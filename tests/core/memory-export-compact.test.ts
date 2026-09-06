import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { getMessage } from '../../src/cli/helpers/messages.js';
import {
  exportMemoryDetailsMd,
  exportMemoryMd,
  exportSummaryMd,
  writeGuardedExports,
} from '../../src/core/memory-export.js';
import { buildMemoryExportLabels } from '../../src/core/memory-export-labels.js';
import { MemoryStore } from '../../src/core/memory-store.js';
import { parseSprintOrdinal } from '../../src/core/utils.js';

let root: string;
let store: MemoryStore;

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => compareCodeUnits(left, right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function semanticSnapshot(): string {
  return store.readSnapshot(() => canonicalJson({
    entries: store.getByType('memory').map(entry => ({
      entry,
      tags: [...store.getTagsForEntry(entry.id)].sort(compareCodeUnits),
      history: store.getHistory(entry.id),
      relations: store.getRelations(entry.id)
        .sort((left, right) => compareCodeUnits(canonicalJson(left), canonicalJson(right))),
    })).sort((left, right) => compareCodeUnits(left.entry.id, right.entry.id)),
    relationCount: store.countRelations(),
    totalCount: store.totalCount(),
  }));
}

function insertMemory(input: {
  id: string;
  sprintId?: string;
  sprintNum?: number;
  content?: string;
  title?: string;
}): void {
  store.insert({
    id: input.id,
    type: 'memory',
    title: input.title ?? input.id,
    content: input.content ?? `content:${input.id}`,
    source: 'brain',
    status: 'active',
    priority: 'normal',
    ...(input.sprintId === undefined ? {} : { sprint_id: input.sprintId }),
    ...(input.sprintNum === undefined ? {} : { sprint_num: input.sprintNum }),
    tags: ['meaning', input.id],
    metadata: { evidenceRef: `fixture:${input.id}` },
  });
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'memory-export-compact-'));
  store = new MemoryStore(join(root, 'memory.db'));
});

afterEach(() => {
  store.close();
  rmSync(root, { recursive: true, force: true });
});

describe('lossless compact memory export', () => {
  it('preserves complete meaning and every source record without an entry cap', () => {
    const longContent = [
      'Claim: preserve every meaning unit.',
      'Condition: the compact view may collapse presentation only.',
      'Exception: source records are never rewritten.',
      'Negative: do not delete, paraphrase, or truncate.',
      'Limit: 3000 is a view target, not a storage cap.',
      'Source: receipt fixture-9002.',
      '<script>not executable inside the generated code fence</script>',
      '````` embedded fence remains source text',
      ...Array.from({ length: 3_050 }, (_, index) => `meaning-unit-${index}: ${'x'.repeat(24)}`),
      'trailing spaces stay exact.   ',
    ].join('\n');
    insertMemory({ id: 'memory-current', sprintId: 'sprint-724', sprintNum: 724, content: longContent });
    for (let index = 0; index < 14; index++) {
      insertMemory({ id: `memory-bulk-${String(index).padStart(2, '0')}`, sprintId: 'sprint-723', sprintNum: 723 });
    }
    store.insertRelation({ from_id: 'memory-current', to_id: 'memory-bulk-00', type: 'depends_on' });
    store.update('memory-current', { priority: 'high' }, 'compact-test');
    const before = semanticSnapshot();
    const labels = buildMemoryExportLabels(getMessage, 'en');

    const summary = exportSummaryMd(store, { labels });
    const memory = exportMemoryMd(store, { labels, maxInlineLines: 40 });
    const details = exportMemoryDetailsMd(store, { labels, maxInlineLines: 40 });
    const current = store.getById('memory-current')!;

    expect(summary).not.toContain(longContent);
    expect(memory).not.toContain(longContent);
    expect(details).toContain(longContent);
    expect(memory.split('\n').length).toBeLessThanOrEqual(40);
    expect(memory).toContain('memory-details.md#memory-entry-');
    expect(summary).toContain('memory-current');
    expect(summary).toContain('Complete memory index');
    expect(memory).toContain('memory-bulk-13');
    for (let index = 0; index < 14; index++) {
      const id = `memory-bulk-${String(index).padStart(2, '0')}`;
      expect(memory).toContain(id);
    }
    expect(details).toContain('"source":"brain"');
    expect(details).toContain('"rel_type":"depends_on"');
    expect(details).toContain('"changed_by":"compact-test"');
    expect(details).toContain('fixture:memory-current');
    expect(details).toContain(`"created_at":${JSON.stringify(current.created_at)}`);
    expect(details).toContain('"tags":["meaning","memory-current"]');
    expect(details).toContain(`"content_byte_length":${Buffer.byteLength(longContent, 'utf8')}`);
    expect(semanticSnapshot()).toBe(before);
  });

  it('orders ordinal sprints deterministically and keeps one truthful legacy plus one null group', () => {
    const epoch = Date.UTC(2024, 0, 1);
    insertMemory({ id: 'equal-b', sprintId: 'sprint-724', sprintNum: 724 });
    insertMemory({ id: 'equal-a', sprintId: 'sprint-724', sprintNum: 724 });
    insertMemory({ id: 'older', sprintId: 'sprint-723', sprintNum: 723 });
    insertMemory({ id: 'legacy-a', sprintId: `sprint-${epoch}`, sprintNum: epoch });
    insertMemory({ id: 'legacy-b', sprintId: `sprint-${epoch + 1}`, sprintNum: epoch + 1 });
    insertMemory({ id: 'without-sprint' });
    const labels = buildMemoryExportLabels(getMessage, 'en');

    const memory = exportMemoryMd(store, { labels });
    const summary = exportSummaryMd(store, { labels });
    const details = exportMemoryDetailsMd(store, { labels });

    expect(parseSprintOrdinal(`sprint-${epoch}`)).toBeNull();
    expect(parseSprintOrdinal('sprint-724')).toBe(724);
    expect(parseSprintOrdinal('not-a-sprint')).toBeNull();
    expect(parseSprintOrdinal(`sprint-${Date.UTC(2000, 0, 1)}`)).toBeNull();
    expect(parseSprintOrdinal(`sprint-${Date.UTC(2000, 0, 1) - 1}`)).toBe(Date.UTC(2000, 0, 1) - 1);
    expect(parseSprintOrdinal(`sprint-${Date.UTC(3000, 0, 1)}`)).toBe(Date.UTC(3000, 0, 1));
    expect(memory.indexOf('Sprint sprint-724 Learnings')).toBeLessThan(memory.indexOf('Sprint sprint-723 Learnings'));
    expect(memory.indexOf('equal-a')).toBeLessThan(memory.indexOf('equal-b'));
    expect(memory.match(/^## Legacy Epoch Learnings$/gmu)).toHaveLength(1);
    expect(memory).not.toContain(`## Sprint sprint-${epoch} Learnings`);
    expect(memory).toContain(`**Sprint ID:** sprint-${epoch}`);
    expect(details).toContain(`"sprint-${epoch}"`);
    expect(memory).toContain('## Learnings Without Sprint Attribution');
    expect(details).toContain('"sprint_id":null');
    expect(summary).toContain('Complete memory index');
    expect(summary).toContain('### Legacy Epoch Learnings');
    expect(summary).toContain('### Learnings Without Sprint Attribution');
    expect(summary).not.toContain('without-sprint');
    expect(summary).toContain('equal-a');
    expect(summary).not.toContain('equal-b');
    expect(summary.indexOf('equal-a')).toBeLessThan(summary.indexOf('### Legacy Epoch Learnings'));
  });

  it('keeps every ID reachable while bounding a large human view', () => {
    for (let index = 0; index < 429; index++) {
      insertMemory({
        id: `memory-many-${String(index).padStart(3, '0')}`,
        sprintId: index % 2 === 0 ? 'sprint-724' : 'sprint-723',
        sprintNum: index % 2 === 0 ? 724 : 723,
      });
    }
    const labels = buildMemoryExportLabels(getMessage);

    const memory = exportMemoryMd(store, { labels, maxInlineLines: 500 });
    const summary = exportSummaryMd(store, { labels, summaryInlineLines: 10 });
    const details = exportMemoryDetailsMd(store, { labels });

    expect(memory.split('\n').length).toBeLessThanOrEqual(500);
    expect(summary.split('\n').length).toBeLessThanOrEqual(500);
    for (let index = 0; index < 429; index++) {
      const id = `memory-many-${String(index).padStart(3, '0')}`;
      expect(memory).toContain(id);
      expect(details).toContain(id);
    }
    expect(summary).toContain('memory-many-000');
    expect(summary).not.toContain('memory-many-001');
    expect(summary.split('\n').length).toBeLessThan(40);
    expect(memory).toContain('memory-details.md#memory-entry-');
    expect(memory).not.toContain('"history"');
    expect(summary).not.toContain('"history"');
    expect(details).toContain('deckent-memory-export:v2 kind=memory-details entry-type=memory entry-count=429');
  });

  it('spills one oversized single-line unit by bytes without cutting its source', () => {
    const content = `single-line:${'x'.repeat(270_000)}`;
    insertMemory({ id: 'memory-byte-boundary', sprintId: 'sprint-724', content });
    const labels = buildMemoryExportLabels(getMessage);

    const memory = exportMemoryMd(store, { labels });
    const summary = exportSummaryMd(store, { labels });
    const details = exportMemoryDetailsMd(store, { labels });

    expect(memory).not.toContain(content);
    expect(summary).not.toContain(content);
    expect(memory).toContain('memory-byte-boundary');
    expect(memory).toContain('memory-details.md#memory-entry-');
    expect(details).toContain(content);
    expect(details).toContain(`"content_byte_length":${Buffer.byteLength(content, 'utf8')}`);
  });

  it('retains every MemoryEntryV2 provenance field in the details authority', () => {
    store.insert({
      id: 'memory-provenance',
      type: 'memory',
      title: 'provenance',
      content: 'complete-source',
      source: 'system',
      adr_class: 'D',
      scope: 'project',
      immutable: true,
      source_authority: 'fixture-authority',
      enforcement_level: 'runtime',
    });
    const details = exportMemoryDetailsMd(store, {
      labels: buildMemoryExportLabels(getMessage),
    });

    expect(details).toContain('"adr_class":"D"');
    expect(details).toContain('"scope":"project"');
    expect(details).toContain('"immutable":1');
    expect(details).toContain('"source_authority":"fixture-authority"');
    expect(details).toContain('"enforcement_level":"runtime"');
  });

  it('uses locale-independent structural guard metadata and replays deterministic bytes', () => {
    insertMemory({ id: 'turkish-memory', sprintId: 'sprint-724', sprintNum: 724 });
    const labels = buildMemoryExportLabels(getMessage, 'tr');
    const exportsDir = join(root, 'exports');

    const first = writeGuardedExports(store, exportsDir, { labels });
    const firstMemory = readFileSync(join(exportsDir, 'memory.md'), 'utf8');
    const firstDetails = readFileSync(join(exportsDir, 'memory-details.md'), 'utf8');
    const second = writeGuardedExports(store, exportsDir, { labels });

    expect(first.warnings).toEqual([]);
    expect(second.warnings).toEqual([]);
    expect(readFileSync(join(exportsDir, 'memory.md'), 'utf8')).toBe(firstMemory);
    expect(readFileSync(join(exportsDir, 'memory-details.md'), 'utf8')).toBe(firstDetails);
    expect(first.written[0]).toBe('memory-details.md');
    expect(firstMemory).toContain('deckent-memory-export:v2 kind=memory entry-type=memory entry-count=1');
    expect(firstMemory).toContain('## sprint-724 Sprint Öğrenimleri');
  });

  it('does not let a legacy no-options caller overwrite a configured compact projection', () => {
    insertMemory({ id: 'configured-memory', sprintId: 'sprint-724', sprintNum: 724 });
    const exportsDir = join(root, 'exports');
    writeGuardedExports(store, exportsDir, {
      labels: buildMemoryExportLabels(getMessage, 'tr'),
    });
    const before = new Map<string, string>(
      ['summary.md', 'decisions.md', 'memory.md', 'debt.md', 'memory-details.md'].map(name => [
        name, readFileSync(join(exportsDir, name), 'utf8'),
      ] as const),
    );

    const result = writeGuardedExports(store, exportsDir);

    expect(result.written).toEqual([]);
    expect(result.skipped).toEqual(['summary.md', 'decisions.md', 'memory.md', 'debt.md']);
    expect(result.warnings.every(warning => warning.includes('COMPACT_RENDER_OPTIONS_REQUIRED'))).toBe(true);
    for (const [name, content] of before) {
      expect(readFileSync(join(exportsDir, name), 'utf8')).toBe(content);
    }
  });

  it('holds a localized partial render by structural count rather than translated empty text', () => {
    insertMemory({ id: 'guarded-memory', sprintId: 'sprint-724', sprintNum: 724 });
    const labels = buildMemoryExportLabels(getMessage, 'tr');
    const exportsDir = join(root, 'exports');
    writeGuardedExports(store, exportsDir, { labels });
    const prior = readFileSync(join(exportsDir, 'memory.md'), 'utf8');
    let memoryReads = 0;
    const racy = new Proxy(store, {
      get(target, property, receiver) {
        if (property === 'getByType') {
          return (type: string) => {
            if (type !== 'memory') return target.getByType(type as never);
            memoryReads++;
            return memoryReads === 2 ? [] : target.getByType('memory');
          };
        }
        return Reflect.get(target, property, receiver);
      },
    });

    const result = writeGuardedExports(racy as unknown as MemoryStore, exportsDir, { labels });

    expect(result.skipped).toContain('memory.md');
    expect(result.warnings).toEqual(expect.arrayContaining([
      expect.stringMatching(/DB has 0 memory entries but render has 1/u),
    ]));
    expect(readFileSync(join(exportsDir, 'memory.md'), 'utf8')).toBe(prior);
  });

  it('finishes every render before the first output write', () => {
    const exportsDir = join(root, 'exports');
    mkdirSync(exportsDir, { recursive: true });
    const prior = new Map<string, string>();
    for (const name of ['summary.md', 'decisions.md', 'memory.md', 'debt.md', 'memory-details.md']) {
      const bytes = `prior:${name}`;
      prior.set(name, bytes);
      writeFileSync(join(exportsDir, name), bytes);
    }
    const throwing = new Proxy(store, {
      get(target, property, receiver) {
        if (property === 'getByType') {
          return (type: string) => {
            if (type === 'pattern') throw new Error('render-failure');
            return target.getByType(type as never);
          };
        }
        return Reflect.get(target, property, receiver);
      },
    });

    expect(() => writeGuardedExports(
      throwing as unknown as MemoryStore,
      exportsDir,
      { labels: buildMemoryExportLabels(getMessage) },
    )).toThrow('render-failure');
    for (const [name, bytes] of prior) {
      expect(readFileSync(join(exportsDir, name), 'utf8')).toBe(bytes);
    }
  });

  it('preserves an existing output boundary when the atomic writer cannot create files', () => {
    insertMemory({ id: 'atomic-memory', sprintId: 'sprint-724', sprintNum: 724 });
    const exportsDir = join(root, 'exports');
    writeFileSync(exportsDir, 'preserve-me');

    expect(() => writeGuardedExports(store, exportsDir, {
      labels: buildMemoryExportLabels(getMessage),
    })).toThrow();
    expect(readFileSync(exportsDir, 'utf8')).toBe('preserve-me');
  });

  it('holds without output while another writer owns the export lock', () => {
    const exportsDir = join(root, 'exports');
    const lockPath = join(exportsDir, '.memory-export-write.lock');
    mkdirSync(lockPath, { recursive: true });
    writeFileSync(
      join(lockPath, 'owner.json'),
      JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }),
    );

    let caught: unknown;
    try {
      writeGuardedExports(store, exportsDir, {
        labels: buildMemoryExportLabels(getMessage),
      });
    } catch (error: unknown) {
      caught = error;
    }
    expect(caught).toMatchObject({
      code: 'MEMORY_EXPORT_RENDER_HOLD', message: 'writer-lock-timeout',
    });
    expect(readFileSync(join(lockPath, 'owner.json'), 'utf8')).toContain(String(process.pid));
    expect(readdirSync(exportsDir)).toEqual(['.memory-export-write.lock']);
  });
});
