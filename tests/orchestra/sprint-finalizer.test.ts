/**
 * tests/orchestra/sprint-finalizer.test.ts
 *
 * Tests for the extracted sprint-finalizer module.
 * Covers: hook stubs (runHonestyCheck, writeRubricDetail, runSelfAuditGate),
 *         FinalizeSprintOptions type, SelfAuditResult type,
 *         finalizeSprint integration (gate.json write, load-report write, fail-safe).
 */

import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { TaskEvaluation, SprintPhase, SprintStatus, TaskStatus } from '../../src/core/types.js';
import type { Sprint, TaskResult } from '../../src/core/types.js';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Real per-test scratch project root (fresh in the file-wide beforeEach below).
let PROJECT_ROOT = '';
beforeEach(() => {
  if (PROJECT_ROOT) rmSync(PROJECT_ROOT, { recursive: true, force: true });
  PROJECT_ROOT = mkdtempSync(join(tmpdir(), 'deckent-finalizer-'));
});
afterAll(() => {
  if (PROJECT_ROOT) rmSync(PROJECT_ROOT, { recursive: true, force: true });
});

// ─── Mocks ──────────────────────────────────────────────────────────

// ─── REAL FILESYSTEM (FAZ4A-S2) ─────────────────────────────────────
// node:fs mock deliberately removed: the finalizer's atomic publication ring
// (temp write → renameSync → read-back digest, run-status read model) verifies its
// own writes and a mocked fs cannot carry the round-trip. Every test runs against a
// fresh real scratch root under tmpdir instead.

vi.mock('node:child_process', () => ({
  // Real fs, mocked processes: probes stay sandboxed and status-shaped.
  spawnSync: vi.fn(() => ({ status: 0, stdout: '', stderr: '' })),
}));

vi.mock('../../src/core/utils.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/core/utils.js')>();
  return {
    ...actual,
    parseDebtTable: vi.fn().mockReturnValue([]),
    updateLastSprintId: vi.fn(),
    debugLog: vi.fn(),
  };
});

vi.mock('../../src/orchestra/sprint-reporter.js', () => ({
  writeRetrospective: vi.fn(),
  appendRetroSection: vi.fn(),
  writeSprintLog: vi.fn(),
  calculateMetrics: vi.fn().mockReturnValue({
    totalTasks: 1,
    completedTasks: 1,
    techDebtTasks: 0,
    noGoTasks: 0,
    durationMs: 1000,
    coverage: 95,
  }),
  updateProjectDocs: vi.fn(),
  buildAgentPerformance: vi.fn().mockReturnValue([]),
  archiveDirectives: vi.fn(),
  archiveOrphanTasks: vi.fn().mockReturnValue(0),
}));

// Mock MemoryStore for triple-link tests (dynamic import in finalizeSprint)
const mockInsertRelation = vi.fn();
const mockMemStoreClose = vi.fn();
vi.mock('../../src/core/memory-store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/core/memory-store.js')>();
  return {
    ...actual,
    MemoryStore: vi.fn().mockImplementation((...args: ConstructorParameters<typeof actual.MemoryStore>) => {
      const store = new actual.MemoryStore(...args);
      const close = store.close.bind(store);
      store.close = () => {
        mockMemStoreClose();
        close();
      };
      // Triple-link behavior stays directly observable without manufacturing
      // foreign-key fixture rows. Every archive/index/export method remains the
      // real MemoryStore implementation and therefore materializes Brain truth.
      store.insertRelation = ((...relationArgs: unknown[]) => {
        mockInsertRelation(...relationArgs);
      }) as typeof store.insertRelation;
      return store;
    }),
  };
});

vi.mock('../../src/orchestra/result-evaluator.js', () => ({
  GO_WITH_GATE_FAILURE: 'GO_WITH_GATE_FAILURE',
  getRecentSprintStats: vi.fn().mockReturnValue({
    sprintCount: 0,
    avgNoGoRate: 0,
    avgCoverage: 80,
  }),
  // Re-exports from auditor.js — kept for backward compat
  tryCodeVerifiedDone: vi.fn().mockResolvedValue({ triggered: false, verified: false }),
  writeCodeVerifiedResult: vi.fn().mockResolvedValue(undefined),
  CODE_VERIFIED_DONE: 'CODE_VERIFIED_DONE',
  parseEvidenceCommand: vi.fn().mockReturnValue(null),
  CodeVerifyOptions: undefined,
  CodeVerifyResult: undefined,
}));

// Sprint 138: tryCodeVerifiedDone migrated to auditor.ts — mock both paths
vi.mock('../../src/monitor/auditor.js', () => ({
  tryCodeVerifiedDone: vi.fn().mockResolvedValue({ triggered: false, verified: false }),
  writeCodeVerifiedResult: vi.fn().mockResolvedValue(undefined),
  CODE_VERIFIED_DONE: 'CODE_VERIFIED_DONE',
  parseEvidenceCommand: vi.fn().mockReturnValue(null),
}));

vi.mock('../../src/orchestra/baseline-tracker.js', () => ({
  parseVitestBaseline: vi.fn().mockReturnValue({ files: 0, pass: 0, fail: 0, skipped: 0 }),
  readBaseline: vi.fn().mockReturnValue(null),
  containsHonestyTrigger: vi.fn().mockReturnValue(false),
  captureVitestBaseline: vi.fn(),
}));

vi.mock('../../src/orchestra/result-collector.js', () => ({
  buildResultsMap: vi.fn().mockReturnValue(new Map()),
}));

vi.mock('../../src/orchestra/debt-manager.js', () => ({
  runDecay: vi.fn(),
  auditBrainBudget: vi.fn().mockReturnValue({ status: 'OK', decayableLines: 0, permanentLines: 0 }),
}));

vi.mock('../../src/core/agent-pool.js', () => ({
  AgentPoolManager: vi.fn().mockImplementation(() => ({
    loadAgents: vi.fn().mockReturnValue(new Map()),
    updateAgentStats: vi.fn(),
    getAgent: vi.fn(),
    saveAgent: vi.fn(),
  })),
}));

vi.mock('../../src/core/skill-pool.js', () => ({
  SkillPoolManager: vi.fn().mockImplementation(() => ({
    loadSkills: vi.fn().mockReturnValue(new Map()),
    updateSkillStats: vi.fn(),
    getSkill: vi.fn(),
    saveSkill: vi.fn(),
  })),
}));

vi.mock('../../src/core/plugin-hooks.js', () => ({
  runHooks: vi.fn(),
  loadPluginHooks: vi.fn(),
  clearHooks: vi.fn(),
}));

vi.mock('../../src/orchestra/sprint-utils.js', () => ({
  readFileSafe: vi.fn().mockReturnValue(''),
  now: vi.fn().mockReturnValue('2026-04-10T12:00:00Z'),
}));

vi.mock('../../src/cli/helpers/sprint-summary-rich.js', () => ({
  formatRichSprintSummary: vi.fn().mockReturnValue(null),
}));

vi.mock('../../src/core/observability.js', () => ({
  generateLoadReport: vi.fn().mockResolvedValue('# Sprint Load Test Report\n\n## Wave Timeline\n\nNo wave data recorded.\n'),
  initObservability: vi.fn(),
  structuredLog: vi.fn(),
  metric: vi.fn(),
  trace: vi.fn(),
  TELEMETRY_ENABLED: false,
  setObservabilitySprintId: vi.fn(),
  getObservabilitySprintId: vi.fn().mockReturnValue(null),
  getMetricsPath: vi.fn().mockReturnValue('/tmp/metrics.jsonl'),
  getPerSprintMetricsPath: vi.fn().mockReturnValue(null),
  resetObservability: vi.fn(),
}));

// ─── Post-Finalize Hooks Mock (Sprint 143 Task 10) ──
const mockRunPostFinalizeHooks = vi.fn().mockResolvedValue({
  memoryExport: { success: true, filesWritten: ['summary.md', 'decisions.md', 'memory.md', 'debt.md'], errors: [] },
  identityRegen: { success: true, filePath: '/tmp/project/.brain/PROJECT-IDENTITY.md', adrCount: 40, totalSprints: 143, reason: 'updated' },
  ruleRegenCalled: false,
  errors: [],
});
vi.mock('../../src/core/identity-generator.js', () => ({
  runPostFinalizeHooks: (...args: unknown[]) => mockRunPostFinalizeHooks(...args),
  regenerateProjectIdentity: vi.fn().mockReturnValue({ success: true, filePath: '', adrCount: 0, totalSprints: 1, reason: 'updated' }),
  runMemoryExport: vi.fn().mockResolvedValue({ success: true, filesWritten: [], errors: [] }),
}));

// ─── Event Stream Mock (Sprint 139 Task 042 — Brain event hooks) ──
vi.mock('../../src/orchestra/event-stream.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/orchestra/event-stream.js')>();
  return {
    ...actual,
    writeEvent: vi.fn(actual.writeEvent),
    getCurrentSprintId: vi.fn().mockReturnValue('sprint-139'),
  };
});

import * as nodeFsMod from 'node:fs';
import * as observabilityMod from '../../src/core/observability.js';
import * as eventStreamMod from '../../src/orchestra/event-stream.js';
import { writeEvent as writeCanonicalEvent } from '../../src/core/event-stream.js';
import { MemoryStore } from '../../src/core/memory-store.js';
import { getMessage } from '../../src/cli/helpers/messages.js';
import { buildMemoryExportLabels } from '../../src/core/memory-export-labels.js';
import * as skillAttributionMod from '../../src/core/routing/skill-attribution.js';

import {
  runHonestyCheck,
  writeRubricDetail,
  runSelfAuditGate,
  applyGateStatus,
  finalizeSprint,
  runBudgetedDecay,
  buildFinalizerTerminalTruth,
  publishFencedSprintTerminalReceipt,
} from '../../src/orchestra/sprint-finalizer.js';
import type { FinalizeSprintOptions, SelfAuditResult } from '../../src/orchestra/sprint-finalizer.js';
import type { ResolvedConfig } from '../../src/core/types.js';
import { GO_WITH_GATE_FAILURE } from '../../src/orchestra/result-evaluator.js';
import { runDecay as mockRunDecay, auditBrainBudget as mockAuditBrainBudget } from '../../src/orchestra/debt-manager.js';
import { tryCodeVerifiedDone, writeCodeVerifiedResult } from '../../src/monitor/auditor.js';
import { buildResultsMap } from '../../src/orchestra/result-collector.js';

beforeEach(() => {
  vi.mocked(eventStreamMod.writeEvent).mockReset();
  vi.mocked(eventStreamMod.writeEvent).mockImplementation(writeCanonicalEvent);
});

describe('sprint-finalizer — hook stubs', () => {
  describe('runHonestyCheck', () => {
    it('should return 0 violations (stub)', async () => {
      const result = await runHonestyCheck(PROJECT_ROOT, 'sprint-134', []);
      expect(result).toBe(0);
    });

    it('should be call-safe with any arguments', async () => {
      const result = await runHonestyCheck(PROJECT_ROOT, 'sprint-999', [
        { taskId: 't1', workerId: 'w1', filesChanged: [], linesAdded: 0, linesRemoved: 0, testsPassed: true, coverage: 95, selfAssessment: 'DONE', notes: '' , workAttribution: { state: 'VERIFIED' as const, attemptId: 'attempt-t1', baselineRef: 'baseline:attempt-t1', scopeDigest: 'attempt-t1000000000000000000000000000000000000000000000000000000' } },
      ]);
      expect(result).toBe(0);
    });
  });

  describe('writeRubricDetail', () => {
    it('should return false when no results have rubric scores', async () => {
      const evaluations = new Map<string, TaskEvaluation>();
      const results = [
        { taskId: 't1', workerId: 'w1', filesChanged: [], linesAdded: 0, linesRemoved: 0, testsPassed: true, coverage: 95, selfAssessment: 'DONE' as const, notes: '' , workAttribution: { state: 'VERIFIED' as const, attemptId: 'attempt-t1', baselineRef: 'baseline:attempt-t1', scopeDigest: 'attempt-t1000000000000000000000000000000000000000000000000000000' } },
      ];
      const result = await writeRubricDetail(PROJECT_ROOT, 'sprint-134', results, evaluations);
      expect(result).toBe(false);
    });

    it('should return false for empty results', async () => {
      const evaluations = new Map<string, TaskEvaluation>();
      const result = await writeRubricDetail(PROJECT_ROOT, 'sprint-134', [], evaluations);
      expect(result).toBe(false);
    });
  });

  describe('runSelfAuditGate', () => {
    it('should return all-PASS result (stub)', async () => {
      const result = await runSelfAuditGate('sprint-134');
      expect(result.overallGate).toBe('PASS');
      expect(result.tsc.status).toBe('PASS');
      expect(result.vitest.status).toBe('PASS');
      expect(result.honesty.violations).toBe(0);
    });

    it('should have correct SelfAuditResult shape', async () => {
      const result: SelfAuditResult = await runSelfAuditGate('sprint-134', PROJECT_ROOT);
      expect(result).toHaveProperty('tsc');
      expect(result).toHaveProperty('vitest');
      expect(result).toHaveProperty('honesty');
      expect(result).toHaveProperty('observability');
      expect(result).toHaveProperty('overallGate');
      expect(result.tsc.errors).toEqual([]);
      expect(result.honesty.flaggedTasks).toEqual([]);
    });
  });

  describe('FinalizeSprintOptions type', () => {
    it('should accept valid options', () => {
      const opts: FinalizeSprintOptions = {
        skipDecay: true,
        skipHooks: false,
      };
      expect(opts.skipDecay).toBe(true);
    });
  });

  describe('applyGateStatus', () => {
    it('should return GO_WITH_GATE_FAILURE when gate is GATE_FAILURE', () => {
      const gate = { overallGate: 'GATE_FAILURE' as const };
      const result = applyGateStatus('DONE', gate);
      expect(result).toBe(GO_WITH_GATE_FAILURE);
    });

    it('should leave status unchanged when gate is PASS', () => {
      const gate = { overallGate: 'PASS' as const };
      const result = applyGateStatus('DONE', gate);
      expect(result).toBe('DONE');
    });

    it('should leave status unchanged when gate is WARNING (metrics missing is not fail)', () => {
      // WARNING is not a valid overallGate value in SelfAuditResult (only PASS|GATE_FAILURE),
      // but the helper must not break if passed an unknown string via cast
      const gate = { overallGate: 'WARNING' as unknown as 'PASS' | 'GATE_FAILURE' };
      const result = applyGateStatus('GO_WITH_TECH_DEBT', gate);
      expect(result).toBe('GO_WITH_TECH_DEBT');
    });
  });
});

describe('sprint-finalizer — on-demand load-report formatter', () => {
  it('generateLoadReport returns a report with a wave timeline section', async () => {
    const mockGenerate = vi.mocked(observabilityMod.generateLoadReport);
    mockGenerate.mockResolvedValueOnce(
      '# Sprint Load Test Report\n\n## Wave Timeline\n\nNo wave data recorded.\n\n## Percentile Distribution (p50/p95/p99)\n',
    );

    const result = await observabilityMod.generateLoadReport(PROJECT_ROOT);
    expect(result).toContain('Wave Timeline');
    expect(mockGenerate).toHaveBeenCalledWith(PROJECT_ROOT);
  });

  it('generateLoadReport errors propagate to its on-demand caller', async () => {
    const mockGenerate = vi.mocked(observabilityMod.generateLoadReport);
    // Simulate a throw from generateLoadReport
    mockGenerate.mockRejectedValueOnce(new Error('Disk full'));

    await expect(observabilityMod.generateLoadReport(PROJECT_ROOT)).rejects.toThrow('Disk full');

    expect(mockGenerate).toHaveBeenCalled();
  });

  it('generateLoadReport returns a minimal report when no metrics data is available', async () => {
    const mockGenerate = vi.mocked(observabilityMod.generateLoadReport);
    mockGenerate.mockResolvedValueOnce('# Load Report\n\nNo metrics data found.\n');

    const result = await observabilityMod.generateLoadReport(PROJECT_ROOT);
    expect(result).toContain('# Load Report');
    expect(result).toContain('No metrics data found');
  });

});

describe('sprint-finalizer — gate.json wiring', () => {
  it('runSelfAuditGate returns valid JSON with all required fields', async () => {
    // Verifies that the object written to gate.json has correct shape
    const result: SelfAuditResult = await runSelfAuditGate('sprint-136', PROJECT_ROOT);
    const serialized = JSON.stringify(result, null, 2);
    const parsed = JSON.parse(serialized) as SelfAuditResult;
    expect(parsed).toHaveProperty('tsc');
    expect(parsed).toHaveProperty('vitest');
    expect(parsed).toHaveProperty('honesty');
    expect(parsed).toHaveProperty('observability');
    expect(parsed).toHaveProperty('overallGate');
    expect(['PASS', 'GATE_FAILURE']).toContain(parsed.overallGate);
  });

  it('overallGate field roundtrip: PASS gate serializes and deserializes correctly', async () => {
    const result = await runSelfAuditGate('sprint-136');
    expect(result.overallGate).toBe('PASS');
    // Simulate what finalizeSprint writes to gate.json
    const json = JSON.stringify(result, null, 2);
    const parsed = JSON.parse(json) as SelfAuditResult;
    expect(parsed.overallGate).toBe('PASS');
    expect(parsed.tsc.status).toBe('PASS');
    expect(parsed.vitest.status).toBe('PASS');
    expect(parsed.honesty.violations).toBe(0);
  });

  it('gate.json write failure does not affect sprint status (fail-safe)', async () => {
    // Simulate fsPromises.writeFile throwing EACCES
    const fsMod = nodeFsMod as unknown as { promises: { writeFile: ReturnType<typeof vi.fn> } };
    const originalWriteFile = fsMod.promises.writeFile;
    fsMod.promises.writeFile = vi.fn().mockRejectedValueOnce(new Error('EACCES: permission denied'));

    // runSelfAuditGate itself should still succeed regardless of the writeFile failure
    // (the failure is caught inside finalizeSprint's try/catch, not in runSelfAuditGate)
    const result = await runSelfAuditGate('sprint-136', PROJECT_ROOT);
    expect(result.overallGate).toBe('PASS');

    // Restore original mock
    fsMod.promises.writeFile = originalWriteFile;
  });
});

// ─── Helper for finalizeSprint integration tests ─────────────────────────────

function makeSprint(id = 'sprint-137'): Sprint {
  return {
    id,
    number: 137,
    status: SprintStatus.COMPLETE,
    phase: SprintPhase.COMPLETE,
    // Terminal-evidence contract: a finalizable sprint needs at least one logical
    // task whose lineage can COMPLETE — an empty sprint is NO_LOGICAL_TASKS and is
    // (correctly) refused at the archive boundary.
    tasks: [makeSettledTask(`${id}-main`)],
    workers: [],
  };
}

function makeSettledTask(taskId: string): Sprint['tasks'][number] {
  return {
    id: taskId,
    title: `Task ${taskId}`,
    description: '',
    model: 'sonnet',
    effort: 'normal',
    priority: 'NORMAL',
    reason: '',
    scope: { directories: ['src/'], filesRead: [], filesWrite: [] },
    dependencies: [],
    goNogo: { goCriteria: '', noGoCriteria: '', techDebtAcceptable: '' },
    status: TaskStatus.DONE,
    sprintId: taskId.replace(/-main$/, ''),
    createdAt: new Date().toISOString(),
  } as Sprint['tasks'][number];
}

/** DONE evaluation + host-attributed result for every task on the sprint. */
function settledFixture(sprint: Sprint): {
  evaluations: Map<string, TaskEvaluation>;
  results: TaskResult[];
} {
  // Finalizer archive settlement adopts a compact Brain index by default.
  // Materialize a genuine SQLite authority so reconcile/upsert/export/verify
  // exercise the same producer→consumer chain as production.
  try {
    mkdirSync(join(PROJECT_ROOT, '.brain'), { recursive: true });
    new MemoryStore(join(PROJECT_ROOT, '.brain', 'memory.db')).close();
  } catch { /* tests that intentionally make .brain unavailable opt out below */ }
  const tasksDir = join(PROJECT_ROOT, '.tasks');
  mkdirSync(tasksDir, { recursive: true });
  const evaluations = new Map<string, TaskEvaluation>();
  const results: TaskResult[] = [];
  for (const task of sprint.tasks) {
    // The finalizer's terminal receipt is CAS-fenced against durable task
    // authority. Integration fixtures must therefore persist the task bytes
    // they claim to settle instead of relying on the in-memory Sprint alone.
    writeFileSync(
      join(tasksDir, `task-${task.id}.json`),
      `${JSON.stringify(task, null, 2)}\n`,
      { mode: 0o600 },
    );
    const attemptId = `attempt-${task.id}`;
    const baselineSha256 = 'a'.repeat(64);
    evaluations.set(task.id, TaskEvaluation.DONE);
    results.push({
      taskId: task.id,
      workerId: `w-${task.id}`,
      filesChanged: ['src/x.ts'],
      linesAdded: 1,
      linesRemoved: 0,
      testsPassed: true,
      coverage: 90,
      selfAssessment: 'DONE',
      notes: '',
      workAttribution: {
        state: 'VERIFIED' as const,
        attemptId,
        baselineRef: `task-result-work-attribution-baseline:sha256:${baselineSha256}`,
        baselineSha256,
        scopeDigest: 'b'.repeat(64),
      },
    });
  }
  return { evaluations, results };
}

describe('sprint-finalizer — mixed terminal receipt truth', () => {
  it('publishes COMPLETE with distinct completed, policy-skip, and cascade-skip counts', () => {
    const sprint = makeSprint('sprint-703');
    sprint.tasks = [
      makeSettledTask('703-901'),
      makeSettledTask('703-902'),
      makeSettledTask('703-903'),
    ];
    sprint.tasks[2]!.dependencies = ['703-902'];
    const { results: completedResults } = settledFixture({
      ...sprint,
      tasks: [sprint.tasks[0]!],
    } as Sprint);
    const results: TaskResult[] = [
      ...completedResults,
      {
        taskId: '703-902', workerId: 'host-703-902', filesChanged: [],
        linesAdded: 0, linesRemoved: 0, testsPassed: false, coverage: 0,
        selfAssessment: 'NO_GO', notes: 'host settlement fixture',
        preDispatchSettlement: {
          version: 1, state: 'NOT_DISPATCHED',
          attemptId: 'host-pre-dispatch:703-902:forced-skill',
          reasonCode: 'FORCED_SKILL_UNAVAILABLE',
          evidenceRef: `host-pre-dispatch-settlement:sha256:${'c'.repeat(64)}`,
        },
      } as TaskResult,
      {
        taskId: '703-903', workerId: 'cascade-skip-703-903', filesChanged: [],
        linesAdded: 0, linesRemoved: 0, testsPassed: false, coverage: 0,
        selfAssessment: 'NO_GO', evaluationDecision: 'NO_GO',
        cascadeSkipped: true, notes: 'cascade fixture',
      } as TaskResult,
    ];
    for (const task of sprint.tasks.slice(1)) {
      writeFileSync(join(PROJECT_ROOT, '.tasks', `task-${task.id}.json`),
        `${JSON.stringify(task, null, 2)}\n`, { mode: 0o600 });
    }
    const truth = buildFinalizerTerminalTruth({
      tasks: sprint.tasks,
      results,
      evaluations: new Map([
        ['703-901', TaskEvaluation.DONE],
        ['703-902', TaskEvaluation.NOT_DISPATCHED],
        ['703-903', TaskEvaluation.NO_GO],
      ]),
    });

    expect(truth.terminalEvidence.cleanupEligibility).toEqual({
      state: 'CANDIDATE', candidate: true, reasons: [],
    });
    expect(truth.terminalTruth).toEqual({
      completedLineages: 1,
      policySkippedLineages: 1,
      cascadeSkippedLineages: 1,
    });
    const publication = publishFencedSprintTerminalReceipt({
      projectRoot: PROJECT_ROOT, sprint, truth,
    });
    const artifact = JSON.parse(readFileSync(publication.artifactPath, 'utf8')) as {
      terminalOutcome: string;
      terminalTruth: typeof truth.terminalTruth;
    };
    expect(artifact.terminalOutcome).toBe('COMPLETE');
    expect(artifact.terminalTruth).toEqual(truth.terminalTruth);
  });

  it('still refuses COMPLETE for an unrepaired worker NO_GO', () => {
    const sprint = makeSprint('sprint-703-failed');
    const task = sprint.tasks[0]!;
    const { results } = settledFixture(sprint);
    results[0] = { ...results[0]!, selfAssessment: 'NO_GO', evaluationDecision: 'NO_GO' };
    const truth = buildFinalizerTerminalTruth({
      tasks: sprint.tasks,
      results,
      evaluations: new Map([[task.id, TaskEvaluation.NO_GO]]),
    });
    expect(() => publishFencedSprintTerminalReceipt({
      projectRoot: PROJECT_ROOT, sprint, truth,
    })).toThrow(/TERMINAL_PUBLICATION_NOT_CLEANUP_CANDIDATE_BLOCKED/);
  });
});

describe('sprint-finalizer — finalizeSprint gate.json integration', () => {
  beforeEach(() => {
    // Reset fs promise mocks before each test
  });

  it('finalizeSprint writes gate.json to .deckent/recently-works/ after runSelfAuditGate', async () => {
    const sprint = makeSprint('sprint-137');
    const { evaluations, results } = settledFixture(sprint);

    await finalizeSprint(PROJECT_ROOT, sprint, evaluations, results, { skipDecay: true, skipHooks: true });

    // REAL disk truth (not a writeFile spy): gate.json lands under recently-works
    // (Sprint 150 de-scatter), never the legacy .deckent/ root.
    const gatePath = join(PROJECT_ROOT, '.deckent', 'recently-works', 'sprint-137-gate.json');
    const parsed = JSON.parse(readFileSync(gatePath, 'utf8')) as { overallGate: string };
    expect(['PASS', 'GATE_FAILURE']).toContain(parsed.overallGate);
  });

  it('finalizeSprint does not write a product-doc load report', async () => {
    vi.mocked(observabilityMod.generateLoadReport).mockClear();
    const sprint = makeSprint('sprint-137');
    const { evaluations, results } = settledFixture(sprint);

    await finalizeSprint(PROJECT_ROOT, sprint, evaluations, results, { skipDecay: true, skipHooks: true });

    const reportPath = join(PROJECT_ROOT, 'docs', 'audits', 'sprint-137', 'load-test-report.md');
    expect(existsSync(reportPath)).toBe(false);
    expect(observabilityMod.generateLoadReport).not.toHaveBeenCalled();
  });

  it('holds when fresh gate authority cannot be persisted', async () => {
    // The gate JSON view is best-effort only after a fresh authoritative gate has
    // been persisted. A global write failure at that authority boundary is a HOLD.
    const writeSpy = vi.spyOn(nodeFsMod.promises, 'writeFile')
      .mockRejectedValue(new Error('ENOSPC: no space left'));
    try {

    const sprint = makeSprint('sprint-137');
    const { evaluations, results } = settledFixture(sprint);

    await expect(
      finalizeSprint(PROJECT_ROOT, sprint, evaluations, results, { skipDecay: true, skipHooks: true }),
    ).rejects.toThrow(/FINALIZER_GATE_EVALUATION_HOLD/);
    } finally { writeSpy.mockRestore(); }
  });
});

// ─── tryCodeVerifiedDone Wire Integration Tests ───────────────────────────────

describe('sprint-finalizer — tryCodeVerifiedDone wire integration', () => {
  const mockTryCode = vi.mocked(tryCodeVerifiedDone);
  const mockWriteResult = vi.mocked(writeCodeVerifiedResult);
  const mockBuildResultsMap = vi.mocked(buildResultsMap);

  // CONTRACT SUPERSEDED (FAZ4A-S2 discovery, evaluation-honesty train 483-490):
  // the finalizer explicitly demoted code-verified reconciliation to a
  // DIAGNOSTIC-ONLY ambient observation — "verdict unchanged"; it may never
  // mutate an evaluation or synthesize a worker result at the finalizer
  // boundary (RECOVERY-BORN-483-EVALUATION-HONESTY-001 class). The old tests
  // pinned the retired mutation behavior (NO_GO → DONE flip + synthetic
  // .result write); these pin the honest replacement.

  const nogoTask = (taskId: string): Sprint['tasks'][number] => ({
    id: taskId,
    title: `Task ${taskId}`,
    description: '',
    model: 'sonnet',
    effort: 'normal',
    priority: 'HIGH',
    reason: '',
    scope: { directories: ['src/'], filesRead: [], filesWrite: ['src/a.ts'] },
    dependencies: [],
    goNogo: { goCriteria: '', noGoCriteria: '', techDebtAcceptable: '' },
    status: 'DONE',
  }) as Sprint['tasks'][number];

  beforeEach(() => {
    mockTryCode.mockReset();
    mockWriteResult.mockReset().mockResolvedValue(undefined);
    mockBuildResultsMap.mockReset().mockReturnValue(new Map());
    mockTryCode.mockResolvedValue({
      triggered: false,
      verified: false,
      reason: 'Reconciliation not triggered',
      verifiedFiles: [],
      evidenceMatched: false,
    });
  });

  it('probes tryCodeVerifiedDone diagnostically for NO_GO tasks only, then fails closed', async () => {
    const sprint = makeSprint('sprint-137');
    sprint.tasks = [nogoTask('137-001'), makeSettledTask('137-002')];
    const evaluations = new Map<string, TaskEvaluation>([
      ['137-001', TaskEvaluation.NO_GO],
      ['137-002', TaskEvaluation.DONE],
    ]);
    const { results } = settledFixture({ ...sprint, tasks: [sprint.tasks[1]] } as Sprint);

    // Unresolved NO_GO lineage → plain finalize is refused at the archive boundary.
    await expect(
      finalizeSprint(PROJECT_ROOT, sprint, evaluations, results, { skipDecay: true, skipHooks: true }),
    ).rejects.toThrow(/TERMINAL_/);

    // The diagnostic probe still ran for the NO_GO task and only for it.
    expect(mockTryCode).toHaveBeenCalledWith('137-001', PROJECT_ROOT);
    expect(mockTryCode).not.toHaveBeenCalledWith('137-002', PROJECT_ROOT);
  });

  it('never mutates a NO_GO verdict, even when the probe reports verified=true', async () => {
    const sprint = makeSprint('sprint-137');
    sprint.tasks = [nogoTask('137-003')];
    const evaluations = new Map<string, TaskEvaluation>([['137-003', TaskEvaluation.NO_GO]]);
    mockTryCode.mockResolvedValueOnce({
      triggered: true,
      verified: true,
      reason: 'Code physically verified despite missing .result',
      verifiedFiles: ['src/a.ts'],
      evidenceMatched: true,
    });

    await expect(
      finalizeSprint(PROJECT_ROOT, sprint, evaluations, [], { skipDecay: true, skipHooks: true }),
    ).rejects.toThrow(/TERMINAL_/);

    // The retired behavior flipped the verdict and synthesized a result; the honest
    // contract does neither.
    expect(evaluations.get('137-003')).toBe(TaskEvaluation.NO_GO);
    expect(mockWriteResult).not.toHaveBeenCalled();
  });

  it('preserves NO_GO and fails closed when the probe itself throws (fail-safe diagnostics)', async () => {
    const sprint = makeSprint('sprint-137');
    sprint.tasks = [nogoTask('137-004')];
    const evaluations = new Map<string, TaskEvaluation>([['137-004', TaskEvaluation.NO_GO]]);
    mockTryCode.mockRejectedValueOnce(new Error('probe crashed'));

    // Probe failure is swallowed (diagnostic), the unresolved NO_GO still refuses settle.
    await expect(
      finalizeSprint(PROJECT_ROOT, sprint, evaluations, [], { skipDecay: true, skipHooks: true }),
    ).rejects.toThrow(/TERMINAL_/);
    expect(evaluations.get('137-004')).toBe(TaskEvaluation.NO_GO);
  });
});

describe('sprint-finalizer — archiveDirectives called in finalizeSprint', () => {
  beforeEach(() => {
  });

  it('calls archiveDirectives with projectRoot and sprintId during finalizeSprint', async () => {
    const { archiveDirectives } = await import('../../src/orchestra/sprint-reporter.js');
    const mockArchive = vi.mocked(archiveDirectives);
    mockArchive.mockClear();

    const sprint = makeSprint('sprint-138');
    const { evaluations, results } = settledFixture(sprint);

    await finalizeSprint(PROJECT_ROOT, sprint, evaluations, results, { skipDecay: true, skipHooks: true });

    expect(mockArchive).toHaveBeenCalledWith(PROJECT_ROOT, 'sprint-138', expect.anything(), expect.anything());
  });

  it('never archives a zero-task sprint (fail-closed; was: called even when no tasks)', async () => {
    // Superseded contract: archive lives BEHIND the terminal-receipt gate now, and an
    // empty sprint is NO_LOGICAL_TASKS → refused. Archiving directives for a sprint
    // with no archivable evidence was the old false-COMPLETE shape.
    const { archiveDirectives } = await import('../../src/orchestra/sprint-reporter.js');
    const mockArchive = vi.mocked(archiveDirectives);
    mockArchive.mockClear();

    const sprint = makeSprint('sprint-138');
    sprint.tasks = [];
    const { evaluations, results } = settledFixture(sprint);

    // A′/ADR-D-007 (535/536 kronolojisi): the hold now fires BEFORE any receipt
    // byte is written — TERMINAL_PUBLICATION_ZERO_TASK_HOLD replaces the old
    // post-publication TERMINAL_RECEIPT_NOT_CLEANUP_ELIGIBLE for the empty set.
    await expect(
      finalizeSprint(PROJECT_ROOT, sprint, evaluations, results, { skipDecay: true, skipHooks: true }),
    ).rejects.toThrow(/TERMINAL_PUBLICATION_ZERO_TASK_HOLD/);
    expect(mockArchive).not.toHaveBeenCalled();
  });

  it('holds when canonical DIRECTIVES archival fails', async () => {
    const { archiveDirectives } = await import('../../src/orchestra/sprint-reporter.js');
    const mockArchive = vi.mocked(archiveDirectives);
    mockArchive.mockImplementationOnce(() => { throw new Error('EACCES: permission denied'); });

    const sprint = makeSprint('sprint-138');
    const { evaluations, results } = settledFixture(sprint);

    await expect(
      finalizeSprint(PROJECT_ROOT, sprint, evaluations, results, { skipDecay: true, skipHooks: true }),
    ).rejects.toThrow(/SPRINT_ARCHIVE_DIRECTIVES_FAILED/);
  });
});

// ─── Sprint 138: Layer 4 Runtime Wire Forensic Fix Tests ────────────────────

describe('sprint-finalizer — Layer 4 runtime wire fix (Sprint 138)', () => {
  const mockBuildResultsMap = vi.mocked(buildResultsMap);
  const mockTryCode = vi.mocked(tryCodeVerifiedDone);

  beforeEach(() => {
    mockBuildResultsMap.mockReset().mockReturnValue(new Map());
    mockTryCode.mockReset().mockResolvedValue({
      triggered: false,
      verified: false,
      reason: 'Reconciliation not triggered',
      verifiedFiles: [],
      evidenceMatched: false,
    });

    // Reset fs promise mocks
  });

  it('gate.json is always written even when runSelfAuditGate succeeds', async () => {
    const sprint = makeSprint('sprint-138');
    const { evaluations, results } = settledFixture(sprint);

    await finalizeSprint(PROJECT_ROOT, sprint, evaluations, results, { skipDecay: true, skipHooks: true });

    const gatePath = join(PROJECT_ROOT, '.deckent', 'recently-works', 'sprint-138-gate.json');
    const parsed = JSON.parse(readFileSync(gatePath, 'utf8')) as { overallGate: string };
    expect(['PASS', 'GATE_FAILURE']).toContain(parsed.overallGate);
  });

  it('gate.json is written with fallback content when runSelfAuditGate throws', async () => {
    // Override runSelfAuditGate to throw via the spawnSync mock
    const cpMod = await import('node:child_process');
    const spawnSyncMock = vi.mocked(cpMod.spawnSync);
    spawnSyncMock.mockImplementation(() => { throw new Error('npx not found'); });

    const sprint = makeSprint('sprint-138');
    const { evaluations, results } = settledFixture(sprint);

    await finalizeSprint(PROJECT_ROOT, sprint, evaluations, results, { skipDecay: true, skipHooks: true });

    // gate.json must STILL be written (fallback gate result) — real disk truth.
    const gatePath = join(PROJECT_ROOT, '.deckent', 'recently-works', 'sprint-138-gate.json');
    const parsed = JSON.parse(readFileSync(gatePath, 'utf8')) as { overallGate: string };
    expect(parsed.overallGate).toBe('GATE_FAILURE');

    // Restore spawnSync mock
    spawnSyncMock.mockReturnValue({ status: 0, stdout: '', stderr: '', pid: 0, signal: null, output: [] });
  });

  it('holds when the fresh gate cannot persist', async () => {
    const wSpy = vi.spyOn(nodeFsMod.promises, 'writeFile').mockRejectedValue(new Error('ENOSPC'));
    const mSpy = vi.spyOn(nodeFsMod.promises, 'mkdir').mockRejectedValue(new Error('ENOSPC'));
    try {
      const sprint = makeSprint('sprint-138');
      const { evaluations, results } = settledFixture(sprint);

      await expect(
        finalizeSprint(PROJECT_ROOT, sprint, evaluations, results, { skipDecay: true, skipHooks: true }),
      ).rejects.toThrow(/FINALIZER_GATE_EVALUATION_HOLD/);
    } finally {
      wSpy.mockRestore();
      mSpy.mockRestore();
    }
  });

  it('spawnSync in runSelfAuditGate does not use shell: true (ADR-006 compliance)', async () => {
    // This test verifies the ADR-006 fix: no shell: true in spawnSync calls
    const cpMod = await import('node:child_process');
    const spawnSyncMock = vi.mocked(cpMod.spawnSync);
    spawnSyncMock.mockClear();
    spawnSyncMock.mockReturnValue({ status: 0, stdout: '', stderr: '', pid: 0, signal: null, output: [] });

    // Use DI options to avoid actual spawnSync for tsc/vitest, but still check git diff call
    await runSelfAuditGate('sprint-138', PROJECT_ROOT, {
      runTsc: () => ({ status: 0, stdout: '', stderr: '' }),
      runVitest: () => ({ status: 0, stdout: '', stderr: '' }),
    });

    // spawnSync should NOT have been called with shell: true for tsc/vitest
    // (DI overrides were used, so spawnSync was only called for git diff in Step 10 —
    //  but runSelfAuditGate itself doesn't call git diff, so no spawnSync calls)
    for (const call of spawnSyncMock.mock.calls) {
      const opts = call[2] as { shell?: boolean } | undefined;
      expect(opts?.shell).not.toBe(true);
    }
  });
});

// ═══ Brain Event Hook Points — Sprint 139 Task 042 ═══════════════
// Tests for the 4 event hook points added to finalizeSprint:
//   SPRINT_PHASE_CHANGE (EXECUTE→EVALUATE, EVALUATE→RETRO, RETRO→CLEANUP)
//   METRIC_EMITTED (sprint.summary after metrics calculation)
//   GATE_COMPUTED (after gate.json is written)

describe('sprint-finalizer — Brain event hooks (Sprint 139 Task 042)', () => {
  beforeEach(() => {
    vi.mocked(eventStreamMod.writeEvent).mockClear();
  });

  // ─── SPRINT_PHASE_CHANGE ─────────────────────────────────────────

  it('emits SPRINT_PHASE_CHANGE EXECUTE→EVALUATE at the start of finalizeSprint', async () => {
    const sprint = makeSprint('sprint-139');
    const { evaluations, results } = settledFixture(sprint);

    await finalizeSprint(PROJECT_ROOT, sprint, evaluations, results, { skipDecay: true, skipHooks: true });

    const phaseChangeCalls = vi.mocked(eventStreamMod.writeEvent).mock.calls.filter(
      call => call[4] === 'BRAIN→*:SPRINT_PHASE_CHANGE',
    );
    expect(phaseChangeCalls.length).toBeGreaterThanOrEqual(1);

    // First SPRINT_PHASE_CHANGE must be EXECUTE→EVALUATE
    const executeToEvaluate = phaseChangeCalls.find(call => {
      const payload = call[5] as { fromPhase?: string; toPhase?: string };
      return payload.fromPhase === 'EXECUTE' && payload.toPhase === 'EVALUATE';
    });
    expect(executeToEvaluate).toBeDefined();
    expect(executeToEvaluate![2]).toBe('brain');    // source
    expect(executeToEvaluate![3]).toBe('*');         // target (broadcast)
  });

  it('emits SPRINT_PHASE_CHANGE EVALUATE→RETRO before writing RETRO.md', async () => {
    const sprint = makeSprint('sprint-139');
    const { evaluations, results } = settledFixture(sprint);

    await finalizeSprint(PROJECT_ROOT, sprint, evaluations, results, { skipDecay: true, skipHooks: true });

    const phaseChangeCalls = vi.mocked(eventStreamMod.writeEvent).mock.calls.filter(
      call => call[4] === 'BRAIN→*:SPRINT_PHASE_CHANGE',
    );

    const evaluateToRetro = phaseChangeCalls.find(call => {
      const payload = call[5] as { fromPhase?: string; toPhase?: string };
      return payload.fromPhase === 'EVALUATE' && payload.toPhase === 'RETRO';
    });
    expect(evaluateToRetro).toBeDefined();
    expect(evaluateToRetro![2]).toBe('brain');
  });

  it('emits SPRINT_PHASE_CHANGE RETRO→CLEANUP at the end of finalizeSprint', async () => {
    const sprint = makeSprint('sprint-139');
    const { evaluations, results } = settledFixture(sprint);

    await finalizeSprint(PROJECT_ROOT, sprint, evaluations, results, { skipDecay: true, skipHooks: true });

    const phaseChangeCalls = vi.mocked(eventStreamMod.writeEvent).mock.calls.filter(
      call => call[4] === 'BRAIN→*:SPRINT_PHASE_CHANGE',
    );

    const retroToCleanup = phaseChangeCalls.find(call => {
      const payload = call[5] as { fromPhase?: string; toPhase?: string };
      return payload.fromPhase === 'RETRO' && payload.toPhase === 'CLEANUP';
    });
    expect(retroToCleanup).toBeDefined();
    expect(retroToCleanup![2]).toBe('brain');
  });

  it('emits all 3 SPRINT_PHASE_CHANGE events in correct order', async () => {
    const sprint = makeSprint('sprint-139');
    const { evaluations, results } = settledFixture(sprint);

    await finalizeSprint(PROJECT_ROOT, sprint, evaluations, results, { skipDecay: true, skipHooks: true });

    const phaseChangeCalls = vi.mocked(eventStreamMod.writeEvent).mock.calls.filter(
      call => call[4] === 'BRAIN→*:SPRINT_PHASE_CHANGE',
    );
    // At least 3 phase changes: EXECUTE→EVALUATE, EVALUATE→RETRO, RETRO→CLEANUP
    expect(phaseChangeCalls.length).toBeGreaterThanOrEqual(3);

    const phases = phaseChangeCalls.map(call => {
      const payload = call[5] as { fromPhase?: string; toPhase?: string };
      return `${payload.fromPhase}→${payload.toPhase}`;
    });
    const executeIdx = phases.indexOf('EXECUTE→EVALUATE');
    const retroIdx = phases.indexOf('EVALUATE→RETRO');
    const cleanupIdx = phases.indexOf('RETRO→CLEANUP');

    expect(executeIdx).toBeGreaterThanOrEqual(0);
    expect(retroIdx).toBeGreaterThan(executeIdx);
    expect(cleanupIdx).toBeGreaterThan(retroIdx);
  });

  // ─── METRIC_EMITTED ─────────────────────────────────────────────

  it('emits METRIC_EMITTED with sprint.summary after metrics calculation', async () => {
    const sprint = makeSprint('sprint-139');
    const { evaluations, results } = settledFixture(sprint);

    await finalizeSprint(PROJECT_ROOT, sprint, evaluations, results, { skipDecay: true, skipHooks: true });

    const metricCalls = vi.mocked(eventStreamMod.writeEvent).mock.calls.filter(
      call => call[4] === 'BRAIN→*:METRIC_EMITTED',
    );
    expect(metricCalls.length).toBeGreaterThanOrEqual(1);

    const summaryEvent = metricCalls.find(call => {
      const payload = call[5] as { name?: string };
      return payload.name === 'sprint.summary';
    });
    expect(summaryEvent).toBeDefined();
    expect(summaryEvent![2]).toBe('brain');
    expect(summaryEvent![3]).toBe('*');

    const payload = summaryEvent![5] as {
      totalTasks: number;
      completedTasks: number;
      techDebtTasks: number;
      noGoTasks: number;
      durationMs: number;
      sprintId: string;
    };
    expect(payload.sprintId).toBe('sprint-139');
    expect(typeof payload.totalTasks).toBe('number');
    expect(typeof payload.completedTasks).toBe('number');
    expect(typeof payload.durationMs).toBe('number');
  });

  it('METRIC_EMITTED payload includes coveragePercent field', async () => {
    const sprint = makeSprint('sprint-139');
    const { evaluations, results } = settledFixture(sprint);

    await finalizeSprint(PROJECT_ROOT, sprint, evaluations, results, { skipDecay: true, skipHooks: true });

    const metricCalls = vi.mocked(eventStreamMod.writeEvent).mock.calls.filter(
      call => call[4] === 'BRAIN→*:METRIC_EMITTED',
    );
    const summaryPayload = metricCalls.find(call => {
      const p = call[5] as { name?: string };
      return p.name === 'sprint.summary';
    })?.[5] as Record<string, unknown>;

    expect(summaryPayload).toBeDefined();
    expect(Object.prototype.hasOwnProperty.call(summaryPayload, 'coveragePercent')).toBe(true);
  });

  // ─── GATE_COMPUTED ───────────────────────────────────────────────

  it('emits GATE_COMPUTED after gate.json is written', async () => {
    const sprint = makeSprint('sprint-139');
    const { evaluations, results } = settledFixture(sprint);

    await finalizeSprint(PROJECT_ROOT, sprint, evaluations, results, { skipDecay: true, skipHooks: true });

    const gateComputedCalls = vi.mocked(eventStreamMod.writeEvent).mock.calls.filter(
      call => call[4] === 'AUDITOR→BRAIN:GATE_COMPUTED',
    );
    expect(gateComputedCalls.length).toBeGreaterThanOrEqual(1);

    const call = gateComputedCalls[0];
    expect(call[2]).toBe('auditor');  // source
    expect(call[3]).toBe('brain');    // target

    const payload = call[5] as { sprintId: string; overallGate: string };
    expect(payload.sprintId).toBe('sprint-139');
    expect(['PASS', 'GATE_FAILURE']).toContain(payload.overallGate);
  });

  it('GATE_COMPUTED payload includes tscStatus and vitestFail fields', async () => {
    const sprint = makeSprint('sprint-139');
    const { evaluations, results } = settledFixture(sprint);

    await finalizeSprint(PROJECT_ROOT, sprint, evaluations, results, { skipDecay: true, skipHooks: true });

    const gateComputedCalls = vi.mocked(eventStreamMod.writeEvent).mock.calls.filter(
      call => call[4] === 'AUDITOR→BRAIN:GATE_COMPUTED',
    );
    const payload = gateComputedCalls[0][5] as {
      tscStatus: string;
      vitestFail: number;
      vitestPass: number;
      honestyViolations: number;
      observabilityOk: boolean;
    };
    expect(['PASS', 'FAIL']).toContain(payload.tscStatus);
    expect(typeof payload.vitestFail).toBe('number');
    expect(typeof payload.vitestPass).toBe('number');
    expect(typeof payload.honestyViolations).toBe('number');
  });

  it('GATE_COMPUTED is NOT emitted when gate.json write fails', async () => {
    // When writeFile rejects, the GATE_COMPUTED event inside the try block is skipped.
    const eaccesSpy = vi.spyOn(nodeFsMod.promises, 'writeFile')
      .mockRejectedValue(new Error('EACCES: permission denied'));
    try {

    const sprint = makeSprint('sprint-139');
    const { evaluations, results } = settledFixture(sprint);

    await expect(
      finalizeSprint(PROJECT_ROOT, sprint, evaluations, results, { skipDecay: true, skipHooks: true }),
    ).rejects.toThrow(/FINALIZER_GATE_EVALUATION_HOLD/);

    // The gate.json write failed, so GATE_COMPUTED inside that try block was not reached
    const gateComputedCalls = vi.mocked(eventStreamMod.writeEvent).mock.calls.filter(
      call => call[4] === 'AUDITOR→BRAIN:GATE_COMPUTED',
    );
    expect(gateComputedCalls.length).toBe(0);
    } finally { eaccesSpy.mockRestore(); }
  });

  it('does not emit LOAD_REPORT_WRITTEN during finalization', async () => {
    const sprint = makeSprint('sprint-139');
    const { evaluations, results } = settledFixture(sprint);

    await finalizeSprint(PROJECT_ROOT, sprint, evaluations, results, { skipDecay: true, skipHooks: true });

    const loadReportCalls = vi.mocked(eventStreamMod.writeEvent).mock.calls.filter(
      call => call[4] === 'AUDITOR→BRAIN:LOAD_REPORT_WRITTEN',
    );
    expect(loadReportCalls).toHaveLength(0);
  });

  // ─── Fail-safe: a non-terminal event write may fail without hiding terminal authority ──

  it('a non-terminal writeEvent I/O failure does not crash finalizeSprint (fail-safe)', async () => {
    // Real writeEvent never throws — it swallows errors and returns null.
    // Only the first lifecycle observation is optional. The outer terminal
    // archive events remain canonical authority and must materialize on disk.
    vi.mocked(eventStreamMod.writeEvent)
      .mockReturnValueOnce(null)
      .mockImplementation(writeCanonicalEvent);

    const sprint = makeSprint('sprint-139');
    const { evaluations, results } = settledFixture(sprint);

    // Should resolve despite the non-terminal observation failure.
    const metrics = await finalizeSprint(
      PROJECT_ROOT, sprint, evaluations, results, { skipDecay: true, skipHooks: true },
    );
    expect(metrics).toBeDefined();
    expect(typeof metrics.totalTasks).toBe('number');
  });
});

// ═══ Triple-Link Tests (Task 143-007) ══════════════════════════════

describe('sprint-finalizer — triple-link relations (Task 143-007)', () => {
  beforeEach(() => {
    mockInsertRelation.mockClear();
    mockMemStoreClose.mockClear();
    // Real fs: the triple-link gate checks .brain/memory.db on disk — create it.
    mkdirSync(join(PROJECT_ROOT, '.brain'), { recursive: true });
    writeFileSync(join(PROJECT_ROOT, '.brain', 'memory.db'), '');
  });

  it('creates 3 triple-link relations during finalizeSprint', async () => {
    const sprint = makeSprint('sprint-143');
    const { evaluations, results } = settledFixture(sprint);

    await finalizeSprint(PROJECT_ROOT, sprint, evaluations, results, { skipDecay: true, skipHooks: true });

    // Triple-link: sprint-log → memory (depends_on), memory → retro (depends_on), retro → sprint-log (references)
    expect(mockInsertRelation).toHaveBeenCalledWith('sprint-log-sprint-143', 'memory-sprint-143', 'depends_on');
    expect(mockInsertRelation).toHaveBeenCalledWith('memory-sprint-143', 'retro-sprint-143', 'depends_on');
    expect(mockInsertRelation).toHaveBeenCalledWith('retro-sprint-143', 'sprint-log-sprint-143', 'references');
  });

  it('closes the MemoryStore after triple-link insertion', async () => {
    const sprint = makeSprint('sprint-143');
    const { evaluations, results } = settledFixture(sprint);

    await finalizeSprint(PROJECT_ROOT, sprint, evaluations, results, { skipDecay: true, skipHooks: true });

    expect(mockMemStoreClose).toHaveBeenCalled();
  });

  it('triple-link is fail-safe — finalizeSprint continues even on MemoryStore error', async () => {
    mockInsertRelation.mockImplementation(() => { throw new Error('DB locked'); });

    const sprint = makeSprint('sprint-143');
    const { evaluations, results } = settledFixture(sprint);

    // finalizeSprint must not throw
    const metrics = await finalizeSprint(PROJECT_ROOT, sprint, evaluations, results, { skipDecay: true, skipHooks: true });
    expect(metrics).toBeDefined();
  });

  it('skips triple-link when memory.db cannot exist (KPI ring failed)', async () => {
    // Real-fs discovery: simply deleting memory.db no longer produces the skip —
    // the KPI ring (recordKpiMeasurements → real KpiStore) runs BEFORE triple-link
    // and CREATES the DB. The gate's false branch is only reachable when that ring
    // fails; make `.brain` a FILE so KpiStore creation throws (swallowed, fail-safe)
    // and the DB genuinely cannot exist at the gate.
    rmSync(join(PROJECT_ROOT, '.brain'), { recursive: true, force: true });
    writeFileSync(join(PROJECT_ROOT, '.brain'), '');

    const sprint = makeSprint('sprint-143');
    const { evaluations, results } = settledFixture(sprint);

    await finalizeSprint(PROJECT_ROOT, sprint, evaluations, results, {
      skipDecay: true,
      skipHooks: true,
      skipMemoryExport: true,
    });

    expect(mockInsertRelation).not.toHaveBeenCalled();
  });
});

// ═══ Post-Finalize Hooks Tests (Sprint 143 Task 10) ═══════════════

describe('sprint-finalizer — post-finalize hooks (Sprint 143 Task 10)', () => {
  beforeEach(() => {
    mockRunPostFinalizeHooks.mockClear();
    mockRunPostFinalizeHooks.mockResolvedValue({
      memoryExport: { success: true, filesWritten: ['summary.md', 'decisions.md', 'memory.md', 'debt.md'], errors: [] },
      identityRegen: { success: true, filePath: '/tmp/project/.brain/PROJECT-IDENTITY.md', adrCount: 40, totalSprints: 143, reason: 'updated' },
      ruleRegenCalled: false,
      errors: [],
    });

  });

  it('calls runPostFinalizeHooks during finalizeSprint', async () => {
    const sprint = makeSprint('sprint-143');
    const { evaluations, results } = settledFixture(sprint);

    await finalizeSprint(PROJECT_ROOT, sprint, evaluations, results, { skipDecay: true, skipHooks: true });

    expect(mockRunPostFinalizeHooks).toHaveBeenCalledOnce();
    const callArgs = mockRunPostFinalizeHooks.mock.calls[0][0] as {
      projectRoot: string;
      sprintId: string;
      metrics: { sprintId: string };
    };
    expect(callArgs.projectRoot).toBe(PROJECT_ROOT);
    expect(callArgs.sprintId).toBe('sprint-143');
    expect(callArgs.metrics.sprintId).toBe('sprint-143');
  });

  it('passes onRuleRegen callback from FinalizeSprintOptions', async () => {
    const sprint = makeSprint('sprint-143');
    const { evaluations, results } = settledFixture(sprint);
    const ruleRegenFn = vi.fn();

    await finalizeSprint(PROJECT_ROOT, sprint, evaluations, results, {
      skipDecay: true,
      skipHooks: true,
      onRuleRegen: ruleRegenFn,
    });

    const callArgs = mockRunPostFinalizeHooks.mock.calls[0][0] as { onRuleRegen?: unknown };
    expect(callArgs.onRuleRegen).toBe(ruleRegenFn);
  });

  it('passes skipMemoryExport and skipIdentityRegen options', async () => {
    const sprint = makeSprint('sprint-143');
    const { evaluations, results } = settledFixture(sprint);

    await finalizeSprint(PROJECT_ROOT, sprint, evaluations, results, {
      skipDecay: true,
      skipHooks: true,
      skipMemoryExport: true,
      skipIdentityRegen: true,
    });

    const callArgs = mockRunPostFinalizeHooks.mock.calls[0][0] as {
      skipMemoryExport?: boolean;
      skipIdentityRegen?: boolean;
    };
    expect(callArgs.skipMemoryExport).toBe(true);
    expect(callArgs.skipIdentityRegen).toBe(true);
  });

  it('derives Turkish memory-export labels from the resolved project config', async () => {
    const sprint = makeSprint('sprint-143');
    const { evaluations, results } = settledFixture(sprint);
    // This test is intentionally self-contained: terminal skill-attribution
    // integrity binds provider/auth and provider-reported usage. Do not depend
    // on broader recovery fixture rewrites to reach the memory-export seam.
    sprint.tasks[0]!.provider = 'codex';
    sprint.tasks[0]!.authMode = 'subscription';
    results[0]!.tokenUsage = {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      provider: 'codex',
      model: 'sonnet',
    };
    const config = {
      language: 'tr',
      memory_export: {
        max_inline_lines: 901,
        max_inline_bytes: 4097,
        summary_inline_lines: 27,
        summary_inline_bytes: 513,
      },
    } as ResolvedConfig;

    // Skill-attribution receipt cutover belongs to the inherited recovery lane.
    // Keep this memory-export forwarding proof at its own seam while the selected
    // HEAD tree still emits an unprefixed logical-settlement digest there.
    const attributionWrite = vi.spyOn(skillAttributionMod, 'writeSkillAttributionBatch')
      .mockImplementation(() => undefined);
    try {
      await finalizeSprint(PROJECT_ROOT, sprint, evaluations, results, {
        skipDecay: true,
        skipHooks: true,
        config,
      });
    } finally {
      attributionWrite.mockRestore();
    }

    const callArgs = mockRunPostFinalizeHooks.mock.calls[0][0] as {
      memoryExportRenderOptions?: unknown;
    };
    expect(callArgs.memoryExportRenderOptions).toEqual({
      labels: buildMemoryExportLabels(getMessage, 'tr'),
      maxInlineLines: 901,
      maxInlineBytes: 4097,
      summaryInlineLines: 27,
      summaryInlineBytes: 513,
    });
  });

  it('finalizeSprint continues when post-finalize hooks fail (fail-safe)', async () => {
    mockRunPostFinalizeHooks.mockRejectedValueOnce(new Error('Hook chain crashed'));

    const sprint = makeSprint('sprint-143');
    const { evaluations, results } = settledFixture(sprint);

    // Must not throw — post-finalize hook failure is non-fatal
    const metrics = await finalizeSprint(PROJECT_ROOT, sprint, evaluations, results, { skipDecay: true, skipHooks: true });
    expect(metrics).toBeDefined();
  });

  it('post-finalize hooks run AFTER job summary (step 13) and BEFORE RETRO→CLEANUP event', async () => {
    const callOrder: string[] = [];

    mockRunPostFinalizeHooks.mockImplementation(async () => {
      callOrder.push('postFinalizeHooks');
      return {
        memoryExport: null,
        identityRegen: null,
        ruleRegenCalled: false,
        errors: [],
      };
    });
    vi.mocked(eventStreamMod.writeEvent).mockImplementation((...args: unknown[]) => {
      const payload = args[5] as { toPhase?: string } | undefined;
      if (payload && payload.toPhase === 'CLEANUP') callOrder.push('retroCleanupEvent');
      return writeCanonicalEvent(...args as Parameters<typeof writeCanonicalEvent>);
    });

    const sprint = makeSprint('sprint-143');
    const { evaluations, results } = settledFixture(sprint);
    await finalizeSprint(PROJECT_ROOT, sprint, evaluations, results, { skipDecay: true, skipHooks: true });

    // Hooks fire before the RETRO→CLEANUP phase event; the job summary is real disk
    // truth now, asserted by existence rather than a monkey-patched writeFileSync
    // (redefining node:fs exports is impossible against the real module — by design).
    expect(callOrder.indexOf('postFinalizeHooks')).toBeGreaterThanOrEqual(0);
    expect(callOrder.indexOf('retroCleanupEvent')).toBeGreaterThan(callOrder.indexOf('postFinalizeHooks'));
  });

  it('metrics passed to hooks match calculated sprint metrics', async () => {
    const sprint = makeSprint('sprint-143');
    const { evaluations, results } = settledFixture(sprint);

    await finalizeSprint(PROJECT_ROOT, sprint, evaluations, results, { skipDecay: true, skipHooks: true });

    const callArgs = mockRunPostFinalizeHooks.mock.calls[0][0] as {
      metrics: { totalTasks: number; completedTasks: number };
    };
    expect(callArgs.metrics.totalTasks).toBe(1);
    expect(callArgs.metrics.completedTasks).toBe(1);
  });
});

// ─── CORE-UNIFORMITY (slice 2): runBudgetedDecay — mode-independent helper ───
describe('runBudgetedDecay (mode-independent decay helper)', () => {
  beforeEach(() => {
    // mockClear (not reset) keeps the module-level default implementation intact so
    // other describe blocks are unaffected; per-test behavior uses *Once variants.
    vi.mocked(mockRunDecay).mockClear();
    vi.mocked(mockAuditBrainBudget).mockClear();
  });

  it('is callable with primitives only — no sprint object needed (mode-independent)', () => {
    vi.mocked(mockAuditBrainBudget).mockReturnValueOnce({ status: 'OK', decayableLines: 0, permanentLines: 0, totalLines: 0 });

    // Invoked exactly the way the autonomous per-item hook calls it.
    expect(() => runBudgetedDecay(PROJECT_ROOT, 'sprint-42', { memoryBudget: 900, decaySprints: 20 })).not.toThrow();

    expect(vi.mocked(mockAuditBrainBudget)).toHaveBeenCalledWith(PROJECT_ROOT, 900);
    expect(vi.mocked(mockRunDecay)).toHaveBeenCalledWith(
      PROJECT_ROOT, 'sprint-42', { memoryBudget: 900, decaySprints: 20 },
    );
  });

  it('forces decay when the budget is OVER, normal decay when OK', () => {
    // OVER → force:true
    vi.mocked(mockAuditBrainBudget).mockReturnValueOnce({ status: 'OVER', decayableLines: 1200, permanentLines: 0, totalLines: 1200 });
    runBudgetedDecay(PROJECT_ROOT, 'sprint-7', { memoryBudget: 900, decaySprints: 20 });
    expect(vi.mocked(mockRunDecay)).toHaveBeenLastCalledWith(
      PROJECT_ROOT, 'sprint-7', { force: true, memoryBudget: 900, decaySprints: 20 },
    );

    // OK → no force
    vi.mocked(mockAuditBrainBudget).mockReturnValueOnce({ status: 'OK', decayableLines: 10, permanentLines: 0, totalLines: 10 });
    runBudgetedDecay(PROJECT_ROOT, 'sprint-8', { memoryBudget: 900, decaySprints: 20 });
    expect(vi.mocked(mockRunDecay)).toHaveBeenLastCalledWith(
      PROJECT_ROOT, 'sprint-8', { memoryBudget: 900, decaySprints: 20 },
    );
  });

  it('never throws — an auditBrainBudget failure is swallowed (fail-safe)', () => {
    vi.mocked(mockAuditBrainBudget).mockImplementationOnce(() => { throw new Error('audit boom'); });
    expect(() => runBudgetedDecay(PROJECT_ROOT, 'sprint-9')).not.toThrow();
    expect(vi.mocked(mockRunDecay)).not.toHaveBeenCalled();
  });
});
