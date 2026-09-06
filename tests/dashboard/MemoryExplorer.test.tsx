// @vitest-environment happy-dom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { LanguageProvider } from "../../src/dashboard/src/i18n/LanguageProvider";
import MemoryExplorer from "../../src/dashboard/src/components/MemoryExplorer";

const memoryHooks = vi.hoisted(() => ({
  useMemoryRead: vi.fn(),
  useMemoryDetail: vi.fn(),
}));
const fetchJson = vi.hoisted(() => vi.fn((url: string) => {
  if (url === '/api/config') return Promise.resolve({ language: 'en' });
  return Promise.reject(new Error(`UNEXPECTED_DASHBOARD_REQUEST:${url}`));
}));

vi.mock("../../src/dashboard/src/lib/api", () => ({ fetchJson }));
vi.mock("../../src/dashboard/src/lib/memory-read", async () => ({
  ...(await vi.importActual<typeof import("../../src/dashboard/src/lib/memory-read")>("../../src/dashboard/src/lib/memory-read")),
  useMemoryRead: memoryHooks.useMemoryRead,
  useMemoryDetail: memoryHooks.useMemoryDetail,
}));

const scope = { kind: 'tenant' as const, tenantId: 'tenant-a', projectId: 'project-proof' };
const revision = `sha256:${'a'.repeat(64)}`;

function entry(id: string, content = `Complete body for ${id}`) {
  return {
    entry: {
      id,
      type: 'memory',
      title: `Title ${id}`,
      content,
      source: 'brain',
      status: 'active',
      sprint_id: 'sprint-9002',
      updated_at: '2026-09-06T12:00:00.000Z',
    },
    contentDigest: 'sha256:shared-content-digest',
  };
}

function available(overrides: Record<string, unknown> = {}) {
  return {
    data: {
      schemaVersion: 1,
      view: {
        state: 'AVAILABLE',
        scope,
        selectionRevisionDigest: revision,
        entries: [entry('mem-1', 'Entire entry body, not a line-filtered export.')],
        deferred: [],
        nextCursor: null,
        ...overrides,
      },
    },
    loading: false,
    error: null,
  };
}

function renderExplorer() {
  return render(<LanguageProvider><MemoryExplorer /></LanguageProvider>);
}

describe("MemoryExplorer", () => {
  beforeEach(() => {
    memoryHooks.useMemoryRead.mockReturnValue(available());
    memoryHooks.useMemoryDetail.mockReturnValue({ data: null, loading: false, error: null });
  });
  afterEach(() => { cleanup(); vi.clearAllMocks(); });

  it("renders whole units with compact identity, source and scoped revision evidence", () => {
    memoryHooks.useMemoryRead.mockReturnValue(available({
      entries: [entry('mem-1'), entry('mem-2')],
    }));
    renderExplorer();

    expect(screen.getByTestId("memory-content").textContent).toContain('Complete body for mem-1');
    expect(screen.getByTestId("memory-content").textContent).toContain('Complete body for mem-2');
    expect(screen.getByText('Record ID: mem-1')).toBeTruthy();
    expect(screen.getAllByText('Source: brain').length).toBeGreaterThan(0);
    expect(screen.getByTestId('memory-read-metadata').textContent).toContain('Tenant: tenant-a');
    expect(screen.getByTestId('memory-read-metadata').textContent).toContain('Project: project-proof');
    expect(screen.getByTestId('memory-read-metadata').textContent).toContain(revision.slice(0, 19));
    expect(screen.getByText('Complete body for mem-1').className).toContain('whitespace-pre-wrap');
  });

  it("changes the actual API selector when ADR or debt tabs are selected", () => {
    renderExplorer();
    fireEvent.click(screen.getByTestId('tab-adr'));
    expect(memoryHooks.useMemoryRead.mock.calls.some(([request]) => request.type === 'adr')).toBe(true);
    fireEvent.click(screen.getByTestId('tab-debt'));
    expect(memoryHooks.useMemoryRead.mock.calls.some(([request]) => request.type === 'debt')).toBe(true);
  });

  it("uses a non-overlapping responsive search form", () => {
    renderExplorer();
    const form = screen.getByTestId('search-container');
    const input = screen.getByTestId('search-input');
    const submit = screen.getByTestId('memory-search-submit');

    expect(form.className).toContain('flex-wrap');
    expect(input.parentElement?.className).toContain('flex-1');
    expect(submit.className).toContain('shrink-0');
    fireEvent.change(input, { target: { value: 'narrow viewport proof' } });
    expect(screen.getByTestId('search-clear').className).toContain('right-2');
    expect(submit.className).not.toContain('absolute');
  });

  it("uses tab-specific empty headings without claiming a sprint will populate the reader", () => {
    memoryHooks.useMemoryRead.mockReturnValue({
      data: {
        schemaVersion: 1,
        view: { state: 'ABSENT', scope, selectionRevisionDigest: revision, entries: [], deferred: [], nextCursor: null },
      },
      loading: false,
      error: null,
    });
    renderExplorer();

    expect(screen.getByTestId('memory-absent').textContent).toContain('No matching memory entries');
    expect(screen.getByTestId('memory-absent').textContent).toContain('No records match this scoped read.');
    expect(screen.getByTestId('memory-absent').textContent).not.toContain('sprint has completed');
    fireEvent.click(screen.getByTestId('tab-adr'));
    expect(screen.getByTestId('memory-absent').textContent).toContain('No matching ADR entries');
  });

  it("retries the same request only for retryable request failures and returns focus to search", () => {
    const retry = vi.fn();
    memoryHooks.useMemoryRead.mockReturnValue({ data: null, loading: false, error: 'request', retry });
    renderExplorer();

    const input = screen.getByTestId('search-input');
    fireEvent.click(screen.getByTestId('memory-retry'));
    expect(retry).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(input);
  });

  it("keeps one polite live status and restores search focus after navigation and detail close", () => {
    const deferred = [{
      candidate: { id: 'mem-focus', type: 'memory', source: 'worker', titlePreview: 'Focusable deferred entry', status: 'active', sprintId: null, candidateDigest: 'sha256:candidate' },
      reasonCode: 'BYTE_LIMIT',
      detailRef: 'detail-focus',
    }];
    memoryHooks.useMemoryRead.mockReturnValue(available({ deferred, nextCursor: 'cursor-page-2' }));
    memoryHooks.useMemoryDetail.mockReturnValue({ data: { schemaVersion: 1, detail: { state: 'AVAILABLE', entry: entry('mem-focus').entry, contentDigest: 'sha256:focus' } }, loading: false, error: null });
    renderExplorer();

    expect(screen.getByTestId('memory-read-live-status').getAttribute('aria-live')).toBe('polite');
    expect(screen.getByTestId('memory-read-live-status').textContent).toContain('Memory results available.');
    fireEvent.click(screen.getByTestId('memory-next-page'));
    expect(document.activeElement).toBe(screen.getByTestId('search-input'));
    fireEvent.click(screen.getByText('Open complete entry'));
    fireEvent.click(screen.getByText('Close detail'));
    expect(document.activeElement).toBe(screen.getByTestId('search-input'));
  });

  it("projects canonical HOLD scope and required IDs, then restarts an invalid cursor from the current first page", () => {
    memoryHooks.useMemoryRead.mockImplementation((request: { cursor?: string }) => request.cursor
      ? {
          data: {
            schemaVersion: 1,
            view: { state: 'HOLD', consumer: 'api', scope, reasonCode: 'CURSOR_INVALID', requiredIds: ['ADR-G-020'] },
          },
          loading: false,
          error: null,
        }
      : available({ nextCursor: 'cursor-page-2' }));
    renderExplorer();

    fireEvent.click(screen.getByTestId('memory-next-page'));
    expect(screen.getByTestId('memory-hold').textContent).toContain('CURSOR_INVALID');
    expect(screen.getByTestId('memory-hold-scope').textContent).toContain('Tenant: tenant-a');
    expect(screen.getByTestId('memory-hold-required-ids').textContent).toContain('ADR-G-020');
    fireEvent.click(screen.getByTestId('memory-restart-query'));
    expect(memoryHooks.useMemoryRead.mock.calls.at(-1)?.[0]).toMatchObject({ cursor: undefined });
    expect(document.activeElement).toBe(screen.getByTestId('search-input'));
    expect(screen.getByTestId('memory-read-live-status').textContent).toContain('Memory results available.');
  });

  it("shows required-entry and oversize guidance without a cursor reset action", () => {
    memoryHooks.useMemoryRead.mockReturnValue({
      data: {
        schemaVersion: 1,
        view: { state: 'HOLD', consumer: 'api', scope, reasonCode: 'REQUIRED_ENTRY_OVERSIZE', requiredIds: ['ADR-D-007'] },
      },
      loading: false,
      error: null,
    });
    renderExplorer();

    expect(screen.getByTestId('memory-hold').textContent).toContain('No limits or approvals were changed.');
    expect(screen.getByTestId('memory-hold-required-ids').textContent).toContain('ADR-D-007');
    expect(screen.queryByTestId('memory-restart-query')).toBeNull();
  });

  it("retries QUERY_FAILED HOLDs explicitly", () => {
    const retry = vi.fn();
    memoryHooks.useMemoryRead.mockReturnValue({
      data: {
        schemaVersion: 1,
        view: { state: 'HOLD', consumer: 'api', scope, reasonCode: 'QUERY_FAILED', requiredIds: [] },
      },
      loading: false,
      error: null,
      retry,
    });
    renderExplorer();

    fireEvent.click(screen.getByTestId('memory-retry'));
    expect(retry).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(screen.getByTestId('search-input'));
  });

  it("keeps a failed detail dismissible and invalidates it on query and page changes", () => {
    const deferred = [{
      candidate: { id: 'mem-deferred', type: 'memory', source: 'worker', titlePreview: 'Deferred entry', status: 'active', sprintId: null, candidateDigest: 'sha256:candidate' },
      reasonCode: 'BYTE_LIMIT',
      detailRef: 'detail-proof',
    }];
    memoryHooks.useMemoryRead.mockReturnValue(available({ deferred, nextCursor: 'cursor-page-2' }));
    memoryHooks.useMemoryDetail.mockReturnValue({
      data: {
        schemaVersion: 1,
        detail: { state: 'HOLD', consumer: 'api', scope, reasonCode: 'DETAIL_CHANGED', requiredIds: ['mem-deferred'] },
      },
      loading: false,
      error: null,
    });
    renderExplorer();

    fireEvent.click(screen.getByText('Open complete entry'));
    expect(screen.getByTestId('memory-detail-hold').textContent).toContain('DETAIL_CHANGED');
    fireEvent.change(screen.getByTestId('search-input'), { target: { value: 'new query' } });
    fireEvent.submit(screen.getByTestId('search-container'));
    expect(screen.queryByTestId('memory-detail-error')).toBeNull();

    fireEvent.click(screen.getByText('Open complete entry'));
    expect(screen.getByTestId('memory-detail-hold-scope').textContent).toContain('Project: project-proof');
    expect(screen.getByTestId('memory-detail-hold-required-ids').textContent).toContain('mem-deferred');
    fireEvent.click(screen.getByTestId('memory-next-page'));
    expect(screen.queryByTestId('memory-detail-error')).toBeNull();

    fireEvent.click(screen.getByText('Open complete entry'));
    expect(screen.getByText('Close detail')).toBeTruthy();
    fireEvent.click(screen.getByText('Close detail'));
    expect(screen.queryByTestId('memory-detail-error')).toBeNull();
  });
});
