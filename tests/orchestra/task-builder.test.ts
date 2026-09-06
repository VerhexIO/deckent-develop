import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { MemoryStore } from '../../src/core/memory-store.js';
import {
  createTask,
  extractScopeFromDirective,
  enrichScopeWithTestFiles,
  mirrorTestScope,
  parseStructuredDirectives,
  parseBulletOrNumberedTasks,
  parsePriorityDirective,
  parseAuthModeDirective,
  parseDependenciesDirective,
  isPlanSlotId,
  resolveDependencyRef,
  resolveTaskDependencies,
  plannerTaskToParams,
  resolveWorkerEffort,
  buildWorkerPrompt,
  // loadADRContent removed — now uses MemoryStore queryRelevantADRs
  DirectiveTaskSchema,
  DirectiveSchema,
  validateDirective,
} from '../../src/orchestra/task-builder.js';
import { TaskStatus } from '../../src/core/types.js';
import type { Task, PlannerTask, CreateTaskParams } from '../../src/core/types.js';
import { buildParametricModel, modelRegistry } from '../../src/core/model-registry.js';

// ─── Helpers ───────────────────────────────────────────────────────────────

function makeBaseParams(overrides: Partial<CreateTaskParams> = {}): CreateTaskParams {
  return {
    title: 'Test Task',
    description: 'A test task description',
    model: 'claude-sonnet-5',
    effort: 'normal',
    priority: 'NORMAL',
    reason: 'Testing purposes',
    scope: { directories: ['src/core/'], filesRead: [], filesWrite: ['src/core/foo.ts'] },
    dependencies: [],
    goNogo: { goCriteria: 'tests pass', noGoCriteria: 'tests fail', techDebtAcceptable: 'minor' },
    sprintId: 'sprint-025',
    ...overrides,
  };
}

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: '025-001',
    title: 'Test Task',
    description: 'A test task description',
    model: 'claude-sonnet-5',
    effort: 'normal',
    priority: 'NORMAL',
    reason: 'Testing purposes',
    scope: { directories: ['src/core/'], filesRead: [], filesWrite: ['src/core/foo.ts'] },
    dependencies: [],
    goNogo: { goCriteria: 'tests pass', noGoCriteria: 'tests fail', techDebtAcceptable: 'minor' },
    status: TaskStatus.PENDING,
    sprintId: 'sprint-025',
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

/**
 * TASK-BUILDER-ADR-CWD-LEAK (391-001): a fresh tmp dir with no `.brain/memory.db`,
 * so `buildWorkerPrompt`'s ADR-load path is deterministically empty regardless of
 * whatever real `.brain/memory.db` exists at the actual repo cwd during a local run.
 */
function makeEmptyProjectRoot(): string {
  return mkdtempSync(join(tmpdir(), 'task-builder-empty-root-'));
}

function makePlannerTask(overrides: Partial<PlannerTask> = {}): PlannerTask {
  return {
    title: 'Planner Task',
    description: 'Planner task desc',
    model: 'claude-opus-4-8',
    effort: 'high',
    priority: 'HIGH',
    reason: 'Complexity',
    scope: { directories: ['src/orchestra/'], filesRead: [], filesWrite: ['src/orchestra/brain.ts'] },
    dependencies: ['001'],
    goNogo: { goCriteria: 'all checks pass', noGoCriteria: 'compile fails', techDebtAcceptable: 'none' },
    ...overrides,
  };
}

// ─── createTask ────────────────────────────────────────────────────────────

describe('createTask', () => {
  it('generates id from sprintId and sequence', () => {
    const task = createTask(makeBaseParams({ sprintId: 'sprint-025' }), 1);
    expect(task.id).toBe('025-001');
  });

  it('pads sequence to 3 digits', () => {
    const task = createTask(makeBaseParams({ sprintId: 'sprint-025' }), 42);
    expect(task.id).toBe('025-042');
  });

  it('strips "sprint-" prefix from sprintId', () => {
    const task = createTask(makeBaseParams({ sprintId: 'sprint-001' }), 1);
    expect(task.id).toBe('001-001');
  });

  it('uses PENDING status by default', () => {
    const task = createTask(makeBaseParams(), 1);
    expect(task.status).toBe(TaskStatus.PENDING);
  });

  it('respects initialStatus override', () => {
    const task = createTask(makeBaseParams({ initialStatus: TaskStatus.DRAFT }), 1);
    expect(task.status).toBe(TaskStatus.DRAFT);
  });

  it('copies all fields from params', () => {
    const params = makeBaseParams();
    const task = createTask(params, 1);
    expect(task.title).toBe(params.title);
    expect(task.description).toBe(params.description);
    expect(task.model).toBe(params.model);
    expect(task.effort).toBe(params.effort);
    expect(task.priority).toBe(params.priority);
    expect(task.reason).toBe(params.reason);
    // scope.directories may be widened by mirrorTestScope for code-development tasks
    expect(task.scope.directories).toEqual(expect.arrayContaining(params.scope.directories));
    expect(task.scope.filesRead).toEqual(params.scope.filesRead);
    expect(task.scope.filesWrite).toEqual(params.scope.filesWrite);
    expect(task.dependencies).toEqual(params.dependencies);
    expect(task.goNogo).toEqual(expect.objectContaining(params.goNogo));
    expect(task.goNogo.items).toHaveLength(2);
    expect(task.sprintId).toBe(params.sprintId);
  });

  it('sets createdAt to valid ISO string', () => {
    const before = Date.now();
    const task = createTask(makeBaseParams(), 1);
    const after = Date.now();
    const ts = new Date(task.createdAt!).getTime();
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });

  it('carries isPriorityFix and fixForTaskId when set', () => {
    const task = createTask(makeBaseParams({ isPriorityFix: true, fixForTaskId: '024-003' }), 5);
    expect(task.isPriorityFix).toBe(true);
    expect(task.fixForTaskId).toBe('024-003');
  });
});

// ─── extractScopeFromDirective ─────────────────────────────────────────────

describe('extractScopeFromDirective', () => {
  it('extracts src/ directory from line', () => {
    const scope = extractScopeFromDirective('- Kapsam: src/core/');
    expect(scope.directories).toContain('src/core/');
  });

  it('extracts tests/ directory from line', () => {
    const scope = extractScopeFromDirective('tests/orchestra/');
    expect(scope.directories).toContain('tests/orchestra/');
  });

  it('extracts .ts file from line', () => {
    const scope = extractScopeFromDirective('- Dosya: src/core/utils.ts (güncelle)');
    expect(scope.filesWrite).toContain('src/core/utils.ts');
  });

  it('returns empty arrays for unrelated line', () => {
    const scope = extractScopeFromDirective('some random text without paths');
    expect(scope.directories).toEqual([]);
    expect(scope.filesWrite).toEqual([]);
    expect(scope.filesRead).toEqual([]);
  });

  it('deduplicates directories', () => {
    const scope = extractScopeFromDirective('src/core/ and also src/core/ paths');
    expect(scope.directories.filter(d => d === 'src/core/')).toHaveLength(1);
  });

  it('deduplicates file paths', () => {
    const scope = extractScopeFromDirective('src/core/utils.ts src/core/utils.ts');
    expect(scope.filesWrite.filter(f => f === 'src/core/utils.ts')).toHaveLength(1);
  });

  it('extracts multiple directories from one line', () => {
    const scope = extractScopeFromDirective('src/core/ and tests/core/');
    expect(scope.directories).toContain('src/core/');
    expect(scope.directories).toContain('tests/core/');
  });

  it('always returns empty filesRead', () => {
    const scope = extractScopeFromDirective('src/core/utils.ts');
    expect(scope.filesRead).toEqual([]);
  });

  it('keeps BOTH grants when Files and Reads share one line (671-review multi-label fix)', () => {
    const scope = extractScopeFromDirective('- Files: tests/a.test.ts, Reads: src/core/x.ts');
    expect(scope.filesWrite).toEqual(['tests/a.test.ts']);
    expect(scope.filesRead).toEqual(['src/core/x.ts']);
  });

  it('parses Reads as exact read-only authority without leaking into write scope', () => {
    const scope = extractScopeFromDirective(
      'Reads: src/core/utils.ts, docs/MASTER-PLAN.md, .deckent/provider-execution-observations.db',
    );
    expect(scope).toEqual({
      directories: [],
      filesRead: [
        'src/core/utils.ts',
        'docs/MASTER-PLAN.md',
        '.deckent/provider-execution-observations.db',
      ],
      filesWrite: [],
    });
  });

  it('adds root-level DECKENT.md to filesWrite without adding docs/ directory', () => {
    const scope = extractScopeFromDirective('Files: DECKENT.md, src/core/config.ts');
    expect(scope.filesWrite).toContain('DECKENT.md');
    expect(scope.directories).not.toContain('docs/');
  });

  it('adds .gitignore to filesWrite', () => {
    const scope = extractScopeFromDirective('Files: DECKENT.md, .gitignore');
    expect(scope.filesWrite).toContain('.gitignore');
    expect(scope.filesWrite).toContain('DECKENT.md');
  });

  it('adds CONTRIBUTING.md to filesWrite without docs/ directory', () => {
    const scope = extractScopeFromDirective('Files: CONTRIBUTING.md, README.md');
    expect(scope.filesWrite).toContain('CONTRIBUTING.md');
    expect(scope.directories).not.toContain('docs/');
  });

  it('still adds docs/ directory for files inside docs/', () => {
    const scope = extractScopeFromDirective('Files: docs/guide.md, docs/api.md');
    expect(scope.filesWrite).toContain('docs/guide.md');
    expect(scope.directories).toContain('docs/');
  });
});

// ─── parseStructuredDirectives ─────────────────────────────────────────────

describe('parseStructuredDirectives', () => {
  it('keeps Reads and Files in disjoint authority channels', () => {
    const [task] = parseStructuredDirectives(`
## Task 1: Read/write split
- Reads: src/core/config.ts, docs/MASTER-PLAN.md
- Files: docs/evidence/read-write-split.md
Implement: inspect inputs and write the evidence note.
`);
    expect(task?.scope.filesRead).toEqual(['src/core/config.ts', 'docs/MASTER-PLAN.md']);
    expect(task?.scope.filesWrite).toEqual(['docs/evidence/read-write-split.md']);
  });

  it('returns empty array when no structured sections', () => {
    const result = parseStructuredDirectives('# Just a heading\nSome content');
    expect(result).toEqual([]);
  });

  it('parses a single Görev block', () => {
    // The regex splits on "## Görev N:", so text after the colon on the heading line
    // becomes the first content in the block — that becomes the title.
    const content = `## Görev 1: First Task
- Dosya: src/core/utils.ts
- Kapsam: src/core/

### Açıklama
Do something useful`;
    const result = parseStructuredDirectives(content);
    expect(result).toHaveLength(1);
    // Title = first non-empty line after heading's ":"  → "First Task"
    expect(result[0].title).toBe('First Task');
  });

  it('parses multiple blocks', () => {
    const content = `## Görev 1: Task One
- Title line one

## Görev 2: Task Two
- Title line two`;
    const result = parseStructuredDirectives(content);
    expect(result).toHaveLength(2);
  });

  it('parses Task keyword in addition to Görev', () => {
    const content = `## Task 1: English Task
- Something`;
    const result = parseStructuredDirectives(content);
    expect(result).toHaveLength(1);
  });

  it('extracts scope from Dosya and Kapsam lines', () => {
    const content = `## Görev 1: Utility Functions
- Dosya: src/core/utils.ts (yeni)
- Kapsam: src/core/`;
    const result = parseStructuredDirectives(content);
    expect(result[0].scope.filesWrite).toContain('src/core/utils.ts');
    expect(result[0].scope.directories).toContain('src/core/');
  });

  it('extracts testTarget from Test: line', () => {
    const content = `## Görev 1: My Task
- Kapsam: src/

- Test: tests/core/utils.test.ts`;
    const result = parseStructuredDirectives(content);
    expect(result[0].testTarget).toBe('tests/core/utils.test.ts');
  });

  it('testTarget is undefined when no Test: line', () => {
    const content = `## Görev 1: My Task
- No test line here`;
    const result = parseStructuredDirectives(content);
    expect(result[0].testTarget).toBeUndefined();
  });

  it('merges scope from multiple scope lines in a block', () => {
    const content = `## Görev 1: Multi-scope Task
- Dosya: src/core/utils.ts (güncelle)
- Dosya: src/orchestra/brain.ts`;
    const result = parseStructuredDirectives(content);
    expect(result[0].scope.filesWrite).toContain('src/core/utils.ts');
    expect(result[0].scope.filesWrite).toContain('src/orchestra/brain.ts');
  });

  it('skips blocks without a title', () => {
    // A block with only whitespace — should be skipped
    const content = `## Görev 1: Empty

## Görev 2: Real Task
- Something here`;
    const result = parseStructuredDirectives(content);
    // The "empty" block might be skipped since first non-empty line is empty
    // Result should have at least 1 (the real task)
    expect(result.length).toBeGreaterThanOrEqual(1);
  });
});

// ─── plannerTaskToParams ────────────────────────────────────────────────────

describe('plannerTaskToParams', () => {
  it('maps PlannerTask fields to CreateTaskParams', () => {
    const pt = makePlannerTask();
    const params = plannerTaskToParams(pt, 'sprint-025', 'claude-sonnet-5');
    expect(params.title).toBe(pt.title);
    expect(params.description).toBe(pt.description);
    expect(params.effort).toBe(pt.effort);
    expect(params.priority).toBe(pt.priority);
    expect(params.reason).toBe(pt.reason);
    expect(params.scope).toEqual(pt.scope);
    expect(params.dependencies).toEqual(pt.dependencies);
    expect(params.goNogo).toEqual(pt.goNogo);
    expect(params.sprintId).toBe('sprint-025');
  });

  it('uses PlannerTask model when provided', () => {
    const pt = makePlannerTask({ model: 'claude-opus-4-8' });
    const params = plannerTaskToParams(pt, 'sprint-025', 'claude-sonnet-5');
    expect(params.model).toBe('claude-opus-4-8');
  });

  it('falls back to modelOverride when PlannerTask.model is undefined', () => {
    const pt = makePlannerTask({ model: undefined as any });
    const params = plannerTaskToParams(pt, 'sprint-025', 'claude-haiku-4-5-20251001');
    expect(params.model).toBe('claude-haiku-4-5-20251001');
  });

  it('passes initialStatus when provided', () => {
    const pt = makePlannerTask();
    const params = plannerTaskToParams(pt, 'sprint-025', 'claude-sonnet-5', TaskStatus.DRAFT);
    expect(params.initialStatus).toBe(TaskStatus.DRAFT);
  });

  it('initialStatus is undefined when not provided', () => {
    const pt = makePlannerTask();
    const params = plannerTaskToParams(pt, 'sprint-025', 'claude-sonnet-5');
    expect(params.initialStatus).toBeUndefined();
  });
});

// ─── resolveWorkerEffort ───────────────────────────────────────────────────

describe('resolveWorkerEffort', () => {
  it('returns "max" for high-score tasks (score >= 6)', () => {
    // Multi-directory (3 dirs = +3) + architectural keyword (+2) + many files > 10 (+2) = 7
    const task = makeTask({
      title: 'Architect the whole system migration',
      description: 'Major architectural redesign',
      scope: {
        directories: ['src/core/', 'src/orchestra/', 'src/agents/'],
        filesRead: [],
        filesWrite: Array(12).fill('src/core/foo.ts').map((f, i) => f.replace('foo', `f${i}`)),
      },
    });
    const result = resolveWorkerEffort(task);
    expect(result).toBe('max');
  });

  it('returns "high" for medium-score tasks (score 1-5)', () => {
    // Single directory (-1) + 0 from text = -1, but let's use 2 dirs (+3) = 3
    const task = makeTask({
      title: 'Implement feature',
      description: 'Plain implementation',
      scope: {
        directories: ['src/core/', 'src/cli/'],
        filesRead: [],
        filesWrite: ['src/core/foo.ts'],
      },
    });
    const result = resolveWorkerEffort(task);
    expect(result).toBe('high');
  });

  it('returns "low" for very low-score tasks', () => {
    // docs-only scope (-2) + single dir (-1) = -3 → should be 'low'
    const task = makeTask({
      title: 'Update readme',
      description: 'simple doc update',
      scope: {
        directories: ['docs/'],
        filesRead: [],
        filesWrite: ['docs/README.md'],
      },
    });
    const result = resolveWorkerEffort(task);
    expect(result).toBe('low');
  });

  it('returns "medium" for score -1 to 0', () => {
    // Single directory (-1) + no other bonuses = -1 → medium
    const task = makeTask({
      title: 'Small fix',
      description: 'Minor bugfix',
      scope: {
        directories: ['src/core/'],
        filesRead: [],
        filesWrite: ['src/core/foo.ts'],
      },
    });
    // score = -1 (single directory)
    const result = resolveWorkerEffort(task);
    expect(result).toBe('medium');
  });

  it('result is one of the valid effort strings', () => {
    const task = makeTask();
    const result = resolveWorkerEffort(task);
    expect(['max', 'high', 'medium', 'low']).toContain(result);
  });
});

// ─── buildWorkerPrompt — human-friendly format ────────────────────────────

describe('buildWorkerPrompt', () => {
  it.each([
    { workerCore: false, codexChannel: false, externalized: false },
    { workerCore: true, codexChannel: false, externalized: false },
    { workerCore: true, codexChannel: true, externalized: true },
  ])(
    'resolves Codex core externalization when worker_core_system_prompt=$workerCore and codex_core_channel=$codexChannel',
    ({ workerCore, codexChannel, externalized }) => {
    const task = makeTask({ provider: 'codex', model: 'gpt-4.1' });
    const emptyRoot = makeEmptyProjectRoot();
    try {
      const prompt = buildWorkerPrompt(
        task,
        undefined,
        undefined,
        emptyRoot,
        {
          prompt: {
            worker_core_system_prompt: workerCore,
            codex_core_channel: codexChannel,
          },
        },
        undefined,
        undefined,
        // Externalization also requires a backend that can deliver the core;
        // this case pins the provider/flag half, so it names a delivering one.
        'docker',
      );

      if (externalized) {
        expect(prompt).not.toContain('## Karpathy Discipline');
        expect(prompt).not.toContain('## Turn Economy');
      } else {
        expect(prompt).toContain('## Karpathy Discipline');
        expect(prompt).toContain('## Turn Economy');
      }
    } finally {
      rmSync(emptyRoot, { recursive: true, force: true });
    }
    },
  );

  it.each([
    { enabled: false, externalized: false },
    { enabled: true, externalized: true },
  ])('preserves Claude core externalization when worker_core_system_prompt=$enabled', ({ enabled, externalized }) => {
    const task = makeTask({ provider: 'claude', model: 'claude-sonnet-5' });
    const emptyRoot = makeEmptyProjectRoot();
    try {
      const prompt = buildWorkerPrompt(
        task,
        undefined,
        undefined,
        emptyRoot,
        { prompt: { worker_core_system_prompt: enabled } },
        undefined,
        undefined,
        // See above: the backend gate is pinned separately in
        // worker-core-backend-capability.test.ts.
        'docker',
      );

      if (externalized) {
        expect(prompt).not.toContain('## Karpathy Discipline');
        expect(prompt).not.toContain('## Turn Economy');
      } else {
        expect(prompt).toContain('## Karpathy Discipline');
        expect(prompt).toContain('## Turn Economy');
      }
    } finally {
      rmSync(emptyRoot, { recursive: true, force: true });
    }
  });

  it('includes task id and title in "Your Task" section', () => {
    const task = makeTask({ id: '025-007', title: 'My Special Task' });
    const prompt = buildWorkerPrompt(task);
    expect(prompt).toContain('## Your Task');
    expect(prompt).toContain('025-007');
    expect(prompt).toContain('My Special Task');
  });

  it('includes task description alongside title', () => {
    // Sprint 182 PQ-4 (F6): title and description live on separate lines
    // instead of being joined with " — ". Both must still appear in the prompt.
    const task = makeTask({ id: '025-001', title: 'Fix Bug', description: 'Fix the login bug' });
    const prompt = buildWorkerPrompt(task);
    expect(prompt).toContain('Fix Bug');
    expect(prompt).toContain('Fix the login bug');
    expect(prompt).not.toContain('Fix Bug — Fix the login bug');
  });

  it('includes model in prompt', () => {
    const task = makeTask({ model: 'claude-opus-4-8' });
    const prompt = buildWorkerPrompt(task);
    expect(prompt).toContain('Model: claude-opus-4-8');
  });

  it('includes effort level', () => {
    const task = makeTask();
    const prompt = buildWorkerPrompt(task);
    const effort = resolveWorkerEffort(task);
    expect(prompt).toContain(`Effort: ${effort}`);
  });

  it('includes "What To Do" section with steps and explicit verify block', () => {
    const task = makeTask();
    const prompt = buildWorkerPrompt(task);
    expect(prompt).toContain('## What To Do');
    expect(prompt).toContain('1. Read the task scope carefully');
    expect(prompt).toContain('Write the code changes');
    // PCOMP-W2: step-4 no longer orders doc edits (which contradicted filesWrite);
    // doc staleness is reported via a docImpact: note in the result instead.
    expect(prompt).toContain('Doc-impact:');
    expect(prompt).toContain('docImpact:');
    expect(prompt).toContain('Report: write your result file');
    expect(prompt).toContain('## CRITICAL VERIFY STEPS');
    expect(prompt).toContain('tsc --noEmit');
    expect(prompt).toContain('npx vitest run');
  });

  it('includes "Scope Rules" section with directories', () => {
    const task = makeTask({ scope: { directories: ['src/core/', 'src/cli/'], filesRead: [], filesWrite: [] } });
    const prompt = buildWorkerPrompt(task);
    expect(prompt).toContain('## Scope Rules');
    // compileCanonicalScope projects directories canonically: sorted, no
    // trailing slash (sprint-661 canonical-scope authority).
    expect(prompt).toContain('  - src/cli\n  - src/core');
  });

  it('includes filesWrite in scope section', () => {
    const task = makeTask({ scope: { directories: ['src/core/'], filesRead: [], filesWrite: ['src/core/config.ts', 'src/core/types.ts'] } });
    const prompt = buildWorkerPrompt(task);
    expect(prompt).toContain('  - src/core/config.ts');
    expect(prompt).toContain('  - src/core/types.ts');
  });

  it('shows no-restriction message when directories are empty', () => {
    const task = makeTask({ scope: { directories: [], filesRead: [], filesWrite: [] } });
    const prompt = buildWorkerPrompt(task);
    expect(prompt).toContain('(no directory restriction)');
  });

  it('warns about auditor boundary violations', () => {
    const emptyRoot = makeEmptyProjectRoot();
    const task = makeTask();
    try {
      const prompt = buildWorkerPrompt(task, undefined, undefined, emptyRoot);
      expect(prompt).toContain('the auditor flags any write outside it');
    } finally {
      rmSync(emptyRoot, { recursive: true, force: true });
    }
  });

  it('includes heartbeat file path', () => {
    const task = makeTask({ id: '025-007' });
    const prompt = buildWorkerPrompt(task);
    expect(prompt).toContain('.tasks/task-025-007.hb');
  });

  it('includes "Result File" section with correct path', () => {
    const task = makeTask({ id: '025-007' });
    const prompt = buildWorkerPrompt(task);
    expect(prompt).toContain('## Result & Self-Assessment');
    expect(prompt).toContain('.tasks/task-025-007.result');
  });

  it('includes selfAssessment options in result template', () => {
    const task = makeTask();
    const prompt = buildWorkerPrompt(task);
    expect(prompt).toContain('selfAssessment');
    expect(prompt).toContain('"DONE"');
    expect(prompt).toContain('GO_WITH_TECH_DEBT');
    expect(prompt).toContain('NO_GO');
  });

  it('references WORKER-GUIDE.md instead of embedding boilerplate', () => {
    const task = makeTask();
    const prompt = buildWorkerPrompt(task);
    expect(prompt).toContain('.deckent/workspace/WORKER-GUIDE.md');
  });

  it('does not embed heartbeat JSON template (moved to WORKER-GUIDE.md)', () => {
    const task = makeTask({ id: '040-001' });
    const prompt = buildWorkerPrompt(task);
    // JSON template lines removed — only condensed hint remains
    expect(prompt).not.toContain('"workerId": "w-040-001"');
    expect(prompt).not.toContain('"filesChanged": ["list/of/files');
  });

  it('does not embed "If Something Goes Wrong" section (moved to WORKER-GUIDE.md)', () => {
    const task = makeTask();
    const prompt = buildWorkerPrompt(task);
    expect(prompt).not.toContain('## If Something Goes Wrong');
  });

  it('mentions max 3 attempts for tsc', () => {
    const task = makeTask();
    const prompt = buildWorkerPrompt(task);
    expect(prompt).toContain('max 3 attempts');
  });

  it('prompt is structured with markdown headers', () => {
    const task = makeTask();
    const prompt = buildWorkerPrompt(task);
    const headers = prompt.match(/^## .+$/gm);
    expect(headers).not.toBeNull();
    expect(headers!.length).toBeGreaterThanOrEqual(4);
  });

  it('includes heartbeat file path and workerId hint', () => {
    const task = makeTask({ id: '040-001' });
    const prompt = buildWorkerPrompt(task);
    expect(prompt).toContain('.tasks/task-040-001.hb');
    expect(prompt).toContain('w-040-001');
  });

  it('result file is marked as mandatory (never exit without it)', () => {
    const task = makeTask();
    const prompt = buildWorkerPrompt(task);
    expect(prompt).toContain('never exit without writing the .result file');
  });

  it('prompt is significantly shorter than original (~80 lines target)', () => {
    const task = makeTask();
    const prompt = buildWorkerPrompt(task);
    const lines = prompt.split('\n').length;
    // Original was ~150 lines, target was ~80 lines
    // ADR injection (Sprint 138) adds ~170 lines of mandatory architecture rules
    // Honest Assessment block + Event Stream hints (Sprint 138) add another ~30 lines
    // Raised 200 → 450 (2026-04-17, Sprint 143) — Sprint 144 debt: slot-based assertion
    expect(lines).toBeLessThan(450);
  });

  it('task description ratio is higher in shorter prompt', () => {
    const task = makeTask({ description: 'A'.repeat(500) });
    const prompt = buildWorkerPrompt(task);
    const descLen = 500;
    const totalLen = prompt.length;
    // Description should be meaningful portion of total prompt (baseline improvement from 16%)
    // Threshold lowered from 0.20 → 0.18 (tokenUsage), → 0.17 (rubricScores),
    // → 0.05 (Sprint 138 ADR injection), → 0.02 (2026-04-17, Sprint 143 full ADR content grew to ~17K chars).
    // Sprint 144 debt: replace ratio check with absolute description presence assertion.
    expect(descLen / totalLen).toBeGreaterThan(0.02);
  });

  it('includes the orchestrator-filled tokenUsage instruction in result file section (WP-4)', () => {
    const task = makeTask();
    const prompt = buildWorkerPrompt(task);
    // The tokenUsage shape is still documented…
    expect(prompt).toContain('tokenUsage');
    expect(prompt).toContain('inputTokens');
    expect(prompt).toContain('outputTokens');
    expect(prompt).toContain('provider');
    // …but the worker is told NOT to estimate counts; the orchestrator fills them.
    expect(prompt).toContain('do NOT estimate');
    expect(prompt).toContain('orchestrator');
  });

  it('keeps plan-time provider/model out of worker-authored tokenUsage', () => {
    const task = makeTask({ provider: 'codex', model: 'gpt-4.1' });
    const prompt = buildWorkerPrompt(task);
    expect(prompt).toContain('Plan-resolved provider: codex');
    expect(prompt).toContain('Plan-resolved model: gpt-4.1');
    expect(prompt).not.toContain('"provider": "codex"');
    expect(prompt).not.toContain('"model": "gpt-4.1"');
    expect(prompt).toContain('do not place provider/model inside tokenUsage');
  });

  it('WP-4: tokenUsage is orchestrator-owned (no stale "missing → NO_GO" demand)', () => {
    const task = makeTask();
    const prompt = buildWorkerPrompt(task);
    // The impossible self-estimation ask + stale NO_GO threat are gone…
    expect(prompt).not.toContain('a missing tokenUsage is rejected as NO_GO');
    expect(prompt).not.toContain('tokenUsage with ALL four fields');
    // …replaced by: the orchestrator fills the counts; tokenUsage is optional.
    expect(prompt).toContain('orchestrator');
    expect(prompt.toLowerCase()).toContain('optional');
  });
});

// ─── forceModel / forceEffort (DIRECTIVES.md user override) ─────────────

describe('parseStructuredDirectives — forceModel/forceEffort', () => {
  it('parses "Model: claude-opus-4-8" into forceModel', () => {
    const content = '## Task 1: Security Audit\n- Model: claude-opus-4-8\n- Scope: src/auth/\n\n### Description\nAudit auth.';
    const tasks = parseStructuredDirectives(content);
    expect(tasks[0].forceModel).toBe('claude-opus-4-8');
  });

  it('parses "Model: claude-haiku-4-5-20251001" into forceModel', () => {
    const content = '## Task 1: Quick Fix\nModel: claude-haiku-4-5-20251001\n\n### Description\nFix typo.';
    const tasks = parseStructuredDirectives(content);
    expect(tasks[0].forceModel).toBe('claude-haiku-4-5-20251001');
  });

  it('returns undefined forceModel when no Model line', () => {
    const content = '## Task 1: Normal Task\n\n### Description\nDo something.';
    const tasks = parseStructuredDirectives(content);
    expect(tasks[0].forceModel).toBeUndefined();
  });

  it('fails loudly for an unknown model without an explicit provider', () => {
    const content = '## Task 1: Bad Model\nModel: gpt4\n\n### Description\nTest.';
    expect(() => parseStructuredDirectives(content)).toThrow(/E_MODEL_PROVIDER_UNVERIFIED/);
  });

  it('accepts an exact future API model ID after catalog-backed registration', () => {
    const model = 'gpt-7.2-preview-2031-04-09';
    const content = `## Task 1: Future Model\n- Provider: codex\n- Model: ${model}\n\n### Description\nTest.`;
    try {
      modelRegistry.register(buildParametricModel(model, {
        provider: 'codex',
        costPerMillion: { input: 9, output: 45 },
        pricingEvidenceRef: 'catalog:test:gpt-7.2-preview-2031-04-09',
        status: 'ga',
        register: false,
      }));
      const tasks = parseStructuredDirectives(content);
      expect(tasks[0].forceModel).toBe(model);
      expect(modelRegistry.get(model)?.provider).toBe('codex');
      expect(modelRegistry.get(model)?.apiId).toBe(model);
    } finally {
      modelRegistry.unregister(model);
    }
  });

  it('does not mutate the registry while parsing a dynamic local tag', () => {
    const model = 'parser-purity:9b';
    modelRegistry.unregister(model);
    const content = `## Task 1: Local Model\n- Provider: ollama\n- Model: ${model}\n\n### Description\nTest.`;
    const tasks = parseStructuredDirectives(content);
    expect(tasks[0].forceModel).toBe(model);
    expect(modelRegistry.has(model)).toBe(false);
  });

  it('rejects legacy model aliases instead of rewriting task intent', () => {
    const content = '## Task 1: Legacy Alias\n- Model: gpt-5\n\n### Description\nTest.';
    expect(() => parseStructuredDirectives(content)).toThrow(/E_LEGACY_MODEL_ALIAS/);
  });

  it('parses "Effort: high" into forceEffort', () => {
    const content = '## Task 1: Complex Task\nEffort: high\n\n### Description\nHard work.';
    const tasks = parseStructuredDirectives(content);
    expect(tasks[0].forceEffort).toBe('high');
  });

  it('returns undefined forceEffort when no Effort line', () => {
    const content = '## Task 1: Normal\n\n### Description\nSimple.';
    const tasks = parseStructuredDirectives(content);
    expect(tasks[0].forceEffort).toBeUndefined();
  });

  it('parses both Model and Effort together', () => {
    const content = '## Task 1: Full Override\nModel: claude-opus-4-8\nEffort: high\n- Scope: src/\n\n### Description\nBig task.';
    const tasks = parseStructuredDirectives(content);
    expect(tasks[0].forceModel).toBe('claude-opus-4-8');
    expect(tasks[0].forceEffort).toBe('high');
  });

  it('preserves case sensitivity and rejects a non-canonical model ID', () => {
    const content = '## Task 1: Case Test\n- model: OPUS\n\n### Description\nTest.';
    expect(() => parseStructuredDirectives(content)).toThrow(/E_MODEL_PROVIDER_UNVERIFIED/);
  });
});

describe('resolveWorkerEffort — forceEffort override', () => {
  it('returns forceEffort when set', () => {
    const task = makeTask({ forceEffort: 'high' });
    expect(resolveWorkerEffort(task)).toBe('high');
  });

  it('returns score-based effort when forceEffort not set', () => {
    const task = makeTask({ forceEffort: undefined });
    const effort = resolveWorkerEffort(task);
    expect(['max', 'high', 'medium', 'low']).toContain(effort);
  });
});

describe('createTask — forceModel/forceEffort passthrough', () => {
  it('passes forceModel to task', () => {
    const task = createTask(makeBaseParams({ forceModel: 'claude-opus-4-8' }), 1);
    expect(task.forceModel).toBe('claude-opus-4-8');
  });

  it('passes forceEffort to task', () => {
    const task = createTask(makeBaseParams({ forceEffort: 'high' }), 1);
    expect(task.forceEffort).toBe('high');
  });

  it('forceModel undefined when not provided', () => {
    const task = createTask(makeBaseParams(), 1);
    expect(task.forceModel).toBeUndefined();
  });
});

// ─── buildWorkerPrompt — agentPrompt injection ──────────────────────────────

describe('buildWorkerPrompt — agentPrompt parameter', () => {
  it('includes agent block when agentPrompt is provided', () => {
    const task = makeTask({ assignedAgent: 'security-auditor' });
    const prompt = buildWorkerPrompt(task, 'You are a security specialist.');
    expect(prompt).toContain('=== Agent: security-auditor ===');
    expect(prompt).toContain('You are a security specialist.');
    // No dangling "=== Task ===" header — the real header is "## Your Task".
    expect(prompt).not.toContain('=== Task ===');
    expect(prompt).toContain('## Your Task');
  });

  it('does not include agent block when agentPrompt is undefined', () => {
    const task = makeTask();
    const prompt = buildWorkerPrompt(task);
    expect(prompt).not.toContain('=== Agent:');
    expect(prompt).not.toContain('=== Task ===');
  });

  it('does not include agent block when agentPrompt is empty string', () => {
    const task = makeTask();
    const prompt = buildWorkerPrompt(task, '');
    expect(prompt).not.toContain('=== Agent:');
  });

  it('includes full agentPrompt without truncation', () => {
    // TASK-BUILDER-ADR-CWD-LEAK (391-001): explicit empty projectRoot keeps this
    // hermetic — without it, buildWorkerPrompt's ADR-load defaulted to
    // process.cwd(), so a local checkout with a real `.brain/memory.db` could
    // inject an ADR block (its "ADVISORY CONTEXT" header contains a literal "X")
    // before '## Your Task' and inflate the count.
    const emptyRoot = makeEmptyProjectRoot();
    try {
      const longPrompt = 'X'.repeat(3000);
      const task = makeTask({ assignedAgent: 'test-agent' });
      const prompt = buildWorkerPrompt(task, longPrompt, undefined, emptyRoot);
      // agentPrompt is included without truncation (Sprint 147+ behavior)
      const agentSection = prompt.split('## Your Task')[0]!;
      const xCount = (agentSection.match(/X/g) || []).length;
      expect(xCount).toBeGreaterThanOrEqual(3000);
    } finally {
      rmSync(emptyRoot, { recursive: true, force: true });
    }
  });

  it('uses "generic" for assignedAgent when not set', () => {
    const task = makeTask({ assignedAgent: undefined });
    const prompt = buildWorkerPrompt(task, 'some prompt');
    expect(prompt).toContain('=== Agent: generic ===');
  });

  it('includes both agent block and standard prompt content', () => {
    const task = makeTask({ id: '029-005', title: 'Special Task', assignedAgent: 'my-agent' });
    const prompt = buildWorkerPrompt(task, 'Agent instructions here');
    // Agent block present
    expect(prompt).toContain('Agent instructions here');
    // Standard prompt content also present
    expect(prompt).toContain('029-005');
    expect(prompt).toContain('Special Task');
    expect(prompt).toContain('You are a Deckent worker agent');
  });

  it('agent block comes before task content', () => {
    const task = makeTask({ assignedAgent: 'first-agent' });
    const prompt = buildWorkerPrompt(task, 'First content');
    const agentIdx = prompt.indexOf('=== Agent:');
    const workerIdx = prompt.indexOf('You are a Deckent worker agent');
    expect(workerIdx).toBeLessThan(agentIdx);
  });

  it('standard prompt unchanged when agentPrompt is not provided', () => {
    const task = makeTask({ id: '029-010' });
    const withoutAgent = buildWorkerPrompt(task);
    const withEmptyAgent = buildWorkerPrompt(task, '');
    // Both should produce same output (no agent block)
    expect(withoutAgent).toBe(withEmptyAgent);
  });

  it('handles agentPrompt with special characters', () => {
    const task = makeTask({ assignedAgent: 'regex-agent' });
    const prompt = buildWorkerPrompt(task, 'Use pattern: /[a-z]+/g and $1 replacement');
    expect(prompt).toContain('Use pattern: /[a-z]+/g and $1 replacement');
  });

  it('handles agentPrompt with newlines', () => {
    const task = makeTask({ assignedAgent: 'multiline-agent' });
    const agentPrompt = 'Line 1\nLine 2\nLine 3';
    const prompt = buildWorkerPrompt(task, agentPrompt);
    expect(prompt).toContain('Line 1');
    expect(prompt).toContain('Line 3');
  });

  it('includes combined systemPrompt + expertise + PROMPT.md content', () => {
    const task = makeTask({ assignedAgent: 'test-writer' });
    const combined = 'You are a test expert.\n\nExpertise: testing, coverage\n\nDetailed prompt from PROMPT.md';
    const prompt = buildWorkerPrompt(task, combined);
    expect(prompt).toContain('You are a test expert.');
    expect(prompt).toContain('Expertise: testing, coverage');
    expect(prompt).toContain('Detailed prompt from PROMPT.md');
    expect(prompt).toContain('=== Agent: test-writer ===');
  });

  it('agent block appears for forceModel tasks with assigned agent', () => {
    const task = makeTask({ assignedAgent: 'bug-fixer', forceModel: 'claude-opus-4-8' } as Partial<Task>);
    const prompt = buildWorkerPrompt(task, 'Bug fixing specialist.');
    expect(prompt).toContain('=== Agent: bug-fixer ===');
    expect(prompt).toContain('Bug fixing specialist.');
  });

  it('threads effective persona_render config into the V3-selected guidance slice', () => {
    const emptyRoot = makeEmptyProjectRoot();
    const agentPrompt = [
      '# Implementer',
      'Full persona body.',
      '<!-- guidance:implementation-start -->',
      'Implementation-specific guidance.',
      '<!-- guidance:implementation-end -->',
      '<!-- guidance:default-start -->',
      'Default guidance.',
      '<!-- guidance:default-end -->',
    ].join('\n');
    const task = makeTask({
      assignedAgent: 'implementer',
      routingMeta: {
        routingVersion: 'v3',
        workType: 'build',
        personaSlices: ['implementation', 'default'],
      },
    });

    try {
      const prompt = buildWorkerPrompt(
        task,
        agentPrompt,
        undefined,
        emptyRoot,
        { prompt: { persona_render: 'guidance' } } as Parameters<typeof buildWorkerPrompt>[4],
      );

      expect(prompt).toContain('Implementation-specific guidance.');
      expect(prompt).not.toContain('Default guidance.');
      expect(prompt).not.toContain('Full persona body.');
    } finally {
      rmSync(emptyRoot, { recursive: true, force: true });
    }
  });
});

// ─── DirectiveTaskSchema ───────────────────────────────────────────────────

describe('DirectiveTaskSchema', () => {
  it('accepts a valid task with all required fields', () => {
    const result = DirectiveTaskSchema.safeParse({
      title: 'Implement feature',
      files: ['src/core/utils.ts'],
      scope: ['src/core/'],
      description: 'Add utility helpers',
    });
    expect(result.success).toBe(true);
  });

  it('accepts optional model field with valid value', () => {
    const result = DirectiveTaskSchema.safeParse({
      title: 'Audit security',
      model: 'claude-opus-4-8',
      files: [],
      scope: [],
      description: 'Security review',
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.model).toBe('claude-opus-4-8');
  });

  it('rejects invalid model value', () => {
    const result = DirectiveTaskSchema.safeParse({
      title: 'Bad model task',
      model: 'gpt4',
      files: [],
      scope: [],
      description: 'Test',
    });
    expect(result.success).toBe(false);
  });

  it('accepts all valid model values', () => {
    for (const model of ['claude-opus-4-8', 'claude-sonnet-5', 'claude-haiku-4-5-20251001'] as const) {
      const result = DirectiveTaskSchema.safeParse({
        title: 'Task',
        model,
        files: [],
        scope: [],
        description: 'desc',
      });
      expect(result.success).toBe(true);
    }
  });

  it('accepts optional effort field with valid value', () => {
    const result = DirectiveTaskSchema.safeParse({
      title: 'Hard task',
      effort: 'high',
      files: [],
      scope: [],
      description: 'Hard work',
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.effort).toBe('high');
  });

  it('rejects invalid effort value', () => {
    const result = DirectiveTaskSchema.safeParse({
      title: 'Bad effort',
      effort: 'max',
      files: [],
      scope: [],
      description: 'Test',
    });
    expect(result.success).toBe(false);
  });

  it('accepts all valid effort values', () => {
    for (const effort of ['low', 'normal', 'high'] as const) {
      const result = DirectiveTaskSchema.safeParse({
        title: 'Task',
        effort,
        files: [],
        scope: [],
        description: 'desc',
      });
      expect(result.success).toBe(true);
    }
  });

  it('rejects missing title', () => {
    const result = DirectiveTaskSchema.safeParse({
      files: [],
      scope: [],
      description: 'No title here',
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty title', () => {
    const result = DirectiveTaskSchema.safeParse({
      title: '',
      files: [],
      scope: [],
      description: 'Empty title',
    });
    expect(result.success).toBe(false);
  });

  it('accepts optional tests array', () => {
    const result = DirectiveTaskSchema.safeParse({
      title: 'Tested task',
      files: [],
      scope: [],
      description: 'Has tests',
      tests: ['All pass', 'No regressions'],
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.tests).toHaveLength(2);
  });

  it('allows model and effort to be undefined (optional)', () => {
    const result = DirectiveTaskSchema.safeParse({
      title: 'No overrides',
      files: ['src/core/foo.ts'],
      scope: ['src/core/'],
      description: 'Plain task',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.model).toBeUndefined();
      expect(result.data.effort).toBeUndefined();
    }
  });
});

// ─── DirectiveSchema ───────────────────────────────────────────────────────

describe('DirectiveSchema', () => {
  function validDirective() {
    return {
      goal: 'Refactor the codebase',
      tasks: [
        {
          title: 'Extract module',
          files: ['src/orchestra/brain.ts'],
          scope: ['src/orchestra/'],
          description: 'Move logic to new file',
        },
      ],
    };
  }

  it('accepts a valid directive with goal and one task', () => {
    const result = DirectiveSchema.safeParse(validDirective());
    expect(result.success).toBe(true);
  });

  it('accepts multiple tasks', () => {
    const input = {
      ...validDirective(),
      tasks: [
        { title: 'Task 1', files: [], scope: [], description: 'First' },
        { title: 'Task 2', files: [], scope: [], description: 'Second' },
      ],
    };
    const result = DirectiveSchema.safeParse(input);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.tasks).toHaveLength(2);
  });

  it('rejects missing goal', () => {
    const { goal: _g, ...noGoal } = validDirective();
    const result = DirectiveSchema.safeParse(noGoal);
    expect(result.success).toBe(false);
  });

  it('rejects empty goal string', () => {
    const result = DirectiveSchema.safeParse({ ...validDirective(), goal: '' });
    expect(result.success).toBe(false);
  });

  it('rejects missing tasks field', () => {
    const { tasks: _t, ...noTasks } = validDirective();
    const result = DirectiveSchema.safeParse(noTasks);
    expect(result.success).toBe(false);
  });

  it('rejects empty tasks array', () => {
    const result = DirectiveSchema.safeParse({ ...validDirective(), tasks: [] });
    expect(result.success).toBe(false);
  });

  it('rejects when a task in array has invalid model', () => {
    const result = DirectiveSchema.safeParse({
      goal: 'Do stuff',
      tasks: [
        { title: 'Bad task', model: 'unknown-model', files: [], scope: [], description: 'test' },
      ],
    });
    expect(result.success).toBe(false);
  });

  it('detects partial valid + partial invalid tasks', () => {
    const result = DirectiveSchema.safeParse({
      goal: 'Mixed tasks',
      tasks: [
        { title: 'Good task', files: [], scope: [], description: 'Fine' },
        { title: '', files: [], scope: [], description: 'Empty title — bad' },
      ],
    });
    expect(result.success).toBe(false);
  });
});

// ─── validateDirective ─────────────────────────────────────────────────────

describe('validateDirective', () => {
  function validInput() {
    return {
      goal: 'Clean up the codebase',
      tasks: [
        {
          title: 'Refactor utils',
          files: ['src/core/utils.ts'],
          scope: ['src/core/'],
          description: 'Extract shared helpers',
          tests: ['All helpers tested'],
        },
      ],
    };
  }

  it('returns success=true for valid directive', () => {
    const result = validateDirective(validInput());
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.goal).toBe('Clean up the codebase');
      expect(result.data.tasks).toHaveLength(1);
    }
  });

  it('returns success=false for missing goal', () => {
    const { goal: _g, ...noGoal } = validInput();
    const result = validateDirective(noGoal);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toContain('DIRECTIVES validation failed');
  });

  it('returns clear error message for missing goal field', () => {
    const result = validateDirective({ tasks: [{ title: 'T', files: [], scope: [], description: 'D' }] });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/goal/i);
    }
  });

  it('returns success=false for empty tasks array', () => {
    const result = validateDirective({ ...validInput(), tasks: [] });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBeTruthy();
  });

  it('returns error mentioning task field for invalid model', () => {
    const result = validateDirective({
      goal: 'Some goal',
      tasks: [{ title: 'T', model: 'gpt4', files: [], scope: [], description: 'D' }],
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBeTruthy();
  });

  it('returns error mentioning task field for invalid effort', () => {
    const result = validateDirective({
      goal: 'Some goal',
      tasks: [{ title: 'T', effort: 'extreme', files: [], scope: [], description: 'D' }],
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBeTruthy();
  });

  it('returns error for missing title in a task', () => {
    const result = validateDirective({
      goal: 'Goal',
      tasks: [{ files: [], scope: [], description: 'No title' }],
    });
    expect(result.success).toBe(false);
  });

  it('returns error for empty title in a task', () => {
    const result = validateDirective({
      goal: 'Goal',
      tasks: [{ title: '', files: [], scope: [], description: 'Empty title' }],
    });
    expect(result.success).toBe(false);
  });

  it('does not throw on invalid input — returns error object instead', () => {
    expect(() => validateDirective(null)).not.toThrow();
    expect(() => validateDirective(42)).not.toThrow();
    expect(() => validateDirective(undefined)).not.toThrow();
    const result = validateDirective(null);
    expect(result.success).toBe(false);
  });

  it('succeeds with optional fields absent', () => {
    const result = validateDirective({
      goal: 'Minimal directive',
      tasks: [{ title: 'Only required fields', files: [], scope: [], description: 'Minimal' }],
    });
    expect(result.success).toBe(true);
  });

  it('succeeds with all optional fields present', () => {
    const result = validateDirective({
      goal: 'Full directive',
      tasks: [{
        title: 'Full task',
        model: 'claude-sonnet-5',
        effort: 'normal',
        files: ['src/core/foo.ts'],
        scope: ['src/core/'],
        description: 'Complete description',
        tests: ['Test A', 'Test B'],
      }],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.tasks[0].model).toBe('claude-sonnet-5');
      expect(result.data.tasks[0].effort).toBe('normal');
      expect(result.data.tasks[0].tests).toEqual(['Test A', 'Test B']);
    }
  });

  it('error message starts with DIRECTIVES validation failed prefix', () => {
    const result = validateDirective({});
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/^DIRECTIVES validation failed:/);
    }
  });
});

// ─── Provider Field (Task 038-002) ──────────────────────────────────────────

describe('parseStructuredDirectives — provider parsing', () => {
  it('parses "Provider: codex" into provider field', () => {
    const content = '## Task 1: Codex Task\n- Provider: codex\n- Scope: src/core/\n\n### Description\nUse codex.';
    const tasks = parseStructuredDirectives(content);
    expect(tasks[0].provider).toBe('codex');
  });

  it('parses "Provider: gemini" into provider field', () => {
    const content = '## Task 1: Gemini Task\n- Provider: gemini\n\n### Description\nUse gemini.';
    const tasks = parseStructuredDirectives(content);
    expect(tasks[0].provider).toBe('gemini');
  });

  it('parses "Provider: claude" into provider field', () => {
    const content = '## Task 1: Claude Task\n- Provider: claude\n\n### Description\nUse claude.';
    const tasks = parseStructuredDirectives(content);
    expect(tasks[0].provider).toBe('claude');
  });

  it('returns undefined provider when no Provider line', () => {
    const content = '## Task 1: No Provider\n\n### Description\nDefault.';
    const tasks = parseStructuredDirectives(content);
    expect(tasks[0].provider).toBeUndefined();
  });

  it('ignores invalid provider values', () => {
    const content = '## Task 1: Bad Provider\n- Provider: openai\n\n### Description\nInvalid.';
    const tasks = parseStructuredDirectives(content);
    expect(tasks[0].provider).toBeUndefined();
  });

  it('case-insensitive Provider parsing', () => {
    const content = '## Task 1: Case Test\n- provider: CODEX\n\n### Description\nTest.';
    const tasks = parseStructuredDirectives(content);
    expect(tasks[0].provider).toBe('codex');
  });

  it('parses Provider with leading dash prefix', () => {
    const content = '## Task 1: Dash Prefix\n- Provider: gemini\n\n### Description\nTest.';
    const tasks = parseStructuredDirectives(content);
    expect(tasks[0].provider).toBe('gemini');
  });

  it('parses Provider alongside Model and Effort', () => {
    const content = '## Task 1: Full Override\n- Model: o3\n- Effort: high\n- Provider: codex\n- Scope: src/\n\n### Description\nBig task.';
    const tasks = parseStructuredDirectives(content);
    expect(tasks[0].provider).toBe('codex');
    expect(tasks[0].forceModel).toBe('o3');
    expect(tasks[0].forceEffort).toBe('high');
  });
});

describe('DirectiveTaskSchema — provider field', () => {
  it('accepts valid provider "codex"', () => {
    const result = DirectiveTaskSchema.safeParse({
      title: 'Codex task',
      provider: 'codex',
      files: [],
      scope: [],
      description: 'desc',
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.provider).toBe('codex');
  });

  it('accepts valid provider "gemini"', () => {
    const result = DirectiveTaskSchema.safeParse({
      title: 'Gemini task',
      provider: 'gemini',
      files: [],
      scope: [],
      description: 'desc',
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.provider).toBe('gemini');
  });

  it('accepts valid provider "claude"', () => {
    const result = DirectiveTaskSchema.safeParse({
      title: 'Claude task',
      provider: 'claude',
      files: [],
      scope: [],
      description: 'desc',
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.provider).toBe('claude');
  });

  it('rejects invalid provider value', () => {
    const result = DirectiveTaskSchema.safeParse({
      title: 'Bad provider',
      provider: 'openai',
      files: [],
      scope: [],
      description: 'desc',
    });
    expect(result.success).toBe(false);
  });

  it('allows provider to be undefined (optional)', () => {
    const result = DirectiveTaskSchema.safeParse({
      title: 'No provider',
      files: [],
      scope: [],
      description: 'desc',
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.provider).toBeUndefined();
  });
});

describe('createTask — provider field', () => {
  it('passes provider to task when specified', () => {
    const task = createTask(makeBaseParams({ model: 'gpt-5.5', provider: 'codex' }), 1);
    expect(task.provider).toBe('codex');
  });

  it('provider is undefined when not specified', () => {
    const task = createTask(makeBaseParams(), 1);
    expect(task.provider).toBeUndefined();
  });

  it('fails loudly when model and provider identities conflict', () => {
    expect(() => createTask(
      makeBaseParams({ model: 'claude-opus-4-8', provider: 'codex' }),
      1,
    )).toThrow(/E_MODEL_PROVIDER_MISMATCH/);
  });

  it('does not warn when model and provider are compatible', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const task = createTask(makeBaseParams({ model: 'o3', provider: 'codex' }), 1);
    expect(task.provider).toBe('codex');
    expect(task.model).toBe('o3');
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('does not warn when provider is not specified', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const task = createTask(makeBaseParams({ model: 'claude-opus-4-8' }), 1);
    expect(task.provider).toBeUndefined();
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('provider appears in created task JSON', () => {
    const task = createTask(makeBaseParams({ model: 'gemini-2.5-pro', provider: 'gemini' }), 1);
    const json = JSON.parse(JSON.stringify(task));
    expect(json.provider).toBe('gemini');
  });

  it('compatible claude model with claude provider does not warn', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const task = createTask(makeBaseParams({ model: 'claude-opus-4-8', provider: 'claude' }), 1);
    expect(task.provider).toBe('claude');
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('compatible gemini model with gemini provider does not warn', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const task = createTask(makeBaseParams({ model: 'gemini-2.5-pro' as any, provider: 'gemini' }), 1);
    expect(task.provider).toBe('gemini');
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});

// ═══ parseBulletOrNumberedTasks ════════════════════════════════════

describe('parseBulletOrNumberedTasks', () => {
  it('parses "- Task: <title>" format', () => {
    const content = `# Goal\n\n- Task: Build auth module\n- Task: Add tests`;
    const tasks = parseBulletOrNumberedTasks(content);
    expect(tasks.length).toBeGreaterThanOrEqual(2);
    expect(tasks[0]!.title).toBe('Build auth module');
    expect(tasks[1]!.title).toBe('Add tests');
  });

  it('parses numbered list "1. <title>" format', () => {
    const content = `1. Build auth module\n2. Add UI components\n3. Write tests`;
    const tasks = parseBulletOrNumberedTasks(content);
    expect(tasks.length).toBe(3);
    expect(tasks[0]!.title).toBe('Build auth module');
    expect(tasks[2]!.title).toBe('Write tests');
  });

  it('parses "1) <title>" format', () => {
    const content = `1) First task\n2) Second task`;
    const tasks = parseBulletOrNumberedTasks(content);
    expect(tasks.length).toBe(2);
    expect(tasks[0]!.title).toBe('First task');
  });

  it('parses "* Task: <title>" format', () => {
    const content = `* Task: Implement login\n* Task: Implement logout`;
    const tasks = parseBulletOrNumberedTasks(content);
    expect(tasks.length).toBe(2);
    expect(tasks[0]!.title).toBe('Implement login');
  });

  it('extracts Model override from sub-lines', () => {
    const content = `- Task: Complex refactor\n  - Model: claude-opus-4-8`;
    const tasks = parseBulletOrNumberedTasks(content);
    expect(tasks[0]!.forceModel).toBe('claude-opus-4-8');
  });

  it('extracts Effort override from sub-lines', () => {
    const content = `1. Quick fix\n   Effort: low`;
    const tasks = parseBulletOrNumberedTasks(content);
    expect(tasks[0]!.forceEffort).toBe('low');
  });

  it('returns empty array for plain prose with no task markers', () => {
    const content = `This is just a description.\nNo tasks here.`;
    const tasks = parseBulletOrNumberedTasks(content);
    expect(tasks).toHaveLength(0);
  });

  it('ignores lines with title shorter than 3 characters', () => {
    const content = `1. OK\n2. Build proper feature`;
    const tasks = parseBulletOrNumberedTasks(content);
    expect(tasks.length).toBeLessThanOrEqual(2);
    const longTitles = tasks.filter(t => t.title.length >= 3);
    expect(longTitles.length).toBeGreaterThanOrEqual(1);
  });
});

// ═══ parseStructuredDirectives bullet fallback ════════════════════

describe('parseStructuredDirectives — bullet/numbered fallback', () => {
  it('falls back to bullet format when no ## Task headings present', () => {
    const content = `# My Project\n\n- Task: Implement feature A\n- Task: Write tests\n`;
    const tasks = parseStructuredDirectives(content);
    expect(tasks.length).toBeGreaterThanOrEqual(2);
    expect(tasks[0]!.title).toBe('Implement feature A');
  });

  it('falls back to numbered list when no ## Task headings present', () => {
    const content = `# Tasks\n\n1. Build backend API\n2. Add frontend UI\n3. Integration tests\n`;
    const tasks = parseStructuredDirectives(content);
    expect(tasks.length).toBe(3);
    expect(tasks[0]!.title).toBe('Build backend API');
  });

  it('still parses ## Task headings when present', () => {
    const content = `# Sprint\n\n## Task 1: Fix bug\n- Dosya: src/core/utils.ts\n\n## Task 2: Add tests\n`;
    const tasks = parseStructuredDirectives(content);
    expect(tasks.length).toBe(2);
    expect(tasks[0]!.title).toBe('Fix bug');
  });
});

// ─── Sprint 059-004: Scope & GO/NO-GO Fix Tests ─────────────────────────────

describe('extractScopeFromDirective — docs/ support', () => {
  it('should extract docs/ directory paths', () => {
    const scope = extractScopeFromDirective('Files: docs/analysis/report.md, src/core/utils.ts');
    expect(scope.directories).toContain('docs/analysis/');
  });

  it('should add standalone doc files like CHANGELOG.md to filesWrite', () => {
    const scope = extractScopeFromDirective('Update CHANGELOG.md with sprint entries');
    expect(scope.filesWrite).toContain('CHANGELOG.md');
    // Standalone root-level .md files do NOT force docs/ into directories
    expect(scope.directories).not.toContain('docs/');
  });

  it('should not duplicate docs/ directory', () => {
    const scope = extractScopeFromDirective('Files: docs/release/ and CHANGELOG.md');
    const docsCount = scope.directories.filter(d => d === 'docs/').length;
    // docs/release/ is already a docs dir, so standalone docs/ may or may not be added
    // but should not have duplicate entries
    const allDocs = scope.directories.filter(d => d.startsWith('docs/'));
    expect(allDocs.length).toBeGreaterThanOrEqual(1);
  });
});

// ─── Sprint 069-006: Standalone root file support ──────────────────────────

describe('extractScopeFromDirective — standalone root files', () => {
  it('adds DECKENT.md to filesWrite', () => {
    const scope = extractScopeFromDirective('Files: DECKENT.md, .gitignore');
    expect(scope.filesWrite).toContain('DECKENT.md');
  });

  it('adds .gitignore to filesWrite', () => {
    const scope = extractScopeFromDirective('Files: DECKENT.md, .gitignore');
    expect(scope.filesWrite).toContain('.gitignore');
  });

  it('adds docker-compose.yml to filesWrite', () => {
    const scope = extractScopeFromDirective('Files: docker-compose.yml, .env');
    expect(scope.filesWrite).toContain('docker-compose.yml');
  });

  it('adds .github/workflows yaml files via directory path', () => {
    const scope = extractScopeFromDirective('Files: config.yaml, setup.yml');
    expect(scope.filesWrite).toContain('config.yaml');
    expect(scope.filesWrite).toContain('setup.yml');
  });

  it('does not add src/core/config.ts as standalone "config.ts" when path-prefixed version already present', () => {
    const scope = extractScopeFromDirective('Files: src/core/config.ts');
    // Should contain the full path, NOT a duplicate standalone entry
    expect(scope.filesWrite).toContain('src/core/config.ts');
    const standaloneCount = scope.filesWrite.filter(f => f === 'config.ts').length;
    expect(standaloneCount).toBe(0);
  });

  it('does not duplicate DECKENT.md when both blocks match', () => {
    const scope = extractScopeFromDirective('Files: DECKENT.md');
    const count = scope.filesWrite.filter(f => f === 'DECKENT.md').length;
    expect(count).toBe(1);
  });

  it('does NOT add .deckent as filesWrite when path is .deckent/config.json', () => {
    const scope = extractScopeFromDirective('Files: .deckent/config.json');
    expect(scope.filesWrite).not.toContain('.deckent');
    expect(scope.filesWrite).toContain('.deckent/config.json');
  });

  it('does NOT add .brain as filesWrite when path is .brain/MEMORY.md', () => {
    const scope = extractScopeFromDirective('.brain/MEMORY.md');
    expect(scope.filesWrite).not.toContain('.brain');
  });

  it('does NOT add .contracts as filesWrite when path is .contracts/api-surface.md', () => {
    const scope = extractScopeFromDirective('.contracts/api-surface.md');
    expect(scope.filesWrite).not.toContain('.contracts');
  });

  it('still matches real standalone dotfiles after directory prefix fix', () => {
    const scope = extractScopeFromDirective('.gitignore, .npmrc, .deckent/config.json');
    expect(scope.filesWrite).toContain('.gitignore');
    expect(scope.filesWrite).toContain('.npmrc');
    expect(scope.filesWrite).not.toContain('.deckent');
  });
});

describe('enrichScopeWithTestFiles', () => {
  it('should add test file patterns when tests/ is in directories', () => {
    const scope = {
      directories: ['src/core/', 'tests/core/'],
      filesRead: [],
      filesWrite: ['src/core/config.ts', 'src/core/utils.ts'],
    };
    const enriched = enrichScopeWithTestFiles(scope, scope.filesWrite);
    expect(enriched.filesWrite).toContain('tests/core/config.test.ts');
    expect(enriched.filesWrite).toContain('tests/core/utils.test.ts');
  });

  it('should not add test patterns when no tests/ directory', () => {
    const scope = {
      directories: ['src/core/'],
      filesRead: [],
      filesWrite: ['src/core/config.ts'],
    };
    const enriched = enrichScopeWithTestFiles(scope, scope.filesWrite);
    expect(enriched.filesWrite).toEqual(['src/core/config.ts']);
  });

  it('should not add test patterns when test files already exist in filesWrite', () => {
    const scope = {
      directories: ['src/core/', 'tests/core/'],
      filesRead: [],
      filesWrite: ['src/core/config.ts', 'tests/core/config.test.ts'],
    };
    const enriched = enrichScopeWithTestFiles(scope, scope.filesWrite);
    // Should not duplicate
    const testFiles = enriched.filesWrite.filter(f => f.includes('.test.'));
    expect(testFiles).toEqual(['tests/core/config.test.ts']);
  });

  it('should not mutate the original scope', () => {
    const scope = {
      directories: ['src/core/', 'tests/core/'],
      filesRead: [],
      filesWrite: ['src/core/config.ts'],
    };
    const original = [...scope.filesWrite];
    enrichScopeWithTestFiles(scope, scope.filesWrite);
    expect(scope.filesWrite).toEqual(original);
  });
});

describe('parseStructuredDirectives — filesWrite enrichment', () => {
  it('should add test file patterns when tests/ is in scope directories', () => {
    const content = `# Sprint

## Task 1: Fix config
- Files: src/core/config.ts
- Scope: src/core/, tests/core/
`;
    const tasks = parseStructuredDirectives(content);
    expect(tasks[0]!.scope.filesWrite).toContain('tests/core/config.test.ts');
  });
});

describe('parseStructuredDirectives — testTarget extraction for GO/NO-GO', () => {
  it('should extract testTarget from Test: line', () => {
    const content = `# Sprint

## Task 1: Add feature
- Files: src/core/config.ts
- Scope: src/core/
- Test: 10+ test

### Description
Some description here.
`;
    const tasks = parseStructuredDirectives(content);
    expect(tasks[0]!.testTarget).toBe('10+ test');
  });
});

// ─── createTask — assignedAgent/assignedSkills defaults (Sprint 061) ───────

describe('createTask — assignedAgent/assignedSkills defaults', () => {
  it('initializes assignedAgent to "generic" by default', () => {
    const task = createTask(makeBaseParams(), 1);
    expect(task.assignedAgent).toBe('generic');
  });

  it('initializes assignedSkills to empty array by default', () => {
    const task = createTask(makeBaseParams(), 1);
    expect(task.assignedSkills).toEqual([]);
  });

  it('assignedAgent persists through JSON.stringify/parse', () => {
    const task = createTask(makeBaseParams(), 1);
    const serialized = JSON.stringify(task);
    const parsed = JSON.parse(serialized);
    expect(parsed.assignedAgent).toBe('generic');
  });

  it('assignedSkills persists through JSON.stringify/parse', () => {
    const task = createTask(makeBaseParams(), 1);
    const serialized = JSON.stringify(task);
    const parsed = JSON.parse(serialized);
    expect(parsed.assignedSkills).toEqual([]);
  });

  it('assignedAgent can be overwritten after creation', () => {
    const task = createTask(makeBaseParams(), 1);
    expect(task.assignedAgent).toBe('generic');
    task.assignedAgent = 'security-auditor';
    expect(task.assignedAgent).toBe('security-auditor');
  });

  it('assignedSkills can be populated after creation', () => {
    const task = createTask(makeBaseParams(), 1);
    expect(task.assignedSkills).toEqual([]);
    task.assignedSkills = ['typescript-expert', 'testing-expert'];
    expect(task.assignedSkills).toHaveLength(2);
    expect(task.assignedSkills).toContain('typescript-expert');
  });

  it('assignedAgent field exists in JSON keys', () => {
    const task = createTask(makeBaseParams(), 1);
    const json = JSON.stringify(task, null, 2);
    expect(json).toContain('"assignedAgent"');
  });

  it('assignedSkills field exists in JSON keys', () => {
    const task = createTask(makeBaseParams(), 1);
    const json = JSON.stringify(task, null, 2);
    expect(json).toContain('"assignedSkills"');
  });

  it('assignedAgent survives mutation + re-serialization', () => {
    const task = createTask(makeBaseParams(), 1);
    task.assignedAgent = 'bug-fixer';
    task.assignedSkills = ['testing-expert'];
    const roundTripped = JSON.parse(JSON.stringify(task));
    expect(roundTripped.assignedAgent).toBe('bug-fixer');
    expect(roundTripped.assignedSkills).toEqual(['testing-expert']);
  });

  it('all created tasks have assignedAgent regardless of params', () => {
    const params1 = makeBaseParams({ model: 'claude-opus-4-8', effort: 'high', priority: 'CRITICAL' });
    const params2 = makeBaseParams({ model: 'claude-haiku-4-5-20251001', effort: 'low', priority: 'LOW' });
    const params3 = makeBaseParams({ forceModel: 'claude-opus-4-8', forceEffort: 'high' });
    const task1 = createTask(params1, 1);
    const task2 = createTask(params2, 2);
    const task3 = createTask(params3, 3);
    expect(task1.assignedAgent).toBe('generic');
    expect(task2.assignedAgent).toBe('generic');
    expect(task3.assignedAgent).toBe('generic');
    expect(task1.assignedSkills).toEqual([]);
    expect(task2.assignedSkills).toEqual([]);
    expect(task3.assignedSkills).toEqual([]);
  });
});

// ─── plannerTaskToParams — PlannerTask override fields pass-through ──────────

describe('plannerTaskToParams — override fields pass-through', () => {
  it('passes forceAgent from PlannerTask to CreateTaskParams', () => {
    const pt = makePlannerTask({ forceAgent: 'security-auditor' });
    const params = plannerTaskToParams(pt, 'sprint-066', 'claude-sonnet-5');
    expect(params.forceAgent).toBe('security-auditor');
  });

  it('passes forceSkills from PlannerTask to CreateTaskParams', () => {
    const pt = makePlannerTask({ forceSkills: ['typescript-expert', 'testing-expert'] });
    const params = plannerTaskToParams(pt, 'sprint-066', 'claude-sonnet-5');
    expect(params.forceSkills).toEqual(['typescript-expert', 'testing-expert']);
  });

  it('passes forceModel from PlannerTask to CreateTaskParams', () => {
    const pt = makePlannerTask();
    pt.forceModel = pt.model;
    const params = plannerTaskToParams(pt, 'sprint-066', pt.model);
    expect(params.forceModel).toBe(pt.forceModel);
  });

  it('passes excludeAgent from PlannerTask to CreateTaskParams', () => {
    const pt = makePlannerTask({ excludeAgent: ['doc-writer', 'refactorer'] });
    const params = plannerTaskToParams(pt, 'sprint-066', 'claude-sonnet-5');
    expect(params.excludeAgent).toEqual(['doc-writer', 'refactorer']);
  });

  it('passes excludeSkills from PlannerTask to CreateTaskParams', () => {
    const pt = makePlannerTask({ excludeSkills: ['ci-testing'] });
    const params = plannerTaskToParams(pt, 'sprint-066', 'claude-sonnet-5');
    expect(params.excludeSkills).toEqual(['ci-testing']);
  });

  it('override fields are undefined when not set in PlannerTask', () => {
    const pt = makePlannerTask();
    const params = plannerTaskToParams(pt, 'sprint-066', 'claude-sonnet-5');
    expect(params.forceAgent).toBeUndefined();
    expect(params.forceSkills).toBeUndefined();
    expect(params.excludeAgent).toBeUndefined();
    expect(params.excludeSkills).toBeUndefined();
  });

  it('applies enrichScopeWithTestFiles to scope when tests/ directory is present', () => {
    const pt = makePlannerTask({
      scope: {
        directories: ['src/core/', 'tests/core/'],
        filesRead: [],
        filesWrite: ['src/core/config.ts'],
      },
    });
    const params = plannerTaskToParams(pt, 'sprint-066', 'claude-sonnet-5');
    // enrichScopeWithTestFiles should add tests/core/config.test.ts
    expect(params.scope.filesWrite).toContain('tests/core/config.test.ts');
  });

  it('scope unchanged when no tests/ directory in PlannerTask', () => {
    const pt = makePlannerTask({
      scope: {
        directories: ['src/orchestra/'],
        filesRead: [],
        filesWrite: ['src/orchestra/brain.ts'],
      },
    });
    const params = plannerTaskToParams(pt, 'sprint-066', 'claude-sonnet-5');
    expect(params.scope.filesWrite).toEqual(['src/orchestra/brain.ts']);
    expect(params.scope.directories).toEqual(['src/orchestra/']);
  });
});

// ─── buildWorkerPrompt — effort-based skill token budget ─────────────────────

describe('buildWorkerPrompt — effort maxTokens budget', () => {
  it('high effort task allows longer skill prompts (2500 token budget)', () => {
    const task = makeTask({
      effort: 'high',
      forceEffort: 'high',
      assignedSkills: ['typescript-expert'],
    });
    const longSkillContent = 'A'.repeat(2500);
    const prompt = buildWorkerPrompt(task, undefined, [
      { name: 'typescript-expert', content: longSkillContent },
    ]);
    // High effort should allow up to 2500 chars per skill (not truncated to 2000)
    expect(prompt).toContain('typescript-expert');
    const skillSectionMatch = prompt.match(/=== Skills ===([\s\S]*?)(?=\n\n===)/);
    expect(skillSectionMatch).not.toBeNull();
    // Should contain more content than low-effort would allow
    const skillSection = skillSectionMatch![1] ?? '';
    expect(skillSection.length).toBeGreaterThan(1000);
  });

  it('low effort task still injects full skill content (Sprint 182 PQ-2 F2: no effort-based clipping)', () => {
    const task = makeTask({
      effort: 'low',
      forceEffort: 'low',
      assignedSkills: ['typescript-expert'],
    });
    const longSkillContent = 'A'.repeat(2000);
    const prompt = buildWorkerPrompt(task, undefined, [
      { name: 'typescript-expert', content: longSkillContent },
    ]);
    // Sprint 182 PQ-2 (F2): EFFORT_TOKEN_MAP removed; full content for every effort level.
    expect(prompt).toContain('typescript-expert');
    expect(prompt).toContain(longSkillContent);
  });

  it('normal effort uses 1500 token budget (unchanged from default)', () => {
    const task = makeTask({
      effort: 'normal',
      assignedSkills: ['testing-expert'],
    });
    const content1500 = 'B'.repeat(1500);
    const prompt = buildWorkerPrompt(task, undefined, [
      { name: 'testing-expert', content: content1500 },
    ]);
    expect(prompt).toContain('testing-expert');
  });

  it('high effort includes more skill context than low effort for same content', () => {
    const sharedContent = 'X'.repeat(2000);

    const highTask = makeTask({ effort: 'high', forceEffort: 'high', assignedSkills: ['ts-skill'] });
    const lowTask = makeTask({ effort: 'low', forceEffort: 'low', assignedSkills: ['ts-skill'] });

    const highPrompt = buildWorkerPrompt(highTask, undefined, [{ name: 'ts-skill', content: sharedContent }]);
    const lowPrompt = buildWorkerPrompt(lowTask, undefined, [{ name: 'ts-skill', content: sharedContent }]);

    // High effort prompt should contain more skill content
    expect(highPrompt.length).toBeGreaterThan(lowPrompt.length);
  });
});

// ═══ Sprint 134-002: Scope Parser Hardening — Edge Case Tests ════════════

describe('extractScopeFromDirective — .brain/ prefix path', () => {
  it('recognizes .brain/ as a directory scope', () => {
    const scope = extractScopeFromDirective('- Scope: .brain/');
    expect(scope.directories).toContain('.brain/');
  });

  it('recognizes .brain/ in multi-scope with other dirs', () => {
    const scope = extractScopeFromDirective('- Scope: .brain/, docs/vision/');
    expect(scope.directories).toContain('.brain/');
    expect(scope.directories).toContain('docs/vision/');
  });
});

describe('extractScopeFromDirective — root scope "."', () => {
  it('parses "." as root scope → "./"', () => {
    const scope = extractScopeFromDirective('- Scope: .');
    expect(scope.directories).toContain('./');
  });

  it('parses multi-scope with "." root + named directory', () => {
    const scope = extractScopeFromDirective('- Scope: docs/analysis/, .');
    expect(scope.directories).toContain('./');
    expect(scope.directories).toContain('docs/analysis/');
  });
});

describe('parseStructuredDirectives — title code snippet does not pollute scope', () => {
  it('does not create false positive scope from results.find() in title', () => {
    const content = `## Task 1: Fix results.find() junk entry
- Scope: src/orchestra/
- Files: src/orchestra/result-collector.ts

### Description
Fix the results.find() bug that creates junk entries.`;
    const tasks = parseStructuredDirectives(content);
    expect(tasks).toHaveLength(1);
    // Scope should come from explicit Scope:/Files: lines, not from title
    expect(tasks[0]!.scope.directories).toContain('src/orchestra/');
    // The title should NOT inject false scope entries from "results.find()"
    expect(tasks[0]!.scope.filesWrite).not.toContain('results.find');
  });

  it('does not create scope from code-like title patterns', () => {
    const content = `## Task 1: Update parseConfig() to handle edge cases
- Scope: src/core/

### Description
Handle edge cases in parseConfig().`;
    const tasks = parseStructuredDirectives(content);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]!.scope.directories).toContain('src/core/');
  });
});

describe('parseStructuredDirectives — description paths do not become scope', () => {
  it('does not add source paths mentioned only in prose to filesWrite or directories', () => {
    const content = `## Task 1: Document work model reference
- Agent: doc-writer

### Description
Document how \`src/core/work-model.ts\` relates to task classification without changing source files.

**Test:** docs-only review`;

    const tasks = parseStructuredDirectives(content);

    expect(tasks).toHaveLength(1);
    expect(tasks[0]!.scope.filesWrite).not.toContain('src/core/work-model.ts');
    expect(tasks[0]!.scope.directories).not.toContain('src/core/');
    expect(tasks[0]!.scope.filesWrite).toEqual([]);
    expect(tasks[0]!.scope.directories).toEqual([]);
  });
});

describe('extractScopeFromDirective — .deckent/ prefix path', () => {
  it('recognizes .deckent/ as a directory scope', () => {
    const scope = extractScopeFromDirective('- Scope: .deckent/');
    expect(scope.directories).toContain('.deckent/');
  });
});

describe('extractScopeFromDirective — absolute path scope reject', () => {
  it('does not parse /usr/local/bin as a valid scope', () => {
    const scope = extractScopeFromDirective('- Scope: /usr/local/bin');
    // extractScopeFromDirective adds trailing / but /usr/local/bin/ is NOT src/ or tests/
    // The Scope: label will still parse it, but it should be caught by downstream validation
    // At minimum, it should not match directory regex patterns for src/tests/docs
    const hasSrcOrTests = scope.directories.some(d => d.startsWith('src/') || d.startsWith('tests/'));
    expect(hasSrcOrTests).toBe(false);
  });
});

describe('extractScopeFromDirective — empty scope', () => {
  it('returns empty directories for empty scope line', () => {
    const scope = extractScopeFromDirective('');
    expect(scope.directories).toEqual([]);
    expect(scope.filesWrite).toEqual([]);
  });
});

describe('parseStructuredDirectives — Sprint 134 DIRECTIVES self-parse', () => {
  it('correctly parses all 15 tasks from Sprint 134 DIRECTIVES', () => {
    // Use a minimal but representative subset of Sprint 134 DIRECTIVES
    const content = `# DIRECTIVES — Sprint 134

## Goal: Sprint 134 goals.

---

## Task 1: Task Dependency Pipeline
- Model: claude-opus-4-8
- Effort: high
- Scope: src/orchestra/
- Files: src/orchestra/task-builder.ts

### Description
Implement dependency pipeline.

---

## Task 2: DIRECTIVES Scope Parser Hardening
- Model: claude-opus-4-8
- Effort: normal
- Scope: src/orchestra/
- Files: src/orchestra/task-builder.ts, src/orchestra/planner.ts

### Description
Fix scope parser edge cases.

---

## Task 3: Auditor Heartbeat Cleanup
- Model: claude-sonnet-5
- Effort: low
- Scope: src/monitor/, src/agents/

### Description
Clean up heartbeat files.

---

## Task 4: Gitignore Cleanup
- Model: claude-haiku-4-5-20251001
- Effort: low
- Scope: .
- Files: .gitignore

### Description
Update gitignore patterns.

---

## Task 7: ADR-033 Product Vision
- Model: claude-sonnet-5
- Effort: normal
- Scope: .brain/, docs/vision/
- Files: .brain/DECISIONS.md, docs/vision/roadmap.md

### Description
Write ADR-033.

---

## Task 12: Multi-Project Isolation
- Model: claude-opus-4-8
- Effort: normal
- Scope: .brain/, docs/design/, src/agents/

### Description
Write ADR-034.

---

## Task 15: Competitive Analysis
- Model: claude-haiku-4-5-20251001
- Effort: low
- Scope: docs/analysis/

### Description
Update competitive analysis.`;

    const tasks = parseStructuredDirectives(content);
    expect(tasks.length).toBe(7);

    // Task 1: src/orchestra/
    expect(tasks[0]!.scope.directories).toContain('src/orchestra/');

    // Task 4: "." root scope → "./"
    expect(tasks[3]!.scope.directories).toContain('./');
    expect(tasks[3]!.scope.filesWrite).toContain('.gitignore');

    // Task 7: .brain/ + docs/vision/
    const t7dirs = tasks[4]!.scope.directories;
    expect(t7dirs).toContain('.brain/');
    expect(t7dirs).toContain('docs/vision/');

    // Task 12: .brain/ + docs/design/ + src/agents/
    const t12dirs = tasks[5]!.scope.directories;
    expect(t12dirs).toContain('.brain/');
    expect(t12dirs).toContain('docs/design/');
    expect(t12dirs).toContain('src/agents/');

    // Task 15: docs/analysis/
    expect(tasks[6]!.scope.directories).toContain('docs/analysis/');
  });
});

describe('parseStructuredDirectives — .brain/ scope detection via scopeLines filter', () => {
  it('includes .brain/ Files in scope when only .brain paths present', () => {
    const content = `## Task 1: Write ADR
- Files: .brain/DECISIONS.md
- Scope: .brain/

### Description
Write architecture decision record.`;
    const tasks = parseStructuredDirectives(content);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]!.scope.directories).toContain('.brain/');
    expect(tasks[0]!.scope.filesWrite).toContain('.brain/DECISIONS.md');
  });
});

// ═══ parsePriorityDirective ════════════════════════════════════════

describe('parsePriorityDirective', () => {
  it('parses "- Priority: CRITICAL" → "CRITICAL"', () => {
    expect(parsePriorityDirective('- Priority: CRITICAL')).toBe('CRITICAL');
  });

  it('parses "- Priority: HIGH" → "HIGH"', () => {
    expect(parsePriorityDirective('- Priority: HIGH')).toBe('HIGH');
  });

  it('parses "- Priority: NORMAL" → "NORMAL"', () => {
    expect(parsePriorityDirective('- Priority: NORMAL')).toBe('NORMAL');
  });

  it('parses "- Priority: LOW" → "LOW"', () => {
    expect(parsePriorityDirective('- Priority: LOW')).toBe('LOW');
  });

  it('returns undefined for missing line', () => {
    expect(parsePriorityDirective(undefined)).toBeUndefined();
  });

  it('returns undefined for empty value', () => {
    expect(parsePriorityDirective('- Priority: ')).toBeUndefined();
  });

  it('returns undefined for invalid priority value', () => {
    expect(parsePriorityDirective('- Priority: URGENT')).toBeUndefined();
  });

  it('is case-insensitive for the label and normalizes value to uppercase', () => {
    expect(parsePriorityDirective('- priority: critical')).toBe('CRITICAL');
    expect(parsePriorityDirective('  Priority: high')).toBe('HIGH');
  });
});

// ═══ parseStructuredDirectives — Priority parsing ═════════════════

describe('parseStructuredDirectives — priority parsing', () => {
  const sprint136DirectivesFixture = Array.from({ length: 10 }, (_, index) => {
    const taskNumber = index + 1;
    const priority = taskNumber <= 3 ? 'CRITICAL' : taskNumber <= 8 ? 'HIGH' : 'NORMAL';
    return [
      `## Task ${taskNumber}: Sprint 136 Task ${taskNumber}`,
      `- Priority: ${priority}`,
      `- Files: src/core/task-${taskNumber}.ts`,
      '- Scope: src/core/',
      '',
      '### Description',
      `Sprint 136 fixture task ${taskNumber}.`,
    ].join('\n');
  }).join('\n\n---\n\n');

  it('parses Priority: CRITICAL from structured task block', () => {
    const content = `## Task 1: Critical Fix
- Priority: CRITICAL
- Files: src/core/config.ts
- Scope: src/core/

### Description
Fix critical bug.`;
    const tasks = parseStructuredDirectives(content);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]!.priority).toBe('CRITICAL');
  });

  it('parses Priority: HIGH from structured task block', () => {
    const content = `## Task 1: Important Feature
- Priority: HIGH
- Files: src/core/types.ts
- Scope: src/core/

### Description
Add important feature.`;
    const tasks = parseStructuredDirectives(content);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]!.priority).toBe('HIGH');
  });

  it('returns undefined priority when Priority line is missing (default NORMAL)', () => {
    const content = `## Task 1: Normal Task
- Files: src/core/config.ts
- Scope: src/core/

### Description
Regular task with no priority specified.`;
    const tasks = parseStructuredDirectives(content);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]!.priority).toBeUndefined();
  });

  it('parses multiple tasks with different priorities', () => {
    const content = `## Task 1: Critical Fix
- Priority: CRITICAL
- Files: src/core/config.ts

### Description
Critical fix.

---

## Task 2: Normal Task
- Files: src/core/types.ts

### Description
Normal task.

---

## Task 3: Low Priority
- Priority: LOW
- Files: src/core/utils.ts

### Description
Low priority cleanup.`;
    const tasks = parseStructuredDirectives(content);
    expect(tasks).toHaveLength(3);
    expect(tasks[0]!.priority).toBe('CRITICAL');
    expect(tasks[1]!.priority).toBeUndefined();
    expect(tasks[2]!.priority).toBe('LOW');
  });

  it('Sprint 136 DIRECTIVES self-parse: correct priority distribution (3 CRITICAL + 5 HIGH + 2 NORMAL)', () => {
    const tasks = parseStructuredDirectives(sprint136DirectivesFixture);
    expect(tasks.length).toBe(10);

    const criticalCount = tasks.filter(t => t.priority === 'CRITICAL').length;
    const highCount = tasks.filter(t => t.priority === 'HIGH').length;
    const normalCount = tasks.filter(t => t.priority === 'NORMAL').length;

    // Sprint 136 DIRECTIVES: 3 CRITICAL (T-001..T-003), 5 HIGH (T-004..T-008), 2 NORMAL (T-009..T-010)
    expect(criticalCount).toBe(3);
    expect(highCount).toBe(5);
    expect(normalCount).toBe(2);
  });

  it('Sprint 136 DIRECTIVES self-parse: no explicit dependencies (all tasks independent)', () => {
    const tasks = parseStructuredDirectives(sprint136DirectivesFixture);
    expect(tasks.length).toBe(10);

    // Sprint 136 DIRECTIVES has no explicit "- Dependencies:" lines
    // All tasks should have undefined dependencies (wiring is done at sprint level via wave topology)
    const withDeps = tasks.filter(t => t.dependencies !== undefined && t.dependencies.length > 0);
    expect(withDeps.length).toBe(0);

    // T-001 (index 0): CRITICAL priority confirmed
    expect(tasks[0]!.priority).toBe('CRITICAL');
    // T-009 (index 8): NORMAL priority confirmed
    expect(tasks[8]!.priority).toBe('NORMAL');
  });

  it('parser edge case: leading whitespace around Priority line is handled correctly', () => {
    const content = `## Task 1: Whitespace Test
  - Priority:   CRITICAL
- Files: src/core/config.ts
- Scope: src/core/

### Description
Task with extra whitespace around priority.`;
    const tasks = parseStructuredDirectives(content);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]!.priority).toBe('CRITICAL');
  });

  it('backward compat: task without Priority field defaults to undefined (caller uses NORMAL)', () => {
    const content = `## Task 1: Legacy Task
- Model: claude-sonnet-5
- Effort: normal
- Files: src/core/utils.ts
- Scope: src/core/

### Description
Old-style task without any Priority line.`;
    const tasks = parseStructuredDirectives(content);
    expect(tasks).toHaveLength(1);
    // Parser returns undefined → sprint-controller defaults to 'NORMAL'
    expect(tasks[0]!.priority).toBeUndefined();
  });
});

// ─── loadADRContent — REMOVED ─────────────────────────────────────────
// loadADRContent was deleted; ADR injection now uses MemoryStore queryRelevantADRs

// ─── buildWorkerPrompt ADR injection ────────────────────────────────────

describe('buildWorkerPrompt — ADR injection', () => {
  it('HOLDs an explicit ADR when the memory database is absent', () => {
    const rootFixture = mkdtempSync(join(tmpdir(), 'task-builder-memory-absent-'));
    try {
      const task = makeTask({ description: 'Must obey ADR-G-997.' });
      expect(() => buildWorkerPrompt(task, undefined, undefined, rootFixture))
        .toThrow(/MEMORY_READ_CONTEXT_HOLD:REQUIRED_ENTRY_MISSING/u);
    } finally {
      rmSync(rootFixture, { recursive: true, force: true });
    }
  });

  it('keeps required ADRs whole while query-only ADRs remain typed background', () => {
    const rootFixture = mkdtempSync(join(tmpdir(), 'task-builder-memory-selection-'));
    let store: MemoryStore | undefined;
    try {
      mkdirSync(join(rootFixture, '.brain'), { recursive: true });
      store = new MemoryStore(join(rootFixture, '.brain', 'memory.db'));
      const ids = ['ADR-G-991', 'ADR-G-992', 'ADR-G-993', 'ADR-G-994', 'ADR-G-995'];
      for (const [index, id] of ids.entries()) {
        store.insert({
          id,
          type: 'adr',
          title: `Canonical ADR ${index}`,
          content: `FULL_CANONICAL_ADR_${index}_BEGIN\nLow-relevance mandatory body ${index}.\nFULL_CANONICAL_ADR_${index}_END`,
          status: 'accepted',
        });
      }
      for (const id of ['adr-d-001', 'adr-d-004']) {
        store.insert({
          id, type: 'adr', title: `Preset ${id}`,
          content: `FULL_PRESET_${id.toUpperCase()}_BODY`, status: 'accepted',
        });
      }
      store.insert({
        id: 'adr-g-990', type: 'adr', title: 'Quoted path memory background',
        content: 'QUERY_ONLY_BACKGROUND_DEEP_BODY', summary: 'Query-only summary.', status: 'accepted',
      });
      store.insert({
        id: 'critical-memory-1', type: 'memory', title: 'Scoped critical operational context',
        content: 'SCOPED_CRITICAL_MEMORY_WHOLE', priority: 'critical', status: 'active',
      });
      store.close();
      store = undefined;
      const noisy = Array.from({ length: 2_000 }, (_, index) =>
        `Change ${index}: path-${index}/unit AND OR NOT "quoted"`).join(' ');
      const task = makeTask({ description: `${noisy}\n${ids.join(' ')}` });
      const prompt = buildWorkerPrompt(task, undefined, undefined, rootFixture);

      for (const [index, id] of ids.entries()) {
        expect(prompt).toContain(`## ${id}: Canonical ADR ${index}`);
        expect(prompt).toContain(`FULL_CANONICAL_ADR_${index}_BEGIN`);
        expect(prompt).toContain(`FULL_CANONICAL_ADR_${index}_END`);
      }
      expect(prompt).toContain('FULL_PRESET_ADR-D-001_BODY');
      expect(prompt).toContain('FULL_PRESET_ADR-D-004_BODY');
      expect(prompt).toContain('SCOPED_CRITICAL_MEMORY_WHOLE');
      expect(prompt).toContain('## adr-g-990: Quoted path memory background');
      expect(prompt).toContain('[background constraint — full text:');
      expect(prompt).not.toContain('QUERY_ONLY_BACKGROUND_DEEP_BODY');
    } finally {
      store?.close();
      rmSync(rootFixture, { recursive: true, force: true });
    }
  });

  it('includes worker prompt structure even without DB-sourced ADRs', () => {
    const task = makeTask();
    const prompt = buildWorkerPrompt(task);
    // Without a real MemoryStore DB, queryRelevantADRs returns empty.
    // The prompt should still be well-formed.
    expect(prompt).toContain('Deckent worker agent');
  });

  // TASK-BUILDER-ADR-CWD-LEAK (391-001): buildWorkerPrompt's ADR-load previously
  // read `.brain/memory.db` from `process.cwd()` instead of the `projectRoot`
  // parameter it was given — the one inconsistent read in the function (every
  // other read: worker_comms/SharedMemory, baseline, git ls-files already used
  // `projectRoot`). Proves the fix: the ADR block is sourced from `projectRoot`
  // even when `process.cwd()` points at a directory with no `.brain/memory.db`
  // at all (so a cwd-based read would find nothing).
  it('loads the ADR block from projectRoot, not process.cwd()', () => {
    const cwdFixture = mkdtempSync(join(tmpdir(), 'task-builder-cwd-fixture-'));
    const rootFixture = mkdtempSync(join(tmpdir(), 'task-builder-root-fixture-'));
    const originalCwd = process.cwd();
    let store: MemoryStore | undefined;
    try {
      mkdirSync(join(rootFixture, '.brain'), { recursive: true });
      store = new MemoryStore(join(rootFixture, '.brain', 'memory.db'));
      store.insert({
        id: 'adr-999',
        type: 'adr',
        title: 'Fixture Marker ADR',
        content: '# ADR-999: Fixture Marker\n\n**Status:** accepted\n\nFIXTURE_ADR_MARKER_CONTENT_XYZ.\n',
        status: 'accepted',
        sprint_id: 'sprint-999',
        sprint_num: 999,
      });
      store.insert({
        id: 'memory-999',
        type: 'memory',
        title: 'Fixture behavior memory',
        content: 'WHOLE_MEMORY_CONTEXT_MARKER_BEGIN\nNever split this meaning unit.\nWHOLE_MEMORY_CONTEXT_MARKER_END',
        status: 'active',
        sprint_id: 'sprint-999',
        sprint_num: 999,
      });
      store.close();
      store = undefined;

      // cwd has NO .brain/memory.db — a cwd-based read finds nothing here.
      process.chdir(cwdFixture);

      // Task text explicitly references ADR-999 so it force-includes with a
      // full (non-condensed) body, regardless of relevance scoring.
      const task = makeTask({ description: 'Implements ADR-999 fixture behavior.' });
      const prompt = buildWorkerPrompt(task, undefined, undefined, rootFixture);

      expect(prompt).toContain('FIXTURE_ADR_MARKER_CONTENT_XYZ');
      expect(prompt).toContain('=== Relevant project memory ===');
      expect(prompt).toContain('WHOLE_MEMORY_CONTEXT_MARKER_BEGIN');
      expect(prompt).toContain('WHOLE_MEMORY_CONTEXT_MARKER_END');
      expect(prompt).toMatch(/Selection revision: sha256:[a-f0-9]{64}/u);
      const promptArtifact = readdirSync(join(rootFixture, '.tasks'))
        .find(name => name.startsWith(`.prompt-${task.id}-`) && name.endsWith('.txt'));
      expect(promptArtifact).toBeDefined();
      expect(readFileSync(join(rootFixture, '.tasks', promptArtifact!), 'utf8')).toBe(prompt);
    } finally {
      store?.close();
      process.chdir(originalCwd);
      rmSync(cwdFixture, { recursive: true, force: true });
      rmSync(rootFixture, { recursive: true, force: true });
    }
  });


  it('HOLDs an explicit ADR that cannot fit the configured whole-entry budget', () => {
    const rootFixture = mkdtempSync(join(tmpdir(), 'task-builder-memory-budget-'));
    let store: MemoryStore | undefined;
    try {
      mkdirSync(join(rootFixture, '.brain'), { recursive: true });
      store = new MemoryStore(join(rootFixture, '.brain', 'memory.db'));
      store.insert({
        id: 'adr-g-998',
        type: 'adr',
        title: 'Oversize required ADR',
        content: `REQUIRED_WHOLE_BEGIN\n${'x'.repeat(4096)}\nREQUIRED_WHOLE_END`,
        status: 'accepted',
        sprint_id: 'sprint-998',
        sprint_num: 998,
      });
      store.close();
      store = undefined;
      const task = makeTask({ description: 'Must obey ADR-G-998.' });
      expect(() => buildWorkerPrompt(task, undefined, undefined, rootFixture, {
        memory_read: { maxEntries: 4, maxCandidates: 8, maxBytes: 512, maxLines: 40 },
        language: 'en',
      })).toThrow(/MEMORY_READ_CONTEXT_HOLD:REQUIRED_ENTRY_OVERSIZE/u);
    } finally {
      store?.close();
      rmSync(rootFixture, { recursive: true, force: true });
    }
  });
});

// ─── buildWorkerPrompt — Honest Self-Assessment injection ────────────────────

describe('buildWorkerPrompt — Honest Self-Assessment injection', () => {
  it('includes the self-assessment authority section in prompt', () => {
    const task = makeTask();
    const prompt = buildWorkerPrompt(task);
    expect(prompt).toContain('## Result & Self-Assessment');
    // WP-19: subjective "Assess yourself honestly" prose replaced by an objective
    // goCriteria-derived checklist + verdict rubric.
    expect(prompt).toContain('Self-assessment rubric');
  });

  it('maps fully closed polarity-specific outcomes to DONE (WP-19)', () => {
    const task = makeTask();
    const prompt = buildWorkerPrompt(task);
    expect(prompt).not.toContain('<80%');
    expect(prompt).toContain('polarity-specific outcomes closed → DONE');
    expect(prompt).toContain('GO_WITH_TECH_DEBT');
  });

  it('maps a critical open item to NO_GO (WP-19)', () => {
    const task = makeTask();
    const prompt = buildWorkerPrompt(task);
    expect(prompt).not.toContain('<50%');
    expect(prompt).toContain('a critical item open → NO_GO');
  });

  it('renders a goCriteria-derived checklist judged WITH EVIDENCE (WP-19)', () => {
    const task = makeTask();
    const prompt = buildWorkerPrompt(task);
    // One polarity-aware checkbox per structured criterion, closed only with evidence.
    expect(prompt).toContain('- [ ] tests pass');
    expect(prompt).toContain('WITH EVIDENCE');
  });

  it('clarifies that "Code written" ≠ "DONE"', () => {
    const task = makeTask();
    const prompt = buildWorkerPrompt(task);
    expect(prompt).toContain('"Code written"');
  });

  it('mandates silent planning and NO plan file in "What To Do" (7094-F1d)', () => {
    const task = makeTask({ id: '139-021' });
    const prompt = buildWorkerPrompt(task);
    // 7094-F1d: the host never read a .plan; the mandated file write only
    // burned a full cached-context turn per task. Planning stays, the file goes.
    expect(prompt).toContain('Plan silently BEFORE coding');
    expect(prompt).not.toContain('task-139-021.plan');
    const planIndex = prompt.indexOf('Plan silently BEFORE coding');
    const codeIndex = prompt.indexOf('Write the code changes');
    expect(planIndex).toBeLessThan(codeIndex);
  });
});

// ═══ parseAuthModeDirective (Sprint 193 wire) ═════════════════════════
//
// Per-task auth override parser. "api" → opts the worker out of the host
// ~/.claude session mount (spawn-backend-docker uses ANTHROPIC_API_KEY instead).
// "subscription" → explicit default. Unknown values fall back to undefined so
// the spawn-backend can apply the config-level default.

describe('parseAuthModeDirective', () => {
  it('parses "- Auth: api" → "api"', () => {
    expect(parseAuthModeDirective('- Auth: api')).toBe('api');
  });

  it('parses "- Auth: subscription" → "subscription"', () => {
    expect(parseAuthModeDirective('- Auth: subscription')).toBe('subscription');
  });

  it('is case-insensitive', () => {
    expect(parseAuthModeDirective('- Auth: API')).toBe('api');
    expect(parseAuthModeDirective('  auth: Subscription')).toBe('subscription');
  });

  it('returns undefined for missing line, empty value, or unknown value', () => {
    expect(parseAuthModeDirective(undefined)).toBeUndefined();
    expect(parseAuthModeDirective('- Auth: ')).toBeUndefined();
    expect(parseAuthModeDirective('- Auth: hybrid')).toBeUndefined();
  });
});

describe('parseStructuredDirectives — authMode parsing', () => {
  it('propagates "- Auth: api" from a structured task block to the parsed task', () => {
    const content = `## Task 1: API mode opt-in
- Model: claude-sonnet-5
- Auth: api
- Files: src/core/config.ts
- Scope: src/core/

### Description
Run this task with the API key instead of the subscription session.`;
    const tasks = parseStructuredDirectives(content);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]!.authMode).toBe('api');
  });

  it('leaves authMode undefined when no Auth: line is present', () => {
    const content = `## Task 1: Default auth
- Model: claude-sonnet-5
- Files: src/core/config.ts
- Scope: src/core/

### Description
No auth directive — fall back to config default.`;
    const tasks = parseStructuredDirectives(content);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]!.authMode).toBeUndefined();
  });
});

// ─── mirrorTestScope (Sprint 260 BOUNDARY-TEST-PATTERN) ───────────────────────

describe('mirrorTestScope', () => {
  it('adds tests/orchestra/ when kind=code-development and src/orchestra/ is in directories', () => {
    const scope = {
      directories: ['src/orchestra/'],
      filesRead: [],
      filesWrite: ['src/orchestra/task-builder.ts'],
    };
    const result = mirrorTestScope(scope, 'code-development');
    expect(result.directories).toContain('src/orchestra/');
    expect(result.directories).toContain('tests/orchestra/');
  });

  it('adds mirrored tests/ dirs for multiple src/ directories', () => {
    const scope = {
      directories: ['src/core/', 'src/cli/'],
      filesRead: [],
      filesWrite: ['src/core/config.ts'],
    };
    const result = mirrorTestScope(scope, 'code-development');
    expect(result.directories).toContain('tests/core/');
    expect(result.directories).toContain('tests/cli/');
  });

  it('does not add duplicate tests/ dir when already present', () => {
    const scope = {
      directories: ['src/orchestra/', 'tests/orchestra/'],
      filesRead: [],
      filesWrite: ['src/orchestra/brain.ts'],
    };
    const result = mirrorTestScope(scope, 'code-development');
    const testsDirs = result.directories.filter(d => d === 'tests/orchestra/');
    expect(testsDirs).toHaveLength(1);
  });

  it('leaves scope unchanged for non-code-development kinds', () => {
    const scope = {
      directories: ['src/core/'],
      filesRead: [],
      filesWrite: ['src/core/config.ts'],
    };
    const auditResult = mirrorTestScope(scope, 'audit');
    const docResult = mirrorTestScope(scope, 'document-write');
    expect(auditResult).toBe(scope);
    expect(docResult).toBe(scope);
  });

  it('leaves scope unchanged when no src/ directories present', () => {
    const scope = {
      directories: ['docs/', 'tests/core/'],
      filesRead: [],
      filesWrite: ['docs/guide.md'],
    };
    const result = mirrorTestScope(scope, 'code-development');
    expect(result).toBe(scope);
  });

  it('does not mutate the original scope', () => {
    const original = ['src/orchestra/'];
    const scope = { directories: original, filesRead: [], filesWrite: [] };
    mirrorTestScope(scope, 'code-development');
    expect(scope.directories).toEqual(['src/orchestra/']);
  });

  it('preserves filesRead and filesWrite unchanged', () => {
    const scope = {
      directories: ['src/core/'],
      filesRead: ['src/core/config.ts'],
      filesWrite: ['src/core/utils.ts'],
    };
    const result = mirrorTestScope(scope, 'code-development');
    expect(result.filesRead).toEqual(['src/core/config.ts']);
    expect(result.filesWrite).toEqual(['src/core/utils.ts']);
  });
});

// ─── createTask — BOUNDARY-TEST-PATTERN auto-widen ────────────────────────────

describe('createTask — auto-includes matching tests/ dir for code-development scope', () => {
  it('adds tests/orchestra/ when scope is src/orchestra/ (code-development task)', () => {
    const params = makeBaseParams({
      scope: {
        directories: ['src/orchestra/'],
        filesRead: [],
        filesWrite: ['src/orchestra/task-builder.ts'],
      },
    });
    const task = createTask(params, 1);
    expect(task.scope.directories).toContain('src/orchestra/');
    expect(task.scope.directories).toContain('tests/orchestra/');
  });

  it('adds tests/core/ when scope is src/core/ (code-development task)', () => {
    const params = makeBaseParams({
      scope: {
        directories: ['src/core/'],
        filesRead: [],
        filesWrite: ['src/core/config.ts'],
      },
    });
    const task = createTask(params, 2);
    expect(task.scope.directories).toContain('tests/core/');
  });

  it('does not duplicate tests/ dir when already explicitly in scope', () => {
    const params = makeBaseParams({
      scope: {
        directories: ['src/orchestra/', 'tests/orchestra/'],
        filesRead: [],
        filesWrite: ['src/orchestra/brain.ts'],
      },
    });
    const task = createTask(params, 3);
    const count = task.scope.directories.filter(d => d === 'tests/orchestra/').length;
    expect(count).toBe(1);
  });

  it('does not add tests/ dir for doc-only scope', () => {
    const params = makeBaseParams({
      scope: {
        directories: ['docs/'],
        filesRead: [],
        filesWrite: ['docs/guide.md'],
      },
    });
    const task = createTask(params, 4);
    const testDirs = task.scope.directories.filter(d => d.startsWith('tests/'));
    expect(testDirs).toHaveLength(0);
  });
});

// ═══ Dependency directive format guard (323-031) ═══════════════════════

describe('parseDependenciesDirective — structured slot-id format', () => {
  it('parses "- Dependencies: 323-005, 323-007" to a slot-id array', () => {
    expect(parseDependenciesDirective('- Dependencies: 323-005, 323-007'))
      .toEqual(['323-005', '323-007']);
  });

  it('parses a single bare "Dependencies: 323-005"', () => {
    expect(parseDependenciesDirective('Dependencies: 323-005')).toEqual(['323-005']);
  });

  it('parses a JSON-array dependency literal', () => {
    expect(parseDependenciesDirective('- Dependencies: ["323-005", "323-007"]'))
      .toEqual(['323-005', '323-007']);
  });

  it('returns undefined for "none" and for a missing line', () => {
    expect(parseDependenciesDirective('- Dependencies: none')).toBeUndefined();
    expect(parseDependenciesDirective(undefined)).toBeUndefined();
    expect(parseDependenciesDirective('- Dependencies:   ')).toBeUndefined();
  });
});

describe('isPlanSlotId — format guard', () => {
  it('accepts canonical NNN-NNN slot ids', () => {
    expect(isPlanSlotId('323-005')).toBe(true);
    expect(isPlanSlotId('1-1')).toBe(true);
    expect(isPlanSlotId('  323-007  ')).toBe(true); // trims surrounding space
  });

  it('rejects title-prefix labels and free-text titles', () => {
    expect(isPlanSlotId('W1-1')).toBe(false);
    expect(isPlanSlotId('Build REST API')).toBe(false);
    expect(isPlanSlotId('')).toBe(false);
  });

  it('rejects malformed / over-length numeric refs', () => {
    expect(isPlanSlotId('12345-1')).toBe(false); // > 4 digits
    expect(isPlanSlotId('323')).toBe(false);      // missing dash segment
    expect(isPlanSlotId('323-')).toBe(false);
  });
});

// ═══ resolveDependencyRef — integer index resolution (325-001) ════════════════

describe('resolveDependencyRef — pure-integer index refs', () => {
  const sampleTasks = [
    { id: '325-001', title: 'First task' },
    { id: '325-002', title: 'Second task' },
    { id: '325-003', title: 'Third task' },
  ];

  it('"0" resolves to the first task id (index 0)', () => {
    expect(resolveDependencyRef('0', sampleTasks)).toBe('325-001');
  });

  it('"1" resolves to the second task id (index 1)', () => {
    expect(resolveDependencyRef('1', sampleTasks)).toBe('325-002');
  });

  it('"2" resolves to the third task id (index 2)', () => {
    expect(resolveDependencyRef('2', sampleTasks)).toBe('325-003');
  });

  it('out-of-bounds integer returns undefined', () => {
    expect(resolveDependencyRef('99', sampleTasks)).toBeUndefined();
  });

  it('canonical slot-id still resolves by exact id match (not treated as index)', () => {
    expect(resolveDependencyRef('325-002', sampleTasks)).toBe('325-002');
  });

  it('title-prefix label still resolves by title token match', () => {
    expect(resolveDependencyRef('First', sampleTasks)).toBe('325-001');
  });

  it('"none" is reserved and returns undefined', () => {
    expect(resolveDependencyRef('none', sampleTasks)).toBeUndefined();
  });

  it('empty string returns undefined', () => {
    expect(resolveDependencyRef('', sampleTasks)).toBeUndefined();
  });
});

describe('resolveTaskDependencies — integer index batch resolution', () => {
  const tasks = [
    { id: '324-001', title: 'Planner fix' },
    { id: '324-002', title: 'Router fix' },
    { id: '324-003', title: 'Evaluator fix' },
  ];

  it('resolves ["0"] to the first task id', () => {
    expect(resolveTaskDependencies(['0'], tasks)).toEqual(['324-001']);
  });

  it('resolves mixed index + slot-id refs correctly', () => {
    expect(resolveTaskDependencies(['0', '324-003'], tasks)).toEqual(['324-001', '324-003']);
  });

  it('deduplicates when index and slot-id resolve to same task', () => {
    // "0" and "324-001" both resolve to the first task
    expect(resolveTaskDependencies(['0', '324-001'], tasks)).toEqual(['324-001']);
  });

  it('drops unresolvable refs without throwing', () => {
    expect(resolveTaskDependencies(['99', '324-002'], tasks)).toEqual(['324-002']);
  });
});

describe('parseStructuredDirectives — Dependencies index-ref (325-001 live evidence)', () => {
  it('"- Dependencies: 0" resolves to the first task id after planning', () => {
    // Parsing returns the raw "0" string; resolution happens via resolveDependencyRef
    const content = `## Task 1: Gate task
- Files: src/core/config.ts
- Scope: src/core/

### Description
Gate task.

## Task 2: Dependent task
- Dependencies: 0
- Files: src/core/utils.ts
- Scope: src/core/

### Description
Depends on task 0 (first task in the list).`;
    const parsed = parseStructuredDirectives(content);
    expect(parsed).toHaveLength(2);
    // The raw "0" is preserved by the parser; caller resolves it via resolveDependencyRef
    expect(parsed[1]!.dependencies).toEqual(['0']);

    // Simulate sprint-planner resolution: build task stubs and resolve
    const taskStubs = [
      { id: '325-001', title: parsed[0]!.title },
      { id: '325-002', title: parsed[1]!.title },
    ];
    const resolved = resolveTaskDependencies(parsed[1]!.dependencies!, taskStubs);
    expect(resolved).toEqual(['325-001']);
  });
});

// ─── extractScopeFromDirective — qualified-path .md tail duplication ──────
// Sprint-443 plan-gate live case: "- Files: src/core/builtins/agents/x/PROMPT.md"
// ALSO matched the bare ".md" alternative ("PROMPT.md"), pushing an unqualified
// duplicate into filesWrite; scope-sanitizer then dropped it and prompt-gate read
// the drop as a write-authority-shrink BLOCK on all 20 U4 content tasks.

describe('extractScopeFromDirective — bare .md tail of a qualified path', () => {
  it('does not duplicate PROMPT.md when the full path is on the line', () => {
    const scope = extractScopeFromDirective(
      '- Files: src/core/builtins/agents/devops-engineer/PROMPT.md',
    );
    expect(scope.filesWrite).toContain('src/core/builtins/agents/devops-engineer/PROMPT.md');
    expect(scope.filesWrite).not.toContain('PROMPT.md');
  });

  it('still captures a genuinely root-level .md file', () => {
    const scope = extractScopeFromDirective('- Files: DECKENT.md');
    expect(scope.filesWrite).toContain('DECKENT.md');
  });
});
