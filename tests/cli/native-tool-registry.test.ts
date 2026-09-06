// tests/cli/native-tool-registry.test.ts
import { describe, it, expect } from 'vitest';
import { tmpdir } from 'node:os';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { buildNativeToolRegistry } from '../../src/cli/repl/native-tool-registry.js';
import { mergeConfigs } from '../../src/core/config.js';

describe('buildNativeToolRegistry', () => {
  it('registers the exec tools with native tiers (read→silent, write→confirm, bash floor stays confirm)', () => {
    const reg = buildNativeToolRegistry({ cwd: () => tmpdir() });
    const names = reg.list().map((t) => t.name).sort();
    expect(names).toContain('deckent_read_file');
    expect(names).toContain('deckent_write_file');
    expect(names).toContain('deckent_bash');
    expect(reg.get('deckent_read_file')!.tier).toBe('silent');   // classifyTool 'read' → 'silent'
    expect(reg.get('deckent_write_file')!.tier).toBe('confirm');  // side-effecting
    expect(reg.get('deckent_bash')!.tier).toBe('confirm');
  });

  it('exec handler runs the real dispatcher with NO internal confirm (single gate), mapping string→ToolResult', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ntr-'));
    try {
      writeFileSync(join(dir, 'f.txt'), 'HELLO');
      const reg = buildNativeToolRegistry({ cwd: () => dir });
      const read = await reg.get('deckent_read_file')!.handler({ path: 'f.txt' });
      expect(read).toEqual({ ok: true, output: 'HELLO' });
      // a side-effecting write executes WITHOUT prompting (no confirm injected) — the
      // AgentSession permission engine is the gate, not the dispatcher.
      const write = await reg.get('deckent_write_file')!.handler({ path: 'g.txt', content: 'X' });
      expect(write.ok).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('threads opts.contentStore into the SHARED exec dispatcher — an over-cap read spills its full bytes there (564-002 hand-completion)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ntr-spill-'));
    try {
      // 20_000 bytes > DEFAULT_MAX_PREVIEW_BYTES (16_384) → the broker MUST hand
      // the full bytes to the session store while rendering a bounded preview.
      const big = 'A'.repeat(20_000);
      writeFileSync(join(dir, 'big.txt'), big);
      const spilled: Buffer[] = [];
      const reg = buildNativeToolRegistry({
        cwd: () => dir,
        contentStore: {
          write(bytes) { spilled.push(bytes); return { path: '(stub)', sha256: 'x' }; },
        },
      });
      await reg.get('deckent_read_file')!.handler({ path: 'big.txt' });
      expect(spilled.length).toBeGreaterThan(0);
      expect(spilled.some((b) => b.toString('utf8') === big)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('marks a dispatcher error string as ok:false', async () => {
    const reg = buildNativeToolRegistry({ cwd: () => tmpdir() });
    const r = await reg.get('deckent_read_file')!.handler({ path: '../escape.txt' });
    expect(r.ok).toBe(false);
    expect(r.output).toMatch(/mcp-error|scope/);
  });

  it('registers the CLI-bridge tools too (deckent_status is silent/read)', () => {
    const reg = buildNativeToolRegistry({ cwd: () => tmpdir() });
    expect(reg.get('deckent_status')).toBeDefined();
    expect(reg.get('deckent_status')!.tier).toBe('silent');
  });

  it('exposes the memory query continuation and detail-reference schema to the actual native registry', () => {
    const reg = buildNativeToolRegistry({ cwd: () => tmpdir() });
    const schema = reg.get('deckent_memory_query')!.inputSchema as {
      properties?: Record<string, unknown>;
      anyOf?: unknown[];
    };
    expect(schema.properties).toEqual(expect.objectContaining({
      query: expect.anything(),
      cursor: expect.anything(),
      detail_ref: expect.anything(),
    }));
    expect(schema.anyOf).toEqual([{ required: ['query'] }, { required: ['detail_ref'] }]);
  });

  it('registers MCP bridge tools as confirm-tier ToolDefinitions (single-gate dispatch)', async () => {
    const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
    const mcpBridge = {
      listTools: () => [
        { namespacedName: 'srv__echo', descriptor: { name: 'echo', description: 'echo it', inputSchema: { type: 'object', properties: { v: { type: 'string' } } } }, server: 'srv', tool: 'echo' },
      ],
      dispatch: async (name: string, args: Record<string, unknown>) => { calls.push({ name, args }); return { ok: true, output: `mcp:${args['v']}` }; },
    };
    const reg = buildNativeToolRegistry({ cwd: () => tmpdir(), mcpBridge });
    const def = reg.get('srv__echo');
    expect(def).toBeDefined();
    expect(def!.tier).toBe('confirm');       // external MCP is never silent
    expect(def!.source).toBe('mcp');
    const r = await def!.handler({ v: 'hi' });
    expect(r).toEqual({ ok: true, output: 'mcp:hi' });
    expect(calls).toHaveLength(1);           // dispatched through the bridge (no-op confirm)
  });

  // TOOL-QB-FLIP (376-001): config.ts now resolves `tool_surface` to
  // `{ enabled: true }` by default (opt-out, not opt-in — see config.ts loadConfig/
  // mergeConfigs). This registry itself keeps its own local default OFF
  // (`opts.toolSurface?.enabled`, byte-identical when the caller omits the option) —
  // these tests prove that threading the new resolved config default through into
  // `buildNativeToolRegistry` registers the 3 progressive-disclosure meta-tools,
  // and that an absent `toolSurface` option still yields the pre-existing opt-out shape.
  it('registers the 3 progressive-disclosure meta-tools when fed the config-resolved default (tool_surface default-ON)', () => {
    const resolved = mergeConfigs(null, null);
    expect(resolved.tool_surface).toEqual({ enabled: true });
    const reg = buildNativeToolRegistry({
      cwd: () => tmpdir(),
      toolSurface: { enabled: resolved.tool_surface!.enabled! },
    });
    const names = reg.list().map((t) => t.name);
    expect(names).toContain('deckent_search_tools');
    expect(names).toContain('deckent_describe_tool');
    expect(names).toContain('deckent_call_tool');
  });

  it('omitting toolSurface entirely still registers none of the meta-tools (local opt-out default unchanged)', () => {
    const reg = buildNativeToolRegistry({ cwd: () => tmpdir() });
    const names = reg.list().map((t) => t.name);
    expect(names).not.toContain('deckent_search_tools');
    expect(names).not.toContain('deckent_describe_tool');
    expect(names).not.toContain('deckent_call_tool');
  });

  it('an explicit config-resolved tool_surface { enabled: false } (opt-out) registers none of the meta-tools', () => {
    const resolved = mergeConfigs(null, { tool_surface: { enabled: false } });
    expect(resolved.tool_surface).toEqual({ enabled: false });
    const reg = buildNativeToolRegistry({
      cwd: () => tmpdir(),
      toolSurface: { enabled: resolved.tool_surface!.enabled! },
    });
    const names = reg.list().map((t) => t.name);
    expect(names).not.toContain('deckent_search_tools');
  });
});
