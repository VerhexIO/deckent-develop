// @vitest-environment happy-dom
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const fetchJson = vi.hoisted(() => vi.fn());
vi.mock('../../src/dashboard/src/lib/api', async () => ({
  ...(await vi.importActual<typeof import('../../src/dashboard/src/lib/api')>('../../src/dashboard/src/lib/api')),
  fetchJson,
}));

import { useMemoryRead } from '../../src/dashboard/src/lib/memory-read';
import { ApiError } from '../../src/dashboard/src/lib/api';

function pending<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function response(id: string) {
  return {
    schemaVersion: 1 as const,
    view: {
      state: 'AVAILABLE' as const,
      scope: { kind: 'local-project' as const, projectId: 'project-hook' },
      selectionRevisionDigest: `sha256:${id}`,
      entries: [{
        entry: { id, type: 'memory', title: id, content: id, source: 'brain', status: 'active', sprint_id: null, updated_at: '2026-09-06' },
        contentDigest: `sha256:${id}`,
      }],
      deferred: [],
      nextCursor: null,
    },
  };
}

afterEach(() => vi.clearAllMocks());

describe('useMemoryRead request authority', () => {
  it('never lets a slower prior query overwrite the newer scoped response', async () => {
    const oldRequest = pending<ReturnType<typeof response>>();
    const newRequest = pending<ReturnType<typeof response>>();
    fetchJson.mockReturnValueOnce(oldRequest.promise).mockReturnValueOnce(newRequest.promise);

    const { result, rerender } = renderHook(
      ({ query }) => useMemoryRead({ query, type: 'memory' }),
      { initialProps: { query: 'old-query' } },
    );
    rerender({ query: 'new-query' });

    await act(async () => { newRequest.resolve(response('new-entry')); });
    expect(result.current.data?.view.state).toBe('AVAILABLE');
    expect(result.current.data?.view.state === 'AVAILABLE' && result.current.data.view.entries[0]?.entry.id)
      .toBe('new-entry');

    await act(async () => { oldRequest.resolve(response('old-entry')); });
    expect(result.current.data?.view.state === 'AVAILABLE' && result.current.data.view.entries[0]?.entry.id)
      .toBe('new-entry');
  });

  it('ignores a rejected request after its component has unmounted', async () => {
    const request = pending<ReturnType<typeof response>>();
    fetchJson.mockReturnValueOnce(request.promise);
    const { unmount } = renderHook(() => useMemoryRead({ query: 'removed', type: 'memory' }));
    unmount();
    await act(async () => { request.reject(new Error('late failure')); });
    expect(fetchJson).toHaveBeenCalledTimes(1);
  });

  it('projects forbidden API responses and network failures without exposing raw request details', async () => {
    fetchJson.mockRejectedValueOnce(new ApiError(403, 'GET /api/memory/search?token=private failed'));
    const forbidden = renderHook(() => useMemoryRead({ query: 'restricted', type: 'memory' }));
    await act(async () => {});
    expect(forbidden.result.current.error).toBe('forbidden');

    fetchJson.mockRejectedValueOnce(new Error('socket ECONNREFUSED private-host'));
    const network = renderHook(() => useMemoryRead({ query: 'offline', type: 'memory' }));
    await act(async () => {});
    expect(network.result.current.error).toBe('network');
  });

  it('retries a same-query request only when explicitly invoked', async () => {
    fetchJson.mockResolvedValueOnce(response('first-entry')).mockResolvedValueOnce(response('retried-entry'));
    const { result } = renderHook(() => useMemoryRead({ query: 'same-query', type: 'memory' }));
    await act(async () => {});
    expect(fetchJson).toHaveBeenCalledTimes(1);
    expect(result.current.data?.view.state === 'AVAILABLE' && result.current.data.view.entries[0]?.entry.id).toBe('first-entry');

    act(() => { result.current.retry(); });
    await act(async () => {});
    expect(fetchJson).toHaveBeenCalledTimes(2);
    expect(result.current.data?.view.state === 'AVAILABLE' && result.current.data.view.entries[0]?.entry.id).toBe('retried-entry');
  });
});
