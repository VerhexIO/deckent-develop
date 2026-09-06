// ─── Node Builtins ─────────────────────────────────────────────────
import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';

import { framedOutputDigest } from '../core/output-digest.js';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';

// ─── Core (types only — NO brain.ts imports) ──────────────────────
import type {
  BrainContext, SprintSizeRecommendation, PlannerResult, ModelType,
} from '../core/types.js';
import { ALL_PROVIDER_NAMES } from '../core/types.js';
import { BRAIN_PLAN_TIMEOUT_MS } from '../core/constants.js';
import type {
  ProviderAdapter,
  ProviderPlannerCommand,
  ProviderPlannerInvocation,
} from '../core/provider.js';
import { buildCliInvocation, providerRegistry, ProviderError } from '../core/provider.js';
import {
  getLegacyModelMigration,
  inferProviderFromId,
  modelRegistry,
  resolveCanonicalModelIdentity,
} from '../core/model-registry.js';
import type { RegistryProviderNameExt } from '../core/model-registry.js';
import type { RoleInvocationResolution } from '../core/role-invocation-resolver.js';
import { resolveBrainModel } from '../core/config.js';
import { debugLog } from '../core/utils.js';
import type {
  GoNoGoCriterionItem,
  GoNoGoCriterionPolarity,
  TaskScope,
} from '../core/task-types.js';
import {
  createGoNoGoCriterionItem,
  createProductionWiringPlanEvidenceV2,
  deriveProductionWiringApplicability,
  getProviderForModel,
} from '../core/task-types.js';
import {
  ProductionWiringProposalCompletionError,
  completeProductionWiringFromProposal,
  productionWiringContractV2InputFromCanonical,
} from '../core/production-wiring-contract.js';
import { TERMINAL_NATIVE_PROVIDER_PROOF_IDENTITY } from '../core/production-wiring-host-proof.js';
import {
  INVOCATION_RECEIPT_SCHEMA_VERSION,
  type InvocationAuthMode,
  type InvocationEvent,
  type InvocationExecutionBackend,
  type InvocationReceipt,
  type InvocationReceiptLedger,
  type InvocationReceiptRef,
  type InvocationReasonCode,
  type InvocationTransport,
} from '../core/invocation-receipt.js';
import { buildAdrConstraintsPlannerBlock } from '../core/adr-constraints.js';
import {
  stripPhantomScope,
  expandScopeWithAffectedTests,
  type AffectedTestFile,
} from '../core/task-builder-scope.js';
// Dependency-ref resolution reuse (323-031): resolveDependencyRef handles
// slot-id (NNN-NNN) exact match AND title-token match (substring-trap safe);
// isPlanSlotId classifies dropped refs. No import cycle — only sprint-planner
// imports planner.js, so task-builder never re-enters this module.
import { resolveDependencyRef, isPlanSlotId } from './task-builder.js';
// 519-004: the built-binary classification + post-settlement restatement primitives
// live with the Task producer (task-builder); planner owns the validation STAGE.
import {
  classifyBuiltBinaryProofDemand,
  stageBuiltBinaryProofObligation,
  type ProofStagingFinding,
  type ProofStagingSurface,
} from './task-builder.js';
import type { PostSettlementPlanProjection } from '../core/types.js';
import { normalizePlannerResult } from './planner-normalize.js';

// ─── Zod Schemas ──────────────────────────────────────────────────
const PlannerCriterionItemSchema = z.object({
  polarity: z.enum(['go', 'no-go']),
  statement: z.string().min(1),
  evidenceRequirements: z.array(z.string().min(1)).min(1),
});

const PlannerTaskSchema = z.object({
  title: z.string().min(1),
  description: z.string().min(1),
  model: z.string().min(1).refine((model) => getLegacyModelMigration(model) === undefined, 'E_LEGACY_MODEL_ALIAS'),
  effort: z.enum(['low', 'normal', 'high']),
  priority: z.enum(['CRITICAL', 'HIGH', 'NORMAL', 'LOW']),
  reason: z.string(),
  scope: z.object({
    directories: z.array(z.string()),
    filesRead: z.array(z.string()),
    filesWrite: z.array(z.string()),
  }),
  dependencies: z.array(z.string()),
  goNogo: z.object({
    goCriteria: z.string(),
    noGoCriteria: z.string(),
    techDebtAcceptable: z.string(),
    items: z.array(PlannerCriterionItemSchema).optional(),
  }),
  productionWiringProposal: z.unknown().optional(),
  productionWiring: z.unknown().optional(),
});

const PlannerResultSchema = z.object({
  tasks: z.array(PlannerTaskSchema).min(1),
  reasoning: z.string(),
});

// ─── RECOVERY-BORN-PLANNER-DEPENDENCY-SHAPE-001 (MASTER 3332) ────────────────
//
// A nondeterministic planner model sometimes emits `dependencies` as task NUMBERS
// (the 1-based "Task N" ordinal it was shown) or as "Task N" strings instead of
// the exact title strings the schema requires. Before this slice the whole plan
// was rejected as `parse_failed`, the schema-retry repeated the shape, and the
// ledger could not tell a JSON failure from a schema failure. The repair is
// deterministic and bounded: ordinal refs that unambiguously name ANOTHER task in
// the same plan become that task's title; anything else (out of range, self, 0)
// is left as a string so normalizePlannerDependencies drops it VISIBLY later.

/** Secret-safe description of why a planner response was rejected. */
export interface PlannerParseFailure {
  /** `json` = not parseable JSON; `schema` = valid JSON violating PlannerResultSchema;
   *  `wiring` = production-wiring contract rejected. */
  readonly stage: 'json' | 'schema' | 'wiring' | 'identity';
  /** Dotted Zod issue paths with their codes (`tasks.2.dependencies.0:invalid_type`),
   *  capped — never a byte of the model's output. */
  readonly issues: readonly string[];
}

const PLANNER_ISSUE_CAP = 8;
const ORDINAL_DEPENDENCY_RE = /^\s*(?:task\s*#?|#)\s*(\d+)\s*$/i;

export function coercePlannerDependencyShape(parsed: unknown): { value: unknown; coerced: number } {
  if (!parsed || typeof parsed !== 'object') return { value: parsed, coerced: 0 };
  const tasks = (parsed as { tasks?: unknown }).tasks;
  if (!Array.isArray(tasks)) return { value: parsed, coerced: 0 };
  const titles = tasks.map((task) =>
    task && typeof task === 'object' && typeof (task as { title?: unknown }).title === 'string'
      ? (task as { title: string }).title
      : null,
  );
  let coerced = 0;
  const resolveOrdinal = (ordinal: number, selfIndex: number): string | null => {
    if (!Number.isInteger(ordinal)) return null;
    const target = ordinal - 1;
    if (target < 0 || target >= titles.length || target === selfIndex) return null;
    return titles[target] ?? null;
  };
  const nextTasks = tasks.map((task, selfIndex) => {
    if (!task || typeof task !== 'object') return task;
    const deps = (task as { dependencies?: unknown }).dependencies;
    if (!Array.isArray(deps)) return task;
    const nextDeps = deps.map((ref) => {
      if (typeof ref === 'number') {
        const title = resolveOrdinal(ref, selfIndex);
        if (title !== null) { coerced++; return title; }
        return String(ref);
      }
      if (typeof ref === 'string') {
        const match = ORDINAL_DEPENDENCY_RE.exec(ref);
        if (match) {
          const title = resolveOrdinal(Number(match[1]), selfIndex);
          if (title !== null) { coerced++; return title; }
        }
      }
      return ref;
    });
    return { ...(task as object), dependencies: nextDeps };
  });
  return { value: { ...(parsed as object), tasks: nextTasks }, coerced };
}

function summarizeZodIssues(error: z.ZodError): readonly string[] {
  return error.issues
    .slice(0, PLANNER_ISSUE_CAP)
    .map((issue) => `${issue.path.map(String).join('.')}:${issue.code}`);
}

/** One-line, output-free description used in messages and the schema-retry prompt. */
export function describePlannerParseFailure(failure: PlannerParseFailure | undefined): string {
  if (!failure) return 'unparseable output';
  if (failure.stage === 'json') return 'response was not valid JSON';
  if (failure.stage === 'wiring') {
    return failure.issues.length > 0
      ? `production wiring contract rejected at ${failure.issues.join(', ')} (every task that writes production source must carry a valid productionWiring V2 block)`
      : 'production wiring contract rejected';
  }
  if (failure.stage === 'identity') return `model identity rejected (${failure.issues.join(', ')})`;
  return failure.issues.length > 0
    ? `schema violations at ${failure.issues.join(', ')}`
    : 'schema violation';
}

function consumerReasonFor(failure: PlannerParseFailure | undefined): 'parse_failed' | 'validation_failed' {
  return failure?.stage === 'schema' || failure?.stage === 'wiring' || failure?.stage === 'identity'
    ? 'validation_failed'
    : 'parse_failed';
}

/** A planner response that violates the output contract: unparseable/invalid
 *  JSON, or a task model outside the allowed worker policy. `description` is
 *  secret-safe (paths, codes and model API IDs only). */
export interface PlannerContractViolation {
  readonly reasonCode: 'parse_failed' | 'validation_failed';
  readonly description: string;
}

export function describePlannerContractViolation(
  detailed: { result: PlannerResult | null; failure?: PlannerParseFailure },
  policy: PlannerTaskModelPolicy,
): PlannerContractViolation | null {
  if (!detailed.result) {
    return { reasonCode: consumerReasonFor(detailed.failure), description: describePlannerParseFailure(detailed.failure) };
  }
  const disallowed = detailed.result.tasks
    .map((task, index) => ({ index, model: task.model }))
    .filter(({ model }) => !policy.allowedModels.includes(model));
  if (disallowed.length === 0) return null;
  return {
    reasonCode: 'validation_failed',
    description: `model outside the allowed worker policy at ${disallowed
      .slice(0, PLANNER_ISSUE_CAP)
      .map(({ index, model }) => `tasks.${index}.model:${model}`)
      .join(', ')}`,
  };
}

function canonicalPlannerCriteria(
  goCriteria: string,
  noGoCriteria: string,
  authoredItems: readonly z.infer<typeof PlannerCriterionItemSchema>[] | undefined,
): GoNoGoCriterionItem[] {
  const items = (authoredItems ?? []).map(item => createGoNoGoCriterionItem(item));
  const ensurePolarity = (
    polarity: GoNoGoCriterionPolarity,
    legacyStatement: string,
  ): void => {
    if (items.some(item => item.polarity === polarity)) return;
    const statement = legacyStatement.trim();
    if (!statement) return;
    items.push(createGoNoGoCriterionItem({
      polarity,
      statement,
      evidenceRequirements: [statement],
    }));
  };
  // Older planner envelopes have only display strings. Preserve each complete
  // string as one typed generic item; punctuation inside it is never decomposed.
  ensurePolarity('go', goCriteria);
  ensurePolarity('no-go', noGoCriteria);
  return [...new Map(items.map(item => [item.id, item])).values()];
}

// ─── Context Priority Section ─────────────────────────────────────

interface PrioritySection {
  text: string;
  priority: number; // 1 = highest, larger = lower priority
}

/**
 * Build context block from sections with priority-based truncation.
 * When total lines exceed maxLines, lowest-priority sections are trimmed first.
 * Priority order: DIRECTIVES(1) > MEMORY(2) > DEBT(3) > PATTERNS(4) > others(5+)
 * @internal
 */
export function buildPriorityContextBlock(
  sections: PrioritySection[],
  maxLines: number,
): string {
  // Total lines without any truncation
  const totalLines = sections.reduce((sum, s) => sum + (s.text ? s.text.split('\n').length + 1 : 0), 0);

  if (!Number.isSafeInteger(maxLines) || maxLines <= 0 || totalLines > maxLines) {
    throw new RangeError('BRAIN_PLAN_CONTEXT_LIMIT_EXCEEDED');
  }
  return sections.filter(s => s.text).map(s => s.text).join('\n\n');
}

// ─── buildPlanPrompt ──────────────────────────────────────────────

export interface PlannerTaskModelPolicy {
  readonly defaultModel: ModelType;
  readonly allowedModels: readonly ModelType[];
}

/**
 * Build the model vocabulary exposed to the planning model from one concrete
 * worker-provider namespace. The prompt never contains Deckent family aliases;
 * every choice is an exact registry/API identity. A runtime-registered model
 * participates automatically, so versioned/provider-specific IDs remain
 * parametric instead of being frozen into prompt text.
 */
export function createPlannerTaskModelPolicy(
  defaultModel: ModelType,
  provider?: string,
): PlannerTaskModelPolicy {
  const authoredProvider = modelRegistry.get(defaultModel)?.provider ?? inferProviderFromId(defaultModel);
  const targetProvider = provider ?? authoredProvider;
  if (!targetProvider) {
    throw new ProviderError(`E_MODEL_PROVIDER_UNVERIFIED: ${defaultModel}`, 'planner');
  }
  const authoredDefinition = resolveCanonicalModelIdentity(defaultModel, {
    ...(authoredProvider ? { provider: authoredProvider as RegistryProviderNameExt } : {}),
    registerParametric: true,
  });
  const resolvedDefaultModel = authoredDefinition.provider === targetProvider
    ? authoredDefinition.id
    : modelRegistry.getEquivalent(authoredDefinition.id, targetProvider as RegistryProviderNameExt);
  const defaultDefinition = resolveCanonicalModelIdentity(resolvedDefaultModel, {
    provider: targetProvider as RegistryProviderNameExt,
    registerParametric: true,
  });
  const allowedModels = modelRegistry.getAllModels()
    .filter((candidate) => candidate.provider === defaultDefinition.provider && candidate.status === 'ga')
    .sort((left, right) => left.tier.localeCompare(right.tier) || left.id.localeCompare(right.id))
    .map((candidate) => candidate.id as ModelType);
  const canonicalDefaultModel = defaultDefinition.id as ModelType;
  if (!allowedModels.includes(canonicalDefaultModel)) allowedModels.push(canonicalDefaultModel);
  return { defaultModel: canonicalDefaultModel, allowedModels };
}

function resolvePlannerTaskModelPolicy(
  policy?: PlannerTaskModelPolicy,
): PlannerTaskModelPolicy {
  const candidate = policy ?? createPlannerTaskModelPolicy(resolveBrainModel(undefined));
  const allowedModels = [...new Set(candidate.allowedModels)];
  if (!allowedModels.includes(candidate.defaultModel)) allowedModels.push(candidate.defaultModel);
  const defaultProvider = modelRegistry.get(candidate.defaultModel)?.provider
    ?? inferProviderFromId(candidate.defaultModel);
  if (!defaultProvider) {
    throw new ProviderError(`E_MODEL_PROVIDER_UNVERIFIED: ${candidate.defaultModel}`, 'planner');
  }
  for (const model of allowedModels) {
    const provider = modelRegistry.get(model)?.provider ?? inferProviderFromId(model) ?? defaultProvider;
    resolveCanonicalModelIdentity(model, {
      provider,
      registerParametric: true,
    });
  }
  return { defaultModel: candidate.defaultModel, allowedModels };
}

function renderPlannerModelPolicy(policy: PlannerTaskModelPolicy): string {
  return policy.allowedModels.map((model) => {
    const tier = modelRegistry.get(model)?.tier ?? 'standard';
    return `- **${model}** (${tier}): use this exact API ID when that capability/cost tier fits the task`;
  }).join('\n');
}

/**
 * @internal Used only within orchestra/ — builds the AI planner prompt.
 * Not part of the public API surface.
 *
 * SINGLE English prompt (PCOMP-8 U3 language unification, Alperen 2026-07-14):
 * the former TR/EN fork had already drifted — the ADR-constraints block existed
 * only in the TR branch — which is exactly the contradiction class the prompt
 * revolution exists to kill. Model-facing text is EN-only; one source, no fork.
 */
export function buildPlanPrompt(
  context: BrainContext,
  recommendation: SprintSizeRecommendation,
  projectName: string,
  zeroConfigDescription?: string,
  worstCombinations?: string,
  modelPolicy?: PlannerTaskModelPolicy,
): string {
  const criticalDebt = context.debt.filter(d => d.priority === 'CRITICAL' && !d.resolved);
  const critDebtText = criticalDebt.length > 0
    ? `CRITICAL DEBT:\n${criticalDebt.map(d => `- ${d.id}: ${d.description}`).join('\n')}`
    : '';

  const fileTree = context.projectState.fileTree.slice(0, 100);
  const fileTreeText = fileTree.length > 0
    ? `FILE TREE (first ${fileTree.length}):\n${fileTree.join('\n')}`
    : '';

  let zeroConfigText = '';
  if (zeroConfigDescription) {
    zeroConfigText = `ZERO-CONFIG MODE:\nUser started sprint with: "${zeroConfigDescription}"\nSplit into ${zeroConfigTaskRange().min}-${zeroConfigTaskRange().max} independent tasks. Each must be completable on its own.\nExample: "Add login page with Google OAuth" → 1) Auth API endpoints, 2) Google OAuth integration, 3) Login page UI, 4) Tests`;
  }

  // Sections with priority: DIRECTIVES(1) > MEMORY(2) > DEBT(3) > PATTERNS(4) > others(5+)
  const prioritySections: PrioritySection[] = [
    { text: zeroConfigText, priority: 0 },
    { text: context.directives ? `DIRECTIVES:\n${context.directives}` : '', priority: 1 },
    { text: context.memory ? `MEMORY:\n${context.memory}` : '', priority: 2 },
    { text: critDebtText, priority: 3 },
    { text: context.patterns ? `PATTERNS:\n${context.patterns}` : '', priority: 4 },
    { text: context.retro ? `RETRO:\n${context.retro}` : '', priority: 5 },
    { text: context.decisions ? `DECISIONS:\n${context.decisions}` : '', priority: 6 },
    { text: context.projectIdentity ? `PROJECT IDENTITY:\n${context.projectIdentity}` : '', priority: 7 },
    { text: fileTreeText, priority: 8 },
  ];

  // Directives are plan authority; memory has already been selected as bounded
  // whole units by the canonical read service. A second line cap here silently
  // erased both, so production composition preserves every admitted section.
  // Provider capacity/admission remains the one input-budget authority.
  const contextBlock = [{ text: `Project: ${projectName}`, priority: 0 }, ...prioritySections]
    .filter(section => section.text)
    .map(section => section.text)
    .join('\n\n');

  // Inject worst combinations from OutcomeTracker.getWorstCombinations() when available
  // so the AI planner avoids historically poor agent+skill combos
  const worstCombinationsSection = worstCombinations
    ? `\nPAST RESULTS (combinations to avoid):\n${worstCombinations}`
    : '';

  const effectiveModelPolicy = resolvePlannerTaskModelPolicy(modelPolicy);
  const modelSelection = renderPlannerModelPolicy(effectiveModelPolicy);

  return `You are a software project orchestrator. Analyze the given directives and create a structured task plan.

RULES:
- Plan ALL tasks from the directives as task JSON — do not limit the task count
- max_workers (${recommendation.maxWorkers}) is only the concurrent execution limit, not the task count cap
- Each task must be independently executable (parallel execution)
- Specify dependencies in the dependencies array if any exist
- Define scope (directories + filesWrite) for each task
- Write GO/NO-GO criteria for each task
- Emit one goNogo.items object per authored criterion. Do not split free text on semicolons.
- Every item needs a polarity, one atomic statement, and concrete evidenceRequirements.
- Criterion IDs are host-derived after parsing; do not emit an id field.
- For every production mutation, emit the identity-only productionWiringProposal described below.

${FILE_PATH_RULES}

${PRODUCTION_WIRING_PROPOSAL_RULES}

${buildAdrConstraintsPlannerBlock()}
MODEL SELECTION CRITERIA (CHOOSE ONE EXACT API ID FOR EACH TASK):
${modelSelection}
- Never emit a family alias such as opus, sonnet, haiku, gpt-5, or gpt-5.6
- Explain the model selection in the "reason" field (why this model, how complex)

CONTEXT:
${contextBlock}${worstCombinationsSection}

OUTPUT FORMAT (JSON ONLY, nothing else):
{
  "tasks": [
    {
      "title": "...",
      "description": "...",
      "model": "${effectiveModelPolicy.defaultModel}",
      "effort": "low|normal|high",
      "priority": "CRITICAL|HIGH|NORMAL|LOW",
      "reason": "Why this model/effort",
      "scope": { "directories": [...], "filesRead": [...], "filesWrite": [...] },
      "dependencies": [],
      "goNogo": {
        "goCriteria": "...",
        "noGoCriteria": "...",
        "techDebtAcceptable": "...",
        "items": [
          { "polarity": "go", "statement": "...", "evidenceRequirements": ["..."] },
          { "polarity": "no-go", "statement": "...", "evidenceRequirements": ["..."] }
        ]
      },
      "productionWiringProposal": {
        "version": 1,
        "changeKind": "runtime-addition|runtime-change|refactor|removal|foundation|public-library|documentation|data",
        "producer": { "producerId": "..." },
        "canonicalConsumer": { "consumerId": "...", "relationship": "invokes-producer|removed-or-migrated" },
        "affectedIngresses": [{ "ingressId": "...", "kind": "ingress|entrypoint" }],
        "enablementAuthority": { "authorityId": "...", "mechanism": "configuration|policy|registration|unconditional" },
        "disposition": { "kind": "production-wiring" },
        "proofTargets": [{ "proofTargetId": "...", "kind": "consumer-execution|ingress-execution|enablement-resolution|removal-verification|platform|scale" }]
      }
    }
  ],
  "reasoning": "Plan rationale"
}`;
}

// ─── parsePlannerResponse ─────────────────────────────────────────

/**
 * @internal Used only within orchestra/ — parses the AI planner response JSON.
 * Not part of the public API surface.
 */
/**
 * Strip markdown code fences from a text block and return the inner content.
 * Handles ` ```json ... ``` ` and plain ` ``` ... ``` ` wrappers.
 */
function stripCodeFences(text: string): string {
  const trimmed = text.trim();
  const fence = trimmed.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/);
  return fence?.[1] ? fence[1].trim() : trimmed;
}

/**
 * Parse the planner CLI stdout into a PlannerResult.
 *
 * Provider-agnostic: when `adapter` is supplied and implements `parseAgentResponse`,
 * the adapter unwraps its provider-specific envelope first (Claude/Gemini/Codex differ).
 * If no adapter is given, treats stdout as raw text and code-fence-strips it.
 *
 * Returns null when stdout is empty, not valid JSON, or fails schema validation.
 *
 * @param raw      Full stdout captured from spawnSync
 * @param adapter  Provider adapter — when present, used to unwrap CLI envelopes
 */
/** 3332: parse + shape-repair + schema validation with a secret-safe failure envelope. */
export function parsePlannerResponseDetailed(
  raw: string,
  adapter?: ProviderAdapter,
  context: Readonly<{ readonly projectRoot?: string }> = {},
): { result: PlannerResult | null; failure?: PlannerParseFailure } {
  try {
    // Step 1: provider-specific envelope unwrap (Claude/Gemini/Codex)
    const unwrapped = adapter?.parseAgentResponse ? adapter.parseAgentResponse(raw) : raw;

    // Step 2: strip outer code fences
    let cleaned = stripCodeFences(unwrapped);

    // Step 3: first JSON.parse — may yield wrapped envelope if adapter didn't unwrap
    let parsed: unknown;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      // Some adapter unwraps leave a string that's still wrapped in fences/quotes — retry once
      cleaned = stripCodeFences(cleaned.replace(/^"|"$/g, ''));
      parsed = JSON.parse(cleaned);
    }

    // Step 4: defensive fallback unwrap for callers that pass raw without an adapter
    // Mirrors ClaudeAdapter.parseAgentResponse so direct CLI-format stdout still parses.
    if (
      parsed !== null
      && typeof parsed === 'object'
      && (parsed as { type?: unknown }).type === 'result'
      && typeof (parsed as { result?: unknown }).result === 'string'
    ) {
      const inner = stripCodeFences((parsed as { result: string }).result);
      parsed = JSON.parse(inner);
    }

    // 3332: deterministic pre-schema dependency-shape repair (ordinal → title).
    parsed = coercePlannerDependencyShape(parsed).value;

    const result = PlannerResultSchema.safeParse(parsed);
    if (!result.success) {
      debugLog('parsePlannerResponse:validation', result.error);
      return { result: null, failure: { stage: 'schema', issues: summarizeZodIssues(result.error) } };
    }
    const productionWiring = new Map<number, ReturnType<typeof createProductionWiringPlanEvidenceV2>>();
    for (let index = 0; index < result.data.tasks.length; index++) {
      const task = result.data.tasks[index]!;
      const provider = modelRegistry.get(task.model)?.provider ?? inferProviderFromId(task.model);
      resolveCanonicalModelIdentity(task.model, {
        ...(provider ? { provider } : {}),
        registerParametric: false,
      });
      if (task.productionWiringProposal !== undefined && task.productionWiring !== undefined) {
        return { result: null, failure: { stage: 'wiring', issues: [`tasks.${index}.productionWiringProposal:ambiguous`] } };
      }
      const proposal = task.productionWiringProposal ?? task.productionWiring;
      if (proposal !== undefined) {
        try {
          const contract = completeProductionWiringFromProposal(proposal, {
            projectRoot: context.projectRoot ?? process.cwd(),
          });
          productionWiring.set(index, createProductionWiringPlanEvidenceV2(
            productionWiringContractV2InputFromCanonical(contract),
          ));
        } catch (error) {
          const reason = error instanceof ProductionWiringProposalCompletionError
            ? error.reasonCode : 'host-proof-contract-invalid';
          return {
            result: null,
            failure: {
              stage: 'wiring',
              issues: [`tasks.${index}.productionWiringProposal:${reason}`],
            },
          };
        }
      }
      if (deriveProductionWiringApplicability(task.scope).state === 'required'
        && !productionWiring.has(index)) return { result: null, failure: { stage: 'wiring', issues: [`tasks.${index}.productionWiringProposal:required`] } };
    }
    const value = {
      ...result.data,
      tasks: result.data.tasks.map((authoredTask, index) => {
        const {
          productionWiringProposal: _proposal,
          productionWiring: _legacyWiring,
          ...task
        } = authoredTask;
        return {
          ...task,
          productionWiringApplicability: deriveProductionWiringApplicability(task.scope),
          ...(productionWiring.has(index)
            ? { productionWiring: productionWiring.get(index)! }
            : {}),
          goNogo: {
            ...task.goNogo,
            items: canonicalPlannerCriteria(
              task.goNogo.goCriteria,
              task.goNogo.noGoCriteria,
              task.goNogo.items,
            ),
          },
        };
      }),
    } as PlannerResult;
    return { result: value };
  } catch (e) {
    debugLog('parsePlannerResponse:parse', e);
    // SyntaxError = the output was not JSON; anything else surfaced after a
    // successful parse (model identity/provider verification) and is a content
    // failure — labelled distinctly so the ledger never calls it `parse_failed`.
    if (e instanceof SyntaxError) return { result: null, failure: { stage: 'json', issues: [] } };
    const name = e instanceof Error ? e.name : 'Error';
    const code = e instanceof Error ? e.message.split(':')[0]?.trim() ?? '' : '';
    return { result: null, failure: { stage: 'identity', issues: [`${name}:${code}`.slice(0, 120)] } };
  }
}

export function parsePlannerResponse(raw: string, adapter?: ProviderAdapter): PlannerResult | null {
  return parsePlannerResponseDetailed(raw, adapter).result;
}

// ─── Provider Command Extraction ──────────────────────────────────

/**
 * @internal Build planner-specific spawn args from a ProviderAdapter.
 * If the adapter implements buildPlannerCommand(), delegates entirely to it.
 * Otherwise extracts CLI binary from adapter.buildCommand() and builds
 * generic args (first token as command, standard flags).
 */
export interface PlannerSpawnSpec {
  readonly command: string;
  readonly args: string[];
  readonly stdin?: string;
  readonly calledProvider: string;
  readonly calledModel: string;
  readonly transport: InvocationTransport;
  readonly executionBackend: InvocationExecutionBackend;
}

function extractWireModel(command: ProviderPlannerCommand): string | null {
  for (const flag of ['--model', '-m']) {
    const index = command.args.indexOf(flag);
    if (index >= 0 && command.args[index + 1]) return command.args[index + 1]!;
  }
  for (const flag of ['-d', '--data', '--data-binary']) {
    const index = command.args.indexOf(flag);
    const value = index >= 0 ? command.args[index + 1] : undefined;
    if (!value?.startsWith('{')) continue;
    try {
      const parsed = JSON.parse(value) as { model?: unknown };
      if (typeof parsed.model === 'string' && parsed.model) return parsed.model;
    } catch {
      // The provider may use a non-JSON request body; fail loudly below.
    }
  }
  return null;
}

function canonicalProviderFromAdapter(adapter: ProviderAdapter): string {
  for (const provider of ALL_PROVIDER_NAMES) {
    if (adapter.name === provider || adapter.name.startsWith(`${provider}-`)) return provider;
  }
  return adapter.name;
}

function normalizePlannerCommand(
  adapter: ProviderAdapter,
  command: ProviderPlannerCommand,
  expectedModel: ModelType,
): PlannerSpawnSpec {
  const wireModel = extractWireModel(command);
  if (!wireModel) {
    throw new ProviderError(
      `Provider "${adapter.name}" planner command omitted an exact wire model`,
      adapter.name,
    );
  }
  if (command.calledModel && command.calledModel !== wireModel) {
    throw new ProviderError(
      `Provider "${adapter.name}" planner metadata does not match its wire model`,
      adapter.name,
    );
  }
  if (wireModel !== expectedModel) {
    throw new ProviderError(
      `Provider "${adapter.name}" planner wire model differs from the resolved model`,
      adapter.name,
    );
  }
  const calledProvider = canonicalProviderFromAdapter(adapter);
  if (command.calledProvider && command.calledProvider !== calledProvider) {
    throw new ProviderError(
      `Provider "${adapter.name}" planner metadata does not match its adapter identity`,
      adapter.name,
    );
  }
  resolveCanonicalModelIdentity(wireModel, {
    provider: calledProvider as RegistryProviderNameExt,
    registerParametric: false,
  });
  return {
    command: command.command,
    args: command.args,
    ...(command.stdin === undefined ? {} : { stdin: command.stdin }),
    calledProvider,
    calledModel: wireModel,
    transport: command.transport ?? 'cli',
    executionBackend: command.executionBackend ?? 'host-subprocess',
  };
}

function normalizeNativePlannerInvocation(
  adapter: ProviderAdapter,
  invocation: ProviderPlannerInvocation,
  expectedModel: ModelType,
): PlannerSpawnSpec {
  const calledProvider = canonicalProviderFromAdapter(adapter);
  if (invocation.calledProvider !== calledProvider) {
    throw new ProviderError(
      `Provider "${adapter.name}" native planner metadata does not match its adapter identity`,
      adapter.name,
    );
  }
  if (invocation.calledModel !== expectedModel) {
    throw new ProviderError(
      `Provider "${adapter.name}" native planner model differs from the resolved model`,
      adapter.name,
    );
  }
  resolveCanonicalModelIdentity(invocation.calledModel, {
    provider: calledProvider as RegistryProviderNameExt,
    registerParametric: false,
  });
  return {
    command: `[native:${calledProvider}]`,
    args: [],
    calledProvider,
    calledModel: invocation.calledModel,
    transport: invocation.transport,
    executionBackend: invocation.executionBackend,
  };
}

export function buildPlannerSpawnArgs(
  adapter: ProviderAdapter,
  prompt: string,
  model: ModelType,
): PlannerSpawnSpec {
  // Delegate to adapter if it provides its own planner command builder
  if (typeof adapter.buildPlannerCommand === 'function') {
    return normalizePlannerCommand(adapter, adapter.buildPlannerCommand(prompt, model), model);
  }

  // Generic fallback: extract CLI binary from adapter.buildCommand()
  const shellCommand = adapter.buildCommand(model, '/dev/null');
  const firstToken = shellCommand.split(/\s+/)[0];
  if (!firstToken) {
    throw new ProviderError(`Provider "${adapter.name}" returned empty buildCommand result`, adapter.name);
  }
  // Sprint 238 İŞ5: pass the real model name (apiId, e.g. claude-opus-4-8) to the
  // brain planner CLI, not the alias — so AI planning targets the exact version
  // (no 4-6/4-8 confusion), matching the worker-spawn fix (Sprint 237). Falls back
  // to the raw model for unregistered tags (ollama) / custom CLIs.
  const apiId = modelRegistry.get(model)?.apiId ?? model;
  return normalizePlannerCommand(adapter, {
    command: firstToken,
    args: ['-p', prompt, '--model', apiId, '--output-format', 'json'],
    calledProvider: canonicalProviderFromAdapter(adapter),
    calledModel: apiId,
    transport: 'cli',
    executionBackend: 'host-subprocess',
  }, model);
}

/**
 * @internal Resolve the provider adapter to use for planner calls.
 * If an adapter is explicitly provided, use it. Otherwise, when an explicit
 * `requestedProvider` authority is supplied, resolve ONLY that adapter. When no
 * provider authority is supplied but a `model` is given, resolve ONLY the
 * adapter that owns that canonical model identity.
 * Unknown models and absent owner adapters fail before dispatch: registry
 * default order is not model ownership, reachability, or fallback authority.
 *
 * Model-less legacy callers retain ProviderRegistry.getDefault(). Evidence-backed
 * role fallback is a separate admission decision and must inject the selected
 * adapter rather than relying on this identity resolver.
 */
export function resolveAdapter(
  adapter?: ProviderAdapter,
  model?: ModelType,
  requestedProvider?: string | null,
): ProviderAdapter {
  if (adapter) return adapter;
  if (requestedProvider) return providerRegistry.getProvider(requestedProvider);
  if (model) return providerRegistry.getProvider(getProviderForModel(model));
  // Throws ProviderError('No providers registered') if registry is empty
  return providerRegistry.getDefault();
}

// ─── callBrainPlanner ─────────────────────────────────────────────

/**
 * Discriminated failure reason for AI planner invocation.
 *
 * - `spawn_failed`: subprocess could not start, exited non-zero, or returned empty stdout
 * - `timeout`: subprocess killed by SIGTERM after exceeding `brain_plan_timeout_ms`
 * - `parse_failed`: stdout could not be JSON-parsed or stripped of provider envelope
 * - `validation_failed`: parsed JSON failed Zod schema validation (PlannerResultSchema)
 * - `no_providers`: ProviderRegistry empty or requested provider missing
 */
export { framedOutputDigest };

export type PlannerFailureReason =
  | 'spawn_failed'
  | 'timeout'
  | 'parse_failed'
  | 'validation_failed'
  | 'no_providers'
  | 'receipt_failed'
  | 'receipt_replay_blocked';

/**
 * Discriminated union returned by `callBrainPlanner`. Replaces the legacy
 * `PlannerResult | null` shape so callers can distinguish *why* the AI planner
 * failed and surface the real reason instead of silently dropping to structured.
 *
 * See [[feedback_ai_planner_silent_fallback]].
 */
/**
 * Secret-safe diagnostic envelope for a planner failure.
 *
 * A failure message is read by a human and may be logged, so it must never carry
 * provider output verbatim: stderr routinely contains tokens, auth URLs and
 * absolute paths. These fields describe the output instead of reproducing it —
 * enough to tell one failure apart from another and to correlate with the
 * invocation receipt, with nothing to leak.
 */
export interface PlannerFailureEvidence {
  readonly provider: string;
  readonly model?: string;
  readonly durationMs?: number;
  readonly exitCode?: number | null;
  readonly signal?: string | null;
  readonly stdoutBytes?: number;
  readonly stderrBytes?: number;
  /**
   * Algorithm-prefixed digest of the provider output, computed over a
   * byte-length-framed encoding so `stdout`/`stderr` cannot be confused for one
   * another by concatenation (`sha256:<hex>`).
   */
  readonly outputDigest?: string;
  /** Where a parse gave up, when the reason is `parse_failed`. */
  readonly parserStage?: string;
}

export type PlannerCallResult =
  | { ok: true; data: PlannerResult; receiptRef?: InvocationReceiptRef }
  | {
      ok: false;
      reason: PlannerFailureReason;
      message: string;
      receiptRef?: InvocationReceiptRef;
      evidence?: PlannerFailureEvidence;
    };


export interface PlannerReceiptContext {
  readonly tenantId: string;
  readonly projectRoot: string;
  readonly runId: string;
  readonly taskId?: string | null;
  readonly configuredProvider?: string | null;
  readonly requestedProvider?: string | null;
  readonly configuredModel?: string | null;
  readonly requestedModel?: string | null;
  readonly authMode?: InvocationAuthMode;
  readonly accountRefHash?: string | null;
  readonly idempotencyKey?: string;
  readonly invocationId?: string;
  readonly callId?: string;
  readonly store?: InvocationReceiptLedger;
  readonly now?: () => string;
  readonly idFactory?: () => string;
  /** Evidence-backed role admission decision. Without it the receipt records
   *  router selection only and MUST NOT synthesize a fallback claim. */
  readonly resolution?: Pick<
    RoleInvocationResolution,
    'configured' | 'resolved' | 'fallbackChain' | 'reachability' | 'limits'
  >;
}

interface PlannerReceiptFacts {
  readonly resolvedProvider: string | null;
  readonly resolvedModel: string | null;
  readonly calledProvider: string | null;
  readonly calledModel: string | null;
  readonly transport: InvocationTransport;
  readonly executionBackend: InvocationExecutionBackend;
  readonly missingReason: InvocationReasonCode;
}

interface PlannerReceiptSession {
  readonly store: InvocationReceiptLedger;
  readonly ownedStore: boolean;
  readonly ref: InvocationReceiptRef;
  readonly created: boolean;
  append(event: Omit<InvocationEvent, 'eventId'>): void;
  close(): void;
}

function deterministicInvocationId(context: PlannerReceiptContext): string {
  const seed = [context.tenantId, context.runId, context.taskId ?? '', 'brain', 'sprint-planning'].join('\u0000');
  return `inv-${createHash('sha256').update(seed).digest('hex').slice(0, 32)}`;
}

async function beginPlannerReceipt(
  context: PlannerReceiptContext,
  facts: PlannerReceiptFacts,
): Promise<PlannerReceiptSession> {
  let store = context.store;
  let ownedStore = false;
  if (!store) {
    const { InvocationReceiptStore } = await import('../core/invocation-receipt-store.js');
    store = new InvocationReceiptStore(context.projectRoot);
    ownedStore = true;
  }
  const now = context.now ?? (() => new Date().toISOString());
  const idFactory = context.idFactory ?? randomUUID;
  const invocationId = context.invocationId ?? deterministicInvocationId(context);
  const callId = context.callId ?? `${invocationId}:call-1`;
  const resolution = context.resolution;
  if (resolution && resolution.resolved.provider !== null
    && (resolution.resolved.provider !== facts.resolvedProvider
      || resolution.resolved.model !== facts.resolvedModel)) {
    if (ownedStore) store.close();
    throw new ProviderError('E_INVOCATION_RESOLUTION_IDENTITY_MISMATCH', 'planner');
  }
  const missingSelection = (source: 'config' | 'router' | 'wire') => ({
    provider: null,
    model: null,
    source,
    reasonCode: facts.missingReason,
  } as const);
  const receipt: InvocationReceipt = {
    schemaVersion: INVOCATION_RECEIPT_SCHEMA_VERSION,
    invocationId,
    idempotencyKey: context.idempotencyKey ?? `${context.runId}:brain:sprint-planning:1`,
    tenantId: context.tenantId,
    projectId: store.projectId,
    runId: context.runId,
    taskId: context.taskId ?? null,
    callId,
    role: 'brain',
    purpose: 'sprint-planning',
    configured: resolution?.configured ?? (context.configuredProvider || context.configuredModel
      ? {
          provider: context.configuredProvider ?? null,
          model: context.configuredModel ?? null,
          source: 'config',
          reasonCode: 'none',
        }
      : missingSelection('config')),
    requested: context.requestedProvider || context.requestedModel
      ? {
          provider: context.requestedProvider ?? null,
          model: context.requestedModel ?? null,
          source: 'config',
          reasonCode: 'none',
        }
      : missingSelection('config'),
    resolved: resolution?.resolved ?? (facts.resolvedProvider || facts.resolvedModel
      ? {
          provider: facts.resolvedProvider,
          model: facts.resolvedModel,
          source: 'router',
          reasonCode: 'none',
        }
      : missingSelection('router')),
    called: facts.calledProvider || facts.calledModel
      ? {
          provider: facts.calledProvider,
          model: facts.calledModel,
          source: 'wire',
          reasonCode: 'none',
        }
      : missingSelection('wire'),
    backend: { transport: facts.transport, executionBackend: facts.executionBackend },
    auth: { mode: context.authMode ?? 'unknown', accountRefHash: context.accountRefHash ?? null },
    fallbackChain: resolution?.fallbackChain ?? [],
    reachability: resolution?.reachability ?? { state: 'unknown', evidenceRef: null },
    limits: resolution?.limits ?? { state: 'unknown', evidenceRefs: [] },
    createdAt: now(),
  };
  try {
    const declaration = store.declare(receipt);
    return {
      store,
      ownedStore,
      ref: declaration.ref,
      created: declaration.created,
      append: (event) => {
        store!.append(declaration.ref, invocationId, { ...event, eventId: idFactory() } as InvocationEvent);
      },
      close: () => {
        if (ownedStore) store!.close();
      },
    };
  } catch (error) {
    if (ownedStore) store.close();
    throw error;
  }
}

function receiptFailure(message: string, receiptRef?: InvocationReceiptRef): PlannerCallResult {
  return { ok: false, reason: 'receipt_failed', message, receiptRef };
}

/**
 * @internal Used only within orchestra/ — invokes the AI planner subprocess and
 * returns a discriminated `PlannerCallResult`. On failure, `reason` names the
 * exact category (`spawn_failed` / `timeout` / `parse_failed` / `validation_failed`
 * / `no_providers`) and `message` carries provider/stderr/timeout detail so the
 * caller (planSprint) can surface it to the user instead of falling back silently.
 *
 * This is the canonical entry point for Sprint 224 task 224-001's honest-fallback
 * contract. The legacy `callBrainPlanner()` thin wrapper below delegates to this
 * function and collapses failure to `null` for backward compatibility with older
 * call sites (other test files that mock `callBrainPlanner` returning null).
 *
 * @param adapter  Optional ProviderAdapter. If omitted, uses ProviderRegistry.getDefault().
 *                 Returns `{ok: false, reason: 'no_providers'}` if no provider is available.
 * @param timeout  Subprocess timeout in milliseconds. Defaults to BRAIN_PLAN_TIMEOUT_MS.
 *                 Configurable via `brain_plan_timeout_ms` (sprint-planner wires it
 *                 from ResolvedConfig). Default is 900s (Sprint 184) for opus on
 *                 large zero-config prompts.
 * @param worstCombinations  Optional output from OutcomeTracker.getWorstCombinations().
 *   Injects GECMIS SONUCLAR / past results block into the AI planner prompt so the
 *   planner avoids historically poor agent+skill combinations.
 */
// ─── F-2 — async planner spawn (the spawnSync freeze-class fix) ──────────────
//
// The planner's LLM calls used `spawnSync`, which blocks the WHOLE event loop
// for the entire provider round-trip (up to brain_plan_timeout_ms — 15 min by
// default): no progress line can render, Ctrl-C degrades, and `deckent do`
// looks hung. This seam replaces it with an async spawn carrying the SAME
// observable semantics (SIGTERM on timeout, status/stdout/stderr surface),
// injectable for hermetic tests (model-auto-detect's `spawnFn` precedent).

export interface PlannerSpawnOutcome {
  status: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  /** Populated when the process could not be spawned at all (e.g. ENOENT). */
  error?: Error;
}

export type PlannerSpawnFn = (
  command: string,
  args: readonly string[],
  opts: { timeoutMs: number; stdin?: string },
) => Promise<PlannerSpawnOutcome>;

export interface PlannerSpawnDependencies {
  readonly platform?: NodeJS.Platform;
  readonly spawnImpl?: typeof spawn;
}

/** Build the planner subprocess seam with injectable platform/process dependencies. */
export function createPlannerSpawn(
  dependencies: PlannerSpawnDependencies = {},
): PlannerSpawnFn {
  const platform = dependencies.platform ?? process.platform;
  const spawnImpl = dependencies.spawnImpl ?? spawn;
  return (command, args, opts) => new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let child;
    const settle = (outcome: PlannerSpawnOutcome): void => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve(outcome);
    };
    try {
      const invocation = buildCliInvocation(command, [...args], platform);
      child = spawnImpl(invocation.command, invocation.args, {
        stdio: [opts.stdin === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
        shell: invocation.shell,
      });
    } catch (e) {
      settle({ status: null, signal: null, stdout, stderr, error: e as Error });
      return;
    }
    timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill('SIGTERM');
      } catch {
        // already gone — close will resolve
      }
    }, opts.timeoutMs);
    timer.unref?.();
    child.stdout?.setEncoding('utf-8');
    child.stderr?.setEncoding('utf-8');
    child.stdout?.on('data', (d: string) => { stdout += d; });
    child.stderr?.on('data', (d: string) => { stderr += d; });
    child.on('error', (err) => {
      settle({ status: null, signal: null, stdout, stderr, error: err });
    });
    child.on('close', (code, signal) => {
      // A kill we issued at the deadline is a timeout even if the OS reports
      // the signal differently — keep spawnSync's SIGTERM contract.
      settle({ status: code, signal: timedOut ? 'SIGTERM' : signal, stdout, stderr });
    });
    if (opts.stdin !== undefined) {
      const onStdinError = (error: Error): void => {
        if (settled) return;
        // The deadline path owns settlement once it has sent SIGTERM. A large
        // in-flight stdin write can then report EPIPE; consuming that stream
        // error must not reclassify the canonical timeout as spawn_error.
        if (timedOut) return;
        try { child.kill('SIGTERM'); } catch { /* already gone */ }
        settle({ status: null, signal: null, stdout, stderr, error });
      };
      if (!child.stdin) {
        onStdinError(new Error('Planner stdin transport is unavailable'));
        return;
      }
      child.stdin.on('error', onStdinError);
      try {
        child.stdin.end(opts.stdin);
      } catch (error) {
        onStdinError(error instanceof Error ? error : new Error(String(error)));
      }
    }
  });
}

/** Default planner spawn: async child_process.spawn + SIGTERM at `timeoutMs`
 *  (mirrors spawnSync's timeout contract — a timed-out run resolves with
 *  `signal: 'SIGTERM'`). Never rejects; spawn-level failures surface as
 *  `error` so callers keep their single mapping path. */
export const defaultPlannerSpawn: PlannerSpawnFn = (command, args, opts) =>
  createPlannerSpawn()(command, args, opts);

/** ONE source for the effective planner timeout: config `brain_plan_timeout_ms`
 *  (Sprint 224 contract) → legacy `ai_planner_timeout` → BRAIN_PLAN_TIMEOUT_MS.
 *  Used by sprint-planner (ai-mode), the run-proposal compiler (zero-config)
 *  and `deckent do`'s planning notice — so the number the user SEES is the
 *  number that actually governs the spawn. */
export function resolvePlanTimeoutMs(
  config?: { brain_plan_timeout_ms?: number; ai_planner_timeout?: number },
): number {
  return config?.brain_plan_timeout_ms ?? config?.ai_planner_timeout ?? BRAIN_PLAN_TIMEOUT_MS;
}

export async function callBrainPlannerWithReason(
  context: BrainContext,
  recommendation: SprintSizeRecommendation,
  model: ModelType,
  projectName: string,
  adapter?: ProviderAdapter,
  timeout?: number,
  worstCombinations?: string,
  spawnFn: PlannerSpawnFn = defaultPlannerSpawn,
  receiptContext?: PlannerReceiptContext,
  modelPolicy?: PlannerTaskModelPolicy,
): Promise<PlannerCallResult> {
  const effectiveModelPolicy = resolvePlannerTaskModelPolicy(
    modelPolicy ?? createPlannerTaskModelPolicy(model),
  );
  const prompt = buildPlanPrompt(
    context, recommendation, projectName, undefined, worstCombinations, effectiveModelPolicy,
  );

  const rejectedBeforeDispatch = async (
    facts: PlannerReceiptFacts,
    reason: PlannerFailureReason,
    reasonCode: InvocationReasonCode,
    message: string,
  ): Promise<PlannerCallResult> => {
    if (!receiptContext) return { ok: false, reason, message };
    let receipt: PlannerReceiptSession;
    try {
      receipt = await beginPlannerReceipt(receiptContext, facts);
    } catch {
      return receiptFailure('INVOCATION_RECEIPT_DECLARE_FAILED');
    }
    if (!receipt.created) {
      receipt.close();
      return {
        ok: false,
        reason: 'receipt_replay_blocked',
        message: 'INVOCATION_RECEIPT_DUPLICATE_DISPATCH_BLOCKED',
        receiptRef: receipt.ref,
      };
    }
    try {
      receipt.append({ type: 'dispatch_rejected', payload: { reasonCode } });
      receipt.append({ type: 'consumer_settled', payload: { outcome: 'rejected', reasonCode } });
      return { ok: false, reason, message, receiptRef: receipt.ref };
    } catch {
      return receiptFailure('INVOCATION_RECEIPT_EVENT_WRITE_FAILED', receipt.ref);
    } finally {
      receipt.close();
    }
  };

  // resolveAdapter throws ProviderError when registry is empty or provider missing.
  // Surface as `no_providers` reason so the caller does not silently fall back.
  let resolved: ProviderAdapter;
  try {
    resolved = resolveAdapter(adapter, model, receiptContext?.requestedProvider);
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    return rejectedBeforeDispatch(
      {
        resolvedProvider: null,
        resolvedModel: null,
        calledProvider: null,
        calledModel: null,
        transport: 'cli',
        executionBackend: 'host-subprocess',
        missingReason: 'no_provider',
      },
      'no_providers',
      'no_provider',
      `Provider registry empty or missing requested provider: ${detail}`,
    );
  }

  let cmdInfo: PlannerSpawnSpec;
  let nativeInvocation: ProviderPlannerInvocation | undefined;
  try {
    nativeInvocation = resolved.buildPlannerInvocation?.(prompt, model);
    cmdInfo = nativeInvocation
      ? normalizeNativePlannerInvocation(resolved, nativeInvocation, model)
      : buildPlannerSpawnArgs(resolved, prompt, model);
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    return rejectedBeforeDispatch(
      {
        resolvedProvider: canonicalProviderFromAdapter(resolved),
        resolvedModel: model,
        calledProvider: null,
        calledModel: null,
        transport: 'cli',
        executionBackend: 'host-subprocess',
        missingReason: 'command_build_failed',
      },
      'spawn_failed',
      'command_build_failed',
      `Could not build planner command for provider=${resolved.name}: ${detail}`,
    );
  }

  const effectiveTimeout = timeout ?? BRAIN_PLAN_TIMEOUT_MS;
  let receipt: PlannerReceiptSession | undefined;
  if (receiptContext) {
    try {
      receipt = await beginPlannerReceipt(receiptContext, {
        resolvedProvider: canonicalProviderFromAdapter(resolved),
        resolvedModel: model,
        calledProvider: cmdInfo.calledProvider,
        calledModel: cmdInfo.calledModel,
        transport: cmdInfo.transport,
        executionBackend: cmdInfo.executionBackend,
        missingReason: 'none',
      });
    } catch {
      return receiptFailure('INVOCATION_RECEIPT_DECLARE_FAILED');
    }
    if (!receipt.created) {
      receipt.close();
      return {
        ok: false,
        reason: 'receipt_replay_blocked',
        message: 'INVOCATION_RECEIPT_DUPLICATE_DISPATCH_BLOCKED',
        receiptRef: receipt.ref,
      };
    }
    try {
      receipt.append({ type: 'dispatch_started', payload: { attempt: 1 } });
    } catch {
      const receiptRef = receipt.ref;
      receipt.close();
      return receiptFailure('INVOCATION_RECEIPT_PRE_DISPATCH_WRITE_FAILED', receiptRef);
    }
  }

  const finish = (
    events: Array<Omit<InvocationEvent, 'eventId'>>,
    result: PlannerCallResult,
  ): PlannerCallResult => {
    if (!receipt) return result;
    try {
      for (const event of events) receipt.append(event);
      return { ...result, receiptRef: receipt.ref };
    } catch {
      return receiptFailure('INVOCATION_RECEIPT_SETTLEMENT_WRITE_FAILED', receipt.ref);
    } finally {
      receipt.close();
    }
  };

  const startedAt = Date.now();
  let result: PlannerSpawnOutcome;
  try {
    result = nativeInvocation
      ? await nativeInvocation.execute({ timeoutMs: effectiveTimeout })
      : await spawnFn(cmdInfo.command, cmdInfo.args, {
          timeoutMs: effectiveTimeout,
          ...(cmdInfo.stdin === undefined ? {} : { stdin: cmdInfo.stdin }),
        });
  } catch (error) {
    result = {
      status: null,
      signal: null,
      stdout: '',
      stderr: '',
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
  const durationMs = Math.max(0, Date.now() - startedAt);

  // SIGTERM indicates the process was killed at the configured timeout.
  // Surface as `timeout` so the caller can suggest raising brain_plan_timeout_ms.
  if (result.signal === 'SIGTERM') {
    return finish(
      [
        {
          type: 'transport_settled',
          payload: { outcome: 'timeout', exitCode: result.status, signal: result.signal, reasonCode: 'timeout', durationMs },
        },
        { type: 'consumer_settled', payload: { outcome: 'rejected', reasonCode: 'timeout' } },
      ],
      {
        ok: false,
        reason: 'timeout',
        message:
        `Subscription spawn timed out after ${effectiveTimeout}ms (provider=${resolved.name}). ` +
        `Consider raising brain_plan_timeout_ms in config or passing a larger timeout.`,
        evidence: { provider: resolved.name, durationMs: effectiveTimeout },
      },
    );
  }

  if (result.error) {
    return finish(
      [
        {
          type: 'transport_settled',
          payload: { outcome: 'failed', exitCode: null, signal: null, reasonCode: 'spawn_error', durationMs },
        },
        { type: 'consumer_settled', payload: { outcome: 'rejected', reasonCode: 'spawn_error' } },
      ],
      {
        ok: false,
        reason: 'spawn_failed',
        message: `spawn error for provider=${resolved.name}: ${result.error.message}`,
        evidence: {
          provider: resolved.name,
          durationMs,
          exitCode: null,
          signal: null,
        },
      },
    );
  }

  if (result.status !== 0 || !result.stdout) {
    // The provider's stderr is NOT rendered: it routinely carries tokens, auth
    // URLs and absolute paths, and this message reaches logs and the operator's
    // screen. Byte counts plus a framed digest identify the failure without
    // reproducing any of it; the receipt carries the correlatable identity.
    const stdoutText = (result.stdout ?? '').toString();
    const stderrText = (result.stderr ?? '').toString();
    const stdoutBytes = Buffer.byteLength(stdoutText, 'utf8');
    const stderrBytes = Buffer.byteLength(stderrText, 'utf8');
    const outputDigest = framedOutputDigest([stdoutText, stderrText]);
    const reasonCode: InvocationReasonCode = result.status !== 0 ? 'nonzero_exit' : 'empty_output';
    return finish(
      [
        {
          type: 'transport_settled',
          payload: { outcome: 'failed', exitCode: result.status, signal: result.signal, reasonCode, durationMs },
        },
        { type: 'consumer_settled', payload: { outcome: 'rejected', reasonCode } },
      ],
      {
        ok: false,
        reason: 'spawn_failed',
        message:
        `provider=${resolved.name} exited with status=${result.status ?? 'null'}, `
        + `stdout=${stdoutBytes} bytes, stderr=${stderrBytes} bytes, output=${outputDigest}`,
        evidence: {
          provider: resolved.name,
          exitCode: result.status ?? null,
          signal: result.signal ?? null,
          durationMs,
          stdoutBytes,
          stderrBytes,
          outputDigest,
        },
      },
    );
  }

  const detailedParse = parsePlannerResponseDetailed(result.stdout, resolved, {
    projectRoot: receiptContext?.projectRoot ?? process.cwd(),
  });
  const parsed = detailedParse.result;
  if (!parsed) {
    const parseReason = consumerReasonFor(detailedParse.failure);
    // Same rule as the nonzero-exit branch: the model's own output can echo
    // prompt context (paths, project content, credentials pasted into it), so a
    // raw snippet is not a safe diagnostic. The digest identifies the exact
    // output for correlation without reproducing a byte of it.
    const stdoutBytes = Buffer.byteLength(result.stdout, 'utf8');
    const outputDigest = framedOutputDigest([result.stdout]);
    return finish(
      [
        {
          type: 'transport_settled',
          payload: { outcome: 'succeeded', exitCode: 0, signal: null, reasonCode: 'none', durationMs },
        },
        { type: 'consumer_settled', payload: { outcome: 'rejected', reasonCode: parseReason } },
      ],
      {
        ok: false,
        reason: parseReason,
        message:
        `provider=${resolved.name} ${describePlannerParseFailure(detailedParse.failure)} `
        + `(${stdoutBytes} bytes, output=${outputDigest})`,
        evidence: {
          provider: resolved.name,
          durationMs,
          exitCode: 0,
          signal: null,
          stdoutBytes,
          outputDigest,
          parserStage: `planner-${detailedParse.failure?.stage ?? 'json'}`,
        },
      },
    );
  }

  const disallowedModel = parsed.tasks.find(
    (task) => !effectiveModelPolicy.allowedModels.includes(task.model),
  );
  if (disallowedModel) {
    return finish(
      [
        {
          type: 'transport_settled',
          payload: { outcome: 'succeeded', exitCode: 0, signal: null, reasonCode: 'none', durationMs },
        },
        { type: 'consumer_settled', payload: { outcome: 'rejected', reasonCode: 'validation_failed' } },
      ],
      {
        ok: false,
        reason: 'validation_failed',
        message: `provider=${resolved.name} returned model outside the allowed worker policy: ${disallowedModel.model}`,
      },
    );
  }

  return finish(
    [
      {
        type: 'transport_settled',
        payload: { outcome: 'succeeded', exitCode: 0, signal: null, reasonCode: 'none', durationMs },
      },
      {
        type: 'consumer_settled',
        payload: { outcome: 'accepted', reasonCode: 'none' },
      },
    ],
    { ok: true, data: parsed },
  );
}

/**
 * @internal Legacy thin wrapper preserved for backward compatibility with
 * pre-Sprint-224 call sites and test mocks that expect `PlannerResult | null`.
 *
 * New code (and Sprint 224 task 224-001's honest-fallback path) MUST call
 * `callBrainPlannerWithReason` instead so failure details (`reason`, `message`)
 * surface to the user. This wrapper drops them.
 *
 * Note: when no provider is registered this wrapper throws (mirrors the original
 * behavior — see `tests/orchestra/planner.test.ts` "throws when registry is empty"),
 * because `no_providers` was originally a thrown ProviderError, not a null return.
 */
export async function callBrainPlanner(
  context: BrainContext,
  recommendation: SprintSizeRecommendation,
  model: ModelType,
  projectName: string,
  adapter?: ProviderAdapter,
  timeout?: number,
  worstCombinations?: string,
  spawnFn?: PlannerSpawnFn,
  receiptContext?: PlannerReceiptContext,
  modelPolicy?: PlannerTaskModelPolicy,
): Promise<PlannerResult | null> {
  const result = await callBrainPlannerWithReason(
    context, recommendation, model, projectName, adapter, timeout, worstCombinations, spawnFn,
    receiptContext,
    modelPolicy,
  );
  if (result.ok) return result.data;
  if (result.reason === 'no_providers') {
    // Preserve legacy throw contract (ProviderError surfaces via thrown Error).
    throw new ProviderError(result.message, adapter?.name ?? '');
  }
  return null;
}

// ─── Zero-Config AI Planner ───────────────────────────────────────

// U2-G6 (PCOMP-8): the 3-5 hardcode structurally violated the 20-40-micro-task
// law (scale_up — CC'nin kayıtlı ihlal-itirafı). The range now comes from
// config/env; the historical 3-5 stays as the ABSOLUTE fallback so foreign
// projects without config keep today's behavior.
function zeroConfigTaskRange(): { min: number; max: number } {
  const min = Number(process.env['DECKENT_PLANNER_MIN_TASKS'] ?? '') || 3;
  const max = Number(process.env['DECKENT_PLANNER_MAX_TASKS'] ?? '') || 5;
  return min <= max ? { min, max } : { min: 3, max: 5 };
}

/**
 * Build a prompt specifically for splitting a single natural-language description
 * into structured tasks (range from zeroConfigTaskRange()) that the AI planner
 * can assign to workers.
 *
 * SINGLE English prompt (PCOMP-8 U3 language unification, Alperen 2026-07-14):
 * the former TR/EN fork had drifted — the ADR-constraints block existed only in
 * the TR branch while production defaulted to TR. One source, no fork.
 */
// ─── F-1 — planner file-path contract (ONE source for BOTH prompts) ──────────
// The path-sprawl class: a planner that is blind to the repo (or ungoverned on
// path shape) invents bare/nonexistent paths ("README.md", "tests/x"). Rule 5
// of the scope sanitizer silently drops bare filenames, and the SAN-1
// prompt-gate lint escalates every such drop to a plan-time BLOCK — the user
// then hits a gate error they never caused. This block makes the rules
// explicit to the model; scope-sanitizer.ts's WELL_KNOWN_ROOT_FILES carve-out
// is the deterministic backstop for the root-file class when a model still
// disobeys.
const FILE_PATH_RULES = `FILE PATH RULES:
- Every scope.filesWrite / scope.filesRead entry MUST be repo-relative AND directory-qualified (e.g. "src/auth/login.ts" — NEVER a bare filename like "login.ts")
- Exception: well-known root files (README.md, LICENSE, CHANGELOG.md, CONTRIBUTING.md) may be written by their bare name
- scope.filesRead may ONLY list files that actually exist (see the file tree when provided) — never claim a file you have not seen
- Creating NEW files is allowed and normal — put each one under a directory-qualified path
- Never use absolute paths, "~" or ".." segments
- Every file path mentioned in goNogo.goCriteria/noGoCriteria MUST also appear in that task's scope.filesWrite or scope.directories — a criterion referencing an unwritable file fails the prompt gate (scope-satisfiability)`;

/** F-1: sparse/greenfield guidance — shown INSTEAD of a file tree when the
 *  project has no visible tracked files. Deliberately avoids the literal
 *  "FILE TREE" label: callers pin that label's absence for an empty tree. */
const GREENFIELD_NOTE = `PROJECT STATE: greenfield — no tracked files are visible yet.
Choose conventional directories for new files (src/, tests/, docs/); every path still needs its directory prefix.`;

const TERMINAL_NATIVE_PROVIDER_PROPOSAL_EXAMPLE = Object.freeze({
  version: 1 as const,
  changeKind: 'runtime-change' as const,
  ...TERMINAL_NATIVE_PROVIDER_PROOF_IDENTITY,
  disposition: Object.freeze({ kind: 'production-wiring' as const }),
});

const PRODUCTION_WIRING_PROPOSAL_RULES = `PRODUCTION WIRING PROPOSAL RULES:
- For every production mutation, emit productionWiringProposal version 1 with identity fields only: changeKind, producer, canonicalConsumer, affectedIngresses, enablementAuthority, disposition, and proofTargets.
- Never emit hostProofProgram, verifierAssets, executable paths, argv, platform support claims, probe/program/contract digests, evidenceRefs, or completion claims. Those are host-owned.
- The host admits only exact identity tuples backed by a code-owned proof profile. Never invent or rename an identity to bypass admission.
- Registered profile for the Terminal native-provider resolution topology (use only when the task actually changes this topology):
${JSON.stringify(TERMINAL_NATIVE_PROVIDER_PROPOSAL_EXAMPLE)}`;

export function buildZeroConfigPlanPrompt(
  description: string,
  projectName: string,
  fileTree: string[] = [],
  modelPolicy?: PlannerTaskModelPolicy,
): string {
  const treeSection = fileTree.length > 0
    ? `\nFILE TREE (first ${Math.min(fileTree.length, 50)}):\n${fileTree.slice(0, 50).join('\n')}`
    : `\n${GREENFIELD_NOTE}`;

  const effectiveModelPolicy = resolvePlannerTaskModelPolicy(modelPolicy);
  const modelSelection = renderPlannerModelPolicy(effectiveModelPolicy);

  return `You are a software project orchestrator. A user requested a feature in natural language.
Split this request into ${zeroConfigTaskRange().min}-${zeroConfigTaskRange().max} independent, parallel-executable tasks.

PROJECT: ${projectName}
USER REQUEST: "${description}"${treeSection}

TASK SPLITTING RULES:
- Each task must be independently executable (parallel execution possible)
- Specify dependencies if any (e.g., UI depends on backend API)
- Create exactly ${zeroConfigTaskRange().min}-${zeroConfigTaskRange().max} tasks (no more, no less)
- Define scope (directories + filesWrite) for each task
- EVERY task's scope.filesWrite MUST contain at least one file path — an empty filesWrite array is invalid
- A task's "title" MUST NOT contain a comma (,) character — rephrase with "and"/a dash instead
- Write GO/NO-GO criteria for each task
- Emit one goNogo.items object per authored criterion. Do not split free text on semicolons.
- Every item needs a polarity, one atomic statement, and concrete evidenceRequirements.
- Criterion IDs are host-derived after parsing; do not emit an id field.
- The last task MUST be an integration/test task

${FILE_PATH_RULES}

${PRODUCTION_WIRING_PROPOSAL_RULES}

EXAMPLE SPLIT:
"Add login page with Google OAuth" →
1. Auth API endpoints (backend, POST /auth/login, /auth/google-callback)
2. Google OAuth integration (oauth2 client setup, token exchange)
3. Login page UI (React component, form, redirect logic)
4. Integration tests (E2E auth flow, token validation tests)

${buildAdrConstraintsPlannerBlock()}
MODEL SELECTION (EXACT API IDs ONLY):
${modelSelection}
- Never emit a family alias such as opus, sonnet, haiku, gpt-5, or gpt-5.6

OUTPUT FORMAT (JSON ONLY, nothing else):
{
  "tasks": [
    {
      "title": "...",
      "description": "...",
      "model": "${effectiveModelPolicy.defaultModel}",
      "effort": "low|normal|high",
      "priority": "CRITICAL|HIGH|NORMAL|LOW",
      "reason": "Why this model/effort",
      "scope": { "directories": [...], "filesRead": [...], "filesWrite": [...] },
      "dependencies": [],
      "goNogo": {
        "goCriteria": "...",
        "noGoCriteria": "...",
        "techDebtAcceptable": "...",
        "items": [
          { "polarity": "go", "statement": "...", "evidenceRequirements": ["..."] },
          { "polarity": "no-go", "statement": "...", "evidenceRequirements": ["..."] }
        ]
      },
      "productionWiringProposal": {
        "version": 1,
        "changeKind": "runtime-addition|runtime-change|refactor|removal|foundation|public-library|documentation|data",
        "producer": { "producerId": "..." },
        "canonicalConsumer": { "consumerId": "...", "relationship": "invokes-producer|removed-or-migrated" },
        "affectedIngresses": [{ "ingressId": "...", "kind": "ingress|entrypoint" }],
        "enablementAuthority": { "authorityId": "...", "mechanism": "configuration|policy|registration|unconditional" },
        "disposition": { "kind": "production-wiring" },
        "proofTargets": [{ "proofTargetId": "...", "kind": "consumer-execution|ingress-execution|enablement-resolution|removal-verification|platform|scale" }]
      }
    }
  ],
  "reasoning": "Why you split it this way"
}`;
}

/**
 * Call the AI planner with a zero-config (single natural-language) description.
 * The AI splits the description into structured tasks (range from zeroConfigTaskRange()).
 *
 * Falls back to null if the AI call fails; callers should fall back to
 * structured (single-task) mode in that case.
 *
 * @param adapter  Optional ProviderAdapter. If omitted, uses ProviderRegistry.getDefault().
 *                 Throws if no provider is available (no silent fallback).
 */
export async function callZeroConfigPlanner(
  description: string,
  model: ModelType,
  projectName: string,
  fileTree: string[] = [],
  adapter?: ProviderAdapter,
  timeout?: number,
  spawnFn: PlannerSpawnFn = defaultPlannerSpawn,
  receiptContext?: PlannerReceiptContext,
  taskModelPolicy?: PlannerTaskModelPolicy,
): Promise<PlannerResult | null> {
  const modelPolicy = resolvePlannerTaskModelPolicy(
    taskModelPolicy ?? createPlannerTaskModelPolicy(model),
  );
  const prompt = buildZeroConfigPlanPrompt(description, projectName, fileTree, modelPolicy);
  const resolved = resolveAdapter(adapter, model);
  const timeoutMs = timeout ?? BRAIN_PLAN_TIMEOUT_MS;
  interface ZeroConfigAttempt {
    readonly outcome: PlannerSpawnOutcome;
    readonly receipt?: PlannerReceiptSession;
    readonly durationMs: number;
  }
  const contextForAttempt = (attempt: number): PlannerReceiptContext | undefined => {
    if (!receiptContext || attempt === 1) return receiptContext;
    const baseInvocationId = receiptContext.invocationId ?? deterministicInvocationId(receiptContext);
    const invocationId = `${baseInvocationId}:schema-retry-${attempt}`;
    return {
      ...receiptContext,
      invocationId,
      idempotencyKey: `${receiptContext.idempotencyKey ?? `${receiptContext.runId}:brain:sprint-planning:1`}:schema-retry-${attempt}`,
      callId: `${invocationId}:call-1`,
    };
  };
  const invoke = async (plannerPrompt: string, attempt: number): Promise<ZeroConfigAttempt> => {
    let nativeInvocation: ProviderPlannerInvocation | undefined;
    let spec: PlannerSpawnSpec;
    try {
      nativeInvocation = resolved.buildPlannerInvocation?.(plannerPrompt, model);
      spec = nativeInvocation
        ? normalizeNativePlannerInvocation(resolved, nativeInvocation, model)
        : buildPlannerSpawnArgs(resolved, plannerPrompt, model);
    } catch (error) {
      return {
        outcome: {
          status: null, signal: null, stdout: '', stderr: '',
          error: error instanceof Error ? error : new Error(String(error)),
        },
        durationMs: 0,
      };
    }
    let receipt: PlannerReceiptSession | undefined;
    const attemptContext = contextForAttempt(attempt);
    if (attemptContext) {
      try {
        receipt = await beginPlannerReceipt(attemptContext, {
          resolvedProvider: canonicalProviderFromAdapter(resolved),
          resolvedModel: model,
          calledProvider: spec.calledProvider,
          calledModel: spec.calledModel,
          transport: spec.transport,
          executionBackend: spec.executionBackend,
          missingReason: 'none',
        });
        if (!receipt.created) {
          receipt.close();
          return {
            outcome: {
              status: null, signal: null, stdout: '', stderr: '',
              error: new Error('INVOCATION_RECEIPT_DUPLICATE_DISPATCH_BLOCKED'),
            },
            durationMs: 0,
          };
        }
        receipt.append({ type: 'dispatch_started', payload: { attempt } });
      } catch (error) {
        receipt?.close();
        return {
          outcome: {
            status: null, signal: null, stdout: '', stderr: '',
            error: error instanceof Error ? error : new Error(String(error)),
          },
          durationMs: 0,
        };
      }
    }
    const startedAt = Date.now();
    try {
      const outcome = nativeInvocation
        ? await nativeInvocation.execute({ timeoutMs })
        : await spawnFn(spec.command, spec.args, {
            timeoutMs,
            ...(spec.stdin === undefined ? {} : { stdin: spec.stdin }),
          });
      return {
        outcome, receipt, durationMs: Math.max(0, Date.now() - startedAt),
      };
    } catch (error) {
      return {
        outcome: {
          status: null, signal: null, stdout: '', stderr: '',
          error: error instanceof Error ? error : new Error(String(error)),
        },
        receipt,
        durationMs: Math.max(0, Date.now() - startedAt),
      };
    }
  };

  const settle = (
    attempt: ZeroConfigAttempt,
    consumerOutcome: 'accepted' | 'rejected',
    consumerReason: InvocationReasonCode,
  ): boolean => {
    if (!attempt.receipt) return true;
    const { outcome } = attempt;
    const transportOutcome = outcome.signal === 'SIGTERM'
      ? 'timeout'
      : outcome.error || outcome.status !== 0 || !outcome.stdout
        ? 'failed'
        : 'succeeded';
    const transportReason: InvocationReasonCode = outcome.signal === 'SIGTERM'
      ? 'timeout'
      : outcome.error
        ? 'spawn_error'
        : outcome.status !== 0
          ? 'nonzero_exit'
          : !outcome.stdout
            ? 'empty_output'
            : 'none';
    try {
      attempt.receipt.append({
        type: 'transport_settled',
        payload: {
          outcome: transportOutcome,
          exitCode: outcome.status,
          signal: outcome.signal,
          reasonCode: transportReason,
          durationMs: attempt.durationMs,
        },
      });
      attempt.receipt.append({
        type: 'consumer_settled',
        payload: { outcome: consumerOutcome, reasonCode: consumerReason },
      });
      return true;
    } catch {
      return false;
    } finally {
      attempt.receipt.close();
    }
  };

  const firstAttempt = await invoke(prompt, 1);
  const result = firstAttempt.outcome;

  if (result.status !== 0 || !result.stdout) {
    settle(firstAttempt, 'rejected', result.signal === 'SIGTERM' ? 'timeout' : result.error ? 'spawn_error' : result.status !== 0 ? 'nonzero_exit' : 'empty_output');
    return null;
  }
  let detailed = parsePlannerResponseDetailed(result.stdout, resolved, {
    projectRoot: receiptContext?.projectRoot ?? process.cwd(),
  });
  let acceptedAttempt = firstAttempt;

  // U2 (PCOMP-8) + 3332: ONE corrective round-trip for every output-contract
  // violation a nondeterministic model produces — unparseable/invalid JSON
  // (parse/schema/identity) OR a task model outside the allowed worker policy.
  // The retry names the exact violation (secret-safe paths, codes, model API
  // IDs) and restates the contract; a second violation settles typed and returns
  // null, which upstream reports honestly instead of as "provider unavailable".
  let violation = describePlannerContractViolation(detailed, modelPolicy);
  if (violation) {
    debugLog('planner:contractViolation', `attempt 1 rejected — ${violation.description}`);
    if (!settle(firstAttempt, 'rejected', violation.reasonCode)) return null;
    const retryPrompt = `${prompt}\n\nYOUR PREVIOUS RESPONSE WAS INVALID (${violation.description}). Respond again with ONLY the requested JSON schema and no other text. The "dependencies" array must contain the exact task title strings of OTHER tasks in this plan — never task numbers. Every task "model" must be exactly one of these allowed API IDs: ${modelPolicy.allowedModels.join(', ')}.`;
    const retryAttempt = await invoke(retryPrompt, 2);
    const retry = retryAttempt.outcome;
    const retryTransportOk = retry.status === 0 && Boolean(retry.stdout);
    if (retryTransportOk) {
      detailed = parsePlannerResponseDetailed(retry.stdout, resolved, {
        projectRoot: receiptContext?.projectRoot ?? process.cwd(),
      });
      violation = describePlannerContractViolation(detailed, modelPolicy);
    }
    if (!retryTransportOk || violation || !detailed.result) {
      if (violation) debugLog('planner:contractViolation', `attempt 2 rejected — ${violation.description}`);
      settle(
        retryAttempt,
        'rejected',
        retryTransportOk
          ? (violation?.reasonCode ?? 'parse_failed')
          : retry.signal === 'SIGTERM' ? 'timeout' : retry.error ? 'spawn_error' : retry.status !== 0 ? 'nonzero_exit' : 'empty_output',
      );
      return null;
    }
    acceptedAttempt = retryAttempt;
  }
  let parsed: PlannerResult = detailed.result!;

  // U2 output-contract completion (deterministic): filesRead mentioned+import
  // completion + mirror-test create-if-missing. Fail-soft I/O — a completion
  // that cannot run leaves the plan as-is.
  try {
    const cwd = process.cwd();
    const ls = spawnSync('git', ['ls-files'], { encoding: 'utf-8', cwd });
    const trackedFiles = ls.status === 0 ? ls.stdout.trim().split('\n') : [];
    if (trackedFiles.length > 0) {
      parsed = normalizePlannerResult(parsed, {
        trackedFiles,
        readFile: (rel) => { try { return readFileSync(join(cwd, rel), 'utf-8'); } catch { return null; } },
      });
    }
  } catch { /* normalization is best-effort; linter W-checks remain witnesses */ }

  if (!settle(acceptedAttempt, 'accepted', 'none')) return null;
  return parsed;
}

// ─── Bug Y2: Plan-time Ground-Truth Audit (Sprint 166) ───────────────
//
// Plans coming out of the AI planner may carry stale numeric claims
// (e.g. "16 agents" when the codebase only ships 15). The runtime Auditor
// catches mismatches via verifyDocSyncGroundTruth, but failing fast at
// plan-time avoids spawning workers that would then emit boundary violations.

export interface PlannerGroundTruthIssue {
  taskIndex: number;
  taskTitle: string;
  metric: string;
  claimed: number;
  measured: number;
  raw: string;
}

const PLANNER_AGENTS_CLAIM_RE = /\b(\d{1,3})\s+(?:built-?in\s+)?agents?\b/gi;

function plannerMeasureAgentsCount(projectRoot: string): number {
  const agentsDir = join(projectRoot, 'src/core/builtins/agents');
  if (!existsSync(agentsDir)) return -1;
  try {
    return readdirSync(agentsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .length;
  } catch {
    return -1;
  }
}

function plannerLoadOverrides(projectRoot: string): Array<{
  metric: string;
  expected: number;
  until_sprint: number;
}> {
  const path = join(projectRoot, '.deckent', 'ground-truth-overrides.json');
  if (!existsSync(path)) return [];
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as {
      overrides?: Array<{ metric: string; expected: number; until_sprint: number }>;
    };
    return parsed?.overrides ?? [];
  } catch {
    return [];
  }
}

function plannerSprintNumber(sprintId: string | undefined | null): number {
  if (!sprintId) return Number.NaN;
  const m = /sprint-(\d+)/i.exec(sprintId);
  if (!m || !m[1]) return Number.NaN;
  return Number.parseInt(m[1], 10);
}

/**
 * Audit a planner result for doc-sync ground-truth mismatches across all
 * task descriptions. Returns the list of issues found (empty when no claim
 * disagrees with the filesystem measurement, or every divergent claim is
 * covered by an active whitelist override).
 *
 * Never throws — measurement failures yield an empty result (fail-safe).
 */
export function auditPlanGroundTruth(
  projectRoot: string,
  plan: PlannerResult,
  currentSprintId: string,
): PlannerGroundTruthIssue[] {
  if (!plan?.tasks?.length) return [];
  const agentsMeasured = plannerMeasureAgentsCount(projectRoot);
  if (agentsMeasured < 0) return [];
  const overrides = plannerLoadOverrides(projectRoot);
  const currentSprint = plannerSprintNumber(currentSprintId);

  const issues: PlannerGroundTruthIssue[] = [];
  plan.tasks.forEach((task, idx) => {
    const description = task.description ?? '';
    if (!description) return;
    let m: RegExpExecArray | null;
    PLANNER_AGENTS_CLAIM_RE.lastIndex = 0;
    while ((m = PLANNER_AGENTS_CLAIM_RE.exec(description)) !== null) {
      const numStr = m[1];
      if (!numStr) continue;
      const claimed = Number.parseInt(numStr, 10);
      if (!Number.isFinite(claimed)) continue;
      if (claimed === agentsMeasured) continue;
      const overrideActive = overrides.some((o) => {
        if (o.metric !== 'agents_count') return false;
        if (o.expected !== claimed) return false;
        if (Number.isNaN(currentSprint)) return true;
        return currentSprint < o.until_sprint;
      });
      if (overrideActive) continue;
      issues.push({
        taskIndex: idx,
        taskTitle: task.title,
        metric: 'agents_count',
        claimed,
        measured: agentsMeasured,
        raw: m[0],
      });
    }
  });
  return issues;
}

/**
 * Build a minimal structured fallback plan from a zero-config description.
 * Used when the AI planner is unavailable or returns an invalid response.
 * Produces a single task that wraps the full description.
 */
export function buildZeroConfigFallbackPlan(description: string): PlannerResult {
  const fallbackModelId = resolveBrainModel(undefined);
  const fallbackModel = modelRegistry.get(fallbackModelId);
  if (!fallbackModel) throw new ProviderError('E_MODEL_FALLBACK_UNSATISFIED', 'E_MODEL_FALLBACK_UNSATISFIED');
  return {
    tasks: [
      {
        title: description.slice(0, 80),
        description,
        model: fallbackModel.id,
        effort: 'normal',
        priority: 'NORMAL',
        reason: 'Zero-config fallback: single task wrapping the full description',
        scope: { directories: ['src/'], filesRead: [], filesWrite: [] },
        productionWiringApplicability: deriveProductionWiringApplicability({
          directories: ['src/'], filesRead: [], filesWrite: [],
        }),
        dependencies: [],
        goNogo: {
          goCriteria: 'Feature implemented and tests pass',
          noGoCriteria: 'Build fails or tests do not pass',
          techDebtAcceptable: 'Minor style issues acceptable',
          items: canonicalPlannerCriteria(
            'Feature implemented and tests pass',
            'Build fails or tests do not pass',
            undefined,
          ),
        },
      },
    ],
    reasoning: `Zero-config fallback plan for: ${description}`,
  };
}

// ─── AI-Plan Dependency Normalization (323-031) ──────────────────────────────
//
// The AI planner emits each `task.dependencies` entry as free text — usually the
// *title* of the depended-on task, because it cannot know the final `NNN-NNN`
// slot id at plan time. `buildDependencyGraph` (dependency-scheduler.ts) matches
// strictly by task id, so a title ref is silently dropped and the dependency
// pipeline is never wired (cleanup-last never runs, just-wired code can be
// deleted). This pass rewrites every AI task's `dependencies` into concrete
// same-sprint ids AFTER the tasks have been created (so each carries its real
// id + title), and reports anything it could not resolve instead of dropping it
// silently.

/** A dependency ref that failed to resolve to any sibling task (and was dropped). */
export interface DroppedDependency {
  /** Id of the task whose dependency could not be resolved. */
  taskId: string;
  /** The raw ref string the planner emitted (title or id-shaped). */
  ref: string;
  /**
   * True when `ref` looked like a concrete plan-slot id (`NNN-NNN`) — i.e. it
   * referenced a task id that does not exist in the sprint, rather than a title
   * the planner failed to spell exactly.
   */
  looksLikePlanSlotId: boolean;
}

/** Outcome of `normalizePlannerDependencies`. */
export interface DependencyNormalizationResult {
  /** Count of dependency refs resolved to a concrete same-sprint id. */
  resolvedCount: number;
  /** Refs that could not be resolved — dropped, but never silently (logged + returned). */
  dropped: DroppedDependency[];
}

/**
 * Normalize AI-planner task dependencies into concrete same-sprint task IDs.
 *
 * Rewrites each task's `dependencies` array IN PLACE:
 *   - a ref already a slot id (`323-007`) that names a real sibling → kept
 *   - a ref that is a sibling task title → resolved to that task's id
 *   - multiple deps are supported and de-duplicated (first occurrence wins)
 *   - a self-reference is dropped (a task cannot depend on itself) without being
 *     reported as unresolvable
 *   - an unresolvable ref is dropped AND reported (returned in `dropped` +
 *     `debugLog`) — never silently lost
 *
 * Resolution reuses `resolveDependencyRef` (task-builder), which already handles
 * slot-id exact match and substring-trap-safe title-token matching.
 *
 * Behaviour-preserving for plans that already use correct slot ids: every ref
 * resolves to itself and `dropped` is empty.
 *
 * @param tasks AI-created tasks (mutated: `dependencies` rewritten to ids).
 *   Only `id`, `title`, and `dependencies` are read/written.
 * @returns resolved count + the list of dropped refs for operator visibility.
 */
export function normalizePlannerDependencies(
  tasks: Array<{ id: string; title: string; dependencies?: string[] }>,
): DependencyNormalizationResult {
  const dropped: DroppedDependency[] = [];
  let resolvedCount = 0;

  for (const task of tasks) {
    const rawDeps = task.dependencies;
    if (!rawDeps || rawDeps.length === 0) continue;

    const resolved: string[] = [];
    const seen = new Set<string>();

    for (const ref of rawDeps) {
      const id = resolveDependencyRef(ref, tasks);

      if (id && id !== task.id) {
        if (!seen.has(id)) {
          seen.add(id);
          resolved.push(id);
          resolvedCount++;
        }
        continue;
      }

      if (id === task.id) {
        // Self-reference — drop without flagging as unresolvable.
        debugLog('planner:normalizeDeps', `Task ${task.id}: self-dependency "${ref}" dropped`);
        continue;
      }

      // Unresolvable — drop, but make it visible (never silent).
      const looksLikePlanSlotId = isPlanSlotId(ref);
      dropped.push({ taskId: task.id, ref, looksLikePlanSlotId });
      debugLog(
        'planner:normalizeDeps',
        `Task ${task.id}: unresolvable dependency "${ref}" dropped (` +
        `${looksLikePlanSlotId ? 'id-shaped — no such task in sprint' : 'title not found among sprint tasks'})`,
      );
    }

    task.dependencies = resolved;
  }

  return { resolvedCount, dropped };
}

// ─── SCOPE-W2 → G1b (sprint-399): the plan-time scope-sufficiency check now lives in
// scope-satisfiability.ts (lintScopeSatisfiability), wired into evaluatePromptGate.
// The original validateGoCriteriaScope helper here was dead since birth (its only
// caller was its own test) and was removed with that wiring — see the verification
// doc .analysis/prompt-contract-verification-2026-07-10.md (N3).

// ─── Plan-time Scope Preflight (423-003: born-653 phantom-strip + born-661 expansion) ─
//
// A single in-place pass over finalized tasks (mirrors normalizePlannerDependencies:
// mutate + report, never silent). Two concerns:
//   - born-653: strip phantom scope entries a naive derivation produced from the
//     declared Files (file-path-as-directory, substring-derived phantom paths). Requires
//     the task's DECLARED Files (its true write intent) — supplied via `declaredFilesOf`,
//     because by this stage scope.filesWrite already carries the derived extras.
//   - born-661: expand write scope with the test files that import a task's source
//     modules (capped ≤25) so a worker can update the tests its change breaks in-scope.
//
// The full-dependency-graph vision (born-661) is intentionally NOT built here — this is a
// bounded import-mention scan. Live wiring (a single call in sprint-planner.ts just before
// evaluatePromptGate) is the remaining follow-up; sprint-planner.ts is outside this task's
// write authority. See the .result docImpact note.

/** Minimal task read-shape for the scope preflight (id + mutable scope). */
interface PreflightTask {
  id: string;
  scope?: TaskScope;
}

export interface ScopePreflightOptions {
  /**
   * The candidate test-file corpus (typically tests/** from the tracked-file list, with
   * optional content for import-matching). When absent, the born-661 expansion is skipped.
   */
  testFiles?: readonly AffectedTestFile[];
  /**
   * Returns a task's DECLARED Files (original write intent) for born-653 phantom grounding.
   * When absent, phantom-strip is skipped (a post-derivation filesWrite cannot self-ground
   * without the original Files — the fix's true home is the derivation in task-builder).
   */
  declaredFilesOf?: (task: PreflightTask) => readonly string[];
  /** Max affected tests added per task (defaults to AFFECTED_TEST_CAP = 25). */
  cap?: number;
}

/** Per-task outcome of the scope preflight. */
export interface ScopePreflightEntry {
  taskId: string;
  addedTests: string[];
  removedPhantoms: string[];
  /** True when the affected-test match count exceeded the cap and was truncated. */
  capped: boolean;
}

/** Outcome of `preflightTaskScopes`: per-task detail + human-readable report lines. */
export interface ScopePreflightResult {
  entries: ScopePreflightEntry[];
  /** One line per task that changed — surfaced to the operator (never silent). */
  reportLines: string[];
}

/**
 * Run the plan-time scope preflight over `tasks`, mutating each task's `scope` IN PLACE
 * (born-653 phantom-strip then born-661 affected-test expansion). Behaviour-preserving
 * for a task whose scope is already clean and has no affected tests: nothing changes and
 * it contributes no report line. Both passes are individually opt-in via `options`, so a
 * caller with only a tracked-test corpus (no declared-Files map) still gets 661.
 */
export function preflightTaskScopes(
  tasks: PreflightTask[],
  options: ScopePreflightOptions = {},
): ScopePreflightResult {
  const entries: ScopePreflightEntry[] = [];
  const reportLines: string[] = [];

  for (const task of tasks) {
    if (!task.scope) continue;
    let scope = task.scope;
    const removedPhantoms: string[] = [];

    // born-653: strip phantoms against the task's declared write intent.
    if (options.declaredFilesOf) {
      const stripped = stripPhantomScope(scope, options.declaredFilesOf(task));
      scope = stripped.scope;
      removedPhantoms.push(...stripped.removed);
    }

    // born-661: expand with affected tests.
    let addedTests: string[] = [];
    let capped = false;
    if (options.testFiles && options.testFiles.length > 0) {
      const expanded = expandScopeWithAffectedTests(scope, options.testFiles, { cap: options.cap });
      scope = expanded.scope;
      addedTests = expanded.scan.added;
      capped = expanded.scan.capped;
      if (addedTests.length > 0) reportLines.push(`[${task.id}] ${expanded.scan.report}`);
    }

    if (removedPhantoms.length > 0) {
      reportLines.push(`[${task.id}] phantom-scope-strip: -${removedPhantoms.length} (${removedPhantoms.join(', ')})`);
    }

    task.scope = scope;
    if (addedTests.length > 0 || removedPhantoms.length > 0) {
      entries.push({ taskId: task.id, addedTests, removedPhantoms, capped });
    }
  }

  return { entries, reportLines };
}

// ─── Proof-Staging Validation Stage (519-004, row 3275) ───────────────
//
// Source verification and built-binary proof are SEPARATE authority stages.
// A sprint never builds, so anything that can only run against a freshly built
// artifact belongs on the post-settlement obligation (`postSettlementProjection`),
// never on an in-sprint surface. This pass is pure (mirrors lintScopeSatisfiability:
// findings only, no mutation) and reports — it never drops a demand:
//   - executable in-sprint surfaces (`smoke`, `testTarget`) → BLOCK, with the typed
//     post-settlement restatement attached as `stagedObligation`;
//   - free-text criteria (`goCriteria`/`noGoCriteria`) → WARN (prose is not argv, so
//     no command is synthesized), negation-guarded so a criterion that FORBIDS
//     building ("no dist/ mutation") is never mistaken for a demand to build.
// A task that already carries a post-settlement obligation and no in-sprint demand
// produces no findings at all.

/** Minimal task read-shape for the proof-staging lint. */
export interface ProofStagingLintTask {
  id: string;
  scope?: TaskScope;
  testTarget?: string;
  goNogo?: { goCriteria?: string; noGoCriteria?: string };
  smoke?: { command: string; expect: string };
  postSettlementProjection?: PostSettlementPlanProjection;
}

/** A mention wrapped in negation ("no dist/ writes") states a prohibition, not a demand. */
const NEGATED_PROOF_MENTION_RE =
  /\b(?:no|not|never|without|forbidden|must not|cannot|yasak|olmadan|asla|değil)\b/i;

/** The line of `text` containing `token` — the negation guard's evaluation window. */
function proofMentionLine(text: string, token: string): string {
  const line = text.split('\n').find(l => l.includes(token));
  return line ?? text;
}

const EMPTY_LINT_SCOPE: TaskScope = { directories: [], filesRead: [], filesWrite: [] };

/**
 * Plan-time validation stage: reject in-sprint built-binary proof demands with a
 * typed finding. Pure — returns findings, mutates nothing.
 */
export function lintProofStaging(tasks: readonly ProofStagingLintTask[]): ProofStagingFinding[] {
  const findings: ProofStagingFinding[] = [];

  for (const task of tasks) {
    const scope = task.scope ?? EMPTY_LINT_SCOPE;

    const executableSurfaces: Array<{ surface: ProofStagingSurface; text: string | undefined }> = [
      { surface: 'smoke', text: task.smoke?.command },
      { surface: 'testTarget', text: task.testTarget },
    ];
    for (const { surface, text } of executableSurfaces) {
      if (!text) continue;
      const demand = classifyBuiltBinaryProofDemand(text);
      if (!demand) continue;
      const stagedObligation = stageBuiltBinaryProofObligation({ commandText: text, scope });
      findings.push({
        severity: 'BLOCK',
        code: stagedObligation ? 'IN_SPRINT_BUILT_BINARY_DEMAND' : 'BUILT_BINARY_PROOF_UNSTAGEABLE',
        surface,
        signal: demand.signal,
        demand: text,
        taskRef: task.id,
        ...(stagedObligation ? { stagedObligation } : {}),
        message: stagedObligation
          ? `in-sprint ${surface} needs the built binary (${demand.signal}: "${demand.token}"); a sprint never `
            + 'builds — restate it as a post-settlement proof obligation (`- PromotionProof:`).'
          : `in-sprint ${surface} needs the built binary (${demand.signal}: "${demand.token}") and exceeds the `
            + 'bounded post-settlement command limits — it must be restated by hand.',
      });
    }

    const proseSurfaces: Array<{ surface: ProofStagingSurface; text: string | undefined }> = [
      { surface: 'goCriteria', text: task.goNogo?.goCriteria },
      { surface: 'noGoCriteria', text: task.goNogo?.noGoCriteria },
    ];
    for (const { surface, text } of proseSurfaces) {
      if (!text) continue;
      const demand = classifyBuiltBinaryProofDemand(text);
      if (!demand) continue;
      if (NEGATED_PROOF_MENTION_RE.test(proofMentionLine(text, demand.token))) continue;
      findings.push({
        severity: 'WARN',
        code: 'IN_SPRINT_BUILT_BINARY_DEMAND',
        surface,
        signal: demand.signal,
        demand: demand.token,
        taskRef: task.id,
        message:
          `${surface} states a built-binary proof (${demand.signal}: "${demand.token}"); a sprint never builds — `
          + 'move the obligation to the post-settlement stage (`- PromotionProof:`) instead of an in-sprint criterion.',
      });
    }
  }

  return findings;
}
