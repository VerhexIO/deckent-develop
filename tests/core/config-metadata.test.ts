import { describe, it, expect } from 'vitest';
import {
  CONFIG_METADATA,
  getConfigHelp,
  listConfigByCategory,
  generateConfigReference,
} from '../../src/core/config.js';

describe('getConfigHelp', () => {
  it('returns metadata for a known key', () => {
    const meta = getConfigHelp('mode');
    expect(meta).toBeDefined();
    expect(meta?.description).toBeTruthy();
    expect(meta?.category).toBe('Sprint');
  });

  it('returns undefined for an unknown key', () => {
    expect(getConfigHelp('nonexistent_key_xyz')).toBeUndefined();
  });

  it('returns metadata with correct fields for brain_provider', () => {
    const meta = getConfigHelp('brain_provider');
    expect(meta).toBeDefined();
    expect(meta?.type).toContain('claude');
    expect(meta?.default).toBe('claude');
    expect(meta?.options).toContain('claude');
    expect(meta?.category).toBe('Provider');
  });

  it('returns metadata for memory_budget with Memory category', () => {
    const meta = getConfigHelp('memory_budget');
    expect(meta).toBeDefined();
    expect(meta?.category).toBe('Memory');
    expect(meta?.default).toBe(5000);
    expect(meta?.descriptionTr).toContain('Brain');
  });

  it('describes bounded memory_export without treating it as durable retention', () => {
    const meta = getConfigHelp('memory_export');
    expect(meta).toMatchObject({ category: 'Memory', type: 'object | undefined' });
    expect(meta?.description).toContain('human-view');
    expect(meta?.descriptionTr).toContain('insan görünümü');
  });

  it('returns metadata for scan_interval with Auditor category', () => {
    const meta = getConfigHelp('scan_interval');
    expect(meta).toBeDefined();
    expect(meta?.category).toBe('Auditor');
    expect(meta?.default).toBe(30);
  });

  it('returns metadata for output_mode with options', () => {
    const meta = getConfigHelp('output_mode');
    expect(meta).toBeDefined();
    expect(meta?.options).toContain('quiet');
    expect(meta?.options).toContain('normal');
    expect(meta?.options).toContain('verbose');
  });

  it('returns metadata for rollback_policy', () => {
    const meta = getConfigHelp('rollback_policy');
    expect(meta).toBeDefined();
    expect(meta?.default).toBe('never');
  });
});

describe('listConfigByCategory', () => {
  it('returns an object with expected categories', () => {
    const grouped = listConfigByCategory();
    expect(grouped['Provider']).toBeDefined();
    expect(grouped['Sprint']).toBeDefined();
    expect(grouped['Memory']).toBeDefined();
    expect(grouped['Auditor']).toBeDefined();
    expect(grouped['Output']).toBeDefined();
    expect(grouped['Search']).toBeDefined();
    expect(grouped['Notifications']).toBeDefined();
    expect(grouped['Telemetry']).toBeDefined();
  });

  it('keys within each category are sorted alphabetically', () => {
    const grouped = listConfigByCategory();
    for (const [cat, keys] of Object.entries(grouped)) {
      const sorted = [...keys].sort();
      expect(keys, `${cat} keys should be sorted`).toEqual(sorted);
    }
  });

  it('Memory category contains all memory fields', () => {
    const { Memory } = listConfigByCategory();
    expect(Memory).toContain('memory_budget');
    expect(Memory).toContain('decay_after_sprints');
    expect(Memory).toContain('patterns_enabled');
    expect(Memory).toContain('project_identity_enabled');
    expect(Memory).toContain('memory_export');
  });

  it('Auditor category contains all auditor fields', () => {
    const { Auditor } = listConfigByCategory();
    expect(Auditor).toContain('scan_interval');
    expect(Auditor).toContain('heartbeat_timeout');
    expect(Auditor).toContain('boundary_enforcement');
  });

  it('every CONFIG_METADATA key appears in some category', () => {
    const grouped = listConfigByCategory();
    const allGroupedKeys = Object.values(grouped).flat();
    for (const key of Object.keys(CONFIG_METADATA)) {
      expect(allGroupedKeys, `${key} should be in a category`).toContain(key);
    }
  });
});

describe('generateConfigReference', () => {
  it('returns a non-empty string', () => {
    const md = generateConfigReference();
    expect(typeof md).toBe('string');
    expect(md.length).toBeGreaterThan(100);
  });

  it('contains a top-level heading', () => {
    const md = generateConfigReference();
    expect(md).toContain('# Deckent Config Reference');
  });

  it('contains a Table of Contents section', () => {
    const md = generateConfigReference();
    expect(md).toContain('## Table of Contents');
  });

  it('contains category headings for Provider and Memory', () => {
    const md = generateConfigReference();
    expect(md).toContain('## Provider');
    expect(md).toContain('## Memory');
    expect(md).toContain('## Auditor');
    expect(md).toContain('## Sprint');
  });

  it('contains key headings for known config fields', () => {
    const md = generateConfigReference();
    expect(md).toContain('### `brain_provider`');
    expect(md).toContain('### `memory_budget`');
    expect(md).toContain('### `scan_interval`');
    expect(md).toContain('### `output_mode`');
  });

  it('contains Description, Type, and Default fields for entries', () => {
    const md = generateConfigReference();
    expect(md).toContain('**Description:**');
    expect(md).toContain('**Type:**');
    expect(md).toContain('**Default:**');
  });

  it('contains Options field for entries with options', () => {
    const md = generateConfigReference();
    expect(md).toContain('**Options:**');
  });

  it('null defaults are shown as `null`', () => {
    // notify_channel and notify_url have null defaults
    const md = generateConfigReference();
    expect(md).toContain('`null`');
  });

  it('undefined defaults are shown as (not set)', () => {
    // language, projectName, version have undefined defaults
    const md = generateConfigReference();
    expect(md).toContain('*(not set)*');
  });
});
