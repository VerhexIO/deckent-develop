import { describe, it, expect } from 'vitest';
import { z } from 'zod/v4';

/**
 * Unit tests for the MCP memory_query tool schema.
 * We verify the Zod schema accepts the `mode` parameter correctly.
 * Integration with actual MCP server is tested elsewhere.
 */

const inputSchema = z.object({
  query: z.string().optional(),
  type: z.array(z.string()).optional(),
  status: z.array(z.string()).optional(),
  limit: z.number().optional().default(5),
  sprint_min: z.number().optional(),
  mode: z.enum(['and', 'or']).optional().default('or'),
  cursor: z.string().optional(),
  detail_ref: z.string().optional(),
  root: z.string().optional(),
});

describe('MCP memory_query tool schema', () => {
  it('accepts mode=or', () => {
    const result = inputSchema.parse({ query: 'docker', mode: 'or' });
    expect(result.mode).toBe('or');
  });

  it('accepts mode=and', () => {
    const result = inputSchema.parse({ query: 'docker', mode: 'and' });
    expect(result.mode).toBe('and');
  });

  it('defaults mode to or when omitted', () => {
    const result = inputSchema.parse({ query: 'docker' });
    expect(result.mode).toBe('or');
  });

  it('rejects invalid mode', () => {
    expect(() => inputSchema.parse({ query: 'docker', mode: 'xor' })).toThrow();
  });

  it('accepts an opaque continuation or detail reference without accepting a tenant selector', () => {
    expect(inputSchema.parse({ query: 'docker', cursor: 'memory-read-cursor-v1.opaque' }).cursor)
      .toBe('memory-read-cursor-v1.opaque');
    expect(inputSchema.parse({ detail_ref: 'memory-read-detail-v1.opaque' }).detail_ref)
      .toBe('memory-read-detail-v1.opaque');
    expect(inputSchema.parse({ query: 'docker', tenantId: 'untrusted' })).not.toHaveProperty('tenantId');
  });
});
