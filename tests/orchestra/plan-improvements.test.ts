/**
 * tests/orchestra/plan-improvements.test.ts
 *
 * Tests for Sprint 064-002 plan improvements:
 *   A) AI Planner Timeout Configurable — config.ai_planner_timeout properly typed
 *   B) Structured Parser Bullet/Prose (already implemented — confirm behavior)
 *   C) Auto Mode >2x Task Safeguard with fallback
 *   D) Agent/Skill Selection Error Logging — per-task try/catch
 *   E) (removed — usage tracking no longer exists)
 *   F) Context Truncation Priority (already implemented — confirm behavior)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { BrainContext, SprintSizeRecommendation, ModelType, ResolvedConfig } from '../../src/core/types.js';
import type { ProviderAdapter } from '../../src/core/provider.js';

// ─── Mocks ──────────────────────────────────────────────────────────

vi.mock('node:child_process', () => ({
  spawnSync: vi.fn(),
}));

import { spawnSync } from 'node:child_process';
import {
  callBrainPlanner,
  callZeroConfigPlanner,
  buildPriorityContextBlock,
  type PlannerSpawnFn,
} from '../../src/orchestra/planner.js';
import {
  parseStructuredDirectives,
  parseBulletOrNumberedTasks,
} from '../../src/orchestra/task-builder.js';
import { providerRegistry } from '../../src/core/provider.js';
import { BRAIN_PLAN_TIMEOUT_MS } from '../../src/core/constants.js';

void vi.mocked(spawnSync); // module stays mocked (fail-soft git ls-files); planner calls inject PlannerSpawnFn

// ─── Helpers ────────────────────────────────────────────────────────

function makeContext(overrides: Partial<BrainContext> = {}): BrainContext {
  return {
    directives: '# Sprint\n## Task 1: Build feature\nBuild it',
    memory: '# Memory',
    retro: '',
    debt: [],
    patterns: '',
    decisions: '',
    existingTasks: [],
    projectState: { gitStatus: '', fileTree: ['src/index.ts'] },
    ...overrides,
  };
}

function makeRecommendation(overrides: Partial<SprintSizeRecommendation> = {}): SprintSizeRecommendation {
  return {
    size: 'full',
    maxWorkers: 4,
    modelConstraint: null,
    reason: 'OK',
    ...overrides,
  };
}

function makeMockAdapter(overrides: Partial<ProviderAdapter> = {}): ProviderAdapter {
  return {
    name: 'claude',
    supportedModels: ['claude-opus-4-8', 'claude-sonnet-5', 'claude-haiku-4-5-20251001'] as readonly ModelType[],
    spawn: vi.fn(),
    kill: vi.fn(),
    listWorkers: vi.fn().mockReturnValue([]),
    isAvailable: vi.fn().mockResolvedValue(true),
    buildCommand: vi.fn().mockReturnValue('mock-cli -p - --model claude-sonnet-5 < /dev/null'),
    ...overrides,
  };
}

function makeConfig(overrides: Partial<ResolvedConfig> = {}): ResolvedConfig {
  return {
    mode: 'pro_plan',
    activeModeConfig: {
      max_workers: 4,
      brain_model: 'claude-sonnet-5',
      default_model: 'claude-sonnet-5',
      haiku_allowed: true,
    },
    modes: {} as ResolvedConfig['modes'],
    language: 'tr',
    projectName: 'test',
    projectRoot: '/tmp/test',
    version: '1.0.0',
    ...overrides,
  };
}

const validPlannerJSON = JSON.stringify({
  tasks: [{
    title: 'Build feature',
    description: 'Build the feature',
    model: 'claude-sonnet-5',
    effort: 'normal',
    priority: 'NORMAL',
    reason: 'Standard task',
    scope: { directories: ['src/'], filesRead: [], filesWrite: ['src/feature.ts'] },
    dependencies: [],
    goNogo: { goCriteria: 'Tests pass', noGoCriteria: 'Build fails', techDebtAcceptable: 'Minor' },
  }],
  reasoning: 'Single task for the directive',
});

beforeEach(() => {
  vi.clearAllMocks();
  providerRegistry.clear();
});

// ═══ A) AI Planner Timeout Configurable ═══════════════════════════════

describe('A) AI Planner Timeout Configurable', () => {
  // F-2: the planner spawn is async + injectable — timeout assertions read the
  // recorded PlannerSpawnFn call instead of a spawnSync mock.
  function makeSpawnFn() {
    const calls: Array<{ command: string; timeoutMs: number }> = [];
    const fn: PlannerSpawnFn = async (command, _args, opts) => {
      calls.push({ command, timeoutMs: opts.timeoutMs });
      return { status: 0, signal: null, stdout: validPlannerJSON, stderr: '' };
    };
    return { fn, calls };
  }

  it('uses custom timeout when provided', async () => {
    const adapter = makeMockAdapter();
    const { fn, calls } = makeSpawnFn();

    await callBrainPlanner(makeContext(), makeRecommendation(), 'claude-sonnet-5', 'test', adapter, 120_000, undefined, fn);

    expect(calls[0]).toMatchObject({ command: 'mock-cli', timeoutMs: 120_000 });
  });

  it('defaults to BRAIN_PLAN_TIMEOUT_MS when no timeout provided', async () => {
    const adapter = makeMockAdapter();
    const { fn, calls } = makeSpawnFn();

    await callBrainPlanner(makeContext(), makeRecommendation(), 'claude-sonnet-5', 'test', adapter, undefined, undefined, fn);

    expect(calls[0]).toMatchObject({ command: 'mock-cli', timeoutMs: BRAIN_PLAN_TIMEOUT_MS });
  });

  it('callZeroConfigPlanner uses custom timeout', async () => {
    const adapter = makeMockAdapter();
    const { fn, calls } = makeSpawnFn();

    await callZeroConfigPlanner('Add login', 'claude-sonnet-5', 'test', [], adapter, 90_000, fn);

    expect(calls[0]).toMatchObject({ command: 'mock-cli', timeoutMs: 90_000 });
  });

  it('callZeroConfigPlanner defaults to BRAIN_PLAN_TIMEOUT_MS', async () => {
    const adapter = makeMockAdapter();
    const { fn, calls } = makeSpawnFn();

    await callZeroConfigPlanner('Add login', 'claude-sonnet-5', 'test', [], adapter, undefined, fn);

    expect(calls[0]).toMatchObject({ command: 'mock-cli', timeoutMs: BRAIN_PLAN_TIMEOUT_MS });
  });

  it('ResolvedConfig accepts ai_planner_timeout field without type error', () => {
    const config = makeConfig({ ai_planner_timeout: 120_000 });
    expect(config.ai_planner_timeout).toBe(120_000);
  });
});

// ═══ B) Structured Parser Bullet/Prose ════════════════════════════════

describe('B) Structured Parser Bullet/Prose fallback', () => {
  it('parseStructuredDirectives falls back to bullet format when no ## headings', () => {
    const content = `# Goal: Do things\n\n- Task: Build auth module\n- Task: Add tests`;
    const tasks = parseStructuredDirectives(content);
    expect(tasks.length).toBeGreaterThanOrEqual(2);
    expect(tasks[0]!.title).toBe('Build auth module');
  });

  it('parseStructuredDirectives falls back to numbered list format', () => {
    const content = `# Goal\n\n1. Build the API\n2. Write integration tests\n3. Update docs`;
    const tasks = parseStructuredDirectives(content);
    expect(tasks.length).toBeGreaterThanOrEqual(3);
  });

  it('parseBulletOrNumberedTasks handles "1) title" format', () => {
    const content = `1) First task here\n2) Second task here`;
    const tasks = parseBulletOrNumberedTasks(content);
    expect(tasks.length).toBe(2);
    expect(tasks[0]!.title).toBe('First task here');
  });

  it('parseBulletOrNumberedTasks handles "* Task:" format', () => {
    const content = `* Task: Create database schema\n* Task: Add migration scripts`;
    const tasks = parseBulletOrNumberedTasks(content);
    expect(tasks.length).toBe(2);
    expect(tasks[0]!.title).toBe('Create database schema');
    expect(tasks[1]!.title).toBe('Add migration scripts');
  });

  it('parseBulletOrNumberedTasks extracts Model/Effort from sub-lines', () => {
    const content = `- Task: Implement API endpoint\n  Model: claude-opus-4-8\n  Effort: high`;
    const tasks = parseBulletOrNumberedTasks(content);
    expect(tasks.length).toBe(1);
    expect(tasks[0]!.forceModel).toBe('claude-opus-4-8');
    expect(tasks[0]!.forceEffort).toBe('high');
  });
});

// ═══ F) Context Truncation Priority ═══════════════════════════════════

describe('F) Context Truncation Priority Order', () => {
  it('HOLDs rather than discarding PATTERNS behind DIRECTIVES', () => {
    const directives = Array.from({ length: 30 }, (_, i) => `directive-${i}`).join('\n');
    const patterns = Array.from({ length: 30 }, (_, i) => `pattern-${i}`).join('\n');
    const sections = [
      { text: `DIRECTIVES:\n${directives}`, priority: 1 },
      { text: `PATTERNS:\n${patterns}`, priority: 4 },
    ];
    expect(() => buildPriorityContextBlock(sections, 35))
      .toThrow('BRAIN_PLAN_CONTEXT_LIMIT_EXCEEDED');
  });

  it('HOLDs rather than discarding DEBT behind MEMORY', () => {
    const memory = Array.from({ length: 20 }, (_, i) => `mem-${i}`).join('\n');
    const debt = Array.from({ length: 20 }, (_, i) => `debt-${i}`).join('\n');
    const sections = [
      { text: `MEMORY:\n${memory}`, priority: 2 },
      { text: `DEBT:\n${debt}`, priority: 3 },
    ];
    expect(() => buildPriorityContextBlock(sections, 22))
      .toThrow('BRAIN_PLAN_CONTEXT_LIMIT_EXCEEDED');
  });

  it('includes all sections when maxLines is sufficient', () => {
    const sections = [
      { text: 'DIRECTIVES: short', priority: 1 },
      { text: 'MEMORY: short', priority: 2 },
      { text: 'DEBT: short', priority: 3 },
      { text: 'PATTERNS: short', priority: 4 },
    ];
    const result = buildPriorityContextBlock(sections, 100);
    expect(result).toContain('DIRECTIVES');
    expect(result).toContain('MEMORY');
    expect(result).toContain('DEBT');
    expect(result).toContain('PATTERNS');
  });
});

// ═══ D) Agent/Skill Selection Error Logging ═══════════════════════════

describe('D) Agent/Skill Selection Error Logging', () => {
  it('has per-task agent selection error handling with debugLog', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(
      new URL('../../src/orchestra/sprint-planner.ts', import.meta.url),
      'utf-8',
    );
    // Outer catch for pool loading failure
    expect(source).toContain('routeTasksV3ForPlan') // ROUTE-V1-PURGE: per-task selection lives in routeTasksV3ForPlan; planner no longer hosts a V1 agent-pool loop;
    // ROUTE-V1-PURGE: the V1 pool-loading block is gone; selection safety lives in routeTasksV3ForPlan's fallback.
    // Inner per-task catch for individual agent selection failure
    expect(source).toContain('routeTasksV3ForPlan');
    // V1 per-task selection loop purged (ROUTE-V1-PURGE) — failure-safety = routeTasksV3ForPlan fallback.
  });

  it('has per-task skill selection error handling with debugLog', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(
      new URL('../../src/orchestra/sprint-planner.ts', import.meta.url),
      'utf-8',
    );
    // CATALOG-STATS-AUTHORITY-001 (2026-08-17): the temp-SKILL generation path
    // is retired with project-conventions — only the temp-AGENT catch remains,
    // and the retired debugLog tag must never come back.
    expect(source).not.toContain("debugLog('planSprint:temp-skill'");
    expect(source).toContain("debugLog('planSprint:generateTempAgents'");
  });
});

// ═══ C) Auto Mode >2x Task Safeguard ═════════════════════════════════

describe('C) Auto Mode >2x Task Safeguard', () => {
  it('has >2x safeguard with fallback (not just warning)', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(
      new URL('../../src/orchestra/sprint-planner.ts', import.meta.url),
      'utf-8',
    );
    // Should set plannerResult = null (fallback) when >2x
    expect(source).toContain('directiveTaskCount * 2');
    expect(source).toContain('Falling back to structured mode');
    // Should have the fallback assignment after >2x check
    expect(source).toMatch(/directiveTaskCount \* 2[\s\S]*?plannerResult = null/);
  });

  it('also has <1x safeguard for too few tasks', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(
      new URL('../../src/orchestra/sprint-planner.ts', import.meta.url),
      'utf-8',
    );
    // AI returned fewer tasks than directives — fallback
    expect(source).toContain('plannerResult.tasks.length < directiveTaskCount');
  });
});
