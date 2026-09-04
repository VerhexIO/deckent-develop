// tests/orchestra/planner-dependency-shape.test.ts
// RECOVERY-BORN-PLANNER-DEPENDENCY-SHAPE-001 (MASTER 3332): a nondeterministic
// planner model sometimes emits `dependencies` as task NUMBERS (1-based "Task N"
// indexes) instead of exact title strings. The schema (`z.array(z.string())`)
// rejected the whole plan as `parse_failed`, the schema-retry repeated the shape,
// and the ledger never recorded why. This battery pins:
//   1. deterministic pre-schema coercion (1-based index / "Task N" → title),
//   2. the json-vs-schema failure distinction with bounded issue paths,
//   3. the zero-config end-to-end path accepting a numeric-dependency plan via an
//      injected spawn seam, and naming the violation on the schema-retry prompt.
// Hermetic: node:child_process mocked (planner-zeroconfig precedent); no real
// provider CLI; fixture model/provider names only.
import { describe, it, expect, vi } from 'vitest';

vi.mock('node:child_process', () => ({ spawnSync: vi.fn(), spawn: vi.fn() }));

import {
  coercePlannerDependencyShape,
  parsePlannerResponseDetailed,
  parsePlannerResponse,
  callZeroConfigPlanner,
  type PlannerSpawnFn,
} from '../../src/orchestra/planner.js';
import type { ModelType } from '../../src/core/types.js';
import type { ProviderAdapter } from '../../src/core/provider.js';

// Registered model id (sibling planner tests use the same one): the parser verifies
// model identity against the live registry, so a made-up id cannot exercise the
// happy path.
const MODEL = 'claude-sonnet-5' as ModelType;

function task(title: string, dependencies: unknown[] = []) {
  return {
    title,
    description: `${title} description`,
    model: MODEL,
    effort: 'normal',
    priority: 'NORMAL',
    reason: 'fixture',
    scope: { directories: ['docs/'], filesRead: [], filesWrite: [`docs/${title.replace(/\s+/g, '-')}.md`] },
    dependencies,
    goNogo: { goCriteria: 'go', noGoCriteria: 'no-go', techDebtAcceptable: '' },
  };
}

function plan(tasks: unknown[]) {
  return { reasoning: 'fixture plan', tasks };
}

function fakeAdapter(): ProviderAdapter {
  return {
    name: 'claude',
    supportedModels: [MODEL] as readonly ModelType[],
    spawn: vi.fn(),
    kill: vi.fn(),
    listWorkers: vi.fn().mockReturnValue([]),
    isAvailable: vi.fn().mockResolvedValue(true),
    buildCommand: vi.fn().mockReturnValue('fixture'),
    buildPlannerCommand: (prompt: string, model: ModelType) => ({ command: 'fixture', args: ['-p', prompt, '--model', model] }),
  } as unknown as ProviderAdapter;
}

describe('coercePlannerDependencyShape — deterministic pre-schema shape repair (3332)', () => {
  it('maps 1-based task numbers to the exact task titles', () => {
    const input = plan([task('Alpha'), task('Beta', [1]), task('Gamma', [1, 2])]);
    const { value, coerced } = coercePlannerDependencyShape(input);
    const tasks = (value as { tasks: Array<{ dependencies: unknown[] }> }).tasks;
    expect(tasks[1]!.dependencies).toEqual(['Alpha']);
    expect(tasks[2]!.dependencies).toEqual(['Alpha', 'Beta']);
    expect(coerced).toBe(3);
  });

  it('maps "Task N" / "task 2" / "#3" strings the same way; other strings are untouched', () => {
    const input = plan([task('Alpha'), task('Beta'), task('Gamma', ['Task 1', 'task 2', '#2', 'Alpha'])]);
    const { value, coerced } = coercePlannerDependencyShape(input);
    const tasks = (value as { tasks: Array<{ dependencies: unknown[] }> }).tasks;
    expect(tasks[2]!.dependencies).toEqual(['Alpha', 'Beta', 'Beta', 'Alpha']);
    expect(coerced).toBe(3);
  });

  it('leaves out-of-range and self-referencing numbers as strings (they drop VISIBLY later, never silently re-targeted)', () => {
    const input = plan([task('Alpha', [1]), task('Beta', [0, 9])]);
    const { value } = coercePlannerDependencyShape(input);
    const tasks = (value as { tasks: Array<{ dependencies: unknown[] }> }).tasks;
    expect(tasks[0]!.dependencies).toEqual(['1']);
    expect(tasks[1]!.dependencies).toEqual(['0', '9']);
  });

  it('is a no-op on non-plan shapes and never throws', () => {
    expect(coercePlannerDependencyShape(null).coerced).toBe(0);
    expect(coercePlannerDependencyShape({ tasks: 'nope' }).coerced).toBe(0);
    expect(coercePlannerDependencyShape({ tasks: [{ dependencies: 'x' }] }).coerced).toBe(0);
  });
});

describe('parsePlannerResponseDetailed — json vs schema failure with bounded issue paths', () => {
  it('numeric dependencies now parse into a valid plan with title dependencies', () => {
    const raw = JSON.stringify(plan([task('Alpha'), task('Beta', [1])]));
    const detailed = parsePlannerResponseDetailed(raw);
    expect(detailed.failure).toBeUndefined();
    expect(detailed.result?.tasks[1]?.dependencies).toEqual(['Alpha']);
    // The legacy wrapper keeps its contract.
    expect(parsePlannerResponse(raw)?.tasks).toHaveLength(2);
  });

  it('invalid JSON → stage "json", no result', () => {
    const detailed = parsePlannerResponseDetailed('{ this is not json');
    expect(detailed.result).toBeNull();
    expect(detailed.failure?.stage).toBe('json');
  });

  it('valid JSON that violates the schema → stage "schema" with dotted issue paths, capped and output-free', () => {
    const bad = plan([task('Alpha'), { ...task('Beta'), effort: 'extreme', dependencies: [{ deep: true }] }]);
    const detailed = parsePlannerResponseDetailed(JSON.stringify(bad));
    expect(detailed.result).toBeNull();
    expect(detailed.failure?.stage).toBe('schema');
    expect(detailed.failure?.issues).toContain('tasks.1.effort:invalid_enum_value');
    expect(detailed.failure?.issues.some((i: string) => i.startsWith('tasks.1.dependencies.0:'))).toBe(true);
    expect(detailed.failure?.issues.length).toBeLessThanOrEqual(8);
    for (const issue of detailed.failure!.issues) expect(issue).not.toContain('Beta description');
  });
});

describe('callZeroConfigPlanner — numeric-dependency plan is accepted; schema violations are named on retry', () => {
  function spawnSeam(stdouts: string[]) {
    const prompts: string[] = [];
    const fn: PlannerSpawnFn = async (_command, args) => {
      prompts.push(args.join(' '));
      const stdout = stdouts[Math.min(prompts.length - 1, stdouts.length - 1)]!;
      return { status: 0, signal: null, stdout, stderr: '' };
    };
    return { fn, prompts };
  }

  it('first attempt with numeric dependencies → plan accepted, dependencies resolved to titles, no retry', async () => {
    const { fn, prompts } = spawnSeam([JSON.stringify(plan([task('Alpha'), task('Beta', [1]), task('Gamma', [1, 2])]))]);
    const result = await callZeroConfigPlanner('fixture goal', MODEL, 'app', [], fakeAdapter(), undefined, fn, undefined, {
      defaultModel: MODEL, allowedModels: [MODEL],
    });
    expect(result).not.toBeNull();
    expect(prompts).toHaveLength(1);
    expect(result!.tasks[2]!.dependencies).toEqual(['Alpha', 'Beta']);
  });

  it('schema violation on attempt 1 → retry prompt names the violated paths; valid attempt 2 is accepted', async () => {
    const invalid = JSON.stringify(plan([task('Alpha'), { ...task('Beta'), priority: 'URGENT' }]));
    const valid = JSON.stringify(plan([task('Alpha'), task('Beta', [1])]));
    const { fn, prompts } = spawnSeam([invalid, valid]);
    const result = await callZeroConfigPlanner('fixture goal', MODEL, 'app', [], fakeAdapter(), undefined, fn, undefined, {
      defaultModel: MODEL, allowedModels: [MODEL],
    });
    expect(result).not.toBeNull();
    expect(prompts).toHaveLength(2);
    expect(prompts[1]).toContain('tasks.1.priority:invalid_enum_value');
    expect(prompts[1]).toContain('exact task title');
  });

  it('attempt 1 uses a model outside the allowed policy → retry names tasks.N.model:<id> and the allowed IDs; valid attempt 2 is accepted', async () => {
    const OTHER = 'claude-haiku-4-5-20251001' as ModelType; // registered, but not in this policy
    const bad = JSON.stringify(plan([task('Alpha'), { ...task('Beta'), model: OTHER }]));
    const valid = JSON.stringify(plan([task('Alpha'), task('Beta', [1])]));
    const { fn, prompts } = spawnSeam([bad, valid]);
    const result = await callZeroConfigPlanner('fixture goal', MODEL, 'app', [], fakeAdapter(), undefined, fn, undefined, {
      defaultModel: MODEL, allowedModels: [MODEL],
    });
    expect(result).not.toBeNull();
    expect(prompts).toHaveLength(2);
    expect(prompts[1]).toContain(`tasks.1.model:${OTHER}`);
    expect(prompts[1]).toContain(`allowed API IDs: ${MODEL}`);
  });

  it('both attempts violate the model policy → null after exactly two attempts (finite, typed)', async () => {
    const OTHER = 'claude-haiku-4-5-20251001' as ModelType;
    const bad = JSON.stringify(plan([{ ...task('Alpha'), model: OTHER }]));
    const { fn, prompts } = spawnSeam([bad, bad]);
    const result = await callZeroConfigPlanner('fixture goal', MODEL, 'app', [], fakeAdapter(), undefined, fn, undefined, {
      defaultModel: MODEL, allowedModels: [MODEL],
    });
    expect(result).toBeNull();
    expect(prompts).toHaveLength(2);
  });
});
