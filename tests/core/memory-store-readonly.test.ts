import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { MemoryStore } from '../../src/core/memory-store.js';

const roots: string[] = [];
const stores: MemoryStore[] = [];
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'memory-readonly-'));
  roots.push(root);
  const path = join(root, 'memory.db');
  const writer = new MemoryStore(path);
  stores.push(writer);
  writer.insert({ id: 'original', type: 'memory', title: 'Original', content: 'Keep all source bytes.', tags: ['source'] });
  return { path, writer };
}
afterEach(() => {
  for (const store of stores.splice(0).reverse()) store.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('MemoryStore read-only projection contract', () => {
  it('reads complete source records without allowing writes or changing persisted database bytes', () => {
    const { path, writer } = fixture();
    const expected = writer.getById('original');
    writer.close();
    stores.splice(stores.indexOf(writer), 1);
    const before = readFileSync(path);
    const reader = new MemoryStore(path, { readOnly: true });
    stores.push(reader);
    expect(reader.readSnapshot(() => ({ entry: reader.getById('original'), tags: reader.getTagsForEntry('original'), history: reader.getHistory('original') })))
      .toMatchObject({ entry: expected, tags: ['source'] });
    expect(() => reader.insert({ id: 'forbidden', type: 'memory', title: 'Forbidden', content: 'Must not persist.' })).toThrow();
    reader.close();
    stores.splice(stores.indexOf(reader), 1);
    expect(readFileSync(path)).toEqual(before);
  });

  it('never creates a missing database in read-only mode', () => {
    const root = mkdtempSync(join(tmpdir(), 'memory-readonly-absent-'));
    roots.push(root);
    const path = join(root, 'absent.db');
    expect(() => new MemoryStore(path, { readOnly: true })).toThrow();
    expect(existsSync(path)).toBe(false);
  });

  it('holds one WAL read revision while a different connection updates the source', () => {
    const { path, writer } = fixture();
    const reader = new MemoryStore(path, { readOnly: true });
    stores.push(reader);
    reader.readSnapshot(() => {
      expect(reader.getById('original')?.title).toBe('Original');
      writer.update('original', { title: 'Later revision' });
      expect(reader.getById('original')?.title).toBe('Original');
    });
    expect(reader.getById('original')?.title).toBe('Later revision');
  });

  it('forbids mutations during nested snapshots and restores writer capability after an exception', () => {
    const { writer } = fixture();
    expect(() => writer.readSnapshot(() => writer.readSnapshot(() => writer.update('original', { title: 'Forbidden' })))).toThrow(/readonly/u);
    expect(writer.getById('original')?.title).toBe('Original');
    writer.update('original', { title: 'Allowed after snapshot' });
    expect(writer.getById('original')?.title).toBe('Allowed after snapshot');
  });

  it('retains tenant isolation on read-only query paths', () => {
    const { path, writer } = fixture();
    writer.insert({ id: 'private', type: 'memory', title: 'Private', content: 'Tenant only', tenant_id: 'tenant-a' });
    const reader = new MemoryStore(path, { readOnly: true });
    stores.push(reader);
    expect(reader.getByType('memory', 'tenant-a').map(entry => entry.id)).toEqual(['private']);
    expect(reader.getByType('memory', 'tenant-b')).toEqual([]);
  });

  it('rejects async callbacks before invoking them, and restores capability after rejected thenables', () => {
    const { writer } = fixture();
    let invoked = false;
    // @ts-expect-error A snapshot callback must be synchronous, also enforced at runtime.
    expect(() => writer.readSnapshot(async () => { invoked = true; })).toThrow('MEMORY_READ_SNAPSHOT_ASYNC_UNSUPPORTED');
    expect(invoked).toBe(false);
    // @ts-expect-error A non-async function returning a Promise is not a read snapshot either.
    expect(() => writer.readSnapshot(() => Promise.resolve('not a snapshot'))).toThrow(/promise/u);
    writer.update('original', { title: 'Writable after rejection' });
    expect(writer.getById('original')?.title).toBe('Writable after rejection');
  });
});
