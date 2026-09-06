import { describe, expect, it, vi } from 'vitest';
import { buildMemoryReadLabels } from '../../src/core/memory-read-labels.js';
import { getMessage } from '../../src/cli/helpers/messages.js';

describe('memory read presentation labels', () => {
  it('injects the caller catalog and defaults to English', () => {
    const message = vi.fn((key: string, language: string) => `${language}:${key}`);
    const labels = buildMemoryReadLabels(message);
    expect(labels.source).toBe('en:memory_read.source');
    expect(labels.updatedAt).toBe('en:memory_read.updated_at');
    expect(Object.values(labels)).toHaveLength(10);
    expect(Object.isFrozen(labels)).toBe(true);
  });

  it.each(['en', 'tr'])('resolves every label and state message in %s', language => {
    const labels = buildMemoryReadLabels(getMessage, language);
    for (const value of Object.values(labels)) {
      expect(value).toBeTruthy();
      expect(value).not.toContain('memory_read.');
    }
    const hold = getMessage('memory_read.hold', language, { reason: 'REQUIRED_ENTRY_MISSING' });
    expect(hold).toContain('REQUIRED_ENTRY_MISSING');
    expect(hold).not.toContain('{reason}');
    expect(getMessage('memory_read.invalid_limits', language)).not.toBe('memory_read.invalid_limits');
    for (const key of [
      'memory_read.invalid_profiles', 'memory_read.context_heading', 'memory_read.unavailable',
      'bot.memory.context.heading', 'bot.memory.context.guidance', 'bot.memory.context.absent',
      'bot.memory.tool.invalid_request',
    ]) {
      expect(getMessage(key, language)).not.toBe(key);
    }
    for (const key of ['bot.memory.context.hold', 'bot.memory.tool.unavailable']) {
      expect(getMessage(key, language, { reason: 'QUERY_FAILED' })).toContain('QUERY_FAILED');
    }
  });
});
