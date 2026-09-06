import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeChatResponder } from '../../src/connectors/chat-bridge.js';
import type { ResolvedPrincipal } from '../../src/connectors/identity/provider.js';
import { MemoryStore } from '../../src/core/memory-store.js';
import type {
  ChatMemoryAdapter,
  ChatMessage,
  ChatProviderAdapter,
  McpToolDispatcher,
} from '../../src/cli/commands/chat-native.js';

const PRINCIPAL_A: ResolvedPrincipal = Object.freeze({
  userId: 'user-a', role: 'viewer', permissions: ['*:read'],
  tenantId: 'tenant-a', verified: true, source: 'test-directory',
});
const PRINCIPAL_B: ResolvedPrincipal = Object.freeze({
  userId: 'user-b', role: 'viewer', permissions: ['*:read'],
  tenantId: 'tenant-b', verified: true, source: 'test-directory',
});

let root: string;

function openWriter(): MemoryStore {
  return new MemoryStore(join(root, '.brain', 'memory.db'));
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'bot-memory-read-'));
  mkdirSync(join(root, '.brain', 'exports'), { recursive: true });
  mkdirSync(join(root, '.deckent'), { recursive: true });
  writeFileSync(join(root, '.deckent', 'config.json'), JSON.stringify({
    language: 'en',
    memory_read: { maxEntries: 8, maxCandidates: 16, maxBytes: 16_384, maxLines: 100 },
    memory_read_profiles: { bot: { maxEntries: 1 } },
  }));
  const store = openWriter();
  store.insert({
    id: 'tenant-a-memory', type: 'memory', source: 'worker', title: 'Tenant A',
    content: 'TENANT_A_PRIVATE_MARKER', tenant_id: 'tenant-a', sprint_id: 'sprint-10', sprint_num: 10,
  });
  store.insert({
    id: 'tenant-b-memory', type: 'memory', source: 'worker', title: 'Tenant B',
    content: 'TENANT_B_PRIVATE_MARKER', tenant_id: 'tenant-b', sprint_id: 'sprint-11', sprint_num: 11,
  });
  store.close();
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('bot canonical memory reader wiring', () => {
  it('honors the explicit bot consumer profile instead of the generic read limits', async () => {
    const store = openWriter();
    store.insert({
      id: 'tenant-a-newest', type: 'memory', source: 'worker', title: 'Newest tenant A',
      content: 'TENANT_A_PROFILE_NEWEST', tenant_id: 'tenant-a', sprint_id: 'sprint-12', sprint_num: 12,
    });
    store.close();
    const prompts: string[] = [];
    const respond = makeChatResponder({
      agentic: true,
      root,
      dispatcher: { dispatch: vi.fn(async () => '') },
      persistentProviderFactory: ({ systemPrompt }) => {
        prompts.push(systemPrompt);
        return {
          async send() { return { text: 'ok', stopReason: 'end_turn' as const }; },
          async exit() {},
        };
      },
    });
    await respond('profile-session', 'hello', undefined, undefined, PRINCIPAL_A);
    expect(prompts[0]).toContain('TENANT_A_PROFILE_NEWEST');
    expect(prompts[0]).not.toContain('TENANT_A_PRIVATE_MARKER');
  });

  it('grounds and queries through the per-turn tenant authority without the global summary projection', async () => {
    writeFileSync(join(root, '.brain', 'exports', 'summary.md'), 'POISON_GLOBAL_SUMMARY TENANT_B_PRIVATE_MARKER');
    const prompts: string[] = [];
    const toolResults: string[] = [];
    const delegated: McpToolDispatcher = { dispatch: vi.fn(async () => 'legacy-memory-leak') };
    const respond = makeChatResponder({
      agentic: true,
      root,
      dispatcher: delegated,
      persistentProviderFactory: ({ systemPrompt }) => {
        prompts.push(systemPrompt);
        let sendCount = 0;
        return {
          async send(messages: ChatMessage[]) {
            sendCount += 1;
            if (sendCount === 1) {
              return {
                stopReason: 'tool_use' as const,
                toolCalls: [{ id: 'memory-1', name: 'deckent_memory_query', args: { query: 'PRIVATE_MARKER' } }],
              };
            }
            const tool = [...messages].reverse().find((message) => message.role === 'tool');
            if (tool) toolResults.push(tool.content);
            return { text: 'grounded', stopReason: 'end_turn' as const };
          },
          async exit() {},
        };
      },
    });

    await expect(respond('telegram:channel-1', 'Use the memory tool', undefined, undefined, PRINCIPAL_A))
      .resolves.toBe('grounded');
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain('TENANT_A_PRIVATE_MARKER');
    expect(prompts[0]).not.toContain('TENANT_B_PRIVATE_MARKER');
    expect(prompts[0]).not.toContain('POISON_GLOBAL_SUMMARY');
    expect(toolResults[0]).toContain('TENANT_A_PRIVATE_MARKER');
    expect(toolResults[0]).not.toContain('TENANT_B_PRIVATE_MARKER');
    expect(delegated.dispatch).not.toHaveBeenCalled();
  });

  it('rejects model-supplied tenant or limit authority instead of delegating to the CLI bridge', async () => {
    const toolResults: string[] = [];
    const delegated: McpToolDispatcher = { dispatch: vi.fn(async () => 'SHOULD_NOT_RUN') };
    const respond = makeChatResponder({
      agentic: true,
      root,
      dispatcher: delegated,
      persistentProviderFactory: () => {
        let sendCount = 0;
        return {
          async send(messages) {
            sendCount += 1;
            if (sendCount === 1) {
              return {
                stopReason: 'tool_use' as const,
                toolCalls: [{
                  id: 'memory-injection', name: 'deckent_memory_query',
                  args: { query: 'PRIVATE_MARKER', tenantId: 'tenant-b', maxEntries: 999 },
                }],
              };
            }
            const tool = [...messages].reverse().find((message) => message.role === 'tool');
            if (tool) toolResults.push(tool.content);
            return { text: 'held', stopReason: 'end_turn' as const };
          },
          async exit() {},
        };
      },
    });

    await respond('telegram:channel-1', 'query memory', undefined, undefined, PRINCIPAL_A);
    expect(toolResults).toEqual(['Invalid memory query or continuation reference.']);
    expect(delegated.dispatch).not.toHaveBeenCalled();
  });

  it('reuses one child only for the same scope/session/context revision and rotates after a source revision', async () => {
    const prompts: string[] = [];
    let exits = 0;
    const respond = makeChatResponder({
      agentic: true,
      root,
      dispatcher: { dispatch: vi.fn(async () => '') },
      persistentProviderFactory: ({ systemPrompt }) => {
        prompts.push(systemPrompt);
        return {
          async send() { return { text: 'ok', stopReason: 'end_turn' as const }; },
          async exit() { exits += 1; },
        };
      },
    });

    await respond('session-1', 'hello', undefined, undefined, PRINCIPAL_A);
    await respond('session-1', 'hello again', undefined, undefined, PRINCIPAL_A);
    expect(prompts).toHaveLength(1);
    expect(exits).toBe(0);

    const store = openWriter();
    store.update('tenant-a-memory', { content: 'TENANT_A_PRIVATE_CHANGED' });
    store.close();
    await respond('session-1', 'after revision', undefined, undefined, PRINCIPAL_A);
    expect(prompts).toHaveLength(2);
    expect(exits).toBe(1);

    await respond('session-2', 'other session', undefined, undefined, PRINCIPAL_A);
    expect(prompts).toHaveLength(3);
    expect(exits).toBe(2);
    await respond('session-2', 'other principal', undefined, undefined, PRINCIPAL_B);
    expect(prompts).toHaveLength(4);
    expect(exits).toBe(3);
    await respond.dispose?.();
    expect(exits).toBe(4);
  });

  it('serializes different agentic sessions because they share exactly one child slot', async () => {
    let active = 0;
    let maxActive = 0;
    const releases: Array<() => void> = [];
    const respond = makeChatResponder({
      agentic: true,
      root,
      dispatcher: { dispatch: vi.fn(async () => '') },
      persistentProviderFactory: () => ({
        async send() {
          active += 1;
          maxActive = Math.max(maxActive, active);
          await new Promise<void>((resolve) => releases.push(resolve));
          active -= 1;
          return { text: 'ok', stopReason: 'end_turn' as const };
        },
        async exit() {},
      }),
    });
    const first = respond('session-a', 'first', undefined, undefined, PRINCIPAL_A);
    const second = respond('session-b', 'second', undefined, undefined, PRINCIPAL_A);
    await vi.waitFor(() => expect(releases).toHaveLength(1));
    releases[0]!();
    await vi.waitFor(() => expect(releases).toHaveLength(2));
    releases[1]!();
    await Promise.all([first, second]);
    expect(maxActive).toBe(1);
  });

  it('binds durable chat history to scope, session and principal without changing the external channel id', async () => {
    const readKeys: string[] = [];
    const writeKeys: string[] = [];
    const memory: ChatMemoryAdapter = {
      getChatHistory(sessionId) { readKeys.push(sessionId); return []; },
      appendChatTurn(sessionId) { writeKeys.push(sessionId); return writeKeys.length; },
    };
    const respond = makeChatResponder({
      agentic: true,
      root,
      memory,
      dispatcher: { dispatch: vi.fn(async () => '') },
      persistentProviderFactory: () => ({
        async send() { return { text: 'ok', stopReason: 'end_turn' as const }; },
        async exit() {},
      }),
    });
    await respond('external-channel', 'first', undefined, undefined, PRINCIPAL_A);
    await respond('external-channel', 'second', undefined, undefined, PRINCIPAL_B);
    expect(readKeys).toHaveLength(2);
    expect(new Set(readKeys).size).toBe(2);
    expect(readKeys.every((key) => key.startsWith('bot-memory-v1:'))).toBe(true);
    expect(new Set(writeKeys)).toEqual(new Set(readKeys));
  });

  it('surfaces unavailable memory as a typed HOLD in both grounding and the tool result', async () => {
    rmSync(join(root, '.brain', 'memory.db'), { force: true });
    const prompts: string[] = [];
    const toolResults: string[] = [];
    const respond = makeChatResponder({
      agentic: true,
      root,
      dispatcher: { dispatch: vi.fn(async () => 'SHOULD_NOT_RUN') },
      persistentProviderFactory: ({ systemPrompt }) => {
        prompts.push(systemPrompt);
        let sendCount = 0;
        return {
          async send(messages) {
            sendCount += 1;
            if (sendCount === 1) {
              return {
                stopReason: 'tool_use' as const,
                toolCalls: [{ id: 'memory-missing', name: 'deckent_memory_query', args: { query: 'anything' } }],
              };
            }
            const tool = [...messages].reverse().find((message) => message.role === 'tool');
            if (tool) toolResults.push(tool.content);
            return { text: 'held', stopReason: 'end_turn' as const };
          },
          async exit() {},
        };
      },
    });

    await respond('missing-memory', 'hello', undefined, undefined, PRINCIPAL_A);
    expect(prompts[0]).toContain('MEMORY_SOURCE_UNAVAILABLE');
    expect(toolResults[0]).toContain('MEMORY_SOURCE_UNAVAILABLE');
    expect(toolResults[0]).not.toBe('');
  });
});
