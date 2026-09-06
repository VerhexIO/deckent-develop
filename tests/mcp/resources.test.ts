import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';

// ─── Mocks ──────────────────────────────────────────────────────────

vi.mock('node:fs', () => ({
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
  readdirSync: vi.fn(),
  unlinkSync: vi.fn(),
}));

const mockMcpMemStore = {
  getByType: vi.fn().mockReturnValue([]),
  getById: vi.fn().mockReturnValue(null),
  insert: vi.fn(),
  upsert: vi.fn(),
  softDelete: vi.fn(),
  close: vi.fn(),
  totalCount: vi.fn().mockReturnValue(0),
  countByType: vi.fn(),
  decay: vi.fn(),
  getRawDb: vi.fn(),
  getRelationsFrom: vi.fn().mockReturnValue([]),
  getHistory: vi.fn().mockReturnValue([]),
  restore: vi.fn(),
  getSchemaVersion: vi.fn().mockReturnValue(1),
};
const memoryReadMocks = vi.hoisted(() => ({
  readMemoryView: vi.fn(),
  renderMemoryReadView: vi.fn(),
}));
vi.mock('../../src/core/memory-store.js', () => ({
  MemoryStore: vi.fn().mockImplementation(() => mockMcpMemStore),
}));

vi.mock('../../src/core/memory-read-service.js', () => ({
  readMemoryView: memoryReadMocks.readMemoryView,
  renderMemoryReadView: memoryReadMocks.renderMemoryReadView,
}));

vi.mock('node:child_process', () => ({
  spawnSync: vi.fn(),
}));

vi.mock('../../src/core/config.js', () => ({
  resolveBrainModel: () => 'sonnet',  // sprint-431 (431-003) compiler-cagri-zinciri okur
  resolveBrainPlanningMode: (c: any) => c?.brain_planning ?? c?.activeModeConfig?.brain_planning ?? 'auto',  // sprint-429 (429-006)
  loadConfig: vi.fn().mockResolvedValue({ language: 'en' }),
  resolveMemoryReadConfig: vi.fn().mockReturnValue({ language: 'en', memory_read: { maxEntries: 20, maxCandidates: 128, maxBytes: 32768, maxLines: 200 } }),
}));

vi.mock('../../src/core/utils.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/core/utils.js')>();
  return {
    ...actual,
    countBrainLines: vi.fn().mockReturnValue(100),
    ensureDeckentImport: vi.fn(),
  };
});

vi.mock('../../src/orchestra/brain.js', () => ({
  runSprint: vi.fn(),
  readContext: vi.fn(),
  planSprint: vi.fn(),
  BrainError: class BrainError extends Error {},
}));

vi.mock('../../src/orchestra/tmux.js', () => ({
  isSessionActive: vi.fn(),
  ensureSession: vi.fn(),
  spawnWorker: vi.fn(),
  killWorker: vi.fn(),
  listWorkers: vi.fn(),
  startAuditor: vi.fn(),
  attach: vi.fn(),
  destroy: vi.fn(),
  sendKeys: vi.fn(),
}));

vi.mock('../../src/monitor/auditor.js', () => ({
  updateDashboard: vi.fn(),
  detectDeadlocks: vi.fn(),
}));

vi.mock('../../src/agents/worker.js', () => ({
  updateTaskStatus: vi.fn(),
  releaseAllLocks: vi.fn(),
}));

// ─── Mock Server Pattern ────────────────────────────────────────────

type ResourceHandler = (uri: URL, vars?: unknown) => Promise<{ contents: Array<{ uri: string; text: string; mimeType?: string }> }>;

interface MockServer {
  resources: Map<string, { config: unknown; handler: ResourceHandler }>;
  registerTool: (name: string, config: unknown, handler: unknown) => void;
  registerResource: (name: string, uri: string, config: unknown, handler: ResourceHandler) => void;
}

function createMockServer(): MockServer {
  const resources = new Map<string, { config: unknown; handler: ResourceHandler }>();

  return {
    resources,
    registerTool() { /* no-op for resource tests */ },
    registerResource(name: string, _uri: string, config: unknown, handler: ResourceHandler) {
      resources.set(name, { config, handler });
    },
  };
}

// ─── Resource Tests ──────────────────────────────────────────────────

describe('MCP Resources', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    memoryReadMocks.readMemoryView.mockReturnValue({ state: 'ABSENT' });
    memoryReadMocks.renderMemoryReadView.mockReturnValue('');
  });

  describe('deckent://dashboard', () => {
    it('returns dashboard state', async () => {
      const { registerDashboardResource } = await import('../../src/mcp/resources/dashboard.js');
      const mock = createMockServer();
      registerDashboardResource(mock as unknown as import('@modelcontextprotocol/sdk/server/mcp.js').McpServer);

      const dashState = { sprint: { id: 'sprint-007' }, progress: { done: 2, total: 4 } };
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify(dashState));

      const handler = mock.resources.get('dashboard')!.handler;
      const result = await handler(new URL('deckent://dashboard'));

      expect(result.contents).toHaveLength(1);
      const parsed = JSON.parse(result.contents[0]!.text);
      expect(parsed.sprint.id).toBe('sprint-007');
    });

    it('returns inactive when no dashboard file', async () => {
      const { registerDashboardResource } = await import('../../src/mcp/resources/dashboard.js');
      const mock = createMockServer();
      registerDashboardResource(mock as unknown as import('@modelcontextprotocol/sdk/server/mcp.js').McpServer);

      vi.mocked(existsSync).mockReturnValue(false);

      const handler = mock.resources.get('dashboard')!.handler;
      const result = await handler(new URL('deckent://dashboard'));

      const parsed = JSON.parse(result.contents[0]!.text);
      expect(parsed.active).toBe(false);
    });
  });

  describe('deckent://directives', () => {
    it('returns directives content', async () => {
      const { registerDirectivesResource } = await import('../../src/mcp/resources/directives.js');
      const mock = createMockServer();
      registerDirectivesResource(mock as unknown as import('@modelcontextprotocol/sdk/server/mcp.js').McpServer);

      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue('## Task 1: Auth\nDetails here');

      const handler = mock.resources.get('directives')!.handler;
      const result = await handler(new URL('deckent://directives'));

      expect(result.contents[0]!.text).toContain('Task 1: Auth');
      expect(result.contents[0]!.mimeType).toBe('text/markdown');
    });

    it('returns empty string when no DIRECTIVES.md', async () => {
      const { registerDirectivesResource } = await import('../../src/mcp/resources/directives.js');
      const mock = createMockServer();
      registerDirectivesResource(mock as unknown as import('@modelcontextprotocol/sdk/server/mcp.js').McpServer);

      vi.mocked(existsSync).mockReturnValue(false);

      const handler = mock.resources.get('directives')!.handler;
      const result = await handler(new URL('deckent://directives'));

      expect(result.contents[0]!.text).toBe('');
    });
  });

  describe('deckent://memory', () => {
    it('returns memory content', async () => {
      const { registerMemoryResource } = await import('../../src/mcp/resources/memory.js');
      const mock = createMockServer();
      registerMemoryResource(mock as unknown as import('@modelcontextprotocol/sdk/server/mcp.js').McpServer);

      vi.mocked(existsSync).mockReturnValue(true);
      memoryReadMocks.readMemoryView.mockReturnValue({
        state: 'AVAILABLE',
        scope: { kind: 'local-project', projectId: 'project-test' },
        selectionRevisionDigest: 'sha256:selection',
        queryDigest: 'sha256:query',
        entries: [], deferred: [], nextCursor: null,
      });
      memoryReadMocks.renderMemoryReadView.mockReturnValue('- Pattern A');

      const handler = mock.resources.get('memory')!.handler;
      const result = await handler(new URL('deckent://memory'));

      expect(JSON.parse(result.contents[0]!.text).rendered).toContain('Pattern A');
    });

    it('returns a typed unavailable hold when memory.db is absent', async () => {
      const { registerMemoryResource } = await import('../../src/mcp/resources/memory.js');
      const mock = createMockServer();
      registerMemoryResource(mock as unknown as import('@modelcontextprotocol/sdk/server/mcp.js').McpServer);

      vi.mocked(existsSync).mockReturnValue(false);

      const handler = mock.resources.get('memory')!.handler;
      const result = await handler(new URL('deckent://memory'));

      expect(JSON.parse(result.contents[0]!.text).metadata.reasonCode).toBe('QUERY_FAILED');
    });
  });

  describe('deckent://debt', () => {
    it('parses debt from MemoryStore', async () => {
      const { registerDebtResource } = await import('../../src/mcp/resources/debt.js');
      const mock = createMockServer();
      registerDebtResource(mock as unknown as import('@modelcontextprotocol/sdk/server/mcp.js').McpServer);

      vi.mocked(existsSync).mockReturnValue(true);
      mockMcpMemStore.getByType.mockImplementation((type: string) => {
        if (type === 'debt') return [
          { id: 'debt-001', type: 'debt', title: 'Missing tests', content: 'x', source: 'brain', status: 'active', priority: 'high', sprint_id: 'sprint-006', sprint_num: 6, metadata: JSON.stringify({ originTaskId: '6-001', originSprintId: 'sprint-006', sprintsOpen: 1 }), tag_text: 'debt', created_at: '2026-03-17', updated_at: '2026-03-17', deleted_at: null },
          { id: 'debt-002', type: 'debt', title: 'Unused import', content: 'x', source: 'brain', status: 'resolved', priority: 'normal', sprint_id: 'sprint-006', sprint_num: 6, metadata: JSON.stringify({ originTaskId: '6-002', originSprintId: 'sprint-006', sprintsOpen: 2, resolvedInSprintId: 'sprint-007' }), tag_text: 'debt', created_at: '2026-03-16', updated_at: '2026-03-16', deleted_at: null },
        ];
        return [];
      });

      const handler = mock.resources.get('debt')!.handler;
      const result = await handler(new URL('deckent://debt'));

      const items = JSON.parse(result.contents[0]!.text);
      expect(items).toHaveLength(2);
      expect(items[0].id).toBe('debt-001');
      expect(items[0].priority).toBe('HIGH');
      expect(items[1].resolved).toBe(true);
    });

    it('returns empty array when no DEBT.md', async () => {
      const { registerDebtResource } = await import('../../src/mcp/resources/debt.js');
      const mock = createMockServer();
      registerDebtResource(mock as unknown as import('@modelcontextprotocol/sdk/server/mcp.js').McpServer);

      vi.mocked(existsSync).mockReturnValue(false);

      const handler = mock.resources.get('debt')!.handler;
      const result = await handler(new URL('deckent://debt'));

      const items = JSON.parse(result.contents[0]!.text);
      expect(items).toHaveLength(0);
    });
  });

  describe('deckent://config', () => {
    it('returns config JSON when file exists', async () => {
      const { registerConfigResource } = await import('../../src/mcp/resources/config.js');
      const mock = createMockServer();
      registerConfigResource(mock as unknown as import('@modelcontextprotocol/sdk/server/mcp.js').McpServer);

      const configContent = JSON.stringify({ mode: 'max_plan', language: 'tr', projectName: 'test' });
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue(configContent);

      const handler = mock.resources.get('config')!.handler;
      const result = await handler(new URL('deckent://config'));

      const parsed = JSON.parse(result.contents[0]!.text);
      expect(parsed.mode).toBe('max_plan');
      expect(parsed.projectName).toBe('test');
      expect(result.contents[0]!.mimeType).toBe('application/json');
    });

    it('returns error when config file is missing', async () => {
      const { registerConfigResource } = await import('../../src/mcp/resources/config.js');
      const mock = createMockServer();
      registerConfigResource(mock as unknown as import('@modelcontextprotocol/sdk/server/mcp.js').McpServer);

      vi.mocked(existsSync).mockReturnValue(false);

      const handler = mock.resources.get('config')!.handler;
      const result = await handler(new URL('deckent://config'));

      const parsed = JSON.parse(result.contents[0]!.text);
      expect(parsed.error).toContain('Config not found');
    });

    it('returns error when config is invalid JSON', async () => {
      const { registerConfigResource } = await import('../../src/mcp/resources/config.js');
      const mock = createMockServer();
      registerConfigResource(mock as unknown as import('@modelcontextprotocol/sdk/server/mcp.js').McpServer);

      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue('not valid json{{{');

      const handler = mock.resources.get('config')!.handler;
      const result = await handler(new URL('deckent://config'));

      const parsed = JSON.parse(result.contents[0]!.text);
      expect(parsed.error).toContain('Cannot parse config');
    });
  });
});

// TSM-017: physically merged from tests/mcp/resources/resources.test.ts.
{
// ─── Mocks ──────────────────────────────────────────────────────────
// ── MemoryStore mock for DB-first code paths ─────────────────────
const mockMemStore = mockMcpMemStore;

// ─── Mock Server Pattern ────────────────────────────────────────────
type ResourceHandler = (uri: URL, vars?: unknown) => Promise<{
    contents: Array<{
        uri: string;
        text: string;
        mimeType?: string;
    }>;
}>;

interface MockServer {
    resources: Map<string, {
        config: unknown;
        handler: ResourceHandler;
    }>;
    registerTool: (name: string, config: unknown, handler: unknown) => void;
    registerResource: (name: string, uri: string, config: unknown, handler: ResourceHandler) => void;
}

function createMockServer(): MockServer {
    const resources = new Map<string, {
        config: unknown;
        handler: ResourceHandler;
    }>();
    return {
        resources,
        registerTool() { },
        registerResource(name: string, _uri: string, config: unknown, handler: ResourceHandler) {
            resources.set(name, { config, handler });
        },
    };
}

// ─── Tests ───────────────────────────────────────────────────────────
describe('MCP Resources — Comprehensive Suite', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Reset MemoryStore mock to default empty returns after clearAllMocks
        mockMemStore.getByType.mockReturnValue([]);
        mockMemStore.getById.mockReturnValue(null);
        memoryReadMocks.readMemoryView.mockReturnValue({ state: 'ABSENT' });
        memoryReadMocks.renderMemoryReadView.mockReturnValue('');
    });
    // ── config resource ────────────────────────────────────────────────
    describe('deckent://config', () => {
        it('registers config resource with correct name and mimeType', async () => {
            const { registerConfigResource } = await import("../../src/mcp/resources/config.js");
            const mock = createMockServer();
            registerConfigResource(mock as unknown as import("@modelcontextprotocol/sdk/server/mcp.js").McpServer);
            expect(mock.resources.has('config')).toBe(true);
            const cfg = mock.resources.get('config')!.config as {
                mimeType?: string;
            };
            expect(cfg.mimeType).toBe('application/json');
        });
        it('returns valid JSON when config file exists', async () => {
            const { registerConfigResource } = await import("../../src/mcp/resources/config.js");
            const mock = createMockServer();
            registerConfigResource(mock as unknown as import("@modelcontextprotocol/sdk/server/mcp.js").McpServer);
            const config = { mode: 'max_plan', language: 'en', projectName: 'my-project', brain_planning: 'ai' };
            vi.mocked(existsSync).mockReturnValue(true);
            vi.mocked(readFileSync).mockReturnValue(JSON.stringify(config));
            const handler = mock.resources.get('config')!.handler;
            const result = await handler(new URL('deckent://config'));
            expect(result.contents).toHaveLength(1);
            const parsed = JSON.parse(result.contents[0]!.text);
            expect(parsed.mode).toBe('max_plan');
            expect(parsed.language).toBe('en');
            expect(parsed.projectName).toBe('my-project');
        });
        it('returns error object when config file does not exist', async () => {
            const { registerConfigResource } = await import("../../src/mcp/resources/config.js");
            const mock = createMockServer();
            registerConfigResource(mock as unknown as import("@modelcontextprotocol/sdk/server/mcp.js").McpServer);
            vi.mocked(existsSync).mockReturnValue(false);
            const handler = mock.resources.get('config')!.handler;
            const result = await handler(new URL('deckent://config'));
            const parsed = JSON.parse(result.contents[0]!.text);
            expect(parsed.error).toBeDefined();
            expect(parsed.error).toContain('Config not found');
        });
        it('returns error object when config file has invalid JSON', async () => {
            const { registerConfigResource } = await import("../../src/mcp/resources/config.js");
            const mock = createMockServer();
            registerConfigResource(mock as unknown as import("@modelcontextprotocol/sdk/server/mcp.js").McpServer);
            vi.mocked(existsSync).mockReturnValue(true);
            vi.mocked(readFileSync).mockReturnValue('{ invalid json <<<');
            const handler = mock.resources.get('config')!.handler;
            const result = await handler(new URL('deckent://config'));
            const parsed = JSON.parse(result.contents[0]!.text);
            expect(parsed.error).toContain('Cannot parse config');
        });
        it('includes uri in content', async () => {
            const { registerConfigResource } = await import("../../src/mcp/resources/config.js");
            const mock = createMockServer();
            registerConfigResource(mock as unknown as import("@modelcontextprotocol/sdk/server/mcp.js").McpServer);
            vi.mocked(existsSync).mockReturnValue(false);
            const handler = mock.resources.get('config')!.handler;
            const result = await handler(new URL('deckent://config'));
            expect(result.contents[0]!.uri).toContain('deckent://config');
        });
    });
    // ── dashboard resource ─────────────────────────────────────────────
    describe('deckent://dashboard', () => {
        it('registers dashboard resource with correct name and mimeType', async () => {
            const { registerDashboardResource } = await import("../../src/mcp/resources/dashboard.js");
            const mock = createMockServer();
            registerDashboardResource(mock as unknown as import("@modelcontextprotocol/sdk/server/mcp.js").McpServer);
            expect(mock.resources.has('dashboard')).toBe(true);
            const cfg = mock.resources.get('dashboard')!.config as {
                mimeType?: string;
            };
            expect(cfg.mimeType).toBe('application/json');
        });
        it('returns dashboard state when file exists', async () => {
            const { registerDashboardResource } = await import("../../src/mcp/resources/dashboard.js");
            const mock = createMockServer();
            registerDashboardResource(mock as unknown as import("@modelcontextprotocol/sdk/server/mcp.js").McpServer);
            const dashState = {
                active: true,
                sprint: { id: 'sprint-024', phase: 'EXECUTE' },
                progress: { done: 3, total: 5 },
                agents: [],
                alerts: [],
            };
            vi.mocked(existsSync).mockReturnValue(true);
            vi.mocked(readFileSync).mockReturnValue(JSON.stringify(dashState));
            const handler = mock.resources.get('dashboard')!.handler;
            const result = await handler(new URL('deckent://dashboard'));
            const parsed = JSON.parse(result.contents[0]!.text);
            expect(parsed.active).toBe(true);
            expect(parsed.sprint.id).toBe('sprint-024');
            expect(parsed.progress.done).toBe(3);
        });
        it('returns { active: false } when dashboard file does not exist', async () => {
            const { registerDashboardResource } = await import("../../src/mcp/resources/dashboard.js");
            const mock = createMockServer();
            registerDashboardResource(mock as unknown as import("@modelcontextprotocol/sdk/server/mcp.js").McpServer);
            vi.mocked(existsSync).mockReturnValue(false);
            const handler = mock.resources.get('dashboard')!.handler;
            const result = await handler(new URL('deckent://dashboard'));
            const parsed = JSON.parse(result.contents[0]!.text);
            expect(parsed.active).toBe(false);
        });
        it('returns { active: false, error } when dashboard JSON is malformed', async () => {
            const { registerDashboardResource } = await import("../../src/mcp/resources/dashboard.js");
            const mock = createMockServer();
            registerDashboardResource(mock as unknown as import("@modelcontextprotocol/sdk/server/mcp.js").McpServer);
            vi.mocked(existsSync).mockReturnValue(true);
            vi.mocked(readFileSync).mockReturnValue('not valid json!!!');
            const handler = mock.resources.get('dashboard')!.handler;
            const result = await handler(new URL('deckent://dashboard'));
            const parsed = JSON.parse(result.contents[0]!.text);
            expect(parsed.active).toBe(false);
            expect(parsed.error).toBeDefined();
            expect(parsed.error).toContain('JSON parse error');
        });
        it('returns correct mimeType in contents', async () => {
            const { registerDashboardResource } = await import("../../src/mcp/resources/dashboard.js");
            const mock = createMockServer();
            registerDashboardResource(mock as unknown as import("@modelcontextprotocol/sdk/server/mcp.js").McpServer);
            vi.mocked(existsSync).mockReturnValue(false);
            const handler = mock.resources.get('dashboard')!.handler;
            const result = await handler(new URL('deckent://dashboard'));
            expect(result.contents[0]!.mimeType).toBe('application/json');
        });
    });
    // ── debt resource ──────────────────────────────────────────────────
    describe('deckent://debt', () => {
        it('registers debt resource with correct name and mimeType', async () => {
            const { registerDebtResource } = await import("../../src/mcp/resources/debt.js");
            const mock = createMockServer();
            registerDebtResource(mock as unknown as import("@modelcontextprotocol/sdk/server/mcp.js").McpServer);
            expect(mock.resources.has('debt')).toBe(true);
            const cfg = mock.resources.get('debt')!.config as {
                mimeType?: string;
            };
            expect(cfg.mimeType).toBe('application/json');
        });
        it('returns debt entries from DB as JSON array', async () => {
            const { registerDebtResource } = await import("../../src/mcp/resources/debt.js");
            const mock = createMockServer();
            registerDebtResource(mock as unknown as import("@modelcontextprotocol/sdk/server/mcp.js").McpServer);
            vi.mocked(existsSync).mockReturnValue(true);
            mockMemStore.getByType.mockReturnValue([
                { id: 'debt-001', type: 'debt', title: 'Missing tests', content: '', source: 'brain', summary: null, status: 'active', priority: 'high', sprint_id: 'sprint-006', sprint_num: 6, tag_text: '', metadata: JSON.stringify({ originTaskId: '6-001', originSprintId: 'sprint-006', sprintsOpen: 1 }), created_at: '2026-03-17', updated_at: '', deleted_at: null },
                { id: 'debt-002', type: 'debt', title: 'Unused import', content: '', source: 'brain', summary: null, status: 'resolved', priority: 'normal', sprint_id: 'sprint-006', sprint_num: 6, tag_text: '', metadata: JSON.stringify({ originTaskId: '6-002', originSprintId: 'sprint-006', sprintsOpen: 2, resolvedInSprintId: 'sprint-007' }), created_at: '2026-03-16', updated_at: '', deleted_at: null },
            ]);
            const handler = mock.resources.get('debt')!.handler;
            const result = await handler(new URL('deckent://debt'));
            const items = JSON.parse(result.contents[0]!.text);
            expect(Array.isArray(items)).toBe(true);
            expect(items).toHaveLength(2);
            expect(items[0].id).toBe('debt-001');
            expect(items[0].priority).toBe('HIGH');
            expect(items[0].resolved).toBe(false);
            expect(items[1].id).toBe('debt-002');
            expect(items[1].resolved).toBe(true);
            expect(items[1].resolvedInSprintId).toBe('sprint-007');
        });
        it('returns empty array when DEBT.md does not exist', async () => {
            const { registerDebtResource } = await import("../../src/mcp/resources/debt.js");
            const mock = createMockServer();
            registerDebtResource(mock as unknown as import("@modelcontextprotocol/sdk/server/mcp.js").McpServer);
            vi.mocked(existsSync).mockReturnValue(false);
            const handler = mock.resources.get('debt')!.handler;
            const result = await handler(new URL('deckent://debt'));
            const items = JSON.parse(result.contents[0]!.text);
            expect(items).toHaveLength(0);
        });
        it('returns empty array when DEBT.md has no table rows', async () => {
            const { registerDebtResource } = await import("../../src/mcp/resources/debt.js");
            const mock = createMockServer();
            registerDebtResource(mock as unknown as import("@modelcontextprotocol/sdk/server/mcp.js").McpServer);
            const emptyDebt = `# Tech Debt\nNo items yet.\n`;
            vi.mocked(existsSync).mockReturnValue(true);
            vi.mocked(readFileSync).mockReturnValue(emptyDebt);
            const handler = mock.resources.get('debt')!.handler;
            const result = await handler(new URL('deckent://debt'));
            const items = JSON.parse(result.contents[0]!.text);
            expect(items).toHaveLength(0);
        });
        it('handles CRITICAL priority debt item', async () => {
            const { registerDebtResource } = await import("../../src/mcp/resources/debt.js");
            const mock = createMockServer();
            registerDebtResource(mock as unknown as import("@modelcontextprotocol/sdk/server/mcp.js").McpServer);
            vi.mocked(existsSync).mockReturnValue(true);
            mockMemStore.getByType.mockReturnValue([
                { id: 'debt-003', type: 'debt', title: 'Security hole', content: '', source: 'brain', summary: null, status: 'active', priority: 'critical', sprint_id: 'sprint-009', sprint_num: 9, tag_text: '', metadata: JSON.stringify({ originTaskId: '9-001', originSprintId: 'sprint-009', sprintsOpen: 5 }), created_at: '2026-03-20', updated_at: '', deleted_at: null },
            ]);
            const handler = mock.resources.get('debt')!.handler;
            const result = await handler(new URL('deckent://debt'));
            const items = JSON.parse(result.contents[0]!.text);
            expect(items[0].priority).toBe('CRITICAL');
            expect(items[0].sprintsOpen).toBe(5);
        });
    });
    // ── directives resource ────────────────────────────────────────────
    describe('deckent://directives', () => {
        it('registers directives resource with correct name and mimeType', async () => {
            const { registerDirectivesResource } = await import("../../src/mcp/resources/directives.js");
            const mock = createMockServer();
            registerDirectivesResource(mock as unknown as import("@modelcontextprotocol/sdk/server/mcp.js").McpServer);
            expect(mock.resources.has('directives')).toBe(true);
            const cfg = mock.resources.get('directives')!.config as {
                mimeType?: string;
            };
            expect(cfg.mimeType).toBe('text/markdown');
        });
        it('returns DIRECTIVES.md content as markdown', async () => {
            const { registerDirectivesResource } = await import("../../src/mcp/resources/directives.js");
            const mock = createMockServer();
            registerDirectivesResource(mock as unknown as import("@modelcontextprotocol/sdk/server/mcp.js").McpServer);
            const content = '# Sprint Goals\n\n## Task 1: Auth\nImplement login flow\n';
            vi.mocked(existsSync).mockReturnValue(true);
            vi.mocked(readFileSync).mockReturnValue(content);
            const handler = mock.resources.get('directives')!.handler;
            const result = await handler(new URL('deckent://directives'));
            expect(result.contents[0]!.text).toBe(content);
            expect(result.contents[0]!.mimeType).toBe('text/markdown');
        });
        it('returns empty string when DIRECTIVES.md does not exist', async () => {
            const { registerDirectivesResource } = await import("../../src/mcp/resources/directives.js");
            const mock = createMockServer();
            registerDirectivesResource(mock as unknown as import("@modelcontextprotocol/sdk/server/mcp.js").McpServer);
            vi.mocked(existsSync).mockReturnValue(false);
            const handler = mock.resources.get('directives')!.handler;
            const result = await handler(new URL('deckent://directives'));
            expect(result.contents[0]!.text).toBe('');
        });
        it('preserves full markdown content including headers and code blocks', async () => {
            const { registerDirectivesResource } = await import("../../src/mcp/resources/directives.js");
            const mock = createMockServer();
            registerDirectivesResource(mock as unknown as import("@modelcontextprotocol/sdk/server/mcp.js").McpServer);
            const content = '# Directives\n\n```ts\nconst x = 1;\n```\n\n- item 1\n- item 2\n';
            vi.mocked(existsSync).mockReturnValue(true);
            vi.mocked(readFileSync).mockReturnValue(content);
            const handler = mock.resources.get('directives')!.handler;
            const result = await handler(new URL('deckent://directives'));
            expect(result.contents[0]!.text).toContain('```ts');
            expect(result.contents[0]!.text).toContain('item 1');
        });
    });
    // ── memory resource ────────────────────────────────────────────────
    describe('deckent://memory', () => {
        it('registers memory resource with correct name and mimeType', async () => {
            const { registerMemoryResource } = await import("../../src/mcp/resources/memory.js");
            const mock = createMockServer();
            registerMemoryResource(mock as unknown as import("@modelcontextprotocol/sdk/server/mcp.js").McpServer);
            expect(mock.resources.has('memory')).toBe(true);
            const cfg = mock.resources.get('memory')!.config as {
                mimeType?: string;
            };
            expect(cfg.mimeType).toBe('text/markdown');
        });
        it('returns memory entries from DB', async () => {
            const { registerMemoryResource } = await import("../../src/mcp/resources/memory.js");
            const mock = createMockServer();
            registerMemoryResource(mock as unknown as import("@modelcontextprotocol/sdk/server/mcp.js").McpServer);
            vi.mocked(existsSync).mockReturnValue(true);
            memoryReadMocks.readMemoryView.mockReturnValue({
                state: 'AVAILABLE',
                scope: { kind: 'local-project', projectId: 'project-test' },
                selectionRevisionDigest: 'sha256:selection',
                queryDigest: 'sha256:query',
                entries: [], deferred: [], nextCursor: null,
            });
            memoryReadMocks.renderMemoryReadView.mockReturnValue('- spawnSync is safe from injection');
            const handler = mock.resources.get('memory')!.handler;
            const result = await handler(new URL('deckent://memory'));
            expect(JSON.parse(result.contents[0]!.text).rendered).toContain('spawnSync');
            expect(result.contents[0]!.mimeType).toBe('application/json');
        });
        it('returns a typed unavailable hold when memory.db does not exist', async () => {
            const { registerMemoryResource } = await import("../../src/mcp/resources/memory.js");
            const mock = createMockServer();
            registerMemoryResource(mock as unknown as import("@modelcontextprotocol/sdk/server/mcp.js").McpServer);
            vi.mocked(existsSync).mockReturnValue(false);
            const handler = mock.resources.get('memory')!.handler;
            const result = await handler(new URL('deckent://memory'));
            expect(JSON.parse(result.contents[0]!.text).metadata.reasonCode).toBe('QUERY_FAILED');
        });
        it('returns correct uri in content', async () => {
            const { registerMemoryResource } = await import("../../src/mcp/resources/memory.js");
            const mock = createMockServer();
            registerMemoryResource(mock as unknown as import("@modelcontextprotocol/sdk/server/mcp.js").McpServer);
            vi.mocked(existsSync).mockReturnValue(false);
            const handler = mock.resources.get('memory')!.handler;
            const result = await handler(new URL('deckent://memory'));
            expect(result.contents[0]!.uri).toContain('deckent://memory');
        });
    });
    // ── retro resource ─────────────────────────────────────────────────
    describe('deckent://retro', () => {
        it('registers retro resource with correct name and mimeType', async () => {
            const { registerRetroResource } = await import("../../src/mcp/resources/retro.js");
            const mock = createMockServer();
            registerRetroResource(mock as unknown as import("@modelcontextprotocol/sdk/server/mcp.js").McpServer);
            expect(mock.resources.has('retro')).toBe(true);
            const cfg = mock.resources.get('retro')!.config as {
                mimeType?: string;
            };
            expect(cfg.mimeType).toBe('text/markdown');
        });
        it('returns retro content from DB when DB exists', async () => {
            const { registerRetroResource } = await import("../../src/mcp/resources/retro.js");
            const mock = createMockServer();
            registerRetroResource(mock as unknown as import("@modelcontextprotocol/sdk/server/mcp.js").McpServer);
            const content = '# Sprint Retro\n\n## What went well\n- Fast delivery\n';
            vi.mocked(existsSync).mockReturnValue(true);
            mockMemStore.getByType.mockReturnValue([
                { id: 'retro-1', type: 'retro', title: 'Sprint Retro', content, source: 'brain', summary: null, status: 'active', priority: 'normal', sprint_id: null, sprint_num: 0, tag_text: '', metadata: '{}', created_at: '', updated_at: '', deleted_at: null },
            ]);
            const handler = mock.resources.get('retro')!.handler;
            const result = await handler(new URL('deckent://retro'));
            expect(result.contents[0]!.text).toBe(content);
            expect(result.contents[0]!.mimeType).toBe('text/markdown');
        });
        it('returns empty string when RETRO.md does not exist', async () => {
            const { registerRetroResource } = await import("../../src/mcp/resources/retro.js");
            const mock = createMockServer();
            registerRetroResource(mock as unknown as import("@modelcontextprotocol/sdk/server/mcp.js").McpServer);
            vi.mocked(existsSync).mockReturnValue(false);
            const handler = mock.resources.get('retro')!.handler;
            const result = await handler(new URL('deckent://retro'));
            expect(result.contents[0]!.text).toBe('');
        });
        it('returns correct uri in content', async () => {
            const { registerRetroResource } = await import("../../src/mcp/resources/retro.js");
            const mock = createMockServer();
            registerRetroResource(mock as unknown as import("@modelcontextprotocol/sdk/server/mcp.js").McpServer);
            vi.mocked(existsSync).mockReturnValue(false);
            const handler = mock.resources.get('retro')!.handler;
            const result = await handler(new URL('deckent://retro'));
            expect(result.contents[0]!.uri).toContain('deckent://retro');
        });
    });
    // ── tasks resource ─────────────────────────────────────────────────
    describe('deckent://tasks', () => {
        it('registers tasks resource with correct name and mimeType', async () => {
            const { registerTasksResource } = await import("../../src/mcp/resources/tasks.js");
            const mock = createMockServer();
            registerTasksResource(mock as unknown as import("@modelcontextprotocol/sdk/server/mcp.js").McpServer);
            expect(mock.resources.has('tasks')).toBe(true);
            const cfg = mock.resources.get('tasks')!.config as {
                mimeType?: string;
            };
            expect(cfg.mimeType).toBe('application/json');
        });
        it('returns task list when .tasks dir exists', async () => {
            const { registerTasksResource } = await import("../../src/mcp/resources/tasks.js");
            const mock = createMockServer();
            registerTasksResource(mock as unknown as import("@modelcontextprotocol/sdk/server/mcp.js").McpServer);
            const taskJson = { id: '059-001', title: 'My Task', status: 'EXECUTING' };
            vi.mocked(existsSync).mockReturnValue(true);
            vi.mocked((await import("node:fs")).readdirSync).mockReturnValue(['task-059-001.json'] as unknown as ReturnType<typeof import("node:fs").readdirSync>);
            vi.mocked(readFileSync).mockReturnValue(JSON.stringify(taskJson));
            const handler = mock.resources.get('tasks')!.handler;
            const result = await handler(new URL('deckent://tasks'));
            const parsed = JSON.parse(result.contents[0]!.text);
            expect(parsed.tasks).toHaveLength(1);
            expect(parsed.tasks[0].id).toBe('059-001');
        });
        it('returns empty task list when .tasks dir does not exist', async () => {
            const { registerTasksResource } = await import("../../src/mcp/resources/tasks.js");
            const mock = createMockServer();
            registerTasksResource(mock as unknown as import("@modelcontextprotocol/sdk/server/mcp.js").McpServer);
            vi.mocked(existsSync).mockReturnValue(false);
            const handler = mock.resources.get('tasks')!.handler;
            const result = await handler(new URL('deckent://tasks'));
            const parsed = JSON.parse(result.contents[0]!.text);
            expect(parsed.tasks).toHaveLength(0);
        });
    });
    // ── agents resource ────────────────────────────────────────────────
    describe('deckent://agents', () => {
        it('registers agents resource with correct name and mimeType', async () => {
            const { registerAgentsResource } = await import("../../src/mcp/resources/agents.js");
            const mock = createMockServer();
            registerAgentsResource(mock as unknown as import("@modelcontextprotocol/sdk/server/mcp.js").McpServer);
            expect(mock.resources.has('agents')).toBe(true);
            const cfg = mock.resources.get('agents')!.config as {
                mimeType?: string;
            };
            expect(cfg.mimeType).toBe('application/json');
        });
        it('returns agent list when .deckent/agents dir exists', async () => {
            const { registerAgentsResource } = await import("../../src/mcp/resources/agents.js");
            const mock = createMockServer();
            registerAgentsResource(mock as unknown as import("@modelcontextprotocol/sdk/server/mcp.js").McpServer);
            const agentJson = { id: 'bug-fixer', name: 'Bug Fixer', enabled: true };
            vi.mocked(existsSync).mockReturnValue(true);
            vi.mocked((await import("node:fs")).readdirSync).mockReturnValue(['bug-fixer'] as unknown as ReturnType<typeof import("node:fs").readdirSync>);
            vi.mocked(readFileSync).mockReturnValue(JSON.stringify(agentJson));
            const handler = mock.resources.get('agents')!.handler;
            const result = await handler(new URL('deckent://agents'));
            const parsed = JSON.parse(result.contents[0]!.text);
            expect(parsed.agents).toHaveLength(1);
            expect(parsed.agents[0].id).toBe('bug-fixer');
        });
        it('returns empty agents list when .deckent/agents dir does not exist', async () => {
            const { registerAgentsResource } = await import("../../src/mcp/resources/agents.js");
            const mock = createMockServer();
            registerAgentsResource(mock as unknown as import("@modelcontextprotocol/sdk/server/mcp.js").McpServer);
            vi.mocked(existsSync).mockReturnValue(false);
            const handler = mock.resources.get('agents')!.handler;
            const result = await handler(new URL('deckent://agents'));
            const parsed = JSON.parse(result.contents[0]!.text);
            expect(parsed.agents).toHaveLength(0);
        });
    });
    // ── registerResources index ────────────────────────────────────────
    describe('registerResources (index)', () => {
        it('registers all 8 resources on the server', async () => {
            const { registerResources } = await import("../../src/mcp/resources/index.js");
            const mock = createMockServer();
            registerResources(mock as unknown as import("@modelcontextprotocol/sdk/server/mcp.js").McpServer);
            expect(mock.resources.has('config')).toBe(true);
            expect(mock.resources.has('dashboard')).toBe(true);
            expect(mock.resources.has('directives')).toBe(true);
            expect(mock.resources.has('memory')).toBe(true);
            expect(mock.resources.has('debt')).toBe(true);
            expect(mock.resources.has('retro')).toBe(true);
            expect(mock.resources.has('tasks')).toBe(true);
            expect(mock.resources.has('agents')).toBe(true);
        });
    });
    // ── Error handling edge cases ──────────────────────────────────────
    describe('Error handling', () => {
        it('config: readFileSync throwing non-JSON error returns error object', async () => {
            const { registerConfigResource } = await import("../../src/mcp/resources/config.js");
            const mock = createMockServer();
            registerConfigResource(mock as unknown as import("@modelcontextprotocol/sdk/server/mcp.js").McpServer);
            vi.mocked(existsSync).mockReturnValue(true);
            vi.mocked(readFileSync).mockImplementation(() => { throw new Error('EACCES: permission denied'); });
            const handler = mock.resources.get('config')!.handler;
            const result = await handler(new URL('deckent://config'));
            const parsed = JSON.parse(result.contents[0]!.text);
            expect(parsed.error).toBeDefined();
        });
        it('dashboard: readFileSync throwing returns error fallback', async () => {
            const { registerDashboardResource } = await import("../../src/mcp/resources/dashboard.js");
            const mock = createMockServer();
            registerDashboardResource(mock as unknown as import("@modelcontextprotocol/sdk/server/mcp.js").McpServer);
            vi.mocked(existsSync).mockReturnValue(true);
            vi.mocked(readFileSync).mockImplementation(() => { throw new Error('EACCES: permission denied'); });
            const handler = mock.resources.get('dashboard')!.handler;
            const result = await handler(new URL('deckent://dashboard'));
            const parsed = JSON.parse(result.contents[0]!.text);
            expect(parsed.active).toBe(false);
        });
        it('debt: readFileSync throwing returns empty array', async () => {
            const { registerDebtResource } = await import("../../src/mcp/resources/debt.js");
            const mock = createMockServer();
            registerDebtResource(mock as unknown as import("@modelcontextprotocol/sdk/server/mcp.js").McpServer);
            vi.mocked(existsSync).mockReturnValue(true);
            vi.mocked(readFileSync).mockImplementation(() => { throw new Error('EACCES: permission denied'); });
            const handler = mock.resources.get('debt')!.handler;
            const result = await handler(new URL('deckent://debt'));
            const items = JSON.parse(result.contents[0]!.text);
            expect(items).toHaveLength(0);
        });
    });
});
}
