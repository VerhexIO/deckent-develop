import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import type { Command } from 'commander';

import {
  discoverSprintArchiveIds,
  reconcileSprintArchive,
  resolveSprintArchiveDir,
  sealSprintArchiveTerminal,
  verifySprintArchive,
  verifySprintArchiveTerminal,
  type SprintArchiveReconcileReport,
} from '../../core/sprint-archive.js';
import { DeckentError } from '../../core/errors.js';
import type { SprintTerminalReceiptV1 } from '../../core/sprint-terminal-publication.js';
import { loadConfig } from '../../core/config.js';
import { getLangFromConfig } from '../helpers/config-reader.js';
import { getLanguage, getMessage } from '../helpers/messages.js';
import { memoryCatalogMessage } from '../helpers/message-catalog/cli-memory-catalog.js';
import { print, printError } from '../helpers/output.js';
import { resolveProjectRoot } from '../helpers/process.js';
import { buildMemoryExportLabels } from '../../core/memory-export-labels.js';

interface ArchiveSelectionOptions {
  readonly sprint?: string;
  readonly all?: boolean;
  readonly json?: boolean;
}

interface ArchiveReconcileOptions extends ArchiveSelectionOptions {
  readonly apply?: boolean;
  readonly retireLegacy?: boolean;
}

interface ArchiveTerminalOptions {
  readonly sprint?: string;
  readonly hotJournal?: string;
  readonly receipt?: string;
  readonly finalSequence?: string;
  readonly finalDigest?: string;
  readonly expectedArchiveDigest?: string;
  readonly expectedHotDigest?: string;
  readonly reason?: string;
  readonly json?: boolean;
}

interface TerminalPreflight {
  readonly sprintId: string;
  readonly archivedJournalPath: string;
  readonly hotJournalPath: string;
  readonly archivedDigest: string | null;
  readonly hotDigest: string | null;
  readonly strictPrefix: boolean;
  readonly byteIdentical: boolean;
}

type TerminalMutationStatus = 'not_attempted' | 'durable_state_may_exist';
type TerminalSealState = 'not_attempted' | 'unknown' | 'incomplete' | 'complete';
type TerminalVerificationState = 'not_attempted' | 'unknown' | 'passed' | 'failed';

interface TerminalFailureEnvelope {
  readonly operation: string;
  readonly ok: false;
  readonly code: string;
  readonly reason: string;
  readonly mutationStatus: TerminalMutationStatus;
  readonly sealState: TerminalSealState;
  readonly applicationState: string;
  readonly verification: { readonly state: TerminalVerificationState; readonly result: unknown | null };
  readonly retryGuidance: string;
  readonly verifyCommand: string | null;
  readonly coreResult: unknown | null;
}

/** Mutable only for hermetic CLI failure-stage tests; production uses core implementations. */
export const archiveTerminalOperations = {
  seal: sealSprintArchiveTerminal,
  verify: verifySprintArchiveTerminal,
};

const SHA256 = /^[a-f0-9]{64}$/u;

function fileDigest(path: string): string | null {
  try { return createHash('sha256').update(readFileSync(path)).digest('hex'); } catch { return null; }
}

/** Read-only terminal parity capture. Exported as a pure CLI seam for hermetic tests. */
export function inspectArchiveTerminalParity(root: string, sprintId: string, hotJournalPath?: string): TerminalPreflight {
  const canonicalHot = resolve(root, '.deckent', 'recently-works', `${sprintId}-events.jsonl`);
  const hot = resolve(hotJournalPath ?? canonicalHot);
  if (hot !== canonicalHot) {
    throw new DeckentError(
      'E_ARCHIVE_TERMINAL_HOT_JOURNAL_NOT_CANONICAL',
      'ARCHIVE_TERMINAL_HOT_JOURNAL_NOT_CANONICAL',
    );
  }
  const archived = join(resolveSprintArchiveDir(root, sprintId), `${sprintId}-events.jsonl`);
  let hotBytes: Buffer | null = null;
  let archivedBytes: Buffer | null = null;
  try { hotBytes = readFileSync(hot); } catch { /* represented by a null digest */ }
  try { archivedBytes = readFileSync(archived); } catch { /* represented by a null digest */ }
  const byteIdentical = hotBytes !== null && archivedBytes !== null && hotBytes.equals(archivedBytes);
  const strictPrefix = hotBytes !== null && archivedBytes !== null
    && archivedBytes.length < hotBytes.length && hotBytes.subarray(0, archivedBytes.length).equals(archivedBytes);
  return { sprintId, archivedJournalPath: archived, hotJournalPath: hot,
    archivedDigest: fileDigest(archived), hotDigest: fileDigest(hot), strictPrefix, byteIdentical };
}

function parseTerminalReceipt(path: string): SprintTerminalReceiptV1 {
  let persisted: unknown;
  try {
    persisted = JSON.parse(readFileSync(path, 'utf8')) as unknown;
  } catch {
    throw new DeckentError('E_ARCHIVE_TERMINAL_RECEIPT_INVALID', 'ARCHIVE_TERMINAL_RECEIPT_INVALID');
  }
  if (!persisted || typeof persisted !== 'object' || Array.isArray(persisted)) {
    throw new DeckentError('E_ARCHIVE_TERMINAL_RECEIPT_INVALID', 'ARCHIVE_TERMINAL_RECEIPT_INVALID');
  }
  const wrapper = persisted as { readonly receipt?: unknown };
  const value = wrapper.receipt ?? persisted;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new DeckentError('E_ARCHIVE_TERMINAL_RECEIPT_INVALID', 'ARCHIVE_TERMINAL_RECEIPT_INVALID');
  }
  const receipt = value as Partial<SprintTerminalReceiptV1>;
  if (receipt.version !== 1 || typeof receipt.sprintId !== 'string' || receipt.sprintId.length === 0
      || typeof receipt.runId !== 'string' || receipt.runId.length === 0
      || !Number.isSafeInteger(receipt.coordinatorGeneration) || (receipt.coordinatorGeneration ?? 0) < 1
      || (receipt.terminalOutcome !== 'COMPLETE' && receipt.terminalOutcome !== 'ABORTED')
      || typeof receipt.logicalSettlementDigest !== 'string' || !SHA256.test(receipt.logicalSettlementDigest)
      || !Number.isSafeInteger(receipt.priorAuthorityVersion) || (receipt.priorAuthorityVersion ?? -1) < 0
      || !Number.isSafeInteger(receipt.authorityVersion) || (receipt.authorityVersion ?? -1) < 0) {
    throw new DeckentError('E_ARCHIVE_TERMINAL_RECEIPT_INVALID', 'ARCHIVE_TERMINAL_RECEIPT_INVALID');
  }
  return receipt as SprintTerminalReceiptV1;
}

function exactCanonicalReceiptPath(root: string, sprintId: string, supplied: string | undefined): string {
  const canonical = resolve(root, '.deckent', 'recently-works', `${sprintId}-terminal-receipt.json`);
  if (!supplied || resolve(supplied) !== canonical) {
    throw new DeckentError(
      'E_ARCHIVE_TERMINAL_RECEIPT_PATH_NOT_CANONICAL',
      'ARCHIVE_TERMINAL_RECEIPT_PATH_NOT_CANONICAL',
    );
  }
  return canonical;
}

function exactTerminalSprint(options: ArchiveTerminalOptions): string {
  if (!options.sprint) {
    throw new DeckentError(
      'E_ARCHIVE_TERMINAL_EXACT_SPRINT_REQUIRED',
      'ARCHIVE_TERMINAL_EXACT_SPRINT_REQUIRED',
    );
  }
  return options.sprint;
}

function printTerminalPreflight(report: TerminalPreflight, lang: string): void {
  print(getMessage('archive.terminal.inspect_report', lang, {
    sprintId: report.sprintId,
    archivedDigest: report.archivedDigest ?? getMessage('archive.value.missing', lang),
    hotDigest: report.hotDigest ?? getMessage('archive.value.missing', lang),
    relation: report.byteIdentical ? getMessage('archive.terminal.relation.identical', lang)
      : report.strictPrefix ? getMessage('archive.terminal.relation.strict_prefix', lang)
        : getMessage('archive.terminal.relation.unproven', lang),
  }));
}

function terminalErrorCode(error: unknown): string {
  return error instanceof DeckentError && /^E_ARCHIVE_TERMINAL_[A-Z_]+$/u.test(error.code)
    ? error.code
    : 'E_ARCHIVE_TERMINAL_OPERATION_FAILED';
}

function terminalFailureEnvelope(
  error: unknown, operation: string, coreInvocationAttempted: boolean, coreResult: unknown,
  verificationResult: unknown, sprintId?: string, hotJournalPath?: string,
): TerminalFailureEnvelope {
  const core = coreResult !== null && typeof coreResult === 'object' ? coreResult as Record<string, unknown> : null;
  const terminalComplete = core?.['terminalComplete'];
  const application = core?.['applicationReceipt'];
  const applicationState = application !== null && typeof application === 'object'
    && typeof (application as Record<string, unknown>)['state'] === 'string'
    ? (application as Record<string, unknown>)['state'] as string
    : coreInvocationAttempted ? 'unknown' : 'not_attempted';
  const verification = verificationResult !== null && typeof verificationResult === 'object'
    ? verificationResult as Record<string, unknown> : null;
  const verificationState: TerminalVerificationState = verification === null ? 'not_attempted'
    : verification['ok'] === true ? 'passed' : verification['ok'] === false ? 'failed' : 'unknown';
  return {
    operation, ok: false, code: terminalErrorCode(error),
    reason: error instanceof Error ? error.message : String(error),
    mutationStatus: coreInvocationAttempted ? 'durable_state_may_exist' : 'not_attempted',
    sealState: !coreInvocationAttempted ? 'not_attempted'
      : terminalComplete === true ? 'complete' : terminalComplete === false ? 'incomplete' : 'unknown',
    applicationState,
    verification: { state: verificationState, result: verificationResult },
    retryGuidance: coreInvocationAttempted
      ? 'Replay the original terminal-repair request unchanged, including the original --expected-archive-digest and --expected-hot-digest values; do not substitute current digests.'
      : 'Correct the typed failure and retry the same terminal operation; terminal-repair preflight requires the original archive-or-hot preimage digest.',
    verifyCommand: sprintId && hotJournalPath
      ? `deckent archive terminal-verify --sprint ${sprintId} --hot-journal ${hotJournalPath} --json` : null,
    coreResult,
  };
}

function terminalError(
  error: unknown, lang: string, json = false, operation = 'archive.terminal',
  coreInvocationAttempted = false, coreResult: unknown = null, verificationResult: unknown = null,
  sprintId?: string, hotJournalPath?: string,
): void {
  if (json) print(JSON.stringify(terminalFailureEnvelope(
    error, operation, coreInvocationAttempted, coreResult, verificationResult, sprintId, hotJournalPath,
  ), null, 2));
  else printError(getMessage('archive.error.terminal_failed', lang, { code: terminalErrorCode(error) }));
  process.exitCode = 1;
}

function selectedSprintIds(root: string, options: ArchiveSelectionOptions): readonly string[] {
  if (options.sprint && options.all) {
    throw new DeckentError('E_ARCHIVE_SELECTION_CONFLICT', 'ARCHIVE_SELECTION_CONFLICT');
  }
  if (options.sprint) return [options.sprint];
  if (options.all) return discoverSprintArchiveIds(root);
  throw new DeckentError('E_ARCHIVE_SELECTION_REQUIRED', 'ARCHIVE_SELECTION_REQUIRED');
}

function printReconcileReport(
  report: SprintArchiveReconcileReport,
  lang: string,
): void {
  print(getMessage('archive.report', lang, {
    sprintId: report.sprintId,
    mode: report.applied ? getMessage('archive.mode.apply', lang) : getMessage('archive.mode.dry_run', lang),
    artifacts: String(report.manifest.artifactCount),
    bytes: String(report.manifest.totalBytes),
    published: String(report.published),
    deduplicated: String(report.deduplicated),
    retired: String(report.retired),
    conflicts: String(report.conflicts),
    failures: String(report.failures.length),
  }));
}

function reportSelectionError(error: unknown, lang: string): void {
  const code = error instanceof Error ? error.message : String(error);
  const key = code === 'ARCHIVE_SELECTION_CONFLICT'
    ? 'archive.error.selection_conflict'
    : 'archive.error.selection_required';
  printError(getMessage(key, lang));
  process.exitCode = 2;
}

export function registerArchive(program: Command): void {
  const archive = program
    .command('archive')
    .description(getMessage('archive.description', getLangFromConfig(resolveProjectRoot())));

  // Read vs mutation is a PATH-level fact here — state it on the parent path.
  archive.addHelpText('after', memoryCatalogMessage('cli.memcat.archive.help.paths', getLangFromConfig(resolveProjectRoot())));

  archive
    .command('inspect')
    .description(getMessage('archive.inspect.description', getLangFromConfig(resolveProjectRoot())))
    .option('--sprint <id>', getMessage('archive.option.sprint', getLangFromConfig(resolveProjectRoot())))
    .option('--all', getMessage('archive.option.all', getLangFromConfig(resolveProjectRoot())))
    .option('--json', getMessage('archive.option.json', getLangFromConfig(resolveProjectRoot())))
    .action((options: ArchiveSelectionOptions) => {
      const root = resolveProjectRoot();
      const lang = getLangFromConfig(root);
      try {
        const reports = selectedSprintIds(root, options)
          .map(sprintId => reconcileSprintArchive(root, sprintId));
        if (options.json) print(JSON.stringify(reports, null, 2));
        else reports.forEach(report => printReconcileReport(report, lang));
      } catch (error) {
        reportSelectionError(error, lang);
      }
    });

  archive
    .command('reconcile')
    .description(getMessage('archive.reconcile.description', getLangFromConfig(resolveProjectRoot())))
    .option('--sprint <id>', getMessage('archive.option.sprint', getLangFromConfig(resolveProjectRoot())))
    .option('--all', getMessage('archive.option.all', getLangFromConfig(resolveProjectRoot())))
    .option('--apply', getMessage('archive.option.apply', getLangFromConfig(resolveProjectRoot())))
    .option('--retire-legacy', getMessage('archive.option.retire_legacy', getLangFromConfig(resolveProjectRoot())))
    .option('--json', getMessage('archive.option.json', getLangFromConfig(resolveProjectRoot())))
    .action((options: ArchiveReconcileOptions) => {
      const root = resolveProjectRoot();
      const lang = getLangFromConfig(root);
      if (options.retireLegacy && !options.apply) {
        printError(getMessage('archive.error.retire_requires_apply', lang));
        process.exitCode = 2;
        return;
      }
      try {
        const reports = selectedSprintIds(root, options).map(sprintId => reconcileSprintArchive(
          root,
          sprintId,
          {
            apply: options.apply === true,
            retireLegacySources: options.retireLegacy === true,
            indexMemory: options.apply === true,
          },
        ));
        if (options.json) print(JSON.stringify(reports, null, 2));
        else reports.forEach(report => printReconcileReport(report, lang));
        if (reports.some(report => report.failures.length > 0)) process.exitCode = 1;
      } catch (error) {
        if (error instanceof Error && error.message.startsWith('ARCHIVE_SELECTION_')) {
          reportSelectionError(error, lang);
          return;
        }
        printError(getMessage('archive.error.reconcile_failed', lang, {
          error: error instanceof Error ? error.message : String(error),
        }));
        process.exitCode = 1;
      }
    });

  archive
    .command('verify')
    .description(getMessage('archive.verify.description', getLangFromConfig(resolveProjectRoot())))
    .option('--sprint <id>', getMessage('archive.option.sprint', getLangFromConfig(resolveProjectRoot())))
    .option('--all', getMessage('archive.option.all', getLangFromConfig(resolveProjectRoot())))
    .option('--json', getMessage('archive.option.json', getLangFromConfig(resolveProjectRoot())))
    .action((options: ArchiveSelectionOptions) => {
      const root = resolveProjectRoot();
      const lang = getLangFromConfig(root);
      try {
        const reports = selectedSprintIds(root, options)
          .map(sprintId => verifySprintArchive(root, sprintId));
        if (options.json) print(JSON.stringify(reports, null, 2));
        else for (const report of reports) {
          print(getMessage(report.ok ? 'archive.verify.ok' : 'archive.verify.failed', lang, {
            sprintId: report.sprintId,
            checked: String(report.checked),
            missing: String(report.missing.length),
            mismatched: String(report.mismatched.length),
            untracked: String(report.untracked.length),
          }));
        }
        if (reports.some(report => !report.ok)) process.exitCode = 1;
      } catch (error) {
        reportSelectionError(error, lang);
      }
    });

  archive
    .command('terminal-inspect')
    .description(getMessage('archive.terminal.inspect.description', getLangFromConfig(resolveProjectRoot())))
    .requiredOption('--sprint <id>', getMessage('archive.option.exact_sprint', getLangFromConfig(resolveProjectRoot())))
    .option('--hot-journal <path>', getMessage('archive.option.hot_journal', getLangFromConfig(resolveProjectRoot())))
    .option('--json', getMessage('archive.option.json', getLangFromConfig(resolveProjectRoot())))
    .action((options: ArchiveTerminalOptions) => {
      const root = resolveProjectRoot(); const lang = getLangFromConfig(root);
      try {
        const report = inspectArchiveTerminalParity(root, exactTerminalSprint(options), options.hotJournal);
        if (options.json) print(JSON.stringify(report, null, 2)); else printTerminalPreflight(report, lang);
      } catch (error) { terminalError(error, lang, options.json, 'archive.terminal-inspect', false, null, null, options.sprint, options.hotJournal); }
    });

  archive
    .command('terminal-verify')
    .description(getMessage('archive.terminal.verify.description', getLangFromConfig(resolveProjectRoot())))
    .requiredOption('--sprint <id>', getMessage('archive.option.exact_sprint', getLangFromConfig(resolveProjectRoot())))
    .option('--hot-journal <path>', getMessage('archive.option.hot_journal', getLangFromConfig(resolveProjectRoot())))
    .option('--json', getMessage('archive.option.json', getLangFromConfig(resolveProjectRoot())))
    .action((options: ArchiveTerminalOptions) => {
      const root = resolveProjectRoot(); const lang = getLangFromConfig(root);
      try {
        const report = archiveTerminalOperations.verify(root, exactTerminalSprint(options), options.hotJournal);
        if (options.json) print(JSON.stringify(report, null, 2));
        else print(getMessage(report.ok ? 'archive.terminal.verify_ok' : 'archive.terminal.verify_failed', lang, {
          sprintId: report.sprintId,
          manifestDigest: report.manifestDigest ?? getMessage('archive.value.missing', lang),
          reasons: report.reasonCodes.join(',') || getMessage('archive.value.none', lang),
        }));
        if (!report.ok) process.exitCode = 1;
      } catch (error) { terminalError(error, lang, options.json, 'archive.terminal-verify', false, null, null, options.sprint, options.hotJournal); }
    });

  archive
    .command('terminal-repair')
    .description(getMessage('archive.terminal.repair.description', getLangFromConfig(resolveProjectRoot())))
    .requiredOption('--sprint <id>', getMessage('archive.option.exact_sprint', getLangFromConfig(resolveProjectRoot())))
    .requiredOption('--hot-journal <path>', getMessage('archive.option.hot_journal', getLangFromConfig(resolveProjectRoot())))
    .requiredOption('--receipt <path>', getMessage('archive.option.receipt', getLangFromConfig(resolveProjectRoot())))
    .requiredOption('--final-sequence <n>', getMessage('archive.option.final_sequence', getLangFromConfig(resolveProjectRoot())))
    .requiredOption('--final-digest <sha256>', getMessage('archive.option.final_digest', getLangFromConfig(resolveProjectRoot())))
    .requiredOption('--expected-archive-digest <sha256>', getMessage('archive.option.expected_archive_digest', getLangFromConfig(resolveProjectRoot())))
    .requiredOption('--expected-hot-digest <sha256>', getMessage('archive.option.expected_hot_digest', getLangFromConfig(resolveProjectRoot())))
    .requiredOption('--reason <text>', getMessage('archive.option.reason', getLangFromConfig(resolveProjectRoot())))
    .option('--json', getMessage('archive.option.json', getLangFromConfig(resolveProjectRoot())))
    .action(async (options: ArchiveTerminalOptions) => {
      const root = resolveProjectRoot(); let lang = getLangFromConfig(root);
      let coreInvocationAttempted = false;
      let coreResult: unknown = null;
      let verificationResult: unknown = null;
      let sprintId: string | undefined;
      let hotJournalPath: string | undefined;
      try {
        const config = await loadConfig(root);
        lang = getLanguage(config.language);
        sprintId = exactTerminalSprint(options); const reason = options.reason?.trim() ?? '';
        const sequence = Number(options.finalSequence);
        if (!reason) {
          throw new DeckentError('E_ARCHIVE_TERMINAL_REASON_REQUIRED', 'ARCHIVE_TERMINAL_REASON_REQUIRED');
        }
        if (!Number.isSafeInteger(sequence) || sequence < 1 || !SHA256.test(options.finalDigest ?? '')) {
          throw new DeckentError('E_ARCHIVE_TERMINAL_EVENT_INVALID', 'ARCHIVE_TERMINAL_EVENT_INVALID');
        }
        if (!SHA256.test(options.expectedArchiveDigest ?? '') || !SHA256.test(options.expectedHotDigest ?? '')) {
          throw new DeckentError('E_ARCHIVE_TERMINAL_DIGEST_INVALID', 'ARCHIVE_TERMINAL_DIGEST_INVALID');
        }
        const receiptPath = exactCanonicalReceiptPath(root, sprintId, options.receipt);
        const receipt = parseTerminalReceipt(receiptPath);
        if (receipt.sprintId !== sprintId) {
          throw new DeckentError(
            'E_ARCHIVE_TERMINAL_RECEIPT_IDENTITY_MISMATCH',
            'ARCHIVE_TERMINAL_RECEIPT_IDENTITY_MISMATCH',
          );
        }
        const preflight = inspectArchiveTerminalParity(root, sprintId, options.hotJournal);
        hotJournalPath = preflight.hotJournalPath;
        const archivedPreimageMatches = preflight.archivedDigest === options.expectedArchiveDigest
          || preflight.archivedDigest === options.expectedHotDigest;
        if (!archivedPreimageMatches || preflight.hotDigest !== options.expectedHotDigest) {
          throw new DeckentError('E_ARCHIVE_TERMINAL_PREIMAGE_MISMATCH', 'ARCHIVE_TERMINAL_PREIMAGE_MISMATCH');
        }
        coreInvocationAttempted = true;
        const result = archiveTerminalOperations.seal(root, sprintId, {
          receipt,
          finalEvent: { sequence, digest: options.finalDigest ?? '' },
          hotJournalPath: preflight.hotJournalPath,
          expectedArchivedPreimageSha256: options.expectedArchiveDigest ?? '',
          expectedHotJournalSha256: options.expectedHotDigest ?? '',
          operatorReason: reason,
          adoptBrain: true,
        }, {
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
        coreResult = result;
        if (!result.terminalComplete || !result.receipt || result.applicationReceipt?.state !== 'applied') {
          throw new DeckentError(
            'E_ARCHIVE_TERMINAL_HOLD',
            `ARCHIVE_TERMINAL_HOLD:${result.reasonCode ?? 'unknown'}`,
          );
        }
        const verified = archiveTerminalOperations.verify(root, sprintId, preflight.hotJournalPath);
        verificationResult = verified;
        if (!verified.ok || result.receipt.archivedJournalSha256 !== options.expectedHotDigest) {
          throw new DeckentError(
            'E_ARCHIVE_TERMINAL_POST_APPLY_PARITY_FAILED',
            'ARCHIVE_TERMINAL_POST_APPLY_PARITY_FAILED',
          );
        }
        const manifestDigest = result.applicationReceipt.manifestDigest ?? '';
        const report = { ...result, verification: verified };
        if (options.json) print(JSON.stringify(report, null, 2));
        else print(getMessage('archive.terminal.repair_ok', lang, { sprintId, disposition: result.disposition,
          digest: result.receipt.archivedJournalSha256, manifestDigest,
          brainIndexDigest: result.applicationReceipt.brainIndexSha256 ?? getMessage('archive.value.missing', lang),
          guardedSummaryDigest: result.applicationReceipt.guardedSummarySha256 ?? getMessage('archive.value.missing', lang),
        }));
      } catch (error) {
        terminalError(error, lang, options.json, 'archive.terminal-repair', coreInvocationAttempted,
          coreResult, verificationResult, sprintId, hotJournalPath);
      }
    });
}
