// tests/cli/repl/provider-bootstrap.test.ts
// RECOVERY-BORN-NATIVE-DO-SLASH-PROVIDER-BOOTSTRAP-001 (MASTER 3331): the ONE
// lazy, idempotent provider-bootstrap helper shared by the `deckent_propose_run`
// tool handler (557-003) and the REPL `/do` slash path (run-flow-controller
// `ensureProviders` seam). Hermetic: `core/provider.js` is fully mocked — no
// network, no real provider CLI probing; the config loader is an injected fake.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ensureProvidersBootstrapped } from '../../../src/cli/repl/provider-bootstrap.js';
import type { ResolvedConfig } from '../../../src/core/types.js';

const listProvidersMock = vi.fn<() => string[]>();
const bootstrapProvidersMock = vi.fn<(cfg: unknown, root?: string) => Promise<unknown>>();

vi.mock('../../../src/core/provider.js', () => ({
  providerRegistry: { listProviders: () => listProvidersMock() },
  bootstrapProviders: (cfg: unknown, root?: string) => bootstrapProvidersMock(cfg, root),
}));

const ROOT = '/fixture/root';
const CFG = { projectRoot: ROOT } as unknown as ResolvedConfig;

describe('ensureProvidersBootstrapped — single lazy idempotent seam (3331)', () => {
  beforeEach(() => {
    listProvidersMock.mockReset();
    bootstrapProvidersMock.mockReset();
  });

  it('empty registry → loads config ONCE, bootstraps ONCE with (config, root), returns the post-bootstrap list', async () => {
    let populated = false;
    listProvidersMock.mockImplementation(() => (populated ? ['fixture-provider'] : []));
    bootstrapProvidersMock.mockImplementation(async () => { populated = true; return undefined; });
    const loadCfg = vi.fn(async () => CFG);

    const registered = await ensureProvidersBootstrapped(ROOT, loadCfg);

    expect(loadCfg).toHaveBeenCalledTimes(1);
    expect(bootstrapProvidersMock).toHaveBeenCalledTimes(1);
    expect(bootstrapProvidersMock).toHaveBeenCalledWith(CFG, ROOT);
    expect(registered).toEqual(['fixture-provider']);
  });

  it('populated registry → neither config load nor bootstrap; returns the current list', async () => {
    listProvidersMock.mockReturnValue(['fixture-provider']);
    const loadCfg = vi.fn(async () => CFG);

    const registered = await ensureProvidersBootstrapped(ROOT, loadCfg);

    expect(loadCfg).not.toHaveBeenCalled();
    expect(bootstrapProvidersMock).not.toHaveBeenCalled();
    expect(registered).toEqual(['fixture-provider']);
  });

  it('bootstrap fault is swallowed (best-effort, mirrors spawn.ts recovery) — returns whatever is registered', async () => {
    listProvidersMock.mockReturnValue([]);
    bootstrapProvidersMock.mockRejectedValue(new Error('boom: provider bootstrap unavailable'));
    const loadCfg = vi.fn(async () => CFG);

    await expect(ensureProvidersBootstrapped(ROOT, loadCfg)).resolves.toEqual([]);
    expect(bootstrapProvidersMock).toHaveBeenCalledTimes(1);
  });

  it('config-loader fault is swallowed too — no throw escapes the seam', async () => {
    listProvidersMock.mockReturnValue([]);
    const loadCfg = vi.fn(async () => { throw new Error('config unreadable'); });

    await expect(ensureProvidersBootstrapped(ROOT, loadCfg)).resolves.toEqual([]);
    expect(bootstrapProvidersMock).not.toHaveBeenCalled();
  });

  it('second call after the registry became populated never double-bootstraps (idempotent at the seam)', async () => {
    let populated = false;
    listProvidersMock.mockImplementation(() => (populated ? ['fixture-provider'] : []));
    bootstrapProvidersMock.mockImplementation(async () => { populated = true; return undefined; });
    const loadCfg = vi.fn(async () => CFG);

    await ensureProvidersBootstrapped(ROOT, loadCfg);
    await ensureProvidersBootstrapped(ROOT, loadCfg);

    expect(bootstrapProvidersMock).toHaveBeenCalledTimes(1);
    expect(loadCfg).toHaveBeenCalledTimes(1);
  });
});
