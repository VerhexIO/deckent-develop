import { createHash } from 'node:crypto';
import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, unlinkSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const cli = vi.hoisted(() => ({ root: '' }));
vi.mock('../../src/cli/helpers/process.js', () => ({ resolveProjectRoot: () => cli.root }));

import { archiveTerminalOperations, registerArchive, inspectArchiveTerminalParity } from '../../src/cli/commands/archive.js';
import { getMessage } from '../../src/cli/helpers/messages.js';
import { buildMemoryExportLabels } from '../../src/core/memory-export-labels.js';
import { MemoryStore } from '../../src/core/memory-store.js';
import { resolveSprintArchiveDir } from '../../src/core/sprint-archive.js';
import type { SprintTerminalReceiptV1 } from '../../src/core/sprint-terminal-publication.js';

const sprintId = 'sprint-629';
const roots: string[] = [];
const originalExitCode = process.exitCode;
const receipt: SprintTerminalReceiptV1 = {
  version: 1,
  sprintId,
  runId: 'run-629',
  coordinatorGeneration: 3,
  terminalOutcome: 'COMPLETE',
  logicalSettlementDigest: 'a'.repeat(64),
  priorAuthorityVersion: 10,
  authorityVersion: 11,
};

function digest(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function write(relativePath: string, content: string): string {
  const path = join(cli.root, relativePath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
  return path;
}

function fixture(): void {
  cli.root = mkdtempSync(join(tmpdir(), 'archive-terminal-cli-'));
  roots.push(cli.root);
  mkdirSync(join(cli.root, '.brain'), { recursive: true });
  const store = new MemoryStore(join(cli.root, '.brain', 'memory.db'));
  store.close();
}

function terminalFixture(): {
  hot: string;
  receiptPath: string;
  oldDigest: string;
  hotDigest: string;
  finalDigest: string;
} {
  const old = `${JSON.stringify({ sequence: 1 })}\n`;
  const finalLine = JSON.stringify({ sequence: 2, channel: 'SPRINT_TERMINAL_COMPLETED' });
  const content = `${old}${finalLine}\n`;
  const hot = write(`.deckent/recently-works/${sprintId}-events.jsonl`, content);
  write(`.deckent/recently-works/${sprintId}-seq`, '2');
  const receiptPath = write(`.deckent/recently-works/${sprintId}-terminal-receipt.json`, JSON.stringify({
    version: 1,
    terminalOutcome: receipt.terminalOutcome,
    publicationState: {
      version: 1,
      sprintId,
      runId: receipt.runId,
      coordinatorGeneration: receipt.coordinatorGeneration,
      authorityVersion: receipt.authorityVersion,
      receipt,
    },
    receipt,
    terminalEvidence: {},
    writtenAt: '2026-08-23T00:00:00.000Z',
  }));
  write(`.deckent/archive/sprints/${sprintId}/${sprintId}-events.jsonl`, old);
  write(`.deckent/archive/sprints/${sprintId}/${sprintId}-seq`, '1');
  return { hot, receiptPath, oldDigest: digest(old), hotDigest: digest(content), finalDigest: digest(finalLine) };
}

async function run(args: readonly string[]): Promise<{ stdout: string; stderr: string; exitCode: number | undefined }> {
  process.exitCode = 0;
  const stdout: string[] = [];
  const stderr: string[] = [];
  const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: string | Uint8Array) => {
    stdout.push(String(chunk)); return true;
  }) as typeof process.stdout.write);
  const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(((chunk: string | Uint8Array) => {
    stderr.push(String(chunk)); return true;
  }) as typeof process.stderr.write);
  try {
    const program = new Command().exitOverride();
    registerArchive(program);
    await program.parseAsync(['node', 'deckent', 'archive', ...args]);
    return { stdout: stdout.join(''), stderr: stderr.join(''), exitCode: process.exitCode };
  } finally {
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
  }
}

function repairArgs(authority: ReturnType<typeof terminalFixture>): string[] {
  return [
    'terminal-repair',
    '--sprint', sprintId,
    '--hot-journal', authority.hot,
    '--receipt', authority.receiptPath,
    '--final-sequence', '2',
    '--final-digest', authority.finalDigest,
    '--expected-archive-digest', authority.oldDigest,
    '--expected-hot-digest', authority.hotDigest,
    '--reason', 'owner-authorized archive parity repair',
    '--json',
  ];
}

function brainDiskSnapshot(): Record<string, { sha256: string; mtimeMs: number } | null> {
  return Object.fromEntries([
    '.brain/memory.db',
    '.brain/memory.db-wal',
    '.brain/memory.db-shm',
    '.brain/exports/summary.md',
    '.brain/exports/decisions.md',
    '.brain/exports/memory.md',
    '.brain/exports/debt.md',
  ].map(relativePath => {
    const path = join(cli.root, relativePath);
    return [relativePath, existsSync(path)
      ? { sha256: digest(readFileSync(path)), mtimeMs: statSync(path).mtimeMs }
      : null];
  }));
}

beforeEach(() => { fixture(); });
afterEach(() => {
  process.exitCode = originalExitCode;
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('archive terminal operator surface', () => {
  it('captures canonical strict-prefix parity without mutating either journal', async () => {
    const authority = terminalFixture();
    const archived = join(resolveSprintArchiveDir(cli.root, sprintId), `${sprintId}-events.jsonl`);
    const before = [readFileSync(archived), readFileSync(authority.hot)];

    const report = inspectArchiveTerminalParity(cli.root, sprintId, authority.hot);
    const command = await run(['terminal-inspect', '--sprint', sprintId, '--hot-journal', authority.hot, '--json']);

    expect(report).toMatchObject({ strictPrefix: true, byteIdentical: false });
    expect(command.exitCode).toBe(0);
    expect(JSON.parse(command.stdout)).toMatchObject({ strictPrefix: true, byteIdentical: false });
    expect(readFileSync(archived)).toEqual(before[0]);
    expect(readFileSync(authority.hot)).toEqual(before[1]);
  });

  it('keeps inspect and terminal-complete verify semantically distinct', async () => {
    const authority = terminalFixture();

    const inspect = await run(['terminal-inspect', '--sprint', sprintId, '--json']);
    const verify = await run(['terminal-verify', '--sprint', sprintId, '--json']);

    expect(JSON.parse(inspect.stdout)).toMatchObject({ strictPrefix: true });
    expect(JSON.parse(verify.stdout)).toMatchObject({
      ok: false,
      reasonCodes: expect.arrayContaining(['application_not_applied']),
    });
    expect(verify.exitCode).toBe(1);
  });

  it('repairs through the real Commander surface, persists authority, and verifies idempotent replay', async () => {
    const authority = terminalFixture();
    write('.deckent/config.json', JSON.stringify({
      language: 'tr',
      memory_export: {
        max_inline_lines: 901,
        max_inline_bytes: 4097,
        summary_inline_lines: 27,
        summary_inline_bytes: 513,
      },
    }));
    const seal = vi.spyOn(archiveTerminalOperations, 'seal');

    const first = await run(repairArgs(authority));
    const firstReport = JSON.parse(first.stdout) as {
      terminalComplete: boolean;
      receipt: { operatorReason: string; priorAuthorityVersion: number };
      applicationReceipt: { state: string; manifestDigest: string; brainIndexSha256: string; guardedSummarySha256: string };
    };
    const replay = await run(repairArgs(authority));
    const hotCounter = join(cli.root, '.deckent', 'recently-works', `${sprintId}-seq`);
    if (existsSync(hotCounter)) unlinkSync(hotCounter);
    const retiredCounterReplay = await run(repairArgs(authority));
    const brainBeforeVerify = brainDiskSnapshot();
    const verified = await run(['terminal-verify', '--sprint', sprintId, '--hot-journal', authority.hot, '--json']);

    expect(first.exitCode).toBe(0);
    expect(firstReport).toMatchObject({
      terminalComplete: true,
      receipt: {
        operatorReason: 'owner-authorized archive parity repair',
        priorAuthorityVersion: receipt.priorAuthorityVersion,
      },
      applicationReceipt: { state: 'applied' },
    });
    expect(firstReport.applicationReceipt.manifestDigest).toMatch(/^[a-f0-9]{64}$/u);
    expect(firstReport.applicationReceipt.brainIndexSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(firstReport.applicationReceipt.guardedSummarySha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(seal.mock.calls[0]?.[3]).toEqual({
      labels: buildMemoryExportLabels(getMessage, 'tr'),
      maxInlineLines: 901,
      maxInlineBytes: 4097,
      summaryInlineLines: 27,
      summaryInlineBytes: 513,
    });
    expect(JSON.parse(replay.stdout)).toMatchObject({ disposition: 'idempotent', terminalComplete: true });
    expect(JSON.parse(retiredCounterReplay.stdout)).toMatchObject({ disposition: 'idempotent', terminalComplete: true });
    expect(retiredCounterReplay.exitCode).toBe(0);
    expect(JSON.parse(verified.stdout)).toMatchObject({ ok: true, reasonCodes: [] });
    expect(verified.exitCode).toBe(0);
    expect(brainDiskSnapshot()).toEqual(brainBeforeVerify);
  });

  it('reports a staged partial core failure truthfully and replays the same original preimages', async () => {
    const authority = terminalFixture();
    const staged = vi.spyOn(archiveTerminalOperations, 'seal').mockImplementationOnce(() => ({
      terminalComplete: false, receipt: { archivedJournalSha256: authority.hotDigest },
      applicationReceipt: { state: 'staged' }, reasonCode: 'staged_partial_failure',
    }) as never);
    const failed = await run(repairArgs(authority));
    staged.mockRestore();
    const replay = await run(repairArgs(authority));
    const envelope = JSON.parse(failed.stdout) as {
      operation: string; ok: boolean; code: string; mutationStatus: string; sealState: string;
      applicationState: string; verification: { state: string; result: unknown }; retryGuidance: string;
      verifyCommand: string; coreResult: { applicationReceipt: { state: string } };
    };
    expect(failed.exitCode).toBe(1);
    expect(envelope).toMatchObject({
      operation: 'archive.terminal-repair', ok: false, code: 'E_ARCHIVE_TERMINAL_HOLD',
      mutationStatus: 'durable_state_may_exist', sealState: 'incomplete', applicationState: 'staged',
      verification: { state: 'not_attempted', result: null }, coreResult: { applicationReceipt: { state: 'staged' } },
    });
    expect(envelope.retryGuidance).toContain('original --expected-archive-digest and --expected-hot-digest');
    expect(envelope.verifyCommand).toContain('terminal-verify');
    expect(replay.exitCode).toBe(0);
    expect(JSON.parse(replay.stdout)).toMatchObject({ terminalComplete: true });
  });

  it('rejects non-canonical receipt and hot paths before mutation', async () => {
    const authority = terminalFixture();
    const foreignReceipt = write('.deckent/recently-works/foreign-terminal-receipt.json', JSON.stringify(receipt));
    const receiptArgs = repairArgs(authority);
    receiptArgs[receiptArgs.indexOf('--receipt') + 1] = foreignReceipt;
    const badReceipt = await run(receiptArgs);

    const foreignHot = write('.deckent/recently-works/foreign-events.jsonl', readFileSync(authority.hot, 'utf8'));
    const hotArgs = repairArgs(authority);
    hotArgs[hotArgs.indexOf('--hot-journal') + 1] = foreignHot;
    const badHot = await run(hotArgs);

    expect(badReceipt.exitCode).toBe(1);
    expect(JSON.parse(badReceipt.stdout)).toMatchObject({
      code: 'E_ARCHIVE_TERMINAL_RECEIPT_PATH_NOT_CANONICAL', mutationStatus: 'not_attempted',
    });
    expect(badHot.exitCode).toBe(1);
    expect(JSON.parse(badHot.stdout)).toMatchObject({
      code: 'E_ARCHIVE_TERMINAL_HOT_JOURNAL_NOT_CANONICAL', mutationStatus: 'not_attempted',
    });
    expect(() => readFileSync(join(resolveSprintArchiveDir(cli.root, sprintId), 'terminal-seal-receipt.json'))).toThrow();
  });

  it('rejects empty reason and incorrect digests without producing a seal receipt', async () => {
    const authority = terminalFixture();
    const reasonArgs = repairArgs(authority);
    reasonArgs[reasonArgs.indexOf('--reason') + 1] = ' ';
    const badReason = await run(reasonArgs);
    const digestArgs = repairArgs(authority);
    digestArgs[digestArgs.indexOf('--expected-archive-digest') + 1] = 'b'.repeat(64);
    const badDigest = await run(digestArgs);

    expect(badReason.exitCode).toBe(1);
    expect(JSON.parse(badReason.stdout)).toMatchObject({
      code: 'E_ARCHIVE_TERMINAL_REASON_REQUIRED', mutationStatus: 'not_attempted',
    });
    expect(badDigest.exitCode).toBe(1);
    expect(JSON.parse(badDigest.stdout)).toMatchObject({
      code: 'E_ARCHIVE_TERMINAL_PREIMAGE_MISMATCH', mutationStatus: 'not_attempted',
    });
    expect(() => readFileSync(join(resolveSprintArchiveDir(cli.root, sprintId), 'terminal-seal-receipt.json'))).toThrow();
  });

  it('normalizes malformed canonical receipts to a typed localized error without mutation', async () => {
    const authority = terminalFixture();
    write(`.deckent/recently-works/${sprintId}-terminal-receipt.json`, '{not-json');
    const command = await run(repairArgs(authority));

    expect(command.exitCode).toBe(1);
    expect(JSON.parse(command.stdout)).toMatchObject({
      code: 'E_ARCHIVE_TERMINAL_RECEIPT_INVALID', mutationStatus: 'not_attempted',
    });
    expect(JSON.parse(command.stdout).reason).not.toContain('SyntaxError');
    expect(() => readFileSync(join(resolveSprintArchiveDir(cli.root, sprintId), 'terminal-seal-receipt.json'))).toThrow();
  });

  it('ships every new operator status through both message catalogs', () => {
    const keys = [
      'archive.terminal.inspect.description',
      'archive.terminal.verify.description',
      'archive.terminal.verify_ok',
      'archive.terminal.verify_failed',
      'archive.terminal.repair_ok',
      'archive.error.terminal_failed',
    ] as const;
    for (const key of keys) {
      expect(getMessage(key, 'en')).not.toBe(key);
      expect(getMessage(key, 'tr')).not.toBe(key);
    }
  });
});


describe('archive terminal error authority', () => {
  it('renders typed terminal failures through localized catalog text', () => {
    expect(getMessage('archive.error.terminal_failed', 'en', { code: 'E_ARCHIVE_TERMINAL_RECEIPT_INVALID' }))
      .toContain('E_ARCHIVE_TERMINAL_RECEIPT_INVALID');
    expect(getMessage('archive.error.terminal_failed', 'tr', { code: 'E_ARCHIVE_TERMINAL_RECEIPT_INVALID' }))
      .toContain('E_ARCHIVE_TERMINAL_RECEIPT_INVALID');
  });

  it('labels success digests separately for manifest, Brain index, and guarded summary', () => {
    const message = getMessage('archive.terminal.repair_ok', 'en', {
      sprintId, disposition: 'applied', digest: 'journal', manifestDigest: 'manifest',
      brainIndexDigest: 'brain', guardedSummaryDigest: 'summary',
    });
    expect(message).toContain('manifest=manifest');
    expect(message).toContain('Brain-index=brain');
    expect(message).toContain('guarded-summary=summary');
  });
});
