// ═══ Sprint Finalizer ══════════════════════════════════════════════
// Extracted from sprint-controller.ts — handles post-sprint finalization:
//   finalizeSprint(), applyAdaptiveThresholds(), hook stubs for Task 13/14/15

// ─── Node Builtins ─────────────────────────────────────────────────
import { normalizeChangedPaths } from '../core/task-result-schema.js';
import { writeConfigJsonAtomic } from '../core/config-write-authority.js';
import {
  readFileSync, writeFileSync, existsSync,
  mkdirSync, readdirSync, renameSync, unlinkSync,
  openSync, closeSync, fsyncSync,
} from 'node:fs';
import { promises as fsPromises } from 'node:fs';
import { dirname, join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';

// ─── Core (value imports) ──────────────────────────────────────────
import {
  TaskEvaluation, SprintStatus, SprintPhase,
} from '../core/types.js';

// ─── Core (type imports) ───────────────────────────────────────────
import type {
  Task, TaskResult, Sprint, SprintMetrics,
  ResolvedConfig,
} from '../core/types.js';
import { resolveBillingModeForAuth } from '../core/cost-calculator.js';
import { getMessage } from '../cli/helpers/messages.js';
import { buildMemoryExportLabels } from '../core/memory-export-labels.js';
import type { MemoryExportRenderOptions } from '../core/memory-export.js';
import {
  projectAttributedTaskWork,
  projectSprintWorkAttribution,
} from '../core/sprint-work-attribution.js';
import { resolveHostPreDispatchSettlement } from '../core/pre-dispatch-settlement.js';
import { resolvePromptDeliveryAttribution } from '../core/prompt-delivery-receipt.js';
import type { PromptDeliveryAttribution } from '../core/prompt-delivery-receipt.js';
import {
  buildSkillAttributionReceipt,
  readSkillAttributionBatch,
  SkillAttributionConflictError,
  writeSkillAttributionBatch,
} from '../core/routing/skill-attribution.js';
import type { SkillAttributionReceipt } from '../core/routing/skill-attribution.js';
import {
  createTaskTerminalProjection,
  reduceTaskTerminalProjection,
} from '../core/task-terminal-projection.js';
import type {
  TaskTerminalEvidence,
  TaskTerminalProjection,
} from '../core/task-terminal-projection.js';

import { ALL_INTENT_TYPES } from '../core/routing-types.js';
import type { TaskDNA } from '../core/routing-types.js';
import {
  createSprintFinalizerGateAuthority,
  deriveSprintFinalizerGateInputDigest,
  invalidateSprintFinalizerGate,
  publishSprintFinalizerGate,
  resolveSprintFinalizerGate,
} from '../core/sprint-finalizer-gate-authority.js';
import type {
  SprintFinalizerGateAuthority,
  SprintFinalizerGateInput,
} from '../core/sprint-finalizer-gate-authority.js';

type CatalogStatsEntry = Record<string, unknown> & {
  totalUses?: number;
  successCount?: number;
  successRate?: number;
  avgCoverage?: number;
  lastUsedInSprint?: string;
  coverageSampleCount?: number;
};

interface CatalogSkillExposureEntry extends Record<string, unknown> {
  selected?: number;
  delivered?: number;
  credited?: number;
  terminalOutcomes?: number;
  lastObservedInSprint?: string;
}

interface CatalogStatsSidecar extends Record<string, unknown> {
  agents?: Record<string, CatalogStatsEntry>;
  skills?: Record<string, CatalogStatsEntry>;
  skillExposure?: Record<string, CatalogSkillExposureEntry>;
  skillAttribution?: {
    authority: 'causal-receipt-v1';
    cutoverSprint: string;
    legacyQuarantineDigest: string | null;
  };
  legacySkillStatsQuarantine?: {
    sourceDigest: string;
    cutoverSprint: string;
    skills: Record<string, CatalogStatsEntry>;
  };
  commsUsage?: Record<string, CatalogStatsCommsUsage>;
}

/** Per-attempt worker-comms usage (Sprint 278 COMM-1 fields), recorded once per taskId. */
export interface CatalogStatsCommsUsage {
  readonly sharedNotesWritten: number;
  readonly handoffNotesWritten: number;
  readonly handoffsReceived: boolean;
}

export interface CatalogStatsTerminalOutcome {
  readonly taskId: string;
  readonly agentId: string | null;
  readonly skillIds: readonly string[];
  readonly selectedSkillIds: readonly string[];
  readonly deliveredSkillIds: readonly string[];
  readonly creditedSkillIds: readonly string[];
  readonly skillAttributionState: import('../core/routing/skill-attribution.js').SkillAttributionState;
  readonly skillAttributionReceiptDigest?: string;
  readonly evaluation: TaskEvaluation.DONE | TaskEvaluation.GO_WITH_TECH_DEBT | TaskEvaluation.NO_GO;
  readonly coverage?: number;
  readonly commsUsage?: CatalogStatsCommsUsage;
}

const ZERO_COMMS_USAGE: CatalogStatsCommsUsage = {
  sharedNotesWritten: 0,
  handoffNotesWritten: 0,
  handoffsReceived: false,
};

function sameIds(left: readonly string[], right: readonly string[]): boolean {
  return JSON.stringify([...left]) === JSON.stringify([...right]);
}

/**
 * Mutable stats are a projection, never attribution authority. Any row that
 * carries skill exposure or credit must be byte-bound to the immutable batch
 * written earlier in finalization. This also prevents direct helper callers
 * from minting CREDITED by setting a boolean/string field themselves.
 */
function assertCatalogSkillAttributionAuthority(
  projectRoot: string,
  sprintId: string,
  outcomes: readonly CatalogStatsTerminalOutcome[],
): void {
  const attributed = outcomes.filter(outcome =>
    outcome.selectedSkillIds.length > 0
    || outcome.deliveredSkillIds.length > 0
    || outcome.creditedSkillIds.length > 0
    || outcome.skillAttributionState === 'HOLD');
  if (attributed.length === 0) return;
  const batch = readSkillAttributionBatch(projectRoot, sprintId);
  if (!batch) throw new SkillAttributionConflictError(sprintId);
  const receipts = new Map(batch.receipts.map(receipt => [receipt.logicalTaskId, receipt] as const));
  for (const outcome of attributed) {
    const receipt = receipts.get(outcome.taskId);
    if (
      !receipt
      || receipt.receiptDigest !== outcome.skillAttributionReceiptDigest
      || receipt.state !== outcome.skillAttributionState
      || !sameIds(receipt.selectedSkillIds, outcome.selectedSkillIds)
      || !sameIds(receipt.deliveredSkillIds, outcome.deliveredSkillIds)
      || !sameIds(receipt.creditedSkillIds, outcome.creditedSkillIds)
      || !sameIds(receipt.creditedSkillIds, outcome.skillIds)
    ) throw new SkillAttributionConflictError(sprintId);
  }
}

/**
 * Tolerant comms-usage extraction from a worker's `.result` (Sprint 551 551-002).
 * Every field defaults to its zero value on absence or shape mismatch — no throw,
 * so a legacy `.result` predating the Sprint 278 COMM-1 fields (or a future
 * `handoffsReceived` field this parser doesn't know about yet) still yields a
 * valid all-zero/false record instead of crashing the finalize pass.
 */
export function parseCommsUsageFromResult(result: TaskResult): CatalogStatsCommsUsage {
  const raw = result as unknown as Record<string, unknown>;
  const sharedNotes = raw.sharedNotes;
  const handoffNotes = raw.handoffNotes;
  return {
    sharedNotesWritten: Array.isArray(sharedNotes) ? sharedNotes.length : 0,
    handoffNotesWritten: typeof handoffNotes === 'string' && handoffNotes.trim().length > 0 ? 1 : 0,
    handoffsReceived: raw.handoffsReceived === true,
  };
}

export function collectCatalogStatsTerminalOutcomes(
  projectRoot: string,
  tasks: readonly Task[],
  evaluations: ReadonlyMap<string, TaskEvaluation>,
  results: ReadonlyMap<string, TaskResult>,
  attributionByTask?: ReadonlyMap<string, SkillAttributionReceipt>,
  deliveryByTask?: ReadonlyMap<string, PromptDeliveryAttribution>,
): CatalogStatsTerminalOutcome[] {
  const outcomes: CatalogStatsTerminalOutcome[] = [];
  for (const task of tasks) {
    const evaluation = evaluations.get(task.id);
    const result = results.get(task.id);
    if (
      result === undefined
      || result.cascadeSkipped === true
      || (
        evaluation !== TaskEvaluation.DONE
        && evaluation !== TaskEvaluation.GO_WITH_TECH_DEBT
        && evaluation !== TaskEvaluation.NO_GO
      )
    ) continue;
    const delivery = deliveryByTask?.get(task.id) ?? resolvePromptDeliveryAttribution({
      projectRoot,
      taskId: task.id,
      requireCurrentReceipt: typeof task.promptCompilePlanId === 'string',
      legacyAgentId: result.agentId ?? task.assignedAgent ?? null,
      legacySkillIds: result.skillIds ?? task.assignedSkills,
    });
    const attribution = attributionByTask?.get(task.id);
    const selectedSkillIds = attribution?.selectedSkillIds ?? delivery.skillIds;
    const deliveredSkillIds = attribution?.deliveredSkillIds ?? delivery.skillIds;
    // Delivery is exposure evidence, never causal efficacy evidence. Callers
    // without a host-validated attribution receipt fail closed to exposure-only.
    const creditedSkillIds = attribution?.creditedSkillIds ?? [];
    const skillAttributionState = attribution?.state
      ?? (selectedSkillIds.length > 0 || deliveredSkillIds.length > 0
        ? 'EXPOSURE_ONLY'
        : 'NO_SKILLS');
    outcomes.push({
      taskId: task.id,
      agentId: delivery.agentId,
      skillIds: [...creditedSkillIds],
      selectedSkillIds: [...selectedSkillIds],
      deliveredSkillIds: [...deliveredSkillIds],
      creditedSkillIds: [...creditedSkillIds],
      skillAttributionState,
      ...(attribution ? { skillAttributionReceiptDigest: attribution.receiptDigest } : {}),
      evaluation,
      ...(typeof result.coverage === 'number' ? { coverage: result.coverage } : {}),
      commsUsage: parseCommsUsageFromResult(result),
    });
  }
  return outcomes;
}

const WORK_TYPE_INTENT: Readonly<Record<string, TaskDNA['intent']['primary']>> = Object.freeze({
  build: 'implementation',
  fix: 'bugfix',
  refactor: 'refactor',
  document: 'documentation',
  review: 'architecture',
  configure: 'config',
  migrate: 'migration',
  analyze: 'architecture',
});

const WORK_TYPE_OPERATIONS: Readonly<Record<string, TaskDNA['operations']>> = Object.freeze({
  build: [{ type: 'create', weight: 0.6 }, { type: 'modify', weight: 0.4 }],
  fix: [{ type: 'modify', weight: 1 }],
  refactor: [{ type: 'modify', weight: 1 }],
  document: [{ type: 'document', weight: 1 }],
  review: [{ type: 'test', weight: 1 }],
  configure: [{ type: 'configure', weight: 1 }],
  migrate: [{ type: 'modify', weight: 0.7 }, { type: 'create', weight: 0.3 }],
  analyze: [{ type: 'test', weight: 1 }],
});

function isTaskDNA(value: unknown): value is TaskDNA {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Partial<TaskDNA>;
  const primary = record.intent?.primary;
  return typeof primary === 'string'
    && ALL_INTENT_TYPES.includes(primary as TaskDNA['intent']['primary'])
    && Array.isArray(record.intent?.secondary)
    && typeof record.intent?.confidence === 'number'
    && Array.isArray(record.tags)
    && Array.isArray(record.domains)
    && Array.isArray(record.operations)
    && !!record.complexity
    && !!record.scope;
}

function normalizeFinalizerPath(value: string): string {
  return value.replace(/\\/gu, '/').replace(/^\.\//u, '').replace(/\/{2,}/gu, '/');
}

function routingConfidence(value: string | number | undefined): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(0, Math.min(1, value));
  }
  switch (value) {
    case 'high': return 0.9;
    case 'medium': return 0.7;
    case 'low': return 0.4;
    case 'uncertain': return 0.2;
    default: return 0;
  }
}

/**
 * Produce the learning projection from route-time structural facts. V3 never
 * falls back to the old all-unknown DNA merely because it uses a different
 * decision vocabulary; an already validated V2 DNA remains authoritative.
 */
export function deriveFinalizerTaskDNA(task: Pick<Task, 'scope' | 'routingMeta'>): TaskDNA {
  if (isTaskDNA(task.routingMeta?.taskDNA)) return task.routingMeta.taskDNA;

  const writePaths = [...new Set(task.scope.filesWrite.map(normalizeFinalizerPath).filter(Boolean))].sort();
  const directoryClaims = [...new Set(task.scope.directories.map(normalizeFinalizerPath).filter(Boolean))].sort();
  const moduleIds = new Set(
    (writePaths.length > 0 ? writePaths : directoryClaims)
      .map(path => path.split('/').slice(0, -1).join('/') || path.split('/')[0] || '')
      .filter(Boolean),
  );
  const prefixCounts = new Map<string, number>();
  for (const path of writePaths) {
    const prefix = path.split('/')[0] ?? path;
    prefixCounts.set(prefix, (prefixCounts.get(prefix) ?? 0) + 1);
  }
  const writeRatio = Object.fromEntries(
    [...prefixCounts.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([prefix, count]) => [prefix, writePaths.length > 0 ? count / writePaths.length : 0]),
  );
  const primaryWriteTarget = [...prefixCounts.entries()]
    .sort(([leftPrefix, leftCount], [rightPrefix, rightCount]) =>
      rightCount - leftCount || leftPrefix.localeCompare(rightPrefix))[0]?.[0] ?? '';
  const workType = task.routingMeta?.workType?.toLowerCase() ?? '';
  const dominantDomain = task.routingMeta?.dominantDomain?.trim();
  const fileCount = writePaths.length;
  const estimatedSize: TaskDNA['complexity']['estimatedSize'] = fileCount === 0
    ? 'trivial'
    : fileCount <= 2
      ? 'small'
      : fileCount <= 5
        ? 'medium'
        : fileCount <= 10
          ? 'large'
          : 'epic';
  const primaryIntent = dominantDomain === 'security' && (workType === 'review' || workType === 'analyze')
    ? 'security'
    : WORK_TYPE_INTENT[workType] ?? 'unknown';

  return {
    intent: {
      primary: primaryIntent,
      secondary: [],
      confidence: routingConfidence(task.routingMeta?.confidence),
    },
    tags: [...new Set(task.routingMeta?.policyTags ?? [])].sort(),
    domains: dominantDomain ? [{ name: dominantDomain, weight: 1 }] : [],
    operations: [...(WORK_TYPE_OPERATIONS[workType] ?? [])],
    complexity: {
      fileCount,
      moduleCount: moduleIds.size,
      crossCutting: moduleIds.size > 1,
      estimatedSize,
    },
    scope: {
      writeRatio,
      primaryWriteTarget,
      testWriteRatio: fileCount > 0
        ? writePaths.filter(path => /(^|\/)(test|tests|__tests__)(\/|$)|\.(?:test|spec)\.[^/]+$/iu.test(path)).length / fileCount
        : 0,
    },
  };
}

/**
 * Collapse each FIX/retry lineage to its resolving attempt while preserving the
 * logical root id. Downstream learning/stat consumers therefore see one task
 * with the routing and prompt authority that actually settled the lineage.
 */
export function projectFinalizerLogicalTasks(
  terminalEvidence: Pick<SprintTerminalEvidence, 'logicalTasks'>,
  attemptTasks: readonly Task[],
): Task[] {
  const tasksById = new Map(attemptTasks.map(task => [task.id, task]));
  return terminalEvidence.logicalTasks.flatMap(logicalTask => {
    const resolvingTaskId = logicalTask.resolvingAttempt?.taskId
      ?? logicalTask.attempts.at(-1)?.taskId;
    const resolvingTask = resolvingTaskId ? tasksById.get(resolvingTaskId) : undefined;
    return resolvingTask ? [{ ...resolvingTask, id: logicalTask.logicalTaskId }] : [];
  });
}

export interface CatalogStatsFileSystem {
  readonly exists: (path: string) => boolean;
  readonly read: (path: string) => string;
  readonly mkdir: (path: string) => void;
  readonly write: (path: string, content: string) => void;
  readonly rename: (source: string, destination: string) => void;
}

const catalogStatsFileSystem: CatalogStatsFileSystem = {
  exists: path => existsSync(path),
  read: path => readFileSync(path, 'utf-8'),
  mkdir: path => mkdirSync(path, { recursive: true }),
  write: (path, content) => writeFileSync(path, content, 'utf-8'),
  rename: (source, destination) => renameSync(source, destination),
};

function mergeCatalogStatsEntry(
  current: CatalogStatsEntry | undefined,
  outcomes: readonly CatalogStatsTerminalOutcome[],
  sprintId: string,
): CatalogStatsEntry {
  const prior = current ?? {};
  const previousUses = typeof prior.totalUses === 'number' ? prior.totalUses : 0;
  const previousSuccesses = typeof prior.successCount === 'number'
    ? prior.successCount
    : Math.round((typeof prior.successRate === 'number' ? prior.successRate : 0) * previousUses);
  const addedSuccesses = outcomes.filter(outcome => outcome.evaluation !== TaskEvaluation.NO_GO).length;
  const totalUses = previousUses + outcomes.length;
  const successCount = previousSuccesses + addedSuccesses;
  const measuredCoverage = outcomes
    .map(outcome => outcome.coverage)
    .filter((coverage): coverage is number => typeof coverage === 'number');
  const previousCoverageSampleCount = typeof prior.coverageSampleCount === 'number'
    ? prior.coverageSampleCount
    : typeof prior.avgCoverage === 'number' ? previousUses : 0;
  const coverageSampleCount = previousCoverageSampleCount + measuredCoverage.length;
  const avgCoverage = measuredCoverage.length === 0
    ? prior.avgCoverage
    : previousCoverageSampleCount > 0
      ? (((typeof prior.avgCoverage === 'number' ? prior.avgCoverage : 0) * previousCoverageSampleCount)
        + measuredCoverage.reduce((sum, coverage) => sum + coverage, 0))
        / coverageSampleCount
      : measuredCoverage.reduce((sum, coverage) => sum + coverage, 0) / measuredCoverage.length;

  return {
    ...prior,
    totalUses,
    successCount,
    successRate: totalUses > 0 ? successCount / totalUses : 0,
    ...(avgCoverage === undefined ? {} : { avgCoverage }),
    coverageSampleCount,
    lastUsedInSprint: sprintId,
  };
}

/** Publish this run's terminal catalog outcomes with one read and one atomic replacement. */
export function writeCatalogStatsTerminalOutcomes(
  projectRoot: string,
  sprintId: string,
  outcomes: readonly CatalogStatsTerminalOutcome[],
  fileSystem: CatalogStatsFileSystem = catalogStatsFileSystem,
  forceSkillAttributionCutover = false,
): void {
  assertCatalogSkillAttributionAuthority(projectRoot, sprintId, outcomes);
  const agentOutcomes = new Map<string, CatalogStatsTerminalOutcome[]>();
  const skillOutcomes = new Map<string, CatalogStatsTerminalOutcome[]>();
  for (const outcome of outcomes) {
    if (outcome.agentId && outcome.agentId !== 'generic') {
      const entries = agentOutcomes.get(outcome.agentId) ?? [];
      entries.push(outcome);
      agentOutcomes.set(outcome.agentId, entries);
    }
    const causallyCredited = outcome.skillAttributionState === 'CREDITED'
      ? outcome.creditedSkillIds
      : [];
    for (const skillId of new Set(causallyCredited)) {
      const entries = skillOutcomes.get(skillId) ?? [];
      entries.push(outcome);
      skillOutcomes.set(skillId, entries);
    }
  }
  const hasSkillExposure = outcomes.some(outcome =>
    outcome.selectedSkillIds.length > 0
    || outcome.deliveredSkillIds.length > 0
    || outcome.creditedSkillIds.length > 0);
  const statsDir = join(projectRoot, '.deckent', 'stats');
  const statsPath = join(statsDir, 'catalog-stats.json');
  const current = fileSystem.exists(statsPath)
    ? JSON.parse(fileSystem.read(statsPath)) as CatalogStatsSidecar
    : {};
  const agents = { ...(current.agents ?? {}) };
  const hasCausalSkillAuthority = current.skillAttribution?.authority === 'causal-receipt-v1';
  if (
    agentOutcomes.size === 0
    && skillOutcomes.size === 0
    && !hasSkillExposure
    && !forceSkillAttributionCutover
    && hasCausalSkillAuthority
  ) return;
  const legacySkills = hasCausalSkillAuthority ? {} : { ...(current.skills ?? {}) };
  const legacyQuarantineDigest = hasCausalSkillAuthority
    ? current.skillAttribution?.legacyQuarantineDigest ?? null
    : Object.keys(legacySkills).length > 0
      ? `sha256:${createHash('sha256').update(canonicalJson(legacySkills)).digest('hex')}`
      : null;
  const skills = hasCausalSkillAuthority ? { ...(current.skills ?? {}) } : {};
  for (const [agentId, entityOutcomes] of agentOutcomes) {
    agents[agentId] = mergeCatalogStatsEntry(agents[agentId], entityOutcomes, sprintId);
  }
  for (const [skillId, entityOutcomes] of skillOutcomes) {
    skills[skillId] = mergeCatalogStatsEntry(skills[skillId], entityOutcomes, sprintId);
  }

  const skillExposure: Record<string, CatalogSkillExposureEntry> = {
    ...(current.skillExposure ?? {}),
  };
  for (const outcome of outcomes) {
    const selected = new Set(outcome.selectedSkillIds);
    const delivered = new Set(outcome.deliveredSkillIds);
    const credited = new Set(
      outcome.skillAttributionState === 'CREDITED' ? outcome.creditedSkillIds : [],
    );
    const observed = new Set([...selected, ...delivered, ...credited]);
    for (const skillId of observed) {
      const prior = skillExposure[skillId] ?? {};
      skillExposure[skillId] = {
        ...prior,
        selected: (typeof prior.selected === 'number' ? prior.selected : 0) + (selected.has(skillId) ? 1 : 0),
        delivered: (typeof prior.delivered === 'number' ? prior.delivered : 0) + (delivered.has(skillId) ? 1 : 0),
        credited: (typeof prior.credited === 'number' ? prior.credited : 0) + (credited.has(skillId) ? 1 : 0),
        terminalOutcomes: (typeof prior.terminalOutcomes === 'number' ? prior.terminalOutcomes : 0) + 1,
        lastObservedInSprint: sprintId,
      };
    }
  }

  // Comms usage is recorded once per attempt (taskId), not aggregated like the
  // agent/skill entity stats above — an attempt's counters simply replace any
  // prior entry under the same taskId. Folded into the SAME temp-write/rename
  // pair below; this must never become a second sidecar write pass.
  const commsUsage: Record<string, CatalogStatsCommsUsage> = { ...(current.commsUsage ?? {}) };
  for (const outcome of outcomes) {
    commsUsage[outcome.taskId] = outcome.commsUsage ?? ZERO_COMMS_USAGE;
  }

  fileSystem.mkdir(statsDir);
  const tempPath = `${statsPath}.${process.pid}.${randomUUID()}.tmp`;
  fileSystem.write(tempPath, `${JSON.stringify({
    ...current,
    schemaVersion: 2,
    agents,
    skills,
    skillExposure,
    skillAttribution: {
      authority: 'causal-receipt-v1',
      cutoverSprint: current.skillAttribution?.cutoverSprint ?? sprintId,
      legacyQuarantineDigest,
    },
    ...(!hasCausalSkillAuthority && Object.keys(legacySkills).length > 0 ? {
      legacySkillStatsQuarantine: {
        sourceDigest: legacyQuarantineDigest!,
        cutoverSprint: sprintId,
        skills: legacySkills,
      },
    } : {}),
    commsUsage,
  }, null, 2)}\n`);
  fileSystem.rename(tempPath, statsPath);
}

/** Explicit pre-dogfood cutover entrypoint; empty outcome lists never mint efficacy. */
export function persistCatalogStatsSkillAttributionCutover(
  projectRoot: string,
  cutoverId: string,
): void {
  writeCatalogStatsTerminalOutcomes(
    projectRoot,
    cutoverId,
    [],
    catalogStatsFileSystem,
    true,
  );
}

import {
  BRAIN_DIR, JOBS_DIR, DASHBOARD_FILE, RECENT_WORKS_DIR, TASKS_DIR,
  SPRINT_ACTIVE_FILE, SPRINT_PAUSE_STATE_FILE,
} from '../core/constants.js';

import {
  archiveTaskArtifacts,
  isSprintArchiveNamespaceSafe,
  reconcileSprintArchive,
  resolveSprintArchiveDir,
  resolveTaskArtifactReadDirs,
  sealSprintArchiveTerminal,
  verifySprintArchive,
  verifySprintArchiveTerminal,
} from '../core/sprint-archive.js';
import type {
  SprintArchiveTerminalApplicationReceipt,
  SprintArchiveTerminalSealReceipt,
  SprintArchiveTerminalSealResult,
  SprintArchiveTerminalVerificationReport,
  TaskArtifactArchivePlan,
} from '../core/sprint-archive.js';
export {
  archiveTaskArtifacts,
  resolveTaskArtifactArchiveDir,
  TASK_ARTIFACT_PRESERVED_SUBDIR,
  TASK_ARTIFACT_PRESERVATION_MARKER_FILE,
  TASK_ARTIFACT_PRESERVATION_MARKER_KIND,
} from '../core/sprint-archive.js';
export type {
  TaskArtifactArchivePlan,
  TaskArtifactArchiveResult,
  TaskArtifactPreservationMarker,
} from '../core/sprint-archive.js';

import { cleanupCounters, runRetention } from '../core/sprint-file-retention.js';
import { archiveStaleSchedulerShadowJournals } from '../core/scheduler-shadow-retention.js';
import {
  reconcileRuntimeHygiene,
  type RuntimeHygieneApplyResult,
  type RuntimeHygieneFamilyOutcome,
} from '../core/runtime-hygiene.js';

// ─── Core — utils ─────────────────────────────────────────────────
import { updateLastSprintId, debugLog, readJsonSafe } from '../core/utils.js';

// ─── Provider execution observation retirement (row 3296) ─────────
// orchestra → core import: ADR-D-004 C2 allowed direction.
import { canonicalProjectRoot, settleRunPolicyResultEvidence } from '../core/task-result-settlement.js';
import {
  PROVIDER_EXECUTION_OBSERVATION_DATABASE_PATH,
  ProviderExecutionObservationStore,
  type ProviderExecutionGenerationReconciliation,
  type ProviderExecutionIntervalRetirementReason,
} from '../core/provider-execution-observation-store.js';
import { getDebtItems } from '../core/debt-store.js';
import { publishCanonicalRunStatusReadModel } from '../core/run-status-read-model.js';

// ─── Terminal truth (Sprint 486 task 486-007) ─────────────────────
import {
  assembleSprintTerminalEvidence,
  type CoordinatorTerminalEvidence,
  type ExactAttemptEvidence,
  type ExactAttemptIdentity,
  type SprintTerminalEvidence,
} from './sprint-terminal-evidence.js';
import {
  projectLogicalProgress,
  type LogicalProgressProjection,
} from '../core/logical-progress-projection.js';
import {
  projectNotDispatchedSettlements,
  resolveTaskLineageRootId,
  type NotDispatchedSettlement,
} from '../core/task-lineage.js';
import {
  aggregateLineageUsageAuthority,
  type LineageBillingAuthority,
  type LineageUsageAuthorityAggregate,
} from '../core/lineage-usage-authority.js';
import {
  createSprintTerminalPublicationState,
  transitionSprintTerminalPublication,
  SPRINT_TERMINAL_PUBLICATION_VERSION,
  type SprintTerminalOutcome,
  type SprintTerminalPublicationStateV1,
  type SprintTerminalReceiptV1,
} from '../core/sprint-terminal-publication.js';

// ─── Sprint Reporter ──────────────────────────────────────────────
import {
  writeRetrospective, appendRetroSection, writeSprintLog, calculateMetrics,
  updateProjectDocs,
  buildAgentPerformance, archiveDirectives,
  buildSprintLimitBurnRow, buildFilesChangedCostSection,
} from './sprint-reporter.js';

// ─── Cost Ledger — helper-call (off-primary) cost bridge (MET668B / 419-002) ──
// orchestra → core import: ADR-008 allowed direction. Pure functions; the disk
// read (collectHelperCost) lives here in orchestra, not in core.
import {
  buildHelperLedger, extractHelperUsageEntries, loadBundledClaudePricing,
  type ModelUsageMap, type HelperEnvelope, type CostLedger,
} from '../core/cost-ledger.js';

// ─── Sprint Docs Updater (direct — cleanTasksArchive not re-exported via sprint-reporter) ──
import { cleanTasksArchive } from './sprint-docs-updater.js';

// ─── Sprint Log Projection (row 3298 — terminal COMPLETE/ABORTED truth) ───
// Called directly (not via the tier-1 doc-updaters registry) because the
// registry's step 9 pass runs while sprint.status is still RETROSPECTIVE —
// `upsertSprintLog` takes its terminal status as an explicit argument so it
// can be invoked once the status is genuinely terminal.
import { upsertSprintLog } from './doc-updaters/sprint-log.js';

// ─── Result Evaluator ─────────────────────────────────────────────
import {
  getRecentSprintStats,
  GO_WITH_GATE_FAILURE,
  applyTechDebtDowngrade,
} from './result-evaluator.js';

// ─── Auditor (code verification — migrated Sprint 138) ────────────
import {
  tryCodeVerifiedDone,
} from '../monitor/auditor.js';

// ─── Baseline Tracker ─────────────────────────────────────────────
import {
  parseVitestBaseline, readBaseline, containsHonestyTrigger,
  captureVitestBaseline,
} from './baseline-tracker.js';

// ─── Result Collector ─────────────────────────────────────────────
import { buildResultsMap } from './result-collector.js';

// ─── Self-Audit Adapter Registry (ADR-D-004 allowed orchestra → core direction) ──
// The finalizer owns policy (what may run); the registry owns ecosystem command
// selection and output parsing. No framework-specific argv lives here.
import { SelfAuditAdapterRegistry } from '../core/self-audit-adapter.js';
import type {
  SelfAuditExecutor,
  SelfAuditRequest,
  SelfAuditResult as AdapterSelfAuditResult,
} from '../core/self-audit-adapter.js';
import { VitestSelfAuditAdapter } from '../core/self-audit-vitest-adapter.js';
import { detectProjectStack } from '../core/stack-detector.js';

// ─── Handoff Protocol (B-HANDOFF-PRUNE — Sprint 331 331-006 storage-prune hook) ──
import { HandoffProtocol } from './handoff-protocol.js';

// ─── KPI Collection (Sprint 330 Task 8 — non-blocking finalize hook) ──
// orchestra → core import: ADR-008 allowed direction (core never imports orchestra).
import { recordKpiMeasurements } from '../core/kpi/collection.js';
import type { UsageTotals } from '../core/kpi/collection.js';

// ─── Cumulative Spend Advisory (B6 — warn-only finalize hook, Sprint 333 333-005) ──
// orchestra → core import: ADR-008 allowed direction (core never imports orchestra).
// checkSpendGate is pure + flag-gated; spend-window read + cost-config load live in core.
import { checkSpendGate, evaluateSpendWarnAtSpawn } from '../core/cost-gate.js';
import type { CostLimitWarnEvent } from '../core/cost-gate.js';
import { readSpendWindow, loadCostConfig } from '../core/cost-config-loader.js';
import type { CostConfig } from '../core/cost-config-loader.js';

// ─── Debt Manager ─────────────────────────────────────────────────
import { runDecay, auditBrainBudget } from './debt-manager.js';
import { isPolicyTerminalPreDispatchResult } from '../core/failure-disposition-policy.js';
import { runDocTrackingSync } from '../core/doc-tracking/sync.js';

// ─── Observability ────────────────────────────────────────────────
import { initObservability } from '../core/observability.js';
import { rotateMetricsFile } from '../core/observability-rotation.js';
import type { ObservabilityRotationConfig } from '../core/observability-rotation.js';

// ─── Agent/Skill Pool ─────────────────────────────────────────────
import { PromptVersionManager } from '../agents/prompt-version.js';

// ─── Plugin Hooks ─────────────────────────────────────────────────
import { runHooks } from '../core/plugin-hooks.js';
import type { AfterSprintContext } from '../core/plugin-hooks.js';

// ─── Rich Output ──────────────────────────────────────────────────
import { formatRichSprintSummary } from '../cli/helpers/sprint-summary-rich.js';

// ─── Event Stream (Brain event hooks — Sprint 139 Task 042) ───────
import { writeEvent, CHANNELS, getCurrentSprintId } from './event-stream.js';

// ─── Post-Finalize Hooks (Sprint 143 Task 10) ─────────────────────
import { runPostFinalizeHooks } from '../core/identity-generator.js';
import type { PostFinalizeHookResult } from '../core/identity-generator.js';

// ─── Export-wipe guard (Sprint 227 task 227-002) ──────────────────
// runMemoryExport (identity-generator.ts) overwrites .brain/exports/*.md
// unconditionally; in sprint-226 this wiped decisions.md from 8518 to 2 lines
// while the DB still held 75 ADRs. We bypass runMemoryExport and call the
// guarded writer here instead — it refuses to overwrite when the render
// collapses to the "no entries" marker while the DB has entries.
import { MEMORY_DB_FILE } from '../core/constants.js';

// ─── Task Restoration / Auto-Archive Guard (Sprint 143 Task 13) ───
import { createPreArchiveSnapshot, classifyTaskFiles } from './task-restoration.js';

// ─── Notify (DECKENT→USER:NOTIFY — Hot Fix H6) ────────────────────
import { notify } from '../core/notify.js';

// ─── Terminal package (671-006) ───────────────────────────────────
// Durable terminal-kind owner notification (same outbox as the lifecycle
// enqueues in sprint-lifecycle.ts) + terminal-aware sprint-lock release,
// both fired at the common COMPLETE/ABORTED end-point next to clearPid.
import { enqueueOwnerNotification } from '../connectors/notification-delivery.js';
import { resolveOwnerNotificationLang } from './sprint-lifecycle.js';
import { releaseSprintLockForTerminatedSprint } from '../core/multi-ide.js';

// ─── Sprint State + PID cleanup (Sprint 223 Task 013) ─────────────
// Mark sprint-state.json as terminal (COMPLETE/COMPLETE) and remove
// `.deckent/pids/<id>.pid` + `.snapshot.json` so the next `deckent start`
// no longer detects this sprint as an orphan and does not re-resume it
// in the FIX phase.
import { writeSprintState, readSprintState, SPRINT_STATE_FILE } from './sprint-utils.js';
import { clearPid } from './sprint-pid-manager.js';

// ─── Checkpoint cleanup (Sprint 272 272-001 — GHOST-FINALIZE) ─────
// Terminal-state finalize must purge `.deckent/<id>-checkpoint.json` +
// `-checkpoint-seq` so the next `deckent start` cannot read a stale
// checkpoint and run a phantom 0/0 "complete" restore that exits before
// the new sprint starts. Covers normal completion AND `finalize --force`.
import { cleanupCheckpointFiles } from './sprint-checkpoint.js';
import {
  isCurrentExactAcceptedTaskTerminalAuthorityRead,
  type ExactAcceptedTaskTerminalAuthorityRead,
} from './evaluation-audit-trail.js';


// ═══ Types ════════════════════════════════════════════════════════

/**
 * Options for finalizeSprint.
 */
export interface FinalizeSprintOptions {
  /** Skip decay phase */
  skipDecay?: boolean;
  /** Skip plugin hooks */
  skipHooks?: boolean;
  /** Resolved config (used for updateProjectDocs) */
  config?: ResolvedConfig;
  /** Hermetic seam for the final TypeScript truth check. */
  runTscFn?: TscSettlementRunner;
  /** Skip post-finalize memory export */
  skipMemoryExport?: boolean;
  /** Skip post-finalize identity regeneration */
  skipIdentityRegen?: boolean;
  /** Rule regeneration callback (Task 11 hook point) */
  onRuleRegen?: (projectRoot: string) => void | Promise<void>;
  /**
   * Run-flow correlation id (TERM5-FIN / sprint-427 task 1). Not derivable from
   * `Sprint` (no `flowId` field) and orchestra/ MUST NOT import
   * cli/repl/run-flow-store.ts to look one up (ADR-D-004 C2) — so a caller that
   * started this sprint via the run-flow-v2 path threads it in here. Absent for
   * every current caller; surfaced (when present) on the job completion record's
   * `completionRecord.flowId` for later flowId-correlated consumers.
   */
  flowId?: string;
  /**
   * Monotonic coordinator generation for the fenced terminal-publication CAS.
   * Legacy in-process callers are generation 1; restarted/failover coordinators
   * must thread their durable generation rather than overwriting that authority.
   */
  coordinatorGeneration?: number;
  /**
   * Exact durable COMPLETE receipt adopted by an external recovery finalizer.
   * The receipt is never regenerated or rewritten; it authorizes continuation
   * from the post-receipt archive/seal boundary after a coordinator crash.
   */
  resumeTerminalReceipt?: SprintTerminalReceiptV1;
  /**
   * The in-process Sprint controller still owns delayed cleanup. When true,
   * finalization prepares metrics/docs but leaves COMPLETE state, PID
   * retirement, dashboard and completion notification to the controller's
   * post-cleanup terminal publisher.
   */
  deferTerminalAuthority?: boolean;
  /**
   * Completed-checkpoint recovery reuses already-persisted evaluations and
   * performs terminalization only. Suppress the ordinary EXECUTE→EVALUATE→
   * RETRO→CLEANUP event replay and preserve the event sequence counter so the
   * recovery-specific events can continue the original monotonic stream.
   */
  lifecycleContext?: 'live-execution' | 'completed-checkpoint-recovery';
  /**
   * Store-revalidated T11 terminal reads for normal-docker exact attempts.
   * Their receipts, result projection and attempt identity replace every
   * caller/public-result verdict at the sprint terminal boundary.
   */
  exactTerminalAuthorities?: ReadonlyMap<string, ExactAcceptedTaskTerminalAuthorityRead>;
}

function configuredMemoryExportRenderOptions(config?: ResolvedConfig): MemoryExportRenderOptions {
  const limits = config?.memory_export;
  return {
    labels: buildMemoryExportLabels(getMessage, config?.language === 'tr' ? 'tr' : 'en'),
    ...(limits?.max_inline_lines !== undefined ? { maxInlineLines: limits.max_inline_lines } : {}),
    ...(limits?.max_inline_bytes !== undefined ? { maxInlineBytes: limits.max_inline_bytes } : {}),
    ...(limits?.summary_inline_lines !== undefined ? { summaryInlineLines: limits.summary_inline_lines } : {}),
    ...(limits?.summary_inline_bytes !== undefined ? { summaryInlineBytes: limits.summary_inline_bytes } : {}),
  };
}

const TSC_SETTLEMENT_TIMEOUT_MS = 240_000;
const TSC_SETTLEMENT_ERROR_LINE_LIMIT = 20;

export interface TscSettlementRunResult {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut?: boolean;
}

export type TscSettlementRunner = (
  projectRoot: string,
  timeoutMs: number,
) => Promise<TscSettlementRunResult>;

export type TscSettlementGateResult =
  | { readonly kind: 'pass' }
  | { readonly kind: 'skip'; readonly reason: 'disabled' | 'not-typescript' | 'tsc-unavailable' }
  | { readonly kind: 'residual'; readonly code: 'TSC_DIRTY_RESIDUAL' | 'TSC_GATE_FAULT'; readonly errors: readonly string[] };

function boundedTscLines(result: TscSettlementRunResult): string[] {
  return `${result.stdout}\n${result.stderr}`.split(/\r?\n/u)
    .map(line => line.trim()).filter(Boolean).slice(0, TSC_SETTLEMENT_ERROR_LINE_LIMIT);
}

export const runTscSettlementCommand: TscSettlementRunner = (projectRoot, timeoutMs) =>
  new Promise(resolve => {
    const child = spawn('npx', ['tsc', '--noEmit'], {
      cwd: projectRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, timeoutMs);
    child.stdout?.on('data', chunk => { stdout += String(chunk); });
    child.stderr?.on('data', chunk => { stderr += String(chunk); });
    child.once('error', error => {
      clearTimeout(timer);
      resolve({ exitCode: null, stdout, stderr: `${stderr}\n${error.message}`, timedOut });
    });
    child.once('close', exitCode => {
      clearTimeout(timer);
      resolve({ exitCode, stdout, stderr, timedOut });
    });
  });

export async function runTscSettlementGate(
  projectRoot: string,
  enabled: boolean,
  runner: TscSettlementRunner = runTscSettlementCommand,
): Promise<TscSettlementGateResult> {
  if (!enabled) return { kind: 'skip', reason: 'disabled' };
  if (!existsSync(join(projectRoot, 'tsconfig.json'))) {
    return { kind: 'skip', reason: 'not-typescript' };
  }
  try {
    const result = await runner(projectRoot, TSC_SETTLEMENT_TIMEOUT_MS);
    const lines = boundedTscLines(result);
    if (result.exitCode === 0 && result.timedOut !== true) return { kind: 'pass' };
    if (result.exitCode !== null && !result.timedOut) {
      const unavailable = lines.some(line => /could not determine executable|not found|MODULE_NOT_FOUND/u.test(line));
      if (unavailable) return { kind: 'skip', reason: 'tsc-unavailable' };
      return { kind: 'residual', code: 'TSC_DIRTY_RESIDUAL', errors: lines };
    }
    return { kind: 'residual', code: 'TSC_GATE_FAULT', errors: lines };
  } catch (error: unknown) {
    return {
      kind: 'residual', code: 'TSC_GATE_FAULT',
      errors: [error instanceof Error ? error.message : String(error)],
    };
  }
}

export type FinalizerRuntimeHygieneResult =
  | { readonly state: 'skipped'; readonly reason: 'disabled' | 'not-configured' | 'not-terminal' }
  | { readonly state: 'applied'; readonly evidence: RuntimeHygieneApplyResult };

/** Typed, durable evidence that optional finalize-time hygiene did not complete. */
export class FinalizerRuntimeHygieneHoldError extends Error {
  readonly code = 'RUNTIME_HYGIENE_FINALIZER_HOLD' as const;

  constructor(
    readonly reasonCode: 'RUNTIME_HYGIENE_EXECUTION_FAILED' | 'RUNTIME_HYGIENE_PARTIAL',
    readonly evidence?: {
      readonly receiptPath: string;
      readonly outcomes: readonly RuntimeHygieneFamilyOutcome[];
    },
    options?: ErrorOptions,
  ) {
    super(`${reasonCode}${evidence ? `:${evidence.receiptPath}` : ''}`, options);
    this.name = 'FinalizerRuntimeHygieneHoldError';
  }
}

/** Apply resolved opt-in hygiene only at the verified terminal boundary. */
export function runConfiguredRuntimeHygieneAfterFinalize(
  projectRoot: string,
  sprintId: string,
  config: ResolvedConfig | undefined,
  terminal: { readonly receiptCleanupEligible: boolean; readonly archiveVerified: boolean },
): FinalizerRuntimeHygieneResult {
  const policy = config?.runtime_artifact_retention;
  if (policy === undefined) return { state: 'skipped', reason: 'not-configured' };
  if (!policy.enabled || !policy.apply_on_finalize) return { state: 'skipped', reason: 'disabled' };
  if (!terminal.receiptCleanupEligible || !terminal.archiveVerified) {
    return { state: 'skipped', reason: 'not-terminal' };
  }

  const archiveRoot = policy.archive_path.replace(/[\\/]+$/u, '');
  const runtimeBounds = policy.families['runtime'];
  try {
    const result = reconcileRuntimeHygiene(projectRoot, {
      apply: true,
      sprintIds: [sprintId],
      currentSprintIds: [],
      ...(runtimeBounds ? { jobBounds: runtimeBounds } : {}),
      flow: {
        ...(runtimeBounds ? { staleAfterMs: runtimeBounds.max_age_days * 24 * 60 * 60 * 1_000 } : {}),
        archiveRoot: `${archiveRoot}/run-flows`,
      },
      logs: {
        ...(runtimeBounds ? { maxAgeDays: runtimeBounds.max_age_days } : {}),
        archiveRoot: `${archiveRoot}/logs`,
      },
      receiptRoot: `${archiveRoot}/receipts`,
    }) as RuntimeHygieneApplyResult;
    if (result.receipt.status === 'partial') {
      throw new FinalizerRuntimeHygieneHoldError('RUNTIME_HYGIENE_PARTIAL', {
        receiptPath: result.receiptPath,
        outcomes: result.receipt.outcomes,
      });
    }
    return { state: 'applied', evidence: result };
  } catch (error) {
    if (error instanceof FinalizerRuntimeHygieneHoldError) throw error;
    throw new FinalizerRuntimeHygieneHoldError('RUNTIME_HYGIENE_EXECUTION_FAILED', undefined, {
      cause: error,
    });
  }
}

export function shouldEmitStandardLifecycleEvents(
  opts?: Pick<FinalizeSprintOptions, 'lifecycleContext'>,
): boolean {
  return opts?.lifecycleContext !== 'completed-checkpoint-recovery';
}


// ═══ Hook Stubs (Task 13 / Task 14 / Task 15 will fill these) ═══

/**
 * Run honesty check against pre-sprint baseline.
 * Stub — Task 5 (baseline-tracker) will implement comparison logic.
 * @returns Number of honesty violations detected (0 = clean)
 */
export async function runHonestyCheck(
  _projectRoot: string,
  _sprintId: string,
  _results: TaskResult[],
): Promise<number> {
  // Stub: returns 0 violations (no-op until Task 5 integrates)
  return 0;
}

/**
 * Append rubric score detail to the sprint's `retro` entry in memory.db.
 * Adds a "### Rubric Scores" section. B8: writes to the DB retro entry —
 * the legacy `.brain/RETRO.md` file is no longer produced.
 * @returns true if detail was written, false if no rubric data available
 */
export async function writeRubricDetail(
  projectRoot: string,
  sprintId: string,
  results: TaskResult[],
  _evaluations: Map<string, TaskEvaluation>,
): Promise<boolean> {
  // Only proceed if at least one result has rubric scores
  const scoredResults = results.filter(r => r.rubricScores && Object.keys(r.rubricScores).length > 0);
  if (scoredResults.length === 0) return false;

  // Build the rubric table rows
  const tableLines: string[] = [];
  tableLines.push('');
  tableLines.push(`### Rubric Scores`);
  tableLines.push('| Task | Correctness | Coverage | Scope | Docs | Avg |');
  tableLines.push('|------|-------------|----------|-------|------|-----|');

  const avgScores: number[] = [];

  for (const result of scoredResults) {
    const rs = result.rubricScores!;
    const fmt = (v: number | undefined): string => v !== undefined ? `${v}` : 'N/A';
    const correctness = rs.correctness;
    const coverage = rs.test_coverage;
    const scope = rs.scope_compliance;
    const docs = rs.documentation;

    const defined = [correctness, coverage, scope, docs].filter((v): v is number => v !== undefined);
    const avg = defined.length > 0 ? Math.round(defined.reduce((a, b) => a + b, 0) / defined.length) : undefined;
    if (avg !== undefined) avgScores.push(avg);

    tableLines.push(`| ${result.taskId} | ${fmt(correctness)} | ${fmt(coverage)} | ${fmt(scope)} | ${fmt(docs)} | ${avg !== undefined ? avg : 'N/A'} |`);
  }

  if (avgScores.length > 0) {
    const overallAvg = Math.round(avgScores.reduce((a, b) => a + b, 0) / avgScores.length);
    tableLines.push(`| **Sprint Avg** | — | — | — | — | **${overallAvg}** |`);
  }

  return appendRetroSection(projectRoot, sprintId, '### Rubric Scores', tableLines.join('\n') + '\n');
}

/**
 * Self-audit gate: run tsc + vitest + honesty + observability checks.
 * Implemented by Task 14 (Brain Self-Audit Gate).
 *
 * Gate steps:
 * 1. `npx tsc --noEmit` (timeout 90s)
 * 2. `npx vitest run` (timeout 300s) + baseline delta
 * 3. Honesty violation count from task results
 * 4. `.deckent/metrics.jsonl` existence + line count
 *
 * Overall gate = PASS if tsc + vitest + honesty all pass.
 * metrics.jsonl missing → WARNING only, not gate failure.
 */
/**
 * Typed non-green outcomes of the scoped audit surface. `ECOSYSTEM_UNSUPPORTED`
 * and `ADAPTER_HOLD` are honest holds: the gate never reports PASS for a project
 * type no registered adapter can execute.
 */
export type SelfAuditExecutionReasonCode =
  | 'NO_TEST_REQUIRED'
  | 'REQUIRED_TEST_MANIFEST_EMPTY'
  | 'EXECUTION_EVIDENCE_UNPARSEABLE'
  | 'ECOSYSTEM_UNSUPPORTED'
  | 'ADAPTER_HOLD';

export interface SelfAuditResult {
  tsc: { status: 'PASS' | 'FAIL'; errors: string[] };
  vitest: {
    status: 'PASS' | 'FAIL';
    delta: { files: number; pass: number; fail: number; skipped: number };
    execution?: {
      mode: 'scoped' | 'full';
      command: readonly string[];
      testFiles: readonly string[];
      executed: boolean;
      timedOut: boolean;
      exitCode: number | null;
      reasonCode?: SelfAuditExecutionReasonCode;
      /** Registry adapter that produced the evidence (scoped mode only). */
      adapterId?: string;
      /** Typed hold detail when the registry refused to produce green evidence. */
      holdDetail?: string;
      /** Adapter-computed digest of the captured execution output. */
      outputDigest?: string;
    };
  };
  honesty: { violations: number; flaggedTasks: string[] };
  observability: { metricsJsonlExists: boolean; lineCount: number };
  overallGate: 'PASS' | 'GATE_FAILURE';
}

export interface ScopedSelfAuditManifest {
  readonly testFiles: readonly string[];
  readonly requiresTests: boolean;
  readonly requiresTypeScript: boolean;
  readonly evidenceRefs: readonly string[];
}

function normalizeScopedAuditPath(value: string): string | null {
  const normalized = value.replaceAll('\\', '/').replace(/^\.\//u, '');
  if (
    normalized.length === 0
    || normalized.startsWith('/')
    || /^[A-Za-z]:\//u.test(normalized)
    || normalized.split('/').some(segment => segment === '' || segment === '.' || segment === '..')
  ) return null;
  return normalized;
}

function isTestFile(path: string): boolean {
  return /(?:^|\/)(?:tests?|__tests__)\//u.test(path)
    || /\.(?:test|spec)\.[^/]+$/u.test(path);
}

function isExecutableSourceFile(path: string): boolean {
  return /\.(?:[cm]?[jt]sx?|py|rb|php|java|kt|kts|cs|fs|fsx|go|rs|swift|scala|c|cc|cpp|cxx|h|hpp)$/u.test(path);
}

/**
 * Derive the finalizer's bounded test manifest from approved task scope and
 * host-attributed result paths. Worker prose and shell commands are never
 * executable authority here.
 */
export function deriveScopedSelfAuditManifest(
  tasks: readonly Task[],
  results: readonly TaskResult[],
): ScopedSelfAuditManifest {
  const paths = new Set<string>();
  const evidenceRefs = new Set<string>();
  for (const task of tasks) {
    for (const candidate of task.scope.filesWrite) {
      const normalized = normalizeScopedAuditPath(candidate);
      if (normalized) paths.add(normalized);
    }
    evidenceRefs.add(`task-scope:${task.id}`);
  }
  for (const result of results) {
    for (const candidate of normalizeChangedPaths(result.filesChanged)) {
      const normalized = normalizeScopedAuditPath(candidate);
      if (normalized) paths.add(normalized);
    }
    if (result.workAttribution?.state === 'VERIFIED') {
      evidenceRefs.add(`work-attribution:${result.taskId}:${result.workAttribution.attemptId}`);
    }
  }
  const ordered = [...paths].sort();
  const testFiles = ordered.filter(isTestFile);
  const executableSources = ordered.filter(path => isExecutableSourceFile(path) && !isTestFile(path));
  return {
    testFiles,
    requiresTests: executableSources.length > 0,
    requiresTypeScript: ordered.some(path => /\.[cm]?tsx?$/u.test(path)),
    evidenceRefs: [...evidenceRefs].sort(),
  };
}

interface BoundedCommandResult {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
}

async function runBoundedCommand(
  command: string,
  args: readonly string[],
  cwd: string,
  timeoutMs: number,
): Promise<BoundedCommandResult> {
  const { spawn } = await import('node:child_process');
  return await new Promise<BoundedCommandResult>((resolveCommand, rejectCommand) => {
    const child = spawn(command, [...args], {
      cwd,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    child.stdout.on('data', chunk => { stdout += String(chunk); });
    child.stderr.on('data', chunk => { stderr += String(chunk); });
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);
    child.once('error', error => {
      clearTimeout(timeout);
      rejectCommand(error);
    });
    child.once('close', status => {
      clearTimeout(timeout);
      resolveCommand({ status, stdout, stderr, timedOut });
    });
  });
}

/** Bounded deadline for a scoped registry-executed audit run. */
const SCOPED_SELF_AUDIT_TIMEOUT_MS = 120_000;

/**
 * Ecosystem assumed when a direct caller supplies no explicit value. Production
 * ingress (finalizeSprint) always resolves the real project ecosystem instead.
 */
const DEFAULT_SELF_AUDIT_ECOSYSTEM = 'vitest';

/**
 * Adapters shipped with deckent. Registration only — command selection and
 * output parsing stay inside the adapters.
 */
export function createDefaultSelfAuditRegistry(): SelfAuditAdapterRegistry {
  const registry = new SelfAuditAdapterRegistry();
  registry.register(new VitestSelfAuditAdapter());
  return registry;
}

/**
 * Resolve the audit ecosystem from the canonical project stack detector. An
 * undetectable stack stays honest: the registry has no adapter for `unknown`
 * and the gate holds instead of reporting a green suite it never ran.
 */
export function resolveSelfAuditEcosystem(projectRoot: string): string {
  try {
    return detectProjectStack(projectRoot).testFramework;
  } catch (e) {
    debugLog('resolveSelfAuditEcosystem', `stack detection failed: ${e}`);
    return 'unknown';
  }
}

/** Translate a registry outcome into the gate's vitest-slot evidence. */
function mapAdapterResultToGateEvidence(
  result: AdapterSelfAuditResult,
  request: SelfAuditRequest,
): SelfAuditResult['vitest'] {
  const testFiles = request.scope.kind === 'scoped' ? [...request.scope.testFiles] : [];
  const holdEvidence = (
    reasonCode: SelfAuditExecutionReasonCode,
    holdDetail: string,
    adapterId?: string,
    timedOut = false,
  ): SelfAuditResult['vitest'] => ({
    status: 'FAIL',
    delta: { files: 0, pass: 0, fail: 0, skipped: 0 },
    execution: {
      mode: 'scoped',
      command: [],
      testFiles,
      executed: false,
      timedOut,
      exitCode: null,
      reasonCode,
      holdDetail,
      ...(adapterId === undefined ? {} : { adapterId }),
    },
  });

  if (result.kind === 'unsupported') {
    return holdEvidence(
      'ECOSYSTEM_UNSUPPORTED',
      `No self-audit adapter supports ecosystem '${result.ecosystem}'`,
    );
  }
  if (result.kind === 'hold') {
    return holdEvidence(
      result.reason === 'missing-executed-evidence'
        ? 'EXECUTION_EVIDENCE_UNPARSEABLE'
        : 'ADAPTER_HOLD',
      `${result.reason}: ${result.detail}`,
      result.adapterId,
      result.reason === 'execution-timeout',
    );
  }

  const { evidence } = result;
  const unit = (kind: string): number =>
    evidence.executedUnits.find(candidate => candidate.kind === kind)?.count ?? 0;
  const executedAssertions = unit('assertion');
  const failedAssertions = unit('failed-assertion');
  return {
    status: result.outcome === 'passed' ? 'PASS' : 'FAIL',
    delta: {
      files: unit('file'),
      pass: executedAssertions - failedAssertions,
      fail: failedAssertions,
      skipped: unit('skipped-assertion'),
    },
    execution: {
      mode: 'scoped',
      command: [evidence.invocation.executable, ...evidence.invocation.argv],
      testFiles,
      executed: true,
      timedOut: false,
      exitCode: evidence.exitCode,
      adapterId: evidence.adapterId,
      outputDigest: evidence.outputDigest,
    },
  };
}

/**
 * Options for dependency injection in runSelfAuditGate.
 * Allows tests to override shell commands and filesystem access.
 */
export interface SelfAuditGateOptions {
  /** Override tsc execution (for testing) */
  runTsc?: (projectRoot: string) => { status: number; stdout: string; stderr: string };
  /** Override vitest execution (for testing) */
  runVitest?: (projectRoot: string) => { status: number; stdout: string; stderr: string };
  /** Finalizer-only bounded manifest. Absence means an explicit full audit surface. */
  scopedManifest?: ScopedSelfAuditManifest;
  /** Async scoped runner seam; receives shell-free argv. */
  runScopedCommand?: (
    command: string,
    args: readonly string[],
    projectRoot: string,
    timeoutMs: number,
  ) => Promise<BoundedCommandResult>;
  /** Scoped-mode adapter registry. Defaults to the shipped adapter set. */
  selfAuditRegistry?: SelfAuditAdapterRegistry;
  /** Scoped-mode ecosystem id. Production ingress resolves it from the project stack. */
  selfAuditEcosystem?: string;
  /** Override honesty check results (for testing) */
  honestyResults?: Array<{ taskId: string; violation: boolean }>;
  /** Override metrics.jsonl path check (for testing) */
  metricsJsonlPath?: string;
}

export async function runSelfAuditGate(
  sprintId: string,
  projectRoot?: string,
  options?: SelfAuditGateOptions,
): Promise<SelfAuditResult> {
  const root = projectRoot ?? process.cwd();

  // ── Step 1: tsc --noEmit (timeout 90s) ──────────────────────────
  let tscResult: SelfAuditResult['tsc'];
  try {
    const tscRun = options?.runTsc
      ? options.runTsc(root)
      : options?.scopedManifest && !options.scopedManifest.requiresTypeScript
        ? { status: 0, stdout: '', stderr: '' }
        : options?.scopedManifest
          ? await (options.runScopedCommand ?? runBoundedCommand)(
            'npx', ['tsc', '--noEmit'], root, 30_000,
          )
          : spawnSync('npx', ['tsc', '--noEmit'], {
          cwd: root,
          timeout: 30_000,
          stdio: ['pipe', 'pipe', 'pipe'],
          encoding: 'utf-8',
          });

    if (tscRun.status === 0) {
      tscResult = { status: 'PASS', errors: [] };
    } else {
      const output = ((tscRun.stdout ?? '') + (tscRun.stderr ?? '')).trim();
      const errors = output
        .split('\n')
        .filter(line => line.includes('error TS'))
        .slice(0, 20);
      tscResult = { status: 'FAIL', errors };
    }
  } catch (e) {
    tscResult = { status: 'FAIL', errors: [`tsc execution failed: ${e}`] };
  }
  debugLog('runSelfAuditGate:tsc', `status=${tscResult.status} errors=${tscResult.errors.length}`);

  // ── Step 2: vitest run (timeout 300s) + baseline delta ──────────
  let vitestResult: SelfAuditResult['vitest'];
  try {
    const scopedManifest = options?.scopedManifest;
    if (scopedManifest && scopedManifest.testFiles.length === 0) {
      const required = scopedManifest.requiresTests;
      vitestResult = {
        status: required ? 'FAIL' : 'PASS',
        delta: { files: 0, pass: 0, fail: 0, skipped: 0 },
        execution: {
          mode: 'scoped',
          command: [],
          testFiles: [],
          executed: false,
          timedOut: false,
          exitCode: null,
          reasonCode: required ? 'REQUIRED_TEST_MANIFEST_EMPTY' : 'NO_TEST_REQUIRED',
        },
      };
    } else if (scopedManifest) {
      // Scoped surface: the adapter registry is the single authority for the
      // command and for the executed-count evidence that may turn the gate green.
      const request: SelfAuditRequest = {
        ecosystem: options?.selfAuditEcosystem ?? DEFAULT_SELF_AUDIT_ECOSYSTEM,
        projectRoot: root,
        scope: { kind: 'scoped', testFiles: [...scopedManifest.testFiles] },
        timeoutMs: SCOPED_SELF_AUDIT_TIMEOUT_MS,
      };
      const runScoped = options?.runScopedCommand ?? runBoundedCommand;
      const execute: SelfAuditExecutor = async invocation => {
        const run = await runScoped(
          invocation.executable, invocation.argv, invocation.cwd, invocation.timeoutMs,
        );
        return {
          exitCode: run.status,
          stdout: run.stdout,
          stderr: run.stderr,
          timedOut: run.timedOut,
        };
      };
      const registry = options?.selfAuditRegistry ?? createDefaultSelfAuditRegistry();
      vitestResult = mapAdapterResultToGateEvidence(await registry.run(request, execute), request);
    } else {
      const vitestRun = options?.runVitest
        ? options.runVitest(root)
        : spawnSync('npx', ['vitest', 'run', '--reporter=basic'], {
          cwd: root,
          timeout: 120_000,
          stdio: ['pipe', 'pipe', 'pipe'],
          encoding: 'utf-8',
        });

      const vitestOutput = ((vitestRun.stdout ?? '') + (vitestRun.stderr ?? '')).trim();
      const current = parseVitestBaseline(vitestOutput);

      // Explicit `deckent audit` full-authority surface: unchanged historical
      // net-new baseline comparison over the whole repository suite.
      const baseline = readBaseline(root, sprintId);

      const delta = baseline != null && current != null
        ? {
          files: current.files - baseline.files,
          pass: current.pass - baseline.pass,
          fail: current.fail - baseline.fail,
          skipped: current.skipped - baseline.skipped,
        }
        : { files: 0, pass: 0, fail: current?.fail ?? 0, skipped: 0 };

      const netNewFailures = baseline != null && current != null
        ? delta.fail
        : (current?.fail ?? 0);
      const vitestPassed = vitestRun.status === 0
        || (current != null && current.fail === 0)
        || netNewFailures <= 0;
      vitestResult = { status: vitestPassed ? 'PASS' : 'FAIL', delta };
    }
  } catch (e) {
    vitestResult = { status: 'FAIL', delta: { files: 0, pass: 0, fail: 0, skipped: 0 } };
    debugLog('runSelfAuditGate:vitest', `execution failed: ${e}`);
  }
  debugLog('runSelfAuditGate:vitest', `status=${vitestResult.status} delta.fail=${vitestResult.delta.fail}`);

  // ── Step 3: Honesty violations ──────────────────────────────────
  let honestyResult: SelfAuditResult['honesty'];
  if (options?.honestyResults) {
    const violations = options.honestyResults.filter(r => r.violation);
    honestyResult = {
      violations: violations.length,
      flaggedTasks: violations.map(r => r.taskId),
    };
  } else {
    const flaggedTasks: string[] = [];
    try {
      const tasksDir = join(root, '.tasks');
      // Async readdir — Sprint 139 async migration
      const tasksDirFiles = await fsPromises.readdir(tasksDir).catch(() => [] as string[]);
      const resultFiles = tasksDirFiles.filter(f => f.endsWith('.result'));
      for (const file of resultFiles) {
        try {
          // Async readFile — Sprint 139 async migration
          const raw = await fsPromises.readFile(join(tasksDir, file), 'utf-8');
          const result = JSON.parse(raw) as { taskId?: string; notes?: string };
          if (result.notes && containsHonestyTrigger(result.notes)) {
            if (options?.scopedManifest) {
              // Never launch a hidden second suite from the scoped finalizer.
              // The explicit honesty marker remains visible and fail-closed.
              flaggedTasks.push(result.taskId ?? file);
            } else {
              const taskBaseline = readBaseline(root, sprintId);
              if (taskBaseline) {
                const currentCapture = await captureVitestBaseline(root, 180_000);
                if (currentCapture && currentCapture.fail > taskBaseline.fail) {
                  flaggedTasks.push(result.taskId ?? file);
                }
              }
            }
          }
        } catch { /* skip unparseable result files */ }
      }
    } catch (e) {
      debugLog('runSelfAuditGate:honesty', `scan failed: ${e}`);
    }
    honestyResult = {
      violations: flaggedTasks.length,
      flaggedTasks,
    };
  }
  debugLog('runSelfAuditGate:honesty', `violations=${honestyResult.violations}`);

  // ── Step 4: Observability — metrics.jsonl check (async) ─────────
  const metricsPath = options?.metricsJsonlPath ?? join(root, '.deckent', 'metrics.jsonl');
  let observabilityResult: SelfAuditResult['observability'];
  // Async readFile — Sprint 139 async migration (replaces existsSync + readFileSync)
  try {
    const content = await fsPromises.readFile(metricsPath, 'utf-8');
    const lineCount = content.split('\n').filter(l => l.trim().length > 0).length;
    observabilityResult = { metricsJsonlExists: true, lineCount };
  } catch {
    observabilityResult = { metricsJsonlExists: false, lineCount: 0 };
    debugLog('runSelfAuditGate:observability', 'WARNING: metrics.jsonl not found');
  }

  // ── Overall Gate Decision ───────────────────────────────────────
  const overallGate: 'PASS' | 'GATE_FAILURE' =
    tscResult.status === 'FAIL' ||
    vitestResult.status === 'FAIL' ||
    honestyResult.violations > 0
      ? 'GATE_FAILURE'
      : 'PASS';

  debugLog('runSelfAuditGate', `overallGate=${overallGate} sprint=${sprintId}`);

  return {
    tsc: tscResult,
    vitest: vitestResult,
    honesty: honestyResult,
    observability: observabilityResult,
    overallGate,
  };
}


// ═══ Gate Status Propagation ══════════════════════════════════════

/**
 * Apply self-audit gate result to sprint status.
 * If gate fails (GATE_FAILURE), overrides currentStatus with GO_WITH_GATE_FAILURE.
 * PASS and WARNING gates leave status unchanged.
 */
export function applyGateStatus(currentStatus: string, gate: Pick<SelfAuditResult, 'overallGate'>): string {
  if (gate.overallGate === 'GATE_FAILURE') {
    return GO_WITH_GATE_FAILURE;
  }
  return currentStatus;
}

/** Clear only the obsolete gate-derived downgrade after a fresh product-green pass. */
export function applyAuthoritativeGateStatus(
  currentStatus: string,
  outcome: 'PASS' | 'FAIL',
  logicalProductGreen: boolean,
): string {
  if (outcome === 'FAIL') return GO_WITH_GATE_FAILURE;
  if (logicalProductGreen && currentStatus === GO_WITH_GATE_FAILURE) return 'DONE';
  return currentStatus;
}

export class FinalizerFreshGateHoldError extends Error {
  constructor(readonly reasonCode: string) {
    super(reasonCode);
    this.name = 'FinalizerFreshGateHoldError';
  }
}

export interface FreshFinalizerGateResolution {
  readonly authority: SprintFinalizerGateAuthority;
  readonly outcome: 'PASS' | 'FAIL';
  readonly reused: boolean;
}

/** Resolve an exact gate or invalidate stale evidence and compute one fresh gate. */
export async function resolveOrEvaluateFreshFinalizerGate(input: {
  readonly authority: SprintFinalizerGateAuthority;
  readonly currentInput: SprintFinalizerGateInput;
  readonly evaluate: () => Promise<'PASS' | 'FAIL'>;
  readonly now?: () => string;
}): Promise<FreshFinalizerGateResolution> {
  const resolution = resolveSprintFinalizerGate(input.authority, input.currentInput);
  if (resolution.decision === 'authoritative') {
    return { authority: input.authority, outcome: resolution.receipt.outcome, reused: true };
  }

  const inputDigest = deriveSprintFinalizerGateInputDigest(input.currentInput);
  let authority = input.authority;
  if (resolution.reasonCode === 'stale-input') {
    const invalidated = invalidateSprintFinalizerGate(authority, {
      expectedRevision: authority.revision,
      invalidatedInputDigest: authority.gate!.inputDigest,
      replacementInputDigest: inputDigest,
      observedAt: (input.now ?? (() => new Date().toISOString()))(),
    });
    if (invalidated.decision === 'hold') {
      throw new FinalizerFreshGateHoldError(`FINALIZER_GATE_INVALIDATION_HOLD:${invalidated.reasonCode}`);
    }
    authority = invalidated.state;
  }

  const outcome = await input.evaluate();
  const published = publishSprintFinalizerGate(authority, {
    input: input.currentInput,
    inputDigest,
    outcome,
    expectedRevision: authority.revision,
  });
  if (published.decision === 'hold') {
    throw new FinalizerFreshGateHoldError(`FINALIZER_GATE_PUBLISH_HOLD:${published.reasonCode}`);
  }
  return { authority: published.state, outcome: published.receipt.outcome, reused: false };
}


// ═══ Adaptive Thresholds ══════════════════════════════════════════

/**
 * Pure helper for the coverage aspirational auto-learn step (Sprint 179 W2-4).
 *
 * Returns the new aspirational coverage target given the current target,
 * the immutable hard floor, and recent avg coverage. The hard floor is
 * never mutated — the result is always clamped at `>= hardFloor`.
 *
 * Lowering rule (mirrors pre-split behavior): when avg coverage drops
 * below 70 and is positive, lower aspirational to round(avg). Otherwise
 * no change. The clamp prevents the EVALUATE gate from ever sliding
 * below `hardFloor`.
 */
export function computeAdjustedAspirational(input: {
  currentAspirational: number;
  hardFloor: number;
  avgCoverage: number;
}): { newAspirational: number; changed: boolean } {
  const { currentAspirational, hardFloor, avgCoverage } = input;
  if (avgCoverage <= 0 || avgCoverage >= 70) {
    return { newAspirational: currentAspirational, changed: false };
  }
  const proposed = Math.round(avgCoverage);
  const clamped = Math.max(proposed, hardFloor);
  return {
    newAspirational: clamped,
    changed: clamped !== currentAspirational,
  };
}

/**
 * Auto-adjust agent_min_score and coverage_aspirational based on recent sprint stats.
 * Reads .brain/sprints/ files, computes NO_GO rate and avg coverage,
 * then writes updated values to .deckent/config.json and appends a note to RETRO.md.
 *
 * Rules:
 * - NO_GO rate > no_go_threshold → agent_min_score decremented (min 1)
 * - NO_GO rate < 10% → agent_min_score incremented (max 10)
 * - avg coverage < 70% → coverage_aspirational lowered to avg (clamped at coverage_hard_floor)
 * - coverage_hard_floor is immutable; auto-learn never touches it
 * - Requires min_samples sprints before any adjustment
 */
export async function applyAdaptiveThresholds(projectRoot: string, config: ResolvedConfig, sprintId?: string): Promise<void> {
  const ac = config.adaptive_config;
  const stats = await getRecentSprintStats(projectRoot, ac.coverage_lookback);

  if (stats.sprintCount < ac.min_samples) {
    debugLog('applyAdaptiveThresholds', `Not enough sprints (${stats.sprintCount}/${ac.min_samples}) — skipping`);
    return;
  }

  const changes: string[] = [];
  const configPath = join(projectRoot, '.deckent', 'config.json');
  // Async config read — Sprint 139 async migration
  const rawCfg: Record<string, unknown> = await (async () => {
    try {
      return JSON.parse(await fsPromises.readFile(configPath, 'utf-8')) as Record<string, unknown>;
    } catch {
      return {};
    }
  })();

  // Adjust agent_min_score based on NO_GO rate
  const currentScore = config.agent_min_score;
  let newScore = currentScore;
  if (stats.avgNoGoRate > ac.no_go_threshold && currentScore > 1) {
    newScore = currentScore - 1;
  } else if (stats.avgNoGoRate < 0.1 && currentScore < 10) {
    newScore = currentScore + 1;
  }
  if (newScore !== currentScore) {
    rawCfg['agent_min_score'] = newScore;
    changes.push(`agent_min_score ${currentScore} => ${newScore} (NO_GO rate: ${(stats.avgNoGoRate * 100).toFixed(1)}%)`);
    debugLog('applyAdaptiveThresholds', changes.at(-1));
  }

  // Adjust coverage_aspirational based on avg coverage — Sprint 179 W2-4.
  // The hard floor (immutable EVALUATE gate) is never written; the helper
  // clamps the new aspirational to `>= hard_floor`.
  // Defensive defaults: config-types marks both fields optional on
  // ResolvedConfig and instructs consumers to `?? <default>` (50 / 90).
  const currentAspirational = config.coverage_aspirational ?? 90;
  const hardFloor = config.coverage_hard_floor ?? 50;
  const adjustment = computeAdjustedAspirational({
    currentAspirational,
    hardFloor,
    avgCoverage: stats.avgCoverage,
  });
  if (adjustment.changed) {
    rawCfg['coverage_aspirational'] = adjustment.newAspirational;
    // Mirror to the legacy field so unmigrated consumers stay in sync.
    rawCfg['coverage_threshold'] = adjustment.newAspirational;
    changes.push(
      `coverage_aspirational ${currentAspirational} => ${adjustment.newAspirational} ` +
      `(avg coverage: ${stats.avgCoverage.toFixed(1)}%, hard_floor: ${hardFloor})`,
    );
    debugLog('applyAdaptiveThresholds', changes.at(-1));
  }

  if (changes.length === 0) return;

  writeConfigJsonAtomic(configPath, rawCfg);

  // Append adaptive-threshold notes to the sprint retro entry — B8 (DB-first).
  if (sprintId) {
    const adaptiveSection = '\n### Adaptive Threshold Changes\n'
      + changes.map(c => `- Adaptive: ${c}`).join('\n') + '\n';
    appendRetroSection(projectRoot, sprintId, '### Adaptive Threshold Changes', adaptiveSection);
  }
}


// ═══ Budgeted Decay (mode-independent) ════════════════════════════

/**
 * CORE-UNIFORMITY (slice 2): mode-independent budgeted brain-memory decay.
 *
 * Extracted from finalizeSprint so BOTH the sprint lifecycle AND the autonomous
 * per-item lifecycle (execute-dispatcher's `postItemLifecycle`) share a single
 * decay path — sprint-coupling resolved. Audits the brain budget; when OVER it
 * forces a decay, otherwise runs the normal (budget-gated) decay.
 *
 * Self-contained + fail-safe: never throws (errors are debug-logged and swallowed),
 * so callers can invoke it inline without guarding. Behavior is identical to the
 * former inline finalizeSprint block; only the debug label differs.
 *
 * @param projectRoot - Project root directory
 * @param sprintId - Current sprint id (used for retention-window math in runDecay)
 * @param opts.memoryBudget - Brain memory budget in entries/lines (default 900)
 * @param opts.decaySprints - Retention window; MUST be the caller's
 *   `config.decay_after_sprints` (default 20). Dropping it regresses the Sprint 232
 *   memory-loss bug (runDecay silently falls back to a hardcoded 8).
 */
export function runBudgetedDecay(
  projectRoot: string,
  sprintId: string,
  opts?: { memoryBudget?: number; decaySprints?: number },
): void {
  try {
    const memBudget = opts?.memoryBudget ?? 900;
    const decayAfterSprints = opts?.decaySprints;
    const budgetAudit = auditBrainBudget(projectRoot, memBudget);
    if (budgetAudit.status === 'OVER') {
      debugLog('runBudgetedDecay', `Brain budget OVER: ${budgetAudit.decayableLines} decayable lines > ${memBudget} budget (${budgetAudit.permanentLines} permanent exempt, decay_after_sprints=${decayAfterSprints ?? 'default'})`);
      runDecay(projectRoot, sprintId, { force: true, memoryBudget: memBudget, decaySprints: decayAfterSprints });
    } else {
      runDecay(projectRoot, sprintId, { memoryBudget: memBudget, decaySprints: decayAfterSprints });
    }
  } catch (e) { debugLog('runBudgetedDecay', e); }
}

/**
 * ADR-090 doc-tracking sync hook. Gated on config.doc_tracking.sync_on_finalize
 * (default OFF — no surprise overhead). DB-only (no front-matter writes).
 * Fail-safe: any error is swallowed (debugLog) so it can never break finalize.
 */
export async function maybeRunDocTrackingSync(
  projectRoot: string,
  config: { doc_tracking?: { sync_on_finalize?: boolean } } | undefined,
): Promise<{ ran: boolean; count?: number }> {
  if (config?.doc_tracking?.sync_on_finalize !== true) return { ran: false };
  try {
    const { count } = await runDocTrackingSync(projectRoot);
    return { ran: true, count };
  } catch (e) {
    debugLog('finalizeSprint:docTrackingSync', e);
    return { ran: true };
  }
}


// ═══ Stale Handoff Pruning (B-HANDOFF-PRUNE — Sprint 331 331-006) ═

/**
 * B-HANDOFF-PRUNE (Sprint 331 331-006) — prune stale cross-sprint handoff files
 * at sprint finalize.
 *
 * `.tasks/handoffs/` is an append-only registry: every handoff ever written
 * stays on disk forever, so the directory grows without bound across sprints.
 * B-HANDOFF-STALE (Sprint 318) scoped the observability *summary* to the current
 * sprint, but the storage itself kept accumulating; this deletes the stale files
 * whose endpoints are BOTH outside the current sprint, leaving in-flight
 * (current-sprint) handoffs untouched.
 *
 * Non-blocking + fail-safe: derives the current-sprint task-id set from
 * `sprint.tasks` and delegates to `HandoffProtocol.pruneCompletedSprints` (the
 * membership rule + deletion live there, already unit-tested — not re-implemented
 * here). Any error is swallowed via debugLog so it can NEVER fail or block
 * finalize. Mirrors the other end-of-sprint storage-retention hooks
 * (runBudgetedDecay / cleanTasksArchive / sprintFileRetention).
 *
 * @param projectRoot - Project root directory (handoffs live under
 *   `<projectRoot>/.tasks/handoffs/`). Always the caller's root — never cwd.
 * @param sprint - The completed sprint; its `tasks[].id` are the in-flight set.
 * @returns the number of stale handoff files pruned (0 on any failure or empty registry).
 */
export function pruneStaleHandoffs(projectRoot: string, sprint: Sprint): number {
  try {
    const currentSprintTaskIds = new Set(sprint.tasks.map(t => t.id));
    return new HandoffProtocol(projectRoot).pruneCompletedSprints(currentSprintTaskIds);
  } catch (e) {
    debugLog('finalizeSprint:pruneStaleHandoffs', e);
    return 0;
  }
}


// ═══ KPI Usage Totals (Sprint 330 Task 8) ════════════════════════

// Opus-tier public per-token prices (USD). Estimate-only FALLBACK — applied per
// result only when that result carries no provider-reported `cost` (Sprint 332).
const OPUS_PRICE_INPUT_USD = 5e-6;
const OPUS_PRICE_OUTPUT_USD = 25e-6;
const OPUS_PRICE_CACHE_READ_USD = 0.5e-6;

/**
 * Per-result Opus-tier cost estimate (USD) from a result's token counts — the
 * conservative single-tier FALLBACK used only when a result reports no `cost.usd`.
 * Null-safe: a missing `tokenUsage` estimates to 0.
 */
function estimateResultCost(usage: TaskResult['tokenUsage']): number {
  if (!usage) return 0;
  return (
    (usage.inputTokens ?? 0) * OPUS_PRICE_INPUT_USD +
    (usage.outputTokens ?? 0) * OPUS_PRICE_OUTPUT_USD +
    (usage.cacheReadTokens ?? 0) * OPUS_PRICE_CACHE_READ_USD
  );
}

/**
 * Aggregate per-task usage across a sprint's results into the provider-agnostic
 * {@link UsageTotals} consumed by the KPI collection pipeline.
 *
 * Billing-authority-first: `result.cost.usd` is incremental billed/API spend,
 * while `result.cost.referenceUsd` retains catalog/provider-equivalent value for
 * subscription, free-tier and local attempts. A legacy result without the
 * separated reference field falls back to its historical cost or token estimate.
 *
 * Token counts are still summed across all results regardless of cost source.
 *
 * Pure + total + null-safe: a result with no `tokenUsage` and no `cost` contributes
 * 0 (so a sprint with no usage telemetry yields all-zero totals, never a crash), and
 * the function never throws.
 */
export function buildUsageTotals(
  results: readonly TaskResult[],
  tasks: readonly Task[] = [],
  defaultAuthMode?: 'subscription' | 'api' | 'hybrid',
): UsageTotals {
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheRead = 0;
  let costUsd = 0;
  let referenceCostUsd = 0;
  let unknownBillingTaskCount = 0;
  const tasksById = new Map(tasks.map(task => [task.id, task]));

  for (const result of results) {
    const usage = result.tokenUsage;
    if (usage) {
      inputTokens += usage.inputTokens ?? 0;
      outputTokens += usage.outputTokens ?? 0;
      cacheRead += usage.cacheReadTokens ?? 0;
    }

    // Reference value keeps provider/catalog equivalence; the legacy Opus-tier
    // estimate is used only when this result reports no cost authority.
    const reportedReferenceCost = result.cost?.referenceUsd ?? result.cost?.usd;
    const referenceCost = typeof reportedReferenceCost === 'number'
      && Number.isFinite(reportedReferenceCost)
      ? reportedReferenceCost
      : estimateResultCost(usage);
    referenceCostUsd += referenceCost;

    // KPI `cost_usd` means billed/API spend. Subscription, free-tier and
    // local regimes may retain a catalog-equivalent reference value for
    // comparison, but that value is never money owed.
    const task = tasksById.get(result.taskId);
    if (task) {
      const effectiveAuthMode = task.authMode ?? defaultAuthMode;
      const billingMode = resolveBillingModeForAuth(
        task.provider,
        effectiveAuthMode,
      ) ?? (effectiveAuthMode === undefined ? result.cost?.billingMode : undefined);
      if (billingMode === 'api') {
        const billedCost = result.cost?.usd;
        const billedEvidenceKnown = result.cost !== undefined
          && !result.cost.pricingSource.startsWith('unknown-model:')
          && !result.cost.pricingSource.startsWith('unknown-billing:')
          && !result.cost.pricingSource.startsWith('unverified-api-reference:');
        if (
          billedEvidenceKnown
          && typeof billedCost === 'number'
          && Number.isFinite(billedCost)
        ) {
          costUsd += billedCost;
        } else {
          unknownBillingTaskCount++;
        }
      }
      else if (billingMode === undefined) unknownBillingTaskCount++;
    } else {
      // Backward-compatible library/test path: absent task authority retains
      // the historical metered interpretation.
      costUsd += referenceCost;
    }
  }

  return tasks.length > 0
    ? {
        costUsd,
        referenceCostUsd,
        unknownBillingTaskCount,
        inputTokens,
        outputTokens,
        cacheRead,
      }
    : { costUsd, inputTokens, outputTokens, cacheRead };
}


// ═══ Canonical terminal truth projection (Sprint 486 task 486-007) ════════

export class FinalizerTerminalEvidenceError extends Error {
  constructor(readonly reasonCode: string) {
    super(reasonCode);
    this.name = 'FinalizerTerminalEvidenceError';
  }
}

export interface FinalizerLogicalMetrics {
  readonly totalTasks: number;
  readonly completedTasks: number;
  readonly techDebtTasks: number;
  readonly noGoTasks: number;
  readonly unevaluatedTasks: number;
  readonly coveragePercent: number;
}

/** Receipt-facing lineage counts derived only from classified terminal evidence. */
export interface FinalizerTerminalTruthCounts {
  readonly completedLineages: number;
  readonly policySkippedLineages: number;
  readonly cascadeSkippedLineages: number;
}

/**
 * Digest-only custody projection retained by the sprint receipt. It carries
 * every immutable T11 boundary independently so archive readers can prove
 * which accepted result, evaluation, finalizer and settlement were closed;
 * the combined logical digest is not asked to stand in for those identities.
 */
export interface FinalizerExactCustodyDigestBundle {
  readonly taskId: string;
  readonly attemptId: string;
  readonly generation: number;
  readonly admissionReceiptDigest: string;
  readonly acceptedResultArtifactReceiptDigest: string;
  readonly acceptedResultChainDigest: string;
  readonly resultDigest: string;
  readonly evaluationArtifactReceiptDigest: string;
  readonly evaluationChainDigest: string;
  readonly evaluationReceiptDigest: string;
  readonly finalizerArtifactReceiptDigest: string;
  readonly finalizerChainDigest: string;
  readonly finalizerReceiptDigest: string;
  readonly settlementArtifactReceiptDigest: string;
  readonly settlementDigest: string;
}

export interface FinalizerTerminalTruth {
  readonly attempts: readonly ExactAttemptEvidence<TaskResult>[];
  readonly terminalEvidence: SprintTerminalEvidence<TaskResult>;
  readonly logicalProgress: LogicalProgressProjection;
  readonly logicalMetrics: FinalizerLogicalMetrics;
  readonly terminalTruth: FinalizerTerminalTruthCounts;
  readonly logicalEvaluations: ReadonlyMap<string, TaskEvaluation>;
  readonly lineageUsage: readonly LineageUsageAuthorityAggregate[];
  readonly usageTotals: UsageTotals;
  readonly exactCustodyDigests: readonly FinalizerExactCustodyDigestBundle[];
  readonly logicalSettlementDigest: string;
}

export interface FinalizerTerminalReceiptPublication {
  readonly receipt: SprintTerminalReceiptV1;
  readonly terminalEvidence: SprintTerminalEvidence<TaskResult>;
  readonly artifactPath: string;
}

export interface ForceAbortSprintSettlement {
  readonly outcome: 'ABORTED';
  readonly receiptPublication: FinalizerTerminalReceiptPublication;
  readonly terminalTruth: FinalizerTerminalTruth;
}

export interface TestModeSprintTerminalSettlement {
  readonly receiptPublication: FinalizerTerminalReceiptPublication;
  readonly terminalTruth: FinalizerTerminalTruth;
}

export const SPRINT_TERMINAL_COMPLETED_CHANNEL = 'BRAIN→*:SPRINT_TERMINAL_COMPLETED';
export const SPRINT_TERMINAL_ABORTED_CHANNEL = 'BRAIN→*:SPRINT_TERMINAL_ABORTED';

export interface SprintTerminalDurableEvent {
  readonly channel: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly target?: string;
}

export interface OutermostSprintTerminalArchivePublication {
  readonly seal: SprintArchiveTerminalSealResult;
  readonly verification: SprintArchiveTerminalVerificationReport;
  readonly finalEvent: {
    readonly sequence: number;
    readonly digest: string;
  };
}

function matchesTerminalVerification(
  sprintId: string,
  application: SprintArchiveTerminalApplicationReceipt | undefined,
  verification: SprintArchiveTerminalVerificationReport | undefined,
): boolean {
  return application?.state === 'applied'
    && verification?.ok === true
    && verification.sprintId === sprintId
    && verification.manifestDigest === application.manifestDigest
    && verification.sealReceiptSha256 === application.sealReceiptSha256
    && verification.brainIndexSha256 === (application.brainIndexSha256 ?? null)
    && verification.guardedSummarySha256 === (application.guardedSummarySha256 ?? null);
}

/**
 * Identifies whether the canonical terminal seal was already committed before
 * a later projection failed. Recovery callers use this bit to avoid appending
 * a HOLD event to an immutable, sealed journal.
 */
export class SprintTerminalArchivePublicationError extends FinalizerTerminalEvidenceError {
  constructor(
    reasonCode: string,
    readonly archiveSealed: boolean,
    options?: ErrorOptions,
  ) {
    super(reasonCode);
    this.name = 'SprintTerminalArchivePublicationError';
    if (options?.cause !== undefined) this.cause = options.cause;
  }
}

function persistedReceiptMatches(
  projectRoot: string,
  sprintId: string,
  expected: SprintTerminalReceiptV1,
): boolean {
  const artifact = readJsonSafe<Record<string, unknown>>(
    join(projectRoot, RECENT_WORKS_DIR, `${sprintId}-terminal-receipt.json`),
  );
  if (!artifact) return false;
  const candidate = artifact.receipt && typeof artifact.receipt === 'object' && !Array.isArray(artifact.receipt)
    ? artifact.receipt as Record<string, unknown>
    : artifact;
  return receiptRecordMatches(candidate, expected);
}

function receiptRecordMatches(
  candidate: Record<string, unknown>,
  expected: SprintTerminalReceiptV1,
): boolean {
  return candidate.version === expected.version
    && candidate.sprintId === expected.sprintId
    && candidate.runId === expected.runId
    && candidate.coordinatorGeneration === expected.coordinatorGeneration
    && candidate.terminalOutcome === expected.terminalOutcome
    && candidate.logicalSettlementDigest === expected.logicalSettlementDigest
    && candidate.priorAuthorityVersion === expected.priorAuthorityVersion
    && candidate.authorityVersion === expected.authorityVersion;
}

function resumePersistedTerminalReceipt(input: {
  readonly projectRoot: string;
  readonly sprintId: string;
  readonly expected: SprintTerminalReceiptV1;
  readonly terminalEvidence: SprintTerminalEvidence<TaskResult>;
}): FinalizerTerminalReceiptPublication {
  const artifactPath = join(
    input.projectRoot,
    RECENT_WORKS_DIR,
    `${input.sprintId}-terminal-receipt.json`,
  );
  const persisted = readJsonSafe<PersistedSprintTerminalReceipt>(artifactPath);
  if (!persisted
      || persisted.terminalOutcome !== 'COMPLETE'
      || !receiptRecordMatches(
        persisted.receipt as unknown as Record<string, unknown>,
        input.expected,
      )
      || persisted.terminalEvidence.cleanupEligibility.candidate !== true
      || persisted.terminalEvidence.holds.length > 0
      || input.terminalEvidence.cleanupEligibility.candidate !== true) {
    throw new FinalizerTerminalEvidenceError('TERMINAL_RECEIPT_RESUME_AUTHORITY_HOLD');
  }
  return {
    receipt: persisted.receipt,
    terminalEvidence: input.terminalEvidence,
    artifactPath,
  };
}

function terminalEventsProjectionDigest(events: readonly SprintTerminalDurableEvent[]): string {
  return createHash('sha256').update(canonicalJson(events.map(event => ({
    channel: event.channel,
    target: event.target ?? '*',
    payload: event.payload,
  })))).digest('hex');
}

function postSealPolicyDigest(config: ResolvedConfig | undefined): string | null {
  const policy = config?.runtime_artifact_retention;
  return policy === undefined
    ? null
    : createHash('sha256').update(canonicalJson(policy)).digest('hex');
}

function manualFinalizeTerminalEvents(
  receipt: SprintTerminalReceiptV1,
): readonly SprintTerminalDurableEvent[] {
  return [
    {
      channel: CHANNELS.SPRINT_PHASE_CHANGE,
      payload: {
        fromPhase: SprintPhase.DECAY,
        toPhase: SprintPhase.COMPLETE,
        sprintId: receipt.sprintId,
        transitionKind: 'manual-finalize',
      },
    },
    {
      channel: SPRINT_TERMINAL_COMPLETED_CHANNEL,
      payload: {
        sprintId: receipt.sprintId,
        status: SprintStatus.COMPLETE,
        phase: SprintPhase.COMPLETE,
        terminalOutcome: 'COMPLETE',
        runId: receipt.runId,
        coordinatorGeneration: receipt.coordinatorGeneration,
        authorityVersion: receipt.authorityVersion,
      },
    },
  ];
}

/**
 * A published terminal seal is the replay boundary for manual finalization.
 * Re-entering the full finalizer would append pre-terminal events and mutate
 * already-bound projections before the outer publisher can inspect the seal.
 * Validate the current logical input against the immutable receipt, resume or
 * replay the outer seal, and let the caller return its freshly computed metrics.
 */
function replaySettledManualFinalizeIfPresent(input: {
  readonly projectRoot: string;
  readonly sprintId: string;
  readonly logicalSettlementDigest: string;
  readonly opts?: FinalizeSprintOptions;
}): boolean {
  if (input.opts?.deferTerminalAuthority) return false;
  const archiveDir = resolveSprintArchiveDir(input.projectRoot, input.sprintId);
  const sealPath = join(archiveDir, 'terminal-seal-receipt.json');
  const applicationPath = join(archiveDir, 'terminal-seal-application.json');
  const sealExists = existsSync(sealPath);
  const applicationExists = existsSync(applicationPath);
  if (!sealExists && !applicationExists) return false;
  const seal = readJsonSafe<SprintArchiveTerminalSealReceipt>(sealPath);
  const application = readJsonSafe<SprintArchiveTerminalApplicationReceipt>(applicationPath);
  const expectedRunId = input.opts?.flowId ?? input.sprintId;
  const expectedGeneration = input.opts?.coordinatorGeneration ?? 1;
  if (!seal
      || seal.sprintId !== input.sprintId
      || seal.terminalOutcome !== 'COMPLETE'
      || seal.logicalSettlementDigest !== input.logicalSettlementDigest
      || seal.terminalReceipt.runId !== expectedRunId
      || seal.terminalReceipt.coordinatorGeneration !== expectedGeneration
      || seal.postSealPolicySha256 !== postSealPolicyDigest(input.opts?.config)) {
    throw new FinalizerTerminalEvidenceError('SPRINT_ARCHIVE_EXISTING_SEAL_IDENTITY_MISMATCH');
  }
  const terminalEvents = manualFinalizeTerminalEvents(seal.terminalReceipt);
  if (application?.state === 'applied') {
    const replay = replayExistingTerminalSeal({
      projectRoot: input.projectRoot,
      sprintId: input.sprintId,
      receipt: seal.terminalReceipt,
      terminalEvents,
      config: input.opts?.config,
    });
    if (!replay) {
      throw new FinalizerTerminalEvidenceError('SPRINT_ARCHIVE_EXISTING_SEAL_IDENTITY_MISMATCH');
    }
    return true;
  }
  publishOutermostSprintTerminalArchive({
    projectRoot: input.projectRoot,
    sprintId: input.sprintId,
    receipt: seal.terminalReceipt,
    terminalEvents,
    config: input.opts?.config,
    skipMemoryExport: input.opts?.skipMemoryExport,
  });
  return true;
}

/** Replay or resume an existing seal before any reconcile or journal append. */
function replayExistingTerminalSeal(input: {
  readonly projectRoot: string;
  readonly sprintId: string;
  readonly receipt: SprintTerminalReceiptV1;
  readonly terminalEvents: readonly SprintTerminalDurableEvent[];
  readonly config?: ResolvedConfig;
}): OutermostSprintTerminalArchivePublication | null {
  const archiveDir = resolveSprintArchiveDir(input.projectRoot, input.sprintId);
  const sealPath = join(archiveDir, 'terminal-seal-receipt.json');
  const applicationPath = join(archiveDir, 'terminal-seal-application.json');
  const sealExists = existsSync(sealPath);
  const applicationExists = existsSync(applicationPath);
  if (!sealExists && !applicationExists) return null;
  if (!isSprintArchiveNamespaceSafe(input.projectRoot, input.sprintId)) {
    throw new FinalizerTerminalEvidenceError('SPRINT_ARCHIVE_NAMESPACE_UNSAFE');
  }
  const seal = readJsonSafe<SprintArchiveTerminalSealReceipt>(
    sealPath,
  );
  const application = readJsonSafe<SprintArchiveTerminalApplicationReceipt>(
    applicationPath,
  );
  if (!seal
      || !receiptRecordMatches(seal.terminalReceipt as unknown as Record<string, unknown>, input.receipt)
      || seal.sprintId !== input.sprintId) {
    throw new FinalizerTerminalEvidenceError('SPRINT_ARCHIVE_EXISTING_SEAL_IDENTITY_MISMATCH');
  }
  const expectedProjection = terminalEventsProjectionDigest(input.terminalEvents);
  if (seal.terminalEventsProjectionSha256 !== expectedProjection) {
    throw new FinalizerTerminalEvidenceError('SPRINT_ARCHIVE_TERMINAL_EVENTS_PROJECTION_MISMATCH');
  }
  const expectedPostSealPolicy = postSealPolicyDigest(input.config);
  if (seal.postSealPolicySha256 !== expectedPostSealPolicy) {
    throw new FinalizerTerminalEvidenceError('SPRINT_ARCHIVE_POST_SEAL_POLICY_MISMATCH');
  }

  const hotJournalPath = join(
    input.projectRoot,
    RECENT_WORKS_DIR,
    `${input.sprintId}-events.jsonl`,
  );
  if (application?.state === 'applied') {
    const verification = verifySprintArchiveTerminal(
      input.projectRoot,
      input.sprintId,
      hotJournalPath,
    );
    if (!matchesTerminalVerification(input.sprintId, application, verification)) {
      throw new FinalizerTerminalEvidenceError(
        `SPRINT_ARCHIVE_EXISTING_SEAL_VERIFY_HOLD:${verification.reasonCodes.join('|')}`,
      );
    }
    return {
      seal: {
        disposition: 'idempotent',
        terminalComplete: true,
        receipt: seal,
        applicationReceipt: application,
      },
      verification,
      finalEvent: seal.finalEvent,
    };
  }
  if (application && application.state !== 'staged') {
    throw new FinalizerTerminalEvidenceError('SPRINT_ARCHIVE_EXISTING_APPLICATION_INVALID');
  }

  const resumed = sealSprintArchiveTerminal(input.projectRoot, input.sprintId, {
    receipt: input.receipt,
    finalEvent: seal.finalEvent,
    hotJournalPath,
    expectedArchivedPreimageSha256: seal.expectedArchivedPreimageSha256,
    expectedHotJournalSha256: seal.hotJournalSha256,
    operatorReason: seal.operatorReason,
    adoptBrain: seal.brainAdoptionRequired,
    terminalEventsProjectionSha256: expectedProjection,
    postSealPolicySha256: expectedPostSealPolicy,
  }, configuredMemoryExportRenderOptions(input.config));
  if (!resumed.terminalComplete || !resumed.receipt || resumed.applicationReceipt?.state !== 'applied') {
    throw new FinalizerTerminalEvidenceError(
      `SPRINT_ARCHIVE_EXISTING_SEAL_RESUME_HOLD:${resumed.reasonCode ?? 'unknown'}`,
    );
  }
  const verification = resumed.verification;
  if (!verification
      || !matchesTerminalVerification(input.sprintId, resumed.applicationReceipt, verification)) {
    throw new FinalizerTerminalEvidenceError(
      `SPRINT_ARCHIVE_EXISTING_SEAL_VERIFY_HOLD:${verification?.reasonCodes.join('|') ?? 'missing_same_commit_verification'}`,
    );
  }
  return {
    seal: resumed,
    verification,
    finalEvent: resumed.receipt.finalEvent,
  };
}

function completeOutermostPostSeal(input: {
  readonly projectRoot: string;
  readonly sprintId: string;
  readonly config?: ResolvedConfig;
}, publication: OutermostSprintTerminalArchivePublication): OutermostSprintTerminalArchivePublication {
  const runtimeHygiene = runConfiguredRuntimeHygieneAfterFinalize(
    input.projectRoot,
    input.sprintId,
    input.config,
    { receiptCleanupEligible: true, archiveVerified: true },
  );
  debugLog(
    'publishOutermostSprintTerminalArchive:runtimeHygiene',
    runtimeHygiene.state === 'applied'
      ? `Receipt ${runtimeHygiene.evidence.receiptState} at ${runtimeHygiene.evidence.receiptPath}`
      : `Skipped: ${runtimeHygiene.reason}`,
  );
  cleanupCounters(input.projectRoot, input.sprintId);
  return publication;
}

/**
 * The sole outer lifecycle publisher for terminal archive evidence.
 *
 * Every ingress first finishes its lifecycle authority and cleanup work, then
 * delegates here. This function snapshots all pre-terminal artifacts, appends
 * the final durable lifecycle marker(s), seals that exact journal tail, refreshes
 * the Brain archive projection, verifies the resulting manifest and retires the
 * sequence counter. No caller may write raw sprint evidence after it returns.
 */
export function publishOutermostSprintTerminalArchive(input: {
  readonly projectRoot: string;
  readonly sprintId: string;
  readonly receipt: SprintTerminalReceiptV1;
  readonly terminalEvents: readonly SprintTerminalDurableEvent[];
  readonly config?: ResolvedConfig;
  readonly skipMemoryExport?: boolean;
}): OutermostSprintTerminalArchivePublication {
  let archiveSealed = false;
  try {
    // Natural-path seal observability (2026-08-25): sprint-668 ended COMPLETE
    // with no seal artifact and no error anywhere — entry/exit breadcrumbs make
    // the outermost publication provable from .brain/ERRORS.md like the other
    // finalize steps.
    debugLog('publishOutermostSprintTerminalArchive:enter', `${input.sprintId} events=${input.terminalEvents.length}`);
    if (input.terminalEvents.length === 0) {
      throw new FinalizerTerminalEvidenceError('SPRINT_ARCHIVE_TERMINAL_EVENT_REQUIRED');
    }
    if (!persistedReceiptMatches(input.projectRoot, input.sprintId, input.receipt)) {
      throw new FinalizerTerminalEvidenceError('SPRINT_ARCHIVE_TERMINAL_RECEIPT_MISMATCH');
    }
    if (!isSprintArchiveNamespaceSafe(input.projectRoot, input.sprintId)) {
      throw new FinalizerTerminalEvidenceError('SPRINT_ARCHIVE_NAMESPACE_UNSAFE');
    }
    const archiveDir = resolveSprintArchiveDir(input.projectRoot, input.sprintId);
    archiveSealed = existsSync(join(archiveDir, 'terminal-seal-receipt.json'))
      || existsSync(join(archiveDir, 'terminal-seal-application.json'));
    const replay = replayExistingTerminalSeal(input);
    if (replay) {
      return replay.seal.disposition === 'idempotent'
        ? replay
        : completeOutermostPostSeal(input, replay);
    }

    // Materialize every already-settled artifact before the final journal
    // append. The core seal then repairs only the strict journal prefix and
    // commits the exact terminal snapshot without accepting divergent history.
    const prepared = reconcileSprintArchive(input.projectRoot, input.sprintId, {
      apply: true,
      retireLegacySources: true,
      indexMemory: false,
    });
    if (prepared.failures.length > 0) {
      throw new FinalizerTerminalEvidenceError(
        `SPRINT_ARCHIVE_RECONCILE_FAILED:${prepared.failures.join('|')}`,
      );
    }
    if (prepared.manifest.conflicts.length > 0) {
      throw new FinalizerTerminalEvidenceError(
        `SPRINT_ARCHIVE_RECONCILE_CONFLICT:${prepared.manifest.conflicts.length}`,
      );
    }
    const preparedVerification = verifySprintArchive(input.projectRoot, input.sprintId);
    if (!preparedVerification.ok) {
      throw new FinalizerTerminalEvidenceError(
        `SPRINT_ARCHIVE_VERIFY_FAILED:missing=${preparedVerification.missing.length}:`
        + `mismatched=${preparedVerification.mismatched.length}:untracked=${preparedVerification.untracked.length}`,
      );
    }
    const canonicalJournalPath = join(prepared.archiveDir, `${input.sprintId}-events.jsonl`);
    const expectedArchivedPreimageSha256 = existsSync(canonicalJournalPath)
      ? createHash('sha256').update(readFileSync(canonicalJournalPath)).digest('hex')
      : null;

    let finalEvent: ReturnType<typeof writeEvent> = null;
    for (const terminalEvent of input.terminalEvents) {
      finalEvent = writeEvent(
        input.projectRoot,
        input.sprintId,
        'brain',
        terminalEvent.target ?? '*',
        terminalEvent.channel,
        terminalEvent.payload,
      );
      if (finalEvent === null) {
        throw new FinalizerTerminalEvidenceError(
          `SPRINT_ARCHIVE_TERMINAL_EVENT_WRITE_FAILED:${terminalEvent.channel}`,
        );
      }
    }
    if (finalEvent === null) {
      throw new FinalizerTerminalEvidenceError('SPRINT_ARCHIVE_TERMINAL_EVENT_WRITE_FAILED');
    }

    const finalEventIdentity = {
      sequence: finalEvent.sequence,
      digest: createHash('sha256').update(JSON.stringify(finalEvent)).digest('hex'),
    };
    const hotJournalPath = join(
      input.projectRoot,
      RECENT_WORKS_DIR,
      `${input.sprintId}-events.jsonl`,
    );
    const expectedHotJournalSha256 = createHash('sha256')
      .update(readFileSync(hotJournalPath))
      .digest('hex');
    const seal = sealSprintArchiveTerminal(input.projectRoot, input.sprintId, {
      receipt: input.receipt,
      finalEvent: finalEventIdentity,
      hotJournalPath,
      expectedArchivedPreimageSha256,
      expectedHotJournalSha256,
      operatorReason: `deckent outer lifecycle terminal publication: ${input.receipt.terminalOutcome}`,
      adoptBrain: input.skipMemoryExport !== true,
      terminalEventsProjectionSha256: terminalEventsProjectionDigest(input.terminalEvents),
      postSealPolicySha256: postSealPolicyDigest(input.config),
    }, configuredMemoryExportRenderOptions(input.config));
    // A staged seal receipt is already immutable authority even when its
    // application remains HOLD. Callers must not append a recovery event over
    // that exact final-event identity; retry proceeds through the core repair.
    debugLog('publishOutermostSprintTerminalArchive:sealed', `${input.sprintId} receipt=${seal.receipt !== undefined} terminalComplete=${seal.terminalComplete}`);
    archiveSealed = seal.receipt !== undefined;
    if (!seal.terminalComplete) {
      throw new FinalizerTerminalEvidenceError(
        `SPRINT_ARCHIVE_TERMINAL_SEAL_HOLD:${seal.reasonCode ?? 'unknown'}`,
      );
    }
    archiveSealed = true;

    // The core application receipt binds manifest + optional Brain index and
    // guarded summary digests. Consume the exact verification produced inside
    // that same commit; an immediate detached DB/WAL re-open can observe a
    // checkpoint transition and falsely report brain_adoption_failed. Public
    // and later replay verification remain independent through the path above.
    const verification = seal.verification;
    if (!verification
        || !matchesTerminalVerification(input.sprintId, seal.applicationReceipt, verification)) {
      throw new FinalizerTerminalEvidenceError(
        `SPRINT_ARCHIVE_TERMINAL_VERIFY_FAILED:${verification?.reasonCodes.join('|') ?? 'missing_same_commit_verification'}`,
      );
    }

    return completeOutermostPostSeal(input, { seal, verification, finalEvent: finalEventIdentity });
  } catch (error) {
    if (error instanceof SprintTerminalArchivePublicationError) throw error;
    const reason = error instanceof FinalizerTerminalEvidenceError
      ? error.reasonCode
      : `SPRINT_ARCHIVE_TERMINAL_PUBLICATION_FAILED:${error instanceof Error ? error.message : String(error)}`;
    throw new SprintTerminalArchivePublicationError(reason, archiveSealed, { cause: error });
  }
}

/** RCPT-1: receipt detail bound — enough for any real fix cascade while
 *  keeping the artifact small; the full list stays in terminal evidence. */
const RECEIPT_EXCLUSION_DETAIL_LIMIT = 20;

interface PersistedSprintTerminalReceipt {
  readonly version: 1;
  readonly terminalOutcome: SprintTerminalOutcome;
  readonly publicationState: SprintTerminalPublicationStateV1;
  readonly receipt: SprintTerminalReceiptV1;
  readonly terminalEvidence: Pick<
    SprintTerminalEvidence<TaskResult>,
    | 'version'
    | 'summary'
    | 'cleanupEligibility'
    | 'holds'
    | 'attributionExclusions'
    | 'coordinatorEvidence'
  >;
  readonly logicalProgress: LogicalProgressProjection;
  readonly terminalTruth: FinalizerTerminalTruthCounts;
  readonly lineageUsage: readonly LineageUsageAuthorityAggregate[];
  readonly exactCustodyDigests: readonly FinalizerExactCustodyDigestBundle[];
  readonly writtenAt: string;
}

type PersistedTerminalTask = Record<string, unknown> & {
  readonly id?: unknown;
  readonly terminalProjection?: unknown;
};

function isTaskTerminalProjection(value: unknown): value is TaskTerminalProjection {
  if (value === null || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.logicalTaskId === 'string'
    && Number.isSafeInteger(candidate.generation)
    && (typeof candidate.winnerAttemptId === 'string' || candidate.winnerAttemptId === null)
    && (candidate.terminal === null
      || candidate.terminal === 'DONE'
      || candidate.terminal === 'NO_GO'
      || candidate.terminal === 'ABORTED'
      || candidate.terminal === 'CASCADE_SKIPPED'
      || candidate.terminal === 'NEVER_DISPATCHED')
    && (candidate.status === null
      || candidate.status === 'DONE'
      || candidate.status === 'NO_GO'
      || candidate.status === 'ABORTED')
    && typeof candidate.cascadeSkipped === 'boolean'
    && typeof candidate.neverDispatched === 'boolean';
}

/** Persist CAS-fenced terminal task read models before publishing a sprint receipt. */
export function persistFinalizerTaskTerminalProjections(input: {
  readonly projectRoot: string;
  readonly sprintId: string;
  readonly truth: FinalizerTerminalTruth;
  readonly coordinatorGeneration: number;
  readonly terminalOutcome: SprintTerminalOutcome;
}): void {
  const tasksDir = join(input.projectRoot, TASKS_DIR);
  const locateTaskProjection = (taskId: string): string => {
    const fileName = `task-${taskId}.json`;
    const roots = [tasksDir, ...resolveTaskArtifactReadDirs(input.projectRoot, input.sprintId)];
    for (const root of roots) {
      const pending = [root];
      while (pending.length > 0) {
        const current = pending.pop()!;
        let entries;
        try { entries = readdirSync(current, { withFileTypes: true }); } catch { continue; }
        for (const entry of entries) {
          const path = join(current, entry.name);
          if (entry.isDirectory()) {
            pending.push(path);
          } else if (entry.isFile() && entry.name === fileName) {
            return path;
          }
        }
      }
    }
    // Preserve the historical fail-closed ENOENT/CAS signal when no durable
    // task authority exists anywhere. The finalizer must never synthesize a
    // projection from its in-memory Sprint argument alone.
    return join(tasksDir, fileName);
  };
  const targets = [...input.truth.terminalEvidence.logicalTasks]
    .sort((left, right) => left.logicalTaskId.localeCompare(right.logicalTaskId))
    .flatMap(logicalTask => logicalTask.attempts.map(identity => {
      const path = locateTaskProjection(identity.taskId);
      return {
        logicalTask,
        identity,
        path,
        lockPath: join(dirname(path), `task-${identity.taskId}.terminal-projection.lock`),
      };
    })).sort((left, right) => left.path.localeCompare(right.path));
  const locks: Array<{ readonly path: string; readonly fd: number }> = [];

  try {
    // Acquire the complete sorted fence set before the first replacement.
    for (const target of targets) {
      try {
        locks.push({ path: target.lockPath, fd: openSync(target.lockPath, 'wx', 0o600) });
      } catch (cause) {
        throw new FinalizerTerminalEvidenceError(
          `TASK_TERMINAL_PROJECTION_CAS_HOLD:${target.identity.taskId}:${(cause as NodeJS.ErrnoException).code ?? 'LOCK_FAILED'}`,
        );
      }
    }

    for (const target of targets) {
      let task: PersistedTerminalTask;
      try {
        task = JSON.parse(readFileSync(target.path, 'utf-8')) as PersistedTerminalTask;
      } catch (cause) {
        throw new FinalizerTerminalEvidenceError(
          `TASK_TERMINAL_PROJECTION_READ_HOLD:${target.identity.taskId}:${cause instanceof Error ? cause.message : String(cause)}`,
        );
      }
      if (task.id !== target.identity.taskId) {
        throw new FinalizerTerminalEvidenceError(
          `TASK_TERMINAL_PROJECTION_IDENTITY_HOLD:${target.identity.taskId}`,
        );
      }

      const winnerAttemptId = target.logicalTask.resolvingAttempt?.attemptId ?? null;
      const current = task.terminalProjection === undefined
        ? createTaskTerminalProjection({
            logicalTaskId: target.logicalTask.logicalTaskId,
            generation: input.coordinatorGeneration,
            winnerAttemptId,
          })
        : isTaskTerminalProjection(task.terminalProjection)
          ? task.terminalProjection
          : (() => { throw new FinalizerTerminalEvidenceError(
              `TASK_TERMINAL_PROJECTION_MALFORMED_HOLD:${target.identity.taskId}`,
            ); })();
      const cascadeSkipped = input.truth.attempts.some(attempt =>
        attempt.identity.taskId === target.identity.taskId
        && (attempt.result.state === 'COMPLETE' || attempt.result.state === 'PARTIAL')
        && attempt.result.payload?.cascadeSkipped === true);
      // Task-terminal generation is fixed by the first durable projection. A
      // restarted recovery coordinator may legitimately publish the OUTER run
      // receipt at a later generation; that must not relabel already-terminal
      // task truth or mistake the recovery checkpoint number for a task CAS.
      // Exact logical-task/winner/terminal checks below still fail closed.
      const taskGeneration = input.terminalOutcome === 'ABORTED'
        ? current.generation
        : input.coordinatorGeneration;
      const evidence: TaskTerminalEvidence = cascadeSkipped
          ? { kind: 'gate-terminal', logicalTaskId: target.logicalTask.logicalTaskId,
              generation: taskGeneration, attemptId: winnerAttemptId, outcome: 'CASCADE_SKIPPED' }
          : target.logicalTask.state === 'COMPLETED' && winnerAttemptId !== null
            ? { kind: 'attempt-result', logicalTaskId: target.logicalTask.logicalTaskId,
                generation: taskGeneration, attemptId: winnerAttemptId, outcome: 'DONE' }
          : target.logicalTask.state === 'FAILED' && winnerAttemptId !== null
            ? { kind: 'attempt-result', logicalTaskId: target.logicalTask.logicalTaskId,
                generation: taskGeneration, attemptId: winnerAttemptId, outcome: 'NO_GO' }
          : input.terminalOutcome === 'ABORTED'
            ? { kind: 'gate-terminal', logicalTaskId: target.logicalTask.logicalTaskId,
                generation: taskGeneration, attemptId: null, outcome: 'ABORTED' }
          : winnerAttemptId === null
            ? { kind: 'gate-terminal', logicalTaskId: target.logicalTask.logicalTaskId,
                generation: taskGeneration, attemptId: null, outcome: 'NEVER_DISPATCHED' }
            : { kind: 'attempt-result', logicalTaskId: target.logicalTask.logicalTaskId,
                generation: taskGeneration, attemptId: winnerAttemptId,
                outcome: target.logicalTask.state === 'COMPLETED' ? 'DONE' : 'NO_GO' };
      const reduced = reduceTaskTerminalProjection(current, evidence);
      if (reduced.decision === 'hold') {
        throw new FinalizerTerminalEvidenceError(
          `TASK_TERMINAL_PROJECTION_${reduced.reasonCode.toUpperCase().replaceAll('-', '_')}_HOLD:${target.identity.taskId}`,
        );
      }
      const projected = {
        ...task,
        status: reduced.projection.status,
        cascadeSkipped: reduced.projection.cascadeSkipped,
        neverDispatched: reduced.projection.neverDispatched,
        terminalProjection: reduced.projection,
      };
      const tempPath = `${target.path}.terminal-${process.pid}-${randomUUID()}.tmp`;
      const fd = openSync(tempPath, 'wx', 0o600);
      try {
        writeFileSync(fd, JSON.stringify(projected, null, 2) + '\n', 'utf-8');
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
      renameSync(tempPath, target.path);
    }
    for (const directory of new Set(targets.map(target => dirname(target.path)))) {
      const dirFd = openSync(directory, 'r');
      try { fsyncSync(dirFd); } finally { closeSync(dirFd); }
    }
  } finally {
    for (const lock of locks.reverse()) {
      try { closeSync(lock.fd); } catch { /* best-effort descriptor retirement */ }
      try { unlinkSync(lock.path); } catch { /* projection failure remains a HOLD */ }
    }
  }
}

function canonicalJson(value: unknown): string {
  const normalize = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(normalize);
    if (item !== null && typeof item === 'object') {
      return Object.fromEntries(Object.entries(item as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, normalize(nested)]));
    }
    return item;
  };
  return JSON.stringify(normalize(value));
}

function sha256EvidenceRef(kind: string, value: unknown): string {
  return `${kind}:sha256:${createHash('sha256').update(canonicalJson(value)).digest('hex')}`;
}

function finiteNonNegative(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
}

function finiteCoverage(value: unknown): number {
  return Math.min(100, finiteNonNegative(value));
}

function asTerminalVerdict(
  evaluation: TaskEvaluation | undefined,
): 'DONE' | 'GO_WITH_TECH_DEBT' | 'NO_GO' | null {
  if (evaluation === TaskEvaluation.DONE
    || evaluation === TaskEvaluation.GO_WITH_TECH_DEBT
    || evaluation === TaskEvaluation.NO_GO) return evaluation;
  return null;
}

function requiresExactTerminalAuthority(result: TaskResult | undefined): boolean {
  if (!result || typeof result !== 'object') return false;
  return Object.prototype.hasOwnProperty.call(result, 'exactAcceptedResultAuthority')
    || (result as TaskResult & { exactCustodyTerminalAuthorityRequired?: unknown })
      .exactCustodyTerminalAuthorityRequired === true;
}

/**
 * Merge PLAN-time roots with runtime-born FIX/FIX-FIX task artifacts. FIX
 * attempts are intentionally not appended to `sprint.tasks`; final settlement
 * therefore reloads the exact same-sprint task JSONs before lineage folding.
 */
/**
 * Host-owned tenant/run identity for provider execution observations. Derived
 * exactly like the spawn-time settlement reference's `projectRootSha256`, which
 * is what the spawn site binds as the observation `runId` — so a settling
 * generation can only ever match intervals from its own project/tenant.
 */
export function resolveProviderExecutionObservationRunId(projectRoot: string): string {
  return createHash('sha256').update(canonicalProjectRoot(projectRoot)).digest('hex');
}

/**
 * Close the provider execution intervals owned by the exact attempt generation
 * being settled, with a typed retirement reason. Left open, they survive
 * cleanup as `unresolved-provider-observation` evidence and hold an unrelated
 * IDLE or next run (row 3296). Foreign and historical intervals are untouched
 * forensic evidence — nothing is deleted and closure is never inferred.
 *
 * Returns null when no observation authority exists: settlement never creates
 * a provider observation store, and a generation with no exact attempt identity
 * owns nothing to reconcile.
 */
export function reconcileSettledProviderExecutionObservations(input: {
  readonly projectRoot: string;
  readonly attempts: readonly ExactAttemptIdentity[];
  readonly reason: ProviderExecutionIntervalRetirementReason;
  readonly dbPath?: string;
}): ProviderExecutionGenerationReconciliation | null {
  const dbPath = input.dbPath
    ?? join(input.projectRoot, PROVIDER_EXECUTION_OBSERVATION_DATABASE_PATH);
  if (!existsSync(dbPath)) return null;
  const attempts = input.attempts.filter(
    attempt => attempt.taskId.trim() !== '' && attempt.attemptId.trim() !== '',
  );
  if (attempts.length === 0) return null;
  const store = new ProviderExecutionObservationStore(input.projectRoot, { dbPath });
  try {
    return store.reconcileGenerationRetirement({
      runId: resolveProviderExecutionObservationRunId(input.projectRoot),
      attempts,
      reason: input.reason,
    });
  } finally {
    store.close();
  }
}

/** Reconcile only the terminal truth's exact owned attempts, or fail the terminal boundary closed. */
function retireTerminalProviderExecutionObservations(
  projectRoot: string,
  terminalTruth: FinalizerTerminalTruth,
  source: 'finalizeSprint' | 'forceAbortSprint',
): void {
  try {
    const reconciliation = reconcileSettledProviderExecutionObservations({
      projectRoot,
      attempts: terminalTruth.attempts.map(attempt => attempt.identity),
      reason: 'run-generation-settled',
    });
    debugLog(`${source}:providerObservationRetirement`, reconciliation === null
      ? 'No provider execution observation authority — nothing to reconcile'
      : `Retired ${reconciliation.retired.length} owned interval(s) `
        + `(reason=${reconciliation.reason}, foreignOpen=${reconciliation.foreignOpenIntervals})`);
  } catch (e) {
    throw new FinalizerTerminalEvidenceError(
      `PROVIDER_EXECUTION_OBSERVATION_RETIREMENT_FAILED:${e instanceof Error ? e.message : String(e)}`,
    );
  }
}

export function loadFinalizerAttemptTasks(
  projectRoot: string,
  sprint: Sprint,
): readonly Task[] {
  const byId = new Map(sprint.tasks.map(task => [task.id, task]));
  const tasksDir = join(projectRoot, TASKS_DIR);
  // Task ids/files carry the sprint ID's padded segment (`001-001`); the numeric
  // `sprint.number` (`1`) never matches for sprints < 100, which silently blinded
  // attempt-task discovery on fresh installs (PROD-SPRINT-PREFIX-PAD-001).
  const sprintIdSegment = sprint.id.replace(/^sprint-/, '');
  const prefix = `task-${sprintIdSegment}-`;

  // Live projection has precedence; every canonical/legacy archive root is a
  // fallback. This closes the recovery ordering hole where task artifacts were
  // settled before force-finalize rebuilt whole-run truth.
  const roots = [
    ...(existsSync(tasksDir) ? [tasksDir] : []),
    ...resolveTaskArtifactReadDirs(projectRoot, sprint.id),
  ];
  const seenPaths = new Set<string>();
  const diskTaskIds = new Set<string>();
  for (const root of roots) {
    const pending = [root];
    while (pending.length > 0) {
      const current = pending.pop()!;
      let entries;
      try { entries = readdirSync(current, { withFileTypes: true }); } catch (error) {
        debugLog('loadFinalizerAttemptTasks:read', error);
        continue;
      }
      for (const entry of entries) {
        const path = join(current, entry.name);
        if (entry.isDirectory()) {
          pending.push(path);
          continue;
        }
        if (!entry.isFile() || !entry.name.startsWith(prefix) || !entry.name.endsWith('.json')) continue;
        if (seenPaths.has(path)) continue;
        seenPaths.add(path);
        const candidate = readJsonSafe<Task>(path);
        if (
          !candidate
          || typeof candidate.id !== 'string'
          || !candidate.id.startsWith(`${sprintIdSegment}-`)
          || (candidate.sprintId !== undefined && candidate.sprintId !== sprint.id)
        ) continue;
        // The first root wins, so live state cannot be overwritten by an older
        // legacy archive projection.
        if (!diskTaskIds.has(candidate.id)) {
          byId.set(candidate.id, candidate);
          diskTaskIds.add(candidate.id);
        }
      }
    }
  }
  return [...byId.values()].sort((left, right) => left.id.localeCompare(right.id));
}

function lineageBillingAuthority(
  task: Task,
  rootResult: TaskResult | undefined,
  defaultAuthMode: 'subscription' | 'api' | 'hybrid' | undefined,
): LineageBillingAuthority {
  const effectiveAuthMode = task.authMode ?? defaultAuthMode;
  if (effectiveAuthMode === 'hybrid') return 'hybrid';
  const mode = resolveBillingModeForAuth(task.provider, effectiveAuthMode)
    ?? rootResult?.cost?.billingMode;
  if (mode === 'api') return 'metered';
  if (mode === 'subscription') return 'subscription';
  if (mode === 'local') return 'local';
  if (mode === 'free_tier') return 'free-tier';
  return 'unknown';
}

function terminalAttemptEvidence(
  tasks: readonly Task[],
  evaluations: ReadonlyMap<string, TaskEvaluation>,
  results: readonly TaskResult[],
  notDispatchedSettlements: ReadonlyMap<string, NotDispatchedSettlement>,
  exactTerminalAuthorities: ReadonlyMap<string, ExactAcceptedTaskTerminalAuthorityRead>,
): readonly ExactAttemptEvidence<TaskResult>[] {
  const tasksById = new Map(tasks.map(task => [task.id, task]));
  const resultsById = new Map(results.map(result => [result.taskId, result]));
  const candidateIds = new Set<string>([
    ...tasks.map(task => task.id),
    ...evaluations.keys(),
    ...results.map(result => result.taskId),
    ...exactTerminalAuthorities.keys(),
  ]);
  const identityFor = (taskId: string): ExactAttemptIdentity => {
    const exactTerminal = exactTerminalAuthorities.get(taskId);
    if (exactTerminal?.state === 'current') {
      return {
        taskId,
        attemptId: exactTerminal.terminalAuthority.acceptedAuthority.identity.attemptId,
      };
    }
    const result = resultsById.get(taskId);
    const work = projectAttributedTaskWork(result);
    const preDispatchSettlement = resolveHostPreDispatchSettlement(result);
    const settlement = notDispatchedSettlements.get(taskId);
    return {
      taskId,
      attemptId: work.attemptId
        ?? preDispatchSettlement?.attemptId
        // Host-authored cascade-skip synthetics carry a host identity — the
        // dependent never had a worker attempt, and empty-string identity is
        // an INVALID_IDENTITY publication hold (3301 r9 kanıtı, 2026-08-27).
        ?? (result?.cascadeSkipped === true ? `host:cascade-skip:${taskId}` : undefined)
        ?? (settlement && settlement.state !== 'RESUMABLE' ? `host:${settlement.reasonCode}` : ''),
    };
  };

  return [...candidateIds].sort().map(taskId => {
    const task = tasksById.get(taskId);
    const exactTerminal = exactTerminalAuthorities.get(taskId);
    const publicResult = resultsById.get(taskId);
    const result = exactTerminal?.state === 'current'
      ? exactTerminal.projectedResult
      : publicResult;
    const exactAuthorityMissing = exactTerminal === undefined
      && requiresExactTerminalAuthority(publicResult);
    const evaluation = exactTerminal?.state === 'current'
      ? exactTerminal.evaluationReceipt.verdict as TaskEvaluation
      : evaluations.get(taskId);
    const verdict = asTerminalVerdict(evaluation);
    const identity = identityFor(taskId);
    const work = projectAttributedTaskWork(result);
    const notDispatchedSettlement = notDispatchedSettlements.get(taskId);
    const preDispatchSettlement = resolveHostPreDispatchSettlement(result);
    const projectedTerminalNotDispatched = evaluation === TaskEvaluation.NOT_DISPATCHED
      && notDispatchedSettlement !== undefined
      && notDispatchedSettlement.state !== 'RESUMABLE';
    const hostTerminalNotDispatched = preDispatchSettlement !== null
      || projectedTerminalNotDispatched;
    const hostTerminalReasonCode = preDispatchSettlement?.reasonCode
      ?? notDispatchedSettlement?.reasonCode
      ?? 'HOST_PRE_DISPATCH_REJECTION';
    const hostTerminalEvidenceRef = preDispatchSettlement?.evidenceRef;
    const parentId = task?.fixForTaskId;
    const supersedes = parentId && tasksById.has(parentId) ? identityFor(parentId) : null;

    const authority: ExactAttemptEvidence<TaskResult>['authority'] = exactAuthorityMissing
      ? { state: 'UNKNOWN', reasonCode: 'EXACT_TERMINAL_AUTHORITY_REQUIRED' }
      : exactTerminal?.state === 'hold'
      ? { state: 'UNKNOWN', reasonCode: `EXACT_TERMINAL_AUTHORITY_HOLD:${exactTerminal.reasonCode}` }
      : exactTerminal?.state === 'current'
      ? {
          state: 'TERMINAL',
          verdict: exactTerminal.evaluationReceipt.verdict,
          evidenceRef: sha256EvidenceRef(
            'exact-terminal-authority',
            exactTerminal.terminalAuthority,
          ),
        }
      : hostTerminalNotDispatched
      ? {
          state: 'TERMINAL',
          verdict: 'NO_GO',
          reasonCode: hostTerminalReasonCode,
          hostTerminalNotDispatched: true,
          evidenceRef: hostTerminalEvidenceRef ?? sha256EvidenceRef('not-dispatched-settlement', {
            identity,
            settlement: notDispatchedSettlement,
          }),
        }
      : verdict
      ? {
          state: 'TERMINAL',
          verdict,
          evidenceRef: sha256EvidenceRef('evaluation', { identity, verdict }),
        }
      : evaluation === undefined
        ? { state: 'UNKNOWN', reasonCode: 'FINAL_EVALUATION_UNAVAILABLE' }
        : { state: 'UNSETTLED', evidenceRef: sha256EvidenceRef('evaluation', { identity, evaluation }) };
    const resultEvidence: ExactAttemptEvidence<TaskResult>['result'] = exactAuthorityMissing
      ? result
        ? {
            state: 'PARTIAL',
            payload: result,
            evidenceRef: sha256EvidenceRef('unsettled-exact-result', result),
            reasonCode: 'EXACT_TERMINAL_AUTHORITY_REQUIRED',
          }
        : { state: 'ABSENT' }
      : exactTerminal?.state === 'hold'
      ? result
        ? {
            state: 'PARTIAL',
            payload: result,
            evidenceRef: sha256EvidenceRef('untrusted-exact-result', result),
            reasonCode: `EXACT_TERMINAL_AUTHORITY_HOLD:${exactTerminal.reasonCode}`,
          }
        : { state: 'ABSENT' }
      : exactTerminal?.state === 'current'
      ? {
          state: 'COMPLETE',
          verdict: exactTerminal.evaluationReceipt.verdict,
          evidenceRef: `exact-settled-result:${exactTerminal.terminalResultAuthority.settlementDigest}`,
          payload: exactTerminal.projectedResult,
        }
      : hostTerminalNotDispatched
      ? {
          state: 'NOT_APPLICABLE',
          reasonCode: hostTerminalReasonCode,
          evidenceRef: hostTerminalEvidenceRef ?? sha256EvidenceRef('not-dispatched-zero-work', {
            identity,
            settlement: notDispatchedSettlement,
          }),
        }
      : !result
      ? { state: 'ABSENT' }
      : verdict
        ? {
            state: 'COMPLETE',
            verdict,
            evidenceRef: sha256EvidenceRef('task-result', result),
            payload: result,
          }
        : {
            state: 'PARTIAL',
            evidenceRef: sha256EvidenceRef('task-result', result),
            payload: result,
            reasonCode: 'FINAL_EVALUATION_UNAVAILABLE',
          };
    const attribution: ExactAttemptEvidence<TaskResult>['attribution'] = exactAuthorityMissing
      ? { state: 'HOLD', reasonCode: 'EXACT_TERMINAL_AUTHORITY_REQUIRED' }
      : exactTerminal?.state === 'hold'
      ? {
          state: 'HOLD',
          reasonCode: `EXACT_TERMINAL_AUTHORITY_HOLD:${exactTerminal.reasonCode}`,
        }
      : hostTerminalNotDispatched
      ? {
          state: 'VERIFIED',
          evidenceRef: hostTerminalEvidenceRef ?? sha256EvidenceRef('not-dispatched-zero-work-attribution', {
            identity,
            settlement: notDispatchedSettlement,
          }),
          filesChanged: [],
          linesAdded: 0,
          linesRemoved: 0,
        }
      : work.state === 'VERIFIED'
      ? {
          state: 'VERIFIED',
          evidenceRef: sha256EvidenceRef('work-attribution', result?.workAttribution),
          filesChanged: work.filesChanged,
          linesAdded: work.linesAdded,
          linesRemoved: work.linesRemoved,
        }
      : {
          state: work.state,
          reasonCode: work.reasonCode ?? 'ATTRIBUTION_AUTHORITY_UNAVAILABLE',
          // RCPT-1: carry the attempt's KNOWN claims so resolution-aware
          // cleanup eligibility can decide; a held attribution's claim set is
          // the out-of-scope list (the honest-gate's own evidence) unioned
          // with whatever the result itself claims to have changed. Unknown
          // claims (no result / no lists) stay absent → eligibility fails
          // closed for that exclusion.
          ...(result?.workAttribution?.claimedOutsideScope !== undefined
            || (result?.filesChanged?.length ?? 0) > 0
            ? {
                claimedPaths: [...new Set([
                  ...(result?.workAttribution?.claimedOutsideScope ?? []),
                  ...(result?.filesChanged ?? []),
                ].filter(Boolean))].sort(),
              }
            : {}),
        };

    return {
      logicalTaskId: task
        ? resolveTaskLineageRootId(task, tasksById)
        : taskId,
      identity,
      ...(supersedes ? { supersedes } : {}),
      authority,
      result: resultEvidence,
      attribution,
      // RCPT-1 supp: the declared write scope joins terminal evidence so a
      // COMPLETED lineage's resolver can attest its paths (see the coverage
      // union in sprint-terminal-evidence.ts).
      ...(task?.scope?.filesWrite !== undefined
        ? { writeScope: [...task.scope.filesWrite] }
        : {}),
    };
  });
}

function buildLineageUsage(
  tasks: readonly Task[],
  results: readonly TaskResult[],
  attempts: readonly ExactAttemptEvidence<TaskResult>[],
  defaultAuthMode: 'subscription' | 'api' | 'hybrid' | undefined,
): readonly LineageUsageAuthorityAggregate[] {
  const tasksById = new Map(tasks.map(task => [task.id, task]));
  const resultsById = new Map(results.map(result => [result.taskId, result]));
  const roots = [...new Set(attempts.map(attempt => attempt.logicalTaskId))].sort();
  const authorityTasks = roots.map(id => {
    const task = tasksById.get(id);
    return {
      id,
      billingAuthority: task
        ? lineageBillingAuthority(task, resultsById.get(id), defaultAuthMode)
        : 'unknown' as const,
    };
  });
  const usageAttempts = attempts.map(attempt => {
    const result = attempt.result.state === 'COMPLETE' || attempt.result.state === 'PARTIAL'
      ? attempt.result.payload
      : undefined;
    const usage = result?.tokenUsage;
    const referenceCostUsd = finiteNonNegative(
      result?.cost?.referenceUsd ?? result?.cost?.usd ?? estimateResultCost(usage),
    );
    const rootTask = tasksById.get(attempt.logicalTaskId);
    const billingAuthority = rootTask
      ? lineageBillingAuthority(rootTask, resultsById.get(rootTask.id), defaultAuthMode)
      : 'unknown';
    const invoicedCost = billingAuthority === 'metered'
      && result?.cost
      && !result.cost.pricingSource.startsWith('unknown-model:')
      && !result.cost.pricingSource.startsWith('unknown-billing:')
      && !result.cost.pricingSource.startsWith('unverified-api-reference:')
      ? finiteNonNegative(result.cost.usd)
      : undefined;
    return {
      id: attempt.identity.attemptId,
      taskId: attempt.identity.taskId,
      ...(attempt.supersedes ? { fixForTaskId: attempt.supersedes.taskId } : {}),
      logicalRootTaskId: attempt.logicalTaskId,
      inputTokens: finiteNonNegative(usage?.inputTokens),
      outputTokens: finiteNonNegative(usage?.outputTokens),
      cacheReadTokens: finiteNonNegative(usage?.cacheReadTokens),
      cacheCreationTokens: finiteNonNegative(usage?.cacheCreationTokens),
      referenceCostUsd,
      ...(invoicedCost !== undefined ? { invoicedCostUsd: invoicedCost } : {}),
    };
  });
  return aggregateLineageUsageAuthority({ tasks: authorityTasks, attempts: usageAttempts });
}

function usageTotalsFromLineages(
  lineageUsage: readonly LineageUsageAuthorityAggregate[],
): UsageTotals {
  return lineageUsage.reduce<UsageTotals>((total, lineage) => ({
    inputTokens: total.inputTokens + lineage.tokenUsage.inputTokens,
    outputTokens: total.outputTokens + lineage.tokenUsage.outputTokens,
    cacheRead: total.cacheRead + lineage.tokenUsage.cacheReadTokens,
    costUsd: total.costUsd + (lineage.billedUsd.state === 'known' ? lineage.billedUsd.usd : 0),
    referenceCostUsd: (total.referenceCostUsd ?? 0) + lineage.referenceCostUsd,
    unknownBillingTaskCount: (total.unknownBillingTaskCount ?? 0)
      + (lineage.billedUsd.state === 'unknown' ? 1 : 0),
  }), {
    inputTokens: 0,
    outputTokens: 0,
    cacheRead: 0,
    costUsd: 0,
    referenceCostUsd: 0,
    unknownBillingTaskCount: 0,
  });
}

/**
 * RUN-POLICY-DELIVERY-001 (correction-2): terminal-convergence parity veto.
 *
 * Every finalize ingress — standard finalize, test-mode receipt, CLI
 * `deckent finalize`, completed-checkpoint recovery — converges on
 * {@link buildFinalizerTerminalTruth}, and each builds its `evaluations` map
 * from a different source (live Brain verdicts, archived results'
 * `evaluationDecision`, checkpoint snapshots, worker `selfAssessment`
 * projections). A task that CARRIES a run policy may therefore arrive here
 * claiming DONE/GO_WITH_TECH_DEBT without ever passing the evaluator's parity
 * gate. This input veto closes that class at the single convergence point:
 * a completion claim with missing, mismatched or tampered policy evidence is
 * downgraded to a typed NO_GO before any terminal truth is assembled. Tasks
 * without a policy and claims with exact evidence pass through untouched, so
 * policy-free and normal/FIX behavior is byte-preserved.
 */
function enforceRunPolicyParityOnTerminalInputs(
  tasks: readonly Task[],
  evaluations: ReadonlyMap<string, TaskEvaluation>,
  results: readonly TaskResult[],
  exactTerminalAuthorities: ReadonlyMap<string, ExactAcceptedTaskTerminalAuthorityRead>,
): ReadonlyMap<string, TaskEvaluation> {
  let vetoed: Map<string, TaskEvaluation> | null = null;
  const resultsById = new Map(results.map(result => [result.taskId, result]));
  for (const task of tasks) {
    if (exactTerminalAuthorities.get(task.id)?.state === 'current') continue;
    if (!task.runPolicy) continue;
    const evaluation = evaluations.get(task.id);
    if (evaluation !== TaskEvaluation.DONE && evaluation !== TaskEvaluation.GO_WITH_TECH_DEBT) {
      continue;
    }
    const workerEvidence = resultsById.get(task.id)?.runPolicyEvidence;
    const settlement = settleRunPolicyResultEvidence({
      plan: task.runPolicy,
      ...(workerEvidence !== undefined ? { workerEvidence } : {}),
    });
    if (settlement.state !== 'POLICY_PARITY') {
      (vetoed ??= new Map(evaluations)).set(task.id, TaskEvaluation.NO_GO);
      debugLog(
        'finalizer:run-policy-parity-veto',
        `${task.id}: ${evaluation} → NO_GO (${settlement.reason})`,
      );
    }
  }
  return vetoed ?? evaluations;
}

function projectExactCustodyDigestBundles(
  authorities: ReadonlyMap<string, ExactAcceptedTaskTerminalAuthorityRead>,
): readonly FinalizerExactCustodyDigestBundle[] {
  return [...authorities.entries()]
    .filter((entry): entry is [
      string,
      Extract<ExactAcceptedTaskTerminalAuthorityRead, { readonly state: 'current' }>,
    ] => entry[1].state === 'current')
    .map(([taskId, authority]) => {
      const accepted = authority.terminalAuthority.acceptedAuthority;
      const terminal = authority.terminalResultAuthority;
      return Object.freeze({
        taskId,
        attemptId: accepted.identity.attemptId,
        generation: accepted.identity.generation,
        admissionReceiptDigest: accepted.admissionReceiptDigest,
        acceptedResultArtifactReceiptDigest: accepted.acceptedResultRef.artifactReceiptDigest,
        acceptedResultChainDigest: accepted.acceptedResultChainDigest,
        resultDigest: accepted.resultDigest,
        evaluationArtifactReceiptDigest: terminal.evaluationArtifact.artifactReceiptDigest,
        evaluationChainDigest: terminal.evaluationChainDigest,
        evaluationReceiptDigest: authority.evaluationReceipt.receiptDigest,
        finalizerArtifactReceiptDigest: terminal.finalizerArtifact.artifactReceiptDigest,
        finalizerChainDigest: terminal.finalizerChainDigest,
        finalizerReceiptDigest: authority.finalizerReceipt.receiptDigest,
        settlementArtifactReceiptDigest: terminal.settlementRef.artifactReceiptDigest,
        settlementDigest: terminal.settlementDigest,
      });
    })
    .sort((left, right) => left.taskId.localeCompare(right.taskId)
      || left.attemptId.localeCompare(right.attemptId)
      || left.generation - right.generation);
}

function projectFinalizerAuthoritativeInputs(
  truth: FinalizerTerminalTruth,
): {
  readonly results: TaskResult[];
  readonly evaluations: Map<string, TaskEvaluation>;
} {
  const results: TaskResult[] = [];
  const evaluations = new Map<string, TaskEvaluation>();
  for (const attempt of truth.attempts) {
    if (attempt.authority.state !== 'TERMINAL') continue;
    evaluations.set(attempt.identity.taskId, attempt.authority.verdict as TaskEvaluation);
    if (attempt.result.state === 'COMPLETE') {
      results.push(attempt.result.payload);
    }
  }
  return { results, evaluations };
}

export function buildFinalizerTerminalTruth(input: {
  readonly tasks: readonly Task[];
  readonly evaluations: ReadonlyMap<string, TaskEvaluation>;
  readonly results: readonly TaskResult[];
  readonly defaultAuthMode?: 'subscription' | 'api' | 'hybrid';
  readonly coordinatorEvidence?: readonly CoordinatorTerminalEvidence[];
  readonly notDispatchedSettlements?: ReadonlyMap<string, NotDispatchedSettlement>;
  readonly exactTerminalAuthorities?: ReadonlyMap<string, ExactAcceptedTaskTerminalAuthorityRead>;
}): FinalizerTerminalTruth {
  const exactTerminalAuthorities = new Map<string, ExactAcceptedTaskTerminalAuthorityRead>();
  const plannedTaskIds = new Set(input.tasks.map(task => task.id));
  for (const [taskId, authority] of input.exactTerminalAuthorities ?? new Map()) {
    exactTerminalAuthorities.set(
      taskId,
      !plannedTaskIds.has(taskId)
        ? { state: 'hold', reasonCode: 'terminal-authority-task-unplanned' }
        : authority.state === 'current'
        && !isCurrentExactAcceptedTaskTerminalAuthorityRead(
          taskId,
          authority.terminalAuthority,
          authority,
        )
        ? { state: 'hold', reasonCode: 'terminal-authority-read-invalid' }
        : authority,
    );
  }
  const authorityResultsByTaskId = new Map(
    input.results.map(result => [result.taskId, result]),
  );
  for (const [taskId, authority] of exactTerminalAuthorities) {
    if (authority.state === 'current') {
      authorityResultsByTaskId.set(taskId, authority.projectedResult);
    }
  }
  const authorityResults = [...authorityResultsByTaskId.values()];
  const evaluations = enforceRunPolicyParityOnTerminalInputs(
    input.tasks,
    input.evaluations,
    authorityResults,
    exactTerminalAuthorities,
  );
  const attempts = terminalAttemptEvidence(
    input.tasks,
    evaluations,
    authorityResults,
    input.notDispatchedSettlements ?? new Map(),
    exactTerminalAuthorities,
  );
  const terminalEvidence = assembleSprintTerminalEvidence({
    attempts,
    coordinatorEvidence: input.coordinatorEvidence ?? [],
  });
  const roots = new Set(attempts.map(attempt => attempt.logicalTaskId));
  const progressResult = projectLogicalProgress({
    attempts: attempts.map(attempt => ({
      id: attempt.identity.taskId,
      logicalTaskId: attempt.logicalTaskId,
      status: attempt.authority.state === 'TERMINAL'
        ? attempt.authority.verdict === 'NO_GO' ? 'blocked' : 'done'
        : 'active',
      ...(attempt.supersedes
        ? { fixForAttemptId: attempt.supersedes.taskId }
        : {}),
    })),
    denominator: { kind: 'logical-task', total: roots.size },
  });
  if (!progressResult.ok) {
    throw new FinalizerTerminalEvidenceError(progressResult.diagnostic);
  }

  const resultsByTaskId = new Map(authorityResults.map(result => [result.taskId, result]));
  const currentCoverage = terminalEvidence.logicalTasks.reduce((sum, logicalTask) => {
    const taskId = logicalTask.resolvingAttempt?.taskId
      ?? logicalTask.attempts.at(-1)?.taskId;
    return sum + finiteCoverage(taskId ? resultsByTaskId.get(taskId)?.coverage : undefined);
  }, 0);
  const coveragePercent = progressResult.projection.total > 0
    ? currentCoverage / progressResult.projection.total
    : 0;
  const logicalEvaluations = new Map<string, TaskEvaluation>();
  for (const logicalTask of terminalEvidence.logicalTasks) {
    if (logicalTask.state === 'COMPLETED') {
      const completed = terminalEvidence.completed.find(
        item => item.logicalTaskId === logicalTask.logicalTaskId,
      );
      logicalEvaluations.set(
        logicalTask.logicalTaskId,
        completed?.verdict === 'GO_WITH_TECH_DEBT'
          ? TaskEvaluation.GO_WITH_TECH_DEBT
          : TaskEvaluation.DONE,
      );
    } else if (logicalTask.state === 'FAILED') {
      logicalEvaluations.set(logicalTask.logicalTaskId, TaskEvaluation.NO_GO);
    }
  }
  const techDebtTasks = [...logicalEvaluations.values()]
    .filter(value => value === TaskEvaluation.GO_WITH_TECH_DEBT).length;
  const lineageUsage = buildLineageUsage(
    input.tasks,
    authorityResults,
    attempts,
    input.defaultAuthMode,
  );
  const usageTotals = usageTotalsFromLineages(lineageUsage);
  const exactCustodyDigests = projectExactCustodyDigestBundles(exactTerminalAuthorities);
  const logicalMetrics: FinalizerLogicalMetrics = {
    totalTasks: progressResult.projection.total,
    completedTasks: progressResult.projection.done,
    techDebtTasks,
    noGoTasks: progressResult.projection.blocked,
    unevaluatedTasks: progressResult.projection.active,
    coveragePercent: Number.isFinite(coveragePercent) ? coveragePercent : 0,
  };
  const lineageIdsFor = (
    evidenceState: SprintTerminalEvidence<TaskResult>['settledAttempts'][number]['evidenceState'],
  ): Set<string> => new Set(terminalEvidence.settledAttempts
    .filter(attempt => attempt.evidenceState === evidenceState)
    .map(attempt => attempt.logicalTaskId));
  const terminalTruth: FinalizerTerminalTruthCounts = {
    completedLineages: new Set(
      terminalEvidence.completed.map(lineage => lineage.logicalTaskId),
    ).size,
    policySkippedLineages: lineageIdsFor('HOST_TERMINAL_NOT_DISPATCHED').size,
    cascadeSkippedLineages: lineageIdsFor('CASCADE_SKIP').size,
  };
  const logicalSettlementDigest = createHash('sha256').update(canonicalJson({
    terminalEvidence,
    logicalProgress: progressResult.projection,
    lineageUsage,
  })).digest('hex');
  return {
    attempts,
    terminalEvidence,
    logicalProgress: progressResult.projection,
    logicalMetrics,
    terminalTruth,
    logicalEvaluations,
    lineageUsage,
    usageTotals,
    exactCustodyDigests,
    logicalSettlementDigest,
  };
}

export function publishFencedSprintTerminalReceipt(input: {
  readonly projectRoot: string;
  readonly sprint: Sprint;
  readonly truth: FinalizerTerminalTruth;
  readonly runId?: string;
  readonly coordinatorGeneration?: number;
  readonly now?: () => string;
}): FinalizerTerminalReceiptPublication {
  return publishFencedTerminalReceipt(input, 'COMPLETE', true);
}

function publishFencedTerminalReceipt(
  input: {
    readonly projectRoot: string;
    readonly sprint: Sprint;
    readonly truth: FinalizerTerminalTruth;
    readonly runId?: string;
    readonly coordinatorGeneration?: number;
    readonly now?: () => string;
  },
  terminalOutcome: SprintTerminalOutcome,
  requireSettledAttempts: boolean,
): FinalizerTerminalReceiptPublication {
  const evidence = input.truth.terminalEvidence;
  const unsettledLogical = evidence.logicalTasks.filter(
    logicalTask => logicalTask.state !== 'COMPLETED' && logicalTask.state !== 'FAILED',
  );
  const exactAttemptsSettled = unsettledLogical.length === 0
    && evidence.activeOrUnsettledAttempts.length === 0
    && evidence.partialResults.length === 0
    && evidence.holds.length === 0;
  if (requireSettledAttempts && !exactAttemptsSettled) {
    // Name WHICH settled-condition failed and its first offender — the bare
    // TERMINAL_EVIDENCE_HOLD code hid the cause across two live runs
    // (sprint-661 and sprint-667) and made the success-path finalizer
    // undiagnosable from operator logs.
    const offenders: string[] = [];
    if (unsettledLogical.length > 0) {
      offenders.push(`logical=${unsettledLogical.length}:${unsettledLogical[0]!.logicalTaskId}:${unsettledLogical[0]!.state}`);
    }
    if (evidence.activeOrUnsettledAttempts.length > 0) {
      const first = evidence.activeOrUnsettledAttempts[0]!;
      offenders.push(`unsettled=${evidence.activeOrUnsettledAttempts.length}:${JSON.stringify(first).slice(0, 160)}`);
    }
    if (evidence.partialResults.length > 0) {
      offenders.push(`partial=${evidence.partialResults.length}:${JSON.stringify(evidence.partialResults[0]).slice(0, 120)}`);
    }
    if (evidence.holds.length > 0) {
      const firstHold = evidence.holds[0]!;
      offenders.push(`holds=${evidence.holds.length}:${JSON.stringify(firstHold).slice(0, 200)}`);
    }
    throw new FinalizerTerminalEvidenceError(
      `TERMINAL_EVIDENCE_${evidence.cleanupEligibility.state}[${offenders.join(' | ')}]`,
    );
  }
  const recentWorksDir = join(input.projectRoot, RECENT_WORKS_DIR);
  mkdirSync(recentWorksDir, { recursive: true });
  const artifactPath = join(recentWorksDir, `${input.sprint.id}-terminal-receipt.json`);
  const existing = readJsonSafe<PersistedSprintTerminalReceipt>(artifactPath);
  // A recovery/finalize retry may enter without the original live Flow
  // context. The persisted fenced authority is then the only canonical owner
  // identity; defaulting to the sprint id/generation 1 manufactures a foreign
  // publisher and makes an otherwise idempotent terminal retry impossible.
  // Explicit caller identities still take precedence so a genuine mismatch
  // remains a typed `foreign_ownership`/generation HOLD.
  const runId = input.runId
    ?? existing?.publicationState.runId
    ?? input.sprint.id;
  const coordinatorGeneration = input.coordinatorGeneration
    ?? existing?.publicationState.coordinatorGeneration
    ?? 1;
  const state = existing?.publicationState ?? createSprintTerminalPublicationState({
    version: SPRINT_TERMINAL_PUBLICATION_VERSION,
    sprintId: input.sprint.id,
    runId,
    coordinatorGeneration,
    authorityVersion: 0,
  });
  const transitioned = transitionSprintTerminalPublication(state, {
    version: SPRINT_TERMINAL_PUBLICATION_VERSION,
    sprintId: input.sprint.id,
    runId,
    coordinatorGeneration,
    terminalOutcome,
    logicalSettlementDigest: input.truth.logicalSettlementDigest,
    priorAuthorityVersion: state.receipt?.priorAuthorityVersion ?? state.authorityVersion,
  });
  if (transitioned.decision === 'hold') {
    throw new FinalizerTerminalEvidenceError(`TERMINAL_PUBLICATION_${transitioned.reasonCode}`);
  }
  const receiptEvidence: CoordinatorTerminalEvidence = {
    evidenceId: 'sprint-terminal-receipt',
    kind: 'terminal-receipt',
    state: 'VERIFIED',
    evidenceRef: sha256EvidenceRef('terminal-receipt', transitioned.receipt),
    requiredForCleanup: true,
  };
  const terminalEvidence = assembleSprintTerminalEvidence({
    attempts: input.truth.attempts,
    coordinatorEvidence: [
      ...input.truth.terminalEvidence.coordinatorEvidence,
      receiptEvidence,
    ],
  });
  // A′ / ADR-D-007 bounded recovery (owner onayı, 2026-08-17): a COMPLETE
  // terminal receipt asserts settled WORK. The sprint-535/536 chronology showed
  // an execute-handoff fault producing an EMPTY logical-task set — the vacuous
  // settled check above passes on an empty set, an empty "complete" receipt was
  // written, and only the post-publication archive guard failed (confusingly,
  // with the receipt already on disk). Fail closed BEFORE any byte is written:
  // zero logical tasks, unresolved evidence holds (missing/moved task
  // evidence) or a non-candidate cleanup eligibility are typed HOLDs, never a
  // receipt. The operator-approved ABORTED path is exempt — force-abort IS the
  // fail-closed closure mechanism for exactly these broken runs.
  if (terminalOutcome === 'COMPLETE') {
    if (input.truth.terminalEvidence.logicalTasks.length === 0) {
      throw new FinalizerTerminalEvidenceError('TERMINAL_PUBLICATION_ZERO_TASK_HOLD');
    }
    if (terminalEvidence.holds.length > 0) {
      throw new FinalizerTerminalEvidenceError('TERMINAL_PUBLICATION_EVIDENCE_HOLD');
    }
    if (terminalEvidence.cleanupEligibility.candidate !== true) {
      throw new FinalizerTerminalEvidenceError(
        `TERMINAL_PUBLICATION_NOT_CLEANUP_CANDIDATE_${terminalEvidence.cleanupEligibility.state}`,
      );
    }
  }
  // Receipt publication cannot outrun its task projections. Validate COMPLETE
  // candidacy first so a rejected publication cannot terminalize task JSONs
  // without a receipt. Reducer/CAS/durability failures still propagate as a
  // typed HOLD before receipt bytes exist.
  persistFinalizerTaskTerminalProjections({
    projectRoot: input.projectRoot,
    sprintId: input.sprint.id,
    truth: input.truth,
    coordinatorGeneration,
    terminalOutcome,
  });
  const artifact: PersistedSprintTerminalReceipt = {
    version: 1,
    terminalOutcome,
    publicationState: transitioned.state,
    receipt: transitioned.receipt,
    terminalEvidence: {
      version: terminalEvidence.version,
      summary: terminalEvidence.summary,
      cleanupEligibility: terminalEvidence.cleanupEligibility,
      holds: terminalEvidence.holds,
      coordinatorEvidence: terminalEvidence.coordinatorEvidence,
      // RCPT-1: bounded exclusion DETAIL — the receipt used to carry only a
      // count, so diagnosing a cleanup block meant task-file archaeology.
      // Each record names the attempt, the reason, the claimed paths and
      // whether a verified resolution superseded it.
      attributionExclusions: terminalEvidence.attributionExclusions.slice(0, RECEIPT_EXCLUSION_DETAIL_LIMIT),
    },
    logicalProgress: input.truth.logicalProgress,
    terminalTruth: input.truth.terminalTruth,
    lineageUsage: input.truth.lineageUsage,
    exactCustodyDigests: input.truth.exactCustodyDigests,
    writtenAt: input.now?.() ?? new Date().toISOString(),
  };
  const tempPath = `${artifactPath}.tmp-${process.pid}-${randomUUID()}`;
  writeFileSync(tempPath, JSON.stringify(artifact, null, 2) + '\n', 'utf-8');
  renameSync(tempPath, artifactPath);
  return { receipt: transitioned.receipt, terminalEvidence, artifactPath };
}

/**
 * Publishes an operator-approved ABORTED settlement without converting open,
 * paused, or failed lineages into completion. The exact terminal truth and its
 * unresolved evidence remain in the same fenced artifact used by status and
 * cleanup; only the run outcome differs from normal COMPLETE publication.
 */
export function publishFencedAbortedSprintTerminalReceipt(input: {
  readonly projectRoot: string;
  readonly sprint: Sprint;
  readonly truth: FinalizerTerminalTruth;
  readonly runId?: string;
  readonly coordinatorGeneration?: number;
  readonly now?: () => string;
}): FinalizerTerminalReceiptPublication {
  return publishFencedTerminalReceipt(input, 'ABORTED', false);
}

/**
 * Publish the same exact-attempt terminal authority as a normal sprint while
 * deliberately omitting every learning side effect (retro, memory, promotion,
 * decay and archive). `deckent test` is a lifecycle run, not a second terminal
 * protocol: its reduced surface still has to satisfy the controller's fenced
 * receipt boundary before cleanup or COMPLETE may be published.
 */
export function publishTestModeSprintTerminalReceipt(
  projectRoot: string,
  sprint: Sprint,
  evaluations: ReadonlyMap<string, TaskEvaluation>,
  results: readonly TaskResult[],
  opts: {
    readonly defaultAuthMode?: 'subscription' | 'api' | 'hybrid';
    readonly runId?: string;
    readonly coordinatorGeneration?: number;
    readonly exactTerminalAuthorities?: ReadonlyMap<string, ExactAcceptedTaskTerminalAuthorityRead>;
  } = {},
): TestModeSprintTerminalSettlement {
  const attemptTasks = loadFinalizerAttemptTasks(projectRoot, sprint);
  const terminalTruth = buildFinalizerTerminalTruth({
    tasks: attemptTasks,
    evaluations: normalizePolicyTerminalEvaluations(evaluations, derivePolicyTerminalIdsFromResults(results)),
    results,
    defaultAuthMode: opts.defaultAuthMode,
    exactTerminalAuthorities: opts.exactTerminalAuthorities,
    notDispatchedSettlements: projectNotDispatchedSettlements(
      attemptTasks,
      normalizePolicyTerminalEvaluations(evaluations, derivePolicyTerminalIdsFromResults(results)),
      new Set(
        attemptTasks
          .filter(task => existsSync(join(
            projectRoot,
            TASKS_DIR,
            `task-${task.id}.redispatch-attempted`,
          )))
          .map(task => task.id),
      ),
      derivePolicyTerminalIdsFromResults(results),
    ),
  });
  const receiptPublication = publishFencedSprintTerminalReceipt({
    projectRoot,
    sprint,
    truth: terminalTruth,
    ...(opts.runId ? { runId: opts.runId } : {}),
    ...(opts.coordinatorGeneration !== undefined
      ? { coordinatorGeneration: opts.coordinatorGeneration }
      : {}),
  });
  return { receiptPublication, terminalTruth };
}

/**
 * Canonical operator containment settlement. Unlike normal finalization this
 * path deliberately performs no retrospective, learning, promotion, decay,
 * archive, or synthetic COMPLETE work. It records the exact unresolved truth,
 * publishes one fenced ABORTED receipt, then advances lifecycle authority.
 */
export function forceAbortSprint(
  projectRoot: string,
  sprint: Sprint,
  evaluations: ReadonlyMap<string, TaskEvaluation>,
  results: readonly TaskResult[],
  opts: {
    readonly defaultAuthMode?: 'subscription' | 'api' | 'hybrid';
    readonly runId?: string;
    readonly coordinatorGeneration?: number;
    /**
     * Exact-sprint recovery-coordinator retirement proof captured by the CLI
     * before terminal publication. Legacy in-process callers may omit it;
     * force-finalize sets `requireCoordinatorRetirementEvidence` and therefore
     * cannot publish or return without this proof.
     */
    readonly coordinatorRetirementEvidence?: CoordinatorTerminalEvidence;
    readonly requireCoordinatorRetirementEvidence?: boolean;
    readonly exactTerminalAuthorities?: ReadonlyMap<string, ExactAcceptedTaskTerminalAuthorityRead>;
  } = {},
): ForceAbortSprintSettlement {
  const coordinatorRetirementEvidence = opts.coordinatorRetirementEvidence;
  if (opts.requireCoordinatorRetirementEvidence) {
    if (
      coordinatorRetirementEvidence?.kind !== 'recovery-coordinator-retirement'
      || coordinatorRetirementEvidence.state !== 'VERIFIED'
      || !coordinatorRetirementEvidence.evidenceRef
    ) {
      throw new FinalizerTerminalEvidenceError(
        'FORCE_FINALIZE_COORDINATOR_OWNERSHIP_HOLD',
      );
    }
  }
  const attemptTasks = loadFinalizerAttemptTasks(projectRoot, sprint);
  const truth = buildFinalizerTerminalTruth({
    tasks: attemptTasks,
    evaluations: normalizePolicyTerminalEvaluations(evaluations, derivePolicyTerminalIdsFromResults(results)),
    results: [...results],
    defaultAuthMode: opts.defaultAuthMode,
    coordinatorEvidence: coordinatorRetirementEvidence
      ? [coordinatorRetirementEvidence]
      : [],
    exactTerminalAuthorities: opts.exactTerminalAuthorities,
    notDispatchedSettlements: projectNotDispatchedSettlements(
      attemptTasks,
      normalizePolicyTerminalEvaluations(evaluations, derivePolicyTerminalIdsFromResults(results)),
      new Set(
        attemptTasks
          .filter(task => existsSync(join(
            projectRoot,
            TASKS_DIR,
            `task-${task.id}.redispatch-attempted`,
          )))
          .map(task => task.id),
      ),
      derivePolicyTerminalIdsFromResults(results),
    ),
  });
  const receiptPublication = publishFencedAbortedSprintTerminalReceipt({
    projectRoot,
    sprint,
    truth,
    ...(opts.runId ? { runId: opts.runId } : {}),
    ...(opts.coordinatorGeneration !== undefined
      ? { coordinatorGeneration: opts.coordinatorGeneration }
      : {}),
  });

  // The receipt fences ABORTED truth before this exact-attempt retirement.
  // Any authority failure is terminal: do not archive evidence or publish state.
  retireTerminalProviderExecutionObservations(projectRoot, truth, 'forceAbortSprint');

  // ABORTED is terminal containment, not permission to discard unresolved
  // evidence. Preserve a rollback snapshot, settle terminal artifacts and hold
  // non-terminal artifacts under `tasks/preserved/`, then publish a complete
  // hash manifest plus the Brain archive index. Retrospective/promotion remain
  // deliberately out of this path; only evidence preservation is closed here.
  createPreArchiveSnapshot(projectRoot, sprint.id);
  const tasksDir = join(projectRoot, TASKS_DIR);
  const segment = sprint.id.replace(/^sprint-/u, '');
  let archivePlan: TaskArtifactArchivePlan = { archive: [], preserve: [] };
  if (existsSync(tasksDir)) {
    const prefix = `task-${segment}-`;
    const sprintFiles = readdirSync(tasksDir).filter(name => name.startsWith(prefix));
    const classified = classifyTaskFiles(tasksDir, prefix, sprintFiles);
    archivePlan = { archive: classified.archivable, preserve: classified.preserved };
  }
  const artifactSettlement = archiveTaskArtifacts(projectRoot, sprint.id, archivePlan);
  if (artifactSettlement.failures.length > 0) {
    throw new FinalizerTerminalEvidenceError(
      `SPRINT_ARCHIVE_TASK_SETTLEMENT_FAILED:${artifactSettlement.failures.join('|')}`,
    );
  }
  publishAbortedSprintAuthority(projectRoot, sprint, truth.logicalMetrics);
  // Sprint log projection (row 3298): publishAbortedSprintAuthority just set
  // sprint.status = ABORTED and sprint.completedAt — genuinely terminal, so
  // this is the correct place to upsert the ABORTED log section. Non-fatal:
  // the log is a projection, never settlement authority.
  try {
    const startedAtMs = sprint.startedAt ? Date.parse(sprint.startedAt) : NaN;
    const completedAtMs = sprint.completedAt ? Date.parse(sprint.completedAt) : Date.now();
    const durationMs = Number.isFinite(startedAtMs) ? Math.max(0, completedAtMs - startedAtMs) : 0;
    upsertSprintLog(
      {
        projectRoot,
        sprintResult: {
          sprint,
          evaluations: truth.logicalEvaluations,
          metrics: {
            durationMs,
            totalTasks: truth.logicalMetrics.totalTasks,
            completedTasks: truth.logicalMetrics.completedTasks,
            techDebtTasks: truth.logicalMetrics.techDebtTasks,
            noGoTasks: truth.logicalMetrics.noGoTasks,
            coveragePercent: truth.logicalMetrics.coveragePercent,
          },
        },
      },
      'ABORTED',
    );
  } catch (e) { debugLog('forceAbortSprint:sprintLogProjection', e); }

  publishOutermostSprintTerminalArchive({
    projectRoot,
    sprintId: sprint.id,
    receipt: receiptPublication.receipt,
    terminalEvents: [{
      channel: SPRINT_TERMINAL_ABORTED_CHANNEL,
      payload: {
        sprintId: sprint.id,
        status: SprintStatus.ABORTED,
        phase: sprint.phase,
        terminalOutcome: 'ABORTED',
        runId: receiptPublication.receipt.runId,
        coordinatorGeneration: receiptPublication.receipt.coordinatorGeneration,
        authorityVersion: receiptPublication.receipt.authorityVersion,
      },
    }],
  });
  return { outcome: 'ABORTED', receiptPublication, terminalTruth: truth };
}


// ═══ KPI Forward-Collection Hook (Sprint 332 332-002) ═════════════

/**
 * Forward-collection hook: record the just-finalized sprint's 11 base KPI
 * measurements into `<projectRoot>/.brain/memory.db` at finalize time.
 *
 * Extracted from the inline finalizeSprint block (Sprint 332 332-002, fix #2) so
 * the success path is a first-class, independently unit-testable seam —
 * finalizeSprint itself spawns subprocesses (git diff + runSelfAuditGate → tsc/
 * vitest) and cannot be driven hermetically. The forward path is what makes a
 * sprint's KPIs carry REAL non-zero cost/tokens; the read-path backfill
 * (kpi-backfill.ts) only reconstructs zero-telemetry rows for sprints that were
 * never forward-collected, so a working forward hook is the SSOT for real numbers.
 *
 * NON-BLOCKING + fail-safe: any failure (DB locked/missing, compute error) is
 * swallowed via debugLog so it can NEVER block or fail finalize. SprintMetrics →
 * SprintMetricsLike field mapping is explicit (totalTasks→tasksTotal, etc.); tenant
 * is the Phase-1 'default'.
 *
 * @returns true when measurements were recorded; false when a throw was swallowed.
 */
export function recordSprintKpis(
  projectRoot: string,
  sprintId: string,
  metrics: Pick<SprintMetrics, 'totalTasks' | 'completedTasks' | 'noGoTasks' | 'boundaryViolations'>,
  results: readonly TaskResult[],
  tasks: readonly Task[] = [],
  defaultAuthMode?: 'subscription' | 'api' | 'hybrid',
  authoritativeUsage?: UsageTotals,
): boolean {
  try {
    recordKpiMeasurements(
      join(projectRoot, BRAIN_DIR, MEMORY_DB_FILE),
      sprintId,
      'default',
      {
        tasksTotal: metrics.totalTasks,
        tasksDone: metrics.completedTasks,
        noGo: metrics.noGoTasks,
        boundaryViolations: metrics.boundaryViolations,
      },
      results,
      authoritativeUsage ?? buildUsageTotals(results, tasks, defaultAuthMode),
    );
    return true;
  } catch (e) {
    debugLog('finalizeSprint:kpiCollection', e);
    return false;
  }
}


// ═══ Cumulative Spend Admission Gate (row 4091 — pre-spawn HARD block) ══
//
// `cost_limits.enforce_spend_gate` used to be a name-behaviour gap: the key only
// enabled a warning at both the pre-spawn (start.ts / MCP deckent_start) and the
// finalize (emitFinalizeSpendAdvisory, below) call sites. This section closes the
// gap on ONE side only, deliberately:
//
//   • ADMISSION (pre-spawn) — enforcing. Over-ceiling cumulative day/month spend
//     refuses to admit a NEW run with a typed COST_GATE_EXCEEDED.
//   • FINALIZE (in-flight) — advisory, forever. An ACTIVE sprint is never cut,
//     paused or killed on breach; it lands gracefully and only the NEXT admission
//     is refused. See emitFinalizeSpendAdvisory's contract note below.
//
// Both faces live in this one module so that invariant stays visible at both ends.
// The gate owns NO spend math and NO spend source: the projection + thresholds are
// delegated wholesale to core (`evaluateSpendWarnAtSpawn` → `checkSpendGate` over
// `readSpendWindow`, the canonical cost/usage authority). This function only turns
// that authority's breach event into a typed admission decision.

/** Admission allowed — the run may spawn. */
export interface SpendAdmissionAllowed {
  ok: true;
  /**
   * The window breach, when one occurred but the operator acknowledged it
   * (CLI `--force`, MCP `acknowledgeCost: true`) — callers surface it as the
   * unchanged COST_LIMIT_WARN advisory. Null when no window limit was breached
   * (which includes every flag-off run: the gate is a no-op then).
   */
  breach: CostLimitWarnEvent | null;
  /** True when a breach was downgraded to a warning by operator acknowledgement. */
  overrideApplied: boolean;
}

/** Admission refused — the run must NOT spawn. */
export interface SpendAdmissionBlocked {
  ok: false;
  reason: 'COST_GATE_EXCEEDED';
  /** The breach detail (window, spent, projection, limit) from the canonical authority. */
  breach: CostLimitWarnEvent;
  /** Human-readable refusal, breach message + override guidance. */
  message: string;
}

export type SpendAdmissionDecision = SpendAdmissionAllowed | SpendAdmissionBlocked;

export interface SpendAdmissionGateInput {
  /** Project root — the resource ledger (canonical spend authority) lives under it. */
  root: string;
  /** Loaded cost config (provides daily_max_usd / monthly_max_usd / enforce_spend_gate). */
  costConfig: CostConfig;
  /** This run's cost estimate, projected on top of the already-logged spend. */
  sprintEstimateUsd: number;
  /**
   * Operator acknowledgement (CLI `--force`, MCP `acknowledgeCost: true`). When set,
   * a breach is downgraded to the pre-existing warn instead of blocking — the same
   * override contract the estimate gate (`evaluateCostGate`) already uses.
   */
  acknowledged?: boolean;
  /** Spend-window reader override (tests). Threaded into evaluateSpendWarnAtSpawn. */
  readSpend?: (root: string, window: 'day' | 'month') => number;
}

/**
 * Row 4091 — PRE-SPAWN cumulative-spend admission gate.
 *
 * Returns a typed `COST_GATE_EXCEEDED` refusal when `cost_limits.enforce_spend_gate`
 * is true (default-off, unchanged) AND the projected day/month spend crosses its
 * ceiling AND the operator has not acknowledged the cost.
 *
 * Flag-off is a strict no-op: `evaluateSpendWarnAtSpawn` short-circuits before the
 * ledger is touched, so the gate performs zero I/O and returns `{ok: true, breach: null}`
 * — the caller's spawn path stays byte-for-byte what it is today.
 *
 * Pure with respect to orchestration state: it never kills, pauses or signals a
 * running sprint. It answers one question — may a NEW run be admitted?
 */
export function evaluateSpendAdmissionGate(
  input: SpendAdmissionGateInput,
): SpendAdmissionDecision {
  const breach = evaluateSpendWarnAtSpawn({
    root: input.root,
    costConfig: input.costConfig,
    sprintEstimateUsd: input.sprintEstimateUsd,
    ...(input.readSpend ? { readSpendWindow: input.readSpend } : {}),
  });

  if (!breach) return { ok: true, breach: null, overrideApplied: false };
  if (input.acknowledged) return { ok: true, breach, overrideApplied: true };

  return {
    ok: false,
    reason: 'COST_GATE_EXCEEDED',
    breach,
    message:
      `${breach.message} Cumulative spend gate (cost_limits.enforce_spend_gate) is enforcing — ` +
      `no new sprint is admitted. Any already-running sprint keeps going and lands normally. ` +
      `Override with --force (CLI) / acknowledgeCost=true (MCP), or raise ` +
      `cost_limits.${breach.window === 'day' ? 'daily_max_usd' : 'monthly_max_usd'} in .deckent/cost-config.json.`,
  };
}


// ═══ Cumulative Spend Advisory (B6 — warn-only, never blocks) ═════
// DECKENT-TRIAGE-PLAN B6 / Sprint 333 333-005.

/**
 * Injectable advisory emitter — receives the {@link CostLimitWarnEvent} and
 * surfaces it (event stream, console, …). Injectable so the finalize hook is
 * hermetically unit-testable without the real event-stream writer / stdout.
 */
export type CostLimitAdvisoryEmitter = (event: CostLimitWarnEvent) => void;

/** Test seams + reference-time injection for {@link emitFinalizeSpendAdvisory}. */
export interface FinalizeSpendAdvisoryOptions {
  /** Override the advisory emitter (default: writeEvent + console.warn). */
  emit?: CostLimitAdvisoryEmitter;
  /** Override the spend-window reader (default: readSpendWindow over the resource ledger). */
  readSpend?: (root: string, window: 'day' | 'month') => number;
  /** Override the cost-config loader (default: loadCostConfig). */
  loadConfig?: (root: string) => CostConfig;
  /** Fixed reference timestamp (ISO) threaded into the default readSpendWindow. */
  now?: string;
}

/**
 * B6 (DECKENT-TRIAGE-PLAN) — cost-gate daily/monthly WARN-ONLY wire.
 *
 * At sprint finalize, project this sprint's realized cost on top of the
 * already-logged cumulative spend (daily + monthly windows from the resource
 * ledger) and, when `cost_limits.enforce_spend_gate` is enabled AND a window
 * limit is breached, EMIT a `BRAIN→USER:COST_LIMIT_WARN` advisory.
 *
 * VISIBILITY ONLY — warn-only, NON-BLOCKING, and PERMANENTLY so (row 4091).
 * `enforce_spend_gate` IS a hard block now, but only at ADMISSION — see
 * {@link evaluateSpendAdmissionGate}. Enforcement deliberately stops at the
 * spawn boundary: a sprint that is already ACTIVE is never cut, paused or failed
 * when a ceiling is crossed mid-flight; it lands gracefully and only the next
 * admission is refused. Turning this hook into a block would violate that
 * property, so it stays an advisory regardless of the flag.
 *
 * The spend math is delegated ENTIRELY to readSpendWindow + checkSpendGate
 * (no re-implementation). READ-only against the spend ledger; the only write
 * is the advisory event itself (default emitter). When the flag is off (the
 * default) checkSpendGate returns null → zero side effects → finalize output
 * is byte-for-byte unchanged.
 *
 * NON-BLOCKING + fail-safe: the whole body is wrapped so any failure (ledger
 * missing, config parse error, emitter throw) is swallowed via debugLog and
 * can NEVER fail or block finalize. Mirrors the recordSprintKpis /
 * pruneStaleHandoffs end-of-sprint fail-safe seam pattern.
 *
 * @param projectRoot - Project root (resource ledger + cost-config live under it).
 * @param sprintId - Current sprint id (carried on the advisory event).
 * @param sprintCostUsd - This sprint's realized cost (buildUsageTotals(results).costUsd).
 * @param opts - Injectable test seams (emit / readSpend / loadConfig / now).
 * @returns the emitted advisory, or null when no breach / flag off / on error.
 */
export function emitFinalizeSpendAdvisory(
  projectRoot: string,
  sprintId: string,
  sprintCostUsd: number,
  opts?: FinalizeSpendAdvisoryOptions,
): CostLimitWarnEvent | null {
  try {
    const readSpend =
      opts?.readSpend ??
      ((root: string, window: 'day' | 'month'): number =>
        readSpendWindow(root, window, opts?.now ? { now: opts.now } : undefined));
    const loadConfig = opts?.loadConfig ?? ((root: string): CostConfig => loadCostConfig(root));

    const costConfig = loadConfig(projectRoot);

    // Delegate ALL spend math to checkSpendGate (flag-gated, pure). It returns
    // null when enforce_spend_gate is off (default) or both windows are within
    // limits — so the common path is a no-op.
    const warn = checkSpendGate({
      spentDayUsd: readSpend(projectRoot, 'day'),
      spentMonthUsd: readSpend(projectRoot, 'month'),
      sprintEstimateUsd: sprintCostUsd,
      costConfig,
    });
    if (!warn) return null;

    const emit =
      opts?.emit ??
      ((event: CostLimitWarnEvent): void => {
        // Default emitter — visibility only, both non-blocking:
        //   1. structured BRAIN→USER:COST_LIMIT_WARN event (dashboard / status tail / auditor).
        //      Channel is the literal event.type — no CHANNELS constant needed.
        //   2. console.warn so a CLI operator sees the advisory inline.
        writeEvent(projectRoot, sprintId, 'brain', 'user', event.type, { ...event, sprintId });
        console.warn(`⚠️  [cost-advisory] ${event.message}`);
      });
    emit(warn);
    return warn;
  } catch (e) {
    debugLog('finalizeSprint:spendAdvisory', e);
    return null;
  }
}


// ═══ Helper-call cost surfacing (MET668B / task 419-002) ══════════
//
// The haiku auxiliary-call cost ($0.0127 class — Brain's doc/summary helper turns) lands
// in each task's provider envelope `modelUsage` map but is dropped by the aggregate-only
// capture path (result-collector.ts, born-562 — untouchable), so `result.cost.usd` /
// `buildUsageTotals` cover the PRIMARY model only. This read-side wire re-prices the
// NON-primary (helper) models via the cost-ledger bridge and surfaces the delta — WITHOUT
// touching the capture contract, and WITHOUT folding into buildUsageTotals (which is pinned
// by the KPI tests and would then double-count). Best-effort + fail-safe: never blocks finalize.

/** Result of {@link collectHelperCost} — the previously off-ledger auxiliary-call cost. */
export interface HelperCostReport {
  /** Total USD of previously off-ledger auxiliary (helper) model calls this sprint. */
  helperUsd: number;
  /** The priced helper ledger (rows carry model + kind:'helper' + usd). */
  ledger: CostLedger;
  /** How many task envelopes contributed at least one helper (non-primary) entry. */
  envelopesWithHelper: number;
}

/** Injectable seams for {@link collectHelperCost} — used by hermetic tests. */
export interface CollectHelperCostOptions {
  /**
   * Per-task `modelUsage` reader. Default: best-effort parse of `.tasks/task-<id>.log`.
   * Return `undefined` when no envelope is available (never throw — the caller also guards).
   */
  readModelUsage?: (projectRoot: string, taskId: string) => ModelUsageMap | undefined;
  /** Override the cost-config loader (default: loadCostConfig). */
  loadConfig?: (root: string) => CostConfig;
}

const EMPTY_HELPER_LEDGER: CostLedger = { rows: [], totalUsd: 0, unpricedCount: 0 };

/**
 * Best-effort `modelUsage` extractor from a task's CLI `.log` envelope. Minimal + fail-safe:
 * tries the whole file as a single JSON envelope first (the `--output-format json` common
 * case), then scans line-by-line for a JSONL record carrying a `modelUsage` map; returns the
 * LAST such map found, or `undefined` on any failure. It deliberately does NOT reinvent the
 * full envelope parser (born-562) — an unreadable / multi-envelope-pretty-printed log simply
 * yields `undefined` (honest miss), which the caller treats as "no helper cost for this task".
 */
function readModelUsageFromLog(projectRoot: string, taskId: string): ModelUsageMap | undefined {
  try {
    const logPath = join(projectRoot, TASKS_DIR, `task-${taskId}.log`);
    if (!existsSync(logPath)) return undefined;
    const raw = readFileSync(logPath, 'utf-8');

    const asMap = (v: unknown): ModelUsageMap | undefined =>
      v !== null && typeof v === 'object' ? (v as ModelUsageMap) : undefined;

    // 1. Whole-file single JSON envelope (possibly pretty-printed).
    try {
      const whole = JSON.parse(raw) as { modelUsage?: unknown };
      const m = asMap(whole?.modelUsage);
      if (m) return m;
    } catch { /* not a single JSON object — fall through to JSONL scan */ }

    // 2. JSONL scan — last line carrying a modelUsage map wins.
    let found: ModelUsageMap | undefined;
    for (const line of raw.split('\n')) {
      const t = line.trim();
      if (!t.startsWith('{')) continue;
      try {
        const obj = JSON.parse(t) as { modelUsage?: unknown };
        const m = asMap(obj?.modelUsage);
        if (m) found = m;
      } catch { /* skip non-JSON line */ }
    }
    return found;
  } catch (e) {
    debugLog('collectHelperCost:readModelUsageFromLog', e);
    return undefined;
  }
}

/**
 * Aggregate the previously off-ledger helper-call cost across a sprint's results.
 *
 * For each result: read its provider envelope `modelUsage` map (best-effort), take the
 * PRIMARY model from `result.tokenUsage?.model` (the model already priced into
 * `result.cost.usd`), and price only the NON-primary models via {@link buildHelperLedger}
 * (double-count guard lives in extractHelperUsageEntries — an unresolvable primary emits
 * nothing). Per-result reads are individually guarded so one bad log cannot zero the rest;
 * the whole body is fail-safe (returns an all-zero report, never throws).
 */
export function collectHelperCost(
  projectRoot: string,
  results: readonly TaskResult[],
  opts?: CollectHelperCostOptions,
): HelperCostReport {
  try {
    const read = opts?.readModelUsage ?? readModelUsageFromLog;
    const loadConfig = opts?.loadConfig ?? ((root: string): CostConfig => loadCostConfig(root));
    const config = loadConfig(projectRoot);
    const ssot = loadBundledClaudePricing();

    const envelopes: HelperEnvelope[] = [];
    let envelopesWithHelper = 0;
    for (const r of results) {
      let modelUsage: ModelUsageMap | undefined;
      try {
        modelUsage = read(projectRoot, r.taskId);
      } catch (e) {
        debugLog('collectHelperCost:read', e);
        continue;
      }
      if (!modelUsage) continue;
      const primaryModel = r.tokenUsage?.model;
      envelopes.push({ primaryModel, modelUsage });
      // Presence check via the same guard (no pricing) — cheaper than a full per-result ledger.
      if (extractHelperUsageEntries(modelUsage, primaryModel, ssot).length > 0) envelopesWithHelper += 1;
    }

    const ledger = buildHelperLedger(envelopes, config, ssot);
    return { helperUsd: ledger.totalUsd, ledger, envelopesWithHelper };
  } catch (e) {
    debugLog('finalizeSprint:collectHelperCost', e);
    return { helperUsd: 0, ledger: EMPTY_HELPER_LEDGER, envelopesWithHelper: 0 };
  }
}


// ═══ Rich Completion Record (TERM5-FIN — sprint-427 task 1) ═══════
//
// Data-foundation for the design doc's "Ölecek / compatibility-only parçalar"
// row "Exit-code-only evaluate → Rich finalizer result'ıyla değiştirilir"
// (docs/analysis/term-flow-unify-design-2026-07-11.md). Purely additive: this
// record is appended as a NEW `completionRecord` key on the existing Step-13
// job-completion-summary artifact (`.deckent/runtime/jobs/<sprintId>.json`) —
// the artifact run-completion-watch.ts already polls/fs.watches, so no new
// mechanism is introduced. Later TERM5 tasks (2-6) correlate on `flowId`.

/** Per-verdict counts, independent of `SprintMetrics` (different shape/purpose). */
export interface CompletionVerdictSummary {
  done: number;
  techDebt: number;
  noGo: number;
}

/** One evaluated task's summary — a flat array entry, distinct from the
 *  existing keyed `evaluations` record (a future result-turn renderer wants
 *  an ordered list, not a map). SURF-3 result-evidence (born-697 successor):
 *  the file/test evidence fields carry the same numbers the keyed `evaluations`
 *  map already holds, so the terminal result-turn can render per-task evidence
 *  without re-reading N `.tasks/*.result` files — the job file (already watched)
 *  is enough. Additive: legacy job files lack these and parse to `undefined`. */
export interface CompletionTaskSummary {
  taskId: string;
  title: string;
  evaluation: TaskEvaluation;
  selfAssessment: string;
  /** Count of files this task changed (not the list — the terminal wants density). */
  filesChanged: number;
  linesAdded: number;
  linesRemoved: number;
  testsPassed: boolean;
  /** Test coverage percent (0 when the task ran no tests / reported none). */
  coverage: number;
  /** Host-owned work attribution; unavailable claims contribute zero work. */
  workAttributionState: 'VERIFIED' | 'HOLD' | 'UNAVAILABLE';
  attemptId: string | null;
  attributionReason: string | null;
}

export interface SprintCompletionRecord {
  /** Run-flow correlation id — present only when the caller threaded one in
   *  via `FinalizeSprintOptions.flowId` (absent for every current caller). */
  flowId?: string;
  verdictSummary: CompletionVerdictSummary;
  taskSummary: CompletionTaskSummary[];
  /** Exact attempts remain available even though taskSummary is logical-task scoped. */
  attemptEvidence?: readonly ExactAttemptEvidence<TaskResult>[];
  /** Host-authoritative usage aggregated once per logical lineage. */
  lineageUsage?: readonly LineageUsageAuthorityAggregate[];
  logicalProgress?: LogicalProgressProjection;
}

/**
 * Build the additive rich completion record from the same `evaluations` +
 * `resultsMap` already available at the Step-13 callsite (mirrors the
 * existing `richEvaluations` construction there). Pure — no I/O, no throw.
 */
export function buildSprintCompletionRecord(
  sprint: Sprint,
  evaluations: Map<string, TaskEvaluation>,
  resultsMap: Map<string, TaskResult>,
  flowId?: string,
  truth?: FinalizerTerminalTruth,
): SprintCompletionRecord {
  const verdictSummary: CompletionVerdictSummary = { done: 0, techDebt: 0, noGo: 0 };
  const taskSummary: CompletionTaskSummary[] = [];

  for (const [taskId, evaluation] of evaluations) {
    const task = sprint.tasks.find(t => t.id === taskId);
    const result = resultsMap.get(taskId);
    const work = projectAttributedTaskWork(result);
    taskSummary.push({
      taskId,
      title: task?.title ?? '',
      evaluation,
      selfAssessment: result?.selfAssessment ?? evaluation,
      filesChanged: work.filesChanged.length,
      linesAdded: work.linesAdded,
      linesRemoved: work.linesRemoved,
      testsPassed: result?.testsPassed ?? false,
      coverage: result?.coverage ?? 0,
      workAttributionState: work.state,
      attemptId: work.attemptId,
      attributionReason: work.reasonCode,
    });

    if (evaluation === TaskEvaluation.NO_GO) verdictSummary.noGo += 1;
    else if (evaluation === TaskEvaluation.GO_WITH_TECH_DEBT) verdictSummary.techDebt += 1;
    else if (evaluation === TaskEvaluation.DONE) verdictSummary.done += 1;
  }

  const record: SprintCompletionRecord = { verdictSummary, taskSummary };
  if (flowId) record.flowId = flowId;
  if (truth) {
    record.attemptEvidence = truth.attempts;
    record.lineageUsage = truth.lineageUsage;
    record.logicalProgress = truth.logicalProgress;
  }
  return record;
}


// Task archive authority lives in core/sprint-archive.ts so normal finalize,
// recovery, cleanup and read-side consumers share one dependency-safe contract.

// ═══ Finalize Sprint ══════════════════════════════════════════════

/**
 * Run ALL post-sprint finalization actions. This function is idempotent-safe:
 * calling it multiple times with the same data won't corrupt state (MEMORY.md
 * may get duplicate entries if sprint learnings already exist, but trimming
 * keeps it within budget).
 *
 * Actions performed:
 * 1. Calculate metrics from evaluations + results
 * 2. Write sprint log to .brain/sprints/sprint-NNN.md
 * 3. Update MEMORY.md with sprint learnings (trimMemoryWithHeader)
 * 4. Write RETRO.md (writeRetrospective)
 * 5. (Legacy removed) Identity file write dropped in Memory V2 — identity is now DB-first,
 *    surfaced via managed .deckent/workspace/IDENTITY.md (ADR-046, B6).
 * 6. Update last_sprint_id in .deckent/config.json
 * 7. Run decay if over budget
 * 8. Run afterSprint plugin hooks
 * 9. Update project docs (doc-updaters registry)
 *
 * @param projectRoot - Project root directory
 * @param sprint - The completed sprint (must have tasks populated)
 * @param evaluations - Map of task ID to evaluation result
 * @param results - Array of worker task results
 * @param opts - Optional finalization settings
 * @returns The computed sprint metrics
 */
export async function finalizeSprint(
  projectRoot: string,
  sprint: Sprint,
  evaluations: Map<string, TaskEvaluation>,
  results: TaskResult[],
  opts?: FinalizeSprintOptions,
): Promise<SprintMetrics> {
  const sprintIdForEvents = getCurrentSprintId(projectRoot) ?? sprint.id;
  const emitStandardLifecycleEvents = shouldEmitStandardLifecycleEvents(opts);
  const archiveDir = resolveSprintArchiveDir(projectRoot, sprint.id);
  const manualReplayCandidate = opts?.deferTerminalAuthority !== true
    && (existsSync(join(archiveDir, 'terminal-seal-receipt.json'))
      || existsSync(join(archiveDir, 'terminal-seal-application.json')));

  // Preserve the live first-finalize event order. A sealed replay takes the
  // read-only branch below before observability, lifecycle, debt or Brain APIs
  // receive an opportunity to mutate authority files.
  if (!manualReplayCandidate) {
    initObservability(projectRoot);
    if (emitStandardLifecycleEvents) {
      writeEvent(
        projectRoot, sprintIdForEvents, 'brain', '*',
        CHANNELS.SPRINT_PHASE_CHANGE,
        { fromPhase: 'EXECUTE', toPhase: 'EVALUATE', sprintId: sprint.id, timestamp: new Date().toISOString() },
      );
    }
  }

  // Build O(1) lookup index from results array — eliminates O(n²) linear scans
  const callerResultsMap = buildResultsMap(results);

  // Settlement truth gate: a dirty or unexecutable compiler may not be
  // represented as a pure COMPLETE. Reuse the existing per-task tech-debt
  // channel so every downstream projection observes the same residual.
  if (!manualReplayCandidate) {
    const tscGate = await runTscSettlementGate(
      projectRoot,
      opts?.config?.evaluation?.tsc_settlement_gate ?? true,
      opts?.runTscFn,
    );
    if (tscGate.kind === 'residual') {
      const candidate = sprint.tasks.find(task => evaluations.get(task.id) === TaskEvaluation.DONE);
      if (candidate) {
        evaluations.set(candidate.id, TaskEvaluation.GO_WITH_TECH_DEBT);
        const result = callerResultsMap.get(candidate.id);
        if (result) {
          const detail = [tscGate.code, ...tscGate.errors].join('\n');
          result.selfAssessment = 'GO_WITH_TECH_DEBT';
          result.notes = result.notes ? `${result.notes}\n${detail}` : detail;
        }
      }
      writeEvent(
        projectRoot, sprintIdForEvents, 'brain', 'auditor',
        'BRAIN→AUDITOR:TSC_SETTLEMENT_GATE_RESIDUAL',
        {
          sprintId: sprint.id,
          code: tscGate.code,
          errors: [...tscGate.errors],
          timestamp: new Date().toISOString(),
        },
      );
    }
  }

  // One canonical terminal projection owns every finalizer denominator. Exact
  // attempts remain on terminalTruth for evidence/usage, while downstream
  // task-shaped consumers receive only each lineage's resolving attempt under
  // its logical root id. This prevents original + FIX attempts from inflating
  // jobs, KPI measurements, coverage, or rich output.
  const attemptTasks = loadFinalizerAttemptTasks(projectRoot, sprint);
  const terminalTruth = buildFinalizerTerminalTruth({
    tasks: attemptTasks,
    evaluations: normalizePolicyTerminalEvaluations(evaluations, derivePolicyTerminalIdsFromResults(results)),
    results,
    defaultAuthMode: opts?.config?.auth_mode,
    exactTerminalAuthorities: opts?.exactTerminalAuthorities,
    notDispatchedSettlements: projectNotDispatchedSettlements(
      attemptTasks,
      normalizePolicyTerminalEvaluations(evaluations, derivePolicyTerminalIdsFromResults(results)),
      new Set(
        attemptTasks
          .filter(task => existsSync(join(projectRoot, TASKS_DIR, `task-${task.id}.redispatch-attempted`)))
          .map(task => task.id),
      ),
      derivePolicyTerminalIdsFromResults(results),
    ),
  });
  // From this boundary onward, caller/public arrays are no longer outcome
  // inputs. Every result and verdict is projected back out of the classified
  // attempt truth; exact attempts therefore carry only the Store-revalidated
  // T11 payload and receipt verdict into logs, retro, docs, learning and audit.
  const authoritativeInputs = projectFinalizerAuthoritativeInputs(terminalTruth);
  const authoritativeResults = authoritativeInputs.results;
  const authoritativeEvaluations = authoritativeInputs.evaluations;
  const authoritativeResultsById = buildResultsMap(authoritativeResults);
  const deliveryByAttempt = new Map(attemptTasks.map(task => {
    const result = authoritativeResultsById.get(task.id);
    const delivery = resolvePromptDeliveryAttribution({
      projectRoot,
      taskId: task.id,
      requireCurrentReceipt: typeof task.promptCompilePlanId === 'string',
      legacyAgentId: result?.agentId ?? task.assignedAgent ?? null,
      legacySkillIds: result?.skillIds ?? task.assignedSkills,
    });
    return [task.id, delivery] as const;
  }));
  const tasksById = new Map(attemptTasks.map(task => [task.id, task]));
  const logicalTasks = projectFinalizerLogicalTasks(terminalTruth.terminalEvidence, attemptTasks);
  const logicalResults = terminalTruth.terminalEvidence.logicalTasks.flatMap(logicalTask => {
    const resolvingTaskId = logicalTask.resolvingAttempt?.taskId
      ?? logicalTask.attempts.at(-1)?.taskId;
    const result = resolvingTaskId ? authoritativeResultsById.get(resolvingTaskId) : undefined;
    return result ? [{ ...result, taskId: logicalTask.logicalTaskId }] : [];
  });
  const logicalResultsMap = buildResultsMap(logicalResults);
  const logicalDelivery = new Map(terminalTruth.terminalEvidence.logicalTasks.flatMap(logicalTask => {
    const resolvingTaskId = logicalTask.resolvingAttempt?.taskId
      ?? logicalTask.attempts.at(-1)?.taskId;
    const delivery = resolvingTaskId ? deliveryByAttempt.get(resolvingTaskId) : undefined;
    return delivery ? [[logicalTask.logicalTaskId, delivery] as const] : [];
  }));
  const skillAttributionReceipts = terminalTruth.terminalEvidence.logicalTasks.flatMap(logicalTask => {
    const resolvingAttemptId = logicalTask.resolvingAttempt?.taskId
      ?? logicalTask.attempts.at(-1)?.taskId;
    if (!resolvingAttemptId) return [];
    const resolvingTask = tasksById.get(resolvingAttemptId);
    const delivery = deliveryByAttempt.get(resolvingAttemptId);
    if (!resolvingTask || !delivery) return [];
    const selectedSkillIds = delivery.state === 'CURRENT'
      ? delivery.receipt.assignedSkillIds
      : resolvingTask.assignedSkills ?? [];
    return [buildSkillAttributionReceipt({
      sprintId: sprint.id,
      logicalTaskId: logicalTask.logicalTaskId,
      resolvingAttemptId,
      routingDecisionDigest: resolvingTask.routingMeta?.skillDecisionDigest ?? null,
      skillEvidenceDigest: resolvingTask.routingMeta?.skillEvidenceDigest ?? null,
      logicalSettlementDigest: terminalTruth.logicalSettlementDigest,
      promptDeliveryState: delivery.state,
      selectedSkillIds,
      deliveredSkillIds: delivery.skillIds,
      // No worker/task verdict can populate `appliedEvidence`. A future host
      // validator may supply it; until then the durable state is exposure-only.
    })];
  });
  const skillAttributionByLogicalTask = new Map(
    skillAttributionReceipts.map(receipt => [receipt.logicalTaskId, receipt] as const),
  );
  const logicalSprint: Sprint = { ...sprint, tasks: logicalTasks };
  const logicalEvaluations = new Map(terminalTruth.logicalEvaluations);

  if (manualReplayCandidate) {
    const replayMetrics: SprintMetrics = {
      ...calculateMetrics(logicalSprint, logicalEvaluations, logicalResults),
      ...terminalTruth.logicalMetrics,
    };
    if (replaySettledManualFinalizeIfPresent({
      projectRoot,
      sprintId: sprint.id,
      logicalSettlementDigest: terminalTruth.logicalSettlementDigest,
      opts,
    })) {
      sprint.metrics = replayMetrics;
      return replayMetrics;
    }
    throw new FinalizerTerminalEvidenceError('SPRINT_ARCHIVE_EXISTING_SEAL_IDENTITY_MISMATCH');
  }

  // Immutable, logical-task-grain skill attribution is published before any
  // mutable learning/stat projection. A conflicting replay blocks projection.
  writeSkillAttributionBatch(projectRoot, sprint.id, skillAttributionReceipts);

  // 0. Legacy ambient code observation (diagnostic-only). It deliberately runs
  // after the immutable replay branch so sealed re-entry remains observational.
  const codeVerifiedTasks: string[] = [];
  for (const [taskId, evaluation] of authoritativeEvaluations) {
    if (evaluation !== TaskEvaluation.NO_GO) continue;
    try {
      const verifyResult = await tryCodeVerifiedDone(taskId, projectRoot);
      if (verifyResult.triggered && verifyResult.verified) {
        debugLog(
          'finalizeSprint:ambientCodeObservation',
          `task=${taskId} observedFiles=${verifyResult.verifiedFiles.length}; verdict unchanged`,
        );
      }
    } catch (e) {
      debugLog('finalizeSprint:codeReconcile', `Reconciliation failed for ${taskId}: ${e}`);
    }
  }
  if (codeVerifiedTasks.length > 0) {
    debugLog('finalizeSprint:codeReconcile', `${codeVerifiedTasks.length} tasks reconciled: ${codeVerifiedTasks.join(', ')}`);
  }

  // 1. Calculate metrics — tech debt is read DB-first (Task #4d).
  const freshDebt = getDebtItems(projectRoot);
  const baseMetrics = calculateMetrics(
    logicalSprint,
    logicalEvaluations,
    logicalResults,
    freshDebt,
  );
  const metrics: SprintMetrics = {
    ...baseMetrics,
    ...terminalTruth.logicalMetrics,
  };
  sprint.metrics = metrics;

  // ─── KPI forward-collection hook (Sprint 330 Task 8; hardened 332-002) ──
  // Record the sprint's 11 base KPI measurements into memory.db. Extracted into
  // recordSprintKpis so the success path is an independently unit-testable seam
  // (finalizeSprint spawns subprocesses → not hermetically callable). Best-effort
  // + fail-safe: NEVER blocks or fails finalize; finalize behavior is unchanged.
  recordSprintKpis(
    projectRoot,
    sprint.id,
    metrics,
    logicalResults,
    logicalTasks,
    opts?.config?.auth_mode,
    terminalTruth.usageTotals,
  );

  // ─── Cumulative spend advisory (B6 — warn-only, Sprint 333 333-005) ──
  // Project this sprint's realized cost (buildUsageTotals → the same usage/cost
  // already aggregated for KPIs above) onto the rolling daily/monthly ledger spend
  // and, when cost_limits.enforce_spend_gate is on AND a window cap is breached,
  // EMIT a BRAIN→USER:COST_LIMIT_WARN advisory. Warn-only + NON-BLOCKING: the hook
  // is self-fail-safe (swallows every throw) and checkSpendGate is flag-gated
  // default-off, so the flag-off common path is a no-op and finalize is byte-for-byte
  // unchanged. Row 4091: enforce_spend_gate is a real block at ADMISSION
  // (evaluateSpendAdmissionGate, pre-spawn) — never here. This sprint is already
  // ACTIVE; it lands gracefully and only the next admission is refused.
  emitFinalizeSpendAdvisory(
    projectRoot,
    sprint.id,
    terminalTruth.usageTotals.costUsd,
  );

  // ─── METRIC_EMITTED: sprint summary metrics ──────────────────────
  // Emitted in parallel with metrics.jsonl so Auditor and Dashboard
  // get structured metric data without parsing the JSONL file.
  // ADR-035: BRAIN→*:METRIC_EMITTED is a broadcast channel.
  writeEvent(
    projectRoot, sprintIdForEvents, 'brain', '*',
    CHANNELS.METRIC_EMITTED,
    {
      name: 'sprint.summary',
      sprintId: sprint.id,
      totalTasks: metrics.totalTasks,
      completedTasks: metrics.completedTasks,
      techDebtTasks: metrics.techDebtTasks,
      noGoTasks: metrics.noGoTasks,
      durationMs: metrics.durationMs,
      coveragePercent: metrics.coveragePercent,
    },
  );

  // 2. Write sprint log
  try {
    writeSprintLog(projectRoot, logicalSprint, metrics, logicalEvaluations);
  } catch (e) { debugLog('finalizeSprint:writeSprintLog', e); }

  // ─── SPRINT_PHASE_CHANGE: EVALUATE → RETRO ──────────────────────
  if (emitStandardLifecycleEvents) {
    writeEvent(
      projectRoot, sprintIdForEvents, 'brain', '*',
      CHANNELS.SPRINT_PHASE_CHANGE,
      { fromPhase: 'EVALUATE', toPhase: 'RETRO', sprintId: sprint.id, timestamp: new Date().toISOString() },
    );
  }

  // 3 + 4. Write RETRO.md and update MEMORY.md (writeRetrospective does both)
  // ─── ADR-046 Step 5 — retroWriter (dual write contract) ─────────
  // Sprint 168 C0a-3 (BUG-DD + BUG-EE): writeRetrospective MUST emit
  // both DB rows (`sprint-log-NNN`, `retro-sprint-NNN`, `mem-sprint-NNN`)
  // and `.brain/RETRO.md` in a single invocation. Pinned by
  // tests/orchestra/retro-dual-write.test.ts. Do NOT split the call
  // (Sprint 167 regression — DB+FS came out of sync when the wire was
  // partial). Unconditional invocation per ADR-046 §"Mimari Prensipler".
  debugLog('finalizeSprint:preRetro', `evaluations.size=${logicalEvaluations.size} keys=[${[...logicalEvaluations.keys()].join(',')}]`);
  let sprintLogPersisted = false;
  try {
    // Build skillMap from delivered prompt identities for Skill Performance.
    const skillMap = new Map<string, string[]>();
    for (const task of logicalTasks) {
      const delivered = logicalDelivery.get(task.id)?.skillIds ?? [];
      if (delivered.length > 0) {
        skillMap.set(task.id, [...delivered]);
      }
    }
    // Sprint 192 Task 192-005: opt into createIfMissing so the chronic
    // Sprint 167+ DB-gap [[project_sprint167_db_gap]] cannot recur — even
    // a first-ever sprint on a fresh project now lands sprint-log + retro
    // + mem rows.
    const retroWriteResult = writeRetrospective(
      projectRoot, logicalSprint, logicalEvaluations, metrics,
      undefined,
      skillMap.size > 0 ? skillMap : undefined,
      logicalResults,
      { createIfMissing: true },
    );
    sprintLogPersisted = retroWriteResult.sprintLogWritten;
    // Sprint 190 carry-over [[project_sprint189_retro_db_missing]]:
    // surface DB-write outcome so silent failures (Sprint 189 retro entry
    // missing while patterns landed) cannot recur unnoticed. Non-fatal.
    if (retroWriteResult.dbError) {
      debugLog('finalizeSprint:writeRetrospective:dbWrite',
        `Retro DB write failed for ${sprint.id} — ${retroWriteResult.dbError}`);
    } else if (retroWriteResult.dbAttempted &&
        (!retroWriteResult.sprintLogWritten || !retroWriteResult.retroWritten || !retroWriteResult.memoryWritten)) {
      debugLog('finalizeSprint:writeRetrospective:dbPartial',
        `Retro DB write partial for ${sprint.id} — sprintLog=${retroWriteResult.sprintLogWritten} ` +
        `retro=${retroWriteResult.retroWritten} memory=${retroWriteResult.memoryWritten}`);
    } else {
      debugLog('finalizeSprint:writeRetrospective:dbOk',
        `Retro DB rows persisted for ${sprint.id}`);
    }

    // Append Code-Verified DONE section to the retro entry — B8 (DB-first).
    if (codeVerifiedTasks.length > 0) {
      const section = [
        '',
        '### Code-Verified DONE',
        `${codeVerifiedTasks.length} task(s) reconciled via physical code verification:`,
        ...codeVerifiedTasks.map(id => `- ${id}: Code physically verified despite missing .result (docker HB shutdown pattern)`),
        '',
      ].join('\n');
      appendRetroSection(projectRoot, sprint.id, '### Code-Verified DONE', section);
    }
  } catch (e) { debugLog('finalizeSprint:writeRetrospective', e); }

  // ─── F1-TOK 273-004 retro wire — "Limit burn" row ────────────────
  // buildLimitBurnRow shipped + tested in Sprint 273 but was never called
  // from the retro path (0-caller dormant; found in the 2026-06-11
  // calibration analysis). Best-effort: ledger/transcript errors must
  // never block finalize.
  try {
    const limitBurnRow = await buildSprintLimitBurnRow(projectRoot, sprint.id, sprint.tasks.length);
    if (limitBurnRow) {
      const section = ['', '### Limit Burn', '', limitBurnRow, ''].join('\n');
      appendRetroSection(projectRoot, sprint.id, '### Limit Burn', section);
    }
  } catch (e) { debugLog('finalizeSprint:limitBurnRow', e); }

  // ─── MET668B (419-002) — helper-call cost + REAL files/cost retro wire ──
  // (a) Surface the previously off-ledger auxiliary (haiku helper) cost, priced from each
  //     task's envelope modelUsage minus the already-captured primary (double-count guarded).
  // (b) Render REAL files-changed/cost from the live `results` via the 418-001 seam
  //     (computeFilesChangedAndCost) — replacing the hardcoded-0 placeholders in the report.
  // Best-effort + fail-safe: never blocks finalize. Helper cost is kept SEPARATE from
  // buildUsageTotals/KPI (which stays primary-only) so it is added exactly once.
  try {
    const helper = collectHelperCost(projectRoot, authoritativeResults);
    if (helper.helperUsd > 0) {
      writeEvent(
        projectRoot, sprintIdForEvents, 'brain', '*',
        CHANNELS.METRIC_EMITTED,
        {
          name: 'sprint.helperCost', sprintId: sprint.id,
          helperUsd: helper.helperUsd,
          rows: helper.ledger.rows.length,
          unpriced: helper.ledger.unpricedCount,
        },
      );
    }
    const attributed = projectSprintWorkAttribution(authoritativeResults);
    const excluded = attributed.heldAttempts + attributed.unavailableAttempts;
    const section = buildFilesChangedCostSection(authoritativeResults, {
      helperCostUsd: helper.helperUsd,
      requireVerifiedAttribution: true,
      ...(excluded > 0
        ? {
            attributionWarning: getMessage(
              'finalize.attribution_excluded',
              opts?.config?.language ?? 'en',
              { count: String(excluded) },
            ),
          }
        : {}),
    });
    appendRetroSection(projectRoot, sprint.id, '## Files Changed & Cost', section);
  } catch (e) { debugLog('finalizeSprint:helperCostWire', e); }

  // Sprint 198 198-002 defensive fallback — guarantees a sprint-log DB
  // row even when writeRetrospective threw or its own try/catch returned
  // with sprintLogWritten=false. Closes the chronic finalize bug
  // surfaced in Sprint 197 197-002 (sprint-log-194 + sprint-log-196
  // missing). Minimal payload (sprintId + totalTasks + durationMs) is
  // enough for downstream retroactive reclassify to land a Task
  // Outcomes section in a future pass; full content is preferred but
  // optional. Silent failures are forbidden — log the error explicitly.
  if (!sprintLogPersisted) {
    try {
      const { MemoryStore } = await import('../core/memory-store.js');
      const { MEMORY_DB_FILE } = await import('../core/constants.js');
      const memDbPath = join(projectRoot, BRAIN_DIR, MEMORY_DB_FILE);
      if (existsSync(memDbPath)) {
        const store = new MemoryStore(memDbPath);
        try {
          store.upsertSprintLog(sprint.id, {
            totalTasks: metrics?.totalTasks,
            durationMs: metrics?.durationMs,
            extraTags: ['defensive-fallback'],
          });
          sprintLogPersisted = true;
          debugLog('finalizeSprint:sprintLogFallback',
            `Defensive sprint-log row written for ${sprint.id}`);
        } finally {
          store.close();
        }
      } else {
        debugLog('finalizeSprint:sprintLogFallback',
          `memory.db missing at ${memDbPath} — fallback skipped`);
      }
    } catch (e) {
      debugLog('finalizeSprint:sprintLogFallback',
        `Defensive sprint-log write failed for ${sprint.id} — ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // 5. Legacy identity-file write dropped — Memory V2, B6.
  // `.deckent/workspace/IDENTITY.md` is the user/project identity source;
  // memory.db carries its provenance+digest-bound searchable projection. The
  // finalizer never reverses that direction or overwrites user identity text.

  // 5b. Triple-link: sprint-log → memory → retro (depends_on chain)
  try {
    const { MemoryStore } = await import('../core/memory-store.js');
    const { MEMORY_DB_FILE } = await import('../core/constants.js');
    const memDbPath = join(projectRoot, BRAIN_DIR, MEMORY_DB_FILE);
    if (existsSync(memDbPath)) {
      const memStore = new MemoryStore(memDbPath);
      try {
        const sprintLogId = `sprint-log-${sprint.id}`;
        const memoryId = `memory-${sprint.id}`;
        const retroId = `retro-${sprint.id}`;

        // sprint-log depends_on memory, memory depends_on retro
        memStore.insertRelation(sprintLogId, memoryId, 'depends_on');
        memStore.insertRelation(memoryId, retroId, 'depends_on');
        // retro references sprint-log (circular awareness)
        memStore.insertRelation(retroId, sprintLogId, 'references');

        debugLog('finalizeSprint:tripleLink', `Triple-link created for ${sprint.id}`);
      } finally {
        memStore.close();
      }
    }
  } catch (e) { debugLog('finalizeSprint:tripleLink', e); }

  // 6. Update last_sprint_id in config
  try {
    updateLastSprintId(projectRoot, sprint.id);
  } catch (e) { debugLog('finalizeSprint:updateLastSprintId', e); }

  // 7. Run decay if over budget (uses auditBrainBudget for decayable-only accounting)
  // Sprint 232 PRIMARY fix: pass config.decay_after_sprints to runDecay so the
  // user-configured retention window (default 20) is honored. Previously the
  // option was dropped and runDecay fell back to a hardcoded 8 — too aggressive,
  // causing memory-loss across sprint-226/231 dogfood.
  if (!opts?.skipDecay) {
    // CORE-UNIFORMITY (slice 2): decay now flows through the mode-independent
    // runBudgetedDecay helper (shared with the autonomous per-item lifecycle).
    // Behavior unchanged — same audit → force/normal branching as before.
    runBudgetedDecay(projectRoot, sprint.id, {
      memoryBudget: opts?.config?.memory_budget ?? 900,
      decaySprints: opts?.config?.decay_after_sprints,
    });
  }

  // 7b. ADR-090 doc-tracking sync (gated, fail-safe — never breaks finalize)
  debugLog('finalizeSprint:breadcrumb', 'doc-tracking sync hook — entering');
  try {
    const dtRes = await maybeRunDocTrackingSync(projectRoot, opts?.config);
    if (dtRes.ran) debugLog('finalizeSprint:docTrackingSync', `synced ${dtRes.count ?? '?'} docs`);
  } catch (e) { debugLog('finalizeSprint:docTrackingSync', e); }

  // 8. Run afterSprint plugin hooks
  if (!opts?.skipHooks) {
    try {
      const ctx: AfterSprintContext = {
        hook: 'afterSprint',
        sprint,
        projectRoot,
      };
      await runHooks('afterSprint', ctx);
    } catch (e) { debugLog('finalizeSprint:afterSprintHook', e); }
  }

  // 8b. Update prompt-version stats for every routed task. Legacy V2 DNA
  // outcomes and V3 learning cells are separated below so no task is credited
  // twice and the live V3 router consumes only its own cell ledger.

  // F5 evolution wire (B11): record per-task use of each agent's CURRENT prompt
  // version so prompt-analytics / /api/evolution/prompt-metrics see real
  // uses/successRate (updateVersionStats was zero-caller → stats frozen at 0).
  // No-op for agents without a versioned prompt.
  const promptVersionMgr = new PromptVersionManager(projectRoot);

  // V2: Record outcomes to learnings.json (single source of truth).
  // Agent.json manifests are NOT touched here directly — stats live in
  // learnings.json and are synced to agent.json/manifest.json below (8d2).
  try {
    const { OutcomeTracker } = await import('./outcome-tracker.js');
    const { assessQuality } = await import('./quality-assessor.js');
    const tracker = new OutcomeTracker(projectRoot);
    const catalogOutcomes = collectCatalogStatsTerminalOutcomes(
      projectRoot,
      logicalTasks,
      logicalEvaluations,
      logicalResultsMap,
      skillAttributionByLogicalTask,
      logicalDelivery,
    );

    // FINALIZE-RECOUNT guard (Sprint 268, 1b): recordOutcome appends
    // sprint.id to learnings.recentSprints on the first record and that
    // list is append-only — its presence is a durable "stats already
    // recorded for this sprint" marker. A re-finalize (`finalize --force`
    // on an already-finalized sprint) must NOT re-record: the sprint-267
    // live bug re-counted every task (uses+N) while archived results read
    // as missing/NO_GO (success+0). Corrections to a recorded sprint go
    // through tracker.reclassifyTaskOutcome instead of double-recording.
    // The downstream steps (rule evolution, manifest sync, promotions)
    // still run — they derive from accumulated learnings and are
    // idempotent on unchanged data.
    const statsAlreadyRecorded = tracker.getLearnings().recentSprints.includes(sprint.id);
    if (statsAlreadyRecorded) {
      debugLog('finalizeSprint:routing-outcomes',
        `Stats already recorded for ${sprint.id} — skipping re-record (idempotent re-finalize)`);
    } else {
      const catalogOutcomesByTask = new Map(catalogOutcomes.map(outcome => [outcome.taskId, outcome]));
      for (const task of logicalTasks) {
        const terminalOutcome = catalogOutcomesByTask.get(task.id);
        if (!terminalOutcome) continue;
        const evaluation = terminalOutcome.evaluation;
        const taskResult = logicalResultsMap.get(task.id);
        if (!taskResult) continue;
        // F5: record use against the agent's current prompt version (V2 path).
        if (terminalOutcome.agentId) {
          promptVersionMgr.recordCurrentVersionUse(terminalOutcome.agentId, evaluation);
        }

        // Quality assessment — multi-dimensional scoring beyond GO/NO_GO
        let qualityScore: number | undefined;
        if (taskResult) {
          try {
            const quality = assessQuality(task, taskResult, evaluation as unknown as string);
            qualityScore = quality.overall;
          } catch (e) { debugLog('finalizeSprint:assessQuality', e); }
        }

        tracker.recordOutcome({
          taskId: task.id,
          sprintId: sprint.id,
          taskDNA: deriveFinalizerTaskDNA(task),
          agentId: terminalOutcome.agentId,
          skillIds: [...(terminalOutcome.creditedSkillIds ?? terminalOutcome.skillIds)],
          skillExposureIds: [...new Set([
            ...(terminalOutcome.selectedSkillIds ?? []),
            ...(terminalOutcome.deliveredSkillIds ?? []),
          ])].sort(),
          skillAttributionState: terminalOutcome.skillAttributionState ?? 'HOLD',
          evaluation: evaluation as unknown as 'DONE' | 'GO_WITH_TECH_DEBT' | 'NO_GO',
          coverage: taskResult.coverage ?? 0,
          qualityScore,
          routingVersion: task.routingMeta?.routingVersion ?? 'v2',
        });

      }
      writeCatalogStatsTerminalOutcomes(projectRoot, sprint.id, catalogOutcomes);
      debugLog('finalizeSprint:routing-outcomes', `Recorded ${logicalTasks.length} logical routing outcomes to learnings.json`);
    }

    // ROUTING-V3 learning cells (673-002 closure). Deliberately OUTSIDE the V2
    // `statsAlreadyRecorded` wrapper: learning-cells carries its own
    // (taskId, sprintId) idempotency, so a re-finalize can repair a V3 ledger
    // the V2 marker would otherwise lock out forever. Three contract fixes vs
    // the retired in-wrapper block: (a) the domain comes from the route-time
    // `routingMeta.dominantDomain` — never re-derived at finalize time;
    // (b) NO fallback key: a task without a route-time domain writes NO cell
    // (the old `?? 'core-runtime'` literal minted keys the reader can never
    // match — a measured 279-uses black hole); (c) infra deaths pass
    // `failureClass` through so the ledger can skip them (no capability
    // signal in an OOM/SIGKILL).
    try {
      const { recordOutcome: recordCell } = await import('../core/routing/learning-cells.js');
      for (const outcome of catalogOutcomes) {
        const task = logicalTasks.find(t => t.id === outcome.taskId);
        const v3Meta = task?.routingMeta;
        if (!task || v3Meta?.routingVersion !== 'v3' || !outcome.agentId) continue;
        const dominantDomain = v3Meta.dominantDomain;
        if (!dominantDomain) continue;
        const taskResult = logicalResultsMap.get(task.id);
        let qualityScore: number | undefined;
        if (taskResult) {
          try {
            qualityScore = assessQuality(task, taskResult, outcome.evaluation as unknown as string).overall;
          } catch (e) { debugLog('finalizeSprint:assessQuality:v3', e); }
        }
        recordCell(projectRoot, {
          taskId: task.id,
          sprintId: sprint.id,
          workType: (v3Meta.workType ?? 'build') as import('../core/routing/types.js').WorkType,
          domain: dominantDomain,
          agentId: outcome.agentId,
          verdict: outcome.evaluation as unknown as 'DONE' | 'GO_WITH_TECH_DEBT' | 'NO_GO',
          quality: qualityScore ?? 50,
          ...(taskResult?.failureClass ? { failureClass: taskResult.failureClass } : {}),
        });
      }
    } catch (e) {
      debugLog('finalizeSprint:routing-cells', e);
    }

    // 8d. Legacy RuleEvolver production writes are retired. V3 never consumed
    // those activation rules, so continuing to mint them would be a semantic
    // dead producer and an unjournaled future feedback risk.

    // 8e. Evaluate promotions/demotions from causal receipt-backed stats only.
    try {
      const { PromotionPipeline } = await import('./promotion-pipeline.js');
      const pipeline = new PromotionPipeline(projectRoot);
      const promotions = pipeline.evaluatePromotions(tracker);
      const demotions = pipeline.evaluateDemotions(tracker);
      for (const p of promotions.filter(r => r.action === 'promote')) {
        debugLog('finalizeSprint:promotion', `${p.entityType} '${p.entityId}': ${p.reason}`);
        try {
          pipeline.promote(p.entityId, p.entityType);
        } catch (promoteErr) {
          debugLog('finalizeSprint:promotion', `Failed to promote ${p.entityType} '${p.entityId}': ${promoteErr}`);
        }
      }
      for (const d of demotions.filter(r => r.action === 'demote')) {
        debugLog('finalizeSprint:demotion', `${d.entityType} '${d.entityId}': ${d.reason}`);
        try {
          pipeline.demote(d.entityId, d.entityType);
        } catch (demoteErr) {
          debugLog('finalizeSprint:demotion', `Failed to demote ${d.entityType} '${d.entityId}': ${demoteErr}`);
        }
      }
    } catch (e) { debugLog('finalizeSprint:promotionDemotion', e); }
  } catch (err) {
    debugLog('finalizeSprint:skill-attribution-projection', err);
    // Selection/delivery/credit truth is a settlement invariant after the P0
    // cutover. Silently completing while its durable projections failed would
    // recreate attribution poisoning on the next run.
    throw new FinalizerTerminalEvidenceError('SKILL_ATTRIBUTION_PROJECTION_HOLD');
  }

  // 9. Update project docs
  if (opts?.config) {
    try {
      updateProjectDocs(
        projectRoot,
        { sprint: logicalSprint, evaluations: logicalEvaluations, metrics },
        opts.config,
        logicalResults,
      );
    } catch (e) { debugLog('finalizeSprint:updateProjectDocs', e); }
  }

  // 10. Rich output (non-fatal — sprint completes even if formatting fails)
  debugLog('finalizeSprint:breadcrumb', 'Step 10 (richOutput) — entering');
  try {
    const attributedDiff = projectSprintWorkAttribution(logicalResults);
    const gitDiffLines = attributedDiff.filesChanged.map(path => {
      const attempts = attributedDiff.fileAttemptIds[path] ?? [];
      return `${path} | attempt ${attempts.join(',')}`;
    });
    const excludedAttribution = attributedDiff.heldAttempts + attributedDiff.unavailableAttempts;
    if (excludedAttribution > 0) {
      gitDiffLines.push(getMessage(
        'finalize.attribution_excluded',
        opts?.config?.language ?? 'en',
        { count: String(excludedAttribution) },
      ));
    }
    const gitDiff = gitDiffLines.join('\n');
    // output_mode lives on DeckentConfig (raw), not ResolvedConfig — access via cast
    const rawConfig = opts?.config as Record<string, unknown> | undefined;
    const outputMode = (rawConfig?.['output_mode'] as string) ?? 'normal';
    const richInput = { id: sprint.id, number: sprint.number, tasks: logicalTasks.map(t => ({ id: t.id, title: t.title })), metrics: { ...metrics } };
    // Build agent performance data for the performance table
    const attemptedSprint: Sprint = {
      ...logicalSprint,
      tasks: logicalTasks.filter(task => {
        const result = logicalResultsMap.get(task.id);
        return result !== undefined && result.cascadeSkipped !== true;
      }),
    };
    const agentRows = buildAgentPerformance(attemptedSprint, logicalEvaluations, logicalResults);
    const agentPerf = agentRows.map(row => ({
      agentId: row.agent,
      totalTasks: row.tasks,
      doneTasks: row.done,
      successRate: row.tasks > 0 ? Math.round((row.done / row.tasks) * 100) : 0,
    }));
    // Extract learnings from evaluation results (task notes from results)
    const learnings = logicalResults
      .filter(r => r.notes && r.notes.trim().length > 0)
      .map(r => r.notes as string)
      .slice(0, 5);
    const richOutput = formatRichSprintSummary(
      richInput,
      logicalEvaluations,
      { gitDiff, agentPerf, learnings, outputMode: outputMode as 'quiet' | 'normal' | 'verbose' },
    );
    if (richOutput) console.log(richOutput);
  } catch (e) { debugLog('finalizeSprint:richOutput', e); }

  // 10b. Self-audit gate: reuse only exact authority; stale evidence is archived
  // and replaced by an on-demand evaluation before status can be projected.
  debugLog('finalizeSprint:breadcrumb', 'Step 10b (selfAuditGate) — entering');
  let gateResult: SelfAuditResult | null = null;
  const recentWorksDir = join(projectRoot, RECENT_WORKS_DIR);
  const gateAuthorityPath = join(recentWorksDir, `${sprint.id}-gate-authority.json`);
  type PersistedGateAuthority = {
    readonly authority: SprintFinalizerGateAuthority;
    readonly evidence: SelfAuditResult;
  };
  try {
    await fsPromises.mkdir(recentWorksDir, { recursive: true });
    const persisted = readJsonSafe<PersistedGateAuthority>(gateAuthorityPath);
    const initialAuthority = persisted?.authority
      ?? createSprintFinalizerGateAuthority(sprint.id);
    const taskSetDigest = createHash('sha256')
      .update(JSON.stringify(attemptTasks.map(task => task.id).sort()))
      .digest('hex');
    const attemptWinners = Object.fromEntries(
      terminalTruth.terminalEvidence.logicalTasks
        .flatMap(task => task.resolvingAttempt
          ? [[task.logicalTaskId, task.resolvingAttempt.attemptId] as const]
          : []),
    );
    const codeDigest = terminalTruth.logicalSettlementDigest;
    const configDigest = createHash('sha256')
      .update(JSON.stringify(opts?.config ?? null))
      .digest('hex');
    const snapshot = {
      runId: opts?.flowId ?? sprint.id,
      generation: opts?.coordinatorGeneration ?? 1,
      taskSetDigest,
      attemptWinners,
      codeDigest,
      configDigest,
    };
    const priorInput = initialAuthority.gate?.input;
    const observedAt = priorInput
      && priorInput.runId === snapshot.runId
      && priorInput.generation === snapshot.generation
      && priorInput.taskSetDigest === snapshot.taskSetDigest
      && JSON.stringify(priorInput.attemptWinners) === JSON.stringify(snapshot.attemptWinners)
      && priorInput.codeDigest === snapshot.codeDigest
      && priorInput.configDigest === snapshot.configDigest
        ? priorInput.observedAt
        : new Date().toISOString();
    const currentInput: SprintFinalizerGateInput = { ...snapshot, observedAt };
    let evaluatedEvidence: SelfAuditResult | null = null;
    const resolved = await resolveOrEvaluateFreshFinalizerGate({
      authority: initialAuthority,
      currentInput,
      evaluate: async () => {
        evaluatedEvidence = await runSelfAuditGate(sprint.id, projectRoot, {
          scopedManifest: deriveScopedSelfAuditManifest(attemptTasks, authoritativeResults),
          selfAuditEcosystem: resolveSelfAuditEcosystem(projectRoot ?? process.cwd()),
        });
        return evaluatedEvidence.overallGate === 'PASS' ? 'PASS' : 'FAIL';
      },
    });
    gateResult = evaluatedEvidence ?? persisted?.evidence ?? null;
    if (gateResult === null || (gateResult.overallGate === 'PASS') !== (resolved.outcome === 'PASS')) {
      throw new FinalizerFreshGateHoldError('FINALIZER_GATE_EVIDENCE_HOLD');
    }
    const authorityTempPath = `${gateAuthorityPath}.${process.pid}.${randomUUID()}.tmp`;
    await fsPromises.writeFile(
      authorityTempPath,
      JSON.stringify({ authority: resolved.authority, evidence: gateResult }, null, 2),
    );
    await fsPromises.rename(authorityTempPath, gateAuthorityPath);
    debugLog('finalizeSprint:selfAuditGate', `${resolved.reused ? 'Reused' : 'Computed'} authoritative gate: overallGate=${gateResult.overallGate}`);
    const currentStatus = sprint.status ?? '';
    const newStatus = applyAuthoritativeGateStatus(
      currentStatus,
      resolved.outcome,
      terminalTruth.logicalMetrics.noGoTasks === 0
        && terminalTruth.logicalMetrics.unevaluatedTasks === 0,
    );
    if (newStatus !== currentStatus) {
      sprint.status = newStatus as Sprint['status'];
      debugLog('finalizeSprint:selfAuditGate', `Status updated: ${currentStatus} → ${newStatus}`);
    }
  } catch (e) {
    if (e instanceof FinalizerFreshGateHoldError) throw e;
    throw new FinalizerFreshGateHoldError(
      `FINALIZER_GATE_EVALUATION_HOLD:${e instanceof Error ? e.message : String(e)}`,
    );
  }
  // Write gate.json to .deckent/recently-works/ — ALWAYS (even on gate failure or fallback).
  // Canonical location since the Sprint 150 de-scatter (gate/seq/events/pre-archive all live
  // under recently-works, managed by sprint-file-retention). Matches the `deckent audit`
  // CLI + MCP writers; the legacy `.deckent/` root path was outside retention (files piled up
  // un-pruned and invisible to listSprintFiles).
  try {
    await fsPromises.mkdir(recentWorksDir, { recursive: true });
    const gatePath = join(recentWorksDir, `${sprint.id}-gate.json`);
    await fsPromises.writeFile(gatePath, JSON.stringify(gateResult, null, 2));
    debugLog('finalizeSprint:selfAuditGate', `Gate result written to ${gatePath} overallGate=${gateResult.overallGate}`);

    // ─── GATE_COMPUTED event (ADR-035 — AUDITOR→BRAIN:GATE_COMPUTED) ───
    // Brain emits on behalf of the self-audit gate (finalizeSprint is in-process auditor role).
    // Event stream source is 'auditor' to match ADR-037 authority matrix.
    writeEvent(
      projectRoot, sprintIdForEvents, 'auditor', 'brain',
      CHANNELS.GATE_COMPUTED,
      {
        sprintId: sprint.id,
        overallGate: gateResult.overallGate,
        tscStatus: gateResult.tsc.status,
        vitestFail: gateResult.vitest.delta.fail,
        vitestPass: gateResult.vitest.delta.pass,
        honestyViolations: gateResult.honesty.violations,
        observabilityOk: gateResult.observability.metricsJsonlExists,
      },
    );
  } catch (writeErr) {
    debugLog('finalizeSprint:selfAuditGate', `WARNING: Failed to write gate.json: ${writeErr}`);
  }
  // Append Gate Failure section to the retro entry if the gate failed — B8.
  if (gateResult.overallGate === 'GATE_FAILURE') {
    const errors: string[] = [];
    if (gateResult.tsc.status === 'FAIL') errors.push(...gateResult.tsc.errors.slice(0, 5));
    if (gateResult.vitest.status === 'FAIL') errors.push(`vitest: ${gateResult.vitest.delta.fail} failing tests`);
    if (gateResult.honesty.violations > 0) errors.push(`honesty violations: ${gateResult.honesty.flaggedTasks.join(', ')}`);
    const gateSection = [
      '',
      '### Gate Failure',
      `Self-audit gate failed for sprint ${sprint.id}. Status: ${GO_WITH_GATE_FAILURE}.`,
      '',
      ...errors.map(e => `- ${e}`),
    ].join('\n') + '\n';
    appendRetroSection(projectRoot, sprint.id, '### Gate Failure', gateSection);
  }

  // 10b2. Tech-debt gate: downgrade sprint outcome when debt ratio exceeds configured threshold.
  // Flag-gated: gate?.max_tech_debt_ratio absent or 0 → byte-identical (default-off).
  // applyTechDebtDowngrade determines severity via completion-ratio thresholds (0.8 / 0.5).
  debugLog('finalizeSprint:breadcrumb', 'Step 10b2 (techDebtGate) — entering');
  try {
    const maxDebtRatio = opts?.config?.gate?.max_tech_debt_ratio;
    if (maxDebtRatio && maxDebtRatio > 0 && metrics.totalTasks > 0) {
      const debtRatio = metrics.techDebtTasks / metrics.totalTasks;
      if (debtRatio > maxDebtRatio) {
        const completionRatio = 1 - debtRatio;
        const downgradeResult = applyTechDebtDowngrade(
          'DONE',
          { selfAssessment: 'DONE' },
          completionRatio,
        );
        // Gate triggered: severity determines whether outcome is GO_WITH_TECH_DEBT or GATE_FAILURE.
        // applyTechDebtDowngrade: completionRatio < 0.5 → 'NO_GO' (severe) → GATE_FAILURE.
        const newStatus = downgradeResult.decision === 'NO_GO'
          ? GO_WITH_GATE_FAILURE
          : TaskEvaluation.GO_WITH_TECH_DEBT;
        sprint.status = newStatus as Sprint['status'];
        debugLog('finalizeSprint:techDebtGate',
          `Sprint ${sprint.id}: debt-ratio=${(debtRatio * 100).toFixed(1)}% > max=${(maxDebtRatio * 100).toFixed(1)}% → ${newStatus} (${downgradeResult.reason ?? 'gate triggered'})`);
      }
    }
  } catch (e) { debugLog('finalizeSprint:techDebtGate', e); }
  debugLog('finalizeSprint:breadcrumb', 'Step 10b2 (techDebtGate) — done');

  // 10c2. Rotate metrics file (Sprint 150 T-030)
  debugLog('finalizeSprint:breadcrumb', 'Step 10c2 (metricsRotation) — entering');
  try {
    const rotationConfig: Partial<ObservabilityRotationConfig> = {
      ...(opts?.config?.observability?.rotation ?? {}),
    };
    const rotationResult = rotateMetricsFile(projectRoot, sprint.id, rotationConfig);
    if (rotationResult.rotated) {
      debugLog('finalizeSprint:metricsRotation',
        `Rotated ${rotationResult.originalSizeBytes} bytes → ${rotationResult.archivePath} ` +
        `(${rotationResult.archivedSizeBytes} bytes gzipped), pruned ${rotationResult.pruned.length} old archives`);
    }
  } catch (e) { debugLog('finalizeSprint:metricsRotation', `WARNING: metrics rotation failed: ${e}`); }
  debugLog('finalizeSprint:breadcrumb', 'Step 10c2 (metricsRotation) — done');

  // 10d. Regenerate features manifest (Sprint 150 Task 029 — Feature Manifest Canlılaştırma)
  debugLog('finalizeSprint:breadcrumb', 'Step 10d (featuresManifest) — entering');
  try {
    const syncScript = join(projectRoot, 'scripts', 'sync-manifest.mjs');
    if (existsSync(syncScript)) {
      const syncResult = spawnSync('node', [syncScript, '--root', projectRoot], {
        encoding: 'utf-8',
        timeout: 30000,
        cwd: projectRoot,
      });
      debugLog('finalizeSprint:featuresManifest', `Sync exit=${syncResult.status}: ${(syncResult.stdout || '').trim()}`);
    }
  } catch (e) { debugLog('finalizeSprint:featuresManifest', `WARNING: features manifest sync failed: ${e}`); }

  // 11. Adaptive thresholds: auto-adjust agent_min_score + coverage_threshold based on recent sprints
  if (opts?.config?.adaptive_thresholds) {
    try {
      await applyAdaptiveThresholds(projectRoot, opts.config, sprint.id);
    } catch (err) {
      debugLog('finalizeSprint:adaptive', `Adaptive threshold update failed: ${err}`);
    }
  }

  // Publish the generation-fenced terminal receipt at the single archive
  // boundary. Exact attempts and every outcome-shaping gate have settled by
  // this point. Receipt publication is not completion authority: a settled
  // NO_GO remains FAILED/BLOCKED in the reassembled evidence, while stale,
  // partial, deferred, or otherwise held evidence leaves publication null.
  let terminalReceiptPublication: FinalizerTerminalReceiptPublication | null = null;
  try {
    terminalReceiptPublication = opts?.resumeTerminalReceipt
      ? resumePersistedTerminalReceipt({
          projectRoot,
          sprintId: sprint.id,
          expected: opts.resumeTerminalReceipt,
          terminalEvidence: terminalTruth.terminalEvidence,
        })
      : publishFencedSprintTerminalReceipt({
          projectRoot,
          sprint,
          truth: terminalTruth,
          ...(opts?.flowId ? { runId: opts.flowId } : {}),
          ...(opts?.coordinatorGeneration !== undefined
            ? { coordinatorGeneration: opts.coordinatorGeneration }
            : {}),
        });
    debugLog(
      'finalizeSprint:terminalReceipt',
      `Receipt published at ${terminalReceiptPublication.artifactPath}`,
    );
  } catch (e) {
    debugLog('finalizeSprint:terminalReceipt', `Publication held: ${e}`);
    // Terminal evidence is a hard authority boundary. Continuing after a
    // held publication used to write a COMPLETE job/state without a receipt,
    // leaving status, cleanup, and re-finalize surfaces in contradiction.
    // Preserve the original typed reason when possible and fail closed before
    // any archive, job summary, or terminal authority is published.
    if (e instanceof FinalizerTerminalEvidenceError) throw e;
    throw new FinalizerTerminalEvidenceError(
      `TERMINAL_RECEIPT_PUBLICATION_FAILED:${e instanceof Error ? e.message : String(e)}`,
    );
  }

  const receiptAllowsArchive =
    terminalReceiptPublication?.terminalEvidence.cleanupEligibility.candidate === true;
  if (!receiptAllowsArchive) {
    throw new FinalizerTerminalEvidenceError('TERMINAL_RECEIPT_NOT_CLEANUP_ELIGIBLE');
  }
  if (receiptAllowsArchive) {

  // 12a. Retire the provider execution intervals THIS generation owns (row 3296).
  // COMPLETE and cleanup share this boundary: the fenced receipt above already
  // proved cleanup eligibility, and archiving below removes the task artifacts
  // that keep these intervals inside the exact current task set. Reconciling
  // here — and only over `terminalTruth.attempts`, the exact settling attempt
  // identities — closes what this run owns while foreign and historical
  // intervals stay open, forensic, and harmless to the next run. Idempotent, so
  // a re-finalize retires nothing further.
  debugLog('finalizeSprint:breadcrumb', 'Step 12a (providerObservationRetirement) — entering');
  retireTerminalProviderExecutionObservations(projectRoot, terminalTruth, 'finalizeSprint');

  // 12. Archive DIRECTIVES.md — always archive copy; PRESERVE working DIRECTIVES.md by default.
  //
  // Sprint 168 C0a-4 (BUG-CC fix, Alperen Pre-Flight Step 16 Option B):
  //   - auto_archive_directives config flag default flipped: true → FALSE
  //   - Default: DIRECTIVES.md is PRESERVED (archive copy still always written)
  //   - Opt-in: `auto_archive_directives: true` restores legacy placeholder-overwrite
  //
  // Rationale: Sprint 167 BUG-CC live evidence — placeholder overwrite =
  // catastrophic sprint context loss. Conservative default (preserve) safer.
  // See ADR-046 Amendment (Sprint 168 C0a-4).
  debugLog('finalizeSprint:breadcrumb', 'Step 12 (archiveDirectives) — entering');
  try {
    const rawCfg = opts?.config as Record<string, unknown> | undefined;
    const autoArchive = rawCfg?.['auto_archive_directives'] ?? false;
    archiveDirectives(projectRoot, sprint.id, 'CLEANUP', { autoArchive: autoArchive === true });
  } catch (e) {
    debugLog('finalizeSprint:archiveDirectives', e);
    throw new FinalizerTerminalEvidenceError(
      `SPRINT_ARCHIVE_DIRECTIVES_FAILED:${e instanceof Error ? e.message : String(e)}`,
    );
  }

  // 12b. Settle task artifacts into the canonical archive destination
  // (resolveTaskArtifactArchiveDir — the single authority, row 3314). Guard:
  // pre-archive snapshot + non-terminal preservation, now held INSIDE the
  // canonical location with a typed marker instead of loose in the tasks root.
  debugLog('finalizeSprint:breadcrumb', 'Step 12b (archiveTaskArtifacts) — entering');
  try {
    // Step 12b-i: Create pre-archive snapshot for rollback safety
    const snapshot = createPreArchiveSnapshot(projectRoot, sprint.id);
    if (snapshot) {
      debugLog('finalizeSprint:preArchiveSnapshot', `Snapshot created: ${snapshot.fileCount} files, hash=${snapshot.hash.slice(0, 12)}...`);
    }

    // Step 12b-ii: Classify tasks by status — only archive terminal (DONE/NO_GO).
    // classifyTaskFiles stays the sole authority on what counts as non-terminal.
    const tasksDir = join(projectRoot, TASKS_DIR);
    const sprintMatch = sprint.id.match(/sprint-(\d+)/);
    let plan: TaskArtifactArchivePlan = { archive: [], preserve: [] };
    if (existsSync(tasksDir) && sprintMatch) {
      const prefix = `task-${sprintMatch[1]}-`;
      const allFiles = readdirSync(tasksDir) as string[];
      const sprintFiles = allFiles.filter(f => f.startsWith(prefix));
      const { archivable, preserved } = classifyTaskFiles(tasksDir, prefix, sprintFiles);
      plan = { archive: archivable, preserve: preserved };

      if (preserved.length > 0) {
        debugLog('finalizeSprint:archiveGuard', `Preserving ${preserved.length} active task files: ${preserved.slice(0, 5).join(', ')}${preserved.length > 5 ? '...' : ''}`);
      }
    }

    // Step 12b-iii: One destination, zero residue — terminal artifacts, preserved
    // non-terminal artifacts, legacy tasks-local archives and hidden worker
    // artifacts all land under the same resolved directory.
    const settlement = archiveTaskArtifacts(projectRoot, sprint.id, plan);
    if (settlement.failures.length > 0) {
      throw new FinalizerTerminalEvidenceError(
        `SPRINT_ARCHIVE_TASK_SETTLEMENT_FAILED:${settlement.failures.join('|')}`,
      );
    }
    debugLog('finalizeSprint:archiveTaskArtifacts',
      `Archived ${settlement.archived.length} → ${settlement.destination} `
      + `(preserved=${settlement.preserved.length}, consolidated=${settlement.consolidated.length}, `
      + `residue=${settlement.residueSwept.length}, failures=${settlement.failures.length})`);
  } catch (e) {
    debugLog('finalizeSprint:archiveTaskArtifacts', e);
    if (e instanceof FinalizerTerminalEvidenceError) throw e;
    throw new FinalizerTerminalEvidenceError(
      `SPRINT_ARCHIVE_TASK_SETTLEMENT_FAILED:${e instanceof Error ? e.message : String(e)}`,
    );
  }

  // 12c. Consolidate legacy `.tasks/archive/` staging into canonical archives.
  debugLog('finalizeSprint:breadcrumb', 'Step 12c (cleanTasksArchive) — entering');
  try {
    const removed = cleanTasksArchive(projectRoot);
    debugLog('finalizeSprint:cleanTasksArchive', `Consolidated ${removed} legacy .tasks/archive/ dirs`);
  } catch (e) { debugLog('finalizeSprint:cleanTasksArchive', e); }

  // 12d. Sprint file retention — clean counters, migrate forensic files, enforce keep_last_n + size_cap
  debugLog('finalizeSprint:breadcrumb', 'Step 12d (sprintFileRetention) — entering');
  try {
    // Read retention config from project config if available
    let retentionConfig: Record<string, unknown> = {};
    try {
      const cfgPath = join(projectRoot, '.deckent', 'config.json');
      if (existsSync(cfgPath)) {
        const raw = JSON.parse(readFileSync(cfgPath, 'utf-8'));
        if (raw?.sprint_file_retention) retentionConfig = raw.sprint_file_retention;
      }
    } catch { /* use defaults */ }

    const retentionResult = runRetention(
      projectRoot,
      sprint.id,
      retentionConfig,
      { deferCounterCleanup: true },
    );
    debugLog('finalizeSprint:sprintFileRetention',
      `Retention complete: archived=${retentionResult.archived.length}, countersDeleted=${retentionResult.countersDeleted.length}, forensicMoved=${retentionResult.forensicMoved.length}, reconciled=${retentionResult.reconciledSprintIds.length}, bytesFreed=${retentionResult.bytesFreed}`);
  } catch (e) {
    debugLog('finalizeSprint:sprintFileRetention', e);
    throw new FinalizerTerminalEvidenceError(
      `SPRINT_ARCHIVE_RETENTION_FAILED:${e instanceof Error ? e.message : String(e)}`,
    );
  }

  // 12e. Prune stale cross-sprint handoff files (B-HANDOFF-PRUNE — Sprint 331 331-006).
  // `.tasks/handoffs/` is an append-only registry that grows without bound across
  // sprints. pruneStaleHandoffs deletes handoffs whose endpoints are BOTH outside
  // THIS sprint, keeping in-flight ones. Self-contained + fail-safe (never throws) —
  // it can never fail or block finalize. Groups with the 12c/12d storage-retention hooks.
  debugLog('finalizeSprint:breadcrumb', 'Step 12e (pruneStaleHandoffs) — entering');
  const prunedHandoffs = pruneStaleHandoffs(projectRoot, sprint);
  if (prunedHandoffs > 0) {
    debugLog('finalizeSprint:pruneStaleHandoffs', `Pruned ${prunedHandoffs} stale handoff file(s)`);
  }

  // 12f. Scheduler-shadow journal retention — archive .deckent/runtime/scheduler-shadow/*.jsonl
  // files older than retention_days (age-based, fail-soft, mirrors Step 12d).
  debugLog('finalizeSprint:breadcrumb', 'Step 12f (schedulerShadowRetention) — entering');
  try {
    // Read retention config from project config if available
    let schedulerShadowRetentionConfig: Record<string, unknown> = {};
    try {
      const cfgPath = join(projectRoot, '.deckent', 'config.json');
      if (existsSync(cfgPath)) {
        const raw = JSON.parse(readFileSync(cfgPath, 'utf-8'));
        if (raw?.scheduler_shadow_retention) schedulerShadowRetentionConfig = raw.scheduler_shadow_retention;
      }
    } catch { /* use defaults */ }

    const schedulerShadowResult = archiveStaleSchedulerShadowJournals(projectRoot, schedulerShadowRetentionConfig);
    debugLog('finalizeSprint:schedulerShadowRetention',
      `Retention complete: archived=${schedulerShadowResult.archived.length}, bytesFreed=${schedulerShadowResult.bytesFreed}`);
  } catch (e) { debugLog('finalizeSprint:schedulerShadowRetention', e); }
  } else {
    debugLog(
      'finalizeSprint:archiveBoundary',
      'Archive and retention held until a cleanup-eligible terminal receipt exists',
    );
  }

  // 13. Write job completion summary to .deckent/runtime/jobs/ for MCP polling and CLI notification
  debugLog('finalizeSprint:breadcrumb', 'Step 13 (jobSummary) — entering');
  try {
    const jobsDir = join(projectRoot, JOBS_DIR);
    mkdirSync(jobsDir, { recursive: true });

    // Build agent breakdown
    const agentBreakdown: Record<string, number> = {};
    for (const task of logicalTasks) {
      const result = logicalResultsMap.get(task.id);
      if (!result || result.cascadeSkipped === true) continue;
      const agent = logicalDelivery.get(task.id)?.agentId ?? 'generic';
      agentBreakdown[agent] = (agentBreakdown[agent] ?? 0) + 1;
    }
    const agentParts = Object.entries(agentBreakdown).map(([a, c]) => `${a}(${c})`).join(', ');

    // Format duration — Sprint 268 FINALIZE fix: without a recoverable
    // startedAt the computed durationMs is a meaningless ~0 (calculateMetrics
    // falls back to Date.now() for the start). Report 'unknown' honestly
    // instead of a fake "0sn" (sprint-267 live finding: Duration=0ms).
    const durationMs = metrics.durationMs;
    const mins = Math.floor(durationMs / 60000);
    const secs = Math.floor((durationMs % 60000) / 1000);
    const durationStr = !sprint.startedAt
      ? 'unknown'
      : mins > 0 ? `${mins}dk ${secs}sn` : `${secs}sn`;
    const usageTotals = terminalTruth.usageTotals;

    // completedTasks already includes TECH_DEBT (see calculateMetrics), so use it directly
    const donePure = metrics.completedTasks - metrics.techDebtTasks;
    const summary = `Sprint ${sprint.id} tamamlandı (${durationStr}) — ${metrics.completedTasks}/${metrics.totalTasks} task başarılı: ${donePure} DONE, ${metrics.techDebtTasks} TECH_DEBT, ${metrics.noGoTasks} NO_GO | Agent: ${agentParts}`;

    // Build rich evaluations with per-task details from results
    const richEvaluations: Record<string, {
      evaluation: string;
      title: string;
      agent: string;
      skills: string[];
      reason: string;
      filesChanged: string[];
      linesAdded: number;
      linesRemoved: number;
      testsPassed: boolean;
      coverage: number;
      selfAssessment: string;
      techDebtDetail: string;
    }> = {};
    for (const [taskId, evaluation] of logicalEvaluations) {
      const taskResult = logicalResultsMap.get(taskId);
      const task = logicalTasks.find(t => t.id === taskId);
      const delivery = logicalDelivery.get(taskId);
      const isTechDebt = evaluation === TaskEvaluation.GO_WITH_TECH_DEBT;
      const work = projectAttributedTaskWork(taskResult);
      richEvaluations[taskId] = {
        evaluation,
        title: task?.title ?? '',
        agent: delivery?.agentId ?? 'generic',
        skills: [...(delivery?.skillIds ?? [])],
        reason: taskResult?.notes ?? '',
        filesChanged: [...work.filesChanged],
        linesAdded: work.linesAdded,
        linesRemoved: work.linesRemoved,
        testsPassed: taskResult?.testsPassed ?? false,
        coverage: taskResult?.coverage ?? 0,
        selfAssessment: taskResult?.selfAssessment ?? evaluation,
        techDebtDetail: isTechDebt ? (taskResult?.notes ?? '') : '',
      };
    }

    // Rich completion-record (TERM5-FIN — sprint-427 task 1): additive-only,
    // appended as a NEW key below — every pre-existing jobData field/value
    // stays exactly as it was.
    const completionRecord = buildSprintCompletionRecord(
      logicalSprint,
      logicalEvaluations,
      logicalResultsMap,
      opts?.flowId,
      terminalTruth,
    );

    const jobFile = join(jobsDir, `${sprint.id}.json`);
    const jobData = {
      status: 'COMPLETE',
      sprintId: sprint.id,
      summary,
      completedAt: new Date().toISOString(),
      metrics: {
        totalTasks: metrics.totalTasks,
        done: donePure,
        techDebt: metrics.techDebtTasks,
        noGo: metrics.noGoTasks,
        duration: durationStr,
        durationMs: metrics.durationMs,
        billedCostUsd: usageTotals.costUsd,
        referenceCostUsd: usageTotals.referenceCostUsd ?? 0,
        unknownBillingTaskCount: usageTotals.unknownBillingTaskCount ?? 0,
      },
      agentBreakdown,
      evaluations: richEvaluations,
      completionRecord,
    };
    writeFileSync(jobFile, JSON.stringify(jobData, null, 2) + '\n');
    debugLog('finalizeSprint:jobSummary', `Job summary written to ${jobFile}`);
  } catch (e) { debugLog('finalizeSprint:jobSummary', e); }

  // 14. Post-finalize hook chain (Sprint 143 Task 10)
  // Order: (1) memory export → (2) identity regen → (3) adr insert → (4) rule regen hook
  // ADR-046 Step Ordering Contract; ruleRegen MUST observe ADRs inserted by adrInsert.
  // Changelog and sprint-log are already handled by doc-updaters registry in step 9.
  debugLog('finalizeSprint:breadcrumb', 'Step 14 (postFinalizeHooks) — entering');
  let postFinalizeResult: PostFinalizeHookResult | null = null;
  try {
    // ── Step 4 ruleRegen invocation (Sprint 168 C0a-2) ─────────────
    // Sprint 167 T3 HIGH regression: when sprint-finalizer.ts was called
    // without an explicit `onRuleRegen` callback, Step 4 was silently
    // skipped, leaving `.claude/rules/brain.md` Active ADR Constraints
    // stale (44/50 ADRs). The fix here provides a default callback that
    // invokes `regenerateRules(projectRoot)` — which queries
    // `store.getByType('adr')` against the post-Step-3 memory.db and
    // re-renders rules for all 4 provider dirs (claude / codex / gemini
    // / cursor). Callers passing their own `opts.onRuleRegen` (e.g. tests
    // or override paths) bypass the default. ADR-046 Step 4 contract.
    let resolvedOnRuleRegen = opts?.onRuleRegen;
    if (!resolvedOnRuleRegen) {
      resolvedOnRuleRegen = async (root: string): Promise<void> => {
        const { regenerateRules } = await import('../core/rule-generator.js');
        await regenerateRules(root);
      };
    }

    postFinalizeResult = await runPostFinalizeHooks({
      projectRoot,
      sprintId: sprint.id,
      metrics: {
        sprintId: sprint.id,
        totalTasks: metrics.totalTasks,
        completedTasks: metrics.completedTasks,
        techDebtTasks: metrics.techDebtTasks,
        noGoTasks: metrics.noGoTasks,
        coveragePercent: metrics.coveragePercent,
        durationMs: metrics.durationMs,
      },
      onRuleRegen: resolvedOnRuleRegen,
      // Sprint 227 task 227-002: always skip the unsafe runMemoryExport.
      // The outer terminal seal performs the guarded Brain adoption and binds
      // its digest in the applied archive-side application receipt.
      skipMemoryExport: true,
      memoryExportRenderOptions: configuredMemoryExportRenderOptions(opts?.config),
      skipIdentityRegen: opts?.skipIdentityRegen,
    });

    debugLog('finalizeSprint:postFinalizeHooks',
      `memExport=${postFinalizeResult.memoryExport?.filesWritten.length ?? 'skipped'} ` +
      `identity=${postFinalizeResult.identityRegen?.reason ?? 'skipped'} ` +
      `adrInsert=${postFinalizeResult.adrInsert
        ? `inserted=${postFinalizeResult.adrInsert.inserted}/updated=${postFinalizeResult.adrInsert.updated}/skipped=${postFinalizeResult.adrInsert.skipped}`
        : 'skipped'} ` +
      `ruleRegen=${postFinalizeResult.ruleRegenCalled} ` +
      `errors=${postFinalizeResult.errors.length}`);
  } catch (e) {
    debugLog('finalizeSprint:postFinalizeHooks', `Post-finalize hooks failed: ${e}`);
  }

  // ─── SPRINT_PHASE_CHANGE: RETRO → CLEANUP ───────────────────────
  // Final phase transition — sprint lifecycle complete.
  // Consumer: auditor marks sprint as finalized, dashboard shows COMPLETE.
  if (emitStandardLifecycleEvents) {
    writeEvent(
      projectRoot, sprintIdForEvents, 'brain', '*',
      CHANNELS.SPRINT_PHASE_CHANGE,
      { fromPhase: 'RETRO', toPhase: 'CLEANUP', sprintId: sprint.id, timestamp: new Date().toISOString() },
    );
  }

  if (!opts?.deferTerminalAuthority) {
    publishFinalSprintAuthority(projectRoot, sprint, metrics, opts?.config?.language ?? 'en', logicalEvaluations);
    publishOutermostSprintTerminalArchive({
      projectRoot,
      sprintId: sprint.id,
      receipt: terminalReceiptPublication.receipt,
      config: opts?.config,
      skipMemoryExport: opts?.skipMemoryExport,
      terminalEvents: manualFinalizeTerminalEvents(terminalReceiptPublication.receipt),
    });
  }

  return metrics;
}

/**
 * Single terminal authority publisher shared by external finalize and the
 * in-process controller after every ref'ed cleanup operation has completed.
 * @param evaluations - Logical task evaluations for the sprint-log projection
 *   (row 3298). Optional so the existing deferred/checkpoint-recovery callers
 *   (sprint-controller.ts, completed-checkpoint-terminalizer.ts) stay
 *   source-compatible; `upsertSprintLog` falls back to each task's own
 *   status when an id is missing from the map.
 */
/**
 * 671-006 — terminal package shared by the COMPLETE and ABORTED publishers.
 * Runs adjacent to the terminal clearPid call on BOTH paths and closes two
 * leases at once, best-effort (it must never block or fail finalization):
 *   (a) enqueue the durable terminal-kind owner notification exactly once —
 *       the deterministic id (`terminal:<sprintId>:<outcome>`) additionally
 *       keeps a re-finalize idempotent at the outbox dedup layer;
 *   (b) release `.deckent/sprint.lock` by terminated-sprint identity so a
 *       finalize running in a foreign process (owner PID dead or different)
 *       cannot leave the lock behind as a stale lease.
 */
function closeTerminalSprintPackage(
  projectRoot: string,
  sprintId: string,
  outcome: SprintTerminalOutcome,
  progress: {
    readonly done: number;
    readonly total: number;
    readonly debt: number;
    readonly noGo: number;
    readonly unevaluated: number;
  },
  lang?: string,
): void {
  try {
    const resolvedLang = lang ?? resolveOwnerNotificationLang(projectRoot);
    // Both strings come from the existing getMessage catalogue (en + tr);
    // the outcome token (COMPLETE/ABORTED) is the canonical untranslated
    // terminal-status literal, exactly as `finalize.aborted` renders it.
    enqueueOwnerNotification(projectRoot, {
      id: `terminal:${sprintId}:${outcome}`,
      kind: 'terminal',
      sprintId,
      title: getMessage('finalize.notification_title', resolvedLang, { sprintId }),
      message: `${outcome} — ${getMessage('finalize.notification_summary', resolvedLang, {
        done: String(progress.done),
        total: String(progress.total),
        debt: String(progress.debt),
        noGo: String(progress.noGo),
        unevaluated: String(progress.unevaluated),
      })}`,
      lang: resolvedLang,
    });
  } catch (e) { debugLog('closeTerminalSprintPackage:enqueue', e); }
  try {
    const release = releaseSprintLockForTerminatedSprint(projectRoot, sprintId);
    debugLog('closeTerminalSprintPackage:releaseSprintLock', `${sprintId}: ${release.state}`);
  } catch (e) { debugLog('closeTerminalSprintPackage:releaseSprintLock', e); }
}

export function publishFinalSprintAuthority(
  projectRoot: string,
  sprint: Sprint,
  metrics: SprintMetrics,
  lang = 'en',
  evaluations?: ReadonlyMap<string, TaskEvaluation>,
): void {
  debugLog('finalizeSprint:breadcrumb', 'terminal authority publication — entering');
  persistFinalSprintState(projectRoot, sprint);
  // 671-006: terminal package — adjacent to the clearPid call that
  // persistFinalSprintState just performed; shared with the ABORTED publisher.
  closeTerminalSprintPackage(projectRoot, sprint.id, 'COMPLETE', {
    done: metrics.completedTasks,
    total: metrics.totalTasks,
    debt: metrics.techDebtTasks ?? 0,
    noGo: metrics.noGoTasks ?? 0,
    unevaluated: metrics.unevaluatedTasks ?? 0,
  }, lang);
  // Sprint log projection (row 3298): sprint.status is genuinely COMPLETE at
  // this point (persistFinalSprintState just set it) — this is the only
  // place the true terminal status is known, so it is the correct place to
  // upsert the human-readable log section. Non-fatal: the log is a
  // projection, never settlement authority, and must never abort finalize.
  try {
    upsertSprintLog(
      {
        projectRoot,
        sprintResult: { sprint, evaluations: evaluations ?? new Map(), metrics },
      },
      'COMPLETE',
    );
  } catch (e) { debugLog('finalizeSprint:sprintLogProjection', e); }
  // Dashboard is an input to the canonical read-model conflict detector. It
  // must reach the same COMPLETE generation before the model is published;
  // publishing first and rewriting dashboard second immediately invalidated
  // the model digest and made status hide an otherwise valid receipt.
  try {
    writeTerminalDashboardSnapshot(projectRoot, sprint, metrics);
  } catch (e) { debugLog('finalizeSprint:terminalDashboard', e); }
  const statusModel = publishCanonicalRunStatusReadModel(projectRoot);
  if (
    statusModel.authority.sprintId !== sprint.id
    || statusModel.authority.lifecycle !== 'COMPLETE'
    || statusModel.terminalPublication.state !== 'receipt-observed'
  ) {
    throw new FinalizerTerminalEvidenceError('TERMINAL_STATUS_READ_MODEL_HOLD');
  }
  try {
    const done = statusModel.logicalProgress.done;
    const total = statusModel.logicalProgress.total;
    const noGo = metrics.noGoTasks ?? 0;
    const debt = metrics.techDebtTasks ?? 0;
    const unevaluated = metrics.unevaluatedTasks ?? 0;
    void notify(
      'sprint-finalized',
      sprint.id,
      getMessage('finalize.notification_title', lang, { sprintId: sprint.id }),
      getMessage('finalize.notification_summary', lang, {
        done: String(done),
        total: String(total),
        debt: String(debt),
        noGo: String(noGo),
        unevaluated: String(unevaluated),
      }),
    );
  } catch (e) { debugLog('finalizeSprint:notify:sprint-finalized', e); }
  debugLog('finalizeSprint:breadcrumb', 'terminal authority publication — done');
}

function removeOwnedJsonProjection(path: string, sprintId: string): void {
  if (!existsSync(path)) return;
  const value = readJsonSafe<{ readonly sprintId?: unknown }>(path);
  if (value?.sprintId === sprintId) unlinkSync(path);
}

/**
 * Publish ABORTED lifecycle truth only after the fenced abort receipt exists.
 * This writer is strict and atomic: a torn or foreign sprint-state must leave
 * cleanup closed instead of exposing an unreceipted terminal projection.
 */
export function publishAbortedSprintAuthority(
  projectRoot: string,
  sprint: Sprint,
  metrics: FinalizerLogicalMetrics,
): void {
  const statePath = join(projectRoot, SPRINT_STATE_FILE);
  const existing = readSprintState(projectRoot);
  if (existing?.sprintId && existing.sprintId !== sprint.id) {
    throw new FinalizerTerminalEvidenceError('ABORT_AUTHORITY_SPRINT_MISMATCH');
  }

  const completedAt = sprint.completedAt ?? new Date().toISOString();
  const phase = sprint.phase === SprintPhase.COMPLETE
    ? SprintPhase.TRANSITION
    : sprint.phase;
  const state = {
    sprintId: sprint.id,
    phase,
    status: SprintStatus.ABORTED,
    startedAt: sprint.startedAt ?? existing?.startedAt ?? completedAt,
    updatedAt: completedAt,
    completedAt,
    taskIds: sprint.tasks.map(task => task.id),
  };
  mkdirSync(join(projectRoot, '.deckent'), { recursive: true });
  const stateTempPath = `${statePath}.tmp-${process.pid}-${randomUUID()}`;
  writeFileSync(stateTempPath, JSON.stringify(state, null, 2) + '\n', 'utf-8');
  renameSync(stateTempPath, statePath);

  sprint.status = SprintStatus.ABORTED;
  sprint.phase = phase;
  sprint.completedAt = completedAt;

  removeOwnedJsonProjection(join(projectRoot, SPRINT_PAUSE_STATE_FILE), sprint.id);
  removeOwnedJsonProjection(join(projectRoot, SPRINT_ACTIVE_FILE), sprint.id);
  cleanupCheckpointFiles(projectRoot, sprint.id);
  clearPid(projectRoot, sprint.id);
  // 671-006: terminal package — same shared end-point as the COMPLETE path.
  closeTerminalSprintPackage(projectRoot, sprint.id, 'ABORTED', {
    done: metrics.completedTasks,
    total: metrics.totalTasks,
    debt: metrics.techDebtTasks,
    noGo: metrics.noGoTasks,
    unevaluated: metrics.unevaluatedTasks,
  });

  const dashboard = {
    sprint: {
      id: sprint.id,
      number: sprint.number,
      phase,
      status: SprintStatus.ABORTED,
    },
    agents: [],
    progress: {
      done: metrics.completedTasks,
      active: 0,
      blocked: Math.max(0, metrics.totalTasks - metrics.completedTasks),
      total: metrics.totalTasks,
    },
    alerts: [],
    updatedAt: completedAt,
    completedAt,
    terminalAuthority: {
      sprintId: sprint.id,
      outcome: 'ABORTED',
      completedAt,
    },
  };
  const dashboardPath = join(projectRoot, DASHBOARD_FILE);
  const dashboardTempPath = `${dashboardPath}.tmp-${process.pid}-${randomUUID()}`;
  writeFileSync(dashboardTempPath, JSON.stringify(dashboard, null, 2) + '\n', 'utf-8');
  renameSync(dashboardTempPath, dashboardPath);
  publishCanonicalRunStatusReadModel(projectRoot);
}

/**
 * Sprint 223 Task 013 — finalize sprint-state COMPLETED + pids cleanup.
 *
 * Root cause (Sprint 222→223 transition): `deckent finalize --force` wrote
 * RETRO / MEMORY / config but left `.deckent/sprint-state.json` at
 * `status:ACTIVE, phase:EXECUTE` and the dead `.deckent/pids/<id>.pid` in
 * place. The next `deckent start` then either reported the sprint as an
 * orphan (PID dead) or wrongly resumed the finished sprint in FIX, blocking
 * the next sprint from launching.
 *
 * Fix: stamp the sprint as `SprintStatus.COMPLETE` / `SprintPhase.COMPLETE`,
 * overwrite `.deckent/sprint-state.json` only when it already exists (so
 * fresh checkouts don't gain a phantom state file), then drop the PID +
 * snapshot files via `clearPid` (which is itself idempotent on missing
 * files). Both steps are wrapped in non-fatal try/catch — finalize must
 * never crash because of a stale tmp file.
 */
export function persistFinalSprintState(projectRoot: string, sprint: Sprint): void {
  try {
    sprint.status = SprintStatus.COMPLETE;
    sprint.phase = SprintPhase.COMPLETE;
    sprint.completedAt = sprint.completedAt ?? new Date().toISOString();
    const statePath = join(projectRoot, SPRINT_STATE_FILE);
    if (existsSync(statePath)) {
      // Sprint 268 guard: only stamp the state file when it belongs to THIS
      // sprint — `finalize --force` for an older sprint must not overwrite a
      // different (possibly live) sprint's state as COMPLETE. A state file
      // without a sprintId (legacy/corrupt) is still stamped, preserving the
      // Sprint 223 cleanup behavior.
      const existing = readSprintState(projectRoot);
      if (!existing?.sprintId || existing.sprintId === sprint.id) {
        writeSprintState(projectRoot, sprint);
      } else {
        debugLog('persistFinalSprintState:skip',
          `sprint-state.json belongs to ${existing.sprintId}, not ${sprint.id} — leaving untouched`);
      }
    }
  } catch (e) { debugLog('persistFinalSprintState:writeSprintState', e); }
  try {
    clearPid(projectRoot, sprint.id);
  } catch (e) { debugLog('persistFinalSprintState:clearPid', e); }
  // GHOST-FINALIZE fix (Sprint 272 272-001): purge this sprint's checkpoint
  // artifacts so the next `deckent start` cannot read a stale checkpoint and
  // run a phantom 0/0 "complete" restore. cleanupCheckpointFiles is itself
  // idempotent + fail-safe; the wrapping try/catch is belt-and-suspenders so
  // finalize never crashes on a locked/missing file.
  try {
    cleanupCheckpointFiles(projectRoot, sprint.id);
  } catch (e) { debugLog('persistFinalSprintState:cleanupCheckpointFiles', e); }
  // A pause record is a refining authority only while its run is resumable.
  // Once the same sprint is terminal it must be removed, otherwise canonical
  // status correctly keeps reporting PAUSED over the newly-written COMPLETE
  // sprint-state. Never touch a pause record owned by another sprint.
  try {
    const pausePath = join(projectRoot, SPRINT_PAUSE_STATE_FILE);
    if (existsSync(pausePath)) {
      const pause = JSON.parse(readFileSync(pausePath, 'utf-8')) as { sprintId?: unknown };
      if (pause.sprintId === sprint.id) unlinkSync(pausePath);
    }
  } catch (e) { debugLog('persistFinalSprintState:clearPauseState', e); }
}

/**
 * Sprint 282 Task 005 — TERMINAL dashboard snapshot (DASH-UX-2).
 *
 * After sprint finalize, the `.dashboard` file is left at the last auditor
 * scan state (e.g. "EXECUTE 80% 8/10").  The next `/api/status` call returns
 * this stale snapshot as if the sprint is still running.
 *
 * Fix: overwrite `.dashboard` with a TERMINAL snapshot containing
 *   sprint.phase = COMPLETE, sprint.status = COMPLETE,
 *   agents = [], progress = final values, alerts = [].
 * The file is always overwritten (idempotent — same data on re-finalize).
 * Non-fatal: wrapped in the caller's try/catch (Step 16 in finalizeSprint).
 */
export function writeTerminalDashboardSnapshot(
  projectRoot: string,
  sprint: Sprint,
  metrics: SprintMetrics,
): void {
  const dashPath = join(projectRoot, DASHBOARD_FILE);
  const snapshot = {
    sprint: {
      id: sprint.id,
      number: sprint.number,
      phase: SprintPhase.COMPLETE,
      status: SprintStatus.COMPLETE,
    },
    agents: [],
    progress: {
      done: metrics.completedTasks,
      active: 0,
      blocked: 0,
      total: metrics.totalTasks,
    },
    alerts: [],
    updatedAt: new Date().toISOString(),
    completedAt: sprint.completedAt ?? new Date().toISOString(),
    terminalAuthority: {
      sprintId: sprint.id,
      completedAt: sprint.completedAt ?? new Date().toISOString(),
    },
  };
  writeFileSync(dashPath, JSON.stringify(snapshot, null, 2), 'utf-8');
  debugLog('writeTerminalDashboardSnapshot', `terminal snapshot written for ${sprint.id}`);
}

/**
 * Truth-normalizasyonu (3301): policy-terminal pre-dispatch sonuçların verdikti
 * her dalda NOT_DISPATCHED'tır; NO_GO yazılmışsa burada düzeltilir (kopya döner).
 */
function normalizePolicyTerminalEvaluations(
  evaluations: ReadonlyMap<string, TaskEvaluation>,
  policyTerminalIds: ReadonlySet<string>,
): ReadonlyMap<string, TaskEvaluation> {
  if (policyTerminalIds.size === 0) return evaluations;
  const normalized = new Map(evaluations);
  for (const id of policyTerminalIds) {
    if (normalized.get(id) === TaskEvaluation.NO_GO) {
      normalized.set(id, TaskEvaluation.NOT_DISPATCHED);
    }
  }
  return normalized;
}

/** Task ids whose result is a policy-terminal host pre-dispatch settlement (3301). */
function derivePolicyTerminalIdsFromResults(
  results: Iterable<TaskResult> | ReadonlyMap<string, TaskResult>,
): ReadonlySet<string> {
  const iterable: Iterable<TaskResult> =
    results instanceof Map ? results.values() : results as Iterable<TaskResult>;
  const ids = new Set<string>();
  for (const result of iterable) {
    if (isPolicyTerminalPreDispatchResult(result)) ids.add(result.taskId);
  }
  return ids;
}
