import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConfigValidationError, createDefaultConfig, getConfigHelp, mergeConfigs, resolveMemoryReadConfig, resolveMemoryReadLimitsForConsumer, resolveMemoryReadProfiles, validateConfig } from '../../src/core/config.js';
import { DEFAULT_MEMORY_READ_LIMITS, resolveMemoryReadLimits } from '../../src/core/memory-read-contract.js';
import type { DeckentConfig } from '../../src/core/config-types.js';
import { getMissingFields } from '../../src/core/config-migration.js';

const paths = vi.hoisted(() => ({ global: '' }));
vi.mock('../../src/core/global-scope-resolver.js', async importOriginal => ({
  ...await importOriginal<typeof import('../../src/core/global-scope-resolver.js')>(),
  resolveGlobalConfigReadPath: () => paths.global,
}));

describe('memory_read config authority', () => {
  it('shares a single default contract between config, metadata and the read service', () => {
    const config = createDefaultConfig();
    // Optional authored settings stay absent: automatic config migration must
    // not pin shared defaults as owner-authored caps on a subsequent load.
    expect(config.memory_read).toBeUndefined();
    expect(config.memory_read_profiles).toBeUndefined();
    expect(getConfigHelp('memory_read')?.default).toEqual(DEFAULT_MEMORY_READ_LIMITS);
    expect(resolveMemoryReadLimits()).toEqual(mergeConfigs(null, null).memory_read);
    expect(validateConfig(config)).toEqual([]);
  });

  it('preserves project precedence and custom units through effective resolution', () => {
    const resolved = mergeConfigs(
      { memory_read: { maxEntries: 4, maxBytes: 8192, maxCandidates: 96 } },
      { memory_read: { maxEntries: 6, maxLines: 80 } },
    );
    expect(resolved.memory_read).toEqual({ maxEntries: 6, maxBytes: 8192, maxCandidates: 96, maxLines: 80 });
    expect(resolveMemoryReadLimits(resolved.memory_read)).toEqual(resolved.memory_read);
  });

  it.each([
    null, [], { otherBudget: 1 }, { maxEntries: 0 }, { maxCandidates: -1 },
    { maxLines: 1.5 }, { maxBytes: Infinity }, { maxBytes: '256' },
    { maxBytes: Number.MAX_SAFE_INTEGER + 1 }, { maxEntries: 129, maxCandidates: 128 },
  ])('rejects invalid runtime config %j without silently granting a different budget', memory_read => {
    const config = { ...createDefaultConfig(), memory_read } as unknown as DeckentConfig;
    expect(() => validateConfig(config)).toThrow(ConfigValidationError);
  });

  it('accepts positive one-unit views without turning them into a storage cap', () => {
    const config = createDefaultConfig();
    config.memory_read = { maxEntries: 1, maxCandidates: 1, maxLines: 1, maxBytes: 1 };
    expect(() => validateConfig(config)).not.toThrow();
    expect(config.memory_budget).toBe(5000);
  });

  it('provides complete worker authority capacity without expanding other consumers', () => {
    const config = mergeConfigs(null, null);
    expect(resolveMemoryReadLimitsForConsumer(config, 'worker')).toEqual({
      ...DEFAULT_MEMORY_READ_LIMITS, maxBytes: 131072, maxLines: 512,
    });
    for (const consumer of ['planner', 'cli', 'mcp', 'api', 'bot', 'dashboard', 'desktop'] as const) {
      expect(resolveMemoryReadLimitsForConsumer(config, consumer)).toEqual(DEFAULT_MEMORY_READ_LIMITS);
    }
  });

  it('does not materialize implicit read defaults through automatic config migration', () => {
    const fields = getMissingFields({});
    expect(fields).not.toContain('memory_read');
    expect(fields).not.toContain('memory_read_profiles');
  });

  it('never treats a worker default as a floor over explicit shared caps', () => {
    const config = mergeConfigs({ memory_read: { maxBytes: 1024, maxLines: 12 } }, null);
    expect(resolveMemoryReadLimitsForConsumer(config, 'worker')).toEqual({
      ...DEFAULT_MEMORY_READ_LIMITS, maxBytes: 1024, maxLines: 12,
    });
  });

  it('resolves named overrides after shared settings with project precedence', () => {
    const config = mergeConfigs(
      { memory_read: { maxBytes: 1024 }, memory_read_profiles: { worker: { maxBytes: 65536, maxLines: 300 } } },
      { memory_read: { maxLines: 21 }, memory_read_profiles: { worker: { maxLines: 450 }, bot: { maxEntries: 3 } } },
    );
    expect(resolveMemoryReadLimitsForConsumer(config, 'worker')).toEqual({
      ...DEFAULT_MEMORY_READ_LIMITS, maxBytes: 65536, maxLines: 450,
    });
    expect(resolveMemoryReadLimitsForConsumer(config, 'bot')).toEqual({
      ...DEFAULT_MEMORY_READ_LIMITS, maxBytes: 1024, maxLines: 21, maxEntries: 3,
    });
  });

  it.each([null, [], { unknown: {} }, { worker: null }, { worker: { maxLines: 0 } }, { worker: { maxEntries: 129 } }])(
    'rejects invalid consumer profiles %j', memory_read_profiles => {
      expect(() => validateConfig({ ...createDefaultConfig(), memory_read_profiles } as unknown as DeckentConfig))
        .toThrow(ConfigValidationError);
    },
  );

  it('returns immutable effective limits without mutating authored profiles', () => {
    const input = { memory_read_profiles: { worker: { maxBytes: 65536 } } };
    const before = JSON.stringify(input);
    const profiles = resolveMemoryReadProfiles(input);
    expect(Object.isFrozen(profiles)).toBe(true);
    expect(Object.isFrozen(profiles.worker)).toBe(true);
    expect(JSON.stringify(input)).toBe(before);
  });

  it('validates entry/candidate relationships after merging, not against invented intermediate defaults', () => {
    const config = mergeConfigs(
      { memory_read: { maxEntries: 5 }, memory_read_profiles: { worker: { maxEntries: 3 } } },
      { memory_read: { maxCandidates: 10 }, memory_read_profiles: { worker: { maxCandidates: 4 } } },
    );
    expect(resolveMemoryReadLimitsForConsumer(config, 'planner').maxCandidates).toBe(10);
    expect(resolveMemoryReadLimitsForConsumer(config, 'worker')).toEqual({
      maxEntries: 3, maxCandidates: 4, maxBytes: 131072, maxLines: 512,
    });
    expect(() => resolveMemoryReadProfiles(
      { memory_read: { maxEntries: 8 } }, { memory_read_profiles: { worker: { maxCandidates: 4 } } },
    )).toThrow('MEMORY_READ_LIMITS_INVALID');
  });
});

describe('synchronous read-only memory config projection', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'deckent-memory-read-config-'));
    paths.global = join(root, 'global.json');
    mkdirSync(join(root, '.deckent'));
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('uses the same layer merge as resolved config without creating missing files', () => {
    expect(resolveMemoryReadConfig(root)).toEqual({ memory_read: DEFAULT_MEMORY_READ_LIMITS, language: 'en' });
    expect(readdirSync(root)).toEqual(['.deckent']);
    expect(readdirSync(join(root, '.deckent'))).toEqual([]);
  });

  it('preserves exact authored bytes and global/project overrides', () => {
    const global = { memory_read: { maxLines: 900, maxBytes: 65536 }, language: 'tr' };
    const project = { memory_read: { maxEntries: 7 }, memory_budget: 5000 };
    const projectFile = join(root, '.deckent', 'config.json');
    writeFileSync(paths.global, JSON.stringify(global));
    writeFileSync(projectFile, JSON.stringify(project));
    const before = readFileSync(projectFile);
    const resolved = mergeConfigs(global, project);
    expect(resolveMemoryReadConfig(root)).toEqual({ memory_read: resolved.memory_read, language: resolved.language });
    expect(readFileSync(projectFile).equals(before)).toBe(true);
    expect(readdirSync(join(root, '.deckent'))).toEqual(['config.json']);
  });

  it('does not hide changes behind a cached default or mutate corrupted input', () => {
    const projectFile = join(root, '.deckent', 'config.json');
    writeFileSync(projectFile, '{"memory_read":{"maxLines":999}}');
    expect(resolveMemoryReadConfig(root).memory_read.maxLines).toBe(999);
    writeFileSync(projectFile, '{broken');
    expect(() => resolveMemoryReadConfig(root)).toThrow('MEMORY_READ_CONFIG_UNAVAILABLE');
    expect(readFileSync(projectFile, 'utf8')).toBe('{broken');
    expect(readdirSync(join(root, '.deckent'))).toEqual(['config.json']);
  });

  it('matches effective config consumer profiles without changing either authored file', () => {
    const global = { memory_read: { maxLines: 27 }, memory_read_profiles: { worker: { maxLines: 400 } } };
    const project = { memory_read_profiles: { worker: { maxBytes: 98304 }, bot: { maxLines: 99 } } };
    const projectFile = join(root, '.deckent', 'config.json');
    writeFileSync(paths.global, JSON.stringify(global));
    writeFileSync(projectFile, JSON.stringify(project));
    const before = readFileSync(projectFile);
    const config = mergeConfigs(global, project);
    for (const consumer of ['planner', 'worker', 'bot', 'api'] as const) {
      expect(resolveMemoryReadConfig(root, consumer).memory_read)
        .toEqual(resolveMemoryReadLimitsForConsumer(config, consumer));
    }
    expect(readFileSync(projectFile).equals(before)).toBe(true);
  });

  it.each([null, [], { memory_read: { maxBytes: 0 } }, { language: 'invalid' }])(
    'fails explicitly on invalid view settings %j', value => {
      writeFileSync(join(root, '.deckent', 'config.json'), JSON.stringify(value));
      expect(() => resolveMemoryReadConfig(root)).toThrow();
    },
  );
});
