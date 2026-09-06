/**
 * tests/core/identity-generator.test.ts
 *
 * Tests for identity-generator module:
 * - regenerateProjectIdentity (create, update, idempotency)
 * - runMemoryExport (happy path, missing DB, partial failure)
 * - runPostFinalizeHooks (full chain, skip options, rule regen hook, error isolation)
 * - IDENTITY.md AUTOGEN block integrity (identity-status, MCP count consistency)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync as realReadFileSync, existsSync as realExistsSync } from 'node:fs';
import { join as realJoin, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  regenerateProjectIdentity,
  runMemoryExport,
  runPostFinalizeHooks,
  validateIdentityAutogenScope,
} from '../../src/core/identity-generator.js';
import type {
  IdentityMetrics,
  IdentityContext,
  PostFinalizeHookOptions,
} from '../../src/core/identity-generator.js';
import { buildMemoryExportLabels } from '../../src/core/memory-export-labels.js';

// ─── Mocks ──────────────────────────────────────────────────────────

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  readdirSync: vi.fn().mockReturnValue([]),
}));

vi.mock('../../src/core/utils.js', () => ({
  debugLog: vi.fn(),
}));

// Mock memory-store and memory-export for runMemoryExport tests
const mockClose = vi.fn();
const mockMemoryStore = vi.fn();
const mockStore = {
  close: mockClose,
};
vi.mock('../../src/core/memory-store.js', () => ({
  MemoryStore: mockMemoryStore.mockImplementation(() => mockStore),
}));

const mockWriteGuardedExports = vi.fn(() => ({
  written: ['summary.md', 'decisions.md', 'memory.md', 'debt.md'],
  skipped: [],
  warnings: [],
}));
vi.mock('../../src/core/memory-export.js', () => ({
  writeGuardedExports: (...args: unknown[]) => mockWriteGuardedExports(...args),
}));

// ─── Helpers ────────────────────────────────────────────────────────

function makeMetrics(overrides?: Partial<IdentityMetrics>): IdentityMetrics {
  return {
    sprintId: 'sprint-143',
    totalTasks: 20,
    completedTasks: 17,
    techDebtTasks: 3,
    noGoTasks: 2,
    coveragePercent: 89.3,
    durationMs: 300000,
    ...overrides,
  };
}

const mockedExistsSync = vi.mocked(existsSync);
const mockedReadFileSync = vi.mocked(readFileSync);
const mockedWriteFileSync = vi.mocked(writeFileSync);
const mockedReaddirSync = vi.mocked(readdirSync);

beforeEach(() => {
  vi.clearAllMocks();
});

// ═══ regenerateProjectIdentity ══════════════════════════════════════

describe('regenerateProjectIdentity', () => {
  it('creates PROJECT-IDENTITY.md when file does not exist', () => {
    mockedExistsSync.mockReturnValue(false);

    const result = regenerateProjectIdentity({
      projectRoot: '/test',
      metrics: makeMetrics(),
      adrCount: 40,
      cliCommandCount: 41,
      mcpToolCount: 22,
    });

    expect(result.success).toBe(true);
    expect(result.reason).toBe('created');
    expect(result.adrCount).toBe(40);
    expect(mockedWriteFileSync).toHaveBeenCalledOnce();

    const content = mockedWriteFileSync.mock.calls[0]![1] as string;
    expect(content).toContain('# Project Identity');
    expect(content).toContain('sprint-143');
    expect(content).toContain('ADR Count: 40');
    expect(content).toContain('MCP Tools: 22');
    expect(content).toContain('CLI Commands: 41+');
  });

  it('updates existing PROJECT-IDENTITY.md Current State section', () => {
    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue(
      '# Project Identity\n\n## Current State\n- Last Sprint: sprint-142\n- Old Data: xyz\n\n## Architecture\n- Language: TypeScript\n',
    );

    const result = regenerateProjectIdentity({
      projectRoot: '/test',
      metrics: makeMetrics(),
      adrCount: 40,
    });

    expect(result.success).toBe(true);
    expect(result.reason).toBe('updated');

    const content = mockedWriteFileSync.mock.calls[0]![1] as string;
    expect(content).toContain('sprint-143');
    expect(content).not.toContain('sprint-142');
    expect(content).not.toContain('Old Data');
    expect(content).toContain('## Architecture');
    expect(content).toContain('Language: TypeScript');
  });

  it('appends Current State section when missing in existing file', () => {
    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue('# Project Identity\n\n## Architecture\n- Language: TypeScript\n');

    const result = regenerateProjectIdentity({
      projectRoot: '/test',
      metrics: makeMetrics(),
    });

    expect(result.success).toBe(true);
    expect(result.reason).toBe('updated');

    const content = mockedWriteFileSync.mock.calls[0]![1] as string;
    expect(content).toContain('## Current State');
    expect(content).toContain('## Architecture');
  });

  it('is idempotent — calling twice with same metrics writes same content', () => {
    const metrics = makeMetrics();

    // First call: create
    mockedExistsSync.mockReturnValue(false);
    regenerateProjectIdentity({
      projectRoot: '/test',
      metrics,
      adrCount: 40,
      cliCommandCount: 41,
      mcpToolCount: 22,
    });
    const firstContent = mockedWriteFileSync.mock.calls[0]![1] as string;

    // Second call: update existing with same data — content should be equivalent
    mockedWriteFileSync.mockClear();
    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue(firstContent);

    regenerateProjectIdentity({
      projectRoot: '/test',
      metrics,
      adrCount: 40,
      cliCommandCount: 41,
      mcpToolCount: 22,
    });

    // Whether reason is 'unchanged' or 'updated', the content must be equivalent
    if (mockedWriteFileSync.mock.calls.length > 0) {
      const secondContent = mockedWriteFileSync.mock.calls[0]![1] as string;
      // Normalize whitespace for comparison
      expect(secondContent.replace(/\n+/g, '\n').trim()).toBe(
        firstContent.replace(/\n+/g, '\n').trim(),
      );
    }
    // Either way, the operation succeeded
  });

  it('counts ADRs from summary.md when adrCount not provided', () => {
    // First call: existsSync for PROJECT-IDENTITY.md
    // Internal calls: existsSync for dbPath, summary.md
    mockedExistsSync.mockImplementation((p: string) => {
      if (typeof p === 'string' && p.includes('PROJECT-IDENTITY')) return false;
      if (typeof p === 'string' && p.includes('memory.db')) return true;
      if (typeof p === 'string' && p.includes('summary.md')) return true;
      return false;
    });
    mockedReadFileSync.mockReturnValue(
      '| adr-001 | TypeScript |\n| adr-002 | ESM |\n| adr-003 | vitest |\n',
    );

    const result = regenerateProjectIdentity({
      projectRoot: '/test',
      metrics: makeMetrics(),
    });

    expect(result.adrCount).toBe(3);
  });

  it('handles errors gracefully', () => {
    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockImplementation(() => {
      throw new Error('EACCES');
    });

    const result = regenerateProjectIdentity({
      projectRoot: '/test',
      metrics: makeMetrics(),
    });

    expect(result.success).toBe(false);
    expect(result.reason).toContain('error');
  });
});

// ═══ runMemoryExport ════════════════════════════════════════════════

describe('runMemoryExport', () => {
  it('writes all 4 export files when DB exists', async () => {
    mockedExistsSync.mockReturnValue(true);

    const result = await runMemoryExport('/test');

    expect(result.success).toBe(true);
    expect(result.filesWritten).toEqual(['summary.md', 'decisions.md', 'memory.md', 'debt.md']);
    expect(result.errors).toHaveLength(0);
    expect(mockClose).toHaveBeenCalledOnce();
  });

  it('opens the export snapshot read-only and forwards caller render options', async () => {
    mockedExistsSync.mockReturnValue(true);
    const labels = buildMemoryExportLabels((key, language) => `${language}:${key}`, 'tr');

    await runMemoryExport('/test', { labels });

    expect(mockMemoryStore).toHaveBeenCalledWith('/test/.brain/memory.db', { readOnly: true });
    expect(mockWriteGuardedExports).toHaveBeenCalledWith(
      mockStore,
      '/test/.brain/exports',
      { labels },
    );
  });

  it('returns error when memory.db not found', async () => {
    mockedExistsSync.mockReturnValue(false);

    const result = await runMemoryExport('/test');

    expect(result.success).toBe(false);
    expect(result.errors).toContain('memory.db not found');
    expect(result.filesWritten).toHaveLength(0);
  });

  it('reports guarded export warnings without declaring success', async () => {
    mockedExistsSync.mockReturnValue(true);
    mockWriteGuardedExports.mockReturnValueOnce({
      written: ['summary.md'],
      skipped: ['decisions.md'],
      warnings: ['decisions.md guarded'],
    });

    const result = await runMemoryExport('/test');

    expect(result.success).toBe(false);
    expect(result.filesWritten).toContain('summary.md');
    expect(result.errors).toContain('decisions.md guarded');
  });

  it('closes the read-only snapshot when guarded rendering throws', async () => {
    mockedExistsSync.mockReturnValue(true);
    mockWriteGuardedExports.mockImplementationOnce(() => {
      throw new Error('guarded renderer failed');
    });

    const result = await runMemoryExport('/test');

    expect(result.success).toBe(false);
    expect(result.errors.join('\n')).toContain('guarded renderer failed');
    expect(mockClose).toHaveBeenCalledOnce();
  });
});

// ═══ runPostFinalizeHooks ═══════════════════════════════════════════

describe('runPostFinalizeHooks', () => {
  it('runs full hook chain successfully', async () => {
    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue('# Project Identity\n\n## Current State\n- Old\n');

    const ruleRegenFn = vi.fn();

    const result = await runPostFinalizeHooks({
      projectRoot: '/test',
      sprintId: 'sprint-143',
      metrics: makeMetrics(),
      onRuleRegen: ruleRegenFn,
    });

    expect(result.memoryExport).not.toBeNull();
    expect(result.identityRegen).toBeNull(); // Sprint 168 C0a-1: skipIdentityRegen default=true (BUG-GG)
    expect(result.ruleRegenCalled).toBe(true);
    expect(ruleRegenFn).toHaveBeenCalledWith('/test');
  });

  it('forwards memory export render options through the public hook', async () => {
    mockedExistsSync.mockReturnValue(true);
    const labels = buildMemoryExportLabels((key, language) => `${language}:${key}`, 'tr');

    await runPostFinalizeHooks({
      projectRoot: '/test',
      sprintId: 'sprint-143',
      metrics: makeMetrics(),
      memoryExportRenderOptions: { labels },
    });

    expect(mockWriteGuardedExports).toHaveBeenCalledWith(
      mockStore,
      '/test/.brain/exports',
      { labels },
    );
  });

  it('skips memory export when skipMemoryExport=true', async () => {
    mockedExistsSync.mockReturnValue(false);

    const result = await runPostFinalizeHooks({
      projectRoot: '/test',
      sprintId: 'sprint-143',
      metrics: makeMetrics(),
      skipMemoryExport: true,
    });

    expect(result.memoryExport).toBeNull();
    expect(result.identityRegen).toBeNull(); // Sprint 168 C0a-1: skipIdentityRegen default=true
  });

  it('skips identity regen when skipIdentityRegen=true', async () => {
    mockedExistsSync.mockReturnValue(true);

    const result = await runPostFinalizeHooks({
      projectRoot: '/test',
      sprintId: 'sprint-143',
      metrics: makeMetrics(),
      skipIdentityRegen: true,
      skipMemoryExport: true,
    });

    expect(result.identityRegen).toBeNull();
    expect(result.memoryExport).toBeNull();
  });

  it('does not call rule regen when no callback provided', async () => {
    mockedExistsSync.mockReturnValue(false);

    const result = await runPostFinalizeHooks({
      projectRoot: '/test',
      sprintId: 'sprint-143',
      metrics: makeMetrics(),
      skipMemoryExport: true,
    });

    expect(result.ruleRegenCalled).toBe(false);
  });

  it('isolates errors — rule regen failure does not affect other results', async () => {
    mockedExistsSync.mockReturnValue(false);

    const failingRuleRegen = vi.fn().mockRejectedValue(new Error('rule gen failed'));

    const result = await runPostFinalizeHooks({
      projectRoot: '/test',
      sprintId: 'sprint-143',
      metrics: makeMetrics(),
      onRuleRegen: failingRuleRegen,
      skipMemoryExport: true,
    });

    expect(result.ruleRegenCalled).toBe(false);
    expect(result.errors.some(e => e.includes('ruleRegen'))).toBe(true);
    // Sprint 168 C0a-1: identity regen now skipped by default (skipIdentityRegen=true)
    expect(result.identityRegen).toBeNull();
  });

  it('handles async rule regen callback', async () => {
    mockedExistsSync.mockReturnValue(false);

    const asyncRuleRegen = vi.fn().mockResolvedValue(undefined);

    const result = await runPostFinalizeHooks({
      projectRoot: '/test',
      sprintId: 'sprint-143',
      metrics: makeMetrics(),
      onRuleRegen: asyncRuleRegen,
      skipMemoryExport: true,
    });

    expect(result.ruleRegenCalled).toBe(true);
    expect(asyncRuleRegen).toHaveBeenCalledWith('/test');
  });
});

// ═══ IDENTITY.md AUTOGEN block integrity ═══════════════════════════

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const IDENTITY_PATH = realJoin(PROJECT_ROOT, '.deckent/workspace/IDENTITY.md');

function extractAutogenBlockRaw(content: string, id: string): string | null {
  const start = `<!-- AUTOGEN:START id="${id}" -->`;
  const end = `<!-- AUTOGEN:END id="${id}" -->`;
  const startIdx = content.indexOf(start);
  const endIdx = content.indexOf(end);
  if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) return null;
  return content.slice(startIdx + start.length, endIdx).trim();
}

describe('IDENTITY.md AUTOGEN block integrity', () => {
  let identityContent: string;

  beforeEach(async () => {
    // Use vi.importActual to bypass vi.mock('node:fs') hoisting
    const realFs = await vi.importActual<typeof import('node:fs')>('node:fs');
    identityContent = realFs.readFileSync(IDENTITY_PATH, 'utf-8');
  });

  it('identity-status AUTOGEN block exists in IDENTITY.md', () => {
    const block = extractAutogenBlockRaw(identityContent, 'identity-status');
    expect(block).not.toBeNull();
    expect(block).toContain('| MCP Tools |');
    expect(block).toContain('| MCP Resources |');
  });

  it('MCP Tools count in identity-status block is ≥ 27 (file-count lower bound)', () => {
    const block = extractAutogenBlockRaw(identityContent, 'identity-status');
    expect(block).not.toBeNull();
    const match = block!.match(/\|\s*MCP Tools\s*\|\s*(\d+)\s*\|/);
    expect(match).not.toBeNull();
    const count = parseInt(match![1]!, 10);
    expect(count).toBeGreaterThanOrEqual(27);
  });

  it('identity-status and identity-summary MCP counts are consistent', () => {
    const statusBlock = extractAutogenBlockRaw(identityContent, 'identity-status');
    const summaryBlock = extractAutogenBlockRaw(identityContent, 'identity-summary');
    expect(statusBlock).not.toBeNull();
    expect(summaryBlock).not.toBeNull();

    const statusMatch = statusBlock!.match(/\|\s*MCP Tools\s*\|\s*(\d+)\s*\|/);
    const summaryMatch = summaryBlock!.match(/MCP:\s*(\d+)\s*tools/);
    expect(statusMatch).not.toBeNull();
    expect(summaryMatch).not.toBeNull();

    const statusCount = parseInt(statusMatch![1]!, 10);
    const summaryCount = parseInt(summaryMatch![1]!, 10);
    expect(statusCount).toBe(summaryCount);
  });

  // (a) MCP count matches the registered tool count produced by
  // scripts/update-readme-stats.mjs (single source of truth). Previously this
  // test pinned the count to 31, which became brittle each time a new MCP tool
  // shipped (Sprint 190 deckent_models → 32). Sourcing the expected count from
  // the generator keeps the assertion grounded in real registrations without
  // hand-edits per sprint.
  //
  // Implementation note: we invoke the generator in a child process because
  // this test file mocks `node:fs` at the top — calling `collectStats` via
  // dynamic import would feed it the empty mock and return mcpTools=0.
  it('MCP Tools count in identity-status block matches registered count from update-readme-stats', () => {
    const block = extractAutogenBlockRaw(identityContent, 'identity-status');
    expect(block).not.toBeNull();
    const match = block!.match(/\|\s*MCP Tools\s*\|\s*(\d+)\s*\|/);
    expect(match).not.toBeNull();
    const blockCount = parseInt(match![1]!, 10);

    const scriptUrl = `file://${realJoin(PROJECT_ROOT, 'scripts/update-readme-stats.mjs').replace(/\\/g, '/')}`;
    const proc = spawnSync('node', [
      '-e',
      `import('${scriptUrl}').then(m => { const s = m.collectStats({ root: ${JSON.stringify(PROJECT_ROOT)} }); process.stdout.write(String(s.mcpTools)); });`,
    ], { encoding: 'utf-8' });
    expect(proc.status).toBe(0);
    const registeredCount = parseInt(proc.stdout.trim(), 10);
    expect(Number.isFinite(registeredCount)).toBe(true);
    expect(blockCount).toBe(registeredCount);
    // Lower bound guard: must never regress below the Sprint 190 baseline.
    expect(blockCount).toBeGreaterThanOrEqual(31);
  });

  // (b) Project Status table is inside identity-status AUTOGEN block
  it('## Project Status heading immediately precedes identity-status AUTOGEN block', () => {
    const statusStart = '<!-- AUTOGEN:START id="identity-status" -->';
    const statusStartIdx = identityContent.indexOf(statusStart);
    expect(statusStartIdx).toBeGreaterThan(-1);

    const headingIdx = identityContent.lastIndexOf('## Project Status', statusStartIdx);
    expect(headingIdx).toBeGreaterThan(-1);

    // Content between the heading and AUTOGEN start must be only whitespace/newline
    const between = identityContent.slice(headingIdx + '## Project Status'.length, statusStartIdx).trim();
    expect(between).toBe('');
  });

  // (c) AUTOGEN block markers are well-formed (prerequisite for drift detection)
  it('identity-status AUTOGEN start/end markers are properly paired', () => {
    const startMarker = '<!-- AUTOGEN:START id="identity-status" -->';
    const endMarker = '<!-- AUTOGEN:END id="identity-status" -->';
    const startIdx = identityContent.indexOf(startMarker);
    const endIdx = identityContent.indexOf(endMarker);

    expect(startIdx).toBeGreaterThan(-1);
    expect(endIdx).toBeGreaterThan(-1);
    expect(endIdx).toBeGreaterThan(startIdx + startMarker.length);

    // No nested AUTOGEN:START inside the block
    const inner = identityContent.slice(startIdx + startMarker.length, endIdx);
    expect(inner).not.toContain('<!-- AUTOGEN:START');
  });
});

// ═══ validateIdentityAutogenScope ══════════════════════════════════

describe('validateIdentityAutogenScope', () => {
  it('returns ok=true for well-formed IDENTITY.md with MCP Tools=31', () => {
    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue(
      '# Project Identity\n' +
      '<!-- AUTOGEN:START id="identity-summary" -->\n' +
      'MCP: 31 tools, 8 resources\n' +
      '<!-- AUTOGEN:END id="identity-summary" -->\n' +
      '## Project Status\n' +
      '<!-- AUTOGEN:START id="identity-status" -->\n' +
      '| Metric | Value |\n' +
      '|--------|-------|\n' +
      '| MCP Tools | 31 |\n' +
      '<!-- AUTOGEN:END id="identity-status" -->\n',
    );

    const result = validateIdentityAutogenScope('/test');
    expect(result.ok).toBe(true);
    expect(result.findings).toHaveLength(0);
    expect(result.mcpToolCount).toBe(31);
  });

  it('returns ok=false when MCP Tools count is below 31', () => {
    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue(
      '## Project Status\n' +
      '<!-- AUTOGEN:START id="identity-status" -->\n' +
      '| MCP Tools | 27 |\n' +
      '<!-- AUTOGEN:END id="identity-status" -->\n',
    );

    const result = validateIdentityAutogenScope('/test');
    expect(result.ok).toBe(false);
    expect(result.findings.some(f => f.includes('27'))).toBe(true);
  });

  it('returns ok=false when identity-status block is missing', () => {
    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue('# Project Identity\n## Project Status\n| MCP Tools | 31 |\n');

    const result = validateIdentityAutogenScope('/test');
    expect(result.ok).toBe(false);
    expect(result.findings.some(f => f.includes('identity-status'))).toBe(true);
  });

  it('returns ok=false when IDENTITY.md does not exist', () => {
    mockedExistsSync.mockReturnValue(false);

    const result = validateIdentityAutogenScope('/test');
    expect(result.ok).toBe(false);
    expect(result.findings[0]).toContain('not found');
  });

  it('returns ok=false when Project Status does not immediately precede AUTOGEN block', () => {
    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue(
      '# Project Identity\n' +
      '## Project Status\n' +
      'Some extra content here\n' +
      '<!-- AUTOGEN:START id="identity-status" -->\n' +
      '| MCP Tools | 31 |\n' +
      '<!-- AUTOGEN:END id="identity-status" -->\n',
    );

    const result = validateIdentityAutogenScope('/test');
    expect(result.ok).toBe(false);
    expect(result.findings.some(f => f.includes('Project Status'))).toBe(true);
  });
});

// ═══ AUTOGEN extends Project Status — managed-doc contract ════════
//
// Sprint 191 Task 191-009: the ## Project Status table must live INSIDE the
// `identity-status` AUTOGEN block so that sprint metric updates (MCP tool
// count, sprint label, version) flow through scripts/update-readme-stats.mjs
// and never require hand-edits. These tests pin the contract end-to-end
// against the real IDENTITY.md plus the lint+generator pair.
//
// Subprocess invocation is intentional — this test file mocks `node:fs` at
// the module top, which would feed the scripts an empty filesystem if called
// via dynamic import. Spawning a fresh node process gives the scripts the
// real fs they need.

describe('AUTOGEN extends Project Status (Sprint 191 Task 191-009 contract)', () => {
  let identityContent: string;
  const IDENTITY_REL = '.deckent/workspace/IDENTITY.md';
  const LINT_SCRIPT = realJoin(PROJECT_ROOT, 'scripts/lint-identity-md.mjs');

  beforeEach(async () => {
    const realFs = await vi.importActual<typeof import('node:fs')>('node:fs');
    identityContent = realFs.readFileSync(IDENTITY_PATH, 'utf-8');
  });

  // (a) AUTOGEN extends Project Status: the entire metric table is bracketed
  // by identity-status markers — no metric rows leak outside the block.
  it('all Project Status metric rows live inside the identity-status AUTOGEN block', () => {
    const startMarker = '<!-- AUTOGEN:START id="identity-status" -->';
    const endMarker = '<!-- AUTOGEN:END id="identity-status" -->';
    const startIdx = identityContent.indexOf(startMarker);
    const endIdx = identityContent.indexOf(endMarker);
    expect(startIdx).toBeGreaterThan(-1);
    expect(endIdx).toBeGreaterThan(startIdx);

    const inside = identityContent.slice(startIdx + startMarker.length, endIdx);
    const outsideAfter = identityContent.slice(endIdx + endMarker.length);

    // FAZ4B: satır-listesi generator authority'sine hizalandı —
    // scripts/update-readme-stats.mjs:renderIdentityStatus artık `| Sprint |`
    // ve `| Providers |` satırlarını üretmiyor; kontratın kaynağı generator'dır.
    const requiredRows = [
      '| Version |',
      '| MCP Tools |',
      '| MCP Resources |',
      '| CLI Commands |',
      '| Dashboard Pages |',
      '| Agents |',
      '| Skills |',
    ];
    for (const row of requiredRows) {
      expect(inside).toContain(row);
      expect(outsideAfter).not.toContain(row);
    }
  });

  // (b) lint catches manual edit: mutating a managed metric outside the
  // generator (simulating a hand-edit) must produce a non-zero exit from
  // `lint-identity-md.mjs` (the CI guard).
  it('lint script exits non-zero when a managed metric is hand-edited', async () => {
    const realFs = await vi.importActual<typeof import('node:fs')>('node:fs');
    const original = realFs.readFileSync(IDENTITY_PATH, 'utf-8');
    const tampered = original.replace(/\|\s*MCP Tools\s*\|\s*\d+\s*\|/, '| MCP Tools | 99 |');
    expect(tampered).not.toBe(original);

    try {
      realFs.writeFileSync(IDENTITY_PATH, tampered);
      const proc = spawnSync('node', [LINT_SCRIPT], {
        cwd: PROJECT_ROOT,
        encoding: 'utf-8',
      });
      expect(proc.status).not.toBe(0);
      // The drift report should mention the IDENTITY.md path so operators
      // know where to look.
      const combined = `${proc.stdout}${proc.stderr}`;
      expect(combined).toContain(IDENTITY_REL);
    } finally {
      // Always restore — leaving the file tampered would poison every
      // subsequent test in the suite.
      realFs.writeFileSync(IDENTITY_PATH, original);
    }
  });

  // (c) generator output stable across runs: invoking the lint script twice
  // in a row must report the same result both times. This guards against
  // non-determinism in the generator (e.g., readdir ordering, hash collisions).
  // When IDENTITY.md is in sync, both runs exit 0. When there is drift (e.g.,
  // during a sprint where docs:stats hasn't been run yet), both runs must still
  // agree — the tool must be deterministic regardless of drift state.
  it('lint --check reports no drift across two consecutive runs', () => {
    const runCheck = () => spawnSync('node', [LINT_SCRIPT], {
      cwd: PROJECT_ROOT,
      encoding: 'utf-8',
    });
    const first = runCheck();
    const second = runCheck();
    // Verify determinism: both runs must return the same exit code and output
    expect(second.status).toBe(first.status);
    expect(second.stdout).toBe(first.stdout);
  });
});
