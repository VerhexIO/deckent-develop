// ═══ run-flow-controller — TERM-FLOW-UNIFY Sprint-3 dilim (425-001) ════════
//
// docs/analysis/term-flow-unify-design-2026-07-11.md ("Net Öneri"): the first
// real caller of the Sprint-1 contract/reducer (core/run-flow-contract.ts,
// orchestra/run-flow-reducer.ts) and the Sprint-2 shared-preview layer
// (orchestra/run-proposal-compiler.ts, orchestra/plan-preview-service.ts).
// Host-owned coordinator behind `terminal.run_flow_v2` (default OFF) — drives
// a `deckent_propose_run` native-tool call from PROPOSAL_SUBMITTED through
// PREVIEW_READY (a REAL Brain plan preview, not a stub) up to APPROVED via
// approve()/reject(). Never constructs START_REQUESTED — no method here can
// reach STARTING/DETACHED_RUNNING; that is dilim-4's job (design doc Sprint-4,
// "Exact-snapshot start", run-job-service.ts/run-flow-store.ts).
//
// ADR-D-004 (Layer-1 import direction): this file lives under cli/repl/ (a
// "surface") and imports orchestra/ entrypoints only (run-flow-reducer,
// run-proposal-compiler, plan-preview-service, brain.js's readContext) — C2/C3
// explicitly allow a surface to call approved orchestra/ entrypoints; nothing
// here re-implements orchestration logic (C3: surfaces host no reusable
// business logic — every actual decision is delegated to the reducer/services
// above, "yeniden-icat yok").
//
// Single-flow-per-instance by design: `proposeRun` may run exactly once per
// controller (COLLECTING -> PROPOSAL_READY is a one-way door in the reducer
// itself); a second call surfaces the reducer's own RunFlowTransitionError
// rather than a redundant guard duplicated here — this is also the "ikinci
// plan-yolu doğarsa NO_GO" invariant: there is structurally only one path
// from a fresh controller to a plan preview.
//
// Factory-closure shape (not a class) — matches this directory's existing
// stateful-module convention (createApprovalCardQueue in approval-card.tsx,
// createCliToolDispatcher in chat-tool-bridge.ts, createDefaultSkillDispatcher
// above in native-tool-registry.ts).

import { randomUUID } from 'node:crypto';
import { basename } from 'node:path';
import {
  type RunFlowContext,
  type RunProposal,
  createInitialRunFlowContext,
  isTerminalRunFlowState,
} from '../../core/run-flow-contract.js';
import type { ActorContext, RequestOrigin } from '../../core/work-model.js';
import type { BrainPlanningMode, ResolvedConfig, SprintSizeRecommendation } from '../../core/types.js';
import type { ExecutionWriteScopePolicy } from '../../core/execution-write-scope-policy.js';
import {
  decideRunFlowPlan,
  planRunFlow,
  type RunFlowScopeEvidence,
} from '../../orchestra/run-flow-plan-service.js';
import { startRunFlow } from '../../orchestra/run-flow-decision-service.js';
import { getRunFlowCoordinator } from '../../orchestra/run-flow-coordinator-registry.js';
import type {
  SpawnExactProcessContext,
  SpawnExactProcessResult,
} from '../../orchestra/exact-plan-start-service.js';
import { readContext } from '../../orchestra/brain.js';
import { resolveBrainModel } from '../../core/config.js';
import { getProviderForModel } from '../../core/task-types.js';
import { buildFlowStartSpawn } from '../helpers/detached-start.js';
// TERM5-CTRL (sprint-427, task 5) — the SAME completion-notification shape
// run.tsx already receives from `createRunCompletionWatch`'s `onComplete`
// callback (wireBgTurnsProducer, run.tsx) — see applyRunCompletion below.
import type { RunCompletionInfo } from './run-completion-watch.js';

/**
 * RECOVERY-BORN-NATIVE-DO-SLASH-PROVIDER-BOOTSTRAP-001 (MASTER 3331) — typed
 * planner hold: the provider registry does not carry the provider the resolved
 * brain model implies, even after the `ensureProviders` seam ran. Replaces the
 * raw `Provider not found: "<provider>"` string that used to escape into the
 * REPL transcript. `code` is the planner's own `PlannerFailureReason`
 * vocabulary (`no_providers`, planner.ts) in the run-flow error family; the
 * message stays machine-shaped — surfaces localize `details` themselves
 * (app.tsx `formatDoSlashNoProviders`, key `do.slash_no_providers`).
 */
export interface RunFlowProviderHoldDetails {
  flowId: string;
  /** Brain model resolved from effective config (`resolveBrainModel`). */
  model: string;
  /** Provider the model implies (from the planner error, else the registry); null if unknown. */
  provider: string | null;
  /** Providers registered when the hold was raised (post-bootstrap). */
  registered: readonly string[];
}

export class RunFlowProviderHoldError extends Error {
  readonly code = 'NO_PROVIDERS' as const;
  constructor(readonly details: RunFlowProviderHoldDetails, options?: { cause?: unknown }) {
    super(
      `run-flow-controller: NO_PROVIDERS — model "${details.model}" resolves to provider ` +
        `"${details.provider ?? 'unknown'}"; registered providers: [${details.registered.join(', ')}] ` +
        `(flowId=${details.flowId})`,
      options,
    );
    this.name = 'RunFlowProviderHoldError';
  }
}

/** Walk the `cause` chain (bounded) for a ProviderNotFoundError — matched by
 *  name so this module never statically loads core/provider.js. */
function findProviderNotFound(err: unknown): { providerName: string | null } | null {
  let cursor: unknown = err;
  for (let depth = 0; depth < 8 && cursor && typeof cursor === 'object'; depth++) {
    const candidate = cursor as { name?: unknown; providerName?: unknown; cause?: unknown };
    if (candidate.name === 'ProviderNotFoundError') {
      return { providerName: typeof candidate.providerName === 'string' ? candidate.providerName : null };
    }
    cursor = candidate.cause;
  }
  return null;
}

function safeProviderForModel(model: string): string | null {
  try {
    return getProviderForModel(model as Parameters<typeof getProviderForModel>[0]);
  } catch {
    return null;
  }
}

export interface RunFlowControllerDeps {
  /** Project root — threaded straight into readContext()/generatePlanPreview(). */
  root: string;
  config: ResolvedConfig;
  tenant?: string;
  project?: string;
  actor?: ActorContext;
  origin?: RequestOrigin;
  /**
   * 3331 — awaited BEFORE the planner resolves an adapter: the ONE lazy,
   * idempotent provider bootstrap (provider-bootstrap.ts). Returns the providers
   * registered afterwards so a residual miss can be reported as a typed
   * {@link RunFlowProviderHoldError}. run.tsx's `wireRunFlowMount` supplies the
   * production default; absent (unit tests, legacy callers) → no bootstrap,
   * `registered` reported as `[]`.
   */
  ensureProviders?: () => Promise<readonly string[]>;
  /** Seam for tests — production default is crypto.randomUUID(). */
  generateFlowId?: () => string;
  /** Seam for tests — production default is `() => new Date().toISOString()`. */
  now?: () => string;
  /** Sprint-size recommendation override — production default mirrors
   *  cli/commands/plan.ts's own inline object (full-size, config-derived maxWorkers). */
  recommendation?: SprintSizeRecommendation;
  /** Defaults to 'structured' — deterministic, no AI/provider bootstrap, the
   *  same forced mode CLI `plan --dry-run` already uses (see plan.ts). */
  mode?: BrainPlanningMode;
  /**
   * TERM-FLOW-UNIFY Sprint-4 mount (426-002) — seam for startApproved()'s
   * actual detached spawn. Production default builds the SAME
   * `deckent start --flow-id <id> --revision <n> --plan-digest <digest>` CLI
   * args as mcp/tools/start.ts's own spawnStart closure (see startApproved's
   * doc comment below) via spawnDetachedDeckent — no reinvention. Tests
   * inject a fake so no real sprint is ever spawned.
   */
  spawnStart?: (context: SpawnExactProcessContext) => SpawnExactProcessResult;
  /**
   * Dogfood-449 B1 — operator's `--force-scope` consent. Two effects, both
   * mirroring `deckent start`: (a) proposeRun's front-door scope-gate mirror
   * acknowledges write-suspects instead of failing the preview, (b) the
   * default spawnStart forwards `--force-scope` to the detached child so the
   * child's own PLAN-phase gate makes the SAME decision. Default: false.
   */
  forceScope?: boolean;
  /** Digest-bound owner authority. When present, `forceScope` cannot widen it. */
  writeScopePolicy?: ExecutionWriteScopePolicy;
  /** Hermetic/platform scope-evidence adapter forwarded to the canonical
   * plan service. Production normally uses its bounded git adapter. */
  scopeEvidence?: RunFlowScopeEvidence;
}

export interface RunFlowController {
  getContext(): RunFlowContext;
  /** Runs exactly once per controller instance — see file header. */
  proposeRun(intentSummary: string): Promise<RunFlowContext>;
  /** Approves whatever preview is CURRENTLY live — revision/planDigest are
   *  self-derived from `getContext().preview`, never caller-suppliable (no
   *  stale-digest approval is possible by construction). */
  approve(approvedBy: ActorContext): RunFlowContext;
  reject(reason?: string): RunFlowContext;
  /**
   * TERM-FLOW-UNIFY Sprint-4 mount (426-002) — drives an APPROVED context
   * through Task-1's run-flow-store/run-job-service APIs to STARTING then
   * DETACHED_RUNNING. This is where dilim-3's "approvedSnapshot lives only
   * in-process, stops at APPROVED" limit (see approve()'s doc comment) is
   * actually lifted — deliberately NOT inside approve() itself, which stays
   * pinned to APPROVED/no-handle by tests/cli/run-flow-controller.test.ts
   * (out of this task's write scope). Idempotent when called again while
   * already STARTING/DETACHED_RUNNING (the reducer's own duplicate-replay
   * handling — see run-flow-reducer.ts). Optional so the pre-426-002
   * RunFlowController shape (e.g. that test file's fakeController()) still
   * structurally satisfies this interface without modification.
   */
  startApproved?(): RunFlowContext;
  /**
   * TERM5-CTRL (sprint-427, task 5) — the controller's completion channel:
   * consumes a flowId-correlated completion notification
   * (run-completion-watch.ts's `RunCompletionInfo`, e.g. delivered by
   * `createRunCompletionWatch`'s `onComplete` callback filtered to this
   * controller's own flowId — the same channel run.tsx's
   * `wireBgTurnsProducer` already consumes) and drives
   * DETACHED_RUNNING -> COMPLETED / (STARTING|DETACHED_RUNNING) -> FAILED
   * through the SAME `reduceRunFlow` every other method in this file goes
   * through — no hand-rolled state mutation here.
   *
   * Two invariants, both defense-in-depth against a mis-wired or duplicate
   * caller (the production caller is already flowId-filtered at the watch
   * layer, but this method never assumes that holds):
   *   - a wrong-flow event (`event.flowId` unset, or not equal to the live
   *     `getContext().flowId`) is a loud-logged no-op — context is returned
   *     unchanged.
   *   - once the flow has already reached a terminal state
   *     (COMPLETED/FAILED/CANCELLED/BLOCKED — e.g. this exact event
   *     redelivered by an at-least-once watcher) this is a SILENT no-op —
   *     an expected replay, not an anomaly.
   * A context that is non-terminal but not yet STARTING/DETACHED_RUNNING is
   * a genuine ordering bug, not a race this method smooths over — it is left
   * to surface `reduceRunFlow`'s own typed `RunFlowTransitionError`.
   *
   * Optional for the same reason `startApproved` is: the pre-427-005
   * `RunFlowController` shape (e.g. tests/cli/run-flow-controller.test.ts's
   * `fakeController()`) still structurally satisfies this interface without
   * modification.
   */
  applyRunCompletion?(event: RunCompletionInfo): RunFlowContext;
}

function defaultRecommendation(config: ResolvedConfig): SprintSizeRecommendation {
  return {
    size: 'full',
    maxWorkers: typeof config.activeModeConfig.max_workers === 'number' ? config.activeModeConfig.max_workers : 4,
    modelConstraint: null,
    reason: 'No usage constraints',
  };
}

export function createRunFlowController(deps: RunFlowControllerDeps): RunFlowController {
  let context: RunFlowContext = createInitialRunFlowContext();
  const generateFlowId = deps.generateFlowId ?? (() => randomUUID());
  const getContext = (): RunFlowContext => {
    if (!context.flowId) return context;
    try {
      context = getRunFlowCoordinator(deps.root).getFlow(context.flowId);
    } catch {
      // The in-memory context remains the honest fallback until its first
      // durable proposal event exists.
    }
    return context;
  };
  // TERM-FLOW-UNIFY Sprint-4 mount (426-002) — the real planned Sprint (task
  async function proposeRun(intentSummary: string): Promise<RunFlowContext> {
    const trimmed = intentSummary.trim();
    if (trimmed.length === 0) {
      throw new Error('run-flow-controller: intentSummary must be a non-empty string');
    }

    const flowId = generateFlowId();
    const revision = 1;
    const proposal: RunProposal = {
      flowId,
      tenant: deps.tenant ?? 'local',
      project: deps.project ?? basename(deps.root),
      actor: deps.actor ?? { id: 'native-agent' },
      origin: deps.origin ?? 'chat',
      revision,
      intentSummary: trimmed,
    };

    const recommendation = deps.recommendation ?? defaultRecommendation(deps.config);
    // 3331: bootstrap the provider registry BEFORE planning (see the seam's doc).
    const registered: readonly string[] = deps.ensureProviders ? await deps.ensureProviders() : [];
    const result = await planRunFlow({
      projectRoot: deps.root,
      config: deps.config,
      recommendation,
      proposal,
      lineage: {
        tenantId: proposal.tenant,
        actor: proposal.actor,
        origin: proposal.origin,
        correlationId: proposal.flowId,
        idempotencyKey: `plan:${proposal.flowId}:r${proposal.revision}`,
        sourceRef: 'terminal:run-flow',
      },
      source: {
        sourceKind: 'intent',
        baseContext: readContext(deps.root),
      },
      previewOptions: {
        mode: deps.mode ?? 'structured',
        ...(deps.writeScopePolicy ? { writeScopePolicy: deps.writeScopePolicy } : {}),
      },
      acknowledgeScopePaths: deps.forceScope === true,
      ...(deps.scopeEvidence ? { scopeEvidence: deps.scopeEvidence } : {}),
    }).catch((err: unknown) => {
      const notFound = findProviderNotFound(err);
      if (!notFound) throw err;
      const model = resolveBrainModel(deps.config);
      throw new RunFlowProviderHoldError(
        { flowId, model, provider: notFound.providerName ?? safeProviderForModel(model), registered },
        { cause: err },
      );
    });
    context = result.context;

    return context;
  }

  function approve(approvedBy: ActorContext): RunFlowContext {
    const { preview, flowId } = context;
    if (!preview || !flowId) {
      throw new Error('run-flow-controller: approve() requires a live preview (call proposeRun first; state must be AWAITING_APPROVAL)');
    }
    if (preview.topologyGateResult === 'fail') {
      throw new Error('run-flow-controller: structural topology gate blocked approval');
    }
    context = decideRunFlowPlan(deps.root, flowId, {
      decision: 'approve',
      actor: approvedBy,
      ...(deps.forceScope === true ? { acknowledgeScopePaths: true } : {}),
    });
    return context;
  }

  /** See {@link RunFlowController.startApproved} for the full rationale. */
  function startApproved(): RunFlowContext {
    const { flowId, approvedSnapshot, state } = context;
    if (state !== 'APPROVED' && state !== 'STARTING' && state !== 'DETACHED_RUNNING') {
      throw new Error(
        `run-flow-controller: startApproved() requires state 'APPROVED' (call approve() first; current state: '${state}')`,
      );
    }
    // born-681: in-process idempotency artık CONTEXT'ten gelir (disk-handle'dan
    // değil — parent handle YAZMAZ, tek-yazar child). Aynı controller'da ikinci
    // çağrı: iş zaten başladıysa (handle reduce edilmiş) sessiz no-op replay.
    if (state === 'STARTING' || state === 'DETACHED_RUNNING') {
      return context;
    }
    if (!flowId || !approvedSnapshot) {
      throw new Error('run-flow-controller: startApproved() requires an approved snapshot (call approve() first)');
    }
    const result = startRunFlow(deps.root, flowId, {
      lineage: {
        tenantId: context.proposal?.tenant ?? deps.tenant ?? 'local',
        actor: approvedSnapshot.approvedBy,
        origin: deps.origin ?? 'chat',
        correlationId: flowId,
        idempotencyKey: `start:${flowId}:r${approvedSnapshot.revision}`,
        sourceId: 'terminal:run-flow',
        authorization: { kind: 'approved-actor' },
      },
      spawnStart: deps.spawnStart ?? buildFlowStartSpawn(
        deps.root,
        approvedSnapshot.revision,
        approvedSnapshot.planDigest,
        undefined,
        deps.forceScope === true ? ['--force-scope'] : [],
      ),
    });
    context = result.context;
    return context;
  }

  function reject(reason?: string): RunFlowContext {
    const { flowId } = context;
    if (!flowId) {
      throw new Error('run-flow-controller: reject() requires an active flow (call proposeRun first)');
    }
    context = decideRunFlowPlan(deps.root, flowId, {
      decision: 'reject',
      actor: deps.actor ?? { id: 'native-agent' },
      ...(reason !== undefined ? { reason } : {}),
    });
    return context;
  }

  /** See {@link RunFlowController.applyRunCompletion} for the full rationale. */
  function applyRunCompletion(event: RunCompletionInfo): RunFlowContext {
    const { flowId } = context;

    if (flowId === undefined || event.flowId !== flowId) {
      console.error(
        `[run-flow-controller] ignoring completion event for jobId='${event.jobId}' ` +
          `(event.flowId='${event.flowId ?? '<unset>'}') — controller is tracking flowId='${flowId ?? '<unset>'}'`,
      );
      return context;
    }

    const coordinator = getRunFlowCoordinator(deps.root);
    context = coordinator.getFlow(flowId);
    const { state } = context;
    if (isTerminalRunFlowState(state)) {
      // Idempotent replay — the flow already reached a terminal state (most
      // commonly this exact event redelivered by an at-least-once watcher).
      // Silent: this is expected steady-state behavior, not an anomaly.
      return context;
    }

    context = event.status === 'COMPLETE'
      ? coordinator.recordCompletion({
          flowId,
          summary: `run ${event.jobId} completed`,
          commandId: `watch-complete-${flowId}-${event.jobId}`,
        }).context
      : coordinator.recordRunFailure({
          flowId,
          error: event.error ?? `run ${event.jobId} failed`,
          commandId: `watch-failed-${flowId}-${event.jobId}`,
        }).context;
    return context;
  }

  return {
    getContext,
    proposeRun,
    approve,
    reject,
    startApproved,
    applyRunCompletion,
  };
}
