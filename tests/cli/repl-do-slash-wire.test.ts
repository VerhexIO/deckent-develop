// ═══ /do slash ↔ shared RunFlow chain — integration wire (452-002) ═════════
//
// REPL-DO-SLASH-WIRE goCriteria file. Proves the `/do <goal>` slash drives the
// SAME RunFlow chain the native `deckent_propose_run` tool uses — via run.tsx's
// `wireRunFlowMount` (the /run precedent: one session controller) composed with
// app.tsx's `runReplDoSlash` — for BOTH flag states, without mounting Ink
// (ink-testing-library is not a project dependency; the pure-helper extraction
// is the blessed pattern — see app-surface-wire.test.tsx).
//
//   flag-ON : wireRunFlowMount(true) → controller;  /do → proposeRun(goal) →
//             setPreview(deriveRunFlowPreview(ctx)) — the exact join seam.
//   flag-OFF: wireRunFlowMount(false) → undefined, the controller factory is
//             NEVER invoked (it is what would touch readContext/planSprint), so
//             the flag-off path has ZERO fs/planner side effects; /do prints the
//             real getMessage-backed notice.

import { describe, it, expect, vi } from 'vitest';
import { wireRunFlowMount, buildDoSlashLabels } from '../../src/cli/repl/run.js';
import { runReplDoSlash, deriveRunFlowPreview, type ReplDoSlashDeps } from '../../src/cli/repl/app.js';
import { RunFlowProviderHoldError } from '../../src/cli/repl/run-flow-controller.js';
import { getMessage } from '../../src/cli/helpers/messages.js';
import type { RunFlowController, RunFlowControllerDeps } from '../../src/cli/repl/run-flow-controller.js';
import type { RunFlowContext, PlanPreview } from '../../src/core/run-flow-contract.js';
import type { ResolvedConfig } from '../../src/core/types.js';
import { runChatNativeLoop, type ChatNativeOptions, type ChatProviderAdapter, type McpToolDispatcher, type ProviderResponse } from "../../src/cli/commands/chat-native.js";

const PREVIEW: PlanPreview = {
  flowId: 'flow-wire-1', revision: 1, planDigest: 'digest-wire',
  taskSummaries: [], policyDecision: 'allow', gateResult: 'skipped',
};
const AWAITING: RunFlowContext = { state: 'AWAITING_APPROVAL', preview: PREVIEW };

// wireRunFlowMount only forwards `deps` to the factory; the fake factory below
// ignores it, so a cast-minimal deps object is sufficient (no real controller,
// no fs) — matches run-flow-mount.test.ts's wireRunFlowMount coverage.
const mountDeps: RunFlowControllerDeps = { root: '/mock/root', config: {} as ResolvedConfig };

function fakeController(record: { goal?: string }): RunFlowController {
  return {
    getContext: () => AWAITING,
    proposeRun: vi.fn(async (goal: string) => { record.goal = goal; return AWAITING; }),
    approve: vi.fn(() => AWAITING),
    reject: vi.fn(() => AWAITING),
  };
}

interface Sink {
  emitted: string[];
  previews: (PlanPreview | null)[];
  errors: string[];
}
function makeDeps(controller: RunFlowController | undefined, lang: string, sink: Sink): ReplDoSlashDeps {
  return {
    controller,
    labels: buildDoSlashLabels((k) => getMessage(k, lang)),
    emit: (t) => sink.emitted.push(t),
    setPreview: (p) => sink.previews.push(p),
    reportError: (m) => sink.errors.push(m),
  };
}

describe('/do slash wire — flag ON (terminal.run_flow_v2)', () => {
  it('mount composed → /do drives proposeRun(goal) → shared preview seam', async () => {
    const record: { goal?: string } = {};
    const controller = fakeController(record);
    const factory = vi.fn(() => controller);

    // The /run precedent: one session controller from wireRunFlowMount.
    const mounted = wireRunFlowMount(true, mountDeps, factory);
    expect(factory).toHaveBeenCalledTimes(1);
    expect(mounted).toBe(controller);

    const sink: Sink = { emitted: [], previews: [], errors: [] };
    await runReplDoSlash('add a health endpoint', makeDeps(mounted, 'en', sink));

    // proposeRun received the goal text …
    expect(controller.proposeRun).toHaveBeenCalledWith('add a health endpoint');
    expect(record.goal).toBe('add a health endpoint');
    // … and the preview handed to the card is EXACTLY the shared-seam derivation
    // (same setRunFlowPreview(deriveRunFlowPreview(ctx)) the tool path feeds).
    expect(sink.previews).toEqual([deriveRunFlowPreview(controller.getContext())]);
    expect(sink.previews).toEqual([PREVIEW]);
    expect(sink.emitted).toEqual([]);
    expect(sink.errors).toEqual([]);
  });
});

describe('/do slash wire — flag OFF', () => {
  it('mount returns undefined without building a controller (zero fs/planner)', () => {
    const factory = vi.fn(() => fakeController({}));
    const mounted = wireRunFlowMount(false, mountDeps, factory);
    expect(mounted).toBeUndefined();
    expect(factory).not.toHaveBeenCalled(); // no readContext/planSprint ever runs
  });

  it('/do prints the real getMessage flag-off notice, no fs/preview side effect', async () => {
    const factory = vi.fn(() => fakeController({}));
    const mounted = wireRunFlowMount(false, mountDeps, factory);

    const sink: Sink = { emitted: [], previews: [], errors: [] };
    await runReplDoSlash('add a health endpoint', makeDeps(mounted, 'en', sink));

    expect(sink.emitted).toEqual([getMessage('do.slash_flag_off', 'en')]);
    expect(sink.previews).toEqual([]);
    expect(sink.errors).toEqual([]);
    expect(factory).not.toHaveBeenCalled();
  });

  it('localizes the flag-off notice (tr)', async () => {
    const sink: Sink = { emitted: [], previews: [], errors: [] };
    await runReplDoSlash('bir şey yap', makeDeps(undefined, 'tr', sink));
    expect(sink.emitted).toEqual([getMessage('do.slash_flag_off', 'tr')]);
  });
});

// WIRE-015: physically merged from tests/cli/repl-slash-wire.test.ts.
{
// Sprint 221 T-221-001 — runChatNativeLoop slash-wire tests.
// Verifies that handleReplCommand is called from inside the loop so /exit,
// /quit, /clear are handled BEFORE provider dispatch — for any input source.
async function* lines(...items: string[]): AsyncIterable<string> {
    for (const item of items)
        yield item;
}

function queuedProvider(responses: ProviderResponse[]): {
    adapter: ChatProviderAdapter;
    sendSpy: ReturnType<typeof vi.fn>;
} {
    const remaining = [...responses];
    const sendSpy = vi.fn(async () => {
        const next = remaining.shift();
        if (!next)
            throw new Error('queuedProvider: response queue exhausted');
        return next;
    });
    return { adapter: { send: sendSpy }, sendSpy };
}

function fakeDispatcher(): {
    dispatcher: McpToolDispatcher;
    dispatchSpy: ReturnType<typeof vi.fn>;
} {
    const dispatchSpy = vi.fn(async () => 'tool-ok');
    return { dispatcher: { dispatch: dispatchSpy }, dispatchSpy };
}

function baseOpts(overrides: Partial<ChatNativeOptions> & {
    provider: ChatProviderAdapter;
    dispatcher: McpToolDispatcher;
    input: AsyncIterable<string>;
}): ChatNativeOptions {
    return {
        output: vi.fn(),
        ...overrides,
    };
}

describe('runChatNativeLoop — slash command wire (T-221-001)', () => {
    it('/exit breaks the loop without calling provider', async () => {
        const { adapter, sendSpy } = queuedProvider([]);
        const { dispatcher } = fakeDispatcher();
        const output = vi.fn();
        const transcript = await runChatNativeLoop(baseOpts({
            provider: adapter,
            dispatcher,
            input: lines('/exit'),
            output,
        }));
        expect(sendSpy).not.toHaveBeenCalled();
        expect(transcript).toEqual([]);
    });
    it('/quit breaks the loop without calling provider', async () => {
        const { adapter, sendSpy } = queuedProvider([]);
        const { dispatcher } = fakeDispatcher();
        const output = vi.fn();
        const transcript = await runChatNativeLoop(baseOpts({
            provider: adapter,
            dispatcher,
            input: lines('/quit'),
            output,
        }));
        expect(sendSpy).not.toHaveBeenCalled();
        expect(transcript).toEqual([]);
    });
    it('/clear empties the transcript and continues; subsequent line reaches provider', async () => {
        // First turn populates transcript, then /clear wipes it, then a fresh
        // turn arrives and is dispatched normally. After loop end, transcript
        // contains only the post-/clear turn (and its assistant reply).
        const { adapter, sendSpy } = queuedProvider([
            { text: 'one', stopReason: 'end_turn' },
            { text: 'two', stopReason: 'end_turn' },
        ]);
        const { dispatcher } = fakeDispatcher();
        const output = vi.fn();
        const transcript = await runChatNativeLoop(baseOpts({
            provider: adapter,
            dispatcher,
            input: lines('first', '/clear', 'second'),
            output,
        }));
        expect(sendSpy).toHaveBeenCalledTimes(2);
        expect(transcript).toEqual([
            { role: 'user', content: 'second' },
            { role: 'assistant', content: 'two' },
        ]);
    });
    it('normal line falls through to provider (slash does not swallow regular input)', async () => {
        const { adapter, sendSpy } = queuedProvider([
            { text: 'hi back', stopReason: 'end_turn' },
        ]);
        const { dispatcher } = fakeDispatcher();
        const output = vi.fn();
        const transcript = await runChatNativeLoop(baseOpts({
            provider: adapter,
            dispatcher,
            input: lines('hello'),
            output,
        }));
        expect(sendSpy).toHaveBeenCalledTimes(1);
        expect(transcript).toEqual([
            { role: 'user', content: 'hello' },
            { role: 'assistant', content: 'hi back' },
        ]);
    });
    it('uppercase /EXIT is normalized and breaks the loop', async () => {
        const { adapter, sendSpy } = queuedProvider([]);
        const { dispatcher } = fakeDispatcher();
        const output = vi.fn();
        const transcript = await runChatNativeLoop(baseOpts({
            provider: adapter,
            dispatcher,
            input: lines('  /EXIT  '),
            output,
        }));
        expect(sendSpy).not.toHaveBeenCalled();
        expect(transcript).toEqual([]);
    });
});
}

// ─── 3331: typed NO_PROVIDERS hold → localized `do.slash_no_providers` line ───
describe('/do slash wire — typed provider hold (RECOVERY-BORN-NATIVE-DO-SLASH-PROVIDER-BOOTSTRAP-001)', () => {
  const details = { flowId: 'flow-hold', model: 'fixture-brain-model', provider: 'fixture-provider', registered: ['other-provider'] };

  it.each(['en', 'tr'])('%s: reportError carries the localized template with {model}/{provider}/{registered} filled — never the raw message', async (lang) => {
    const controller = fakeController({});
    (controller.proposeRun as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new RunFlowProviderHoldError(details));
    const sink: Sink = { emitted: [], previews: [], errors: [] };

    await runReplDoSlash('Fixture goal', makeDeps(controller, lang, sink));

    expect(sink.previews).toEqual([]);
    expect(sink.errors).toEqual([
      getMessage('do.slash_no_providers', lang, { model: details.model, provider: details.provider, registered: 'other-provider' }),
    ]);
    expect(sink.errors[0]).not.toContain('NO_PROVIDERS');
    expect(getMessage('do.slash_no_providers', 'en')).not.toBe(getMessage('do.slash_no_providers', 'tr'));
  });

  it('buildDoSlashLabels carries the noProviders template (en/tr pin)', () => {
    for (const lang of ['en', 'tr']) {
      expect(buildDoSlashLabels((k) => getMessage(k, lang)).noProviders).toBe(getMessage('do.slash_no_providers', lang));
    }
  });

  it('a non-hold controller failure still reports its raw message (unchanged edge)', async () => {
    const controller = fakeController({});
    (controller.proposeRun as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('boom'));
    const sink: Sink = { emitted: [], previews: [], errors: [] };
    await runReplDoSlash('Fixture goal', makeDeps(controller, 'en', sink));
    expect(sink.errors).toEqual(['boom']);
  });
});
