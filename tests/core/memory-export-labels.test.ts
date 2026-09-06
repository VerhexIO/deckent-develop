import { describe, expect, it, vi } from 'vitest';

import { buildMemoryExportLabels } from '../../src/core/memory-export-labels.js';

describe('buildMemoryExportLabels', () => {
  it('uses English by default and returns only resolved plain strings', () => {
    const getMessage = vi.fn((key: string, language: string) => `${language}:${key}`);

    const labels = buildMemoryExportLabels(getMessage);

    expect(labels.legacyEpochLearnings).toBe('en:memory_export.legacy_epoch_learnings');
    expect(labels.unattributedLearnings).toBe('en:memory_export.unattributed_learnings');
    expect(labels.memoryDetailsTitle).toBe('en:memory_export.memory_details_title');
    expect(labels.fullDetails).toBe('en:memory_export.full_details');
    expect(labels.boundedViewNotice).toBe('en:memory_export.bounded_view_notice');
    expect(labels.memoryIndex).toBe('en:memory_export.memory_index');
    expect(labels.viewBudgetFloorExceeded).toBe('en:memory_export.view_budget_floor_exceeded');
    expect(labels.details).toBe('en:memory_export.details');
    expect(Object.values(labels).every(value => typeof value === 'string')).toBe(true);
    expect(getMessage).toHaveBeenCalledWith('memory_export.summary_title', 'en');
  });

  it('forwards the selected language without importing a catalog into core', () => {
    const calls: Array<readonly [string, string]> = [];
    const labels = buildMemoryExportLabels((key, language) => {
      calls.push([key, language]);
      return `${key}:${language}`;
    }, 'tr');

    expect(labels.sprintLearningHeading).toBe('memory_export.sprint_learning_heading:tr');
    expect(labels.details).toBe('memory_export.details:tr');
    expect(calls.length).toBe(Object.keys(labels).length);
    expect(calls.every(([, language]) => language === 'tr')).toBe(true);
  });
});
