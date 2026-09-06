/**
 * memory-export.ts — Generate .md snapshots from the SQLite DB.
 *
 * Four export functions produce markdown strings for git tracking
 * and human review. Each takes a MemoryStore instance and returns
 * a markdown string.
 *
 * Also exports `exportAdrsToFs` for DB→FS reverse sync (Sprint 169 H1,
 * DB-authority projection contract per ADR-G-035.
 *
 * `writeGuardedExports` (Sprint 227 task 227-002) is the sanity-checked
 * writer: it refuses to overwrite an existing .md with an empty render
 * when the DB still contains entries of the corresponding type. This
 * blocks the catastrophic wipe path observed in sprint-226 (decisions.md
 * 8518→2 lines while the DB held 75 ADRs).
 */

import { mkdirSync, existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import type { MemoryStore } from './memory-store.js';
import type { EntryHistoryRecord, EntryRelation, MemoryEntryV2, EntryType } from './memory-types.js';
import { DeckentError } from './errors.js';
import { parseSprintOrdinal } from './utils.js';
import type { MemoryExportLabels } from './memory-export-labels.js';
import { writeOperationFileAtomic } from './operation-file-authority.js';
import {
  ConfigWriteLockTimeoutError,
  withConfigWriteLock,
} from './config-write-authority.js';

// ─── Helpers ─────────────────────────────────────────────────────────

function isoDate(): string {
  return new Date().toISOString().split('T')[0]!;
}

export interface MemoryExportRenderOptions {
  readonly labels?: MemoryExportLabels;
  /** Human-view target. Source records remain complete in memory-details.md. */
  readonly maxInlineLines?: number;
  /** Human memory-view byte target. Required ID indexes remain complete. */
  readonly maxInlineBytes?: number;
  /** Summary-only additional inline context; zero selects an index-only view. */
  readonly summaryInlineLines?: number;
  /** Summary-only inline context byte target. */
  readonly summaryInlineBytes?: number;
}

const DEFAULT_MAX_INLINE_LINES = 3_000;
const DEFAULT_MAX_INLINE_BYTES = 256 * 1_024;
const DEFAULT_SUMMARY_INLINE_LINES = 200;
const DEFAULT_SUMMARY_INLINE_BYTES = 16 * 1_024;
const MEMORY_DETAILS_FILE = 'memory-details.md';

interface RenderedExport {
  readonly content: string;
  readonly renderedEntryCount: number;
}

interface LearningDetails {
  readonly tags: readonly string[];
  readonly relations: readonly EntryRelation[];
  readonly history: readonly EntryHistoryRecord[];
}

interface MemoryExportRenderContext {
  readonly learningDetails: Map<string, LearningDetails>;
}

function createRenderContext(): MemoryExportRenderContext {
  return { learningDetails: new Map() };
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function formatLabel(template: string, vars: Readonly<Record<string, string>>): string {
  return template.replace(/\{([a-zA-Z][a-zA-Z0-9]*)\}/gu, (token, key: string) => vars[key] ?? token);
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => compareCodeUnits(left, right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function codeFenceFor(content: string): string {
  const longest = Math.max(0, ...[...content.matchAll(/`+/gu)].map(match => match[0].length));
  return '`'.repeat(Math.max(3, longest + 1));
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .replace(/"/gu, '&quot;')
    .replace(/'/gu, '&#39;');
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function memoryDetailAnchor(id: string): string {
  return `memory-entry-${sha256(id)}`;
}

function lineCount(lines: readonly string[]): number {
  return lines.reduce((total, line) => total + line.split('\n').length, 0);
}

function byteLength(lines: readonly string[]): number {
  return Buffer.byteLength(lines.join('\n'), 'utf8');
}

function maxInlineLines(opts: MemoryExportRenderOptions): number {
  const value = opts.maxInlineLines ?? DEFAULT_MAX_INLINE_LINES;
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new DeckentError('MEMORY_EXPORT_RENDER_HOLD', 'max-inline-lines-invalid');
  }
  return value;
}

function maxInlineBytes(opts: MemoryExportRenderOptions): number {
  const value = opts.maxInlineBytes ?? DEFAULT_MAX_INLINE_BYTES;
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new DeckentError('MEMORY_EXPORT_RENDER_HOLD', 'max-inline-bytes-invalid');
  }
  return value;
}

function summaryInlineLines(opts: MemoryExportRenderOptions): number {
  const value = opts.summaryInlineLines ?? DEFAULT_SUMMARY_INLINE_LINES;
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new DeckentError('MEMORY_EXPORT_RENDER_HOLD', 'summary-inline-lines-invalid');
  }
  return value;
}

function summaryInlineBytes(opts: MemoryExportRenderOptions): number {
  const value = opts.summaryInlineBytes ?? DEFAULT_SUMMARY_INLINE_BYTES;
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new DeckentError('MEMORY_EXPORT_RENDER_HOLD', 'summary-inline-bytes-invalid');
  }
  return value;
}

function exportMetadata(kind: string, entryType: EntryType, entryCount: number): string {
  return `<!-- deckent-memory-export:v2 kind=${kind} entry-type=${entryType} entry-count=${entryCount} -->`;
}

/** Locale-independent total order. Canonical IDs are zero-padded at their numeric boundary. */
function sortById(a: MemoryEntryV2, b: MemoryEntryV2): number {
  return compareCodeUnits(a.id, b.id);
}

function learningOrder(a: MemoryEntryV2, b: MemoryEntryV2): number {
  const ao = parseSprintOrdinal(a.sprint_id);
  const bo = parseSprintOrdinal(b.sprint_id);
  if (ao !== null && bo !== null) {
    if (ao !== bo) return bo - ao;
    return sortById(a, b);
  }
  if (ao !== null) return -1;
  if (bo !== null) return 1;
  if (a.sprint_id === null && b.sprint_id !== null) return 1;
  if (a.sprint_id !== null && b.sprint_id === null) return -1;
  const updated = compareCodeUnits(b.updated_at, a.updated_at);
  if (updated !== 0) return updated;
  return sortById(a, b);
}

function readLearningDetails(
  store: MemoryStore,
  mem: MemoryEntryV2,
  context: MemoryExportRenderContext,
): LearningDetails {
  const cached = context.learningDetails.get(mem.id);
  if (cached !== undefined) return cached;
  const details = {
    tags: [...store.getTagsForEntry(mem.id)].sort(compareCodeUnits),
    relations: [...store.getRelations(mem.id)]
      .sort((left, right) => compareCodeUnits(canonicalJson(left), canonicalJson(right))),
    history: [...store.getHistory(mem.id)]
      .sort((left, right) => left.id - right.id || compareCodeUnits(canonicalJson(left), canonicalJson(right))),
  };
  context.learningDetails.set(mem.id, details);
  return details;
}

function renderLearningLines(
  store: MemoryStore,
  mem: MemoryEntryV2,
  labels: MemoryExportLabels,
  context: MemoryExportRenderContext,
): string[] {
  const { tags, relations, history } = readLearningDetails(store, mem, context);
  const { content: _content, ...sourceRecord } = mem;
  const record = canonicalJson({
    ...sourceRecord,
    content_byte_length: Buffer.byteLength(mem.content, 'utf8'),
    content_sha256: sha256(mem.content),
    history,
    relations,
    tags,
  });
  const metadataFence = codeFenceFor(record);
  const contentFence = codeFenceFor(mem.content);
  return [
    `<a id="${memoryDetailAnchor(mem.id)}"></a>`,
    `#### ${escapeHtml(labels.details)} — ${escapeHtml(mem.id)} · ${escapeHtml(mem.title)}`,
    `${metadataFence}json`,
    record,
    metadataFence,
    `${contentFence}text`,
    mem.content,
    contentFence,
  ];
}

function renderLearningLink(mem: MemoryEntryV2, labels: MemoryExportLabels): string {
  return `- <a href="./${MEMORY_DETAILS_FILE}#${memoryDetailAnchor(mem.id)}">${escapeHtml(mem.id)} · ${escapeHtml(mem.title)}</a> — ${escapeHtml(labels.fullDetails)}`;
}

function renderMemoryIndexLink(labels: MemoryExportLabels, anchor = 'memory-index'): string {
  return `- <a href="./memory.md#${anchor}">${escapeHtml(labels.memoryIndex)}</a>`;
}

function renderInlineLearningLines(mem: MemoryEntryV2, labels: MemoryExportLabels): string[] {
  const contentFence = codeFenceFor(mem.content);
  return [
    `#### ${escapeHtml(mem.id)} · ${escapeHtml(mem.title)}`,
    `**${escapeHtml(labels.sprintId)}:** ${mem.sprint_id === null ? 'null' : escapeHtml(mem.sprint_id)}`,
    `${contentFence}text`,
    mem.content,
    contentFence,
    renderLearningLink(mem, labels),
  ];
}

function learningGroups(memories: readonly MemoryEntryV2[]): {
  ordinalGroups: Map<string, MemoryEntryV2[]>;
  legacy: MemoryEntryV2[];
  unattributed: MemoryEntryV2[];
} {
  const ordinalGroups = new Map<string, MemoryEntryV2[]>();
  const legacy: MemoryEntryV2[] = [];
  const unattributed: MemoryEntryV2[] = [];
  for (const memory of memories) {
    if (memory.sprint_id === null) {
      unattributed.push(memory);
    } else if (parseSprintOrdinal(memory.sprint_id) === null) {
      legacy.push(memory);
    } else {
      const entries = ordinalGroups.get(memory.sprint_id) ?? [];
      entries.push(memory);
      ordinalGroups.set(memory.sprint_id, entries);
    }
  }
  return { ordinalGroups, legacy, unattributed };
}

function renderBoundedLearningGroups(
  memories: readonly MemoryEntryV2[],
  labels: MemoryExportLabels,
  headingPrefix: '##' | '###',
  availableLines: number,
  availableBytes: number,
  inlineAdditionalLineLimit = Number.POSITIVE_INFINITY,
  inlineAdditionalByteLimit = Number.POSITIVE_INFINITY,
  maxInlineEntries = Number.POSITIVE_INFINITY,
): string[] {
  const { ordinalGroups, legacy, unattributed } = learningGroups(memories);
  const grouped: Array<{ anchor: string; heading: string; entries: MemoryEntryV2[] }> = [
    ...[...ordinalGroups.entries()].map(([sprintId, entries]) => ({
      anchor: `memory-group-${sha256(sprintId)}`,
      heading: formatLabel(labels.sprintLearningHeading, { sprintId }), entries,
    })),
    ...(legacy.length > 0 ? [{
      anchor: 'memory-group-legacy-epoch', heading: labels.legacyEpochLearnings, entries: legacy,
    }] : []),
    ...(unattributed.length > 0 ? [{
      anchor: 'memory-group-unattributed', heading: labels.unattributedLearnings, entries: unattributed,
    }] : []),
  ];
  const skeleton = grouped.flatMap(group => [
    `<a id="${group.anchor}"></a>`,
    `${headingPrefix} ${group.heading}`,
    ...group.entries.map(memory => renderLearningLink(memory, labels)),
  ]);
  let remainingInlineLines = Math.max(
    0,
    Math.min(availableLines - lineCount(skeleton), inlineAdditionalLineLimit),
  );
  let remainingInlineBytes = Math.max(
    0,
    Math.min(availableBytes - byteLength(skeleton), inlineAdditionalByteLimit),
  );
  let inlineEntries = 0;
  const lines: string[] = [];
  for (const group of grouped) {
    lines.push(`<a id="${group.anchor}"></a>`);
    lines.push(`${headingPrefix} ${group.heading}`);
    for (const memory of group.entries) {
      const inlineLines = renderInlineLearningLines(memory, labels);
      const additionalLines = lineCount(inlineLines) - 1;
      const additionalBytes = byteLength(inlineLines) - byteLength([renderLearningLink(memory, labels)]);
      if (
        inlineEntries < maxInlineEntries
        && additionalLines <= remainingInlineLines
        && additionalBytes <= remainingInlineBytes
      ) {
        lines.push(...inlineLines);
        remainingInlineLines -= additionalLines;
        remainingInlineBytes -= additionalBytes;
        inlineEntries++;
      } else {
        lines.push(renderLearningLink(memory, labels));
      }
    }
  }
  return lines;
}

function normalizeAdrProjectionSections(content: string): string {
  return content
    .replace(
      /^(CONTEXT|DECISION|CONSEQUENCES?|ROLLOUT|ACCEPTANCE)$/gmu,
      (_match, section: string) =>
        `## ${section.charAt(0)}${section.slice(1).toLowerCase()}`,
    )
    .replace(/^Decision:\s*/gimu, '**Decision:** ');
}

// ─── exportSummaryMd ────────────────────────────────────────────────

function truncateLegacy(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return `${text.slice(0, maxLen - 3)}...`;
}

function renderLegacySummary(store: MemoryStore): RenderedExport {
  const lines: string[] = [];
  lines.push('# Brain Summary (auto-generated)');
  lines.push('');
  const adrs = store.getByType('adr').sort(sortById);
  lines.push('## Active Architecture Decisions');
  if (adrs.length > 0) {
    lines.push('| ID | Title | Status |');
    lines.push('|-----|-------|--------|');
    for (const adr of adrs) {
      lines.push(`| ${adr.id} | ${adr.title} | ${adr.status} |`);
    }
  } else {
    lines.push('_No architecture decisions recorded._');
  }
  lines.push('');
  const memories = store.getByType('memory');
  lines.push('## Recent Learnings');
  if (memories.length > 0) {
    for (const mem of memories.slice(0, 10)) {
      const sprintLabel = mem.sprint_id ? ` (${mem.sprint_id})` : '';
      lines.push(`- **${mem.title}**${sprintLabel}: ${truncateLegacy(mem.content, 120)}`);
    }
  } else {
    lines.push('_No learnings recorded._');
  }
  lines.push('');
  const debts = store.getByType('debt').filter(d => d.status !== 'resolved');
  lines.push('## Active Technical Debt');
  if (debts.length > 0) {
    for (const d of debts) {
      lines.push(`- [${d.priority.toUpperCase()}] ${d.title}`);
    }
  } else {
    lines.push('_No active technical debt._');
  }
  lines.push('');
  const patterns = store.getByType('pattern').filter(p => p.status === 'active');
  lines.push('## Active Patterns');
  if (patterns.length > 0) {
    const counts = new Map<string, number>();
    for (const p of patterns) {
      counts.set(p.title, (counts.get(p.title) ?? 0) + 1);
    }
    for (const [title, count] of [...counts.entries()].sort((a, b) => b[1] - a[1])) {
      lines.push(count > 1 ? `- ${title} (×${count} sprints)` : `- ${title}`);
    }
  } else {
    lines.push('_No active patterns._');
  }
  lines.push('');
  lines.push(`_Total entries: ${store.totalCount()} | Generated: ${isoDate()}_`);

  return { content: lines.join('\n'), renderedEntryCount: adrs.length };
}

function renderCompactSummary(
  store: MemoryStore,
  labels: MemoryExportLabels,
  opts: MemoryExportRenderOptions,
  _context: MemoryExportRenderContext,
): RenderedExport {
  const lines: string[] = [];
  const adrs = store.getByType('adr').sort(sortById);
  lines.push(`# ${labels.summaryTitle}`);
  lines.push(exportMetadata('summary', 'adr', adrs.length));
  lines.push('');
  lines.push(`## ${labels.activeArchitectureDecisions}`);
  if (adrs.length > 0) {
    lines.push(`| ${labels.id} | ${labels.title} | ${labels.status} |`);
    lines.push('|-----|-------|--------|');
    for (const adr of adrs) lines.push(`| ${adr.id} | ${adr.title} | ${adr.status} |`);
  } else {
    lines.push(`_${labels.noArchitectureDecisions}_`);
  }
  lines.push('');

  const memories = store.getByType('memory').sort(learningOrder);
  lines.push(`## ${labels.recentLearnings}`);
  if (memories.length === 0) {
    lines.push(`_${labels.noLearnings}_`);
  } else {
    lines.push(renderMemoryIndexLink(labels));
    const newest = memories[0]!;
    const inline = renderInlineLearningLines(newest, labels);
    if (
      lineCount(inline) <= summaryInlineLines(opts)
      && byteLength(inline) <= summaryInlineBytes(opts)
    ) {
      lines.push(...inline);
    } else {
      lines.push(renderLearningLink(newest, labels));
    }
    if (memories.some(memory =>
      memory.sprint_id !== null && parseSprintOrdinal(memory.sprint_id) === null)) {
      lines.push(`### ${labels.legacyEpochLearnings}`);
      lines.push(renderMemoryIndexLink(labels, 'memory-group-legacy-epoch'));
    }
    if (memories.some(memory => memory.sprint_id === null)) {
      lines.push(`### ${labels.unattributedLearnings}`);
      lines.push(renderMemoryIndexLink(labels, 'memory-group-unattributed'));
    }
  }

  const suffix: string[] = [''];
  const debts = store.getByType('debt').filter(debt => debt.status !== 'resolved').sort(sortById);
  suffix.push(`## ${labels.activeTechnicalDebt}`);
  if (debts.length > 0) {
    for (const debt of debts) suffix.push(`- [${debt.priority.toUpperCase()}] ${debt.title}`);
  } else {
    suffix.push(`_${labels.noActiveTechnicalDebt}_`);
  }
  suffix.push('');

  const patterns = store.getByType('pattern').filter(pattern => pattern.status === 'active');
  suffix.push(`## ${labels.activePatterns}`);
  if (patterns.length > 0) {
    const counts = new Map<string, number>();
    for (const pattern of patterns) counts.set(pattern.title, (counts.get(pattern.title) ?? 0) + 1);
    for (const [title, count] of [...counts.entries()]
      .sort(([leftTitle, leftCount], [rightTitle, rightCount]) =>
        rightCount - leftCount || compareCodeUnits(leftTitle, rightTitle))) {
      suffix.push(count > 1
        ? `- ${formatLabel(labels.repeatedPattern, { title, count: String(count) })}`
        : `- ${title}`);
    }
  } else {
    suffix.push(`_${labels.noActivePatterns}_`);
  }
  suffix.push('');
  suffix.push(`_${formatLabel(labels.totalEntriesGenerated, {
    total: String(store.totalCount()), date: isoDate(),
  })}_`);

  lines.push(...suffix);

  return { content: lines.join('\n'), renderedEntryCount: adrs.length };
}

function renderSummary(
  store: MemoryStore,
  opts: MemoryExportRenderOptions,
  context = createRenderContext(),
): RenderedExport {
  return opts.labels === undefined
    ? renderLegacySummary(store)
    : renderCompactSummary(store, opts.labels, opts, context);
}

/**
 * Context projection. Supplying labels selects the lossless compact v2 view;
 * the no-options overload remains the byte-compatible legacy projection.
 */
export function exportSummaryMd(store: MemoryStore, opts: MemoryExportRenderOptions = {}): string {
  return store.readSnapshot(() => renderSummary(store, opts).content);
}

// ─── exportDecisionsMd ──────────────────────────────────────────────

function renderDecisions(store: MemoryStore, opts: MemoryExportRenderOptions): RenderedExport {
  const lines: string[] = [];
  const adrs = store.getByType('adr').sort(sortById);
  const labels = opts.labels;
  lines.push(`# ${labels?.decisionsTitle ?? 'Architecture Decision Records (auto-generated)'}`);
  if (labels !== undefined) lines.push(exportMetadata('decisions', 'adr', adrs.length));
  lines.push('');

  if (adrs.length === 0) {
    lines.push(`_${labels?.noArchitectureDecisions ?? 'No architecture decisions recorded.'}_`);
    return { content: lines.join('\n'), renderedEntryCount: 0 };
  }

  for (let i = 0; i < adrs.length; i++) {
    const adr = adrs[i]!;

    lines.push(`## ${adr.id}: ${adr.title}`);
    lines.push('');
    lines.push(`**${labels?.status ?? 'Status'}:** ${adr.status}`);
    lines.push('');

    // If the content already starts with **Status:** strip it to avoid duplication
    let content = normalizeAdrProjectionSections(adr.content);
    const statusLineRegex = /^\*\*Status:\*\*\s*\S+\s*\n*/;
    if (statusLineRegex.test(content)) {
      content = content.replace(statusLineRegex, '').trimStart();
    }

    lines.push(content);

    // Separator between ADRs (not after the last one)
    if (i < adrs.length - 1) {
      lines.push('');
      lines.push('---');
      lines.push('');
    }
  }

  return { content: lines.join('\n'), renderedEntryCount: adrs.length };
}

/** Full ADR content for git review. */
export function exportDecisionsMd(store: MemoryStore, opts: MemoryExportRenderOptions = {}): string {
  return store.readSnapshot(() => renderDecisions(store, opts).content);
}

// ─── exportMemoryMd ────────────────────────────────────────────────

function renderLegacyMemory(store: MemoryStore): RenderedExport {
  const lines: string[] = [];
  lines.push('# Sprint Learnings (auto-generated)');
  lines.push('');
  const memories = store.getByType('memory');
  if (memories.length === 0) {
    lines.push('_No learnings recorded._');
    return { content: lines.join('\n'), renderedEntryCount: 0 };
  }
  const groups = new Map<string, MemoryEntryV2[]>();
  for (const mem of memories) {
    const key = mem.sprint_id ?? 'unknown';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(mem);
  }
  for (const [sprintId, entries] of groups) {
    lines.push(`## Sprint ${sprintId} Learnings`);
    for (const mem of entries) {
      lines.push(`- ${mem.title}: ${mem.content.replace(/[ \t]+$/gmu, '').trimEnd()}`);
    }
    lines.push('');
  }
  return { content: lines.join('\n'), renderedEntryCount: memories.length };
}

function renderCompactMemory(
  store: MemoryStore,
  labels: MemoryExportLabels,
  opts: MemoryExportRenderOptions,
  _context: MemoryExportRenderContext,
): RenderedExport {
  const lines: string[] = [];
  const memories = store.getByType('memory').sort(learningOrder);
  lines.push(`# ${labels.sprintLearnings}`);
  lines.push(exportMetadata('memory', 'memory', memories.length));
  lines.push('<a id="memory-index"></a>');
  lines.push('');
  if (memories.length === 0) {
    lines.push(`_${labels.noLearnings}_`);
    return { content: lines.join('\n'), renderedEntryCount: 0 };
  }
  lines.push(formatLabel(labels.boundedViewNotice, { detailsFile: MEMORY_DETAILS_FILE }));

  const skeleton = renderBoundedLearningGroups(memories, labels, '##', 0, 0);
  if (
    lineCount([...lines, ...skeleton]) > maxInlineLines(opts)
    || byteLength([...lines, ...skeleton]) > maxInlineBytes(opts)
  ) {
    lines.push(labels.viewBudgetFloorExceeded);
  }
  lines.push(...renderBoundedLearningGroups(
    memories,
    labels,
    '##',
    Math.max(0, maxInlineLines(opts) - lineCount(lines)),
    Math.max(0, maxInlineBytes(opts) - byteLength(lines) - 1),
  ));

  return { content: lines.join('\n'), renderedEntryCount: memories.length };
}

function renderMemory(
  store: MemoryStore,
  opts: MemoryExportRenderOptions,
  context = createRenderContext(),
): RenderedExport {
  return opts.labels === undefined
    ? renderLegacyMemory(store)
    : renderCompactMemory(store, opts.labels, opts, context);
}

/** Sprint learnings grouped without changing their source records. */
export function exportMemoryMd(store: MemoryStore, opts: MemoryExportRenderOptions = {}): string {
  return store.readSnapshot(() => renderMemory(store, opts).content);
}

function renderMemoryDetails(
  store: MemoryStore,
  opts: MemoryExportRenderOptions,
  context = createRenderContext(),
): RenderedExport {
  const labels = opts.labels;
  if (labels === undefined) return { content: '', renderedEntryCount: 0 };
  const memories = store.getByType('memory').sort(learningOrder);
  const lines = [
    `# ${labels.memoryDetailsTitle}`,
    exportMetadata('memory-details', 'memory', memories.length),
    '',
  ];
  if (memories.length === 0) {
    lines.push(`_${labels.noLearnings}_`);
  } else {
    for (const memory of memories) lines.push(...renderLearningLines(store, memory, labels, context));
  }
  return { content: lines.join('\n'), renderedEntryCount: memories.length };
}

/** Complete source-preserving companion for the bounded memory view. */
export function exportMemoryDetailsMd(
  store: MemoryStore,
  opts: MemoryExportRenderOptions,
): string {
  if (opts.labels === undefined) {
    throw new DeckentError('MEMORY_EXPORT_RENDER_HOLD', 'compact-labels-required');
  }
  return store.readSnapshot(() => renderMemoryDetails(store, opts).content);
}

// ─── exportDebtMd ──────────────────────────────────────────────────

function renderDebt(store: MemoryStore, opts: MemoryExportRenderOptions): RenderedExport {
  const lines: string[] = [];
  const allDebt = store.getByType('debt');
  const labels = opts.labels;
  lines.push(`# ${labels?.technicalDebtTitle ?? 'Technical Debt (auto-generated)'}`);
  if (labels !== undefined) lines.push(exportMetadata('debt', 'debt', allDebt.length));
  lines.push('');

  if (allDebt.length === 0) {
    lines.push(`_${labels?.noTechnicalDebt ?? 'No technical debt recorded.'}_`);
    return { content: lines.join('\n'), renderedEntryCount: 0 };
  }

  const active = allDebt.filter(d => d.status !== 'resolved');
  const resolved = allDebt.filter(d => d.status === 'resolved');

  // Active table
  lines.push(`## ${labels?.activeTechnicalDebt ?? 'Active Technical Debt'}`);
  lines.push('');
  lines.push(`| ${labels?.id ?? 'ID'} | ${labels?.title ?? 'Title'} | ${labels?.priority ?? 'Priority'} | ${labels?.sprintId ?? 'Sprint'} | ${labels?.status ?? 'Status'} |`);
  lines.push('|----|-------|----------|--------|--------|');
  if (active.length > 0) {
    for (const d of active) {
      lines.push(`| ${d.id} | ${d.title} | ${d.priority} | ${d.sprint_id ?? '-'} | ${d.status} |`);
    }
  }
  lines.push('');

  // Resolved table (only if there are resolved entries)
  if (resolved.length > 0) {
    lines.push(`## ${labels?.resolvedTechnicalDebt ?? 'Resolved Technical Debt'}`);
    lines.push('');
    lines.push(`| ${labels?.id ?? 'ID'} | ${labels?.title ?? 'Title'} | ${labels?.priority ?? 'Priority'} | ${labels?.sprintId ?? 'Sprint'} | ${labels?.status ?? 'Status'} |`);
    lines.push('|----|-------|----------|--------|--------|');
    for (const d of resolved) {
      lines.push(`| ${d.id} | ${d.title} | ${d.priority} | ${d.sprint_id ?? '-'} | ${d.status} |`);
    }
    lines.push('');
  }

  return { content: lines.join('\n'), renderedEntryCount: allDebt.length };
}

/** Active + resolved debt as markdown tables. */
export function exportDebtMd(store: MemoryStore, opts: MemoryExportRenderOptions = {}): string {
  return store.readSnapshot(() => renderDebt(store, opts).content);
}

// ─── exportAdrsToFs ────────────────────────────────────────────────

/**
 * Result of a DB→FS ADR export run.
 */
export interface AdrFsExportResult {
  /** New files created (did not exist before). */
  written: number;
  /** Existing files overwritten (DB is newer than file mtime). */
  updated: number;
  /** Files skipped because file mtime > DB updated_at (manual edit wins). */
  skipped: number;
  /** Error messages (one per failed ADR entry). */
  errors: string[];
  /** IDs of ADRs that were written or updated (not skipped/errored). */
  ids: string[];
}

/**
 * Compute the filesystem filename for an ADR entry.
 * adr-001   + "TypeScript ESM" → "001-typescript-esm.md"
 * ADR-G-037 + "Execution..."   → "adr-g-037-execution.md"
 */
function adrToFilename(id: string, title: string): string {
  const match = id.match(/^adr-(?:(g|d|ug|up)-)?(\d+)$/i);
  if (!match) {
    throw new DeckentError('E_NON_CANONICAL_ADR_ID', `non-canonical ADR id: ${id}`);
  }
  const adrClass = match[1]?.toLowerCase() ?? null;
  const number = match[2]!.padStart(3, '0');
  const idPrefix = adrClass ? `adr-${adrClass}-${number}` : number;
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `${idPrefix}-${slug}.md`;
}

function adrFilenamePrefix(id: string): string {
  const match = id.match(/^adr-(?:(g|d|ug|up)-)?(\d+)$/i);
  if (!match) {
    throw new DeckentError('E_NON_CANONICAL_ADR_ID', `non-canonical ADR id: ${id}`);
  }
  const adrClass = match[1]?.toLowerCase() ?? null;
  const number = match[2]!.padStart(3, '0');
  return adrClass ? `adr-${adrClass}-${number}-` : `${number}-`;
}

/**
 * Build MADR v3 markdown for an ADR entry.
 * If content already starts with a `#` header, use it as-is.
 * Otherwise generate a wrapper with `_To be backfilled_` placeholders.
 */
function buildAdrMarkdown(entry: MemoryEntryV2): string {
  const content = entry.content.trim();

  if (content.startsWith('#')) {
    return content + '\n';
  }

  const sprintField = entry.sprint_id ?? '_To be backfilled_';
  const bodyContent = normalizeAdrProjectionSections(content) || '_To be backfilled_';
  const idClass = entry.id.match(/^adr-(g|d|ug|up)-\d+$/i)?.[1]?.toUpperCase();
  const taxonomyParts: string[] = [];
  const adrClass = entry.adr_class ?? idClass;
  if (adrClass) taxonomyParts.push(`**Class:** ADR-${adrClass.toUpperCase()}`);
  if (entry.scope) taxonomyParts.push(`**Scope:** ${entry.scope}`);
  if (entry.immutable != null) taxonomyParts.push(`**Immutable:** ${entry.immutable === 1 ? 'yes' : 'no'}`);
  if (entry.source_authority) taxonomyParts.push(`**Source:** ${entry.source_authority}`);
  if (entry.enforcement_level) taxonomyParts.push(`**Enforcement-Level:** ${entry.enforcement_level}`);

  const lines = [
    `# ${entry.id.toUpperCase()}: ${entry.title}`,
    '',
    `**Status:** ${entry.status || '_To be backfilled_'}`,
    '',
    `**Sprint:** ${sprintField}`,
    '',
  ];
  if (taxonomyParts.length > 0) {
    lines.push(taxonomyParts.join(' · '), '');
  }
  lines.push(
    '---',
    '',
    bodyContent,
    '',
  );
  return lines.join('\n');
}

/**
 * Export all ADR entries from the memory DB to individual markdown files
 * in `adrDir`. Implements the reverse (DB→FS) direction of the bi-directional
 * projection contract governed by ADR-G-035.
 *
 * Idempotency: byte-identical projections are left untouched. When content
 * differs, DB authority wins and the projection is rewritten. Human edits must
 * enter through the DB-authoring path; filesystem mtime is not authority.
 */
export function exportAdrsToFs(
  store: MemoryStore,
  adrDir: string,
  opts?: { dryRun?: boolean },
): AdrFsExportResult {
  const dryRun = opts?.dryRun ?? false;
  const result: AdrFsExportResult = {
    written: 0,
    updated: 0,
    skipped: 0,
    errors: [],
    ids: [],
  };

  if (!dryRun) {
    mkdirSync(adrDir, { recursive: true });
  }

  const adrs = store.getByType('adr').sort(sortById);
  const existingFiles = existsSync(adrDir)
    ? readdirSync(adrDir).filter(name => name.endsWith('.md'))
    : [];

  for (const adr of adrs) {
    try {
      const prefix = adrFilenamePrefix(adr.id);
      const existingMatches = existingFiles.filter(name =>
        name.toLowerCase().startsWith(prefix.toLowerCase()),
      );
      if (existingMatches.length > 1) {
        throw new DeckentError('E_AMBIGUOUS_ADR_PROJECTION_FOR', 
          `ambiguous ADR projection for ${adr.id}: ${existingMatches.join(', ')}`,
        );
      }
      const filename = existingMatches[0] ?? adrToFilename(adr.id, adr.title);
      const filePath = join(adrDir, filename);
      const markdown = buildAdrMarkdown(adr);

      const fileExists = existsSync(filePath);

      if (fileExists) {
        if (readFileSync(filePath, 'utf-8') === markdown) {
          result.skipped++;
          continue;
        }

        if (!dryRun) {
          writeFileSync(filePath, markdown, 'utf-8');
        }
        result.ids.push(adr.id);
        result.updated++;
      } else {
        if (!dryRun) {
          writeFileSync(filePath, markdown, 'utf-8');
        }
        result.ids.push(adr.id);
        result.written++;
      }
    } catch (e) {
      result.errors.push(`${adr.id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return result;
}

// ─── writeGuardedExports (Sprint 227 task 227-002) ─────────────────

/**
 * Per-file outcome of writeGuardedExports.
 */
export interface GuardedExportResult {
  written: string[];
  skipped: string[];
  warnings: string[];
}

interface GuardedExportSpec {
  name: string;
  kind: string;
  render: (
    store: MemoryStore,
    opts: MemoryExportRenderOptions,
    context?: MemoryExportRenderContext,
  ) => RenderedExport;
  entryType: EntryType;
  compactOnly?: boolean;
  countLegacyDiskEntries: (content: string) => number | null;
}

function countVersionedDiskEntries(
  content: string,
  expectedKind: string,
  expectedEntryType: EntryType,
): number | null {
  const match = content.match(
    /^<!-- deckent-memory-export:v2 kind=([^ ]+) entry-type=([^ ]+) entry-count=(0|[1-9]\d*) -->$/mu,
  );
  if (match?.[1] !== expectedKind || match[2] !== expectedEntryType) return null;
  const count = Number(match[3]);
  return Number.isSafeInteger(count) ? count : null;
}

function countDecisionExportEntries(content: string): number | null {
  if (!content.startsWith('# Architecture Decision Records (auto-generated)')) return null;
  const lines = content.split('\n');
  let count = 0;
  for (let index = 0; index < lines.length - 2; index++) {
    if (
      /^## .+:\s*.+$/u.test(lines[index] ?? '')
      && (lines[index + 1] ?? '') === ''
      && /^\*\*Status:\*\*\s*\S+/u.test(lines[index + 2] ?? '')
    ) {
      count++;
    }
  }
  return count;
}

function countSummaryDecisionEntries(content: string): number | null {
  if (!content.startsWith('# Brain Summary (auto-generated)')) return null;
  const section = content
    .split('## Active Architecture Decisions')[1]
    ?.split('\n## ')[0];
  if (section === undefined) return null;
  return section
    .split('\n')
    .filter(line =>
      /^\| .+ \| .+ \| .+ \|$/u.test(line)
      && !line.includes('| ID | Title | Status |')
      && !line.includes('|-----|-------|--------|'))
    .length;
}

const GUARDED_EXPORT_SPECS: GuardedExportSpec[] = [
  {
    name: MEMORY_DETAILS_FILE,
    kind: 'memory-details',
    render: renderMemoryDetails,
    entryType: 'memory',
    compactOnly: true,
    countLegacyDiskEntries: () => null,
  },
  {
    name: 'summary.md',
    kind: 'summary',
    render: renderSummary,
    entryType: 'adr',
    countLegacyDiskEntries: countSummaryDecisionEntries,
  },
  {
    name: 'decisions.md',
    kind: 'decisions',
    render: renderDecisions,
    entryType: 'adr',
    countLegacyDiskEntries: countDecisionExportEntries,
  },
  {
    name: 'memory.md', kind: 'memory', render: renderMemory, entryType: 'memory',
    countLegacyDiskEntries: content => content.includes('_No learnings recorded._') ? 0 : null,
  },
  {
    name: 'debt.md', kind: 'debt', render: renderDebt, entryType: 'debt',
    countLegacyDiskEntries: content => content.includes('_No technical debt recorded._') ? 0 : null,
  },
];

/**
 * Render and write export .md snapshots with a sanity guard.
 *
 * Every renderer and guard read completes before the first write. Each
 * eligible file is then replaced atomically; this is deliberately not an
 * all-filesystem transaction, so a later file failure cannot be described
 * as rolling back an earlier successful replacement.
 *
 * All configured export files are guarded. Compact mode publishes the complete
 * memory-details companion before either view that links to it.
 */
function writeGuardedExportsWhileLocked(
  store: MemoryStore,
  exportsDir: string,
  opts: MemoryExportRenderOptions = {},
): GuardedExportResult {
  const result: GuardedExportResult = { written: [], skipped: [], warnings: [] };
  const prepared = store.readSnapshot(() => {
    const context = createRenderContext();
    return GUARDED_EXPORT_SPECS
      .filter(spec => !spec.compactOnly || opts.labels !== undefined)
      .map(spec => {
      const rendered = spec.render(store, opts, context);
      const dbCount = store.getByType(spec.entryType).length;
      const filePath = join(exportsDir, spec.name);
      const diskContent = existsSync(filePath)
        ? readFileSync(filePath, 'utf-8')
        : null;
      const diskHasVersionedMarker = diskContent?.includes('<!-- deckent-memory-export:v2') ?? false;
      const versionedDiskCount = diskContent === null
        ? null
        : countVersionedDiskEntries(diskContent, spec.kind, spec.entryType);
      const diskCount = diskContent === null
        ? null
        : versionedDiskCount ?? spec.countLegacyDiskEntries(diskContent);
      return {
        spec, rendered, dbCount, filePath, diskContent, diskCount,
        diskHasVersionedMarker, versionedDiskCount,
      };
      });
  });

  const eligible: typeof prepared = [];
  for (const item of prepared) {
    const {
      spec, rendered, dbCount, filePath, diskContent, diskCount,
      diskHasVersionedMarker, versionedDiskCount,
    } = item;
    if (diskHasVersionedMarker && versionedDiskCount === null) {
      result.warnings.push(`export-wipe-guard: INVALID_V2_METADATA: ${spec.name}`);
      result.skipped.push(spec.name);
      continue;
    }
    if (opts.labels === undefined && versionedDiskCount !== null) {
      result.warnings.push(`export-wipe-guard: COMPACT_RENDER_OPTIONS_REQUIRED: ${spec.name}`);
      result.skipped.push(spec.name);
      continue;
    }
    if (dbCount !== rendered.renderedEntryCount) {
      const warning =
        `export-wipe-guard: refused to write ${spec.name} — ` +
        `DB has ${dbCount} ${spec.entryType} entries but render has ${rendered.renderedEntryCount} ` +
        `(preserving previous file at ${filePath})`;
      result.warnings.push(warning);
      result.skipped.push(spec.name);
      continue;
    }

    if (dbCount > 0 && diskCount !== null && diskCount > dbCount) {
      const warning =
        `export-wipe-guard: refused to write ${spec.name} — ` +
        `DB has ${dbCount} ${spec.entryType} entries but disk export has ${diskCount} ` +
        `(preserving previous file at ${filePath})`;
      result.warnings.push(warning);
      result.skipped.push(spec.name);
      continue;
    }

    if (dbCount === 0 && diskContent !== null && diskContent.trim().length > 0 && diskCount !== 0) {
      const warning =
        `export-wipe-guard: refused to write ${spec.name} — ` +
        `DB is empty but disk file has content ` +
        `(preserving previous file at ${filePath})`;
      result.warnings.push(warning);
      result.skipped.push(spec.name);
      continue;
    }
    eligible.push(item);
  }

  if (opts.labels !== undefined) {
    const detailsEligible = eligible.some(item => item.spec.name === MEMORY_DETAILS_FILE);
    if (!detailsEligible) {
      for (const dependentName of ['summary.md', 'memory.md']) {
        const index = eligible.findIndex(item => item.spec.name === dependentName);
        if (index < 0) continue;
        eligible.splice(index, 1);
        result.warnings.push(
          `export-wipe-guard: DETAILS_DEPENDENCY_UNAVAILABLE: ${dependentName}`,
        );
        result.skipped.push(dependentName);
      }
    }
  }

  for (const { spec, rendered, filePath } of eligible) {
    writeOperationFileAtomic(filePath, rendered.content, 0o644);
    result.written.push(spec.name);
  }

  return result;
}

export function writeGuardedExports(
  store: MemoryStore,
  exportsDir: string,
  opts: MemoryExportRenderOptions = {},
): GuardedExportResult {
  mkdirSync(exportsDir, { recursive: true });
  try {
    return withConfigWriteLock(join(exportsDir, '.memory-export-write'), () =>
      writeGuardedExportsWhileLocked(store, exportsDir, opts));
  } catch (error: unknown) {
    if (error instanceof ConfigWriteLockTimeoutError) {
      throw new DeckentError('MEMORY_EXPORT_RENDER_HOLD', 'writer-lock-timeout');
    }
    throw error;
  }
}
