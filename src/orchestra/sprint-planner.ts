// ═══ Sprint Planner ════════════════════════════════════════════════
// Extracted from sprint-controller.ts — planning functions:
//   readContext(), planSprint(), confirmDraftTasks(), cleanupDraftTasks()

// ─── Node Builtins ─────────────────────────────────────────────────
import {
  readFileSync, existsSync,
  mkdirSync, readdirSync, unlinkSync,
} from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';

// ─── Core (value imports — enums used at runtime) ──────────────────
import {
  TaskStatus, SprintPhase,
  SprintStatus, DebtPriority,
} from '../core/types.js';

// ─── Core (type imports) ───────────────────────────────────────────
import type {
  Task, TaskScope, Sprint, DebtItem,
  ResolvedConfig,
  BrainContext, SprintSizeRecommendation,
  BrainPlanningMode, PlannerResult, ProviderName,
  ModelType, TaskEffort, PlannerProof, PlannerProofResolutionReason,
} from '../core/types.js';

import {
  BRAIN_DIR, TASKS_DIR, DIRECTIVES_FILE,
  MEMORY_DB_FILE,
} from '../core/constants.js';

// ─── Memory V2 ───────────────────────────────────────────────────
import { MemoryStore } from '../core/memory-store.js';
import {
  buildMemoryDiscoveryQuery,
  readMemoryView,
  renderMemoryReadView,
  resolveMemoryRequiredIds,
} from '../core/memory-read-service.js';
import { buildMemoryReadLabels } from '../core/memory-read-labels.js';
import {
  resolveMemoryReadLimits,
  type MemoryReadEntryV1,
  type MemoryReadLimitsV1,
  type MemoryReadScopeV1,
  type MemoryReadViewV1,
} from '../core/memory-read-contract.js';
import { attendedExecutionProjectId } from '../core/attended-execution-approval.js';

// ─── Core — utils ─────────────────────────────────────────────────
import { getNextSprintId, readJsonSafe, debugLog } from '../core/utils.js';
import {
  readAuthMode,
  resolveBrainPlanningMode,
  resolveMemoryReadConfig,
  resolveMemoryReadLimitsForConsumer,
} from '../core/config.js';
import { createPromptCostCanaryTaskAuthority } from '../core/prompt-cost-canary-task-authority.js';
import { estimateSprintCost } from '../core/cost-calculator.js';
import { initCostConfig, loadCostConfig } from '../core/cost-config-loader.js';
import {
  buildTaskCostInput,
  deriveRequestedExecutionBudget,
} from '../core/execution-budget-derivation.js';
import { createGoNoGoCriterionItem } from '../core/task-types.js';
import { resolveDebt, isSuccessOnlyDebtNote } from './debt-manager.js';
import { preflightCriticalDebt } from './debt-preflight.js';

// ─── Sprint Utilities ─────────────────────────────────────────────
import { readFileSafe, extractGoNogoCriteria } from './sprint-utils.js';
import { resolveRunPolicyFromDirectives } from './run-policy-resolver.js';
import { resolveCanonicalModelIdentity } from '../core/model-registry.js';

// ─── Core — provider abstraction ──────────────────────────────────
import type { ProviderAdapter } from '../core/provider.js';
import { orderedRoleProviders, providerRegistry } from '../core/provider.js';

// ─── Core — skill system ─────────────────────────────────────────
import { detectProjectStack, detectFullStack } from '../core/stack-detector.js';
import { normalizeTechStack, rubricTypeToKind } from '../core/work-model.js';
import { detectTaskType } from './rubric-registry.js';
import { SkillPoolManager } from '../core/skill-pool.js';

// ─── Planner ─────────────────────────────────────────────────────
import {
  callBrainPlanner,
  callBrainPlannerWithReason,
  createPlannerTaskModelPolicy,
  resolvePlanTimeoutMs,
} from './planner.js';
import type { PlannerCallResult, PlannerFailureReason } from './planner.js';

/**
 * Resolve the planner-call function, with a legacy-mock fallback.
 *
 * Older test files (`vi.mock('../../src/orchestra/planner.js', () => ({ callBrainPlanner: vi.fn().mockReturnValue(null) }))`)
 * only provide `callBrainPlanner` in their mock factory. Vitest throws when the
 * test imports `callBrainPlannerWithReason` from such a mocked module ("No
 * callBrainPlannerWithReason export is defined on the mock"). We wrap the
 * access in try/catch so those tests keep working without modifying them
 * (out of scope for task 224-001). On the fallback path we synthesize a
 * `parse_failed` reason from the legacy null return.
 */
function resolveCallBrainPlanner(): (
  ...args: Parameters<typeof callBrainPlannerWithReason>
) => PlannerCallResult | Promise<PlannerCallResult> {
  let withReasonFn: typeof callBrainPlannerWithReason | undefined;
  try {
    withReasonFn = callBrainPlannerWithReason;
  } catch {
    withReasonFn = undefined;
  }
  if (typeof withReasonFn === 'function') {
    return withReasonFn;
  }
  return async (...args): Promise<PlannerCallResult> => {
    try {
      // F-2: callBrainPlanner is async now; await also tolerates a legacy
      // SYNC mock returning a plain PlannerResult/null.
      const r = await callBrainPlanner(...args);
      if (r) return { ok: true, data: r };
      return {
        ok: false,
        reason: 'parse_failed' as PlannerFailureReason,
        message: 'AI planner returned null (legacy mock or unexpected fall-through).',
      };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return {
        ok: false,
        reason: 'no_providers' as PlannerFailureReason,
        message,
      };
    }
  };
}

// ─── Auditor ──────────────────────────────────────────────────────
import { detectDeadlocks } from '../monitor/auditor.js';

// ─── Agent Pool & Selection ──────────────────────────────────────
import { AgentPoolManager } from '../core/agent-pool.js';
import { effortForWorkType } from '../core/routing/config.js';
import { produceContentStructural, producePositional } from '../core/routing/requirement-vector.js';
import { BUILTIN_DOMAINS } from '../core/routing/vocabulary-builtin.js';

// ─── Sub-module imports ──────────────────────────────────────────
import { resolveTaskModel, parsePatterns, deduplicatePatterns } from './model-selector.js';
import {
  createTask,
  extractScopeFromDirective,
  normalizeStructuredTaskDependencies,
  parseStructuredDirectives,
  plannerTaskToParams,
} from './task-builder.js';
import { extractExplicitAdrRefs } from './adr-selector.js';
import { evaluatePromptGate } from './prompt-gate.js';
import type { PromptGateResult } from '../core/prompt-gate-types.js';
import type { InvocationReceiptRef } from '../core/invocation-receipt.js';
import { applyWorkerExecutionBudgetPolicy } from '../core/execution-plan-digest.js';
import { compileCanonicalScope } from '../core/execution-write-scope-policy.js';
import {
  evaluateTestDiscoverability,
  resolveTestDiscoveryContracts,
} from '../core/test-discovery-contract.js';
import { getMessage } from '../cli/helpers/messages.js';
import { detectLang } from '../cli/helpers/i18n.js';

// ─── BrainError ──────────────────────────────────────────────────
import { BrainError } from './sprint-lifecycle.js';

// ─── Notify + Progress ───────────────────────────────────────────
import { notify } from '../core/notify.js';
import { emitProgress } from '../core/event-stream.js';

/**
 * Preserve the exact write authorities authored by the structured DIRECTIVES
 * parser at the planner boundary. Declared files are source authority: unlike
 * inferred/read-context paths, they must never depend on git tracking or current
 * disk existence. The stable first-seen order also makes repeated declarations
 * deterministic without widening the scope beyond parser-authored entries.
 */
function mergeDeclaredFilesIntoScope(
  scope: TaskScope,
  declaredFiles: readonly string[],
): TaskScope {
  return {
    ...scope,
    filesWrite: [...new Set([...scope.filesWrite, ...declaredFiles])],
  };
}

// ═══ Exported Functions ════════════════════════════════════════════

/**
 * Read the full brain context from disk: directives, memory, retro, patterns,
 * decisions, debt, existing tasks, git status, and file tree.
 * @param projectRoot - Project root directory
 * @returns Complete brain context for sprint planning
 */
type PlannerMemorySelection = Pick<BrainContext,
  'memory' | 'memorySelectionRevisionDigest' | 'memoryReadInputDigest'
  | 'memoryReadScope' | 'memoryReadLimits' | 'memoryReadLanguage'> & {
    readonly selectedEntries: readonly MemoryReadEntryV1[];
  };

function renderPlannerGeneralMemory(view: Exclude<MemoryReadViewV1, { state: 'HOLD' }>, language: string): string {
  if (view.state === 'ABSENT') return '';
  const legacyProjectionTypes = new Set(['adr', 'debt', 'identity', 'pattern', 'retro']);
  return renderMemoryReadView(Object.freeze({
    ...view,
    entries: Object.freeze(view.entries.filter(({ entry }) => !legacyProjectionTypes.has(entry.type))),
    deferred: Object.freeze(view.deferred.filter(({ candidate }) => !legacyProjectionTypes.has(candidate.type))),
  }), buildMemoryReadLabels(getMessage, language));
}

function readPlannerMemoryContext(
  projectRoot: string,
  directives: string,
  limits?: Partial<MemoryReadLimitsV1>,
  language = 'en',
  scope: MemoryReadScopeV1 = {
    kind: 'local-project',
    projectId: attendedExecutionProjectId(projectRoot),
  },
): PlannerMemorySelection {
  const dbPath = join(projectRoot, BRAIN_DIR, MEMORY_DB_FILE);
  const resolvedLimits = resolveMemoryReadLimits(limits);
  const memoryReadInputDigest = `sha256:${createHash('sha256').update(directives, 'utf8').digest('hex')}`;
  const explicitAdrReferences = extractExplicitAdrRefs(directives);
  if (!existsSync(dbPath)) {
    if (explicitAdrReferences.length > 0) {
      throw new BrainError('MEMORY_READ_CONTEXT_HOLD:REQUIRED_ENTRY_MISSING', SprintPhase.PLAN);
    }
    return {
      memory: '',
      selectedEntries: Object.freeze([]),
      memoryReadInputDigest,
      memoryReadScope: scope,
      memoryReadLimits: resolvedLimits,
      memoryReadLanguage: language,
    };
  }
  let store: MemoryStore | undefined;
  try {
    store = new MemoryStore(dbPath, { readOnly: true });
    const required = resolveMemoryRequiredIds(store, {
      consumer: 'planner',
      scope,
      references: explicitAdrReferences,
    });
    if (required.state === 'HOLD') {
      throw new BrainError(`MEMORY_READ_CONTEXT_HOLD:${required.reasonCode}`, SprintPhase.PLAN);
    }
    const queryText = buildMemoryDiscoveryQuery(directives);
    const view = readMemoryView(store, {
      consumer: 'planner',
      scope,
      query: queryText.length > 0 ? { text: queryText } : {},
      limits: resolvedLimits,
      requiredIds: required.exactIds,
      includeCritical: true,
      preferredLatestTypes: ['identity', 'retro'],
    });
    if (view.state === 'HOLD') {
      throw new BrainError(`MEMORY_READ_CONTEXT_HOLD:${view.reasonCode}`, SprintPhase.PLAN);
    }
    return {
      memory: renderPlannerGeneralMemory(view, language),
      selectedEntries: view.state === 'AVAILABLE' ? view.entries : Object.freeze([]),
      memorySelectionRevisionDigest: view.selectionRevisionDigest,
      memoryReadInputDigest,
      memoryReadScope: scope,
      memoryReadLimits: resolvedLimits,
      memoryReadLanguage: language,
    };
  } catch (error) {
    if (error instanceof BrainError) throw error;
    throw new BrainError('MEMORY_READ_CONTEXT_HOLD:QUERY_FAILED', SprintPhase.PLAN);
  } finally {
    store?.close();
  }
}

function projectPlannerLegacyContext(selectedEntries: readonly MemoryReadEntryV1[]): Pick<BrainContext,
  'retro' | 'debt' | 'patterns' | 'decisions' | 'projectIdentity'> {
  const selected = selectedEntries.map(({ entry, reasons }) => ({ entry, reasons }));
  const retro = selected.find(({ entry, reasons }) => entry.type === 'retro' && reasons.includes('PREFERRED_LATEST'))
    ?.entry.content ?? '';
  const projectIdentity = selected.find(({ entry, reasons }) => entry.type === 'identity' && reasons.includes('PREFERRED_LATEST'))
    ?.entry.content;
  const patterns = selected.some(({ entry }) => entry.type === 'pattern')
    ? JSON.stringify(selected
        .filter(({ entry }) => entry.type === 'pattern')
        .map(({ entry }) => ({ pattern: entry.title, resolved: entry.status === 'resolved' })))
    : '';
  const decisions = selected
    .filter(({ entry }) => entry.type === 'adr' && entry.status === 'accepted')
    .map(({ entry }) => `## ${entry.id}: ${entry.title}\n\n**Status:** ${entry.status}\n\n${entry.content}`)
    .join('\n\n---\n\n');
  const debt = selected
    .filter(({ entry }) => entry.type === 'debt' && entry.status !== 'resolved')
    .map(({ entry }) => {
      let metadata: Record<string, unknown>;
      try {
        const parsed = JSON.parse(entry.metadata || '{}') as unknown;
        if (parsed === null || Array.isArray(parsed) || typeof parsed !== 'object') throw new Error('invalid-metadata');
        metadata = parsed as Record<string, unknown>;
      } catch {
        throw new BrainError('MEMORY_READ_CONTEXT_HOLD:INVALID_DEBT_METADATA', SprintPhase.PLAN);
      }
      const debtClass = metadata['class'];
      const originScope = metadata['originScope'];
      const validDebtClass = debtClass === 'verified-no-result'
        || debtClass === 'timeout-partial'
        || debtClass === 'success-echo'
        || debtClass === 'standard'
        ? debtClass
        : undefined;
      const originScopeRecord = originScope !== null && !Array.isArray(originScope) && typeof originScope === 'object'
        ? originScope as Record<string, unknown>
        : null;
      const originDirectories = originScopeRecord?.['directories'];
      const originFilesWrite = originScopeRecord?.['filesWrite'];
      const validOriginScope = Array.isArray(originDirectories)
        && originDirectories.every((value: unknown) => typeof value === 'string')
        && Array.isArray(originFilesWrite)
        && originFilesWrite.every((value: unknown) => typeof value === 'string')
        ? {
            directories: [...originDirectories] as string[],
            filesWrite: [...originFilesWrite] as string[],
          }
        : undefined;
      return {
        id: entry.id,
        description: entry.content || entry.title,
        originTaskId: typeof metadata['originTaskId'] === 'string' ? metadata['originTaskId'] : '',
        originSprintId: typeof metadata['originSprintId'] === 'string'
          ? metadata['originSprintId']
          : entry.sprint_id ?? '',
        priority: (entry.priority?.toUpperCase() ?? 'NORMAL') as DebtPriority,
        sprintsOpen: typeof metadata['sprintsOpen'] === 'number' ? metadata['sprintsOpen'] : 0,
        resolved: false,
        resolvedInSprintId: undefined,
        createdAt: entry.created_at,
        class: validDebtClass,
        originScope: validOriginScope,
      } satisfies DebtItem;
    });
  return { retro, debt, patterns, decisions, projectIdentity };
}

export function readContext(
  projectRoot: string,
  memoryOptions?: { scope?: MemoryReadScopeV1 },
): BrainContext {
  // Directives always from file (not in DB)
  const directives = readFileSafe(join(projectRoot, DIRECTIVES_FILE));

  // Try DB-first for brain context
  let memoryConfig: ReturnType<typeof resolveMemoryReadConfig>;
  try {
    memoryConfig = resolveMemoryReadConfig(projectRoot, 'planner');
  } catch {
    throw new BrainError('MEMORY_READ_CONFIG_UNAVAILABLE', SprintPhase.PLAN);
  }
  const plannerSelection = readPlannerMemoryContext(projectRoot, directives,
    memoryConfig.memory_read, memoryConfig.language, memoryOptions?.scope);
  const { selectedEntries, ...selectedMemory } = plannerSelection;
  const { retro, debt, patterns, decisions, projectIdentity } = projectPlannerLegacyContext(selectedEntries);
  const memory = selectedMemory.memory;

  // Existing tasks + git status (unchanged)
  const existingTasks: Task[] = [];
  const tasksDir = join(projectRoot, TASKS_DIR);
  if (existsSync(tasksDir)) {
    const files = readdirSync(tasksDir).filter(f => f.startsWith('task-') && f.endsWith('.json'));
    for (const file of files) {
      const task = readJsonSafe<Task>(join(tasksDir, file));
      if (task) existingTasks.push(task);
    }
  }

  const gitResult = spawnSync('git', ['status', '--porcelain'], { cwd: projectRoot, encoding: 'utf-8' });
  const gitStatus = gitResult.status === 0 ? (gitResult.stdout ?? '') : '';

  const treeResult = spawnSync('git', ['ls-files'], { cwd: projectRoot, encoding: 'utf-8' });
  const fileTree = treeResult.status === 0
    ? (treeResult.stdout ?? '').split('\n').filter(Boolean)
    : [];

  return {
    directives,
    memory,
    ...(selectedMemory.memorySelectionRevisionDigest !== undefined
      ? { memorySelectionRevisionDigest: selectedMemory.memorySelectionRevisionDigest }
      : {}),
    ...(selectedMemory.memoryReadInputDigest !== undefined
      ? { memoryReadInputDigest: selectedMemory.memoryReadInputDigest }
      : {}),
    ...(selectedMemory.memoryReadScope !== undefined ? { memoryReadScope: selectedMemory.memoryReadScope } : {}),
    ...(selectedMemory.memoryReadLimits !== undefined ? { memoryReadLimits: selectedMemory.memoryReadLimits } : {}),
    ...(selectedMemory.memoryReadLanguage !== undefined ? { memoryReadLanguage: selectedMemory.memoryReadLanguage } : {}),
    retro,
    debt,
    patterns,
    decisions,
    projectIdentity,
    existingTasks,
    projectState: { gitStatus, fileTree },
  };
}

/**
 * Plan a new sprint by creating task definitions from directives.
 * Handles critical debt priority fixes, AI planner with structured fallback,
 * deadlock detection, agent selection, and skill assignment.
 * @param projectRoot - Project root directory
 * @param config - Resolved project configuration
 * @param context - Brain context with directives, memory, debt, etc.
 * @param recommendation - Sprint size recommendation
 * @param options - Optional planning mode, draft flag, and usage metrics
 * @returns The planned sprint with all tasks
 * @throws {BrainError} When AI planner fails in 'ai' mode or circular dependencies detected
 */
export function shouldDeferTaskArtifactProjection(
  tasks: readonly Pick<Task, 'backend'>[],
  requested: boolean | undefined,
): boolean {
  return requested === true || tasks.some(task => task.backend === 'docker');
}

export async function planSprint(
  projectRoot: string,
  config: ResolvedConfig,
  context: BrainContext,
  recommendation: SprintSizeRecommendation,
  options?: {
    mode?: BrainPlanningMode;
    asDraft?: boolean;
    dryRun?: boolean;
    acknowledgePromptGate?: boolean;
    /** Exact normal-Docker runs publish public task compatibility files only after RELEASED. */
    deferTaskArtifactProjection?: boolean;
  },
): Promise<Sprint> {
  const memoryReadInputDigest = `sha256:${createHash('sha256').update(context.directives, 'utf8').digest('hex')}`;
  const plannerMemoryReadLimits = resolveMemoryReadLimitsForConsumer(config, 'planner');
  if (context.memorySelectionRevisionDigest === undefined
    || context.memoryReadInputDigest !== memoryReadInputDigest
    || JSON.stringify(context.memoryReadLimits) !== JSON.stringify(plannerMemoryReadLimits)
    || context.memoryReadLanguage !== config.language) {
    const plannerSelection = readPlannerMemoryContext(
      projectRoot,
      context.directives,
      plannerMemoryReadLimits,
      config.language,
      context.memoryReadScope,
    );
    const { selectedEntries, ...selectedMemory } = plannerSelection;
    context = { ...context, ...selectedMemory, ...projectPlannerLegacyContext(selectedEntries) };
  }
  const sprintId = getNextSprintId(projectRoot);
  // G-series plan-time prompt-gate result (persona/decision-space); computed after
  // routing inside the pool try-block, attached to the returned Sprint below.
  let promptGate: PromptGateResult | undefined;
  // A preview is not a run: it must leave no raw event/sequence allocator evidence.
  if (!options?.dryRun && !options?.deferTaskArtifactProjection) {
    emitProgress({ phase: 'PLAN', root: projectRoot, sprintId });
  }
  const plannerTaskModelPolicy = createPlannerTaskModelPolicy(
    recommendation.modelConstraint ?? config.activeModeConfig.default_model,
    config.worker_provider,
  );
  const defaultModel = plannerTaskModelPolicy.defaultModel;
  // 429-006 (PLNR1): resolve through resolveBrainPlanningMode so an explicit
  // top-level `config.brain_planning` overrides the mode preset — reading
  // `config.activeModeConfig.brain_planning` directly here would silently
  // ignore the top-level user override (the original bug).
  const requestedPlanMode = options?.mode ?? resolveBrainPlanningMode(config);
  let planMode = requestedPlanMode;
  let plannerResolutionReason: PlannerProofResolutionReason =
    requestedPlanMode === 'structured' ? 'requested-structured' : 'model-success';
  let plannerCallAttempted = false;
  let plannerCallSucceeded = false;
  let plannerResolvedProvider: ProviderName | null = null;
  let plannerResolvedModel: ModelType | null = null;
  let plannerFailureReason: string | null = null;
  let plannerReceiptRef: InvocationReceiptRef | null = null;
  const configuredBrainProvider = config.providers?.brain ?? config.brain_provider ?? null;
  let plannerRequestedProvider: ProviderName | null = configuredBrainProvider;
  const initialStatus = options?.asDraft ? TaskStatus.DRAFT : TaskStatus.PENDING;

  // Sprint 238 İŞ1 (+ 429-007 PLNR2): Per-task `- Provider:`/`- Model:`/`- Agent:`/
  // `- Skills:` directives are deterministic routing decisions that must be honored
  // EXACTLY. AI planning cannot guarantee a 1:1 directive→task mapping (it may
  // split/merge tasks), so whenever DIRECTIVES carry explicit provider/model/agent/
  // skills overrides we route to structured planning in any mode — extending the
  // existing auto→structured fallback (count-mismatch) below. `forceSkills` may be
  // `[]` for an explicit "Skills: none" — still truthy in JS, so no `!== undefined`
  // check is needed here.
  const parsedDirectives = parseStructuredDirectives(context.directives);
  const directiveOverrideKinds = Array.from(new Set(parsedDirectives.flatMap((task) => {
    const kinds: Array<'provider' | 'model' | 'agent' | 'skills'> = [];
    if (task.provider) kinds.push('provider');
    if (task.forceModel) kinds.push('model');
    if (task.forceAgent) kinds.push('agent');
    if (task.forceSkills) kinds.push('skills');
    return kinds;
  })));
  const buildPlannerProof = (actualMode: PlannerProof['actualMode']): PlannerProof => ({
    version: 1,
    requestedMode: requestedPlanMode,
    actualMode,
    resolutionReason: plannerResolutionReason,
    directiveOverrideKinds,
    call: {
      attempted: plannerCallAttempted,
      succeeded: plannerCallSucceeded,
      requestedProvider: plannerRequestedProvider,
      resolvedProvider: plannerResolvedProvider,
      requestedModel: config.activeModeConfig.brain_model ?? null,
      resolvedModel: plannerResolvedModel,
      failureReason: plannerFailureReason,
      receiptRef: plannerReceiptRef,
    },
  });
  if (planMode !== 'structured' && parsedDirectives.some(t => t.provider || t.forceModel || t.forceAgent || t.forceSkills || t.postSettlementProjection || t.productionWiring)) {
    if (planMode === 'ai') {
      void notify(
        'phase-change', sprintId,
        '[Brain] plan:structured-override',
        'Per-task provider/model/agent/skills overrides present in DIRECTIVES — using structured planning to honor them exactly (AI planning cannot guarantee exact routing).',
      );
    }
    planMode = 'structured';
    plannerResolutionReason = 'directive-routing-override';
  }

  const tasks: Task[] = [];
  let seq = 1;
  let plannerResult: PlannerResult | null = null;
  let usedMode: PlannerProof['actualMode'] = 'structured';

  // Dogfood-449 B5: pre-flight revalidation of CRITICAL debt BEFORE dispatch.
  // A debt note that asserts completion and whose own evidence commands re-run
  // green host-side is already resolved in the tree — auto-close it instead of
  // spawning a no-op fix worker (sprint-449 burned 3 sonnet-high workers per
  // run on such debts; debt-433-001-fix had been re-dispatched for 15 sprints).
  // Fail-open by design: any red/timeout/error keeps the debt dispatched, with
  // the pre-flight outcome appended to the fix task so the worker starts from
  // fresh signal instead of the stale note dump.
  // NOT (sprint-450 canlı-dersi): B5 için dryRun'a BAKMA. generatePlanPreview
  // dryRun:true çağırır (task-dosyası ve temp-agent persist guard'ları) ve run_flow_v2'de
  // exact-snapshot start bu planı OLDUĞU GİBİ koşturur — dryRun-guard'ı B5'i
  // tüm do-akışında kapatıyordu. Preflight kapaması kanıt-temelli ve idempotent
  // (komutlar ŞİMDİ yeşilse debt ağaçta zaten çözülmüş) — önizlemede koşması da
  // dürüstlüktür: gösterilen plan = başlatılacak plan.
  let debtForInjection = context.debt;
  if (config.debt_preflight_enabled !== false) {
    try {
      const preflight = await preflightCriticalDebt(projectRoot, context.debt);
      if (preflight.items.length > 0) {
        for (const verifiedId of preflight.verifiedIds) {
          resolveDebt(projectRoot, verifiedId, sprintId);
        }
        debtForInjection = context.debt.map(d => {
          if (preflight.verifiedIds.has(d.id)) return { ...d, resolved: true };
          const annotation = preflight.annotations.get(d.id);
          return annotation ? { ...d, description: `${d.description}\n\n${annotation}` } : d;
        });
        const redCount = preflight.items.filter(i => i.verdict === 'evidence-red').length;
        void notify(
          'phase-change', sprintId,
          '[Brain] debt-preflight',
          `Pre-flight revalidated ${preflight.items.length} CRITICAL debt(s): ${preflight.verifiedIds.size} auto-closed (completion claim + evidence commands green), ${redCount} confirmed-real (evidence red), rest dispatched unchanged.`,
        );
      }
    } catch (e) {
      debugLog('planSprint:debtPreflight', e); // fail-open — dispatch as before
    }
  }

  // CRITICAL debt -> priority fix tasks (Sprint 179 W1-1)
  const injected = injectCriticalDebtTasks(debtForInjection, sprintId, defaultModel, seq, initialStatus);
  tasks.push(...injected.tasks);
  seq = injected.nextSeq;

  // 365-001: honest-closure debts (verified-no-result / timeout-partial) are
  // intentionally NOT re-injected as fix tasks — but the skip signal was
  // previously discarded, leaving those rows `active` to re-inject/re-evaluate
  // every sprint forever (a permanent no-op pile-up). Resolving them here makes
  // a skip a genuine closure. resolveDebt is idempotent + fail-soft (no-op when
  // there is no DB / the row is already resolved), so this is safe to run every plan.
  // NOTE (born-603): `injected.skippedNoop` (heuristic honest-noop-echo class)
  // is deliberately NOT looped/resolved here — see DebtInjectionResult doc.
  for (const skippedDebtId of injected.skipped) {
    resolveDebt(projectRoot, skippedDebtId, sprintId);
  }

  // AI planner attempt
  if (planMode === 'ai' || planMode === 'auto') {
    // The role policy owns the requested primary. Registry order is catalog
    // state, not fallback/reachability authority, so an absent primary remains
    // unresolved and reaches the existing no-provider receipt/HOLD path.
    const brainProviderOrder = orderedRoleProviders('brain', config);
    const brainProviderName = brainProviderOrder.primary;
    plannerRequestedProvider = brainProviderName;
    let brainAdapter: ProviderAdapter | undefined;
    if (providerRegistry.hasProvider(brainProviderName)) {
      brainAdapter = providerRegistry.getProvider(brainProviderName);
    } else {
      debugLog(
        'planSprint:resolveProvider',
        `Configured Brain primary is not registered: ${brainProviderName}`,
      );
    }

    // Model equivalence is meaningful only after the exact requested provider
    // adapter exists. When it does not, preserve the configured model solely as
    // requested identity so the planner can persist a truthful no-provider
    // rejection instead of fabricating a cross-provider model resolution.
    const brainModel = brainAdapter
      ? resolveTaskModel(
          'sprint-planning', 'AI planner invocation',
          { directories: [], filesRead: [], filesWrite: [] },
          config,
          undefined, config.activeModeConfig.brain_model,
          undefined, brainProviderName,
        )
      : config.activeModeConfig.brain_model;
    plannerResolvedProvider = brainAdapter ? brainProviderName : null;
    plannerResolvedModel = brainAdapter ? brainModel : null;

    // Fetch worst agent+skill combinations from OutcomeTracker to inject into planner prompt
    let worstCombinations: string | undefined;
    try {
      const { OutcomeTracker: OT } = await import('./outcome-tracker.js');
      const ot = new OT(projectRoot);
      const worst = ot.getWorstCombinations(5);
      if (worst) worstCombinations = worst;
    } catch (e) {
      debugLog('planSprint:worstCombinations', e);
    }

    // brain_plan_timeout_ms: optional ResolvedConfig override (Sprint 224 — task
    // 224-001). Resolution lives in planner.ts's resolvePlanTimeoutMs (F-2:
    // single source shared with the run-proposal compiler and `deckent do`'s
    // planning notice).
    const planTimeout = resolvePlanTimeoutMs(
      config as unknown as { brain_plan_timeout_ms?: number; ai_planner_timeout?: number },
    );

    const plannerCallFn = resolveCallBrainPlanner();
    const plannerAuthMode = await readAuthMode(projectRoot);
    // Preview calls are real, billable model invocations and therefore still
    // receive durable audit receipts. They must not share the execution
    // invocation's deterministic idempotency identity, though: dry-run writes
    // no sprint/task state, so the subsequent real plan reuses the sprint id.
    // A per-preview attempt identity preserves audit truth without poisoning
    // the later execution dispatch as a duplicate replay.
    const previewAttemptId = options?.dryRun ? randomUUID() : null;
    plannerCallAttempted = true;
    const callResult: PlannerCallResult = await plannerCallFn(
      context,
      recommendation,
      brainModel,
      config.projectName,
      brainAdapter,
      planTimeout,
      worstCombinations,
      undefined,
      {
        tenantId: 'local',
        projectRoot,
        runId: sprintId,
        taskId: null,
        configuredProvider: configuredBrainProvider,
        requestedProvider: brainProviderName,
        configuredModel: config.activeModeConfig.brain_model ?? null,
        requestedModel: config.activeModeConfig.brain_model ?? null,
        authMode: plannerAuthMode,
        ...(previewAttemptId ? {
          invocationId: `inv-preview-${previewAttemptId}`,
          idempotencyKey: `${sprintId}:brain:sprint-planning:preview:${previewAttemptId}`,
          callId: `inv-preview-${previewAttemptId}:call-1`,
        } : {}),
      },
      plannerTaskModelPolicy,
    );
    plannerReceiptRef = callResult.receiptRef ?? null;

    if (callResult.ok) {
      plannerCallSucceeded = true;
      plannerResult = callResult.data;
      const directiveTaskCount = parsedDirectives.length;
      if (planMode === 'auto' && directiveTaskCount > 0 && plannerResult.tasks.length < directiveTaskCount) {
        void notify(
          'progress', sprintId,
          '[Brain] plan:task-count-low',
          `AI planner returned ${plannerResult.tasks.length} tasks, but directives contain ${directiveTaskCount}. Falling back to structured mode.`,
        );
        plannerResult = null;
        usedMode = 'fallback';
        plannerResolutionReason = 'task-count-low-fallback';
      } else if (planMode === 'auto' && directiveTaskCount > 0 && plannerResult.tasks.length > directiveTaskCount * 2) {
        void notify(
          'progress', sprintId,
          '[Brain] plan:task-count-high',
          `AI planner returned ${plannerResult.tasks.length} tasks (>2x of ${directiveTaskCount}). Falling back to structured mode.`,
        );
        plannerResult = null;
        usedMode = 'fallback';
        plannerResolutionReason = 'task-count-high-fallback';
      } else {
        usedMode = 'ai';
        plannerResolutionReason = 'model-success';
        for (const pt of plannerResult.tasks) {
          tasks.push(createTask(
            plannerTaskToParams(pt, sprintId, defaultModel, initialStatus),
            seq++,
          ));
        }
      }
    } else if (planMode === 'ai'
      || callResult.reason === 'receipt_replay_blocked'
      || callResult.reason === 'receipt_failed') {
      plannerFailureReason = callResult.reason;
      plannerResolutionReason = callResult.reason === 'receipt_replay_blocked'
        || callResult.reason === 'receipt_failed'
        ? 'invocation-authority-failure'
        : 'model-failure';
      // Strict ai-mode: surface the actual failure reason + message so the user
      // sees *why* (spawn_failed / timeout / parse_failed / no_providers / …)
      // instead of a generic "failed" message. structured moda düşülmedi (mode=ai).
      throw new BrainError(
        `AI planner failed (provider=${brainProviderName ?? 'unknown'}, reason=${callResult.reason}). ` +
        `${callResult.message} structured moda düşülmedi (mode=${planMode}).`,
        SprintPhase.PLAN,
        buildPlannerProof('failed'),
      );
    } else {
      plannerFailureReason = callResult.reason;
      // auto mode + AI failure: surface via notify so operator/MCP/AI can see it.
      void notify(
        'phase-change', sprintId,
        '[Brain] plan:ai-failed',
        `AI planner failed (provider=${brainProviderName ?? 'unknown'}, reason=${callResult.reason}): ${callResult.message} — falling back to structured mode.`,
      );
      usedMode = 'fallback';
      plannerResolutionReason = 'model-failure-fallback';
    }
  }

  // Structured fallback (mode === 'structured' || AI fail + auto)
  if (!plannerResult && (planMode === 'structured' || planMode === 'auto')) {
    const structuredTasks = parsedDirectives;
    const directiveSources: Array<{ title: string; description: string; scope: TaskScope; provider?: import('../core/types.js').ProviderName; forceModel?: import('../core/types.js').ModelType; forceEffort?: import('../core/types.js').TaskEffort; testTarget?: string; forceAgent?: string; forceSkills?: string[]; excludeAgent?: string[]; excludeSkills?: string[]; priority?: import('../core/types.js').TaskPriority; dependencies?: string[]; authMode?: 'subscription' | 'api'; backend?: 'docker' | 'tmux' | 'subprocess'; modelEffort?: string; smoke?: { command: string; expect: string }; postSettlementProjection?: import('../core/task-types.js').PostSettlementPlanProjection; productionWiring?: import('../core/task-types.js').ProductionWiringPlanEvidence }> =
      structuredTasks.length > 0
        ? structuredTasks
        : (() => {
            // KN4 (GR-2026-08-08-DOGFOOD-KN4-01): the last-resort line splitter
            // used to turn EVERY non-heading line into a task — including the
            // narrative under `# Goal`, which became a scopeless task and died
            // at execution-landing admission ("landing scope must contain at
            // least one path"). The goal is CONTEXT, not work: track the
            // current heading and skip narrative lines inside a Goal/Amaç
            // section. Pattern-matched directives (Task headings / numbered
            // bullets) never reach this fallback and stay byte-identical.
            const out: Array<{ title: string; description: string; scope: TaskScope }> = [];
            let inGoalSection = false;
            for (const raw of context.directives.split('\n')) {
              const l = raw.trim();
              if (l.startsWith('#')) {
                inGoalSection = /^#+\s*(goal|ama[çc])\b/iu.test(l);
                continue;
              }
              if (!l) continue;
              const isBullet = /^[-*]\s+/u.test(l);
              // Inside a Goal section only BULLETS count as work — prose stays context.
              if (inGoalSection && !isBullet) continue;
              const line = l.replace(/^[-*]\s+/u, '');
              if (!line) continue;
              out.push({ title: line, description: line, scope: extractScopeFromDirective(line) });
            }
            return out;
          })();

    // Parse and deduplicate patterns from context for model selection
    const patternsRaw = typeof context.patterns === 'string' ? context.patterns : '';
    const parsedPatterns = deduplicatePatterns(parsePatterns(patternsRaw));

    // WM-7: resolve the project tech stack ONCE. Classification remains task-level,
    // while repository-wide commands are retained for wave verification rather
    // than copied into every generated task's acceptance criteria.
    const wm7Stack = detectFullStack(projectRoot);
    const wm7StackKind = normalizeTechStack(wm7Stack?.language);
    // Retain the detected command set as stack metadata. The criteria deriver
    // deliberately does not project these wave-level checks into each task.
    const wm7Commands = {
      build: wm7Stack?.commands?.build,
      test: wm7Stack?.commands?.test,
      typecheck: wm7Stack?.commands?.typecheck,
    };

    // born-636-K2 (COST-K2): routing.effort_tiering config-flag, default-off —
    // the sole surviving routing tuning flag (skill_agent_affinity/kindAffinity/
    // languagePenalty were removed with the V2 engine, S3 cut-over). It is typed
    // on DeckentConfig.routing (config-types.ts) and read directly below.
    // Known gap (disk-verified, pre-existing, unrelated to this diff):
    // `mergeConfigs()` does not pass `routing` through AT ALL (only `loadConfig`
    // does) — configs built via `mergeConfigs()` (many hermetic tests) never see
    // ANY `routing.*` flag, including effort_tiering. See sprint notes.
    const effortTieringEnabled = config.routing?.effort_tiering ?? false;

    for (let sourceIndex = 0; sourceIndex < directiveSources.length; sourceIndex++) {
      const src = directiveSources[sourceIndex]!;
      // The structured parser is the authority for explicit `Files:` entries.
      // Snapshot/merge them here, before routing and persistence, so later
      // existence/tracked-file classifiers can classify but never delete an
      // operator-declared create target. Fallback line-split tasks have no
      // structured declaration snapshot and therefore gain no authority.
      const declaredFiles = structuredTasks[sourceIndex]?.scope.filesWrite ?? [];
      const sourceScope = mergeDeclaredFilesIntoScope(src.scope, declaredFiles);
      if (src.forceModel) {
        resolveCanonicalModelIdentity(src.forceModel, {
          ...(src.provider ? { provider: src.provider } : {}),
          registerParametric: true,
        });
      }

      // born-479 (362-002 MODEL-DROP-FIX): a `- Model:` directive is a
      // deterministic user override and MUST win outright. Previously
      // `resolvedModel` ran forceModel through
      // `recommendation.modelConstraint ?? resolveTaskModel(...)` — when the
      // directive had no explicit `- Provider:` line (e.g. sprint-361's
      // `- Model: gpt-5` + `- Backend: subprocess`, no Provider line),
      // resolveTaskModel defaulted the target provider to the registry
      // default ('claude'), found gpt-5 unavailable there, and silently
      // rewrote it to the claude tier-equivalent ('opus') — while
      // task-router later (correctly) re-inferred provider='codex' from the
      // still-intact forceModel, leaving a written task JSON with a
      // mismatched model/provider pair (task.model='opus', task.provider=
      // 'codex'). forceModel now always resolves verbatim, independent of
      // provider presence/mismatch and of recommendation.modelConstraint
      // (which only ever constrains auto-selected, non-forced models). An
      // honest WARN fires when the model is not registered anywhere in the
      // catalog at all (adapter-provider tags are always accepted — Sprint
      // 236 pass-through contract); the override is preserved either way —
      // silent substitution is never acceptable.
      let resolvedModel: ModelType;
      if (src.forceModel) {
        resolvedModel = src.forceModel;
      } else {
        resolvedModel = recommendation.modelConstraint ??
          resolveTaskModel(src.title, src.description, sourceScope, config, parsedPatterns, undefined, undefined, src.provider);
      }
      // born-636-K2: task-tipi→effort tiering, flag-gated (effortTieringEnabled,
      // hoisted above the loop). `detectedTaskType` is computed once here and
      // reused below for `goNogo.kind` (previously a second, redundant call to
      // the same pure scope-only function — dedupe, zero behavior change).
      const detectedTaskType = detectTaskType({ scope: sourceScope } as Task);
      const tieredEffort: TaskEffort = detectedTaskType === 'audit'
        ? 'high'
        : effortForWorkType(
            produceContentStructural(
              { title: src.title, description: src.description, scope: sourceScope } as Task,
              producePositional({ title: src.title, description: src.description, scope: sourceScope } as Task, { domains: BUILTIN_DOMAINS }),
            ).workType,
          );
      // `- Effort:` directive ALWAYS wins (404-003 hint-chain, unchanged `??`);
      // flag-off (default) preserves the exact pre-existing 'normal' fallback.
      const resolvedEffort = src.forceEffort ?? (effortTieringEnabled ? tieredEffort : 'normal');
      tasks.push(createTask({
        title: src.title,
        description: src.description,
        model: resolvedModel,
        effort: resolvedEffort,
        priority: src.priority ?? 'NORMAL',
        reason: src.forceModel
          ? `Directive (model: ${resolvedModel} -- user override)`
          : `Directive (model: ${resolvedModel} -- resolved from scope/complexity/plan)`,
        scope: sourceScope,
        provider: src.provider,
        dependencies: src.dependencies ?? [],
        goNogo: extractGoNogoCriteria(src.description, src.testTarget, {
          kind: rubricTypeToKind(detectedTaskType),
          stack: wm7StackKind,
          commands: wm7Commands,
        }),
        verificationCommands: src.testTarget ? [src.testTarget] : undefined,
        sprintId,
        initialStatus,
        forceModel: src.forceModel,
        forceEffort: src.forceEffort,
        forceAgent: src.forceAgent,
        forceSkills: src.forceSkills,
        excludeAgent: src.excludeAgent,
        excludeSkills: src.excludeSkills,
        authMode: src.authMode,
        backend: src.backend,
        modelEffort: src.modelEffort,
        // PLAN-W1 Bug 1: thread the parsed Tier-1 Smoke: directive into the task
        // so it lands in the written `.tasks/task-*.json` (previously dropped here,
        // leaving the post-sprint proof-of-function gate with no command to run).
        smoke: src.smoke,
        // 488-014: thread the parsed PromotionProof directive into the task —
        // createTask() copies it onto Task.postSettlementProjection, never a
        // hidden Task of its own (see PostSettlementPlanProjection doc comment).
        postSettlementProjection: src.postSettlementProjection,
        productionWiring: src.productionWiring,
      }, seq++));
    }
  }

  // born-465 wire (359-001's honest debt, CC-paid): resolve every dependency
  // ref (title-prefix / "Task N" / index) to a concrete slot-id IN the written
  // task JSON, so all three runtime layers (wave-enforcement, scheduler graph,
  // continuous-dispatch gate) see the same ids. Unresolvable refs WARN+drop
  // (or throw under dependency_ref_strict) per the 358-010 loud contract.
  normalizeStructuredTaskDependencies(tasks);

  // Deadlock check
  const deadlocks = detectDeadlocks(tasks);
  if (deadlocks.length > 0) {
    throw new BrainError(
      `Circular dependencies detected: ${deadlocks[0]?.detail ?? 'unknown'}`,
      SprintPhase.PLAN,
    );
  }

  // D) Safeguard: warn if AI planner produced >2x the directive task count
  const directiveTaskCountForGuard = parsedDirectives.length;
  if (directiveTaskCountForGuard > 0 && tasks.length > directiveTaskCountForGuard * 2) {
    void notify(
      'progress', sprintId,
      '[Brain] plan:task-overflow',
      `Warning: ${tasks.length} tasks planned but directives only contain ${directiveTaskCountForGuard} tasks (>2x). Review the plan for excessive task generation.`,
    );
  }

  // ─── Routing Engine v3: provider-independent requirement/capability vectors ─
  try {
    const agentPool = new AgentPoolManager(projectRoot);
    const pool = agentPool.loadAgents();
    const projectStackV2 = detectProjectStack(projectRoot);
    const skillPoolV2 = new SkillPoolManager(projectRoot);
    const skillsV2 = skillPoolV2.loadSkills();

    // S3: the V2 learning-bonus block (the tasks[0]-DNA K4 bug) is retired —
    // V3's learning-cells feed the numerical axis per-task inside the adapter.

    // project-conventions is NO LONGER a routable/learnable skill: its content
    // ships as the deterministic project-context prompt segment injected for
    // every worker at compile time (task-builder → prompt-god-template).
    // Inserting it here made the learning loop grade an always-matching
    // pseudo-skill (CATALOG-STATS-AUTHORITY-001 correction, 2026-08-17).

    // Generate and persist project-specific temp agents (V2 only)
    try {
      const { generateTempAgents } = await import('./temp-skill-generator.js');
      if (projectStackV2) {
        const tempAgents = generateTempAgents(projectStackV2);
        for (const tempAgent of tempAgents) {
          if (!options?.dryRun) {
            agentPool.saveTempAgentToPool(tempAgent);
          }
          pool.set(tempAgent.id.startsWith('temp-') ? tempAgent.id : `temp-${tempAgent.id}`, tempAgent);
          debugLog('planSprint:temp-agent', `Generated temp agent: ${tempAgent.id} for ${projectStackV2.language}/${projectStackV2.framework}`);
        }
      }
    } catch (e) { debugLog('planSprint:generateTempAgents', e); }

    // Legacy evolved activation rules are intentionally not injected. V3
    // applicability + deterministic composition own skill selection; agent
    // adaptation flows through replayable learning cells. Keeping this retired
    // writer/consumer pair disconnected avoids an unjournaled feedback plane.

    // ADR-075 routing-balance gate (343-007): accumulate per-task agent
    // selections so the affinity distribution can be measured BEFORE the flag
    // is defaulted on. In-memory, non-blocking, never throws.

    // ─── ROUTING-V3 (S3 cut-over 2026-07-15: V3 is THE routing engine) ──────
    // Every task routes through the vector pipeline UNCONDITIONALLY — the V2
    // loop and its `routing_v3.enabled` gate are gone (Alperen: "v2'yi tamamen
    // kaldır"). One LLM batch enriches the content axis, matching stays
    // deterministic, escalations/catalog-gaps surface on the plan (decision-5
    // — never silent). `resolveRoutingV3Config` still supplies weights/topK/
    // governanceMode; only the removed `enabled` flag no longer gates anything.
    {
      const { routeTasksV3ForPlan } = await import('./routing-plan-adapter.js');
      const { resolveRoutingV3Config } = await import('../core/routing/config.js');
      const v3Config = resolveRoutingV3Config(null, config as Parameters<typeof resolveRoutingV3Config>[1]);

      // One-shot completion over the same provider machinery the AI planner
      // uses (governance mode = no completion → structural content).
      // Zero-hardcode: the batch rides the configured BRAIN model (planner's
      // own tier) — no model literal, no new spawnSync (async spawn + await).
      const contentBatchModel = config.activeModeConfig.brain_model;
      const completeFn =
        v3Config.governanceMode === 'ai'
          ? async (prompt: string): Promise<string> => {
              const { spawn } = await import('node:child_process');
              const { resolveAdapter, buildPlannerSpawnArgs } = await import('./planner.js');
              const adapter = resolveAdapter(undefined, contentBatchModel);
              const cmd = buildPlannerSpawnArgs(adapter, prompt, contentBatchModel);
              return await new Promise<string>((resolvePromise, rejectPromise) => {
                const child = spawn(cmd.command, cmd.args, { timeout: 120_000 });
                let out = '';
                let err = '';
                child.stdout?.on('data', (d: Buffer) => { out += d.toString(); });
                child.stderr?.on('data', (d: Buffer) => { err += d.toString(); });
                child.on('error', rejectPromise);
                child.on('close', (code: number | null) => {
                  if (code === 0 && out) {
                    // 581-B16 (root-cause, 2026-07-19): the provider CLI's
                    // `--output-format json` wraps the answer in an envelope
                    // `{"type":"result","result":"<escaped JSON string>"}`. The
                    // raw envelope was resolved verbatim, so BOTH consumers of
                    // this completeFn silently died on every call: the routing
                    // content-batch (`parseContentBatchResponse`'s
                    // indexOf('[')…lastIndexOf(']') sliced escaped `\"`s → JSON
                    // parse fail → structural fallback for 100% of tasks) AND
                    // the K3 tie-judge (`parseTieJudgeVerdict`'s `{…}` match
                    // grabbed the envelope, parsed OK, but `.agentId` was
                    // undefined → null → fail-open → never fired). Unwrap here,
                    // ONE point, exactly as parsePlannerResponse does via
                    // adapter.parseAgentResponse — revives both at once.
                    const unwrapped = typeof adapter.parseAgentResponse === 'function'
                      ? adapter.parseAgentResponse(out)
                      : out;
                    resolvePromise(unwrapped);
                  } else {
                    rejectPromise(new BrainError(`content-batch completion failed (provider=${adapter.name}, code=${code}): ${err.slice(0, 200)}`));
                  }
                });
              });
            }
          : undefined;

      const v3Result = await routeTasksV3ForPlan(tasks, projectRoot, v3Config, {
        ...(completeFn ? { complete: completeFn } : {}),
        sprintId,
        // In-memory pools: generated temp agents + the project-conventions
        // temp-skill must be V3-visible (they never exist on disk at plan time).
        pools: { agents: pool, skills: skillsV2 },
      });

      for (const esc of v3Result.escalations) {
        const line =
          `${esc.taskId} escalated (${esc.reason}): ${esc.detail}` +
          (esc.candidates.length > 0
            ? ` — candidates: ${esc.candidates.map((c) => `${c.agentId}@${c.finalScore.toFixed(2)}`).join(', ')}`
            : '');
        debugLog('planSprint:routing-v3-escalation', line);
        void notify('phase-change', sprintId, '[Brain] routing-v3:escalation', line);
      }
      for (const fb of v3Result.contentFallbacks) {
        debugLog('planSprint:routing-v3', `content fallback for ${fb.taskId}: ${fb.reason}`);
      }

      const unassigned = tasks.filter((t) => !t.assignedAgent);
      if (unassigned.length > 0) {
        throw new BrainError(
          `ROUTING-V3 catalog gap: ${unassigned.map((t) => t.id).join(', ')} have no capable agent. ` +
            `Run \`deckent agent lint\` for the gap map; author/widen a capability or adjust the tasks. ` +
            `(Honest gap — the V2 fallback chain is retired.)`,
        );
      }
    }



    // G-series plan-time prompt-gate (G1a persona + G1d decision-space + G1c premise):
    // flag every finalized task's (persona × intent) fit, goCriteria decision-shape, and
    // stale "X is missing" premises — source-agnostic (forceAgent AND router picks).
    // Surfaced by the caller (deckent plan / MCP); blocks on BLOCK unless acknowledged.
    // sprint-399 scope-contract lints: give the gate the real tracked-file set
    // (fail-soft — a git failure just skips the two scope lints, never blocks).
    let gateTrackedFiles: string[] | undefined;
    {
      const ls = spawnSync('git', ['ls-files'], {
        cwd: projectRoot, encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024, timeout: 5000,
      });
      if (ls.status === 0 && typeof ls.stdout === 'string') {
        gateTrackedFiles = ls.stdout.split('\n').filter(Boolean);
      }
    }
    const testDiscoveryContracts = resolveTestDiscoveryContracts(projectRoot);
    const testDiscoverabilityIssues = evaluateTestDiscoverability(tasks, testDiscoveryContracts, projectRoot);
    const gateLang = detectLang(projectRoot);
    promptGate = evaluatePromptGate({
      tasks,
      agentPool: pool,
      acknowledgePromptGate: options?.acknowledgePromptGate,
      trackedFiles: gateTrackedFiles,
      preflightFindings: testDiscoverabilityIssues.map(issue => ({
        taskId: issue.taskId,
        lint: 'test-discoverability' as const,
        level: 'block' as const,
        agentId: tasks.find(task => task.id === issue.taskId)?.assignedAgent ?? 'generic',
        message: getMessage('prompt_gate.test_not_discoverable', gateLang, {
          path: issue.testPath,
          runner: issue.runner,
          config: issue.configPath,
          include: issue.include.join(', '),
        }),
        suggestion: getMessage('prompt_gate.test_not_discoverable_fix', gateLang, {
          path: issue.testPath,
          config: issue.configPath,
        }),
      })),
      // G1c: bounded, fail-soft repo probe — count tracked files containing a symbol.
      // spawnSync git-grep exits 1 on no-match (→ status !== 0 → 0), so a missing symbol
      // or any error never invents a finding.
      probeRepo: (symbol: string): number => {
        if (!symbol || symbol.length < 4) return 0;
        const r = spawnSync('git', ['grep', '-I', '-l', '-F', '--', symbol], {
          cwd: projectRoot, encoding: 'utf-8', timeout: 2000,
        });
        if (r.status !== 0 || typeof r.stdout !== 'string') return 0;
        return r.stdout.split('\n').filter(Boolean).length;
      },
    });
    if (promptGate.findings.length > 0) {
      debugLog(
        'planSprint:prompt-gate',
        `${promptGate.findings.length} finding(s), ${promptGate.blockers.length} blocker(s), ok=${promptGate.ok}`,
      );
    }

    // PLAN persistence is an admission boundary, not merely a warning
    // surface. Replace each legacy scope with the compiler's exact projection
    // before any task JSON can be written; malformed/wildcard/cross-platform
    // ambiguous input therefore cannot reach the scheduler even when another
    // prompt-gate finding is acknowledged.
    for (const task of tasks) {
      const compiledScope = compileCanonicalScope({
        scope: task.scope,
        inventory: gateTrackedFiles,
      });
      if (!compiledScope.ok) {
        throw new BrainError(
          `PLAN_SCOPE_PREFLIGHT_HOLD:${task.id}:${compiledScope.holds
            .map(hold => `${hold.code}:${hold.field}:${hold.value}`).join('|')}`,
          SprintPhase.PLAN,
        );
      }
      task.scope = {
        directories: [...compiledScope.manifest.scope.directories],
        filesRead: [...compiledScope.manifest.scope.filesRead],
        filesWrite: [...compiledScope.manifest.scope.filesWrite],
      };
    }
  } catch (poolErr) {
    debugLog('planSprint:routing-v3', `Routing/prompt admission failed closed: ${poolErr}`);
    if (poolErr instanceof BrainError) throw poolErr;
    throw new BrainError(
      `ROUTING-V3 admission unavailable: ${poolErr instanceof Error ? poolErr.message : String(poolErr)}`,
      SprintPhase.PLAN,
    );
  }

  // KN2 — estimate-anchored REQUESTED budgets (owner karar-turu 2026-08-08).
  // Each task's request derives from its own estimator numbers × headroom; the
  // applier below narrows it against the owner-authored policy authority
  // (field-wise minimum), so a request can only tighten, never widen. Fail-SOFT:
  // an unloadable cost config only drops the USD leg (token ceilings still
  // derive — subscription-billed work needs containment too), and a task that
  // already carries a budget is an explicit request we must not overwrite.
  // ADR-G-036: every number below is config-resolved (cost config; its default
  // data source is the bundled pricing baseline). No literal fallback exists —
  // an unloadable cost config skips the stamping entirely (typed log) and the
  // policy AUTHORITY ceilings from the applier below still contain the task.
  try {
    initCostConfig(projectRoot);
    const costConfig = loadCostConfig(projectRoot);
    const estimator = costConfig.estimator;
    const estimate = estimateSprintCost(
      tasks.map((t) => buildTaskCostInput(t, estimator)),
      costConfig,
    );
    const perTaskUsd = new Map((estimate.taskDetails ?? []).map((d) => [d.id, d.costUsd]));
    for (const task of tasks) {
      if (task.budget !== undefined) continue;
      const costInput = buildTaskCostInput(task, estimator);
      task.budget = deriveRequestedExecutionBudget({
        estimatedInputTokens: costInput.estimatedInputTokens,
        estimatedOutputTokens: costInput.estimatedOutputTokens,
        ...(perTaskUsd.has(task.id) ? { estimatedCostUsd: perTaskUsd.get(task.id) } : {}),
        retryMultiplier: estimate.retryMultiplier,
        sprintMaxUsd: costConfig.cost_limits.sprint_max_usd,
        headroomFactor: estimator.budget_headroom_factor,
      });
    }
  } catch (e) {
    debugLog('planSprint:budget-derivation:cost-config', e);
  }

  // Owner-policy budget snapshot: run at the shared dry-run/persist boundary so
  // the approved preview and written task JSON carry the exact same ceilings.
  // This is deliberately NOT an executable permit; final live provider/model/
  // auth/backend + reachability/limit evidence are bound at host dispatch.
  applyWorkerExecutionBudgetPolicy(tasks, config.execution_budget, config.worker_provider);

  // ── RUN-POLICY-DELIVERY-001 (correction-2): task-carried run policy ────
  // Resolve the run's binding execution policy ONCE at plan time and stamp the
  // identical digest-bound snapshot on EVERY task BEFORE the first task-JSON
  // persistence below — the on-disk task is what workers are spawned from, so
  // a post-persistence stamp would deliver nothing at runtime. All creation
  // paths (ai, structured, fallback, injected-debt) have converged by this
  // point; FIX attempts inherit the parent snapshot (debt-manager) instead of
  // re-resolving, so a mid-run DIRECTIVES edit can never silently supersede
  // the policy a run was admitted under.
  const runPolicy = resolveRunPolicyFromDirectives(context.directives);
  if (runPolicy) {
    for (const stampTarget of tasks) stampTarget.runPolicy = runPolicy;
  }

  // 7094: stamp the stable cross-sprint workload identity and exact effective
  // prompt-feature snapshot before the first task JSON write. FIX attempts copy
  // this authority byte-for-byte; they never recompute it from mutable config.
  for (const stampTarget of tasks) {
    stampTarget.promptCostCanary = createPromptCostCanaryTaskAuthority(
      stampTarget,
      config.prompt,
    );
  }

  // A task-level Docker pin can select exact custody even when the run's
  // default backend is not Docker. Defer the whole plan's compatibility
  // projection in that case; the canonical executor publishes legacy tasks
  // before their legacy dispatch and exact tasks only after RELEASED.
  const deferTaskArtifactProjection = shouldDeferTaskArtifactProjection(
    tasks,
    options?.deferTaskArtifactProjection,
  );

  // Write task files (skip in dry-run or exact pre-publication mode)
  if (!options?.dryRun && !deferTaskArtifactProjection) {
    const tasksPath = join(projectRoot, TASKS_DIR);
    mkdirSync(tasksPath, { recursive: true });
    for (const task of tasks) {
      debugLog(
        'planSprint:task-write',
        `Writing ${task.id}: assignedAgent=${task.assignedAgent ?? 'undefined'}, assignedSkills=[${(task.assignedSkills ?? []).join(', ')}]`,
      );
      await writeFile(join(tasksPath, `task-${task.id}.json`), JSON.stringify(task, null, 2), 'utf-8');
    }

    // Sprint 179 W1-2 — re-plan orphan cleanup. Tasks rewritten above; remove
    // stale `task-{sprintNum}-NNN.json` siblings whose id slipped out of the
    // new plan (cross-sprint files left intact).
    const newTaskIds = new Set(tasks.map(t => t.id));
    const orphans = cleanupOrphanTaskFiles(projectRoot, sprintId, newTaskIds);
    if (orphans.length > 0) {
      debugLog('planSprint:orphan-cleanup', `Removed ${orphans.length} orphan task file(s) for ${sprintId}`);
    }
  }

  const plannerProof = buildPlannerProof(usedMode);

  return {
    id: sprintId,
    number: parseInt(sprintId.replace('sprint-', ''), 10),
    status: SprintStatus.PLANNING,
    phase: SprintPhase.PLAN,
    tasks,
    workers: tasks.map(t => `w-${t.id}`),
    reasoning: plannerResult?.reasoning,
    planningMode: usedMode,
    plannerProof,
    promptGate,
  };
}

/**
 * A single router-level override warning (F8, Sprint 182 —
 * forceAgent/forceSkills semantic-mismatch advisory), tagged with the task it
 * belongs to.
 */
export interface OverrideWarningEntry {
  taskId: string;
  message: string;
}

/**
 * born-595 (395-005): flatten each task's `routingMeta.overrideWarnings` into a
 * flat, task-id-tagged list for surfacing at the `deckent plan` CLI surface.
 *
 * `overrideWarnings` are already produced by `routeTaskV2` / the routing loop
 * above (attached to `task.routingMeta.overrideWarnings`) — this is a read-only
 * projection over that existing data, not a new source of warnings. Task order
 * and per-task warning order are preserved.
 * @param tasks - Sprint tasks (post-routing, i.e. `sprint.tasks`)
 * @returns Flattened `{ taskId, message }` entries, in task/warning order
 */
export function collectOverrideWarnings(tasks: Task[]): OverrideWarningEntry[] {
  const entries: OverrideWarningEntry[] = [];
  for (const task of tasks) {
    const warnings = task.routingMeta?.overrideWarnings;
    if (!warnings || warnings.length === 0) continue;
    for (const message of warnings) {
      entries.push({ taskId: task.id, message });
    }
  }
  return entries;
}

/**
 * Transition all DRAFT tasks in a sprint to PENDING status and persist changes.
 * @param projectRoot - Project root directory
 * @param sprint - Sprint whose draft tasks should be confirmed
 */
export async function confirmDraftTasks(projectRoot: string, sprint: Sprint): Promise<void> {
  const tasksPath = join(projectRoot, TASKS_DIR);
  for (const task of sprint.tasks) {
    if (task.status === TaskStatus.DRAFT) {
      task.status = TaskStatus.PENDING;
      await writeFile(
        join(tasksPath, `task-${task.id}.json`),
        JSON.stringify(task, null, 2),
        'utf-8',
      );
    }
  }
}

/**
 * Remove stale `.tasks/task-{sprintNum}-NNN.json` files that belong to the
 * given sprint but are not part of the freshly-planned task ID set.
 *
 * Sprint 179 W1-2 — when Brain re-plans a sprint (e.g. after auto-debt
 * injection shifts the id-slot allocation), task files from the previous
 * plan attempt could linger on disk and confuse downstream tooling (the
 * Auditor would otherwise see ghost workers). This helper deletes them.
 *
 * Cross-sprint isolation: files whose filename prefix does not match the
 * current sprint number are NEVER touched, so co-resident sprint archives
 * remain safe. Sibling files (`.hb`, `.result`, `.plan`) are ignored — this
 * helper only scans `task-*.json`.
 *
 * @param projectRoot Project root directory containing `.tasks/`.
 * @param sprintId Sprint identifier (e.g. `sprint-179`). Sprint number is
 *   derived from the trailing numeric segment.
 * @param newTaskIds Set of task IDs that survived the latest plan; files
 *   whose parsed `task.id` is absent from this set are removed.
 * @param opts.dryRun When true, return the would-be removal list without
 *   touching disk.
 * @returns Absolute paths of the (would-be) removed task files.
 */
export function cleanupOrphanTaskFiles(
  projectRoot: string,
  sprintId: string,
  newTaskIds: Set<string>,
  opts?: { dryRun?: boolean },
): string[] {
  const tasksPath = join(projectRoot, TASKS_DIR);
  if (!existsSync(tasksPath)) return [];

  const sprintNum = sprintId.replace(/^sprint-/, '');
  if (!sprintNum) return [];
  const sprintPrefix = `task-${sprintNum}-`;

  const removed: string[] = [];
  const files = readdirSync(tasksPath).filter(
    f => f.startsWith(sprintPrefix) && f.endsWith('.json'),
  );

  for (const file of files) {
    const filePath = join(tasksPath, file);
    let taskId: string | undefined;
    try {
      const raw = readFileSync(filePath, 'utf-8');
      const task = JSON.parse(raw);
      taskId = typeof task?.id === 'string' ? task.id : undefined;
    } catch (e) {
      debugLog('cleanupOrphanTaskFiles:parseTaskFile', e);
      continue;
    }
    if (!taskId || newTaskIds.has(taskId)) continue;

    removed.push(filePath);
    if (!opts?.dryRun) {
      try {
        unlinkSync(filePath);
      } catch (e) {
        debugLog('cleanupOrphanTaskFiles:unlink', e);
      }
    }
  }

  return removed;
}

/**
 * Remove existing DRAFT task files from .tasks/ directory.
 * Called before planning to ensure idempotency — re-running `deckent plan`
 * cleans up stale drafts from a previous plan.
 * @param projectRoot - Project root directory
 */
export function cleanupDraftTasks(projectRoot: string): void {
  const tasksPath = join(projectRoot, TASKS_DIR);
  if (!existsSync(tasksPath)) return;
  const files = readdirSync(tasksPath).filter(f => f.startsWith('task-') && f.endsWith('.json'));
  for (const file of files) {
    const filePath = join(tasksPath, file);
    try {
      const raw = readFileSync(filePath, 'utf-8');
      const task = JSON.parse(raw);
      if (task.status === TaskStatus.DRAFT) {
        unlinkSync(filePath);
      }
    } catch (e) {
      debugLog('cleanupDraftTasks:parseTaskFile', e);
    }
  }
}

// ═══ Sprint 179 W1-1 — Auto-debt scope inheritance + verified-no-result skip ═══

/**
 * Result of injecting CRITICAL debt items into the sprint as priority fix tasks.
 */
export interface DebtInjectionResult {
  /** Newly created Task objects ready to be added to the sprint. */
  tasks: Task[];
  /** Next available sequence number after injection (callers continue from here). */
  nextSeq: number;
  /** Debt IDs that were intentionally skipped (e.g. verified-no-result). */
  skipped: string[];
  /**
   * born-603: debt IDs skipped as an "honest no-op fix-wave echo" (heuristic
   * text-pattern classification — see {@link isHonestNoopFixWaveEcho}).
   * Deliberately kept SEPARATE from `skipped`: `planSprint()` resolves every
   * id in `skipped` via `resolveDebt` (permanent closure), but this
   * classification is a text-pattern guess, not a verified structural class
   * — a false positive here must stay OPEN and get re-evaluated next sprint,
   * not close real debt forever. Count this array's length for reporting.
   */
  skippedNoop: string[];
}

/**
 * Build the broad legacy fallback scope used when a debt item carries no
 * `originScope` (e.g. older debt rows persisted before Sprint 179 W1-1).
 */
function legacyFallbackScope(): TaskScope {
  return { directories: ['src/'], filesRead: [], filesWrite: ['src/'] };
}

// born-603 (396-003): a fix-wave task (`<id>-fix` / `<id>-xfix`) that
// investigated and found nothing wrong still produces a GO_WITH_TECH_DEBT /
// NO_GO ledger row (recordDebtEntry has no "no-defect" DebtClass yet — that
// producer-side fix is tracked separately, out of this task's scope).
// sprint-395 saw such a row re-injected as a fresh CRITICAL "Priority fix for
// critical debt item" task, which just spawns another no-op investigation
// worker that reports the same "no defect" finding — an infinite low-value
// loop. Conjunctive on purpose: an origin-suffix match alone would ALSO skip
// real fix-wave defects (silently dropping actionable debt); a content match
// alone would ALSO skip ordinary (non-fix-wave) debt whose note happens to
// mention "no defect" about something unrelated. Both signals together
// narrow this to the exact sprint-395 shape.
const FIX_WAVE_ORIGIN_RE = /-(fix|xfix)$/;
const NO_DEFECT_NOTE_RE = /no defect|no source change|no code change/i;

/**
 * True when `item` is an honest no-op echo from a fix-wave task: the origin
 * task id is itself a priority-fix (`-fix`/`-xfix`), AND the debt note says
 * no defect/source/code change was found. See {@link FIX_WAVE_ORIGIN_RE}.
 */
function isHonestNoopFixWaveEcho(item: DebtItem): boolean {
  return FIX_WAVE_ORIGIN_RE.test(item.originTaskId) && NO_DEFECT_NOTE_RE.test(item.description);
}

/**
 * Translate CRITICAL debt items into priority fix tasks for the next sprint.
 *
 * Sprint 179 W1-1 behaviour:
 *  - `class === 'verified-no-result'` → skip (honest closure, no work needed).
 *  - `class === 'timeout-partial'` → skip (Sprint 364): a killed-worker partial
 *    diff already accepted into the tree — no described defect, so a forced fix
 *    task only spawns a no-op worker that re-injects every sprint.
 *  - born-603 (Sprint 396): honest no-op fix-wave echo (see
 *    {@link isHonestNoopFixWaveEcho}) → skip WITHOUT resolving (tracked in
 *    `skippedNoop`, not `skipped` — see {@link DebtInjectionResult}).
 *  - `originScope` present → inherit `directories` + `filesWrite`; when exact
 *    `filesWrite` targets exist, `filesRead` mirrors `directories` as context.
 *    A directory-only fix keeps `filesRead` empty so every backend recognizes
 *    the established directory-fallback WRITE authority instead of silently
 *    reclassifying the fix as inspection-only.
 *  - `originScope` absent → broad legacy fallback `src/` (matches behaviour
 *    expected of pre-W1-1 debt rows so they still get a fix attempt).
 */
export function injectCriticalDebtTasks(
  debt: DebtItem[],
  sprintId: string,
  defaultModel: ModelType,
  startingSeq: number,
  initialStatus: TaskStatus,
): DebtInjectionResult {
  const tasks: Task[] = [];
  const skipped: string[] = [];
  const skippedNoop: string[] = [];
  let seq = startingSeq;

  for (const item of debt) {
    if (item.priority !== DebtPriority.CRITICAL || item.resolved) continue;

    // Honest closure: verified-no-result debts have no follow-up work, and
    // timeout-partial debts (Sprint 364) record a killed-worker event whose
    // partial diff reconciliation already accepted into the tree — neither has a
    // described code defect, so injecting a CRITICAL fix task only spawns a
    // no-op worker that flails and re-injects every sprint.
    if (item.class === 'verified-no-result' || item.class === 'timeout-partial') {
      skipped.push(item.id);
      continue;
    }

    // born-603: honest no-op fix-wave echo — a heuristic (text-pattern)
    // classification, not a verified structural class, so it goes into
    // `skippedNoop` (never resolved) instead of `skipped` (permanently
    // resolved by planSprint's caller loop).
    if (isHonestNoopFixWaveEcho(item)) {
      skippedNoop.push(item.id);
      continue;
    }

    // sprint-573/574: a success-echo debt (note = pure verification evidence,
    // no actionable gap) has nothing to fix. Typed class from the producer
    // when present; the text fallback covers legacy rows written before the
    // class existed. skippedNoop (never resolved) — like the noop-echo above,
    // this is a classification, and a false positive must stay open.
    if (item.class === 'success-echo'
      || (item.class == null && isSuccessOnlyDebtNote(item.description))) {
      skippedNoop.push(item.id);
      continue;
    }

    const hasOriginScope = !!item.originScope
      && (item.originScope.directories.length > 0 || item.originScope.filesWrite.length > 0);

    const scope: TaskScope = hasOriginScope
      ? {
          directories: [...item.originScope!.directories],
          // Directories already provide navigation context. Exact read scope
          // must instead carry the original targets themselves so a debt worker
          // can observe an already-satisfied protected/root-file residual even
          // when the prompt sanitizer correctly withholds WRITE authority.
          filesRead: [...item.originScope!.filesWrite],
          filesWrite: [...item.originScope!.filesWrite],
        }
      : legacyFallbackScope();

    const scopeNote = hasOriginScope
      ? `Origin scope inherited (directories=[${scope.directories.join(', ')}], filesWrite=[${scope.filesWrite.join(', ')}]).`
      : 'No origin scope on debt — broad legacy fallback (src/) applied.';

    // born-603: `item.description` now carries the full debt note (mapper
    // change in readContext) rather than an 80-char-sliced title, so keep the
    // task TITLE compact (it previously was, de-facto, via the DB's title
    // slice) while the task DESCRIPTION carries the full note verbatim
    // instead of the old generic "Priority fix for critical debt item X"
    // placeholder — the worker sees exactly what was previously found.
    // sprint-573/574: strip the ledger's fixed evaluator preamble first — it
    // is identical on every row and was eating most of the 100-char title
    // budget, leaving titles that said nothing about the actual debt.
    const strippedNote = item.description
      .replace(/^Task evaluated as (DONE, but worker self-assessed GO_WITH_TECH_DEBT|GO_WITH_TECH_DEBT)\.\s*Notes:\s*/i, '');
    const titleNote = strippedNote.length > 100
      ? `${strippedNote.slice(0, 100)}…`
      : strippedNote;

    const fixTask = createTask({
      title: `Fix debt: ${titleNote}`,
      // sprint-573/574: debt notes routinely open with verification receipts
      // before naming the residual gap; without this framing, fix workers
      // read the green evidence, conclude "already done", and honestly no-op.
      description: 'The debt note below may mix PRIOR verification evidence with the residual '
        + 'gap description. Implement ONLY the residual/remaining gap(s); the green results '
        + 'quoted are from the ORIGINAL task, not proof this debt is resolved.\n\n'
        + `${item.description}\n\n${scopeNote}`,
      model: defaultModel,
      effort: 'high',
      priority: 'CRITICAL',
      reason: `Critical debt open for ${item.sprintsOpen} sprints`,
      scope,
      dependencies: [],
      goNogo: {
        goCriteria: 'Debt resolved',
        noGoCriteria: 'Debt still present',
        techDebtAcceptable: '',
        items: [
          createGoNoGoCriterionItem({
            polarity: 'go',
            statement: 'Debt resolved',
            evidenceRequirements: ['Debt resolved'],
          }),
          createGoNoGoCriterionItem({
            polarity: 'no-go',
            statement: 'Debt still present',
            evidenceRequirements: ['Debt still present'],
          }),
        ],
      },
      sprintId,
      isPriorityFix: true,
      fixForTaskId: item.originTaskId,
      initialStatus,
    }, seq++);
    const compiledFixScope = compileCanonicalScope({ scope: fixTask.scope });
    if (!compiledFixScope.ok) {
      throw new TypeError(
        `FIX_SCOPE_PREFLIGHT_HOLD:${fixTask.id}:${compiledFixScope.holds
          .map(hold => `${hold.code}:${hold.field}:${hold.value}`).join('|')}`,
      );
    }
    fixTask.scope = {
      directories: [...compiledFixScope.manifest.scope.directories],
      filesRead: [...compiledFixScope.manifest.scope.filesRead],
      filesWrite: [...compiledFixScope.manifest.scope.filesWrite],
    };
    tasks.push(fixTask);
  }

  return { tasks, nextSeq: seq, skipped, skippedNoop };
}
