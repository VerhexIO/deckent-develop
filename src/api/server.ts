import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { resolveApiCallerTenant, readStrictTenantIsolation } from './tenant-scope.js';
import { readFileSync, existsSync, readdirSync, writeFileSync, mkdirSync, renameSync, unlinkSync, chmodSync } from 'node:fs';
import { basename, join, extname, resolve } from 'node:path';
import { platform as osPlatform } from 'node:os';
import { spawn as nodeSpawn } from 'node:child_process';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import type { SessionBackend } from './terminal/session-backend.js';
import { PtySessionManager } from './terminal/session-manager.js';
import { LocalTokenAuthProvider, JwksAuthProvider } from './terminal/auth-provider.js';
import type { AuthProvider } from './terminal/auth-provider.js';
import { TerminalAudit, MemoryStoreAuditSink } from './terminal/audit.js';
import { loadOrCreateAuditKey } from './terminal/audit-integrity.js';
import { attachTerminalGateway } from './terminal/ws-gateway.js';
import { OutboundLimiter } from './terminal/outbound-limiter.js';
import type { AiTool, CreateSessionInput, SessionKind, TenantId, SessionMeta } from './terminal/types.js';
import { z } from 'zod';
import {
  DASHBOARD_FILE, BRAIN_DIR, SPRINTS_DIR, TASKS_DIR, LOCKS_DIR,
  PROJECT_CONFIG_PATH, DIRECTIVES_FILE, MEMORY_DB_FILE, DECKENT_VERSION, RUNTIME_DIR,
  autonomousPendingPath,
} from '../core/constants.js';
import { SprintStatus, SprintPhase, TaskStatus } from '../core/types.js';
import { writeConfigJsonAtomic } from '../core/config-write-authority.js';
import type { Task, Sprint } from '../core/types.js';
import { readJsonSafe } from '../core/utils.js';
import { deepMerge } from '../core/config.js';
import { MemoryStore } from '../core/memory-store.js';
import { watchDashboard } from './watcher.js';
import { bearerAuthMiddleware, isLocalhostRequest, resolveAuthToken, verifyBearerToken } from './auth.js';
import { injectApiTokenIntoHtml, isLoopbackRemote } from './middleware/token.js';
import { parseSprintLog } from '../cli/commands/history.js';
import { runDoctorChecks } from '../cli/commands/doctor.js';
import { killWorker, killAllWorkers } from '../orchestra/tmux.js';
// KABUL Gün-1 A1 «Changes» — the N4 git surface's HTTP face (587-deseni: the
// ONE service, now three consumers: CLI + chat tools + Desktop).
import {
  gitWorkflowStatus,
  gitWorkflowDiff,
  gitWorkflowAdd,
  gitWorkflowCommit,
  buildCommitProposal,
  buildRunCommitProposal,
} from '../orchestra/git-workflow-service.js';
// RUN-INSPECTOR-001 — canonical, authority-backed sprint inspection read-model.
import {
  buildRunInspectorSnapshot,
  listRunInspectorRuns,
  observeRunInspectorSnapshot,
  readRunInspectorTaskDetail,
  SPRINT_TASK_ID_RE,
} from '../core/run-inspector-read-model.js';
import { loadConfig, createDefaultConfig, validatePartialConfig, ConfigValidationError } from '../core/config.js';
import { readWorkerLog } from '../agents/worker.js';
import { buildAgentCatalogEntries } from '../core/agent-catalog-projection.js';
import { readContext, cleanup } from '../orchestra/brain.js';
import { planRunFlow } from '../orchestra/run-flow-plan-service.js';
import {
  IncomingMessageRouter,
  isValidConnectorId,
  parseWebhookPayload,
  validateWebhookKey,
} from '../connectors/incoming-router.js';
import { loadDeckSecrets } from '../core/deck-file.js';
import { interpolateConfig } from '../core/deck-interpolation.js';
import { resolveChatReply } from './chat-handler.js';
import { streamChatMessage, streamToSseLines, type ChatProviderAdapter } from './chat-stream.js';
import { startLiveEventBridge, formatLiveEventFrame, type LiveEventBridge } from './live-events.js';
import { matchWorkerLogStream, isValidTaskId, handleWorkerLogStream } from './worker-logs.js';
import { registerEvolutionRoutes } from './evolution-endpoint.js';
import { registerMemorySearch } from './memory-search-endpoint.js';
import { registerNervousRoutes } from './nervous-endpoint.js';
import { registerAutonomousRoutes } from './autonomous-endpoint.js';
import { registerProcessRoutes } from './process-endpoint.js';
import { registerReactiveRoutes } from './reactive-endpoint.js';
import { registerMissionsRoute } from './missions-route.js';
import { registerRunFlowRoutes } from './run-flow-routes.js';
import { registerRunFlowEventStreamRoute } from './run-flow-event-stream.js';
import { registerEnterpriseRoutes, handleEnterpriseTenantWrite, handleEnterpriseRbacWrite, handleEnterpriseRateWrite } from './enterprise-endpoint.js';
import { resolveChatProvider } from '../core/config.js';
import { resolveChatAdapter } from '../cli/commands/chat-provider-parity.js';
import { registerCoverageRoutes } from './coverage-endpoint.js';
import { registerKpiEndpoint } from './kpi-endpoint.js';
import { registerKpiTrendEndpoint } from './kpi-trend-endpoint.js';
import { registerDocsHealthRoute } from './docs-health-endpoint.js';
import { registerAuthMeRoute, deriveRequestPrincipal } from './auth-me-endpoint.js';
import { registerOidcCallbackRoute } from './oidc-callback-endpoint.js';
import { registerApprovalHistoryRoute } from './approval-history-endpoint.js';
import { registerLimitsRoute } from './limits-endpoint.js';
import { registerEvaluateHealthRoute } from './evaluate-health-endpoint.js';
import { handleOutputStream, isOutputStreamRequest } from './output-stream.js';
import { createOutputCollector, type OutputCollector } from '../core/output-collector.js';
import { reconcileStatusResponse } from './status-reconcile.js';
import { ApprovalStore, type ApprovalStoreEntry, type ApprovalStoreCategory } from '../core/approval-store.js';
import { ApprovalBroker } from '../core/approval-broker.js';
import { approvalLookupIdSchema } from '../core/approval-contract.js';
import { ApprovalExpiryDriver } from '../core/approval-expiry-driver.js';
import { resolveApprovalLifecyclePolicy } from '../core/approval-lifecycle-policy.js';
import type { ApprovalLifecycleConfig, ResolvedApprovalLifecycleConfig } from '../core/config-types.js';
import { approvalSlaEventId, ApprovalSlaJournal } from '../core/approval-sla.js';
import { writeApprovalLifecycleAuditEvent } from '../core/audit-writer.js';
import {
  ACCEPTANCE_CONFIRMATION_MAX_CANDIDATES,
  sweepExpiredConfirmations,
} from '../core/confirmation-store.js';
import { ApprovalRelay } from '../core/approval-relay.js';
import { ApprovalNotifyDedup } from '../core/approval-notify-dedup.js';
import {
  attachConfiguredApprovalChannels,
  type ApprovalClientsWireConfig,
  type ApprovalClientsWireTransports,
} from '../connectors/approval-clients-wire.js';
import { loadGatewayAccess } from '../connectors/gateway/gateway-access.js';
import { gatewayHome } from '../connectors/gateway/gateway-paths.js';
import { makeApprovalGate } from '../orchestra/autonomous/approval-adapter.js';
import { settleFederatedTimeoutReceipt } from '../orchestra/approval-decision-federation.js';
import {
  runAcceptanceConfirmationReconciliation,
  type AcceptanceConfirmationProductionReconciler,
  type AcceptanceConfirmationReconcilerDeps,
  type AcceptanceReconciliationRunResult,
} from '../orchestra/acceptance-confirmation-reconciler.js';
import type {
  ApprovalAuthorityRuntimeService,
} from '../core/approval-authority-runtime.js';
import type {
  ApprovalOidcAssertionVerifier,
  ApprovalOidcPolicy,
} from '../core/approval-oidc-authenticator.js';
import { rpcRequestSchema, dispatchRpcRequest, type RpcHandler, type RpcHandlerMap } from '../core/term-rpc.js';
import { probeSubscriptionLimits, type SpawnImpl } from '../core/limit-preflight.js';
import { getMessage, getLanguage } from '../cli/helpers/messages.js';
import type { ProviderAuthorityRuntimeServiceOpenResult } from '../core/provider-authority-composition.js';
import { preflightApiBrainProviderAuthority } from './provider-authority-ingress.js';

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
};

const DEFAULT_PORT = 3100;
const LOCALHOST_ONLY = '127.0.0.1';
const MAX_BODY_SIZE = 1024 * 1024; // 1MB
const SPRINT_LIVE_STREAM_PING_MS = 30_000;

// APPROVAL-EXPIRY-DRIVER-WIRE (404-004): sweep cadence when neither an
// explicit `opts.approvalExpirySweepMs` nor `approval.expiry_sweep_ms` in
// `.deckent/config.json` is set. Approvals expire/decide on minute-to-hour
// scales, so a 1-minute sweep is responsive without being wasteful (same
// order of magnitude as the terminal idle-reaper's 30s cadence below).
const DEFAULT_APPROVAL_EXPIRY_SWEEP_MS = 60_000;

// TERM-CONFIG-WIRE (357-009): mirrors DEFAULT_TERMINAL_CONFIG /
// DEFAULT_OUTBOUND_DAILY_QUOTA_BYTES in ../core/config.ts byte-for-byte —
// the exact pre-wire hardcoded literals this function used to inline
// directly at the PtySessionManager/OutboundLimiter construction sites.
// Duplicated (not imported) deliberately: several existing test files
// (tests/api/server.test.ts and siblings) replace ../core/config.js with a
// hand-written `vi.mock` that only lists a handful of named exports —
// importing a new one here would break every one of those unrelated suites.
const TERMINAL_DEFAULT_MAX_SESSIONS = 10;
const TERMINAL_DEFAULT_IDLE_TIMEOUT_MS = 1_800_000;
const TERMINAL_DEFAULT_SCROLLBACK_BYTES = 262_144;
const TERMINAL_DEFAULT_ALLOW_SHELL_KIND = true;
const TERMINAL_DEFAULT_OUTBOUND_QUOTA_BYTES = 1_073_741_824; // 1 GiB

// AI-SESSION-TOOL-ALLOWLIST (born-565): `kind==='ai'` spawns the
// client-supplied `tool` string directly as the executable file
// (terminal/session-manager.ts KIND_CMD.ai: `file: i.tool ?? 'claude'`). The
// `AiTool` union in terminal/types.ts is compile-time only and erases at
// runtime — `input.tool as CreateSessionInput['tool']` was a type assertion,
// not a check, so an unvalidated client string reached `spawn()` unchecked.
// Runtime-mirrors the `AiTool` union so an unlisted value is rejected before
// `terminalMgr.create()` is ever called (same shape as the shell-kind gate).
const AI_SESSION_TOOL_ALLOWLIST = new Set<string>(['claude', 'gemini', 'codex'] satisfies AiTool[]);

// ─── Rate Limiter ────────────────────────────────────────────────

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

export class SlidingWindowRateLimiter {
  private readonly windowMs: number;
  private readonly maxRequests: number;
  private readonly store = new Map<string, RateLimitEntry>();

  /**
   * When true (default), loopback callers bypass the limiter entirely —
   * it exists to throttle remote abuse, and the owner's own dashboard on
   * localhost legitimately exceeds 100 req/min (per-page fetch fan-out +
   * SSE reconnects; a 429'd SSE retry-loop never lets the window drain).
   * Tests that exercise the 429 wire-up set this to false.
   */
  readonly exemptLoopback: boolean;

  constructor(maxRequests = 100, windowMs = 60_000, opts?: { exemptLoopback?: boolean }) {
    this.maxRequests = maxRequests;
    this.windowMs = windowMs;
    this.exemptLoopback = opts?.exemptLoopback ?? true;
  }

  check(ip: string): boolean {
    const now = Date.now();
    const entry = this.store.get(ip);
    if (!entry || now >= entry.resetAt) {
      this.store.set(ip, { count: 1, resetAt: now + this.windowMs });
      return true;
    }
    entry.count++;
    return entry.count <= this.maxRequests;
  }

  /** Exported for testing — resets all entries */
  reset(): void {
    this.store.clear();
  }

  /**
   * Live state snapshot for /api/enterprise/rate (Sprint 269 B-Enterprise) —
   * one row per tracked IP whose window is still open. Expired windows are
   * skipped (they no longer constrain anything).
   */
  snapshot(): Array<{ key: string; count: number; resetAt: number; limit: number }> {
    const now = Date.now();
    const rows: Array<{ key: string; count: number; resetAt: number; limit: number }> = [];
    for (const [key, entry] of this.store) {
      if (now >= entry.resetAt) continue;
      rows.push({ key, count: entry.count, resetAt: entry.resetAt, limit: this.maxRequests });
    }
    return rows;
  }
}

// ─── Auth ───────────────────────────────────────────────────────

/** Generate a cryptographically random API token */
export function generateApiToken(): string {
  return randomBytes(32).toString('hex');
}

// ─── Security Headers ───────────────────────────────────────────

const SECURITY_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'X-XSS-Protection': '0',
};

// ─── Zod Schemas for POST validation ────────────────────────────
const StartSchema = z.object({ autoApprove: z.boolean().optional() });
const SprintTaskDetailQuerySchema = z.object({
  tailLines: z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().min(1).max(200)).optional(),
});
const PlanSchema = z.object({
  directive: z.string().optional(),
  mode: z.enum(['ai', 'structured', 'auto']).optional(),
});
const SetDirectivesSchema = z.object({ content: z.string().min(1) });
const ChatSchema = z.object({ message: z.string() });
const ConfigSchema = z.record(z.string(), z.unknown());
const WORKER_ID_RE = /^[a-zA-Z0-9-]+$/;
const ApprovalDecisionBodySchema = z.object({
  decision: z.enum(['allow', 'deny', 'defer', 'escalate']),
  reason: z.string().max(2000).optional(),
}).strict();
/** Canonical core lookup contract: accepts new lowercase ids plus path-safe
 * persisted v1 ids, while rejecting traversal/device-name hazards. */
function parseApprovalLookupId(segment: string): string | undefined {
  try {
    const id = decodeURIComponent(segment);
    return approvalLookupIdSchema.safeParse(id).success ? id : undefined;
  } catch {
    return undefined;
  }
}

// ─── Chat-Stream Adapter Hook (Sprint 219 T-219-007) ────────────
// Tests inject a deterministic ChatProviderAdapter via setChatStreamAdapter;
// production wiring of a real subscription adapter is deferred to a follow-up
// task. With no adapter configured the /api/chat/stream endpoint emits a
// single `error` event so the surface never 500s.
let chatStreamAdapter: ChatProviderAdapter | null = null;

/** Test/wiring hook — install (or clear) the ChatProviderAdapter used by
 *  the `/api/chat/stream` SSE endpoint. Pass null to reset. */
export function setChatStreamAdapter(adapter: ChatProviderAdapter | null): void {
  chatStreamAdapter = adapter;
}

// ─── RPC limits.get spawn seam (362-008) ────────────────────────────────
// `limits.get`'s handler calls probeSubscriptionLimits(), which shells out to
// the real `claude` binary by default. Same test-seam shape as
// setChatStreamAdapter above — tests inject a fake spawn so `/api/rpc`
// round-trip coverage never depends on a real `claude` binary being on PATH.
let rpcLimitProbeSpawnImpl: SpawnImpl | undefined;

/** Test/wiring hook — install (or clear) the spawn implementation used by
 *  the `limits.get` RPC handler's probeSubscriptionLimits() call. Pass
 *  undefined to reset to the real `claude` binary spawn. */
export function setRpcLimitProbeSpawnImpl(impl: SpawnImpl | undefined): void {
  rpcLimitProbeSpawnImpl = impl;
}

// ─── Active Job Tracking ─────────────────────────────────────────
interface ActiveJob {
  id: string;
  status: 'running' | 'completed' | 'failed';
  result?: unknown;
  error?: string;
}

const activeJobs = new Map<string, ActiveJob>();

/** Exported for testing — resets all job state */
export function _resetActiveJob(): void {
  activeJobs.clear();
}

// ─── Helpers ─────────────────────────────────────────────────────

// KABUL Gün-1 pürüz-2 (2026-07-18): ACAO used to be HARDCODED to
// `http://localhost:${DEFAULT_PORT}` here — origin-INSENSITIVE, so the
// Desktop dev-renderer (localhost:5173) was CORS-blocked on every JSON read,
// and closure-served routes (run-flow, terminal) carried no ACAO at all.
// The header now comes from ONE per-request loopback-reflecting setHeader at
// the top of the server listener (see `applyLoopbackCors`); writeHead merges
// setHeader'd values, so every response path inherits it.
function sendJson(res: ServerResponse, data: unknown, status = 200): void {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    ...SECURITY_HEADERS,
  });
  res.end(body);
}

/**
 * Reflect a LOOPBACK browser origin (any port — the Desktop dev-renderer on
 * localhost:5173, the served dashboard on its own port) plus the packaged
 * Electron renderer's `Origin: null` (a `file://` document is an opaque
 * origin). Every /api surface already requires its own bearer/query token —
 * CORS origin-pinning to one fixed port protected nothing and broke the
 * renderer-owned-transport decision (D4-3). Non-loopback origins get NO
 * header, exactly as before. Exported for the api-family pin.
 */
export function resolveCorsOrigin(originHeader: string | undefined): string | null {
  const origin = originHeader ?? '';
  if (origin === 'null') return 'null';
  if (/^http:\/\/(?:localhost|127\.0\.0\.1|\[::1\]):\d+$/.test(origin)) return origin;
  return null;
}

function applyLoopbackCors(req: IncomingMessage, res: ServerResponse): void {
  const reflected = resolveCorsOrigin(
    Array.isArray(req.headers['origin']) ? req.headers['origin'][0] : req.headers['origin'],
  );
  if (reflected !== null) {
    res.setHeader('Access-Control-Allow-Origin', reflected);
    res.setHeader('Vary', 'Origin');
  }
}

function sendError(res: ServerResponse, status: number, message: string): void {
  sendJson(res, { error: message }, status);
}

/**
 * DASH-OPS-1 (§15 ARC-C): honest "dashboard not built" page.
 *
 * Served (200, not a bare 404) for any non-API route when a `staticDir` is
 * configured but the dashboard bundle's `index.html` is genuinely missing —
 * a fresh clone, or a TS-only `npm run build` run before `build:dashboard`.
 * It tells the owner the bundle is absent and how to build it; the JSON API at
 * `/api/*` stays available regardless. Static, self-contained, English (this is
 * a developer/ops build-instruction surface — server.ts carries no i18n layer).
 */
export function renderDashboardNotBuiltPage(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Deckent — dashboard not built</title>
<style>
  body { font: 15px/1.6 system-ui, sans-serif; max-width: 40rem; margin: 4rem auto; padding: 0 1.5rem; color: #1f2933; }
  h1 { font-size: 1.4rem; }
  code, pre { background: #f0f4f8; border-radius: 6px; }
  code { padding: 0.1rem 0.35rem; }
  pre { padding: 0.8rem 1rem; overflow-x: auto; }
  .muted { color: #5b6b7a; }
</style>
</head>
<body>
<h1>Dashboard not built</h1>
<p>The Deckent web dashboard bundle was not found at <code>dist/dashboard</code>.</p>
<p>Build it, then reload this page:</p>
<pre>npm run build:dashboard   # or: npm run build:all</pre>
<p class="muted">The JSON API is already running — every endpoint under <code>/api/</code> is available now (e.g. <code>/api/status</code>).</p>
</body>
</html>`;
}

export function parseBody(req: IncomingMessage, maxSize = MAX_BODY_SIZE): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let totalSize = 0;
    let rejected = false;
    req.on('data', (chunk: Buffer) => {
      if (rejected) return;
      totalSize += chunk.length;
      if (totalSize > maxSize) {
        rejected = true;
        reject(new Error('Payload too large'));
        req.resume(); // drain remaining data
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (rejected) return;
      const raw = Buffer.concat(chunks).toString('utf-8');
      if (!raw) { resolve({}); return; }
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

function readDashboardJson(dashPath: string): unknown | null {
  return readJsonSafe<unknown>(dashPath);
}

/** One-line current status for the /api/chat handler. */
function chatStatusLine(projectRoot: string, dashPath: string): string {
  const data = readDashboardJson(dashPath) as {
    sprint?: { id?: string; phase?: string; status?: string };
    progress?: { done?: number; active?: number; blocked?: number; total?: number };
  } | null;
  if (data?.sprint) {
    const s = data.sprint;
    const p = data.progress ?? {};
    return `${s.id ?? 'sprint'} — ${s.phase ?? s.status ?? 'running'} — ` +
      `${p.done ?? 0}/${p.total ?? 0} done, ${p.active ?? 0} active, ${p.blocked ?? 0} blocked`;
  }
  const last = getLatestSprintLog(projectRoot);
  return last ? `idle — last sprint ${last.id}` : 'idle — no sprint yet';
}

function getLatestSprintLog(projectRoot: string): { id: string; metrics: Record<string, string>; tasks: string[] } | null {
  const sprintsDir = join(projectRoot, BRAIN_DIR, SPRINTS_DIR);
  if (!existsSync(sprintsDir)) return null;

  const files = readdirSync(sprintsDir)
    .filter((f) => f.startsWith('sprint-') && f.endsWith('.md'))
    .sort();

  if (files.length === 0) return null;

  const latest = files.at(-1);
  if (!latest) return null;
  const content = readFileSync(join(sprintsDir, latest), 'utf-8');
  const record = parseSprintLog(content);

  const tasks: string[] = [];
  const taskSection = content.match(/## Tasks\n([\s\S]*?)(?=\n##|$)/);
  if (taskSection?.[1]) {
    for (const line of taskSection[1].split('\n')) {
      const trimmed = line.trim();
      if (trimmed.startsWith('- ')) tasks.push(trimmed.slice(2));
    }
  }

  return {
    id: record.sprint,
    metrics: {
      tasks: record.tasks,
      completed: record.completed,
      noGoRate: record.noGoRate,
      coverage: record.coverage,
      duration: record.duration,
    },
    tasks,
  };
}

function getAllSprintLogs(projectRoot: string): unknown[] {
  const sprintsDir = join(projectRoot, BRAIN_DIR, SPRINTS_DIR);
  if (!existsSync(sprintsDir)) return [];

  const files = readdirSync(sprintsDir)
    .filter((f) => f.startsWith('sprint-') && f.endsWith('.md'))
    .sort();

  return files.map((f) => {
    const content = readFileSync(join(sprintsDir, f), 'utf-8');
    const record = parseSprintLog(content);
    return { id: record.sprint, ...record };
  });
}

function readJsonFile(filePath: string): unknown | null {
  return readJsonSafe<unknown>(filePath);
}

function readTextFile(filePath: string): string | null {
  if (!existsSync(filePath)) return null;
  try {
    return readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }
}

function countTaskBlocks(content: string): number {
  const matches = content.match(/^## Task\b/gm);
  return matches ? matches.length : 0;
}

function computeRoutingDistribution(
  performanceMap: Record<string, { totalTasks?: number }>,
): { entries: Array<{ id: string; tasks: number; pct: number }>; total: number } {
  const entries = Object.entries(performanceMap);
  if (entries.length === 0) return { entries: [], total: 0 };
  const total = entries.reduce((s, [, p]) => s + (p.totalTasks ?? 0), 0);
  if (total === 0) return { entries: entries.map(([id]) => ({ id, tasks: 0, pct: 0 })), total: 0 };
  const result = entries
    .map(([id, p]) => ({
      id,
      tasks: p.totalTasks ?? 0,
      pct: Math.round(((p.totalTasks ?? 0) / total) * 1000) / 10,
    }))
    .sort((a, b) => b.tasks - a.tasks);
  return { entries: result, total };
}

function detectRoutingImbalance(
  entries: Array<{ id: string; pct: number }>,
  threshold = 80,
): string[] {
  return entries
    .filter((e) => e.pct > threshold)
    .map((e) => `IMBALANCE: "${e.id}" dominates with ${e.pct}% (threshold: ${threshold}%)`);
}

// ─── Approvals (356-002, ADR-G-033/ADR-G-020) ─────────────────────
// GET routes read `ApprovalStore` (read-only snapshot) and are ALWAYS
// available — dashboard monitoring is not flag-gated. The mutation path
// (POST .../decision) goes ONLY through `ApprovalBroker.decide()`, never
// `ApprovalStore.transition()`, so the broker's own validation/event
// semantics stay the single source of truth for a decision.

/**
 * `approval.api_decide` activation flag for POST /api/approvals/:id/decision.
 * Not yet part of the typed `ApprovalConfig` surface (config-types.ts is out
 * of this task's write scope) — read directly off the raw config.json, the
 * same pattern `getNextSprintId` uses for `last_sprint_id` (core/utils.ts).
 * Default-off: an absent block/key or a non-boolean value is disabled.
 */
function isApprovalApiDecideEnabled(projectRoot: string): boolean {
  const raw = readJsonSafe<Record<string, unknown>>(join(projectRoot, PROJECT_CONFIG_PATH));
  const approvalBlock = raw?.['approval'];
  if (!approvalBlock || typeof approvalBlock !== 'object') return false;
  return (approvalBlock as Record<string, unknown>)['api_decide'] === true;
}

// ─── SURF-7 — orchestration-control mutation ratchet (ADR-G-033 cutover) ─────
//
// The dashboard is observability-only ("the dashboard explains"): the HTTP
// mutation endpoints that used to power its control buttons sit behind ONE
// default-off capability flag, `api.control_mutations` — the exact
// `approval.api_decide` pattern. Flag off (default) ⇒ honest 403 naming the
// equivalent surfaces (terminal CLI / Desktop) and the emergency re-enable
// key (the SURF-7 rollback clause). Monitoring GETs are NEVER gated;
// enterprise management-plane writes keep their own admin gate (their client
// moves to the Desktop app — ADR-G-033 amendment); /api/run-flow/* has its
// own SURF-2 contract and is not governed here; /api/rpc (VS Code extension)
// is untouched.

/** `api.control_mutations` activation flag — raw-config read, default-off
 *  (absent block/key or non-boolean ⇒ disabled), mirroring
 *  {@link isApprovalApiDecideEnabled}. `DECKENT_CONTROL_MUTATIONS=1` is the
 *  env twin (same precedent as `DECKENT_API_AUTH_DISABLED`): the test-suite
 *  runs endpoint-behavior specs with the gate open, and an operator can flip
 *  it without editing config in an emergency. */
function isControlMutationApiEnabled(projectRoot: string): boolean {
  if (process.env['DECKENT_CONTROL_MUTATIONS'] === '1') return true;
  const raw = readJsonSafe<Record<string, unknown>>(join(projectRoot, PROJECT_CONFIG_PATH));
  const apiBlock = raw?.['api'];
  if (!apiBlock || typeof apiBlock !== 'object') return false;
  return (apiBlock as Record<string, unknown>)['control_mutations'] === true;
}

/** The (method,url) pairs the SURF-7 ratchet governs — the dashboard's former
 *  control surface. `/api/chat/stream` is a GET that MUTATES (it drives the
 *  agent), so it is governed despite its method. */
export function isGatedControlMutation(method: string, url: string): boolean {
  if (method === 'GET') return url === '/api/chat/stream' || url.startsWith('/api/chat/stream?');
  if (method !== 'POST') return false;
  if (
    url === '/api/start' || url === '/api/plan' || url === '/api/cleanup'
    || url === '/api/set-directives' || url === '/api/directives'
    || url === '/api/config' || url === '/api/chat'
    // KABUL Gün-1 A1 «Changes»: an HTTP git-commit is a control mutation
    // (the human seal must come from an operator surface — Desktop carries
    // the env twin for its own spawned daemons; adopted daemons keep their
    // flag). The /api/git/* GETs (status/diff/proposal) are monitoring
    // reads and stay ungated per the SURF-7 rule.
    || url === '/api/git/commit'
  ) return true;
  if (url === '/api/kill/all' || url.startsWith('/api/kill/')) return true;
  if (
    url.startsWith('/api/nervous/accept/') || url.startsWith('/api/nervous/reject/')
    || url.startsWith('/api/nervous/recommendations/dismiss/')
  ) return true;
  if (url.startsWith('/api/autonomous/approve/') || url.startsWith('/api/autonomous/reject/')) return true;
  return false;
}

/** The honest refusal every gated endpoint answers while the flag is off. */
export const CONTROL_MUTATION_DISABLED_MESSAGE =
  'Orchestration-control mutations over HTTP are disabled (ADR-G-033: the dashboard observes; '
  + 'control lives in the terminal and the Desktop app — e.g. `deckent do` / `deckent runs <n> --approve` / '
  + '`deckent kill` / `deckent cleanup` / `deckent config`). '
  + 'Emergency re-enable: set api.control_mutations: true in .deckent/config.json.';

/** Serialize a store entry for the API — strips `rawArgsRef` (an internal
 *  pointer into the out-of-band raw-args store) so the response carries
 *  `maskedArgs` only. The raw value itself is never a field on the contract
 *  type and this endpoint never calls `resolveRawArgs`. */
function serializeApprovalEntry(category: ApprovalStoreCategory, entry: ApprovalStoreEntry): Record<string, unknown> {
  const { rawArgsRef: _rawArgsRef, ...safeRequest } = entry.request;
  return {
    category,
    request: safeRequest,
    decision: entry.decision,
    ...(entry.lifecycle ? { lifecycle: entry.lifecycle } : {}),
  };
}

/** Find `id` across the store snapshot's 4 categories. */
function findApprovalEntry(
  store: ApprovalStore,
  id: string,
): { category: ApprovalStoreCategory; entry: ApprovalStoreEntry } | undefined {
  const snapshot = store.index();
  for (const category of ['pending', 'approved', 'denied', 'expired'] as const) {
    const entry = snapshot[category].find((e) => e.request.id === id);
    if (entry) return { category, entry };
  }
  return undefined;
}

// ─── TERM-RPC HTTP wire (362-008, RPC-API-WIRE slice-2a) ─────────────────
// POST /api/rpc — the first HTTP consumer of TERM-RPC's dispatcher
// (core/term-rpc.ts, task 361-011). Behind the SAME bearer-auth gate as every
// other /api/* route (no exemption added — see the generic auth check ahead
// of GET/POST dispatch). Only 4 read methods get a real handler this slice:
//   session.list / run.status -> PtySessionManager (api/terminal/session-
//     manager.ts). The task names "session-registry"/"run-state-feed" as
//     adapter sources, but both concrete modules with those names live under
//     src/cli/helpers/ — importing either here would violate ADR-D-004 C3
//     (api/ MUST NOT import cli/). PtySessionManager is the same-layer,
//     already-wired existing surface whose SessionMeta shape (id, kind,
//     tenantId, createdAt, status: running|exited, exitCode?) covers both
//     methods' fields; see docImpact in the task .result notes.
//   approval.list -> ApprovalStore (core/approval-store.ts, already used by
//     GET /api/approvals above).
//   limits.get -> probeSubscriptionLimits (core/limit-preflight.ts).
// session.resume / run.start-detached / approval.decide are deliberately left
// OUT of the handler map — dispatchRpcRequest's own METHOD_NOT_IMPLEMENTED
// path is already the honest "unsupported" answer (write methods wire in the
// dilim-2b follow-up task).

/** SessionMeta -> TERM-RPC SessionSummary. PtySessionManager only tracks
 *  running/exited, narrowed onto the contract's 4-state enum (idle/detached
 *  are never produced by this adapter). SessionMeta has no separate
 *  last-activity timestamp, so `lastActivityAt` honestly mirrors `createdAt`
 *  rather than fabricating a distinct value. */
function sessionMetaToRpcSummary(meta: SessionMeta): {
  sessionId: string;
  label: string;
  status: 'active' | 'idle' | 'detached' | 'closed';
  createdAt: string;
  lastActivityAt: string;
} {
  return {
    sessionId: meta.id,
    label: `${meta.kind}:${meta.tenantId}`,
    status: meta.status === 'running' ? 'active' : 'closed',
    createdAt: meta.createdAt,
    lastActivityAt: meta.createdAt,
  };
}

function buildRpcSessionListHandler(terminalManager: PtySessionManager | undefined): RpcHandler<'session.list'> {
  return () => ({
    sessions: terminalManager ? terminalManager.list().map(sessionMetaToRpcSummary) : [],
  });
}

function buildRpcRunStatusHandler(terminalManager: PtySessionManager | undefined): RpcHandler<'run.status'> {
  return (params) => {
    const meta = terminalManager?.get(params.runId);
    if (!meta) {
      // No on-disk/in-memory evidence of this runId — honestly report
      // "pending" rather than fabricating a completed/failed verdict.
      return { runId: params.runId, state: 'pending', startedAt: null, finishedAt: null, exitCode: null };
    }
    const state: 'running' | 'completed' | 'failed' =
      meta.status === 'running' ? 'running' : meta.exitCode === 0 ? 'completed' : 'failed';
    return {
      runId: meta.id,
      state,
      startedAt: meta.createdAt,
      // SessionMeta tracks no separate finish timestamp.
      finishedAt: null,
      exitCode: meta.exitCode ?? null,
    };
  };
}

function buildRpcApprovalListHandler(projectRoot: string): RpcHandler<'approval.list'> {
  return (params) => {
    const store = new ApprovalStore(projectRoot);
    const snapshot = store.load();
    const categories = ['pending', 'approved', 'denied', 'expired'] as const;
    const approvals = categories.flatMap((category) =>
      snapshot[category]
        .filter((e) => !params.scopeId || e.request.scopeId === params.scopeId)
        .map((e) => serializeApprovalEntry(category, e)),
    );
    return { approvals };
  };
}

function buildRpcLimitsGetHandler(): RpcHandler<'limits.get'> {
  return async () => {
    const probe = await probeSubscriptionLimits(
      rpcLimitProbeSpawnImpl ? { spawnImpl: rpcLimitProbeSpawnImpl } : {},
    );
    if (probe.unavailable) {
      return { limits: { unavailable: true, reason: probe.reason } };
    }
    return {
      limits: {
        unavailable: false,
        sessionPct: probe.sessionPct,
        sessionResetAt: probe.sessionResetAt,
        weekAllPct: probe.weekAllPct,
        weekAllResetAt: probe.weekAllResetAt,
        ...(probe.weekFablePct !== undefined ? { weekFablePct: probe.weekFablePct } : {}),
      },
    };
  };
}

function buildRpcHandlerMap(projectRoot: string, terminalManager: PtySessionManager | undefined): RpcHandlerMap {
  return {
    'session.list': buildRpcSessionListHandler(terminalManager),
    'run.status': buildRpcRunStatusHandler(terminalManager),
    'approval.list': buildRpcApprovalListHandler(projectRoot),
    'limits.get': buildRpcLimitsGetHandler(),
  };
}

// ─── Route Handler ───────────────────────────────────────────────

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  projectRoot: string,
  dashPath: string,
  sseClients: Set<ServerResponse>,
  staticDir?: string,
  initWatcher?: () => void,
  _apiToken?: string | null,
  rateLimiter?: SlidingWindowRateLimiter,
  authMiddleware?: (req: IncomingMessage, res: ServerResponse) => boolean,
  outputCollector?: OutputCollector,
  serveIndexHtml?: (req: IncomingMessage, res: ServerResponse) => boolean,
  chatAdapter?: ChatProviderAdapter | null,
  terminalManager?: PtySessionManager,
  approvalAuthority?: {
    readonly runtime: ApprovalAuthorityRuntimeService;
    readonly policy: ApprovalOidcPolicy;
    readonly verifier: ApprovalOidcAssertionVerifier;
  },
  approvalLifecycleStore?: ApprovalStore,
  providerAuthority?: ProviderAuthorityRuntimeServiceOpenResult,
  approvalLifecycle?: ResolvedApprovalLifecycleConfig,
  strictTenantIsolation = false,
  approvalLang = 'en',
): Promise<void> {
  // Normalize /api/v1/... → /api/... for backward compat
  const rawUrl = req.url ?? '/';
  const url = rawUrl.startsWith('/api/v1/') ? '/api/' + rawUrl.slice('/api/v1/'.length) : rawUrl;
  const method = req.method ?? 'GET';

  // Rate limiting. Loopback callers are exempt by default (Sprint 269 live
  // finding — see SlidingWindowRateLimiter.exemptLoopback); remote binds keep the limit.
  if (rateLimiter && url.startsWith('/api/') && !(rateLimiter.exemptLoopback && isLocalhostRequest(req))) {
    const ip = req.socket.remoteAddress ?? '127.0.0.1';
    if (!rateLimiter.check(ip)) {
      sendError(res, 429, 'Too Many Requests');
      return;
    }
  }

  const origin = req.headers['origin'] ?? '';
  // Strict CORS, ONE authority (pürüz-2): loopback origins any-port + the
  // packaged renderer's `Origin: null` reflect; anything else never does.
  const reflectedOrigin = resolveCorsOrigin(Array.isArray(origin) ? origin[0] : origin);
  const isAllowedOrigin = reflectedOrigin !== null;
  const allowedOrigin = reflectedOrigin ?? `http://localhost:${DEFAULT_PORT}`;

  // CORS preflight
  if (method === 'OPTIONS') {
    if (!isAllowedOrigin && origin !== '') {
      // Reject CORS preflight from disallowed origins
      res.writeHead(403, { 'Content-Type': 'application/json', ...SECURITY_HEADERS });
      res.end(JSON.stringify({ error: 'CORS origin not allowed' }));
      return;
    }
    res.writeHead(200, {
      'Access-Control-Allow-Origin': allowedOrigin,
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      ...SECURITY_HEADERS,
    });
    res.end();
    return;
  }

  // Auth check for all API routes (health endpoint exempt, handled by bearerAuthMiddleware)
  if (url.startsWith('/api/') && authMiddleware) {
    if (!authMiddleware(req, res)) return;
  }

  // SURF-7 authority-cutover: orchestration-control mutations are terminal/
  // Desktop territory — over HTTP they answer an honest 403 unless the
  // emergency flag re-enables them (see isGatedControlMutation).
  if (isGatedControlMutation(method, url) && !isControlMutationApiEnabled(projectRoot)) {
    sendError(res, 403, CONTROL_MUTATION_DISABLED_MESSAGE);
    return;
  }

  // ─── Health endpoint (always accessible, no auth) ──────────
  // DESK-1 (born-496): loopback callers additionally get identity fields so a
  // desktop shell can confirm adopt-vs-spawn (pid + projectRoot match) and
  // capability (terminalEnabled). Non-loopback callers (--host beyond
  // 127.0.0.1) keep the exact minimal body — absolute projectRoot + PID must
  // not leak to remote callers (no new fingerprinting surface).
  if (method === 'GET' && (url === '/health' || url === '/api/health')) {
    const body: Record<string, unknown> = { status: 'ok', timestamp: new Date().toISOString() };
    if (isLocalhostRequest(req)) {
      body.version = DECKENT_VERSION;
      body.pid = process.pid;
      body.projectRoot = projectRoot;
      body.terminalEnabled = terminalManager !== undefined;
    }
    sendJson(res, body);
    return;
  }

  // ─── Enterprise mutations (282-010, DASH-UX-6) ──────────────
  // POST/PUT/DELETE /api/enterprise/{tenants,rbac,rate}[/:id] — admin-RBAC, audit-logged.
  // Dispatched here (ahead of the GET/POST blocks) so all three verbs reach the
  // single handler in enterprise-endpoint.ts. Already auth-gated above.
  if (
    (method === 'POST' || method === 'PUT' || method === 'DELETE') &&
    (
      url.split('?')[0]!.startsWith('/api/enterprise/tenants') ||
      url.split('?')[0]!.startsWith('/api/enterprise/rbac') ||
      url.split('?')[0]!.startsWith('/api/enterprise/rate')
    )
  ) {
    let entBody: unknown = {};
    if (method !== 'DELETE') {
      try {
        entBody = await parseBody(req);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Invalid JSON body';
        sendError(res, msg === 'Payload too large' ? 413 : 400, msg === 'Payload too large' ? 'Payload too large' : 'Invalid JSON body');
        return;
      }
    }
    if (await handleEnterpriseTenantWrite(url, method, res, projectRoot, entBody, req)) return;
    if (await handleEnterpriseRbacWrite(url, method, res, projectRoot, entBody, req)) return;
    if (await handleEnterpriseRateWrite(url, method, res, projectRoot, entBody, req)) return;
  }

  // ─── GET routes ────────────────────────────────────────────
  if (method === 'GET') {
    if (url === '/api/status') {
      const rawData = readDashboardJson(dashPath);
      const data = reconcileStatusResponse(projectRoot, rawData);
      // If reconcile returns an idle response (no dashboard or completed sprint)
      // and there was no original data, augment with lastSprint for UI context.
      const reconciled = data as Record<string, unknown>;
      if (reconciled['idle'] || !rawData) {
        const lastSprint = getLatestSprintLog(projectRoot);
        sendJson(res, {
          ...reconciled,
          sprint: {
            id: lastSprint?.id ?? (reconciled['sprint'] as Record<string, unknown> | undefined)?.['id'] ?? null,
            phase: 'IDLE',
            status: 'IDLE',
          },
          idle: true,
          lastSprint: lastSprint ? {
            id: lastSprint.id,
            metrics: lastSprint.metrics,
            tasks: lastSprint.tasks,
          } : null,
        });
        return;
      }
      sendJson(res, data);
      return;
    }

    if (url === '/api/sprint') {
      const sprint = getLatestSprintLog(projectRoot);
      if (!sprint) { sendError(res, 404, 'No sprint logs found'); return; }
      sendJson(res, sprint);
      return;
    }

    if (url === '/api/history') {
      sendJson(res, getAllSprintLogs(projectRoot));
      return;
    }

    if (url === '/api/config') {
      const configPath = join(projectRoot, PROJECT_CONFIG_PATH);
      const data = readJsonFile(configPath);
      if (!data) { sendError(res, 404, 'Config not found'); return; }
      sendJson(res, data);
      return;
    }

    if (url === '/api/config/defaults') {
      const defaults = createDefaultConfig();
      sendJson(res, defaults);
      return;
    }

    if (url === '/api/doctor') {
      const result = runDoctorChecks(projectRoot);
      sendJson(res, result);
      return;
    }

    if (url === '/api/debt') {
      // Task #4d: DEBT.md is DB-first; serve the generated exports/debt.md view.
      const content = readTextFile(join(projectRoot, BRAIN_DIR, 'exports', 'debt.md'));
      if (content === null) { sendError(res, 404, 'Debt file not found'); return; }
      sendJson(res, { content });
      return;
    }

    // GET /api/tasks — list all task JSON files from .tasks/
    if (url === '/api/tasks') {
      const tasksDir = join(projectRoot, TASKS_DIR);
      if (!existsSync(tasksDir)) { sendJson(res, []); return; }
      const files = readdirSync(tasksDir).filter(f => f.endsWith('.json') && f.startsWith('task-'));
      const tasks = files.map(f => readJsonSafe(join(tasksDir, f))).filter(Boolean);
      sendJson(res, tasks);
      return;
    }

    // GET /api/workers — list active workers from .tasks/*.hb heartbeat files
    if (url === '/api/workers') {
      const tasksDir = join(projectRoot, TASKS_DIR);
      if (!existsSync(tasksDir)) { sendJson(res, []); return; }
      const hbFiles = readdirSync(tasksDir).filter(f => f.startsWith('task-') && f.endsWith('.hb'));
      const workers = hbFiles.map((f) => {
        const hb = readJsonSafe<Record<string, unknown>>(join(tasksDir, f));
        if (!hb) return null;
        const taskId = String(hb['taskId'] ?? '');
        const taskFile = join(tasksDir, `task-${taskId}.json`);
        const task = readJsonSafe<Record<string, unknown>>(taskFile);
        return {
          workerId: hb['workerId'] ?? null,
          taskId,
          status: hb['status'] ?? 'UNKNOWN',
          sequence: hb['sequence'] ?? 0,
          timestamp: hb['timestamp'] ?? null,
          taskTitle: task ? String(task['title'] ?? '') : null,
          taskStatus: task ? String(task['status'] ?? '') : null,
        };
      }).filter(Boolean);
      sendJson(res, workers);
      return;
    }

    // GET /api/agents — the canonical catalog projection (S5, sprint-523 task 9).
    // Same read model as CLI `deckent agent` and MCP `deckent_agent_list`; the
    // pre-S5 payload fields (id/name/source/enabled/totalUses/successRate) are
    // preserved field-for-field for existing consumers, with the read-model
    // truth (validity/routability/provenance/prompt) added alongside.
    if (url === '/api/agents') {
      const agents = buildAgentCatalogEntries(projectRoot).map((entry) => ({
        id: entry.id,
        name: entry.name,
        source: entry.provenance.declared,
        enabled: entry.enabled,
        totalUses: entry.uses,
        successRate: entry.successRate,
        validity: entry.validity,
        routable: entry.routable,
        provenance: entry.provenance,
        prompt: entry.prompt,
        diagnostics: entry.diagnostics,
      }));
      sendJson(res, agents);
      return;
    }

    // GET /api/routing/distribution — agent+skill routing distribution from learnings.json
    if (url === '/api/routing/distribution') {
      const learningsPath = join(projectRoot, '.deckent', 'routing', 'learnings.json');
      const learnings = readJsonSafe<Record<string, unknown>>(learningsPath);
      if (!learnings) {
        sendJson(res, { agents: { entries: [], total: 0 }, skills: { entries: [], total: 0 }, warnings: [], totalOutcomes: 0 });
        return;
      }
      const agentPerf = (learnings['agentPerformance'] ?? {}) as Record<string, { totalTasks?: number }>;
      const skillPerf = (learnings['skillPerformance'] ?? {}) as Record<string, { totalTasks?: number }>;
      const agentDist = computeRoutingDistribution(agentPerf);
      const skillDist = computeRoutingDistribution(skillPerf);
      const warnings = detectRoutingImbalance([...agentDist.entries, ...skillDist.entries]);
      sendJson(res, { agents: agentDist, skills: skillDist, warnings, totalOutcomes: learnings['totalOutcomes'] ?? 0 });
      return;
    }

    // GET /api/job/:jobId
    if (url.startsWith('/api/job/')) {
      const jobId = url.slice('/api/job/'.length);
      const job = activeJobs.get(jobId);
      if (!job) {
        sendError(res, 404, 'Job not found');
        return;
      }
      sendJson(res, job);
      return;
    }

    // GET /api/worker/:taskId/log
    if (url.startsWith('/api/worker/') && url.endsWith('/log')) {
      const taskId = url.slice('/api/worker/'.length, -'/log'.length);
      if (!taskId) {
        sendError(res, 400, 'Missing taskId');
        return;
      }
      const taskPath = join(projectRoot, TASKS_DIR, `task-${taskId}.json`);
      const task = readJsonFile(taskPath);
      if (!task) {
        sendError(res, 404, 'Task not found');
        return;
      }
      const log = readWorkerLog(projectRoot, taskId);
      sendJson(res, { taskId, log, task });
      return;
    }

    // SSE: EventSource can append `?token=...` for auth (Sprint 191), so
    // accept both bare and query-suffixed forms.
    if (url === '/api/events' || url.startsWith('/api/events?')) {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': allowedOrigin,
      });
      res.write('retry: 3000\n\n');
      sseClients.add(res);
      req.on('close', () => { sseClients.delete(res); });
      if (initWatcher) initWatcher();
      return;
    }

    // Worker output SSE (Sprint 230 T-230-008): live log fan-out for the
    // dashboard. Mounted via isOutputStreamRequest so the route matches the
    // exact /api/output-stream path and ignores unrelated GETs. The collector
    // is created eagerly at server setup (Sprint 269 B-OutputStream); a null
    // collector (constructor failure) gets an honest 503 instead of a crash.
    if (isOutputStreamRequest(req)) {
      if (!outputCollector) {
        sendError(res, 503, 'output-stream collector unavailable');
        return;
      }
      handleOutputStream(req, res, outputCollector);
      return;
    }

    // chat-stream SSE (Sprint 219 T-219-007 / F2-007): EventSource only
    // supports GET, so the user message rides on a `?message=…` query string.
    if (url === '/api/chat/stream' || url.startsWith('/api/chat/stream?')) {
      const qIdx = url.indexOf('?');
      const query = qIdx >= 0 ? new URLSearchParams(url.slice(qIdx + 1)) : new URLSearchParams();
      const message = query.get('message') ?? '';

      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': allowedOrigin,
      });
      res.write('retry: 3000\n\n');

      let closed = false;
      req.on('close', () => { closed = true; });

      // Seam-injected adapter (setChatStreamAdapter) wins; otherwise fall back
      // to the config-driven adapter resolved at server setup (Sprint 269
      // B-ChatStream — REPL resolveChatAdapter SSOT). Neither configured →
      // existing honest SSE-error below.
      const adapter = chatStreamAdapter ?? chatAdapter ?? null;
      if (!adapter) {
        res.write(`data: ${JSON.stringify({ type: 'error', message: 'chat-stream: no adapter configured' })}\n\n`);
        res.end();
        return;
      }

      void (async () => {
        try {
          const events = streamChatMessage(message, adapter);
          for await (const line of streamToSseLines(events)) {
            if (closed) break;
            res.write(line);
          }
        } catch (err) {
          if (!closed) {
            const msg = err instanceof Error ? err.message : String(err);
            res.write(`data: ${JSON.stringify({ type: 'error', message: msg })}\n\n`);
          }
        } finally {
          if (!closed) res.end();
        }
      })();
      return;
    }

    // Worker-log SSE (DASH-RT-2, Sprint 284): live tail of `.tasks/task-<id>.log`
    // backend-agnostically. The taskId is validated against `^[A-Za-z0-9_-]+$`
    // BEFORE any fs access — a decoded segment with `.`/`/`/`%` (path traversal)
    // is rejected 403. Query-token auth is granted via the `/api/workers/` prefix
    // in the auth-gate (header-less EventSource transport).
    {
      const rawTaskId = matchWorkerLogStream(url);
      if (rawTaskId !== null) {
        let taskId: string;
        try {
          taskId = decodeURIComponent(rawTaskId);
        } catch {
          taskId = rawTaskId; // malformed %-escape → fails the regex below
        }
        if (!isValidTaskId(taskId)) {
          sendError(res, 403, 'Invalid task id');
          return;
        }
        handleWorkerLogStream(req, res, projectRoot, taskId, allowedOrigin);
        return;
      }
    }

    // Static file serving for dashboard
    if (staticDir && !url.startsWith('/api/')) {
      const urlPath = url.split('?')[0] ?? '/';
      const resolved = resolve(staticDir, urlPath === '/' ? 'index.html' : urlPath.slice(1));
      if (!resolved.startsWith(resolve(staticDir))) {
        sendError(res, 403, 'Forbidden');
        return;
      }

      if (existsSync(resolved)) {
        try {
          const content = readFileSync(resolved);
          const mimeType = MIME_TYPES[extname(resolved)] ?? 'application/octet-stream';
          res.writeHead(200, { 'Content-Type': mimeType });
          res.end(content);
          return;
        } catch {
          // fall through to SPA fallback
        }
      }

      // SPA fallback — every index.html served from here goes through the
      // same loopback-only token-inject helper as the root path (A1, Sprint
      // 269), so deep-link entry/refresh (/enterprise, /status, …) carries
      // __DECKENT_API_TOKEN__ and the dashboard's API calls return 200.
      if (serveIndexHtml?.(req, res)) return;
      const indexPath = join(staticDir, 'index.html');
      if (existsSync(indexPath)) {
        try {
          const content = readFileSync(indexPath);
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(content);
          return;
        } catch {
          // fall through to the honest not-built page
        }
      }

      // DASH-OPS-1: the dashboard bundle is genuinely missing (never built, or a
      // TS-only build before `build:dashboard`). Answer with an honest 200 page
      // that names the build command instead of a bare 404 — the JSON API at
      // /api/* is unaffected.
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(renderDashboardNotBuiltPage());
      return;
    }

    // Evolution endpoints: /api/evolution/genealogy, /retirement, /prompt-metrics
    if (url.startsWith('/api/evolution/')) {
      if (registerEvolutionRoutes(url, res, projectRoot)) return;
    }

    // Memory reader: legacy array search and bounded v1 view/detail routes.
    // `req` is mandatory so tenant scope is derived from the verified caller.
    if (registerMemorySearch(url, res, projectRoot, req)) return;
    if (registerNervousRoutes(url, method, res, projectRoot)) return;
    if (registerAutonomousRoutes(url, method, res, projectRoot, req, {
      ...(approvalLifecycle ? { lifecycle: approvalLifecycle } : {}),
      strictTenantIsolation,
      lang: approvalLang,
      authGateVerified:
        authMiddleware !== undefined && process.env['DECKENT_API_AUTH_DISABLED'] !== '1',
    })) return;
    if (registerMissionsRoute(url, method, res, projectRoot, req)) return;
    // TERM-FLOW-UNIFY Sprint-7 (429-008/429-009, `terminal.run_flow_v2`):
    // flowId-scoped SSE stream BEFORE the REST routes below — both answer
    // false (fall through) for a non-matching path, so order only matters
    // for readability here (the two path shapes are disjoint).
    if (await registerRunFlowEventStreamRoute(url, method, res, projectRoot, req, allowedOrigin)) return;
    if (await registerRunFlowRoutes(
      url,
      method,
      res,
      undefined,
      projectRoot,
      req,
      providerAuthority,
    )) return;
    if (await registerProcessRoutes(url, method, res, undefined, projectRoot, req)) return;
    // Enterprise dashboard data: /api/enterprise/{tenants,rbac,audit,rate} (269-001)
    if (registerEnterpriseRoutes(url, method, res, projectRoot, rateLimiter ? { rateLimiter } : {}, req)) return;
    // Coverage history + brain budget: /api/coverage
    if (registerCoverageRoutes(url, res, projectRoot)) return;
    // KPI trend: /api/kpi/trend?kpiId=&n=&tenantId= (332-009) — registered before the
    // scorecard so the longer path is matched first; req threaded for tenant scope.
    if (registerKpiTrendEndpoint(url, res, projectRoot, req)) return;
    // Sprint KPI scorecard: /api/kpi[?sprint=&tenantId=] (331-009) — req threaded so
    // tenant scope derives from the verified principal (anti-IDOR, A1/A2).
    if (registerKpiEndpoint(url, res, projectRoot, req)) return;
    // Docs health (doc-tracking ADR-090): /api/docs/health
    if (registerDocsHealthRoute(url, res, projectRoot)) return;
    // Auth identity: /api/auth/me (277-001)
    if (registerAuthMeRoute(url, method, res, req)) return;
    // Subscription-limits probe (DASH-LIMITS-CARD, 365-006): /api/limits
    if (await registerLimitsRoute(url, res)) return;
    // Evaluate-health observability (born-484, 370-007): /api/evaluate-health[?n=]
    if (registerEvaluateHealthRoute(url, res, projectRoot)) return;

    // GET /api/directives — DIRECTIVES.md content (symmetric with POST, DASH-FIX-1)
    if (url === '/api/directives') {
      const directivesPath = join(projectRoot, DIRECTIVES_FILE);
      const content = existsSync(directivesPath) ? readFileSync(directivesPath, 'utf-8') : '';
      sendJson(res, { content });
      return;
    }

    // ─── /api/sprint/* — canonical inspector reads ────────────────────────
    // Monitoring reads — never gated (SURF-7 rule). Lifecycle is resolved
    // exclusively by the core read-model's run-status authority.
    if (method === 'GET' && (url === '/api/sprint/live/stream' || url.startsWith('/api/sprint/live/stream?'))) {
      const params = new URL(url, 'http://localhost').searchParams;
      const rawSinceRevision = params.get('sinceRevision');
      if (rawSinceRevision !== null && !/^\d+$/.test(rawSinceRevision)) {
        sendJson(res, {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'sinceRevision must be a non-negative integer',
            details: [{ field: 'sinceRevision', message: 'Must be a non-negative integer', value: rawSinceRevision }],
          },
        }, 400);
        return;
      }

      const sinceRevision = rawSinceRevision === null ? undefined : Number(rawSinceRevision);
      if (sinceRevision !== undefined && !Number.isSafeInteger(sinceRevision)) {
        sendJson(res, {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'sinceRevision must be a non-negative safe integer',
            details: [{ field: 'sinceRevision', message: 'Must be a non-negative safe integer', value: rawSinceRevision }],
          },
        }, 400);
        return;
      }

      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'Access-Control-Allow-Origin': allowedOrigin,
      });
      res.write('retry: 3000\n\n');

      let closed = false;
      let observer: ReturnType<typeof observeRunInspectorSnapshot> | undefined;
      const pingTimer = setInterval(() => {
        if (closed || res.destroyed || res.writableEnded) return;
        res.write('event: ping\ndata: {}\n\n');
      }, SPRINT_LIVE_STREAM_PING_MS);
      pingTimer.unref?.();

      const closeStream = (): void => {
        if (closed) return;
        closed = true;
        clearInterval(pingTimer);
        observer?.close();
      };
      req.on('close', closeStream);
      req.on('error', closeStream);
      res.on('error', closeStream);

      observer = observeRunInspectorSnapshot(projectRoot, {
        ...(sinceRevision !== undefined ? { sinceRevision } : {}),
        onSnapshot: (snapshot) => {
          if (closed || res.destroyed || res.writableEnded) return;
          res.write(`event: snapshot\ndata: ${JSON.stringify({ ...snapshot, active: snapshot.lifecycle.active })}\n\n`);
        },
      });
      if (closed) observer.close();
      return;
    }
    if (method === 'GET' && url === '/api/sprint/live') {
      const snapshot = buildRunInspectorSnapshot(projectRoot);
      // Legacy `active` key preserved for payload compat, but its value comes
      // from the run-status AUTHORITY — never re-inferred from worker files.
      sendJson(res, { ...snapshot, active: snapshot.lifecycle.active });
      return;
    }
    if (method === 'GET' && url === '/api/inspector/runs') {
      sendJson(res, listRunInspectorRuns(projectRoot));
      return;
    }
    if (method === 'GET' && url.startsWith('/api/sprint/task/')) {
      const taskUrl = new URL(url, 'http://localhost');
      const rawId = taskUrl.pathname.slice('/api/sprint/task/'.length);
      let taskId: string;
      try { taskId = decodeURIComponent(rawId); } catch { taskId = rawId; }
      const parsedQuery = SprintTaskDetailQuerySchema.safeParse(
        Object.fromEntries(taskUrl.searchParams.entries()),
      );
      if (!parsedQuery.success) {
        const rawTailLines = taskUrl.searchParams.get('tailLines');
        sendJson(res, {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'tailLines must be an integer between 1 and 200',
            details: [{
              field: 'tailLines',
              message: 'Must be an integer between 1 and 200',
              value: rawTailLines,
            }],
          },
        }, 400);
        return;
      }
      const detail = readRunInspectorTaskDetail(projectRoot, taskId, parsedQuery.data);
      if (detail === null) {
        sendError(res, SPRINT_TASK_ID_RE.test(taskId) ? 404 : 403, 'task not found');
        return;
      }
      sendJson(res, { taskId, ...detail });
      return;
    }

    // ─── /api/git/* — KABUL Gün-1 A1 «Changes» (N4-servisin HTTP-yüzü) ───
    // GETs are monitoring reads (never gated); POST /api/git/commit is a
    // control mutation (isGatedControlMutation) AND stages+commits in one
    // sealed step — the exact runs-- commit semantics, Desktop-bacağı.
    if (method === 'GET' && url === '/api/git/status') {
      sendJson(res, await gitWorkflowStatus(projectRoot));
      return;
    }
    if (method === 'GET' && (url === '/api/git/diff' || url.startsWith('/api/git/diff?'))) {
      const staged = url.includes('staged=1') || url.includes('staged=true');
      sendJson(res, await gitWorkflowDiff(projectRoot, { staged }));
      return;
    }
    if (method === 'GET' && (url === '/api/git/proposal' || url.startsWith('/api/git/proposal?'))) {
      const qIdx = url.indexOf('?');
      const params = qIdx >= 0 ? new URLSearchParams(url.slice(qIdx + 1)) : new URLSearchParams();
      const flowId = params.get('flowId');
      const proposal = flowId !== null && flowId.length > 0
        ? await buildRunCommitProposal(projectRoot, flowId, params.get('intent') ?? undefined)
        : await buildCommitProposal(projectRoot);
      sendJson(res, proposal);
      return;
    }
    // GET /api/approvals — pending/approved/denied buckets, maskedArgs-only
    // (356-002, ADR-G-033/ADR-G-020). Never flag-gated — dashboard monitoring
    // stays always-on regardless of `approval.api_decide`.
    if (url === '/api/approvals') {
      const store = approvalLifecycleStore ?? new ApprovalStore(projectRoot);
      store.persistPolicyTransitions();
      store.sweepExpired();
      const snapshot = store.load();
      sendJson(res, {
        pending: snapshot.pending.map((e) => serializeApprovalEntry('pending', e)),
        approved: snapshot.approved.map((e) => serializeApprovalEntry('approved', e)),
        denied: snapshot.denied.map((e) => serializeApprovalEntry('denied', e)),
        // SURF-kuyruk-E: a TTL-swept approval is an observable fact — the
        // expired category was invisible here (the expiry chaos-leg smoke
        // caught the omission live). Additive field; monitoring never gated.
        expired: snapshot.expired.map((e) => serializeApprovalEntry('expired', e)),
        quarantined: snapshot.quarantined,
      });
      return;
    }

    // GET /api/approvals/history[?status=&limit=&offset=] — paginated settled-
    // approval audit trail (359-013/360-013, ADR-G-033/ADR-G-020). Must be
    // dispatched BEFORE the /api/approvals/:id block below — that block's
    // prefix match would otherwise swallow "history" as an id and 404.
    if (registerApprovalHistoryRoute(url, res, projectRoot)) return;

    // GET /api/approvals/:id — single entry detail. maskedArgs-only; raw
    // args are NEVER resolved (resolveRawArgs is never called from here).
    if (url.startsWith('/api/approvals/')) {
      const lookupLang = getLanguage();
      const id = parseApprovalLookupId(url.slice('/api/approvals/'.length));
      if (!id) {
        sendError(res, 400, getMessage('api.approvals.invalid_id', lookupLang));
        return;
      }
      const store = approvalLifecycleStore ?? new ApprovalStore(projectRoot);
      store.persistPolicyTransitions();
      store.sweepExpired();
      const found = findApprovalEntry(store, id);
      if (!found) {
        sendError(res, 404, getMessage('api.approvals.not_found', lookupLang));
        return;
      }
      sendJson(res, serializeApprovalEntry(found.category, found.entry));
      return;
    }

    // GET with no matching route
    sendError(res, 404, 'Not found');
    return;
  }

  // ─── POST routes ───────────────────────────────────────────
  if (method === 'POST') {
    let body: unknown;
    try {
      body = await parseBody(req);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Invalid JSON body';
      if (msg === 'Payload too large') {
        sendError(res, 413, 'Payload too large');
      } else {
        sendError(res, 400, 'Invalid JSON body');
      }
      return;
    }

    // POST /api/git/commit — A1 «Changes» (control-mutation-gated above):
    // stage-everything + commit in ONE sealed step (runs --commit semantics).
    if (url === '/api/git/commit') {
      const input = body as { message?: unknown };
      const message = typeof input?.message === 'string' ? input.message : '';
      if (message.trim().length === 0) {
        sendError(res, 400, 'commit message required');
        return;
      }
      const added = await gitWorkflowAdd(projectRoot);
      if (!added.ok) {
        sendError(res, added.note === 'not-a-git-repo' ? 409 : 500, added.error ?? added.note ?? 'git add failed');
        return;
      }
      const committed = await gitWorkflowCommit(projectRoot, message);
      if (!committed.ok) {
        sendError(res, 500, committed.error ?? 'git commit failed');
        return;
      }
      sendJson(res, { ok: true, sha: committed.sha ?? null, staged: added.staged });
      return;
    }

    if (registerNervousRoutes(url, method, res, projectRoot)) return;
    if (registerAutonomousRoutes(url, method, res, projectRoot, req, {
      ...(approvalLifecycle ? { lifecycle: approvalLifecycle } : {}),
      strictTenantIsolation,
      lang: approvalLang,
      authGateVerified:
        authMiddleware !== undefined && process.env['DECKENT_API_AUTH_DISABLED'] !== '1',
    })) return;
    // TERM-FLOW-UNIFY Sprint-7 (429-008, `terminal.run_flow_v2`): propose/decision.
    if (await registerRunFlowRoutes(
      url,
      method,
      res,
      body,
      projectRoot,
      req,
      providerAuthority,
    )) return;
    if (await registerProcessRoutes(url, method, res, body, projectRoot, req)) return;
    if (registerReactiveRoutes(url, method, res, body, projectRoot)) return;

    // OIDC SSO token exchange: POST /api/auth/oidc/exchange (277-007). Auth-exempt
    // (login flow has no bearer yet); config-gated (404 when dashboard_oidc off).
    if (await registerOidcCallbackRoute(url, method, res, body, projectRoot)) return;

    // POST /api/rpc — TERM-RPC HTTP wire (362-008, RPC-API-WIRE slice-2a).
    // Auth is already enforced generically above for every /api/* path — no
    // exemption is added for this route. A malformed envelope (fails
    // rpcRequestSchema) is a 400, same convention as every other POST body
    // schema in this file; a well-formed envelope always answers 200 with the
    // RpcResponse body (result OR error) — the dispatcher's own error taxonomy
    // (UNKNOWN_METHOD, METHOD_NOT_IMPLEMENTED, INVALID_PARAMS, ...) carries
    // the honest outcome, matching term-rpc.ts's transport-agnostic envelope.
    if (url === '/api/rpc') {
      const parsedRpc = rpcRequestSchema.safeParse(body);
      if (!parsedRpc.success) {
        sendError(res, 400, `Invalid RPC request: ${parsedRpc.error.message}`);
        return;
      }
      const rpcHandlers = buildRpcHandlerMap(projectRoot, terminalManager);
      if (isApprovalApiDecideEnabled(projectRoot)) {
        const { buildRpcWriteHandlerMap } = await import('./rpc-write-handlers.js');
        const authorization = req.headers['authorization'];
        const [scheme, approvalToken] = typeof authorization === 'string'
          ? authorization.split(' ', 2)
          : [];
        const idempotencyHeader = req.headers['idempotency-key'];
        const approvalIdempotencyKey = Array.isArray(idempotencyHeader)
          ? idempotencyHeader[0]
          : idempotencyHeader;
        const approvalDecideHandler = buildRpcWriteHandlerMap({
          projectRoot,
          requester: deriveRequestPrincipal(req).id,
          approvalAuthority,
          ...(scheme === 'Bearer' && approvalToken ? { approvalToken } : {}),
          ...(approvalIdempotencyKey ? { approvalIdempotencyKey } : {}),
        })['approval.decide'];
        if (approvalDecideHandler) rpcHandlers['approval.decide'] = approvalDecideHandler;
      }
      const rpcResponse = await dispatchRpcRequest(parsedRpc.data, rpcHandlers);
      sendJson(res, rpcResponse);
      return;
    }

    if (url === '/api/start') {
      const parsed = StartSchema.safeParse(body);
      if (!parsed.success) {
        sendError(res, 400, parsed.error.message);
        return;
      }
      sendJson(res, {
        error: 'LEGACY_START_RETIRED',
        code: 'LEGACY_START_RETIRED',
        canonicalFlow: [
          'POST /api/plan',
          'POST /api/run-flow/:flowId/decision',
          'POST /api/run-flow/:flowId/start',
        ],
      }, 410);
      return;
    }

    if (url === '/api/plan') {
      const parsed = PlanSchema.safeParse(body);
      if (!parsed.success) {
        sendError(res, 400, parsed.error.message);
        return;
      }
      try {
        const b = parsed.data;
        const config = await loadConfig(projectRoot);
        const flowId = randomUUID();
        const providerDecision = preflightApiBrainProviderAuthority(
          projectRoot,
          config,
          providerAuthority,
          `api-plan-${flowId}`,
        );
        if (providerDecision.decision === 'hold') {
          sendJson(res, providerDecision.body, providerDecision.statusCode);
          return;
        }
        const principal = deriveRequestPrincipal(req);
        // TENANT-001 T3: strict mode refuses a tenant-less caller instead of
        // folding it into `local` (the NULL-tenant hole). Default-off keeps v1.
        const startTenantScope = resolveApiCallerTenant(principal, projectRoot);
        if (startTenantScope.tenant === null) {
          sendJson(res, { error: startTenantScope.reason }, 403);
          return;
        }
        const tenantId = startTenantScope.tenant;
        const actor = {
          id: principal.id,
          ...(principal.role ? { role: principal.role } : {}),
          ...(principal.tenantId ? { tenantId: principal.tenantId } : {}),
        };
        const baseContext = readContext(projectRoot);
        const directive = b.directive?.trim();
        const context = directive
          ? { ...baseContext, directives: directive }
          : baseContext;
        const maxW = config.activeModeConfig.max_workers;
        const recommendation = {
          size: 'full' as const,
          maxWorkers: typeof maxW === 'number' ? maxW : 4,
          modelConstraint: null,
          reason: 'No usage constraints',
        };
        const plan = await planRunFlow({
          projectRoot,
          config,
          recommendation,
          proposal: {
            flowId,
            tenant: tenantId,
            project: config.projectName || basename(projectRoot),
            actor,
            origin: 'api',
            revision: 1,
            intentSummary: directive || config.projectName || basename(projectRoot),
          },
          lineage: {
            tenantId,
            actor,
            origin: 'api',
            correlationId: flowId,
            idempotencyKey: `api-plan:${flowId}:r1`,
            sourceRef: 'api:/api/plan',
          },
          source: {
            sourceKind: 'directives',
            brainContext: context,
          },
          previewOptions: {
            ...(b.mode !== undefined ? { mode: b.mode } : {}),
          },
        });
        console.log(`[deckent] Plan requested via dashboard (mode: ${b.mode ?? 'auto'})`);
        sendJson(res, {
          ...plan.sprint,
          runFlow: {
            flowId: plan.flowId,
            revision: plan.revision,
            planDigest: plan.planDigest,
            approval: plan.approval,
          },
          preview: plan.preview,
        });
      } catch (err: unknown) {
        sendError(res, 500, err instanceof Error ? err.message : 'Plan failed');
      }
      return;
    }

    if (url === '/api/chat') {
      const parsed = ChatSchema.safeParse(body);
      if (!parsed.success) {
        sendError(res, 400, parsed.error.message);
        return;
      }
      // NL messages ride the same provider adapter the stream block uses (seam
      // wins, then the config-resolved serveChatAdapter); explicit slash/commands
      // (status/help) stay on the classifier front-path. A missing/failing
      // adapter yields an honest i18n error — never a silent "Anlamadım".
      const acceptLang = String(req.headers['accept-language'] ?? '').toLowerCase();
      const lang = acceptLang.startsWith('tr') ? 'tr' : 'en';
      const chatReplyAdapter = chatStreamAdapter ?? chatAdapter ?? null;
      const reply = await resolveChatReply(
        parsed.data.message,
        { status: () => chatStatusLine(projectRoot, dashPath) },
        { adapter: chatReplyAdapter, lang },
      );
      sendJson(res, { reply });
      return;
    }

    // POST /api/kill/all — kill every active worker
    if (url === '/api/kill/all') {
      try {
        const killed = killAllWorkers();
        console.log(`[deckent] All workers killed via dashboard: ${killed}`);
        sendJson(res, { success: true, killed });
      } catch (err: unknown) {
        sendError(res, 500, err instanceof Error ? err.message : 'Kill all failed');
      }
      return;
    }

    // POST /api/kill/:workerId
    if (url.startsWith('/api/kill/')) {
      const workerId = url.slice('/api/kill/'.length);
      if (!workerId) { sendError(res, 400, 'Missing workerId'); return; }
      if (!WORKER_ID_RE.test(workerId)) { sendError(res, 400, 'Invalid workerId'); return; }
      try {
        killWorker(workerId);
        console.log(`[deckent] Worker killed via dashboard: ${workerId}`);
        sendJson(res, { success: true });
      } catch (err: unknown) {
        sendError(res, 500, err instanceof Error ? err.message : 'Kill failed');
      }
      return;
    }

    if (url === '/api/set-directives' || url === '/api/directives') {
      const parsed = SetDirectivesSchema.safeParse(body);
      if (!parsed.success) {
        sendError(res, 400, 'Missing content field');
        return;
      }
      const b = parsed.data;
      try {
        const directivesPath = join(projectRoot, DIRECTIVES_FILE);
        writeFileSync(directivesPath, b.content, 'utf-8');
        const taskCount = countTaskBlocks(b.content);
        console.log(`[deckent] Directives updated via dashboard (${taskCount} tasks)`);
        sendJson(res, { success: true, taskCount });
      } catch (err: unknown) {
        sendError(res, 500, err instanceof Error ? err.message : 'Write failed');
      }
      return;
    }

    if (url === '/api/cleanup') {
      const tasksDir = join(projectRoot, TASKS_DIR);
      const locksDir = join(projectRoot, LOCKS_DIR);

      // Collect task JSON files to check for active sprint
      const tasks: Task[] = [];
      if (existsSync(tasksDir)) {
        const jsonFiles = (readdirSync(tasksDir) as string[]).filter(
          (f) => f.startsWith('task-') && f.endsWith('.json'),
        );
        for (const f of jsonFiles) {
          try {
            const task = readJsonSafe(join(tasksDir, f)) as Task | null;
            if (!task) continue;
            tasks.push(task);
          } catch { /* skip malformed */ }
        }
      }

      // Block cleanup if sprint is actively executing
      const activeTasks = tasks.filter(
        (t) => t.status === TaskStatus.EXECUTING || t.status === TaskStatus.CLAIMED,
      );
      if (activeTasks.length > 0) {
        sendJson(res, { error: 'Cannot cleanup while sprint is active' }, 409);
        return;
      }

      // Count files before cleanup for the result payload
      const taskFileCount = existsSync(tasksDir)
        ? (readdirSync(tasksDir) as string[]).filter((f) => /\.(json|plan|hb|result|paused|log)$/.test(f)).length
        : 0;
      const lockFileCount = existsSync(locksDir)
        ? (readdirSync(locksDir) as string[]).length
        : 0;

      const sprint: Sprint = {
        id: `cleanup-${Date.now()}`,
        number: 0,
        status: SprintStatus.COMPLETE,
        phase: SprintPhase.COMPLETE,
        tasks,
        workers: [],
      };

      try {
        cleanup(projectRoot, sprint);
        console.log(`[deckent] Cleanup triggered via dashboard (removed: ${taskFileCount} tasks, ${lockFileCount} locks)`);
        sendJson(res, { success: true, removedTasks: taskFileCount, removedLocks: lockFileCount });
      } catch (err: unknown) {
        sendError(res, 500, err instanceof Error ? err.message : 'Cleanup failed');
      }
      return;
    }

    if (url === '/api/config') {
      const parsed = ConfigSchema.safeParse(body);
      if (!parsed.success) {
        sendError(res, 400, parsed.error.message);
        return;
      }
      const configPath = join(projectRoot, PROJECT_CONFIG_PATH);
      try {
        const existing: Record<string, unknown> = readJsonSafe<Record<string, unknown>>(configPath) ?? {};
        const merged = deepMerge(existing, parsed.data as Partial<Record<string, unknown>>);
        // Validate merged config before writing
        try {
          validatePartialConfig(merged as Partial<import('../core/config-types.js').DeckentConfig>);
        } catch (validationErr: unknown) {
          if (validationErr instanceof Error && validationErr.name === 'ConfigValidationError' && 'errors' in validationErr) {
            sendJson(res, { error: { code: 'VALIDATION_ERROR', message: 'Config validation failed', details: (validationErr as ConfigValidationError).errors } }, 422);
            return;
          }
          // Non-validation errors (e.g. missing function) are ignored — write proceeds
        }
        writeConfigJsonAtomic(configPath, merged);
        const changedKeys = Object.keys(parsed.data as Record<string, unknown>).join(', ');
        console.log(`[deckent] Config updated via dashboard: ${changedKeys}`);
        sendJson(res, merged);
      } catch (err: unknown) {
        sendError(res, 500, err instanceof Error ? err.message : 'Config update failed');
      }
      return;
    }

    // POST /api/webhooks/:connector/:key — inbound webhook from messaging platforms
    if (url.startsWith('/api/webhooks/')) {
      const parts = url.slice('/api/webhooks/'.length).split('/');
      const connector = parts[0] ?? '';
      const key = parts[1] ?? '';

      if (!connector || !key) {
        sendError(res, 400, 'Missing connector or key parameter');
        return;
      }

      if (!isValidConnectorId(connector)) {
        sendError(res, 400, `Invalid connector: ${connector}`);
        return;
      }

      // Validate webhook key against .deck secrets
      const secrets = loadDeckSecrets(projectRoot);
      const expectedKey = secrets['DECKENT_WEBHOOK_KEY'] ?? secrets[`DECKENT_WEBHOOK_KEY_${connector.toUpperCase()}`] ?? '';
      if (!expectedKey || !validateWebhookKey(key, expectedKey)) {
        sendError(res, 401, 'Invalid webhook key');
        return;
      }

      // Parse payload per connector format
      const parsed = parseWebhookPayload(connector, body);
      if (!parsed) {
        sendError(res, 400, 'Invalid webhook payload');
        return;
      }

      // Route to nervous system via IncomingMessageRouter
      const router = new IncomingMessageRouter();
      router.route({
        id: parsed.id,
        connector,
        fromUser: parsed.fromUser,
        channelId: parsed.channelId,
        text: parsed.text,
        timestamp: parsed.timestamp,
        raw: parsed.raw,
      });

      sendJson(res, { ok: true });
      return;
    }

    // POST /api/approvals/:id/decision — runtime-wide verified ingress.
    // Static bearer/localhost/RPC identity never authorizes this mutation:
    // the same Bearer value is verified again as a fresh OIDC step-up at the
    // decision boundary and the durable decision is MAC-bound by the shared
    // ApprovalAuthorityRuntimeService.
    if (url.startsWith('/api/approvals/') && url.endsWith('/decision')) {
      const approvalLang = getLanguage();
      const id = parseApprovalLookupId(url.slice('/api/approvals/'.length, -'/decision'.length));
      if (!id) {
        sendError(res, 400, getMessage('api.approvals.invalid_id', approvalLang));
        return;
      }

      if (!isApprovalApiDecideEnabled(projectRoot)) {
        sendError(
          res,
          403,
          getMessage('api.approvals.api_decide_disabled', approvalLang),
        );
        return;
      }

      const parsed = ApprovalDecisionBodySchema.safeParse(body);
      if (!parsed.success) {
        sendError(res, 400, parsed.error.message);
        return;
      }

      const authorization = req.headers['authorization'];
      const [scheme, stepUpToken] = typeof authorization === 'string'
        ? authorization.split(' ', 2)
        : [];
      const idempotencyHeader = req.headers['idempotency-key'];
      const idempotencyKey = Array.isArray(idempotencyHeader)
        ? idempotencyHeader[0]
        : idempotencyHeader;
      if (scheme !== 'Bearer' || !stepUpToken) {
        sendError(res, 401, getMessage('api.approval.fresh_oidc_required', approvalLang));
        return;
      }
      if (!idempotencyKey || idempotencyKey.trim().length === 0) {
        sendError(res, 400, getMessage('api.approval.idempotency_required', approvalLang));
        return;
      }

      const decisionStore = approvalLifecycleStore
        ?? approvalAuthority?.runtime.store
        ?? new ApprovalStore(projectRoot);
      decisionStore.persistPolicyTransitions();
      decisionStore.sweepExpired();
      const found = findApprovalEntry(decisionStore, id);
      if (!found) {
        sendError(res, 404, getMessage('api.approvals.not_found', approvalLang));
        return;
      }
      if (found.category !== 'pending') {
        sendError(res, 409, getMessage('api.approvals.already_decided', approvalLang, {
          category: found.category,
        }));
        return;
      }
      if (!approvalAuthority) {
        sendError(res, 503, getMessage('api.approval.authority_unavailable', approvalLang));
        return;
      }

      try {
        const outcome = await approvalAuthority.runtime.decideOidc({
          token: stepUpToken,
          policy: approvalAuthority.policy,
          verifier: approvalAuthority.verifier,
          channel: 'api-oidc',
        }, {
          requestId: id,
          action: parsed.data.decision,
          idempotencyKey: idempotencyKey.trim(),
          ...(parsed.data.reason ? { reason: parsed.data.reason } : {}),
        });
        if (outcome.kind === 'rejected') {
          sendError(
            res,
            outcome.reason === 'unknown-request' ? 404 : 403,
            getMessage('api.approval.decision_rejected', approvalLang, {
              reason: outcome.reason,
            }),
          );
          return;
        }
        if (outcome.kind === 'expired') {
          sendError(res, 409, getMessage('api.approval.request_expired', approvalLang));
          return;
        }
        sendJson(res, {
          success: true,
          decision: outcome.decision,
          idempotent: outcome.kind === 'idempotent',
        });
      } catch (err: unknown) {
        sendError(res, 500, getMessage('api.approval.decision_failed', approvalLang, {
          error: err instanceof Error ? err.message : 'unknown-error',
        }));
      }
      return;
    }

    sendError(res, 404, 'Not found');
    return;
  }

  // Unknown method
  sendError(res, 405, 'Method not allowed');
}

// ─── Public API ──────────────────────────────────────────────────

export interface HttpApi {
  server: Server;
  /** Terminal auth token (test-exposed). Only set when terminal is enabled. */
  terminalToken?: string;
  /**
   * Effective /api/* bearer token after the full resolution chain (explicit >
   * env > config > localhost auto-mint). DESK-1 (born-496): serve.ts persists
   * it into the serve-daemon handshake file so a desktop shell can adopt a
   * running daemon. Undefined ⇒ auth disabled.
   */
  apiToken?: string;
  /** PTY session manager (test-exposed). Only set when terminal is enabled. */
  terminalManager?: PtySessionManager;
  /**
   * TTL-expiry + retention-prune sweeper (404-004 APPROVAL-EXPIRY-DRIVER,
   * test-exposed). Always constructed and started — mirrors the terminal
   * idle-reaper's unconditional-when-server-runs posture; GET /api/approvals
   * is documented as never flag-gated, and this driver is the disk-hygiene
   * counterpart of that same always-on surface.
   */
  approvalExpiryDriver?: ApprovalExpiryDriver;
  /**
   * The EXACT `ApprovalBroker` instance `approvalExpiryDriver` sweeps
   * (test-exposed). `ApprovalBroker.expire()` only TTL-expires requests
   * previously `.submit()`'d through THIS SAME instance (approval-broker.ts
   * `requestsById` is populated solely by `submit()`) — tests that want to
   * observe a real sweep must submit through this reference, not a
   * newly-constructed broker pointed at the same directory.
   */
  approvalBroker?: ApprovalBroker;
  close(): Promise<void>;
}

interface AcceptanceConfirmationRuntimeAuditBase {
  readonly kind: 'acceptance-confirmation-reconciliation';
  /** Correlates the start-to-terminal outcome of exactly one bounded tick. */
  readonly correlationId: string;
  readonly tenantId: string;
  readonly projectRoot: string;
  readonly observedAt: string;
}

export interface AcceptanceConfirmationRuntimeSuccessAuditEvent
  extends AcceptanceConfirmationRuntimeAuditBase {
  readonly status: 'succeeded';
  readonly result: AcceptanceReconciliationRunResult;
}

export interface AcceptanceConfirmationRuntimeFailureAuditEvent
  extends AcceptanceConfirmationRuntimeAuditBase {
  readonly status: 'failed';
  readonly error: string;
}

export type AcceptanceConfirmationRuntimeAuditEvent =
  | AcceptanceConfirmationRuntimeSuccessAuditEvent
  | AcceptanceConfirmationRuntimeFailureAuditEvent;

export interface AcceptanceConfirmationRuntimeOptions {
  /** Exact tenant/project partition this process is authorized to drain. */
  readonly authority: { readonly tenantId: string; readonly projectRoot: string };
  readonly reconciler: AcceptanceConfirmationReconcilerDeps | AcceptanceConfirmationProductionReconciler;
  readonly pageSize?: number;
  readonly clock: () => Date;
  readonly writeAudit: (event: AcceptanceConfirmationRuntimeAuditEvent) => Promise<void> | void;
}

export interface HttpServerOptions {
  port?: number;
  staticDir?: string;
  /** Bearer token for POST endpoints. If omitted, auth is disabled. */
  apiToken?: string;
  /** Bind address. Defaults to 127.0.0.1 (localhost-only). */
  host?: string;
  /** Auto-generate a token if none provided. Defaults to false. */
  autoGenerateToken?: boolean;
  /** Max requests per minute per IP. Defaults to 100. 0 disables rate limiting. */
  rateLimit?: number;
  /**
   * Exempt loopback callers from the rate limiter (default true — the owner's
   * own localhost dashboard legitimately exceeds the per-minute budget via
   * page fetch fan-out + SSE reconnects). Set false to rate-limit loopback
   * too (tests exercising the 429 wire-up rely on this).
   */
  rateLimitExemptLoopback?: boolean;
  /** PTY session backend for embedded terminal support (Sprint 175). */
  terminalBackend?: SessionBackend;
  /**
   * OIDC JWT bearer verification (Sprint 267). Explicit override — when
   * omitted, the project config's `api_oidc` block is consulted (only when
   * `enabled: true`). See `AuthConfig.oidc` for the verification semantics.
   */
  oidc?: {
    issuer: string;
    audience?: string;
    algorithm: 'HS256' | 'RS256';
    key: string;
  };
  /**
   * Explicit override for the approval TTL-expiry + retention-prune sweep
   * cadence (404-004 APPROVAL-EXPIRY-DRIVER). Wins over the project config's
   * `approval.expiry_sweep_ms`; both absent falls back to
   * `DEFAULT_APPROVAL_EXPIRY_SWEEP_MS` — same explicit-param > config-file >
   * hardcoded-default resolution chain as `host`/`terminal.bind` above.
   */
  approvalExpirySweepMs?: number;
  /** Explicit resolved lifecycle authority; wins over project config. */
  approvalLifecycle?: ResolvedApprovalLifecycleConfig;
  /** Runtime transports are injected by the owner-provisioned connector host;
   * secrets are never provisioned by the approval lifecycle package. */
  approvalTransports?: ApprovalClientsWireTransports;
  approvalChannelsConfig?: ApprovalClientsWireConfig;
  /**
   * Shared attended-execution authority. The server never opens custody or
   * constructs a verifier; production composition injects the process-scoped
   * runtime and its pinned OIDC policy as one unit.
   */
  approvalAuthority?: {
    readonly runtime: ApprovalAuthorityRuntimeService;
    readonly policy: ApprovalOidcPolicy;
    readonly verifier: ApprovalOidcAssertionVerifier;
  };
  /**
   * Shared provider execution authority. Production composition owns the
   * process-scoped lifecycle; the HTTP server only consumes the exact injected
   * open result at provider-backed orchestration ingress.
   */
  providerAuthority?: ProviderAuthorityRuntimeServiceOpenResult;
  /**
   * Durable acceptance-confirmation restart drain. It intentionally remains
   * active when the lifecycle creation policy is disabled: gate-off prevents
   * new pending work, but cannot abandon already-durable settlement intent.
   */
  acceptanceConfirmation?: AcceptanceConfirmationRuntimeOptions;
}

// ─── SEC-03: token-fingerprint + runtime token-file persistence ────────────
// A raw bearer token must never land in a process-log stream — any log
// collector (CI, journald, a log-shipper) that captures stderr would then
// store the live credential in plaintext. Every startup log line that used to
// interpolate a raw token now logs a short, non-reversible SHA-256 fingerprint
// instead; the actual token is persisted to an owner-only (0600) file under
// `.deckent/runtime/` and the log line names that file's path so an operator
// who legitimately needs the value can read it from disk.

/** `tok:` + the first 12 hex chars of SHA-256(token) — identifies a token across log lines without revealing it. */
function tokenFingerprint(token: string): string {
  return `tok:${createHash('sha256').update(token).digest('hex').slice(0, 12)}`;
}

/**
 * Atomically persist a runtime token file (same-directory tmp write + rename
 * + owner-only hardening) and return its absolute path.
 *
 * Mirrors core/deck-file.ts's `createDeckTemplate`/`applyWindowsOwnerOnlyAcl`
 * tmp+rename+chmod(0600) pattern byte-for-byte; that helper isn't exported
 * and deck-file.ts is outside this task's write scope, so the platform-
 * specific hardening is duplicated here rather than imported.
 */
function writeRuntimeTokenFile(projectRoot: string, fileName: string, token: string, lang: string): string {
  const dir = join(projectRoot, RUNTIME_DIR);
  mkdirSync(dir, { recursive: true });
  const tokenPath = join(dir, fileName);
  const tmpPath = `${tokenPath}.tmp`;
  writeFileSync(tmpPath, `${token}\n`, { encoding: 'utf-8', mode: 0o600 });
  try {
    renameSync(tmpPath, tokenPath);
  } catch (renameErr) {
    try {
      unlinkSync(tmpPath);
    } catch {
      // Best-effort cleanup — the renameErr thrown below is what the caller needs to see.
    }
    throw renameErr;
  }

  if (osPlatform() === 'win32') {
    const username = process.env['USERNAME'];
    if (!username) {
      process.stderr.write(
        `${getMessage('serve.token.win_acl_unavailable', lang, { path: tokenPath })}\n`,
      );
      return tokenPath;
    }
    try {
      const child = nodeSpawn('icacls', [tokenPath, '/inheritance:r', '/grant:r', `${username}:F`], {
        stdio: ['ignore', 'ignore', 'pipe'],
      });
      let stderrOutput = '';
      child.stderr?.on('data', (chunk: Buffer | string) => {
        stderrOutput += chunk.toString();
      });
      child.on('error', (err) => {
        process.stderr.write(
          `${getMessage('serve.token.win_acl_warn', lang, { path: tokenPath, detail: err.message })}\n`,
        );
      });
      child.on('close', (code) => {
        if (code !== 0) {
          process.stderr.write(
            `${getMessage('serve.token.win_acl_warn', lang, {
              path: tokenPath,
              detail: `icacls exited with code ${code}${stderrOutput.trim() ? `: ${stderrOutput.trim()}` : ''}`,
            })}\n`,
          );
        }
      });
    } catch (err) {
      process.stderr.write(
        `${getMessage('serve.token.win_acl_warn', lang, {
          path: tokenPath,
          detail: err instanceof Error ? err.message : String(err),
        })}\n`,
      );
    }
  } else {
    try {
      // Re-assert 0600 unconditionally: the mode passed to writeFileSync is masked
      // by the process umask before landing on disk, so a permissive umask can leave
      // the file wider than owner-only. chmodSync ignores umask entirely.
      chmodSync(tokenPath, 0o600);
    } catch (err) {
      process.stderr.write(
        `${getMessage('serve.token.posix_chmod_failed', lang, {
          path: tokenPath,
          error: err instanceof Error ? err.message : String(err),
        })}\n`,
      );
    }
  }
  return tokenPath;
}

export function createHttpServer(projectRoot: string, port?: number, staticDir?: string, apiToken?: string): HttpApi;
export function createHttpServer(projectRoot: string, opts?: HttpServerOptions): HttpApi;
export function createHttpServer(
  projectRoot: string,
  portOrOpts?: number | HttpServerOptions,
  staticDir?: string,
  apiToken?: string,
): HttpApi {
  let listenPort: number;
  let resolvedStaticDir: string | undefined;
  let resolvedToken: string | undefined;
  let host: string;
  // SEC-03: no ResolvedConfig loaded at this synchronous point (see the
  // rawCfgForBind/rawCfgForApproval sync-read comments below) — same
  // env-fallback getLanguage() call already used for module-level messages
  // elsewhere (cli/commands/agent.ts, cli/commands/chat.ts) without a config object in scope.
  const lang = getLanguage();

  let autoGenerateToken = false;
  let rateLimitMax = 100;
  let rateLimitExemptLoopback = true;
  let terminalBackend: SessionBackend | undefined;
  let resolvedOidc: HttpServerOptions['oidc'];
  let approvalExpirySweepMsOpt: number | undefined;
  let approvalAuthority: HttpServerOptions['approvalAuthority'];
  let approvalLifecycleOpt: ResolvedApprovalLifecycleConfig | undefined;
  let approvalTransports: ApprovalClientsWireTransports | undefined;
  let approvalChannelsConfigOpt: ApprovalClientsWireConfig | undefined;
  let providerAuthority: HttpServerOptions['providerAuthority'];
  let acceptanceConfirmation: AcceptanceConfirmationRuntimeOptions | undefined;

  // TERM-CONFIG-WIRE (357-009): `terminal.bind` fallback for the server's
  // listen host. Same raw sync-read pattern as the token/OIDC blocks below
  // (createHttpServer is synchronous, loadConfig is async). An explicit
  // `host`/`portOrOpts.host` caller value ALWAYS wins — config only fills the
  // previously-fixed LOCALHOST_ONLY default, so config-absent behavior is
  // unchanged. This is safe against the command-guard's I3 loopback-bypass
  // invariant precisely because this same resolved `host` is what actually
  // gets passed to `server.listen()` below — declared and actual bind can
  // never diverge.
  const rawCfgForBind = readJsonSafe<{ terminal?: { bind?: unknown } }>(
    join(projectRoot, PROJECT_CONFIG_PATH),
  );
  const terminalConfigBind =
    typeof rawCfgForBind?.terminal?.bind === 'string' && rawCfgForBind.terminal.bind.length > 0
      ? rawCfgForBind.terminal.bind
      : undefined;

  // APPROVAL-EXPIRY-DRIVER-WIRE (404-004): `approval.expiry_sweep_ms` fallback
  // for the TTL-expiry/retention-prune sweep interval. Same raw sync-read
  // pattern as `rawCfgForBind` above — createHttpServer is synchronous,
  // loadConfig is async. `ApprovalConfig` (config-types.ts) is out of this
  // task's write scope, same gap `isApprovalApiDecideEnabled` below already
  // documents for `approval.api_decide` — read raw, never through
  // `ResolvedConfig`.
  const rawCfgForApproval = readJsonSafe<ApprovalClientsWireConfig & {
    approval?: { expiry_sweep_ms?: unknown; lifecycle?: ApprovalLifecycleConfig };
  }>(
    join(projectRoot, PROJECT_CONFIG_PATH),
  );
  const approvalConfigSweepMs =
    typeof rawCfgForApproval?.approval?.expiry_sweep_ms === 'number' &&
    Number.isFinite(rawCfgForApproval.approval.expiry_sweep_ms) &&
    rawCfgForApproval.approval.expiry_sweep_ms > 0
      ? rawCfgForApproval.approval.expiry_sweep_ms
      : undefined;

  if (typeof portOrOpts === 'object' && portOrOpts !== null) {
    listenPort = portOrOpts.port ?? DEFAULT_PORT;
    resolvedStaticDir = portOrOpts.staticDir;
    resolvedToken = portOrOpts.apiToken;
    host = portOrOpts.host ?? terminalConfigBind ?? LOCALHOST_ONLY;
    autoGenerateToken = portOrOpts.autoGenerateToken ?? false;
    rateLimitMax = portOrOpts.rateLimit ?? 100;
    rateLimitExemptLoopback = portOrOpts.rateLimitExemptLoopback ?? true;
    terminalBackend = portOrOpts.terminalBackend;
    resolvedOidc = portOrOpts.oidc;
    approvalExpirySweepMsOpt = portOrOpts.approvalExpirySweepMs;
    approvalLifecycleOpt = portOrOpts.approvalLifecycle;
    approvalTransports = portOrOpts.approvalTransports;
    approvalChannelsConfigOpt = portOrOpts.approvalChannelsConfig;
    approvalAuthority = portOrOpts.approvalAuthority;
    providerAuthority = portOrOpts.providerAuthority;
    acceptanceConfirmation = portOrOpts.acceptanceConfirmation;
  } else {
    listenPort = portOrOpts ?? DEFAULT_PORT;
    resolvedStaticDir = staticDir;
    resolvedToken = apiToken;
    host = terminalConfigBind ?? LOCALHOST_ONLY;
  }

  const resolvedApprovalExpirySweepMs =
    approvalExpirySweepMsOpt ?? approvalConfigSweepMs ?? DEFAULT_APPROVAL_EXPIRY_SWEEP_MS;
  const resolvedApprovalLifecycle = approvalLifecycleOpt
    ?? resolveApprovalLifecyclePolicy(rawCfgForApproval?.approval?.lifecycle);

  // Auto-generate token if requested and none provided
  if (!resolvedToken && autoGenerateToken) {
    resolvedToken = randomUUID();
    // SEC-03: never interpolate the raw token into a stderr line (process
    // logs are frequently captured verbatim by CI/journald/log-shippers) —
    // log a short fingerprint plus the 0600 file the real value was persisted to.
    let apiTokenPath: string | undefined;
    try {
      apiTokenPath = writeRuntimeTokenFile(projectRoot, 'api-token', resolvedToken, lang);
    } catch (err) {
      process.stderr.write(
        `${getMessage('serve.token.persist_failed', lang, {
          file: 'api-token',
          error: err instanceof Error ? err.message : String(err),
        })}\n`,
      );
    }
    process.stderr.write(
      `${getMessage('serve.token.auto_generated', lang, {
        fingerprint: tokenFingerprint(resolvedToken),
        path: apiTokenPath ?? join(projectRoot, RUNTIME_DIR, 'api-token'),
      })}\n`,
    );
  }

  // Resolve final token — single resolution order (A4, Sprint 269):
  //   explicit param > env DECKENT_API_TOKEN > config api_auth_token > localhost auto-mint.
  // resolveAuthToken keeps its existing contract (explicit > env); the config
  // layer below only fills the previously-dead third slot — `deckent serve`
  // never forwarded config.api_auth_token, so users who set it got 401s.
  let finalToken = resolveAuthToken(resolvedToken);
  if (!finalToken) {
    const projCfgForToken = join(projectRoot, PROJECT_CONFIG_PATH);
    const rawCfgForToken = readJsonSafe<{ api_auth_token?: unknown }>(projCfgForToken);
    if (rawCfgForToken) {
      // Same deck-interpolation pass as the OIDC block — `$DECK:KEY` resolves.
      const cfgToken = interpolateConfig(rawCfgForToken.api_auth_token, projectRoot);
      if (typeof cfgToken === 'string' && cfgToken.length > 0) finalToken = cfgToken;
    }
  }

  // Sprint 216-006 (reconstructed Sprint 218 after a git reset --hard wiped the
  // original uncommitted change). On a loopback bind with no configured token,
  // auto-mint an API token so the dashboard served from the same origin receives
  // a working `__DECKENT_API_TOKEN__` injection and `/api/*` returns 200 instead
  // of 401. Without this the dashboard loads but every data call fails. Remote
  // binds still require an explicit token (no silent auth on non-loopback).
  const isLoopbackHost = host === '127.0.0.1' || host === '::1' || host === 'localhost';
  if (!finalToken && isLoopbackHost && process.env['DECKENT_API_AUTH_DISABLED'] !== '1') {
    finalToken = randomBytes(32).toString('hex');
    // SEC-03: same fingerprint+file-path redaction as the auto-generate branch
    // above — these two branches are mutually exclusive per run (this one only
    // fires when `!finalToken`, which the auto-generate branch already falsified
    // whenever it ran), so they safely share the same `.deckent/runtime/api-token` file.
    let apiTokenPath: string | undefined;
    try {
      apiTokenPath = writeRuntimeTokenFile(projectRoot, 'api-token', finalToken, lang);
    } catch (err) {
      process.stderr.write(
        `${getMessage('serve.token.persist_failed', lang, {
          file: 'api-token',
          error: err instanceof Error ? err.message : String(err),
        })}\n`,
      );
    }
    process.stderr.write(
      `${getMessage('serve.token.auto_minted', lang, {
        fingerprint: tokenFingerprint(finalToken),
        path: apiTokenPath ?? join(projectRoot, RUNTIME_DIR, 'api-token'),
      })}\n`,
    );
  }

  // Inform at startup about auth status (only reached on a remote bind with no token)
  if (!finalToken && process.env['DECKENT_API_AUTH_DISABLED'] !== '1') {
    process.stderr.write(
      '[deckent:info] No API token configured. All API requests will require auth (401). Set DECKENT_API_TOKEN or config.api_auth_token to provide a token.\n',
    );
  }

  // ─── OIDC bearer config (Sprint 267 T-267-001) ──────────────────
  // Explicit `opts.oidc` wins; otherwise sync-read the project config's
  // `api_oidc` block (same sync-read pattern as the terminal block below —
  // createHttpServer is synchronous, loadConfig is async). The block passes
  // through deck-interpolation so `$DECK:KEY` in `key` resolves exactly like
  // the rest of the config. Fail-closed: a block that is missing, disabled,
  // or incomplete leaves the middleware exactly as before (api_oidc default-off).
  if (!resolvedOidc) {
    const projCfgForOidc = join(projectRoot, PROJECT_CONFIG_PATH);
    const rawCfgForOidc = readJsonSafe<{ api_oidc?: { enabled?: boolean; issuer?: string; audience?: string; algorithm?: string; key?: string } }>(projCfgForOidc);
    if (rawCfgForOidc) {
      const block = interpolateConfig(rawCfgForOidc.api_oidc, projectRoot);
      if (
        block?.enabled === true &&
        typeof block.issuer === 'string' && block.issuer.length > 0 &&
        typeof block.key === 'string' && block.key.length > 0 &&
        (block.algorithm === 'HS256' || block.algorithm === 'RS256')
      ) {
        resolvedOidc = {
          issuer: block.issuer,
          ...(typeof block.audience === 'string' ? { audience: block.audience } : {}),
          algorithm: block.algorithm,
          key: block.key,
        };
      }
    }
  }

  // Build auth middleware with health endpoint exempt. SSE clients
  // (`EventSource`) cannot set Authorization headers, so the SSE GET endpoints
  // opt into a `?token=...` query-parameter fallback — the dashboard appends
  // the bootstrap token there. Same constant-time compare as the Bearer header.
  // Both EventSource channels are whitelisted: `/api/events` (dashboard event
  // stream) and `/api/chat/stream` (chat SSE — Sprint 282 282-004 root-fix; the
  // dashboard chat EventSource carries its token on `?token=` exactly like
  // `/api/events`, so omitting it 401'd every chat stream and forced the
  // "Anlamadım" classifier fallback — DASH-UX-1).
  const authMiddleware = bearerAuthMiddleware({
    configToken: finalToken,
    // /api/auth/oidc/exchange is the SSO login flow (Sprint 277) — the caller
    // has no bearer yet, so it bypasses the bearer gate. The endpoint itself is
    // config-gated (404 when dashboard_oidc is disabled), so exempting the path
    // leaks nothing.
    exemptPaths: ['/health', '/api/health', '/api/auth/oidc/exchange'],
    queryTokenPaths: ['/api/events', '/api/chat/stream'],
    // Worker-log SSE (DASH-RT-2): `/api/workers/:taskId/logs/stream` has a
    // dynamic segment, so it cannot be an exact entry. The PREFIX form (trailing
    // slash) grants the same query-token fallback to the sub-resource while the
    // `/api/workers` LIST endpoint stays exact-match-only (behavior unchanged).
    // SURF-2: run-flow SSE (`/api/run-flow/:flowId/events`) is EventSource-
    // consumed (Desktop console / terminal follow) — headerless by nature.
    // The PREFIX also covers the read-only GETs (:flowId, /preview); the
    // query-token fallback itself is GET/HEAD-only (auth.ts hardening), so
    // POST decision/propose can never authenticate via a URL token.
    queryTokenPrefixes: ['/api/workers/', '/api/run-flow/'],
    ...(resolvedOidc ? { oidc: resolvedOidc } : {}),
  });

  const rateLimiter = rateLimitMax > 0
    ? new SlidingWindowRateLimiter(rateLimitMax, undefined, { exemptLoopback: rateLimitExemptLoopback })
    : undefined;

  const dashPath = join(projectRoot, DASHBOARD_FILE);
  const sseClients = new Set<ServerResponse>();

  // Eager OutputCollector for /api/output-stream SSE (Sprint 230 T-230-008,
  // eager since Sprint 269 B-OutputStream). One per server — workers attach via
  // the docker/tmux/subprocess backends. Created at setup so the first SSE
  // request (before any worker attaches) streams an empty snapshot instead of
  // racing a lazy init; a constructor failure leaves null → honest 503.
  let outputCollector: OutputCollector | null = null;
  try {
    outputCollector = createOutputCollector(projectRoot);
  } catch {
    outputCollector = null;
  }

  // ─── Approval TTL-expiry + retention-prune driver (404-004
  // APPROVAL-EXPIRY-DRIVER) ────────────────────────────────────────
  // approval-expiry-driver.ts existed with zero production callers — nothing
  // ever ran `ApprovalBroker.expire()`, so `ApprovalStore.prune()` could never
  // clean up a TTL-expired-but-undecided entry (prune() only removes entries
  // that already carry a `decision.decidedAt`; see approval-store.ts). One
  // shared broker+store pair, unconditional (mirrors GET /api/approvals'
  // "never flag-gated" posture — this is that same surface's disk-hygiene
  // counterpart), started before `server.listen` below and stopped in
  // `close()`. `ApprovalExpiryDriver.start()` unref's its own interval
  // (ADR-G-013) — same MOAT-2 lesson as the terminal idle-reaper's
  // `.unref?.()` further down. Wrapped fail-soft exactly like `outputCollector`
  // above — several existing test suites replace `node:fs` with a partial
  // mock (no `mkdirSync`); a constructor failure there must leave the
  // approval surface absent, not crash every unrelated createHttpServer() call.
  let approvalBroker: ApprovalBroker | undefined;
  let approvalStore: ApprovalStore | undefined;
  let approvalExpiryDriver: ApprovalExpiryDriver | undefined;
  let approvalRelay: ApprovalRelay | undefined;
  let acceptanceReconciliationInFlight: Promise<void> | undefined;

  const runAcceptanceReconciliationTick = (): Promise<void> => {
    if (!acceptanceConfirmation) return Promise.resolve();
    if (acceptanceReconciliationInFlight) return acceptanceReconciliationInFlight;

    const runtime = acceptanceConfirmation;
    const correlationId = randomUUID();
    const auditBase: AcceptanceConfirmationRuntimeAuditBase = {
      kind: 'acceptance-confirmation-reconciliation',
      correlationId,
      tenantId: runtime.authority.tenantId,
      projectRoot: runtime.authority.projectRoot,
      observedAt: runtime.clock().toISOString(),
    };
    const operation = (async (): Promise<void> => {
      try {
        if (resolve(runtime.authority.projectRoot) !== resolve(projectRoot)) {
          throw new Error('acceptance reconciliation project authority mismatch');
        }
        const result = 'run' in runtime.reconciler
          ? await runtime.reconciler.run({
              limit: runtime.pageSize ?? ACCEPTANCE_CONFIRMATION_MAX_CANDIDATES,
            })
          : await runAcceptanceConfirmationReconciliation(
              runtime.reconciler,
              {
                tenantId: runtime.authority.tenantId,
                limit: runtime.pageSize ?? ACCEPTANCE_CONFIRMATION_MAX_CANDIDATES,
              },
            );
        await runtime.writeAudit({ ...auditBase, status: 'succeeded', result });
      } catch (error) {
        const failure = error instanceof Error ? error.message : String(error);
        try {
          await runtime.writeAudit({ ...auditBase, status: 'failed', error: failure });
        } catch (auditError) {
          throw new AggregateError(
            [error, auditError],
            `acceptance reconciliation and failure audit failed (${correlationId})`,
          );
        }
        throw error;
      }
    })();
    acceptanceReconciliationInFlight = operation.finally(() => {
      acceptanceReconciliationInFlight = undefined;
    });
    return acceptanceReconciliationInFlight;
  };
  try {
    approvalBroker = approvalAuthority?.runtime.broker ?? new ApprovalBroker(projectRoot, {
      lifecycle: resolvedApprovalLifecycle,
    });
    approvalStore = new ApprovalStore(projectRoot, { lifecycle: resolvedApprovalLifecycle });
    approvalRelay = new ApprovalRelay(
      approvalBroker,
      new ApprovalNotifyDedup(projectRoot),
    );
    attachConfiguredApprovalChannels(
      approvalRelay,
      approvalChannelsConfigOpt ?? rawCfgForApproval ?? undefined,
      approvalTransports ?? {},
      { lifecycleAckRoot: join(projectRoot, '.deckent', 'approvals', 'client-acks') },
    );
    approvalExpiryDriver = new ApprovalExpiryDriver({
      broker: approvalBroker,
      store: approvalStore,
      slaJournal: new ApprovalSlaJournal({
        storeDir: join(projectRoot, '.deckent', 'approvals', 'sla-journal'),
      }),
      onLifecycleStage: async (request, evidence) => {
        const delivered = await approvalRelay?.dispatchLifecycleStage(request, evidence);
        if (delivered === false) throw new Error(`approval lifecycle delivery failed: ${evidence.eventId}`);
        writeApprovalLifecycleAuditEvent(projectRoot, request.scopeId, {
          tenantId: request.tenantId,
          requestId: request.id,
          origin: request.origin,
          sourceReference: request.source.reference,
          evidence,
        });
      },
      onLegacyLifecycleSweep: async (observedAt) => {
        const pendingPath = autonomousPendingPath(projectRoot);
        const operations: Promise<unknown>[] = [Promise.resolve().then(() => {
          sweepExpiredConfirmations(projectRoot, {
            lifecycle: resolvedApprovalLifecycle,
            clock: () => observedAt,
          });
          makeApprovalGate({
            pendingPath,
            projectRoot,
            lifecycle: resolvedApprovalLifecycle,
            now: () => observedAt.toISOString(),
          }).pending();
        })];
        if (acceptanceConfirmation) operations.push(runAcceptanceReconciliationTick());
        const home = gatewayHome();
        const pairingsPath = join(home, 'pairings.json');
        if (existsSync(pairingsPath)) {
          operations.push(loadGatewayAccess({
            pairingsPath,
            allowlistPath: join(home, 'allowlist.json'),
            bindingsPath: join(home, 'bindings.json'),
            clock: () => observedAt,
          }).then(async (access) => await access.sweepExpiredPairings()));
        }
        const results = await Promise.allSettled(operations);
        const failures = results.flatMap((result) => result.status === 'rejected' ? [result.reason] : []);
        if (failures.length > 0) throw new AggregateError(failures, 'approval legacy lifecycle sweep failed');
      },
      onTimeoutReceipt: async (receipt) => {
        const settled = await settleFederatedTimeoutReceipt(projectRoot, receipt);
        if (settled.state === 'failed') {
          throw new Error(`approval timeout settle-back failed: ${settled.reason}`);
        }
        writeApprovalLifecycleAuditEvent(projectRoot, receipt.scopeId, {
          tenantId: receipt.tenantId,
          requestId: receipt.requestId,
          origin: receipt.origin,
          sourceReference: receipt.sourceReference,
          evidence: {
            eventId: approvalSlaEventId(receipt.requestId, receipt.lifecycleGeneration, 'expired'),
            requestId: receipt.requestId,
            lifecycleGeneration: receipt.lifecycleGeneration,
            stage: 'expired',
            ordinal: 4,
            kind: 'expired',
            dueAt: receipt.expiresAt,
            observedAt: receipt.decidedAt,
            authoredPolicyDigest: receipt.authoredPolicyDigest,
            appliedPolicyDigest: receipt.appliedPolicyDigest,
          },
        });
      },
    });
    approvalExpiryDriver.start(resolvedApprovalExpirySweepMs);
  } catch {
    approvalBroker = undefined;
    approvalStore = undefined;
    approvalExpiryDriver = undefined;
    approvalRelay = undefined;
  }

  // Config-driven chat adapter for /api/chat/stream (Sprint 269 B-ChatStream).
  // Rides the REPL's resolveChatAdapter SSOT (ADR-083 chat-provider-parity) so
  // dashboard chat streams through the same provider the terminal REPL uses.
  // Same raw sync config read as the OIDC/terminal blocks (createHttpServer is
  // synchronous). The test seam (setChatStreamAdapter) still wins at request
  // time; resolution failure leaves null → the endpoint's honest SSE-error.
  let serveChatAdapter: ChatProviderAdapter | null = null;
  try {
    const projCfgForChat = join(projectRoot, PROJECT_CONFIG_PATH);
    const rawChatCfg = readJsonSafe<Parameters<typeof resolveChatProvider>[0]>(projCfgForChat);
    serveChatAdapter = resolveChatAdapter(resolveChatProvider(rawChatCfg), {});
  } catch {
    serveChatAdapter = null;
  }

  // Watch dashboard file for SSE — lazy start
  let watcher: ReturnType<typeof watchDashboard> | null = null;

  // Live event bridge (DASH-RT-1, Sprint 284): real-time hb/result/event-stream
  // push to the SAME `/api/events` SSE channel. Started lazily on the first SSE
  // connect, independent of `.dashboard` existence, and fans out through the
  // existing `sseClients` set (no second registry). Typed frames carry a named
  // SSE `event:` field so they never collide with the snapshot's `data:`
  // message. Fail-safe — a watcher fault never crashes serve.
  let liveBridge: LiveEventBridge | null = null;
  function ensureLiveBridge(): void {
    if (liveBridge !== null) return;
    try {
      liveBridge = startLiveEventBridge({
        projectRoot,
        onEvent: (ev) => {
          const frame = formatLiveEventFrame(ev);
          for (const client of sseClients) {
            try {
              client.write(frame);
            } catch {
              // client gone — close() / req.on('close') cleans the set up
            }
          }
        },
      });
    } catch {
      liveBridge = null;
    }
  }

  function initWatcher(): void {
    ensureLiveBridge();
    if (watcher !== null) return;
    if (!existsSync(dashPath)) return;
    watcher = watchDashboard(dashPath, () => {
      const data = readDashboardJson(dashPath);
      if (!data) return;
      const payload = `data: ${JSON.stringify(data)}\n\n`;
      for (const client of sseClients) {
        client.write(payload);
      }
    });
    // Send current data to all connected clients
    const data = readDashboardJson(dashPath);
    if (data) {
      const payload = `data: ${JSON.stringify(data)}\n\n`;
      for (const client of sseClients) {
        client.write(payload);
      }
    }
  }

  // ─── Terminal setup (Sprint 175) ──────────────────────────────
  let terminalToken: string | undefined;
  let terminalMgr: PtySessionManager | undefined;
  let terminalAudit: TerminalAudit | undefined;
  let terminalAuditStore: MemoryStore | undefined;
  let terminalAuth: AuthProvider | undefined;
  let terminalReaper: NodeJS.Timeout | undefined;
  let terminalLimiter: OutboundLimiter | undefined;
  // TERM-CONFIG-WIRE (357-009): session-manager defaults, overridden below
  // from `config.terminal.*` when present + valid — absent/invalid config
  // preserves these exact literals (byte-identical to the pre-wire hardcode).
  let terminalMaxSessions: number = TERMINAL_DEFAULT_MAX_SESSIONS;
  let terminalIdleTimeoutMs: number = TERMINAL_DEFAULT_IDLE_TIMEOUT_MS;
  let terminalScrollbackBytes: number = TERMINAL_DEFAULT_SCROLLBACK_BYTES;
  let terminalAllowShellKind: boolean = TERMINAL_DEFAULT_ALLOW_SHELL_KIND;
  let terminalOutboundQuotaBytes: number = TERMINAL_DEFAULT_OUTBOUND_QUOTA_BYTES;

  if (terminalBackend) {
    // Check if terminal is enabled via project config (sync read — createHttpServer is synchronous)
    let terminalEnabled = true;
    // Opt-in JWKS terminal auth (Sprint 268 — ENT-5 async seam). Consulted via
    // the same raw project-config read as `terminal.enabled`; absent block =
    // EXACTLY today's local-token behavior (default-off).
    let terminalJwks: { issuer: string; audience?: string; jwksUrl: string } | undefined;
    // AUDIT-WIRE (ADR-G-029 invariant #3 clause-2): gates the HMAC integrity
    // chain on the persisted audit trail. Persistence itself (MemoryStoreAuditSink)
    // is unconditional — this only decides whether TerminalAudit chain-links
    // each row. New gate, so secure-by-default (absent block = enabled).
    let terminalAuditIntegrityEnabled = true;
    const projCfgPath = join(projectRoot, PROJECT_CONFIG_PATH);
    if (existsSync(projCfgPath)) {
      try {
        const raw = readFileSync(projCfgPath, 'utf-8');
        const projCfg = JSON.parse(raw) as {
          terminal?: {
            enabled?: boolean;
            maxSessions?: unknown;
            idleTimeoutMs?: unknown;
            scrollbackBytes?: unknown;
            allowShellKind?: unknown;
            outboundDailyQuotaBytes?: unknown;
          };
          terminal_oidc_jwks?: { issuer?: unknown; audience?: unknown; jwksUrl?: unknown };
          terminal_audit_integrity?: { enabled?: boolean };
        };
        if (projCfg?.terminal?.enabled === false) {
          terminalEnabled = false;
        }
        if (projCfg?.terminal_audit_integrity?.enabled === false) {
          terminalAuditIntegrityEnabled = false;
        }
        // TERM-CONFIG-WIRE (357-009): validate before use — a malformed value
        // (wrong type / out-of-range) silently keeps the DEFAULT_TERMINAL_CONFIG
        // literal rather than propagating garbage into PtySessionManager.
        const cfgMaxSessions = projCfg?.terminal?.maxSessions;
        if (typeof cfgMaxSessions === 'number' && Number.isFinite(cfgMaxSessions) && cfgMaxSessions > 0) {
          terminalMaxSessions = cfgMaxSessions;
        }
        const cfgIdleTimeoutMs = projCfg?.terminal?.idleTimeoutMs;
        if (typeof cfgIdleTimeoutMs === 'number' && Number.isFinite(cfgIdleTimeoutMs) && cfgIdleTimeoutMs >= 0) {
          terminalIdleTimeoutMs = cfgIdleTimeoutMs;
        }
        const cfgScrollbackBytes = projCfg?.terminal?.scrollbackBytes;
        if (typeof cfgScrollbackBytes === 'number' && Number.isFinite(cfgScrollbackBytes) && cfgScrollbackBytes > 0) {
          terminalScrollbackBytes = cfgScrollbackBytes;
        }
        const cfgAllowShellKind = projCfg?.terminal?.allowShellKind;
        if (typeof cfgAllowShellKind === 'boolean') {
          terminalAllowShellKind = cfgAllowShellKind;
        }
        const cfgOutboundQuota = projCfg?.terminal?.outboundDailyQuotaBytes;
        if (typeof cfgOutboundQuota === 'number' && Number.isFinite(cfgOutboundQuota) && cfgOutboundQuota > 0) {
          terminalOutboundQuotaBytes = cfgOutboundQuota;
        }
        const jwks = projCfg?.terminal_oidc_jwks;
        if (jwks !== undefined && jwks !== null && typeof jwks === 'object') {
          if (
            typeof jwks.issuer === 'string' && jwks.issuer.length > 0 &&
            typeof jwks.jwksUrl === 'string' && jwks.jwksUrl.length > 0
          ) {
            terminalJwks = {
              issuer: jwks.issuer,
              jwksUrl: jwks.jwksUrl,
              ...(typeof jwks.audience === 'string' && jwks.audience.length > 0
                ? { audience: jwks.audience }
                : {}),
            };
          } else {
            // Malformed block: fall back to the (still-secure, random) local
            // token rather than silently running a misconfigured IdP setup.
            process.stderr.write(
              '[deckent:warn] terminal_oidc_jwks requires non-empty issuer + jwksUrl — falling back to local-token terminal auth\n',
            );
          }
        }
      } catch { /* ignore parse errors */ }
    }

    if (terminalEnabled) {
      // Terminal ALWAYS mints its own token — independent of API auth (spec §1c.2).
      // LocalTokenAuthProvider uses constant-time SHA-256 compare (timingSafeEqual)
      // and DELIBERATELY ignores DECKENT_API_AUTH_DISABLED.
      terminalToken = randomUUID();
      // A4 (Sprint 269): label this clearly as the TERMINAL token — it was
      // previously logged as "API token", sending users to /api/* 403s.
      // SEC-03: fingerprint + runtime file path, never the raw value (see the
      // API-token branches above for the shared rationale).
      let terminalTokenPath: string | undefined;
      try {
        terminalTokenPath = writeRuntimeTokenFile(projectRoot, 'terminal-token', terminalToken, lang);
      } catch (err) {
        process.stderr.write(
          `${getMessage('serve.token.persist_failed', lang, {
            file: 'terminal-token',
            error: err instanceof Error ? err.message : String(err),
          })}\n`,
        );
      }
      process.stderr.write(
        `${getMessage('serve.token.terminal_minted', lang, {
          fingerprint: tokenFingerprint(terminalToken),
          path: terminalTokenPath ?? join(projectRoot, RUNTIME_DIR, 'terminal-token'),
        })}\n`,
      );
      terminalMgr = new PtySessionManager(terminalBackend, {
        scrollbackBytes: terminalScrollbackBytes,
        idleTimeoutMs: terminalIdleTimeoutMs,
        maxSessions: terminalMaxSessions,
        // Thread the server's bind host so the command guard (deny-list for
        // remote shell sessions, invariant I3) actually enforces when the server
        // is exposed beyond loopback. Omitting it defaulted host to 'localhost',
        // which exempted EVERY session — the guard never fired even on a remote bind.
        host,
      });
      // TERM-CONFIG-WIRE (357-009): per-tenant outbound byte quota (W4-10,
      // invariant I5) — previously always omitted from attachTerminalGateway,
      // so quota enforcement never ran in production. Unconditional per the
      // DEFAULT_OUTBOUND_DAILY_QUOTA_BYTES doc-comment SSOT in core/config.ts.
      terminalLimiter = new OutboundLimiter({ quotaBytes: terminalOutboundQuotaBytes });
      // Structured audit recorder. Tests pass a no-op sink; production wires
      // a real MemoryStore (.brain/memory.db) via MemoryStoreAuditSink so
      // lifecycle events are actually persisted (AUDIT-WIRE, ADR-G-029
      // invariant #3 clause-2). Raw PTY output is NEVER routed here (security
      // invariant) — TerminalAudit only ever serializes structured fields.
      mkdirSync(join(projectRoot, BRAIN_DIR), { recursive: true }); // ensure .brain/ exists
      terminalAuditStore = new MemoryStore(join(projectRoot, BRAIN_DIR, MEMORY_DB_FILE));
      const auditSink = new MemoryStoreAuditSink(terminalAuditStore);
      terminalAudit = terminalAuditIntegrityEnabled
        ? new TerminalAudit(auditSink, { secret: loadOrCreateAuditKey(projectRoot) })
        : new TerminalAudit(auditSink);
      // JWKS auth (opt-in): bearer = IdP-issued RS256 JWT verified via the
      // verifyAsync seam. The auto-generated local token above is still minted
      // and HTML-injected (return contract preserved) but is NOT honored by
      // JwksAuthProvider — its sync verify is always-deny by design.
      terminalAuth = terminalJwks
        ? new JwksAuthProvider(terminalJwks)
        : new LocalTokenAuthProvider(terminalToken);
    }
  }

  // ─── Localhost-only token injection into index.html (A1, Sprint 269) ─
  // Single inject path for EVERY served index.html — the root/index route in
  // the request handler below AND handleRequest's SPA fallback (deep-link
  // entry / browser refresh on /enterprise, /status, …) both call this.
  // Injects:
  //   - `window.__DECKENT_TERMINAL_TOKEN__` (existing terminal bootstrap)
  //   - `window.__DECKENT_API_TOKEN__` (Sprint 191 — dashboard reads it and
  //     attaches `Authorization: Bearer ...` on non-terminal fetches)
  // Injects ONLY when at least one token is set AND the caller is loopback.
  // Non-localhost callers fall through (return false) and receive the
  // unmodified HTML so the tokens never leak across the network.
  function serveIndexWithTokenInject(req: IncomingMessage, res: ServerResponse): boolean {
    if (!resolvedStaticDir) return false;
    if ((req.method ?? 'GET') !== 'GET') return false;
    if (!terminalToken && !finalToken) return false;
    if (!isLoopbackRemote(req.socket.remoteAddress ?? '')) return false;
    const indexPath = join(resolvedStaticDir, 'index.html');
    if (!existsSync(indexPath)) return false;
    try {
      let html = readFileSync(indexPath, 'utf-8');
      if (terminalToken) {
        const inject = `<script>window.__DECKENT_TERMINAL_TOKEN__ = ${JSON.stringify(terminalToken)};</script>`;
        html = html.replace('</head>', inject + '</head>');
      }
      if (finalToken) {
        html = injectApiTokenIntoHtml(html, finalToken);
      }
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(html);
      return true;
    } catch {
      return false; // unreadable index.html — caller falls through
    }
  }

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    (async () => {
      const rawUrl = req.url ?? '/';
      const urlPath = rawUrl.split('?')[0] ?? '/';
      const method = req.method ?? 'GET';

      // KABUL Gün-1 pürüz-2 — the ONE per-request CORS point: loopback
      // origins (+ packaged file://'s `Origin: null`) are reflected via
      // setHeader so EVERY response path (closure routes here AND
      // handleRequest/sendJson below) inherits a correct ACAO.
      applyLoopbackCors(req, res);

      // KABUL Gün-1 pürüz-5 — closure-served /api/terminal/* intercepts ALL
      // methods, so a browser CORS PREFLIGHT (OPTIONS carries NO bearer by
      // spec) was falling into the token-gated block and dying 401 — the
      // Engine Room could never even ASK for its token from the dev renderer.
      // Answer preflights here, before any auth gate: a 204 grants nothing
      // (the real GET/POST/DELETE still hits the gates below).
      if (method === 'OPTIONS' && urlPath.startsWith('/api/terminal/')) {
        res.writeHead(204, {
          'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        });
        res.end();
        return;
      }

      // ─── N3 (583) — Desktop terminal-token delivery ─
      // ADR-G-029 inv#2 SECOND delivery channel (amendment 2026-07-18): a
      // loopback-only GET returning the terminal token to a caller that
      // presents a VALID **API** bearer — verified here DIRECTLY with the
      // constant-time comparator, NEVER via authMiddleware, so the
      // DECKENT_API_AUTH_DISABLED bypass can never open a path to the shell
      // (inv#1 rationale — fail-CLOSED: no API token configured → always 401).
      // The Desktop renderer (which never loads the daemon's index.html, so
      // the inv#2 bootstrap-inject can't reach it) calls this and then
      // presents the token via Sec-WebSocket-Protocol exactly as before.
      // Must precede the terminal-token-gated block below — same /api/terminal/
      // prefix, different (API) bearer.
      if (method === 'GET' && urlPath === '/api/terminal/token') {
        if (!terminalMgr || !terminalAudit || terminalToken === undefined) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'terminal disabled' }));
          return;
        }
        if (!isLoopbackRemote(req.socket.remoteAddress ?? '')) {
          // Remote/enterprise clients use the OIDC/JWKS path (inv#5) — this
          // bootstrap channel is loopback-only by construction, like the
          // index.html inject it complements.
          terminalAudit.record({
            action: 'auth.deny',
            tenantId: 'local',
            detail: 'http GET /api/terminal/token (non-loopback)',
            at: new Date().toISOString(),
          });
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'terminal token bootstrap is loopback-only' }));
          return;
        }
        if (!finalToken || verifyBearerToken(req, finalToken) !== 'ok') {
          terminalAudit.record({
            action: 'auth.deny',
            tenantId: 'local',
            detail: 'http GET /api/terminal/token (api-bearer)',
            at: new Date().toISOString(),
          });
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Unauthorized' }));
          return;
        }
        terminalAudit.record({
          action: 'auth.ok',
          tenantId: 'local',
          detail: 'http GET /api/terminal/token',
          at: new Date().toISOString(),
        });
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({ token: terminalToken }));
        return;
      }

      // ─── Terminal routes (bypass-independent auth, spec §1c.2) ─
      if (terminalMgr && terminalAuth && terminalAudit && rawUrl.startsWith('/api/terminal/')) {
        const authHeader = req.headers['authorization'] ?? '';
        const tok = authHeader.replace(/^Bearer\s+/i, '');
        // Derive principal from request bearer (claims read from JWT; unverified before auth gate).
        const terminalPrincipal = deriveRequestPrincipal(req);
        // TENANT-001 T3: the terminal surface carries shell access, so a
        // tenant-less caller must not inherit `local` here either.
        const terminalTenantScope = resolveApiCallerTenant(terminalPrincipal, projectRoot);
        if (terminalTenantScope.tenant === null) {
          sendJson(res, { error: terminalTenantScope.reason }, 403);
          return;
        }
        const terminalTenantId: string = terminalTenantScope.tenant;
        // Async seam (Sprint 268): prefer verifyAsync when the provider defines
        // it (JWKS key resolution) — the handler is already async. Sync-only
        // providers (LocalToken) keep the exact previous code path.
        const terminalAuthorized = terminalAuth.verifyAsync
          ? await terminalAuth.verifyAsync(tok || undefined)
          : terminalAuth.verify(tok || undefined);
        if (!terminalAuthorized) {
          terminalAudit.record({
            action: 'auth.deny',
            tenantId: terminalTenantId,
            detail: `http ${method} ${urlPath}`,
            at: new Date().toISOString(),
          });
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Unauthorized' }));
          return;
        }
        // POST /api/terminal/sessions
        if (method === 'POST' && urlPath === '/api/terminal/sessions') {
          let body: unknown;
          try { body = await parseBody(req); } catch { body = {}; }
          const input = body as { kind?: string; tool?: string; args?: string[] };
          const kind = input.kind ?? 'shell';
          // TERM-CONFIG-WIRE (357-009): config.terminal.allowShellKind gate —
          // previously schema-only (never consulted), so a plain `shell`
          // session could always be created regardless of config.
          if (kind === 'shell' && !terminalAllowShellKind) {
            res.writeHead(403, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'shell session kind disabled by config' }));
            return;
          }
          // AI-SESSION-TOOL-ALLOWLIST (born-565): reject an unlisted
          // client-supplied `tool` BEFORE terminalMgr.create() ever runs, so
          // an arbitrary string can never reach backend.spawn(). Omitted
          // `tool` stays allowed — session-manager defaults it to 'claude'.
          if (kind === 'ai' && input.tool !== undefined && !AI_SESSION_TOOL_ALLOWLIST.has(input.tool)) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'ai session tool not allowed' }));
            return;
          }
          try {
            const sess = terminalMgr.create({
              kind: kind as SessionKind,
              tool: input.tool as CreateSessionInput['tool'],
              args: input.args,
              tenantId: terminalTenantId as TenantId,
            });
            terminalAudit.record({
              action: 'session.create',
              tenantId: terminalTenantId,
              sessionId: sess.id,
              detail: `kind=${sess.kind}`,
              at: new Date().toISOString(),
            });
            res.writeHead(201, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(sess));
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : 'create failed';
            res.writeHead(409, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: msg }));
          }
          return;
        }
        // GET /api/terminal/sessions
        if (method === 'GET' && urlPath === '/api/terminal/sessions') {
          const list = terminalMgr.list();
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(list));
          return;
        }
        // DELETE /api/terminal/sessions/:id
        if (method === 'DELETE' && urlPath.startsWith('/api/terminal/sessions/')) {
          const id = urlPath.slice('/api/terminal/sessions/'.length);
          terminalMgr.kill(id);
          terminalAudit.record({
            action: 'session.kill',
            tenantId: terminalTenantId,
            sessionId: id,
            detail: 'http delete',
            at: new Date().toISOString(),
          });
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));
          return;
        }
        // Unknown terminal route
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not found' }));
        return;
      }

      // ─── Localhost-only token injection into index.html (A1) ─
      // Root/index path — same helper as handleRequest's SPA fallback, so a
      // deep-link refresh and the root entry serve byte-identical HTML.
      if (method === 'GET' && (urlPath === '/' || urlPath === '/index.html')) {
        if (serveIndexWithTokenInject(req, res)) return;
      }

      await handleRequest(
        req,
        res,
        projectRoot,
        dashPath,
        sseClients,
        resolvedStaticDir,
        initWatcher,
        finalToken,
        rateLimiter,
        authMiddleware,
        outputCollector ?? undefined,
        serveIndexWithTokenInject,
        serveChatAdapter,
        terminalMgr,
        approvalAuthority,
        approvalStore,
        providerAuthority,
        resolvedApprovalLifecycle,
        readStrictTenantIsolation(projectRoot),
        lang,
      );
    })().catch((err: unknown) => {
      sendError(res, 500, err instanceof Error ? err.message : 'Internal server error');
    });
  });

  // Attach WS gateway for live terminal sessions (spec §1c.2 — auth verified
  // BEFORE bridge, independent of DECKENT_API_AUTH_DISABLED).
  if (terminalMgr && terminalAuth && terminalAudit) {
    attachTerminalGateway(server, {
      manager: terminalMgr,
      auth: terminalAuth,
      audit: terminalAudit,
      limiter: terminalLimiter,
      // TENANT-001 T4a: the upgrade listener bypasses the HTTP request handler,
      // so the tenant decision has to be carried in here explicitly — otherwise
      // the WS shell stays open to callers the HTTP routes already refuse.
      strictTenantIsolation: readStrictTenantIsolation(projectRoot),
    });
    // Idle reaper — sweeps stale non-deckent sessions every 30s.
    // unref() so the timer does not keep the event loop alive in tests.
    terminalReaper = setInterval(() => {
      terminalMgr?.reapIdle();
    }, 30_000);
    terminalReaper.unref?.();
  }

  server.listen(listenPort, host);

  return {
    server,
    terminalToken,
    apiToken: finalToken ?? undefined,
    terminalManager: terminalMgr,
    approvalExpiryDriver,
    approvalBroker,
    close(): Promise<void> {
      watcher?.close();
      liveBridge?.close();
      if (terminalReaper) {
        clearInterval(terminalReaper);
        terminalReaper = undefined;
      }
      terminalMgr?.reapIdle();
      terminalAuditStore?.close();
      approvalExpiryDriver?.stop();
      for (const client of sseClients) {
        client.end();
      }
      sseClients.clear();
      outputCollector?.dispose();
      return (async () => {
        await approvalExpiryDriver?.settleInFlight();
        await acceptanceReconciliationInFlight;
        approvalRelay?.dispose();
        await new Promise<void>((resolve) => {
          server.close(() => resolve());
        });
      })();
    },
  };
}
