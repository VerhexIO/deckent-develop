/**
 * memory-query.ts — Dual-layer FTS5 search for Memory V2.
 *
 * Provides two search layers:
 *   1. Original text columns (title, content, summary, tag_text)
 *   2. Normalized text columns (title_norm, content_norm, summary_norm, tag_norm)
 *
 * The normalized layer uses turkishNormalize() so queries like "brain import"
 * match Turkish content "Brain merkezi import kurali" through ASCII folding.
 *
 * Also provides buildAutoQuery() for Brain lifecycle integration.
 */

import type { MemoryStore } from './memory-store.js';
import { turkishNormalize } from './memory-normalize.js';
import type { MemoryQueryParams, MemorySearchResult, MemoryEntryV2 } from './memory-types.js';
import { createDebugLog } from './debug-log.js';
import { parseSprintOrdinal } from './utils.js';

const log = createDebugLog('memory-query');

// ─── FTS5 Query Escaping ─────────────────────────────────────────────

/**
 * Custom error class for memory query failures.
 * Thrown instead of silently returning empty results.
 */
export class MemoryQueryError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'MemoryQueryError';
  }
}

/**
 * Escape user input for FTS5 MATCH.
 * - Wrap individual tokens in double quotes to treat as literals.
 * - Preserve OR, AND, NOT operators and * wildcard at end of token.
 * - `mode` controls token join: 'or' (default) joins with OR for broader recall,
 *   'and' joins with implicit AND (space) for precise matching.
 */
export function escapeFts5Query(input: string, mode: 'and' | 'or' = 'or'): string {
  const OPERATORS = new Set(['OR', 'AND', 'NOT']);
  const quoteLiteral = (value: string): string => `"${value.replace(/"/g, '""')}"`;
  const tokens = input
    .split(/\s+/)
    .filter(t => t.length > 0)
    .map(token => {
      if (OPERATORS.has(token)) return token;
      // Allow trailing wildcard
      if (token.endsWith('*')) {
        const base = token.slice(0, -1);
        return `${quoteLiteral(base)}*`;
      }
      return quoteLiteral(token);
    });

  if (mode === 'and') return tokens.join(' ');

  // OR mode: insert OR between non-operator tokens, but don't duplicate
  // when user already wrote explicit operators.
  const parts: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i]!;
    if (i > 0 && !OPERATORS.has(tok) && !OPERATORS.has(tokens[i - 1]!)) {
      parts.push('OR');
    }
    parts.push(tok);
  }
  return parts.join(' ');
}

// ─── Row type from FTS join ──────────────────────────────────────────

interface FtsResultRow {
  id: string;
  type: string;
  source: string;
  title: string;
  content: string;
  summary: string | null;
  tag_text: string;
  title_norm: string;
  content_norm: string;
  summary_norm: string;
  tag_norm: string;
  status: string;
  priority: string;
  sprint_id: string | null;
  sprint_num: number;
  lang: string;
  decay_exempt: number;
  metadata: string;
  tenant_id: string | null;
  adr_class: string | null;
  scope: string | null;
  immutable: number | null;
  source_authority: string | null;
  enforcement_level: string | null;
  audit_prev_hmac: string | null;
  audit_hmac: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  rank: number;
  snip_title: string | null;
  snip_content: string | null;
  snip_tags: string | null;
}

interface StructuredResultRow {
  id: string;
  type: string;
  source: string;
  title: string;
  content: string;
  summary: string | null;
  tag_text: string;
  title_norm: string;
  content_norm: string;
  summary_norm: string;
  tag_norm: string;
  status: string;
  priority: string;
  sprint_id: string | null;
  sprint_num: number;
  lang: string;
  decay_exempt: number;
  metadata: string;
  tenant_id: string | null;
  adr_class: string | null;
  scope: string | null;
  immutable: number | null;
  source_authority: string | null;
  enforcement_level: string | null;
  audit_prev_hmac: string | null;
  audit_hmac: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

function rowToEntry(row: StructuredResultRow | FtsResultRow): MemoryEntryV2 {
  return {
    id: row.id,
    type: row.type,
    source: row.source as MemoryEntryV2['source'],
    title: row.title,
    content: row.content,
    summary: row.summary,
    tag_text: row.tag_text,
    title_norm: row.title_norm,
    content_norm: row.content_norm,
    summary_norm: row.summary_norm,
    tag_norm: row.tag_norm,
    status: row.status,
    priority: row.priority,
    sprint_id: row.sprint_id,
    sprint_num: row.sprint_num,
    lang: row.lang,
    decay_exempt: row.decay_exempt === 1,
    metadata: row.metadata,
    tenant_id: row.tenant_id,
    adr_class: row.adr_class,
    scope: row.scope,
    immutable: row.immutable,
    source_authority: row.source_authority,
    enforcement_level: row.enforcement_level,
    audit_prev_hmac: row.audit_prev_hmac,
    audit_hmac: row.audit_hmac,
    created_at: row.created_at,
    updated_at: row.updated_at,
    deleted_at: row.deleted_at,
  };
}

export interface MemoryQueryCandidateRow {
  readonly id: string;
  readonly type: string;
  readonly source: string;
  readonly titlePreview: string;
  readonly summaryPreview: string | null;
  readonly status: string;
  readonly priority: string;
  readonly sprintId: string | null;
  readonly sprintOrdinal: number | null;
  readonly language: string;
  readonly tenantId: string | null;
  readonly adrClass: string | null;
  readonly scope: string | null;
  readonly enforcementLevel: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly contentByteLength: number;
  readonly contentLineCount: number;
  readonly recordByteLengthFloor: number;
  readonly relevance: number;
  readonly snippet?: string;
  /** Internal deterministic pagination key; not a complete-entry field. */
  readonly orderRank: number;
  readonly orderOrdinal: number;
  /** Monotonic per-entry history anchor; internal authority, never a public preview field. */
  readonly entryRevision: number;
}

export interface MemoryQueryCandidateCursorKey {
  readonly rank: number;
  readonly ordinal: number;
  readonly id: string;
}

export type MemoryQueryTenantSelection =
  | Readonly<{ kind: 'tenant'; tenantId: string }>
  | Readonly<{ kind: 'all' }>;

interface CandidateSqlRow {
  id: string;
  type: string;
  source: string;
  title_preview: string;
  summary_preview: string | null;
  status: string;
  priority: string;
  sprint_id: string | null;
  sprint_ordinal: number | null;
  sort_ordinal: number;
  lang: string;
  tenant_id: string | null;
  adr_class: string | null;
  scope: string | null;
  enforcement_level: string | null;
  created_at: string;
  updated_at: string;
  content_byte_length: number;
  content_line_count: number;
  record_byte_length_floor: number;
  rank?: number;
  snip_title?: string | null;
  snip_content?: string | null;
  snip_tags?: string | null;
  entry_revision: number;
}

const CANDIDATE_COLUMNS = `
  e.id,
  e.type,
  e.source,
  substr(e.title, 1, 256) AS title_preview,
  CASE WHEN e.summary IS NULL THEN NULL ELSE substr(e.summary, 1, 512) END AS summary_preview,
  e.status,
  e.priority,
  e.sprint_id,
  deckent_sprint_ordinal_v1(e.sprint_id) AS sprint_ordinal,
  COALESCE(deckent_sprint_ordinal_v1(e.sprint_id), -1) AS sort_ordinal,
  e.lang,
  e.tenant_id,
  e.adr_class,
  e.scope,
  e.enforcement_level,
  e.created_at,
  e.updated_at,
  COALESCE((SELECT MAX(h.id) FROM entry_history h WHERE h.entry_id = e.id), 0) AS entry_revision,
  length(CAST(e.content AS BLOB)) AS content_byte_length,
  CASE
    WHEN length(e.content) = 0 THEN 0
    ELSE 1 + length(e.content) - length(replace(e.content, char(10), ''))
  END AS content_line_count,
  length(CAST(e.id AS BLOB))
    + length(CAST(e.type AS BLOB))
    + length(CAST(e.source AS BLOB))
    + length(CAST(e.title AS BLOB))
    + length(CAST(e.content AS BLOB))
    + length(CAST(COALESCE(e.summary, '') AS BLOB))
    + length(CAST(e.tag_text AS BLOB))
    + length(CAST(e.metadata AS BLOB))
    + length(CAST(COALESCE(e.source_authority, '') AS BLOB))
    + length(CAST(COALESCE(e.enforcement_level, '') AS BLOB))
    AS record_byte_length_floor
`;

function isNonEmptyCandidateId(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function candidateFromRow(row: CandidateSqlRow): MemoryQueryCandidateRow {
  const snippet = pickBestSnippet(row.snip_content ?? null, row.snip_title ?? null, row.snip_tags ?? null);
  return {
    id: row.id,
    type: row.type,
    source: row.source,
    titlePreview: row.title_preview,
    summaryPreview: row.summary_preview,
    status: row.status,
    priority: row.priority,
    sprintId: row.sprint_id,
    sprintOrdinal: row.sprint_ordinal,
    language: row.lang,
    tenantId: row.tenant_id,
    adrClass: row.adr_class,
    scope: row.scope,
    enforcementLevel: row.enforcement_level,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    contentByteLength: row.content_byte_length,
    contentLineCount: row.content_line_count,
    recordByteLengthFloor: row.record_byte_length_floor,
    relevance: row.rank === undefined ? 0 : Math.abs(row.rank),
    ...(snippet === undefined ? {} : { snippet }),
    orderRank: row.rank ?? 0,
    orderOrdinal: row.sort_ordinal,
    entryRevision: row.entry_revision,
  };
}

/**
 * Read one bounded metadata-only candidate page. Complete entry bodies are fetched
 * separately only after the service has admitted them against its byte/line budget.
 */
export function queryMemoryCandidates(
  store: MemoryStore,
  params: Readonly<Omit<MemoryQueryParams, 'tenantId' | 'limit'>>,
  tenantSelection: MemoryQueryTenantSelection,
  page: Readonly<{ limit: number; after?: MemoryQueryCandidateCursorKey; exactId?: string }>,
): MemoryQueryCandidateRow[] {
  if (!Number.isSafeInteger(page.limit) || page.limit <= 0
    || (page.after !== undefined && (!Number.isFinite(page.after.rank)
      || !Number.isSafeInteger(page.after.ordinal) || !isNonEmptyCandidateId(page.after.id)))
    || (page.exactId !== undefined && !isNonEmptyCandidateId(page.exactId))) {
    throw new MemoryQueryError('Memory candidate page is invalid');
  }
  const db = store.getRawDb();
  db.function('deckent_sprint_ordinal_v1', { deterministic: true }, (value: unknown) => parseSprintOrdinal(value));
  const { whereClauses, bindParams } = buildFilterClauses(db, params, 'e', tenantSelection);
  const binds = {
    ...bindParams,
    limit: page.limit,
    ...(page.after === undefined ? {} : {
      after_rank: page.after.rank,
      after_ordinal: page.after.ordinal,
      after_id: page.after.id,
    }),
    ...(page.exactId === undefined ? {} : { exact_id: page.exactId }),
  };
  const exactIdClause = page.exactId === undefined ? '' : 'AND e.id = @exact_id';

  try {
    if (params.text && params.text.trim().length > 0) {
      const mode = params.mode ?? 'or';
      const escaped = escapeFts5Query(params.text, mode);
      const normalized = escapeFts5Query(turkishNormalize(params.text), mode);
      const ftsQuery = `{title content summary tag_text}: (${escaped}) OR `
        + `{title_norm content_norm summary_norm tag_norm}: (${normalized})`;
      const rows = db.prepare(`
        SELECT ${CANDIDATE_COLUMNS},
               entries_fts.rank AS rank,
               snippet(entries_fts, 0, '>>>', '<<<', '...', 20) AS snip_title,
               snippet(entries_fts, 1, '>>>', '<<<', '...', 20) AS snip_content,
               snippet(entries_fts, 3, '>>>', '<<<', '...', 20) AS snip_tags
        FROM entries_fts
        INNER JOIN entries e ON e.rowid = entries_fts.rowid
        WHERE entries_fts MATCH @fts_query
          ${whereClauses.length > 0 ? `AND ${whereClauses.join(' AND ')}` : ''}
          ${exactIdClause}
          ${page.after === undefined ? '' : `AND (
            entries_fts.rank > @after_rank
            OR (entries_fts.rank = @after_rank AND COALESCE(deckent_sprint_ordinal_v1(e.sprint_id), -1) < @after_ordinal)
            OR (entries_fts.rank = @after_rank AND COALESCE(deckent_sprint_ordinal_v1(e.sprint_id), -1) = @after_ordinal AND e.id > @after_id)
          )`}
        ORDER BY entries_fts.rank ASC, sprint_ordinal DESC, e.id ASC
        LIMIT @limit
      `).all({ fts_query: ftsQuery, ...binds }) as CandidateSqlRow[];
      return rows.map(candidateFromRow);
    }

    const rows = db.prepare(`
      SELECT ${CANDIDATE_COLUMNS}
      FROM entries e
      WHERE ${whereClauses.length > 0 ? `${whereClauses.join(' AND ')} AND` : ''} 1 = 1
        ${exactIdClause}
        ${page.after === undefined ? '' : `AND (
          COALESCE(deckent_sprint_ordinal_v1(e.sprint_id), -1) < @after_ordinal
          OR (COALESCE(deckent_sprint_ordinal_v1(e.sprint_id), -1) = @after_ordinal AND e.id > @after_id)
        )`}
      ORDER BY sprint_ordinal DESC, e.id ASC
      LIMIT @limit
    `).all(binds) as CandidateSqlRow[];
    return rows.map(candidateFromRow);
  } catch (error: unknown) {
    if (error instanceof MemoryQueryError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw new MemoryQueryError(`Memory candidate query failed: ${message}`, error);
  }
}

/** Exact scoped full-entry lookup used only after metadata admission. */
export function readMemoryEntryById(
  store: MemoryStore,
  id: string,
  tenantSelection: MemoryQueryTenantSelection,
): MemoryEntryV2 | null {
  const db = store.getRawDb();
  assertTenantColumn(db);
  const tenantClause = tenantSelection.kind === 'tenant' ? 'tenant_id = @tenant_id' : '1 = 1';
  const row = db.prepare(`
    SELECT * FROM entries
    WHERE id = @id AND deleted_at IS NULL AND ${tenantClause}
  `).get({ id, ...(tenantSelection.kind === 'tenant' ? { tenant_id: tenantSelection.tenantId } : {}) }) as StructuredResultRow | undefined;
  return row ? rowToEntry(row) : null;
}

/** Metadata-only exact-ID lookup used to admit required/detail reads. */
export function readMemoryCandidateById(
  store: MemoryStore,
  id: string,
  tenantSelection: MemoryQueryTenantSelection,
): MemoryQueryCandidateRow | null {
  const db = store.getRawDb();
  db.function('deckent_sprint_ordinal_v1', { deterministic: true }, (value: unknown) => parseSprintOrdinal(value));
  assertTenantColumn(db);
  const tenantClause = tenantSelection.kind === 'tenant' ? 'e.tenant_id = @tenant_id' : '1 = 1';
  const row = db.prepare(`
    SELECT ${CANDIDATE_COLUMNS}
    FROM entries e
    WHERE e.id = @id AND e.deleted_at IS NULL AND ${tenantClause}
  `).get({ id, ...(tenantSelection.kind === 'tenant' ? { tenant_id: tenantSelection.tenantId } : {}) }) as CandidateSqlRow | undefined;
  return row ? candidateFromRow(row) : null;
}

/** Resolve one strict ADR reference to at most two scoped, accepted canonical IDs. */
export function resolveMemoryAdrReferenceIds(
  store: MemoryStore,
  reference: string,
  tenantSelection: MemoryQueryTenantSelection,
): string[] {
  const db = store.getRawDb();
  if (tenantSelection.kind === 'tenant') assertTenantColumn(db);
  const tenantClause = tenantSelection.kind === 'tenant' ? 'tenant_id = @tenant_id' : '1 = 1';
  const rows = db.prepare(`
    SELECT id FROM entries
    WHERE type = 'adr'
      AND status = 'accepted'
      AND deleted_at IS NULL
      AND lower(id) = lower(@reference)
      AND ${tenantClause}
    ORDER BY id ASC
    LIMIT 2
  `).all({ reference, ...(tenantSelection.kind === 'tenant' ? { tenant_id: tenantSelection.tenantId } : {}) }) as Array<{ id: string }>;
  return rows.map((row) => row.id);
}

// ─── searchMemory ────────────────────────────────────────────────────

/**
 * Search the memory store using dual-layer FTS5 + structured filters.
 *
 * When `params.text` is provided, runs an FTS5 MATCH on both original and
 * normalized columns (OR'd together for maximum recall). When no text is
 * provided, returns filtered entries ordered by sprint_num DESC.
 */
export function searchMemory(
  store: MemoryStore,
  params: MemoryQueryParams,
): MemorySearchResult[] {
  const db = store.getRawDb();
  const limit = params.limit ?? 10;

  if (params.text && params.text.trim().length > 0) {
    return ftsSearch(db, params, limit);
  }
  return structuredSearch(db, params, limit);
}

/**
 * Pick the best snippet from multiple FTS5 column snippets.
 * Prefers content, then title, then tags — but only if the snippet
 * contains the highlight markers (>>>/<<<), indicating a match.
 */
function pickBestSnippet(...candidates: Array<string | null>): string | undefined {
  const MARKER = '>>>';
  for (const s of candidates) {
    if (s && s.includes(MARKER)) return s;
  }
  // Fallback: return first non-null candidate (no highlights)
  for (const s of candidates) {
    if (s) return s;
  }
  return undefined;
}

// ─── FTS search path ─────────────────────────────────────────────────

function ftsSearch(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  params: MemoryQueryParams,
  limit: number,
): MemorySearchResult[] {
  const mode = params.mode ?? 'or';
  const escaped = escapeFts5Query(params.text!, mode);
  const normalized = escapeFts5Query(turkishNormalize(params.text!), mode);

  log.debug(`FTS query mode=${mode} escaped="${escaped}" normalized="${normalized}"`);

  // Build dual-layer FTS5 MATCH expression:
  // Search original columns OR normalized columns
  const ftsQuery =
    `{title content summary tag_text}: (${escaped})` +
    ` OR ` +
    `{title_norm content_norm summary_norm tag_norm}: (${normalized})`;

  // Build WHERE clauses for structured filters
  const { whereClauses, bindParams } = buildFilterClauses(db, params, 'e');

  // Generate snippets for multiple columns to find best match.
  // FTS5 columns: 0=title, 1=content, 2=summary, 3=tag_text,
  //               4=title_norm, 5=content_norm, 6=summary_norm, 7=tag_norm
  const sql = `
    SELECT e.*,
           entries_fts.rank AS rank,
           snippet(entries_fts, 0, '>>>', '<<<', '...', 20) AS snip_title,
           snippet(entries_fts, 1, '>>>', '<<<', '...', 20) AS snip_content,
           snippet(entries_fts, 3, '>>>', '<<<', '...', 20) AS snip_tags
    FROM entries_fts
    INNER JOIN entries e ON e.rowid = entries_fts.rowid
    WHERE entries_fts MATCH @fts_query
      ${whereClauses.length > 0 ? 'AND ' + whereClauses.join(' AND ') : ''}
    ORDER BY entries_fts.rank
    LIMIT @limit
  `;

  try {
    const rows = db.prepare(sql).all({
      fts_query: ftsQuery,
      limit,
      ...bindParams,
    }) as FtsResultRow[];

    log.info(`FTS search returned ${rows.length} results for mode=${mode}`);

    return rows.map(row => ({
      entry: rowToEntry(row),
      relevance: Math.abs(row.rank),
      snippet: pickBestSnippet(row.snip_content, row.snip_title, row.snip_tags),
    }));
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    log.error(`FTS5 query failed: ${message}`);
    throw new MemoryQueryError(`FTS5 query failed: ${message}`, err);
  }
}

// ─── Structured search path (no text) ────────────────────────────────

function structuredSearch(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  params: MemoryQueryParams,
  limit: number,
): MemorySearchResult[] {
  const { whereClauses, bindParams } = buildFilterClauses(db, params, 'e');

  // tags_contain subquery
  const { tagClause, tagBinds } = buildTagsContainClause(params);

  const allClauses = [...whereClauses];
  if (tagClause) allClauses.push(tagClause);

  const sql = `
    SELECT e.*
    FROM entries e
    ${allClauses.length > 0 ? 'WHERE ' + allClauses.join(' AND ') : ''}
    ORDER BY e.sprint_num DESC
    LIMIT @limit
  `;

  const rows = db.prepare(sql).all({
    limit,
    ...bindParams,
    ...tagBinds,
  }) as StructuredResultRow[];

  return rows.map(row => ({
    entry: rowToEntry(row),
    relevance: 0,
  }));
}

// ─── Tenant column guard (born-609) ──────────────────────────────────

/**
 * Defensive existence check for `entries.tenant_id` via PRAGMA table_info.
 */
function hasTenantColumn(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
): boolean {
  try {
    const cols = db.prepare(`PRAGMA table_info(entries)`).all() as Array<{ name: string }>;
    return cols.some(c => c.name === 'tenant_id');
  } catch {
    return false;
  }
}

function assertTenantColumn(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
): void {
  if (!hasTenantColumn(db)) {
    throw new MemoryQueryError('Tenant-scoped memory query requires entries.tenant_id');
  }
}

// ─── Filter clause builder ───────────────────────────────────────────

function buildFilterClauses(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  params: MemoryQueryParams,
  alias: string,
  explicitTenantSelection?: MemoryQueryTenantSelection,
): { whereClauses: string[]; bindParams: Record<string, unknown> } {
  const clauses: string[] = [];
  const binds: Record<string, unknown> = {};

  // deleted_at filter (default: exclude deleted)
  if (!params.include_deleted) {
    clauses.push(`${alias}.deleted_at IS NULL`);
  }

  const tenantSelection = explicitTenantSelection
    ?? (params.tenantId === undefined ? undefined : { kind: 'tenant' as const, tenantId: params.tenantId });
  if (tenantSelection !== undefined && tenantSelection.kind !== 'all') {
    assertTenantColumn(db);
    clauses.push(`${alias}.tenant_id = @tenant_id`);
    binds['tenant_id'] = tenantSelection.tenantId;
  }

  // type filter
  if (params.type && params.type.length > 0) {
    const placeholders = params.type.map((_, i) => `@type_${i}`);
    clauses.push(`${alias}.type IN (${placeholders.join(', ')})`);
    for (let i = 0; i < params.type.length; i++) {
      binds[`type_${i}`] = params.type[i];
    }
  }

  // source filter
  if (params.source && params.source.length > 0) {
    const placeholders = params.source.map((_, i) => `@source_${i}`);
    clauses.push(`${alias}.source IN (${placeholders.join(', ')})`);
    for (let i = 0; i < params.source.length; i++) {
      binds[`source_${i}`] = params.source[i];
    }
  }

  // status filter
  if (params.status && params.status.length > 0) {
    const placeholders = params.status.map((_, i) => `@status_${i}`);
    clauses.push(`${alias}.status IN (${placeholders.join(', ')})`);
    for (let i = 0; i < params.status.length; i++) {
      binds[`status_${i}`] = params.status[i];
    }
  }

  if (params.priority && params.priority.length > 0) {
    const placeholders = params.priority.map((_, i) => `@priority_${i}`);
    clauses.push(`${alias}.priority IN (${placeholders.join(', ')})`);
    for (let i = 0; i < params.priority.length; i++) {
      binds[`priority_${i}`] = params.priority[i];
    }
  }

  if (params.adr_class && params.adr_class.length > 0) {
    const placeholders = params.adr_class.map((_, i) => `@adr_class_${i}`);
    clauses.push(`${alias}.adr_class IN (${placeholders.join(', ')})`);
    for (let i = 0; i < params.adr_class.length; i++) {
      binds[`adr_class_${i}`] = params.adr_class[i];
    }
  }

  if (params.adr_scope && params.adr_scope.length > 0) {
    const placeholders = params.adr_scope.map((_, i) => `@adr_scope_${i}`);
    clauses.push(`${alias}.scope IN (${placeholders.join(', ')})`);
    for (let i = 0; i < params.adr_scope.length; i++) {
      binds[`adr_scope_${i}`] = params.adr_scope[i];
    }
  }

  // sprint_range filter
  if (params.sprint_range) {
    if (params.sprint_range.min !== undefined) {
      clauses.push(`${alias}.sprint_num >= @sprint_min`);
      binds['sprint_min'] = params.sprint_range.min;
    }
    if (params.sprint_range.max !== undefined) {
      clauses.push(`${alias}.sprint_num <= @sprint_max`);
      binds['sprint_max'] = params.sprint_range.max;
    }
  }

  // decay_exempt filter
  if (params.decay_exempt !== undefined) {
    clauses.push(`${alias}.decay_exempt = @decay_exempt`);
    binds['decay_exempt'] = params.decay_exempt ? 1 : 0;
  }

  // tags_contain subquery (for FTS path, applied to entries table)
  if (params.tags_contain && params.tags_contain.length > 0) {
    const tagCount = params.tags_contain.length;
    const tagPlaceholders = params.tags_contain.map((_, i) => `@tag_${i}`);
    clauses.push(`
      ${alias}.id IN (
        SELECT t.entry_id FROM tags t
        WHERE t.tag IN (${tagPlaceholders.join(', ')})
        GROUP BY t.entry_id
        HAVING COUNT(DISTINCT t.tag) = @tag_count
      )
    `);
    for (let i = 0; i < params.tags_contain.length; i++) {
      binds[`tag_${i}`] = params.tags_contain[i];
    }
    binds['tag_count'] = tagCount;
  }

  return { whereClauses: clauses, bindParams: binds };
}

function buildTagsContainClause(
  params: MemoryQueryParams,
): { tagClause: string | null; tagBinds: Record<string, unknown> } {
  if (!params.tags_contain || params.tags_contain.length === 0) {
    return { tagClause: null, tagBinds: {} };
  }

  const tagCount = params.tags_contain.length;
  const tagPlaceholders = params.tags_contain.map((_, i) => `@stag_${i}`);
  const binds: Record<string, unknown> = {};
  for (let i = 0; i < params.tags_contain.length; i++) {
    binds[`stag_${i}`] = params.tags_contain[i];
  }
  binds['stag_count'] = tagCount;

  const clause = `
    e.id IN (
      SELECT t.entry_id FROM tags t
      WHERE t.tag IN (${tagPlaceholders.join(', ')})
      GROUP BY t.entry_id
      HAVING COUNT(DISTINCT t.tag) = @stag_count
    )
  `;

  return { tagClause: clause, tagBinds: binds };
}

// ─── buildAutoQuery ──────────────────────────────────────────────────

/**
 * Build a MemoryQueryParams from task DNA keywords and scope paths.
 * Used by Brain lifecycle integration to automatically query relevant
 * context for each task during planning.
 */
export function buildAutoQuery(
  taskKeywords: string[],
  taskScope: string[],
  opts?: { type?: string[]; sprintRange?: number },
): MemoryQueryParams {
  return {
    text: taskKeywords.join(' '),
    type: opts?.type ?? ['adr', 'pattern', 'memory'],
    tags_contain: taskScope.length > 0 ? taskScope : undefined,
    sprint_range: opts?.sprintRange ? { min: opts.sprintRange } : undefined,
    limit: 5,
    mode: 'or',
  };
}
