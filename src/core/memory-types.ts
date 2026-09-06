// src/core/memory-types.ts

/**
 * Memory V2 type definitions.
 * These types map directly to the SQLite schema in memory-store.ts.
 */

// ─── Entry Types ──────────────────────────────────────────────────

/** Built-in entry types. Custom types are strings beyond this set. */
export type EntryType =
  | 'adr'
  | 'memory'
  | 'sprint'
  | 'debt'
  | 'pattern'
  | 'retro'
  | 'error'
  | 'identity'
  | 'audit'
  | 'chat'
  | 'custom';

// ─── Chat (Sprint 190 T-190-006) ─────────────────────────────────

/** Role of a single chat turn. */
export type ChatRole = 'user' | 'assistant';

/** A single chat turn as returned by getChatHistory(). */
export interface ChatTurn {
  session_id: string;
  turn_index: number;
  role: ChatRole;
  content: string;
  /** ISO 8601 UTC timestamp. */
  timestamp: string;
}

/** A chat session summary as returned by listChatSessions() — for /resume pickers. */
export interface ChatSessionSummary {
  sessionId: string;
  /** Number of turns (user + assistant) in the session. */
  turnCount: number;
  /** ISO 8601 UTC timestamp of the most recent turn. */
  lastAt: string;
  /** First user-turn content, truncated — a human-readable label for the session. */
  preview: string;
}

/** Who created this entry. */
export type EntrySource =
  | 'system'
  | 'brain'
  | 'worker'
  | 'user'
  | 'import';

/** Entry status. Meaning varies by type. */
export type EntryStatus =
  | 'active'
  | 'accepted'
  | 'deprecated'
  | 'superseded'
  | 'proposed'
  | 'rejected'
  | 'resolved'
  | 'archived';

/** Relation types between entries. */
export type RelationType =
  | 'references'
  | 'supersedes'
  | 'caused_by'
  | 'resolves'
  | 'blocks'
  | 'depends_on';

/** Change types for history tracking. */
export type ChangeType =
  | 'create'
  | 'update'
  | 'soft_delete'
  | 'restore'
  | 'decay';

// ─── Core Data Structures ─────────────────────────────────────────

/** A single knowledge entry in the memory DB. */
export interface MemoryEntryV2 {
  id: string;
  type: string;
  source: EntrySource;
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
  decay_exempt: boolean;
  metadata: string;
  /** Multi-tenant scope tag. NULL for legacy/single-tenant entries (default). */
  tenant_id?: string | null;
  /** ADR taxonomy (ADR-G-019): class `G`|`D`|`UG`|`UP`. NULL for non-ADR rows. */
  adr_class?: string | null;
  scope?: string | null;
  immutable?: number | null;
  source_authority?: string | null;
  enforcement_level?: string | null;
  /**
   * Sprint 179 W5-12 (I4 invariant): audit HMAC chain fields.
   * Only populated for type='audit' rows inserted via `insertAuditWithHmac`.
   * NULL on legacy or non-audit rows.
   */
  audit_prev_hmac?: string | null;
  audit_hmac?: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

/** Input for creating a new entry (fields with defaults omitted). */
export interface CreateEntryInput {
  id: string;
  type: string;
  title: string;
  content: string;
  source?: EntrySource;
  summary?: string;
  tags?: string[];
  status?: string;
  priority?: string;
  sprint_id?: string;
  sprint_num?: number;
  lang?: string;
  decay_exempt?: boolean;
  metadata?: Record<string, unknown>;
  /** Multi-tenant scope tag (omit for single-tenant default). */
  tenant_id?: string;
  /** ADR taxonomy (ADR-G-019): class `G`|`D`|`UG`|`UP`. Omit for non-ADR entries. */
  adr_class?: string;
  /** ADR taxonomy: `global`|`project` scope. */
  scope?: string;
  /** ADR taxonomy: immutable flag (true for ADR-G constitution). */
  immutable?: boolean;
  /** ADR taxonomy: authority source `publisher`|`contributor`|`user`. */
  source_authority?: string;
  /** ADR taxonomy: enforcement level `advisory`|`runtime`|`hard`. */
  enforcement_level?: string;
  relations?: Array<{ to_id: string; rel_type: RelationType }>;
}

/** A cross-reference between two entries. */
export interface EntryRelation {
  from_id: string;
  to_id: string;
  rel_type: RelationType;
  /** Alias for rel_type — available in query results for test/plan spec compatibility. */
  type: RelationType;
  created_at: string;
}

/** Convenience type for relation insert operations. */
export interface Relation {
  from_id: string;
  to_id: string;
  rel_type: RelationType;
  source?: 'auto-extract' | 'backfill' | 'finalizer' | 'user';
}

/** Object form for insertRelation — MADR v3 relation input. */
export interface MemoryRelation {
  from_id: string;
  to_id: string;
  type: RelationType;
  metadata?: Record<string, unknown>;
}

/** A change history record. */
export interface EntryHistoryRecord {
  id: number;
  entry_id: string;
  field: string;
  old_value: string | null;
  new_value: string | null;
  changed_by: string;
  change_type: ChangeType;
  changed_at: string;
}

// ─── Query Interface ──────────────────────────────────────────────

/** Query parameters for searching memory. */
export interface MemoryQueryParams {
  /** Full-text search query (FTS5 MATCH). Searches both original + normalized. */
  text?: string;
  /** Filter by entry type(s). */
  type?: string[];
  /** Filter by source(s). */
  source?: EntrySource[];
  /** Filter by status(es). */
  status?: string[];
  /** Filter by priority values. */
  priority?: string[];
  /** ADR-G-019 class filter. Omitted means all classes. */
  adr_class?: Array<'G' | 'D' | 'UG' | 'UP'>;
  /** ADR-G-019 scope filter. Omitted means all scopes. */
  adr_scope?: string[];
  /** Filter by sprint number range. */
  sprint_range?: { min?: number; max?: number };
  /** Filter: entries must have ALL of these tags. */
  tags_contain?: string[];
  /** Include soft-deleted entries (default: false). */
  include_deleted?: boolean;
  /** Include only decay-exempt entries (default: undefined = all). */
  decay_exempt?: boolean;
  /** Maximum results (default: 10). */
  limit?: number;
  /** Minimum relevance score for FTS results (default: 0). */
  min_score?: number;
  /** FTS5 token join mode: 'or' (default, broader recall) or 'and' (all tokens must match). */
  mode?: 'and' | 'or';
  /**
   * Multi-tenant scope narrowing (born-609, additive-only). When set, results are
   * restricted to rows whose `tenant_id` exactly matches (fail-closed — a NULL-tenant
   * row never matches, mirroring `MemoryStore.getById/getByType/getByTags`'s born-563
   * default). Omitted (default) → behavior is unchanged from pre-609 (no tenant clause).
   */
  tenantId?: string;
}

/** A single search result with relevance score. */
export interface MemorySearchResult {
  entry: MemoryEntryV2;
  relevance: number;
  snippet?: string;
}

// ─── Export Types ─────────────────────────────────────────────────

/** Summary entry for the summary.md context file. */
export interface SummaryExportEntry {
  id: string;
  type: string;
  title: string;
  status: string;
  sprint_id: string | null;
  summary: string | null;
}

// ─── Task Persistence ────────────────────────────────────────────

/**
 * TaskRecord — persistence-layer projection of a runtime Task carrying only
 * the fields the memory DB needs to track across a sprint.
 *
 * Sprint 177 Task 1 introduced `snapshot_stash_ref` to record the git stash
 * ref captured at worker spawn so the result-evaluator can rollback (NO_GO)
 * or drop (DONE/GO_WITH_TECH_DEBT) the snapshot.
 *
 * Note: runtime persistence of the ref currently uses the `.tasks/task-{id}.stash-ref`
 * sidecar file (consistent with `.hb` / `.plan` / `.result`). This interface
 * documents the contract for future memory-store integration.
 */
export interface TaskRecord {
  task_id: string;
  sprint_id?: string | null;
  /**
   * Sprint 177 Task 1: git stash ref captured at worker spawn for rollback.
   * Format matches `stash@\{N\}`. Unset for tasks spawned before rollback
   * infrastructure (Sprint ≤176) and for tasks whose project repo is not a
   * git working tree.
   */
  snapshot_stash_ref?: string | null;
}
