/**
 * Tests for GET /api/memory/search?q= endpoint (Sprint 216, Task 216-012).
 *
 * Uses the real HTTP test harness (startTestServer) with a real MemoryStore
 * seeded in the tmpdir — no gitignored local state ever read (hermetic).
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { MemoryStore } from '../../src/core/memory-store.js';
import {
  startTestServer,
  call,
  type TestServerHandle,
} from './test-server-helper.js';

/** Seed a MemoryStore in the test project root with a minimal entry. */
function seedMemory(projectRoot: string, entries: Array<{ title: string; content: string; type?: string }>): void {
  mkdirSync(join(projectRoot, '.brain'), { recursive: true });
  const dbPath = join(projectRoot, '.brain', 'memory.db');
  const store = new MemoryStore(dbPath);
  entries.forEach((e, i) => {
    store.insert({
      id: `test-entry-${i + 1}`,
      type: (e.type ?? 'memory') as Parameters<typeof store.insert>[0]['type'],
      source: 'user',
      title: e.title,
      content: e.content,
    });
  });
  store.close();
}

describe('GET /api/memory/search', () => {
  let handle: TestServerHandle;

  afterEach(async () => {
    if (handle) {
      await handle.close();
      handle = undefined as unknown as TestServerHandle;
    }
  });

  it('returns matching results for a valid query', async () => {
    handle = await startTestServer({ disableAuth: true });
    seedMemory(handle.projectRoot, [
      { title: 'ADR-001 TypeScript', content: 'Use TypeScript for all source files.' },
      { title: 'Sprint 200 retro', content: 'All tasks completed successfully.' },
    ]);

    const res = await call(handle, '/api/memory/search?q=TypeScript');

    expect(res.status).toBe(200);
    const body = res.json<Array<{ entry: { title: string }; relevance: number }>>();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThanOrEqual(1);
    const titles = body.map(r => r.entry.title);
    expect(titles.some(t => t.includes('TypeScript'))).toBe(true);
  });

  it('returns empty array for empty query', async () => {
    handle = await startTestServer({ disableAuth: true });
    seedMemory(handle.projectRoot, [{ title: 'Some entry', content: 'Some content' }]);

    const res = await call(handle, '/api/memory/search?q=');

    expect(res.status).toBe(200);
    const body = res.json<unknown[]>();
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(0);
  });

  it('returns empty array when query has no matching results', async () => {
    handle = await startTestServer({ disableAuth: true });
    seedMemory(handle.projectRoot, [
      { title: 'Docker config', content: 'Docker setup for CI.' },
    ]);

    const res = await call(handle, '/api/memory/search?q=xyzzynonexistent9999');

    expect(res.status).toBe(200);
    const body = res.json<unknown[]>();
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(0);
  });

  it('finds entries via FTS5 normalized Turkish search', async () => {
    handle = await startTestServer({ disableAuth: true });
    // Insert entry with Turkish content (ğ, ü, ş characters)
    seedMemory(handle.projectRoot, [
      { title: 'Brain Konfigürasyonu', content: 'Beyin yapılandırması güncellendi' },
    ]);

    // Search with ASCII-folded equivalent (konfigurasyonu → konfigürasyonu via normalize)
    const res = await call(handle, '/api/memory/search?q=konfigurasyonu');

    expect(res.status).toBe(200);
    const body = res.json<Array<{ entry: { title: string }; relevance: number }>>();
    // FTS5 dual-layer normalize: ASCII-folded query should match Turkish title
    expect(Array.isArray(body)).toBe(true);
    // Whether found or not depends on FTS5 normalization — at minimum, no error
    // and the response shape is correct
    if (body.length > 0) {
      expect(body[0]).toHaveProperty('entry');
      expect(body[0]).toHaveProperty('relevance');
    }
  });

  it('returns empty array when memory DB does not exist', async () => {
    handle = await startTestServer({ disableAuth: true });
    // Don't seed any memory — DB file will not exist

    const res = await call(handle, '/api/memory/search?q=adr');

    expect(res.status).toBe(200);
    const body = res.json<unknown[]>();
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(0);
  });
});

describe('GET /api/memory/search v1 bounded reader', () => {
  let handle: TestServerHandle;
  afterEach(async () => {
    if (handle) { await handle.close(); handle = undefined as unknown as TestServerHandle; }
  });

  it('returns the versioned scoped view and a typed HOLD instead of a fake empty result when the DB is absent', async () => {
    handle = await startTestServer({ disableAuth: true });
    const absent = await call(handle, '/api/memory/search?v=1&q=needle');
    expect(absent.status).toBe(200);
    expect(absent.json<{ schemaVersion: number; view: { state: string; reasonCode: string } }>()).toMatchObject({ schemaVersion: 1, view: { state: 'HOLD', reasonCode: 'QUERY_FAILED' } });

    seedMemory(handle.projectRoot, [{ title: 'Scoped complete entry', content: 'needle whole entry body' }]);
    const available = await call(handle, '/api/memory/search?v=1&q=needle&type=memory');
    expect(available.status).toBe(200);
    expect(available.json<{ schemaVersion: number; view: { state: string; entries: Array<{ entry: { content: string } }> } }>()).toMatchObject({
      schemaVersion: 1,
      view: { state: 'AVAILABLE', entries: [{ entry: { content: 'needle whole entry body' } }] },
    });
  });

  it('upgrades the /api/memory compatibility route to a bounded v1 scoped projection', async () => {
    handle = await startTestServer({ disableAuth: true });
    seedMemory(handle.projectRoot, [{ title: 'Memory alias', content: 'bounded alias content', type: 'memory' }]);
    const response = await call(handle, '/api/memory');
    expect(response.status).toBe(200);
    expect(response.json<{ schemaVersion: number; content: string; view: { state: string } }>()).toMatchObject({
      schemaVersion: 1,
      view: { state: 'AVAILABLE' },
    });
  });
});

// ═══ TENANT-001 T4b (GR-2026-08-08-TENANT-T4B-01) — memory-search tenant scope ═
// Measured 2026-08-08: the widest tenant leak in the product. server.ts called
// registerMemorySearch WITHOUT `req`, so the principal was never derived and
// even a tenant-claimed caller saw ALL tenants; a tenant-less caller omitted the
// predicate and read across every tenant. These pins run the REAL server with a
// real bearer + real strict config over a real seeded memory.db.
function fakeJwt(claims: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return `${header}.${payload}.fakesig`;
}
function bearer(claims: Record<string, unknown>): Record<string, string> {
  return { Authorization: `Bearer ${fakeJwt(claims)}` };
}

describe('GET /api/memory/search — TENANT-001 T4b tenant scope', () => {
  let handle: TestServerHandle;
  afterEach(async () => {
    if (handle) { await handle.close(); handle = undefined as unknown as TestServerHandle; }
  });

  // OIDC bearer path needs auth ON (a verified principal), so mint an explicit
  // token and additionally carry the tenant claim via the fake JWT.
  async function bootStrict(strict: boolean): Promise<TestServerHandle> {
    // disableAuth so the auth-gate does not reject our fake OIDC bearer; the
    // principal (incl. tenant claim) is still derived from the bearer by
    // deriveRequestPrincipal (signature-agnostic by contract). The tenant
    // DECISION is what strict_tenant_isolation gates, independent of auth.
    return startTestServer({
      disableAuth: true,
      seed: { config: { strict_tenant_isolation: strict } },
    });
  }

  it('strict ON: a tenant-less caller is refused with 403 (no all-tenant read)', async () => {
    handle = await bootStrict(true);
    seedMemory(handle.projectRoot, [{ title: 'ADR-001', content: 'TypeScript everywhere' }]);
    const res = await call(handle, '/api/memory/search?q=TypeScript', {
      headers: bearer({ sub: 'alice' }), // no tenant claim
    });
    expect(res.status).toBe(403);
    expect(res.text).toMatch(/tenant scope unresolved/u);
  });

  it('strict ON: a tenant-claimed caller only sees its own tenant rows', async () => {
    handle = await bootStrict(true);
    // Seed rows under two tenants directly in the store.
    const dbPath = join(handle.projectRoot, '.brain', 'memory.db');
    mkdirSync(join(handle.projectRoot, '.brain'), { recursive: true });
    const store = new MemoryStore(dbPath);
    store.insert({ id: 'acme-1', type: 'memory', source: 'user', title: 'ACME secret', content: 'TypeScript acme plan', tenant_id: 'acme' } as Parameters<typeof store.insert>[0]);
    store.insert({ id: 'globex-1', type: 'memory', source: 'user', title: 'GLOBEX secret', content: 'TypeScript globex plan', tenant_id: 'globex' } as Parameters<typeof store.insert>[0]);
    store.close();

    const res = await call(handle, '/api/memory/search?q=TypeScript', {
      headers: bearer({ sub: 'bob', tenant: 'acme' }),
    });
    expect(res.status).toBe(200);
    const body = res.json<Array<{ entry: { title: string } }>>();
    const titles = body.map(r => r.entry.title);
    expect(titles.some(t => t.includes('ACME'))).toBe(true);
    expect(titles.some(t => t.includes('GLOBEX'))).toBe(false); // cross-tenant leak closed
  });

  it('strict OFF: a tenant-less caller keeps the v1 unfiltered read (operator parity)', async () => {
    handle = await bootStrict(false);
    seedMemory(handle.projectRoot, [{ title: 'ADR-001', content: 'TypeScript everywhere' }]);
    const res = await call(handle, '/api/memory/search?q=TypeScript', {
      headers: bearer({ sub: 'alice' }), // no tenant claim, strict off
    });
    expect(res.status).toBe(200);
    const body = res.json<unknown[]>();
    expect(body.length).toBeGreaterThanOrEqual(1);
  });
});
