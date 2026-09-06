// ─── Memory Search API Endpoint ──────────────────────────────────────────────
// GET /api/memory/search?q=<text> — FTS5 full-text search over memory.db
//
// Tenant scope. The caller's tenant is derived from the verified request
// principal (deriveRequestPrincipal — the same source ws-gateway/audit use) and
// narrows the FTS5 search via MemoryQueryParams.tenantId.
//
// TENANT-001 T4b (measured 2026-08-08): this was the WIDEST tenant leak in the
// product. Two layers were broken: (1) server.ts called this without `req`, so
// the principal was never derived and even a tenant-claimed caller saw ALL
// tenants; (2) a tenant-less caller omitted the predicate entirely and read
// across every tenant's memory. The fix is the same pattern the other T-series
// ingresses use — resolveApiCallerTenant: under strict isolation a tenant-less
// caller is refused (403), a tenant-claimed caller is scoped to its own tenant;
// with strict off the v1 tenant-less path stays byte-identical (operator parity).
import type { IncomingMessage, ServerResponse } from 'node:http';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { MemoryStore } from '../core/memory-store.js';
import { readMemoryDetail, readMemoryView, renderMemoryReadView } from '../core/memory-read-service.js';
import { resolveMemoryReadConfig } from '../core/config.js';
import { buildMemoryReadLabels } from '../core/memory-read-labels.js';
import { attendedExecutionProjectId } from '../core/attended-execution-approval.js';
import { BRAIN_DIR, MEMORY_DB_FILE } from '../core/constants.js';
import { deriveRequestPrincipal } from './auth-me-endpoint.js';
import { resolveApiCallerTenant } from './tenant-scope.js';
import { getMessage } from '../cli/helpers/messages.js';

function sendJson(res: ServerResponse, data: unknown, status = 200): void {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(body);
}

/**
 * Handle GET /api/memory/search?q=<query> — FTS5 memory search.
 * Returns true if the route was handled, false to let the caller try next route.
 *
 * `req` MUST be threaded from server.ts for tenant scope to derive from the verified
 * bearer (anti-IDOR, mirrors kpi-endpoint.ts / missions-route.ts). Omitted (the
 * default) → no tenant narrowing, the pre-609 tenant-less behavior.
 */
function parseList(value: string | null): string[] | undefined {
  if (value === null) return undefined;
  const values = value.split(',').map((item) => item.trim()).filter(Boolean);
  return values.length > 0 ? values : undefined;
}

function parseNonNegativeInteger(value: string | null): number | null | undefined {
  if (value === null) return undefined;
  if (!/^(?:0|[1-9]\d*)$/u.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function parsePositiveInteger(value: string | null): number | null | undefined {
  const parsed = parseNonNegativeInteger(value);
  return parsed === 0 ? null : parsed;
}

function hold(
  scope: { readonly kind: 'tenant'; readonly tenantId: string; readonly projectId: string } | { readonly kind: 'local-project'; readonly projectId: string },
  reasonCode: 'QUERY_FAILED' | 'INVALID_REQUEST',
) {
  return { state: 'HOLD' as const, consumer: 'api' as const, scope, reasonCode, requiredIds: [] as const };
}

/**
 * API memory ingress. Legacy `/search` stays an explicit array-only
 * compatibility route; all v1 reads use the bounded scoped core reader.
 */
export function registerMemorySearch(
  url: string,
  res: ServerResponse,
  projectRoot: string,
  req?: IncomingMessage,
): boolean {
  const parsed = new URL(url, 'http://localhost');
  const isSearch = parsed.pathname === '/api/memory/search';
  const isMemory = parsed.pathname === '/api/memory';
  const isDetail = parsed.pathname === '/api/memory/detail';
  if (!isSearch && !isMemory && !isDetail) return false;

  // T4b: resolve the caller's effective tenant through the shared decision.
  // A null tenant means strict mode refused a tenant-less caller — answer 403
  // rather than folding into an all-tenant read.
  const principal = req ? deriveRequestPrincipal(req) : { id: 'local' };
  const callerTenant = resolveApiCallerTenant(principal, projectRoot);
  if (callerTenant.tenant === null) {
    sendJson(res, { error: callerTenant.reason }, 403);
    return true;
  }
  const scope = principal.tenantId !== undefined
    ? { kind: 'tenant' as const, tenantId: callerTenant.tenant, projectId: attendedExecutionProjectId(projectRoot) }
    : { kind: 'local-project' as const, projectId: attendedExecutionProjectId(projectRoot) };
  const dbPath = join(projectRoot, BRAIN_DIR, MEMORY_DB_FILE);

  // Keep the old array shape only for callers that do not opt into v1.
  if (isSearch && parsed.searchParams.get('v') !== '1') {
    const q = parsed.searchParams.get('q') ?? '';
    if (!q.trim() || !existsSync(dbPath)) {
      sendJson(res, []);
      return true;
    }
    try {
      const legacyConfig = resolveMemoryReadConfig(projectRoot, 'api');
      const store = new MemoryStore(dbPath, { readOnly: true });
      try {
      const legacyView = readMemoryView(store, {
        consumer: 'api',
        scope,
        query: { text: q },
        limits: legacyConfig.memory_read,
      });
      // Compatibility retains the historical array shape, while the source of
      // truth is now the same readonly bounded selection used by v1.
      if (legacyView.state === 'HOLD') {
        sendJson(res, { error: legacyView.reasonCode, view: legacyView }, 409);
      } else {
        sendJson(res, legacyView.state === 'AVAILABLE'
          ? legacyView.entries.map(({ entry, relevance }) => ({ entry, relevance }))
          : []);
      }
      } finally {
        store.close();
      }
    } catch {
      sendJson(res, { error: 'QUERY_FAILED' }, 503);
    }
    return true;
  }

  let config: ReturnType<typeof resolveMemoryReadConfig>;
  try {
    config = resolveMemoryReadConfig(projectRoot, 'api');
  } catch {
    const view = hold(scope, 'QUERY_FAILED');
    sendJson(res, isDetail
      ? { schemaVersion: 1, detail: view }
      : isMemory
      ? { content: getMessage('memory_read.hold', 'en', { reason: view.reasonCode }), schemaVersion: 1, view }
      : { schemaVersion: 1, view });
    return true;
  }
  const labels = buildMemoryReadLabels(getMessage, config.language === 'tr' ? 'tr' : 'en');
  if (!existsSync(dbPath)) {
    const view = hold(scope, 'QUERY_FAILED');
    sendJson(res, isDetail
      ? { schemaVersion: 1, detail: view }
      : isMemory
      ? { content: getMessage('memory_read.hold', config.language, { reason: view.reasonCode }), schemaVersion: 1, view }
      : { schemaVersion: 1, view });
    return true;
  }

  let store: MemoryStore | undefined;
  try {
    store = new MemoryStore(dbPath, { readOnly: true });
    if (isDetail) {
      const detailRef = parsed.searchParams.get('ref');
      sendJson(res, {
        schemaVersion: 1,
        detail: detailRef
          ? readMemoryDetail(store, { consumer: 'api', scope, detailRef })
          : hold(scope, 'INVALID_REQUEST'),
      });
      return true;
    }
    const q = parsed.searchParams.get('q') ?? '';
    const type = isMemory ? ['memory'] : parseList(parsed.searchParams.get('type'));
    const status = parseList(parsed.searchParams.get('status'));
    const sprintMin = parseNonNegativeInteger(parsed.searchParams.get('sprint_min'));
    const requestedLimit = parsePositiveInteger(parsed.searchParams.get('limit'));
    const mode = parsed.searchParams.get('mode');
    if (sprintMin === null || requestedLimit === null || (mode !== null && mode !== 'and' && mode !== 'or')) {
      sendJson(res, { schemaVersion: 1, view: hold(scope, 'INVALID_REQUEST') });
      return true;
    }
    const query = isMemory || q.trim().length > 0 || type !== undefined || status !== undefined || sprintMin !== null
      ? {
          ...(q.trim().length > 0 ? { text: q } : {}),
          ...(type !== undefined ? { type } : {}),
          ...(status !== undefined ? { status } : {}),
          ...(sprintMin !== undefined ? { sprint_range: { min: sprintMin } } : {}),
          mode: mode === 'and' ? 'and' as const : 'or' as const,
        }
      : null;
    if (query === null) {
      sendJson(res, { schemaVersion: 1, view: hold(scope, 'INVALID_REQUEST') });
      return true;
    }
    const limits = requestedLimit !== undefined
      ? { ...config.memory_read, maxEntries: Math.min(config.memory_read.maxEntries, requestedLimit) }
      : config.memory_read;
    const view = readMemoryView(store, {
      consumer: 'api', scope, query, limits,
      ...(parsed.searchParams.get('cursor') !== null ? { cursor: parsed.searchParams.get('cursor')! } : {}),
    });
    if (isMemory) {
      const content = view.state === 'AVAILABLE'
        ? renderMemoryReadView(view, labels)
        : view.state === 'ABSENT'
          ? getMessage('memory_read.absent', config.language)
          : getMessage('memory_read.hold', config.language, { reason: view.reasonCode });
      sendJson(res, { content, schemaVersion: 1, view });
    } else {
      sendJson(res, { schemaVersion: 1, view });
    }
  } catch {
    const view = hold(scope, 'QUERY_FAILED');
    sendJson(res, isDetail ? { schemaVersion: 1, detail: view } : isMemory
      ? { content: getMessage('memory_read.hold', config.language, { reason: view.reasonCode }), schemaVersion: 1, view }
      : { schemaVersion: 1, view });
  } finally {
    store?.close();
  }
  return true;
}
