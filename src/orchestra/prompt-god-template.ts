// ─── Prompt God Template ────────────────────────────────────────────────────
// Single entry point for building worker prompts.
// Pipeline: classifyTaskType → selectAgent → selectSkills → selectRelevantAdrs
//           → sanitizeScope → renderSegments → (optional leading-T0 reorder) → PromptArtifact
//
// Sprint 146 — Task 146-005 · tier segmentation Sprint 330 — Task 330-019

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import type { ProductionWiringPlanEvidence, RunPolicyPlanAuthority, Task, TaskScope } from '../core/task-types.js';
import { createPromptCompilePlan, type PromptCompilePlan, type ScopedVerificationCommand } from '../core/prompt-compile-plan.js';
import { compileCanonicalScope } from '../core/execution-write-scope-policy.js';
import {
  renderWorkerActivityHeartbeatInstruction,
  type WorkerActivityBackend,
} from '../core/worker-activity-heartbeat.js';
import {
  PRODUCTION_WIRING_EVIDENCE_VERSION,
  createGoNoGoCriterionItem,
  createProductionWiringPlanEvidence,
  PRODUCTION_WIRING_PLAN_EVIDENCE_V2_VERSION,
} from '../core/task-types.js';
import type { GoNoGoCriterionItem } from '../core/task-types.js';
import {
  resolveProductionWiringContract,
  type ProductionWiringContract,
  type ProductionWiringEvidence,
} from '../core/production-wiring-contract.js';
import type { MemoryEntryV2 } from '../core/memory-types.js';
import type { MemoryReadEntryV1 } from '../core/memory-read-contract.js';
import { selectRelevantAdrs, buildAdrPromptSection } from './adr-selector.js';
import { personaCoreBody, selectGuidanceSlice } from '../core/persona-guidance.js';
import type { ModelTier } from '../core/model-equivalence.js';
import { evaluateScopeGate } from '../core/scope-gate.js';
import { mirrorTestPath } from '../core/task-builder-scope.js';
import { renderWorkerDodChecklist } from '../core/worker-dod-contract.js';
import type { ManagedContractInspection } from '../core/workspace-artifact-contract.js';
import type { ToolAllowlistResult } from '../core/tool-allowlist.js';
import { sanitizeReadScope, sanitizeScope } from './scope-sanitizer.js';
import { truncateAtParagraph, logInjectionAudit } from './task-builder.js';
import { detectTaskType } from './rubric-registry.js';
import type { ResolvedVerifyCommands } from './worker-verify-tool.js';
import {
  reorderLeadingT0,
  stablePrefixKey,
  DEFAULT_LEADING_T0_REORDER,
  DEFAULT_PROMPT_TENANT_ID,
  SEGMENT_SEPARATOR,
  type PromptTier,
  type PromptSegment,
  type PromptSegmentKind,
} from './prompt-segmentation.js';
// 593-002: THE canonical task-class classifier. The compiler's three former inline
// predicates (core-system-prompt / scope-block / verify-tier) all delegate here.
import {
  resolveTaskPromptProfile,
  type TaskProfileConfig,
  type TaskProfileSignals,
  type TaskPromptProfile,
} from '../core/work-model.js';

// ─── Public Types ──────────────────────────────────────────────────────

export interface PromptArtifact {
  prompt: string;
  metadata: {
    agent: string;
    skills: string[];
    adrIds: string[];
    scopeWarnings: string[];
    charCount: number;
    estimatedTokens: number;
  };
}

/**
 * A compiled worker prompt plus its tier-tagged segmentation (Sprint 330 330-019).
 *
 * Superset of {@link PromptArtifact}: `segments` carries the ordered T0/T1/T2
 * {@link PromptSegment}s the prompt was assembled from, so the provider-agnostic
 * prompt cache can key on the byte-stable prefix while only the volatile tail
 * varies. `prompt` is exactly `segments.map(s => s.content).join('\n\n')`.
 */
export interface SegmentedPrompt {
  compilePlan: PromptCompilePlan;
  planId: string;
  prompt: string;
  segments: PromptSegment[];
  metadata: PromptArtifact['metadata'];
  /**
   * 593-002 — the canonical task-class this prompt was composed for
   * (`resolveTaskPromptProfile`): the SAME value that selected the verify-steps /
   * npm-advisory / read-only-discipline composition.
   */
  promptProfile: TaskPromptProfile;
  /**
   * 593-002 — the provider-agnostic prompt-cache key for this prompt's byte-stable
   * (T0+T1) prefix: `stablePrefixKey(tenantId, '<profile>::<agent>')`. Purely
   * derived metadata; it never changes the compiled prompt.
   */
  cachePrefixKey: string;
}

/**
 * Minimal sprint context needed for prompt generation.
 * Callers construct this from their available data.
 */
export interface SprintContext {
  /** Explicit authority root for prompt-side observations; absent means pure compilation. */
  projectRoot?: string;
  /** Host-bound identity for the one-write worker activity projection. */
  heartbeatIdentity?: {
    readonly attemptId: string;
    readonly backend: WorkerActivityBackend;
  };
  /** Precompiled authority; absent callers compile exactly once at this entrypoint. */
  compilePlan?: PromptCompilePlan;
  /** Agent prompt content (full PROMPT.md text) */
  agentPrompt?: string;
  /** Agent ID assigned to this task */
  agentId?: string;
  /** Skill prompts to inject */
  skillPrompts?: Array<{ name: string; content: string }>;
  /**
   * Deterministic project-context segment (auto-generated conventions content).
   * Always-on data injected for every worker — NOT a skill: it never enters
   * routing or stats (CATALOG-STATS-AUTHORITY-001 correction, 2026-08-17).
   */
  projectContext?: string;
  /** All accepted ADR entries from memory store */
  allAdrs?: MemoryEntryV2[];
  /** Scoped selections with their read-service authority classification. */
  memoryAdrs?: readonly MemoryReadEntryV1[];
  /** Whole-unit, bounded memory context selected by the host read service. */
  memoryContext?: string;
  /** Digest binding the exact bounded memory selection rendered above. */
  memorySelectionRevisionDigest?: string;
  /** Caller-resolved presentation labels for canonical scoped memory. */
  memoryLabels?: {
    readonly contextHeading: string;
    readonly revision: string;
    readonly unavailable: string;
  };
  /** Worker effort level */
  effort?: 'max' | 'high' | 'medium' | 'low';
  /** Registry-resolved model tier used only to add tier-appropriate guidance. */
  modelTier?: ModelTier;
  /** Dependencies info (task IDs this task depends on) */
  dependencies?: string[];
  /** Directory containing `.tasks/` result files (defaults to `<cwd>/.tasks`). Used for enriching dependency block. */
  tasksDir?: string;
  /** Host-verified digest state for the managed WORKER-GUIDE contract. */
  workerGuideContract?: ManagedContractInspection;
  /** Host-evaluated, lineage-aware dependency evidence collected by the prompt caller. */
  dependencyResults?: ReadonlyMap<string, DependencyResultEntry>;
  /**
   * Minimum ADR relevance score required to include an ADR in the prompt
   * (Sprint 182 PQ-5 / F7). ADRs scoring below this threshold are dropped.
   * When every selected ADR is filtered out the entire mandatory rules block
   * (including its header) is omitted. Defaults to {@link DEFAULT_ADR_MIN_RELEVANCE}
   * when unset. Resolved from `config.prompt.adr_min_relevance` at the call site.
   */
  adrMinRelevance?: number;
  /**
   * Notes other workers shared via SharedMemory (Sprint 278 COMM-1 / 278-003).
   *
   * Populated by the caller ONLY when `worker_comms.enabled && inject_shared`;
   * the gating lives at the call site (task-builder), so when this is undefined
   * or empty the rendered prompt is byte-for-byte identical to the pre-COMM-1
   * output. Rendered by {@link buildSharedContextBlock} into a block appended at
   * the very END of the prompt (most task-specific region) so the shared
   * Skills→Agent→ADR cache prefix is never split (F1-TOK lesson).
   */
  sharedContext?: SharedContextEntry[];
  /**
   * Executed upstream handoffs targeting this task (Sprint 278 COMM-1 / 278-004).
   *
   * Populated by the caller ONLY when `worker_comms.enabled && inject_handoffs`;
   * the gating lives at the call site (task-builder), so when this is undefined
   * or empty the rendered prompt is byte-for-byte identical to the pre-COMM-1
   * output. Rendered by {@link buildHandoffBlock} into a block appended at the
   * very END of the prompt (next to the Shared Context block, most task-specific
   * region) so the shared Skills→Agent→ADR cache prefix is never split.
   */
  upstreamHandoffs?: UpstreamHandoffEntry[];
  /**
   * Whether `worker_comms.enabled` is true for this sprint (Sprint 278 COMM-1 / 278-006).
   *
   * When true, the worker prompt receives a short instruction block explaining
   * how to populate `sharedNotes` and `handoffNotes` in the `.result` file.
   * Set by the caller (task-builder) from `config.worker_comms?.enabled`.
   * When absent or false the instruction block is omitted entirely — the
   * rendered prompt is byte-for-byte identical to the pre-COMM-1 output.
   * Rendered by {@link buildWorkerCommsInstructionBlock} and appended at the
   * very END of the prompt (after sharedBlock and handoffBlock) so the shared
   * Skills→Agent→ADR cache prefix is never split (F1-TOK lesson).
   */
  workerCommsEnabled?: boolean;
  /**
   * Live count of pre-existing test failures at THIS sprint's baseline (WP-14).
   *
   * Sourced by the caller (task-builder `buildWorkerPrompt`) from the sprint
   * baseline snapshot (`readBaseline(projectRoot, sprintId).fail`, written by the
   * sprint controller at sprint start). Feeds the CRITICAL VERIFY STEPS note so
   * the worker is told the REAL pre-existing-failure count instead of a stale
   * hardcoded "~67" (ADR-070 zero-hardcode): a green suite that still cites "~67"
   * lets a worker dismiss failures it actually introduced. `undefined` when no
   * baseline was captured → the note warns generically without inventing a count.
   */
  preExistingFailures?: number;
  /**
   * One-line host tool inventory probed at sprint start (TT555 — task 421-002,
   * waste-class (d)). Sourced by the caller from
   * `formatToolInventory(probeToolInventory())` (worker-verify-tool.ts) — the
   * probe is a side-effecting PATH check that MUST stay out of this pure,
   * deterministic compiler, so it is injected as a resolved string exactly like
   * {@link SprintContext.preExistingFailures}. Rendered by {@link buildEnvProbeBlock}
   * into an `env-probe` block (e.g. `python3=yes docker=no rg=yes`) so a worker
   * does not burn a trial-and-error turn discovering an absent tool. `undefined`
   * (the default until a caller wires it) → NO block, so the compiled prompt is
   * byte-for-byte identical to the pre-TT555 output and every prompt pin holds.
   */
  toolInventory?: string;
  /**
   * Stack-resolved check/test commands (born-670b WIRE-VERIFY, task 427-012).
   *
   * Sourced by the caller from `resolveVerifyCommands(projectRoot)`
   * (worker-verify-tool.ts) — that resolution reads the project's stack
   * config off disk (`detectFullStack`), so it MUST stay out of this pure,
   * deterministic compiler and is injected as an already-resolved value,
   * exactly like {@link SprintContext.toolInventory}. When present, the
   * CRITICAL VERIFY STEPS block cites these EXACT commands instead of a
   * generic multi-language examples list, so a worker never burns a
   * verify-loop turn on a wrong-for-stack guess (555 goal). `undefined`
   * (the default until a caller wires it) → the legacy generic-examples
   * text, byte-identical to the pre-427-012 prompt.
   */
  verifyCommands?: ResolvedVerifyCommands;
  /** PCOMP-6 D1a: plan-time-resolved exact targeted-test set (resolveTargetedTestPaths). */
  targetedTestPaths?: readonly string[];
  /**
   * Task-scoped worker tool allowlist (born-664 / 559, task 427-014 ALLOW-WIRE).
   *
   * The resolved {@link ToolAllowlistResult} from `computeToolAllowlist`
   * (`src/core/tool-allowlist.ts`) — a PURE, deterministic selection of the
   * narrowed tool surface for THIS task. Sourced by the caller (task-builder.ts
   * `buildWorkerPrompt`) ONLY when `config.tools.allowlist_enabled` is true; that
   * config flag, the LIVE tool universe (native tools + connectors/MCP), and the
   * per-task compute all live at the call site — out of this pure compiler, exactly
   * like {@link SprintContext.toolInventory} / {@link SprintContext.verifyCommands}.
   * When present, {@link buildToolAllowlistBlock} renders a narrowed-surface block.
   * `undefined` (the default until the caller wire lands — the flag is default-OFF)
   * → NO block, so the compiled prompt is byte-for-byte identical to the
   * pre-427-014 output and every prompt pin (prompt-determinism / prompt-segmentation
   * protected-set + stable-prefix) holds.
   *
   * NOTE — real enforcement injection point: this block only DESCRIBES the surface to
   * the worker. The surface is actually ENFORCED by the provider CLI `--allowedTools`
   * flag, built from a task's write scope by `resolveAllowedTools`
   * (spawn-backend-docker.ts) and the sprint-spawner / scheduler-effects / spawn.ts
   * mirrors → provider `buildCommand` (claude.ts). Making that flag honor the
   * computed allowlist is out of this task's write scope (a tracked follow-up).
   */
  toolAllowlist?: ToolAllowlistResult;
  /**
   * Persona render mode for the agent block (ADR-G-027 U4 — task 443-003).
   *
   * Mirrors `config.prompt.persona_render` (`src/core/config-types.ts`). 'guidance':
   * {@link buildAgentBlock} renders the task's intent-matched {@link selectGuidanceSlice}
   * slice + a `[full persona: <path>]` pointer instead of the full PROMPT.md body — an
   * agent whose PROMPT.md carries no guidance markers at all still falls back to the
   * full body (no content ever dropped from the render, per ADR-G-027 no-truncation).
   * `undefined`/'full' →
   * full body, byte-identical to the pre-443-003 output. Threading `config.prompt.
   * persona_render` into this field is owned by the task-builder call site; this
   * compiler only needs to OBEY the resolved value.
   */
  personaRenderMode?: 'full' | 'guidance';
  /**
   * Leading-T0 cache reorder (Sprint 330 330-019 — provider-agnostic prompt cache).
   *
   * Production-default ON ({@link DEFAULT_LEADING_T0_REORDER}). The explicit
   * `false` value is a compatibility escape hatch. When enabled, the
   * compiled prompt is reassembled so the global (T0) then project (T1) tiers lead
   * contiguously — maximising the byte-stable prefix a provider cache can share
   * across tasks. When false, the legacy assembly order is preserved for rollback.
   */
  leadingT0Reorder?: boolean;
  /**
   * 7094-F3 (flag-gated, default TRUE — `prompt.worker_core_system_prompt`):
   * the task-invariant T0 cognitive-anchor blocks (karpathy/turn-economy/
   * pipe-exit/artifact-reuse + npm-advisory) are EXTERNALIZED to a stable
   * system-prompt file (`claude --system-prompt-file …`) and therefore
   * skipped here, so the stdin prompt carries only task-specific content.
   * The externalized content comes from {@link buildWorkerCoreSystemPrompt} —
   * the SAME constants, one source. Never blind-default-on (F2a lesson:
   * composition changes are measured, not assumed).
   */
  coreExternalized?: boolean;
  /**
   * The repo's tracked files (`git ls-files`) at sprint time — F2.1b.
   *
   * When present and non-empty, {@link buildScopeBlock} splits the WRITE authority
   * list into worker-facing sub-lists (Existing / New / ⚠ Unverified) using the same
   * pre-spawn scope-gate classifier ({@link evaluateScopeGate}), so the prompt tells
   * the worker which paths already exist (modify, don't recreate) versus which are
   * genuinely new versus which look like a typo/wrong-dir (confirm or STOP+NO_GO —
   * the sprint-380 / born-573 orphan-file mode). Populated best-effort by the caller
   * (task-builder). Absent/empty → the flat legacy list is rendered byte-for-byte,
   * so every existing caller and the prompt-determinism guard are unaffected.
   */
  trackedFiles?: string[];
  /** Digest-bound execution directive for an approved exact RunFlow. */
  exactExecutionAuthority?: WorkerExactExecutionAuthority;
  /**
   * 593-002 — resolved `prompt.task_profiles` (`config.prompt.task_profiles`).
   *
   * Threaded by the caller exactly like {@link SprintContext.adrMinRelevance}: this
   * compiler stays pure and only OBEYS the resolved value. `undefined` (today's
   * default until the task-builder call site wires it) → `DEFAULT_TASK_PROFILES`,
   * i.e. the literals the pre-593-002 inline predicates carried, so the compiled
   * prompt is byte-for-byte unchanged.
   */
  taskProfiles?: Partial<TaskProfileConfig>;
  /**
   * 593-002 — tenant identifier for the prompt-cache prefix key.
   *
   * Feeds {@link stablePrefixKey} together with the resolved
   * {@link TaskPromptProfile} (the task-class discriminator). `undefined` →
   * {@link DEFAULT_PROMPT_TENANT_ID} (single-tenant local runs). Affects only the
   * returned `cachePrefixKey` metadata — never a single byte of the prompt.
   */
  tenantId?: string;
}

const HEARTBEAT_IDENTITY_HOLD = 'HEARTBEAT_IDENTITY_HOLD: attemptId/backend were not host-bound. Do not write an ambiguous legacy heartbeat or infer identity from its filename.';

/**
 * Replaces the compile-time HOLD only after the spawn boundary has obtained the
 * host's durable attempt identity. This deliberately reuses the canonical
 * worker-activity renderer rather than introducing a second identity shape.
 */
export function bindWorkerPromptHeartbeatIdentity(
  prompt: string,
  identity: {
    readonly taskId: string;
    readonly workerId: string;
    readonly attemptId: string;
    readonly backend: WorkerActivityBackend;
  },
): string {
  if (!prompt.includes(HEARTBEAT_IDENTITY_HOLD)) return prompt;
  return prompt.replace(
    HEARTBEAT_IDENTITY_HOLD,
    renderWorkerActivityHeartbeatInstruction(identity),
  );
}

export interface WorkerExactExecutionAuthority {
  readonly flowId: string;
  readonly revision: number;
  readonly planDigest: string;
  readonly sourceKind: 'intent' | 'directives' | 'unavailable';
  readonly sourceContentSha256?: string;
  readonly directivesProjection:
    | 'MATCHED_CONTENT_ADDRESSED_POINTER'
    | 'EXCLUDED_SOURCE_KIND'
    | 'EXCLUDED_DIGEST_MISMATCH'
    | 'EXCLUDED_MISSING'
    | 'EXCLUDED_AUTHORITY_UNAVAILABLE';
  readonly observedDirectivesSha256?: string;
}

/**
 * Run-policy authority now lives ON the task (`task.runPolicy`,
 * {@link RunPolicyPlanAuthority} — RUN-POLICY-DELIVERY-001 closing the 486-017
 * producer). Task-carried like `task.productionWiring` (487-026), so the block
 * renders identically on every ingress that compiles this task — the original
 * attempt and every FIX/retry attempt — and can never be gated off by caller
 * wiring drift. The digest is the addressing mechanism: constraints are bounded
 * summaries, never raw source bytes (486-017 NO-GO: unbounded prompt dump).
 * Kept as an exported alias for the historical 486-017 name.
 */
export type RunPolicyAuthority = RunPolicyPlanAuthority;

/**
 * A single inter-worker shared-context entry (Sprint 278 COMM-1 / 278-003).
 * Sourced from a {@link SharedMemory} write performed by another worker:
 * `key`/`writerId` come from the store, `value` is the stringified payload.
 */
export interface SharedContextEntry {
  /** SharedMemory key the upstream worker wrote under. */
  key: string;
  /** Task id of the worker that wrote the entry. */
  writerId: string;
  /** Stringified shared value. */
  value: string;
}

/**
 * A single executed upstream handoff targeting this task (Sprint 278 COMM-1 / 278-004).
 * Sourced from a {@link HandoffProtocol} `ready` handoff whose `toTaskId` is the
 * current task. Decoupled from the `Handoff` shape on purpose (same precedent as
 * {@link SharedContextEntry} vs SharedMemory) so this module stays free of
 * orchestra cross-imports.
 */
export interface UpstreamHandoffEntry {
  /** Task id of the upstream worker that produced the handoff. */
  fromTaskId: string;
  /** Artifact paths carried by the handoff (relative to project root). */
  artifacts: string[];
  /** Free-text message from the upstream worker (Task 5 `handoffNotes`), if any. */
  notes?: string;
}

// ─── Constants ─────────────────────────────────────────────────────────

/** Rough estimate: 1 token ≈ 4 chars for English/mixed text */
const CHARS_PER_TOKEN = 4;

/**
 * Concise, provider-agnostic Karpathy 4-discipline anchor injected into every
 * worker prompt. Replaces the former full `karpathy-discipline.md` document
 * append (~2.1K tokens/worker): the full depth still reaches Claude workers via
 * the `.claude/rules` project context and every worker via the per-skill
 * "Karpathy Notes" sections, so this short anchor preserves the cognitive
 * effect at a fraction of the token cost — uniformly across Claude/Codex/Gemini.
 */
const KARPATHY_ESSENCE = `## Karpathy Discipline
1. **Think before coding** — read the scope + ADRs, plan first, name your assumptions.
2. **Simplicity first** — reuse existing patterns; YAGNI; no premature abstraction.
3. **Surgical changes** — stay inside scope.filesWrite; minimum-diff; preserve existing behavior.
4. **Goal-driven** — map every change to the goCriteria above; assess yourself honestly.`;

/** Role-resolved replacement for the editing discipline on inspection-only work. */
const READ_ONLY_DISCIPLINE_BLOCK = `## Read-Only Role Policy
1. **Think before inspecting** — read the scope + binding/background ADR state, name assumptions, and map observed evidence to the goCriteria.
2. **Stay bounded** — batch independent reads/checks and inspect only authorized filesRead targets. This overrides persona prose asking you to read callers/callees: never inspect a caller or callee outside the rendered read scope.
3. **Preserve the project** — do not create or modify project files; only the separately named worker-lifecycle artifacts may be written.
4. **Report honestly** — a worker \`.result\` is an ingress claim, never audit evidence. Require the host to re-derive every measurable claim from its disk diff and captured command output; an unproven criterion is never DONE.
5. Produce each NEW output file in ONE Write call. Never grow a file through chained Write/Edit turns or re-open it merely to confirm a successful write.
6. A simple single-deliverable inspection is TWO turns total: turn 1 = heartbeat + complete batched evidence collection; turn 2 = the result file. Preserve command exit status: NEVER pipe an evidentiary check to \`tail\`/\`head\`; in bash read \`\${PIPESTATUS[0]}\`, or run it unpiped and read \`$?\` on the NEXT line.`;

/**
 * Turn-economy behavioral directive (born-636-K1, Sprint 407 Task 407-002).
 *
 * born-636 measured a code task at $2.38 total, $1.05 (44%) of which was
 * cacheRead across ~25-30 turns × ~135k context — TURN COUNT, not per-turn
 * token size, is the dominant cost multiplier. This is a prompt-layer-only
 * behavioral fix: a compact, task-invariant directive on tool-call batching
 * and verify-loop discipline. Static (no task.id interpolation) and
 * unconditional — unlike {@link NPM_ADVISORY_BLOCK}, which is skipped for
 * doc-only tasks, this block applies to EVERY task (doc or code) since
 * batching read/search tool calls is universally relevant. Impact is
 * measured by future sprints' num_turns average (Brain-tracked); this
 * constant is the prompt-layer evidence, not a behavior claim.
 */
const TURN_ECONOMY_BLOCK = `## Turn Economy
Every conversation turn re-sends cached context — fewer turns beats fewer tokens per turn.
1. Batch independent read/search tool calls (Read + Grep + Glob) into the SAME turn — never issue them one-by-one across turns when none depends on another's output.
2. Do not re-read a file already in your context unless its on-disk state changed since your last read.
3. Run lint/build + targeted tests once per logical block of edits, not after every micro-edit — the max-3-attempt verify rule above already caps retries; do not burn turns on early, incomplete verify runs.
4. Plan silently before your first edit (Karpathy #1) — 7094-F1d: no separate plan file is written; gather every target file's content in ONE turn (parallel reads) before you start editing.
5. Produce each NEW output file in ONE Write call — compose the complete content silently first, then write it once. Never grow a file through a chain of Write-then-Edit turns, and never re-open a file you just wrote to check it: the successful Write result IS the confirmation (7094-F4: every extra authoring turn replays the full cached context at cost).
6. A simple single-deliverable task is TWO turns total: turn 1 = heartbeat + the complete deliverable (batched writes); turn 2 = the result file. Aim for that shape whenever the task allows it.`;

const ECONOMY_TIER_TURN_GUIDANCE = `7. Economy-tier discipline: use fewer, broader tool-call batches and terminate as soon as the complete goCriteria evidence is available; do not spend an extra turn restating or re-checking already proven facts.`;

function buildTurnEconomyBlock(modelTier: ModelTier | undefined): string {
  return modelTier === 'economy'
    ? `${TURN_ECONOMY_BLOCK}\n${ECONOMY_TIER_TURN_GUIDANCE}`
    : TURN_ECONOMY_BLOCK;
}

/**
 * Pipe-exit honesty directive (TT555 — task 421-002, waste-class (a)).
 *
 * trace-audit 555 (413-001/003 live): a worker piped a failing check through a
 * pager (`cmd 2>&1 | tail`); the shell reports the PIPELINE's exit status — the
 * pager's 0 — so the failure surfaced as `is_error:false` and the worker burned
 * a whole turn re-running it. This compact, task-invariant T0 directive teaches
 * the un-masked read (`${PIPESTATUS[0]}` / separate-line `$?`).
 *
 * born-670b (WIRE-VERIFY, task 427-012) — YALANCI-PROMPT fix: this block used
 * to also offer "call verify_task" as a third alternative. `verify_task` is a
 * TS function (worker-verify-tool.ts), never a tool registered on the actual
 * worker-facing surface (e.g. claude-CLI's tool list) — telling every worker
 * it can "call" a tool that does not exist on its surface is exactly the
 * lying-prompt failure mode this fix kills. The block now points at the
 * VERIFY STEPS section instead (the heading that actually exists in every
 * prompt, code or doc-only), which for code tasks (same task, part (a)) now
 * cites this project's concrete, stack-resolved check/test commands.
 *
 * Pinned by tests/orchestra/verify-commands-prompt.test.ts so it cannot
 * silently regrow a non-existent-tool reference. Concatenated into the shared
 * 'karpathy' T0 segment next to {@link TURN_ECONOMY_BLOCK} (same
 * closed-registry-kind rationale) — not a new PromptSegmentKind.
 */
const PIPE_EXIT_BLOCK = `## Pipe-Exit Honesty
A failing command piped to a pager (\`cmd | tail\`) reports the PIPE's exit code — the pager's 0 — so a real failure reads back as \`is_error:false\` and you burn a turn. NEVER pipe a check to \`tail\`/\`head\`. Read the TRUE code: bash \`\${PIPESTATUS[0]}\`, or run the command unpiped and read \`$?\` on the NEXT line — see the VERIFY STEPS section below for this task's exact commands.`;

/**
 * Artifact-reuse directive (TT555 — task 421-002, waste-class (c)).
 *
 * 413-002/003 re-ran `npm pack` / build inside the same sprint, regenerating an
 * artifact an earlier task had already produced. This is the RULE half (the
 * mechanism — a real artifact cache under `.tasks/artifacts/<sprint>/` — is
 * born-660-continuation work): tell the worker to reuse an existing artifact
 * rather than regenerate it. Task-invariant → folded into the 'karpathy' T0
 * segment alongside {@link PIPE_EXIT_BLOCK}.
 */
const ARTIFACT_REUSE_BLOCK = `## Artifact Reuse
If a pack/build artifact already exists under \`.tasks/artifacts/<sprint>/\`, REUSE it — do not re-run \`npm pack\`/build to regenerate an artifact an earlier task in this sprint already produced.`;

/**
 * Dependency-mutation advisory (born-454, sprint-356 live incident). The worker
 * NEVER mutates node_modules/lockfiles itself; a genuine dependency need is
 * escalated through the file-based worker→Brain question channel
 * (`.tasks/task-<id>.question`, `[NPM-ADVISORY]` marker — answered fail-closed
 * by {@link import('./ipc-registry.js').handleWorkerQuestion}). Static content
 * (no task.id interpolation) so it stays in the shared T0 cache prefix; the
 * worker substitutes its own task id, already stated in its Task/Heartbeat
 * sections. Backend-agnostic on purpose: the destroyed-binding failure mode is
 * docker-mount specific, but unauthorized dependency mutation is out of scope
 * in every backend.
 */
/**
 * 593-002 — the compiler's projection of a {@link Task} onto the canonical
 * task-class signals consumed by {@link resolveTaskPromptProfile}.
 *
 * Full signal set: scope shape (inspection-only) + declared `task.type` +
 * the injected legacy fallback. `detectTaskType` (rubric-registry) is passed in
 * rather than imported by core/ — ADR-D-004 C1 (core must not import orchestra).
 */
function taskProfileSignals(task: Task): TaskProfileSignals {
  return {
    type: task.type,
    scope: task.scope,
    fallbackDocOnly: () => detectTaskType(task) !== 'code-development',
  };
}

/**
 * 593-002 — the DOC-vs-CODE axis only: the same canonical classifier fed WITHOUT
 * the scope signal.
 *
 * Deliberate, not an oversight: the verify-tier branch (`isDocOnlyTask`) and the
 * read-only branch (`isInspectionOnlyTask`) are two INDEPENDENT booleans in
 * {@link renderSegments} (a doc-kind task with a read-only scope is both), and
 * collapsing them into one profile would flip `verificationMode` for that task.
 * Omitting the scope signal reproduces the legacy predicate exactly while still
 * resolving through the single SSOT.
 */
function taskDocProfileSignals(task: Task): TaskProfileSignals {
  return {
    type: task.type,
    fallbackDocOnly: () => detectTaskType(task) !== 'code-development',
  };
}

/**
 * 7094-F3 — the task-invariant worker CORE as a standalone system prompt.
 *
 * Renders the SAME constants the inline T0 path pushes (one source, two
 * projections — the F2a WORKER_TOOL_NAMES precedent): karpathy + turn-economy
 * + pipe-exit + artifact-reuse, plus the npm advisory for code-class tasks.
 * Consumed by the docker spawn path when `prompt.worker_core_system_prompt`
 * is on: the content rides `claude --system-prompt-file <file>` while
 * `ctx.coreExternalized` suppresses the duplicate inline blocks. Variants
 * mirror the inline classifier exactly: inspection-only tasks get the
 * read-only discipline, doc-only tasks drop the npm advisory.
 */
export function buildWorkerCoreSystemPrompt(
  task: Task,
  taskProfiles?: Partial<TaskProfileConfig>,
): string {
  const profile = resolveTaskPromptProfile(taskProfileSignals(task), taskProfiles);
  if (profile === 'inspection-only') return READ_ONLY_DISCIPLINE_BLOCK;
  const core = `${KARPATHY_ESSENCE}\n\n${TURN_ECONOMY_BLOCK}\n\n${PIPE_EXIT_BLOCK}\n\n${ARTIFACT_REUSE_BLOCK}`;
  return profile === 'doc-only' ? core : `${core}\n\n${NPM_ADVISORY_BLOCK}`;
}

const NPM_ADVISORY_BLOCK = `## Dependency-Mutation Advisory (npm / yarn / pnpm)
NEVER run a package-manager command that mutates node_modules or a lockfile in this workspace: \`npm install\`, \`npm ci\`, \`npm rebuild\`, \`npm update\`, \`npm prune\`, \`npm dedupe\`, \`npm link\`, or any yarn/pnpm equivalent. The workspace is mounted from the host — your environment's ABI differs from the host's, and repo .npmrc settings (e.g. \`ignore-scripts=true\`) silently destroy native bindings for every process that shares node_modules. This has caused a real production incident (a worker's \`npm install\` deleted the better-sqlite3 native binding and took down all database access host-wide).

If your task genuinely requires a dependency change, escalate it instead of running it:
1. Write \`.tasks/task-<your-task-id>.question\` with this JSON shape:
   {"taskId": "<your-task-id>", "workerId": "w-<your-task-id>", "question": "[NPM-ADVISORY] <package + one-line why>", "context": "<what the task needs it for>", "suggestedAction": "continue", "timestamp": "<ISO-8601 now>"}
2. Poll \`.tasks/task-<your-task-id>.answer\` for up to 60 seconds, then delete both files after reading (or on timeout).
3. Whatever the answer says: do NOT run the install yourself. Continue the task without the dependency change, record the need in your .result \`notes\` on a line starting with \`npmAdvisory:\`, and self-assess honestly — GO_WITH_TECH_DEBT if the core criteria are still met without it, NO_GO if the task is impossible without it.
The orchestrator (Brain) surfaces your advisory to the human operator, and any actual dependency mutation is performed host-side, never inside a worker.`;

/**
 * Default minimum ADR relevance score (Sprint 182 PQ-5 / F7).
 *
 * Threshold below which ADRs are dropped from the worker prompt's mandatory
 * rules block. Lenient (0.3) so that scope-only or keyword-only matches still
 * surface, but the long tail of unrelated ADRs is filtered out. Mirrors
 * `DEFAULT_PROMPT_CONFIG.adr_min_relevance` in `src/core/config.ts`; the two
 * defaults must stay in lockstep so prompt rendering is consistent whether the
 * caller threads the config through or not.
 */
export const DEFAULT_ADR_MIN_RELEVANCE = 0.3;

/**
 * Sentinel sprintId when a task has no sprintId — keeps the key deterministic.
 * @internal
 */
const IDEMPOTENCY_SPRINT_FALLBACK = 'no-sprint';

/**
 * Compute the per-task idempotency key injected into the worker prompt
 * (Sprint 182 PQ-1 / F1).
 *
 * Locked format: `${sprintId}-${taskId}-${retryCount}` — deterministic so
 * two renders of the same task yield the same key (retry-safe external API
 * calls), but task-id-unique so different tasks never collide.
 *
 * `retryCount` is sourced from `task.routingMeta.rerouteCount` (mid-sprint
 * reroute counter — the runtime expression of "retry attempt" in deckent's
 * sprint loop); missing → 0. `sprintId` is required by the contract; when a
 * caller forgets to thread it through, fall back to a sentinel rather than
 * emit `undefined-…` into the key.
 */
export function computeIdempotencyKey(task: Task): string {
  const sprintId = task.sprintId ?? IDEMPOTENCY_SPRINT_FALLBACK;
  const retryCount = task.routingMeta?.rerouteCount ?? 0;
  return `${sprintId}-${task.id}-${retryCount}`;
}

// ─── Main API ──────────────────────────────────────────────────────────

/**
 * Build the complete worker prompt for a task.
 *
 * Single entry point that replaces inline prompt rendering.
 * Pipeline: classifyTaskType → build agent block → build skill block →
 *           selectRelevantAdrs (topN=3) → sanitizeScope → render template.
 */
function structuredCriteriaForTask(task: Task): GoNoGoCriterionItem[] {
  if (task.goNogo?.items?.length) return task.goNogo.items;
  // Compatibility for callers that invoke the pure compiler directly with a
  // pre-structured-artifact Task. Never split punctuation or infer boundaries:
  // each legacy display field remains one opaque criterion. The production
  // buildWorkerPrompt ingress migrates this shape before reaching the compiler.
  return [
    ...(task.goNogo?.goCriteria?.trim() ? [createGoNoGoCriterionItem({
      polarity: 'go', statement: task.goNogo.goCriteria,
      evidenceRequirements: [task.goNogo.goCriteria],
    })] : []),
    ...(task.goNogo?.noGoCriteria?.trim() ? [createGoNoGoCriterionItem({
      polarity: 'no-go', statement: task.goNogo.noGoCriteria,
      evidenceRequirements: [task.goNogo.noGoCriteria],
    })] : []),
  ];
}

/** Compile the sole immutable authority consumed by prompt rendering. */
export function compileTaskPromptPlan(task: Task, ctx: SprintContext): PromptCompilePlan {
  const compiledScope = compileCanonicalScope({ scope: task.scope, inventory: ctx.trackedFiles });
  if (!compiledScope.ok) throw new TypeError(
    `PROMPT_COMPILE_HOLD:CANONICAL_SCOPE:${compiledScope.holds.map(hold => `${hold.code}:${hold.field}:${hold.value}`).join('|')}`,
  );
  const canonicalScope = compiledScope.manifest.scope;
  const declared = task.verification?.commands ?? [];
  const verificationCommands: ScopedVerificationCommand[] = declared.map(command => ({
    command, scope: resolveTargetedTestPaths(task, ctx.trackedFiles),
  }));
  if (verificationCommands.length === 0 && !hasTaskScopedVerificationAuthority(task) && ctx.verifyCommands) {
    if (ctx.verifyCommands.check) verificationCommands.push({ command: ctx.verifyCommands.check, scope: [...canonicalScope.filesWrite] });
    const paths = resolveTargetedTestPaths(task, ctx.trackedFiles);
    if (ctx.verifyCommands.test && paths.length > 0) verificationCommands.push({
      command: `${ctx.verifyCommands.test} ${paths.join(' ')}`, scope: paths,
    });
  }
  return createPromptCompilePlan({
    criteria: structuredCriteriaForTask(task),
    verificationCommands,
    testApplicability: resolveTaskPromptProfile(taskDocProfileSignals(task), ctx.taskProfiles) === 'doc-only'
      ? 'NOT_APPLICABLE' : 'REQUIRED',
    scope: {
      directories: [...canonicalScope.directories],
      filesRead: [...canonicalScope.filesRead],
      filesWrite: [...canonicalScope.filesWrite],
    },
    rolePolicyIdentity: `worker:${ctx.agentId ?? task.assignedAgent ?? 'generic'}`,
  });
}

export function buildTaskPrompt(task: Task, ctx: SprintContext): PromptArtifact {
  const { prompt, metadata } = buildTaskPromptSegmented(task, ctx);
  return { prompt, metadata };
}

/**
 * Build the worker prompt AND its tier-tagged segmentation (Sprint 330 330-019).
 *
 * Identical pipeline to {@link buildTaskPrompt}, but returns the ordered
 * {@link PromptSegment}[] alongside the rendered prompt so the provider-agnostic
 * prompt cache (and the determinism / protected-set guards) can reason about the
 * T0/T1/T2 tiers. When `ctx.leadingT0Reorder` is set the segments are reassembled
 * leading-T0 for a longer shared cache prefix; otherwise the production assembly
 * order (skills first) is preserved byte-for-byte — `buildTaskPrompt` therefore
 * stays byte-identical to its pre-330-019 output on the default path.
 */
export function buildTaskPromptSegmented(task: Task, ctx: SprintContext): SegmentedPrompt {
  // Recompile the task-carried scope even when the caller supplies a compile
  // plan. Otherwise a stale/forged plan could bypass admission and let a raw
  // legacy wildcard reach the spawn prompt. The supplied plan remains the
  // authority for the other already-compiled fields, but its scope must be the
  // exact canonical projection of this task.
  const admissionPlan = compileTaskPromptPlan(task, { ...ctx, compilePlan: undefined });
  if (ctx.compilePlan
    && JSON.stringify(ctx.compilePlan.scope) !== JSON.stringify(admissionPlan.scope)) {
    throw new TypeError('PROMPT_COMPILE_HOLD:CANONICAL_SCOPE:COMPILE_PLAN_SCOPE_MISMATCH');
  }
  const compilePlan = ctx.compilePlan ?? admissionPlan;
  const effort = ctx.effort ?? 'medium';
  const agentId = ctx.agentId ?? task.assignedAgent ?? 'generic';
  const skillNames: string[] = [];
  const adrIds: string[] = [];
  const scopeWarnings: string[] = [];

  // ── 1. Agent Block ──────────────────────────────────────────────────
  // V3 selects persona slices in the same atomic routing decision as the
  // agent and skills. Prefer that decision over the legacy V2 task-DNA
  // intent so prompt compilation cannot silently diverge from routing.
  const agentBlock = buildAgentBlock(agentId, ctx.agentPrompt, {
    mode: ctx.personaRenderMode,
    intent: getTaskPersonaGuidanceKey(task),
  });

  // ── 2. Skill Block ──────────────────────────────────────────────────
  // F2 (Sprint 182 PQ-2): full skill content, no truncation, no effort-based clipping.
  // WP-17: drop any skill whose name matches the assigned agent (e.g. api-builder
  // exists as BOTH a vertical agent and a horizontal skill). The agent persona is
  // the authoritative one for the task; injecting the same-named skill on top just
  // double-spends tokens on ~40% overlapping content. Non-colliding skills stay.
  const dedupedSkillPrompts = dedupeAgentNamedSkills(ctx.skillPrompts, agentId);
  const skillBlock = buildSkillBlock(dedupedSkillPrompts, skillNames);

  // ── 2b. Project Context Block (deterministic, always-on data — not a skill) ─
  const projectContextBlock = buildProjectContextBlock(ctx.projectContext);
  const memoryContextBlock = ctx.memoryContext?.trim()
    ? `=== ${ctx.memoryLabels?.contextHeading ?? 'Relevant Project Memory'} ===\n${ctx.memoryContext}`
    : '';

  // ── 3. ADR Block (topN=3, relevance-scored) ─────────────────────────
  // Sprint 182 PQ-5 (F7): threshold-based filtering. ADRs below
  // `ctx.adrMinRelevance` (default DEFAULT_ADR_MIN_RELEVANCE) are dropped, and
  // if zero ADRs survive the entire block — header included — is omitted.
  const adrBlock = buildAdrBlock(
    task,
    ctx.allAdrs,
    adrIds,
    ctx.adrMinRelevance ?? DEFAULT_ADR_MIN_RELEVANCE,
    ctx.memoryAdrs,
    ctx.projectRoot,
  );

  // ── 4. Scope Rules (sanitized) ──────────────────────────────────────
  // PROMPT-W1 (d): decide once which optional boilerplate this task needs.
  const boilerplate = conditionalBoilerplate(task);
  const scopeBlock = buildScopeBlock({
    directories: [...compilePlan.scope.directories],
    filesRead: [...compilePlan.scope.filesRead],
    filesWrite: [...compilePlan.scope.filesWrite],
  }, scopeWarnings, boilerplate.hostConfig, ctx.trackedFiles);

  // ── 5. Dependencies Block ───────────────────────────────────────────
  const depsBlock = ctx.dependencyResults
    ? buildDependenciesBlock({
        currentTaskId: task.id,
        deps: task.dependencies?.length ? task.dependencies : (ctx.dependencies ?? []),
        results: ctx.dependencyResults,
      })
    : buildDependenciesBlock(task.dependencies, ctx.dependencies, ctx.tasksDir);

  // ── 5b. Shared Context Block (Sprint 278 COMM-1 / 278-003) ──────────
  // Caller (task-builder) populates ctx.sharedContext ONLY when
  // worker_comms.enabled && inject_shared; empty/undefined → '' (no block).
  const sharedBlock = buildSharedContextBlock(ctx.sharedContext);

  // ── 5c. Upstream Handoff Block (Sprint 278 COMM-1 / 278-004) ────────
  // Caller (task-builder) populates ctx.upstreamHandoffs ONLY when
  // worker_comms.enabled && inject_handoffs; empty/undefined → '' (no block).
  const handoffBlock = buildHandoffBlock(ctx.upstreamHandoffs);

  // ── 5d. Worker Comms Instruction Block (Sprint 278 COMM-1 / 278-006) ─
  // Emitted ONLY when worker_comms.enabled — tells workers how to write
  // sharedNotes/handoffNotes to their .result. Without this instruction
  // workers never know these fields exist (Tasks 1-5 path stays empty).
  const commsInstructionBlock = buildWorkerCommsInstructionBlock(ctx.workerCommsEnabled);
  const executionAuthorityBlock = buildExactExecutionAuthorityBlock(ctx.exactExecutionAuthority);
  // ── 5e. Run Execution Policy (RUN-POLICY-DELIVERY-001) ──────────────
  // Consumer of the 486-017 producer. Rendered from `task.runPolicy` (never
  // from ctx — 487-026 pattern) so the SAME digest-bound block is compiled on
  // every ingress, initial attempt and every FIX attempt alike, and can never
  // be gated off by caller wiring drift.
  const runPolicyBlock = buildRunPolicyAuthorityBlock(task.runPolicy);
  // ── 5f. Production Wiring Authority (487-026) ───────────────────────
  // Consumer of the 487-025 plan-time authority carried on the task itself. It is
  // rendered from `task.productionWiring` (never from ctx) so the SAME block is
  // compiled on every ingress that compiles this task — the initial attempt and
  // every FIX attempt alike — and can never be gated off by caller wiring drift.
  const productionWiringBlock = buildProductionWiringAuthorityBlock(task.productionWiring);

  // ── 6. Render final prompt ──────────────────────────────────────────
  // Sprint 182 PQ-1 (F1): compute deterministic idempotency key once per render
  // so the template can interpolate the resolved value instead of leaking the
  // literal `${IDEMPOTENCY_KEY}` placeholder to the worker.
  const idempotencyKey = computeIdempotencyKey(task);
  const defaultOrder = renderSegments({
    compilePlan,
    coreExternalized: ctx.coreExternalized === true,
    agentBlock,
    skillBlock,
    projectContextBlock,
    memoryContextBlock,
    adrBlock,
    scopeBlock,
    depsBlock,
    sharedBlock,
    handoffBlock,
    commsInstructionBlock,
    executionAuthorityBlock,
    runPolicyBlock,
    productionWiringBlock,
    workerGuideContract: ctx.workerGuideContract,
    heartbeatIdentity: ctx.heartbeatIdentity,
    task,
    effort,
    modelTier: ctx.modelTier,
    idempotencyKey,
    emitIdempotency: boilerplate.idempotency,
    preExistingFailures: ctx.preExistingFailures,
    toolInventory: ctx.toolInventory,
    verifyCommands: ctx.verifyCommands,
    // PCOMP-6 D1a: exact targeted-test set — pure (trackedFiles is ctx-injected).
    targetedTestPaths: resolveTargetedTestPaths(task, ctx.trackedFiles),
    toolAllowlist: ctx.toolAllowlist,
    // 593-002: resolved `prompt.task_profiles`; undefined → legacy defaults.
    taskProfiles: ctx.taskProfiles,
  });

  // Leading-T0 reorder (production default ON): regroup tiers (T0→T1→T2) for the
  // longest shareable cache prefix. Explicit false preserves the legacy order.
  const reorder = ctx.leadingT0Reorder ?? DEFAULT_LEADING_T0_REORDER;
  const segments = reorder ? reorderLeadingT0(defaultOrder) : defaultOrder;
  const prompt = segments.map(s => s.content).join(SEGMENT_SEPARATOR);

  const charCount = prompt.length;
  const estimatedTokens = Math.ceil(charCount / CHARS_PER_TOKEN);

  // ── 7. Prompt-cache prefix key (593-002 — dead seam wired to production) ──
  // `stablePrefixKey` existed with no production caller, so nothing ever produced
  // the (tenant, task-class) key its own stable-prefix contract is defined against.
  // The task-class discriminator is the canonical {@link TaskPromptProfile} —
  // the SAME classifier that decides which T0 blocks compose the prefix (the
  // inspection/doc/code verify-steps + npm-advisory split), joined with the agent
  // because the T1 tier carries that agent's persona. Metadata only: computing the
  // key touches no segment, so the compiled prompt stays byte-for-byte identical.
  const promptProfile = resolveTaskPromptProfile(taskProfileSignals(task), ctx.taskProfiles);
  const cachePrefixKey = stablePrefixKey(
    ctx.tenantId ?? DEFAULT_PROMPT_TENANT_ID,
    `${promptProfile}::${agentId}`,
  );

  return {
    compilePlan,
    planId: compilePlan.planId,
    prompt,
    segments,
    promptProfile,
    cachePrefixKey,
    metadata: {
      agent: agentId,
      skills: skillNames,
      adrIds,
      scopeWarnings,
      charCount,
      estimatedTokens,
    },
  };
}

// ─── Agent Block Builder ───────────────────────────────────────────────

/**
 * Canonical (shadow-of-builtin) PROMPT.md location for an agent (ADR-G-027 "one
 * pointer away" contract — mirrors agent-pool.ts's `getAgentPrompt` resolution
 * precedence step 1 / temp-agent-generator.ts's `promptMdPath`). Kept as a bare
 * relative-path literal (no fs access, no projectRoot) so {@link buildAgentBlock}
 * stays pure and deterministic per (agent, intent).
 */
function agentPromptPointerPath(agentId: string): string {
  return `.deckent/agents/${agentId}/PROMPT.md`;
}

function buildAgentBlock(
  agentId: string,
  agentPrompt?: string,
  opts?: { mode?: 'full' | 'guidance'; intent?: string },
): string {
  if (!agentPrompt) return '';
  // The task itself is rendered later under the "## Your Task" header; do not
  // emit a dangling "=== Task ===" header here (it would sit above the Skills/
  // ADR blocks with no body and mislead the worker about where the task is).
  const identityLine = `=== Agent: ${agentId} ===`;

  // U4 (443-003): 'guidance' mode renders a focused, intent-matched slice +
  // pointer instead of the full body (ADR-G-027 sanctioned condensed+pointer
  // shape). Default/'full' mode — and any agent whose PROMPT.md carries no
  // guidance markers at all (source 'full-body') — renders the CORE body.
  if (opts?.mode === 'guidance') {
    const { slice, source } = selectGuidanceSlice(agentPrompt, opts.intent ?? 'unknown');
    if (source !== 'full-body') {
      const pointer = `[full persona: ${agentPromptPointerPath(agentId)} — read it if this slice is not enough]`;
      return `${identityLine}\n${slice}\n${pointer}`;
    }
  }

  // F1 (sprint-443 blast-radius fix): the full/fallback render ships the CORE body —
  // guidance blocks are distilled COPIES of the body, so rendering the raw post-U4 file
  // here duplicated them into EVERY prompt (+2-3.5KB each) while the default flag was
  // still 'full', silently reversing U4's cost goal. A marker-free PROMPT.md passes
  // through personaCoreBody untouched → byte-identical legacy render. When something
  // WAS stripped, the pointer keeps the full source one pointer away (ADR-G-027).
  const coreBody = personaCoreBody(agentPrompt);
  if (coreBody !== agentPrompt) {
    const pointer = `[full persona: ${agentPromptPointerPath(agentId)} — read it if you need the guidance appendix]`;
    return `${identityLine}\n${coreBody}\n${pointer}`;
  }
  return `${identityLine}\n${agentPrompt}`;
}

// ─── Skill Block Builder ───────────────────────────────────────────────

/**
 * Drop any skill whose name matches the assigned agent (WP-17, case-insensitive).
 *
 * Several capabilities exist as BOTH a vertical agent and a horizontal skill of
 * the same id (api-builder, devops-engineer, …). When such an agent is assigned,
 * the agent PROMPT.md already carries the persona; re-injecting the same-named
 * SKILL.md duplicates ~40% of the content for no signal. Returns the input
 * untouched (same reference semantics for the empty/no-collision case) so the
 * byte-for-byte prompt is preserved whenever nothing collides.
 */
function dedupeAgentNamedSkills(
  skillPrompts: Array<{ name: string; content: string }> | undefined,
  agentId: string,
): Array<{ name: string; content: string }> | undefined {
  if (!skillPrompts || skillPrompts.length === 0) return skillPrompts;
  if (!agentId || agentId === 'generic') return skillPrompts;
  const agentKey = agentId.toLowerCase();
  const filtered = skillPrompts.filter(sp => sp.name.toLowerCase() !== agentKey);
  return filtered.length === skillPrompts.length ? skillPrompts : filtered;
}

/**
 * Remove the skill-local Karpathy appendix now represented by the single
 * prompt-level {@link KARPATHY_ESSENCE} anchor. Only an exact level-two heading
 * starts a removal; every byte outside that section is retained.
 */
function stripSkillKarpathyNotes(content: string): string {
  const heading = /^## Karpathy Notes(?=\r?$)/gm;
  const nextSection = /^## /gm;
  const parts: string[] = [];
  let cursor = 0;

  for (let match = heading.exec(content); match; match = heading.exec(content)) {
    parts.push(content.slice(cursor, match.index));
    nextSection.lastIndex = heading.lastIndex;
    const next = nextSection.exec(content);
    cursor = next?.index ?? content.length;
    heading.lastIndex = cursor;
  }

  if (cursor === 0) return content;
  parts.push(content.slice(cursor));
  return parts.join('');
}

/**
 * Build the skill prompt section. Full SKILL.md content for every assigned
 * skill — no truncation, no effort-based clipping, no skip on overflow.
 *
 * Sprint 182 PQ-2 (F2): per `feedback_prompt_completeness_over_brevity` anchor,
 * skill content is injected verbatim. The previous EFFORT_TOKEN_MAP /
 * `truncateAtParagraph` / `sectionMax` break logic was removed.
 *
 * Exported (522-011, design S4) so the skill-catalog migration's byte-comparison
 * proof renders the REAL worker-prompt skill section from each body-read path
 * instead of a test-local re-implementation of it. Behaviour is unchanged.
 */
export function buildSkillBlock(
  skillPrompts: Array<{ name: string; content: string }> | undefined,
  outNames: string[],
): string {
  if (!skillPrompts || skillPrompts.length === 0) return '';

  const header = '=== Skills ===';
  const parts: string[] = [header];

  for (const sp of skillPrompts) {
    parts.push(`--- ${sp.name} ---\n${stripSkillKarpathyNotes(sp.content)}`);
    outNames.push(sp.name);
  }

  // Only emit if we have at least one skill
  if (parts.length <= 1) return '';
  return parts.join('\n') + '\n';
}

/**
 * Deterministic project-context section (CATALOG-STATS-AUTHORITY-001
 * correction, 2026-08-17). The auto-generated conventions content is prompt
 * DATA injected for every worker — it is not a skill, so it never routes,
 * never earns stats, and can never be demoted/resurrected by the learning loop.
 */
export function buildProjectContextBlock(projectContext: string | undefined): string {
  if (!projectContext || projectContext.trim() === '') return '';
  const context = projectContext.trim();
  if (isGenericGeneratedProjectContext(context)) return '';
  return `=== Project Context ===\n${context}\n`;
}

function isGenericGeneratedProjectContext(context: string): boolean {
  if (!context.includes('# Project Conventions (Auto-Generated)')) return false;

  const signalLines = context.split('\n').map(line => line.trim()).filter(line => {
    if (line === '' || line.startsWith('#')) return false;
    const value = line.match(/^-[^:]+:\s*(.*)$/)?.[1]?.trim().toLowerCase();
    return value === undefined || !['', 'unknown', 'none', 'n/a', 'unspecified'].includes(value);
  });
  return signalLines.length === 0;
}

// ─── ADR Block Builder ─────────────────────────────────────────────────

/**
 * Build the ADR prompt section. Full ADR content for every selected ADR —
 * no length-based summary fallback, no outer safety cap.
 *
 * Sprint 182 PQ-2 (F3): per `feedback_prompt_completeness_over_brevity` anchor,
 * mandatory ADR content is injected verbatim. The previous
 * `ADR_SUMMARY_THRESHOLD` switch and `ADR_SECTION_MAX = 6000` cap (with the
 * "(ADR content truncated for prompt size)" marker) were removed; mode is
 * always `'full'`.
 *
 * Sprint 182 PQ-5 (F7): `minScore` filters out low-relevance ADRs after the
 * top-N selection. When the threshold drops every candidate, the entire block
 * — including the `=== Mandatory Architecture Rules (ADR) ===` header — is
 * omitted so the worker is not handed a stranded empty section.
 */
function buildAdrBlock(
  task: Task,
  allAdrs: MemoryEntryV2[] | undefined,
  outIds: string[],
  minScore: number,
  canonicalScopedSelection?: readonly MemoryReadEntryV1[],
  auditProjectRoot?: string,
): string {
  if (canonicalScopedSelection !== undefined) {
    if (canonicalScopedSelection.length === 0) return '';
    const canonicalEntries = canonicalScopedSelection.map(selection => selection.entry);
    const content = canonicalScopedSelection.map(selection => {
      const entry = selection.entry;
      outIds.push(entry.id);
      if (selection.reasons.includes('REQUIRED')) {
        return `## ${entry.id}: ${entry.title}\n\n${entry.content}`;
      }
      return buildAdrPromptSection([{
        adrId: entry.id,
        title: entry.title,
        score: selection.relevance,
        matchReasons: [],
      }], 'full', canonicalEntries, 'operative', false)
        .replace('### Contract (binding)', '### Background contract')
        .replace('[full text:', '[background — full text:');
    }).filter(Boolean).join('\n\n');
    if (!content) return '';
    return `=== Mandatory Architecture Rules (ADR) ===\nA full-body ADR is BINDING for THIS task: violating it requires a NO_GO result + an ADR amendment proposal. A binding ADR must never be truncated; if its full body is unavailable, fail closed. An entry marked "[background …]" is BACKGROUND: use it as context, not as an enforcement gate. These are the only two ADR render and enforcement states.\n\n${content}\n`;
  }

  if (!allAdrs || allAdrs.length === 0) return '';

  const ranked = selectRelevantAdrs(task, allAdrs, 3);
  // F7: drop ADRs whose relevance score falls below the configured threshold.
  // `selectRelevantAdrs` already filters strict-positive scores, so we apply
  // the threshold on top of that without re-running scoring.
  const filtered = minScore > 0 ? ranked.filter(r => r.score >= minScore) : ranked;
  if (filtered.length === 0) return '';

  for (const r of filtered) outIds.push(r.adrId);

  // PCOMP-W3 (injection audit): this is the LIVE injection call-site — record
  // the decision (id + score + tier + reasons) so a false positive is
  // reproducible from data. Fail-soft inside logInjectionAudit.
  if (auditProjectRoot !== undefined) logInjectionAudit(auditProjectRoot, task, filtered);

  // PROMPT-W1 (a): scope-gate ADR bodies for code-development tasks so that
  // ADRs not intersecting the task scope render as a condensed head+summary+
  // pointer instead of their full amendment-log body. Other task kinds (and
  // tasks with no `type`) keep the full render → backward-safe.
  const scopeGated = task.type === 'code-development';
  // Binding/background is the complete enforcement vocabulary. Binding ADRs
  // are always full-body; scoring-only background ADRs remain condensed.
  const content = filtered.map(adr => {
    if (adr.matchReasons.includes('explicit-ref')) {
      return buildAdrPromptSection([adr], 'full', allAdrs, 'full', false);
    }
    return buildAdrPromptSection([adr], 'full', allAdrs, 'operative', scopeGated)
      .replace('### Contract (binding)', '### Background contract')
      .replace('[full text:', '[background — full text:');
  }).filter(Boolean).join('\n\n');
  if (!content) return '';

  return `=== Mandatory Architecture Rules (ADR) ===\nA full-body ADR is BINDING for THIS task: violating it requires a NO_GO result + an ADR amendment proposal. A binding ADR must never be truncated; if its full body is unavailable, fail closed. An entry marked "[background …]" is BACKGROUND: use it as context, not as an enforcement gate. These are the only two ADR render and enforcement states.\n\n${content}\n`;
}

// ─── Smoke Note Builder (WP-16) ────────────────────────────────────────

/**
 * Render the Tier-1 Proof-of-Function smoke-context note (WP-16).
 *
 * A `Smoke:` directive names a real-binary command Brain runs ON THE HOST (with
 * a real auth token) AFTER the task completes — it is Brain's gate, not the
 * worker's. Without this note workers ran the smoke inside their sandbox, hit a
 * missing host binary / unbindable port / absent token, and self-reported NO_GO
 * even though the host smoke passed (284-006: container FAIL, host PASS 153ms).
 *
 * Returns '' when the task has no smoke directive so the section is omitted
 * entirely (byte-for-byte identical prompt for non-Tier-1 tasks).
 */
export function buildSmokeNote(smoke?: { command: string; expect: string }): string {
  if (!smoke || !smoke.command) return '';
  const expect = smoke.expect ? ` → expect \`${smoke.expect}\`` : '';
  return `## Proof-of-Function Smoke (Tier-1)
A \`Smoke:\` proof command is attached to this task: \`${smoke.command}\`${expect}.
This host-smoke is run by Brain ON THE HOST after your task completes (with a real auth token) — it is Brain's gate, NOT yours. You do NOT need to run it inside your container. If the command fails inside your sandbox (missing host binary, unbindable port, or absent token), that is EXPECTED — do NOT mark NO_GO for a sandbox smoke failure. Make your code changes land and your targeted tests pass; Brain runs the real smoke host-side.`;
}

// ─── Env-Probe Block Builder (TT555 — task 421-002, waste-class d) ──────

/**
 * Render the sprint-start host tool-inventory block from the caller-probed
 * one-line inventory (SprintContext `toolInventory`).
 *
 * PURE: takes the already-resolved inventory STRING (the side-effecting PATH
 * probe lives in worker-verify-tool.ts's {@link import('./worker-verify-tool.js').probeToolInventory},
 * invoked by the caller at sprint start), so the compiler stays deterministic and
 * hermetic. Returns '' when the inventory is absent/blank so the section — header
 * included — is omitted entirely, keeping the default prompt byte-for-byte
 * identical (no cache-prefix split, no pin churn). Emitted as a volatile T2
 * segment (`env-probe`): the inventory varies per HOST, so it must never land in
 * the shared T0/T1 cache prefix (classifyTier maps the unregistered kind to T2).
 */
export function buildEnvProbeBlock(toolInventory?: string): string {
  const inv = (toolInventory ?? '').trim();
  if (inv.length === 0) return '';
  return `## Environment Tool Inventory
Probed on THIS host at sprint start — do not spend a turn re-discovering these: ${inv}. A tool marked \`no\` is absent here; reach for an available alternative (e.g. \`python3=no\` → use a Node.js one-liner) instead of invoking it and failing.`;
}

// ─── Tool-Allowlist Block Builder (born-664 / 559 — task 427-014 ALLOW-WIRE) ──

/**
 * Render the task-scoped tool-allowlist block from the caller-resolved
 * {@link SprintContext.toolAllowlist}.
 *
 * PURE: takes the already-computed {@link ToolAllowlistResult} (the config-flag
 * read + live tool universe + per-task compute all live at the call site, out of
 * this deterministic compiler — same precedent as {@link buildEnvProbeBlock}'s
 * pre-resolved inventory string). Returns '' when the allowlist is absent OR grants
 * no tools, so the section — header included — is omitted entirely and the compiled
 * prompt stays byte-for-byte identical to the pre-427-014 output (flag-off = today).
 *
 * The escape hatch is stated HONESTLY: a worker records an ungranted-tool need on a
 * `toolEscalation:` line in its `.result` notes (mirroring the existing
 * `npmAdvisory:` / `docImpact:` notes-line convention). It never tells the worker to
 * "call" a tool that is not on its actual surface — the YALANCI-PROMPT failure mode
 * born-670b (task 427-012) killed.
 *
 * Emitted as a volatile T2 segment (`tool-allowlist`): the granted set varies per
 * task, so it must never land in the shared T0/T1 cache prefix — `classifyTier` maps
 * the unregistered kind to T2.
 */
export function buildToolAllowlistBlock(allowlist?: ToolAllowlistResult): string {
  if (!allowlist || allowlist.allowed.length === 0) return '';
  const total = allowlist.allowed.length + allowlist.escalatable.length;
  const tools = allowlist.allowed.map(t => `\`${t}\``).join(', ');
  return `## Tool Surface (narrowed for this task)
Your default tool surface is reduced to the ${allowlist.allowed.length} tool(s) this task needs (of ${total} available): ${tools}.
A tool not listed above is NOT granted by default. If your task genuinely needs one, name it and why on a \`toolEscalation:\` line in your \`.result\` notes and continue with the tools above — do NOT assume an ungranted tool is available on your surface.`;
}

// ─── Conditional Boilerplate Gating (PROMPT-W1 d) ──────────────────────

/**
 * Path hints that mark a task as touching HOST-FACING config — the only place
 * the no-hardcode-`/workspace` portability note is relevant. A pure `src/**`
 * refactor never writes these, so it should not carry the note.
 */
const HOST_CONFIG_PATH_HINTS = [
  '.claude/', '.github/', '.gitlab', '.husky', '.deckent/', 'scripts/',
  'package.json', 'tsconfig', 'dockerfile', 'docker-compose',
  '.yml', '.yaml', '.toml',
];

/** True when any scope path looks like host-facing config (case-insensitive). */
function touchesHostConfig(scope: TaskScope | undefined): boolean {
  const paths = [...(scope?.filesWrite ?? []), ...(scope?.directories ?? [])];
  return paths.some(p => {
    const n = p.toLowerCase();
    return HOST_CONFIG_PATH_HINTS.some(h => n.includes(h));
  });
}

/**
 * Path/text hints that a task may make EXTERNAL API calls — the only context where
 * the Idempotency-Key retry-safety note is meaningful (F1.2). Paths cover the
 * outbound-call layers (connectors → messaging APIs, providers → LLM APIs, the HTTP
 * api layer, gateways) and any billing/webhook surface; text hints catch API work
 * whose scope is generic. Bare `api` is deliberately excluded — it matches "public
 * API surface" prose on unrelated tasks and would defeat the opt-in flip.
 */
const EXTERNAL_API_PATH_HINTS = [
  'connectors/', 'providers/', 'src/api/', 'gateway/', 'webhook', 'payment', 'billing',
];
const EXTERNAL_API_TEXT_HINTS = [
  'webhook', 'payment', 'idempoten', 'stripe', 'oauth', 'external api', 'api call',
  'http request', 'http client', 'rest api', 'third-party api', 'rate limit',
];

/**
 * True when a task plausibly performs external API calls (scope paths OR task text).
 * Mirrors {@link touchesHostConfig}: an opt-in scope-detection gate rather than the
 * old on-by-default behaviour. Errs toward inclusion — the note is a safety hint and
 * mild over-inclusion is harmless, while the dominant core/orchestra internals that
 * never call out no longer carry it.
 */
function touchesExternalApi(task: Task): boolean {
  const paths = [...(task.scope?.filesWrite ?? []), ...(task.scope?.directories ?? [])];
  if (paths.some(p => { const n = p.toLowerCase(); return EXTERNAL_API_PATH_HINTS.some(h => n.includes(h)); })) {
    return true;
  }
  const text = `${task.title ?? ''} ${task.description ?? ''}`.toLowerCase();
  return EXTERNAL_API_TEXT_HINTS.some(h => text.includes(h));
}

/** Which optional boilerplate blocks a task actually needs (PROMPT-W1 d). */
interface ConditionalBoilerplate {
  /** Idempotency Key section — only meaningful when the task may call external APIs. */
  idempotency: boolean;
  /** Host-config portability note — only meaningful when scope touches host-facing config. */
  hostConfig: boolean;
}

/**
 * Decide which optional boilerplate blocks to emit for a task (PROMPT-W1 d; F1.2).
 *
 * Both blocks are now OPT-IN by scope/text detection — emitted only where they are
 * actually meaningful, not on by default:
 *  - the **Idempotency Key** section (retry safety for EXTERNAL API calls) →
 *    {@link touchesExternalApi}. Previously on for every non-`refactor` task, which
 *    was dead gating: it landed on ~all core/orchestra internals that never call out
 *    (live prompt-analysis). The docker `IDEMPOTENCY_KEY` env var is injected
 *    unconditionally by spawn-backend-docker, so dropping the informational prompt
 *    block never removes the actual retry key — the flip is signal-clarity, zero risk.
 *  - the **host-config** portability note (no-hardcode-`/workspace`) →
 *    {@link touchesHostConfig}, unchanged (still skipped for a pure refactor).
 */
export function conditionalBoilerplate(task: Task): ConditionalBoilerplate {
  const isPureRefactor = task.type === 'refactor';
  return {
    idempotency: touchesExternalApi(task),
    hostConfig: !isPureRefactor && touchesHostConfig(task.scope),
  };
}

// ─── Scope Block Builder ───────────────────────────────────────────────

/**
 * F2.1b: render the WRITE authority list as worker-facing sub-lists.
 *
 * Reuses the pre-spawn scope-gate classifier ({@link evaluateScopeGate}, run with
 * `acknowledgeScopePaths` so it classifies-only and never blocks here) so the prompt
 * language matches the gate verdict exactly:
 *   - **confirmed** → Existing: modify in place, do not recreate.
 *   - **new-plausible** → New: expected to be created.
 *   - **suspect** → ⚠ Unverified: no such path; likely typo/wrong-dir → confirm or
 *     STOP+NO_GO (this is the orphan-file mode the gate blocks by default; a worker
 *     only sees it here when the sprint was launched with `--force-scope`).
 * Each sub-list is emitted only when non-empty. Deterministic (pure classifier).
 */
function buildWriteAuthorityList(sanitizedFiles: string[], trackedFiles: string[]): string {
  const gate = evaluateScopeGate({
    tasks: [{ id: 'scope', scope: { filesWrite: sanitizedFiles } }],
    trackedFiles,
    acknowledgeScopePaths: true,
  });
  const writes = gate.verdicts.filter(v => v.role === 'write');
  const existing = writes.filter(v => v.classification === 'confirmed').map(v => v.path);
  const created = writes.filter(v => v.classification === 'new-plausible').map(v => v.path);
  const suspect = writes.filter(v => v.classification === 'suspect');

  const list = (paths: string[]): string => paths.map(f => `  - ${f}`).join('\n');
  const blocks: string[] = [];
  if (existing.length > 0) {
    blocks.push(`Existing — modify in place, do NOT recreate from scratch:\n${list(existing)}`);
  }
  if (created.length > 0) {
    blocks.push(`New — you are expected to create these:\n${list(created)}`);
  }
  if (suspect.length > 0) {
    const lines = suspect.map(v => {
      const hint = v.suggestion ? ` → did you mean '${v.suggestion}'?` : '';
      return `  - ${v.path}${hint}`;
    }).join('\n');
    blocks.push(
      `⚠ Unverified — no such path in the repo; likely a typo or wrong directory. ` +
      `Confirm it is genuinely new BEFORE writing. If it should be an existing file, ` +
      `STOP and write a NO_GO result — do NOT create an orphan file:\n${lines}`,
    );
  }
  // Fallback (should not happen — verdicts always classify): flat list.
  return blocks.length > 0 ? blocks.join('\n\n') : list(sanitizedFiles);
}

export function buildScopeBlock(
  scope: TaskScope,
  outWarnings: string[],
  emitHostConfigNote: boolean,
  trackedFiles?: string[],
): string {
  // Sanitize filesWrite. sprint-399 SAN-1 wiring: give the sanitizer the tracked
  // root-file set so a legitimate repo-root entry (README.md, .secrets-baseline…)
  // survives Rule 5 instead of being silently dropped (the 397-011/012 failure).
  const trackedRootFiles = trackedFiles && trackedFiles.length > 0
    ? new Set(trackedFiles.filter(f => !f.includes('/')))
    : undefined;
  const sanitized = sanitizeScope(scope.filesWrite, trackedRootFiles);
  for (const w of sanitized.warnings) outWarnings.push(w);
  for (const r of sanitized.rejected) outWarnings.push(`Rejected path: ${r}`);

  // Inspection-only tasks carry exact read targets and no project write targets.
  // Their validator is intentionally distinct from write sanitization: root
  // manifests are valid exact reads while remaining globally write-protected.
  const sanitizedRead = sanitizeReadScope(scope.filesRead);
  for (const w of sanitizedRead.warnings) outWarnings.push(`Read scope: ${w}`);
  for (const r of sanitizedRead.rejected) outWarnings.push(`Rejected read path: ${r}`);
  // Presence of an authored read list selects fail-closed inspection mode even
  // when every entry is rejected by sanitization. Falling back to directory-wide
  // write authority after a bad read path would turn invalid input into MORE
  // authority — the opposite of a safe compiler.
  // 593-002: same canonical classifier as every other call site, fed THIS site's
  // own signals — the SANITIZED write list (post-sanitizer authority) against the
  // RAW read list (authored-intent) — so the predicate is byte-for-byte the legacy
  // one while the rule itself lives in exactly one place.
  const isInspectionOnly = resolveTaskPromptProfile({
    scope: { filesWrite: sanitized.filesWrite, filesRead: scope.filesRead },
  }) === 'inspection-only';

  const scopeDirs = scope.directories.length > 0
    ? scope.directories.map(d => `  - ${d}`).join('\n')
    : '  - (no directory restriction)';

  // Sprint 182 PQ-4 (F5): when DIRECTIVES omits an explicit `Files:` list,
  // fall back to an inferred formulation that names the assigned directories
  // instead of the vague "(determined by your task scope)" sentinel. The
  // worker now knows it may write anywhere within those directories.
  // 2026-08-28 review BLOCKER: the directory fallback below is correct ONLY when the
  // plan declared no exact write list at all (the PQ-4 F5 case). When a task DID declare
  // exact write targets and sanitization emptied the list, falling back to the directory
  // grant turns a request for one file into "any file in these directories" — an authority
  // EXPANSION rendered under a "You may ONLY write to these files" header. Measured:
  // filesWrite=['package.json'] + directories=['src'] produced exactly that, with no warning,
  // because Rule 6 (GLOBAL_PROTECTED) drops silently. Fail closed instead, and report it so
  // the plan-time gate blocks rather than a worker receiving a widened authority.
  const declaredWrite = scope.filesWrite.filter(p => typeof p === 'string' && p.trim().length > 0);
  const declaredButEmptied = declaredWrite.length > 0 && sanitized.filesWrite.length === 0;
  if (declaredButEmptied) {
    outWarnings.push(
      'Declared write authority was emptied by scope sanitization — refusing to widen to the '
      + `directory grant. Declared: ${declaredWrite.join(', ')}`,
    );
  }

  let scopeFiles: string;
  if (sanitized.filesWrite.length > 0) {
    scopeFiles = sanitized.filesWrite.map(f => `  - ${f}`).join('\n');
  } else if (declaredButEmptied) {
    scopeFiles = '  - (none — every declared write target was rejected by scope sanitization; '
      + 'STOP and report NO_GO. A directory in the read scope grants NO write authority.)';
  } else if (scope.directories.length > 0) {
    const dirList = scope.directories.join(', ');
    scopeFiles = `  - (no explicit Files list — you may write to any file within the directories above: ${dirList})`;
  } else {
    scopeFiles = '  - (determined by your task scope)';
  }

  // PROMPT-W1 (d): the host-config portability note is only relevant when the
  // task actually writes host-facing config; a pure src/** refactor skips it.
  const hostConfigNote = emitHostConfigNote
    ? `\n\nWhen writing host-facing config (hooks in \`.claude/settings.json\`, scripts in \`package.json\`, CI workflows), NEVER hard-code your container working directory (e.g. \`/workspace/...\`). That path does not exist on the user's host machine and will break at runtime. Use a portable form instead: \`$CLAUDE_PROJECT_DIR/...\`, a path relative to the project root, or a bare command resolved via PATH.`
    : '';

  // LP-4 (2026-07-08 scope taxonomy): the WRITE authority names only project
  // artifacts, but the prompt also REQUIRES the worker to write its own
  // `.tasks/task-<id>.hb`, `.result` (and a `.question` on escalation). Without
  // this exemption the "ONLY these files" line reads as self-contradictory — a
  // literal worker either skips its lifecycle files (result-missing → sprint stall)
  // or fears a scope violation. State the taxonomy split explicitly: protocol files
  // are lifecycle artifacts, always writable, and never counted as scope mutations
  // (the auditor already whitelists them — this makes the prompt match the audit).
  const tasksExemptionNote =
    `\n\n## Worker Lifecycle Write Exceptions\nOnly \`.tasks/task-<task-id>.hb\`, \`.tasks/task-<task-id>.result\`, and \`.tasks/task-<task-id>.question\` (when escalation is required) may be written despite the project-write rule. They are lifecycle artifacts, NOT project changes or audit evidence. No other \`.tasks/\` path is authorized by this exception.`;

  // MASTER-PLAN 668 — bounded discovery. Read scope limits what you may CHANGE;
  // it never licensed scanning the whole repository to find it. Measured
  // 2026-07-25: the same documentation task was SIGKILLed (exit 137) three
  // times — 457-003, 458-005, 459-003 — each time while running repository-wide
  // discovery, with the last death mid `git log --oneline --all | grep`. Peak
  // container memory at that moment was 0.20 GB of 6 GB and docker reported no
  // OOM, so the ceiling was not the cause; the unbounded scan was. The same
  // task completed DONE in 31 turns once discovery was bounded. The xverify
  // verifier protocol has carried this rule since its inception; it now applies
  // to every worker.
  const boundedDiscoveryNote =
    `\n\n**Bounded discovery (mandatory).** Search only inside the files and directories listed above.`
    + ` Do NOT run repository-wide discovery: no \`git log --all\`, no history scan across every ref,`
    + ` no repo-wide \`grep\`/\`rg\`/\`find\`/\`ls -R\`, no whole-tree \`git status\`. Prefer an exact path`
    + ` plus a bounded excerpt (\`sed -n 'START,ENDp' path\`) over reading a large file whole.`
    + ` Persona instructions to inspect callers/callees do not widen this authority: a caller or callee outside the paths above MUST NOT be read. If you`
    + ` genuinely cannot locate what you need inside your scope, say so in your \`.result\` notes and`
    + ` return NO_GO — do not widen the search. An unbounded scan has killed real workers here.`;

  // Exact read targets remain part of the worker authority even when the task
  // also has a project write target. Previously only inspection-only prompts
  // rendered `filesRead`; write-capable prompts rendered directories +
  // filesWrite and then ordered the worker to search only the paths "listed
  // above". With an exact-file-only read scope that erased every source input
  // from the prompt and caused deterministic NO_GO/FIX exhaustion. Keep the
  // sanitized exact reads visibly separate from write authority so they can
  // never be mistaken for writable paths.
  const exactReadContext = scope.filesRead.length > 0
    ? `\n\nExact read-only project files:\n${sanitizedRead.filesRead.length > 0
      ? sanitizedRead.filesRead.map(f => `  - ${f}`).join('\n')
      : '  - (no valid exact read targets remain after path validation — STOP and report NO_GO)'}`
    : '';

  if (isInspectionOnly) {
    const readFiles = sanitizedRead.filesRead.length > 0
      ? sanitizedRead.filesRead.map(f => `  - ${f}`).join('\n')
      : '  - (no valid read targets remain after path validation — STOP and report NO_GO)';
    return `## Scope Rules (inspection-only)
READ/context directories — navigation context only; they grant no project write authority:
${scopeDirs}

Exact project files to inspect:
${readFiles}

## PROJECT WRITE authority: NONE
No project source, test, config, documentation, credential, or git-metadata file may be created or modified. A directory above never grants Write/Edit permission.${tasksExemptionNote}${boundedDiscoveryNote}`;
  }

  // PCOMP-W1 (single write authority — sprint-348-005 prompt analysis): the old
  // template printed TWO conflicting authorities ("ONLY modify in these
  // directories" [7 dirs] vs "ONLY write to these files" [2 files]) — ambiguous
  // for both the worker and the auditor. Canonical rule: when an explicit
  // filesWrite list exists it is the SOLE write authority and the directory list
  // is READ/context scope only; the directory-fallback wording applies only when
  // no Files: list was declared (PQ-4 F5 behaviour preserved).
  if (sanitized.filesWrite.length > 0) {
    // F2.1b: when the tracked-file set is available, classify each write target so
    // the worker sees Existing (modify, don't recreate) / New (create) / ⚠ Unverified
    // (typo/wrong-dir → confirm or STOP+NO_GO) instead of one flat list. Absent/empty
    // trackedFiles → the flat legacy list, byte-for-byte.
    const writeAuthority = (trackedFiles && trackedFiles.length > 0)
      ? buildWriteAuthorityList(sanitized.filesWrite, trackedFiles)
      : scopeFiles;
    return `## Scope Rules
READ/context scope — you may read these directories to understand the code:
${scopeDirs}${exactReadContext}

WRITE authority (canonical — the ONLY files you may create or modify):
${writeAuthority}

A directory appearing in the read scope does NOT grant write permission there — the write list above is the single authority, and the auditor flags any write outside it. If a change seems needed in a file you cannot write, note it in your .result \`notes\` instead of editing it.${tasksExemptionNote}${boundedDiscoveryNote}${hostConfigNote}`;
  }

  return `## Scope Rules
You may ONLY modify files in these directories:
${scopeDirs}

You may ONLY write to these files:
${scopeFiles}

DO NOT touch files outside your scope — the auditor will flag violations.${tasksExemptionNote}${boundedDiscoveryNote}${hostConfigNote}`;
}

// ─── Dependencies Block Builder ────────────────────────────────────────

/** Max chars of dependency `notes` embedded into the prompt — keeps worker context bounded. */
const DEPENDENCY_NOTES_MAX_CHARS = 500;

/**
 * Maximum char count for a single dependency digest entry, header included
 * (Sprint 183 W1-3).
 *
 * Sprint 182 dogfood produced an 11-task dep chain — every predecessor digest
 * fed back into downstream prompts, and a few entries with hundreds of
 * `filesChanged` ballooned the prompt past the worker context budget, causing
 * the "Worker exited without writing result (exitCode=0)" pattern documented
 * in `docs/audits/sprint-183/worker-timeout-rc.md`.
 *
 * 2000 chars is a compromise: large enough to keep a reasonable diff summary
 * (~30 filenames + truncated notes) but small enough that 10+ deps cannot
 * cumulatively exceed the worker's safe context budget (10 × 2000 = 20K).
 */
export const DEPENDENCY_ENTRY_MAX_CHARS = 2000;

/** Suffix appended when a dependency entry is truncated for size. */
const DEPENDENCY_TRUNCATION_MARKER = '\n  - (dependency digest truncated for prompt size)';

/** Subset of `.tasks/task-{id}.result` fields the dependency block embeds. */
interface DependencyResultDigest {
  selfAssessment?: string;
  filesChanged?: string[];
  linesAdded?: number;
  linesRemoved?: number;
  notes?: string;
  /**
   * When set, this digest represents a fix-retry whose target is the named
   * task. Sprint 179 W0-1 (Bug A): downstream prompts must surface both the
   * original NO_GO digest *and* the latest fix DONE digest so the worker
   * understands which artifact is current.
   */
  originalTaskId?: string;
}

/**
 * In-memory dependency digest for {@link buildDependenciesBlock} object-form.
 * Verdict is the worker self-assessment (or evaluator verdict if known).
 *
 * Sprint 179 W0-1 (Bug A): introduced so test/runtime call sites can pass
 * pre-collected results without round-tripping through `.tasks/*.result`.
 */
export interface DependencyResultEntry {
  verdict: 'DONE' | 'GO_WITH_TECH_DEBT' | 'NO_GO';
  filesChanged?: string[];
  linesAdded?: number;
  linesRemoved?: number;
  notes?: string;
  originalTaskId?: string;
}

/** Object-form arguments for {@link buildDependenciesBlock} (Sprint 179 W0-1). */
export interface BuildDependenciesBlockInput {
  currentTaskId?: string;
  deps: string[];
  results: ReadonlyMap<string, DependencyResultEntry>;
}

const VERDICT_RANK_DIGEST: Record<DependencyResultEntry['verdict'], number> = {
  NO_GO: 0,
  GO_WITH_TECH_DEBT: 1,
  DONE: 2,
};

function entryToDigest(entry: DependencyResultEntry): DependencyResultDigest {
  return {
    selfAssessment: entry.verdict,
    filesChanged: entry.filesChanged,
    linesAdded: entry.linesAdded,
    linesRemoved: entry.linesRemoved,
    notes: entry.notes,
    originalTaskId: entry.originalTaskId,
  };
}

/**
 * Read and shape a previously-completed dependency's `.result` file.
 * Returns null when the file does not exist or cannot be parsed — callers render
 * a "Pending" placeholder in that case.
 */
function readDependencyResult(depId: string, tasksDir: string): DependencyResultDigest | null {
  const filePath = join(tasksDir, `task-${depId}.result`);
  if (!existsSync(filePath)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const obj = parsed as Record<string, unknown>;
  return {
    selfAssessment: typeof obj.selfAssessment === 'string' ? obj.selfAssessment : undefined,
    filesChanged: Array.isArray(obj.filesChanged)
      ? obj.filesChanged.filter((f): f is string => typeof f === 'string')
      : undefined,
    linesAdded: typeof obj.linesAdded === 'number' ? obj.linesAdded : undefined,
    linesRemoved: typeof obj.linesRemoved === 'number' ? obj.linesRemoved : undefined,
    notes: typeof obj.notes === 'string' ? obj.notes : undefined,
  };
}

/**
 * Format a single dependency entry. Header is `## Dependency {id} ({status})`,
 * body lines: `- Files: …` and `- Notes: …`. When `result` is null, body is the
 * literal `Pending (not yet complete)` sentinel so downstream consumers can match it.
 */
function formatDependencyEntry(depId: string, result: DependencyResultDigest | null): string {
  if (!result) {
    return `## Dependency ${depId} (Pending)\nPending (not yet complete)`;
  }
  const status = result.selfAssessment ?? 'UNKNOWN';
  const lines: string[] = [`## Dependency ${depId} (${status})`];

  if (result.filesChanged && result.filesChanged.length > 0) {
    const filesList = result.filesChanged.join(', ');
    const added = result.linesAdded;
    const removed = result.linesRemoved;
    const hasDelta = (typeof added === 'number' && added > 0) || (typeof removed === 'number' && removed > 0);
    if (hasDelta) {
      lines.push(`- Files: ${filesList} (+${added ?? 0}/-${removed ?? 0})`);
    } else {
      lines.push(`- Files: ${filesList}`);
    }
  }

  if (result.notes) {
    const notesText = truncateAtParagraph(result.notes, DEPENDENCY_NOTES_MAX_CHARS);
    lines.push(`- Notes: ${notesText}`);
  }

  return capDependencyEntry(lines.join('\n'));
}

/**
 * Sprint 183 W1-3: enforce {@link DEPENDENCY_ENTRY_MAX_CHARS} per entry.
 *
 * When an entry exceeds the cap (long `filesChanged` list with hundreds of
 * paths is the dominant overflow source — `notes` already get a 500-char
 * paragraph cap), truncate at a UTF-8-safe slice boundary and append
 * {@link DEPENDENCY_TRUNCATION_MARKER} so the worker can tell the digest is
 * partial.
 *
 * The cap is applied after assembly so all three potential lines (header,
 * files, notes) share the budget — a single oversized line cannot push the
 * total past the bound.
 */
function capDependencyEntry(entry: string): string {
  if (entry.length <= DEPENDENCY_ENTRY_MAX_CHARS) return entry;
  const budget = DEPENDENCY_ENTRY_MAX_CHARS - DEPENDENCY_TRUNCATION_MARKER.length;
  if (budget <= 0) return entry.slice(0, DEPENDENCY_ENTRY_MAX_CHARS);
  return entry.slice(0, budget) + DEPENDENCY_TRUNCATION_MARKER;
}

export function buildDependenciesBlock(input: BuildDependenciesBlockInput): string;
export function buildDependenciesBlock(
  taskDeps?: string[],
  ctxDeps?: string[],
  tasksDir?: string,
): string;
export function buildDependenciesBlock(
  arg1?: string[] | BuildDependenciesBlockInput,
  ctxDeps?: string[],
  tasksDir?: string,
): string {
  // ── Object-form (Sprint 179 W0-1): aggregate-aware in-memory results ─
  if (arg1 && !Array.isArray(arg1) && typeof arg1 === 'object') {
    const { deps, results } = arg1;
    if (!deps || deps.length === 0) return '';
    const entries = deps.map(depId => formatAggregateEntry(depId, results));
    return `## Dependencies
This task depends on: ${deps.join(', ')}
Ensure dependent tasks are complete before starting.

### Dependency Settlement Authority
The \`aggregate\` verdict below is host-evaluated logical-lineage authority. It is the ONLY
dependency-status authority for this attempt. Raw \`.tasks/task-<dependency-id>.result\` files are
attempt-scoped audit evidence and MUST NOT override the aggregate verdict. A repaired lineage
intentionally retains the original attempt's \`NO_GO\`; when aggregate is \`DONE\`, use the declared
dependency output artifacts and proceed. Do not reopen or downgrade that settlement by reading the
original result file.

${entries.join('\n\n')}`;
  }

  // ── Legacy disk-based form (backward compatible) ────────────────────
  const taskDeps = arg1 as string[] | undefined;
  const deps = taskDeps?.length ? taskDeps : ctxDeps;
  if (!deps || deps.length === 0) return '';

  const resolvedDir = tasksDir ?? join(process.cwd(), '.tasks');
  const entries = deps.map(depId => formatDependencyEntry(depId, readDependencyResult(depId, resolvedDir)));

  return `## Dependencies
This task depends on: ${deps.join(', ')}
Ensure dependent tasks are complete before starting.

${entries.join('\n\n')}`;
}

/**
 * Sprint 179 W0-1 (Bug A): format a dependency that may have an original
 * record and zero-or-more fix retries. Emits header with aggregate verdict
 * then individual sub-entries (Original / Fix:{id}) so the worker sees the
 * full trajectory.
 */
function formatAggregateEntry(
  depId: string,
  results: ReadonlyMap<string, DependencyResultEntry>,
): string {
  const original = results.get(depId);
  const fixes: Array<{ id: string; entry: DependencyResultEntry }> = [];
  for (const [id, entry] of results) {
    if (entry.originalTaskId === depId) fixes.push({ id, entry });
  }
  fixes.sort((left, right) => left.id.localeCompare(right.id));

  if (!original && fixes.length === 0) {
    return `## Dependency ${depId} (Pending)\nPending (not yet complete)`;
  }

  let aggregate: DependencyResultEntry['verdict'] = original?.verdict ?? 'NO_GO';
  let resolvedAttemptId = original ? depId : fixes.at(-1)?.id ?? depId;
  for (const { id, entry } of fixes) {
    if (VERDICT_RANK_DIGEST[entry.verdict] > VERDICT_RANK_DIGEST[aggregate]) {
      aggregate = entry.verdict;
      resolvedAttemptId = id;
    } else if (entry.verdict === aggregate) {
      // Same-verdict retries are ordered by attempt id above. The latest
      // matching attempt is the lineage tip workers should cite.
      resolvedAttemptId = id;
    }
  }

  const lines: string[] = [
    `## Dependency ${depId} (aggregate: ${aggregate})`,
    `- Canonical logical settlement: ${aggregate}`,
    `- Resolved by attempt: ${resolvedAttemptId}`,
  ];
  if (original) {
    lines.push(`### Original ${depId} (${original.verdict})`);
    const body = formatDependencyEntry(depId, entryToDigest(original))
      .split('\n')
      .slice(1) // drop the synthetic "## Dependency …" header
      .join('\n');
    if (body) lines.push(body);
  }
  for (const { id, entry } of fixes) {
    lines.push(`### Fix ${id} (${entry.verdict})`);
    const body = formatDependencyEntry(id, entryToDigest(entry))
      .split('\n')
      .slice(1)
      .join('\n');
    if (body) lines.push(body);
  }
  return lines.join('\n');
}

// ─── Shared Context Block Builder (Sprint 278 COMM-1 / 278-003) ────────

/**
 * Render the "Shared Context (other workers)" block from SharedMemory entries.
 *
 * Bridges the dormant {@link SharedMemory} primitive into the worker prompt:
 * notes another worker wrote during the sprint become visible context for the
 * current worker. Returns '' when there is nothing to inject so the caller can
 * skip the section entirely (no stranded empty header).
 *
 * Determinism: entries are sorted by `key` with a stable lexicographic
 * comparator (matching `SharedMemory.listKeys()`'s default sort), so the same
 * set of entries renders byte-for-byte identically regardless of input order —
 * keeping the prompt-determinism guard (Sprint 273) green.
 *
 * KRİTİK (F1-TOK / cache-prefix): the caller appends this block at the very END
 * of the prompt (the most task-specific region), so the shared Skills→Agent→ADR
 * cache prefix is never split.
 *
 * @param entries Shared-context entries, or undefined/empty when comms is off.
 * @returns The rendered block, or '' when there is nothing to render.
 */
export function buildSharedContextBlock(entries: SharedContextEntry[] | undefined): string {
  if (!entries || entries.length === 0) return '';
  const sorted = [...entries].sort((a, b) =>
    a.key < b.key ? -1 : a.key > b.key ? 1 : 0,
  );
  const lines = sorted.map(e => `- ${e.key} (by ${e.writerId}): ${e.value}`);
  return `=== Shared Context (other workers) ===\n${lines.join('\n')}`;
}

// ─── Upstream Handoff Block Builder (Sprint 278 COMM-1 / 278-004) ───────

/**
 * Render the "Upstream Handoffs" block from executed handoffs targeting this task.
 *
 * Bridges the already-created sprint-controller handoffs (`createHandoff` /
 * `executeHandoff`) into the downstream worker prompt: artifact paths the
 * upstream task produced plus its free-text {@link UpstreamHandoffEntry.notes}
 * message (Task 5 `handoffNotes`) become visible context. Returns '' when there
 * is nothing to inject so the caller can skip the section entirely (no stranded
 * empty header).
 *
 * Determinism: the caller passes entries pre-sorted by handoff id
 * (`HandoffProtocol.listHandoffs()` sorts via `localeCompare`), so the rendered
 * block is order-stable and the prompt-determinism guard (Sprint 273) stays green.
 *
 * KRİTİK (F1-TOK / cache-prefix): the caller appends this block at the very END
 * of the prompt (next to the Shared Context block), so the shared
 * Skills→Agent→ADR cache prefix is never split.
 *
 * @param handoffs Executed upstream handoffs, or undefined/empty when comms is off.
 * @returns The rendered block, or '' when there is nothing to render.
 */
export function buildHandoffBlock(handoffs: UpstreamHandoffEntry[] | undefined): string {
  if (!handoffs || handoffs.length === 0) return '';
  const lines = handoffs.map(h => {
    const artifacts = `artifacts [${h.artifacts.join(', ')}]`;
    const note = h.notes ? `, note: ${h.notes}` : '';
    return `- from ${h.fromTaskId}: ${artifacts}${note}`;
  });
  return `=== Upstream Handoffs ===\n${lines.join('\n')}`;
}

// ─── Worker Comms Instruction Block Builder (Sprint 278 COMM-1 / 278-006) ──

/**
 * Render the worker communications instruction block.
 *
 * Emitted ONLY when `worker_comms.enabled` so workers learn how to populate
 * `sharedNotes` and `handoffNotes` in their `.result` file. Without this block
 * the worker has no indication these fields exist and the Tasks 1-5 sharing
 * pipeline stays empty.
 *
 * Content is English (worker prompt standard). Appended at the very END of the
 * prompt (after sharedBlock and handoffBlock) so it never splits the shared
 * Skills→Agent→ADR cache prefix (F1-TOK lesson).
 *
 * @param enabled Whether `config.worker_comms?.enabled` is true.
 * @returns The rendered instruction block, or '' when disabled/absent.
 */
export function buildWorkerCommsInstructionBlock(enabled?: boolean): string {
  if (!enabled) return '';
  return `=== Worker Communications ===
You may share structured notes with other workers in this sprint:
- Add \`sharedNotes: [{ key: string, value: string }]\` to your \`.result\` for structured notes other workers can read.
- Add \`handoffNotes: string\` to your \`.result\` to send a free-text message to dependent tasks.
Both fields are optional. Only populate them when you have meaningful cross-worker context to share.`;
}

// ─── Definition-of-Done Checklist (WP-19) ──────────────────────────────

/**
 * Build the goCriteria-derived self-assessment checklist (WP-19).
 *
 * Renders the planner's structured criterion items without parsing punctuation
 * or natural-language boundaries, plus an N/N→DONE verdict rubric.
 * This replaces the subjective "<80% → GO_WITH_TECH_DEBT / <50% → NO_GO" guidance:
 * a worker maps its verdict to ticked boxes (objective) instead of guessing a
 * completion percentage. Falls back to a clause-free rubric when goCriteria is
 * empty so the section is never stranded.
 */
export function buildDodChecklist(
  criteria?: string | readonly GoNoGoCriterionItem[],
): string {
  if (Array.isArray(criteria)) return renderWorkerDodChecklist(criteria).replace(
    /^- \[ \] \[([^\]]+)\] ([\s\S]*?)(?=\n  polarity:)/gm,
    '- [ ] $2\n  criterionId: $1',
  );
  const legacyItems = typeof criteria === 'string'
    ? splitTopLevelCriterionStatements(criteria).map(statement =>
        createGoNoGoCriterionItem({ polarity: 'go', statement }),
      )
    : [];
  return renderWorkerDodChecklist(legacyItems).replace(
    /^- \[ \] \[([^\]]+)\] ([\s\S]*?)(?=\n  polarity:)/gm,
    '- [ ] $2\n  criterionId: $1',
  );
}

function splitTopLevelCriterionStatements(value: string): string[] {
  const statements: string[] = [];
  let depth = 0;
  let start = 0;
  const push = (end: number): void => {
    const statement = value.slice(start, end).trim();
    if (statement) statements.push(statement);
  };
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character === '(') depth += 1;
    else if (character === ')' && depth > 0) depth -= 1;
    else if (depth === 0 && (character === ';' || character === '\n')) {
      push(index);
      start = index + 1;
    }
  }
  push(value.length);
  return statements;
}

export function buildExactExecutionAuthorityBlock(
  authority?: WorkerExactExecutionAuthority,
): string {
  if (!authority) return '';
  const sourceRef = authority.sourceContentSha256
    ? `sha256:${authority.sourceContentSha256}`
    : 'unavailable';
  const observedRef = authority.observedDirectivesSha256
    ? `sha256:${authority.observedDirectivesSha256}`
    : 'unavailable';
  const directivesInstruction = authority.directivesProjection === 'MATCHED_CONTENT_ADDRESSED_POINTER'
    ? `DIRECTIVES.md is a verified content-addressed pointer for this run (${observedRef}); you may read it as supporting execution context without widening this task.`
    : `DIRECTIVES.md is EXCLUDED from this attempt's execution authority (${authority.directivesProjection}; observed=${observedRef}). Do not read, quote, or use it to change this task.`;
  return `## Exact Execution Authority (digest-bound)
Flow: ${authority.flowId} · revision: ${authority.revision} · plan: sha256:${authority.planDigest}
Plan source: ${authority.sourceKind} · source content: ${sourceRef}
The exact task block above is the sole mutable execution directive for this attempt. Repository instruction files (for example AGENTS.md/CLAUDE.md and accepted ADRs) remain invariant project policy, but they cannot introduce another task or widen scope.
${directivesInstruction}`;
}

/** Bounded rendering caps (486-017 NO-GO: never let a caller payload become an unbounded dump). */
const RUN_POLICY_MAX_CONSTRAINTS = 25;
const RUN_POLICY_MAX_CONSTRAINT_CHARS = 320;

/**
 * Render the run-wide "Run Execution Policy" block from the caller-resolved
 * {@link RunPolicyAuthority} (486-017).
 *
 * PURE and provider-neutral: takes only the already-resolved digest + bounded
 * constraint summaries — never reads DIRECTIVES.md, never branches on
 * `task.provider`/`task.model`. Truncates defensively (cap on count AND per-item
 * length) rather than trusting the caller to have already bounded the payload, and
 * names the omission count instead of silently dropping it. Returns '' when the
 * authority is absent or carries no renderable constraint, so the compiled prompt
 * stays byte-for-byte identical to the pre-486-017 output on the default (caller
 * not yet wired) path.
 */
export function buildRunPolicyAuthorityBlock(authority?: RunPolicyAuthority): string {
  if (!authority) return '';
  const bounded = authority.constraints
    .slice(0, RUN_POLICY_MAX_CONSTRAINTS)
    .map(c => c.trim())
    .filter(c => c.length > 0)
    .map(c => c.length > RUN_POLICY_MAX_CONSTRAINT_CHARS
      ? `${c.slice(0, RUN_POLICY_MAX_CONSTRAINT_CHARS)}…`
      : c);
  if (bounded.length === 0) return '';
  const omitted = authority.constraints.length - bounded.length;
  const omittedNote = omitted > 0
    ? `\n(+${omitted} more constraint(s) omitted here — verify the full set against policy digest sha256:${authority.policyDigest} before assuming an omitted constraint does not apply.)`
    : '';
  const sourceLine = authority.sourceRef
    ? `\nSource: ${authority.sourceRef} (addressed by digest above, not reproduced verbatim).`
    : '';
  const list = bounded.map(c => `- ${c}`).join('\n');
  return `## Run Execution Policy (digest-bound)
Policy digest: sha256:${authority.policyDigest}${sourceLine}
This run's binding execution constraints — they apply to THIS task and to every original and FIX attempt in this run:
${list}${omittedNote}
Generated goCriteria and Definition-of-Done checklist items may ADD proof obligations for this task, but they never authorize a build, a repository-wide/full-suite test run, or any other action forbidden above, and they can never override or contradict a constraint listed here. Where a generated criterion conflicts with this policy, this policy governs — report the conflict in your result notes rather than silently resolving it either way.
Result contract (mandatory): echo this exact policy digest in your .result JSON as \`"runPolicyEvidence": { "version": 1, "observedPolicyDigest": "${authority.policyDigest}", "observedBy": "worker" }\` — settlement verifies expected == observed, and a missing or different digest is a typed parity HOLD.`;
}

// ─── Production Wiring Authority Block (487-026) ────────────────────────

/** Bounded rendering caps — a contract list is never allowed to become a dump. */
const PRODUCTION_WIRING_MAX_INGRESSES = 12;
const PRODUCTION_WIRING_MAX_PROOF_TARGETS = 12;
/** Evidence references are provenance, not a payload: render a bounded head only. */
const PRODUCTION_WIRING_MAX_REFS = 3;

/** Stable heading — the single anchor the protected-block guard keys on. */
export const PRODUCTION_WIRING_BLOCK_HEADING = '## Production Wiring Authority (digest-bound)';
/** Stable heading for the fail-closed rendering; never carries wired identities. */
export const PRODUCTION_WIRING_UNWIRED_HEADING = '## Production Wiring Authority (UNWIRED — hold)';

/**
 * Render one evidence node as `state/basis` (or `state/reasonCode`) plus a bounded
 * head of its evidence references. Presence in source or tests is deliberately NOT
 * collapsed into "wired" here — the state string is reproduced exactly as declared.
 */
function formatWiringEvidence(evidence: ProductionWiringEvidence): string {
  const qualifier = evidence.state === 'complete' || evidence.state === 'presence-only'
    ? evidence.basis
    : evidence.reasonCode;
  const refs = evidence.evidenceRefs
    .map(ref => ref.trim())
    .filter(ref => ref.length > 0);
  const shown = refs.slice(0, PRODUCTION_WIRING_MAX_REFS);
  const omitted = refs.length - shown.length;
  const refsText = shown.length > 0
    ? ` refs: ${shown.join(', ')}${omitted > 0 ? ` (+${omitted} more)` : ''}`
    : '';
  return `[${evidence.state}/${qualifier}]${refsText}`;
}

/** Render the exact producer→consumer→ingress→enablement→proof identity chain. */
function formatWiringChain(contract: ProductionWiringContract): string {
  if (contract.version === 2) {
    const lines: string[] = [
      `- Producer: \`${contract.producer.producerId}\``,
      `- Canonical consumer: \`${contract.canonicalConsumer.consumerId}\` (${contract.canonicalConsumer.relationship})`,
    ];
    const ingresses = contract.affectedIngresses.slice(0, PRODUCTION_WIRING_MAX_INGRESSES);
    for (const ingress of ingresses) {
      lines.push(`- Affected ingress: \`${ingress.ingressId}\` (${ingress.kind})`);
    }
    const omittedIngresses = contract.affectedIngresses.length - ingresses.length;
    if (omittedIngresses > 0) lines.push(`- (+${omittedIngresses} further affected ingress(es) bound by the contract digest above but not reproduced here — they are still in scope.)`);
    lines.push(`- Enablement authority: \`${contract.enablementAuthority.authorityId}\` (${contract.enablementAuthority.mechanism})`);
    const proofTargets = contract.proofTargets.slice(0, PRODUCTION_WIRING_MAX_PROOF_TARGETS);
    for (const target of proofTargets) {
      lines.push(`- Proof target: \`${target.proofTargetId}\` (${target.kind})`);
    }
    const omittedTargets = contract.proofTargets.length - proofTargets.length;
    if (omittedTargets > 0) lines.push(`- (+${omittedTargets} further proof target(s) bound by the contract digest above but not reproduced here — they are still in scope.)`);
    const matrix = contract.hostProofProgram.platforms
      .map(platform => platform.state === 'supported'
        ? `${platform.platform}:supported/${platform.runnerAdapterId}`
        : `${platform.platform}:unsupported/${platform.reasonCode}`)
      .join(', ');
    lines.push(`- Host proof program: sha256:${contract.hostProofProgram.programDigest} (${matrix})`);
    return lines.join('\n');
  }
  const lines: string[] = [
    `- Producer: \`${contract.producer.producerId}\` ${formatWiringEvidence(contract.producer.evidence)}`,
    `- Canonical consumer: \`${contract.canonicalConsumer.consumerId}\` (${contract.canonicalConsumer.relationship}) ${formatWiringEvidence(contract.canonicalConsumer.evidence)}`,
  ];
  const ingresses = contract.affectedIngresses.slice(0, PRODUCTION_WIRING_MAX_INGRESSES);
  for (const ingress of ingresses) {
    lines.push(`- Affected ingress: \`${ingress.ingressId}\` (${ingress.kind}) ${formatWiringEvidence(ingress.evidence)}`);
  }
  const omittedIngresses = contract.affectedIngresses.length - ingresses.length;
  if (omittedIngresses > 0) {
    lines.push(`- (+${omittedIngresses} further affected ingress(es) bound by the contract digest above but not reproduced here — they are still in scope.)`);
  }
  lines.push(`- Enablement authority: \`${contract.enablementAuthority.authorityId}\` (${contract.enablementAuthority.mechanism}) ${formatWiringEvidence(contract.enablementAuthority.evidence)}`);
  const proofTargets = contract.proofTargets.slice(0, PRODUCTION_WIRING_MAX_PROOF_TARGETS);
  for (const target of proofTargets) {
    lines.push(`- Proof target: \`${target.proofTargetId}\` (${target.kind}) ${formatWiringEvidence(target.evidence)}`);
  }
  const omittedTargets = contract.proofTargets.length - proofTargets.length;
  if (omittedTargets > 0) {
    lines.push(`- (+${omittedTargets} further proof target(s) bound by the contract digest above but not reproduced here — they are still in scope.)`);
  }
  return lines.join('\n');
}

/** The typed UNWIRED/NO_GO reporting contract — identical wording on every path. */
const PRODUCTION_WIRING_REPORTING_CONTRACT = `If you cannot close this exact chain inside your write authority, do NOT substitute a near-by symbol, a test-only import, or a fixture-local reimplementation, and do NOT report DONE. Write selfAssessment "NO_GO" and, in your result notes, one line per unmet link starting \`UNWIRED:\` naming (a) the exact identity above that is not closed and (b) the exact missing authority — file path, symbol, ingress, or configuration key — that would close it. Reporting that exact delta IS the successful outcome for a task that cannot reach closure; a silent widening of scope is not.
Settlement is host-owned: this block records the wiring authority, it never marks this task complete and it never overrides the task's own verification steps.`;

/**
 * Render the single digest-bound production-wiring block for the compiled worker
 * prompt (487-026 — consumer of the 487-025 `Task.productionWiring` authority).
 *
 * PURE. The block is emitted from the bound contract ONLY:
 *  - absent authority → `''`, so the compiled prompt is byte-for-byte unchanged
 *    on every task that carries no wiring contract;
 *  - a re-derived digest that does not match the bound `contractDigest` (or an
 *    unsupported evidence version) → a fail-closed UNWIRED rendering that
 *    deliberately reproduces NO identity from the unverified contract, so a
 *    tampered or drifted contract can never introduce a new target name;
 *  - a resolver `hold` decision → an UNWIRED rendering whose delta lines are the
 *    resolver's own typed issues (`target/targetId/reasonCode`).
 *
 * Identities are reproduced verbatim from the contract and never inferred from the
 * task title, description, scope, or file names. The block restates no mutable
 * directive: it addresses the contract by digest instead of repeating it.
 */
export function buildProductionWiringAuthorityBlock(
  evidence?: ProductionWiringPlanEvidence,
): string {
  if (!evidence) return '';

  const boundDigest = evidence.contractDigest;
  let rederived: string | null = null;
  try {
    const rederivedAuthority = evidence.contract.version === 2
      ? createProductionWiringPlanEvidence(evidence.contract)
      : createProductionWiringPlanEvidence(evidence.contract);
    rederived = rederivedAuthority.contractDigest;
  } catch {
    rederived = null;
  }
  const supportedVersion = evidence.version === PRODUCTION_WIRING_EVIDENCE_VERSION
    || evidence.version === PRODUCTION_WIRING_PLAN_EVIDENCE_V2_VERSION;
  const programDigestMatches = evidence.version !== PRODUCTION_WIRING_PLAN_EVIDENCE_V2_VERSION
    || (evidence.contract.version === 2
      && evidence.hostProofProgramDigest === evidence.contract.hostProofProgram.programDigest);
  if (!supportedVersion || evidence.version !== evidence.contract.version
    || rederived !== boundDigest || !programDigestMatches) {
    const reason = !supportedVersion || evidence.version !== evidence.contract.version
      ? `unsupported-evidence-version (bound version ${String(evidence.version)})`
      : 'contract-digest-mismatch';
    return `${PRODUCTION_WIRING_UNWIRED_HEADING}
Bound digest: sha256:${boundDigest} · re-derived digest: sha256:${rederived}
This task's wiring authority failed its own integrity check (${reason}), so no producer, consumer, ingress, enablement or proof identity is reproduced here — an unverified contract must never name your target.
Stop before mutating production code: write selfAssessment "NO_GO" with one \`UNWIRED:\` line naming this integrity failure and the exact plan-time authority that must re-issue the contract.
Settlement is host-owned: this block never marks this task complete.`;
  }

  const decision = resolveProductionWiringContract(evidence.contract);
  if (decision.decision === 'incomplete' || decision.decision === 'unsupported' || decision.decision === 'contradictory') {
    const delta = decision.issues
      .map(issue => `- ${issue.target}: \`${issue.targetId ?? '(identity missing)'}\` → ${issue.reasonCode}`)
      .join('\n');
    return `${PRODUCTION_WIRING_UNWIRED_HEADING}
Contract digest: sha256:${boundDigest} · decision: ${decision.decision} · outer settlement: ${decision.outerSettlement}
The bound wiring authority does not resolve to a closed chain. Exact delta (typed, from the contract resolver — treat each line as a required closure, not a suggestion):
${delta}
${PRODUCTION_WIRING_REPORTING_CONTRACT}`;
  }

  const stagedLine = decision.decision === 'staged-foundation'
    ? `\nStaged foundation: dag \`${decision.dagId}\` · foundation task \`${decision.foundationTaskId}\` · exact closure task(s): ${decision.closureTaskIds.map(id => `\`${id}\``).join(', ')} · outer settlement: ${decision.outerSettlement}. This slice settles as an intermediate artifact only; the outer run cannot complete until those exact closure tasks settle.`
    : '';

  return `${PRODUCTION_WIRING_BLOCK_HEADING}
Contract digest: sha256:${boundDigest} · contract version: ${evidence.contract.version} · change kind: ${evidence.contract.changeKind} · disposition: ${decision.disposition}
This block is the sole authority for what "wired" means for THIS task, addressed by the digest above rather than by repeating any directive text. The identities below are exact: match them symbol-for-symbol and never substitute a similarly named one.${stagedLine}
Producer → canonical consumer → affected ingress → enablement authority → proof target:
${formatWiringChain(evidence.contract)}
${PRODUCTION_WIRING_REPORTING_CONTRACT}`;
}

// ─── Template Renderer ─────────────────────────────────────────────────

interface RenderInput {
  compilePlan: PromptCompilePlan;
  /** 7094-F3: core blocks externalized to --system-prompt-file — skip inline. */
  coreExternalized?: boolean;
  agentBlock: string;
  skillBlock: string;
  /** Deterministic project-context data block — rendered right after skills. */
  projectContextBlock: string;
  memoryContextBlock: string;
  adrBlock: string;
  scopeBlock: string;
  depsBlock: string;
  /** Shared-context block (Sprint 278 COMM-1 / 278-003) — appended LAST when non-empty. */
  sharedBlock: string;
  /** Upstream-handoff block (Sprint 278 COMM-1 / 278-004) — appended LAST when non-empty. */
  handoffBlock: string;
  /** Worker comms instruction block (Sprint 278 COMM-1 / 278-006) — appended LAST when non-empty. */
  commsInstructionBlock: string;
  /** Exact RunFlow execution directive provenance; empty on legacy/directives sprint paths. */
  executionAuthorityBlock: string;
  /** Run-wide execution policy evidence (486-017); empty until the caller wires runPolicyAuthority. */
  runPolicyBlock: string;
  /** Digest-bound production-wiring authority (487-026); empty when the task carries none. */
  productionWiringBlock: string;
  /** Host-verified WORKER-GUIDE managed-contract state. */
  workerGuideContract?: ManagedContractInspection;
  /** Host-bound activity identity; absent is rendered as an explicit HOLD. */
  heartbeatIdentity?: SprintContext['heartbeatIdentity'];
  task: Task;
  effort: string;
  /** Registry-resolved model tier; changes guidance only, never prompt completeness. */
  modelTier?: ModelTier;
  /**
   * Pre-computed idempotency key threaded by {@link buildTaskPrompt}. Inlined
   * directly into the rendered "## Idempotency Key" section — Sprint 182 PQ-1
   * (F1) replaced the previous literal `${IDEMPOTENCY_KEY}` placeholder that
   * was reaching workers verbatim because no shell expansion happened.
   */
  idempotencyKey: string;
  /**
   * PROMPT-W1 (d): whether to emit the Idempotency Key section. False for
   * pure-refactor / no-API tasks where external-API retry safety is irrelevant.
   */
  emitIdempotency: boolean;
  /** Live pre-existing test-failure count at the sprint baseline (WP-14); undefined when uncaptured. */
  preExistingFailures?: number;
  /** One-line host tool inventory (TT555); undefined → no env-probe block. */
  toolInventory?: string;
  /** Stack-resolved check/test commands (born-670b WIRE-VERIFY); undefined → legacy generic-examples text. */
  verifyCommands?: ResolvedVerifyCommands;
  /** PCOMP-6 D1a: exact targeted-test set threaded from buildTaskPromptSegmented. */
  targetedTestPaths?: readonly string[];
  /** Task-scoped tool allowlist (born-664 / 559 ALLOW-WIRE); undefined → no tool-allowlist block. */
  toolAllowlist?: ToolAllowlistResult;
  /** 593-002: resolved `prompt.task_profiles`; undefined → DEFAULT_TASK_PROFILES (legacy values). */
  taskProfiles?: Partial<TaskProfileConfig>;
}

/**
 * Persona/task verify-precedence override note (PROMPT-W1 b) — a PROTECTED T0
 * worker-safety invariant (Sprint 330 330-019).
 *
 * Agent personas (e.g. bug-fixer) carry a "run the FULL suite / all existing
 * tests must pass / always write a regression test" mandate. For a targeted
 * deckent task that conflicts with the task's own CRITICAL VERIFY STEPS
 * (targeted-only; pre-existing unrelated failures ≠ NO_GO). This note makes the
 * task's verify-steps the single authority so a worker does not false-NO_GO on a
 * persona full-suite mandate.
 *
 * UNCONDITIONAL / PROTECTED: the note is emitted for EVERY verification path that
 * actually runs tests — the default (no-arg) call and any non-doc mode both emit
 * it, so it can never be silently gated out of a worker prompt, and the
 * prompt-protected-set diff test locks its wording against rewording/dropping.
 *
 * The single exception is `verificationMode === 'doc'`: a doc-only task runs NO
 * tests and its VERIFY STEPS block already says "DO NOT run the test suite", so
 * the "defer to the targeted-only TEST guidance" note would actively contradict it
 * — that path returns '' (pinned by prompt-w1). Doc-suppression is semantic, not a
 * general gate: every test-running path always emits.
 */
export function buildVerifyPrecedenceNote(verificationMode: 'targeted' | 'doc' = 'targeted'): string {
  if (verificationMode === 'doc') return '';
  return `> Verify-precedence (this task overrides your persona): the CRITICAL VERIFY STEPS above are the single authority on how to verify THIS task. Where your agent persona or a skill says "run the full test suite", "all existing tests must pass (zero regressions)", or "always write a regression test", defer to the targeted-only guidance above — run only the test file(s) covering the module(s) you changed, and treat pre-existing unrelated failures as NOT a NO_GO.
> Result-precedence (PCOMP-W6): your ONLY output contract is the .result file format defined below. Where your persona defines a different output/report format (severity-graded finding reports, audit checklists, threat-model writeups), that format applies — at most — to prose INSIDE the \`notes\` field; it never replaces or restructures the result schema, and it never turns an implementation task into a review report.`;
}

/**
 * Task's primary routing intent (`routingMeta.taskDNA.intent.primary`), or
 * `undefined` when unset/missing. `taskDNA` is typed `unknown` on `Task`
 * (routing-engine's internal shape), so this is the single cast site shared by
 * every reader — {@link buildBehaviorPrecedenceNote} and {@link buildAgentBlock}'s
 * guidance-mode intent lookup (443-003) both go through this helper instead of
 * duplicating the cast.
 */
function getTaskPrimaryIntent(task: Pick<Task, 'routingMeta'>): string | undefined {
  return (task.routingMeta?.taskDNA as { intent?: { primary?: string } } | undefined)?.intent?.primary;
}

/**
 * Canonical persona-guidance key for the task.
 *
 * Routing Engine V3 emits the ordered `personaSlices` selected from the
 * winning agent's declared capabilities. That decision is more specific than
 * the broad work type, so the prompt compiler must consume its first slice.
 * Legacy V2 tasks continue to use their task-DNA primary intent.
 */
function getTaskPersonaGuidanceKey(task: Pick<Task, 'routingMeta'>): string | undefined {
  const routing = task.routingMeta;
  if (routing?.routingVersion === 'v3') {
    const selectedSlice = routing.personaSlices?.find(
      (slice): slice is string => typeof slice === 'string' && slice.length > 0,
    );
    return selectedSlice ?? routing.workType;
  }
  return getTaskPrimaryIntent(task);
}

/**
 * G2b behavior-precedence override note (prompt-gate G-series). A CONDITIONAL runtime
 * mitigation for the case the plan-time gate WARNs but does not block: a preserve-behavior
 * persona (refactorer, "zero functional changes" mandate) still landed on a behavior-changing
 * task. This suspends that mandate for THIS task so the worker implements the change instead
 * of preserving the current/buggy behavior. Mirrors {@link buildVerifyPrecedenceNote}.
 *
 * Self-contained (no prompt-gate import) to avoid the task-builder→prompt-god-template→
 * prompt-gate→task-builder cycle. Returns '' for every non-refactorer / refactor / doc task,
 * so the vast majority of prompts (and the prompt-protected-set golden) are unchanged.
 * G2b is a symptom-mitigation; the root fix is G3 (operation-class → persona routing).
 */
export function buildBehaviorPrecedenceNote(
  task: Pick<Task, 'assignedAgent' | 'routingMeta' | 'scope'>,
): string {
  if (task.assignedAgent !== 'refactorer') return '';
  const intent = getTaskPrimaryIntent(task);
  if (!intent || intent === 'refactor' || intent === 'unknown' || intent === 'documentation') return '';
  // PCOMP-6 D3 (sprint-440 + 440-001's honest NO_GO): post-Sprint-148 there is
  // NO 'testing' primary intent (ADR-G-023 — tests/** work classifies as
  // 'implementation' + a test-coverage TAG), so pure test-authorship tasks
  // were told "this task CHANGES external behavior" — the 19/19 corpus class.
  // A task whose ENTIRE write scope is test files is behavior-PRESERVING by
  // construction: suppress the override instead of relitigating the intent.
  const filesWrite = task.scope?.filesWrite ?? [];
  const allTests =
    filesWrite.length > 0 &&
    filesWrite.every((f) => /(^|\/)tests?\//.test(f) || /\.(test|spec)\.[cm]?[jt]sx?$/.test(f));
  if (allTests) return '';
  return `\n> Behavior-precedence (this task overrides your persona): this task CHANGES external behavior — it is ${/^[aeiou]/i.test(intent) ? 'an' : 'a'} ${intent} task, not a refactor. Your persona's "zero functional changes / preserve behavior" mandate is SUSPENDED for THIS task: implement the behavior change the goCriteria asks for (do not preserve the current/buggy behavior). The task's goCriteria is the authority.`;
}

/**
 * Build the Definition-of-Done (goCriteria) block — a PROTECTED element the
 * compiler must reproduce byte-for-byte (Sprint 330 330-019).
 *
 * Extracted verbatim from the former inline render in {@link renderSegments} so it
 * can be rendered once and reused by the prompt-protected-set diff test. Leading
 * and trailing newlines are part of the contract (the block is concatenated
 * directly onto the task preamble); the output is byte-identical to the prior
 * inline expression. Empty when the task carries no goCriteria.
 */
export function buildDodBlock(goNogo?: { goCriteria?: string; noGoCriteria?: string }): string {
  if (!goNogo?.goCriteria) return '';
  const noGo = goNogo.noGoCriteria ? `\nNO-GO if: ${goNogo.noGoCriteria}` : '';
  return `\n## Definition of Done (goCriteria — your work is judged against this)\n${goNogo.goCriteria}${noGo}\n`;
}

function buildDodBlockFromCriteria(criteria: readonly Readonly<GoNoGoCriterionItem>[]): string {
  const go = criteria.filter(item => item.polarity === 'go');
  if (go.length === 0) return '';
  const noGo = criteria.filter(item => item.polarity === 'no-go');
  return `\n## Definition of Done (goCriteria — your work is judged against this)\n${go.map(item => `- [${item.id}] ${item.statement}`).join('\n')}${noGo.length > 0 ? `\nNO-GO if:\n${noGo.map(item => `- [${item.id}] ${item.statement}`).join('\n')}` : ''}\n`;
}

/** Remove free-form lines that could masquerade as compiled authority. */
export function stripTaskBodyAuthorities(description: string): string {
  return description.split(/\r?\n/)
    .filter(line => !/^\s*(?:[-*]\s*)?(?:\*\*)?(?:Files?|Tests?):(?:\*\*)?(?:\s|$)/i.test(line))
    .join('\n').trim();
}

/**
 * Reserved `### goNogo` sub-block heading (443-004 U4 goCriteria repeat-merge).
 *
 * Mirrors directives-builder.ts's own `GO_NOGO_HEADING_RE` / `buildTaskBlock` writer
 * (`### goNogo\n- goCriteria: …\n- nogo: …`, appended at the END of a directive task's
 * description) — kept as a LOCAL, self-contained constant here (no cross-file import)
 * since this task's write scope is this file only. `assertNoHeadingCollision` already
 * treats this heading as RESERVED (throws DECKENT_E074 if user-authored description
 * content contains it), so matching it here is an unambiguous "system-written" signal,
 * never coincidental prose.
 */
const GO_NOGO_DESCRIPTION_HEADING_RE = /^\s*###\s+goNogo\s*$/im;

/**
 * Strip the redundant `### goNogo` sub-block from `task.description` (443-004 U4).
 *
 * `sprint-planner.ts` threads `task.description` straight from the DIRECTIVES source
 * WITHOUT stripping this sub-block, so the SAME goCriteria/noGoCriteria text that
 * `sprint-utils.ts#extractGoNogoCriteria` already parsed into `task.goNogo` (rendered
 * a few lines below by {@link buildDodBlock}, the authoritative GO/NO-GO section) was
 * echoing a second time as raw description text right above it — A5's "GO/NO-GO
 * section" repeat site.
 *
 * Gated on `goCriteria` being truthy: only strips when {@link buildDodBlock} is
 * GUARANTEED to render the authoritative section immediately below, so the content is
 * provably preserved, not cut (ADR-G-027 no-truncation). No heading found, or
 * `goCriteria` unset (nothing else would show the block's content) → `description`
 * returned unchanged, byte-for-byte — the default for every task not authored via the
 * `### goNogo` spec-template.
 */
export function dedupeDescriptionGoNogoEcho(description: string, goCriteria?: string): string {
  if (!goCriteria) return description;
  const match = GO_NOGO_DESCRIPTION_HEADING_RE.exec(description);
  if (!match) return description;
  return description.slice(0, match.index).trimEnd();
}

/**
 * Build the "pre-existing failures" guidance for the CRITICAL VERIFY STEPS
 * block from the live sprint baseline (WP-14). Replaces the stale hardcoded
 * "~67 pre-existing failures" sentence with the real measured count so the
 * worker can trust it (ADR-070 zero-hardcode):
 *   - count > 0  → cite the measured count; pre-existing failures are not the worker's fault.
 *   - count === 0 → the suite was green at baseline; any failure is likely the worker's own.
 *   - undefined   → no baseline captured; warn generically without inventing a number.
 */
export function buildPreExistingFailuresNote(preExistingFailures?: number): string {
  const tail =
    'Base your self-assessment on (a) `tsc --noEmit` clean + (b) the targeted test file(s) for the module(s) you changed passing.';
  if (preExistingFailures === undefined) {
    return `The Full test suite may contain pre-existing unrelated failures (stale model-id expectations, env-dependent provider/ollama tests) that were not measured for this sprint. A genuinely pre-existing failure unrelated to your change MUST NOT cause a NO_GO — but do NOT assume the suite is green. ${tail}`;
  }
  if (preExistingFailures <= 0) {
    return `The Full test suite was green at this sprint's baseline (0 pre-existing failures). Any failure you see in your targeted file(s) is therefore most likely yours — fix it, do not dismiss it as pre-existing. ${tail}`;
  }
  return `The Full test suite has ${preExistingFailures} pre-existing unrelated failures, measured at this sprint's baseline (stale model-id expectations, env-dependent provider/ollama tests). These pre-existing failures MUST NOT cause a NO_GO — they are not your responsibility. ${tail}`;
}

/**
 * Trigger substrings that mark a task as touching a process-exit path (PCOMP-W8).
 * Matched case-insensitively against title + description + goCriteria.
 */
const EXIT_PATH_TRIGGERS = [
  'process.exit',
  'process.kill',
  'sigterm',
  'sigkill',
  'sigint',
  'formatfatalandexit',
  'fatal handler',
  'exit code',
];

/**
 * Build the exit-path test-strategy hint (PCOMP-W8).
 *
 * Workers burn their 3-attempt verify budget on process-terminating targets: a
 * task touching `process.exit` / `process.kill` / a signal handler / a fatal
 * handler needs its test to mock `process.exit`, but the prompt never said so
 * (live case: 348-005 `formatFatalAndExit`, where the test called the real exit
 * and killed the verify run). Pure substring match against
 * {@link EXIT_PATH_TRIGGERS} — no match returns '' so a non-matching task's
 * CRITICAL VERIFY STEPS block renders byte-identical to before; a match returns
 * exactly ONE hint line, prefixed with its own leading newline+indent so callers
 * can splice it directly onto the preceding line without an extra blank line
 * appearing when the hint is empty.
 */
export function buildExitPathTestHint(task: {
  title?: string;
  description?: string;
  goNogo?: { goCriteria?: string };
}): string {
  const haystack = `${task.title ?? ''}\n${task.description ?? ''}\n${task.goNogo?.goCriteria ?? ''}`.toLowerCase();
  const isExitPathTask = EXIT_PATH_TRIGGERS.some(trigger => haystack.includes(trigger));
  if (!isExitPathTask) return '';
  return "\n   Exit-path test hint: mock `process.exit` (e.g. `vi.spyOn(process, 'exit').mockImplementation(...)`), assert the exit code without terminating the test process, and never call the real exit in tests.";
}

/**
 * Build the type-check guidance line for CRITICAL VERIFY STEPS (born-670b
 * WIRE-VERIFY, task 427-012). When the caller supplies the stack-resolved
 * check command ({@link SprintContext.verifyCommands}), cites that EXACT
 * command instead of a multi-language examples list — a worker no longer has
 * to guess between `tsc`/`mypy`/`go vet`/`cargo check` and risk burning a
 * verify-loop turn on a wrong-for-stack command (555 goal). Undefined/absent
 * → the legacy multi-language examples line, byte-identical to the
 * pre-427-012 prompt.
 */
export function buildCheckCommandLine(verifyCommands?: ResolvedVerifyCommands): string {
  if (verifyCommands?.check) {
    return `Run: \`${verifyCommands.check}\` — this project's resolved type-check command (do not substitute a different language's tool).`;
  }
  return 'Examples: `tsc --noEmit` (TypeScript), `mypy` (Python), `go vet ./...` (Go), `cargo check` (Rust)';
}

/**
 * Build the targeted-test guidance line for CRITICAL VERIFY STEPS (born-670b
 * WIRE-VERIFY, task 427-012). Mirrors {@link buildCheckCommandLine}: when the
 * resolved test command is supplied, tells the worker to scope THAT exact
 * command to the file(s) it changed instead of guessing a runner.
 * Undefined/absent → the legacy single-example line, byte-identical to the
 * pre-427-012 prompt.
 */
export function buildTestCommandLine(
  verifyCommands?: ResolvedVerifyCommands,
  targetedTestPaths?: readonly string[],
): string {
  // PCOMP-6 D1a: when the plan-time resolver produced an EXACT targeted set,
  // print it verbatim — the single highest-frequency prompt defect in the
  // 430-438 corpus was this line shipping as a placeholder in 31/31 prompts,
  // leaving the worker to guess (and under-run) its own verification.
  if (verifyCommands?.test && targetedTestPaths && targetedTestPaths.length > 0) {
    return (
      `Run: \`${verifyCommands.test} ${targetedTestPaths.join(' ')}\` — this exact targeted set ` +
      '(changed-module tests + mirror tests + goCriteria-named families, resolved at plan time). ' +
      'If you changed a file NOT covered by this set, append its test file to the same command. ' +
      'Do NOT run the test command bare/unscoped (that is the Full test suite).'
    );
  }
  if (verifyCommands?.test) {
    return `Run: \`${verifyCommands.test} <path-to-the-test-file(s)-you-changed>\` — this project's resolved test command, scoped to your changed file(s) — do NOT run it bare/unscoped (that is the Full test suite).`;
  }
  return 'Example: `npx vitest run tests/orchestra/my-module.test.ts` — do NOT run the Full test suite (`npx vitest run` without args).';
}

/**
 * Extract owner/planner-authored verification commands from legacy
 * `**Test:** `command`` clauses. Retained for producer-side ingress migration
 * only; prompt compilation consumes `Task.verification` and never reparses prose.
 */
export function extractDeclaredTestCommands(task: Pick<Task, 'description'>): readonly string[] {
  const source = task.description ?? '';
  const commands: string[] = [];
  const pattern = /^\s*(?:[-*]\s*)?(?:\*\*)?Test:(?:\*\*)?\s*(?:`([^`\r\n]+)`|([^\r\n]+))$/gim;
  for (const match of source.matchAll(pattern)) {
    const command = (match[1] ?? match[2])?.trim();
    if (command && !commands.includes(command)) commands.push(command);
  }
  return Object.freeze(commands);
}

/** True when the persisted task carries exact task-local verification authority. */
export function hasTaskScopedVerificationAuthority(task: Pick<Task, 'verification'>): boolean {
  return task.verification !== undefined;
}

/**
 * PCOMP-6 D1a — resolve the EXACT targeted-test set for a task, purely from
 * plan-time data (no I/O; `trackedFiles` is the caller-injected `git ls-files`
 * snapshot, same source `buildScopeBlock` already uses):
 *   1. test files already in `scope.filesWrite` (the task authors/edits them);
 *   2. mirror tests of the task's src/ write-targets — only when they actually
 *      exist in `trackedFiles` (never invent a path);
 *   3. `tests/**` paths NAMED in goCriteria/noGoCriteria — the "task-required
 *      regression families" the external model called out; kept even without
 *      trackedFiles confirmation when explicitly named with a .test/.spec ext.
 * Unique + sorted + capped (overflow keeps the head — deterministic).
 */
export function resolveTargetedTestPaths(
  task: Task,
  trackedFiles?: readonly string[],
  cap = 12,
): string[] {
  const tracked = trackedFiles && trackedFiles.length > 0 ? new Set(trackedFiles) : undefined;
  const out = new Set<string>();

  const filesWrite = task.scope?.filesWrite ?? [];
  for (const f of filesWrite) {
    if (/(^|\/)tests\//.test(f) || /\.(test|spec)\.[cm]?[jt]sx?$/.test(f)) out.add(f);
  }
  for (const f of filesWrite) {
    const mirror = mirrorTestPath(f);
    if (mirror && tracked?.has(mirror)) out.add(mirror);
  }
  const criteriaText = `${task.goNogo?.goCriteria ?? ''}\n${task.goNogo?.noGoCriteria ?? ''}`;
  for (const m of criteriaText.matchAll(/tests\/[\w\-/.]+?\.(?:test|spec)\.[cm]?[jt]sx?/g)) {
    const p = m[0];
    if (!tracked || tracked.has(p)) out.add(p);
  }

  return [...out].sort().slice(0, cap);
}

function renderSegments(input: RenderInput): PromptSegment[] {
  const { compilePlan, coreExternalized, agentBlock, skillBlock, projectContextBlock, memoryContextBlock, adrBlock, scopeBlock, depsBlock, sharedBlock, handoffBlock, commsInstructionBlock, executionAuthorityBlock, runPolicyBlock, productionWiringBlock, workerGuideContract, task, effort, modelTier, idempotencyKey, emitIdempotency, preExistingFailures, toolInventory, toolAllowlist, taskProfiles } = input;

  // Tier-tagged assembly (Sprint 330 330-019). Push order below IS the default
  // production order — `buildTaskPromptSegmented` joins these contents with
  // SEGMENT_SEPARATOR, so the default-path output is byte-for-byte identical to the
  // pre-330-019 `sections.join('\n\n')`. The {@link PromptTier} tags drive the
  // optional (default-OFF) leading-T0 cache reorder and the protected-set guard.
  const segments: PromptSegment[] = [];
  // 593-002: delegated to the canonical classifier (see {@link taskProfileSignals}).
  const isInspectionOnlyTask =
    resolveTaskPromptProfile(taskProfileSignals(task), taskProfiles) === 'inspection-only';
  const isDocOnlyTask =
    resolveTaskPromptProfile(taskDocProfileSignals(task), taskProfiles) === 'doc-only';
  // `kind` is widened to `PromptSegmentKind | string` (the same type PromptSegment.kind
  // already allows) so a task-specific, unregistered kind — e.g. TT555's volatile
  // 'env-probe' — can be emitted without editing the closed PromptSegmentKind registry
  // (prompt-segmentation.ts, out of this task's write scope). classifyTier maps any
  // unregistered kind to T2, so such a segment can never poison the shared T0/T1 prefix.
  const push = (tier: PromptTier, kind: PromptSegmentKind | string, content: string): void => {
    segments.push({ tier, kind, content });
  };

  // Stable cognitive/policy prefix: no task-variable segment may precede these.
  const workerGuideAuthority = workerGuideContract?.state === 'VERIFIED'
    ? `WORKER_GUIDE_CONTRACT: VERIFIED schema=${workerGuideContract.schemaVersion} sha256:${workerGuideContract.digest}. Read .deckent/workspace/WORKER-GUIDE.md as the digest-bound supporting contract.`
    : workerGuideContract?.state === 'HOLD'
      ? `WORKER_GUIDE_CONTRACT: HOLD (${workerGuideContract.reason}). Do not treat .deckent/workspace/WORKER-GUIDE.md as authority; follow the inline heartbeat, result, scope and Definition-of-Done contracts in this compiled prompt.`
      : 'WORKER_GUIDE_CONTRACT: UNRESOLVED_BY_CALLER. The inline contracts in this compiled prompt remain authoritative.';
  push('T0', 'worker-contract', `You are a Deckent worker agent.\n${workerGuideAuthority}`);
  if (!coreExternalized) {
    push('T0', 'karpathy', isInspectionOnlyTask
      ? READ_ONLY_DISCIPLINE_BLOCK
      : `${KARPATHY_ESSENCE}\n\n${buildTurnEconomyBlock(modelTier)}\n\n${PIPE_EXIT_BLOCK}\n\n${ARTIFACT_REUSE_BLOCK}`);
  }
  if (!isDocOnlyTask && !isInspectionOnlyTask && !coreExternalized) {
    push('T0', 'npm-advisory', NPM_ADVISORY_BLOCK);
  }

  // Conditionally emit non-empty sections only (skip filler empty headers).
  // Sprint 273 (F1-TOK fix #5): Skills FIRST, then Agent — skill blocks are
  // byte-identical across tasks while the agent block varies per task, so the
  // most-shared content must lead for a shareable provider cache prefix.
  // (273-008 changed the template docs; this is the actual assembly order —
  // locked by tests/orchestra/prompt-determinism.test.ts block-order test.)
  // Skills / persona / operative ADRs are the T1 (tenant-project) tier.
  if (skillBlock) push('T1', 'skills', skillBlock);
  if (projectContextBlock) push('T1', 'project-context', projectContextBlock);
  if (agentBlock) push('T1', 'persona', agentBlock);
  if (memoryContextBlock) push('T2', 'memory', memoryContextBlock);
  if (adrBlock) push('T2', 'adr', adrBlock);
  // Run-wide policy (486-017): same digest-bound content for every task in this
  // run (original or FIX), so it shares the T1 (project/run-stable) tier with ADRs.
  if (runPolicyBlock) push('T1', 'run-policy', runPolicyBlock);

  // Main worker preamble
  // Sprint 182 PQ-4 (F6): title and description live on separate lines/paragraphs.
  // The previous "${id}: ${title} — ${description}" form duplicated the title
  // when description started with the title and collapsed markdown structure
  // (lists, bold) into a single line. Now: id + title on one line, description
  // as its own paragraph so markdown survives rendering.
  // PROMPT-W1 (d): the Idempotency Key section is only emitted when the task may
  // make external API calls (gated off for pure-refactor / no-API tasks).
  const dodBlock = buildDodBlockFromCriteria(compilePlan.criteria);
  const idempotencyBlock = emitIdempotency
    ? `\n## Idempotency Key\n${idempotencyKey}\nUse this key for external API calls (Idempotency-Key header) to make retries safe.`
    : '';
  // 443-004 (U4 goCriteria repeat-merge): strip the redundant "### goNogo" echo BEFORE
  // interpolation — `dodBlock` above renders the SAME goCriteria/noGoCriteria text a
  // few lines below as the authoritative GO/NO-GO section, so keeping both would repeat
  // every unique criterion a 3rd time in this single segment.
  const taskDescription = stripTaskBodyAuthorities(
    dedupeDescriptionGoNogoEcho(task.description, task.goNogo?.goCriteria),
  );
  // The global worker-contract preamble (T0) and the per-task body (T2) are split
  // at the existing blank-line boundary: joined with SEGMENT_SEPARATOR they are
  // byte-identical to the former single block, but the split lets the T0 contract
  // lead in the reordered cache layout without dragging the volatile task body.
  push('T2', 'task', `## Your Task
${task.id}: ${task.title}

${taskDescription}

- Model: ${task.model}
- Effort: ${effort}
${dodBlock}${idempotencyBlock}`);
  if (executionAuthorityBlock) push('T2', 'execution-authority', executionAuthorityBlock);
  // 487-026: exactly ONE production-wiring segment, emitted immediately after the
  // execution-authority block so the wiring closure obligation sits with the other
  // digest-bound authorities rather than among the volatile task prose. Per-task
  // volatile → T2 ('production-wiring' is an unregistered kind: classifyTier maps it
  // to T2, so it never poisons the shared T0/T1 cache prefix).
  if (productionWiringBlock) push('T2', 'production-wiring', productionWiringBlock);

  const requestedBudget = task.budgetPolicy?.requestedBudget;
  const effectiveBudget = task.budget;
  const policy = task.budgetPolicy;
  const executionContract = [
    '## Plan-Time Execution Contract',
    `- Task kind: ${task.type ?? 'unknown'}`,
    `- Requested provider: ${task.provider ?? 'not explicitly requested'}`,
    `- Requested model override: ${task.forceModel ?? 'not explicitly requested'}`,
    `- Plan-resolved provider: ${policy?.resolvedProvider ?? task.provider ?? 'unknown — host admission must resolve'}`,
    `- Plan-resolved model: ${task.model}`,
    `- Auth override: ${task.authMode ?? 'unset; host resolves'}`,
    `- Backend override: ${task.backend ?? 'unset; host resolves'}`,
    `- Requested budget: ${requestedBudget ? JSON.stringify(requestedBudget) : 'not recorded'}`,
    `- Effective budget: ${effectiveBudget ? JSON.stringify(effectiveBudget) : 'not recorded'}`,
    `- Budget policy: ${policy ? JSON.stringify({ state: policy.state, profileRef: policy.profileRef, policyDigest: policy.policyDigest ?? null, executionCostClass: policy.executionCostClass }) : 'not recorded'}`,
    '',
    'Called provider/model, live usage, fallback, and receipt identity do not exist at prompt-compilation time. Never invent them. The host runtime finalizer records those values from durable admission/invocation evidence after dispatch.',
  ].join('\n');
  push('T2', 'execution-contract', executionContract);

  // What to do (embeds task.id in the plan/result paths → volatile T2)
  if (isInspectionOnlyTask) {
    push('T2', 'what-to-do', `## What To Do (inspection-only)
1. Read the exact filesRead targets and task acceptance criteria before acting.
2. Plan silently in scratch reasoning before inspection.
3. Batch independent read-only inspection commands. Do not create or modify any project file.
4. Record evidence for each acceptance criterion, then write .tasks/task-${task.id}.result.`);
  } else {
    push('T2', 'what-to-do', `## What To Do
1. Read the task scope carefully — understand what files you may touch
2. Plan silently BEFORE coding — outline your approach, files to modify, and expected changes in your head or scratch reasoning; do NOT write a separate plan file (7094-F1d: the host never reads one, and the write costs a full cached-context turn)
3. Write the code changes described above
4. Doc-impact: if your change makes any doc/ADR text stale, do NOT edit docs outside your write authority — add a \`docImpact:\` line to your .result \`notes\` naming the doc + what became stale (the orchestrator turns these into follow-up tasks). Only edit a doc that is explicitly IN your write list.
5. Report: write your result file to .tasks/task-${task.id}.result`);
  }

  // Env-probe (TT555 — waste-class d): a one-line host tool inventory probed at
  // sprint start, injected right after "What To Do" so the worker sees which
  // tools exist BEFORE it acts. Empty when the caller passed no inventory →
  // omitted (byte-for-byte legacy prompt). Volatile per-host → T2 ('env-probe'
  // is an unregistered kind: classifyTier maps it to T2, so it never poisons the
  // shared T0/T1 cache prefix).
  const envProbeBlock = buildEnvProbeBlock(toolInventory);
  if (envProbeBlock) push('T2', 'env-probe', envProbeBlock);

  // Tool-allowlist (born-664 / 559 — task 427-014 ALLOW-WIRE): a narrowed,
  // task-scoped default tool surface, injected next to the env-probe block (both
  // describe the worker's available surface before it acts). Empty when the caller
  // passed no allowlist (the config.tools.allowlist_enabled flag is default-OFF, and
  // the caller wire is a tracked follow-up) → omitted, byte-for-byte legacy prompt.
  // Per-task volatile → T2 ('tool-allowlist' is an unregistered kind: classifyTier
  // maps it to T2, so it never poisons the shared T0/T1 cache prefix).
  const toolAllowlistBlock = buildToolAllowlistBlock(toolAllowlist);
  if (toolAllowlistBlock) push('T2', 'tool-allowlist', toolAllowlistBlock);

  // Verify steps — Sprint 250 MF-1: Tier-0 doc-only tasks must NOT run the full
  // test suite. The prompt previously told EVERY worker to run the project test
  // suite; shell-capable external CLIs (codex/gemini) obeyed and ran the full
  // 17k-test deckent suite on a doc-only task, which collapsed under their
  // sandbox (EROFS ~/.codex, EPERM, API-endpoint timeouts) → false NO_GO +
  // timeout despite a correct doc. Brain already exempts doc tasks at evaluation
  // (result-evaluator isDocTask→DONE); the prompt must match. Doc-only = every
  // inferred scope domain is 'doc' (reuses inferTaskDomains; cycle-safe).
  // LP-1 (2026-07-08 single-source classification): the doc-vs-code verify tier now
  // derives from the SINGLE canonical `task.type` (set by detectTaskType at plan
  // time) — the same field the DoD/goCriteria (criteria-deriver) and the ADR presets
  // (taskKindToAdrDomain) already key on. Previously this block re-classified
  // independently via inferTaskDomains, which let it drift: a non-`docs/` .md task
  // showed a doc verify-steps block under a code DoD + core-dev ADRs (sprint-384
  // 3-layer split). A doc kind (documentation/design) verifies by reading its file
  // back; every other kind verifies via targeted tests. Defensive fallback to the
  // file-domain heuristic only when task.type is unset (legacy/direct-run path) so a
  // doc task is never forced into code verification by a missing type.
  // 523-010 (sprint-522 live evidence): task.type='audit' (docs/audits/*.md report
  // tasks) was missing from this set, so an audit-class task fell through to the
  // default CODE verify-steps branch below and a doc-only worker ran a repo-wide
  // `tsc`/vitest — racing parallel workers' in-flight state. 'audit' is one of
  // rubric-registry's own RubricTaskType values (AUDIT_RUBRIC / isAuditTask), so
  // adding it here closes the gap without inventing a second taxonomy.
  // 593-002: both branches (declared kind, and the rubric-registry `detectTaskType`
  // fallback for tasks with no canonical task.type) now live in the ONE canonical
  // classifier. The scope signal is intentionally NOT passed here — see
  // {@link taskDocProfileSignals}: doc-vs-code and inspection-vs-writing are two
  // independent axes at this call site, and this one asks only the doc question.
  // PROMPT-W1 (b): a doc-only task verifies by reading its file back; every other
  // task verifies via targeted tests, which is also the mode whose guidance must
  // take precedence over a persona's conflicting full-suite test-mandate.
  const verificationMode: 'targeted' | 'doc' = isDocOnlyTask ? 'doc' : 'targeted';
  const declaredTestCommands = compilePlan.verification.commands.map(item => item.command);
  const hasScopedTestDirective = hasTaskScopedVerificationAuthority(task);
  if (isInspectionOnlyTask && hasScopedTestDirective && declaredTestCommands.length === 0) {
    push('T2', 'verify-steps', `## SCOPED VERIFICATION HOLD (inspection-only)
SCOPED_PROOF_HOLD: this inspection task declares a task-local verification surface, but no exact command was captured in the compiled authority. Do not infer a command from prose, substitute a repository-wide check, or claim DONE. Report the missing scoped proof in your result notes.`);
  } else if (isInspectionOnlyTask && hasScopedTestDirective) {
    const commandList = declaredTestCommands
      .map((command, index) => `${index + 1}. \`${command}\``)
      .join('\n');
    push('T2', 'verify-steps', `## CRITICAL VERIFY STEPS (INSPECTION-ONLY TASK-DECLARED AUTHORITY)
This task has no project write authority. Its typed verification authority is still executable and exact. Run every command below byte-for-byte; do not omit environment/resource prefixes, reorder arguments, or substitute an equivalent-looking command:
${commandList}

Only the commands above are authorized. Do not add a build, type check, full suite, package-manager mutation, or unrelated check. Record the exact executed command strings and their original exit codes in testVerification.commands.
If every declared command passes and every GO criterion is MET while every NO-GO criterion is UNMET → selfAssessment = "DONE"
If a command differs, cannot run, or fails → selfAssessment = "NO_GO" with exact evidence.`);
  } else if (isInspectionOnlyTask) {
    push('T2', 'verify-steps', `## VERIFY STEPS (inspection-only)
This task has no project write authority. Do not run a build, type check, test suite, package-manager command, or other mutation-oriented verification unless the task's written acceptance criteria explicitly name that exact read-only command.
1. Execute only the task-directed read-only checks needed to prove the Definition of Done.
2. Cite observed command results and exact file/line evidence in the result notes.
3. Evaluate the single authoritative Definition of Done above. If any required evidence is missing, report GO_WITH_TECH_DEBT or NO_GO; never infer DONE.`);
  } else if (isDocOnlyTask) {
    // 523-010: a documentation-class task (rubric-registry: audit | document-write)
    // names ONLY its own task-declared checks — document existence, a doc/markdown
    // lint if one exists, and an owner-declared `**Test:**` command when present —
    // NEVER a repo-wide type check or full test runner (that generic guidance
    // belongs solely to the source-writing branches below, which stay untouched).
    const declaredCheckBlock = declaredTestCommands.length > 0
      ? `\n3. Run your task-declared check(s) exactly as written — do not substitute a project-wide type check or test runner:\n${declaredTestCommands.map((command, index) => `   ${index + 1}. \`${command}\``).join('\n')}`
      : '';
    push('T2', 'verify-steps', `## VERIFY STEPS (doc-only task — DO NOT run the test suite)
This is a Tier-0 documentation task: there is no source code to type-check or test. DO NOT run \`npm test\` / \`vitest\` / the project test suite, and DO NOT run a project-wide type check (\`tsc\`) — they are large, unrelated to your file, slow, and can race other in-flight workers' state without reflecting your own work.
1. Read your file back from disk (the path in your scope) and confirm its content satisfies the goCriteria above.
2. You MAY run a fast doc/markdown lint if one exists, but a passing test suite is NOT required and NOT expected.${declaredCheckBlock}
Mark selfAssessment = "DONE" when the file exists (and any check above passes) and matches the goCriteria. Use "GO_WITH_TECH_DEBT" only if the content is genuinely partial; use "NO_GO" only if you could not create the file at all. Do NOT mark NO_GO because an unrelated test suite failed.`);
  } else if (hasScopedTestDirective && declaredTestCommands.length === 0) {
    push('T2', 'verify-steps', `## SCOPED VERIFICATION HOLD
SCOPED_PROOF_HOLD: this task declares a task-local Test proof surface, but no scoped command was captured. Do not substitute a repository-wide type check, build, or test command and do not claim DONE. Report the missing scoped proof in your result notes.`);
  } else if (hasScopedTestDirective && declaredTestCommands.length > 0) {
    const commandList = declaredTestCommands
      .map((command, index) => `${index + 1}. \`${command}\``)
      .join('\n');
    push('T2', 'verify-steps', `## CRITICAL VERIFY STEPS (TASK-DECLARED AUTHORITY)
This task declares its verification command(s) explicitly. Run exactly these commands:
${commandList}

Do not add a project-wide type check, test runner, or substitute command unless the task's own goCriteria explicitly requires it. A failure from an unrelated command is not evidence against this task.
If every declared command passes and every goCriteria checklist item is genuinely satisfied → selfAssessment = "DONE"
If a declared command cannot run or fails after repair attempts → selfAssessment = "NO_GO" with the exact evidence
${buildVerifyPrecedenceNote(verificationMode)}${buildBehaviorPrecedenceNote(task)}`);
  } else {
    const checkCommand = compilePlan.verification.commands.find(item =>
      !/(?:vitest|jest|pytest|test(?:\s|$))/i.test(item.command),
    )?.command;
    const testCommand = compilePlan.verification.commands.find(item =>
      /(?:vitest|jest|pytest|test(?:\s|$))/i.test(item.command),
    )?.command;
    const checkLine = checkCommand
      ? `Run: \`${checkCommand}\` — this project's compiled type-check command.`
      : 'SCOPED_PROOF_HOLD: no task-local type-check command was compiled.';
    const testLine = testCommand
      ? `Run: \`${testCommand}\` — this exact task-local targeted test authority.`
      : 'SCOPED_PROOF_HOLD: no exact task-local targeted test command was compiled; do not substitute an unscoped runner.';
    push('T2', 'verify-steps', `## CRITICAL VERIFY STEPS (DO NOT SKIP)
You MUST run the project's type check and TARGETED tests before marking your task as done.
Check the project's TOOLS.md or package.json scripts to find the right commands.

1. **Type check / static analysis** — fix ALL errors (max 3 attempts)
   ${checkLine}
2. **TARGETED test file(s) only** — run ONLY the test file(s) that cover the module(s) you changed (max 3 attempts)
   ${testLine}
   ${buildPreExistingFailuresNote(preExistingFailures)}${buildExitPathTestHint(task)}

If BOTH pass AND every goCriteria checklist item (Result & Self-Assessment section below) is genuinely satisfied → selfAssessment = "DONE"
If minor issues remain, or any checklist item is unmet or only partially evidenced → selfAssessment = "GO_WITH_TECH_DEBT" with the gap/details in notes
If Bash tool is unavailable → report in notes, selfAssessment = "GO_WITH_TECH_DEBT"
If targeted tests fail after 3 attempts → selfAssessment = "NO_GO" with error details
${buildVerifyPrecedenceNote(verificationMode)}${buildBehaviorPrecedenceNote(task)}`);
  }

  // NPM-Advisory (born-454, sprint-356 live incident): dependency mutation is
  // advisory-escalated via the worker→Brain question channel, never executed by
  // the worker itself — a mounted-workspace `npm install` under `.npmrc
  // ignore-scripts=true` + container-vs-host ABI destroyed the better-sqlite3
  // binding for every host process. Static content (no task.id) → T0, so it
  // rides the shared cache prefix.
  // LP-6 (2026-07-08 tier-aware weight): a doc-only task writes markdown/text and
  // never touches a package manager, so the full incident-narrated advisory is pure
  // noise that dilutes the one constraint that matters (scope). Skip it for doc-only
  // tasks — the doc/code T0 prefix already diverges (verify-steps), so this adds no
  // new cache split. Every non-doc task keeps the full advisory verbatim.
  // Smoke note (WP-16) — Tier-1 Proof-of-Function context. Emitted next to the
  // VERIFY STEPS (its natural home) only when the task carries a Smoke: directive.
  const smokeNote = buildSmokeNote(task.smoke);
  if (smokeNote) push('T2', 'smoke', smokeNote);

  // Scope block — PROTECTED (auditor boundary contract); volatile per task (T2).
  push('T2', 'scope', scopeBlock);

  // Dependencies (only if non-empty)
  if (depsBlock) push('T2', 'deps', depsBlock);

  // One write is the complete worker-authored activity protocol. Attempt and
  // backend must be host-bound; prompt compilation must never guess either.
  const heartbeatInstruction = input.heartbeatIdentity
    ? renderWorkerActivityHeartbeatInstruction({
      taskId: task.id,
      workerId: `w-${task.id}`,
      attemptId: input.heartbeatIdentity.attemptId,
      backend: input.heartbeatIdentity.backend,
    })
    : HEARTBEAT_IDENTITY_HOLD;
  push('T2', 'heartbeat', `## Heartbeat
Before ${isInspectionOnlyTask ? 'inspection' : 'starting work'}, write .tasks/task-${task.id}.hb exactly once and batch that write with your first real tool call.
${heartbeatInstruction}
That single write is the entire heartbeat protocol; never refresh it.`);

  // Result + self-assessment — single authority section. Folds the former
  // separate "## Result File" and "## Honest Self-Assessment" sections so the
  // result/verdict instructions are stated once instead of 4×.
  push('T2', 'result-contract', `## Result & Self-Assessment
Write .tasks/task-${task.id}.result with: taskId, workerId ("w-${task.id}"), promptCompilePlanId ("${compilePlan.planId}"), filesChanged (string[]), linesAdded (integer), linesRemoved (integer), testsPassed (BOOLEAN compatibility projection), testVerification, criteriaEvidence, coverage (number; use 0 when not measured), selfAssessment ("DONE"|"GO_WITH_TECH_DEBT"|"NO_GO"), techDebtCriterionIds, and notes. These are worker ingress claims, not the canonical settled result and never audit evidence. The orchestrator MUST independently re-derive measurable file/line claims from the host-observed disk diff and test/TypeScript claims from captured command output; worker \`.result\` notes cannot prove them. It also derives top-level provider/model plus token and cost evidence from host-authoritative sources and assembles the versioned canonical result. Workers do NOT estimate token usage and do not place provider/model inside tokenUsage. The optional tokenUsage object must be omitted unless an adapter supplied real values; when supplied, its usage-only fields are inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens, totalTokens, and source.
Field shapes (strict — a wrong shape here breaks the orchestrator's result parser for the whole sprint):
- \`notes\`: a SINGLE string, never an array or object. For multiple points, join them into ONE string using \`\\n\` newlines — do NOT write \`["point one", "point two"]\` or \`{"a": "..."}\`.
- \`selfAssessment\`: exactly one of the three string literals \`"DONE"\`, \`"GO_WITH_TECH_DEBT"\`, \`"NO_GO"\` — never an array, never any other value.
- \`residualDebt\`: REQUIRED whenever selfAssessment is \`"GO_WITH_TECH_DEBT"\` — ONE short paragraph naming ONLY what remains undone and where (file/area). Never restate what succeeded; the success evidence belongs in \`notes\`. Omit the field entirely for \`"DONE"\` and \`"NO_GO"\`.
- \`filesChanged\`: an array of file-path strings, e.g. \`["src/foo.ts", "tests/foo.test.ts"]\`.
- \`promptCompilePlanId\`: exactly \`${compilePlan.planId}\`; never recompute or substitute it.
- \`testVerification\`: \`{ "applicability": "${compilePlan.verification.applicability}", "outcome": "PASSED"|"FAILED"|"NOT_EXECUTED", "commands": string[] }\`. Commands are the exact commands actually executed; applicability is not a success verdict.
- \`testsPassed\`: one boolean compatibility projection; true only when testVerification.outcome is "PASSED", never because verification is N/A.
- \`criteriaEvidence\`: exactly one entry for every compiled criterion ID (GO and NO-GO): \`[{ "criterionId": string, "outcome": "MET"|"UNMET"|"UNVERIFIED", "evidence": string[] }]\`. Outcome reports whether the criterion STATEMENT is true. For DONE, every GO criterion must be MET and every NO-GO/forbidden criterion must be UNMET. Marking a NO-GO criterion MET means the forbidden condition occurred and blocks DONE. Use observed evidence, never repeat the criterion as its own proof.
- \`techDebtCriterionIds\`: [] for DONE/NO_GO. For GO_WITH_TECH_DEBT it must contain every and only open compiled criterion ID; prose labels are invalid.
- \`coverage\`: one finite number from 0 to 100; use \`0\` to mean "not measured", never omit the field.
${isInspectionOnlyTask ? 'Assess against the single Definition of Done above and attach evidence for every clause; do not repeat or rewrite the criteria.' : buildDodChecklist(compilePlan.criteria)}
CRITICAL: never exit without writing the .result file — even on failure, write selfAssessment "NO_GO" with error details. A missing result file stalls the entire sprint.`);

  // Karpathy 4-discipline anchor + Turn Economy (born-636-K1) + Pipe-Exit Honesty
  // + Artifact Reuse (TT555 task 421-002) — all global T0, unconditional (every
  // task, doc or code), concatenated into ONE 'karpathy' segment. Folded into the
  // existing registered kind rather than new kinds: PromptSegmentKind
  // (prompt-segmentation.ts) is a closed registry backing a Readonly<Record<...>>
  // SSOT (TIER_BY_KIND) that a dedicated guard test (prompt-segmentation.test.ts)
  // checks every emitted segment against — adding an unregistered T0 kind there is
  // out of this task's write scope, so these task-invariant cognitive-anchor blocks
  // share the segment instead. (PIPE_EXIT_BLOCK is separately ≤400-char pinned; the
  // Turn Economy ≤1200 footprint pin measures its own constant and is unaffected.)
  // Shared Context (Sprint 278 COMM-1 / 278-003) — appended LAST, after every
  // shared/structural section, so this per-spawn-variable block sits in the most
  // task-specific region and never splits the Skills→Agent→ADR cache prefix
  // (F1-TOK lesson). Empty when worker_comms is off → byte-for-byte legacy prompt.
  if (sharedBlock) push('T2', 'shared', sharedBlock);

  // Upstream Handoffs (Sprint 278 COMM-1 / 278-004) — appended next to the Shared
  // Context block in the same prompt-END region (same cache-prefix rationale).
  // Empty when worker_comms is off / inject_handoffs disabled → unchanged prompt.
  if (handoffBlock) push('T2', 'handoff', handoffBlock);

  // Worker Comms Instruction (Sprint 278 COMM-1 / 278-006) — appended LAST so
  // workers know how to populate sharedNotes/handoffNotes. Without this block
  // workers never discover these optional fields exist (Tasks 1-5 path stays
  // empty). Empty when worker_comms is off → byte-for-byte legacy prompt.
  if (commsInstructionBlock) push('T2', 'comms', commsInstructionBlock);

  return segments;
}
