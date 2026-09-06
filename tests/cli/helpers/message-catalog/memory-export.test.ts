import { describe, expect, it } from 'vitest';

import { MEMORY_EXPORT_MESSAGES } from '../../../../src/cli/helpers/message-catalog/memory-export.js';
import { getMessage, getMessageLanguages } from '../../../../src/cli/helpers/messages.js';
import { buildMemoryExportLabels } from '../../../../src/core/memory-export-labels.js';

describe('memory export message catalog', () => {
  it('registers every family key with explicit English and Turkish text', () => {
    for (const key of Object.keys(MEMORY_EXPORT_MESSAGES)) {
      expect(getMessageLanguages(key)).toEqual(expect.arrayContaining(['en', 'tr']));
      expect(getMessage(key, 'en')).not.toBe(key);
      expect(getMessage(key, 'tr')).not.toBe(key);
    }
  });

  it('builds distinct canonical English and Turkish compact label bundles', () => {
    const english = buildMemoryExportLabels(getMessage);
    const turkish = buildMemoryExportLabels(getMessage, 'tr');

    expect(english.legacyEpochLearnings).toBe('Legacy Epoch Learnings');
    expect(turkish.legacyEpochLearnings).toBe('Eski Epoch Öğrenimleri');
    expect(english.unattributedLearnings).toBe('Learnings Without Sprint Attribution');
    expect(turkish.unattributedLearnings).toBe('Sprint Atfı Olmayan Öğrenimler');
    expect(english.details).not.toBe(turkish.details);
  });
});
