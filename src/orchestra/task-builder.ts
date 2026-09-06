// ─── Task Creation & Directive Parsing ─────────────────────────────
// Extracted from brain.ts — task construction, scope extraction, directive parsing
import { z } from 'zod';
import { createHash } from 'node:crypto';
import {
  buildPromptDeliveryReceipt,
  promptDeliveryReceiptPath,
  readPromptDeliveryReceipt,
  writePromptDeliveryReceipt,
  type PromptDeliveryReceipt,
} from '../core/prompt-delivery-receipt.js';
import { DeckentError } from '../core/errors.js';
import { existsSync, readdirSync, readFileSync, appendFileSync, mkdirSync, writeFileSync, renameSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import type {
  Task, TaskScope, GoNoGoCriteria, ModelType, TaskEffort, TaskPriority,
  PlannerTask, ProviderName, TaskResult, ResolvedConfig,
  ProductionWiringPlanEvidence,
  PostSettlementPlanProjection,
  PostSettlementPlatformCapability,
} from '../core/types.js';
import {
  createGoNoGoCriterionItem,
  deriveProductionWiringApplicability,
  productionWiringVerifierAssetWriteScopeOverlap,
  createPostSettlementPlanProjection,
  createProductionWiringPlanEvidence,
  createProductionWiringPlanEvidenceV2,
} from '../core/task-types.js';
import type { PostSettlementIngress } from '../core/post-settlement-verification.js';
import {
  POST_SETTLEMENT_MAX_ARG_BYTES,
  POST_SETTLEMENT_MAX_COMMAND_ARGS,
} from '../core/post-settlement-verification.js';
import {
  resolveProductionWiringContract,
  parseProductionWiringContractV2Input,
  type ProductionWiringDecision,
} from '../core/production-wiring-contract.js';
import {
  validateProductionWiringHostProofAdapterAdmission,
} from '../core/production-wiring-host-proof.js';
import { shellSplit } from './proof-of-function.js';
import { isFileScopeToken } from './scope-sanitizer.js';
import { TaskStatus, PROVIDER_MODEL_MAP } from '../core/types.js';
import {
  resolveMemoryReadConfig,
  resolveMemoryReadLimitsForConsumer,
  VALID_PROVIDERS_ALL,
} from '../core/config.js';
import { detectTaskType } from './rubric-registry.js';
import { lintWorkerPromptContract } from './prompt-lint.js';
import { rubricTypeToKind, taskKindToAdrDomain, type AdrTaskType } from '../core/work-model.js';
import { resolveCanonicalModelIdentity } from '../core/model-registry.js';
import { getModelTier } from '../core/model-equivalence.js';
import type { TaskDNA } from '../core/routing-types.js';
import { calculateModelScore } from './model-selector.js';
import { debugLog } from '../core/utils.js';
import { filterSkillPromptsByDNA } from './prompt-token-optimizer.js';
import { resolveSkillPromptBodies } from '../core/skill-loading.js';
import { SkillPoolManager } from '../core/skill-pool.js';
import { MemoryStore } from '../core/memory-store.js';
import type { MemoryEntryV2 } from '../core/memory-types.js';
import { searchMemory } from '../core/memory-query.js';
import {
  buildMemoryDiscoveryQuery,
  readMemoryView,
  renderMemoryReadView,
  resolveMemoryPreferredIds,
  resolveMemoryRequiredIds,
} from '../core/memory-read-service.js';
import { buildMemoryReadLabels } from '../core/memory-read-labels.js';
import type { MemoryReadEntryV1, MemoryReadScopeV1, MemoryReadViewV1 } from '../core/memory-read-contract.js';
import { attendedExecutionProjectId } from '../core/attended-execution-approval.js';
import { createRawFileFirstWriterWins } from '../core/approval-file-cas.js';
import { getMessage } from '../cli/helpers/messages.js';
import { BRAIN_DIR, EVALUATIONS_DIR, MEMORY_DB_FILE, PROJECT_CONFIG_PATH, TASKS_DIR } from '../core/constants.js';
import {
  TASK_TYPE_ADR_PRESETS,
  buildAdrPromptSection,
  classifyInjectionTier,
  classifyTaskIntent,
  extractExplicitAdrRefs,
  selectRelevantAdrs,
} from './adr-selector.js';
import type { AdrRelevance } from './adr-selector.js';
import type { RunFlowPlanSourceAuthority } from '../core/run-flow-contract.js';
import type { SegmentedPrompt, WorkerExactExecutionAuthority } from './prompt-god-template.js';

/**
 * Synchronous prompt composition can re-enter {@link logInjectionAudit} through
 * prompt-god-template's historical circular import. The exact Docker admission
 * path must compile before any public/runtime projection exists, so that one
 * bounded synchronous call suppresses observation writes without weakening the
 * compatibility path. No await occurs while the depth is non-zero.
 */
let deferredPromptObservationDepth = 0;

/**
 * PCOMP-W3 (injection audit): persist every ADR-injection decision so a false
 * positive (e.g. Routing-ADR G-006 injected into a CRASH-REDACT task) is
 * reproducible from its recorded score + matched signals instead of guesswork.
 * One JSONL line per prompt build → `.deckent/prompts/injection-audit.jsonl`.
 * Fail-soft: an audit-write failure never blocks prompt construction.
 */
export function logInjectionAudit(
  projectRoot: string,
  task: { title?: string; description?: string } & { id?: string },
  ranked: AdrRelevance[],
): void {
  if (deferredPromptObservationDepth > 0) return;
  try {
    const dir = join(projectRoot, '.deckent', 'prompts');
    mkdirSync(dir, { recursive: true });
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      task: task.id ?? task.title ?? '(unknown)',
      adrs: ranked.map(r => ({
        id: r.adrId,
        score: Number(r.score.toFixed(3)),
        tier: classifyInjectionTier(r),
        reasons: r.matchReasons,
      })),
    });
    appendFileSync(join(dir, 'injection-audit.jsonl'), line + '\n', 'utf-8');
  } catch (e) { debugLog('logInjectionAudit', e); }
}
import { readBaseline } from './baseline-tracker.js';
import {
  buildTaskPromptSegmented,
  extractDeclaredTestCommands,
  hasTaskScopedVerificationAuthority,
} from './prompt-god-template.js';
import { generateProjectContextSegment } from './temp-skill-generator.js';
import { detectProjectStack } from '../core/stack-detector.js';
import type {
  DependencyResultEntry,
  SprintContext,
  SharedContextEntry,
  UpstreamHandoffEntry,
} from './prompt-god-template.js';
import { readAuthoritativeTaskResult } from './task-result-authority.js';
import { SharedMemory } from './shared-memory.js';
import { HandoffProtocol } from './handoff-protocol.js';
import { inspectWorkerGuideContract } from './workspace-artifacts.js';
import type { WorkerCommsConfig, ToolsConfig } from '../core/config-types.js';
import { deriveTestScope } from './scope-deriver.js';
import type { AgentDefinition } from '../core/agent-types.js';
import { type AgentDomain, getAgentDomain } from '../core/agent-pool.js';
import { readToolInventory } from './sprint-phases.js';
import { resolveVerifyCommands } from './worker-verify-tool.js';
import type { ResolvedVerifyCommands } from './worker-verify-tool.js';
import { computeToolAllowlist } from '../core/tool-allowlist.js';
import type { ToolAllowlistResult } from '../core/tool-allowlist.js';
import { getProviderCommandSpec } from '../core/provider-command-spec.js';
import { spawnBackendKindDeliversWorkerCore } from './spawn-backend.js';

type CoreExternalizationPolicy = {
  /** Claude's established system-prompt-file seam predates the capability field. */
  legacyCoreChannel?: boolean;
  enabled: (flags: NonNullable<ResolvedConfig['prompt']>) => boolean;
};

function publishCompiledWorkerPrompt(
  projectRoot: string,
  taskId: string,
  prompt: string,
  promptSha256: string,
): void {
  if (!/^[A-Za-z0-9._-]+$/u.test(taskId) || !/^[a-f0-9]{64}$/u.test(promptSha256)) {
    throw new DeckentError('DECKENT_E077', `COMPILED_PROMPT_ARTIFACT_WRITE_HOLD:${taskId}`);
  }
  const tasksDir = join(projectRoot, TASKS_DIR);
  const target = join(tasksDir, `.prompt-${taskId}-${promptSha256}.txt`);
  const bytes = Buffer.from(prompt, 'utf8');
  let created: boolean;
  try {
    mkdirSync(tasksDir, { recursive: true });
    created = createRawFileFirstWriterWins(target, bytes);
  } catch (error) {
    throw new DeckentError('DECKENT_E077', `COMPILED_PROMPT_ARTIFACT_WRITE_HOLD:${taskId}`);
  }
  // The canonical publisher fully writes and fsyncs a winner before returning.
  // Only a losing/idempotent caller must authenticate the pre-existing bytes.
  if (created) return;
  try {
    const existing = readFileSync(target);
    if (!existing.equals(bytes)
      || createHash('sha256').update(existing).digest('hex') !== promptSha256) {
      throw new Error('artifact-mismatch');
    }
  } catch {
    throw new DeckentError('DECKENT_E077', `COMPILED_PROMPT_ARTIFACT_COLLISION_HOLD:${taskId}`);
  }
}

const providerCoreExternalizationPolicies: Partial<Record<ProviderName, CoreExternalizationPolicy>> = {
  claude: {
    legacyCoreChannel: true,
    enabled: flags => flags.worker_core_system_prompt === true,
  },
  codex: {
    enabled: flags => flags.worker_core_system_prompt === true && flags.codex_core_channel === true,
  },
};

/**
 * Externalizing the core removes it from the compiled prompt, so it is only
 * honest when something will actually deliver it. The decision is therefore the
 * intersection of three authorities, and any missing one keeps the core inline:
 *
 * 1. the provider exposes a system-prompt core channel,
 * 2. every provider-specific rollout flag for that channel is enabled,
 * 3. **the selected backend can deliver that channel**.
 *
 * (3) is not optional detail: only the docker backend builds the core argv.
 * `spawn_backend: 'auto'` resolves to `subprocess` on Windows and on any host
 * whose docker daemon is unreachable, so deciding without the backend silently
 * strips the worker's execution contract on exactly those hosts.
 */
function shouldExternalizeWorkerCore(
  provider: ProviderName | undefined,
  flags: ResolvedConfig['prompt'] | undefined,
  backendDeliversCore: boolean,
): boolean {
  if (!backendDeliversCore) return false;
  const policy = provider ? providerCoreExternalizationPolicies[provider] : undefined;
  const commandSpec = provider ? getProviderCommandSpec(provider) : undefined;
  const hasCoreChannel = commandSpec != null
    && ('systemPromptCoreArgs' in commandSpec || policy?.legacyCoreChannel === true);
  if (!policy || !flags || !hasCoreChannel) {
    return false;
  }
  return policy.enabled(flags);
}

function exactDependencyPath(value: string): boolean {
  if (value.length === 0 || value.startsWith('/') || value.startsWith('\\') || /^[A-Za-z]:/u.test(value)) {
    return false;
  }
  return value.split('/').every(segment => segment.length > 0 && segment !== '.' && segment !== '..');
}

function normalizeDependencyFilesChanged(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap(entry => {
    if (typeof entry === 'string') return [entry];
    if (typeof entry !== 'object' || entry === null || !('path' in entry)) return [];
    return typeof entry.path === 'string' ? [entry.path] : [];
  });
}

function isExpectedDependencyResultReadError(error: unknown): boolean {
  if (error instanceof SyntaxError) return true;
  return error instanceof Error
    && 'code' in error
    && typeof error.code === 'string';
}

/**
 * Collect host-evaluated dependency attempts and fold FIX/FIX-FIX records back
 * to their logical root. Raw worker selfAssessment is deliberately ignored:
 * without a Brain audit receipt the entry remains pending in the prompt.
 */
export function collectDependencyResultEntries(
  projectRoot: string,
  sprintId: string | undefined,
): ReadonlyMap<string, DependencyResultEntry> {
  const tasksDir = join(projectRoot, TASKS_DIR);
  if (!sprintId || !existsSync(tasksDir)) return new Map();

  const taskRecords = new Map<string, Task>();
  const files = readdirSync(tasksDir).sort();
  for (const file of files.filter(name => name.startsWith('task-') && name.endsWith('.json'))) {
    try {
      const record = JSON.parse(readFileSync(join(tasksDir, file), 'utf-8')) as Task;
      if (record?.id) taskRecords.set(record.id, record);
    } catch { /* malformed task evidence is not prompt authority */ }
  }
  const rootIdFor = (taskId: string): string => {
    let current = taskId;
    const seen = new Set<string>();
    while (!seen.has(current)) {
      seen.add(current);
      const parent = taskRecords.get(current)?.fixForTaskId;
      if (!parent) return current;
      current = parent;
    }
    return taskId;
  };

  const evaluationDir = join(projectRoot, EVALUATIONS_DIR, sprintId);
  const latestAuditByTask = new Map<string, { name: string; attempt: number }>();
  if (existsSync(evaluationDir)) {
    for (const name of readdirSync(evaluationDir)) {
      const match = /^(.*)-attempt-(\d+)\.json$/u.exec(name);
      if (!match) continue;
      const taskId = match[1]!;
      const attempt = Number(match[2]);
      if (!Number.isSafeInteger(attempt) || attempt < 1) continue;
      const current = latestAuditByTask.get(taskId);
      if (!current || attempt > current.attempt) {
        latestAuditByTask.set(taskId, { name, attempt });
      }
    }
  }

  const latestDecisionFor = (taskId: string): 'DONE' | 'GO_WITH_TECH_DEBT' | 'NO_GO' | null => {
    const latest = latestAuditByTask.get(taskId);
    if (!latest) return null;
    try {
      const audit = JSON.parse(
        readFileSync(join(evaluationDir, latest.name), 'utf-8'),
      ) as { decision?: unknown };
      return audit.decision === 'DONE'
        || audit.decision === 'GO_WITH_TECH_DEBT'
        || audit.decision === 'NO_GO'
        ? audit.decision
        : null;
    } catch {
      // Never fall back to an older verdict when the newest authority is corrupt.
      return null;
    }
  };

  const entries = new Map<string, DependencyResultEntry>();
  for (const file of files.filter(name => name.startsWith('task-') && name.endsWith('.result'))) {
    const taskId = file.slice('task-'.length, -'.result'.length);
    try {
      const decision = latestDecisionFor(taskId);
      if (!decision) continue;
      const authority = readAuthoritativeTaskResult<TaskResult>(projectRoot, taskId);
      if (!authority.result) continue;
      const result = authority.result;
      const rootId = rootIdFor(taskId);
      entries.set(taskId, {
        verdict: decision,
        filesChanged: normalizeDependencyFilesChanged(result.filesChanged).filter(exactDependencyPath),
        linesAdded: result.linesAdded,
        linesRemoved: result.linesRemoved,
        notes: typeof result.notes === 'string' ? result.notes : undefined,
        ...(rootId !== taskId ? { originalTaskId: rootId } : {}),
      });
    } catch (error) {
      // Missing/unreadable or malformed evidence remains pending by contract.
      if (!isExpectedDependencyResultReadError(error)) {
        debugLog('collectDependencyResultEntries', error);
      }
    }
  }
  return entries;
}

/**
 * Resolve dependency context for a worker prompt without changing scheduler
 * topology. Priority FIX attempts intentionally dispatch with `dependencies: []`,
 * but their workers still need the logical root task's dependency settlement
 * authority. Walk the explicit fixForTaskId chain and inherit every ancestor's
 * dependency ids for prompt/read-context only.
 */
export function resolvePromptDependencyIds(
  projectRoot: string,
  task: Task,
): readonly string[] {
  const ordered = new Set(task.dependencies ?? []);
  if (!task.fixForTaskId) return [...ordered];

  const tasksDir = join(projectRoot, TASKS_DIR);
  if (!existsSync(tasksDir)) return [...ordered];

  const tasksById = new Map<string, Task>();
  for (const file of readdirSync(tasksDir).sort()) {
    if (!file.startsWith('task-') || !file.endsWith('.json')) continue;
    try {
      const candidate = JSON.parse(readFileSync(join(tasksDir, file), 'utf-8')) as Task;
      if (candidate?.id) tasksById.set(candidate.id, candidate);
    } catch { /* malformed task evidence cannot widen prompt authority */ }
  }

  const seen = new Set<string>([task.id]);
  let parentId: string | undefined = task.fixForTaskId;
  while (parentId && !seen.has(parentId)) {
    seen.add(parentId);
    const parent = tasksById.get(parentId);
    if (!parent) break;
    for (const dependencyId of parent.dependencies ?? []) ordered.add(dependencyId);
    parentId = parent.fixForTaskId;
  }
  return [...ordered];
}

// ─── Provider enum values for Zod schemas ────────────────────────────────
const PROVIDER_NAMES = Object.keys(PROVIDER_MODEL_MAP) as [string, ...string[]];

// ═══ Zod Schemas ═══════════════════════════════════════════════════

/** Zod schema for a single directive task section */
export const DirectiveTaskSchema = z.object({
  title: z.string().min(1, 'Task title must not be empty'),
  model: z.string().min(1).optional(),
  effort: z.enum(['low', 'normal', 'high']).optional(),
  provider: z.enum(PROVIDER_NAMES).optional(),
  files: z.array(z.string()),
  scope: z.array(z.string()),
  description: z.string(),
  tests: z.array(z.string()).optional(),
}).superRefine((task, context) => {
  if (!task.model) return;
  try {
    resolveCanonicalModelIdentity(task.model, {
      ...(task.provider ? { provider: task.provider as ProviderName } : {}),
      registerParametric: false,
    });
  } catch (error) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['model'],
      message: error instanceof DeckentError ? error.code : 'E_MODEL_INVALID',
    });
  }
});

/** Zod schema for a complete parsed DIRECTIVES.md document */
export const DirectiveSchema = z.object({
  goal: z.string().min(1, 'Directive goal must not be empty'),
  tasks: z.array(DirectiveTaskSchema).min(1, 'At least one task is required'),
});

export type DirectiveTask = z.infer<typeof DirectiveTaskSchema>;
export type Directive = z.infer<typeof DirectiveSchema>;

/**
 * Validate a parsed directive object against DirectiveSchema.
 * Returns { success: true, data } on success, or { success: false, error } with a
 * human-readable message on failure. Never throws.
 */
export function validateDirective(
  input: unknown,
): { success: true; data: Directive } | { success: false; error: string } {
  const result = DirectiveSchema.safeParse(input);
  if (result.success) {
    return { success: true, data: result.data };
  }
  const formatted = result.error.format();
  const lines: string[] = ['DIRECTIVES validation failed:'];
  // Top-level field errors
  for (const [field, val] of Object.entries(formatted)) {
    if (field === '_errors') {
      for (const msg of val as string[]) lines.push(`  • ${msg}`);
      continue;
    }
    const fieldErrors = (val as { _errors?: string[] })._errors ?? [];
    for (const msg of fieldErrors) lines.push(`  • ${field}: ${msg}`);
  }
  // Per-task errors
  const tasksField = formatted.tasks as Record<string, { _errors?: string[]; title?: { _errors?: string[] }; model?: { _errors?: string[] }; effort?: { _errors?: string[] } }> | undefined;
  if (tasksField) {
    for (const [idx, taskErr] of Object.entries(tasksField)) {
      if (idx === '_errors') continue;
      const taskFieldErrors = taskErr as Record<string, { _errors?: string[] } | undefined>;
      for (const [subField, subVal] of Object.entries(taskFieldErrors)) {
        if (subField === '_errors') continue;
        for (const msg of (subVal?._errors ?? [])) {
          lines.push(`  • tasks[${idx}].${subField}: ${msg}`);
        }
      }
    }
  }
  return { success: false, error: lines.join('\n') };
}

// ═══ Types ═════════════════════════════════════════════════════════

export interface CreateTaskParams {
  title: string;
  description: string;
  model: ModelType;
  effort: TaskEffort;
  priority: TaskPriority;
  reason: string;
  scope: TaskScope;
  dependencies: string[];
  goNogo: GoNoGoCriteria;
  /** Exact task-local verification commands captured by the planner/directive parser. */
  verificationCommands?: readonly string[];
  sprintId: string;
  isPriorityFix?: boolean;
  fixForTaskId?: string;
  initialStatus?: TaskStatus;
  provider?: ProviderName;
  forceModel?: ModelType;
  forceEffort?: TaskEffort;
  forceAgent?: string;
  forceSkills?: string[];
  excludeAgent?: string[];
  excludeSkills?: string[];
  authMode?: 'subscription' | 'api';
  /** Per-task spawn backend override (`- Backend: docker|host`), Sprint 252 PSL-1. */
  backend?: 'docker' | 'tmux' | 'subprocess';
  /** Per-task MODEL reasoning-effort (`- ModelEffort: <level>`), Sprint 252 F1-RE — distinct from work-size effort. */
  modelEffort?: string;
  fixMode?: 'verify-only' | 'amend' | 're-implement';
  /** Tier-1 Proof-of-Function smoke directive propagated from ParsedDirectiveTask (216-004). */
  smoke?: { command: string; expect: string };
  /**
   * Explicit planner-authored production-mutation authority. Absence is never
   * inferred from filenames, prose, or scope; producer-side classification is
   * responsible for supplying this digest-bound contract.
   */
  productionWiring?: ProductionWiringPlanEvidence;
  /**
   * Digest-bound post-settlement promotion-proof declaration parsed from a
   * `- PromotionProof:` directive line (488-014). Absent unless explicitly declared.
   */
  postSettlementProjection?: PostSettlementPlanProjection;
}

/** Fail-closed planner/build boundary outcome; dispatchers must treat it as HOLD. */
export class ProductionWiringTaskHoldError extends DeckentError {
  readonly decision: Exclude<ProductionWiringDecision, { readonly decision: 'complete' | 'staged-foundation' }>;

  constructor(
    taskTitle: string,
    decision: Exclude<ProductionWiringDecision, { readonly decision: 'complete' | 'staged-foundation' }>,
  ) {
    super(
      'E_PRODUCTION_WIRING_HOLD',
      `Production mutation task "${taskTitle}" is on HOLD: ${decision.decision}.`,
    );
    this.name = 'ProductionWiringTaskHoldError';
    this.decision = decision;
  }
}

function validateProductionWiringAuthority(
  title: string,
  authority: ProductionWiringPlanEvidence | undefined,
  scope: TaskScope,
): ProductionWiringPlanEvidence | undefined {
  const applicability = deriveProductionWiringApplicability(scope);
  if (!authority) {
    if (applicability.state === 'required') {
      throw new DeckentError(
        'E_PRODUCTION_WIRING_REQUIRED',
        `Production mutation task "${title}" requires canonical V2 wiring authority.`,
      );
    }
    return undefined;
  }

  if (authority.version !== 2 || authority.contract.version !== 2) {
    throw new DeckentError(
      'E_PRODUCTION_WIRING_V1_HISTORICAL_ONLY',
      `Production mutation task "${title}" uses historical V1 wiring evidence and cannot enter a new exact execution.`,
    );
  }

  let canonical: ProductionWiringPlanEvidence;
  try {
    canonical = createProductionWiringPlanEvidence(authority.contract);
  } catch {
    throw new DeckentError(
      'E_PRODUCTION_WIRING_DIGEST_MISMATCH',
      `Production mutation task "${title}" has stale or malformed plan wiring authority.`,
    );
  }
  if (
    authority.version !== canonical.version
    || authority.contractDigest !== canonical.contractDigest
    || authority.hostProofProgramDigest !== canonical.hostProofProgramDigest
  ) {
    throw new DeckentError(
      'E_PRODUCTION_WIRING_DIGEST_MISMATCH',
      `Production mutation task "${title}" has stale or malformed plan wiring authority.`,
    );
  }

  const decision = resolveProductionWiringContract(authority.contract);
  if (decision.decision !== 'complete' && decision.decision !== 'staged-foundation') {
    throw new ProductionWiringTaskHoldError(title, decision);
  }
  if (canonical.version === 2
    && productionWiringVerifierAssetWriteScopeOverlap(scope, canonical) !== null) {
    throw new DeckentError(
      'E_PRODUCTION_WIRING_VERIFIER_ASSET_WRITE_SCOPE',
      `Production mutation task "${title}" can write a trusted verifier asset.`,
    );
  }
  if (canonical.version === 2
    && validateProductionWiringHostProofAdapterAdmission(
      canonical.contract.hostProofProgram,
    ).state !== 'valid') {
    throw new DeckentError(
      'E_PRODUCTION_WIRING_HOST_PROOF_ADAPTER_UNREGISTERED',
      `Production mutation task "${title}" names a host-proof adapter that is not code-owned and owner-admitted.`,
    );
  }
  return canonical;
}

export interface ParsedDirectiveTask {
  title: string;
  description: string;
  scope: TaskScope;
  testTarget?: string;
  provider?: ProviderName;
  forceModel?: ModelType;
  forceEffort?: TaskEffort;
  forceAgent?: string;
  forceSkills?: string[];
  excludeAgent?: string[];
  excludeSkills?: string[];
  /** Task dependency IDs parsed from "- Dependencies: 134-005, 134-007" */
  dependencies?: string[];
  /** Task priority parsed from "- Priority: CRITICAL" (default: undefined → NORMAL) */
  priority?: TaskPriority;
  /** Per-task auth mode parsed from "- Auth: subscription|api" */
  authMode?: 'subscription' | 'api';
  /** Per-task spawn backend parsed from "- Backend: docker|host" (Sprint 252 PSL-1). */
  backend?: 'docker' | 'tmux' | 'subprocess';
  /** Per-task MODEL reasoning-effort (`- ModelEffort: <level>`), Sprint 252 F1-RE — distinct from work-size effort. */
  modelEffort?: string;
  /** Tier-1 Proof-of-Function smoke (216-004): real-binary command + expected output, split on `→`. */
  smoke?: { command: string; expect: string };
  /** U1-G2: parsed `- Meta:` line (flowId/revision/…) — content-dışı taşınır. */
  meta?: Record<string, string>;
  /**
   * Digest-bound post-settlement promotion-proof declaration (488-014), parsed
   * from a `- PromotionProof: <ingress>[/<platform>] <executable> [args...]`
   * directive line via {@link extractPromotionProofDeclaration}.
   */
  postSettlementProjection?: PostSettlementPlanProjection;
  /** Canonical V2 authority parsed from an exact ProductionWiring JSON declaration. */
  productionWiring?: ProductionWiringPlanEvidence;
  /** Host-derived from exact scope; directive prose cannot grant an exemption. */
  productionWiringApplicability: ReturnType<typeof deriveProductionWiringApplicability>;
}

function parseProductionWiringDirective(
  lines: readonly string[],
  title: string,
): ProductionWiringPlanEvidence | undefined {
  const raw = findDirectiveValue(lines, 'productionwiring');
  if (raw === undefined) return undefined;
  let decoded: unknown;
  try {
    decoded = JSON.parse(raw);
  } catch {
    throw new DeckentError(
      'E_PRODUCTION_WIRING_DIRECTIVE_INVALID',
      `Production mutation task "${title}" has malformed ProductionWiring JSON.`,
    );
  }
  const input = parseProductionWiringContractV2Input(decoded);
  if (input === null) {
    throw new DeckentError(
      'E_PRODUCTION_WIRING_DIRECTIVE_INVALID',
      `Production mutation task "${title}" has invalid ProductionWiring V2 authority.`,
    );
  }
  try {
    return createProductionWiringPlanEvidenceV2(input);
  } catch {
    throw new DeckentError(
      'E_PRODUCTION_WIRING_DIRECTIVE_HOLD',
      `Production mutation task "${title}" has incomplete ProductionWiring proof coverage.`,
    );
  }
}

/**
 * Extract a Tier-1 `Smoke:` directive from a task block: `**Smoke:** <cmd> → <expect>`
 * or `- Smoke: <cmd> → <expect>`. Returns undefined when absent or missing the
 * `→` separator. Sprint 216-004; reconstructed Sprint 218 after a git reset.
 */
export function extractSmoke(text: string): { command: string; expect: string } | undefined {
  const m = text.match(/(?:[-*]\s*)?\*{0,2}Smoke:?\*{0,2}\s*(.+)/i);
  if (!m) return undefined;
  const rest = m[1]!.trim();
  const arrowIdx = rest.indexOf('→');
  if (arrowIdx === -1) return undefined;
  const command = rest.slice(0, arrowIdx).trim();
  const expect = rest.slice(arrowIdx + 1).trim();
  if (!command || !expect) return undefined;
  return { command, expect };
}

const POST_SETTLEMENT_INGRESS_VALUES: readonly PostSettlementIngress[] =
  ['sprint', 'run-flow', 'do', 'autonomous', 'process'];
const POST_SETTLEMENT_PLATFORM_VALUES: readonly PostSettlementPlatformCapability[] =
  ['linux', 'darwin', 'win32', 'wsl', 'any'];

/**
 * Extract a post-settlement promotion-proof declaration from a task block:
 * `- PromotionProof: <ingress>[/<platform>] <executable> [args...]`
 * (e.g. `- PromotionProof: sprint/linux npm run verify`).
 *
 * The command is tokenized with {@link shellSplit} into a bounded argv array —
 * the joined directive text is never retained or spawned as a shell string
 * (ADR-006 no-shell discipline, same reasoning as the Smoke runner). Returns
 * undefined (never throws) when the line is absent, malformed, declares an
 * unknown ingress/platform, or exceeds the bounded-command limits shared with
 * the runtime reducer (post-settlement-verification.ts, 488-013) — a bad
 * declaration is silently absent rather than corrupting the whole directive
 * parse, mirroring {@link extractSmoke}'s contract.
 */
export function extractPromotionProofDeclaration(
  text: string,
  scope: TaskScope,
): PostSettlementPlanProjection | undefined {
  const m = text.match(/(?:[-*]\s*)?\*{0,2}PromotionProof:?\*{0,2}\s*(.+)/i);
  if (!m) return undefined;
  const rest = m[1]!.trim();
  const firstSpace = rest.indexOf(' ');
  if (firstSpace === -1) return undefined;
  const head = rest.slice(0, firstSpace);
  const commandText = rest.slice(firstSpace + 1).trim();
  if (!commandText) return undefined;

  const [ingressRaw, platformRaw] = head.split('/');
  if (!POST_SETTLEMENT_INGRESS_VALUES.includes(ingressRaw as PostSettlementIngress)) return undefined;
  const ingress = ingressRaw as PostSettlementIngress;
  const platformCapability = (platformRaw ?? 'any') as PostSettlementPlatformCapability;
  if (!POST_SETTLEMENT_PLATFORM_VALUES.includes(platformCapability)) return undefined;

  return boundedProofProjection(commandText, scope, ingress, platformCapability);
}

/**
 * Tokenize `commandText` into the bounded argv a post-settlement projection
 * accepts and build the projection. Returns undefined (never throws) when the
 * command is empty or violates the bounded-command limits shared with the
 * runtime reducer (post-settlement-verification.ts).
 */
function boundedProofProjection(
  commandText: string,
  scope: TaskScope,
  ingress: PostSettlementIngress,
  platformCapability: PostSettlementPlatformCapability,
): PostSettlementPlanProjection | undefined {
  const argv = shellSplit(commandText);
  if (argv.length === 0) return undefined;
  const [executable, ...args] = argv;
  if (!executable) return undefined;
  if (args.length > POST_SETTLEMENT_MAX_COMMAND_ARGS) return undefined;
  if ([executable, ...args].some(value => Buffer.byteLength(value, 'utf8') > POST_SETTLEMENT_MAX_ARG_BYTES)) {
    return undefined;
  }
  if (args.some(arg => arg.includes('\0')) || executable.includes('\0')) return undefined;

  const cwdRef = scope.directories[0] ?? '.';
  return createPostSettlementPlanProjection({
    ingress,
    scope,
    platformCapability,
    command: { executable, args, cwdRef },
  });
}

// ─── 519-004: source verification vs built-binary proof staging ───────
//
// Root cause (row 3275, sprint-487): a plan could express a proof obligation
// that only the BUILT artifact can satisfy — a `Smoke:` directive is documented
// as a "real-binary command" and free-text goCriteria are prose — while a sprint
// is forbidden from building (BUILD-VIOLATION-GUARD, born-644). Both stages
// already existed (`smoke` = in-sprint, `postSettlementProjection` = after
// settlement); what was missing is the plan-time CLASSIFICATION between them, so
// a built-CLI demand was accepted verbatim as an in-sprint criterion and every
// retry burned against a stale dist/ by construction.
//
// The detector below is deliberately conservative: only signals that cannot be
// satisfied without a fresh build count. A type check (`tsc --noEmit`, and the
// project's bare `npx tsc` check line) is SOURCE verification and never matches.

/** Why a proof command can only run against a freshly built artifact. */
export type BuiltBinaryProofSignal =
  | 'build-command'
  | 'dist-artifact'
  | 'package-artifact'
  | 'global-install';

/** A matched built-binary demand: the signal plus the exact matched evidence text. */
export interface BuiltBinaryProofDemand {
  readonly signal: BuiltBinaryProofSignal;
  readonly token: string;
}

const BUILT_BINARY_PROOF_PATTERNS: ReadonlyArray<{
  readonly signal: BuiltBinaryProofSignal;
  readonly re: RegExp;
}> = [
  // Package-script build invocation (`npm|yarn|pnpm [run] build|rebuild|prepack`).
  { signal: 'build-command', re: /\b(?:npm|yarn|pnpm)\s+(?:run\s+)?(?:build|rebuild|prepack|prepublishOnly)\b/i },
  // Built-artifact path: `dist/cli/index.js`, `./dist/…`, `node dist/index.js`.
  { signal: 'dist-artifact', re: /(?:^|[\s"'`(=])\.{0,2}\/?dist\/[A-Za-z0-9._/-]+/ },
  // Tarball/pack artifact.
  { signal: 'package-artifact', re: /\bnpm\s+pack\b/i },
  // Globally installed / linked binary.
  { signal: 'global-install', re: /\bnpm\s+(?:install|i|link)\s+(?:-g\b|--global\b)/i },
];

/**
 * Classify whether `text` demands the BUILT binary. Returns the first matching
 * signal, or undefined when the text is satisfiable from source alone.
 * Pure — no filesystem, no spawn.
 */
export function classifyBuiltBinaryProofDemand(text: string): BuiltBinaryProofDemand | undefined {
  if (!text) return undefined;
  for (const { signal, re } of BUILT_BINARY_PROOF_PATTERNS) {
    const m = re.exec(text);
    if (m) return { signal, token: m[0].trim() };
  }
  return undefined;
}

/**
 * Restate a built-binary proof command as the typed post-settlement obligation
 * it actually is. This is the ONLY sanctioned home for such a demand: it never
 * becomes a Task of its own and never becomes an in-sprint criterion.
 * Returns undefined when the command exceeds the bounded-argv limits — callers
 * must then surface the demand instead of dropping it.
 */
export function stageBuiltBinaryProofObligation(params: {
  readonly commandText: string;
  readonly scope: TaskScope;
  readonly ingress?: PostSettlementIngress;
  readonly platformCapability?: PostSettlementPlatformCapability;
}): PostSettlementPlanProjection | undefined {
  const commandText = params.commandText.trim();
  if (!commandText) return undefined;
  return boundedProofProjection(
    commandText,
    params.scope,
    params.ingress ?? 'sprint',
    params.platformCapability ?? 'any',
  );
}

export type ProofStagingFindingCode =
  /** An in-sprint proof surface demands the built binary — impossible by construction. */
  | 'IN_SPRINT_BUILT_BINARY_DEMAND'
  /** The demand could not be bounded into a post-settlement obligation; it is kept, not dropped. */
  | 'BUILT_BINARY_PROOF_UNSTAGEABLE';

/** Which proof surface the demand was authored on. */
export type ProofStagingSurface = 'smoke' | 'testTarget' | 'goCriteria' | 'noGoCriteria';

/**
 * Typed plan-time finding for the source-verification / built-binary boundary.
 * `stagedObligation` carries the post-settlement restatement of the rejected
 * demand — a finding never means the demand was dropped.
 */
export interface ProofStagingFinding {
  readonly severity: 'BLOCK' | 'WARN';
  readonly code: ProofStagingFindingCode;
  readonly surface: ProofStagingSurface;
  readonly signal: BuiltBinaryProofSignal;
  /** The offending text as authored. */
  readonly demand: string;
  readonly message: string;
  /** Task id (planner lint) or title (directive parse) the finding belongs to. */
  readonly taskRef?: string;
  readonly stagedObligation?: PostSettlementPlanProjection;
}

/** Proof obligations of one directive block, split across the two authority stages. */
export interface DirectiveProofStaging {
  /** In-sprint Tier-1 smoke — absent once a built-binary demand has been rejected. */
  readonly smoke?: { command: string; expect: string };
  /** Post-settlement obligation: an explicit PromotionProof, or a restaged binary demand. */
  readonly postSettlementProjection?: PostSettlementPlanProjection;
  readonly findings: readonly ProofStagingFinding[];
  /** True when a finding actually changed the returned obligations (hard-flip applied). */
  readonly enforced: boolean;
}

export interface ProofStagingOptions {
  /**
   * Apply the rejection to the returned obligations instead of only reporting it.
   *
   * Defaults to FALSE, matching the ADR-G-020 V1.0 posture this repo uses to land
   * a new authority gate: warn + emit first, hard-block once the tree has migrated.
   * Two fixtures still author an in-sprint `dist/` smoke as the expected shape
   * (tests/orchestra/planner-smoke-wire.test.ts, planner-smoke-e2e.test.ts) and
   * they are outside this task's write authority — flipping the default before
   * they are restaged would break a contract this task may not edit. The finding
   * is raised and warned in BOTH modes, so the demand is never silent.
   */
  readonly enforce?: boolean;
}

/**
 * Split a directive block's proof obligations into the two authority stages.
 *
 * A `Smoke:` command that needs the built binary is rejected from the in-sprint
 * stage with a typed finding and restated as a post-settlement obligation (an
 * explicitly authored `PromotionProof:` always wins). Under the default advisory
 * mode the returned obligations are left as authored; under `enforce` the
 * rejection is applied. A smoke satisfiable from source, and a block with no
 * smoke at all, are returned exactly as before in both modes — normal tasks plan
 * byte-identically.
 */
export function stageDirectiveProofObligations(
  block: string,
  scope: TaskScope,
  taskTitle?: string,
  options: ProofStagingOptions = {},
): DirectiveProofStaging {
  const smoke = extractSmoke(block);
  const declared = extractPromotionProofDeclaration(block, scope);
  const asAuthored = { smoke, postSettlementProjection: declared, findings: [], enforced: false } as const;
  if (!smoke) return asAuthored;

  const demand = classifyBuiltBinaryProofDemand(smoke.command);
  if (!demand) return asAuthored;

  const staged = declared ?? stageBuiltBinaryProofObligation({ commandText: smoke.command, scope });
  if (!staged) {
    // Bounds-unstageable: keep the demand visible rather than losing it.
    const finding: ProofStagingFinding = {
      severity: 'BLOCK',
      code: 'BUILT_BINARY_PROOF_UNSTAGEABLE',
      surface: 'smoke',
      signal: demand.signal,
      demand: smoke.command,
      taskRef: taskTitle,
      message:
        `Smoke command needs the built binary (${demand.signal}: "${demand.token}") but exceeds the `
        + 'bounded post-settlement command limits — the demand is kept as authored and must be restated by hand.',
    };
    warnProofStaging(finding);
    return { smoke, postSettlementProjection: declared, findings: [finding], enforced: false };
  }

  const finding: ProofStagingFinding = {
    severity: 'BLOCK',
    code: 'IN_SPRINT_BUILT_BINARY_DEMAND',
    surface: 'smoke',
    signal: demand.signal,
    demand: smoke.command,
    taskRef: taskTitle,
    stagedObligation: staged,
    message:
      `Smoke command needs the built binary (${demand.signal}: "${demand.token}"); a sprint never builds, so this `
      + 'in-sprint criterion belongs on the post-settlement proof stage'
      + (options.enforce ? ' — rejected and restaged.' : ' (advisory: obligations left as authored).'),
  };
  warnProofStaging(finding);
  return options.enforce
    ? { smoke: undefined, postSettlementProjection: staged, findings: [finding], enforced: true }
    : { smoke, postSettlementProjection: declared, findings: [finding], enforced: false };
}

/** Loud, typed operator signal — a restaged proof obligation is never silent. */
function warnProofStaging(finding: ProofStagingFinding): void {
  process.stderr.write(
    `[deckent] ${finding.severity}: ${finding.code} (${finding.surface}`
    + `${finding.taskRef ? `, task "${finding.taskRef}"` : ''}) — ${finding.message}\n`,
  );
}

// ═══ Functions ════════════════════════════════════════════════════

/**
 * Parse a Skills: directive line into force/exclude lists.
 * Supports: "Skills: typescript-expert, -ci-testing, testing-expert"
 * - prefix means exclude, no prefix means include (force).
 * "Skills: none" → forceSkills=[], excludeSkills=[] (explicitly no skills)
 * "Skills: auto" → undefined (let auto-selection run)
 */
export function parseSkillsDirective(line: string | undefined): {
  forceSkills: string[] | undefined;
  excludeSkills: string[] | undefined;
} {
  if (!line) return { forceSkills: undefined, excludeSkills: undefined };

  const value = line.replace(/.*Skills:\s*/i, '').trim();
  if (!value) return { forceSkills: undefined, excludeSkills: undefined };

  const lower = value.toLowerCase();
  if (lower === 'none') return { forceSkills: [], excludeSkills: undefined };
  if (lower === 'auto') return { forceSkills: undefined, excludeSkills: undefined };

  const parts = value.split(',').map(s => s.trim()).filter(Boolean);
  const include: string[] = [];
  const exclude: string[] = [];

  for (const part of parts) {
    if (part.startsWith('-')) {
      exclude.push(part.slice(1).trim());
    } else if (part.toLowerCase() !== 'auto') {
      include.push(part);
    }
  }

  return {
    forceSkills: include.length > 0 ? include : undefined,
    excludeSkills: exclude.length > 0 ? exclude : undefined,
  };
}

/**
 * Normalise a raw dependency value (the part after "Dependencies:") into an
 * array of task-ID strings.  Accepts three formats:
 *   - bare string:           "169-003"              → ["169-003"]
 *   - comma-separated list:  "169-003, 169-007"     → ["169-003", "169-007"]
 *   - JSON array literal:    '["169-003"]'          → ["169-003"]
 * Returns an empty array for empty / whitespace-only / "none" input.
 * Malformed JSON falls back to comma-split (never throws).
 */
export function parseDependencyField(raw: string): string[] {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.toLowerCase() === 'none') return [];

  if (trimmed.startsWith('[')) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return (parsed as unknown[]).map(v => String(v).trim()).filter(Boolean);
      }
    } catch {
      // malformed JSON — fall through to comma-split
    }
  }

  return trimmed.split(',').map(s => s.trim()).filter(Boolean);
}

/**
 * Parse a Dependencies: directive line into an array of dependency refs.
 *
 * Supports two ref styles in the array elements (Sprint 182 W2-2):
 *   - Plan-slot ID (back-compat):   "169-003", "134-005"
 *   - Title-prefix label (new):     "W1-1", "GATE-2", "PQ-3"
 *
 * Plan-slot IDs shift when Brain auto-prepends critical-debt fix tasks at
 * the head of the sprint (Sprint 176/178 drift bug) — title-prefix refs
 * survive that shift because they bind by the directive task's title, not
 * its allocation slot. Caller resolves each raw ref via `resolveDependencyRef`
 * after the full task list is built.
 *
 * Accepted line shapes (all delegated to `parseDependencyField`):
 *   - bare:           "Dependencies: 134-005"
 *   - comma list:     "- Dependencies: 134-005, 134-007"
 *   - JSON array:     '- Dependencies: ["W1-1", "W1-2"]'
 *
 * Returns undefined if there is no dependencies line or the value is empty.
 */
export function parseDependenciesDirective(line: string | undefined): string[] | undefined {
  if (!line) return undefined;

  const value = line.replace(/.*Dependencies:\s*/i, '').trim();
  if (!value) return undefined;

  const parts = parseDependencyField(value);
  return parts.length > 0 ? parts : undefined;
}

// Reserved prefixes / keywords that always resolve to themselves rather than
// being interpreted as title-prefix lookups (so `Dependencies: none` etc. are
// never accidentally treated as title fragments). Plan-slot IDs are detected
// by regex.
const DEPENDENCY_REF_RESERVED = new Set(['NONE', 'AUTO']);

const PLAN_SLOT_ID_RE = /^\d{1,4}-\d{1,4}$/;

// born-458: matches the human-natural "Task N" / "task N" dependency-ref form
// (e.g. "Dependencies: Task 1"), as opposed to a plan-slot id or title-prefix.
const TASK_N_RE = /^task\s+(\d+)$/i;

/**
 * Format guard (323-031): true when `ref` is a canonical plan-slot task id
 * (`NNN-NNN`, e.g. "323-005") — the shape structured `- Dependencies: 323-005,
 * 323-007` lines parse into. Distinguishes concrete slot ids from title-prefix
 * labels ("W1-1") and free-text titles so callers can validate dependency
 * format and classify an unresolvable ref as id-shaped (a referenced task that
 * does not exist) vs title-shaped (planner emitted a title, not an id).
 * Trims surrounding whitespace; non-string input is never a slot id.
 */
export function isPlanSlotId(ref: string): boolean {
  return typeof ref === 'string' && PLAN_SLOT_ID_RE.test(ref.trim());
}

function escapeRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Test whether `title` contains `ref` as a standalone token.
 *
 * Standalone means: the ref appears at the start of `title`, at the end, or
 * surrounded by non-(word|dash) characters. This avoids the classic
 * substring trap where `"W1-1"` would otherwise match the title `"W1-10 …"`.
 * Comparison is case-insensitive so `Dependencies: ["w1-1"]` resolves the
 * same as `["W1-1"]`.
 */
function titleHasRefToken(title: string, ref: string): boolean {
  if (!title || !ref) return false;
  const re = new RegExp(`(?:^|[^\\w-])${escapeRegExp(ref)}(?=[^\\w-]|$)`, 'i');
  return re.test(title);
}

/**
 * Sprint 182 W2-2 — Resolve a single DIRECTIVES dependency ref to a concrete
 * `task.id`, surviving the auto-debt prepend offset drift (Sprint 176/178).
 *
 * Resolution order:
 *   1. Pure integer (`"0"`, `"1"`, …) → 0-based index into the DIRECTIVE
 *      tasks only — entries with `isPriorityFix === true` (auto-injected
 *      debt-fix prepends) are excluded from the index space (325-001,
 *      index-base fix sprint-573/574 evidence).
 *   2. Human-natural `"Task N"` / `"task N"` (born-458) → 1-based index into
 *      the same directive-only sublist, matching the `## Task N:` heading
 *      numbering DIRECTIVES.md authors actually write (`"Task 1"` is the
 *      first authored task — never a debt prepend the author cannot see).
 *      Distinct literal shape from #1 so the two never collide.
 *   3. Plan-slot ID (`NNN-NNN`) → exact `task.id` lookup. Returns the id
 *      when a task with that exact id exists, otherwise undefined. (Back-
 *      compat: legacy DIRECTIVES that hard-code slot IDs still work — but
 *      only when the slot is actually present after planning.)
 *   4. Title-prefix label (anything else) → case-insensitive token match
 *      against `task.title`. Returns the first matching task's id, or
 *      undefined when no title contains the ref as a standalone token.
 *
 * A ref that resolves to `undefined` here is NOT silently dropped by every
 * caller — batch callers should prefer `resolveTaskDependenciesLoud`, which
 * reports every unresolved ref instead of swallowing it.
 *
 * Why index forms skip debt prepends: Brain prepends critical-debt fix tasks
 * at the head of the sprint, which shifts every subsequent plan-slot ID by N.
 * Hard-coded refs like `"178-002"` then silently point at the wrong disk
 * task, and (before the sprint-573/574 fix) `"Task N"`/integer refs bound to
 * the debt-shifted position instead of the authored task — chaining honest
 * directive tasks onto un-fixable debt lineages and parking whole runs.
 * Title-prefix labels (`"W1-1"`) bind to the directive task itself, so they
 * were always safe; index forms now share that safety by indexing only the
 * directive sublist.
 *
 * @param ref Raw dependency reference parsed from DIRECTIVES.
 * @param tasks All tasks already created for the sprint (debt + directive)
 *   — typically passed in after the planner finishes constructing the task
 *   list. Only `id`, `title` and `isPriorityFix` are read.
 */
export function resolveDependencyRef(
  ref: string,
  tasks: ReadonlyArray<{ id: string; title: string; isPriorityFix?: boolean }>,
): string | undefined {
  if (typeof ref !== 'string') return undefined;
  const trimmed = ref.trim();
  if (!trimmed) return undefined;
  if (DEPENDENCY_REF_RESERVED.has(trimmed.toUpperCase())) return undefined;

  // Canonical task ids are not limited to the historical `NNN-NNN` plan-slot
  // shape. Timestamp-backed sprint ids (for example `1780659451555-017`) are
  // already persisted by the structured-plan normalizer before SPAWN, where
  // the shared planner normalizer runs a second, idempotence-oriented pass.
  // Resolve an exact sibling id before applying legacy shape heuristics;
  // otherwise that second pass treats a valid canonical id as a title label
  // and silently drops the authored dependency at the execution boundary.
  const exactTask = tasks.find(t => t.id === trimmed);
  if (exactTask) return exactTask.id;

  // Index-form refs ("0" / "Task 3") count only authored directive tasks:
  // auto-injected debt-fix prepends are invisible to the DIRECTIVES author,
  // so they must be invisible to the author's numbering too.
  const directiveTasks = tasks.filter(t => t.isPriorityFix !== true);

  // Pure integer → 0-based index into the task list (e.g. "0" resolves to the first task's id).
  // This handles `- Dependencies: 0` refs where the planner emits a list index instead of a slot-id.
  if (/^\d+$/.test(trimmed)) {
    const idx = Number.parseInt(trimmed, 10);
    return directiveTasks[idx]?.id;
  }

  // born-458: human-natural "Task N" / "task N" form → 1-based index into the
  // task list, matching DIRECTIVES.md's own "## Task N:" heading numbering
  // (authors write "Dependencies: Task 1" meaning the FIRST task). Deliberately
  // 1-based and a distinct literal shape from the 0-based pure-integer form
  // above, so "0"/"1" and "Task 0"/"Task 1" never collide or alias each other.
  const taskNMatch = TASK_N_RE.exec(trimmed);
  if (taskNMatch) {
    const n = Number.parseInt(taskNMatch[1]!, 10);
    return directiveTasks[n - 1]?.id;
  }

  if (PLAN_SLOT_ID_RE.test(trimmed)) {
    return undefined;
  }

  const titleMatch = tasks.find(t => titleHasRefToken(t.title, trimmed));
  return titleMatch?.id;
}

/**
 * Sprint 182 W2-2 — Batch-resolve dependency refs into concrete task IDs.
 *
 * Convenience wrapper around `resolveDependencyRef`:
 *   - preserves the input order
 *   - drops refs that fail to resolve (caller can compare lengths to detect
 *     missing references and emit a warning if needed)
 *   - de-duplicates the output (a dependency listed twice resolves to one id)
 */
export function resolveTaskDependencies(
  refs: ReadonlyArray<string>,
  tasks: ReadonlyArray<{ id: string; title: string; isPriorityFix?: boolean }>,
): string[] {
  const seen = new Set<string>();
  const resolved: string[] = [];
  for (const ref of refs) {
    const id = resolveDependencyRef(ref, tasks);
    if (id && !seen.has(id)) {
      seen.add(id);
      resolved.push(id);
    }
  }
  return resolved;
}

/** A dependency ref that `resolveTaskDependenciesLoud` could not resolve. */
export interface DependencyRefWarning {
  /** Id of the task whose `Dependencies:` line contained the ref. */
  taskId: string;
  /** The raw, unresolved ref string. */
  ref: string;
  /** The exact `[deckent] WARN: ...` message emitted to stderr. */
  message: string;
}

export interface ResolveTaskDependenciesLoudOptions {
  /**
   * Mirrors the project-config `dependency_ref_strict` field (default off).
   * When true, the FIRST unresolved ref throws instead of warning — blocking
   * planning outright. Callers wire this from `config.dependency_ref_strict`;
   * this function does not read config itself.
   */
  strict?: boolean;
}

export interface ResolveTaskDependenciesLoudResult {
  /** Successfully resolved, order-preserved, de-duplicated task ids. */
  resolved: string[];
  /** Every ref that could not be resolved (empty when all refs resolve). */
  warnings: DependencyRefWarning[];
}

/**
 * born-458 — Loud variant of `resolveTaskDependencies`: an unresolved
 * dependency ref is never silently dropped.
 *
 * For each ref in `refs`:
 *   - resolves via `resolveDependencyRef` (all ref styles: pure-integer,
 *     "Task N", plan-slot id, title-prefix — unchanged resolution rules)
 *   - on success: de-duplicated + appended to `resolved`, order preserved
 *   - on failure: builds `[deckent] WARN: dependency ref '<ref>' çözülemedi
 *     (task <ownerTaskId>)`; when `options.strict` is set, THROWS that
 *     message immediately (blocks plan construction); otherwise writes it to
 *     stderr and records it in the returned `warnings` array so the caller
 *     can stamp it onto the plan output — the ref is dropped from `resolved`
 *     either way, it just never happens invisibly.
 *
 * `resolveTaskDependencies` (above) is left untouched for existing callers
 * that want silent-drop batch resolution; this is an additive sibling.
 */
export function resolveTaskDependenciesLoud(
  ownerTaskId: string,
  refs: ReadonlyArray<string>,
  tasks: ReadonlyArray<{ id: string; title: string; isPriorityFix?: boolean }>,
  options: ResolveTaskDependenciesLoudOptions = {},
): ResolveTaskDependenciesLoudResult {
  const seen = new Set<string>();
  const resolved: string[] = [];
  const warnings: DependencyRefWarning[] = [];

  for (const ref of refs) {
    const id = resolveDependencyRef(ref, tasks);
    if (id) {
      if (!seen.has(id)) {
        seen.add(id);
        resolved.push(id);
      }
      continue;
    }

    const message = `[deckent] WARN: dependency ref '${ref}' çözülemedi (task ${ownerTaskId})`;
    if (options.strict) {
      throw new DeckentError('E_DEP_REF_UNRESOLVED', message);
    }
    process.stderr.write(message + '\n');
    warnings.push({ taskId: ownerTaskId, ref, message });
  }

  return { resolved, warnings };
}

/**
 * born-465 — Normalize EVERY task's `dependencies` from raw DIRECTIVES refs
 * (title-prefix / "Task N" / integer-index / plan-slot id) into concrete
 * slot-ids, once the full structured-plan task list has been built.
 *
 * The structured-plan path (sprint-planner.ts `planSprint`) writes
 * `src.dependencies` straight through to `createTask({ dependencies })` and
 * never resolves title-prefix/"Task N" refs before the task list is
 * serialized to `.tasks/task-*.json` — unlike the AI-planner path
 * (`normalizePlannerDependencies`, planner.ts:904), which already normalizes
 * at construction time. Three runtime layers then disagree on how to read a
 * raw (unresolved) ref: wave-dispatch resolves it inline, the FIFO scheduler
 * drops it, and planContinuous stalls forever waiting on a dependency id that
 * never appears. Calling this once the full task list (debt + directive
 * tasks) is built — and before the tasks are written to disk — makes every
 * runtime layer see the same resolved slot-id shape.
 *
 * Mutates `dependencies` on each task IN PLACE, mirroring
 * `normalizePlannerDependencies`'s contract. Reuses `resolveTaskDependenciesLoud`
 * (born-458 / 358-010) per task, so an unresolved ref keeps the exact same
 * WARN+drop / strict-throw contract already proven for that path — this adds
 * no new resolution policy, it only runs the existing one earlier, for the
 * structured-plan path.
 *
 * @param tasks Full completed task list (debt + directive tasks). Only `id`,
 *   `title`, `dependencies` are read; `dependencies` is rewritten on each entry.
 * @param options.strict Mirrors `config.dependency_ref_strict` (default off) —
 *   throws on the first unresolved ref instead of warning. Caller wires this
 *   from config; this function does not read config itself.
 * @returns every unresolved ref across the whole list (already WARN'd to
 *   stderr per-task by `resolveTaskDependenciesLoud`, unless strict threw first).
 */
export function normalizeStructuredTaskDependencies(
  tasks: Array<{ id: string; title: string; dependencies: string[]; isPriorityFix?: boolean }>,
  options: ResolveTaskDependenciesLoudOptions = {},
): { warnings: DependencyRefWarning[] } {
  const warnings: DependencyRefWarning[] = [];
  for (const task of tasks) {
    if (!task.dependencies || task.dependencies.length === 0) continue;
    const { resolved, warnings: taskWarnings } = resolveTaskDependenciesLoud(
      task.id, task.dependencies, tasks, options,
    );
    warnings.push(...taskWarnings);
    task.dependencies = resolved;
  }
  return { warnings };
}

const VALID_PRIORITIES: readonly string[] = ['CRITICAL', 'HIGH', 'NORMAL', 'LOW'];

/**
 * Parse a Priority: directive line into a TaskPriority value.
 * Supports: "- Priority: CRITICAL", "Priority: HIGH", etc.
 * Returns undefined if no priority line or invalid value (caller defaults to "NORMAL").
 */
export function parsePriorityDirective(line: string | undefined): TaskPriority | undefined {
  if (!line) return undefined;

  const value = line.replace(/.*Priority:\s*/i, '').trim().toUpperCase();
  if (!value) return undefined;

  return VALID_PRIORITIES.includes(value) ? value as TaskPriority : undefined;
}

/**
 * Parse the "- Auth: subscription|api" directive line.
 * Returns undefined for unrecognized values (caller falls back to config `auth_mode`).
 * Per-task `api` opts the worker container out of `~/.claude` session mount and
 * REQUIRES `ANTHROPIC_API_KEY` in the env (enforced in spawn-backend-docker).
 */
export function parseAuthModeDirective(line: string | undefined): 'subscription' | 'api' | undefined {
  if (!line) return undefined;
  const value = line.replace(/.*Auth:\s*/i, '').trim().toLowerCase();
  if (value === 'api') return 'api';
  if (value === 'subscription') return 'subscription';
  return undefined;
}

function now(): string {
  return new Date().toISOString();
}

/** Producer-side migration for legacy display-only GO/NO-GO contracts. */
function ensureStructuredGoNogo(goNogo: GoNoGoCriteria): GoNoGoCriteria {
  if (goNogo.items?.length) return goNogo;
  const items = [
    ...(goNogo.goCriteria.trim() ? [createGoNoGoCriterionItem({
      polarity: 'go',
      statement: goNogo.goCriteria,
      evidenceRequirements: [goNogo.goCriteria],
    })] : []),
    ...(goNogo.noGoCriteria.trim() ? [createGoNoGoCriterionItem({
      polarity: 'no-go',
      statement: goNogo.noGoCriteria,
      evidenceRequirements: [goNogo.noGoCriteria],
    })] : []),
  ];
  return { ...goNogo, items };
}

/**
 * Create a new Task object from the given parameters and sequence number.
 * Generates a unique task ID from the sprint ID and sequence (e.g., "037-001").
 * @param params - Task creation parameters including title, scope, model, etc.
 * @param sequence - Sequence number within the sprint, used for ID generation
 * @returns A fully constructed Task object with status and timestamps
 */
export function createTask(params: CreateTaskParams, sequence: number): Task & { smoke?: { command: string; expect: string } } {
  const sprintNumber = params.sprintId.replace('sprint-', '');
  const id = `${sprintNumber}-${String(sequence).padStart(3, '0')}`;

  const authoredModel = params.forceModel ?? params.model;
  if (authoredModel) {
    resolveCanonicalModelIdentity(authoredModel, {
      ...(params.provider ? { provider: params.provider } : {}),
      registerParametric: true,
    });
  }

  const provider = params.provider;

  // Sprint 196 WP-3: Derive test scope for audit trail (scopeDerivation).
  // Actual scope.filesWrite enrichment happens in enrichScopeWithTestFiles at parse-time.
  const scopeDerived = deriveTestScope(params.scope.filesWrite ?? []);
  const scopeDerivation = scopeDerived.extraFiles.length > 0
    ? { extraFiles: scopeDerived.extraFiles, extraDirs: scopeDerived.extraDirs, reason: 'test-mirror' as const }
    : undefined;

  // WM-2b: derive canonical TaskKind from scope-shape so new tasks carry task.type
  // (canonical SSOT). detectTaskType uses scope only — a minimal scope-only object suffices.
  const canonicalKind = rubricTypeToKind(detectTaskType({ scope: params.scope } as Task));

  // Sprint 260 BOUNDARY-TEST-PATTERN: auto-add mirrored tests/ dirs for code-development tasks
  // so workers adding a test alongside their fix stay in-scope without a BOUNDARY_VIOLATION.
  const normalizedScope = mirrorTestScope(params.scope, canonicalKind);
  const productionWiringApplicability = deriveProductionWiringApplicability(normalizedScope);
  const productionWiring = validateProductionWiringAuthority(
    params.title,
    params.productionWiring,
    normalizedScope,
  );
  const verificationCommands = [...new Set((params.verificationCommands ?? [])
    .map(command => command.replace(/\r\n?/g, '\n').trim())
    .filter(Boolean))];

  return {
    id,
    title: params.title,
    description: params.description,
    model: params.model,
    effort: params.effort,
    priority: params.priority,
    reason: params.reason,
    scope: normalizedScope,
    dependencies: params.dependencies,
    goNogo: ensureStructuredGoNogo(params.goNogo),
    verification: verificationCommands.length > 0
      ? { version: 1, source: 'directive', commands: verificationCommands }
      : undefined,
    status: params.initialStatus ?? TaskStatus.PENDING,
    type: canonicalKind,
    sprintId: params.sprintId,
    isPriorityFix: params.isPriorityFix,
    fixForTaskId: params.fixForTaskId,
    provider,
    forceModel: params.forceModel,
    forceEffort: params.forceEffort,
    forceAgent: params.forceAgent,
    forceSkills: params.forceSkills,
    excludeAgent: params.excludeAgent,
    excludeSkills: params.excludeSkills,
    authMode: params.authMode,
    backend: params.backend,
    modelEffort: params.modelEffort,
    fixMode: params.fixMode,
    assignedAgent: params.forceAgent ?? 'generic',
    assignedSkills: params.forceSkills ?? [],
    createdAt: now(),
    routingMeta: scopeDerivation !== undefined ? { scopeDerivation } : undefined,
    smoke: params.smoke,
    productionWiring,
    productionWiringApplicability,
    postSettlementProjection: params.postSettlementProjection,
  };
}

// ─── Bug Y2: Plan-time Ground-Truth Claim Validation (Sprint 166) ─────
//
// Catches stale numeric claims in directive task descriptions (e.g. "16 agents")
// before they ever reach the worker prompt. Mirrors the runtime check in
// auditor.ts:verifyDocSyncGroundTruth — same regex, same override file.

export interface GroundTruthClaimIssue {
  metric: string;
  claimed: number;
  measured: number;
  raw: string;
}

interface GroundTruthOverrideEntry {
  metric: string;
  expected: number;
  approvedBy: string;
  until_sprint: number;
  reason: string;
}

const AGENTS_CLAIM_RE = /\b(\d{1,3})\s+(?:built-?in\s+)?agents?\b/gi;

function measureAgentsCountFs(projectRoot: string): number {
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

function loadGroundTruthOverridesFs(projectRoot: string): GroundTruthOverrideEntry[] {
  const path = join(projectRoot, '.deckent', 'ground-truth-overrides.json');
  if (!existsSync(path)) return [];
  try {
    const raw = readFileSync(path, 'utf-8');
    const parsed = JSON.parse(raw) as { overrides?: GroundTruthOverrideEntry[] };
    if (!parsed?.overrides || !Array.isArray(parsed.overrides)) return [];
    return parsed.overrides;
  } catch {
    return [];
  }
}

function sprintNumberOf(sprintId: string | undefined | null): number {
  if (!sprintId) return Number.NaN;
  const m = /sprint-(\d+)/i.exec(sprintId);
  if (!m || !m[1]) return Number.NaN;
  return Number.parseInt(m[1], 10);
}

/**
 * Validate doc-sync ground-truth claims in a directive task description at plan-time.
 * Returns the list of mismatches (empty when all claims agree with filesystem
 * reality or are covered by an active whitelist override).
 */
export function validateGroundTruthClaims(
  projectRoot: string,
  description: string,
  currentSprintId: string,
): GroundTruthClaimIssue[] {
  if (!description) return [];
  const agentsMeasured = measureAgentsCountFs(projectRoot);
  if (agentsMeasured < 0) return [];
  const overrides = loadGroundTruthOverridesFs(projectRoot);
  const currentSprint = sprintNumberOf(currentSprintId);

  const issues: GroundTruthClaimIssue[] = [];
  let m: RegExpExecArray | null;
  AGENTS_CLAIM_RE.lastIndex = 0;
  while ((m = AGENTS_CLAIM_RE.exec(description)) !== null) {
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
      metric: 'agents_count',
      claimed,
      measured: agentsMeasured,
      raw: m[0],
    });
  }
  return issues;
}

// ─── Sprint 168 C0c RC1 — Scope filesWrite Validation ──────────────
//
// Sprint 167 cascade root layer (Bug Z2): DIRECTIVES "Files:" parser accepted
// bare extension tokens like ".ts", ".md" as scope.filesWrite entries — these
// match no real path and poison downstream spawn-time lock acquisition, scope
// enforcement, and worker auditing.
//
// Plan-time validator: reject bare tokens + basename-only paths. Callers may
// either throw on invalid OR consume sanitized[] to drop poisoned entries.

const BARE_TOKEN_BLOCKLIST = ['.ts', '.md', '.test', 'test.ts', '.json', '.txt'] as const;

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  sanitized: string[];
}

/**
 * Sprint 168 C0c RC1 — validate scope.filesWrite entries for bare tokens.
 *
 * Rules:
 *   1. Reject entries in BARE_TOKEN_BLOCKLIST exactly (".ts", ".md", etc.)
 *   2. Reject entries without a path separator ('/' or '\\')
 *      — basename-only paths (e.g. "foo.ts", "README.md") are ambiguous and
 *        bypass scope enforcement.
 *   3. Valid entries pass through into `sanitized`.
 *
 * @param filesWrite Array of file path strings from parsed DIRECTIVES.md
 * @returns ValidationResult — { valid, errors, sanitized }
 */
export function validateScopeFilesWrite(filesWrite: string[]): ValidationResult {
  const errors: string[] = [];
  const sanitized: string[] = [];
  for (const fp of filesWrite) {
    if ((BARE_TOKEN_BLOCKLIST as readonly string[]).includes(fp)) {
      errors.push(`Bare token detected: ${fp}`);
      continue;
    }
    if (!fp.includes('/') && !fp.includes('\\')) {
      errors.push(`Basename without path: ${fp}`);
      continue;
    }
    sanitized.push(fp);
  }
  return { valid: errors.length === 0, errors, sanitized };
}

/**
 * row 3312 (a)/(b)/(e) — is this BARE token merely the tail of a longer path that
 * is already present on the same directive line (or among the entries extracted
 * from it)?
 *
 * The loose scavenger regexes below match on word boundaries, so a longer path
 * donates its own tail as a second, unqualified "file": `README.tr.md` → `tr.md`,
 * `tests/PLATFORM.md` → `PLATFORM.md`, `tests\orchestra\x.test.ts` → `x.test.ts`.
 * The phantom is not a file anyone granted — the sanitizer drops it and the
 * prompt-gate reads that drop as a write-authority shrink BLOCK (or, when
 * `hasMultiDotBasename` preserves it, a root-level test file that vitest's
 * `tests/**` include cannot discover → a test-discoverability BLOCK).
 *
 * Boundary characters are the two path separators and `.` (the multi-dot basename
 * case). Only SCAVENGED tokens are suppressed: an entry the operator wrote on a
 * `Files:`/`Scope:` label is pushed before these passes run and is never removed
 * here, so suppressing a tail can never shrink a granted authority.
 */
function isPhantomTailToken(token: string, line: string, extracted: readonly string[]): boolean {
  // A qualified scanner can still donate a shorter qualified tail. The live
  // sprint-661 preflight case was `tests/docs/layer-shims.test.ts` donating
  // `docs/layer-shims.test.ts` through the docs-file regex. Treat that exactly
  // like the existing bare-basename phantoms, while preserving an explicitly
  // authored `docs/...` token (there is no leading separator before it).
  for (const separator of ['/', '\\']) {
    const suffix = separator + token;
    if (line.includes(suffix)) return true;
    if (extracted.some(entry => entry !== token && entry.endsWith(suffix))) return true;
  }
  if (token.includes('/') || token.includes('\\')) return false;
  for (const boundary of ['/', '\\', '.']) {
    const suffix = boundary + token;
    if (line.includes(suffix)) return true;
    if (extracted.some(entry => entry !== token && entry.endsWith(suffix))) return true;
  }
  return false;
}

/**
 * Extract a TaskScope from a directive line by matching directory and file path patterns.
 * Matches directories like src/..., tests/... and files ending in .ts or .js.
 * @param line - A single line from a directive document
 * @returns Extracted scope with directories and filesWrite populated
 */
export function extractScopeFromDirective(line: string): TaskScope {
  const directories: string[] = [];
  const filesRead: string[] = [];
  const filesWrite: string[] = [];

  // 671-review fix: a line carrying MORE THAN ONE scope label (e.g.
  // `Files: a.test.ts, Reads: src/x.ts`) used to hit the Reads early-return
  // below and silently DROP the write grant. Split at each label boundary and
  // parse every segment independently; single-label lines take the exact
  // pre-existing path byte-for-byte.
  const scopeLabels = line.match(/\b(?:Files?|Dosya|Reads?|Oku|Okuma|Scope|Kapsam)\s*:/giu) ?? [];
  if (scopeLabels.length > 1) {
    const merged: TaskScope = { directories: [], filesRead: [], filesWrite: [] };
    const segments = line
      .split(/(?=\b(?:Files?|Dosya|Reads?|Oku|Okuma|Scope|Kapsam)\s*:)/iu)
      .map(segment => segment.replace(/[,\s]+$/u, ''))
      .filter(segment => segment.trim().length > 0);
    for (const segment of segments) {
      const part = extractScopeFromDirective(segment);
      for (const d of part.directories) if (!merged.directories.includes(d)) merged.directories.push(d);
      for (const f of part.filesRead) if (!merged.filesRead.includes(f)) merged.filesRead.push(f);
      for (const f of part.filesWrite) if (!merged.filesWrite.includes(f)) merged.filesWrite.push(f);
    }
    return merged;
  }

  // Structured DIRECTIVES previously had no way to express read-only
  // authority: every explicit path was parsed through Files:/Scope: and
  // therefore became writable. `Reads:` is a disjoint exact-file channel.
  // Return immediately after parsing so the legacy path scavenger below can
  // never reclassify a read grant as filesWrite.
  const readsLabelMatch = line.match(/(?:^|\n)\s*-?\s*(?:Reads?|Oku|Okuma)\s*:\s*(.+)/im);
  if (readsLabelMatch?.[1]) {
    for (const raw of readsLabelMatch[1].split(',')) {
      const path = raw.trim();
      if (path && !filesRead.includes(path)) filesRead.push(path);
    }
    return { directories, filesRead, filesWrite };
  }

  // BUG-25: Explicit Files:/Dosya: and Scope:/Kapsam: label parsing (highest priority)
  const filesLabelMatch = line.match(/(?:^|\n)\s*-?\s*(?:Files?|Dosya)\s*:\s*(.+)/im);
  if (filesLabelMatch?.[1]) {
    const files = filesLabelMatch[1].split(',').map(f => f.trim()).filter(Boolean);
    for (const f of files) {
      if (f.endsWith('/')) {
        if (!directories.includes(f)) directories.push(f);
      } else {
        if (!filesWrite.includes(f)) filesWrite.push(f);
      }
    }
  }

  const scopeLabelMatch = line.match(/(?:^|\n)\s*-?\s*(?:Scope|Kapsam)\s*:\s*(.+)/im);
  if (scopeLabelMatch?.[1]) {
    const scopes = scopeLabelMatch[1].split(',').map(s => s.trim()).filter(Boolean);
    for (const s of scopes) {
      // row 3312 (c): appending a slash to EVERY entry turned granted FILES into
      // phantom directories (`README.md/`, `Dockerfile/` were both observed in
      // real task JSON) and left the file itself with no write authority at all.
      // `isFileScopeToken` is the reader-side mirror of the writer's
      // `normalizeScopeDir` file-vs-directory fix.
      if (isFileScopeToken(s)) {
        if (!filesWrite.includes(s)) filesWrite.push(s);
        continue;
      }
      const dir = s.endsWith('/') ? s : s + '/';
      // './' means project root — valid scope
      if (!directories.includes(dir)) directories.push(dir);
    }
  }

  // Match directory-like paths: src/, tests/, docs/, .deckent/, .brain/, .contracts/, .claude/, scripts/
  const dirMatches = line.match(/\b(src\/[\w/.-]*|tests\/[\w/.-]*|docs\/[\w/.-]*|\.deckent\/[\w/.-]*|\.brain\/[\w/.-]*|\.contracts\/[\w/.-]*|\.claude\/[\w/.-]*|scripts\/[\w/.-]*)\//g);
  if (dirMatches) {
    for (const d of dirMatches) {
      if (!directories.includes(d)) directories.push(d);
    }
  }

  // Match docs/ files (.md, .ts, .js) and standalone root-level .md files (README.md, DECKENT.md)
  const docFileMatches = line.match(/\b(docs\/[\w/.-]+\.(?:md|ts|js)|(?:[\w-]+)\.md)\b/g);
  if (docFileMatches) {
    for (const f of docFileMatches) {
      // U4-gate fix (sprint-443 plan): a bare .md basename that is merely the tail
      // of a longer slash-qualified path on the same line (".../agents/x/PROMPT.md"
      // also matching "PROMPT.md") is NOT a root-level file — skipping it keeps the
      // unqualified duplicate out of filesWrite (scope-sanitizer would drop it and
      // prompt-gate reads that drop as a write-authority shrink BLOCK).
      // row 3312 (a): the `.` boundary belongs to the same class — `README.tr.md`
      // donates the phantom `tr.md`, which the `/`-only guard never caught.
      if (isPhantomTailToken(f, line, filesWrite)) {
        continue;
      }
      // Only add docs/ directory when the file is actually inside docs/
      // Standalone .md files (DECKENT.md, CONTRIBUTING.md) should NOT trigger docs/ directory
      if (f.startsWith('docs/') && !directories.some(d => d.startsWith('docs/'))) {
        directories.push('docs/');
      }
      if (!filesWrite.includes(f)) filesWrite.push(f);
    }
  }

  // Match dotfile paths: .deckent/..., .brain/..., .contracts/...
  const dotFileMatches = line.match(/\b(\.deckent\/[\w/.-]+\.(?:json|md|ts|js)|\.brain\/[\w/.-]+\.(?:json|md)|\.contracts\/[\w/.-]+\.(?:md|json)|\.claude\/[\w/.-]+\.(?:json|md))\b/g);
  if (dotFileMatches) {
    for (const f of dotFileMatches) {
      if (!filesWrite.includes(f)) filesWrite.push(f);
    }
  }

  // Match root-level config files: tsconfig.json, package.json, vitest.config.ts, etc.
  const rootConfigMatches = line.match(/\b(tsconfig\.json|package\.json|vitest\.config\.ts)\b/g);
  if (rootConfigMatches) {
    for (const f of rootConfigMatches) {
      if (!filesWrite.includes(f)) filesWrite.push(f);
    }
  }

  // Match standalone dotfiles at root: .gitignore, .npmignore, .env, .npmrc, etc.
  // \b cannot precede a leading dot, so use negative lookbehind instead.
  // Negative lookahead includes / to avoid matching directory prefixes (.deckent/, .brain/).
  const rootDotfileMatches = line.match(/(?<![/\w])(\.[\w-]+)(?![/\w])/g);
  if (rootDotfileMatches) {
    for (const f of rootDotfileMatches) {
      if (!filesWrite.includes(f)) filesWrite.push(f);
    }
  }

  // Match file paths: anything ending in .ts or .js
  const fileMatches = line.match(/\b[\w/.-]+\.(?:ts|js)\b/g);
  if (fileMatches) {
    for (const f of fileMatches) {
      // row 3312 (e): the char class has no `\`, so a backslash-qualified path
      // (`tests\orchestra\x.test.ts`) matches only its tail — a bare `x.test.ts`
      // that `hasMultiDotBasename` then preserves as a ROOT-level test file, which
      // vitest's `tests/**` include cannot discover → false test-discoverability
      // BLOCK. The Scope/Files label already carries the qualified path.
      if (isPhantomTailToken(f, line, filesWrite)) continue;
      if (!filesWrite.includes(f)) filesWrite.push(f);
    }
  }

  // Match standalone root-level files (no directory prefix): DECKENT.md, docker-compose.yml, tsconfig.yaml, etc.
  // Covers yaml/yml and other file types not matched by the blocks above.
  const standaloneMatches = line.match(/\b([\w.-]+\.(?:md|json|ts|js|yaml|yml))\b/g);
  if (standaloneMatches) {
    for (const f of standaloneMatches) {
      // Skip if already present or if a directory-prefixed version exists in filesWrite
      const alreadyCovered = filesWrite.some(existing => existing === f || existing.endsWith('/' + f));
      // row 3312 (b): this pass had no LINE-level tail guard, so on a `Scope:` line
      // — where the qualified path used to land in `directories`, never in
      // filesWrite — `tests/PLATFORM.md` and `scripts/spawnsync-baseline.json`
      // were emitted as bare tails and then dropped by the sanitizer.
      if (!alreadyCovered && !isPhantomTailToken(f, line, filesWrite)) filesWrite.push(f);
    }
  }

  // Sprint 168 C0c RC1 — drop bare extension tokens (".ts", ".md", etc.) that
  // slipped through the catch-all regex above. Basename-only entries are NOT
  // dropped here (back-compat: DECKENT.md / README.md still extracted).
  const sanitizedFilesWrite = filesWrite.filter(
    f => !(BARE_TOKEN_BLOCKLIST as readonly string[]).includes(f),
  );

  return { directories, filesRead, filesWrite: sanitizedFilesWrite };
}

/**
 * Auto-add mirrored tests/ directories for code-development tasks.
 * Prevents false BOUNDARY_VIOLATION when workers naturally add a test alongside their fix.
 * Only widens scope.directories — backward-safe for audit/doc tasks.
 */
export function mirrorTestScope(scope: TaskScope, kind: string): TaskScope {
  if (kind !== 'code-development') return scope;
  const extraDirs: string[] = [];
  for (const dir of scope.directories) {
    if (dir.startsWith('src/')) {
      const mirrored = 'tests/' + dir.slice('src/'.length);
      if (!scope.directories.includes(mirrored) && !extraDirs.includes(mirrored)) {
        extraDirs.push(mirrored);
      }
    }
  }
  if (extraDirs.length === 0) return scope;
  return { ...scope, directories: [...scope.directories, ...extraDirs] };
}

/**
 * Enrich a task scope by adding test file patterns to filesWrite
 * when tests/ is present in directories but no test files are in filesWrite.
 * Also ensures docs/ directory is included when doc files are in filesWrite.
 */
export function enrichScopeWithTestFiles(scope: TaskScope, filesWriteSource: string[]): TaskScope {
  const directories = [...scope.directories];
  const filesWrite = [...scope.filesWrite];

  // A) If tests/ is in directories but no test files in filesWrite, add test patterns
  const hasTestDir = directories.some(d => d.startsWith('tests/'));
  const hasTestFiles = filesWrite.some(f => f.startsWith('tests/') || f.includes('.test.'));
  if (hasTestDir && !hasTestFiles) {
    // Derive test file patterns from source filesWrite entries
    for (const f of filesWriteSource) {
      if (f.startsWith('src/') && f.endsWith('.ts')) {
        const testPath = f.replace(/^src\//, 'tests/').replace(/\.ts$/, '.test.ts');
        if (!filesWrite.includes(testPath)) filesWrite.push(testPath);
      }
    }
  }

  return { directories, filesRead: scope.filesRead, filesWrite };
}

/**
 * Mask fenced code blocks (```...```) in markdown content to prevent
 * code examples from being parsed as real file paths.
 * Replaces code block content with empty lines to preserve line structure.
 */
export function maskCodeBlocks(content: string): string {
  return content.replace(/```[\s\S]*?```/g, (match) => {
    // Replace content with same number of newlines to preserve line count
    const newlineCount = (match.match(/\n/g) ?? []).length;
    return '\n'.repeat(newlineCount);
  });
}

/**
 * born-629 — Split one directive line into `{key, value}` segments.
 *
 * DIRECTIVES.md task headers combine multiple single-value directives on one
 * line, pipe-joined (e.g. `- Model: sonnet | Agent: bug-fixer`). The previous
 * per-directive extraction anchored a regex at the START of the whole line
 * (`^[\s-]*Model:\s*`) and captured everything up to the end of the line as
 * the value — so on a combined line, `Model`'s captured value included the
 * trailing `| Agent: ...` text (corrupting it into an unrecognized model id),
 * and `Agent` was never found at all (the line doesn't start with `Agent:`).
 *
 * Splitting on `|` first and anchoring each piece independently fixes both:
 * a line with no `|` behaves byte-identically to the old single-anchor match
 * (one segment, same value), while a combined line yields one segment per
 * pipe-joined directive.
 */
export function splitDirectiveLineSegments(line: string): Array<{ key: string; value: string }> {
  const stripped = line.trim().replace(/^[-*]\s*/, '');
  if (!stripped) return [];
  const segments: Array<{ key: string; value: string }> = [];
  for (const part of stripped.split('|')) {
    const m = /^([A-Za-z][\w]*)\s*:\s*(.*)$/.exec(part.trim());
    if (m) segments.push({ key: m[1]!.toLowerCase(), value: m[2]!.trim() });
  }
  return segments;
}

/**
 * born-629 — First value for `key` across every line of a directive block.
 * First occurrence wins (mirrors the previous `lines.find(...)` semantics).
 * Understands both one-directive-per-line and pipe-combined directive lines
 * via `splitDirectiveLineSegments`.
 */
export function findDirectiveValue(lines: readonly string[], key: string): string | undefined {
  const target = key.toLowerCase();
  for (const line of lines) {
    const hit = splitDirectiveLineSegments(line).find(s => s.key === target);
    if (hit) return hit.value;
  }
  return undefined;
}

/**
 * born-629 — stderr-WARN when a `Model:`/`Agent:` directive was present in the
 * block but its value never became a usable hint on the task (unrecognized
 * model id, empty agent value). Mirrors the born-458 dependency-ref precedent
 * (`resolveTaskDependenciesLoud`): a hint the operator wrote is announced when
 * it cannot be captured, never silently dropped.
 */
function warnUncapturedHint(taskTitle: string, label: string, rawValue: string): void {
  process.stderr.write(
    `[deckent] WARN: directive hint '${label}: ${rawValue}' (task "${taskTitle}") force${label}'e inmedi — değer tanınmadı/boş, hint düşürüldü.\n`,
  );
}

/**
 * Parse a DIRECTIVES.md document into structured task definitions.
 * Splits on "## Task N:" or "## Gorev N:" headings and extracts title, scope,
 * test targets, and optional Model/Effort overrides from each section.
 * Falls back to bullet/numbered list parsing if no heading-based sections found.
 * @param content - Raw DIRECTIVES.md content
 * @returns Array of parsed directive tasks; empty if no structured sections found
 */
export function parseStructuredDirectives(content: string): ParsedDirectiveTask[] {
  // Mask code blocks to prevent code examples from polluting scope extraction
  const maskedContent = maskCodeBlocks(content);

  // Split on "## Görev N:" / "## Gorev N:" / "## Task N:" pattern
  const blockSplit = content.split(/^##\s+(?:G[öo]rev|Task)\s+\d+[^:]*:/m);
  const maskedBlockSplit = maskedContent.split(/^##\s+(?:G[öo]rev|Task)\s+\d+[^:]*:/m);
  const blocks = blockSplit.slice(1); // skip content before first heading
  const maskedBlocks = maskedBlockSplit.slice(1);

  if (blocks.length === 0) {
    // Fallback: try bullet list or numbered list format
    return parseBulletOrNumberedTasks(content);
  }

  const tasks: ParsedDirectiveTask[] = [];
  for (let blockIdx = 0; blockIdx < blocks.length; blockIdx++) {
    const block = blocks[blockIdx]!;
    const maskedBlock = maskedBlocks[blockIdx] ?? block;
    const lines = block.trim().split('\n');
    const maskedLines = maskedBlock.trim().split('\n');
    // First non-empty line after heading becomes the title (strip leading "- " prefix)
    const titleLine = lines.find(l => l.trim()) ?? '';
    const title = titleLine.trim().replace(/^-\s+/, '');
    if (!title) continue;

    // Collect only explicit scope directive lines. Prose may mention paths for
    // context, but write scope must come from Files:/Scope: directives.
    // Use maskedLines for filtering to avoid code block false positives
    // but use original lines for actual scope extraction (labels are outside code blocks)
    const scopeLines: string[] = [];
    for (let li = 0; li < lines.length; li++) {
      const l = lines[li]!;
      const ml = maskedLines[li] ?? l;
      // Skip the title line — it may contain code snippets that look like paths
      if (l === titleLine) continue;
      // Use masked line for directive detection to skip code block content.
      if (/^\s*-?\s*(?:Dosya|Files?|Reads?|Oku|Okuma|Kapsam|Scope)\s*:/i.test(ml)) { scopeLines.push(l); continue; }
    }
    const scope = scopeLines.reduce<TaskScope>((acc, scopeLine) => {
      const extracted = extractScopeFromDirective(scopeLine);
      return {
        directories: [...acc.directories, ...extracted.directories.filter(d => !acc.directories.includes(d))],
        filesRead: [...acc.filesRead, ...extracted.filesRead.filter(f => !acc.filesRead.includes(f))],
        filesWrite: [...acc.filesWrite, ...extracted.filesWrite.filter(f => !acc.filesWrite.includes(f))],
      };
    }, { directories: [], filesRead: [], filesWrite: [] });

    // Extract test target from "- Test: ..." lines
    const testLine = lines.find(l => /^[\s-]*Test:/i.test(l.trim()));
    const testTarget = testLine
      ? testLine.trim().replace(/^-\s+/, '').replace(/^Test:\s*/i, '').trim()
      : undefined;

    // Extract optional Provider: override (e.g., "Provider: codex", "Provider: ollama").
    // Provider parse runs before Model so an exact, previously unseen API model ID
    // can be registered parametrically against an explicit provider.
    // born-629: findDirectiveValue understands both one-per-line ("- Provider: X")
    // and pipe-combined ("- Model: X | Agent: Y") directive lines — the previous
    // whole-line-anchored `.find` silently dropped every directive after the
    // first '|' on a combined line.
    const rawProvider = findDirectiveValue(lines, 'provider')?.toLowerCase();
    // VALID_PROVIDERS_ALL is the canonical extended source (includes 'ollama' alongside claude/codex/gemini).
    const parsedProvider = (rawProvider && VALID_PROVIDERS_ALL.includes(rawProvider) ? rawProvider : undefined) as ProviderName | undefined;

    // Extract optional Model: override as an exact API ID. Known IDs must match
    // their provider; unknown IDs require an explicit provider and are registered
    // parametrically. Legacy aliases and unverifiable identities fail loudly.
    const forceModel = findDirectiveValue(lines, 'model')?.trim();
    const parsedForceModel = forceModel
      ? resolveCanonicalModelIdentity(forceModel, {
          ...(parsedProvider ? { provider: parsedProvider } : {}),
          registerParametric: false,
        }).id as ModelType
      : undefined;

    // Extract optional Effort: override (e.g., "Effort: max")
    const forceEffort = findDirectiveValue(lines, 'effort')?.toLowerCase();
    const validEfforts: string[] = ['low', 'normal', 'high'];
    // safe: validEfforts.includes() confirms the string is a valid TaskEffort before assignment
    const parsedForceEffort = (forceEffort && validEfforts.includes(forceEffort) ? forceEffort : undefined) as TaskEffort | undefined;

    // Extract optional Agent: override (e.g., "Agent: security-auditor" or "Agent: none")
    const rawAgentSeg = findDirectiveValue(lines, 'agent');
    const rawAgent = rawAgentSeg?.trim() || undefined;
    const forceAgent = rawAgent
      ? (rawAgent.toLowerCase() === 'none' ? 'generic' : rawAgent.toLowerCase() === 'auto' ? undefined : rawAgent)
      : undefined;
    // Agent: label was present but its value was never usable (empty after trim).
    // 'none'→'generic' and 'auto'→undefined are deliberate mappings, not losses —
    // both leave `rawAgent` defined, so they never trip this WARN.
    if (rawAgentSeg !== undefined && rawAgent === undefined) warnUncapturedHint(title, 'Agent', rawAgentSeg);

    // Extract optional Skills: override (e.g., "Skills: typescript-expert, -ci-testing")
    const skillsLine = lines.find(l => /^[\s-]*Skills:\s*/i.test(l.trim()));
    const { forceSkills, excludeSkills } = parseSkillsDirective(skillsLine);

    // Extract optional Dependencies: line (e.g., "- Dependencies: 134-005, 134-007")
    const depsLine = lines.find(l => /^[\s-]*Dependencies:\s*/i.test(l.trim()));
    const dependencies = parseDependenciesDirective(depsLine);

    // Extract optional Priority: line (e.g., "- Priority: CRITICAL")
    const priorityLine = lines.find(l => /^[\s-]*Priority:\s*/i.test(l.trim()));
    const parsedPriority = parsePriorityDirective(priorityLine);

    // Extract optional Auth: line (e.g., "- Auth: api")
    const authLine = lines.find(l => /^[\s-]*Auth:\s*/i.test(l.trim()));
    const parsedAuthMode = parseAuthModeDirective(authLine);

    // Sprint 252 (PSL-1 verify): optional Backend: line (e.g., "- Backend: docker")
    const backendLine = lines.find(l => /^[\s-]*Backend:\s*/i.test(l.trim()));
    const backendVal = backendLine
      ?.trim().replace(/^-\s+/, '').replace(/^Backend:\s*/i, '').trim().toLowerCase();
    const parsedBackend: 'docker' | 'tmux' | 'subprocess' | undefined =
      backendVal === 'docker' || backendVal === 'tmux' || backendVal === 'subprocess'
        ? backendVal
        : undefined;

    // Sprint 252 (F1-RE): optional ModelEffort: line (e.g., "- ModelEffort: high").
    // Validated per-provider later (resolveReasoningEffort); parsed verbatim here.
    const modelEffortLine = lines.find(l => /^[\s-]*ModelEffort:\s*/i.test(l.trim()));
    const parsedModelEffort = modelEffortLine
      ? modelEffortLine.trim().replace(/^-\s+/, '').replace(/^ModelEffort:\s*/i, '').trim().toLowerCase() || undefined
      : undefined;

    // Sprint 182 PQ-4 (F6): description = content after `### Description` heading
    // when present. Falls back to the full block when no heading is found, so
    // legacy DIRECTIVES.md files keep their old description=block behavior.
    const descHeadingIdx = lines.findIndex(l => /^\s*###\s+Description\b/i.test(l));
    // U1-G2: capture the structured `- Meta:` line (key=value; '\;'-escaped) BEFORE
    // stripping it out of the description flow — round-trip keeps metadata as data.
    let parsedMeta: Record<string, string> | undefined;
    const metaLine = lines.find(l => /^\s*-\s*Meta:\s/i.test(l));
    if (metaLine) {
      parsedMeta = {};
      const body = metaLine.replace(/^\s*-\s*Meta:\s*/i, '');
      for (const pair of splitEscapedPairs(body)) {
        const eq = pair.indexOf('=');
        if (eq > 0) parsedMeta[pair.slice(0, eq).trim()] = pair.slice(eq + 1).trim();
      }
      if (Object.keys(parsedMeta).length === 0) parsedMeta = undefined;
    }
    const rawDescription = descHeadingIdx >= 0
      ? lines.slice(descHeadingIdx + 1).join('\n').trim()
      : block.trim();
    // U1-G2 (PCOMP-8): metadata is NEVER content. Strip (a) the structured
    // `- Meta:` line (new writer) and (b) the legacy embedded traceability
    // sentence ("RunProposal metadata — flowId=…") from description — a flowId
    // hex inside desc once matched the 'cd' devops keyword and misrouted an
    // entire sprint (A1-İz#2, sprint-442).
    const description = rawDescription
      .split('\n')
      .filter(l => !/^\s*-\s*Meta:\s/i.test(l) && !/^\s*RunProposal metadata\s+—/.test(l.trim()))
      .join('\n')
      .trim();

    const enrichedScope = enrichScopeWithTestFiles(scope, scope.filesWrite);
    // 519-004: source verification and built-binary proof are separate authority
    // stages. A Smoke that needs the built binary belongs on postSettlementProjection,
    // never on an in-sprint criterion a sprint can't possibly satisfy. Advisory here
    // (warn + emit, obligations as authored) until the two fixtures that still encode
    // the in-sprint dist/ shape are restaged — see ProofStagingOptions.enforce.
    const proofStaging = stageDirectiveProofObligations(block, enrichedScope, title);
    const productionWiring = parseProductionWiringDirective(lines, title);
    tasks.push({ title, description, meta: parsedMeta, scope: enrichedScope, testTarget, provider: parsedProvider, forceModel: parsedForceModel, forceEffort: parsedForceEffort, forceAgent, forceSkills, excludeSkills, dependencies, priority: parsedPriority, authMode: parsedAuthMode, backend: parsedBackend, modelEffort: parsedModelEffort, smoke: proofStaging.smoke, postSettlementProjection: proofStaging.postSettlementProjection, productionWiring, productionWiringApplicability: deriveProductionWiringApplicability(enrichedScope) });
  }
  return tasks;
}

/**
 * Parse bullet list or numbered list task format as fallback.
 * Supports formats:
 *   - "- Task: My task title"
 *   - "* Task: My task title"
 *   - "1. My task title"
 *   - "1) My task title"
 * Extracts Model/Effort/Provider overrides from indented sub-lines.
 * @param content - Raw directive content
 * @returns Array of parsed directive tasks
 */
export function parseBulletOrNumberedTasks(content: string): ParsedDirectiveTask[] {
  const tasks: ParsedDirectiveTask[] = [];
  const maskedContent = maskCodeBlocks(content);
  const lines = content.split('\n');
  const maskedLines = maskedContent.split('\n');

  // Match "- Task: <title>", "* Task: <title>", "1. <title>", or "1) <title>"
  const taskLineRegex = /^(?:[-*]\s+Task:\s*|[-*]\s+\d+[.)]\s*|\d+[.)]\s+)(.+)/;

  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    const match = taskLineRegex.exec(line);
    if (match) {
      const title = match[1]!.trim();
      if (title.length >= 3) {
        // Collect indented sub-lines for model/effort/scope hints
        const subLines: string[] = [];
        let j = i + 1;
        while (j < lines.length) {
          const subLine = lines[j]!;
          // Continue collecting if indented or starts with special chars
          if (/^\s+/.test(subLine) || /^[\s]*[-*]\s+(?:Model|Effort|Provider|Scope|Files|Reads?|Oku|Okuma|Test):/.test(subLine)) {
            subLines.push(subLine);
            j++;
          } else {
            break;
          }
        }

        const allLines = [line, ...subLines];
        // Collect masked versions of sub-lines for code block filtering
        const allMaskedLines = [maskedLines[i]!, ...subLines.map((_sl, si) => maskedLines[i + 1 + si] ?? _sl)];

        // Extract scope only from explicit directive lines. Prose may mention paths
        // for context, but write scope must come from Files:/Scope: directives.
        // Use masked lines for detection to skip code block content.
        const scopeLines: string[] = [];
        for (let ali = 0; ali < allLines.length; ali++) {
          const al = allLines[ali]!;
          const aml = allMaskedLines[ali] ?? al;
          if (/^\s*-?\s*(?:Dosya|Files?|Reads?|Oku|Okuma|Kapsam|Scope)\s*:/i.test(aml)) { scopeLines.push(al); continue; }
        }
        const scope = scopeLines.reduce<TaskScope>((acc, scopeLine) => {
          const extracted = extractScopeFromDirective(scopeLine);
          return {
            directories: [...acc.directories, ...extracted.directories.filter(d => !acc.directories.includes(d))],
            filesRead: [...acc.filesRead, ...extracted.filesRead.filter(f => !acc.filesRead.includes(f))],
            filesWrite: [...acc.filesWrite, ...extracted.filesWrite.filter(f => !acc.filesWrite.includes(f))],
          };
        }, { directories: [], filesRead: [], filesWrite: [] });

        // Extract Provider before Model so an exact, previously unseen API model ID
        // can be registered parametrically against an explicit provider.
        // born-629: findDirectiveValue understands pipe-combined directive lines
        // (e.g. "- Model: X | Agent: Y") — the previous greedy `.replace(/.*Key:\s*/i, '')`
        // captured everything to the end of the line, corrupting Model's value with a
        // trailing "| Agent: ..." fragment on a combined line.
        const rawProvider = findDirectiveValue(allLines, 'provider')?.toLowerCase();
        // VALID_PROVIDERS_ALL is the canonical extended source (includes 'ollama').
        const parsedProvider = (rawProvider && VALID_PROVIDERS_ALL.includes(rawProvider) ? rawProvider : undefined) as ProviderName | undefined;

        // Extract Model as an exact API ID; aliases, provider mismatches, and
        // unknown identities without an explicit provider fail loudly.
        const rawModel = findDirectiveValue(allLines, 'model')?.trim();
        const parsedForceModel = rawModel
          ? resolveCanonicalModelIdentity(rawModel, {
              ...(parsedProvider ? { provider: parsedProvider } : {}),
              registerParametric: false,
            }).id as ModelType
          : undefined;

        // Extract Effort override
        const rawEffort = findDirectiveValue(allLines, 'effort')?.toLowerCase();
        const validEfforts = ['low', 'normal', 'high'];
        const parsedForceEffort = (rawEffort && validEfforts.includes(rawEffort) ? rawEffort : undefined) as TaskEffort | undefined;

        // Extract test target
        const testLine = allLines.find(l => /Test:\s*/i.test(l));
        const testTarget = testLine ? testLine.replace(/.*Test:\s*/i, '').trim() : undefined;

        // Extract Agent override
        const rawAgentBulletSeg = findDirectiveValue(allLines, 'agent');
        const rawAgentBullet = rawAgentBulletSeg?.trim() || undefined;
        const forceAgentBullet = rawAgentBullet
          ? (rawAgentBullet.toLowerCase() === 'none' ? 'generic' : rawAgentBullet.toLowerCase() === 'auto' ? undefined : rawAgentBullet)
          : undefined;
        // 'none'/'auto' are deliberate mappings (rawAgentBullet stays defined for both) —
        // only an empty captured value after a found Agent: label is a true loss.
        if (rawAgentBulletSeg !== undefined && rawAgentBullet === undefined) {
          warnUncapturedHint(title, 'Agent', rawAgentBulletSeg);
        }

        // Extract Skills override
        const skillsLineBullet = allLines.find(l => /Skills:\s*/i.test(l));
        const { forceSkills: forceSkillsBullet, excludeSkills: excludeSkillsBullet } = parseSkillsDirective(skillsLineBullet);

        // Extract Dependencies override
        const depsLineBullet = allLines.find(l => /Dependencies:\s*/i.test(l));
        const dependenciesBullet = parseDependenciesDirective(depsLineBullet);

        // Extract Priority override
        const priorityLineBullet = allLines.find(l => /Priority:\s*/i.test(l));
        const parsedPriorityBullet = parsePriorityDirective(priorityLineBullet);

        // Extract Auth override
        const authLineBullet = allLines.find(l => /Auth:\s*/i.test(l));
        const parsedAuthModeBullet = parseAuthModeDirective(authLineBullet);

        const enrichedScope = enrichScopeWithTestFiles(scope, scope.filesWrite);
        const productionWiring = parseProductionWiringDirective(allLines, title);
        tasks.push({
          title,
          description: allLines.join('\n').trim(),
          scope: enrichedScope,
          testTarget,
          provider: parsedProvider,
          forceModel: parsedForceModel,
          forceEffort: parsedForceEffort,
          forceAgent: forceAgentBullet,
          forceSkills: forceSkillsBullet,
          excludeSkills: excludeSkillsBullet,
          dependencies: dependenciesBullet,
          priority: parsedPriorityBullet,
          authMode: parsedAuthModeBullet,
          smoke: extractSmoke(allLines.join('\n')),
          productionWiring,
          productionWiringApplicability: deriveProductionWiringApplicability(enrichedScope),
        });

        i = j;
        continue;
      }
    }
    i++;
  }

  return tasks;
}

/**
 * Convert a PlannerTask (from the AI planner) into CreateTaskParams for task creation.
 * Applies a model override and optional initial status.
 * @param pt - Planner task output from the AI planning step
 * @param sprintId - Current sprint identifier
 * @param modelOverride - Default model to use when planner task has no model
 * @param initialStatus - Optional initial task status (e.g., DRAFT)
 * @returns Parameters suitable for passing to createTask
 */
export function plannerTaskToParams(
  pt: PlannerTask & {
    smoke?: { command: string; expect: string };
  },
  sprintId: string,
  modelOverride: ModelType,
  initialStatus?: TaskStatus,
): CreateTaskParams {
  return {
    title: pt.title,
    description: pt.description,
    model: pt.model ?? modelOverride,
    effort: pt.effort,
    priority: pt.priority,
    reason: pt.reason,
    scope: enrichScopeWithTestFiles(pt.scope, pt.scope.filesWrite),
    dependencies: pt.dependencies,
    goNogo: pt.goNogo,
    sprintId,
    initialStatus,
    forceModel: pt.forceModel,
    forceAgent: pt.forceAgent,
    forceSkills: pt.forceSkills,
    excludeAgent: pt.excludeAgent,
    excludeSkills: pt.excludeSkills,
    smoke: pt.smoke,
    productionWiring: pt.productionWiring,
  };
}

/**
 * Determine the worker effort level for a task based on its complexity score.
 * If the task has a forceEffort override, returns that directly.
 * Otherwise maps score ranges: >=6 -> max, >=1 -> high, >=-1 -> medium, else low.
 * @param task - The task to evaluate
 * @returns Effort level string for the worker prompt
 */
export function resolveWorkerEffort(task: Task): 'max' | 'high' | 'medium' | 'low' {
  // Map work-size effort (TaskEffort 'low'|'normal'|'high') → the 4-level
  // worker-prompt scale. Sprint 252 (F1-RE audit): `'normal'` has NO 1:1 member
  // in {max,high,medium,low} — the old `as` cast leaked an invalid `'normal'`.
  // Map it to `'medium'`. (This is the work-size→prompt scale, NOT the model
  // reasoning-effort axis — see resolveReasoningEffort.)
  if (task.forceEffort) {
    return task.forceEffort === 'high' ? 'high' : task.forceEffort === 'low' ? 'low' : 'medium';
  }
  const score = calculateModelScore(task.title, task.description, task.scope);
  if (score >= 6) return 'max';
  if (score >= 1) return 'high';
  if (score >= -1) return 'medium';
  return 'low';
}

function workerMemoryScope(task: Task, projectRoot: string): MemoryReadScopeV1 {
  const projectId = attendedExecutionProjectId(projectRoot);
  return task.actor?.tenantId
    ? { kind: 'tenant', tenantId: task.actor.tenantId, projectId }
    : { kind: 'local-project', projectId };
}

function renderNonAdrMemory(
  view: Exclude<MemoryReadViewV1, { state: 'HOLD' }>,
  language: string,
): string {
  if (view.state === 'ABSENT') return '';
  const filtered = Object.freeze({
    ...view,
    entries: Object.freeze(view.entries.filter(({ entry }) => entry.type !== 'adr')),
    deferred: Object.freeze(view.deferred.filter(({ candidate }) => candidate.type !== 'adr')),
  });
  return renderMemoryReadView(filtered, buildMemoryReadLabels(getMessage, language));
}

function readWorkerMemoryContext(
  task: Task,
  projectRoot: string,
  effectiveConfig?: Pick<ResolvedConfig, 'memory_read' | 'memory_read_profiles' | 'language'>,
): {
  allAdrs?: MemoryEntryV2[];
  memoryAdrs?: readonly MemoryReadEntryV1[];
  memoryContext?: string;
  selectionRevisionDigest?: string;
  memoryLabels?: { contextHeading: string; revision: string; unavailable: string };
} {
  const dbPath = join(projectRoot, BRAIN_DIR, MEMORY_DB_FILE);
  const taskText = `${task.title ?? ''}\n${task.description ?? ''}`;
  const mandatoryReferences = [...new Set(
    extractExplicitAdrRefs(taskText).filter(reference => /^adr-[a-z]+-\d+$/iu.test(reference)),
  )];
  if (!existsSync(dbPath)) {
    if (mandatoryReferences.length > 0) {
      throw new DeckentError('DECKENT_E077', 'MEMORY_READ_CONTEXT_HOLD:REQUIRED_ENTRY_MISSING');
    }
    return {};
  }
  let store: MemoryStore | undefined;
  try {
    store = new MemoryStore(dbPath, { readOnly: true });
    const scope = workerMemoryScope(task, projectRoot);
    // Both canonical classifiers return an AdrTaskType vocabulary member; the
    // legacy orchestra classifier predates the narrower return annotation.
    const intent: AdrTaskType = task.type !== undefined
      ? taskKindToAdrDomain(task.type)
      : classifyTaskIntent(task) as AdrTaskType;
    const preferredReferences = [...new Set(TASK_TYPE_ADR_PRESETS[intent] ?? [])];
    const required = resolveMemoryRequiredIds(store, {
      consumer: 'worker',
      scope,
      references: mandatoryReferences,
    });
    if (required.state === 'HOLD') {
      throw new DeckentError('DECKENT_E077', `MEMORY_READ_CONTEXT_HOLD:${required.reasonCode}`);
    }
    const preferred = resolveMemoryPreferredIds(store, {
      consumer: 'worker',
      scope,
      references: preferredReferences,
    });
    if (preferred.state === 'HOLD') {
      throw new DeckentError('DECKENT_E077', `MEMORY_READ_CONTEXT_HOLD:${preferred.reasonCode}`);
    }
    const queryText = buildMemoryDiscoveryQuery([
      taskText,
      ...(task.scope?.directories ?? []),
      ...(task.scope?.filesRead ?? []),
      ...(task.scope?.filesWrite ?? []),
    ].join('\n'));
    const memoryConfig = effectiveConfig ?? resolveMemoryReadConfig(projectRoot, 'worker');
    const limits = resolveMemoryReadLimitsForConsumer(memoryConfig, 'worker');
    const view = readMemoryView(store, {
      consumer: 'worker',
      scope,
      query: queryText.length > 0 ? { text: queryText } : {},
      limits,
      requiredIds: [...new Set([...required.exactIds, ...preferred.exactIds])],
      includeCritical: true,
    });
    if (view.state === 'HOLD') {
      throw new DeckentError('DECKENT_E077', `MEMORY_READ_CONTEXT_HOLD:${view.reasonCode}`);
    }
    const allAdrs = view.state === 'AVAILABLE'
      ? view.entries.map(({ entry }) => entry).filter(entry => entry.type === 'adr' && entry.status === 'accepted')
      : [];
    const memoryAdrs = view.state === 'AVAILABLE'
      ? view.entries.filter(({ entry }) => entry.type === 'adr' && entry.status === 'accepted')
      : [];
    const memoryContext = renderNonAdrMemory(view, memoryConfig.language);
    const memoryLabels = {
      contextHeading: getMessage('memory_read.context_heading', memoryConfig.language),
      revision: getMessage('memory_read.revision', memoryConfig.language),
      unavailable: getMessage('memory_read.unavailable', memoryConfig.language),
    };
    return {
      ...(allAdrs.length > 0 ? { allAdrs } : {}),
      memoryAdrs,
      ...(memoryContext.length > 0 ? { memoryContext } : {}),
      selectionRevisionDigest: view.selectionRevisionDigest,
      memoryLabels,
    };
  } catch (error) {
    if (error instanceof DeckentError && error.message.startsWith('MEMORY_READ_CONTEXT_HOLD:')) throw error;
    throw new DeckentError('DECKENT_E077', 'MEMORY_READ_CONTEXT_HOLD:QUERY_FAILED');
  } finally {
    store?.close();
  }
}

/**
 * Truncate content at a paragraph or section boundary instead of mid-sentence.
 * Looks for the last double-newline, heading, or sentence-ending punctuation before maxLen.
 */
export function truncateAtParagraph(content: string, maxLen: number): string {
  if (content.length <= maxLen) return content;

  const slice = content.slice(0, maxLen);

  // Try to find last paragraph break (double newline)
  const lastParagraph = slice.lastIndexOf('\n\n');
  if (lastParagraph > maxLen * 0.5) return slice.slice(0, lastParagraph).trimEnd();

  // Try last heading boundary (markdown heading)
  const lastHeading = slice.lastIndexOf('\n#');
  if (lastHeading > maxLen * 0.5) return slice.slice(0, lastHeading).trimEnd();

  // Try last single newline (line boundary)
  const lastNewline = slice.lastIndexOf('\n');
  if (lastNewline > maxLen * 0.7) return slice.slice(0, lastNewline).trimEnd();

  // Fallback: cut at last sentence-ending punctuation
  const lastSentence = Math.max(
    slice.lastIndexOf('. '),
    slice.lastIndexOf('.\n'),
  );
  if (lastSentence > maxLen * 0.5) return slice.slice(0, lastSentence + 1).trimEnd();

  return slice;
}

/**
 * Query relevant ADRs from Memory V2 DB for worker prompt injection.
 * Returns only accepted ADRs matching the task's scope and keywords.
 * Returns empty string if no DB available.
 */
export function queryRelevantADRs(taskDescription: string, taskScope: string[], projectRoot?: string, task?: Pick<Task, 'scope' | 'title' | 'description'>): string {
  const root = projectRoot ?? process.cwd();
  const dbPath = join(root, BRAIN_DIR, MEMORY_DB_FILE);

  try {
    if (!existsSync(dbPath)) {
      return '';
    }

    const store = new MemoryStore(dbPath);
    try {
      // Load all accepted ADRs
      const allAdrs = store.getByType('adr').filter(a => a.status === 'accepted');

      if (allAdrs.length === 0) {
        return '';
      }

      // If a full Task-like object is provided, use the new scoring engine.
      // WP-OPT: render 'operative' (Decision section, not the full amendment log) +
      // scope-gated (non-scope-intersecting ADRs → distilled head + pointer only),
      // so a worker sees the actionable constraint, not a 25 KB full-body dump.
      if (task) {
        const ranked = selectRelevantAdrs(task, allAdrs, 3);
        if (ranked.length === 0) return '';
        logInjectionAudit(root, task, ranked);
        return buildAdrPromptSection(ranked, 'full', allAdrs, 'operative', true);
      }

      // Fallback: construct a minimal task-like object from description + scope
      const pseudoTask = {
        title: taskDescription,
        description: taskDescription,
        scope: { directories: taskScope, filesRead: [] as string[], filesWrite: [] as string[] },
      };
      const ranked = selectRelevantAdrs(pseudoTask, allAdrs, 3);
      if (ranked.length === 0) {
        // Final fallback: FTS5 search (original behavior)
        const keywords = taskDescription.split(/\s+/).filter(w => w.length > 3).slice(0, 10);
        const scopeKeywords = taskScope.map(s => s.replace(/\//g, ' ')).join(' ');
        const queryText = [...keywords, ...scopeKeywords.split(/\s+/)].filter(w => w.length > 2).join(' ');

        const results = searchMemory(store, {
          text: queryText || undefined,
          type: ['adr'],
          status: ['accepted'],
          limit: 3,
        });

        if (results.length === 0) return '';
        return results.map(r => `## ${r.entry.id}: ${r.entry.title}\n\n${r.entry.content}`).join('\n\n---\n\n');
      }
      logInjectionAudit(root, pseudoTask, ranked);
      return buildAdrPromptSection(ranked, 'full', allAdrs, 'operative', true);
    } finally {
      store.close();
    }
  } catch {
    return '';
  }
}

// ─── Sprint 278 COMM-1 (278-003): Worker Comms — shared-context read ───────

/**
 * Read the project-level `worker_comms` config block (Sprint 278 COMM-1).
 *
 * Synchronous + best-effort: `buildWorkerPrompt` is sync and all its spawn-path
 * callers invoke it synchronously, so the async 3-layer `loadConfig` can't be
 * used here. `worker_comms` is an opt-in project-level block (absent ⇒ disabled),
 * so reading the project `.deckent/config.json` directly is sufficient. Any
 * read/parse failure yields `undefined` (comms stays off) — never throws.
 */
function readWorkerCommsConfig(projectRoot: string): WorkerCommsConfig | undefined {
  try {
    const p = join(projectRoot, PROJECT_CONFIG_PATH);
    if (!existsSync(p)) return undefined;
    const parsed = JSON.parse(readFileSync(p, 'utf-8')) as { worker_comms?: WorkerCommsConfig };
    return parsed?.worker_comms;
  } catch {
    return undefined;
  }
}

/**
 * Read the project-level `tools` config block (born-674, W674B / 428-002).
 *
 * Synchronous + best-effort, same rationale as `readWorkerCommsConfig` above:
 * `buildWorkerPrompt` is sync and all its spawn-path callers invoke it
 * synchronously, so the async 3-layer `loadConfig` can't be used here.
 * `tools.allowlist_enabled` is opt-in (absent block/field ⇒ disabled/false), so
 * reading the project `.deckent/config.json` directly is sufficient. Any
 * read/parse failure yields `undefined` (flag stays off) — never throws.
 */
function readToolsConfig(projectRoot: string): ToolsConfig | undefined {
  try {
    const p = join(projectRoot, PROJECT_CONFIG_PATH);
    if (!existsSync(p)) return undefined;
    const parsed = JSON.parse(readFileSync(p, 'utf-8')) as { tools?: ToolsConfig };
    return parsed?.tools;
  } catch {
    return undefined;
  }
}

/** Stringify a SharedMemory value for prompt rendering (strings pass through). */
function stringifySharedValue(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/**
 * Read other workers' SharedMemory notes for injection into this task's prompt
 * (Sprint 278 COMM-1 / 278-003).
 *
 * Returns undefined unless `worker_comms.enabled && (inject_shared ?? true)`.
 * Entries written by the current task itself are skipped — the prompt block is
 * "other workers" context. Best-effort: any failure returns undefined so the
 * worker prompt build is never disrupted.
 */
function readSharedContext(task: Task, projectRoot: string): SharedContextEntry[] | undefined {
  try {
    const wc = readWorkerCommsConfig(projectRoot);
    if (!wc?.enabled || (wc.inject_shared ?? true) === false) return undefined;
    const sm = new SharedMemory(projectRoot, wc.shared_memory_ttl_ms);
    const entries: SharedContextEntry[] = [];
    for (const key of sm.listKeys()) {
      const entry = sm.read(key);
      if (!entry) continue;
      if (entry.writerId === task.id) continue; // skip own notes — "other workers"
      entries.push({ key, writerId: entry.writerId, value: stringifySharedValue(entry.value) });
    }
    return entries.length > 0 ? entries : undefined;
  } catch (e) {
    debugLog('buildWorkerPrompt:readSharedContext', e);
    return undefined;
  }
}

/**
 * Read executed upstream handoffs targeting this task for prompt injection
 * (Sprint 278 COMM-1 / 278-004).
 *
 * Sprint-controller already creates handoffs (`createHandoff`/`executeHandoff`)
 * when a dependency completes — this bridges them into the downstream worker's
 * prompt. Returns undefined unless `worker_comms.enabled && (inject_handoffs ?? true)`.
 * Only `ready` handoffs (executeHandoff verified all artifacts present) addressed
 * to this task (`toTaskId === task.id`) are surfaced; pending/failed handoffs are
 * skipped. `listHandoffs()` already sorts by id, so the order is deterministic.
 * Best-effort: any failure returns undefined so the prompt build is never disrupted.
 */
function readUpstreamHandoffs(task: Task, projectRoot: string): UpstreamHandoffEntry[] | undefined {
  try {
    const wc = readWorkerCommsConfig(projectRoot);
    if (!wc?.enabled || (wc.inject_handoffs ?? true) === false) return undefined;
    const protocol = new HandoffProtocol(projectRoot);
    const entries: UpstreamHandoffEntry[] = [];
    for (const h of protocol.listHandoffs()) {
      if (h.toTaskId !== task.id) continue;
      if (h.status !== 'ready') continue; // only executed handoffs
      entries.push({ fromTaskId: h.fromTaskId, artifacts: h.artifacts, notes: h.notes });
    }
    return entries.length > 0 ? entries : undefined;
  } catch (e) {
    debugLog('buildWorkerPrompt:readUpstreamHandoffs', e);
    return undefined;
  }
}

// ─── Skill Directive Authority + Delivery Proof (561-003) ────────────────────

/**
 * Apply the operator's explicit skill directives to a task's effective skill
 * assignment. Idempotent, and the single authority every spawn path shares.
 *
 * 561-003 FORCE-EZME: routing (plan-time V3, the debt-manager FIX rotation, a
 * mid-sprint reroute, the single-task `routeSingleTaskV3` path) assigns
 * `task.assignedSkills` wholesale. When a routing result is empty — or simply
 * does not happen to contain the forced id — an operator's explicit
 * `- Skills: <id>` directive was silently erased on some paths and honoured on
 * others, so the SAME force produced different worker prompts depending on how
 * the task was launched. This function makes that outcome path-independent:
 * exclusions are applied to the routing-derived set, and every forced id is
 * unioned back in.
 *
 * Precedence: an id named in BOTH `forceSkills` and `excludeSkills` is kept —
 * the positive directive is the operator's explicit selection, the exclusion
 * only prunes what routing added.
 *
 * `task.forceSkills` is READ-ONLY here: an AUTO-assigned (routing-derived)
 * skill is never promoted into the force set
 * (GR-2026-08-08-DOGFOOD-RCPT2-01). A forced id whose SKILL.md cannot be
 * resolved keeps its existing typed-HOLD treatment upstream — this function
 * only preserves the DIRECTIVE, it never asserts deliverability.
 *
 * @returns the effective assigned-skill ids (also written back onto the task).
 */
export function applySkillDirectiveAuthority(task: Task): string[] {
  const forced = task.forceSkills ?? [];
  const current = task.assignedSkills ?? [];
  const excluded = new Set((task.excludeSkills ?? []).filter(id => !forced.includes(id)));

  const merged: string[] = [];
  const seen = new Set<string>();
  for (const id of current) {
    if (excluded.has(id) || seen.has(id)) continue;
    seen.add(id);
    merged.push(id);
  }
  for (const id of forced) {
    if (seen.has(id)) continue;
    seen.add(id);
    merged.push(id);
  }

  const unchanged = merged.length === current.length && merged.every((id, i) => current[i] === id);
  if (!unchanged) task.assignedSkills = merged;
  return task.assignedSkills ?? merged;
}

/**
 * Last-line recovery for a forced skill whose BODY never reached this render.
 *
 * `resolveSkillPrompts` (result-collector) loads bodies strictly from
 * `task.assignedSkills`, so a path that overwrote the assignment before that
 * call arrives here with the forced id restored on the record but with no
 * content to inject. Read the missing bodies through the canonical catalog
 * authority (`resolveSkillPromptBodies` → `SkillPoolManager.resolveBody`) — no
 * parallel catalog or resolver is introduced.
 *
 * An administratively disabled skill (`enabled:false`) is NEVER revived here:
 * that case is a distinct typed HOLD (487-023 FORCED-SKILL-LINEAGE) and
 * silently injecting it because its file still reads would defeat the disable.
 * Fail-soft — a catalog fault leaves the prompt exactly as it was.
 */
function recoverForcedSkillPrompts(
  task: Task,
  present: ReadonlyArray<{ name: string; content: string }>,
  projectRoot: string,
): Array<{ name: string; content: string }> {
  const forced = task.forceSkills ?? [];
  if (forced.length === 0) return [];
  const have = new Set(present.map(p => p.name));
  const missing = forced.filter(id => !have.has(id));
  if (missing.length === 0) return [];

  const recovered: Array<{ name: string; content: string }> = [];
  try {
    const pool = new SkillPoolManager(projectRoot);
    for (const resolution of resolveSkillPromptBodies(projectRoot, missing)) {
      if (!resolution.ok) continue;
      if (pool.getSkill(resolution.skillId)?.enabled === false) continue;
      recovered.push({ name: resolution.skillId, content: resolution.content });
    }
  } catch (e) {
    debugLog('buildWorkerPrompt:recoverForcedSkillPrompts', e);
  }
  return recovered;
}

/**
 * Resolve the skill-prompt blocks a worker prompt renders, from the blocks its
 * caller resolved. Extracted from `buildWorkerPrompt` so the DECISION is a
 * single shared authority rather than an inline local.
 *
 * Order of operations (unchanged from the inline original, plus the forced
 * recovery step):
 *  1. V2 tasks: DNA relevance filter, with forced ids restored when the filter
 *     scored them 0 (487-023 — a narrow-domain forced skill must still reach
 *     the prompt text, not just the task record).
 *  2. Forced bodies missing entirely from the caller's set are recovered from
 *     the catalog authority (see `recoverForcedSkillPrompts`).
 *  3. Duplicate ids are collapsed so one skill's persona is never injected
 *     twice (486-018 render-boundary defence, any caller).
 */
export function resolveDeliveredSkillPrompts(
  task: Task,
  skillPrompts?: Array<{ name: string; content: string }>,
  projectRoot: string = process.cwd(),
): Array<{ name: string; content: string }> | undefined {
  const isV2 = task.routingMeta?.routingVersion === 'v2';
  const rawDNA = task.routingMeta?.taskDNA;
  let effective = skillPrompts;

  // PCOMP-6 D4 (CC completion): the historical `> 1` guard meant a SINGLE
  // assigned skill bypassed relevance filtering entirely — the exact corpus
  // class where an irrelevant sh-portability/file-watch-hygiene body rode
  // along on one-skill tasks (10/31 + 6/31). Post-441 the filter may return
  // an empty list (empty skill block is a valid render), so every V2 task
  // with any skills goes through it.
  if (isV2 && rawDNA && skillPrompts && skillPrompts.length > 0) {
    const dnaFiltered = filterSkillPromptsByDNA(skillPrompts, rawDNA as TaskDNA, {
      filesWrite: task.scope?.filesWrite,
      taskText: `${task.title ?? ''}\n${task.description ?? ''}`,
    });
    // 487-023 FORCED-SKILL-LINEAGE: filterSkillPromptsByDNA scores each skill
    // body by keyword affinity and drops anything scoring 0 — a narrow-domain
    // forced skill can legitimately score 0 against task text/scope that never
    // mentions its domain, and be silently dropped from the RENDERED prompt
    // even though task.assignedSkills (and sprint-spawner's routing union)
    // still lists it as assigned. An operator's explicit forceSkills id must
    // always reach the actual worker prompt text, not just the task record.
    const forcedIds = new Set(task.forceSkills ?? []);
    const forcedDropped = forcedIds.size > 0
      ? skillPrompts.filter(sp => forcedIds.has(sp.name) && !dnaFiltered.some(d => d.name === sp.name))
      : [];
    effective = forcedDropped.length > 0 ? [...dnaFiltered, ...forcedDropped] : dnaFiltered;
  }

  const recovered = recoverForcedSkillPrompts(task, effective ?? [], projectRoot);
  if (recovered.length > 0) effective = [...(effective ?? []), ...recovered];

  // 486-018 FORCED-SKILL-PRESERVE: forced + routing-added skill ids are
  // Set-deduped upstream (sprint-spawner.ts routeSprintTasks), but this render
  // boundary defends independently — an upstream duplicate id (any caller,
  // not just sprint-spawner) must never inject the same skill's persona
  // content twice into one worker prompt.
  if (effective && effective.length > 1) {
    const seenSkillNames = new Set<string>();
    effective = effective.filter(sp => {
      if (seenSkillNames.has(sp.name)) return false;
      seenSkillNames.add(sp.name);
      return true;
    });
  }

  return effective;
}

/**
 * Proof that a skill's content actually entered a worker prompt.
 *
 * 561-003 DELIVERY-PROOF: outcome learning credits a skill from the ASSIGNMENT
 * (`sprint-finalizer.ts` reads `result.skillIds ?? task.assignedSkills`), but
 * assignment and delivery are not the same set — `dedupeAgentNamedSkills`, the
 * DNA relevance filter and an unresolvable body all remove a skill from the
 * rendered prompt while leaving it on the record. `deliveredSkillIds` is taken
 * from the render itself (`buildSkillBlock`'s own emitted names), so it is the
 * exact set of ids whose SKILL.md body is in the prompt bytes.
 */
export interface SkillDeliveryEvidence {
  readonly version: 1;
  readonly taskId: string;
  readonly source: 'worker-prompt';
  /** Ids whose SKILL.md body is present in the rendered prompt. */
  readonly deliveredSkillIds: string[];
  /** `task.assignedSkills` as it stood at render time. */
  readonly assignedSkillIds: string[];
  /** The operator's explicit `- Skills:` selection. */
  readonly forcedSkillIds: string[];
  /** Forced ids that did NOT reach the prompt — never eligible for stat credit. */
  readonly undeliveredForcedSkillIds: string[];
}

/** A caller-supplied sink `buildWorkerPrompt` fills with the rendered skill ids. */
export interface SkillDeliveryProbe {
  deliveredSkillIds: string[];
  /** Digest identity carried through the production compile call chain. */
  promptCompilePlanId?: string;
}

/** In-memory output of a pre-publication prompt compilation. */
export interface WorkerPromptCompilationSinkV2 {
  artifact?: SegmentedPrompt;
  receipt?: PromptDeliveryReceipt;
}

/**
 * Exact callers supply accepted dependency evidence and defer every compile-
 * time observation until the backend has durably released the attempt.
 */
export interface WorkerPromptCompilationOptionsV2 {
  readonly publicationMode?: 'compatibility' | 'deferred';
  readonly dependencyIds?: readonly string[];
  readonly dependencyResults?: ReadonlyMap<string, DependencyResultEntry>;
  readonly sink?: WorkerPromptCompilationSinkV2;
}

/** `.tasks/task-<id>.skill-delivery.json` — stable compatibility sidecar path. */
export function skillDeliveryEvidencePath(projectRoot: string, taskId: string): string {
  return promptDeliveryReceiptPath(projectRoot, taskId);
}

/** Delivery-proof record (9034): exactly which skill ids REACHED the worker
 *  prompt, alongside the assigned/forced sets — stats credit may only be
 *  granted from this evidence, never from assignment alone. */
export function buildSkillDeliveryEvidence(
  task: Task,
  deliveredSkillIds: readonly string[],
): SkillDeliveryEvidence {
  const delivered = Array.from(new Set(deliveredSkillIds));
  const forced = task.forceSkills ?? [];
  return {
    version: 1,
    taskId: task.id,
    source: 'worker-prompt',
    deliveredSkillIds: delivered,
    assignedSkillIds: [...(task.assignedSkills ?? [])],
    forcedSkillIds: [...forced],
    undeliveredForcedSkillIds: forced.filter(id => !delivered.includes(id)),
  };
}

/**
 * Persist the delivery proof next to the task's other lifecycle artifacts.
 * Atomic (temp + rename) so a concurrent reader never observes a partial file,
 * and fail-soft so evidence recording can never break a spawn.
 */
export function writeSkillDeliveryEvidence(
  projectRoot: string,
  evidence: SkillDeliveryEvidence,
): boolean {
  // Spawn callers from the v1 compatibility era may still invoke this after
  // buildWorkerPrompt. Never let that projection overwrite the canonical v2
  // receipt that the prompt boundary already published.
  if (readPromptDeliveryReceipt(projectRoot, evidence.taskId).state === 'AVAILABLE') {
    return true;
  }
  const target = skillDeliveryEvidencePath(projectRoot, evidence.taskId);
  const temp = `${target}.tmp`;
  try {
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(temp, `${JSON.stringify(evidence, null, 2)}\n`, 'utf-8');
    renameSync(temp, target);
    return true;
  } catch (e) {
    debugLog('writeSkillDeliveryEvidence', e);
    return false;
  }
}

/**
 * Read the delivery proof for a task, or `null` when none was recorded (a task
 * spawned before this evidence existed, or a spawn that never reached the
 * prompt). Consumers MUST treat `null` as "no proof", not as "nothing
 * delivered".
 */
export function readSkillDeliveryEvidence(
  projectRoot: string,
  taskId: string,
): SkillDeliveryEvidence | null {
  const current = readPromptDeliveryReceipt(projectRoot, taskId);
  if (current.state === 'AVAILABLE') {
    const receipt = current.receipt;
    return {
      version: 1,
      taskId: receipt.taskId,
      source: receipt.source,
      deliveredSkillIds: [...receipt.deliveredSkillIds],
      assignedSkillIds: [...receipt.assignedSkillIds],
      forcedSkillIds: [...receipt.forcedSkillIds],
      undeliveredForcedSkillIds: [...receipt.undeliveredForcedSkillIds],
    };
  }
  try {
    const target = skillDeliveryEvidencePath(projectRoot, taskId);
    if (!existsSync(target)) return null;
    const parsed = JSON.parse(readFileSync(target, 'utf-8')) as SkillDeliveryEvidence;
    if (parsed.version !== 1 || parsed.taskId !== taskId || !Array.isArray(parsed.deliveredSkillIds)) {
      return null;
    }
    return parsed;
  } catch (e) {
    debugLog('readSkillDeliveryEvidence', e);
    return null;
  }
}

/**
 * Build the full prompt string sent to a worker agent.
 *
 * Provider-agnostic single source: the returned string is written verbatim to
 * the `.prompt` file and consumed identically by the tmux / subprocess / docker
 * backends across Claude, Codex and Gemini. Token estimation comes from the
 * rendered artifact's own accurate count (covers agent + skills + ADRs +
 * Karpathy + scope + deps + template), which downstream routing context-fit,
 * throttle and cost tracking read via `task.estimatedTokens`.
 *
 * @param task The task the worker will execute.
 * @param agentPrompt Optional agent PROMPT.md content.
 * @param skillPrompts Optional skill prompt blocks.
 * @param projectRoot Explicit project root honored uniformly by every read in this function —
 *   `worker_comms` config + SharedMemory (Sprint 278 COMM-1 / 278-003), the ADR/
 *   `.brain/memory.db` load, the baseline-failure read, and `git ls-files`. Every
 *   production dispatch passes this value and therefore publishes the durable
 *   prompt-delivery receipt. An omitted value retains the established `process.cwd()`
 *   read context for compile-only callers without mutating runtime state.
 * @returns The assembled worker prompt (also sets `task.estimatedTokens`).
 */
export function buildWorkerPrompt(
  task: Task,
  agentPrompt?: string,
  skillPrompts?: Array<{ name: string; content: string }>,
  projectRoot?: string,
  effectiveConfig?: Pick<ResolvedConfig, 'prompt' | 'worker_comms' | 'memory_read' | 'memory_read_profiles' | 'language'>,
  exactPlanAuthority?: {
    readonly flowId: string;
    readonly revision: number;
    readonly planDigest: string;
    readonly sourceAuthority?: RunFlowPlanSourceAuthority;
  },
  deliveryProbe?: SkillDeliveryProbe,
  /**
   * Backend kind that will run this task (`docker` | `tmux` | `subprocess` |
   * `auto`). Omitted means "unknown" and resolves fail-closed: the worker core
   * stays inline rather than being suppressed with no channel to carry it.
   */
  spawnBackendKind?: string,
  compilationOptions?: WorkerPromptCompilationOptionsV2,
): string {
  const deferredPublication = compilationOptions?.publicationMode === 'deferred';
  const publishDeliveryReceipt = projectRoot !== undefined && !deferredPublication;
  const explicitProjectRoot = projectRoot;
  projectRoot ??= process.cwd();
  // Legacy task JSON may predate Task.verification and carry `Test:` only in
  // description prose. Migrate exactly once at the production ingress; the
  // compiler/renderer below consumes only the typed task field.
  if (task.verification === undefined) {
    const legacyCommands = extractDeclaredTestCommands(task);
    if (legacyCommands.length > 0) {
      task.verification = {
        version: 1,
        source: 'legacy-ingress',
        commands: [...legacyCommands],
      };
    }
  }
  task.goNogo = ensureStructuredGoNogo(task.goNogo);
  const effort = resolveWorkerEffort(task);

  // 561-003 FORCE-EZME: the LAST boundary every spawn path crosses (sprint,
  // debt-manager FIX, single-task/task-mode-runner, cli/run, mcp/tools/run).
  // Repairing the record here makes an operator's force path-independent even
  // when an upstream router replaced the assignment wholesale.
  applySkillDirectiveAuthority(task);

  // V2 relevance filter + forced restore + dedupe — the shared authority, so
  // the spawner's delivery evidence and this render can never disagree.
  const effectiveSkillPrompts = resolveDeliveredSkillPrompts(task, skillPrompts, projectRoot);

  // Compile-only legacy callers do not carry a project authority. They must not
  // accidentally query the host cwd's tenant/project memory. Every production
  // dispatch supplies the explicit root and therefore takes the canonical path.
  const memoryContext = explicitProjectRoot === undefined
    ? {}
    : readWorkerMemoryContext(task, projectRoot, effectiveConfig);

  // Sprint 278 COMM-1 (278-003): inject other workers' shared-context notes
  // when worker_comms.enabled && inject_shared. Best-effort; undefined when off.
  const sharedContext = readSharedContext(task, projectRoot);

  // Sprint 278 COMM-1 (278-004): inject executed upstream handoffs targeting this
  // task when worker_comms.enabled && inject_handoffs. Best-effort; undefined when off.
  const upstreamHandoffs = readUpstreamHandoffs(task, projectRoot);

  // WP-14: read the live pre-existing-failure count from this sprint's baseline
  // snapshot (written by the sprint controller at sprint start) so the prompt's
  // VERIFY-STEPS note cites the REAL count instead of a stale hardcoded "~67".
  // Best-effort: undefined when no sprintId or no baseline file → generic warning.
  let preExistingFailures: number | undefined;
  try {
    if (task.sprintId) {
      const baseline = readBaseline(projectRoot, task.sprintId);
      if (baseline) preExistingFailures = baseline.fail;
    }
  } catch (e) {
    debugLog('buildWorkerPrompt:readBaseline', e);
  }

  // F2.1b: the repo's tracked files, so the scope block can split the WRITE list into
  // Existing / New / ⚠ Unverified for the worker (same classifier as the pre-spawn
  // scope gate). Best-effort — a git failure yields undefined → the flat legacy scope
  // list is rendered byte-for-byte. `git ls-files` on this repo is ~4.7k paths / <10ms.
  let trackedFiles: string[] | undefined;
  try {
    const ls = spawnSync('git', ['ls-files'], { cwd: projectRoot, encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024 });
    if (ls.status === 0 && ls.stdout) {
      const files = ls.stdout.split('\n').filter(Boolean);
      if (files.length > 0) trackedFiles = files;
    }
  } catch (e) {
    debugLog('buildWorkerPrompt:lsFiles', e);
  }

  // born-674 (428-001): the sprint-start host tool-inventory persisted by
  // 427-011 (readToolInventory, sprint-phases.ts) and the stack-resolved
  // check/test commands (resolveVerifyCommands, worker-verify-tool.ts) so
  // buildEnvProbeBlock / buildCheckCommandLine / buildTestCommandLine render
  // real per-sprint/per-project data instead of staying permanently empty.
  // Both are fail-soft: any read/resolve error yields undefined, never
  // disrupting prompt construction — same contract as preExistingFailures/
  // trackedFiles above.
  let toolInventory: string | undefined;
  try {
    if (task.sprintId) {
      toolInventory = readToolInventory(projectRoot, task.sprintId);
    }
  } catch (e) {
    debugLog('buildWorkerPrompt:readToolInventory', e);
  }

  let verifyCommands: ResolvedVerifyCommands | undefined;
  // A task-local Test directive is the worker's complete verification authority.
  // Stack-resolved commands are wave-level orchestration inputs and must not leak
  // into that worker prompt or widen its proof obligation.
  if (!hasTaskScopedVerificationAuthority(task)) {
    try {
      verifyCommands = resolveVerifyCommands(projectRoot);
    } catch (e) {
      debugLog('buildWorkerPrompt:resolveVerifyCommands', e);
    }
  }

  // born-674 (428-002, W674B): task-scoped tool allowlist via 427-013's pure
  // computeToolAllowlist (core/tool-allowlist.ts) — populated ONLY when
  // tools.allowlist_enabled is true (default false, absent block). Flag-off
  // leaves toolAllowlist undefined, so buildToolAllowlistBlock (427-014,
  // prompt-god-template.ts) renders nothing and the compiled prompt stays
  // byte-exact with pre-674 output. Fail-soft, same contract as
  // toolInventory/verifyCommands above.
  let toolAllowlist: ToolAllowlistResult | undefined;
  try {
    if (readToolsConfig(projectRoot)?.allowlist_enabled === true) {
      toolAllowlist = computeToolAllowlist({
        taskType: task.type ?? 'generic',
        scope: { filesWrite: task.scope.filesWrite },
      });
    }
  } catch (e) {
    debugLog('buildWorkerPrompt:computeToolAllowlist', e);
  }

  const exactExecutionAuthority = resolveWorkerExactExecutionAuthority(
    projectRoot,
    exactPlanAuthority,
  );
  if (exactExecutionAuthority && !deferredPublication) {
    try {
      const auditDir = join(projectRoot, '.deckent', 'runtime', 'prompt-authority');
      mkdirSync(auditDir, { recursive: true });
      appendFileSync(
        join(auditDir, 'execution-authority.jsonl'),
        `${JSON.stringify({
          schemaVersion: 1,
          taskId: task.id,
          ...exactExecutionAuthority,
          recordedAt: new Date().toISOString(),
        })}\n`,
        'utf-8',
      );
    } catch (e) {
      debugLog('buildWorkerPrompt:executionAuthorityAudit', e);
    }
  }

  // RUN-POLICY-DELIVERY-001: BEST-EFFORT compile OBSERVATION that this compile
  // carried the task's digest-bound run policy — same fail-soft append-only
  // jsonl the exact-plan authority uses (no parallel audit store),
  // `kind`-tagged for disambiguation. This surface is deliberately fail-soft
  // (append errors only debug-log) and is NOT authoritative execution truth;
  // the authoritative prompt-compile evidence authority is MASTER 9024
  // (PROMPT-COMPILE-EVIDENCE-AUTHORITY-001). Enforcement lives in the
  // settlement parity chain, not here.
  if (task.runPolicy && !deferredPublication) {
    try {
      const auditDir = join(projectRoot, '.deckent', 'runtime', 'prompt-authority');
      mkdirSync(auditDir, { recursive: true });
      appendFileSync(
        join(auditDir, 'execution-authority.jsonl'),
        `${JSON.stringify({
          schemaVersion: 1,
          kind: 'run-policy-authority',
          taskId: task.id,
          policyDigest: task.runPolicy.policyDigest,
          constraintCount: task.runPolicy.constraints.length,
          ...(task.runPolicy.sourceRef !== undefined ? { sourceRef: task.runPolicy.sourceRef } : {}),
          recordedAt: new Date().toISOString(),
        })}\n`,
        'utf-8',
      );
    } catch (e) {
      debugLog('buildWorkerPrompt:runPolicyAuthorityAudit', e);
    }
  }

  const promptDependencyIds = compilationOptions?.dependencyResults
    ? [...new Set(compilationOptions.dependencyIds ?? task.dependencies ?? [])]
    : resolvePromptDependencyIds(projectRoot, task);
  const dependencyResults = compilationOptions?.dependencyResults
    ?? (promptDependencyIds.length > 0
      ? collectDependencyResultEntries(projectRoot, task.sprintId)
      : new Map<string, DependencyResultEntry>());
  if (promptDependencyIds.length > 0) {
    const dependencyIds = new Set(promptDependencyIds);
    const dependencyReadPaths = [...dependencyResults.entries()].flatMap(([attemptId, entry]) => {
      const rootId = entry.originalTaskId ?? attemptId;
      return dependencyIds.has(rootId) ? (entry.filesChanged ?? []) : [];
    });
    task.scope.filesRead = [...new Set([
      ...(task.scope.filesRead ?? []),
      ...dependencyReadPaths,
    ])].sort();
  }

  // Deterministic project-context segment (not a skill — CATALOG-STATS-AUTHORITY-001
  // correction, 2026-08-17): always-on conventions data for every worker prompt.
  let projectContext: string | undefined;
  try {
    projectContext = generateProjectContextSegment(detectProjectStack(projectRoot));
  } catch (e) {
    debugLog('buildWorkerPrompt:projectContextSegment', e);
  }

  // F4 tier guidance is optional prompt enrichment, not an admission gate.
  // Legacy aliases and provider-local model IDs may be valid at their dispatch
  // boundary without existing in the canonical model registry. In that case,
  // omit only the tier-conditioned guidance and continue composing the prompt.
  let modelTier: ReturnType<typeof getModelTier> | undefined;
  try {
    modelTier = getModelTier(task.model);
  } catch (e) {
    debugLog('buildWorkerPrompt:getModelTier', e);
  }

  const ctx: SprintContext = {
    projectRoot,
    agentPrompt,
    agentId: task.assignedAgent ?? 'generic',
    skillPrompts: effectiveSkillPrompts,
    ...(projectContext !== undefined ? { projectContext } : {}),
    allAdrs: memoryContext.allAdrs,
    memoryAdrs: memoryContext.memoryAdrs,
    memoryContext: memoryContext.memoryContext,
    memorySelectionRevisionDigest: memoryContext.selectionRevisionDigest,
    memoryLabels: memoryContext.memoryLabels,
    effort,
    modelTier,
    dependencies: [...promptDependencyIds],
    tasksDir: join(projectRoot, TASKS_DIR),
    workerGuideContract: inspectWorkerGuideContract(projectRoot),
    dependencyResults,
    sharedContext,
    upstreamHandoffs,
    preExistingFailures,
    trackedFiles,
    toolInventory,
    verifyCommands,
    toolAllowlist,
    personaRenderMode: effectiveConfig?.prompt?.persona_render,
    // Suppress inline T0 only when the provider spec exposes a core channel,
    // every provider-specific rollout flag for that channel is enabled AND the
    // selected backend can actually deliver it.
    coreExternalized: shouldExternalizeWorkerCore(
      task.provider,
      effectiveConfig?.prompt,
      spawnBackendKindDeliversWorkerCore(spawnBackendKind),
    ),
    exactExecutionAuthority,
  };
  let artifact: SegmentedPrompt;
  if (deferredPublication) deferredPromptObservationDepth += 1;
  try {
    artifact = buildTaskPromptSegmented(task, ctx);
  } finally {
    if (deferredPublication) deferredPromptObservationDepth -= 1;
  }

  // Single accurate token estimate from the actual assembled prompt.
  task.estimatedTokens = artifact.metadata.estimatedTokens;
  // Persisted with the EXECUTING task snapshot by every scheduler/spawn path.
  // Result evaluation uses this exact value; workers never recompute it.
  task.promptCompilePlanId = artifact.planId;

  // Build and publish the authoritative receipt once, from this final segmented
  // artifact. This is deliberately independent of the legacy caller probe.
  const receipt = buildPromptDeliveryReceipt({
    taskId: task.id,
    prompt: artifact.prompt,
    promptCompilePlanId: artifact.planId,
    rolePolicyIdentity: artifact.compilePlan.rolePolicyIdentity,
    assignedAgentId: task.assignedAgent,
    assignedSkillIds: task.assignedSkills,
    forcedSkillIds: task.forceSkills,
    segments: artifact.segments,
  });
  if (compilationOptions?.sink) {
    compilationOptions.sink.artifact = artifact;
    compilationOptions.sink.receipt = receipt;
  }
  if (publishDeliveryReceipt) {
    publishCompiledWorkerPrompt(projectRoot, task.id, artifact.prompt, receipt.promptSha256);
  }
  if (publishDeliveryReceipt && !writePromptDeliveryReceipt(projectRoot, receipt)) {
    throw new DeckentError('DECKENT_E077', `PROMPT_DELIVERY_RECEIPT_WRITE_HOLD:${task.id}`);
  }

  // Compatibility observer: its values are projected from the canonical receipt,
  // never used to decide what was delivered or whether a receipt is written.
  if (deliveryProbe) {
    deliveryProbe.deliveredSkillIds = [...receipt.deliveredSkillIds];
    deliveryProbe.promptCompilePlanId = artifact.planId;
  }

  // PCOMP-6 D2 (MASTER-PLAN 573): spawn-time prompt-contract linter —
  // WARN-ONLY rollout (Alperen 2026-07-14: warn → ölçüm → fail-closed).
  // Findings never mutate the prompt and never block the spawn; they are
  // logged to stderr (debug) and appended fail-soft to a measurement ledger
  // so the false-positive rate can be measured before any gating flip.
  try {
    // D5: calibration/regeneration runs (golden-set measurements) must not
    // pollute the production measurement ledger — the fail-closed flip decision
    // reads it. Set DECKENT_PROMPT_LINT_LEDGER=0 to lint without recording.
    // A1-İz#3 (2026-07-14): vitest fixture-çağrıları defteri kirletiyordu
    // (186/193 sahte-W6, taskId=025-* foo.ts) — test-ortamında ledger kapalı.
    const ledgerEnabled = !deferredPublication
      && process.env['DECKENT_PROMPT_LINT_LEDGER'] !== '0'
      && process.env['VITEST'] === undefined;
    const findings = lintWorkerPromptContract(task, trackedFiles);
    if (findings.length > 0 && ledgerEnabled) {
      for (const f of findings) {
        debugLog('prompt-lint', `[${f.check}] task=${f.taskId}: ${f.detail}`);
      }
      const ledger = join(projectRoot, '.deckent', 'runtime', 'prompt-lint.jsonl');
      mkdirSync(dirname(ledger), { recursive: true });
      appendFileSync(
        ledger,
        findings.map((f) => JSON.stringify(f)).join('\n') + '\n',
        'utf-8',
      );
    }
  } catch (e) {
    // Measurement must never break spawning.
    debugLog('prompt-lint', `ledger append failed (fail-soft): ${e instanceof Error ? e.message : String(e)}`);
  }

  return artifact.prompt;
}

/**
 * Resolve whether the mutable root DIRECTIVES projection belongs to this exact
 * approved run. Project policy files remain applicable; this decision controls
 * execution-directive authority only.
 */
export function resolveWorkerExactExecutionAuthority(
  projectRoot: string,
  exactPlanAuthority?: {
    readonly flowId: string;
    readonly revision: number;
    readonly planDigest: string;
    readonly sourceAuthority?: RunFlowPlanSourceAuthority;
  },
): WorkerExactExecutionAuthority | undefined {
  if (!exactPlanAuthority) return undefined;
  const base = {
    flowId: exactPlanAuthority.flowId,
    revision: exactPlanAuthority.revision,
    planDigest: exactPlanAuthority.planDigest,
  } as const;
  const source = exactPlanAuthority.sourceAuthority;
  if (!source) {
    return {
      ...base,
      sourceKind: 'unavailable',
      directivesProjection: 'EXCLUDED_AUTHORITY_UNAVAILABLE',
    };
  }
  if (source.sourceKind !== 'directives') {
    return {
      ...base,
      sourceKind: source.sourceKind,
      sourceContentSha256: source.contentSha256,
      directivesProjection: 'EXCLUDED_SOURCE_KIND',
    };
  }
  const directivesPath = join(projectRoot, 'DIRECTIVES.md');
  if (!existsSync(directivesPath)) {
    return {
      ...base,
      sourceKind: source.sourceKind,
      sourceContentSha256: source.contentSha256,
      directivesProjection: 'EXCLUDED_MISSING',
    };
  }
  let observedDirectivesSha256: string;
  try {
    observedDirectivesSha256 = createHash('sha256')
      .update(readFileSync(directivesPath))
      .digest('hex');
  } catch {
    return {
      ...base,
      sourceKind: source.sourceKind,
      sourceContentSha256: source.contentSha256,
      directivesProjection: 'EXCLUDED_MISSING',
    };
  }
  return {
    ...base,
    sourceKind: source.sourceKind,
    sourceContentSha256: source.contentSha256,
    observedDirectivesSha256,
    directivesProjection: observedDirectivesSha256 === source.contentSha256
      ? 'MATCHED_CONTENT_ADDRESSED_POINTER'
      : 'EXCLUDED_DIGEST_MISMATCH',
  };
}

// ─── Persona-Task Domain Matcher (WP-1) ────────────────────────────────────

/** Path-to-domain mapping rules, evaluated in order (first match wins per path). */
const DOMAIN_PATH_RULES: ReadonlyArray<{ prefix: string; domain: AgentDomain }> = [
  { prefix: 'src/cli/', domain: 'cli' },
  { prefix: 'src/api/', domain: 'react' },
  { prefix: 'src/dashboard/', domain: 'react' },
  { prefix: 'src/core/', domain: 'system' },
  { prefix: 'src/orchestra/', domain: 'system' },
  { prefix: 'src/providers/', domain: 'system' },
  { prefix: 'src/agents/', domain: 'system' },
  { prefix: 'src/mcp/', domain: 'system' },
  { prefix: 'src/nervous/', domain: 'system' },
  { prefix: 'src/monitor/', domain: 'system' },
  { prefix: 'src/connectors/', domain: 'system' },
  { prefix: 'tests/', domain: 'test' },
  { prefix: 'docs/', domain: 'doc' },
  { prefix: '.deckent/', domain: 'devops' },
  { prefix: 'scripts/', domain: 'devops' },
];

/**
 * Infer the set of task domains from scope paths.
 * Returns unique domains found; empty array means ambiguous/unknown.
 */
export function inferTaskDomains(filesWrite: string[], directories: string[]): AgentDomain[] {
  const domains = new Set<AgentDomain>();
  const paths = [...filesWrite, ...directories];
  for (const p of paths) {
    const normalized = p.replace(/^\/workspace\//, '').replace(/^\.\//, '');
    for (const rule of DOMAIN_PATH_RULES) {
      if (normalized.startsWith(rule.prefix) || normalized === rule.prefix.replace(/\/$/, '')) {
        domains.add(rule.domain);
        break;
      }
    }
    // md files → doc
    if (normalized.endsWith('.md') || normalized.endsWith('.mdx')) {
      domains.add('doc');
    }
  }
  return Array.from(domains);
}

export interface PersonaMatchResult {
  valid: boolean;
  severity?: 'HIGH' | 'LOW';
  mismatch?: string[];
  suggestedAgent?: string;
}

/**
 * Validate that an agent's domain matches the task's inferred domain.
 * - Generic agents (no domain) always pass (backward compat).
 * - Multi-domain tasks are ambiguous → no override, valid=true.
 * - Single-domain task + domain-specific agent: check alignment.
 */
export function validatePersonaTaskMatch(
  agent: AgentDefinition,
  task: Pick<Task, 'scope'>,
): PersonaMatchResult {
  const agentDomain = getAgentDomain(agent);

  // Generic agent → no mismatch (legacy behavior)
  if (agentDomain === 'generic') {
    return { valid: true };
  }

  const taskDomains = inferTaskDomains(
    task.scope.filesWrite ?? [],
    task.scope.directories ?? [],
  );

  // No recognizable domain in task → treat as ambiguous, no override
  if (taskDomains.length === 0) {
    return { valid: true };
  }

  // Multi-domain task → ambiguous, no override
  if (taskDomains.length > 1) {
    return { valid: true };
  }

  const taskDomain = taskDomains[0]!;

  // Domain match
  if (agentDomain === taskDomain) {
    return { valid: true };
  }

  // Domain mismatch — determine severity
  // HIGH: clearly wrong domain (e.g. react agent on cli/system task)
  // LOW: plausible overlap (e.g. system agent on test task)
  const highMismatch: Array<{ agent: AgentDomain; task: AgentDomain }> = [
    { agent: 'react', task: 'cli' },
    { agent: 'react', task: 'system' },
    { agent: 'cli', task: 'react' },
    { agent: 'doc', task: 'system' },
    { agent: 'doc', task: 'cli' },
    { agent: 'data', task: 'react' },
    { agent: 'security', task: 'doc' },
  ];

  const isHigh = highMismatch.some(
    (rule) => rule.agent === agentDomain && rule.task === taskDomain,
  );
  const severity: 'HIGH' | 'LOW' = isHigh ? 'HIGH' : 'LOW';

  // Suggest a better agent based on task domain
  const DOMAIN_TO_SUGGESTED_AGENT: Partial<Record<AgentDomain, string>> = {
    'system': 'architect',
    'cli': 'architect',
    'react': 'frontend-designer',
    'test': 'ci-guardian',
    'doc': 'doc-writer',
    'devops': 'devops-engineer',
    'security': 'security-auditor',
    'data': 'data-engineer',
  };

  const suggestedAgent = DOMAIN_TO_SUGGESTED_AGENT[taskDomain];

  if (severity === 'HIGH') {
    debugLog(
      'persona-match',
      `HIGH mismatch: agent '${agent.id}' (domain='${agentDomain}') on task domain='${taskDomain}' — suggested='${suggestedAgent ?? 'none'}'`,
    );
  }

  return {
    valid: severity !== 'HIGH',
    severity,
    mismatch: [`agent domain '${agentDomain}' vs task domain '${taskDomain}'`],
    suggestedAgent,
  };
}

/**
 * Post-selection persona-domain check.
 * Call this after selectAgent() / routeTaskV2() to rotate agents with HIGH domain mismatches.
 *
 * Returns the same agentId if valid, or the suggestedAgent if HIGH mismatch detected.
 * Wire point for sprint-planner.ts (see Sprint 197 task 197-005).
 */
export function applyPersonaDomainCheck(
  selectedAgentId: string,
  task: Pick<Task, 'scope'>,
  pool: Map<string, AgentDefinition>,
): { agentId: string; rotated: boolean; reason?: string } {
  if (selectedAgentId === 'generic') {
    return { agentId: 'generic', rotated: false };
  }

  const agent = pool.get(selectedAgentId);
  if (!agent) {
    return { agentId: selectedAgentId, rotated: false };
  }

  const result = validatePersonaTaskMatch(agent, task);
  debugLog(
    'persona-match',
    `Agent '${selectedAgentId}': valid=${result.valid}, severity=${result.severity ?? 'none'}, suggested=${result.suggestedAgent ?? 'none'}`,
  );

  if (!result.valid && result.severity === 'HIGH' && result.suggestedAgent) {
    debugLog(
      'persona-match',
      `Rotating '${selectedAgentId}' → '${result.suggestedAgent}' (HIGH domain mismatch)`,
    );
    return {
      agentId: result.suggestedAgent,
      rotated: true,
      reason: result.mismatch?.[0] ?? 'domain mismatch',
    };
  }

  return { agentId: selectedAgentId, rotated: false };
}

// ─── Sprint 196 WP-2: FIX Worker Idempotency Mode Inference ────────────────

/**
 * Infer the fix mode for a FIX worker based on the previous task result.
 *
 * - verify-only: previous worker output appears correct (DONE + high rubrics, no boundary violation)
 * - amend: partial work or boundary violation — add missing tests/files (safest default)
 * - re-implement: code defect detected (NO_GO + tests failed)
 *
 * This makes FIX task intent deterministic rather than relying on the FIX worker
 * to guess whether the previous attempt was close or fundamentally broken.
 */
export function inferFixMode(result: TaskResult): 'verify-only' | 'amend' | 're-implement' {
  const notes = result.notes ?? '';
  const rs = result.rubricScores;

  const hasBoundaryViolation = /boundary.?violation|scope.?violation|BOUNDARY_VIOLATION/i.test(notes);

  if (result.selfAssessment === 'DONE' && !hasBoundaryViolation) {
    const allRubricHigh =
      rs !== undefined &&
      (rs.correctness ?? 0) >= 90 &&
      (rs.test_coverage ?? 0) >= 90 &&
      (rs.scope_compliance ?? 0) >= 90;
    if (allRubricHigh) return 'verify-only';
  }

  if (result.selfAssessment === 'NO_GO' && !result.testsPassed) {
    return 're-implement';
  }

  return 'amend';
}


/** U1-G2: split a `- Meta:` body on top-level ';' honoring the writer's '\;' escapes. */
function splitEscapedPairs(body: string): string[] {
  const out: string[] = [];
  let cur = '';
  for (let i = 0; i < body.length; i++) {
    const ch = body[i]!;
    if (ch === '\\' && body[i + 1] === ';') { cur += ';'; i++; continue; }
    if (ch === ';') { out.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}
