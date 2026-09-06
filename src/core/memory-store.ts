/**
 * MemoryStore — SQLite DB layer for Memory V2.
 *
 * Wraps better-sqlite3 with FTS5 full-text search, tags, relations,
 * field-level history tracking, and soft-delete/decay lifecycle.
 *
 * Schema version: 1
 */

import Database from 'better-sqlite3';
import type { Database as DatabaseType } from 'better-sqlite3';
import { types as nodeTypes } from 'node:util';
import { turkishNormalize } from './memory-normalize.js';
import { DeckentError } from './errors.js';
import {
  canonicalAcceptanceConfirmationJson,
  deriveAcceptanceConfirmationId,
  parseAcceptanceConfirmationLineage,
  type AcceptanceConfirmationLineage,
} from './acceptance-confirmation-contract.js';
import type {
  MemoryEntryV2,
  CreateEntryInput,
  EntryRelation,
  EntryHistoryRecord,
  RelationType,
  MemoryRelation,
  ChatRole,
  ChatTurn,
  ChatSessionSummary,
} from './memory-types.js';

const SCHEMA_VERSION = 1;

export interface AcceptanceRouteDebtAuthority {
  readonly tenantId: string;
  readonly projectId: string;
  readonly confirmationId: string;
  readonly lineage: AcceptanceConfirmationLineage;
}
export interface CreateAcceptanceRouteDebtInput extends AcceptanceRouteDebtAuthority {
  readonly id: string; readonly title: string; readonly content: string; readonly status: string;
  readonly priority?: string; readonly metadata?: Readonly<Record<string, unknown>>; readonly changedBy?: string;
}
export type CreateAcceptanceRouteDebtResult =
  | { readonly state: 'CREATED'; readonly entry: MemoryEntryV2 }
  | { readonly state: 'REPLAYED'; readonly entry: MemoryEntryV2 }
  | { readonly state: 'CONFLICT' };
export interface TransitionAcceptanceRouteDebtInput extends AcceptanceRouteDebtAuthority {
  readonly id: string; readonly expectedStatus: string; readonly nextStatus: string;
  readonly expectedMetadata?: Readonly<Record<string, unknown>>;
  readonly nextMetadata?: Readonly<Record<string, unknown>>; readonly changedBy?: string;
}

function acceptanceDebtMetadata(authority: AcceptanceRouteDebtAuthority, metadata?: Readonly<Record<string, unknown>>): string | null {
  const lineage = parseAcceptanceConfirmationLineage(authority.lineage);
  if (!lineage.ok || authority.tenantId !== lineage.value.tenantId
    || authority.projectId !== lineage.value.projectId
    || authority.confirmationId !== deriveAcceptanceConfirmationId(lineage.value)) return null;
  return canonicalAcceptanceConfirmationJson({
    ...(metadata ?? {}), kind: 'acceptance-route-debt', confirmationId: authority.confirmationId, lineage: lineage.value,
  });
}

// ─── Row type from SQLite (decay_exempt is INTEGER 0/1) ──────────

interface EntryRow {
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
  /** ADR taxonomy (ADR-G-019): class `G`|`D`|`UG`|`UP`. NULL for non-ADR rows. */
  adr_class: string | null;
  scope: string | null;
  immutable: number | null;
  source_authority: string | null;
  enforcement_level: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

function rowToEntry(row: EntryRow): MemoryEntryV2 {
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
    tenant_id: row.tenant_id ?? null,
    adr_class: row.adr_class ?? null,
    scope: row.scope ?? null,
    immutable: row.immutable ?? null,
    source_authority: row.source_authority ?? null,
    enforcement_level: row.enforcement_level ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
    deleted_at: row.deleted_at,
  };
}

// ─── MemoryStore class ───────────────────────────────────────────

export class MemoryStore {
  private db: DatabaseType;
  private strictTenantIsolation: boolean;

  constructor(dbPath: string, opts?: { strictTenantIsolation?: boolean; readOnly?: boolean }) {
    this.db = new Database(dbPath, opts?.readOnly
      ? { readonly: true, fileMustExist: true }
      : undefined);
    // Fail-closed by default (born-563 / P1): a NULL-tenant row must NEVER match
    // an explicit-tenantId query unless a caller deliberately opts back into the
    // legacy permissive behavior. Callers that never pass a tenantId at all
    // (the vast majority of call sites — single-tenant/tenant-unaware reads) are
    // completely unaffected either way, since no tenant clause is built for them.
    this.strictTenantIsolation = opts?.strictTenantIsolation ?? true;
    if (opts?.readOnly) {
      // Projection readers must not create/migrate/checkpoint the source database.
      // SQLite enforces this even if a caller accidentally invokes a write method.
      this.db.pragma('query_only = ON');
      this.db.pragma('busy_timeout = 5000');
      return;
    }
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    // DB-LOCK RESILIENCE (verified root cause, sprint-348): `.brain/memory.db` is a
    // shared store — a live sprint's finalizeSprint() writes retro/memory/agent-stats
    // WHILE the dashboard, `deckent review`, the auditor, and other CLI/MCP processes
    // read it concurrently (normal under the multi-tenant / enterprise law). WAL alone
    // does NOT retry on write contention: without a busy_timeout, a concurrent access
    // throws `SQLITE_BUSY: database is locked` IMMEDIATELY. In sprint-348 that lock
    // was swallowed by the finalize try/catch (sprint-phases.ts), silently dropping
    // the entire retro/memory/export/archive step (no .brain/archive/sprint-348-tasks).
    // A 5s busy_timeout makes every connection wait-and-retry instead of failing hard.
    this.db.pragma('busy_timeout = 5000');
    this.initSchema();
  }

  /** Synchronous, consistent read revision; nested calls retain the same snapshot. */
  readSnapshot<T>(reader: () => T & (T extends PromiseLike<unknown> ? never : unknown)): T {
    if (nodeTypes.isAsyncFunction(reader)) {
      throw new TypeError('MEMORY_READ_SNAPSHOT_ASYNC_UNSUPPORTED');
    }
    const queryOnly = this.db.pragma('query_only', { simple: true });
    this.db.pragma('query_only = ON');
    try {
      return this.db.transaction(reader).deferred();
    } finally {
      this.db.pragma(queryOnly ? 'query_only = ON' : 'query_only = OFF');
    }
  }

  // ── Schema initialization ────────────────────────────────────

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_version (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS entries (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        source TEXT NOT NULL DEFAULT 'system',
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        summary TEXT,
        tag_text TEXT NOT NULL DEFAULT '',
        title_norm TEXT NOT NULL DEFAULT '',
        content_norm TEXT NOT NULL DEFAULT '',
        summary_norm TEXT NOT NULL DEFAULT '',
        tag_norm TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'active',
        priority TEXT NOT NULL DEFAULT 'normal',
        sprint_id TEXT,
        sprint_num INTEGER NOT NULL DEFAULT 0,
        lang TEXT NOT NULL DEFAULT 'en',
        decay_exempt INTEGER NOT NULL DEFAULT 0,
        metadata TEXT NOT NULL DEFAULT '{}',
        tenant_id TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        deleted_at TEXT
      );

      CREATE TABLE IF NOT EXISTS tags (
        entry_id TEXT NOT NULL,
        tag TEXT NOT NULL COLLATE NOCASE,
        PRIMARY KEY (entry_id, tag),
        FOREIGN KEY (entry_id) REFERENCES entries(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS relations (
        from_id TEXT NOT NULL,
        to_id TEXT NOT NULL,
        rel_type TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (from_id, to_id, rel_type)
      );

      CREATE TABLE IF NOT EXISTS entry_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        entry_id TEXT NOT NULL,
        field TEXT NOT NULL,
        old_value TEXT,
        new_value TEXT,
        changed_by TEXT NOT NULL,
        change_type TEXT NOT NULL,
        changed_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);

    // Additive, non-destructive migrations for existing DBs (DROP/rebuild forbidden).
    // Each migration is column-existence-guarded via PRAGMA so re-opening a DB
    // is idempotent and never raises "duplicate column" errors.
    this.applyAdditiveMigrations();

    // Indexes
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_entries_type ON entries(type);
      CREATE INDEX IF NOT EXISTS idx_entries_source ON entries(source);
      CREATE INDEX IF NOT EXISTS idx_entries_sprint_num ON entries(sprint_num);
      CREATE INDEX IF NOT EXISTS idx_entries_status ON entries(status);
      CREATE INDEX IF NOT EXISTS idx_entries_decay ON entries(decay_exempt, sprint_num);
      CREATE INDEX IF NOT EXISTS idx_tags_tag ON tags(tag);
      CREATE INDEX IF NOT EXISTS idx_relations_to ON relations(to_id);
      CREATE INDEX IF NOT EXISTS idx_history_entry ON entry_history(entry_id);
    `);

    // Partial index on deleted_at where NULL (active entries)
    this.createIndexIfNotExists(
      'idx_entries_active',
      'CREATE INDEX idx_entries_active ON entries(deleted_at) WHERE deleted_at IS NULL',
    );

    // FTS5 virtual table
    this.createFts5Table();

    // FTS5 sync triggers
    this.createFtsTriggers();

    // Record schema version
    this.recordSchemaVersion();
  }

  /**
   * Idempotent ALTER TABLE migrations for `entries`. Adds columns introduced
   * after the initial schema without rebuilding the table. PRAGMA-guarded so
   * repeated calls (re-opening the same DB file) are no-ops.
   *
   * Invariant: NEVER DROP or rebuild — historical rows must survive.
   */
  private applyAdditiveMigrations(): void {
    const cols = this.db.prepare(`PRAGMA table_info(entries)`).all() as Array<{ name: string }>;
    const have = new Set(cols.map(c => c.name));

    if (!have.has('tenant_id')) {
      this.db.exec(`ALTER TABLE entries ADD COLUMN tenant_id TEXT`);
    }

    // Sprint 179 W5-12: audit HMAC chain (I4 invariant). Additive, idempotent.
    if (!have.has('audit_prev_hmac')) {
      this.db.exec(`ALTER TABLE entries ADD COLUMN audit_prev_hmac TEXT`);
    }
    if (!have.has('audit_hmac')) {
      this.db.exec(`ALTER TABLE entries ADD COLUMN audit_hmac TEXT`);
    }

    // ADR-G-019 4-layer taxonomy columns (G/D/UG/UP). Additive, idempotent.
    // NULL for non-ADR rows. Stores ADR class/scope/immutability for class-aware recall.
    if (!have.has('adr_class')) {
      this.db.exec(`ALTER TABLE entries ADD COLUMN adr_class TEXT`);
    }
    if (!have.has('scope')) {
      this.db.exec(`ALTER TABLE entries ADD COLUMN scope TEXT`);
    }
    if (!have.has('immutable')) {
      this.db.exec(`ALTER TABLE entries ADD COLUMN immutable INTEGER`);
    }
    if (!have.has('source_authority')) {
      this.db.exec(`ALTER TABLE entries ADD COLUMN source_authority TEXT`);
    }
    if (!have.has('enforcement_level')) {
      this.db.exec(`ALTER TABLE entries ADD COLUMN enforcement_level TEXT`);
    }
  }

  private createIndexIfNotExists(name: string, ddl: string): void {
    const exists = this.db.prepare(
      `SELECT 1 FROM sqlite_master WHERE type='index' AND name=?`,
    ).get(name) as { 1: number } | undefined;
    if (!exists) {
      this.db.exec(ddl);
    }
  }

  private createFts5Table(): void {
    const exists = this.db.prepare(
      `SELECT 1 FROM sqlite_master WHERE type='table' AND name='entries_fts'`,
    ).get() as { 1: number } | undefined;
    if (!exists) {
      this.db.exec(`
        CREATE VIRTUAL TABLE entries_fts USING fts5(
          title, content, summary, tag_text,
          title_norm, content_norm, summary_norm, tag_norm,
          content='entries',
          content_rowid='rowid',
          tokenize='unicode61 remove_diacritics 2'
        );
      `);
    }
  }

  private createFtsTriggers(): void {
    const triggerNames = [
      'entries_ai',  // after insert
      'entries_ad',  // after delete
      'entries_au',  // after update
    ];

    for (const name of triggerNames) {
      const exists = this.db.prepare(
        `SELECT 1 FROM sqlite_master WHERE type='trigger' AND name=?`,
      ).get(name) as { 1: number } | undefined;
      if (exists) continue;

      if (name === 'entries_ai') {
        this.db.exec(`
          CREATE TRIGGER entries_ai AFTER INSERT ON entries BEGIN
            INSERT INTO entries_fts(rowid, title, content, summary, tag_text,
              title_norm, content_norm, summary_norm, tag_norm)
            VALUES (new.rowid, new.title, new.content, new.summary, new.tag_text,
              new.title_norm, new.content_norm, new.summary_norm, new.tag_norm);
          END;
        `);
      } else if (name === 'entries_ad') {
        this.db.exec(`
          CREATE TRIGGER entries_ad AFTER DELETE ON entries BEGIN
            INSERT INTO entries_fts(entries_fts, rowid, title, content, summary, tag_text,
              title_norm, content_norm, summary_norm, tag_norm)
            VALUES ('delete', old.rowid, old.title, old.content, old.summary, old.tag_text,
              old.title_norm, old.content_norm, old.summary_norm, old.tag_norm);
          END;
        `);
      } else if (name === 'entries_au') {
        this.db.exec(`
          CREATE TRIGGER entries_au AFTER UPDATE ON entries BEGIN
            INSERT INTO entries_fts(entries_fts, rowid, title, content, summary, tag_text,
              title_norm, content_norm, summary_norm, tag_norm)
            VALUES ('delete', old.rowid, old.title, old.content, old.summary, old.tag_text,
              old.title_norm, old.content_norm, old.summary_norm, old.tag_norm);
            INSERT INTO entries_fts(rowid, title, content, summary, tag_text,
              title_norm, content_norm, summary_norm, tag_norm)
            VALUES (new.rowid, new.title, new.content, new.summary, new.tag_text,
              new.title_norm, new.content_norm, new.summary_norm, new.tag_norm);
          END;
        `);
      }
    }
  }

  private recordSchemaVersion(): void {
    const existing = this.db.prepare(
      `SELECT version FROM schema_version WHERE version = ?`,
    ).get(SCHEMA_VERSION) as { version: number } | undefined;
    if (!existing) {
      this.db.prepare(
        `INSERT INTO schema_version (version, applied_at) VALUES (?, datetime('now'))`,
      ).run(SCHEMA_VERSION);
    }
  }

  // ── CRUD ─────────────────────────────────────────────────────

  insert(input: CreateEntryInput): void {
    const source = input.source ?? 'system';
    const summary = input.summary ?? null;
    const tags = input.tags ?? [];
    const status = input.status ?? 'active';
    const priority = input.priority ?? 'normal';
    const sprintId = input.sprint_id ?? null;
    const sprintNum = input.sprint_num ?? 0;
    const lang = input.lang ?? 'en';
    const decayExempt = input.decay_exempt ? 1 : 0;
    const metadata = JSON.stringify(input.metadata ?? {});
    const tenantId = input.tenant_id ?? null;
    const adrClass = input.adr_class ?? null;
    const adrScope = input.scope ?? null;
    const immutable = input.immutable == null ? null : (input.immutable ? 1 : 0);
    const sourceAuthority = input.source_authority ?? null;
    const enforcementLevel = input.enforcement_level ?? null;
    const relations = input.relations ?? [];

    const tagText = tags.join(' ');
    const titleNorm = turkishNormalize(input.title);
    const contentNorm = turkishNormalize(input.content);
    const summaryNorm = turkishNormalize(summary ?? '');
    const tagNorm = turkishNormalize(tagText);

    const insertEntry = this.db.prepare(`
      INSERT INTO entries (
        id, type, source, title, content, summary,
        tag_text, title_norm, content_norm, summary_norm, tag_norm,
        status, priority, sprint_id, sprint_num, lang,
        decay_exempt, metadata, tenant_id,
        adr_class, scope, immutable, source_authority, enforcement_level
      ) VALUES (
        @id, @type, @source, @title, @content, @summary,
        @tag_text, @title_norm, @content_norm, @summary_norm, @tag_norm,
        @status, @priority, @sprint_id, @sprint_num, @lang,
        @decay_exempt, @metadata, @tenant_id,
        @adr_class, @scope, @immutable, @source_authority, @enforcement_level
      )
    `);

    const insertTag = this.db.prepare(
      `INSERT INTO tags (entry_id, tag) VALUES (?, ?)`,
    );

    const insertRelation = this.db.prepare(
      `INSERT OR IGNORE INTO relations (from_id, to_id, rel_type) VALUES (?, ?, ?)`,
    );

    const insertHistory = this.db.prepare(`
      INSERT INTO entry_history (entry_id, field, old_value, new_value, changed_by, change_type)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    const txn = this.db.transaction(() => {
      insertEntry.run({
        id: input.id,
        type: input.type,
        source,
        title: input.title,
        content: input.content,
        summary,
        tag_text: tagText,
        title_norm: titleNorm,
        content_norm: contentNorm,
        summary_norm: summaryNorm,
        tag_norm: tagNorm,
        status,
        priority,
        sprint_id: sprintId,
        sprint_num: sprintNum,
        lang,
        decay_exempt: decayExempt,
        metadata,
        tenant_id: tenantId,
        adr_class: adrClass,
        scope: adrScope,
        immutable,
        source_authority: sourceAuthority,
        enforcement_level: enforcementLevel,
      });

      for (const tag of tags) {
        insertTag.run(input.id, tag);
      }

      for (const rel of relations) {
        insertRelation.run(input.id, rel.to_id, rel.rel_type);
      }

      // Auto-extract ADR references from content + title
      const adrRefs = MemoryStore.extractAdrReferences(input.content + ' ' + input.title);
      for (const adrId of adrRefs) {
        // Don't self-reference
        if (adrId !== input.id) {
          insertRelation.run(input.id, adrId, 'references');
        }
      }

      // Record create history
      insertHistory.run(input.id, '*', null, null, 'system', 'create');
    });

    txn();
  }

  upsert(input: CreateEntryInput, changedBy: string): void {
    const existing = this.db.prepare(
      `SELECT * FROM entries WHERE id = ?`,
    ).get(input.id) as EntryRow | undefined;

    if (!existing) {
      this.insert(input);
      return;
    }

    // Compute new values
    const source = input.source ?? 'system';
    const summary = input.summary ?? null;
    const tags = input.tags ?? [];
    const status = input.status ?? 'active';
    const priority = input.priority ?? 'normal';
    const sprintId = input.sprint_id ?? null;
    const sprintNum = input.sprint_num ?? 0;
    const lang = input.lang ?? 'en';
    const decayExempt = input.decay_exempt ? 1 : 0;
    const metadata = JSON.stringify(input.metadata ?? {});
    const tenantId = input.tenant_id ?? null;

    // ADR-G-019 taxonomy columns — protect-by-omission: a caller that upserts
    // without these fields (e.g. a generic title/content patch) must NOT erase
    // existing classification. Only overwrite when the caller explicitly supplies
    // a value; otherwise carry the existing row's value forward untouched.
    const adrClass = input.adr_class !== undefined ? input.adr_class : existing.adr_class;
    const adrScope = input.scope !== undefined ? input.scope : existing.scope;
    const immutable = input.immutable !== undefined
      ? (input.immutable ? 1 : 0)
      : existing.immutable;
    const sourceAuthority = input.source_authority !== undefined ? input.source_authority : existing.source_authority;
    const enforcementLevel = input.enforcement_level !== undefined ? input.enforcement_level : existing.enforcement_level;

    const tagText = tags.join(' ');
    const titleNorm = turkishNormalize(input.title);
    const contentNorm = turkishNormalize(input.content);
    const summaryNorm = turkishNormalize(summary ?? '');
    const tagNorm = turkishNormalize(tagText);

    // Build diff of changed fields
    const diffs: Array<{ field: string; oldVal: string | null; newVal: string | null }> = [];

    const fieldMap: Array<[string, string | number | null, string | number | null]> = [
      ['type', existing.type, input.type],
      ['source', existing.source, source],
      ['title', existing.title, input.title],
      ['content', existing.content, input.content],
      ['summary', existing.summary, summary],
      ['tag_text', existing.tag_text, tagText],
      ['status', existing.status, status],
      ['priority', existing.priority, priority],
      ['sprint_id', existing.sprint_id, sprintId],
      ['sprint_num', existing.sprint_num, sprintNum],
      ['lang', existing.lang, lang],
      ['decay_exempt', existing.decay_exempt, decayExempt],
      ['metadata', existing.metadata, metadata],
      ['tenant_id', existing.tenant_id, tenantId],
      ['adr_class', existing.adr_class, adrClass],
      ['scope', existing.scope, adrScope],
      ['immutable', existing.immutable, immutable],
      ['source_authority', existing.source_authority, sourceAuthority],
      ['enforcement_level', existing.enforcement_level, enforcementLevel],
    ];

    for (const [field, oldVal, newVal] of fieldMap) {
      const oldStr = oldVal === null ? null : String(oldVal);
      const newStr = newVal === null ? null : String(newVal);
      if (oldStr !== newStr) {
        diffs.push({ field, oldVal: oldStr, newVal: newStr });
      }
    }

    const updateEntry = this.db.prepare(`
      UPDATE entries SET
        type = @type,
        source = @source,
        title = @title,
        content = @content,
        summary = @summary,
        tag_text = @tag_text,
        title_norm = @title_norm,
        content_norm = @content_norm,
        summary_norm = @summary_norm,
        tag_norm = @tag_norm,
        status = @status,
        priority = @priority,
        sprint_id = @sprint_id,
        sprint_num = @sprint_num,
        lang = @lang,
        decay_exempt = @decay_exempt,
        metadata = @metadata,
        tenant_id = @tenant_id,
        adr_class = @adr_class,
        scope = @scope,
        immutable = @immutable,
        source_authority = @source_authority,
        enforcement_level = @enforcement_level,
        updated_at = datetime('now')
      WHERE id = @id
    `);

    const deleteTags = this.db.prepare(`DELETE FROM tags WHERE entry_id = ?`);
    const insertTag = this.db.prepare(`INSERT INTO tags (entry_id, tag) VALUES (?, ?)`);
    const insertHistory = this.db.prepare(`
      INSERT INTO entry_history (entry_id, field, old_value, new_value, changed_by, change_type)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    const txn = this.db.transaction(() => {
      updateEntry.run({
        id: input.id,
        type: input.type,
        source,
        title: input.title,
        content: input.content,
        summary,
        tag_text: tagText,
        title_norm: titleNorm,
        content_norm: contentNorm,
        summary_norm: summaryNorm,
        tag_norm: tagNorm,
        status,
        priority,
        sprint_id: sprintId,
        sprint_num: sprintNum,
        lang,
        decay_exempt: decayExempt,
        metadata,
        tenant_id: tenantId,
        adr_class: adrClass,
        scope: adrScope,
        immutable,
        source_authority: sourceAuthority,
        enforcement_level: enforcementLevel,
      });

      // Replace tags
      deleteTags.run(input.id);
      for (const tag of tags) {
        insertTag.run(input.id, tag);
      }

      // Record field-level history for each changed field
      for (const diff of diffs) {
        insertHistory.run(input.id, diff.field, diff.oldVal, diff.newVal, changedBy, 'update');
      }
    });

    txn();
  }

  /**
   * Atomic upsert of the canonical `sprint-log-<num>` entry. Single-call
   * API used by sprint finalize (defensive fallback) and by the
   * `scripts/backfill-sprint-log-rows.mjs` reconstruction tool. When a
   * row already exists the call updates fields via {@link upsert}; when
   * absent it inserts a fresh row. Returns the canonical entry id so
   * callers can chain relations / audit writes.
   *
   * Sprint 198 198-002 — closes the chronic gap surfaced in Sprint 197
   * 197-002 (sprint-log-194 + sprint-log-196 missing) where a thrown
   * exception in metrics/retro paths left the DB without a sprint row
   * while the file-side sprint log was already on disk.
   */
  upsertSprintLog(
    sprintId: string,
    payload: {
      content?: string;
      title?: string;
      totalTasks?: number;
      durationMs?: number;
      extraTags?: string[];
      source?: string;
      changedBy?: string;
    } = {},
  ): string {
    const sprintNum = parseInt(sprintId.replace(/\D/g, ''), 10) || 0;
    const id = `sprint-log-${sprintNum}`;
    const title = payload.title ?? `Sprint ${sprintId}`;
    const baseTags = ['sprint', sprintId];
    const tags = payload.extraTags && payload.extraTags.length > 0
      ? Array.from(new Set([...baseTags, ...payload.extraTags]))
      : baseTags;

    let content = payload.content;
    if (!content || content.length === 0) {
      const lines: string[] = [`# ${sprintId}`, ''];
      if (typeof payload.totalTasks === 'number') {
        lines.push(`- Total tasks: ${payload.totalTasks}`);
      }
      if (typeof payload.durationMs === 'number') {
        lines.push(`- Duration: ${payload.durationMs}ms`);
      }
      lines.push('- Backfilled via upsertSprintLog');
      content = lines.join('\n');
    }

    this.upsert({
      id,
      type: 'sprint',
      title,
      content,
      source: (payload.source ?? 'brain') as CreateEntryInput['source'],
      sprint_id: sprintId,
      sprint_num: sprintNum,
      status: 'active',
      tags,
    }, payload.changedBy ?? 'brain');

    return id;
  }

  update(
    id: string,
    fields: Partial<{
      content: string;
      title: string;
      summary: string;
      metadata: string;
      status: string;
      priority: string;
      decay_exempt: number;
    }>,
    changedBy = 'system',
  ): void {
    const existing = this.db.prepare(
      `SELECT * FROM entries WHERE id = ? AND deleted_at IS NULL`,
    ).get(id) as EntryRow | undefined;
    if (!existing) return;

    const sets: string[] = [`updated_at = datetime('now')`];
    const params: Record<string, string | number | null> = { id };
    const diffs: Array<{ field: string; oldVal: string | null; newVal: string | null }> = [];

    if (fields.content !== undefined) {
      sets.push('content = @content', 'content_norm = @content_norm');
      params.content = fields.content;
      params.content_norm = turkishNormalize(fields.content);
      if (existing.content !== fields.content) {
        diffs.push({ field: 'content', oldVal: existing.content, newVal: fields.content });
      }
    }
    if (fields.title !== undefined) {
      sets.push('title = @title', 'title_norm = @title_norm');
      params.title = fields.title;
      params.title_norm = turkishNormalize(fields.title);
      if (existing.title !== fields.title) {
        diffs.push({ field: 'title', oldVal: existing.title, newVal: fields.title });
      }
    }
    if (fields.summary !== undefined) {
      sets.push('summary = @summary', 'summary_norm = @summary_norm');
      params.summary = fields.summary;
      params.summary_norm = turkishNormalize(fields.summary);
      if (existing.summary !== fields.summary) {
        diffs.push({ field: 'summary', oldVal: existing.summary ?? null, newVal: fields.summary });
      }
    }
    if (fields.metadata !== undefined) {
      sets.push('metadata = @metadata');
      params.metadata = fields.metadata;
      if (existing.metadata !== fields.metadata) {
        diffs.push({ field: 'metadata', oldVal: existing.metadata ?? null, newVal: fields.metadata });
      }
    }
    if (fields.status !== undefined) {
      sets.push('status = @status');
      params.status = fields.status;
      if (existing.status !== fields.status) {
        diffs.push({ field: 'status', oldVal: existing.status, newVal: fields.status });
      }
    }
    if (fields.priority !== undefined) {
      sets.push('priority = @priority');
      params.priority = fields.priority;
      if (existing.priority !== fields.priority) {
        diffs.push({ field: 'priority', oldVal: existing.priority, newVal: fields.priority });
      }
    }
    if (fields.decay_exempt !== undefined) {
      sets.push('decay_exempt = @decay_exempt');
      params.decay_exempt = fields.decay_exempt;
      if (String(existing.decay_exempt) !== String(fields.decay_exempt)) {
        diffs.push({ field: 'decay_exempt', oldVal: String(existing.decay_exempt), newVal: String(fields.decay_exempt) });
      }
    }

    const insertHistory = this.db.prepare(`
      INSERT INTO entry_history (entry_id, field, old_value, new_value, changed_by, change_type)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    this.db.transaction(() => {
      this.db.prepare(`UPDATE entries SET ${sets.join(', ')} WHERE id = @id`).run(params);
      for (const diff of diffs) {
        insertHistory.run(id, diff.field, diff.oldVal, diff.newVal, changedBy, 'patch');
      }
    })();
  }

  /**
   * Atomically transition a debt row owned by one tenant.
   *
   * The expected status is the compare-and-swap token. Both the read and the
   * conditional update execute in the same SQLite transaction; tenant_id is
   * only a predicate and is never assigned, so a transition cannot move or
   * downgrade a tenant-owned row.
   */
  updateDebtStatusCas(
    id: string,
    tenantId: string,
    expectedStatus: string,
    nextStatus: string,
    changedBy = 'system',
  ): boolean {
    if (tenantId.length === 0) return false;

    const selectDebt = this.db.prepare(`
      SELECT * FROM entries
      WHERE id = ? AND type = 'debt' AND tenant_id = ? AND deleted_at IS NULL
    `);
    const updateDebt = this.db.prepare(`
      UPDATE entries
      SET status = ?, updated_at = datetime('now')
      WHERE id = ? AND type = 'debt' AND tenant_id = ?
        AND status = ? AND deleted_at IS NULL
    `);
    const insertHistory = this.db.prepare(`
      INSERT INTO entry_history (entry_id, field, old_value, new_value, changed_by, change_type)
      VALUES (?, 'status', ?, ?, ?, 'patch')
    `);

    return this.db.transaction(() => {
      const existing = selectDebt.get(id, tenantId) as EntryRow | undefined;
      if (!existing || existing.status !== expectedStatus) return false;
      if (expectedStatus === nextStatus) return true;

      const result = updateDebt.run(nextStatus, id, tenantId, expectedStatus);
      if (result.changes !== 1) return false;
      insertHistory.run(id, expectedStatus, nextStatus, changedBy);
      return true;
    })();
  }

  /** Tenant/project/confirmation-bound first-writer-wins acceptance debt creation. */
  createAcceptanceRouteDebtFww(input: CreateAcceptanceRouteDebtInput): CreateAcceptanceRouteDebtResult {
    if (!input.id || !input.title || !input.content || !input.status || !input.tenantId) return { state: 'CONFLICT' };
    const metadata = acceptanceDebtMetadata(input, input.metadata);
    if (metadata === null) return { state: 'CONFLICT' };
    const transact = this.db.transaction((): CreateAcceptanceRouteDebtResult => {
      const existing = this.db.prepare(`SELECT * FROM entries WHERE id = ?`).get(input.id) as EntryRow | undefined;
      if (existing) {
        const exact = existing.type === 'debt' && existing.tenant_id === input.tenantId
          && existing.title === input.title && existing.content === input.content
          && existing.status === input.status && existing.priority === (input.priority ?? 'normal')
          && existing.metadata === metadata && existing.deleted_at === null;
        return exact ? { state: 'REPLAYED', entry: rowToEntry(existing) } : { state: 'CONFLICT' };
      }
      this.insert({ id: input.id, type: 'debt', title: input.title, content: input.content,
        source: 'brain', status: input.status, priority: input.priority, tenant_id: input.tenantId,
        metadata: JSON.parse(metadata) as Record<string, unknown> });
      if (input.changedBy && input.changedBy !== 'system') {
        this.db.prepare(`UPDATE entry_history SET changed_by = ? WHERE entry_id = ? AND change_type = 'create'`)
          .run(input.changedBy, input.id);
      }
      const created = this.db.prepare(`SELECT * FROM entries WHERE id = ?`).get(input.id) as EntryRow;
      return { state: 'CREATED', entry: rowToEntry(created) };
    });
    return transact.immediate();
  }

  /** Atomically compare and swap status plus metadata, with history in the same transaction. */
  transitionAcceptanceRouteDebtCas(input: TransitionAcceptanceRouteDebtInput): boolean {
    if (!input.id || !input.tenantId || !input.expectedStatus || !input.nextStatus) return false;
    const expectedMetadata = acceptanceDebtMetadata(input, input.expectedMetadata);
    const nextMetadata = acceptanceDebtMetadata(input, input.nextMetadata ?? input.expectedMetadata);
    if (expectedMetadata === null || nextMetadata === null) return false;
    const update = this.db.prepare(`
      UPDATE entries SET status = ?, metadata = ?, updated_at = datetime('now')
      WHERE id = ? AND type = 'debt' AND tenant_id = ? AND status = ? AND metadata = ? AND deleted_at IS NULL
        AND json_extract(metadata, '$.confirmationId') = ?
        AND json_extract(metadata, '$.lineage.tenantId') = ? AND json_extract(metadata, '$.lineage.projectId') = ?
        AND json_extract(metadata, '$.lineage.attemptId') = ? AND json_extract(metadata, '$.lineage.generation') = ?
        AND json_extract(metadata, '$.lineage.resultDigest') = ? AND json_extract(metadata, '$.lineage.policyDigest') = ?
        AND json_extract(metadata, '$.lineage.sourceDigest') = ?
    `);
    const history = this.db.prepare(`INSERT INTO entry_history
      (entry_id, field, old_value, new_value, changed_by, change_type) VALUES (?, ?, ?, ?, ?, 'patch')`);
    const transact = this.db.transaction(() => {
      if (input.expectedStatus === input.nextStatus && expectedMetadata === nextMetadata) {
        return this.db.prepare(`SELECT 1 FROM entries WHERE id = ? AND type = 'debt' AND tenant_id = ?
          AND status = ? AND metadata = ? AND deleted_at IS NULL`)
          .get(input.id, input.tenantId, input.expectedStatus, expectedMetadata) !== undefined;
      }
      const lineage = input.lineage;
      const result = update.run(input.nextStatus, nextMetadata, input.id, input.tenantId,
        input.expectedStatus, expectedMetadata, input.confirmationId, input.tenantId, input.projectId,
        lineage.attemptId, lineage.generation, lineage.resultDigest, lineage.policyDigest, lineage.sourceDigest);
      if (result.changes !== 1) return false;
      const changedBy = input.changedBy ?? 'system';
      if (input.expectedStatus !== input.nextStatus) history.run(input.id, 'status', input.expectedStatus, input.nextStatus, changedBy);
      if (expectedMetadata !== nextMetadata) history.run(input.id, 'metadata', expectedMetadata, nextMetadata, changedBy);
      return true;
    });
    return transact.immediate();
  }

  getById(id: string, opts?: { includeDeleted?: boolean; tenantId?: string }): MemoryEntryV2 | null {
    const includeDeleted = opts?.includeDeleted ?? false;
    const tenantId = opts?.tenantId;
    let sql: string;
    const params: unknown[] = [id];

    if (tenantId !== undefined) {
      const deletedClause = includeDeleted ? '' : ' AND deleted_at IS NULL';
      // Fail-closed by default (born-563): only the requesting tenant's own rows
      // match. Pass strictTenantIsolation=false to the constructor to opt back
      // into the legacy permissive behavior (NULL-tenant rows also match), e.g.
      // for a deliberately tenant-unaware legacy/global read path.
      const tenantClause = this.strictTenantIsolation
        ? ' AND tenant_id = ?'
        : ' AND (tenant_id = ? OR tenant_id IS NULL)';
      sql = `SELECT * FROM entries WHERE id = ?${deletedClause}${tenantClause}`;
      params.push(tenantId);
    } else {
      sql = includeDeleted
        ? `SELECT * FROM entries WHERE id = ?`
        : `SELECT * FROM entries WHERE id = ? AND deleted_at IS NULL`;
    }

    const row = this.db.prepare(sql).get(...params) as EntryRow | undefined;
    return row ? rowToEntry(row) : null;
  }

  /**
   * `filters` (ADR-G-019 taxonomy, class-aware recall): optional `adr_class`/`scope`
   * equality filters, appended as additional AND clauses. Omitted (default) →
   * SQL text is unchanged from pre-taxonomy behavior — byte-identical for all
   * existing call sites.
   */
  getByType(
    type: string,
    tenantId?: string,
    filters?: { adr_class?: string; scope?: string },
  ): MemoryEntryV2[] {
    const extraClauses: string[] = [];
    const extraParams: unknown[] = [];
    if (filters?.adr_class !== undefined) {
      extraClauses.push('adr_class = ?');
      extraParams.push(filters.adr_class);
    }
    if (filters?.scope !== undefined) {
      extraClauses.push('scope = ?');
      extraParams.push(filters.scope);
    }
    const extraSql = extraClauses.length > 0 ? ` AND ${extraClauses.join(' AND ')}` : '';

    let rows: EntryRow[];
    if (tenantId !== undefined) {
      // Fail-closed by default (born-563): only the requesting tenant's own rows
      // match. Pass strictTenantIsolation=false to the constructor to opt back
      // into the legacy permissive behavior (NULL-tenant rows also match), e.g.
      // for a deliberately tenant-unaware legacy/global read path.
      const tenantClause = this.strictTenantIsolation
        ? 'tenant_id = ?'
        : '(tenant_id = ? OR tenant_id IS NULL)';
      rows = this.db.prepare(
        `SELECT * FROM entries WHERE type = ? AND deleted_at IS NULL AND ${tenantClause}${extraSql} ORDER BY sprint_num DESC`,
      ).all(type, tenantId, ...extraParams) as EntryRow[];
    } else {
      rows = this.db.prepare(
        `SELECT * FROM entries WHERE type = ? AND deleted_at IS NULL${extraSql} ORDER BY sprint_num DESC`,
      ).all(type, ...extraParams) as EntryRow[];
    }
    return rows.map(rowToEntry);
  }

  // ── Tags ─────────────────────────────────────────────────────

  getTagsForEntry(entryId: string): string[] {
    const rows = this.db.prepare(
      `SELECT tag FROM tags WHERE entry_id = ?`,
    ).all(entryId) as Array<{ tag: string }>;
    return rows.map(r => r.tag);
  }

  getByTags(tags: string[], tenantId?: string): MemoryEntryV2[] {
    if (tags.length === 0) return [];
    const placeholders = tags.map(() => '?').join(', ');
    let rows: EntryRow[];
    if (tenantId !== undefined) {
      // Fail-closed by default (born-563): only the requesting tenant's own rows
      // match. Pass strictTenantIsolation=false to the constructor to opt back
      // into the legacy permissive behavior (NULL-tenant rows also match), e.g.
      // for a deliberately tenant-unaware legacy/global read path.
      const tenantClause = this.strictTenantIsolation
        ? 'e.tenant_id = ?'
        : '(e.tenant_id = ? OR e.tenant_id IS NULL)';
      rows = this.db.prepare(`
        SELECT DISTINCT e.* FROM entries e
        INNER JOIN tags t ON e.id = t.entry_id
        WHERE t.tag IN (${placeholders})
          AND e.deleted_at IS NULL
          AND ${tenantClause}
      `).all(...tags, tenantId) as EntryRow[];
    } else {
      rows = this.db.prepare(`
        SELECT DISTINCT e.* FROM entries e
        INNER JOIN tags t ON e.id = t.entry_id
        WHERE t.tag IN (${placeholders})
          AND e.deleted_at IS NULL
      `).all(...tags) as EntryRow[];
    }
    return rows.map(rowToEntry);
  }

  // ── Relations ────────────────────────────────────────────────

  getRelationsFrom(entryId: string): EntryRelation[] {
    const rows = this.db.prepare(
      `SELECT * FROM relations WHERE from_id = ?`,
    ).all(entryId) as Array<{ from_id: string; to_id: string; rel_type: RelationType; created_at: string }>;
    return rows.map((r) => ({ ...r, type: r.rel_type }));
  }

  getRelationsTo(entryId: string): EntryRelation[] {
    const rows = this.db.prepare(
      `SELECT * FROM relations WHERE to_id = ?`,
    ).all(entryId) as Array<{ from_id: string; to_id: string; rel_type: RelationType; created_at: string }>;
    return rows.map((r) => ({ ...r, type: r.rel_type }));
  }

  /**
   * Insert a single relation between two entries.
   * Uses INSERT OR IGNORE to avoid duplicates.
   *
   * Overload 1 (positional): backward-compatible for existing call sites.
   * Overload 2 (object form): MADR v3 MemoryRelation — performs FK validation.
   */
  insertRelation(fromId: string, toId: string, relType: RelationType): void;
  insertRelation(rel: MemoryRelation): void;
  insertRelation(
    fromIdOrRel: string | MemoryRelation,
    toId?: string,
    relType?: RelationType,
  ): void {
    let fromId: string;
    let resolvedToId: string;
    let resolvedRelType: RelationType;

    if (typeof fromIdOrRel === 'object') {
      // Object form — validate FK before insert
      fromId = fromIdOrRel.from_id;
      resolvedToId = fromIdOrRel.to_id;
      resolvedRelType = fromIdOrRel.type;

      const fromExists = this.db.prepare(
        `SELECT 1 FROM entries WHERE id = ?`,
      ).get(fromId);
      if (!fromExists) {
        throw new DeckentError('DECKENT_E068', `Orphan relation: from_id '${fromId}' not found in entries`);
      }

      const toExists = this.db.prepare(
        `SELECT 1 FROM entries WHERE id = ?`,
      ).get(resolvedToId);
      if (!toExists) {
        throw new DeckentError('DECKENT_E069', `Orphan relation: to_id '${resolvedToId}' not found in entries`);
      }
    } else {
      fromId = fromIdOrRel;
      resolvedToId = toId!;
      resolvedRelType = relType!;
    }

    this.db.prepare(
      `INSERT OR IGNORE INTO relations (from_id, to_id, rel_type) VALUES (?, ?, ?)`,
    ).run(fromId, resolvedToId, resolvedRelType);
  }

  /**
   * Get all relations for an entry (both from and to directions).
   * Returns a combined array of EntryRelation with both rel_type and type alias.
   */
  getRelations(entryId: string): EntryRelation[] {
    const rows = this.db.prepare(
      `SELECT * FROM relations WHERE from_id = ? OR to_id = ?`,
    ).all(entryId, entryId) as Array<{ from_id: string; to_id: string; rel_type: RelationType; created_at: string }>;
    return rows.map((r) => ({ ...r, type: r.rel_type }));
  }

  /**
   * Get total count of relations in the database.
   */
  countRelations(): number {
    const row = this.db.prepare(
      `SELECT COUNT(*) as cnt FROM relations`,
    ).get() as { cnt: number };
    return row.cnt;
  }

  /**
   * Extract ADR references from text content.
   * Matches patterns like ADR-001, ADR-039, etc.
   * Returns normalized IDs like 'adr-001'.
   */
  static extractAdrReferences(text: string): string[] {
    const matches = text.match(/\bADR-(\d{3})\b/g);
    if (!matches) return [];
    const unique = new Set(matches.map(m => m.toLowerCase()));
    return [...unique];
  }

  // ── History ──────────────────────────────────────────────────

  getHistory(entryId: string): EntryHistoryRecord[] {
    return this.db.prepare(
      `SELECT * FROM entry_history WHERE entry_id = ? ORDER BY id ASC`,
    ).all(entryId) as EntryHistoryRecord[];
  }

  // ── Lifecycle ────────────────────────────────────────────────

  softDelete(id: string, changedBy: string): void {
    const txn = this.db.transaction(() => {
      this.db.prepare(
        `UPDATE entries SET deleted_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`,
      ).run(id);
      this.db.prepare(`
        INSERT INTO entry_history (entry_id, field, old_value, new_value, changed_by, change_type)
        VALUES (?, 'deleted_at', NULL, datetime('now'), ?, 'soft_delete')
      `).run(id, changedBy);
    });
    txn();
  }

  restore(id: string, changedBy: string): void {
    const txn = this.db.transaction(() => {
      this.db.prepare(
        `UPDATE entries SET deleted_at = NULL, updated_at = datetime('now') WHERE id = ?`,
      ).run(id);
      this.db.prepare(`
        INSERT INTO entry_history (entry_id, field, old_value, new_value, changed_by, change_type)
        VALUES (?, 'deleted_at', datetime('now'), NULL, ?, 'restore')
      `).run(id, changedBy);
    });
    txn();
  }

  decay(
    currentSprintNum: number,
    decayAfterSprints: number,
  ): { deletedCount: number; aborted?: boolean } {
    const threshold = currentSprintNum - decayAfterSprints;

    // Catastrophic-decay guard parameters ([[feedback_db_silmek_yasak]]):
    // If a single decay batch would wipe more than CATASTROPHIC_RATIO of all
    // non-exempt active entries — and the batch is itself large enough to be
    // "catastrophic" (>= CATASTROPHIC_BATCH_MIN) — abort, warn, and preserve.
    // Floor=3: batches of 1-2 entries are never catastrophic regardless of DB size;
    // batches of 3+ that exceed 50% of non-exempt entries abort (small DB included).
    const CATASTROPHIC_BATCH_MIN = 3;
    const CATASTROPHIC_RATIO = 0.5; // >= 0.5 → abort (boundary-inclusive, defensive)

    // Total non-exempt active entries (denominator for catastrophic ratio).
    const nonExemptTotal = (this.db.prepare(`
      SELECT COUNT(*) as cnt FROM entries
      WHERE decay_exempt = 0 AND deleted_at IS NULL
    `).get() as { cnt: number }).cnt;

    // Find entries to decay. Two safety conditions vs the original filter:
    //   1. `sprint_num < threshold` keeps the window boundary intact —
    //      entries with sprint_num >= (currentSprintNum - decayAfterSprints)
    //      stay alive (within retention window).
    //   2. `sprint_num > 0` is a skipDelete guard: entries with the schema
    //      default (sprint_num=0, i.e. inserted without a sprint number or
    //      unparseable) are PRESERVED — we never default-delete undated rows.
    const toDecay = this.db.prepare(`
      SELECT id FROM entries
      WHERE sprint_num < ?
        AND sprint_num > 0
        AND decay_exempt = 0
        AND deleted_at IS NULL
    `).all(threshold) as Array<{ id: string }>;

    if (toDecay.length === 0) return { deletedCount: 0 };

    // Catastrophic-decay guard: refuse a single batch that would wipe more
    // than half of all non-exempt entries (only when the batch is itself
    // large enough to be "catastrophic"). Preserves historical learnings on
    // accidental misconfiguration / parse drift.
    if (
      toDecay.length >= CATASTROPHIC_BATCH_MIN &&
      nonExemptTotal > 0 &&
      toDecay.length / nonExemptTotal >= CATASTROPHIC_RATIO
    ) {
      const pct = ((toDecay.length / nonExemptTotal) * 100).toFixed(1);

      console.warn(
        `[memory-store] decay aborted: catastrophic batch ` +
        `(${toDecay.length}/${nonExemptTotal} = ${pct}% >= ` +
        `${CATASTROPHIC_RATIO * 100}% threshold) — entries preserved`,
      );
      return { deletedCount: 0, aborted: true };
    }

    const updateStmt = this.db.prepare(
      `UPDATE entries SET deleted_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`,
    );
    const historyStmt = this.db.prepare(`
      INSERT INTO entry_history (entry_id, field, old_value, new_value, changed_by, change_type)
      VALUES (?, 'deleted_at', NULL, datetime('now'), 'decay', 'decay')
    `);

    const txn = this.db.transaction(() => {
      for (const row of toDecay) {
        updateStmt.run(row.id);
        historyStmt.run(row.id);
      }
    });

    txn();
    return { deletedCount: toDecay.length };
  }

  // ── Counts ───────────────────────────────────────────────────

  countByType(): Map<string, number> {
    const rows = this.db.prepare(`
      SELECT type, COUNT(*) as cnt FROM entries WHERE deleted_at IS NULL GROUP BY type
    `).all() as Array<{ type: string; cnt: number }>;
    const map = new Map<string, number>();
    for (const row of rows) {
      map.set(row.type, row.cnt);
    }
    return map;
  }

  totalCount(): number {
    const row = this.db.prepare(
      `SELECT COUNT(*) as cnt FROM entries WHERE deleted_at IS NULL`,
    ).get() as { cnt: number };
    return row.cnt;
  }

  // ── Audit HMAC chain (Sprint 179 W5-12, I4 invariant) ──────────

  /**
   * Insert an audit entry that participates in the append-only HMAC chain.
   * The caller is responsible for computing `prevHmac` (last row's hmac, or
   * null for genesis) and `hmac` via `computeAuditHmac()`. We persist them
   * verbatim — verify-side recomputation lives in `audit-integrity.ts`.
   *
   * Note: `type` is forced to `'audit'` to keep the chain coherent.
   */
  insertAuditWithHmac(
    input: CreateEntryInput,
    prevHmac: string | null,
    hmac: string,
  ): void {
    const source = input.source ?? 'system';
    const summary = input.summary ?? null;
    const tags = input.tags ?? [];
    const status = input.status ?? 'active';
    const priority = input.priority ?? 'normal';
    const sprintId = input.sprint_id ?? null;
    const sprintNum = input.sprint_num ?? 0;
    const lang = input.lang ?? 'en';
    const decayExempt = input.decay_exempt ? 1 : 0;
    const metadata = JSON.stringify(input.metadata ?? {});
    const tenantId = input.tenant_id ?? null;

    const tagText = tags.join(' ');
    const titleNorm = turkishNormalize(input.title);
    const contentNorm = turkishNormalize(input.content);
    const summaryNorm = turkishNormalize(summary ?? '');
    const tagNorm = turkishNormalize(tagText);

    const stmt = this.db.prepare(`
      INSERT INTO entries (
        id, type, source, title, content, summary,
        tag_text, title_norm, content_norm, summary_norm, tag_norm,
        status, priority, sprint_id, sprint_num, lang,
        decay_exempt, metadata, tenant_id,
        audit_prev_hmac, audit_hmac
      ) VALUES (
        @id, 'audit', @source, @title, @content, @summary,
        @tag_text, @title_norm, @content_norm, @summary_norm, @tag_norm,
        @status, @priority, @sprint_id, @sprint_num, @lang,
        @decay_exempt, @metadata, @tenant_id,
        @audit_prev_hmac, @audit_hmac
      )
    `);

    stmt.run({
      id: input.id,
      source,
      title: input.title,
      content: input.content,
      summary,
      tag_text: tagText,
      title_norm: titleNorm,
      content_norm: contentNorm,
      summary_norm: summaryNorm,
      tag_norm: tagNorm,
      status,
      priority,
      sprint_id: sprintId,
      sprint_num: sprintNum,
      lang,
      decay_exempt: decayExempt,
      metadata,
      tenant_id: tenantId,
      audit_prev_hmac: prevHmac,
      audit_hmac: hmac,
    });
  }

  /**
   * Returns the HMAC of the latest audit row (id-order = insertion order via
   * SQLite rowid). Returns null when no chained audit rows exist yet.
   */
  getLastAuditHmac(): string | null {
    const row = this.db.prepare(
      `SELECT audit_hmac FROM entries
        WHERE type = 'audit' AND audit_hmac IS NOT NULL
        ORDER BY rowid DESC
        LIMIT 1`,
    ).get() as { audit_hmac: string | null } | undefined;
    return row?.audit_hmac ?? null;
  }

  /**
   * Walk every audit row in chain (insertion) order. Returns the fields the
   * verifier needs to recompute and compare HMACs.
   */
  queryAuditChain(): Array<{
    id: string;
    tenant_id: string | null;
    title: string;
    content: string;
    audit_prev_hmac: string | null;
    audit_hmac: string | null;
    created_at: string;
  }> {
    return this.db.prepare(
      `SELECT id, tenant_id, title, content,
              audit_prev_hmac, audit_hmac, created_at
         FROM entries
        WHERE type = 'audit'
        ORDER BY rowid ASC`,
    ).all() as Array<{
      id: string;
      tenant_id: string | null;
      title: string;
      content: string;
      audit_prev_hmac: string | null;
      audit_hmac: string | null;
      created_at: string;
    }>;
  }

  // ── Chat (Sprint 190 T-190-006) ──────────────────────────────
  //
  // Chat turns are persisted as plain `entries` rows with `type='chat'` so
  // they are automatically indexed by the FTS5 virtual table — `deckent
  // recall "<query>"` therefore matches chat content out of the box.
  //
  // Entry shape per turn:
  //   id        — `chat-<sessionId>-<turnIndex:0-padded>`
  //   tags      — [`chat:<sessionId>`, `role:<role>`] for filtered retrieval
  //   metadata  — { session_id, turn_index, role } JSON
  //   source    — 'user' for user turns, 'system' for assistant turns
  //                (constrained to EntrySource union)

  /**
   * Create a new chat session. Returns the canonical session id used in
   * subsequent appendChatTurn() / getChatHistory() calls. If `sessionId`
   * is omitted, generates one from the current timestamp.
   *
   * No row is written here — sessions are implicit, defined by the first
   * appendChatTurn() call. The return value is purely a convention helper.
   */
  createChatSession(sessionId?: string): string {
    if (sessionId && sessionId.trim().length > 0) {
      return sessionId;
    }
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const rand = Math.random().toString(36).slice(2, 8);
    return `chat-${ts}-${rand}`;
  }

  /**
   * Append a single turn to a chat session. Returns the new turn's index
   * (0-based, monotonically increasing per session).
   *
   * Idempotency note: this method does NOT deduplicate identical content —
   * each call appends a new turn. Callers that retry must track turn
   * indices externally.
   */
  appendChatTurn(sessionId: string, role: ChatRole, content: string): number {
    if (!sessionId || sessionId.trim().length === 0) {
      throw new DeckentError('DECKENT_E070', 'appendChatTurn requires a non-empty sessionId');
    }

    const nextIndex = this.getChatTurnCount(sessionId);
    const paddedIndex = String(nextIndex).padStart(6, '0');
    const id = `chat-${sessionId}-${paddedIndex}`;

    this.insert({
      id,
      type: 'chat',
      source: role === 'user' ? 'user' : 'system',
      title: `[chat] ${sessionId} turn ${nextIndex} (${role})`,
      content,
      tags: [`chat:${sessionId}`, `role:${role}`],
      metadata: { session_id: sessionId, turn_index: nextIndex, role },
      decay_exempt: false,
    });

    return nextIndex;
  }

  /**
   * Return all turns for a chat session in chronological order.
   * Pass `limit` to retrieve only the most recent N turns (e.g. for
   * `deckent chat --resume`).
   */
  getChatHistory(sessionId: string, limit?: number): ChatTurn[] {
    if (!sessionId || sessionId.trim().length === 0) return [];

    // Filter via tag join — `chat:<sessionId>` tag is set by appendChatTurn.
    // Sort by id ASC; id encodes a 0-padded turn index so lexicographic
    // order matches insertion order.
    const rows = this.db.prepare(`
      SELECT DISTINCT e.id, e.content, e.created_at, e.metadata
      FROM entries e
      INNER JOIN tags t ON t.entry_id = e.id
      WHERE e.type = 'chat'
        AND e.deleted_at IS NULL
        AND t.tag = ?
      ORDER BY e.id ASC
    `).all(`chat:${sessionId}`) as Array<{
      id: string;
      content: string;
      created_at: string;
      metadata: string;
    }>;

    const turns: ChatTurn[] = rows.map(row => {
      let parsed: { session_id?: string; turn_index?: number; role?: ChatRole } = {};
      try {
        parsed = JSON.parse(row.metadata) as typeof parsed;
      } catch {
        // Corrupt metadata — fall back to id-derived turn index.
      }
      const turnIndex = typeof parsed.turn_index === 'number'
        ? parsed.turn_index
        : Number.parseInt(row.id.slice(`chat-${sessionId}-`.length), 10) || 0;
      const role: ChatRole = parsed.role === 'assistant' ? 'assistant' : 'user';
      return {
        session_id: sessionId,
        turn_index: turnIndex,
        role,
        content: row.content,
        timestamp: row.created_at,
      };
    });

    if (typeof limit === 'number' && limit >= 0) {
      if (limit === 0) return [];
      if (turns.length > limit) return turns.slice(-limit);
    }
    return turns;
  }

  /**
   * List recent chat sessions, most-recently-active first. Powers the REPL
   * `/resume` picker. Each summary carries the turn count, last-activity
   * timestamp, and a preview (first user turn) as a human-readable label.
   */
  listChatSessions(limit = 10): ChatSessionSummary[] {
    // Group by the `chat:<sessionId>` tag; strip the 5-char `chat:` prefix to
    // recover the session id. ORDER BY last activity DESC for a recency picker.
    const rows = this.db.prepare(`
      SELECT substr(t.tag, 6) AS session_id,
             COUNT(DISTINCT e.id) AS turn_count,
             MAX(e.created_at) AS last_at,
             MAX(e.rowid) AS max_rowid
      FROM entries e
      INNER JOIN tags t ON t.entry_id = e.id
      WHERE e.type = 'chat'
        AND e.deleted_at IS NULL
        AND t.tag LIKE 'chat:%'
      GROUP BY t.tag
      ORDER BY last_at DESC, max_rowid DESC
      LIMIT ?
    `).all(Math.max(0, limit)) as Array<{ session_id: string; turn_count: number; last_at: string; max_rowid: number }>;

    // Preview = first user turn of each session (one small lookup per session).
    const firstUser = this.db.prepare(`
      SELECT e.content
      FROM entries e
      INNER JOIN tags t ON t.entry_id = e.id
      WHERE e.type = 'chat'
        AND e.deleted_at IS NULL
        AND e.source = 'user'
        AND t.tag = ?
      ORDER BY e.id ASC
      LIMIT 1
    `);

    return rows.map((r) => {
      const row = firstUser.get(`chat:${r.session_id}`) as { content: string } | undefined;
      const raw = (row?.content ?? '').replace(/\s+/g, ' ').trim();
      const preview = raw.length > 60 ? `${raw.slice(0, 57)}…` : raw;
      return { sessionId: r.session_id, turnCount: r.turn_count, lastAt: r.last_at, preview };
    });
  }

  /** Internal helper — count chat turns for a given session. */
  private getChatTurnCount(sessionId: string): number {
    const row = this.db.prepare(`
      SELECT COUNT(*) AS cnt
      FROM entries e
      INNER JOIN tags t ON t.entry_id = e.id
      WHERE e.type = 'chat'
        AND e.deleted_at IS NULL
        AND t.tag = ?
    `).get(`chat:${sessionId}`) as { cnt: number };
    return row.cnt;
  }

  // ── Schema & Raw Access ──────────────────────────────────────

  getSchemaVersion(): number {
    const row = this.db.prepare(
      `SELECT MAX(version) as v FROM schema_version`,
    ).get() as { v: number | null };
    return row.v ?? 0;
  }

  close(): void {
    this.db.close();
  }

  getRawDb(): DatabaseType {
    return this.db;
  }
}
