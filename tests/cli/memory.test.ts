import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Command } from 'commander';
import { join } from 'node:path';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { MemoryStore } from '../../src/core/memory-store.js';
import * as memoryExport from '../../src/core/memory-export.js';

// Mock resolveProjectRoot to point to a temp dir
let projectRoot: string;
vi.mock('../../src/cli/helpers/process.js', () => ({
  resolveProjectRoot: () => projectRoot,
}));

import { registerMemory } from '../../src/cli/commands/memory.js';

// ── Output capture ──────────────────────────────────────────────

let stdoutData: string[];
let stderrData: string[];
let stdoutSpy: ReturnType<typeof vi.spyOn>;
let stderrSpy: ReturnType<typeof vi.spyOn>;

function captureOutput(): void {
  stdoutData = [];
  stderrData = [];
  stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation((data) => {
    stdoutData.push(String(data));
    return true;
  });
  stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation((data) => {
    stderrData.push(String(data));
    return true;
  });
}

function restoreOutput(): void {
  stdoutSpy?.mockRestore();
  stderrSpy?.mockRestore();
}

function getStdout(): string { return stdoutData.join(''); }
function getStderr(): string { return stderrData.join(''); }

// ── Helpers ─────────────────────────────────────────────────────

function ensureDbWithEntries(root: string, entries: Array<{
  id: string; type: string; title: string; content: string;
  tags?: string[]; sprint_id?: string; sprint_num?: number;
  summary?: string; status?: string;
}>): string {
  const brainDir = join(root, '.brain');
  mkdirSync(brainDir, { recursive: true });
  const dbPath = join(brainDir, 'memory.db');
  const store = new MemoryStore(dbPath);
  for (const e of entries) {
    store.insert({
      id: e.id,
      type: e.type,
      title: e.title,
      content: e.content,
      tags: e.tags,
      sprint_id: e.sprint_id,
      sprint_num: e.sprint_num,
      summary: e.summary,
      status: e.status,
    });
  }
  store.close();
  return dbPath;
}

async function runMemory(args: string[]): Promise<string> {
  const program = new Command();
  program.exitOverride();
  registerMemory(program);
  try {
    await program.parseAsync(['node', 'test', 'memory', ...args]);
  } catch {
    // commander exit override throws
  }
  return getStdout();
}

// ── Tests: stats ────────────────────────────────────────────────

describe('memory stats command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    projectRoot = mkdtempSync(join(tmpdir(), 'memory-stats-'));
    captureOutput();
  });

  afterEach(() => {
    restoreOutput();
    try { rmSync(projectRoot, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('prints error when memory.db does not exist', async () => {
    await runMemory(['stats']);
    expect(getStderr()).toContain('memory.db not found');
  });

  it('shows statistics for populated DB', async () => {
    ensureDbWithEntries(projectRoot, [
      { id: 'adr-001', type: 'adr', title: 'ADR 1', content: 'Content 1' },
      { id: 'adr-002', type: 'adr', title: 'ADR 2', content: 'Content 2' },
      { id: 'mem-001', type: 'memory', title: 'Mem 1', content: 'Content 3' },
    ]);

    const output = await runMemory(['stats']);
    expect(output).toContain('Memory V2 Statistics');
    expect(output).toContain('adr: 2');
    expect(output).toContain('memory: 1');
    expect(output).toContain('Total: 3');
    expect(output).toContain('Schema: v1');
  });

  it('shows zero total for empty DB', async () => {
    ensureDbWithEntries(projectRoot, []);

    const output = await runMemory(['stats']);
    expect(output).toContain('Total: 0');
  });
});

// ── Tests: export ───────────────────────────────────────────────

describe('memory export command', () => {
  let previousExitCode: typeof process.exitCode;

  beforeEach(() => {
    vi.clearAllMocks();
    projectRoot = mkdtempSync(join(tmpdir(), 'memory-export-'));
    previousExitCode = process.exitCode;
    process.exitCode = undefined;
    captureOutput();
  });

  afterEach(() => {
    process.exitCode = previousExitCode;
    restoreOutput();
    try { rmSync(projectRoot, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('prints error when memory.db does not exist', async () => {
    await runMemory(['export']);
    expect(getStderr()).toContain('memory.db not found');
  });

  it('exports all guarded Memory V2 projections from DB', async () => {
    ensureDbWithEntries(projectRoot, [
      { id: 'adr-001', type: 'adr', title: 'Test ADR', content: 'Test content', status: 'accepted' },
      { id: 'mem-001', type: 'memory', title: 'Test Memory', content: 'Learning content', sprint_id: 'sprint-140', sprint_num: 140 },
    ]);

    const output = await runMemory(['export']);
    expect(output).toContain('Exported 5 .md files');

    const exportsDir = join(projectRoot, '.brain', 'exports');
    expect(existsSync(join(exportsDir, 'summary.md'))).toBe(true);
    expect(existsSync(join(exportsDir, 'decisions.md'))).toBe(true);
    expect(existsSync(join(exportsDir, 'memory.md'))).toBe(true);
    expect(existsSync(join(exportsDir, 'memory-details.md'))).toBe(true);
    expect(existsSync(join(exportsDir, 'debt.md'))).toBe(true);
  });

  it('forwards resolved project memory_export limits to the guarded CLI writer', async () => {
    ensureDbWithEntries(projectRoot, [
      { id: 'mem-001', type: 'memory', title: 'Bounded render', content: 'Fixture content' },
    ]);
    const configDir = join(projectRoot, '.deckent');
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, 'config.json'), JSON.stringify({
      language: 'tr',
      memory_export: {
        max_inline_lines: 901,
        max_inline_bytes: 4097,
        summary_inline_lines: 27,
        summary_inline_bytes: 513,
      },
    }));
    const guarded = vi.spyOn(memoryExport, 'writeGuardedExports');
    try {
      await runMemory(['export']);
      expect(guarded).toHaveBeenCalledWith(
        expect.anything(),
        join(projectRoot, '.brain', 'exports'),
        expect.objectContaining({
          maxInlineLines: 901,
          maxInlineBytes: 4097,
          summaryInlineLines: 27,
          summaryInlineBytes: 513,
        }),
      );
    } finally {
      guarded.mockRestore();
    }
  });

  it('creates exports directory if it does not exist', async () => {
    ensureDbWithEntries(projectRoot, []);

    await runMemory(['export']);

    const exportsDir = join(projectRoot, '.brain', 'exports');
    expect(existsSync(exportsDir)).toBe(true);
  });

  it('holds a partial non-empty DB before it replaces richer ADR snapshots', async () => {
    ensureDbWithEntries(projectRoot, [
      { id: 'user-owner-decision', type: 'adr', title: 'Owner Decision', content: 'Owner content', status: 'active' },
    ]);
    const exportsDir = join(projectRoot, '.brain', 'exports');
    mkdirSync(exportsDir, { recursive: true });
    const summaryPath = join(exportsDir, 'summary.md');
    const decisionsPath = join(exportsDir, 'decisions.md');
    const priorSummary = [
      '# Brain Summary (auto-generated)',
      '',
      '## Active Architecture Decisions',
      '| ID | Title | Status |',
      '|-----|-------|--------|',
      '| adr-g-001 | First | accepted |',
      '| adr-g-002 | Second | accepted |',
    ].join('\n');
    const priorDecisions = [
      '# Architecture Decision Records (auto-generated)',
      '',
      '## adr-g-001: First',
      '',
      '**Status:** accepted',
      '',
      'Decision: first.',
      '',
      '---',
      '',
      '## adr-g-002: Second',
      '',
      '**Status:** accepted',
      '',
      'Decision: second.',
    ].join('\n');
    writeFileSync(summaryPath, priorSummary, 'utf-8');
    writeFileSync(decisionsPath, priorDecisions, 'utf-8');

    await runMemory(['export']);

    expect(process.exitCode).toBe(1);
    expect(getStderr()).toContain('Export held');
    expect(readFileSync(summaryPath, 'utf-8')).toBe(priorSummary);
    expect(readFileSync(decisionsPath, 'utf-8')).toBe(priorDecisions);
  });
});

// ── Tests: rebuild ──────────────────────────────────────────────

describe('memory rebuild command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    projectRoot = mkdtempSync(join(tmpdir(), 'memory-rebuild-'));
    captureOutput();
  });

  afterEach(() => {
    restoreOutput();
    try { rmSync(projectRoot, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('prints error when DB already exists', async () => {
    ensureDbWithEntries(projectRoot, []);

    await runMemory(['rebuild']);
    expect(getStderr()).toContain('memory.db already exists');
  });

  it('prints error when no exports directory exists', async () => {
    mkdirSync(join(projectRoot, '.brain'), { recursive: true });

    await runMemory(['rebuild']);
    expect(getStderr()).toContain('No exports directory');
  });

  it('rebuilds DB from decisions.md export', async () => {
    const brainDir = join(projectRoot, '.brain');
    const exportsDir = join(brainDir, 'exports');
    mkdirSync(exportsDir, { recursive: true });

    // Write a simple decisions.md with ADR format
    const decisionsContent = `# Architecture Decisions

## adr-001: TypeScript ESM

**Status:** accepted

**Context:** Need consistent module system.

**Decision:** Use TypeScript with ESM.

**Consequence:** All imports use .js extension.

---
`;
    writeFileSync(join(exportsDir, 'decisions.md'), decisionsContent);

    const output = await runMemory(['rebuild']);
    expect(output).toContain('Rebuilt memory.db');

    // Verify DB was created
    const dbPath = join(brainDir, 'memory.db');
    expect(existsSync(dbPath)).toBe(true);
  });

  it('imports from original DECISIONS.md when exports are empty', async () => {
    const brainDir = join(projectRoot, '.brain');
    const exportsDir = join(brainDir, 'exports');
    mkdirSync(exportsDir, { recursive: true });

    // Write original DECISIONS.md at brain root
    const decisionsContent = `# Architecture Decisions

## adr-099: Test Decision

**Status:** accepted

**Context:** Test.

**Decision:** Test decision.

**Consequence:** None.

---
`;
    writeFileSync(join(brainDir, 'DECISIONS.md'), decisionsContent);

    const output = await runMemory(['rebuild']);
    expect(output).toContain('from original');
    expect(output).toContain('Rebuilt memory.db');
  });
});

// ── Tests: relations list ───────────────────────────────────────

describe('memory relations list command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    projectRoot = mkdtempSync(join(tmpdir(), 'memory-relations-'));
    captureOutput();
  });

  afterEach(() => {
    restoreOutput();
    try { rmSync(projectRoot, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('prints error when memory.db does not exist', async () => {
    await runMemory(['relations', 'list']);
    expect(getStderr()).toContain('memory.db not found');
  });

  it('lists relations between entries', async () => {
    const dbPath = ensureDbWithEntries(projectRoot, [
      { id: 'adr-001', type: 'adr', title: 'ADR 1', content: 'Content' },
      { id: 'adr-002', type: 'adr', title: 'ADR 2', content: 'Supersedes ADR-001' },
    ]);

    // Add an explicit relation
    const store = new MemoryStore(dbPath);
    store.insertRelation('adr-002', 'adr-001', 'supersedes');
    store.close();

    const output = await runMemory(['relations', 'list']);
    expect(output).toContain('Relations');
    expect(output).toContain('adr-002');
    expect(output).toContain('adr-001');
    expect(output).toContain('supersedes');
  });
});

describe('memory recall query-first read contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    projectRoot = mkdtempSync(join(tmpdir(), 'memory-recall-read-'));
    captureOutput();
  });

  afterEach(() => {
    restoreOutput();
    try { rmSync(projectRoot, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('returns a versioned bounded view and reaches a deferred complete entry only through its detail reference', async () => {
    ensureDbWithEntries(projectRoot, [
      { id: 'memory-read-001', type: 'memory', title: 'First complete unit', content: 'c2-needle first complete content' },
      { id: 'memory-read-002', type: 'memory', title: 'Second complete unit', content: 'c2-needle second complete content' },
    ]);
    mkdirSync(join(projectRoot, '.deckent'), { recursive: true });
    writeFileSync(join(projectRoot, '.deckent', 'config.json'), JSON.stringify({
      memory_read: { maxEntries: 1, maxCandidates: 2, maxBytes: 32_768, maxLines: 200 },
    }));

    await runMemory(['recall', 'c2-needle', '--json']);
    const envelope = JSON.parse(getStdout()) as { schemaVersion: number; view: { state: string; deferred: Array<{ detailRef: string }> } };
    expect(envelope.schemaVersion).toBe(1);
    expect(envelope.view.state).toBe('AVAILABLE');
    expect(envelope.view.deferred).toHaveLength(1);

    stdoutData = [];
    stderrData = [];
    await runMemory(['recall', '--detail', envelope.view.deferred[0]!.detailRef]);
    expect(getStdout()).toMatch(/c2-needle (first|second) complete content/);
  });

  it('holds rather than treating an empty recall query as an unbounded corpus read', async () => {
    ensureDbWithEntries(projectRoot, [
      { id: 'memory-read-003', type: 'memory', title: 'Entry', content: 'must not become a recall corpus' },
    ]);

    await runMemory(['recall']);
    expect(getStderr()).toContain('INVALID_REQUEST');
    expect(getStdout()).not.toContain('must not become a recall corpus');
  });
});
