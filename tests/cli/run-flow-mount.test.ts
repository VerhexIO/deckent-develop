// ═══ run-flow-mount tests — TERM-FLOW-UNIFY Sprint-4 REPL mount (426-002) ═══
//
// Covers the pieces this task adds on top of sprint-425's controller/card:
//   1. app.tsx's new pure helpers (deriveRunFlowPreview, resolveRunFlowCardActive,
//      formatRunFlowOutcomeLine) — same no-Ink-render approach as
//      approval-inputbar-mutex.test.tsx / app-approval-wire tests (Ink-testing-
//      library is not a project dependency).
//   2. run.tsx's wireRunFlowMount — flag-off never invokes the controller
//      factory (byte-identical to pre-426-002); flag-on invokes it exactly once.
//   3. run.tsx's buildRunFlowMountLabels — real en/tr i18n pin (messages.ts).
//   4. run-flow-controller.ts's NEW startApproved() — the full propose ->
//      approve -> startApproved trajectory to DETACHED_RUNNING, using a FAKE
//      spawnStart (no real sprint is ever spawned) and REAL run-flow-store.ts
//      functions against a tmpdir root (hermetic — mirrors run-flow-store.test.ts)
//      to prove the approved snapshot is durably persisted, not just in-memory.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// 429-001 (born-678): compiler artık scaffold üretmez — AI/provider SINIRI olan
// callZeroConfigPlanner mock'lanır (do-real-plan.test.ts emsali); canned tek-task
// GERÇEK-şekilli plan döner, böylece propose-yolu hermetik kalır.
vi.mock('../../src/orchestra/planner.js', () => ({
  resolvePlanTimeoutMs: vi.fn(() => 900_000), // F-2: sprint-planner/do.ts resolve the plan timeout through this
  createPlannerTaskModelPolicy: vi.fn((defaultModel: string) => ({ defaultModel, allowedModels: [defaultModel] })),
  normalizePlannerDependencies: vi.fn(() => ({ resolvedCount: 0, dropped: [] })),
  callZeroConfigPlanner: vi.fn(() => ({
    reasoning: 'canned single-task plan (hermetic planner boundary)',
    tasks: [{
      title: 'Planned task',
      description: 'Canned single-task plan for RunFlow tests (429-001 planner-seam).',
      scope: { directories: ['src/'], filesRead: [], filesWrite: ['src/planned.ts'] },
      dependencies: [],
      model: 'claude-sonnet-5', effort: 'normal', priority: 'NORMAL', reason: 'canned',
      goNogo: { goCriteria: 'The planned change works.', noGoCriteria: 'The planned change breaks.', techDebtAcceptable: '' },
    }],
  })),
}));

vi.mock('../../src/orchestra/brain.js', () => ({
  planSprint: vi.fn(),
  readContext: vi.fn(),
}));

import { planSprint, readContext } from '../../src/orchestra/brain.js';
import {
  deriveRunFlowPreview,
  resolveRunFlowCardActive,
  resolveInboxCardActive,
  formatRunFlowOutcomeLine,
} from '../../src/cli/repl/app.js';
import { wireRunFlowMount, buildRunFlowMountLabels } from '../../src/cli/repl/run.js';
import { createRunFlowController, type RunFlowController, type RunFlowControllerDeps } from '../../src/cli/repl/run-flow-controller.js';
import { loadApprovedSnapshot, loadRunHandle } from '../../src/core/run-flow-store.js';
import type { RunFlowContext } from '../../src/core/run-flow-contract.js';
import type { RunHandle } from '../../src/orchestra/run-job-service.js';
import { getMessage } from '../../src/cli/helpers/messages.js';

/** en mount labels — app.tsx owns no default object since TERMINAL-TOOLS-002. */
const EN_MOUNT_LABELS = buildRunFlowMountLabels((k) => getMessage(k, 'en'));
import { SprintStatus, SprintPhase, TaskStatus } from '../../src/core/types.js';
import type { Sprint, Task, ResolvedConfig, BrainContext } from '../../src/core/types.js';

const mockPlanSprint = vi.mocked(planSprint);
const mockReadContext = vi.mocked(readContext);

// ─── Fixtures (mirrors tests/cli/run-flow-controller.test.ts's own style) ──

function makeConfig(): ResolvedConfig {
  return {
    mode: 'max_plan',
    activeModeConfig: {
      max_workers: 8, brain_model: 'claude-opus-4-8', default_model: 'claude-sonnet-5',
      haiku_allowed: true, brain_planning: 'auto',
    },
    modes: {} as any,
    execution_budget: {
      roles: { worker: { default: { maxTurns: 1 } } },
      landing: { reserve_ratio: 0.25 },
    },
    language: 'en', projectName: 'test', projectRoot: '/mock/root',
    version: '1.0.0', auto_docs: { tier1: true, tier2: true, tier3: false },
  } as ResolvedConfig;
}

function makeBrainContext(): BrainContext {
  return {
    directives: '', memory: '', retro: '', debt: [], patterns: '', decisions: '',
    existingTasks: [], projectState: { gitStatus: '', fileTree: [] },
  };
}

function makeTask(overrides?: Partial<Task>): Task {
  return {
    id: '001-001', title: 'Do the thing', description: 'Do the thing well.', model: 'claude-sonnet-5',
    effort: 'normal', priority: 'NORMAL', reason: 'test',
    scope: { directories: ['src/'], filesRead: [], filesWrite: [] },
    dependencies: [],
    goNogo: { goCriteria: 'pass', noGoCriteria: 'fail', techDebtAcceptable: '' },
    status: TaskStatus.PENDING, sprintId: 'sprint-001', createdAt: new Date(0).toISOString(),
    ...overrides,
  } as Task;
}

function makeSprint(overrides?: Partial<Sprint>): Sprint {
  return {
    id: 'sprint-001', number: 1,
    status: SprintStatus.PLANNING, phase: SprintPhase.PLAN,
    tasks: [makeTask()], workers: ['w-001-001'],
    ...overrides,
  };
}

function fakeController(): RunFlowController {
  const collecting: RunFlowContext = { state: 'COLLECTING' };
  return {
    getContext: () => collecting,
    proposeRun: vi.fn(async () => collecting),
    approve: vi.fn(() => collecting),
    reject: vi.fn(() => collecting),
  };
}

// ─── app.tsx — deriveRunFlowPreview ────────────────────────────────────────

describe('deriveRunFlowPreview', () => {
  const preview = {
    flowId: 'flow-1', revision: 1, planDigest: 'abc',
    taskSummaries: [], policyDecision: 'allow' as const, gateResult: 'skipped' as const,
  };

  it.each<[RunFlowContext['state'], boolean]>([
    ['COLLECTING', false],
    ['PROPOSAL_READY', false],
    ['PREVIEWING', false],
    ['AWAITING_APPROVAL', true],
    ['APPROVED', false],
    ['STARTING', false],
    ['DETACHED_RUNNING', false],
    ['CANCELLED', false],
    ['BLOCKED', false],
  ])('state %s -> preview present: %s', (state, expectPreview) => {
    const ctx: RunFlowContext = { state, ...(expectPreview ? { preview } : {}) };
    expect(deriveRunFlowPreview(ctx)).toEqual(expectPreview ? preview : null);
  });

  it('AWAITING_APPROVAL with no preview on context (should not happen, but honest) -> null', () => {
    expect(deriveRunFlowPreview({ state: 'AWAITING_APPROVAL' })).toBeNull();
  });
});

// ─── app.tsx — resolveRunFlowCardActive ────────────────────────────────────

describe('resolveRunFlowCardActive', () => {
  it('idle (no confirm, no approval pending): card may be active', () => {
    expect(resolveRunFlowCardActive(false, false)).toBe(true);
  });

  it('confirm modal open: card defers, regardless of approval state', () => {
    expect(resolveRunFlowCardActive(true, false)).toBe(false);
    expect(resolveRunFlowCardActive(true, true)).toBe(false);
  });

  it('an ApprovalCard approval is pending (confirm modal closed): card defers', () => {
    expect(resolveRunFlowCardActive(false, true)).toBe(false);
  });
});

// ─── app.tsx — resolveInboxCardActive (SURF-3 D3a) ─────────────────────────

describe('resolveInboxCardActive — live /runs --follow card is the lowest-priority stdin consumer', () => {
  it('idle (no confirm, no approval, no plan-preview): the inbox card may own stdin', () => {
    expect(resolveInboxCardActive(false, false, false)).toBe(true);
  });

  it('defers to the confirm modal', () => {
    expect(resolveInboxCardActive(true, false, false)).toBe(false);
  });

  it('defers to a pending ApprovalCard', () => {
    expect(resolveInboxCardActive(false, true, false)).toBe(false);
  });

  it('defers to a pending PlanPreviewCard (runFlowPending)', () => {
    expect(resolveInboxCardActive(false, false, true)).toBe(false);
  });

  it('defers when several higher-priority consumers are active at once', () => {
    expect(resolveInboxCardActive(true, true, true)).toBe(false);
  });
});

// ─── app.tsx — formatRunFlowOutcomeLine ────────────────────────────────────

describe('formatRunFlowOutcomeLine', () => {
  it('started — substitutes {jobId}', () => {
    expect(formatRunFlowOutcomeLine({ kind: 'started', jobId: 'job-42' }, EN_MOUNT_LABELS))
      .toBe('Run started — job job-42.');
  });

  it('rejected — static line', () => {
    expect(formatRunFlowOutcomeLine({ kind: 'rejected' }, EN_MOUNT_LABELS))
      .toBe('Run proposal rejected.');
  });

  it('error — substitutes {error}', () => {
    expect(formatRunFlowOutcomeLine({ kind: 'error', message: 'boom' }, EN_MOUNT_LABELS))
      .toBe('Run flow error: boom');
  });

  it('honors a caller-supplied label override (i18n wiring, e.g. Turkish)', () => {
    const trLabels = {
      started: '{jobId} başlatıldı', rejected: 'reddedildi', error: 'hata: {error}',
    };
    expect(formatRunFlowOutcomeLine({ kind: 'started', jobId: 'x' }, trLabels)).toBe('x başlatıldı');
  });
});

// ─── run.tsx — wireRunFlowMount (flag-off/flag-on pin) ─────────────────────

describe('wireRunFlowMount', () => {
  const deps: RunFlowControllerDeps = { root: '/mock/root', config: makeConfig() };

  it('flag-off: returns undefined without invoking the controller factory', () => {
    const factory = vi.fn(() => fakeController());
    const result = wireRunFlowMount(false, deps, factory);
    expect(result).toBeUndefined();
    expect(factory).not.toHaveBeenCalled();
  });

  it('flag-on: invokes the factory exactly once and returns its result', () => {
    const controller = fakeController();
    const factory = vi.fn(() => controller);
    const result = wireRunFlowMount(true, deps, factory);
    expect(factory).toHaveBeenCalledTimes(1);
    // 3331: the mount now adds the production `ensureProviders` seam on top of the caller's deps.
    expect(factory).toHaveBeenCalledWith({ ...deps, ensureProviders: expect.any(Function) });
    expect(result).toBe(controller);
  });
});

// ─── run.tsx — buildRunFlowMountLabels (i18n en/tr pin) ────────────────────

describe('buildRunFlowMountLabels', () => {
  it('every label is a non-empty, genuinely-translated string (en !== tr)', () => {
    const en = buildRunFlowMountLabels((k) => getMessage(k, 'en'));
    const tr = buildRunFlowMountLabels((k) => getMessage(k, 'tr'));

    for (const key of ['started', 'rejected', 'error'] as const) {
      expect(en[key].length).toBeGreaterThan(0);
      expect(tr[key].length).toBeGreaterThan(0);
      expect(en[key]).not.toBe(tr[key]);
    }
  });
});

// ─── run-flow-controller.ts — startApproved() trajectory ───────────────────

describe('createRunFlowController — startApproved() (426-002)', () => {
  let tick = 0;
  const nowFn = (): string => new Date(Date.UTC(2026, 0, 1, 0, 0, tick++)).toISOString();
  let root: string;

  beforeEach(() => {
    vi.clearAllMocks();
    tick = 0;
    mockReadContext.mockReturnValue(makeBrainContext());
    mockPlanSprint.mockReturnValue(makeSprint() as any);
    root = mkdtempSync(join(tmpdir(), 'run-flow-mount-test-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function makeControllerDeps(spawnStart?: RunFlowControllerDeps['spawnStart']) {
    return {
      root,
      config: makeConfig(),
      now: nowFn,
      generateFlowId: () => 'flow-1',
      forceScope: true,
      scopeEvidence: { status: 'available' as const, trackedFiles: [] },
      ...(spawnStart ? { spawnStart } : {}),
    };
  }

  it('startApproved() before approve() throws a descriptive error', async () => {
    const controller = createRunFlowController(makeControllerDeps());
    await controller.proposeRun('Ship the thing');
    expect(() => controller.startApproved!()).toThrow(/requires state 'APPROVED'/);
  });

  it('drives APPROVED -> STARTING -> DETACHED_RUNNING via a fake spawnStart — no real sprint spawn', async () => {
    const spawnStart = vi.fn(() => ({ pid: process.pid }));
    const controller = createRunFlowController(makeControllerDeps(spawnStart));
    await controller.proposeRun('Ship the thing');
    controller.approve({ id: 'alperen' });

    const started = controller.startApproved!();

    expect(started.state).toBe('STARTING');
    expect(started.handle).toBeUndefined();
    expect(spawnStart).toHaveBeenCalledTimes(1);
    expect(spawnStart).toHaveBeenCalledWith(expect.objectContaining({
      capability: expect.objectContaining({ flowId: 'flow-1' }),
      sprint: expect.objectContaining({ id: 'sprint-001' }),
    }));
  });

  it('persists the approved snapshot durably via Task-1 run-flow-store.ts (not just in-memory)', async () => {
    const spawnStart = vi.fn(() => ({ pid: process.pid }));
    const controller = createRunFlowController(makeControllerDeps(spawnStart));
    const previewed = await controller.proposeRun('Ship the thing');
    controller.approve({ id: 'alperen' });
    controller.startApproved!();

    const storedSnapshot = loadApprovedSnapshot(root, 'flow-1');
    expect(storedSnapshot).toBeDefined();
    expect(storedSnapshot?.planDigest).toBe(previewed.preview!.planDigest);
    expect(storedSnapshot?.sprint.id).toBe('sprint-001');

    // Parent handle yayımlamaz; child ancak execution admission sonrası
    // attempt journal + compatibility handle'ı atomik yazar.
    expect(loadRunHandle(root, 'flow-1')).toBeUndefined();
    expect(controller.getContext().handle).toBeUndefined();
  });

  it('is idempotent: calling startApproved() twice does not spawn a second time', async () => {
    const spawnStart = vi.fn(() => ({ pid: process.pid }));
    const controller = createRunFlowController(makeControllerDeps(spawnStart));
    await controller.proposeRun('Ship the thing');
    controller.approve({ id: 'alperen' });

    const first = controller.startApproved!();
    const second = controller.startApproved!();

    expect(first.state).toBe('STARTING');
    expect(second.state).toBe('STARTING');
    expect(second.handle).toBeUndefined();
    expect(spawnStart).toHaveBeenCalledTimes(1);
  });

  it('approve() itself is UNCHANGED — still stops at APPROVED with no handle (dilim-3 pin)', async () => {
    const controller = createRunFlowController(makeControllerDeps());
    await controller.proposeRun('Ship the thing');
    const approved = controller.approve({ id: 'alperen' });

    expect(approved.state).toBe('APPROVED');
    expect(approved.handle).toBeUndefined();
  });
});

// ─── 3331: wireRunFlowMount supplies the production `ensureProviders` seam ───
describe('wireRunFlowMount — ensureProviders default seam (RECOVERY-BORN-NATIVE-DO-SLASH-PROVIDER-BOOTSTRAP-001)', () => {
  const seamDeps: RunFlowControllerDeps = { root: '/mock/root', config: {} as never };
  const fakeController = { getContext: () => ({ state: 'COLLECTING' }), proposeRun: vi.fn(), approve: vi.fn(), reject: vi.fn() } as unknown as RunFlowController;

  it('flag-on without a seam → factory receives deps with a callable ensureProviders (the ONE lazy bootstrap)', () => {
    const factory = vi.fn((() => fakeController) as unknown as typeof createRunFlowController);
    wireRunFlowMount(true, seamDeps, factory);
    expect(factory).toHaveBeenCalledTimes(1);
    const received = factory.mock.calls[0]![0];
    expect(typeof received.ensureProviders).toBe('function');
    expect(received.root).toBe('/mock/root');
  });

  it('flag-on with an injected seam → preserved by reference (tests/hosts stay in control)', () => {
    const injected = async () => ['fixture-provider'] as const;
    const factory = vi.fn((() => fakeController) as unknown as typeof createRunFlowController);
    wireRunFlowMount(true, { ...seamDeps, ensureProviders: injected }, factory);
    expect(factory.mock.calls[0]![0].ensureProviders).toBe(injected);
  });

  it('flag-off → factory never invoked, no seam constructed', () => {
    const factory = vi.fn((() => fakeController) as unknown as typeof createRunFlowController);
    expect(wireRunFlowMount(false, seamDeps, factory)).toBeUndefined();
    expect(factory).not.toHaveBeenCalled();
  });
});
