// ═══ run-flow-routes — TERM-FLOW-UNIFY Sprint-7 dilim (429-008) ════════════
//
// docs/analysis/term-flow-unify-design-2026-07-11.md, Sprint-7 row: "Yeni
// api/run-flow-routes.ts, api/run-flow-event-stream.ts" — "Desktop aynı
// flow-service'i tüketir". This is the REST consumer of the SAME
// compiler/preview-service/reducer/store services cli/repl/run-flow-
// controller.ts already drives — NOT a second flow-engine. Every state
// transition below goes through the one pure reducer (`reduceRunFlow`);
// nothing here hand-rolls approval/rejection semantics.
//
// ADR-D-004 C3 (surfaces MUST NOT import one another — api/ <-> cli/):
// run-flow-controller.ts lives under cli/repl/, so it cannot be imported
// from here. This module reimplements the controller's exact event
// sequence (PROPOSAL_SUBMITTED -> PREVIEW_STARTED -> PREVIEW_READY ->
// APPROVAL_GRANTED/APPROVAL_REJECTED) directly against the shared
// orchestra/core services instead — "yeniden-icat yok" refers to the
// compiler/preview-service/reducer/store, not the (necessarily duplicated,
// per-surface) sequencing glue around them.
//
// Four routes only, flag-gated behind `terminal.run_flow_v2` (default off —
// the whole /api/run-flow/* namespace answers 404 while off, same
// "config-gated default-off -> 404" contract as oidc-callback-endpoint.ts's
// dashboard_oidc gate):
//   POST /api/run-flow/propose            — NL intentSummary -> proposal + REAL plan preview
//   GET  /api/run-flow/:flowId            — full flow state (flow-state-get)
//   GET  /api/run-flow/:flowId/preview    — the live PlanPreview only (preview-get)
//   POST /api/run-flow/:flowId/decision   — {decision:'approve'|'reject', reason?} (approve/reject)
//
// NO start endpoint in this slice (design doc Sprint-7 row / DIRECTIVES.md
// Task 8: "start dilim-sonrası karar") — approve() persists the resulting
// ApprovedPlanSnapshot to core/run-flow-store.ts (the same durable store a
// future start-endpoint would read back via loadApprovedSnapshot) but
// nothing here ever calls startApprovedRun or spawns a process.
//
// State is in-process only: a module-level Map<flowId, FlowRecord> — same
// single-process lifetime assumption server.ts's own `activeJobs` Map
// already makes for /api/start's job tracking. A flow's pre-approval stages
// (PROPOSAL_READY/PREVIEWING/AWAITING_APPROVAL) do not survive an API
// process restart; only the APPROVED state's ApprovedPlanSnapshot is durable
// (core/run-flow-store.ts).
//
// Auth/rate-limit: this module intentionally carries NEITHER — both already
// apply centrally in server.ts's dispatch (SlidingWindowRateLimiter +
// bearerAuthMiddleware guard every /api/* path) once this module is wired in
// a later task. The only thing this module does itself is derive
// tenant/role from the verified bearer via deriveRequestPrincipal (never
// from the request body — anti-spoofing), exactly like every other route
// module in this directory (missions-route.ts, process-endpoint.ts).
//
// Tenant isolation mirrors missions-route.ts: a flow's tenant is pinned from
// `proposal.tenant` (itself derived from the request principal at propose
// time, never client-supplied). A caller from a different tenant (and not
// role==='admin') gets 404 — no existence leak.
//
// KNOWN STALE-PIN NOTE (see .result docImpact): tests/orchestra/run-flow-
// reducer.test.ts's KNOWN_CONSUMERS allowlist does not yet list this file —
// DIRECTIVES.md Task 10 (429-010) is the planned follow-up that adds it
// after this task and its SSE sibling (429-009) land.

import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { getRunFlowCoordinator, _resetRunFlowCoordinatorsForTests } from '../orchestra/run-flow-coordinator-registry.js';
import { FlowNotFoundError, InvalidTransitionError } from '../orchestra/run-flow-coordinator.js';
import { RunJobError } from '../orchestra/run-job-service.js';
import { decideRunFlow, startRunFlow, RunFlowDecisionError } from '../orchestra/run-flow-decision-service.js';
import { ExactPlanStartError } from '../orchestra/exact-plan-start-service.js';
import { computeRunDiff } from '../orchestra/run-diff-service.js';
import { buildFlowStartSpawn } from '../cli/helpers/detached-start.js';
import { publishRunFlowEvent } from './run-flow-event-stream.js';
import { basename } from 'node:path';
import { z } from 'zod';
import { loadConfig } from '../core/config.js';
import type { ResolvedConfig, SprintSizeRecommendation } from '../core/types.js';
import {
  RunFlowTransitionError,
  isTerminalRunFlowState,
  type RunFlowContext,
  type RunProposal,
} from '../core/run-flow-contract.js';
import { readTerminalJobClosures } from '../core/run-jobs-read.js';
import type { RunProposalPlanner } from '../orchestra/run-proposal-compiler.js';
import { planRunFlow } from '../orchestra/run-flow-plan-service.js';
import { readContext } from '../orchestra/brain.js';
import { deriveRequestPrincipal } from './auth-me-endpoint.js';
import { resolveCallerTenant, TenantScopeError } from '../core/principal.js';
import type { ProviderAuthorityRuntimeServiceOpenResult } from '../core/provider-authority-composition.js';
import { preflightApiBrainProviderAuthority } from './provider-authority-ingress.js';
import { attendedExecutionProjectId } from '../core/attended-execution-approval.js';

// PRINCIPAL-001 P1a: the API principal's provenance rides into the actor —
// authorization can now SEE whether it is trusting verified claims, merely
// parsed claims, or the unauthenticated 'api-static' fallback.
function apiPrincipalToActor(
  principal: ReturnType<typeof deriveRequestPrincipal>,
): import('../core/work-model.js').ActorContext {
  return {
    id: principal.id,
    ...(principal.role ? { role: principal.role } : {}),
    ...(principal.tenantId ? { tenantId: principal.tenantId } : {}),
    identityClass: principal.id === 'api-static' ? 'service' : 'oidc',
    assurance: principal.claimsVerified === true
      ? 'token-verified'
      : principal.id === 'api-static' ? 'unverified' : 'token-parsed',
    provenance: 'api',
  };
}


const RUN_FLOW_PREFIX = '/api/run-flow/';
const RUN_FLOW_DISABLED_MESSAGE =
  'run-flow API is disabled — set terminal.run_flow_v2: true in .deckent/config.json to enable /api/run-flow/*';

/** Path-segment guard for `:flowId` — flowId ultimately reaches
 *  core/run-flow-store.ts, which joins it straight into a filename with no
 *  sanitization of its own (path-traversal defense-in-depth, same
 *  convention as server.ts's APPROVAL_ID_RE). Production flowIds are always
 *  randomUUID() output, which this pattern already covers. */
const FLOW_ID_RE = /^[a-zA-Z0-9_-]+$/;

const ProposeRunSchema = z.object({
  intentSummary: z.string().min(1).max(20_000),
}).strict();

const DecisionSchema = z.object({
  decision: z.enum(['approve', 'reject']),
  reason: z.string().max(2000).optional(),
}).strict();

// ─── In-process flow state ──────────────────────────────────────────────

// SURF-1c: the module-level FlowRecord Map is DEAD. The per-root
// RunFlowCoordinator (durable event-log + rehydrate + command-idempotency)
// is the single authority; the planned Sprint rides the durable store
// (savePlannedSprint / loadPlannedSprint) so an approve after a process
// restart still builds its StoredApprovedSnapshot.

/** Resolve the shared coordinator for this root, wired to the SSE publisher. */
function coordinatorFor(projectRoot: string) {
  return getRunFlowCoordinator(projectRoot, { onEvent: publishRunFlowEvent });
}

/** Test-only seam — drops every cached coordinator (fresh durable fold next call). */
export function _resetRunFlowRoutesState(): void {
  _resetRunFlowCoordinatorsForTests();
}

/**
 * Test seam for the NL -> plan step (mirrors setChatStreamAdapter /
 * setRpcLimitProbeSpawnImpl in server.ts). Production default is
 * `undefined`, which lets compileRunProposal fall back to its own real
 * AI/structured planner core. Tests inject a hermetic fake planner instead —
 * the real default spawns a provider CLI via spawnSync (orchestra/planner.ts
 * callZeroConfigPlanner) and must never run in a test process.
 */
let proposalPlannerOverride: RunProposalPlanner | undefined;

/** Install (or clear) the RunProposalPlanner used by POST /api/run-flow/propose. Pass undefined to reset. */
export function setRunFlowProposalPlanner(planner: RunProposalPlanner | undefined): void {
  proposalPlannerOverride = planner;
}

// ─── Helpers ─────────────────────────────────────────────────────────────

function sendJson(res: ServerResponse, data: unknown, status = 200): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function sendError(res: ServerResponse, status: number, message: string): void {
  sendJson(res, { error: message }, status);
}

/** Mirrors run-flow-controller.ts's own defaultRecommendation — duplicated
 *  (not imported) because that function lives in cli/repl/, unreachable
 *  from api/ under ADR-D-004 C3; the pure ~6-line body is cheaper to
 *  duplicate than to relocate a cli/repl/-owned helper for one new caller. */
function defaultRecommendation(config: ResolvedConfig): SprintSizeRecommendation {
  return {
    size: 'full',
    maxWorkers: typeof config.activeModeConfig.max_workers === 'number' ? config.activeModeConfig.max_workers : 4,
    modelConstraint: null,
    reason: 'No usage constraints',
  };
}

/** Looks up a flow, enforcing tenant isolation (same fail-closed/no-leak
 *  contract as missions-route.ts's findApprovalEntry-adjacent checks):
 *  a caller outside the flow's tenant (and not role==='admin') gets
 *  `undefined`, indistinguishable from a genuinely unknown flowId. */
function lookupFlow(flowId: string, req: IncomingMessage, projectRoot: string, strictTenant = false): RunFlowContext | undefined {
  let context: RunFlowContext;
  try {
    context = coordinatorFor(projectRoot).getFlow(flowId);
  } catch (err) {
    if (err instanceof FlowNotFoundError) return undefined;
    throw err;
  }
  const principal = deriveRequestPrincipal(req);
  // TENANT-001 T1: strict mode refuses a tenant-less caller instead of folding
  // it into `local` (the NULL-tenant hole the flag was meant to close but never
  // gated — it only ever reached the compliance report).
  const callerTenant = resolveCallerTenant(principal, strictTenant);
  const isAdmin = principal.role === 'admin';
  const flowTenant = context.proposal?.tenant ?? 'local';
  if (!isAdmin && flowTenant !== callerTenant) return undefined;

  // SURF-6 kuyruk — jobs-join (the CLI inbox's F-3 join, API edition): a
  // do-origin flow has no durable event log (Slice-3 deferral), so its folded
  // context claims DETACHED_RUNNING forever even after the sprint finished.
  // The jobs-dir execution truth wins for DISPLAY: a terminal job record
  // upgrades the non-terminal context in the RESPONSE only — read-only, the
  // durable log stays the single transition authority (nothing is appended;
  // decide/start paths also see the honest state and refuse phantom decides).
  if (!isTerminalRunFlowState(context.state)) {
    const closure = readTerminalJobClosures(projectRoot).get(flowId);
    if (closure !== undefined) {
      context = {
        ...context,
        state: closure.state,
        ...(closure.error !== undefined ? { failureReason: closure.error } : {}),
        ...(closure.completedAt !== undefined ? { updatedAt: closure.completedAt } : {}),
      };
    }
  }
  return context;
}

// ─── POST /api/run-flow/propose ─────────────────────────────────────────

async function handlePropose(
  res: ServerResponse,
  projectRoot: string,
  config: ResolvedConfig,
  body: unknown,
  req: IncomingMessage,
  providerAuthority?: ProviderAuthorityRuntimeServiceOpenResult,
): Promise<boolean> {
  const parsed = ProposeRunSchema.safeParse(body);
  if (!parsed.success) {
    sendError(res, 400, parsed.error.message);
    return true;
  }

  // TENANT-001 T1: strict mode refuses a tenant-less caller instead of folding
  // it into `local` — the NULL-tenant hole `strict_tenant_isolation` was
  // introduced to close but never gated (it only reached the compliance
  // report). An unresolved tenant is an AUTHORIZATION refusal (403), answered
  // here rather than thrown, so the request never hangs. Default-off keeps v1
  // behaviour byte-identical.
  const principal = deriveRequestPrincipal(req);
  let callerTenant: string;
  try {
    callerTenant = resolveCallerTenant(principal, config.strict_tenant_isolation === true);
  } catch (err) {
    if (err instanceof TenantScopeError) {
      sendError(res, 403, err.message);
      return true;
    }
    throw err;
  }

  // Identity is ALWAYS derived server-side from the verified bearer — never
  // from the request body (anti-spoofing, matches process-endpoint.ts).
  const flowId = randomUUID();
  const providerDecision = preflightApiBrainProviderAuthority(
    projectRoot,
    config,
    providerAuthority,
    `api-run-flow-propose-${flowId}`,
  );
  if (providerDecision.decision === 'hold') {
    sendJson(res, providerDecision.body, providerDecision.statusCode);
    return true;
  }
  const revision = 1;
  const proposal: RunProposal = {
    flowId,
    tenant: callerTenant,
    project: basename(projectRoot),
    actor: apiPrincipalToActor(principal),
    origin: 'api',
    revision,
    intentSummary: parsed.data.intentSummary.trim(),
  };

  try {
    const result = await planRunFlow({
      projectRoot,
      config,
      recommendation: defaultRecommendation(config),
      proposal,
      lineage: {
        tenantId: proposal.tenant,
        actor: proposal.actor,
        origin: proposal.origin,
        correlationId: proposal.flowId,
        idempotencyKey: `plan:${proposal.flowId}:r${proposal.revision}`,
        sourceRef: 'api:run-flow',
      },
      source: {
        sourceKind: 'intent',
        baseContext: readContext(projectRoot, {
          scope: principal.tenantId !== undefined
            ? { kind: 'tenant', tenantId: callerTenant, projectId: attendedExecutionProjectId(projectRoot) }
            : { kind: 'local-project', projectId: attendedExecutionProjectId(projectRoot) },
        }),
        ...(proposalPlannerOverride ? { planner: proposalPlannerOverride } : {}),
      },
      previewOptions: {
        mode: 'structured',
      },
    });
    sendJson(res, result.context, 201);
    return true;
  } catch (err) {
    // A proposal that cannot be planned is a typed failure, never a
    // silently degraded scaffold (mirrors RunProposalPlanError's own
    // contract) — nothing is persisted to flowStore for a failed proposal.
    sendError(res, 502, err instanceof Error ? err.message : 'run-flow: preview generation failed');
    return true;
  }
}

// ─── GET /api/run-flow/:flowId ──────────────────────────────────────────

function handleFlowStateGet(res: ServerResponse, flowId: string, req: IncomingMessage, projectRoot: string): boolean {
  const context = lookupFlow(flowId, req, projectRoot);
  if (!context) {
    sendError(res, 404, 'Flow not found');
    return true;
  }
  sendJson(res, context);
  return true;
}

// ─── GET /api/run-flow/:flowId/preview ──────────────────────────────────

function handlePreviewGet(res: ServerResponse, flowId: string, req: IncomingMessage, projectRoot: string): boolean {
  const context = lookupFlow(flowId, req, projectRoot);
  if (!context || !context.preview) {
    sendError(res, 404, 'Flow not found');
    return true;
  }
  sendJson(res, context.preview);
  return true;
}

// ─── POST /api/run-flow/:flowId/decision ────────────────────────────────

function handleDecision(
  res: ServerResponse,
  projectRoot: string,
  flowId: string,
  body: unknown,
  req: IncomingMessage,
): boolean {
  const parsed = DecisionSchema.safeParse(body);
  if (!parsed.success) {
    sendError(res, 400, parsed.error.message);
    return true;
  }

  const existing = lookupFlow(flowId, req, projectRoot);
  if (!existing) {
    sendError(res, 404, 'Flow not found');
    return true;
  }

  const principal = deriveRequestPrincipal(req);
  let context: RunFlowContext;

  try {
    // The decide sequence itself lives in orchestra/run-flow-decision-service.ts
    // — shared verbatim with the CLI/REPL surfaces (no second implementation).
    context = decideRunFlow(projectRoot, flowId, {
      decision: parsed.data.decision,
      ...(parsed.data.reason !== undefined ? { reason: parsed.data.reason } : {}),
      actor: apiPrincipalToActor(principal),
    });
  } catch (err) {
    if (
      err instanceof RunFlowDecisionError ||
      err instanceof RunFlowTransitionError ||
      err instanceof InvalidTransitionError
    ) {
      sendError(res, 409, err.message);
      return true;
    }
    throw err;
  }

  sendJson(res, context);
  return true;
}

// ─── GET /api/run-flow (list — SURF-2 parity) ───────────────────────────

function handleFlowList(res: ServerResponse, req: IncomingMessage, projectRoot: string): boolean {
  const coordinator = coordinatorFor(projectRoot);
  const summaries: Array<{ flowId: string; state: string; intentSummary?: string; revision?: number }> = [];
  for (const flowId of coordinator.listFlows()) {
    const context = lookupFlow(flowId, req, projectRoot); // tenant-guarded — non-visible flows are simply absent
    if (!context) continue;
    summaries.push({
      flowId,
      state: context.state,
      ...(context.proposal?.intentSummary ? { intentSummary: context.proposal.intentSummary } : {}),
      ...(context.preview?.revision !== undefined ? { revision: context.preview.revision } : {}),
    });
  }
  sendJson(res, { flows: summaries });
  return true;
}

// ─── POST /api/run-flow/:flowId/start (SURF-2 parity) ───────────────────

/** Mirrors the terminal controller's startApproved: START_REQUESTED via the
 *  coordinator, detached spawn through the SAME CLI-args closure, RUN_STARTED
 *  recorded — child stays the single handle-writer (born-681). */
function handleStart(
  res: ServerResponse,
  projectRoot: string,
  flowId: string,
  req: IncomingMessage,
  config: ResolvedConfig,
  providerAuthority?: ProviderAuthorityRuntimeServiceOpenResult,
): boolean {
  const existing = lookupFlow(flowId, req, projectRoot);
  if (!existing) {
    sendError(res, 404, 'Flow not found');
    return true;
  }
  const snapshot = existing.approvedSnapshot;
  if (existing.state !== 'APPROVED' || !snapshot) {
    sendError(res, 409, `run-flow: flow is ${existing.state}, not APPROVED`);
    return true;
  }

  const providerDecision = preflightApiBrainProviderAuthority(
    projectRoot,
    config,
    providerAuthority,
    `api-run-flow-start-${flowId}`,
  );
  if (providerDecision.decision === 'hold') {
    sendJson(res, providerDecision.body, providerDecision.statusCode);
    return true;
  }

  try {
    // START_REQUESTED → spawn → RUN_STARTED lives in the shared decision
    // service; the argv shape comes from the ONE builder both surfaces use.
    const principal = deriveRequestPrincipal(req);
    const actor = apiPrincipalToActor(principal);
    const result = startRunFlow(projectRoot, flowId, {
      lineage: {
        tenantId: existing.proposal?.tenant ?? 'local',
        actor,
        origin: 'api',
        correlationId: flowId,
        idempotencyKey: `start:${flowId}:r${snapshot.revision}`,
        sourceId: 'api:run-flow',
        authorization: { kind: 'approved-actor' },
      },
      spawnStart: buildFlowStartSpawn(projectRoot, snapshot.revision, snapshot.planDigest),
    });
    sendJson(res, {
      accepted: result.status === 'accepted',
      duplicate: result.status === 'noop-duplicate',
      attemptId: result.attempt.attemptId,
      context: result.context,
    }, 202);
    return true;
  } catch (err) {
    if (
      err instanceof RunJobError ||
      err instanceof RunFlowTransitionError ||
      err instanceof InvalidTransitionError ||
      err instanceof RunFlowDecisionError
    ) {
      sendError(res, 409, err.message);
      return true;
    }
    if (err instanceof ExactPlanStartError) {
      sendJson(res, { error: err.message, code: err.code }, 409);
      return true;
    }
    throw err;
  }
}

// ─── POST /api/run-flow/:flowId/cancel (SURF-2 parity) ──────────────────

const CancelSchema = z.object({ reason: z.string().max(2000).optional() }).strict();

/** Any non-terminal flow → CANCELLED (durable FLOW_ABORTED). NOTE: cancelling
 *  a DETACHED_RUNNING flow closes the FLOW record; the detached sprint
 *  process itself is owned by the sprint lifecycle (deckent kill) — the
 *  response says so explicitly rather than pretending to reap the process. */
function handleCancel(
  res: ServerResponse,
  projectRoot: string,
  flowId: string,
  body: unknown,
  req: IncomingMessage,
): boolean {
  const parsed = CancelSchema.safeParse(body ?? {});
  if (!parsed.success) {
    sendError(res, 400, parsed.error.message);
    return true;
  }
  const existing = lookupFlow(flowId, req, projectRoot);
  if (!existing) {
    sendError(res, 404, 'Flow not found');
    return true;
  }
  const principal = deriveRequestPrincipal(req);
  try {
    const result = coordinatorFor(projectRoot).abortFlow({
      flowId,
      reason: parsed.data.reason ?? `cancelled via API by ${principal.id}`,
      commandId: `cancel-${flowId}-${existing.state}`,
    });
    const wasRunning = existing.state === 'DETACHED_RUNNING' || existing.state === 'STARTING';
    sendJson(res, {
      context: result.context,
      ...(wasRunning
        ? { note: 'flow record closed; the detached sprint process is governed by the sprint lifecycle (deckent kill), not this endpoint' }
        : {}),
    });
    return true;
  } catch (err) {
    if (err instanceof RunFlowTransitionError || err instanceof InvalidTransitionError) {
      sendError(res, 409, err.message);
      return true;
    }
    throw err;
  }
}

// ─── Dispatch ────────────────────────────────────────────────────────────

/**
 * Handle run-flow HTTP routes. Returns true when the route matched (a
 * response was sent), false to let the caller fall through. Async — the
 * flag check and the propose handler both need a loaded ResolvedConfig.
 */
export async function registerRunFlowRoutes(
  url: string,
  method: string,
  res: ServerResponse,
  body: unknown,
  projectRoot: string,
  req: IncomingMessage,
  providerAuthority?: ProviderAuthorityRuntimeServiceOpenResult,
): Promise<boolean> {
  const path = new URL(url, 'http://localhost').pathname;
  if (!path.startsWith(RUN_FLOW_PREFIX)) return false;

  const config = await loadConfig(projectRoot);
  if (config.terminal?.run_flow_v2 !== true) {
    sendError(res, 404, RUN_FLOW_DISABLED_MESSAGE);
    return true;
  }

  const rest = path.slice(RUN_FLOW_PREFIX.length);
  const segments = rest.split('/').filter(Boolean);
  if (segments.length === 0) return false;

  if (method === 'POST' && segments.length === 1 && segments[0] === 'propose') {
    return handlePropose(res, projectRoot, config, body, req, providerAuthority);
  }
  if (method === 'GET' && segments.length === 1 && segments[0] === 'list') {
    return handleFlowList(res, req, projectRoot);
  }

  const flowId = decodeURIComponent(segments[0]!);
  if (!FLOW_ID_RE.test(flowId)) {
    sendError(res, 400, 'Invalid flow id');
    return true;
  }

  if (segments.length === 1 && method === 'GET') {
    return handleFlowStateGet(res, flowId, req, projectRoot);
  }
  if (segments.length === 2 && segments[1] === 'diff' && method === 'GET') {
    // 583/N1 (GAP-4): the run's real footprint as a unified diff — the SAME
    // shared service the terminal's `runs --diff` prints. Tenant-guarded read.
    const flowId = segments[0]!;
    const context = lookupFlow(flowId, req, projectRoot);
    if (!context) {
      sendError(res, 404, 'Flow not found');
      return true;
    }
    sendJson(res, await computeRunDiff(projectRoot, flowId));
    return true;
  }
  if (segments.length === 2 && segments[1] === 'preview' && method === 'GET') {
    return handlePreviewGet(res, flowId, req, projectRoot);
  }
  if (segments.length === 2 && segments[1] === 'decision' && method === 'POST') {
    return handleDecision(res, projectRoot, flowId, body, req);
  }
  if (segments.length === 2 && segments[1] === 'start' && method === 'POST') {
    return handleStart(res, projectRoot, flowId, req, config, providerAuthority);
  }
  if (segments.length === 2 && segments[1] === 'cancel' && method === 'POST') {
    return handleCancel(res, projectRoot, flowId, body, req);
  }

  return false;
}
