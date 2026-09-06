import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { MemoryStore } from '../../src/core/memory-store.js';
import { registerMemoryQueryTool } from '../../src/mcp/tools/memory-query.js';
import { registerMemoryResource } from '../../src/mcp/resources/memory.js';

interface RegisteredTool {
  readonly handler: (input: Record<string, unknown>) => Promise<{ content: Array<{ type: 'text'; text: string }> }>;
}

interface RegisteredResource {
  readonly handler: (uri: URL) => Promise<{ contents: Array<{ uri: string; text: string; mimeType: string }> }>;
}

function createServer(): {
  readonly tools: Map<string, RegisteredTool>;
  readonly resources: Map<string, RegisteredResource>;
  readonly server: unknown;
} {
  const tools = new Map<string, RegisteredTool>();
  const resources = new Map<string, RegisteredResource>();
  return {
    tools,
    resources,
    server: {
      registerTool: (name: string, _config: unknown, handler: RegisteredTool['handler']) => tools.set(name, { handler }),
      registerResource: (name: string, _uri: string, _config: unknown, handler: RegisteredResource['handler']) => resources.set(name, { handler }),
    },
  };
}

function seed(root: string, id: string, content: string): void {
  const brain = join(root, '.brain');
  mkdirSync(brain, { recursive: true });
  const store = new MemoryStore(join(brain, 'memory.db'));
  try {
    store.insert({ id, type: 'memory', source: 'brain', title: id, content, status: 'active' });
  } finally {
    store.close();
  }
}

describe('MCP memory read consumers', () => {
  const roots: string[] = [];

  afterEach(() => {
    vi.restoreAllMocks();
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  it('runs the registered memory query tool against a readonly bounded view without the legacy 200-character content slice', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mcp-memory-read-tool-'));
    roots.push(root);
    const content = `needle ${'x'.repeat(240)} complete-tail`;
    seed(root, 'memory-read-tool-001', content);
    const { server, tools } = createServer();
    registerMemoryQueryTool(server as never);

    const result = await tools.get('deckent_memory_query')!.handler({ query: 'needle', root });
    expect(result.content[0]!.text).toContain('complete-tail');
    expect(result.content[0]!.text).toContain(content);
    expect((result as unknown as { structuredContent?: { schemaVersion: number; view: { state: string } } }).structuredContent)
      .toMatchObject({ schemaVersion: 1, view: { state: 'AVAILABLE' } });
  });

  it('runs the registered memory resource through the same bounded readonly view instead of returning an unbounded getByType corpus', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mcp-memory-read-resource-'));
    roots.push(root);
    seed(root, 'memory-read-resource-001', 'resource complete unit');
    vi.spyOn(process, 'cwd').mockReturnValue(root);
    const { server, resources } = createServer();
    registerMemoryResource(server as never);

    const result = await resources.get('memory')!.handler(new URL('deckent://memory'));
    const envelope = JSON.parse(result.contents[0]!.text) as { metadata: { schemaVersion: number; state: string; selectedIds: Array<{ id: string }> }; rendered: string };
    expect(envelope.metadata.schemaVersion).toBe(1);
    expect(envelope.metadata.state).toBe('AVAILABLE');
    expect(envelope.metadata.selectedIds).toHaveLength(1);
    expect(envelope.rendered).toContain('resource complete unit');
  });
});
