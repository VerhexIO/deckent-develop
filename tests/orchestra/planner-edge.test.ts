import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildPlanPrompt, parsePlannerResponse, callBrainPlanner, type PlannerSpawnFn, type PlannerSpawnOutcome } from '../../src/orchestra/planner.js';
import type { BrainContext, SprintSizeRecommendation, ModelType } from '../../src/core/types.js';
import type { ProviderAdapter } from '../../src/core/provider.js';

// ─── Mock child_process ───────────────────────────────────────────────────
vi.mock('node:child_process', () => ({
  spawnSync: vi.fn(),
}));

import { spawnSync } from 'node:child_process';

// ─── Mock ProviderAdapter ─────────────────────────────────────────────────
function makeMockAdapter(): ProviderAdapter {
  return {
    name: 'claude',
    supportedModels: ['claude-opus-4-8', 'claude-sonnet-5', 'claude-haiku-4-5-20251001'] as readonly ModelType[],
    spawn: vi.fn(),
    kill: vi.fn(),
    listWorkers: vi.fn().mockReturnValue([]),
    isAvailable: vi.fn().mockResolvedValue(true),
    buildCommand: vi.fn().mockReturnValue('claude --model sonnet /dev/null'),
    buildPlannerCommand: (prompt: string, model: ModelType) => ({
      command: 'claude',
      args: ['-p', prompt, '--model', model, '--output-format', 'json'],
    }),
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────

function makeContext(overrides: Partial<BrainContext> = {}): BrainContext {
  return {
    directives: 'Do task A\nDo task B',
    memory: 'Key learning: X',
    retro: 'Last sprint was good',
    debt: [],
    patterns: 'Pattern: avoid Y',
    decisions: 'Decision: use Z',
    existingTasks: [],
    projectState: {
      gitStatus: 'M src/foo.ts',
      fileTree: ['src/foo.ts', 'src/bar.ts'],
    },
    ...overrides,
  };
}

function makeRecommendation(overrides: Partial<SprintSizeRecommendation> = {}): SprintSizeRecommendation {
  return {
    size: 'full',
    maxWorkers: 4,
    modelConstraint: null,
    reason: 'Normal usage',
    ...overrides,
  };
}

function makeValidPlannerJSON(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    tasks: [
      {
        title: 'Task 1',
        description: 'Do something',
        model: 'claude-sonnet-5',
        effort: 'normal',
        priority: 'NORMAL',
        reason: 'Standard work',
        scope: { directories: ['src/'], filesRead: [], filesWrite: ['src/foo.ts'] },
        dependencies: [],
        goNogo: {
          goCriteria: 'Tests pass',
          noGoCriteria: 'Tests fail',
          techDebtAcceptable: 'Minor issues',
        },
      },
    ],
    reasoning: 'Plan rationale',
    ...overrides,
  });
}

// ─── buildPlanPrompt ─────────────────────────────────────────────────────

describe('buildPlanPrompt', () => {
  it('includes project name at the top', () => {
    const ctx = makeContext();
    const rec = makeRecommendation();
    const prompt = buildPlanPrompt(ctx, rec, 'my-project');
    expect(prompt).toContain('Project: my-project');
  });

  it('includes directives section when provided', () => {
    const ctx = makeContext({ directives: 'Build feature X' });
    const prompt = buildPlanPrompt(ctx, makeRecommendation(), 'proj');
    expect(prompt).toContain('DIRECTIVES:');
    expect(prompt).toContain('Build feature X');
  });

  it('includes memory section when provided', () => {
    const ctx = makeContext({ memory: 'Important learning' });
    const prompt = buildPlanPrompt(ctx, makeRecommendation(), 'proj');
    expect(prompt).toContain('MEMORY:');
    expect(prompt).toContain('Important learning');
  });

  it('includes retro section when provided', () => {
    const ctx = makeContext({ retro: 'Sprint went well' });
    const prompt = buildPlanPrompt(ctx, makeRecommendation(), 'proj');
    expect(prompt).toContain('RETRO:');
    expect(prompt).toContain('Sprint went well');
  });

  it('includes patterns and decisions when provided', () => {
    const ctx = makeContext({ patterns: 'use-pattern', decisions: 'adr-001' });
    const prompt = buildPlanPrompt(ctx, makeRecommendation(), 'proj');
    expect(prompt).toContain('PATTERNS:');
    expect(prompt).toContain('use-pattern');
    expect(prompt).toContain('DECISIONS:');
    expect(prompt).toContain('adr-001');
  });

  it('omits CRITICAL DEBT section when no critical unresolved debt', () => {
    const ctx = makeContext({ debt: [] });
    const prompt = buildPlanPrompt(ctx, makeRecommendation(), 'proj');
    expect(prompt).not.toContain('CRITICAL DEBT:');
  });

  it('includes CRITICAL DEBT section for unresolved critical debt', () => {
    const ctx = makeContext({
      debt: [
        {
          id: 'D-001',
          description: 'Critical issue',
          originTaskId: 'T-001',
          originSprintId: 'sprint-001',
          priority: 'CRITICAL' as const,
          sprintsOpen: 2,
          resolved: false,
          createdAt: '2026-01-01',
        },
      ],
    });
    const prompt = buildPlanPrompt(ctx, makeRecommendation(), 'proj');
    expect(prompt).toContain('CRITICAL DEBT:');
    expect(prompt).toContain('D-001: Critical issue');
  });

  it('omits resolved critical debt from CRITICAL DEBT section', () => {
    const ctx = makeContext({
      debt: [
        {
          id: 'D-002',
          description: 'Old critical issue',
          originTaskId: 'T-002',
          originSprintId: 'sprint-001',
          priority: 'CRITICAL' as const,
          sprintsOpen: 3,
          resolved: true,
          resolvedInSprintId: 'sprint-002',
          createdAt: '2026-01-01',
        },
      ],
    });
    const prompt = buildPlanPrompt(ctx, makeRecommendation(), 'proj');
    expect(prompt).not.toContain('CRITICAL DEBT:');
  });

  it('includes maxWorkers from recommendation in prompt', () => {
    const rec = makeRecommendation({ maxWorkers: 6 });
    const prompt = buildPlanPrompt(makeContext(), rec, 'proj');
    expect(prompt).toContain('6');
  });

  it('includes file tree when present', () => {
    const ctx = makeContext({
      projectState: { gitStatus: '', fileTree: ['src/a.ts', 'src/b.ts'] },
    });
    const prompt = buildPlanPrompt(ctx, makeRecommendation(), 'proj');
    expect(prompt).toContain('FILE TREE');
    expect(prompt).toContain('src/a.ts');
  });

  it('limits file tree to first 100 entries', () => {
    const bigTree = Array.from({ length: 200 }, (_, i) => `src/file${i}.ts`);
    const ctx = makeContext({
      projectState: { gitStatus: '', fileTree: bigTree },
    });
    const prompt = buildPlanPrompt(ctx, makeRecommendation(), 'proj');
    expect(prompt).toContain('src/file99.ts');
    expect(prompt).not.toContain('src/file100.ts');
  });

  it('preserves complete directive authority beyond the removed outer line cap', () => {
    const longDirectives = Array.from({ length: 300 }, (_, i) => `line ${i}`).join('\n');
    const ctx = makeContext({ directives: longDirectives });
    const prompt = buildPlanPrompt(ctx, makeRecommendation(), 'proj');
    expect(prompt).toContain('line 0');
    expect(prompt).toContain('line 299');
  });

  it('omits file tree section when fileTree is empty', () => {
    const ctx = makeContext({ projectState: { gitStatus: '', fileTree: [] } });
    const prompt = buildPlanPrompt(ctx, makeRecommendation(), 'proj');
    expect(prompt).not.toContain('FILE TREE');
  });

  it('omits empty optional sections when context fields are empty string', () => {
    const ctx = makeContext({ memory: '', retro: '', patterns: '', decisions: '' });
    const prompt = buildPlanPrompt(ctx, makeRecommendation(), 'proj');
    expect(prompt).not.toContain('MEMORY:');
    expect(prompt).not.toContain('RETRO:');
    expect(prompt).not.toContain('PATTERNS:');
    expect(prompt).not.toContain('DECISIONS:');
  });

  it('includes output format JSON template in prompt', () => {
    const prompt = buildPlanPrompt(makeContext(), makeRecommendation(), 'proj');
    expect(prompt).toContain('"tasks"');
    expect(prompt).toContain('"reasoning"');
  });
});

// ─── parsePlannerResponse ─────────────────────────────────────────────────

describe('parsePlannerResponse', () => {
  it('parses valid JSON with one task', () => {
    const raw = makeValidPlannerJSON();
    const result = parsePlannerResponse(raw);
    expect(result).not.toBeNull();
    expect(result!.tasks).toHaveLength(1);
    expect(result!.tasks[0].title).toBe('Task 1');
    expect(result!.reasoning).toBe('Plan rationale');
  });

  it('parses JSON wrapped in ```json code fence', () => {
    const inner = makeValidPlannerJSON();
    const raw = '```json\n' + inner + '\n```';
    const result = parsePlannerResponse(raw);
    expect(result).not.toBeNull();
    expect(result!.tasks).toHaveLength(1);
  });

  it('parses JSON wrapped in ``` code fence without language tag', () => {
    const inner = makeValidPlannerJSON();
    const raw = '```\n' + inner + '\n```';
    const result = parsePlannerResponse(raw);
    expect(result).not.toBeNull();
  });

  it('returns null for invalid JSON string', () => {
    const result = parsePlannerResponse('not-json-at-all');
    expect(result).toBeNull();
  });

  it('returns null for empty string', () => {
    const result = parsePlannerResponse('');
    expect(result).toBeNull();
  });

  it('returns null when tasks array is empty (min(1) constraint)', () => {
    const raw = JSON.stringify({ tasks: [], reasoning: 'empty' });
    const result = parsePlannerResponse(raw);
    expect(result).toBeNull();
  });

  it('returns null when tasks field is missing', () => {
    const raw = JSON.stringify({ reasoning: 'no tasks here' });
    const result = parsePlannerResponse(raw);
    expect(result).toBeNull();
  });

  it('returns null when reasoning field is missing', () => {
    const raw = JSON.stringify({
      tasks: [
        {
          title: 'T',
          description: 'D',
          model: 'claude-sonnet-5',
          effort: 'normal',
          priority: 'NORMAL',
          reason: 'r',
          scope: { directories: [], filesRead: [], filesWrite: [] },
          dependencies: [],
          goNogo: { goCriteria: 'g', noGoCriteria: 'n', techDebtAcceptable: 't' },
        },
      ],
    });
    const result = parsePlannerResponse(raw);
    expect(result).toBeNull();
  });

  it('returns null when a task has invalid model value', () => {
    const raw = makeValidPlannerJSON({
      tasks: [
        {
          title: 'Task 1',
          description: 'Desc',
          model: 'gpt-4',
          effort: 'normal',
          priority: 'NORMAL',
          reason: 'r',
          scope: { directories: [], filesRead: [], filesWrite: [] },
          dependencies: [],
          goNogo: { goCriteria: 'g', noGoCriteria: 'n', techDebtAcceptable: 't' },
        },
      ],
    });
    const result = parsePlannerResponse(raw);
    expect(result).toBeNull();
  });

  it('returns null when a task has invalid effort value', () => {
    const raw = makeValidPlannerJSON({
      tasks: [
        {
          title: 'Task 1',
          description: 'Desc',
          model: 'claude-sonnet-5',
          effort: 'extreme',
          priority: 'NORMAL',
          reason: 'r',
          scope: { directories: [], filesRead: [], filesWrite: [] },
          dependencies: [],
          goNogo: { goCriteria: 'g', noGoCriteria: 'n', techDebtAcceptable: 't' },
        },
      ],
    });
    const result = parsePlannerResponse(raw);
    expect(result).toBeNull();
  });

  it('returns null when a task has invalid priority value', () => {
    const raw = makeValidPlannerJSON({
      tasks: [
        {
          title: 'Task 1',
          description: 'Desc',
          model: 'claude-sonnet-5',
          effort: 'normal',
          priority: 'MEDIUM',
          reason: 'r',
          scope: { directories: [], filesRead: [], filesWrite: [] },
          dependencies: [],
          goNogo: { goCriteria: 'g', noGoCriteria: 'n', techDebtAcceptable: 't' },
        },
      ],
    });
    const result = parsePlannerResponse(raw);
    expect(result).toBeNull();
  });

  it('returns null when title is empty string', () => {
    const raw = makeValidPlannerJSON({
      tasks: [
        {
          title: '',
          description: 'Desc',
          model: 'claude-sonnet-5',
          effort: 'normal',
          priority: 'NORMAL',
          reason: 'r',
          scope: { directories: [], filesRead: [], filesWrite: [] },
          dependencies: [],
          goNogo: { goCriteria: 'g', noGoCriteria: 'n', techDebtAcceptable: 't' },
        },
      ],
    });
    const result = parsePlannerResponse(raw);
    expect(result).toBeNull();
  });

  it('returns null when description is empty string', () => {
    const raw = makeValidPlannerJSON({
      tasks: [
        {
          title: 'T',
          description: '',
          model: 'claude-sonnet-5',
          effort: 'normal',
          priority: 'NORMAL',
          reason: 'r',
          scope: { directories: [], filesRead: [], filesWrite: [] },
          dependencies: [],
          goNogo: { goCriteria: 'g', noGoCriteria: 'n', techDebtAcceptable: 't' },
        },
      ],
    });
    const result = parsePlannerResponse(raw);
    expect(result).toBeNull();
  });

  it('parses multiple tasks correctly', () => {
    const task = {
      title: 'Task',
      description: 'Desc',
      model: 'claude-sonnet-5',
      effort: 'normal',
      priority: 'NORMAL',
      reason: 'r',
      scope: { directories: [], filesRead: [], filesWrite: [] },
      dependencies: [],
      goNogo: { goCriteria: 'g', noGoCriteria: 'n', techDebtAcceptable: 't' },
    };
    const raw = JSON.stringify({
      tasks: [
        { ...task, title: 'Task A' },
        { ...task, title: 'Task B' },
        { ...task, title: 'Task C' },
      ],
      reasoning: 'Three tasks',
    });
    const result = parsePlannerResponse(raw);
    expect(result).not.toBeNull();
    expect(result!.tasks).toHaveLength(3);
    expect(result!.tasks[1].title).toBe('Task B');
  });

  it('parses all valid model types', () => {
    for (const model of ['claude-opus-4-8', 'claude-sonnet-5', 'claude-haiku-4-5-20251001']) {
      const raw = makeValidPlannerJSON({
        tasks: [
          {
            title: 'T',
            description: 'D',
            model,
            effort: 'normal',
            priority: 'NORMAL',
            reason: 'r',
            scope: { directories: [], filesRead: [], filesWrite: [] },
            dependencies: [],
            goNogo: { goCriteria: 'g', noGoCriteria: 'n', techDebtAcceptable: 't' },
          },
        ],
      });
      const result = parsePlannerResponse(raw);
      expect(result).not.toBeNull();
      expect(result!.tasks[0].model).toBe(model);
    }
  });

  it('parses all valid priority values', () => {
    for (const priority of ['CRITICAL', 'HIGH', 'NORMAL', 'LOW']) {
      const raw = makeValidPlannerJSON({
        tasks: [
          {
            title: 'T',
            description: 'D',
            model: 'claude-sonnet-5',
            effort: 'normal',
            priority,
            reason: 'r',
            scope: { directories: [], filesRead: [], filesWrite: [] },
            dependencies: [],
            goNogo: { goCriteria: 'g', noGoCriteria: 'n', techDebtAcceptable: 't' },
          },
        ],
      });
      const result = parsePlannerResponse(raw);
      expect(result).not.toBeNull();
    }
  });

  it('returns null when goNogo fields are missing', () => {
    const raw = JSON.stringify({
      tasks: [
        {
          title: 'T',
          description: 'D',
          model: 'claude-sonnet-5',
          effort: 'normal',
          priority: 'NORMAL',
          reason: 'r',
          scope: { directories: [], filesRead: [], filesWrite: [] },
          dependencies: [],
          goNogo: { goCriteria: 'g' }, // missing noGoCriteria, techDebtAcceptable
        },
      ],
      reasoning: 'r',
    });
    const result = parsePlannerResponse(raw);
    expect(result).toBeNull();
  });

  it('returns null when scope is missing directories field', () => {
    const raw = JSON.stringify({
      tasks: [
        {
          title: 'T',
          description: 'D',
          model: 'claude-sonnet-5',
          effort: 'normal',
          priority: 'NORMAL',
          reason: 'r',
          scope: { filesRead: [], filesWrite: [] }, // missing directories
          dependencies: [],
          goNogo: { goCriteria: 'g', noGoCriteria: 'n', techDebtAcceptable: 't' },
        },
      ],
      reasoning: 'r',
    });
    const result = parsePlannerResponse(raw);
    expect(result).toBeNull();
  });

  it('ignores extra fields on valid input (Zod passthrough not enabled)', () => {
    const raw = JSON.stringify({
      tasks: [
        {
          title: 'T',
          description: 'D',
          model: 'claude-sonnet-5',
          effort: 'normal',
          priority: 'NORMAL',
          reason: 'r',
          scope: { directories: [], filesRead: [], filesWrite: [] },
          dependencies: [],
          goNogo: { goCriteria: 'g', noGoCriteria: 'n', techDebtAcceptable: 't' },
          extraField: 'should be ignored',
        },
      ],
      reasoning: 'r',
      extraTopLevel: 42,
    });
    const result = parsePlannerResponse(raw);
    // Zod by default strips extra fields and returns success
    expect(result).not.toBeNull();
    expect(result!.tasks[0]).not.toHaveProperty('extraField');
  });
});

// ─── callBrainPlanner ─────────────────────────────────────────────────────

describe('callBrainPlanner', () => {
  const adapter = makeMockAdapter();

  // F-2: the planner spawn is async + injectable (PlannerSpawnFn) — the
  // spawnSync freeze-class died. Each fake returns a canned outcome and
  // records its calls.
  function makeSpawnFn(outcome: Partial<PlannerSpawnOutcome> = {}) {
    const calls: Array<{ command: string; args: string[]; timeoutMs: number }> = [];
    const fn: PlannerSpawnFn = async (command, args, opts) => {
      calls.push({ command, args: [...args], timeoutMs: opts.timeoutMs });
      return { status: 0, signal: null, stdout: makeValidPlannerJSON(), stderr: '', ...outcome };
    };
    return { fn, calls };
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null when the spawn exits non-zero', async () => {
    const { fn } = makeSpawnFn({ status: 1, stdout: '', stderr: 'error occurred' });
    await expect(callBrainPlanner(makeContext(), makeRecommendation(), 'claude-sonnet-5', 'proj', adapter, undefined, undefined, fn)).resolves.toBeNull();
  });

  it('returns null when stdout is empty', async () => {
    const { fn } = makeSpawnFn({ status: 0, stdout: '' });
    await expect(callBrainPlanner(makeContext(), makeRecommendation(), 'claude-sonnet-5', 'proj', adapter, undefined, undefined, fn)).resolves.toBeNull();
  });

  it('returns null when stdout is null-ish', async () => {
    const { fn } = makeSpawnFn({ status: 0, stdout: null as unknown as string });
    await expect(callBrainPlanner(makeContext(), makeRecommendation(), 'claude-sonnet-5', 'proj', adapter, undefined, undefined, fn)).resolves.toBeNull();
  });

  it('returns null on timeout (status null, signal SIGTERM)', async () => {
    const { fn } = makeSpawnFn({ status: null, stdout: '', signal: 'SIGTERM' });
    await expect(callBrainPlanner(makeContext(), makeRecommendation(), 'claude-opus-4-8', 'proj', adapter, undefined, undefined, fn)).resolves.toBeNull();
  });

  it('returns null when stdout is malformed JSON', async () => {
    const { fn } = makeSpawnFn({ status: 0, stdout: 'not valid json' });
    await expect(callBrainPlanner(makeContext(), makeRecommendation(), 'claude-sonnet-5', 'proj', adapter, undefined, undefined, fn)).resolves.toBeNull();
  });

  it('returns null when stdout has valid JSON but fails Zod validation', async () => {
    const { fn } = makeSpawnFn({ status: 0, stdout: JSON.stringify({ tasks: [], reasoning: 'empty' }) });
    await expect(callBrainPlanner(makeContext(), makeRecommendation(), 'claude-sonnet-5', 'proj', adapter, undefined, undefined, fn)).resolves.toBeNull();
  });

  it('returns PlannerResult on valid stdout', async () => {
    const { fn } = makeSpawnFn();
    const result = await callBrainPlanner(makeContext(), makeRecommendation(), 'claude-sonnet-5', 'proj', adapter, undefined, undefined, fn);
    expect(result).not.toBeNull();
    expect(result!.tasks).toHaveLength(1);
  });

  it('spawns the correct claude command', async () => {
    const { fn, calls } = makeSpawnFn();
    await callBrainPlanner(makeContext(), makeRecommendation(), 'claude-opus-4-8', 'proj', adapter, undefined, undefined, fn);
    expect(calls[0]!.command).toBe('claude');
    expect(calls[0]!.args).toEqual(expect.arrayContaining(['-p', expect.any(String), '--model', 'claude-opus-4-8']));
  });

  it('spawns with the output-format json flag', async () => {
    const { fn, calls } = makeSpawnFn();
    await callBrainPlanner(makeContext(), makeRecommendation(), 'claude-sonnet-5', 'proj', adapter, undefined, undefined, fn);
    expect(calls[0]!.args).toEqual(expect.arrayContaining(['--output-format', 'json']));
  });

  it('passes a timeout to the spawn', async () => {
    const { fn, calls } = makeSpawnFn();
    await callBrainPlanner(makeContext(), makeRecommendation(), 'claude-haiku-4-5-20251001', 'proj', adapter, undefined, undefined, fn);
    expect(calls[0]!.timeoutMs).toEqual(expect.any(Number));
  });
});

// ─── Zod Schema Edge Cases ────────────────────────────────────────────────

describe('Zod Schema validation via parsePlannerResponse', () => {
  it('accepts haiku as valid model', () => {
    const raw = makeValidPlannerJSON({
      tasks: [
        {
          title: 'T',
          description: 'D',
          model: 'claude-haiku-4-5-20251001',
          effort: 'low',
          priority: 'LOW',
          reason: 'r',
          scope: { directories: [], filesRead: [], filesWrite: [] },
          dependencies: [],
          goNogo: { goCriteria: 'g', noGoCriteria: 'n', techDebtAcceptable: 't' },
        },
      ],
    });
    const result = parsePlannerResponse(raw);
    expect(result).not.toBeNull();
    expect(result!.tasks[0].model).toBe('claude-haiku-4-5-20251001');
  });

  it('rejects when dependencies is not an array', () => {
    const raw = JSON.stringify({
      tasks: [
        {
          title: 'T',
          description: 'D',
          model: 'claude-sonnet-5',
          effort: 'normal',
          priority: 'NORMAL',
          reason: 'r',
          scope: { directories: [], filesRead: [], filesWrite: [] },
          dependencies: 'not-an-array',
          goNogo: { goCriteria: 'g', noGoCriteria: 'n', techDebtAcceptable: 't' },
        },
      ],
      reasoning: 'r',
    });
    const result = parsePlannerResponse(raw);
    expect(result).toBeNull();
  });

  it('rejects when scope.directories is not an array', () => {
    const raw = JSON.stringify({
      tasks: [
        {
          title: 'T',
          description: 'D',
          model: 'claude-sonnet-5',
          effort: 'normal',
          priority: 'NORMAL',
          reason: 'r',
          scope: { directories: 'src/', filesRead: [], filesWrite: [] },
          dependencies: [],
          goNogo: { goCriteria: 'g', noGoCriteria: 'n', techDebtAcceptable: 't' },
        },
      ],
      reasoning: 'r',
    });
    const result = parsePlannerResponse(raw);
    expect(result).toBeNull();
  });

  it('rejects when task is missing reason field', () => {
    const raw = JSON.stringify({
      tasks: [
        {
          title: 'T',
          description: 'D',
          model: 'claude-sonnet-5',
          effort: 'normal',
          priority: 'NORMAL',
          // reason missing
          scope: { directories: [], filesRead: [], filesWrite: [] },
          dependencies: [],
          goNogo: { goCriteria: 'g', noGoCriteria: 'n', techDebtAcceptable: 't' },
        },
      ],
      reasoning: 'r',
    });
    const result = parsePlannerResponse(raw);
    expect(result).toBeNull();
  });

  it('accepts reason as empty string (no min constraint on reason)', () => {
    const raw = JSON.stringify({
      tasks: [
        {
          title: 'T',
          description: 'D',
          model: 'claude-sonnet-5',
          effort: 'normal',
          priority: 'NORMAL',
          reason: '',
          scope: { directories: [], filesRead: [], filesWrite: [] },
          dependencies: [],
          goNogo: { goCriteria: 'g', noGoCriteria: 'n', techDebtAcceptable: 't' },
        },
      ],
      reasoning: 'r',
    });
    const result = parsePlannerResponse(raw);
    expect(result).not.toBeNull();
  });

  it('accepts all valid effort values', () => {
    for (const effort of ['low', 'normal', 'high']) {
      const raw = makeValidPlannerJSON({
        tasks: [
          {
            title: 'T',
            description: 'D',
            model: 'claude-sonnet-5',
            effort,
            priority: 'NORMAL',
            reason: 'r',
            scope: { directories: [], filesRead: [], filesWrite: [] },
            dependencies: [],
            goNogo: { goCriteria: 'g', noGoCriteria: 'n', techDebtAcceptable: 't' },
          },
        ],
      });
      const result = parsePlannerResponse(raw);
      expect(result).not.toBeNull();
      expect(result!.tasks[0].effort).toBe(effort);
    }
  });

  it('returns null for non-object top-level JSON', () => {
    expect(parsePlannerResponse(JSON.stringify([1, 2, 3]))).toBeNull();
    expect(parsePlannerResponse(JSON.stringify('string'))).toBeNull();
    expect(parsePlannerResponse(JSON.stringify(42))).toBeNull();
    expect(parsePlannerResponse(JSON.stringify(null))).toBeNull();
  });
});
