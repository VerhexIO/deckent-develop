import type { MemoryEntryV2, MemoryQueryParams } from './memory-types.js';

export const MEMORY_READ_CONSUMERS = Object.freeze([
  'planner',
  'worker',
  'cli',
  'mcp',
  'bot',
  'api',
  'dashboard',
  'desktop',
] as const);

export type MemoryReadConsumerV1 = typeof MEMORY_READ_CONSUMERS[number];
// `desktop` reserves cross-surface vocabulary only; 9002 does not claim an
// existing Desktop memory consumer or authorize a new Desktop feature.

export type MemoryReadScopeV1 =
  | Readonly<{ kind: 'tenant'; tenantId: string; projectId: string }>
  | Readonly<{ kind: 'local-project'; projectId: string }>;

export interface MemoryReadLimitsV1 {
  /** Whole entries admitted into this page. */
  readonly maxEntries: number;
  readonly maxCandidates: number;
  /** UTF-8 bytes of complete entry records; candidate previews are excluded. */
  readonly maxBytes: number;
  /** Content lines of complete entry records; rendering labels are excluded. */
  readonly maxLines: number;
}

export const DEFAULT_MEMORY_READ_LIMITS: Readonly<MemoryReadLimitsV1> = Object.freeze({
  maxEntries: 20,
  maxCandidates: 128,
  maxBytes: 32_768,
  maxLines: 200,
});

export type MemoryReadSelectionReasonV1 = 'QUERY_MATCH' | 'REQUIRED' | 'PREFERRED_LATEST' | 'CRITICAL';

export type MemoryReadPreferredLatestTypeV1 = 'retro' | 'identity';

export interface MemoryReadCandidateV1 {
  readonly id: string;
  readonly type: string;
  readonly source: string;
  /** Bounded discovery text only; never authority for the complete title. */
  readonly titlePreview: string;
  /** Bounded discovery text only; never a complete-entry assertion. */
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
  /** SQL-computed lower bound for the complete row's UTF-8 payload. */
  readonly recordByteLengthFloor: number;
  readonly relevance: number;
  /** Discovery ranking only; REQUIRED/CRITICAL admission never depends on it. */
  readonly snippet?: string;
  readonly candidateDigest: string;
}

export interface MemoryReadEntryV1 {
  readonly entry: Readonly<MemoryEntryV2>;
  readonly relevance: number;
  readonly contentDigest: string;
  /** Raw `entry.content` UTF-8 SHA-256, matching lossless export content_sha256. */
  readonly reasons: readonly MemoryReadSelectionReasonV1[];
}

export interface MemoryReadDeferredV1 {
  readonly candidate: MemoryReadCandidateV1;
  readonly reasons: readonly MemoryReadSelectionReasonV1[];
  readonly reasonCode: 'ENTRY_LIMIT' | 'BYTE_LIMIT' | 'LINE_LIMIT';
  readonly detailRef: string;
}

export interface MemoryReadSelectionRevisionV1 {
  /** Digest of this exact bounded candidate page; never a database-global revision. */
  readonly selectionRevisionDigest: string;
  readonly queryDigest: string;
  readonly scopeDigest: string;
  readonly limitsDigest: string;
}

export interface MemoryReadAvailableV1 extends MemoryReadSelectionRevisionV1 {
  readonly state: 'AVAILABLE';
  readonly consumer: MemoryReadConsumerV1;
  readonly scope: MemoryReadScopeV1;
  readonly limits: Readonly<MemoryReadLimitsV1>;
  readonly candidates: readonly MemoryReadCandidateV1[];
  readonly entries: readonly MemoryReadEntryV1[];
  readonly deferred: readonly MemoryReadDeferredV1[];
  readonly nextCursor: string | null;
}

export interface MemoryReadAbsentV1 extends MemoryReadSelectionRevisionV1 {
  readonly state: 'ABSENT';
  readonly consumer: MemoryReadConsumerV1;
  readonly scope: MemoryReadScopeV1;
  readonly candidates: readonly [];
  readonly entries: readonly [];
  readonly deferred: readonly [];
  readonly nextCursor: null;
}

export type MemoryReadHoldReasonV1 =
  | 'INVALID_REQUEST'
  | 'INVALID_LIMITS'
  | 'TENANT_SCOPE_UNAVAILABLE'
  | 'CURSOR_INVALID'
  | 'CURSOR_STALE'
  | 'QUERY_FAILED'
  | 'REQUIRED_ENTRY_MISSING'
  | 'REQUIRED_REFERENCE_AMBIGUOUS'
  | 'REQUIRED_ENTRY_OVERSIZE'
  | 'CRITICAL_CONTEXT_UNAVAILABLE'
  | 'CANDIDATE_LIMIT_EXHAUSTED'
  | 'INSUFFICIENT_CONTEXT'
  | 'DETAIL_REFERENCE_INVALID'
  | 'DETAIL_CHANGED'
  | 'RENDER_LIMIT_EXCEEDED';

export interface MemoryReadHoldV1 {
  readonly state: 'HOLD';
  readonly consumer: MemoryReadConsumerV1 | null;
  readonly scope: MemoryReadScopeV1 | null;
  readonly reasonCode: MemoryReadHoldReasonV1;
  readonly requiredIds: readonly string[];
}

export type MemoryReadViewV1 = MemoryReadAvailableV1 | MemoryReadAbsentV1 | MemoryReadHoldV1;

export interface MemoryReadViewInputV1 {
  readonly consumer: MemoryReadConsumerV1;
  readonly scope: MemoryReadScopeV1;
  readonly query: Readonly<Omit<MemoryQueryParams, 'tenantId' | 'limit'>>;
  readonly limits?: Partial<MemoryReadLimitsV1>;
  readonly requiredIds?: readonly string[];
  /** Optional singleton roles selected by latest sprint ordinal within scope. */
  readonly preferredLatestTypes?: readonly MemoryReadPreferredLatestTypeV1[];
  readonly includeCritical?: boolean;
  readonly cursor?: string;
}

export interface MemoryReadDetailInputV1 {
  readonly consumer: MemoryReadConsumerV1;
  readonly scope: MemoryReadScopeV1;
  readonly detailRef: string;
  /**
   * Optional full-body binding when the caller already possesses an authoritative
   * digest. Without it, detail is an honest fresh point read: metadata identity is
   * revalidated, but the service does not claim the body matches an earlier page.
   */
  readonly expectedContentDigest?: string;
}

export interface MemoryRequiredIdResolutionInputV1 {
  readonly consumer: MemoryReadConsumerV1;
  readonly scope: MemoryReadScopeV1;
  readonly references: readonly string[];
}

export type MemoryPreferredIdResolutionInputV1 = MemoryRequiredIdResolutionInputV1;

export type MemoryRequiredIdResolutionV1 =
  | Readonly<{
      state: 'AVAILABLE';
      consumer: MemoryReadConsumerV1;
      scope: MemoryReadScopeV1;
      exactIds: readonly string[];
    }>
  | MemoryReadHoldV1;

export type MemoryPreferredIdResolutionV1 = MemoryRequiredIdResolutionV1;

export type MemoryReadDetailV1 =
  | Readonly<{
      state: 'AVAILABLE';
      consumer: MemoryReadConsumerV1;
      scope: MemoryReadScopeV1;
      entry: Readonly<MemoryEntryV2>;
      contentDigest: string;
    }>
  | MemoryReadHoldV1;

export interface MemoryReadLabelsV1 {
  readonly id: string;
  readonly revision: string;
  readonly scope: string;
  readonly source: string;
  readonly status: string;
  readonly sprint: string;
  readonly updatedAt: string;
  readonly deferred: string;
  readonly detail: string;
  readonly continuation: string;
}

/** Validate authored fields without inventing defaults before layer resolution. */
export function validateMemoryReadLimitsPatch(input: Partial<MemoryReadLimitsV1>): void {
  if (input === null || Array.isArray(input) || typeof input !== 'object') {
    throw new TypeError('MEMORY_READ_LIMITS_INVALID');
  }
  const keys = Object.keys(input);
  if (keys.some((key) => !['maxEntries', 'maxCandidates', 'maxBytes', 'maxLines'].includes(key))) {
    throw new TypeError('MEMORY_READ_LIMITS_INVALID');
  }
  for (const value of Object.values(input)) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new TypeError('MEMORY_READ_LIMITS_INVALID');
    }
  }
}

export function resolveMemoryReadLimits(input: Partial<MemoryReadLimitsV1> = {}): Readonly<MemoryReadLimitsV1> {
  validateMemoryReadLimitsPatch(input);
  const resolved = { ...DEFAULT_MEMORY_READ_LIMITS, ...input };
  if (resolved.maxEntries > resolved.maxCandidates) {
    throw new TypeError('MEMORY_READ_LIMITS_INVALID');
  }
  return Object.freeze(resolved);
}
