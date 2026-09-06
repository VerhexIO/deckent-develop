import { join } from 'node:path';
import { existsSync } from 'node:fs';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod/v4';
import { MemoryStore } from '../../core/memory-store.js';
import { readMemoryDetail, readMemoryView, renderMemoryReadView } from '../../core/memory-read-service.js';
import { buildMemoryReadLabels } from '../../core/memory-read-labels.js';
import { attendedExecutionProjectId } from '../../core/attended-execution-approval.js';
import { resolveMemoryReadConfig } from '../../core/config.js';
import { BRAIN_DIR, MEMORY_DB_FILE } from '../../core/constants.js';
import { mcpToolDescription } from './description-catalog.js';
import { getLanguage, getMessage } from '../../cli/helpers/messages.js';

export function registerMemoryQueryTool(server: McpServer): void {
  server.registerTool(
    'deckent_memory_query',
    {
      title: 'Memory Query',
      description: mcpToolDescription('deckent_memory_query'),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
      },
      inputSchema: z.object({
        query: z.string().optional().describe('Search query text'),
        type: z.array(z.string()).optional().describe('Filter by type: adr, memory, sprint, debt, pattern, retro'),
        status: z.array(z.string()).optional().describe('Filter by status: active, accepted, deprecated, resolved'),
        limit: z.number().optional().default(5).describe('Max results (default 5)'),
        sprint_min: z.number().optional().describe('Minimum sprint number'),
        mode: z.enum(['and', 'or']).optional().default('or').describe('FTS5 token join: or (default, broader recall) | and (all tokens must match)'),
        cursor: z.string().optional().describe('Opaque continuation cursor returned by an earlier memory query'),
        detail_ref: z.string().optional().describe('Opaque detail reference returned for a deferred complete entry'),
        root: z.string().optional().describe('Project root path'),
      }),
    },
    async ({ query, type, status, limit, sprint_min, mode, cursor, detail_ref, root: rootParam }) => {
      const root = rootParam || process.cwd();
      const dbPath = join(root, BRAIN_DIR, MEMORY_DB_FILE);
      let config: ReturnType<typeof resolveMemoryReadConfig>;
      try {
        config = resolveMemoryReadConfig(root, 'mcp');
      } catch {
        return {
          content: [{ type: 'text' as const, text: getMessage('memory_read.hold', getLanguage(), { reason: 'QUERY_FAILED' }) }],
          structuredContent: { schemaVersion: 1, view: { state: 'HOLD', reasonCode: 'QUERY_FAILED' } },
          isError: true as const,
        };
      }
      const lang = getLanguage(config.language);
      const labels = buildMemoryReadLabels(getMessage, lang === 'tr' ? 'tr' : 'en');

      if (!existsSync(dbPath)) {
        return {
          content: [{ type: 'text' as const, text: getMessage('memory_read.hold', lang, { reason: 'QUERY_FAILED' }) }],
          structuredContent: { schemaVersion: 1, view: { state: 'HOLD', reasonCode: 'QUERY_FAILED' } },
          isError: true as const,
        };
      }

      const store = new MemoryStore(dbPath, { readOnly: true });
      try {
        const scope = { kind: 'local-project' as const, projectId: attendedExecutionProjectId(root) };
        if (detail_ref !== undefined) {
          const detail = readMemoryDetail(store, { consumer: 'mcp', scope, detailRef: detail_ref });
          if (detail.state === 'HOLD') {
            return { content: [{ type: 'text' as const, text: getMessage('memory_read.hold', lang, { reason: detail.reasonCode }) }], structuredContent: { schemaVersion: 1, detail }, isError: true as const };
          }
          return {
            content: [{ type: 'text' as const, text: JSON.stringify({ schemaVersion: 1, detail }) }], structuredContent: { schemaVersion: 1, detail },
          };
        }
        if (typeof query !== 'string' || query.trim().length === 0) {
          const view = { state: 'HOLD' as const, reasonCode: 'INVALID_REQUEST' };
          return { content: [{ type: 'text' as const, text: getMessage('memory_read.hold', lang, { reason: 'INVALID_REQUEST' }) }], structuredContent: { schemaVersion: 1, view }, isError: true as const };
        }
        const configured = config.memory_read;
        const requested = Number.isSafeInteger(limit) && limit > 0 ? limit : configured.maxEntries;
        const view = readMemoryView(store, {
          consumer: 'mcp',
          scope,
          query: {
            text: query,
            type,
            status,
            sprint_range: sprint_min !== undefined ? { min: sprint_min } : undefined,
            mode,
          },
          limits: { ...configured, maxEntries: Math.min(configured.maxEntries, requested) },
          ...(cursor !== undefined ? { cursor } : {}),
        });
        if (view.state === 'HOLD') {
          return { content: [{ type: 'text' as const, text: getMessage('memory_read.hold', lang, { reason: view.reasonCode }) }], structuredContent: { schemaVersion: 1, view }, isError: true as const };
        }
        if (view.state === 'ABSENT') {
          return { content: [{ type: 'text' as const, text: getMessage('memory_read.absent', lang) }], structuredContent: { schemaVersion: 1, view } };
        }
        return { content: [{ type: 'text' as const, text: renderMemoryReadView(view, labels) }], structuredContent: { schemaVersion: 1, view } };
      } finally {
        store.close();
      }
    },
  );
}
