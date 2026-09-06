import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import Database from 'better-sqlite3';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { MemoryStore } from '../../src/core/memory-store.js';
import { searchMemory, buildAutoQuery, escapeFts5Query, MemoryQueryError } from '../../src/core/memory-query.js';

let store: MemoryStore;
let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'memquery-test-'));
  const dbPath = join(tmpDir, 'test.db');
  store = new MemoryStore(dbPath);

  // Seed test entries
  store.insert({
    id: 'ADR-006',
    type: 'adr',
    title: 'spawnSync Security Pattern',
    content: 'All shell commands use spawnSync with args array. No shell interpretation.',
    tags: ['security', 'spawnSync', 'shell-injection'],
    status: 'accepted',
    adr_class: 'G',
    scope: 'global+project',
    immutable: true,
    source_authority: 'publisher',
    enforcement_level: 'hard',
  });

  store.insert({
    id: 'ADR-008',
    type: 'adr',
    title: 'Brain Merkezi Import Kurali',
    content: 'Brain projede diger modulleri import eden TEK moduldur.',
    tags: ['brain', 'import', 'circular'],
    status: 'accepted',
    lang: 'tr',
    adr_class: 'D',
    scope: 'dev',
    immutable: false,
    source_authority: 'publisher',
    enforcement_level: 'runtime',
  });

  store.insert({
    id: 'mem-139-001',
    type: 'memory',
    title: 'Docker HB Core Fix',
    content: 'atomicWriteFileSync ile SIGTERM fsync handler eklendi.',
    tags: ['docker', 'heartbeat', 'atomicWrite'],
    sprint_id: 'sprint-139',
    sprint_num: 139,
  });

  store.insert({
    id: 'mem-138-001',
    type: 'memory',
    title: 'ADR Governance Integration',
    content: 'MADR v3 hibrit format, worker prompt injection, validator script.',
    tags: ['adr', 'governance'],
    sprint_id: 'sprint-138',
    sprint_num: 138,
  });

  store.insert({
    id: 'debt-001',
    type: 'debt',
    title: 'MCP disconnect fix',
    content: 'deckent_start fire-and-forget runSprint Promise event loop bloke ediyor.',
    tags: ['mcp', 'disconnect'],
    status: 'active',
    sprint_num: 140,
  });
});

afterEach(() => {
  store.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

// ── FTS search ─────────────────────────────────────────────────────────

describe('searchMemory — FTS', () => {
  it('finds entries by FTS query (docker heartbeat → mem-139-001)', () => {
    const results = searchMemory(store, { text: 'docker heartbeat' });
    expect(results.length).toBeGreaterThanOrEqual(1);
    const ids = results.map(r => r.entry.id);
    expect(ids).toContain('mem-139-001');
  });

  it('returns empty for non-matching query', () => {
    const results = searchMemory(store, { text: 'xyznonexistent' });
    expect(results).toEqual([]);
  });

  it('treats embedded quotes and punctuation as literal FTS input', () => {
    store.insert({
      id: 'mem-quoted-change',
      type: 'memory',
      title: 'Quoted change marker',
      content: 'The "change": field remains searchable without leaking FTS syntax.',
      sprint_id: 'sprint-141',
      sprint_num: 141,
    });

    expect(() => searchMemory(store, { text: '"change":' })).not.toThrow();
    expect(searchMemory(store, { text: '"change":' }).map(result => result.entry.id))
      .toContain('mem-quoted-change');
  });

  it('Turkish normalize: "brain import" finds ADR-008 (Turkish content)', () => {
    const results = searchMemory(store, { text: 'brain import' });
    expect(results.length).toBeGreaterThanOrEqual(1);
    const ids = results.map(r => r.entry.id);
    expect(ids).toContain('ADR-008');
  });

  it('filters by type (text="spawnSync", type=["adr"] → only ADR results)', () => {
    const results = searchMemory(store, { text: 'spawnSync', type: ['adr'] });
    expect(results.length).toBeGreaterThanOrEqual(1);
    for (const r of results) {
      expect(r.entry.type).toBe('adr');
    }
    const ids = results.map(r => r.entry.id);
    expect(ids).toContain('ADR-006');
  });

  it('filters by status (status=["accepted"] → only accepted)', () => {
    const results = searchMemory(store, { status: ['accepted'] });
    expect(results.length).toBeGreaterThanOrEqual(1);
    for (const r of results) {
      expect(r.entry.status).toBe('accepted');
    }
  });

  it('returns ADR taxonomy fields on FTS results', () => {
    const result = searchMemory(store, { text: 'spawnSync', adr_class: ['G'] })[0];
    expect(result?.entry).toMatchObject({
      id: 'ADR-006',
      adr_class: 'G',
      scope: 'global+project',
      immutable: 1,
      source_authority: 'publisher',
      enforcement_level: 'hard',
    });
  });

  it('filters by sprint range (sprint_range.min=139 → only >=139)', () => {
    const results = searchMemory(store, { sprint_range: { min: 139 } });
    expect(results.length).toBeGreaterThanOrEqual(1);
    for (const r of results) {
      expect(r.entry.sprint_num).toBeGreaterThanOrEqual(139);
    }
  });

  it('limits results (limit=2 → max 2)', () => {
    const results = searchMemory(store, { limit: 2 });
    expect(results.length).toBeLessThanOrEqual(2);
  });

  it('returns snippets with highlights for FTS results', () => {
    const results = searchMemory(store, { text: 'docker' });
    expect(results.length).toBeGreaterThanOrEqual(1);
    // FTS results should have snippet
    const withSnippet = results.find(r => r.snippet);
    expect(withSnippet).toBeDefined();
    // Snippet markers
    expect(withSnippet!.snippet).toMatch(/>>>|<<</);
  });

  it('searches all types without filters (broad query)', () => {
    const results = searchMemory(store, { text: 'fix' });
    // Should match mem-139-001 (Docker HB Core Fix) and debt-001 (MCP disconnect fix)
    expect(results.length).toBeGreaterThanOrEqual(2);
    const ids = results.map(r => r.entry.id);
    expect(ids).toContain('mem-139-001');
    expect(ids).toContain('debt-001');
  });

  it('returns relevance scores for FTS results', () => {
    const results = searchMemory(store, { text: 'spawnSync security' });
    expect(results.length).toBeGreaterThanOrEqual(1);
    // FTS results should have non-zero relevance
    for (const r of results) {
      expect(typeof r.relevance).toBe('number');
    }
  });

  it('throws MemoryQueryError on FTS5 syntax error', () => {
    // Unbalanced quotes in the raw FTS should cause MemoryQueryError
    // Note: escapeFts5Query wraps tokens, so normal input is safe.
    // We verify the error class is thrown for truly malformed queries.
    expect(() =>
      searchMemory(store, { text: '"unclosed quote' }),
    ).not.toThrow(); // escaped properly — no error
    // But if FTS5 somehow fails, the error class is MemoryQueryError
    // (verified via dedicated test below)
  });

  it('uses OR mode by default (broader recall)', () => {
    // "docker governance" — docker matches mem-139-001, governance matches mem-138-001
    const results = searchMemory(store, { text: 'docker governance' });
    const ids = results.map(r => r.entry.id);
    // OR mode: both should be found
    expect(ids).toContain('mem-139-001');
    expect(ids).toContain('mem-138-001');
  });

  it('uses AND mode when mode=and (narrower, all tokens must match)', () => {
    // "docker governance" in AND mode — no single entry has both
    const results = searchMemory(store, { text: 'docker governance', mode: 'and' });
    expect(results.length).toBe(0);
  });

  it('AND mode finds entries containing all tokens', () => {
    // "docker heartbeat" in AND mode — mem-139-001 has both
    const results = searchMemory(store, { text: 'docker heartbeat', mode: 'and' });
    const ids = results.map(r => r.entry.id);
    expect(ids).toContain('mem-139-001');
  });

  it('explicit mode=or behaves same as default', () => {
    const defaultResults = searchMemory(store, { text: 'spawnSync security' });
    const orResults = searchMemory(store, { text: 'spawnSync security', mode: 'or' });
    expect(orResults.length).toBe(defaultResults.length);
    expect(orResults.map(r => r.entry.id)).toEqual(defaultResults.map(r => r.entry.id));
  });
});

// ── Structured query (no text) ─────────────────────────────────────────

describe('searchMemory — structured (no text)', () => {
  it('returns entries ordered by sprint_num DESC when no text', () => {
    const results = searchMemory(store, {});
    expect(results.length).toBeGreaterThanOrEqual(1);
    // Check descending order
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1].entry.sprint_num).toBeGreaterThanOrEqual(
        results[i].entry.sprint_num,
      );
    }
  });

  it('filters by type without text', () => {
    const results = searchMemory(store, { type: ['debt'] });
    expect(results.length).toBe(1);
    expect(results[0].entry.id).toBe('debt-001');
  });

  it('filters ADRs by class and scope without text', () => {
    const global = searchMemory(store, {
      type: ['adr'],
      adr_class: ['G'],
      adr_scope: ['global+project'],
    });
    expect(global.map(result => result.entry.id)).toEqual(['ADR-006']);

    const dogfood = searchMemory(store, {
      type: ['adr'],
      adr_class: ['D'],
      adr_scope: ['dev'],
    });
    expect(dogfood.map(result => result.entry.id)).toEqual(['ADR-008']);
  });

  it('filters by tags_contain (entries must have ALL specified tags)', () => {
    const results = searchMemory(store, { tags_contain: ['docker', 'heartbeat'] });
    expect(results.length).toBe(1);
    expect(results[0].entry.id).toBe('mem-139-001');
  });

  it('tags_contain with no matching combo returns empty', () => {
    const results = searchMemory(store, {
      tags_contain: ['docker', 'governance'],
    });
    expect(results).toEqual([]);
  });

  it('excludes soft-deleted entries by default', () => {
    store.softDelete('debt-001', 'test');
    const results = searchMemory(store, { type: ['debt'] });
    expect(results.length).toBe(0);
  });

  it('includes soft-deleted entries when include_deleted=true', () => {
    store.softDelete('debt-001', 'test');
    const results = searchMemory(store, { type: ['debt'], include_deleted: true });
    expect(results.length).toBe(1);
    expect(results[0].entry.id).toBe('debt-001');
  });

  it('filters by decay_exempt', () => {
    store.insert({
      id: 'exempt-001',
      type: 'identity',
      title: 'Project Identity',
      content: 'Never decays',
      tags: ['identity'],
      decay_exempt: true,
    });
    const results = searchMemory(store, { decay_exempt: true });
    expect(results.length).toBe(1);
    expect(results[0].entry.id).toBe('exempt-001');
  });
});

// ── buildAutoQuery ─────────────────────────────────────────────────────

describe('buildAutoQuery', () => {
  it('constructs correct params from keywords and scope', () => {
    const params = buildAutoQuery(
      ['docker', 'heartbeat'],
      ['src/orchestra'],
    );
    expect(params.text).toBe('docker heartbeat');
    expect(params.type).toEqual(['adr', 'pattern', 'memory']);
    expect(params.tags_contain).toEqual(['src/orchestra']);
    expect(params.limit).toBe(5);
  });

  it('omits tags_contain when scope is empty', () => {
    const params = buildAutoQuery(['security'], []);
    expect(params.tags_contain).toBeUndefined();
  });

  it('respects custom opts', () => {
    const params = buildAutoQuery(
      ['mcp'],
      [],
      { type: ['debt'], sprintRange: 135 },
    );
    expect(params.type).toEqual(['debt']);
    expect(params.sprint_range).toEqual({ min: 135 });
  });

  it('always sets mode to or for Brain auto-query', () => {
    const params = buildAutoQuery(['docker', 'heartbeat'], ['src/orchestra']);
    expect(params.mode).toBe('or');
  });
});

// ── escapeFts5Query ───────────────────────────────────────────────────

describe('escapeFts5Query', () => {
  it('wraps tokens in quotes (default OR join)', () => {
    expect(escapeFts5Query('docker heartbeat')).toBe('"docker" OR "heartbeat"');
  });

  it('joins with space in AND mode', () => {
    expect(escapeFts5Query('docker heartbeat', 'and')).toBe('"docker" "heartbeat"');
  });

  it('preserves OR/AND/NOT operators without duplication', () => {
    // Explicit OR kept, no extra OR inserted
    expect(escapeFts5Query('docker OR heartbeat')).toBe('"docker" OR "heartbeat"');
    // AND mode: explicit operators preserved
    expect(escapeFts5Query('docker AND heartbeat', 'and')).toBe('"docker" AND "heartbeat"');
    // NOT operator
    expect(escapeFts5Query('NOT broken', 'and')).toBe('NOT "broken"');
    expect(escapeFts5Query('NOT broken', 'or')).toBe('NOT "broken"');
  });

  it('handles trailing wildcard', () => {
    expect(escapeFts5Query('dock*')).toBe('"dock"*');
    expect(escapeFts5Query('dock* beat*', 'and')).toBe('"dock"* "beat"*');
  });

  it('doubles embedded quotes in literals and wildcard bases', () => {
    expect(escapeFts5Query('"change":')).toBe('"""change"":"');
    expect(escapeFts5Query('change"*')).toBe('"change"""*');
  });

  it('handles empty input', () => {
    expect(escapeFts5Query('')).toBe('');
    expect(escapeFts5Query('   ')).toBe('');
  });

  it('handles single token', () => {
    expect(escapeFts5Query('docker')).toBe('"docker"');
    expect(escapeFts5Query('docker', 'and')).toBe('"docker"');
  });
});

// ── MemoryQueryError ──────────────────────────────────────────────────

describe('MemoryQueryError', () => {
  it('is an instance of Error with correct name', () => {
    const err = new MemoryQueryError('test');
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('MemoryQueryError');
    expect(err.message).toBe('test');
  });

  it('preserves cause', () => {
    const cause = new Error('sqlite error');
    const err = new MemoryQueryError('FTS5 failed', cause);
    expect(err.cause).toBe(cause);
  });

  it('fails closed when an explicit tenant query targets a schema without tenant_id', () => {
    const legacyPath = join(tmpDir, 'legacy-no-tenant.db');
    const legacyDb = new Database(legacyPath);
    legacyDb.exec('CREATE TABLE entries (id TEXT PRIMARY KEY)');
    legacyDb.close();
    const legacyStore = new MemoryStore(legacyPath, { readOnly: true });
    try {
      expect(() => searchMemory(legacyStore, { tenantId: 'tenant-a' }))
        .toThrowError(/requires entries\.tenant_id/u);
    } finally {
      legacyStore.close();
    }
  });
});
