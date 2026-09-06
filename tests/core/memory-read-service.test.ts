import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MemoryStore } from '../../src/core/memory-store.js';
import {
  buildMemoryDiscoveryQuery,
  MemoryReadRenderHoldError,
  readMemoryDetail,
  readMemoryView,
  renderMemoryReadView,
  resolveMemoryPreferredIds,
  resolveMemoryRequiredIds,
} from '../../src/core/memory-read-service.js';
import type { MemoryReadLabelsV1, MemoryReadScopeV1 } from '../../src/core/memory-read-contract.js';

const PROJECT_SCOPE: MemoryReadScopeV1 = Object.freeze({ kind: 'local-project', projectId: 'project:test' });
const TENANT_A_SCOPE: MemoryReadScopeV1 = Object.freeze({ kind: 'tenant', tenantId: 'tenant-a', projectId: 'project:test' });
const LABELS: MemoryReadLabelsV1 = Object.freeze({
  id: 'ID', revision: 'Revision', scope: 'Scope',
  source: 'Source', status: 'Status', sprint: 'Sprint', updatedAt: 'Updated',
  deferred: 'Deferred', detail: 'Detail', continuation: 'Continue',
});

let root: string;
let store: MemoryStore;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'memory-read-service-'));
  store = new MemoryStore(join(root, 'memory.db'));
  store.insert({
    id: 'local-recent', type: 'memory', source: 'brain', title: 'Recent local',
    content: 'whole local content', summary: 'local summary', sprint_id: 'sprint-42', sprint_num: 42,
  });
  store.insert({
    id: 'tenant-a-1', type: 'memory', source: 'worker', title: 'Tenant alpha',
    content: 'alpha private content', sprint_id: 'sprint-43', sprint_num: 43, tenant_id: 'tenant-a',
  });
  store.insert({
    id: 'tenant-b-1', type: 'memory', source: 'worker', title: 'Tenant beta',
    content: 'beta private content', sprint_id: 'sprint-44', sprint_num: 44, tenant_id: 'tenant-b',
  });
});

afterEach(() => {
  store.close();
  rmSync(root, { recursive: true, force: true });
});

describe('readMemoryView', () => {
  it('turns large operator-bearing prose into a bounded literal discovery query', () => {
    const source = `${Array.from({ length: 2_000 }, (_, index) =>
      `Change ${index}: path-${index}/unit AND OR NOT "quoted"`).join('\n')} memory memory`;
    const query = buildMemoryDiscoveryQuery(source);
    const terms = query.split(/\s+/u);
    expect(terms).toHaveLength(64);
    expect(query).not.toMatch(/\b(?:AND|OR|NOT)\b/u);
    expect(buildMemoryDiscoveryQuery(source)).toBe(query);
    expect(readMemoryView(store, {
      consumer: 'worker', scope: PROJECT_SCOPE, query: { text: query },
    }).state).not.toBe('HOLD');
  });

  it('returns whole content with raw UTF-8 digest under a bounded local-project selection', () => {
    const result = readMemoryView(store, {
      consumer: 'planner', scope: PROJECT_SCOPE, query: { text: 'whole local' },
      limits: { maxEntries: 4, maxCandidates: 8, maxBytes: 8_192, maxLines: 20 },
    });
    expect(result.state).toBe('AVAILABLE');
    if (result.state !== 'AVAILABLE') return;
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]?.entry.content).toBe('whole local content');
    expect(result.entries[0]?.contentDigest).toBe('sha256:accfd6080f2d6e6a30cc8a957e27c6be87d821651085fd564588cc9a800c89a0');
    expect(result.candidates[0]).not.toHaveProperty('content');
    expect(result.candidates[0]).not.toHaveProperty('metadata');
  });

  it('uses exact verified-tenant scope while local-project preserves the existing all-project read', () => {
    const tenant = readMemoryView(store, {
      consumer: 'api', scope: TENANT_A_SCOPE, query: { text: 'private' },
    });
    expect(tenant.state).toBe('AVAILABLE');
    if (tenant.state === 'AVAILABLE') expect(tenant.entries.map((entry) => entry.entry.id)).toEqual(['tenant-a-1']);

    const local = readMemoryView(store, {
      consumer: 'cli', scope: PROJECT_SCOPE, query: { text: 'private' },
    });
    expect(local.state).toBe('AVAILABLE');
    if (local.state === 'AVAILABLE') {
      expect(local.entries.map((entry) => entry.entry.id).sort()).toEqual(['tenant-a-1', 'tenant-b-1']);
    }
  });

  it('defers an oversized optional meaning unit without loading a partial body', () => {
    store.insert({
      id: 'giant', type: 'memory', title: 'Giant unit', content: `needle-${'x'.repeat(100_000)}`,
      sprint_id: 'sprint-45', sprint_num: 45,
    });
    const result = readMemoryView(store, {
      consumer: 'bot', scope: PROJECT_SCOPE, query: { text: 'needle' },
      limits: { maxEntries: 2, maxCandidates: 4, maxBytes: 4_096, maxLines: 10 },
    });
    expect(result.state).toBe('AVAILABLE');
    if (result.state !== 'AVAILABLE') return;
    expect(result.entries).toEqual([]);
    expect(result.deferred).toHaveLength(1);
    expect(result.deferred[0]?.reasonCode).toBe('BYTE_LIMIT');
    expect(result.deferred[0]?.candidate.contentByteLength).toBeGreaterThan(100_000);
    expect(JSON.stringify(result)).not.toContain('needle-xxx');

    const detail = readMemoryDetail(store, {
      consumer: 'bot', scope: PROJECT_SCOPE,
      detailRef: result.deferred[0]!.detailRef,
    });
    expect(detail.state).toBe('AVAILABLE');
    if (detail.state === 'AVAILABLE') expect(detail.entry.content).toBe(`needle-${'x'.repeat(100_000)}`);
  });

  it('invalidates same-second, same-length detail and cursor authorities through entry history', () => {
    const firstBody = `history-anchor-${'a'.repeat(20_000)}`;
    const secondBody = `history-anchor-${'a'.repeat(19_999)}b`;
    store.insert({
      id: 'same-second-history', type: 'memory', title: 'History authority',
      content: firstBody, sprint_id: 'sprint-47', sprint_num: 47,
    });
    const first = readMemoryView(store, {
      consumer: 'bot', scope: PROJECT_SCOPE, query: { text: 'history-anchor' },
      limits: { maxEntries: 1, maxCandidates: 1, maxBytes: 4_096, maxLines: 10 },
    });
    expect(first.state).toBe('AVAILABLE');
    if (first.state !== 'AVAILABLE' || first.deferred.length !== 1 || first.nextCursor === null) return;
    const before = store.getById('same-second-history');
    store.update('same-second-history', { content: secondBody });
    const after = store.getById('same-second-history');
    expect(after?.updated_at).toBe(before?.updated_at);

    expect(readMemoryDetail(store, {
      consumer: 'bot', scope: PROJECT_SCOPE, detailRef: first.deferred[0]!.detailRef,
    })).toMatchObject({ state: 'HOLD', reasonCode: 'DETAIL_CHANGED' });
    expect(readMemoryView(store, {
      consumer: 'bot', scope: PROJECT_SCOPE, query: { text: 'history-anchor' },
      limits: { maxEntries: 1, maxCandidates: 1, maxBytes: 4_096, maxLines: 10 },
      cursor: first.nextCursor,
    })).toMatchObject({ state: 'HOLD', reasonCode: 'CURSOR_STALE' });
  });

  it('defers giant metadata from SQL size evidence before a complete-row fetch is needed', () => {
    store.insert({
      id: 'giant-metadata', type: 'memory', title: 'Metadata unit', content: 'small-body',
      metadata: { payload: 'm'.repeat(100_000) }, sprint_num: 46, sprint_id: 'sprint-46',
    });
    const result = readMemoryView(store, {
      consumer: 'api', scope: PROJECT_SCOPE, query: { text: 'small-body' },
      limits: { maxEntries: 2, maxCandidates: 4, maxBytes: 4_096, maxLines: 10 },
    });
    expect(result.state).toBe('AVAILABLE');
    if (result.state !== 'AVAILABLE') return;
    expect(result.entries).toEqual([]);
    expect(result.deferred[0]).toMatchObject({
      candidate: { id: 'giant-metadata', recordByteLengthFloor: expect.any(Number) },
      reasonCode: 'BYTE_LIMIT',
    });
    expect(result.deferred[0]!.candidate.recordByteLengthFloor).toBeGreaterThan(100_000);
    expect(JSON.stringify(result)).not.toContain('mmmmmmmm');
  });

  it('bounds visible opaque detail references and returns one continuation for the rest', () => {
    for (let index = 0; index < 20; index += 1) {
      store.insert({
        id: `oversized-${index}`, type: 'memory', title: `Oversized ${index}`,
        content: `oversized-token-${'z'.repeat(20_000)}`, sprint_num: 100 + index,
      });
    }
    const result = readMemoryView(store, {
      consumer: 'mcp', scope: PROJECT_SCOPE, query: { text: 'oversized-token' },
      limits: { maxEntries: 20, maxCandidates: 20, maxBytes: 4_096, maxLines: 20 },
    });
    expect(result.state).toBe('AVAILABLE');
    if (result.state !== 'AVAILABLE') return;
    expect(result.deferred.length).toBeGreaterThan(0);
    expect(result.deferred.length).toBeLessThan(20);
    expect(result.nextCursor).not.toBeNull();
    const rendered = renderMemoryReadView(result, LABELS);
    expect(Buffer.byteLength(rendered, 'utf8')).toBeLessThanOrEqual(4_096);
    expect(rendered.split('\n').length).toBeLessThanOrEqual(20);
  });

  it('holds when a required whole unit is missing or exceeds either content budget', () => {
    expect(readMemoryView(store, {
      consumer: 'worker', scope: PROJECT_SCOPE, query: {}, requiredIds: ['missing'],
    })).toMatchObject({ state: 'HOLD', reasonCode: 'REQUIRED_ENTRY_MISSING', requiredIds: ['missing'] });

    store.insert({ id: 'required-long', type: 'memory', title: 'Required', content: 'a\nb\nc' });
    expect(readMemoryView(store, {
      consumer: 'worker', scope: PROJECT_SCOPE, query: {}, requiredIds: ['required-long'],
      limits: { maxEntries: 1, maxCandidates: 4, maxBytes: 8_192, maxLines: 2 },
    })).toMatchObject({ state: 'HOLD', reasonCode: 'REQUIRED_ENTRY_OVERSIZE', requiredIds: ['required-long'] });
  });

  it('includes only unresolved priority-critical context, not every accepted ADR', () => {
    for (let index = 0; index < 24; index += 1) {
      store.insert({
        id: `adr-g-${100 + index}`, type: 'adr', title: `Accepted ${index}`,
        content: `accepted-${index}`, status: 'accepted', enforcement_level: 'hard',
      });
    }
    store.insert({
      id: 'critical-open', type: 'debt', title: 'Critical open', content: 'must remain visible',
      status: 'active', priority: 'critical',
    });
    const result = readMemoryView(store, {
      consumer: 'planner', scope: PROJECT_SCOPE, query: { text: 'no-query-match' }, includeCritical: true,
    });
    expect(result.state).toBe('AVAILABLE');
    if (result.state === 'AVAILABLE') {
      expect(result.entries.map((entry) => entry.entry.id)).toEqual(['critical-open']);
      expect(result.entries[0]?.reasons).toEqual(['CRITICAL']);
    }
  });

  it('selects the latest optional identity and retro whole within the exact tenant scope', () => {
    store.insert({
      id: 'identity-a-old', type: 'identity', title: 'Old identity', content: 'old tenant-a identity',
      sprint_id: 'sprint-10', sprint_num: 10, tenant_id: 'tenant-a',
    });
    store.insert({
      id: 'identity-a-current', type: 'identity', title: 'Current identity', content: 'current tenant-a identity',
      sprint_id: 'sprint-20', sprint_num: 20, tenant_id: 'tenant-a',
    });
    store.insert({
      id: 'retro-a-current', type: 'retro', title: 'Current retro', content: 'current tenant-a retro',
      sprint_id: 'sprint-21', sprint_num: 21, tenant_id: 'tenant-a',
    });
    store.insert({
      id: 'retro-b-newer', type: 'retro', title: 'Other tenant retro', content: 'tenant-b must not leak',
      sprint_id: 'sprint-99', sprint_num: 99, tenant_id: 'tenant-b',
    });

    const result = readMemoryView(store, {
      consumer: 'planner', scope: TENANT_A_SCOPE, query: { text: 'no-query-match' },
      preferredLatestTypes: ['identity', 'retro'],
    });

    expect(result.state).toBe('AVAILABLE');
    if (result.state !== 'AVAILABLE') return;
    expect(result.entries.map(({ entry }) => entry.id).sort())
      .toEqual(['identity-a-current', 'retro-a-current']);
    expect(result.entries.every(({ reasons }) => reasons.includes('PREFERRED_LATEST'))).toBe(true);
    expect(JSON.stringify(result)).not.toContain('tenant-b must not leak');
  });

  it('ignores an absent optional latest role but HOLDs a present role that cannot fit whole', () => {
    const absent = readMemoryView(store, {
      consumer: 'planner', scope: TENANT_A_SCOPE, query: { text: 'no-query-match' },
      preferredLatestTypes: ['identity'],
    });
    expect(absent.state).toBe('ABSENT');

    store.insert({
      id: 'tenant-a-retro-oversize', type: 'retro', title: 'Oversize retro',
      content: `whole-retro-${'x'.repeat(8_000)}`, tenant_id: 'tenant-a', sprint_num: 50,
    });
    expect(readMemoryView(store, {
      consumer: 'planner', scope: TENANT_A_SCOPE, query: {}, preferredLatestTypes: ['retro'],
      limits: { maxEntries: 2, maxCandidates: 4, maxBytes: 1_024, maxLines: 20 },
    })).toMatchObject({
      state: 'HOLD', reasonCode: 'REQUIRED_ENTRY_OVERSIZE', requiredIds: ['tenant-a-retro-oversize'],
    });
  });

  it('binds optional latest selectors into request validation and query authority', () => {
    const withoutSelector = readMemoryView(store, {
      consumer: 'planner', scope: PROJECT_SCOPE, query: { text: 'whole local' },
    });
    const withSelector = readMemoryView(store, {
      consumer: 'planner', scope: PROJECT_SCOPE, query: { text: 'whole local' },
      preferredLatestTypes: ['retro'],
    });
    expect(withoutSelector.state).not.toBe('HOLD');
    expect(withSelector.state).not.toBe('HOLD');
    if (withoutSelector.state === 'HOLD' || withSelector.state === 'HOLD') return;
    expect(withSelector.queryDigest).not.toBe(withoutSelector.queryDigest);
    expect(readMemoryView(store, {
      consumer: 'planner', scope: PROJECT_SCOPE, query: {},
      preferredLatestTypes: ['identity', 'identity'],
    })).toMatchObject({ state: 'HOLD', reasonCode: 'INVALID_REQUEST' });
    expect(readMemoryView(store, {
      consumer: 'planner', scope: PROJECT_SCOPE, query: {},
      preferredLatestTypes: ['unknown'],
    } as never)).toMatchObject({ state: 'HOLD', reasonCode: 'INVALID_REQUEST' });
  });

  it('binds continuation to consumer, scope, query, limits and the prior exact candidate page', () => {
    for (let index = 0; index < 4; index += 1) {
      store.insert({
        id: `page-${index}`, type: 'memory', title: `Page ${index}`, content: `page-content-${index}`,
        sprint_id: `sprint-${50 + index}`, sprint_num: 50 + index,
      });
    }
    const input = {
      consumer: 'dashboard' as const, scope: PROJECT_SCOPE, query: { type: ['memory'] },
      limits: { maxEntries: 2, maxCandidates: 2, maxBytes: 8_192, maxLines: 20 },
    };
    const first = readMemoryView(store, input);
    expect(first.state).toBe('AVAILABLE');
    if (first.state !== 'AVAILABLE' || first.nextCursor === null) return;
    const second = readMemoryView(store, { ...input, cursor: first.nextCursor });
    expect(second.state).toBe('AVAILABLE');
    if (second.state === 'AVAILABLE') {
      expect(second.candidates.map((candidate) => candidate.id))
        .not.toEqual(first.candidates.map((candidate) => candidate.id));
    }
    expect(readMemoryView(store, {
      ...input, consumer: 'api', cursor: first.nextCursor,
    })).toMatchObject({ state: 'HOLD', reasonCode: 'CURSOR_INVALID' });

    store.update(first.candidates[first.candidates.length - 1]!.id, { title: 'changed after cursor' });
    expect(readMemoryView(store, { ...input, cursor: first.nextCursor }))
      .toMatchObject({ state: 'HOLD', reasonCode: 'CURSOR_STALE' });
  });

  it('never renders HOLD as empty context and preserves each admitted content unit', () => {
    const unavailable = readMemoryView(store, {
      consumer: 'worker', scope: PROJECT_SCOPE, query: {}, requiredIds: ['absent'],
    });
    expect(() => renderMemoryReadView(unavailable, LABELS)).toThrow(MemoryReadRenderHoldError);

    const available = readMemoryView(store, {
      consumer: 'worker', scope: PROJECT_SCOPE, query: { text: 'whole local' },
    });
    expect(renderMemoryReadView(available, LABELS)).toContain('whole local content');
  });
});

describe('resolveMemoryRequiredIds', () => {
  it('resolves only one accepted scoped ADR canonical ID and feeds exact requiredIds', () => {
    store.insert({
      id: 'adr-g-035', type: 'adr', title: 'Memory SSOT', content: 'DB-first',
      status: 'accepted', adr_class: 'G', tenant_id: 'tenant-a',
    });
    const resolved = resolveMemoryRequiredIds(store, {
      consumer: 'worker', scope: TENANT_A_SCOPE, references: ['ADR-G-035'],
    });
    expect(resolved).toMatchObject({ state: 'AVAILABLE', exactIds: ['adr-g-035'] });
    if (resolved.state !== 'AVAILABLE') return;
    expect(readMemoryView(store, {
      consumer: 'worker', scope: TENANT_A_SCOPE, query: { text: 'does-not-match' }, requiredIds: resolved.exactIds,
    })).toMatchObject({ state: 'AVAILABLE', entries: [{ entry: { id: 'adr-g-035' }, reasons: ['REQUIRED'] }] });
  });

  it('holds missing, non-ADR and ambiguous case-folded references', () => {
    expect(resolveMemoryRequiredIds(store, {
      consumer: 'worker', scope: PROJECT_SCOPE, references: ['ADR-G-999'],
    })).toMatchObject({ state: 'HOLD', reasonCode: 'REQUIRED_ENTRY_MISSING' });
    expect(resolveMemoryRequiredIds(store, {
      consumer: 'worker', scope: PROJECT_SCOPE, references: ['not-an-adr'],
    })).toMatchObject({ state: 'HOLD', reasonCode: 'INVALID_REQUEST' });

    store.insert({ id: 'ADR-D-7', type: 'adr', title: 'One', content: 'one', status: 'accepted' });
    store.insert({ id: 'adr-d-7', type: 'adr', title: 'Two', content: 'two', status: 'accepted' });
    expect(resolveMemoryRequiredIds(store, {
      consumer: 'worker', scope: PROJECT_SCOPE, references: ['Adr-D-7'],
    })).toMatchObject({ state: 'HOLD', reasonCode: 'REQUIRED_REFERENCE_AMBIGUOUS' });
  });

  it('treats missing preset references as optional but preserves ambiguity as HOLD', () => {
    store.insert({ id: 'adr-d-001', type: 'adr', title: 'Present preset', content: 'present', status: 'accepted' });
    expect(resolveMemoryPreferredIds(store, {
      consumer: 'worker', scope: PROJECT_SCOPE, references: ['ADR-D-001', 'ADR-D-404'],
    })).toMatchObject({ state: 'AVAILABLE', exactIds: ['adr-d-001'] });

    store.insert({ id: 'ADR-G-7', type: 'adr', title: 'One', content: 'one', status: 'accepted' });
    store.insert({ id: 'adr-g-7', type: 'adr', title: 'Two', content: 'two', status: 'accepted' });
    expect(resolveMemoryPreferredIds(store, {
      consumer: 'worker', scope: PROJECT_SCOPE, references: ['ADR-G-7'],
    })).toMatchObject({ state: 'HOLD', reasonCode: 'REQUIRED_REFERENCE_AMBIGUOUS' });
  });
});
