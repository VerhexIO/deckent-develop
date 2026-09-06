import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, fetchJson } from "./api";

export type MemoryReadScope =
  | { readonly kind: 'tenant'; readonly tenantId: string; readonly projectId: string }
  | { readonly kind: 'local-project'; readonly projectId: string };

export interface MemoryReadCandidate {
  readonly id: string;
  readonly type: string;
  readonly source: string;
  readonly titlePreview: string;
  readonly status: string;
  readonly sprintId: string | null;
  readonly candidateDigest: string;
}

export interface MemoryReadEntry {
  readonly entry: {
    readonly id: string;
    readonly type: string;
    readonly title: string;
    readonly content: string;
    readonly source: string;
    readonly status: string;
    readonly sprint_id: string | null;
    readonly updated_at: string;
  };
  readonly contentDigest: string;
}

export interface MemoryReadDeferred {
  readonly candidate: MemoryReadCandidate;
  readonly reasonCode: 'ENTRY_LIMIT' | 'BYTE_LIMIT' | 'LINE_LIMIT';
  readonly detailRef: string;
}

export type MemoryReadHoldReason =
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

export interface MemoryReadHold {
  readonly state: 'HOLD';
  readonly consumer: 'planner' | 'worker' | 'cli' | 'mcp' | 'bot' | 'api' | 'dashboard' | 'desktop' | null;
  readonly scope: MemoryReadScope | null;
  readonly reasonCode: MemoryReadHoldReason;
  readonly requiredIds: readonly string[];
}

export type MemoryReadView =
  | { readonly state: 'AVAILABLE'; readonly scope: MemoryReadScope; readonly selectionRevisionDigest: string; readonly entries: readonly MemoryReadEntry[]; readonly deferred: readonly MemoryReadDeferred[]; readonly nextCursor: string | null }
  | { readonly state: 'ABSENT'; readonly scope: MemoryReadScope; readonly selectionRevisionDigest: string; readonly entries: readonly []; readonly deferred: readonly []; readonly nextCursor: null }
  | MemoryReadHold;

export type MemoryReadDetail =
  | { readonly state: 'AVAILABLE'; readonly entry: MemoryReadEntry['entry']; readonly contentDigest: string }
  | MemoryReadHold;

export interface MemoryReadResponse {
  readonly schemaVersion: 1;
  readonly view: MemoryReadView;
}

export interface MemoryDetailResponse {
  readonly schemaVersion: 1;
  readonly detail: MemoryReadDetail;
}

export interface MemoryReadRequest {
  readonly query?: string;
  readonly type?: string;
  readonly cursor?: string;
}

export function memoryReadUrl(request: MemoryReadRequest): string {
  const params = new URLSearchParams({ v: '1' });
  if (request.query !== undefined && request.query.trim().length > 0) params.set('q', request.query);
  if (request.type !== undefined) params.set('type', request.type);
  if (request.cursor !== undefined) params.set('cursor', request.cursor);
  return `/api/memory/search?${params.toString()}`;
}

export function memoryDetailUrl(detailRef: string): string {
  return `/api/memory/detail?v=1&ref=${encodeURIComponent(detailRef)}`;
}

interface MemoryRequestState<T> {
  readonly data: T | null;
  readonly loading: boolean;
  readonly error: MemoryRequestError | null;
  readonly retry: () => void;
}

type MemoryRequestDataState<T> = Omit<MemoryRequestState<T>, 'retry'>;

export type MemoryRequestError = 'forbidden' | 'network' | 'request';

function safeMemoryRequestError(error: unknown): MemoryRequestError {
  if (error instanceof ApiError && error.status === 403) return 'forbidden';
  if (error instanceof ApiError) return 'request';
  return 'network';
}

/**
 * Memory pages own a request revision because query, tab and cursor changes are
 * one causal read sequence. A slower prior response must never overwrite the
 * newer scoped page, and an unmounted view must never publish late state.
 */
function useMemoryRequest<T>(url: string): MemoryRequestState<T> {
  const revision = useRef(0);
  const [retryNonce, setRetryNonce] = useState(0);
  const [state, setState] = useState<MemoryRequestDataState<T>>({
    data: null,
    loading: true,
    error: null,
  });

  const retry = useCallback(() => setRetryNonce((current) => current + 1), []);

  useEffect(() => {
    const requestRevision = ++revision.current;
    let active = true;
    setState({ data: null, loading: true, error: null });
    void fetchJson<T>(url).then(
      (data) => {
        if (active && revision.current === requestRevision) {
          setState({ data, loading: false, error: null });
        }
      },
      (error: unknown) => {
        if (active && revision.current === requestRevision) {
          setState({
            data: null,
            loading: false,
            error: safeMemoryRequestError(error),
          });
        }
      },
    );
    return () => {
      active = false;
    };
  }, [url, retryNonce]);

  return { ...state, retry };
}

export function useMemoryRead(request: MemoryReadRequest) {
  return useMemoryRequest<MemoryReadResponse>(memoryReadUrl(request));
}

export function useMemoryDetail(detailRef: string) {
  return useMemoryRequest<MemoryDetailResponse>(memoryDetailUrl(detailRef));
}
