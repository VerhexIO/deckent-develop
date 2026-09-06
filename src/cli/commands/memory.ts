import { Command } from 'commander';
import { join } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { MemoryStore } from '../../core/memory-store.js';
import {
  readMemoryDetail,
  readMemoryView,
  renderMemoryReadView,
} from '../../core/memory-read-service.js';
import { resolveMemoryReadConfig } from '../../core/config.js';
import type { MemoryReadLimitsV1 } from '../../core/memory-read-contract.js';
import { buildMemoryReadLabels } from '../../core/memory-read-labels.js';
import { attendedExecutionProjectId } from '../../core/attended-execution-approval.js';
import { parseDecisionsMd, parseMemoryMd, parseDebtMd } from '../../core/memory-import.js';
import { writeGuardedExports } from '../../core/memory-export.js';
import { syncAdrFilesToDb } from '../../core/adr-file-sync.js';
import { BRAIN_DIR, MEMORY_DB_FILE, MEMORY_EXPORTS_DIR } from '../../core/constants.js';
import { resolveProjectRoot } from '../helpers/process.js';
import { print, printError } from '../helpers/output.js';
import { loadConfig } from '../../core/config.js';
import { getMessage, getLanguage } from '../helpers/messages.js';
import { memoryCatalogMessage } from '../helpers/message-catalog/cli-memory-catalog.js';
import { detectLang } from '../helpers/i18n.js';
import type { EntryRelation } from '../../core/memory-types.js';
import type { ResolvedConfig } from '../../core/config-types.js';
import { buildMemoryExportLabels } from '../../core/memory-export-labels.js';

type MemoryRuntimeConfig = Pick<ResolvedConfig, 'language' | 'memory_export' | 'memory_read'>;

function resolvedMemoryReadLimits(configured: Readonly<MemoryReadLimitsV1>, requestedLimit?: unknown): Readonly<MemoryReadLimitsV1> | null {
  if (requestedLimit !== undefined && (typeof requestedLimit !== 'string' || requestedLimit.trim().length === 0)) return null;
  const parsed = typeof requestedLimit === 'string' ? Number.parseInt(requestedLimit, 10) : undefined;
  if (parsed === undefined) return configured;
  if (!Number.isSafeInteger(parsed) || parsed <= 0 || String(parsed) !== requestedLimit) return null;
  return Object.freeze({ ...configured, maxEntries: Math.min(configured.maxEntries, parsed) });
}

function renderMemoryDetail(entry: {
  readonly title: string;
  readonly source: string;
  readonly status: string;
  readonly sprint_id: string | null;
  readonly updated_at: string;
  readonly content: string;
}, labels: ReturnType<typeof buildMemoryReadLabels>): string {
  return [
    `## ${entry.title}`,
    `- ${labels.source}: ${entry.source}`,
    `- ${labels.status}: ${entry.status}`,
    `- ${labels.sprint}: ${entry.sprint_id ?? ''}`,
    `- ${labels.updatedAt}: ${entry.updated_at}`,
    '',
    entry.content,
  ].join('\n');
}

function registerMemoryRecall(mem: Command): void {
  mem
    .command('recall')
    .argument('[query]', memoryCatalogMessage('cli.memcat.recall.arg.query', getLanguage(undefined)))
    .description(getMessage('cli.recall.desc', getLanguage(undefined)))
    .option('-t, --type <types>', memoryCatalogMessage('cli.memcat.recall.opt.type', getLanguage(undefined)), '')
    .option('-n, --limit <n>', memoryCatalogMessage('cli.memcat.recall.opt.limit', getLanguage(undefined)), '5')
    .option('--sprint-min <n>', memoryCatalogMessage('cli.memcat.recall.opt.sprint_min', getLanguage(undefined)))
    .option('-m, --mode <mode>', memoryCatalogMessage('cli.memcat.recall.opt.mode', getLanguage(undefined)), 'or')
    .option('--json', memoryCatalogMessage('cli.memcat.shared.opt.json', getLanguage(undefined)))
    .option('--cursor <cursor>', getMessage('memory_read.cursor_help', getLanguage(undefined)))
    .option('--detail <detailRef>', getMessage('memory_read.detail_help', getLanguage(undefined)))
    .addHelpText('after', memoryCatalogMessage('cli.memcat.recall.help.paths', getLanguage(undefined)))
    .action(async (query: string | undefined, opts) => {
      const root = resolveProjectRoot();
      let memoryReadConfig: ReturnType<typeof resolveMemoryReadConfig>;
      try {
        memoryReadConfig = resolveMemoryReadConfig(root, 'cli');
      } catch {
        if (opts.json) print(JSON.stringify({ schemaVersion: 1, view: { state: 'HOLD', consumer: 'cli', scope: null, reasonCode: 'QUERY_FAILED', requiredIds: [] } }));
        printError(getMessage('memory_read.hold', detectLang(root), { reason: 'QUERY_FAILED' }));
        process.exitCode = 1;
        return;
      }
      const lang = getLanguage(memoryReadConfig.language);
      const labels = buildMemoryReadLabels(getMessage, lang === 'tr' ? 'tr' : 'en');
      const dbPath = join(root, BRAIN_DIR, MEMORY_DB_FILE);

      if (!existsSync(dbPath)) {
        if (opts.json) print(JSON.stringify({ schemaVersion: 1, view: { state: 'HOLD', consumer: 'cli', scope: null, reasonCode: 'QUERY_FAILED', requiredIds: [] } }));
        printError(getMessage('memory_read.hold', lang, { reason: 'QUERY_FAILED' }));
        process.exitCode = 1;
        return;
      }

      let store: MemoryStore | undefined;
      try {
        store = new MemoryStore(dbPath, { readOnly: true });
        const scope = { kind: 'local-project' as const, projectId: attendedExecutionProjectId(root) };
        if (typeof opts.detail === 'string') {
          const detail = readMemoryDetail(store, {
            consumer: 'cli',
            scope,
            detailRef: opts.detail,
          });
          if (detail.state === 'HOLD') {
            if (opts.json) print(JSON.stringify({ schemaVersion: 1, detail }));
            printError(getMessage('memory_read.hold', lang, { reason: detail.reasonCode }));
            process.exitCode = 1;
            return;
          }
          if (opts.json) {
            print(JSON.stringify({ schemaVersion: 1, detail }));
            return;
          }
          print(renderMemoryDetail(detail.entry, labels));
          return;
        }
        if (typeof query !== 'string' || query.trim().length === 0) {
          if (opts.json) print(JSON.stringify({ schemaVersion: 1, view: { state: 'HOLD', consumer: 'cli', scope, reasonCode: 'INVALID_REQUEST', requiredIds: [] } }));
          printError(getMessage('memory_read.hold', lang, { reason: 'INVALID_REQUEST' }));
          process.exitCode = 1;
          return;
        }
        const types = opts.type ? opts.type.split(',').filter(Boolean) : undefined;
        if (opts.mode !== 'and' && opts.mode !== 'or') {
          if (opts.json) print(JSON.stringify({ schemaVersion: 1, view: { state: 'HOLD', consumer: 'cli', scope, reasonCode: 'INVALID_REQUEST', requiredIds: [] } }));
          printError(getMessage('memory_read.hold', lang, { reason: 'INVALID_REQUEST' }));
          process.exitCode = 1;
          return;
        }
        const mode = opts.mode;
        const limits = resolvedMemoryReadLimits(memoryReadConfig.memory_read, opts.limit);
        if (limits === null) {
          if (opts.json) print(JSON.stringify({ schemaVersion: 1, view: { state: 'HOLD', consumer: 'cli', scope, reasonCode: 'INVALID_REQUEST', requiredIds: [] } }));
          printError(getMessage('memory_read.hold', lang, { reason: 'INVALID_REQUEST' }));
          process.exitCode = 1;
          return;
        }
        const view = readMemoryView(store, {
          consumer: 'cli',
          scope,
          query: {
            text: query,
            type: types,
            sprint_range: opts.sprintMin ? { min: Number.parseInt(opts.sprintMin, 10) } : undefined,
            mode,
          },
          limits,
          ...(typeof opts.cursor === 'string' ? { cursor: opts.cursor } : {}),
        });
        if (view.state === 'HOLD') {
          if (opts.json) print(JSON.stringify({ schemaVersion: 1, view }));
          printError(getMessage('memory_read.hold', lang, { reason: view.reasonCode }));
          process.exitCode = 1;
          return;
        }
        if (opts.json) {
          print(JSON.stringify({ schemaVersion: 1, view }));
          return;
        }
        if (view.state === 'ABSENT') {
          print(getMessage('memory_read.absent', lang));
          return;
        }
        print(renderMemoryReadView(view, labels));
      } catch {
        if (opts.json) print(JSON.stringify({ schemaVersion: 1, view: { state: 'HOLD', consumer: 'cli', scope: null, reasonCode: 'QUERY_FAILED', requiredIds: [] } }));
        printError(getMessage('memory_read.hold', lang, { reason: 'QUERY_FAILED' }));
        process.exitCode = 1;
      } finally {
        store?.close();
      }
    });
}


function registerMemoryRemember(mem: Command): void {
  mem
    .command('remember')
    .argument('<note>', memoryCatalogMessage('cli.memcat.remember.arg.note', getLanguage(undefined)))
    .description(getMessage('cli.remember.desc', getLanguage(undefined)))
    .option('-t, --type <type>', memoryCatalogMessage('cli.memcat.remember.opt.type', getLanguage(undefined)), 'memory')
    .option('--tags <tags>', memoryCatalogMessage('cli.memcat.remember.opt.tags', getLanguage(undefined)), '')
    .option('--title <title>', memoryCatalogMessage('cli.memcat.remember.opt.title', getLanguage(undefined)))
    .addHelpText('after', memoryCatalogMessage('cli.memcat.remember.help.paths', getLanguage(undefined)))
    .action((note: string, opts) => {
      const root = resolveProjectRoot();
      const lang = detectLang(root);
      const dbPath = join(root, BRAIN_DIR, MEMORY_DB_FILE);

      if (!existsSync(dbPath)) {
        printError(getMessage('remember.db_not_found', lang));
        return;
      }

      const store = new MemoryStore(dbPath);
      try {
        const id = `user-${Date.now()}`;
        const title = opts.title || note.slice(0, 60) + (note.length > 60 ? '...' : '');
        const tags = opts.tags ? opts.tags.split(',').map((t: string) => t.trim()).filter(Boolean) : [];

        store.insert({
          id,
          type: opts.type,
          source: 'user',
          title,
          content: note,
          tags,
        });

        print(getMessage('remember.stored', lang, { type: String(opts.type), title }));
        if (tags.length > 0) print(getMessage('remember.tags', lang, { tags: tags.join(', ') }));
      } finally {
        store.close();
      }
    });
}


export function registerMemory(program: Command): void {
  const mem = program.command('memory').description(getMessage('cli.memory.desc', getLanguage(undefined)));
  registerMemoryRecall(mem);
  registerMemoryRemember(mem);

  mem.command('rebuild')
    .description(getMessage('cli.memory.rebuild.desc', getLanguage(undefined)))
    .action(() => {
      const root = resolveProjectRoot();
      const brainDir = join(root, BRAIN_DIR);
      const exportsDir = join(brainDir, MEMORY_EXPORTS_DIR);
      const dbPath = join(brainDir, MEMORY_DB_FILE);

      if (existsSync(dbPath)) {
        printError('memory.db already exists. Delete it first to rebuild.');
        return;
      }

      if (!existsSync(exportsDir)) {
        printError('No exports directory found. Cannot rebuild without .brain/exports/*.md files.');
        return;
      }

      const store = new MemoryStore(dbPath);
      let count = 0;

      try {
        // Bug M Sprint 166 T1: docs/adr/*.md is the primary source for ADRs.
        // Exports/decisions.md is used only as a fallback when no ADR files exist.
        const adrDir = join(root, 'docs', 'adr');
        let adrInsertedFromFiles = 0;
        if (existsSync(adrDir)) {
          const syncResult = syncAdrFilesToDb(store, adrDir, { changedBy: 'memory-rebuild' });
          adrInsertedFromFiles = syncResult.inserted + syncResult.updated;
          count += adrInsertedFromFiles;
          if (adrInsertedFromFiles > 0) {
            print(`  ADRs (from docs/adr/): ${adrInsertedFromFiles}`);
          }
        }

        // Fallback to exports/decisions.md only if no ADRs were imported from files.
        const decisionsPath = join(exportsDir, 'decisions.md');
        if (adrInsertedFromFiles === 0 && existsSync(decisionsPath)) {
          const entries = parseDecisionsMd(readFileSync(decisionsPath, 'utf-8'));
          for (const e of entries) { store.insert(e); count++; }
          print(`  ADRs (from exports/decisions.md): ${entries.length}`);
        }

        const memoryPath = join(exportsDir, 'memory.md');
        if (existsSync(memoryPath)) {
          const entries = parseMemoryMd(readFileSync(memoryPath, 'utf-8'));
          for (const e of entries) { store.insert(e); count++; }
          print(`  Memory: ${entries.length}`);
        }

        const debtPath = join(exportsDir, 'debt.md');
        if (existsSync(debtPath)) {
          const entries = parseDebtMd(readFileSync(debtPath, 'utf-8'));
          for (const e of entries) { store.insert(e); count++; }
          print(`  Debt: ${entries.length}`);
        }

        // Final fallback: original .brain/DECISIONS.md if everything else empty.
        const origDecisions = join(brainDir, 'DECISIONS.md');
        if (count === 0 && existsSync(origDecisions)) {
          const entries = parseDecisionsMd(readFileSync(origDecisions, 'utf-8'));
          for (const e of entries) { store.insert(e); count++; }
          print(`  ADRs (from original): ${entries.length}`);
        }

        print(`\n  Rebuilt memory.db with ${count} entries.`);
      } finally {
        store.close();
      }
    });

  mem.command('export')
    .description(getMessage('cli.memory.export.desc', getLanguage(undefined)))
    .action(async () => {
      const root = resolveProjectRoot();
      const config: MemoryRuntimeConfig = await loadConfig(root).catch(
        (): MemoryRuntimeConfig => ({ language: 'en' }),
      );
      const lang = getLanguage(config.language);
      const brainDir = join(root, BRAIN_DIR);
      const exportsDir = join(brainDir, MEMORY_EXPORTS_DIR);
      const dbPath = join(brainDir, MEMORY_DB_FILE);

      if (!existsSync(dbPath)) {
        printError(getMessage('memory.export.not_found', lang));
        return;
      }

      const store = new MemoryStore(dbPath, { readOnly: true });
      try {
        const result = writeGuardedExports(store, exportsDir, {
          labels: buildMemoryExportLabels(getMessage, lang === 'tr' ? 'tr' : 'en'),
          ...(config.memory_export?.max_inline_lines !== undefined
            ? { maxInlineLines: config.memory_export.max_inline_lines } : {}),
          ...(config.memory_export?.max_inline_bytes !== undefined
            ? { maxInlineBytes: config.memory_export.max_inline_bytes } : {}),
          ...(config.memory_export?.summary_inline_lines !== undefined
            ? { summaryInlineLines: config.memory_export.summary_inline_lines } : {}),
          ...(config.memory_export?.summary_inline_bytes !== undefined
            ? { summaryInlineBytes: config.memory_export.summary_inline_bytes } : {}),
        });
        if (result.skipped.length > 0) {
          printError(getMessage('memory.export.guard_hold', lang, {
            files: result.skipped.join(', '),
            written: String(result.written.length),
          }));
          process.exitCode = 1;
          return;
        }
        print(getMessage('memory.export.success', lang, {
          count: String(result.written.length),
        }));
      } finally {
        store.close();
      }
    });

  mem.command('stats')
    .description(getMessage('cli.memory.stats.desc', getLanguage(undefined)))
    .action(() => {
      const root = resolveProjectRoot();
      const dbPath = join(root, BRAIN_DIR, MEMORY_DB_FILE);

      if (!existsSync(dbPath)) {
        printError('memory.db not found.');
        return;
      }

      const store = new MemoryStore(dbPath);
      try {
        const counts = store.countByType();
        const total = store.totalCount();
        print('\n  Memory V2 Statistics:');
        for (const [type, count] of counts) {
          print(`    ${type}: ${count}`);
        }
        print(`    ────────────`);
        print(`    Total: ${total}`);
        print(`    Schema: v${store.getSchemaVersion()}`);
      } finally {
        store.close();
      }
    });

  // ── Backup subcommand ─────────────────────────────────────────
  mem.command('backup')
    .description(getMessage('memory.backup.desc', getLanguage(undefined)))
    .option('--output <path>', getMessage('cli.runtime.memory.backup.opt.output', getLanguage(undefined)))
    .option('--checkpoint', getMessage('cli.runtime.memory.backup.opt.checkpoint', getLanguage(undefined)))
    .action(async (opts: { output?: string; checkpoint?: boolean }) => {
      const root = resolveProjectRoot();
      const config = await loadConfig(root).catch(() => ({ language: 'en', last_sprint_id: undefined as string | undefined }));
      const lang = getLanguage((config as { language?: string }).language);
      const dbPath = join(root, BRAIN_DIR, MEMORY_DB_FILE);

      if (!existsSync(dbPath)) {
        printError(getMessage('memory.backup.not_found', lang));
        return;
      }

      const store = new MemoryStore(dbPath);
      try {
        const db = store.getRawDb();

        // Always run WAL checkpoint to flush write-ahead log into main DB file
        // so the backup contains a consistent, fully-written snapshot.
        db.pragma('wal_checkpoint(TRUNCATE)');
        if (opts.checkpoint) {
          print(getMessage('memory.backup.checkpoint_done', lang));
        }

        const sprintId = (config as { last_sprint_id?: string }).last_sprint_id ?? 'manual';
        const ts = Date.now();
        const outPath = opts.output ?? join(root, BRAIN_DIR, `memory.db.bak-${sprintId}-${ts}`);

        await db.backup(outPath);

        // Verify backup integrity by counting active entries
        const backupStore = new MemoryStore(outPath);
        let count = 0;
        try {
          count = backupStore.totalCount();
        } finally {
          backupStore.close();
        }

        print(getMessage('memory.backup.success', lang, { path: outPath, count: String(count) }));
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        printError(getMessage('memory.backup.error', lang, { error }));
      } finally {
        store.close();
      }
    });

  // ── Relations subcommand ──────────────────────────────────────
  const relations = mem.command('relations').description(getMessage('cli.memory.relations.desc', getLanguage(undefined)));

  relations.command('list')
    .description(getMessage('cli.memory.list.desc', getLanguage(undefined)))
    .action(() => {
      const root = resolveProjectRoot();
      const dbPath = join(root, BRAIN_DIR, MEMORY_DB_FILE);

      if (!existsSync(dbPath)) {
        printError('memory.db not found.');
        return;
      }

      const store = new MemoryStore(dbPath);
      try {
        const count = store.countRelations();
        const db = store.getRawDb();
        const rows = db.prepare(
          `SELECT from_id, to_id, rel_type, created_at FROM relations ORDER BY created_at DESC LIMIT 50`,
        ).all() as EntryRelation[];

        print(`\n  Relations (${count} total, showing last 50):`);
        print('  ──────────────────────────────────────────');
        for (const r of rows) {
          print(`    ${r.from_id} → ${r.to_id} [${r.rel_type}]`);
        }
      } finally {
        store.close();
      }
    });

  relations.command('review')
    .description(getMessage('cli.memory.review.desc', getLanguage(undefined)))
    .action(async () => {
      const root = resolveProjectRoot();
      const previewPath = join(root, BRAIN_DIR, MEMORY_EXPORTS_DIR, 'relations-backfill-preview.md');

      if (!existsSync(previewPath)) {
        printError('No backfill preview found. Run: node scripts/backfill-relations.mjs --dry-run');
        return;
      }

      const dbPath = join(root, BRAIN_DIR, MEMORY_DB_FILE);
      if (!existsSync(dbPath)) {
        printError('memory.db not found.');
        return;
      }

      const content = readFileSync(previewPath, 'utf-8');
      const lines = content.split('\n').filter(l => l.startsWith('|') && !l.includes('---') && !l.includes('From'));

      if (lines.length === 0) {
        print('  No pending relations to review.');
        return;
      }

      const store = new MemoryStore(dbPath);
      const rl = createInterface({ input: process.stdin, output: process.stdout });

      const ask = (q: string): Promise<string> => new Promise(resolve => rl.question(q, resolve));

      let accepted = 0;
      let rejected = 0;

      try {
        for (const line of lines) {
          const cells = line.split('|').map(c => c.trim()).filter(Boolean);
          if (cells.length < 3) continue;

          const fromId = cells[0]!;
          const toId = cells[1]!;
          const relType = cells[2]!;
          const answer = await ask(`  ${fromId} → ${toId} [${relType}] — Accept? (y/n/q): `);

          if (answer.toLowerCase() === 'q') break;
          if (answer.toLowerCase() === 'y') {
            store.insertRelation(fromId, toId, relType as EntryRelation['rel_type']);
            accepted++;
          } else {
            rejected++;
          }
        }

        print(`\n  Review complete: ${accepted} accepted, ${rejected} rejected.`);
      } finally {
        rl.close();
        store.close();
      }
    });
}
