// ─── Sprint Domain Types ────────────────────────────────────────────────────
// Split from types.ts — Sprint lifecycle, metrics, debt, memory, and brain context

import type { Task, TaskEvaluation, ModelType, ProviderName } from './task-types.js';
import type { PromptGateResult } from './prompt-gate-types.js';
import type { InvocationReceiptRef } from './invocation-receipt.js';
import type { MemoryReadLimitsV1, MemoryReadScopeV1 } from './memory-read-contract.js';

// ─── Sprint System ──────────────────────────────────────────────────
export enum SprintPhase {
  DIRECTIVE = 'DIRECTIVE',
  PLAN = 'PLAN',
  SPAWN = 'SPAWN',
  EXECUTE = 'EXECUTE',
  EVALUATE = 'EVALUATE',
  FIX = 'FIX',
  RETRO = 'RETRO',
  DECAY = 'DECAY',
  TRANSITION = 'TRANSITION',
  COMPLETE = 'COMPLETE',
}

export enum SprintStatus {
  PLANNING = 'PLANNING',
  ACTIVE = 'ACTIVE',
  EVALUATING = 'EVALUATING',
  FIXING = 'FIXING',
  RETROSPECTIVE = 'RETROSPECTIVE',
  COMPLETE = 'COMPLETE',
  PAUSED = 'PAUSED',
  ABORTED = 'ABORTED',
}

export type PlannerProofResolutionReason =
  | 'requested-structured'
  | 'directive-routing-override'
  | 'model-success'
  | 'model-failure'
  | 'invocation-authority-failure'
  | 'model-failure-fallback'
  | 'task-count-low-fallback'
  | 'task-count-high-fallback';

/** Immutable evidence of the planner path that produced a sprint. */
export interface PlannerProof {
  readonly version: 1;
  readonly requestedMode: 'ai' | 'structured' | 'auto';
  readonly actualMode: 'ai' | 'structured' | 'fallback' | 'failed';
  readonly resolutionReason: PlannerProofResolutionReason;
  readonly directiveOverrideKinds: readonly ('provider' | 'model' | 'agent' | 'skills')[];
  readonly call: {
    readonly attempted: boolean;
    readonly succeeded: boolean;
    readonly requestedProvider: ProviderName | null;
    readonly resolvedProvider: ProviderName | null;
    readonly requestedModel: ModelType | null;
    readonly resolvedModel: ModelType | null;
    readonly failureReason: string | null;
    readonly receiptRef: InvocationReceiptRef | null;
  };
}

export interface Sprint {
  id: string;
  number: number;
  status: SprintStatus;
  phase: SprintPhase;
  tasks: Task[];
  workers: string[];
  metrics?: SprintMetrics;
  startedAt?: string;
  completedAt?: string;
  reasoning?: string;
  planningMode?: string;
  /** Lifecycle surface that owns terminal side effects across checkpoint recovery. */
  executionMode?: 'standard' | 'test';
  /** Preserve task artifacts after terminal settlement when true. */
  skipCleanup?: boolean;
  /** Requested-vs-actual planner provenance; persisted with sprint state/checkpoints. */
  plannerProof?: PlannerProof;
  /** True if a rollback was triggered during this sprint (all tasks NO_GO) */
  rolledBack?: boolean;
  /** Human-readable rollback result message */
  rollbackResult?: string;
  /**
   * Plan-time prompt-gate result (G-series): per-task persona/decision-space WARN/BLOCK
   * findings computed in planSprint() after routing. Rendered by `deckent plan` and the
   * MCP plan response; a BLOCK halts the plan-confirm unless `--force-prompt-gate`.
   */
  promptGate?: PromptGateResult;
}

export interface SprintMetrics {
  totalTasks: number;
  completedTasks: number;
  techDebtTasks: number;
  noGoTasks: number;
  /**
   * Tasks that produced a real result on disk but were never evaluated (the run
   * ended before EVALUATE reached them).
   *
   * MASTER-PLAN 667: the counters above are derived ONLY from the evaluations
   * map, so an aborted run reported "0/3 DONE" while two workers had genuinely
   * delivered (sprint-459, 2026-07-25). Their work is neither DONE nor NO_GO —
   * nobody judged it — so it gets its own honest bucket instead of silently
   * inflating a success count or being reported as failure.
   */
  unevaluatedTasks: number;
  durationMs: number;
  coveragePercent: number;
  /** Fraction in [0,1] — NOT a percentage. Multiply by 100 for display. Canonical
   *  unit across all producers (calculateMetrics, parseSprintLogMetrics, parseSprintStats). */
  noGoRate: number;
  newDebtCount: number;
  resolvedDebtCount: number;
  totalOpenDebt: number;
  boundaryViolations: number;
  crossAssignments: number;
  contextLinesUsed: number;
  /** Aggregate token usage across all tasks in the sprint (if available) */
  totalInputTokens?: number;
  totalOutputTokens?: number;
  totalCacheReadTokens?: number;
}

// ─── Sprint Result ─────────────────────────────────────────────────
export interface SprintResult {
  sprint: Sprint;
  evaluations: Map<string, TaskEvaluation>;
  metrics: SprintMetrics;
}

// ─── Tech Debt (Blueprint 8) ────────────────────────────────────────
export enum DebtPriority {
  NORMAL = 'NORMAL',
  HIGH = 'HIGH',
  CRITICAL = 'CRITICAL',
}

/**
 * Class marker for tech-debt entries.
 * - `verified-no-result`: closure-only debt that requires no follow-up code change
 *   (e.g. earlier sprint already verified the underlying issue). Injection step
 *   skips such debts to avoid spawning no-op CRITICAL fix tasks (Sprint 179 W1-1).
 * - `timeout-partial`: a worker was killed mid-execution (TIMEOUT_WITH_WORK) and
 *   result-evaluator reconciled its partial diff to GO_WITH_TECH_DEBT — the work
 *   was ACCEPTED into the tree, so there is no described code defect to fix. Like
 *   `verified-no-result`, injection skips it: a timeout is incomplete execution,
 *   not a deliberate shortcut, so a forced fix task only spawns a no-op worker
 *   that re-injects every sprint (the debt-361-001-fix phantom loop). Genuine
 *   incompleteness resurfaces later as a concrete, actionable failure. (Sprint 364.)
 * - `success-echo`: the GO_WITH_TECH_DEBT note carries ONLY success evidence
 *   (verification receipts, green test counts) and no actionable-gap language.
 *   A forced fix task built from it has nothing to fix — the sprint-573/574
 *   live case spawned workers whose entire brief was a success report, who
 *   then honestly NO_GO'd, burned the FIX budget and parked the run. Skipped
 *   by the injector WITHOUT resolving (text classification — a false positive
 *   must stay open for re-evaluation, mirroring the born-603 noop-echo rule).
 * - `standard`: regular debt that needs a fix task (default when class is absent).
 */
export type DebtClass = 'verified-no-result' | 'timeout-partial' | 'success-echo' | 'standard';

/**
 * Origin scope captured when the debt was created. Used by the auto-debt
 * injector to seed CRITICAL fix tasks with the original task's writable
 * surface, instead of falling back to an empty/broad scope (Sprint 179 W1-1).
 */
export interface DebtOriginScope {
  directories: string[];
  filesWrite: string[];
}

export interface DebtItem {
  id: string;
  description: string;
  originTaskId: string;
  originSprintId: string;
  priority: DebtPriority;
  sprintsOpen: number;
  resolved: boolean;
  resolvedInSprintId?: string;
  createdAt: string;
  /** Class marker; absence is treated as 'standard'. Sprint 179 W1-1. */
  class?: DebtClass;
  /** Origin task scope inherited by the auto-injected fix task. Sprint 179 W1-1. */
  originScope?: DebtOriginScope;
}

// ─── Memory System (Blueprint 6) ────────────────────────────────────
export interface MemoryEntry {
  content: string;
  addedInSprint: string;
  lastUsedInSprint: string;
  sprintsSinceLastUse: number;
}

export interface PatternEntry {
  pattern: string;
  occurrences: number;
  firstDetectedInSprint: string;
  lastDetectedInSprint: string;
  resolved: boolean;
}

// ─── Decay Result ──────────────────────────────────────────────
export interface DecayResult {
  linesBefore: number;
  linesAfter: number;
  archivedSprints: string[];
  removedDebtCount: number;
  removedPatternCount: number;
}

// ─── Brain Context ──────────────────────────────────────────────────
export interface BrainContext {
  directives: string;
  memory: string;
  /** Exact bounded memory selection rendered into `memory`; absent when no DB exists. */
  memorySelectionRevisionDigest?: string;
  /** Digest of the exact directives used to select the bounded memory view. */
  memoryReadInputDigest?: string;
  /** Scope and view settings bound to the memory selection above. */
  memoryReadScope?: MemoryReadScopeV1;
  memoryReadLimits?: Readonly<MemoryReadLimitsV1>;
  memoryReadLanguage?: string;
  retro: string;
  debt: DebtItem[];
  patterns: string;
  decisions: string;
  projectIdentity?: string;
  existingTasks: Task[];
  projectState: ProjectState;
}

export interface ProjectState {
  gitStatus: string;
  fileTree: string[];
}

export interface SprintSizeRecommendation {
  size: 'full' | 'reduced' | 'minimal';
  maxWorkers: number;
  modelConstraint: ModelType | null;
  reason: string;
}
