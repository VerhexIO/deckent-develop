import { describe, it, expect } from 'vitest';
import {
  createDefaultConfig,
  getDefaultConfig,
  deepMerge,
  DEFAULT_TIMEOUT_CONFIG,
  mergeConfigs,
} from '../../src/core/config.js';
import type { DeckentConfig, ResolvedConfig } from '../../src/core/types.js';

/**
 * Sprint 156 Task 2: dependency_pipeline_enabled default flip regression guard.
 *
 * The field is declared on ResolvedConfig (config-types.ts) but is set by
 * createDefaultConfig() through a local intersection alias (DeckentConfigWithPipeline).
 * If a future refactor reverts the default to false/undefined, this test fails
 * immediately, preventing a regression of the dependency pipeline being silently
 * disabled across all projects.
 */
describe('createDefaultConfig — Sprint 156 dependency pipeline default flip', () => {
  it('dependency_pipeline_enabled is true by default', () => {
    const cfg = getDefaultConfig() as ResolvedConfig;
    expect(cfg.dependency_pipeline_enabled).toBe(true);
  });

  it('createDefaultConfig() and getDefaultConfig() return the same default value', () => {
    const a = createDefaultConfig() as ResolvedConfig;
    const b = getDefaultConfig() as ResolvedConfig;
    expect(a.dependency_pipeline_enabled).toBe(true);
    expect(b.dependency_pipeline_enabled).toBe(true);
    expect(a.dependency_pipeline_enabled).toBe(b.dependency_pipeline_enabled);
  });

  it('returns a fresh object each call (no shared reference)', () => {
    const a = getDefaultConfig();
    const b = getDefaultConfig();
    expect(a).not.toBe(b);
    // Mutating one must not affect the other — guards against accidental
    // singleton return that would let one test poison another.
    (a as ResolvedConfig).dependency_pipeline_enabled = false;
    expect((b as ResolvedConfig).dependency_pipeline_enabled).toBe(true);
  });
});

describe('memory_export resolved human-view limits', () => {
  it('uses the four bounded-render defaults without constraining durable records', () => {
    const config = createDefaultConfig();
    expect(config.memory_export).toEqual({
      max_inline_lines: 3000,
      max_inline_bytes: 256 * 1024,
      summary_inline_lines: 200,
      summary_inline_bytes: 16 * 1024,
    });
  });

  it('deep-merges global and project overrides into one effective render config', () => {
    const resolved = mergeConfigs(
      { memory_export: { max_inline_lines: 900, max_inline_bytes: 4096 } },
      { memory_export: { summary_inline_lines: 25, summary_inline_bytes: 512 } },
    );
    expect(resolved.memory_export).toEqual({
      max_inline_lines: 900,
      max_inline_bytes: 4096,
      summary_inline_lines: 25,
      summary_inline_bytes: 512,
    });
  });
});

/**
 * Sprint 192 Task 192-002 (Sprint 191 191-002 carry-over):
 * `timeout.runtime_extension_enabled` default flip false → true regression guard.
 *
 * The source-level flip landed in Sprint 191 hotfix commit `07f07c9a`
 * (DEFAULT_TIMEOUT_CONFIG in src/core/config.ts). This trio pins the contract
 * from the `tests/core/config-defaults.test.ts` exemplar so that a future
 * refactor reverting the default to false (or losing the field entirely)
 * fails immediately — production users would otherwise lose the bounded
 * heartbeat-aware extension and silently regress to synthetic NO_GO.
 *
 * Coverage: (a) default true, (b) explicit false override via deepMerge,
 * (c) 3-layer merge precedence — project override wins over global.
 */
describe('createDefaultConfig — Sprint 192 runtime_extension_enabled default flip', () => {
  it('runtime_extension_enabled is true by default', () => {
    const cfg = getDefaultConfig();
    expect(cfg.timeout?.runtime_extension_enabled).toBe(true);
    // DEFAULT_TIMEOUT_CONFIG is the single source of truth — assert directly.
    expect(DEFAULT_TIMEOUT_CONFIG.runtime_extension_enabled).toBe(true);
  });

  it('explicit false override is preserved through deepMerge', () => {
    const base = createDefaultConfig();
    const override: Partial<DeckentConfig> = {
      timeout: { runtime_extension_enabled: false },
    };
    const merged = deepMerge(base, override);
    expect(merged.timeout?.runtime_extension_enabled).toBe(false);
    // Sibling defaults must remain intact — guards against override
    // accidentally clobbering unrelated timeout fields.
    expect(merged.timeout?.docker_min_timeout).toBe(1200);
    expect(merged.timeout?.effort_base.high).toBe(2400);
  });

  it('3-layer merge precedence: project override wins over global', () => {
    // Mirrors mergeConfigs(globalConfig, projectConfig) ordering: defaults
    // first, then global, then project (project takes precedence).
    const base = createDefaultConfig();
    const globalCfg: Partial<DeckentConfig> = {
      timeout: { runtime_extension_enabled: false },
    };
    const projectCfg: Partial<DeckentConfig> = {
      timeout: { runtime_extension_enabled: true },
    };
    const afterGlobal = deepMerge(base, globalCfg);
    const finalCfg = deepMerge(afterGlobal, projectCfg);
    expect(finalCfg.timeout?.runtime_extension_enabled).toBe(true);
  });
});
