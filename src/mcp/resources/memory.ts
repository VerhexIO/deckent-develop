import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { BRAIN_DIR, MEMORY_DB_FILE } from '../../core/constants.js';
import { MemoryStore } from '../../core/memory-store.js';
import { readMemoryView, renderMemoryReadView } from '../../core/memory-read-service.js';
import { buildMemoryReadLabels } from '../../core/memory-read-labels.js';
import { attendedExecutionProjectId } from '../../core/attended-execution-approval.js';
import { resolveMemoryReadConfig } from '../../core/config.js';
import { getLanguage, getMessage } from '../../cli/helpers/messages.js';

function resourceMetadata(view: ReturnType<typeof readMemoryView>): Record<string, unknown> {
  if (view.state === 'HOLD') return { schemaVersion: 1, state: view.state, reasonCode: view.reasonCode };
  if (view.state === 'ABSENT') return { schemaVersion: 1, state: view.state, scope: view.scope, selectionRevisionDigest: view.selectionRevisionDigest, queryDigest: view.queryDigest, selectedIds: [], deferred: [], nextCursor: null };
  return {
    schemaVersion: 1,
    state: view.state,
    scope: view.scope,
    selectionRevisionDigest: view.selectionRevisionDigest,
    queryDigest: view.queryDigest,
    selectedIds: view.entries.map(({ entry, contentDigest }) => ({ id: entry.id, contentDigest })),
    deferred: view.deferred.map(({ candidate, detailRef, reasonCode }) => ({ id: candidate.id, detailRef, reasonCode })),
    nextCursor: view.nextCursor,
  };
}

export function registerMemoryResource(server: McpServer): void {
  server.registerResource(
    'memory',
    'deckent://memory',
    {
      title: 'Brain Memory',
      description: 'Learned patterns from previous sprints',
      mimeType: 'text/markdown',
    },
    async (uri) => {
      const root = process.cwd();

      const dbPath = join(root, BRAIN_DIR, MEMORY_DB_FILE);
      let config: ReturnType<typeof resolveMemoryReadConfig>;
      try {
        config = resolveMemoryReadConfig(root, 'mcp');
      } catch {
        return { contents: [{ uri: uri.href, text: JSON.stringify({ metadata: { schemaVersion: 1, state: 'HOLD', reasonCode: 'QUERY_FAILED' } }), mimeType: 'application/json' }] };
      }
      const lang = getLanguage(config.language);
      if (!existsSync(dbPath)) {
        return {
          contents: [{
            uri: uri.href,
            text: JSON.stringify({ metadata: { schemaVersion: 1, state: 'HOLD', reasonCode: 'QUERY_FAILED' } }),
            mimeType: 'application/json',
          }],
        };
      }
      const store = new MemoryStore(dbPath, { readOnly: true });
      try {
        const view = readMemoryView(store, {
          consumer: 'mcp',
          scope: { kind: 'local-project', projectId: attendedExecutionProjectId(root) },
          query: { type: ['memory'] },
          limits: config.memory_read,
        });
        if (view.state === 'HOLD') {
          return {
            contents: [{
              uri: uri.href,
              text: JSON.stringify({ metadata: resourceMetadata(view) }),
              mimeType: 'application/json',
            }],
          };
        }
        if (view.state === 'ABSENT') {
          return { contents: [{ uri: uri.href, text: JSON.stringify({ metadata: resourceMetadata(view), rendered: getMessage('memory_read.absent', lang) }), mimeType: 'application/json' }] };
        }
        return {
          contents: [{
            uri: uri.href,
            text: JSON.stringify({ metadata: resourceMetadata(view), rendered: renderMemoryReadView(view, buildMemoryReadLabels(getMessage, lang === 'tr' ? 'tr' : 'en')) }),
            mimeType: 'application/json',
          }],
        };
      } catch {
        return {
          contents: [{
            uri: uri.href,
            text: JSON.stringify({ metadata: { schemaVersion: 1, state: 'HOLD', reasonCode: 'QUERY_FAILED' } }),
            mimeType: 'application/json',
          }],
        };
      } finally {
        store.close();
      }
    },
  );
}
