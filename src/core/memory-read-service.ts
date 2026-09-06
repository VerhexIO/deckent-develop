import { createHash } from 'node:crypto';
import { canonicalJson } from './audit-writer.js';
import {
  MemoryQueryError,
  queryMemoryCandidates,
  readMemoryCandidateById,
  readMemoryEntryById,
  resolveMemoryAdrReferenceIds,
  type MemoryQueryCandidateRow,
  type MemoryQueryCandidateCursorKey,
  type MemoryQueryTenantSelection,
} from './memory-query.js';
import type { MemoryStore } from './memory-store.js';
import type { MemoryQueryParams } from './memory-types.js';
import {
  MEMORY_READ_CONSUMERS,
  resolveMemoryReadLimits,
  type MemoryReadAvailableV1,
  type MemoryReadAbsentV1,
  type MemoryReadCandidateV1,
  type MemoryReadConsumerV1,
  type MemoryReadDeferredV1,
  type MemoryReadDetailInputV1,
  type MemoryReadDetailV1,
  type MemoryReadEntryV1,
  type MemoryReadHoldReasonV1,
  type MemoryReadHoldV1,
  type MemoryReadLabelsV1,
  type MemoryReadLimitsV1,
  type MemoryReadPreferredLatestTypeV1,
  type MemoryReadScopeV1,
  type MemoryReadSelectionReasonV1,
  type MemoryReadViewInputV1,
  type MemoryReadViewV1,
  type MemoryRequiredIdResolutionInputV1,
  type MemoryRequiredIdResolutionV1,
  type MemoryPreferredIdResolutionInputV1,
  type MemoryPreferredIdResolutionV1,
} from './memory-read-contract.js';

const SHA256 = /^sha256:[a-f0-9]{64}$/u;
const CURSOR_PREFIX = 'memory-read-cursor-v1.';
const DETAIL_PREFIX = 'memory-read-detail-v1.';
const RENDER_BYTE_RESERVE = 1_024;
const RENDER_LINE_RESERVE = 2;
const RENDER_ENTRY_OVERHEAD = 256;
const RENDER_DEFERRED_OVERHEAD = 64;
const DISCOVERY_QUERY_TERM_LIMIT = 64;
const QUERY_KEYS = new Set([
  'text', 'type', 'source', 'status', 'priority', 'adr_class', 'adr_scope',
  'sprint_range', 'tags_contain', 'include_deleted', 'decay_exempt', 'min_score', 'mode',
]);

type CanonicalRecord = Readonly<Record<string, unknown>>;

/**
 * Convert untrusted planner/worker prose into a bounded literal-only FTS
 * discovery query. Explicit ADR references are resolved through the separate
 * required-ID authority path and therefore never depend on this lossy hint.
 * Lower-casing is deliberate: memory-query's legacy FTS bridge preserves
 * uppercase AND/OR/NOT as operators.
 */
export function buildMemoryDiscoveryQuery(input: string): string {
  const ranked = new Map<string, { count: number; first: number }>();
  let ordinal = 0;
  for (const match of input.normalize('NFKC').toLocaleLowerCase('en-US')
    .matchAll(/[\p{L}\p{N}_./-]+/gu)) {
    const term = match[0];
    if (term.length < 2 || term.length > 128) continue;
    const current = ranked.get(term);
    if (current) current.count += 1;
    else ranked.set(term, { count: 1, first: ordinal });
    ordinal += 1;
  }
  return [...ranked.entries()]
    .sort((left, right) => right[1].count - left[1].count || left[1].first - right[1].first)
    .slice(0, DISCOVERY_QUERY_TERM_LIMIT)
    .map(([term]) => term)
    .join(' ');
}

interface CursorPayloadV1 {
  readonly schemaVersion: 1;
  readonly consumer: MemoryReadConsumerV1;
  readonly scopeDigest: string;
  readonly queryDigest: string;
  readonly limitsDigest: string;
  readonly selectionRevisionDigest: string;
  readonly anchorCandidateDigest: string;
  readonly afterRank: number;
  readonly afterOrdinal: number;
  readonly afterId: string;
}

interface DetailRefPayloadV1 {
  readonly schemaVersion: 1;
  readonly consumer: MemoryReadConsumerV1;
  readonly scopeDigest: string;
  readonly queryDigest: string;
  readonly selectionRevisionDigest: string;
  readonly id: string;
  readonly candidateDigest: string;
}

function digest(value: unknown): string {
  return `sha256:${createHash('sha256').update(canonicalJson(value)).digest('hex')}`;
}

function encodeOpaque(prefix: string, payload: CanonicalRecord): string {
  const body = canonicalJson(payload);
  const envelope = canonicalJson({ payload, digest: digest(payload) });
  if (body.length === 0) throw new TypeError('MEMORY_READ_REFERENCE_INVALID');
  return `${prefix}${Buffer.from(envelope, 'utf8').toString('base64url')}`;
}

function decodeOpaque(prefix: string, value: unknown): CanonicalRecord | null {
  if (typeof value !== 'string' || !value.startsWith(prefix)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value.slice(prefix.length), 'base64url').toString('utf8')) as unknown;
    if (parsed === null || Array.isArray(parsed) || typeof parsed !== 'object') return null;
    const row = parsed as Record<string, unknown>;
    if (Object.keys(row).sort().join(',') !== 'digest,payload'
      || typeof row['digest'] !== 'string'
      || row['payload'] === null || Array.isArray(row['payload']) || typeof row['payload'] !== 'object'
      || row['digest'] !== digest(row['payload'])) return null;
    return row['payload'] as CanonicalRecord;
  } catch {
    return null;
  }
}

function cleanCanonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(cleanCanonical);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .map(([key, entry]) => [key, cleanCanonical(entry)]));
  }
  return value;
}

function isNonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function parseConsumer(value: unknown): MemoryReadConsumerV1 | null {
  return typeof value === 'string' && (MEMORY_READ_CONSUMERS as readonly string[]).includes(value)
    ? value as MemoryReadConsumerV1
    : null;
}

function parseScope(value: unknown): MemoryReadScopeV1 | null {
  if (value === null || Array.isArray(value) || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  if (row['kind'] === 'tenant'
    && Object.keys(row).sort().join(',') === 'kind,projectId,tenantId'
    && isNonEmpty(row['tenantId']) && isNonEmpty(row['projectId'])) {
    return Object.freeze({ kind: 'tenant', tenantId: row['tenantId'], projectId: row['projectId'] });
  }
  if (row['kind'] === 'local-project'
    && Object.keys(row).sort().join(',') === 'kind,projectId'
    && isNonEmpty(row['projectId'])) {
    return Object.freeze({ kind: 'local-project', projectId: row['projectId'] });
  }
  return null;
}

function validStringArray(value: unknown): boolean {
  return Array.isArray(value) && value.every(isNonEmpty);
}

function hasOnlyKeys(value: object, allowed: readonly string[]): boolean {
  const keys = new Set(allowed);
  return Object.keys(value).every((key) => keys.has(key));
}

function parseQuery(value: unknown): Readonly<Omit<MemoryQueryParams, 'tenantId' | 'limit'>> | null {
  if (value === null || Array.isArray(value) || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  if (Object.keys(row).some((key) => !QUERY_KEYS.has(key))) return null;
  for (const key of ['type', 'source', 'status', 'priority', 'adr_class', 'adr_scope', 'tags_contain']) {
    if (row[key] !== undefined && !validStringArray(row[key])) return null;
  }
  if (row['text'] !== undefined && typeof row['text'] !== 'string') return null;
  if (row['mode'] !== undefined && row['mode'] !== 'and' && row['mode'] !== 'or') return null;
  if (row['include_deleted'] !== undefined && row['include_deleted'] !== false) return null;
  if (row['decay_exempt'] !== undefined && typeof row['decay_exempt'] !== 'boolean') return null;
  if (row['min_score'] !== undefined
    && (typeof row['min_score'] !== 'number' || !Number.isFinite(row['min_score']) || row['min_score'] < 0)) return null;
  if (row['sprint_range'] !== undefined) {
    const range = row['sprint_range'];
    if (range === null || Array.isArray(range) || typeof range !== 'object') return null;
    const values = range as Record<string, unknown>;
    if (Object.keys(values).some((key) => key !== 'min' && key !== 'max')) return null;
    if (Object.values(values).some((entry) => !Number.isSafeInteger(entry) || (entry as number) < 0)) return null;
  }
  return Object.freeze(cleanCanonical(row) as Omit<MemoryQueryParams, 'tenantId' | 'limit'>);
}

function tenantSelection(scope: MemoryReadScopeV1): MemoryQueryTenantSelection {
  return scope.kind === 'tenant'
    ? Object.freeze({ kind: 'tenant', tenantId: scope.tenantId })
    : Object.freeze({ kind: 'all' });
}

function hold(
  reasonCode: MemoryReadHoldReasonV1,
  consumer: MemoryReadConsumerV1 | null,
  scope: MemoryReadScopeV1 | null,
  requiredIds: readonly string[] = [],
): MemoryReadHoldV1 {
  return Object.freeze({ state: 'HOLD', consumer, scope, reasonCode, requiredIds: Object.freeze([...requiredIds]) });
}

function candidateDigest(row: MemoryQueryCandidateRow): string {
  const { relevance: _relevance, snippet: _snippet, orderRank: _orderRank, orderOrdinal: _orderOrdinal, ...identity } = row;
  return digest(identity);
}

function queryCandidateDigest(row: MemoryQueryCandidateRow): string {
  return digest(row);
}

function publicCandidate(row: MemoryQueryCandidateRow): MemoryReadCandidateV1 {
  const { orderRank: _orderRank, orderOrdinal: _orderOrdinal, entryRevision: _entryRevision, ...candidate } = row;
  return Object.freeze({ ...candidate, candidateDigest: candidateDigest(row) });
}

function contentDigest(content: string): string {
  return `sha256:${createHash('sha256').update(content, 'utf8').digest('hex')}`;
}

function exactKeys(row: CanonicalRecord, expected: readonly string[]): boolean {
  return Object.keys(row).sort().join(',') === [...expected].sort().join(',');
}

function parseCursor(value: unknown): CursorPayloadV1 | null {
  const row = decodeOpaque(CURSOR_PREFIX, value);
  if (!row || !exactKeys(row, [
    'schemaVersion', 'consumer', 'scopeDigest', 'queryDigest', 'limitsDigest',
    'selectionRevisionDigest', 'anchorCandidateDigest', 'afterRank', 'afterOrdinal', 'afterId',
  ])) return null;
  const consumer = parseConsumer(row['consumer']);
  if (row['schemaVersion'] !== 1 || consumer === null
    || typeof row['scopeDigest'] !== 'string' || !SHA256.test(row['scopeDigest'])
    || typeof row['queryDigest'] !== 'string' || !SHA256.test(row['queryDigest'])
    || typeof row['limitsDigest'] !== 'string' || !SHA256.test(row['limitsDigest'])
    || typeof row['selectionRevisionDigest'] !== 'string' || !SHA256.test(row['selectionRevisionDigest'])
    || typeof row['anchorCandidateDigest'] !== 'string' || !SHA256.test(row['anchorCandidateDigest'])
    || typeof row['afterRank'] !== 'number' || !Number.isFinite(row['afterRank'])
    || !Number.isSafeInteger(row['afterOrdinal']) || !isNonEmpty(row['afterId'])) return null;
  return row as unknown as CursorPayloadV1;
}

function parseDetailRef(value: unknown): DetailRefPayloadV1 | null {
  const row = decodeOpaque(DETAIL_PREFIX, value);
  if (!row || !exactKeys(row, [
    'schemaVersion', 'consumer', 'scopeDigest', 'queryDigest', 'selectionRevisionDigest', 'id', 'candidateDigest',
  ])) return null;
  const consumer = parseConsumer(row['consumer']);
  if (row['schemaVersion'] !== 1 || consumer === null || !isNonEmpty(row['id'])
    || typeof row['scopeDigest'] !== 'string' || !SHA256.test(row['scopeDigest'])
    || typeof row['queryDigest'] !== 'string' || !SHA256.test(row['queryDigest'])
    || typeof row['selectionRevisionDigest'] !== 'string' || !SHA256.test(row['selectionRevisionDigest'])
    || typeof row['candidateDigest'] !== 'string' || !SHA256.test(row['candidateDigest'])) return null;
  return row as unknown as DetailRefPayloadV1;
}

function criticalCandidates(
  store: MemoryStore,
  selection: MemoryQueryTenantSelection,
  limit: number,
): MemoryQueryCandidateRow[] {
  const unresolved = queryMemoryCandidates(store, {
    priority: ['critical'],
    status: ['active', 'proposed'],
  }, selection, { limit });
  const byId = new Map<string, MemoryQueryCandidateRow>();
  for (const candidate of unresolved) byId.set(candidate.id, candidate);
  return [...byId.values()];
}

interface CollectedSelection {
  queryPage: MemoryQueryCandidateRow[];
  candidates: MemoryQueryCandidateRow[];
  reasons: Map<string, Set<MemoryReadSelectionReasonV1>>;
  revision: string;
  hasNext: boolean;
}

function collectSelection(
  store: MemoryStore,
  query: Readonly<Omit<MemoryQueryParams, 'tenantId' | 'limit'>>,
  selection: MemoryQueryTenantSelection,
  limits: Readonly<MemoryReadLimitsV1>,
  requiredIds: readonly string[],
  preferredLatestTypes: readonly MemoryReadPreferredLatestTypeV1[],
  includeCritical: boolean,
  after: MemoryQueryCandidateCursorKey | undefined,
  revisionMaterial: CanonicalRecord,
): CollectedSelection | MemoryReadHoldReasonV1 {
  const reasons = new Map<string, Set<MemoryReadSelectionReasonV1>>();
  const mandatory = new Map<string, MemoryQueryCandidateRow>();
  for (const id of requiredIds) {
    const candidate = readMemoryCandidateById(store, id, selection);
    if (!candidate) return 'REQUIRED_ENTRY_MISSING';
    mandatory.set(id, candidate);
    reasons.set(id, new Set(['REQUIRED']));
  }
  for (const type of preferredLatestTypes) {
    const candidate = queryMemoryCandidates(store, { type: [type] }, selection, { limit: 1 })[0];
    if (!candidate) continue;
    mandatory.set(candidate.id, candidate);
    const rowReasons = reasons.get(candidate.id) ?? new Set<MemoryReadSelectionReasonV1>();
    rowReasons.add('PREFERRED_LATEST');
    reasons.set(candidate.id, rowReasons);
  }
  if (includeCritical) {
    const critical = criticalCandidates(store, selection, limits.maxCandidates + 1);
    if (critical.length > limits.maxCandidates) return 'CRITICAL_CONTEXT_UNAVAILABLE';
    for (const candidate of critical) {
      mandatory.set(candidate.id, candidate);
      const rowReasons = reasons.get(candidate.id) ?? new Set<MemoryReadSelectionReasonV1>();
      rowReasons.add('CRITICAL');
      reasons.set(candidate.id, rowReasons);
    }
  }
  if (mandatory.size > limits.maxCandidates) {
    return [...reasons.values()].some((rowReasons) => rowReasons.has('REQUIRED') || rowReasons.has('PREFERRED_LATEST'))
      ? 'REQUIRED_ENTRY_OVERSIZE'
      : 'CRITICAL_CONTEXT_UNAVAILABLE';
  }
  const pageLimit = limits.maxCandidates - mandatory.size;
  if (pageLimit === 0) {
    const probe = queryMemoryCandidates(store, query, selection, {
      limit: limits.maxCandidates + 1,
      ...(after === undefined ? {} : { after }),
    });
    if (probe.some((candidate) => !mandatory.has(candidate.id))) return 'CANDIDATE_LIMIT_EXHAUSTED';
  }
  const queryPage = pageLimit > 0
    ? queryMemoryCandidates(store, query, selection, {
        limit: pageLimit,
        ...(after === undefined ? {} : { after }),
      })
    : [];
  for (const candidate of queryPage) {
    const rowReasons = reasons.get(candidate.id) ?? new Set<MemoryReadSelectionReasonV1>();
    rowReasons.add('QUERY_MATCH');
    reasons.set(candidate.id, rowReasons);
  }
  const candidates = [...mandatory.values()];
  for (const candidate of queryPage) {
    if (!mandatory.has(candidate.id)) candidates.push(candidate);
  }
  const revision = digest({
    ...revisionMaterial,
    after: after ?? null,
    candidates: candidates.map((candidate) => ({ digest: queryCandidateDigest(candidate), reasons: [...(reasons.get(candidate.id) ?? [])].sort() })),
  });
  return { queryPage, candidates, reasons, revision, hasNext: pageLimit > 0 && queryPage.length === pageLimit };
}

export function readMemoryView(store: MemoryStore, input: MemoryReadViewInputV1): MemoryReadViewV1 {
  const consumer = parseConsumer((input as { consumer?: unknown } | null)?.consumer);
  const scope = parseScope((input as { scope?: unknown } | null)?.scope);
  const query = parseQuery((input as { query?: unknown } | null)?.query);
  if (consumer === null || scope === null || query === null || input === null || typeof input !== 'object'
    || !hasOnlyKeys(input, ['consumer', 'scope', 'query', 'limits', 'requiredIds', 'preferredLatestTypes', 'includeCritical', 'cursor'])) {
    return hold('INVALID_REQUEST', consumer, scope);
  }
  let limits: Readonly<MemoryReadLimitsV1>;
  try {
    limits = resolveMemoryReadLimits(input.limits === undefined ? {} : input.limits);
  } catch {
    return hold('INVALID_LIMITS', consumer, scope);
  }
  if (input.includeCritical !== undefined && typeof input.includeCritical !== 'boolean') {
    return hold('INVALID_REQUEST', consumer, scope);
  }
  if (input.requiredIds !== undefined && !validStringArray(input.requiredIds)) {
    return hold('INVALID_REQUEST', consumer, scope);
  }
  if (input.preferredLatestTypes !== undefined
    && (!Array.isArray(input.preferredLatestTypes)
      || input.preferredLatestTypes.some((type) => type !== 'retro' && type !== 'identity'))) {
    return hold('INVALID_REQUEST', consumer, scope);
  }
  const requiredIds = Object.freeze([...(input.requiredIds ?? [])]);
  const preferredLatestTypes = Object.freeze([...(input.preferredLatestTypes ?? [])]);
  if (new Set(requiredIds).size !== requiredIds.length) return hold('INVALID_REQUEST', consumer, scope, requiredIds);
  if (new Set(preferredLatestTypes).size !== preferredLatestTypes.length) {
    return hold('INVALID_REQUEST', consumer, scope, requiredIds);
  }
  if (requiredIds.length > limits.maxEntries || requiredIds.length > limits.maxCandidates) {
    return hold('REQUIRED_ENTRY_OVERSIZE', consumer, scope, requiredIds);
  }
  const selection = tenantSelection(scope);
  const scopeDigest = digest(scope);
  const queryDigest = digest({ consumer, query, preferredLatestTypes });
  const limitsDigest = digest(limits);
  const revisionMaterial = Object.freeze({ consumer, scopeDigest, queryDigest, limitsDigest });
  const cursor = input.cursor === undefined ? null : parseCursor(input.cursor);
  if (input.cursor !== undefined && cursor === null) return hold('CURSOR_INVALID', consumer, scope, requiredIds);
  if (cursor && (cursor.consumer !== consumer || cursor.scopeDigest !== scopeDigest
    || cursor.queryDigest !== queryDigest || cursor.limitsDigest !== limitsDigest)) {
    return hold('CURSOR_INVALID', consumer, scope, requiredIds);
  }
  const after: MemoryQueryCandidateCursorKey | undefined = cursor === null ? undefined : {
    rank: cursor.afterRank,
    ordinal: cursor.afterOrdinal,
    id: cursor.afterId,
  };

  try {
    return store.readSnapshot(() => {
      if (cursor) {
        const anchor = queryMemoryCandidates(store, query, selection, {
          limit: 1,
          exactId: cursor.afterId,
        })[0];
        if (!anchor || anchor.orderRank !== cursor.afterRank || anchor.orderOrdinal !== cursor.afterOrdinal
          || queryCandidateDigest(anchor) !== cursor.anchorCandidateDigest) {
          return hold('CURSOR_STALE', consumer, scope, requiredIds);
        }
      }
      const collected = collectSelection(store, query, selection, limits, requiredIds, preferredLatestTypes,
        input.includeCritical === true, after, revisionMaterial);
      if (typeof collected === 'string') return hold(collected, consumer, scope, requiredIds);
      const revision = {
        selectionRevisionDigest: collected.revision,
        queryDigest,
        scopeDigest,
        limitsDigest,
      } as const;
      if (collected.candidates.length === 0) {
        const absent: MemoryReadAbsentV1 = Object.freeze({
          state: 'ABSENT', consumer, scope, ...revision,
          candidates: Object.freeze([]) as readonly [],
          entries: Object.freeze([]) as readonly [],
          deferred: Object.freeze([]) as readonly [],
          nextCursor: null,
        });
        return absent;
      }

      const entries: MemoryReadEntryV1[] = [];
      const deferred: MemoryReadDeferredV1[] = [];
      const presentedCandidates: MemoryQueryCandidateRow[] = [];
      let usedBytes = 0;
      let usedLines = 0;
      let stoppedCandidate: MemoryQueryCandidateRow | null = null;
      const renderByteBudget = Math.max(0, limits.maxBytes - RENDER_BYTE_RESERVE);
      const renderLineBudget = Math.max(0, limits.maxLines - RENDER_LINE_RESERVE);
      for (const rawCandidate of collected.candidates) {
        const candidate = publicCandidate(rawCandidate);
        const reasons = Object.freeze([...(collected.reasons.get(rawCandidate.id) ?? [])].sort()) as readonly MemoryReadSelectionReasonV1[];
        const mandatory = reasons.includes('REQUIRED')
          || reasons.includes('PREFERRED_LATEST')
          || reasons.includes('CRITICAL');
        let reasonCode: MemoryReadDeferredV1['reasonCode'] | null = null;
        if (entries.length >= limits.maxEntries) reasonCode = 'ENTRY_LIMIT';
        else if (usedBytes + rawCandidate.recordByteLengthFloor + RENDER_ENTRY_OVERHEAD > renderByteBudget) reasonCode = 'BYTE_LIMIT';
        else if (usedLines + rawCandidate.contentLineCount + 7 > renderLineBudget) reasonCode = 'LINE_LIMIT';
        if (reasonCode !== null) {
          if (mandatory) {
            return hold(reasons.includes('CRITICAL') && !reasons.includes('REQUIRED') && !reasons.includes('PREFERRED_LATEST')
              ? 'CRITICAL_CONTEXT_UNAVAILABLE'
              : 'REQUIRED_ENTRY_OVERSIZE', consumer, scope, [rawCandidate.id]);
          }
          const detailRef = encodeOpaque(DETAIL_PREFIX, {
            schemaVersion: 1, consumer, scopeDigest, queryDigest,
            selectionRevisionDigest: collected.revision, id: rawCandidate.id, candidateDigest: candidate.candidateDigest,
          });
          const deferredBytes = Buffer.byteLength(rawCandidate.id, 'utf8')
            + Buffer.byteLength(detailRef, 'utf8') + RENDER_DEFERRED_OVERHEAD;
          if (usedBytes + deferredBytes > renderByteBudget || usedLines + 1 > renderLineBudget) {
            stoppedCandidate = rawCandidate;
            break;
          }
          deferred.push(Object.freeze({ candidate, reasons, reasonCode, detailRef }));
          presentedCandidates.push(rawCandidate);
          usedBytes += deferredBytes;
          usedLines += 1;
          continue;
        }
        const entry = readMemoryEntryById(store, rawCandidate.id, selection);
        if (!entry) return hold('QUERY_FAILED', consumer, scope, requiredIds);
        const actualBytes = Buffer.byteLength(entry.content, 'utf8');
        const actualLines = entry.content.length === 0 ? 0 : entry.content.split('\n').length;
        const wholeBytes = Buffer.byteLength(canonicalJson(cleanCanonical(entry)), 'utf8');
        if (actualBytes !== rawCandidate.contentByteLength || actualLines !== rawCandidate.contentLineCount
          || usedBytes + wholeBytes + RENDER_ENTRY_OVERHEAD > renderByteBudget
          || usedLines + actualLines + 7 > renderLineBudget) {
          if (mandatory) {
            return hold(reasons.includes('CRITICAL') && !reasons.includes('REQUIRED') && !reasons.includes('PREFERRED_LATEST')
              ? 'CRITICAL_CONTEXT_UNAVAILABLE'
              : 'REQUIRED_ENTRY_OVERSIZE', consumer, scope, [rawCandidate.id]);
          }
          const detailRef = encodeOpaque(DETAIL_PREFIX, {
            schemaVersion: 1, consumer, scopeDigest, queryDigest,
            selectionRevisionDigest: collected.revision, id: rawCandidate.id, candidateDigest: candidate.candidateDigest,
          });
          const deferredBytes = Buffer.byteLength(rawCandidate.id, 'utf8')
            + Buffer.byteLength(detailRef, 'utf8') + RENDER_DEFERRED_OVERHEAD;
          if (usedBytes + deferredBytes > renderByteBudget || usedLines + 1 > renderLineBudget) {
            stoppedCandidate = rawCandidate;
            break;
          }
          deferred.push(Object.freeze({ candidate, reasons, reasonCode: 'BYTE_LIMIT', detailRef }));
          presentedCandidates.push(rawCandidate);
          usedBytes += deferredBytes;
          usedLines += 1;
          continue;
        }
        usedBytes += wholeBytes + RENDER_ENTRY_OVERHEAD;
        usedLines += actualLines + 7;
        presentedCandidates.push(rawCandidate);
        entries.push(Object.freeze({
          entry: Object.freeze({ ...entry }),
          relevance: rawCandidate.relevance,
          contentDigest: contentDigest(entry.content),
          reasons,
        }));
      }
      const stoppedIndex = stoppedCandidate === null
        ? -1
        : collected.queryPage.findIndex((candidate) => candidate.id === stoppedCandidate!.id);
      if (stoppedCandidate !== null && stoppedIndex <= 0) {
        return hold('INSUFFICIENT_CONTEXT', consumer, scope, [stoppedCandidate.id]);
      }
      const anchor = stoppedIndex > 0
        ? collected.queryPage[stoppedIndex - 1]
        : collected.queryPage[collected.queryPage.length - 1];
      const hasMore = stoppedCandidate !== null || collected.hasNext;
      const nextCursor = hasMore && anchor
        ? encodeOpaque(CURSOR_PREFIX, {
            schemaVersion: 1, consumer, scopeDigest, queryDigest, limitsDigest,
            selectionRevisionDigest: collected.revision,
            anchorCandidateDigest: queryCandidateDigest(anchor),
            afterRank: anchor.orderRank,
            afterOrdinal: anchor.orderOrdinal,
            afterId: anchor.id,
          })
        : null;
      const available: MemoryReadAvailableV1 = Object.freeze({
        state: 'AVAILABLE', consumer, scope, limits, ...revision,
        candidates: Object.freeze(presentedCandidates.map(publicCandidate)),
        entries: Object.freeze(entries),
        deferred: Object.freeze(deferred),
        nextCursor,
      });
      return available;
    });
  } catch (error: unknown) {
    if (error instanceof MemoryQueryError && error.message.includes('tenant_id')) {
      return hold('TENANT_SCOPE_UNAVAILABLE', consumer, scope, requiredIds);
    }
    return hold('QUERY_FAILED', consumer, scope, requiredIds);
  }
}

export function readMemoryDetail(store: MemoryStore, input: MemoryReadDetailInputV1): MemoryReadDetailV1 {
  const consumer = parseConsumer((input as { consumer?: unknown } | null)?.consumer);
  const scope = parseScope((input as { scope?: unknown } | null)?.scope);
  if (consumer === null || scope === null || input === null || typeof input !== 'object'
    || !hasOnlyKeys(input, ['consumer', 'scope', 'detailRef', 'expectedContentDigest'])) {
    return hold('INVALID_REQUEST', consumer, scope);
  }
  const reference = parseDetailRef(input.detailRef);
  const scopeDigest = digest(scope);
  if (!reference || reference.consumer !== consumer || reference.scopeDigest !== scopeDigest) {
    return hold('DETAIL_REFERENCE_INVALID', consumer, scope);
  }
  if (input.expectedContentDigest !== undefined && !SHA256.test(input.expectedContentDigest)) {
    return hold('INVALID_REQUEST', consumer, scope);
  }
  try {
    return store.readSnapshot(() => {
      const selection = tenantSelection(scope);
      const candidate = readMemoryCandidateById(store, reference.id, selection);
      if (!candidate || candidateDigest(candidate) !== reference.candidateDigest) {
        return hold('DETAIL_CHANGED', consumer, scope, [reference.id]);
      }
      const entry = readMemoryEntryById(store, reference.id, selection);
      if (!entry) return hold('DETAIL_CHANGED', consumer, scope, [reference.id]);
      const actualDigest = contentDigest(entry.content);
      if (input.expectedContentDigest !== undefined && input.expectedContentDigest !== actualDigest) {
        return hold('DETAIL_CHANGED', consumer, scope, [reference.id]);
      }
      return Object.freeze({
        state: 'AVAILABLE', consumer, scope,
        entry: Object.freeze({ ...entry }),
        contentDigest: actualDigest,
      });
    });
  } catch (error: unknown) {
    if (error instanceof MemoryQueryError && error.message.includes('tenant_id')) {
      return hold('TENANT_SCOPE_UNAVAILABLE', consumer, scope, [reference.id]);
    }
    return hold('QUERY_FAILED', consumer, scope, [reference.id]);
  }
}

const ADR_REFERENCE = /^ADR-[A-Z]+-\d+$/iu;

/** Strict case bridge for task-authored ADR references; no fuzzy alias/title lookup. */
export function resolveMemoryRequiredIds(
  store: MemoryStore,
  input: MemoryRequiredIdResolutionInputV1,
): MemoryRequiredIdResolutionV1 {
  const consumer = parseConsumer((input as { consumer?: unknown } | null)?.consumer);
  const scope = parseScope((input as { scope?: unknown } | null)?.scope);
  if (consumer === null || scope === null || input === null || typeof input !== 'object'
    || !hasOnlyKeys(input, ['consumer', 'scope', 'references'])
    || !validStringArray(input.references)) return hold('INVALID_REQUEST', consumer, scope);
  if (new Set(input.references).size !== input.references.length
    || input.references.some((reference) => !ADR_REFERENCE.test(reference))) {
    return hold('INVALID_REQUEST', consumer, scope, input.references);
  }
  try {
    return store.readSnapshot(() => {
      const exactIds: string[] = [];
      for (const reference of input.references) {
        const matches = resolveMemoryAdrReferenceIds(store, reference, tenantSelection(scope));
        if (matches.length === 0) return hold('REQUIRED_ENTRY_MISSING', consumer, scope, [reference]);
        if (matches.length !== 1) return hold('REQUIRED_REFERENCE_AMBIGUOUS', consumer, scope, [reference]);
        exactIds.push(matches[0]!);
      }
      return Object.freeze({ state: 'AVAILABLE', consumer, scope, exactIds: Object.freeze(exactIds) });
    });
  } catch (error: unknown) {
    if (error instanceof MemoryQueryError && error.message.includes('tenant_id')) {
      return hold('TENANT_SCOPE_UNAVAILABLE', consumer, scope, input.references);
    }
    return hold('QUERY_FAILED', consumer, scope, input.references);
  }
}

/** Preset bridge: missing references are optional, ambiguity and invalid input remain HOLD. */
export function resolveMemoryPreferredIds(
  store: MemoryStore,
  input: MemoryPreferredIdResolutionInputV1,
): MemoryPreferredIdResolutionV1 {
  const consumer = parseConsumer((input as { consumer?: unknown } | null)?.consumer);
  const scope = parseScope((input as { scope?: unknown } | null)?.scope);
  if (consumer === null || scope === null || input === null || typeof input !== 'object'
    || !hasOnlyKeys(input, ['consumer', 'scope', 'references'])
    || !validStringArray(input.references)) return hold('INVALID_REQUEST', consumer, scope);
  if (new Set(input.references).size !== input.references.length
    || input.references.some((reference) => !ADR_REFERENCE.test(reference))) {
    return hold('INVALID_REQUEST', consumer, scope, input.references);
  }
  try {
    return store.readSnapshot(() => {
      const exactIds: string[] = [];
      for (const reference of input.references) {
        const matches = resolveMemoryAdrReferenceIds(store, reference, tenantSelection(scope));
        if (matches.length > 1) return hold('REQUIRED_REFERENCE_AMBIGUOUS', consumer, scope, [reference]);
        if (matches.length === 1) exactIds.push(matches[0]!);
      }
      return Object.freeze({ state: 'AVAILABLE', consumer, scope, exactIds: Object.freeze(exactIds) });
    });
  } catch (error: unknown) {
    if (error instanceof MemoryQueryError && error.message.includes('tenant_id')) {
      return hold('TENANT_SCOPE_UNAVAILABLE', consumer, scope, input.references);
    }
    return hold('QUERY_FAILED', consumer, scope, input.references);
  }
}

export class MemoryReadRenderHoldError extends Error {
  readonly code = 'MEMORY_READ_CONTEXT_HOLD';
  constructor(readonly reasonCode: MemoryReadHoldReasonV1) {
    super(`MEMORY_READ_CONTEXT_HOLD:${reasonCode}`);
    this.name = 'MemoryReadRenderHoldError';
  }
}

/** Pure whole-unit formatter. HOLD is never converted into an empty prompt. */
export function renderMemoryReadView(view: MemoryReadViewV1, labels: MemoryReadLabelsV1): string {
  if (view.state === 'HOLD') throw new MemoryReadRenderHoldError(view.reasonCode);
  if (view.state === 'ABSENT') return '';
  const lines: string[] = [
    `${labels.revision}: ${view.selectionRevisionDigest}`,
    `${labels.scope}: ${canonicalJson(view.scope)}`,
    '',
  ];
  for (const selected of view.entries) {
    const entry = selected.entry;
    lines.push(`## [${entry.id}] ${entry.title}`);
    lines.push(`- ${labels.source}: ${entry.source}`);
    lines.push(`- ${labels.status}: ${entry.status}`);
    lines.push(`- ${labels.sprint}: ${entry.sprint_id ?? ''}`);
    lines.push(`- ${labels.updatedAt}: ${entry.updated_at}`);
    lines.push('');
    lines.push(entry.content);
    lines.push('');
  }
  for (const deferred of view.deferred) {
    lines.push(`- ${labels.deferred}: ${deferred.candidate.id} · ${labels.detail}: ${deferred.detailRef}`);
  }
  if (view.nextCursor) lines.push(`- ${labels.continuation}: ${view.nextCursor}`);
  const rendered = lines.join('\n');
  const lineCount = rendered.length === 0 ? 0 : rendered.split('\n').length;
  if (Buffer.byteLength(rendered, 'utf8') > view.limits.maxBytes || lineCount > view.limits.maxLines) {
    throw new MemoryReadRenderHoldError('RENDER_LIMIT_EXCEEDED');
  }
  return rendered;
}
