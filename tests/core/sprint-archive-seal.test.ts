import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { Worker } from 'node:worker_threads';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { MemoryStore } from '../../src/core/memory-store.js';
import { buildMemoryExportLabels } from '../../src/core/memory-export-labels.js';
import {
  isSprintArchivePathContained,
  publishSprintArchiveArtifact,
  resolveSprintArchiveDir,
  sealSprintArchiveTerminal,
  verifySprintArchiveTerminal,
  type SprintArchiveTerminalSealRequest,
} from '../../src/core/sprint-archive.js';
import type { SprintTerminalReceiptV1 } from '../../src/core/sprint-terminal-publication.js';

const sprintId = 'sprint-629';
let root: string;
const receipt: SprintTerminalReceiptV1 = {
  version: 1,
  sprintId,
  runId: 'run-629',
  coordinatorGeneration: 4,
  terminalOutcome: 'COMPLETE',
  logicalSettlementDigest: 'a'.repeat(64),
  priorAuthorityVersion: 8,
  authorityVersion: 9,
};

function digest(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function write(relativePath: string, content: string): string {
  const path = join(root, relativePath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
  return path;
}

function journal(lines = [{ sequence: 1 }, { sequence: 2 }]): string {
  return `${lines.map(JSON.stringify).join('\n')}\n`;
}

function persistMarker(wrapper = false, value: SprintTerminalReceiptV1 = receipt): string {
  const persisted = wrapper ? {
    version: 1,
    terminalOutcome: value.terminalOutcome,
    publicationState: {
      version: 1,
      sprintId,
      runId: value.runId,
      coordinatorGeneration: value.coordinatorGeneration,
      authorityVersion: value.authorityVersion,
      receipt: value,
    },
    receipt: value,
    terminalEvidence: {},
    writtenAt: '2026-08-23T00:00:00.000Z',
  } : value;
  return write(`.deckent/recently-works/${sprintId}-terminal-receipt.json`, JSON.stringify(persisted));
}

function request(
  hotPath: string,
  content: string,
  expectedArchivedPreimageSha256: string | null,
  overrides: Partial<SprintArchiveTerminalSealRequest> = {},
): SprintArchiveTerminalSealRequest {
  const line = content.trimEnd().split('\n').at(-1)!;
  const sequence = JSON.parse(line).sequence as number;
  write(`.deckent/recently-works/${sprintId}-seq`, String(sequence));
  return {
    receipt,
    finalEvent: { sequence, digest: digest(line) },
    hotJournalPath: hotPath,
    expectedArchivedPreimageSha256,
    expectedHotJournalSha256: digest(content),
    operatorReason: 'owner-authorized terminal archive repair',
    ...overrides,
  };
}

function createBrain(): void {
  mkdirSync(join(root, '.brain'), { recursive: true });
  const store = new MemoryStore(join(root, '.brain', 'memory.db'));
  store.close();
}

function brainDiskSnapshot(): Record<string, { sha256: string; mtimeMs: number } | null> {
  const paths = [
    '.brain/memory.db',
    '.brain/memory.db-wal',
    '.brain/memory.db-shm',
    '.brain/exports/summary.md',
    '.brain/exports/decisions.md',
    '.brain/exports/memory.md',
    '.brain/exports/debt.md',
  ];
  return Object.fromEntries(paths.map(relativePath => {
    const path = join(root, relativePath);
    return [relativePath, existsSync(path)
      ? { sha256: digest(readFileSync(path)), mtimeMs: statSync(path).mtimeMs }
      : null];
  }));
}

function diskSnapshot(paths: readonly string[]): Record<string, {
  readonly sha256: string;
  readonly size: number;
  readonly mtimeMs: number;
} | null> {
  return Object.fromEntries(paths.map(path => [path, existsSync(path)
    ? {
      sha256: digest(readFileSync(path)),
      size: statSync(path).size,
      mtimeMs: statSync(path).mtimeMs,
    }
    : null]));
}

beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'archive-seal-')); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

describe('typed terminal archive seal', () => {
  it('accepts the canonical persisted terminal-receipt wrapper and verifies exact identity', () => {
    persistMarker(true);
    const content = journal();
    const hot = write(`.deckent/recently-works/${sprintId}-events.jsonl`, content);

    const result = sealSprintArchiveTerminal(root, sprintId, request(hot, content, null));

    expect(result).toMatchObject({ disposition: 'sealed', terminalComplete: true });
    expect(result.receipt?.terminalReceipt).toEqual(receipt);
    expect(result.receipt?.priorAuthorityVersion).toBe(receipt.priorAuthorityVersion);
    expect(verifySprintArchiveTerminal(root, sprintId, hot)).toMatchObject({ ok: true, reasonCodes: [] });
  });

  it('seals exact journal/sequence parity and replays idempotently', () => {
    persistMarker();
    const content = journal();
    const hot = write(`.deckent/recently-works/${sprintId}-events.jsonl`, content);
    const authority = request(hot, content, null);

    const first = sealSprintArchiveTerminal(root, sprintId, authority);
    const second = sealSprintArchiveTerminal(root, sprintId, authority);
    const archiveDir = resolveSprintArchiveDir(root, sprintId);

    expect(first).toMatchObject({ disposition: 'sealed', terminalComplete: true });
    expect(second).toMatchObject({ disposition: 'idempotent', terminalComplete: true });
    expect(readFileSync(join(archiveDir, `${sprintId}-events.jsonl`), 'utf8')).toBe(content);
    expect(readFileSync(join(archiveDir, `${sprintId}-seq`), 'utf8')).toBe('2');
  });

  it('replays an exact applied seal after hot counter retirement and rejects request drift without writes', () => {
    persistMarker();
    const content = journal();
    const hot = write(`.deckent/recently-works/${sprintId}-events.jsonl`, content);
    const authority = request(hot, content, null);
    expect(sealSprintArchiveTerminal(root, sprintId, authority).terminalComplete).toBe(true);
    const hotSequencePath = join(root, '.deckent', 'recently-works', `${sprintId}-seq`);
    expect(existsSync(hotSequencePath)).toBe(false);
    writeFileSync(hotSequencePath, '2');
    const archiveDir = resolveSprintArchiveDir(root, sprintId);
    const authorityPaths = [
      `${sprintId}-events.jsonl`, `${sprintId}-seq`, 'manifest.json',
      'terminal-seal-receipt.json', 'terminal-seal-application.json',
    ];
    const before = authorityPaths.map(name => digest(readFileSync(join(archiveDir, name))));

    expect(sealSprintArchiveTerminal(root, sprintId, authority)).toMatchObject({
      disposition: 'idempotent',
      terminalComplete: true,
    });
    expect(existsSync(hotSequencePath)).toBe(false);
    expect(sealSprintArchiveTerminal(root, sprintId, {
      ...authority,
      operatorReason: 'different owner-authorized reason',
    })).toMatchObject({ terminalComplete: false, reasonCode: 'terminal_identity_mismatch' });
    expect(authorityPaths.map(name => digest(readFileSync(join(archiveDir, name))))).toEqual(before);
  });

  it('rejects a tampered prior application without writing through the retired-counter fallback', () => {
    persistMarker();
    const content = journal();
    const hot = write(`.deckent/recently-works/${sprintId}-events.jsonl`, content);
    const authority = request(hot, content, null);
    expect(sealSprintArchiveTerminal(root, sprintId, authority).terminalComplete).toBe(true);
    const archiveDir = resolveSprintArchiveDir(root, sprintId);
    const applicationPath = join(archiveDir, 'terminal-seal-application.json');
    const application = JSON.parse(readFileSync(applicationPath, 'utf8')) as Record<string, unknown>;
    writeFileSync(applicationPath, `${JSON.stringify({ ...application, state: 'tampered' }, null, 2)}\n`);
    const authorityPaths = [
      hot,
      join(archiveDir, `${sprintId}-events.jsonl`),
      join(archiveDir, `${sprintId}-seq`),
      join(archiveDir, 'manifest.json'),
      join(archiveDir, 'terminal-seal-receipt.json'),
      applicationPath,
    ];
    const before = diskSnapshot(authorityPaths);

    expect(sealSprintArchiveTerminal(root, sprintId, authority)).toMatchObject({
      terminalComplete: false,
      reasonCode: 'terminal_identity_mismatch',
    });
    expect(diskSnapshot(authorityPaths)).toEqual(before);
  });

  it('requires a hot counter for initial seal and never masks a mismatched live counter on resume', () => {
    persistMarker();
    const content = journal();
    const hot = write(`.deckent/recently-works/${sprintId}-events.jsonl`, content);
    const authority = request(hot, content, null);
    const hotSequencePath = join(root, '.deckent', 'recently-works', `${sprintId}-seq`);
    unlinkSync(hotSequencePath);
    expect(sealSprintArchiveTerminal(root, sprintId, authority)).toMatchObject({
      terminalComplete: false,
      reasonCode: 'sequence_counter_mismatch',
    });
    expect(existsSync(join(resolveSprintArchiveDir(root, sprintId), 'terminal-seal-receipt.json'))).toBe(false);

    writeFileSync(hotSequencePath, '2');
    expect(sealSprintArchiveTerminal(root, sprintId, authority).terminalComplete).toBe(true);
    const archiveDir = resolveSprintArchiveDir(root, sprintId);
    const applicationPath = join(archiveDir, 'terminal-seal-application.json');
    const application = JSON.parse(readFileSync(applicationPath, 'utf8')) as Record<string, unknown>;
    writeFileSync(applicationPath, `${JSON.stringify({
      kind: application.kind,
      version: application.version,
      sprintId: application.sprintId,
      state: 'staged',
      sealReceiptSha256: application.sealReceiptSha256,
    }, null, 2)}\n`);
    writeFileSync(hotSequencePath, '1');
    const authorityPaths = [
      hot,
      hotSequencePath,
      join(archiveDir, `${sprintId}-events.jsonl`),
      join(archiveDir, `${sprintId}-seq`),
      join(archiveDir, 'manifest.json'),
      join(archiveDir, 'terminal-seal-receipt.json'),
      applicationPath,
    ];
    const before = diskSnapshot(authorityPaths);

    expect(sealSprintArchiveTerminal(root, sprintId, authority)).toMatchObject({
      terminalComplete: false,
      reasonCode: 'sequence_counter_mismatch',
    });
    expect(diskSnapshot(authorityPaths)).toEqual(before);
  });

  it('CAS-repairs only strict journal/sequence prefixes and preserves both preimages', () => {
    persistMarker();
    const oldJournal = `${JSON.stringify({ sequence: 1 })}\n`;
    const content = journal();
    const hot = write(`.deckent/recently-works/${sprintId}-events.jsonl`, content);
    write(`.deckent/archive/sprints/${sprintId}/${sprintId}-events.jsonl`, oldJournal);
    write(`.deckent/archive/sprints/${sprintId}/${sprintId}-seq`, '1');

    const result = sealSprintArchiveTerminal(root, sprintId, request(hot, content, digest(oldJournal)));
    const archiveDir = resolveSprintArchiveDir(root, sprintId);

    expect(result).toMatchObject({ disposition: 'repaired', terminalComplete: true });
    expect(result.receipt?.expectedArchivedPreimageSha256).toBe(digest(oldJournal));
    expect(result.receipt?.expectedArchivedSequencePreimageSha256).toBe(digest('1'));
    expect(readFileSync(join(archiveDir, result.receipt!.repairedHistoryPath!), 'utf8')).toBe(oldJournal);
    expect(readFileSync(join(archiveDir, result.receipt!.repairedSequenceHistoryPath!), 'utf8')).toBe('1');
    expect(readFileSync(join(archiveDir, `${sprintId}-seq`), 'utf8')).toBe('2');
  });

  it('fails closed before staging for receipt, digest, reason, and non-prefix mismatches', () => {
    const content = journal();
    const hot = write(`.deckent/recently-works/${sprintId}-events.jsonl`, content);
    const valid = request(hot, content, null);
    expect(sealSprintArchiveTerminal(root, sprintId, valid)).toMatchObject({ reasonCode: 'missing_terminal_marker' });

    persistMarker(false, { ...receipt, priorAuthorityVersion: 7 });
    expect(sealSprintArchiveTerminal(root, sprintId, valid)).toMatchObject({ reasonCode: 'terminal_identity_mismatch' });
    persistMarker();
    expect(sealSprintArchiveTerminal(root, sprintId, { ...valid, operatorReason: ' ' })).toMatchObject({
      reasonCode: 'invalid_operator_reason',
    });
    expect(sealSprintArchiveTerminal(root, sprintId, {
      ...valid,
      expectedHotJournalSha256: 'b'.repeat(64),
    })).toMatchObject({ reasonCode: 'preimage_mismatch' });

    const divergent = '{"sequence":99}\n';
    write(`.deckent/archive/sprints/${sprintId}/${sprintId}-events.jsonl`, divergent);
    const result = sealSprintArchiveTerminal(root, sprintId, request(hot, content, digest(divergent)));
    expect(result).toMatchObject({ reasonCode: 'non_prefix_divergence', terminalComplete: false });
    expect(existsSync(join(resolveSprintArchiveDir(root, sprintId), 'terminal-seal-receipt.json'))).toBe(false);
  });

  it('rejects non-canonical hot paths and regressed sequence counters', () => {
    persistMarker();
    const content = journal();
    const canonical = write(`.deckent/recently-works/${sprintId}-events.jsonl`, content);
    const foreign = write('.deckent/recently-works/foreign-events.jsonl', content);
    expect(sealSprintArchiveTerminal(root, sprintId, request(foreign, content, null))).toMatchObject({
      reasonCode: 'invalid_hot_journal_path',
    });

    const oldJournal = `${JSON.stringify({ sequence: 1 })}\n`;
    write(`.deckent/archive/sprints/${sprintId}/${sprintId}-events.jsonl`, oldJournal);
    write(`.deckent/archive/sprints/${sprintId}/${sprintId}-seq`, '9');
    expect(sealSprintArchiveTerminal(root, sprintId, request(canonical, content, digest(oldJournal)))).toMatchObject({
      reasonCode: 'sequence_counter_mismatch',
    });
  });

  it('does not declare green for a stale final-event identity', () => {
    persistMarker();
    const content = journal();
    const hot = write(`.deckent/recently-works/${sprintId}-events.jsonl`, content);
    const stale = request(hot, content, null, { finalEvent: { sequence: 1, digest: 'b'.repeat(64) } });

    expect(sealSprintArchiveTerminal(root, sprintId, stale)).toMatchObject({
      disposition: 'hold',
      terminalComplete: false,
      reasonCode: 'terminal_identity_mismatch',
    });
    expect(existsSync(join(resolveSprintArchiveDir(root, sprintId), 'manifest.json'))).toBe(false);
  });

  it('binds manifest, compact Brain index, and guarded summary digests in applied receipt', () => {
    persistMarker(true);
    createBrain();
    const content = journal();
    const hot = write(`.deckent/recently-works/${sprintId}-events.jsonl`, content);

    const result = sealSprintArchiveTerminal(root, sprintId, request(hot, content, null, { adoptBrain: true }));
    const verification = verifySprintArchiveTerminal(root, sprintId, hot);
    const store = new MemoryStore(join(root, '.brain', 'memory.db'));
    const archiveEntry = store.getById(`archive-${sprintId}`);
    store.close();

    expect(result).toMatchObject({ terminalComplete: true, applicationReceipt: { state: 'applied', brainAdopted: true } });
    expect(result.applicationReceipt?.manifestDigest).toBe(verification.manifestDigest);
    expect(result.applicationReceipt?.brainIndexSha256).toBe(verification.brainIndexSha256);
    expect(result.applicationReceipt?.guardedSummarySha256).toBe(verification.guardedSummarySha256);
    expect(JSON.parse(archiveEntry!.metadata)).toMatchObject({
      manifestDigest: `sha256:${verification.manifestDigest}`,
      guardedSummarySha256: `sha256:${verification.guardedSummarySha256}`,
    });
    expect(existsSync(join(root, '.brain', 'exports', 'summary.md'))).toBe(true);
    expect(verification.ok).toBe(true);
  });

  it('forwards caller-owned labels through Brain adoption without persisting render options', () => {
    persistMarker(true);
    createBrain();
    const content = journal();
    const hot = write(`.deckent/recently-works/${sprintId}-events.jsonl`, content);
    const labels = buildMemoryExportLabels((key, language) => `${language}:${key}`, 'tr');

    const result = sealSprintArchiveTerminal(
      root,
      sprintId,
      request(hot, content, null, { adoptBrain: true }),
      { labels },
    );
    const receiptPath = join(resolveSprintArchiveDir(root, sprintId), 'terminal-seal-receipt.json');

    expect(result).toMatchObject({ terminalComplete: true, applicationReceipt: { state: 'applied', brainAdopted: true } });
    expect(readFileSync(join(root, '.brain', 'exports', 'summary.md'), 'utf8')).toContain(`# ${labels.summaryTitle}`);
    expect(JSON.parse(readFileSync(receiptPath, 'utf8'))).not.toHaveProperty('renderOptions');
  });

  it('binds the writer-owned adopted row while another live Brain WAL connection remains open', () => {
    persistMarker(true);
    createBrain();
    const content = journal();
    const hot = write(`.deckent/recently-works/${sprintId}-events.jsonl`, content);
    const liveStore = new MemoryStore(join(root, '.brain', 'memory.db'));
    try {
      liveStore.insert({
        id: 'unrelated-pre-adoption-write',
        type: 'learning',
        title: 'Unrelated pre-adoption WAL row',
        content: 'Keeps the live Brain WAL lifecycle active during archive adoption.',
      });

      const result = sealSprintArchiveTerminal(
        root,
        sprintId,
        request(hot, content, null, { adoptBrain: true }),
      );

      expect(result).toMatchObject({
        terminalComplete: true,
        applicationReceipt: {
          state: 'applied',
          brainAdopted: true,
          brainIndexSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
          guardedSummarySha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        },
      });
      expect(liveStore.getById(`archive-${sprintId}`)).not.toBeNull();
      expect(verifySprintArchiveTerminal(root, sprintId, hot)).toMatchObject({ ok: true, reasonCodes: [] });
    } finally {
      liveStore.close();
    }
  });

  it('replays an earlier adoption after a later canonical Brain refresh and rejects its row tampering', () => {
    persistMarker(true);
    createBrain();
    const content = journal();
    const hot = write(`.deckent/recently-works/${sprintId}-events.jsonl`, content);
    const authority = request(hot, content, null, { adoptBrain: true });

    expect(sealSprintArchiveTerminal(root, sprintId, authority)).toMatchObject({
      disposition: 'sealed',
      terminalComplete: true,
    });
    const firstSummary = readFileSync(join(root, '.brain', 'exports', 'summary.md'), 'utf8');
    const laterSprintId = 'sprint-630';
    const laterReceipt: SprintTerminalReceiptV1 = {
      ...receipt, sprintId: laterSprintId, runId: 'run-630', priorAuthorityVersion: 9, authorityVersion: 10,
    };
    write(`.deckent/recently-works/${laterSprintId}-terminal-receipt.json`, JSON.stringify(laterReceipt));
    const laterContent = journal([{ sequence: 1 }]);
    const laterHot = write(`.deckent/recently-works/${laterSprintId}-events.jsonl`, laterContent);
    write(`.deckent/recently-works/${laterSprintId}-seq`, '1');
    const laterLine = laterContent.trim();
    expect(sealSprintArchiveTerminal(root, laterSprintId, {
      receipt: laterReceipt,
      finalEvent: { sequence: 1, digest: digest(laterLine) },
      hotJournalPath: laterHot,
      expectedArchivedPreimageSha256: null,
      expectedHotJournalSha256: digest(laterContent),
      operatorReason: 'owner-authorized terminal archive repair',
      adoptBrain: true,
    })).toMatchObject({ terminalComplete: true });
    expect(readFileSync(join(root, '.brain', 'exports', 'summary.md'), 'utf8')).not.toBe(firstSummary);
    expect(verifySprintArchiveTerminal(root, sprintId, hot)).toMatchObject({ ok: true, reasonCodes: [] });
    expect(sealSprintArchiveTerminal(root, sprintId, authority)).toMatchObject({
      disposition: 'idempotent', terminalComplete: true,
    });

    const store = new MemoryStore(join(root, '.brain', 'memory.db'));
    try {
      const entry = store.getById(`archive-${sprintId}`)!;
      store.update(entry.id, { summary: 'drifted Brain projection' }, 'test-drift');
    } finally {
      store.close();
    }
    expect(verifySprintArchiveTerminal(root, sprintId, hot)).toMatchObject({
      ok: false,
      reasonCodes: expect.arrayContaining(['brain_adoption_failed']),
    });
  });

  it('verifies the Brain projection through a byte-stable read-only SQLite path', () => {
    persistMarker(true);
    createBrain();
    const content = journal();
    const hot = write(`.deckent/recently-works/${sprintId}-events.jsonl`, content);
    const authority = request(hot, content, null, { adoptBrain: true });
    expect(sealSprintArchiveTerminal(root, sprintId, authority).terminalComplete).toBe(true);
    const before = brainDiskSnapshot();

    expect(verifySprintArchiveTerminal(root, sprintId, hot)).toMatchObject({ ok: true, reasonCodes: [] });
    expect(verifySprintArchiveTerminal(root, sprintId, hot)).toMatchObject({ ok: true, reasonCodes: [] });

    expect(brainDiskSnapshot()).toEqual(before);
  });

  it('verifies from a detached DB+WAL snapshot while a live Brain writer remains open', () => {
    persistMarker(true);
    createBrain();
    const content = journal();
    const hot = write(`.deckent/recently-works/${sprintId}-events.jsonl`, content);
    const authority = request(hot, content, null, { adoptBrain: true });
    expect(sealSprintArchiveTerminal(root, sprintId, authority).terminalComplete).toBe(true);
    const store = new MemoryStore(join(root, '.brain', 'memory.db'));
    try {
      store.insert({
        id: 'unrelated-live-write',
        type: 'learning',
        title: 'Unrelated live write',
        content: 'Must remain observable without touching source DB/WAL/SHM.',
      });
      expect(statSync(join(root, '.brain', 'memory.db-wal')).size).toBeGreaterThan(0);
      const before = brainDiskSnapshot();

      expect(verifySprintArchiveTerminal(root, sprintId, hot)).toMatchObject({ ok: true, reasonCodes: [] });

      expect(brainDiskSnapshot()).toEqual(before);
    } finally {
      store.close();
    }
  });

  it('fails closed before following a symlinked Brain database into external authority', () => {
    persistMarker(true);
    const externalDir = join(root, 'external-brain');
    mkdirSync(externalDir, { recursive: true });
    const externalDbPath = join(externalDir, 'memory.db');
    new MemoryStore(externalDbPath).close();
    mkdirSync(join(root, '.brain'), { recursive: true });
    symlinkSync(externalDbPath, join(root, '.brain', 'memory.db'), 'file');
    const content = journal();
    const hot = write(`.deckent/recently-works/${sprintId}-events.jsonl`, content);

    const result = sealSprintArchiveTerminal(
      root,
      sprintId,
      request(hot, content, null, { adoptBrain: true }),
    );
    const externalStore = new MemoryStore(externalDbPath);
    try {
      expect(result).toMatchObject({ terminalComplete: false, reasonCode: 'brain_adoption_failed' });
      expect(externalStore.getById(`archive-${sprintId}`)).toBeNull();
      expect(existsSync(join(root, '.brain', 'exports', 'summary.md'))).toBe(false);
    } finally {
      externalStore.close();
    }
  });

  it('holds metadata digest mismatch through detached read-only verification without writes', () => {
    persistMarker(true);
    createBrain();
    const content = journal();
    const hot = write(`.deckent/recently-works/${sprintId}-events.jsonl`, content);
    expect(sealSprintArchiveTerminal(
      root,
      sprintId,
      request(hot, content, null, { adoptBrain: true }),
    ).terminalComplete).toBe(true);
    const store = new MemoryStore(join(root, '.brain', 'memory.db'));
    try {
      const entry = store.getById(`archive-${sprintId}`)!;
      store.update(entry.id, {
        metadata: JSON.stringify({
          ...JSON.parse(entry.metadata) as Record<string, unknown>,
          manifestDigest: `sha256:${'f'.repeat(64)}`,
        }),
      }, 'test-tamper');
    } finally {
      store.close();
    }
    const before = brainDiskSnapshot();

    expect(verifySprintArchiveTerminal(root, sprintId, hot)).toMatchObject({
      ok: false,
      reasonCodes: expect.arrayContaining(['brain_adoption_failed']),
    });
    expect(brainDiskSnapshot()).toEqual(before);
  });

  it('fails closed on a malformed live WAL without mutating Brain authority', () => {
    persistMarker(true);
    createBrain();
    const content = journal();
    const hot = write(`.deckent/recently-works/${sprintId}-events.jsonl`, content);
    expect(sealSprintArchiveTerminal(
      root,
      sprintId,
      request(hot, content, null, { adoptBrain: true }),
    ).terminalComplete).toBe(true);
    write('.brain/memory.db-wal', 'not-a-sqlite-wal');
    const before = brainDiskSnapshot();

    expect(verifySprintArchiveTerminal(root, sprintId, hot)).toMatchObject({
      ok: false,
      reasonCodes: expect.arrayContaining(['brain_adoption_failed']),
    });
    expect(brainDiskSnapshot()).toEqual(before);
  });

  it('fails closed when the source WAL changes during the detached snapshot CAS', async () => {
    persistMarker(true);
    createBrain();
    const content = journal();
    const hot = write(`.deckent/recently-works/${sprintId}-events.jsonl`, content);
    expect(sealSprintArchiveTerminal(
      root,
      sprintId,
      request(hot, content, null, { adoptBrain: true }),
    ).terminalComplete).toBe(true);
    const store = new MemoryStore(join(root, '.brain', 'memory.db'));
    store.insert({
      id: 'concurrent-wal-write',
      type: 'learning',
      title: 'Concurrent WAL write',
      content: 'Forces source snapshot drift during observational verification.',
    });
    const control = new Int32Array(new SharedArrayBuffer(8));
    const worker = new Worker(`
      const { workerData } = require('node:worker_threads');
      const { closeSync, fsyncSync, openSync, writeSync } = require('node:fs');
      const control = new Int32Array(workerData.control);
      const descriptor = openSync(workerData.path, 'a');
      const bytes = Buffer.alloc(32, 0xa5);
      do {
        writeSync(descriptor, bytes);
        fsyncSync(descriptor);
        Atomics.store(control, 0, 1);
        Atomics.notify(control, 0);
      } while (Atomics.load(control, 1) === 0);
      closeSync(descriptor);
    `, {
      eval: true,
      workerData: { path: join(root, '.brain', 'memory.db-wal'), control: control.buffer },
    });
    expect(Atomics.wait(control, 0, 0, 5_000)).not.toBe('timed-out');
    try {
      expect(verifySprintArchiveTerminal(root, sprintId, hot)).toMatchObject({
        ok: false,
        reasonCodes: expect.arrayContaining(['brain_adoption_failed']),
      });
    } finally {
      Atomics.store(control, 1, 1);
      Atomics.notify(control, 1);
      await worker.terminate();
      store.close();
    }
  });

  it('rejects an applied-receipt attempt to downgrade required Brain adoption', () => {
    persistMarker(true);
    createBrain();
    const content = journal();
    const hot = write(`.deckent/recently-works/${sprintId}-events.jsonl`, content);
    const authority = request(hot, content, null, { adoptBrain: true });
    const sealed = sealSprintArchiveTerminal(root, sprintId, authority);
    expect(sealed.receipt).toMatchObject({ brainAdoptionRequired: true });
    const applicationPath = join(resolveSprintArchiveDir(root, sprintId), 'terminal-seal-application.json');
    const application = JSON.parse(readFileSync(applicationPath, 'utf8')) as Record<string, unknown>;
    writeFileSync(applicationPath, `${JSON.stringify({
      ...application,
      brainAdopted: false,
      brainIndexSha256: null,
      guardedSummarySha256: null,
    }, null, 2)}\n`);

    expect(verifySprintArchiveTerminal(root, sprintId, hot)).toMatchObject({
      ok: false,
      reasonCodes: expect.arrayContaining(['application_not_applied', 'brain_adoption_failed']),
    });
    expect(sealSprintArchiveTerminal(root, sprintId, authority)).toMatchObject({
      terminalComplete: false,
      reasonCode: 'application_not_applied',
    });
  });

  it('leaves a typed staged receipt instead of false success when guarded Brain adoption fails', () => {
    persistMarker();
    createBrain();
    write('.brain/exports/summary.md', '# retained operator summary\n');
    const content = journal();
    const hot = write(`.deckent/recently-works/${sprintId}-events.jsonl`, content);

    const result = sealSprintArchiveTerminal(root, sprintId, request(hot, content, null, { adoptBrain: true }));
    const application = JSON.parse(readFileSync(
      join(resolveSprintArchiveDir(root, sprintId), 'terminal-seal-application.json'),
      'utf8',
    )) as { state: string };

    expect(result).toMatchObject({ terminalComplete: false, reasonCode: 'brain_adoption_failed' });
    expect(application.state).toBe('staged');
    expect(verifySprintArchiveTerminal(root, sprintId, hot)).toMatchObject({
      ok: false,
      reasonCodes: expect.arrayContaining(['application_not_applied']),
    });
  });

  it('detects receipt/history traversal tampering and handles Windows containment semantics', () => {
    persistMarker();
    const oldJournal = `${JSON.stringify({ sequence: 1 })}\n`;
    const content = journal();
    const hot = write(`.deckent/recently-works/${sprintId}-events.jsonl`, content);
    write(`.deckent/archive/sprints/${sprintId}/${sprintId}-events.jsonl`, oldJournal);
    write(`.deckent/archive/sprints/${sprintId}/${sprintId}-seq`, '1');
    const authority = request(hot, content, digest(oldJournal));
    expect(sealSprintArchiveTerminal(root, sprintId, authority).terminalComplete).toBe(true);

    const sealPath = join(resolveSprintArchiveDir(root, sprintId), 'terminal-seal-receipt.json');
    const seal = JSON.parse(readFileSync(sealPath, 'utf8')) as Record<string, unknown>;
    writeFileSync(sealPath, `${JSON.stringify({ ...seal, repairedHistoryPath: '../../outside' }, null, 2)}\n`);
    const archiveDir = resolveSprintArchiveDir(root, sprintId);
    const authorityPaths = [
      hot,
      join(root, '.deckent', 'recently-works', `${sprintId}-seq`),
      join(archiveDir, `${sprintId}-events.jsonl`),
      join(archiveDir, `${sprintId}-seq`),
      join(archiveDir, 'manifest.json'),
      sealPath,
      join(archiveDir, 'terminal-seal-application.json'),
      ...(typeof seal.repairedHistoryPath === 'string'
        ? [join(archiveDir, seal.repairedHistoryPath)] : []),
      ...(typeof seal.repairedSequenceHistoryPath === 'string'
        ? [join(archiveDir, seal.repairedSequenceHistoryPath)] : []),
    ];
    const before = diskSnapshot(authorityPaths);
    expect(verifySprintArchiveTerminal(root, sprintId, hot)).toMatchObject({ ok: false });
    expect(sealSprintArchiveTerminal(root, sprintId, authority)).toMatchObject({
      terminalComplete: false,
      reasonCode: 'terminal_identity_mismatch',
    });
    expect(diskSnapshot(authorityPaths)).toEqual(before);

    expect(isSprintArchivePathContained('C:\\repo\\archive', 'C:\\repo\\archive\\history\\a', 'win32')).toBe(true);
    expect(isSprintArchivePathContained('C:\\repo\\archive', 'C:\\repo\\outside', 'win32')).toBe(false);
    expect(isSprintArchivePathContained('C:\\repo\\archive', 'D:\\repo\\archive\\a', 'win32')).toBe(false);
  });

  it('rejects a canonical hot namespace redirected through a symlink or junction parent', () => {
    mkdirSync(join(root, '.deckent'), { recursive: true });
    const redirected = join(root, 'redirected-hot');
    mkdirSync(redirected, { recursive: true });
    symlinkSync(
      redirected,
      join(root, '.deckent', 'recently-works'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    persistMarker();
    const content = journal();
    const hot = write(`.deckent/recently-works/${sprintId}-events.jsonl`, content);

    expect(sealSprintArchiveTerminal(root, sprintId, request(hot, content, null))).toMatchObject({
      terminalComplete: false,
      reasonCode: 'invalid_hot_journal_path',
    });
  });

  it('rejects an archive namespace redirected through a symlink or junction', () => {
    persistMarker();
    const content = journal();
    const hot = write(`.deckent/recently-works/${sprintId}-events.jsonl`, content);
    const authority = request(hot, content, null);
    const redirected = join(root, 'redirected-archive');
    mkdirSync(redirected, { recursive: true });
    mkdirSync(join(root, '.deckent', 'archive', 'sprints'), { recursive: true });
    symlinkSync(
      redirected,
      resolveSprintArchiveDir(root, sprintId),
      process.platform === 'win32' ? 'junction' : 'dir',
    );

    expect(sealSprintArchiveTerminal(root, sprintId, authority)).toMatchObject({
      terminalComplete: false,
      reasonCode: 'invalid_archive_path',
    });
    expect(existsSync(join(redirected, 'terminal-seal-receipt.json'))).toBe(false);
  });
});

describe('sealed archive artifact publication', () => {
  it('publishes ordinary artifacts before a terminal sidecar exists', () => {
    const source = write('source/ordinary.txt', 'ordinary');

    const publication = publishSprintArchiveArtifact(root, sprintId, source, 'docs/ordinary.txt');

    expect(publication).toMatchObject({ path: 'docs/ordinary.txt', state: 'published', sourceRetired: false });
    expect(readFileSync(join(resolveSprintArchiveDir(root, sprintId), publication.path), 'utf8')).toBe('ordinary');
  });

  it('does not write through a redirected canonical parent', () => {
    const source = write('source/redirected.txt', 'must-not-escape');
    const external = mkdtempSync(join(tmpdir(), 'deckent-archive-external-'));
    mkdirSync(join(root, '.deckent', 'archive'), { recursive: true });
    symlinkSync(external, join(root, '.deckent', 'archive', 'sprints'));

    expect(() => publishSprintArchiveArtifact(root, sprintId, source, 'docs/redirected.txt'))
      .toThrow(/ARCHIVE_UNSAFE_NAMESPACE/u);
    expect(existsSync(join(external, sprintId, 'docs', 'redirected.txt'))).toBe(false);
    expect(existsSync(source)).toBe(true);
    rmSync(external, { recursive: true, force: true });
  });

  it('rejects new and conflicting publication after a seal or application sidecar without mutation', () => {
    const archive = resolveSprintArchiveDir(root, sprintId);
    write('.deckent/archive/sprints/sprint-629/docs/existing.txt', 'canonical');
    const newSource = write('source/new.txt', 'new');
    write('.deckent/archive/sprints/sprint-629/terminal-seal-receipt.json', '{}');

    expect(() => publishSprintArchiveArtifact(root, sprintId, newSource, 'docs/new.txt'))
      .toThrow(/ARCHIVE_TERMINAL_PUBLICATION_REJECTED/u);
    expect(existsSync(newSource)).toBe(true);
    expect(existsSync(join(archive, 'docs', 'new.txt'))).toBe(false);
    expect(existsSync(join(archive, 'docs', 'conflicts'))).toBe(false);

    unlinkSync(join(archive, 'terminal-seal-receipt.json'));
    write('.deckent/archive/sprints/sprint-629/terminal-seal-application.json', '{}');
    const conflictingSource = write('source/conflicting.txt', 'different');
    expect(() => publishSprintArchiveArtifact(root, sprintId, conflictingSource, 'docs/existing.txt'))
      .toThrow(/ARCHIVE_TERMINAL_PUBLICATION_REJECTED/u);
    expect(readFileSync(join(archive, 'docs', 'existing.txt'), 'utf8')).toBe('canonical');
    expect(existsSync(conflictingSource)).toBe(true);
    expect(existsSync(join(archive, 'docs', 'conflicts'))).toBe(false);
  });

  it('retains a pre-seal conflict as a hash-addressed artifact', () => {
    const first = write('source/first.txt', 'first');
    const second = write('source/second.txt', 'second');
    publishSprintArchiveArtifact(root, sprintId, first, 'docs/conflict.txt');

    const publication = publishSprintArchiveArtifact(root, sprintId, second, 'docs/conflict.txt');

    expect(publication.state).toBe('conflict');
    expect(readFileSync(join(resolveSprintArchiveDir(root, sprintId), publication.path), 'utf8')).toBe('second');
    expect(existsSync(second)).toBe(true);
  });

  it('proves an exact sealed replay and retires its matching source only on request', () => {
    write('.deckent/archive/sprints/sprint-629/docs/replay.txt', 'same-bytes');
    write('.deckent/archive/sprints/sprint-629/terminal-seal-receipt.json', '{}');
    const source = write('source/replay.txt', 'same-bytes');

    const publication = publishSprintArchiveArtifact(root, sprintId, source, 'docs/replay.txt', {
      retireSource: true,
    });

    expect(publication).toMatchObject({ path: 'docs/replay.txt', state: 'deduplicated', sourceRetired: true });
    expect(existsSync(source)).toBe(false);
    expect(readFileSync(join(resolveSprintArchiveDir(root, sprintId), publication.path), 'utf8')).toBe('same-bytes');
  });
});
