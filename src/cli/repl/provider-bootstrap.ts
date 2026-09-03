// ═══ provider-bootstrap — the ONE lazy, idempotent provider-registry seam ════
//
// RECOVERY-BORN-NATIVE-DO-SLASH-PROVIDER-BOOTSTRAP-001 (MASTER 3331; canonical
// class 7083 NATIVE-RUNFLOW-BOOTSTRAP-001). Every CLI entry point that plans
// (`deckent do`, `deckent run`, spawn.ts, serve.ts) bootstraps the global
// `providerRegistry` before the planner resolves an adapter. The native REPL
// boot never does: 557-003 added a lazy bootstrap to the `deckent_propose_run`
// tool handler only, so the `/do <goal>` SLASH path (app.tsx `runReplDoSlash` →
// controller.proposeRun) still reached an EMPTY registry and surfaced the raw
// `Provider not found: "<provider>"` string. This module is the single seam both
// paths now share (run-flow-controller's `ensureProviders` default is wired by
// run.tsx `wireRunFlowMount`; the tool handler calls it directly).
//
// Contract (mirrors spawn.ts's `if (!adapter)` recovery exactly):
//   - `core/provider.js` is imported lazily — REPL boot must not pay the provider
//     module (and its adapter graph) unless a plan is actually requested.
//   - `listProviders().length === 0` is the cheap outer gate; bootstrapProviders
//     is ALSO idempotent per provider, so a populated registry is never touched
//     and a second call never double-registers.
//   - The config loader runs ONLY when the registry is empty (the tool handler's
//     `loadConfig(root)` stays lazy; the controller passes its already-resolved
//     config through a no-op loader).
//   - Faults are swallowed (best-effort): the caller proceeds to the planner,
//     whose typed `NO_PROVIDERS` hold (run-flow-controller.ts) reports the
//     honest residual with the registered set this function returns.
import type { ResolvedConfig } from '../../core/types.js';

/** Lazily resolves the effective config — invoked only when the registry is empty. */
export type ProviderConfigLoader = () => Promise<ResolvedConfig>;

/**
 * Ensure the global provider registry is populated (idempotent, best-effort) and
 * return the provider names registered afterwards. Never throws.
 */
export async function ensureProvidersBootstrapped(
  root: string,
  loadCfg: ProviderConfigLoader,
): Promise<readonly string[]> {
  let registry: { listProviders(): string[] } | null = null;
  try {
    const provider = await import('../../core/provider.js');
    registry = provider.providerRegistry;
    if (provider.providerRegistry.listProviders().length === 0) {
      const cfg = await loadCfg();
      await provider.bootstrapProviders(cfg, root);
    }
  } catch {
    // Keep whatever the registry already had; the planner's typed hold reports
    // the residual. A bootstrap fault must never escape into an Ink callback.
  }
  try {
    return Object.freeze(registry ? [...registry.listProviders()] : []);
  } catch {
    return Object.freeze([]);
  }
}
