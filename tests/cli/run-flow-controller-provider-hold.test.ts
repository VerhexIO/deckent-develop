// tests/cli/run-flow-controller-provider-hold.test.ts
// RECOVERY-BORN-NATIVE-DO-SLASH-PROVIDER-BOOTSTRAP-001 (MASTER 3331):
// run-flow-controller's `ensureProviders` seam runs BEFORE planning, and a
// planner failure whose cause chain is a ProviderNotFoundError surfaces as the
// typed `RunFlowProviderHoldError` (code NO_PROVIDERS) instead of the raw
// "Provider not found" string. Hermetic: planRunFlow + readContext are mocked;
// no fs, no provider CLI, no real model identifiers (fixture names only).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ResolvedConfig, SprintSizeRecommendation } from '../../src/core/types.js';

const planRunFlowMock = vi.fn();
vi.mock('../../src/orchestra/run-flow-plan-service.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/orchestra/run-flow-plan-service.js')>();
  return { ...actual, planRunFlow: (...a: unknown[]) => planRunFlowMock(...a) };
});
vi.mock('../../src/orchestra/brain.js', () => ({ readContext: vi.fn(() => ({ directives: '' })) }));

import { createRunFlowController, RunFlowProviderHoldError } from '../../src/cli/repl/run-flow-controller.js';

const FIXTURE_MODEL = 'fixture-brain-model';
const FIXTURE_PROVIDER = 'fixture-provider';
const config = {
  mode: 'performance',
  modes: { performance: { brain_model: FIXTURE_MODEL, default_model: FIXTURE_MODEL, max_workers: 1 } },
  max_workers: 1,
} as unknown as ResolvedConfig;
const recommendation: SprintSizeRecommendation = {
  maxTasks: 3, maxWorkers: 1, reason: 'fixture',
} as unknown as SprintSizeRecommendation;

function providerNotFoundCause(): Error {
  const inner = new Error(`Provider not found: "${FIXTURE_PROVIDER}"`);
  inner.name = 'ProviderNotFoundError';
  (inner as Error & { providerName: string }).providerName = FIXTURE_PROVIDER;
  const wrapped = new Error('run-proposal-compiler: planner failed to produce a real plan', { cause: inner });
  wrapped.name = 'RunProposalPlanError';
  return wrapped;
}

function awaitingApproval() {
  return {
    context: {
      state: 'AWAITING_APPROVAL',
      flowId: 'flow-fixture',
      preview: { flowId: 'flow-fixture', revision: 1, planDigest: 'digest', taskSummaries: [], policyDecision: 'allow', gateResult: 'skipped' },
    },
  };
}

describe('run-flow-controller — ensureProviders seam + typed NO_PROVIDERS hold (3331)', () => {
  beforeEach(() => { planRunFlowMock.mockReset(); });

  it('awaits ensureProviders BEFORE planRunFlow (order pinned)', async () => {
    const order: string[] = [];
    planRunFlowMock.mockImplementation(async () => { order.push('plan'); return awaitingApproval(); });
    const ensureProviders = vi.fn(async () => { order.push('bootstrap'); return [FIXTURE_PROVIDER]; });
    const controller = createRunFlowController({ root: '/fixture/root', config, recommendation, ensureProviders });

    const ctx = await controller.proposeRun('Fixture goal');

    expect(order).toEqual(['bootstrap', 'plan']);
    expect(ctx.state).toBe('AWAITING_APPROVAL');
  });

  it('ProviderNotFoundError in the cause chain → RunFlowProviderHoldError(code NO_PROVIDERS) with model, provider, registered, flowId', async () => {
    planRunFlowMock.mockRejectedValue(providerNotFoundCause());
    const controller = createRunFlowController({
      root: '/fixture/root', config, recommendation,
      generateFlowId: () => 'flow-hold-1',
      ensureProviders: async () => ['other-provider'],
    });

    const err = await controller.proposeRun('Fixture goal').catch((e: unknown) => e);

    expect(err).toBeInstanceOf(RunFlowProviderHoldError);
    const hold = err as RunFlowProviderHoldError;
    expect(hold.code).toBe('NO_PROVIDERS');
    expect(hold.details).toEqual({
      flowId: 'flow-hold-1',
      model: FIXTURE_MODEL,
      provider: FIXTURE_PROVIDER,
      registered: ['other-provider'],
    });
    // The typed message stays machine-shaped (the REPL localizes it) and never
    // leaks the raw "Provider not found" string as the only carrier.
    expect(hold.message).toContain('NO_PROVIDERS');
    expect(hold.message).toContain(FIXTURE_MODEL);
    expect(hold.message).toContain(FIXTURE_PROVIDER);
  });

  it('a non-provider planner failure passes through UNCHANGED (no new error shape for unrelated faults)', async () => {
    const boom = new Error('planner timed out');
    planRunFlowMock.mockRejectedValue(boom);
    const controller = createRunFlowController({ root: '/fixture/root', config, recommendation, ensureProviders: async () => [] });

    await expect(controller.proposeRun('Fixture goal')).rejects.toBe(boom);
  });

  it('no ensureProviders seam (unit tests, legacy callers) → planning still runs; a provider hold reports registered=[]', async () => {
    planRunFlowMock.mockRejectedValue(providerNotFoundCause());
    const controller = createRunFlowController({ root: '/fixture/root', config, recommendation, generateFlowId: () => 'flow-hold-2' });

    const err = await controller.proposeRun('Fixture goal').catch((e: unknown) => e);

    expect(planRunFlowMock).toHaveBeenCalledTimes(1);
    expect(err).toBeInstanceOf(RunFlowProviderHoldError);
    expect((err as RunFlowProviderHoldError).details.registered).toEqual([]);
  });
});
