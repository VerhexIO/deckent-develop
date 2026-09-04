import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';
import type { BrainContext, SprintSizeRecommendation, DebtItem, Task, ModelType } from '../../src/core/types.js';
import type { ProviderAdapter } from '../../src/core/provider.js';

// ─── Mocks ──────────────────────────────────────────────────────────

// F-2: the planner's LLM calls are async now (injectable PlannerSpawnFn seam —
// the spawnSync freeze-class died). node:child_process stays mocked so the
// fail-soft `git ls-files` normalization step never runs real git in tests.
vi.mock('node:child_process', () => ({
  spawnSync: vi.fn(),
  spawn: vi.fn(),
}));

import {
  buildPlanPrompt,
  parsePlannerResponse,
  callBrainPlanner,
  callZeroConfigPlanner,
  buildZeroConfigFallbackPlan,
  buildPlannerSpawnArgs,
  buildZeroConfigPlanPrompt,
  createPlannerTaskModelPolicy,
  createPlannerSpawn,
  resolveAdapter,
  normalizePlannerDependencies,
  type PlannerSpawnFn,
  type PlannerSpawnOutcome,
} from '../../src/orchestra/planner.js';
import { providerRegistry } from '../../src/core/provider.js';
import { BRAIN_PLAN_TIMEOUT_MS } from '../../src/core/constants.js';
import { buildParametricModel, modelRegistry } from '../../src/core/model-registry.js';
import { TERMINAL_NATIVE_PROVIDER_PROOF_IDENTITY } from '../../src/core/production-wiring-host-proof.js';

/** Hermetic PlannerSpawnFn fake: records every call, returns the canned
 *  outcome (per-call overrides supported for the retry path). */
function makeSpawnFn(outcome: Partial<PlannerSpawnOutcome> = {}, perCall?: Array<Partial<PlannerSpawnOutcome>>) {
  const calls: Array<{ command: string; args: string[]; timeoutMs: number; stdin?: string }> = [];
  const fn: PlannerSpawnFn = async (command, args, opts) => {
    const idx = calls.length;
    calls.push({
      command,
      args: [...args],
      timeoutMs: opts.timeoutMs,
      ...(opts.stdin === undefined ? {} : { stdin: opts.stdin }),
    });
    return { status: 0, signal: null, stdout: validPlannerJSON, stderr: '', ...(perCall?.[idx] ?? outcome) };
  };
  return { fn, calls };
}

// ─── Helpers ────────────────────────────────────────────────────────

function makeContext(overrides: Partial<BrainContext> = {}): BrainContext {
  return {
    directives: '# Sprint 13\n## Task 1: Build feature\nBuild it',
    memory: '# Memory',
    retro: '',
    debt: [],
    patterns: '',
    decisions: '',
    existingTasks: [] as Task[],
    projectState: { gitStatus: '', fileTree: ['src/index.ts', 'src/core/types.ts'] },
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

// ─── Mock Adapter Factory ────────────────────────────────────────────

function makeMockAdapter(overrides: Partial<ProviderAdapter> = {}): ProviderAdapter {
  return {
    name: 'claude',
    supportedModels: ['claude-opus-4-8', 'claude-sonnet-5', 'claude-haiku-4-5-20251001'] as readonly ModelType[],
    spawn: vi.fn(),
    kill: vi.fn(),
    listWorkers: vi.fn().mockReturnValue([]),
    isAvailable: vi.fn().mockResolvedValue(true),
    buildCommand: vi.fn().mockImplementation(
      (model: ModelType, promptPath: string) => `mock-cli -p - --model ${model} < ${promptPath}`,
    ),
    ...overrides,
  };
}

function makeCodexAdapter(overrides: Partial<ProviderAdapter> = {}): ProviderAdapter {
  return {
    name: 'codex',
    supportedModels: ['o3', 'o4-mini'] as readonly ModelType[],
    spawn: vi.fn(),
    kill: vi.fn(),
    listWorkers: vi.fn().mockReturnValue([]),
    isAvailable: vi.fn().mockResolvedValue(true),
    buildCommand: vi.fn().mockImplementation(
      (model: ModelType, promptPath: string) => `codex --model ${model} --quiet < ${promptPath}`,
    ),
    ...overrides,
  };
}

function makeAdapterWithPlannerCommand(overrides: Partial<ProviderAdapter> = {}): ProviderAdapter {
  return {
    ...makeMockAdapter(),
    name: 'claude',
    buildPlannerCommand: vi.fn().mockImplementation(
      (prompt: string, model: ModelType) => ({
        command: 'custom-ai',
        args: ['--prompt', prompt, '--model', model, '--json'],
      }),
    ),
    ...overrides,
  };
}

const validPlannerJSON = JSON.stringify({
  tasks: [
    {
      title: 'Build feature',
      description: 'Build the feature',
      model: 'claude-sonnet-5',
      effort: 'normal',
      priority: 'NORMAL',
      reason: 'Standard task',
      scope: { directories: ['src/'], filesRead: [], filesWrite: ['src/feature.ts'] },
      dependencies: [],
      goNogo: { goCriteria: 'Tests pass', noGoCriteria: 'Build fails', techDebtAcceptable: 'Minor' },
      productionWiringProposal: productionWiringInput(),
    },
  ],
  reasoning: 'Single task for the directive',
});

function productionWiringInput() {
  return {
    version: 1, changeKind: 'runtime-change', ...TERMINAL_NATIVE_PROVIDER_PROOF_IDENTITY,
    disposition: { kind: 'production-wiring' },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  providerRegistry.clear();
});

// ═══ Tests ═══════════════════════════════════════════════════════════

describe('buildPlanPrompt', () => {
  it('includes directives content', () => {
    const prompt = buildPlanPrompt(makeContext(), makeRecommendation(), 'test-project');
    expect(prompt).toContain('Build feature');
  });

  it('includes project name', () => {
    const prompt = buildPlanPrompt(makeContext(), makeRecommendation(), 'my-app');
    expect(prompt).toContain('my-app');
  });

  it('includes maxWorkers as concurrent execution limit (not task count cap)', () => {
    const prompt = buildPlanPrompt(makeContext(), makeRecommendation({ maxWorkers: 3 }), 'test');
    expect(prompt).toContain('3');
    expect(prompt).not.toMatch(/Maksimum\s+\d+\s+görev oluştur/);
  });

  it('instructs AI to plan ALL directive tasks without count limit', () => {
    const prompt = buildPlanPrompt(makeContext(), makeRecommendation({ maxWorkers: 5 }), 'test');
    expect(prompt).toContain('Plan ALL tasks');
  });

  it('includes JSON format instruction', () => {
    const prompt = buildPlanPrompt(makeContext(), makeRecommendation(), 'test');
    expect(prompt).toContain('"tasks"');
    expect(prompt).toContain('"reasoning"');
  });

  it('requires identity-only production-wiring authoring and keeps host authority out', () => {
    const prompt = buildPlanPrompt(makeContext(), makeRecommendation(), 'test');
    expect(prompt).toContain('"productionWiringProposal"');
    expect(prompt).not.toContain('"hostProofProgram"');
    expect(prompt).not.toContain('sha256:<64 lowercase hex>');
    expect(prompt).toContain('Never emit hostProofProgram');
  });

  it('includes memory when present', () => {
    const prompt = buildPlanPrompt(makeContext({ memory: 'Remember this' }), makeRecommendation(), 'test');
    expect(prompt).toContain('Remember this');
  });

  it('includes critical debt', () => {
    const debt: DebtItem[] = [{
      id: 'debt-1', description: 'Fix the bug', originTaskId: 't-1', originSprintId: 's-1',
      priority: 'CRITICAL' as never, sprintsOpen: 3, resolved: false, createdAt: '',
    }];
    const prompt = buildPlanPrompt(makeContext({ debt }), makeRecommendation(), 'test');
    expect(prompt).toContain('Fix the bug');
  });

  it('includes file tree (limited to 100)', () => {
    const fileTree = Array.from({ length: 150 }, (_, i) => `src/file-${i}.ts`);
    const prompt = buildPlanPrompt(
      makeContext({ projectState: { gitStatus: '', fileTree } }),
      makeRecommendation(),
      'test',
    );
    expect(prompt).toContain('src/file-0.ts');
    expect(prompt).toContain('first 100');
    expect(prompt).not.toContain('src/file-149.ts');
  });

  it('truncates context to BRAIN_PLAN_MAX_CONTEXT_LINES', () => {
    const longDirectives = Array.from({ length: 300 }, (_, i) => `Directive line ${i}`).join('\n');
    const prompt = buildPlanPrompt(makeContext({ directives: longDirectives }), makeRecommendation(), 'test');
    expect(prompt.length).toBeGreaterThan(0);
  });

  it('handles empty context gracefully', () => {
    const emptyCtx = makeContext({ directives: '', memory: '', retro: '', patterns: '', decisions: '' });
    const prompt = buildPlanPrompt(emptyCtx, makeRecommendation(), 'test');
    expect(prompt).toContain('RULES:');
  });

  it('F-1: carries the shared FILE PATH RULES contract (same block as the zero-config prompt)', () => {
    const prompt = buildPlanPrompt(makeContext(), makeRecommendation(), 'test');
    expect(prompt).toContain('FILE PATH RULES:');
    expect(prompt).toContain('directory-qualified');
    expect(prompt).toContain('NEVER a bare filename');
    // SURF-6 kuyruk-D: goCriteria↔scope consistency (shared block — both prompts)
    expect(prompt).toContain('goNogo.goCriteria/noGoCriteria MUST also appear');
  });
});

describe('parsePlannerResponse', () => {
  it('canonicalizes AI-authored V2 wiring and derives both digests on the host', () => {
    const parsed = JSON.parse(validPlannerJSON) as { tasks: Array<Record<string, unknown>>; reasoning: string };
    parsed.tasks[0]!.productionWiringProposal = productionWiringInput();
    const result = parsePlannerResponse(JSON.stringify(parsed));

    expect(result?.tasks[0]?.productionWiring).toMatchObject({ version: 2 });
    expect(result?.tasks[0]?.productionWiring?.contractDigest).toMatch(/^[a-f0-9]{64}$/u);
    expect(result?.tasks[0]?.productionWiring?.hostProofProgramDigest).toBe(
      result?.tasks[0]?.productionWiring?.contract.hostProofProgram.programDigest,
    );
    expect(JSON.stringify(result?.tasks[0]?.productionWiring)).not.toContain('evidenceRefs');
  });

  it('rejects an AI production-write task that omits V2 instead of trusting planner prose', () => {
    const parsed = JSON.parse(validPlannerJSON) as { tasks: Array<Record<string, unknown>>; reasoning: string };
    delete parsed.tasks[0]!.productionWiringProposal;
    expect(parsePlannerResponse(JSON.stringify(parsed))).toBeNull();
  });

  it('admits an omitted contract only for a host-proven test-only scope', () => {
    const parsed = JSON.parse(validPlannerJSON) as { tasks: Array<Record<string, unknown>>; reasoning: string };
    delete parsed.tasks[0]!.productionWiringProposal;
    parsed.tasks[0]!.scope = {
      directories: ['tests/orchestra/'], filesRead: [], filesWrite: ['tests/orchestra/planner.test.ts'],
    };
    const result = parsePlannerResponse(JSON.stringify(parsed));
    expect(result?.tasks[0]?.productionWiring).toBeUndefined();
    expect(result?.tasks[0]?.productionWiringApplicability).toEqual({
      state: 'not-applicable', reasonCode: 'test-only-scope',
    });
  });

  it('rejects AI wiring whose identity tuple has no registered host profile', () => {
    const parsed = JSON.parse(validPlannerJSON) as { tasks: Array<Record<string, unknown>>; reasoning: string };
    const wiring = productionWiringInput();
    wiring.producer = { producerId: 'unregistered' };
    parsed.tasks[0]!.productionWiringProposal = wiring;
    expect(parsePlannerResponse(JSON.stringify(parsed))).toBeNull();
  });

  it('parses valid JSON', () => {
    const result = parsePlannerResponse(validPlannerJSON);
    expect(result).not.toBeNull();
    expect(result!.tasks).toHaveLength(1);
    expect(result!.tasks[0]!.title).toBe('Build feature');
    expect(result!.reasoning).toBe('Single task for the directive');
  });

  it('strips code fences', () => {
    const wrapped = '```json\n' + validPlannerJSON + '\n```';
    const result = parsePlannerResponse(wrapped);
    expect(result).not.toBeNull();
    expect(result!.tasks).toHaveLength(1);
  });

  it('returns null for invalid JSON', () => {
    expect(parsePlannerResponse('not json')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(parsePlannerResponse('')).toBeNull();
  });

  it('returns null for missing required fields', () => {
    const incomplete = JSON.stringify({ tasks: [{ title: 'X' }], reasoning: 'Y' });
    expect(parsePlannerResponse(incomplete)).toBeNull();
  });

  it('returns null for invalid model value', () => {
    const bad = JSON.stringify({
      tasks: [{
        title: 'X', description: 'Y', model: 'unowned-model', effort: 'normal',
        priority: 'NORMAL', reason: 'R', scope: { directories: [], filesRead: [], filesWrite: [] },
        dependencies: [], goNogo: { goCriteria: '', noGoCriteria: '', techDebtAcceptable: '' },
      }],
      reasoning: 'Y',
    });
    expect(parsePlannerResponse(bad)).toBeNull();
  });

  it('returns null for empty tasks array', () => {
    const empty = JSON.stringify({ tasks: [], reasoning: 'Y' });
    expect(parsePlannerResponse(empty)).toBeNull();
  });

  it('validates all model values', () => {
    for (const model of ['claude-opus-4-8', 'claude-sonnet-5', 'claude-haiku-4-5-20251001']) {
      const json = JSON.stringify({
        tasks: [{
          title: 'T', description: 'D', model, effort: 'normal',
          priority: 'NORMAL', reason: 'R', scope: { directories: [], filesRead: [], filesWrite: [] },
          dependencies: [], goNogo: { goCriteria: 'G', noGoCriteria: 'N', techDebtAcceptable: 'T' },
        }],
        reasoning: 'R',
      });
      expect(parsePlannerResponse(json)).not.toBeNull();
    }
  });
});

// ═══ resolveAdapter ═════════════════════════════════════════════════

describe('resolveAdapter', () => {
  it('returns explicitly provided adapter', () => {
    const adapter = makeMockAdapter();
    expect(resolveAdapter(adapter)).toBe(adapter);
  });

  it('returns registry default when no adapter provided', () => {
    const adapter = makeMockAdapter({ name: 'reg-default' });
    providerRegistry.registerProvider(adapter, true);
    expect(resolveAdapter()).toBe(adapter);
  });

  it('throws when no adapter provided and registry is empty', () => {
    expect(() => resolveAdapter()).toThrow(/No providers registered/);
  });

  it('does NOT silently fall back to any hardcoded provider', () => {
    expect(() => resolveAdapter()).toThrow();
  });

  // ─── born-690: model-aware resolution ──────────────────────────────
  // The default provider and the requested model are independent axes.
  // With brain_provider=codex the registry default became codex, and the
  // planner spawned `codex exec --model claude-sonnet-5` → hard 400. resolveAdapter
  // must prefer the adapter that OWNS the model.

  it('born-690: prefers the model-owning provider over the registry default', () => {
    const codex = makeCodexAdapter(); // name: 'codex'
    const claude = makeMockAdapter({ name: 'claude' });
    providerRegistry.registerProvider(codex, true); // codex is DEFAULT
    providerRegistry.registerProvider(claude);
    // 'claude-sonnet-5' is registry-owned by claude → claude adapter wins, not the default
    expect(resolveAdapter(undefined, 'claude-sonnet-5')).toBe(claude);
  });

  it('fails loudly for models unknown to the model registry instead of using the registry default', () => {
    const codex = makeCodexAdapter();
    providerRegistry.registerProvider(codex, true);
    expect(() => resolveAdapter(undefined, 'my-custom-ollama-tag' as ModelType))
      .toThrow(/Unknown model/);
  });

  it('fails loudly when the owning provider is absent instead of using a foreign registry default', () => {
    const codex = makeCodexAdapter();
    providerRegistry.registerProvider(codex, true);
    expect(() => resolveAdapter(undefined, 'claude-sonnet-5'))
      .toThrow(/Provider not found: "claude"/);
  });

  it('fails loudly for an absent explicit requested provider instead of re-resolving from model owner', () => {
    const claude = makeMockAdapter({ name: 'claude' });
    providerRegistry.registerProvider(claude, true);
    expect(() => resolveAdapter(undefined, 'claude-sonnet-5', 'ollama'))
      .toThrow(/Provider not found: "ollama"/);
  });

  it('born-690: an explicitly provided adapter still wins over model-aware resolution', () => {
    const codex = makeCodexAdapter();
    const claude = makeMockAdapter({ name: 'claude' });
    providerRegistry.registerProvider(claude, true);
    expect(resolveAdapter(codex, 'claude-sonnet-5')).toBe(codex);
  });
});

// ═══ buildPlannerSpawnArgs ═══════════════════════════════════════════

describe('buildPlannerSpawnArgs', () => {
  it('extracts CLI binary from adapter.buildCommand()', () => {
    const adapter = makeMockAdapter();
    const result = buildPlannerSpawnArgs(adapter, 'test prompt', 'claude-opus-4-8');
    expect(result.command).toBe('mock-cli');
  });

  it('builds generic args when adapter lacks buildPlannerCommand', () => {
    const adapter = makeMockAdapter();
    const result = buildPlannerSpawnArgs(adapter, 'my prompt', 'claude-sonnet-5');
    // Sprint 238 İŞ5: planner passes the real apiId (live from the registry), not the alias.
    expect(result.args).toEqual(['-p', 'my prompt', '--model', modelRegistry.resolveApiId('claude-sonnet-5'), '--output-format', 'json']);
  });

  it('extracts "codex" from codex adapter buildCommand', () => {
    const adapter = makeCodexAdapter();
    const result = buildPlannerSpawnArgs(adapter, 'test', 'gpt-5.5');
    expect(result.command).toBe('codex');
  });

  it('calls adapter.buildCommand to extract binary name', () => {
    const adapter = makeMockAdapter();
    buildPlannerSpawnArgs(adapter, 'test', 'claude-haiku-4-5-20251001');
    expect(adapter.buildCommand).toHaveBeenCalledWith('claude-haiku-4-5-20251001', '/dev/null');
  });

  it('delegates to adapter.buildPlannerCommand() when available', () => {
    const adapter = makeAdapterWithPlannerCommand();
    const result = buildPlannerSpawnArgs(adapter, 'my prompt', 'claude-opus-4-8');
    expect(result.command).toBe('custom-ai');
    expect(result.args).toEqual(['--prompt', 'my prompt', '--model', 'claude-opus-4-8', '--json']);
    expect(adapter.buildPlannerCommand).toHaveBeenCalledWith('my prompt', 'claude-opus-4-8');
  });

  it('does NOT call buildCommand when buildPlannerCommand is available', () => {
    const adapter = makeAdapterWithPlannerCommand();
    buildPlannerSpawnArgs(adapter, 'test', 'claude-sonnet-5');
    expect(adapter.buildCommand).not.toHaveBeenCalled();
  });

  it('codex adapter builds its own args via buildPlannerCommand', () => {
    const codexAdapter = makeCodexAdapter({
      buildPlannerCommand: vi.fn().mockImplementation(
        (prompt: string, model: ModelType) => ({
          command: 'codex',
          args: ['exec', '--model', model, '-q', prompt],
        }),
      ),
    });
    const result = buildPlannerSpawnArgs(codexAdapter, 'plan this', 'o3');
    expect(result.command).toBe('codex');
    expect(result.args).toEqual(['exec', '--model', 'o3', '-q', 'plan this']);
    expect(result.args).not.toContain('-p');
    expect(result.args).not.toContain('--output-format');
  });

  it('preserves provider-owned stdin without placing the prompt on argv', () => {
    const prompt = `large-plan-${'x'.repeat(128 * 1024)}`;
    const codexAdapter = makeCodexAdapter({
      buildPlannerCommand: () => ({
        command: 'codex',
        args: ['exec', '--model', 'gpt-5.5'],
        stdin: prompt,
      }),
    });
    const result = buildPlannerSpawnArgs(codexAdapter, prompt, 'gpt-5.5');
    expect(result.stdin).toBe(prompt);
    expect(result.args).not.toContain(prompt);
  });

  it('prefers a provider-native planner invocation over subprocess command construction', async () => {
    const execute = vi.fn().mockResolvedValue({
      status: 0,
      signal: null,
      stdout: validPlannerJSON.replace('claude-sonnet-5', 'gpt-5.5'),
      stderr: '',
    });
    const adapter = makeCodexAdapter({
      buildPlannerInvocation: vi.fn(() => ({
        calledProvider: 'codex',
        calledModel: 'gpt-5.5',
        transport: 'http',
        executionBackend: 'in-process',
        execute,
      })),
      buildPlannerCommand: vi.fn(() => { throw new Error('must not build a subprocess command'); }),
    });
    const spawnFn: PlannerSpawnFn = vi.fn(async () => {
      throw new Error('must not spawn');
    });

    const result = await callBrainPlanner(
      makeContext(), makeRecommendation(), 'gpt-5.5', 'test', adapter, 1234, undefined, spawnFn,
    );

    expect(result?.tasks[0]?.model).toBe('gpt-5.5');
    expect(execute).toHaveBeenCalledWith({ timeoutMs: 1234 });
    expect(spawnFn).not.toHaveBeenCalled();
    expect(adapter.buildPlannerCommand).not.toHaveBeenCalled();
  });

  it('fails loudly when provider metadata disagrees with the wire model or adapter identity', () => {
    const wrongModel = makeCodexAdapter({
      buildPlannerCommand: () => ({
        command: 'codex', args: ['exec', '--model', 'wire-model'],
        calledProvider: 'codex', calledModel: 'different-model',
      }),
    });
    expect(() => buildPlannerSpawnArgs(wrongModel, 'test', 'gpt-5.5')).toThrow(/wire model/);

    const wrongProvider = makeCodexAdapter({
      buildPlannerCommand: () => ({
        command: 'codex', args: ['exec', '--model', 'gpt-5.5'],
        calledProvider: 'gemini', calledModel: 'gpt-5.5',
      }),
    });
    expect(() => buildPlannerSpawnArgs(wrongProvider, 'test', 'gpt-5.5')).toThrow(/adapter identity/);

    const silentRemap = makeCodexAdapter({
      buildPlannerCommand: () => ({
        command: 'codex', args: ['exec', '--model', 'gpt-5.6-sol'],
        calledProvider: 'codex', calledModel: 'gpt-5.6-sol',
      }),
    });
    expect(() => buildPlannerSpawnArgs(silentRemap, 'test', 'gpt-5.5')).toThrow(/resolved model/);
  });

  it('maps the task default into the configured worker provider namespace', () => {
    const policy = createPlannerTaskModelPolicy('claude-opus-4-8', 'codex');
    expect(policy.defaultModel).toBe('gpt-5.5');
    expect(policy.allowedModels.length).toBeGreaterThan(0);
    expect(policy.allowedModels.every((model) => modelRegistry.get(model)?.provider === 'codex')).toBe(true);
  });

  it('registers an explicitly authorized versioned API model for downstream DIRECTIVES parsing', () => {
    const apiId = 'claude-versioned-policy-test-2026-07-20';
    modelRegistry.register(buildParametricModel(apiId, {
      provider: 'claude',
      costPerMillion: { input: 1, output: 5 },
      pricingEvidenceRef: 'test-fixture:versioned-policy-model',
    }));
    const policy = createPlannerTaskModelPolicy(apiId, 'claude');
    expect(policy.defaultModel).toBe(apiId);
    expect(policy.allowedModels).toContain(apiId);
    expect(modelRegistry.get(apiId)).toMatchObject({ id: apiId, apiId, provider: 'claude' });
  });

  it('throws when adapter.buildCommand returns empty string', () => {
    const adapter = makeMockAdapter({
      buildCommand: vi.fn().mockReturnValue(''),
    });
    expect(() => buildPlannerSpawnArgs(adapter, 'test', 'claude-opus-4-8')).toThrow(/empty buildCommand/);
  });
});

describe('createPlannerSpawn', () => {
  function fakeChild() {
    const child = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter & { setEncoding: ReturnType<typeof vi.fn> };
      stderr: EventEmitter & { setEncoding: ReturnType<typeof vi.fn> };
      stdin: EventEmitter & { end: ReturnType<typeof vi.fn> };
      kill: ReturnType<typeof vi.fn>;
    };
    child.stdout = Object.assign(new EventEmitter(), { setEncoding: vi.fn() });
    child.stderr = Object.assign(new EventEmitter(), { setEncoding: vi.fn() });
    child.stdin = Object.assign(new EventEmitter(), { end: vi.fn() });
    child.kill = vi.fn();
    return child;
  }

  it('uses the canonical win32 wrapper and carries large/metacharacter prompts only on stdin', async () => {
    const child = fakeChild();
    const spawnImpl = vi.fn(() => child) as never;
    const plannerSpawn = createPlannerSpawn({ platform: 'win32', spawnImpl });
    const prompt = `--plan $(not-a-command) & ${'x'.repeat(128 * 1024)}`;

    const outcomePromise = plannerSpawn('codex', ['exec', '--model', 'gpt-5.5'], {
      timeoutMs: 5_000,
      stdin: prompt,
    });
    child.stdout.emit('data', '{"tasks":[]}');
    child.emit('close', 0, null);

    await expect(outcomePromise).resolves.toMatchObject({ status: 0, stdout: '{"tasks":[]}' });
    expect(spawnImpl).toHaveBeenCalledWith(
      'cmd.exe',
      ['/c', 'codex', 'exec', '--model', 'gpt-5.5'],
      { stdio: ['pipe', 'pipe', 'pipe'], shell: false },
    );
    expect(child.stdin.end).toHaveBeenCalledWith(prompt);
    expect(spawnImpl.mock.calls[0]?.[1]).not.toContain(prompt);
  });

  it('spawns POSIX binaries directly and ignores stdin when no input is declared', async () => {
    const child = fakeChild();
    const spawnImpl = vi.fn(() => child) as never;
    const plannerSpawn = createPlannerSpawn({ platform: 'linux', spawnImpl });

    const outcomePromise = plannerSpawn('claude', ['-p', 'inline'], { timeoutMs: 5_000 });
    child.emit('close', 0, null);

    await expect(outcomePromise).resolves.toMatchObject({ status: 0 });
    expect(spawnImpl).toHaveBeenCalledWith(
      'claude',
      ['-p', 'inline'],
      { stdio: ['ignore', 'pipe', 'pipe'], shell: false },
    );
    expect(child.stdin.end).not.toHaveBeenCalled();
  });

  it('settles an early-exit stdin EPIPE once as a typed spawn error without crashing', async () => {
    const child = fakeChild();
    const spawnImpl = vi.fn(() => child) as never;
    const plannerSpawn = createPlannerSpawn({ platform: 'linux', spawnImpl });
    const prompt = 'x'.repeat(4 * 1024 * 1024);
    const epipe = Object.assign(new Error('write EPIPE'), { code: 'EPIPE' });

    const outcomePromise = plannerSpawn('codex', ['exec', '--model', 'gpt-5.5'], {
      timeoutMs: 5_000,
      stdin: prompt,
    });
    child.stdin.emit('error', epipe);
    child.emit('close', 1, null);

    await expect(outcomePromise).resolves.toMatchObject({
      status: null,
      signal: null,
      error: expect.objectContaining({ code: 'EPIPE' }),
    });
    expect(child.kill).toHaveBeenCalledTimes(1);
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    expect(child.stdin.end).toHaveBeenCalledTimes(1);
    expect(child.stdin.end).toHaveBeenCalledWith(prompt);
  });

  it('preserves timeout classification when SIGTERM causes a later stdin EPIPE', async () => {
    vi.useFakeTimers();
    try {
      const child = fakeChild();
      const spawnImpl = vi.fn(() => child) as never;
      const plannerSpawn = createPlannerSpawn({ platform: 'linux', spawnImpl });
      const outcomePromise = plannerSpawn('codex', ['exec', '--model', 'gpt-5.5'], {
        timeoutMs: 5_000,
        stdin: 'x'.repeat(4 * 1024 * 1024),
      });

      await vi.advanceTimersByTimeAsync(5_000);
      child.stdin.emit('error', Object.assign(new Error('write EPIPE'), { code: 'EPIPE' }));
      child.emit('close', null, 'SIGTERM');

      await expect(outcomePromise).resolves.toEqual({
        status: null,
        signal: 'SIGTERM',
        stdout: '',
        stderr: '',
      });
      expect(child.kill).toHaveBeenCalledTimes(1);
      expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    } finally {
      vi.useRealTimers();
    }
  });
});

// ═══ Provider Decoupling — callBrainPlanner ═════════════════════════

describe('callBrainPlanner with adapter', () => {
  it('uses adapter to determine CLI command', async () => {
    const adapter = makeMockAdapter();
    const { fn, calls } = makeSpawnFn();

    await callBrainPlanner(makeContext(), makeRecommendation(), 'claude-opus-4-8', 'test', adapter, undefined, undefined, fn);

    expect(calls[0]!.command).toBe('mock-cli');
    expect(calls[0]!.args).toEqual(expect.arrayContaining(['-p', expect.any(String), '--model', 'claude-opus-4-8', '--output-format', 'json']));
    expect(calls[0]!.timeoutMs).toBe(BRAIN_PLAN_TIMEOUT_MS);
  });

  it('uses codex adapter CLI binary when codex adapter provided', async () => {
    const adapter = makeCodexAdapter();
    const { fn, calls } = makeSpawnFn();

    await callBrainPlanner(makeContext(), makeRecommendation(), 'gpt-5.5', 'test', adapter, undefined, undefined, fn);

    expect(calls[0]!.command).toBe('codex');
    expect(calls[0]!.args).toEqual(expect.arrayContaining(['--model', modelRegistry.resolveApiId('gpt-5.5')]));
  });

  it('resolves the registered model-owning adapter when no adapter is passed', async () => {
    const adapter = makeMockAdapter({ name: 'claude' });
    providerRegistry.registerProvider(adapter, true);
    const { fn, calls } = makeSpawnFn();

    await callBrainPlanner(makeContext(), makeRecommendation(), 'claude-opus-4-8', 'test', undefined, undefined, undefined, fn);

    expect(calls[0]!.command).toBe('mock-cli');
    expect(calls[0]!.args).toEqual(expect.arrayContaining(['--model', 'claude-opus-4-8']));
  });

  it('rejects a foreign registry default before provider spawn when the model owner is absent', async () => {
    providerRegistry.registerProvider(makeCodexAdapter(), true);
    const { fn, calls } = makeSpawnFn();

    await expect(
      callBrainPlanner(
        makeContext(), makeRecommendation(), 'claude-opus-4-8', 'test',
        undefined, undefined, undefined, fn,
      ),
    ).rejects.toThrow(/Provider not found: "claude"/);

    expect(calls).toEqual([]);
  });

  it('rejects when registry is empty and no adapter provided (no silent fallback)', async () => {
    await expect(
      callBrainPlanner(makeContext(), makeRecommendation(), 'claude-opus-4-8', 'test'),
    ).rejects.toThrow(/Provider not found: "claude"/);
  });

  it('returns parsed result when adapter-based call succeeds', async () => {
    const adapter = makeMockAdapter();
    const { fn } = makeSpawnFn();

    const result = await callBrainPlanner(makeContext(), makeRecommendation(), 'claude-sonnet-5', 'test', adapter, undefined, undefined, fn);
    expect(result).not.toBeNull();
    expect(result!.tasks).toHaveLength(1);
    expect(result!.tasks[0]!.title).toBe('Build feature');
  });

  it('returns null when adapter-based call fails (non-zero exit)', async () => {
    const adapter = makeMockAdapter();
    const { fn } = makeSpawnFn({ status: 1, stdout: '', stderr: 'error' });

    await expect(
      callBrainPlanner(makeContext(), makeRecommendation(), 'claude-opus-4-8', 'test', adapter, undefined, undefined, fn),
    ).resolves.toBeNull();
  });

  it('returns null on empty stdout', async () => {
    const adapter = makeMockAdapter();
    const { fn } = makeSpawnFn({ status: 0, stdout: '' });

    await expect(
      callBrainPlanner(makeContext(), makeRecommendation(), 'claude-sonnet-5', 'test', adapter, undefined, undefined, fn),
    ).resolves.toBeNull();
  });

  it('returns null when the spawn times out (SIGTERM at the deadline)', async () => {
    const adapter = makeMockAdapter();
    const { fn } = makeSpawnFn({ status: null, signal: 'SIGTERM', stdout: '' });

    await expect(
      callBrainPlanner(makeContext(), makeRecommendation(), 'claude-sonnet-5', 'test', adapter, undefined, undefined, fn),
    ).resolves.toBeNull();
  });

  it('uses adapter with buildPlannerCommand for callBrainPlanner', async () => {
    const adapter = makeAdapterWithPlannerCommand();
    const { fn, calls } = makeSpawnFn();

    await callBrainPlanner(makeContext(), makeRecommendation(), 'claude-opus-4-8', 'test', adapter, undefined, undefined, fn);

    expect(calls[0]!.command).toBe('custom-ai');
    expect(calls[0]!.args).toEqual(expect.arrayContaining(['--prompt', expect.any(String), '--model', 'claude-opus-4-8', '--json']));
  });

  it('passes model parameter correctly', async () => {
    const adapter = makeMockAdapter();
    const { fn, calls } = makeSpawnFn();

    await callBrainPlanner(makeContext(), makeRecommendation(), 'claude-haiku-4-5-20251001', 'test', adapter, undefined, undefined, fn);

    const args = calls[0]!.args;
    const modelIdx = args.indexOf('--model');
    // Sprint 238 İŞ5: planner passes the real apiId, not the alias.
    expect(args[modelIdx + 1]).toBe('claude-haiku-4-5-20251001');
  });
});

// ═══ Provider Decoupling — callZeroConfigPlanner ════════════════════

describe('callZeroConfigPlanner', () => {
  it('rejects when no adapter and empty registry (no silent fallback)', async () => {
    await expect(
      callZeroConfigPlanner('Add login page', 'claude-sonnet-5', 'test-project'),
    ).rejects.toThrow(/Provider not found: "claude"/);
  });

  it('uses adapter CLI when adapter provided', async () => {
    const adapter = makeCodexAdapter();
    const { fn, calls } = makeSpawnFn();

    await callZeroConfigPlanner('Add login page', 'gpt-5.5', 'test-project', [], adapter, undefined, fn);

    expect(calls[0]!.command).toBe('codex');
    expect(calls[0]!.args).toEqual(expect.arrayContaining(['--model', modelRegistry.resolveApiId('gpt-5.5')]));
  });

  it('forwards provider-owned stdin through the zero-config planner dispatch', async () => {
    const adapter = makeCodexAdapter({
      buildPlannerCommand: (prompt, model) => ({
        command: 'codex',
        args: ['exec', '--model', model],
        stdin: prompt,
      }),
    });
    const { fn, calls } = makeSpawnFn();

    await callZeroConfigPlanner('Exact stdin plan', 'gpt-5.5', 'test-project', [], adapter, undefined, fn);

    expect(calls[0]!.stdin).toContain('Exact stdin plan');
    expect(calls[0]!.args.join(' ')).not.toContain('Exact stdin plan');
  });

  it('resolves the registered model-owning adapter when no adapter is passed', async () => {
    const adapter = makeCodexAdapter({ name: 'codex' });
    providerRegistry.registerProvider(adapter, true);
    const { fn, calls } = makeSpawnFn();

    await callZeroConfigPlanner('Add login page', 'gpt-5.5', 'test-project', [], undefined, undefined, fn);

    expect(calls[0]!.command).toBe('codex');
    expect(calls[0]!.args).toEqual(expect.arrayContaining(['--model', 'gpt-5.5']));
  });

  it('returns parsed result on success', async () => {
    const adapter = makeMockAdapter();
    const { fn } = makeSpawnFn();

    const result = await callZeroConfigPlanner('Add login page', 'claude-sonnet-5', 'test-project', [], adapter, undefined, fn);
    expect(result).not.toBeNull();
    expect(result!.tasks).toHaveLength(1);
  });

  it('returns null on failure', async () => {
    const adapter = makeMockAdapter();
    const { fn } = makeSpawnFn({ status: 1, stdout: '', stderr: 'fail' });

    await expect(
      callZeroConfigPlanner('Add login page', 'claude-sonnet-5', 'test-project', [], adapter, undefined, fn),
    ).resolves.toBeNull();
  });

  it('returns null on empty stdout', async () => {
    const adapter = makeMockAdapter();
    const { fn } = makeSpawnFn({ status: 0, stdout: '' });

    await expect(
      callZeroConfigPlanner('Add login page', 'claude-sonnet-5', 'test-project', [], adapter, undefined, fn),
    ).resolves.toBeNull();
  });

  it('uses adapter with buildPlannerCommand for zero-config', async () => {
    const adapter = makeAdapterWithPlannerCommand();
    const { fn, calls } = makeSpawnFn();

    await callZeroConfigPlanner('Add feature', 'claude-opus-4-8', 'test-project', [], adapter, undefined, fn);

    expect(calls[0]!.command).toBe('custom-ai');
    expect(calls[0]!.args).toEqual(expect.arrayContaining(['--prompt', expect.any(String), '--model', 'claude-opus-4-8', '--json']));
  });

  it('retries ONCE with a schema-feedback prompt when the first response is unparseable (U2)', async () => {
    const adapter = makeMockAdapter();
    const { fn, calls } = makeSpawnFn({}, [
      { status: 0, stdout: 'not json at all' },
      { status: 0, stdout: validPlannerJSON },
    ]);

    const result = await callZeroConfigPlanner('Add login page', 'claude-sonnet-5', 'test-project', [], adapter, undefined, fn);

    expect(calls).toHaveLength(2);
    expect(calls[1]!.args.join(' ')).toContain('YOUR PREVIOUS RESPONSE WAS INVALID');
    expect(result).not.toBeNull();
  });
});

// ═══ Structured planner / fallback unchanged ════════════════════════

describe('buildZeroConfigFallbackPlan', () => {
  it('returns a single-task plan without provider interaction', () => {
    const result = buildZeroConfigFallbackPlan('Add dark mode');
    expect(result.tasks).toHaveLength(1);
    expect(result.tasks[0]!.title).toBe('Add dark mode');
    expect(result.tasks[0]!.model).toBe('claude-sonnet-5');
    expect(result.reasoning).toContain('Zero-config fallback');
  });

  it('truncates long descriptions in title to 80 chars', () => {
    const longDesc = 'A'.repeat(120);
    const result = buildZeroConfigFallbackPlan(longDesc);
    expect(result.tasks[0]!.title).toHaveLength(80);
    expect(result.tasks[0]!.description).toBe(longDesc);
  });

  it('works without any provider registered (structured mode)', () => {
    providerRegistry.clear();
    const result = buildZeroConfigFallbackPlan('Simple task');
    expect(result.tasks).toHaveLength(1);
    expect(result.tasks[0]!.title).toBe('Simple task');
  });
});

describe('buildZeroConfigPlanPrompt', () => {
  it('includes the description in the prompt', () => {
    const prompt = buildZeroConfigPlanPrompt('Add login page', 'my-app');
    expect(prompt).toContain('Add login page');
    expect(prompt).toContain('my-app');
  });

  it('includes file tree when provided', () => {
    const prompt = buildZeroConfigPlanPrompt('Feature', 'app', ['src/index.ts', 'src/app.ts']);
    expect(prompt).toContain('src/index.ts');
    expect(prompt).toContain('FILE TREE');
  });

  it('omits file tree section when empty', () => {
    const prompt = buildZeroConfigPlanPrompt('Feature', 'app', []);
    expect(prompt).not.toContain('FILE TREE');
  });
});

// ═══ AI Planner Timeout Configurable ════════════════════════════════

describe('callBrainPlanner — configurable timeout', () => {
  it('uses default BRAIN_PLAN_TIMEOUT_MS when no timeout provided', async () => {
    const adapter = makeMockAdapter();
    const { fn, calls } = makeSpawnFn();

    await callBrainPlanner(makeContext(), makeRecommendation(), 'claude-sonnet-5', 'test', adapter, undefined, undefined, fn);

    expect(calls[0]!.timeoutMs).toBe(BRAIN_PLAN_TIMEOUT_MS);
  });

  it('uses custom timeout when provided (config.ai_planner_timeout)', async () => {
    const adapter = makeMockAdapter();
    const { fn, calls } = makeSpawnFn();

    const customTimeout = 120_000;
    await callBrainPlanner(makeContext(), makeRecommendation(), 'claude-sonnet-5', 'test', adapter, customTimeout, undefined, fn);

    expect(calls[0]!.timeoutMs).toBe(customTimeout);
  });

  it('custom timeout overrides the default BRAIN_PLAN_TIMEOUT_MS', async () => {
    const adapter = makeMockAdapter();
    const { fn, calls } = makeSpawnFn();

    const shortTimeout = 5_000;
    await callBrainPlanner(makeContext(), makeRecommendation(), 'claude-haiku-4-5-20251001', 'test', adapter, shortTimeout, undefined, fn);

    expect(calls[0]!.timeoutMs).toBe(shortTimeout);
    expect(calls[0]!.timeoutMs).not.toBe(BRAIN_PLAN_TIMEOUT_MS);
  });

  it('callZeroConfigPlanner uses custom timeout when provided', async () => {
    const adapter = makeMockAdapter();
    const { fn, calls } = makeSpawnFn();

    const customTimeout = 90_000;
    await callZeroConfigPlanner('Add feature', 'claude-sonnet-5', 'test-project', [], adapter, customTimeout, fn);

    expect(calls[0]!.timeoutMs).toBe(customTimeout);
  });

  it('callZeroConfigPlanner uses default timeout when none provided', async () => {
    const adapter = makeMockAdapter();
    const { fn, calls } = makeSpawnFn();

    await callZeroConfigPlanner('Add feature', 'claude-sonnet-5', 'test-project', [], adapter, undefined, fn);

    expect(calls[0]!.timeoutMs).toBe(BRAIN_PLAN_TIMEOUT_MS);
  });
});

// ═══ Zero hardcoded 'claude' strings verification ═══════════════════

describe('planner.ts provider decoupling — zero hardcoded claude', () => {
  it('planner.ts source file contains zero hardcoded "claude" strings', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(
      new URL('../../src/orchestra/planner.ts', import.meta.url),
      'utf-8',
    );
    expect(source).not.toContain("'claude'");
    expect(source).not.toContain('"claude"');
    expect(source.toLowerCase()).not.toMatch(/command\s*=\s*['"]claude['"]/);
  });

  it('missing adapter throws error with clear message (no silent fallback)', () => {
    providerRegistry.clear();
    expect(() => resolveAdapter()).toThrow();
  });

  it('adapter with buildPlannerCommand produces non-Claude-shaped args', () => {
    const adapter = makeAdapterWithPlannerCommand();
    const result = buildPlannerSpawnArgs(adapter, 'test prompt', 'claude-opus-4-8');
    expect(result.args).not.toContain('--output-format');
    expect(result.command).not.toBe('claude');
  });
});

// ═══ buildPriorityContextBlock ════════════════════════════════════════

import { buildPriorityContextBlock } from '../../src/orchestra/planner.js';

describe('buildPriorityContextBlock', () => {
  it('returns all sections joined when within limit', () => {
    const sections = [
      { text: 'DIRECTIVES:\nDo X', priority: 1 },
      { text: 'MEMORY:\nRemember Y', priority: 2 },
    ];
    const result = buildPriorityContextBlock(sections, 100);
    expect(result).toContain('DIRECTIVES');
    expect(result).toContain('MEMORY');
  });

  it('preserves higher-priority sections when truncating', () => {
    const directives = Array.from({ length: 50 }, (_, i) => `directive line ${i}`).join('\n');
    const memory = Array.from({ length: 50 }, (_, i) => `memory line ${i}`).join('\n');
    const patterns = Array.from({ length: 50 }, (_, i) => `pattern line ${i}`).join('\n');
    const sections = [
      { text: `DIRECTIVES:\n${directives}`, priority: 1 },
      { text: `MEMORY:\n${memory}`, priority: 2 },
      { text: `PATTERNS:\n${patterns}`, priority: 4 },
    ];
    const result = buildPriorityContextBlock(sections, 60);
    // DIRECTIVES (priority 1) must be preserved over PATTERNS (priority 4)
    expect(result).toContain('DIRECTIVES');
    expect(result).toContain('directive line');
  });

  it('drops lowest priority sections first when over limit', () => {
    const sections = [
      { text: 'DIRECTIVES:\nKeep this', priority: 1 },
      { text: 'FILE TREE:\nMaybe drop this', priority: 8 },
    ];
    const result = buildPriorityContextBlock(sections, 5);
    expect(result).toContain('DIRECTIVES');
    // FILE TREE has lower priority and may be dropped
  });

  it('skips empty text sections', () => {
    const sections = [
      { text: '', priority: 1 },
      { text: 'MEMORY:\nContent', priority: 2 },
    ];
    const result = buildPriorityContextBlock(sections, 100);
    expect(result).toBe('MEMORY:\nContent');
    expect(result).not.toContain('\n\n\n');
  });
});

// ═══ prompt language unification (PCOMP-8 U3) ═════════════════════════
// Model-facing prompts are SINGLE-SOURCE English — the former TR/EN fork had
// drifted (ADR block only in the TR branch while production defaulted to TR).
// These pins keep the fork dead: no Turkish prompt text may reappear.

describe('buildPlanPrompt — single English source', () => {
  it('is English with no language parameter', () => {
    const prompt = buildPlanPrompt(makeContext(), makeRecommendation(), 'test-project');
    expect(prompt).toContain('RULES:');
    expect(prompt).toContain('OUTPUT FORMAT');
    expect(prompt).toContain('Plan ALL tasks');
    expect(prompt).not.toContain('KURALLAR');
    expect(prompt).not.toContain('ÇIKTI FORMAT');
  });

  it('includes the context block', () => {
    const prompt = buildPlanPrompt(
      makeContext({ directives: 'Build something great' }),
      makeRecommendation(),
      'test-project',
    );
    expect(prompt).toContain('Build something great');
  });

  it('zero-config mode block is English', () => {
    const prompt = buildPlanPrompt(
      makeContext(), makeRecommendation(), 'test-project',
      'Add dark mode',
    );
    expect(prompt).toContain('ZERO-CONFIG MODE');
    expect(prompt).toContain('User started sprint');
    expect(prompt).not.toContain('Kullanıcı');
  });
});

describe('buildZeroConfigPlanPrompt — single English source', () => {
  it('is English with no language parameter', () => {
    const prompt = buildZeroConfigPlanPrompt('Add feature', 'my-app');
    expect(prompt).toContain('USER REQUEST');
    expect(prompt).toContain('OUTPUT FORMAT');
    expect(prompt).not.toContain('KULLANICI TALEBİ');
  });

  it('contains the description and project name', () => {
    const prompt = buildZeroConfigPlanPrompt('Add dark mode', 'my-app');
    expect(prompt).toContain('Add dark mode');
    expect(prompt).toContain('my-app');
  });
});

// ═══ normalizePlannerDependencies (323-031) ══════════════════════════

describe('normalizePlannerDependencies', () => {
  // Sibling tasks as the AI planner would produce them once createTask has
  // assigned real NNN-NNN ids. AI emits deps by TITLE; this pass rewrites them.
  function siblings(): Array<{ id: string; title: string; dependencies?: string[] }> {
    return [
      { id: '323-005', title: 'Setup database schema', dependencies: [] },
      { id: '323-007', title: 'Build REST API', dependencies: [] },
      { id: '323-010', title: 'Login page UI', dependencies: [] },
    ];
  }

  it('resolves a title-string dependency to the sibling task id (faithful — pre-fix RED)', () => {
    // Pre-fix: the title would survive (or be silently dropped by buildDependencyGraph).
    // Post-fix: it normalizes to the concrete id.
    const tasks = siblings();
    tasks[2]!.dependencies = ['Build REST API']; // Login UI depends on the API (by title)

    const result = normalizePlannerDependencies(tasks);

    expect(tasks[2]!.dependencies).toEqual(['323-007']);
    expect(result.resolvedCount).toBe(1);
    expect(result.dropped).toEqual([]);
  });

  it('resolves multiple deps mixing title and slot-id refs', () => {
    const tasks = siblings();
    tasks[2]!.dependencies = ['Setup database schema', '323-007'];

    const result = normalizePlannerDependencies(tasks);

    expect(tasks[2]!.dependencies).toEqual(['323-005', '323-007']);
    expect(result.resolvedCount).toBe(2);
    expect(result.dropped).toEqual([]);
  });

  it('preserves already-correct slot-id dependencies (behaviour-preserving)', () => {
    const tasks = siblings();
    tasks[1]!.dependencies = ['323-005'];

    const result = normalizePlannerDependencies(tasks);

    expect(tasks[1]!.dependencies).toEqual(['323-005']);
    expect(result.dropped).toEqual([]);
  });

  it('de-duplicates repeated refs that resolve to the same id', () => {
    const tasks = siblings();
    tasks[2]!.dependencies = ['Setup database schema', 'Setup database schema', '323-005'];

    normalizePlannerDependencies(tasks);

    expect(tasks[2]!.dependencies).toEqual(['323-005']);
  });

  it('drops a self-reference without reporting it as unresolvable', () => {
    const tasks = siblings();
    tasks[0]!.dependencies = ['Setup database schema']; // names itself by title

    const result = normalizePlannerDependencies(tasks);

    expect(tasks[0]!.dependencies).toEqual([]);
    expect(result.dropped).toEqual([]);
  });

  it('drops an unresolvable title dep and reports it (never silent)', () => {
    const tasks = siblings();
    tasks[1]!.dependencies = ['Nonexistent task'];

    const result = normalizePlannerDependencies(tasks);

    expect(tasks[1]!.dependencies).toEqual([]);
    expect(result.resolvedCount).toBe(0);
    expect(result.dropped).toEqual([
      { taskId: '323-007', ref: 'Nonexistent task', looksLikePlanSlotId: false },
    ]);
  });

  it('flags an id-shaped unresolvable ref distinctly from a title typo', () => {
    const tasks = siblings();
    tasks[1]!.dependencies = ['999-999']; // id-shaped but no such task

    const result = normalizePlannerDependencies(tasks);

    expect(tasks[1]!.dependencies).toEqual([]);
    expect(result.dropped).toEqual([
      { taskId: '323-007', ref: '999-999', looksLikePlanSlotId: true },
    ]);
  });

  it('leaves tasks with empty / undefined dependencies untouched', () => {
    const tasks: Array<{ id: string; title: string; dependencies?: string[] }> = [
      { id: '323-005', title: 'A', dependencies: [] },
      { id: '323-007', title: 'B' }, // undefined dependencies
    ];

    const result = normalizePlannerDependencies(tasks);

    expect(tasks[0]!.dependencies).toEqual([]);
    expect(tasks[1]!.dependencies).toBeUndefined();
    expect(result.resolvedCount).toBe(0);
    expect(result.dropped).toEqual([]);
  });
});
