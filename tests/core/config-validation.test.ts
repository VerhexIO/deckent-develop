import { describe, it, expect } from 'vitest';
import {
  validateConfig,
  ConfigValidationError,
  createDefaultConfig,
  DEFAULT_MODES,
} from '../../src/core/config.js';
import type { DeckentConfig, PlanModeConfig } from '../../src/core/types.js';

// ─── Helper: build a valid config then override specific fields ─────
function buildConfig(overrides?: Partial<DeckentConfig>): DeckentConfig {
  const base = createDefaultConfig();
  return { ...base, ...overrides };
}

function buildConfigWithModeOverride(
  modeName: 'performance' | 'balanced' | 'economic' | 'api',
  overrides: Partial<PlanModeConfig>,
): DeckentConfig {
  const config = createDefaultConfig();
  config.modes[modeName] = { ...config.modes[modeName], ...overrides } as PlanModeConfig;
  return config;
}

describe('validateConfig', () => {
  // ─── Valid config ──────────────────────────────────────────────────

  it('returns empty warnings for a valid default config', () => {
    const config = createDefaultConfig();
    const warnings = validateConfig(config);
    expect(warnings).toEqual([]);
  });

  it('returns empty warnings when all fields are correct', () => {
    const config = buildConfig({ language: 'tr' });
    const warnings = validateConfig(config);
    expect(warnings).toEqual([]);
  });

  it('validates bounded memory_export units and rejects unknown or invalid fields', () => {
    const valid = buildConfig({
      memory_export: {
        max_inline_lines: 1,
        max_inline_bytes: 1,
        summary_inline_lines: 0,
        summary_inline_bytes: 0,
      },
    });
    expect(() => validateConfig(valid)).not.toThrow();

    for (const memory_export of [
      { max_inline_lines: 0 },
      { max_inline_bytes: 0 },
      { summary_inline_lines: 1.5 },
      { summary_inline_bytes: Number.POSITIVE_INFINITY },
      { unrecognized_limit: 7 },
    ]) {
      expect(() => validateConfig(buildConfig({ memory_export }))).toThrow(ConfigValidationError);
    }
  });

  // ─── Invalid mode ─────────────────────────────────────────────────

  it('throws ConfigValidationError for invalid mode', () => {
    const config = buildConfig({ mode: 'invalid_mode' as any });
    expect(() => validateConfig(config)).toThrow(ConfigValidationError);
    try {
      validateConfig(config);
    } catch (e) {
      const err = e as ConfigValidationError;
      expect(err.errors).toContainEqual(expect.stringContaining('Invalid value'));
      expect(err.errors).toContainEqual(expect.stringContaining('invalid_mode'));
    }
  });

  // ─── Invalid language ─────────────────────────────────────────────

  it('throws ConfigValidationError for invalid language', () => {
    const config = buildConfig({ language: 'de' });
    expect(() => validateConfig(config)).toThrow(ConfigValidationError);
    try {
      validateConfig(config);
    } catch (e) {
      const err = e as ConfigValidationError;
      expect(err.errors).toContainEqual(expect.stringContaining('Invalid value'));
    }
  });

  it('accepts undefined language (uses default)', () => {
    const config = createDefaultConfig();
    delete (config as any).language;
    expect(() => validateConfig(config)).not.toThrow();
  });

  // ─── Invalid max_workers ──────────────────────────────────────────

  it('throws for max_workers = 0', () => {
    const config = buildConfigWithModeOverride('performance', { max_workers: 0 });
    expect(() => validateConfig(config)).toThrow(ConfigValidationError);
  });

  it('throws for max_workers = -1', () => {
    const config = buildConfigWithModeOverride('performance', { max_workers: -1 });
    expect(() => validateConfig(config)).toThrow(ConfigValidationError);
  });

  it('throws for max_workers = 101 (above limit)', () => {
    const config = buildConfigWithModeOverride('performance', { max_workers: 101 });
    expect(() => validateConfig(config)).toThrow(ConfigValidationError);
  });

  it('throws for max_workers as string (non-auto)', () => {
    const config = buildConfigWithModeOverride('performance', { max_workers: 'fast' as any });
    expect(() => validateConfig(config)).toThrow(ConfigValidationError);
  });

  it('accepts max_workers = "auto"', () => {
    const config = buildConfigWithModeOverride('performance', { max_workers: 'auto' });
    expect(() => validateConfig(config)).not.toThrow();
  });

  it('returns warning (not error) for max_workers >= 20', () => {
    const config = buildConfigWithModeOverride('performance', { max_workers: 25 });
    const warnings = validateConfig(config);
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0]).toContain('>=20');
  });

  it('max_workers = 19 does not produce a warning', () => {
    const config = buildConfigWithModeOverride('performance', { max_workers: 19 });
    const warnings = validateConfig(config);
    // Should have no warnings about performance specifically
    const maxPlanWarnings = warnings.filter(w => w.includes('performance'));
    expect(maxPlanWarnings).toHaveLength(0);
  });

  // ─── Invalid brain_model ──────────────────────────────────────────

  it('throws for invalid brain_model', () => {
    const config = buildConfigWithModeOverride('performance', { brain_model: 'gpt4' as any });
    expect(() => validateConfig(config)).toThrow(ConfigValidationError);
    try {
      validateConfig(config);
    } catch (e) {
      const err = e as ConfigValidationError;
      expect(err.errors).toContainEqual(expect.stringContaining('brain_model'));
    }
  });

  // ─── Invalid default_model ────────────────────────────────────────

  it('throws for invalid default_model', () => {
    const config = buildConfigWithModeOverride('economic', { default_model: 'llama' as any });
    expect(() => validateConfig(config)).toThrow(ConfigValidationError);
    try {
      validateConfig(config);
    } catch (e) {
      const err = e as ConfigValidationError;
      expect(err.errors).toContainEqual(expect.stringContaining('default_model'));
    }
  });

  // ─── Invalid haiku_allowed ────────────────────────────────────────

  it('throws for non-boolean haiku_allowed', () => {
    const config = buildConfigWithModeOverride('performance', { haiku_allowed: 'yes' as any });
    expect(() => validateConfig(config)).toThrow(ConfigValidationError);
    try {
      validateConfig(config);
    } catch (e) {
      const err = e as ConfigValidationError;
      expect(err.errors).toContainEqual(expect.stringContaining('haiku_allowed'));
    }
  });

  it('throws for numeric haiku_allowed', () => {
    const config = buildConfigWithModeOverride('performance', { haiku_allowed: 1 as any });
    expect(() => validateConfig(config)).toThrow(ConfigValidationError);
  });

  // ─── Invalid brain_planning ───────────────────────────────────────

  it('throws for invalid brain_planning value', () => {
    const config = buildConfigWithModeOverride('performance', { brain_planning: 'manual' as any });
    expect(() => validateConfig(config)).toThrow(ConfigValidationError);
    try {
      validateConfig(config);
    } catch (e) {
      const err = e as ConfigValidationError;
      expect(err.errors).toContainEqual(expect.stringContaining('brain_planning'));
    }
  });

  it('accepts valid brain_planning values (ai, structured, auto)', () => {
    for (const value of ['ai', 'structured', 'auto'] as const) {
      const config = buildConfigWithModeOverride('performance', { brain_planning: value });
      expect(() => validateConfig(config)).not.toThrow();
    }
  });

  // ─── API mode budget_per_sprint ───────────────────────────────────

  it('throws for non-positive budget_per_sprint in API mode', () => {
    const config = buildConfigWithModeOverride('api', { budget_per_sprint: 0 });
    expect(() => validateConfig(config)).toThrow(ConfigValidationError);
  });

  it('throws for negative budget_per_sprint in API mode', () => {
    const config = buildConfigWithModeOverride('api', { budget_per_sprint: -5 });
    expect(() => validateConfig(config)).toThrow(ConfigValidationError);
  });

  it('throws for non-number budget_per_sprint in API mode', () => {
    const config = buildConfigWithModeOverride('api', { budget_per_sprint: 'unlimited' as any });
    expect(() => validateConfig(config)).toThrow(ConfigValidationError);
  });

  it('accepts positive budget_per_sprint in API mode', () => {
    const config = buildConfigWithModeOverride('api', { budget_per_sprint: 10 });
    expect(() => validateConfig(config)).not.toThrow();
  });

  // ─── Missing mode config ──────────────────────────────────────────

  it('throws for missing mode config entry', () => {
    const config = createDefaultConfig();
    delete (config.modes as any).api;
    expect(() => validateConfig(config)).toThrow(ConfigValidationError);
    try {
      validateConfig(config);
    } catch (e) {
      const err = e as ConfigValidationError;
      expect(err.errors).toContainEqual(expect.stringContaining('Missing mode config'));
      expect(err.errors).toContainEqual(expect.stringContaining('api'));
    }
  });

  // ─── Multiple errors accumulated ──────────────────────────────────

  it('accumulates multiple errors in ConfigValidationError.errors', () => {
    const config = createDefaultConfig();
    config.mode = 'invalid' as any;
    config.modes.performance.brain_model = 'gpt4' as any;
    config.modes.performance.haiku_allowed = 'maybe' as any;
    config.modes.economic.default_model = 'llama' as any;

    expect(() => validateConfig(config)).toThrow(ConfigValidationError);
    try {
      validateConfig(config);
    } catch (e) {
      const err = e as ConfigValidationError;
      expect(err.errors.length).toBeGreaterThanOrEqual(4);
      expect(err.name).toBe('ConfigValidationError');
      expect(err.message).toContain('Config validation failed');
    }
  });

  // ─── ConfigValidationError structure ──────────────────────────────

  it('ConfigValidationError contains all error strings in message', () => {
    const errors = ['Error 1', 'Error 2', 'Error 3'];
    const err = new ConfigValidationError(errors);
    expect(err.errors).toEqual(errors);
    expect(err.message).toContain('Error 1');
    expect(err.message).toContain('Error 2');
    expect(err.message).toContain('Error 3');
    expect(err.name).toBe('ConfigValidationError');
  });

  // ─── Edge: boundary values ────────────────────────────────────────

  it('accepts max_workers = 1 (lower boundary)', () => {
    const config = buildConfigWithModeOverride('performance', { max_workers: 1 });
    expect(() => validateConfig(config)).not.toThrow();
  });

  it('accepts max_workers = 100 (upper boundary) with warning', () => {
    const config = buildConfigWithModeOverride('performance', { max_workers: 100 });
    const warnings = validateConfig(config);
    expect(warnings.length).toBeGreaterThan(0);
  });

  // ─── routing_engine validation ────────────────────────────────────

  it('rejects routing_engine = v1 (ROUTE-V1-PURGE / ADR-G-006)', () => {
    const config = buildConfig({ routing_engine: 'v1' as 'v3' });
    expect(() => validateConfig(config)).toThrow(ConfigValidationError);
  });

  it('accepts routing_engine = v3', () => {
    const config = buildConfig({ routing_engine: 'v3' });
    expect(() => validateConfig(config)).not.toThrow();
  });

  it('accepts routing_engine = undefined (omitted)', () => {
    const config = buildConfig();
    delete (config as Record<string, unknown>)['routing_engine'];
    expect(() => validateConfig(config)).not.toThrow();
  });

  it('throws ConfigValidationError for invalid routing_engine', () => {
    const config = buildConfig({ routing_engine: 'v4' as 'v3' });
    expect(() => validateConfig(config)).toThrow(ConfigValidationError);
    try {
      validateConfig(config);
    } catch (e) {
      const err = e as ConfigValidationError;
      expect(err.errors).toContainEqual(expect.stringContaining('routing_engine'));
      expect(err.errors).toContainEqual(expect.stringContaining('v4'));
    }
  });

  it('createDefaultConfig includes routing_engine = v3', () => {
    const config = createDefaultConfig();
    expect(config.routing_engine).toBe('v3');
  });
});
