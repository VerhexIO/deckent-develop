#!/usr/bin/env node
// Canonical source invocation: node --import tsx scripts/memory-compact-host-proof-observer.mjs

import {
  mkdtempSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const OBSERVATION_KIND = 'deckent-memory-compact-read-export-observation-v1';
const LEGACY_HEADING = '## Legacy Epoch Learnings';
const SUCCESS_CHECKS = Object.freeze([
  'deterministic-projection',
  'legacy-epoch-recency-grouping',
  'meaning-unit-integrity',
  'source-preservation',
]);

const CURRENT_ID = 'memory-sprint-724-meaning';
const CURRENT_TITLE = 'Bounded memory preserves complete meaning';
const CURRENT_CONTENT = 'Claim: retain source bytes when compacting. Condition: only bounded projections may change. Exception: never renumber legacy epochs. Negative: do not delete originals. Limit: 3000 is a view target, not a storage cap. Source: receipt fixture-9002.';
const OLDER_ID = 'memory-sprint-723-context';
const LEGACY_RECORDS = Object.freeze([
  Object.freeze({
    id: 'memory-legacy-1720000000000',
    sprintId: 'sprint-1720000000000',
    sprintNum: 1_720_000_000_000,
    title: 'Legacy detached learning alpha',
    content: 'Legacy source alpha remains available without becoming Sprint 1.',
  }),
  Object.freeze({
    id: 'memory-legacy-1720000001000',
    sprintId: 'sprint-1720000001000',
    sprintNum: 1_720_000_001_000,
    title: 'Legacy detached learning beta',
    content: 'Legacy source beta retains its original epoch identity and provenance.',
  }),
]);

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function occurrences(text, fragment) {
  if (fragment.length === 0) return 0;
  return text.split(fragment).length - 1;
}

function normalizeGeneratedSummaryDate(text) {
  return text.replace(
    /(_Total entries: [0-9]+ \| Generated: )[0-9]{4}-[0-9]{2}-[0-9]{2}(_)/u,
    '$1<generated-date>$2',
  );
}

function semanticStoreSnapshot(store) {
  const entries = store.getByType('memory')
    .map(entry => ({
      entry,
      tags: [...store.getTagsForEntry(entry.id)].sort(),
      history: store.getHistory(entry.id),
      relations: store.getRelations(entry.id)
        .map(relation => ({
          from_id: relation.from_id,
          to_id: relation.to_id,
          rel_type: relation.rel_type,
          created_at: relation.created_at,
        }))
        .sort((left, right) => canonicalJson(left).localeCompare(canonicalJson(right))),
    }))
    .sort((left, right) => left.entry.id.localeCompare(right.entry.id));
  return canonicalJson({
    entries,
    relationCount: store.countRelations(),
    totalCount: store.totalCount(),
  });
}

function insertFixture(store) {
  store.insert({
    id: OLDER_ID,
    type: 'memory',
    title: 'Previous ordinal learning',
    content: 'The prior ordinal sprint stays below the current ordinal sprint.',
    source: 'brain',
    status: 'active',
    priority: 'normal',
    sprint_id: 'sprint-723',
    sprint_num: 723,
    tags: ['memory-proof', 'ordinal'],
    metadata: { evidenceRef: 'fixture:ordinal:723' },
  });
  store.insert({
    id: CURRENT_ID,
    type: 'memory',
    title: CURRENT_TITLE,
    content: CURRENT_CONTENT,
    summary: 'A complete claim, condition, exception, negative, limit, and source.',
    source: 'brain',
    status: 'active',
    priority: 'critical',
    sprint_id: 'sprint-724',
    sprint_num: 724,
    tags: ['memory-proof', 'meaning'],
    metadata: { evidenceRef: 'fixture:ordinal:724' },
  });
  for (const legacy of LEGACY_RECORDS) {
    store.insert({
      id: legacy.id,
      type: 'memory',
      title: legacy.title,
      content: legacy.content,
      source: 'brain',
      status: 'active',
      priority: 'normal',
      sprint_id: legacy.sprintId,
      sprint_num: legacy.sprintNum,
      tags: ['memory-proof', 'legacy-epoch'],
      metadata: { evidenceRef: `fixture:legacy:${legacy.sprintNum}` },
    });
  }
  store.insertRelation({ from_id: CURRENT_ID, to_id: OLDER_ID, type: 'depends_on' });
  store.update(CURRENT_ID, { priority: 'high' }, 'memory-host-proof');
}

async function observe() {
  const fixtureRoot = mkdtempSync(join(tmpdir(), 'deckent-memory-host-proof-'));
  let store;
  let stage = 'module-import';
  try {
    const [
      { MemoryStore },
      { writeGuardedExports },
      { buildMemoryExportLabels },
      { getMessage },
    ] = await Promise.all([
      import('../src/core/memory-store.ts'),
      import('../src/core/memory-export.ts'),
      import('../src/core/memory-export-labels.ts'),
      import('../src/cli/helpers/messages.ts'),
    ]);
    // This fixture intentionally observes the canonical default-English label
    // projection while keeping the core renderer independent of CLI i18n.
    const labels = buildMemoryExportLabels(getMessage, 'en');
    stage = 'fixture-seed';
    store = new MemoryStore(join(fixtureRoot, 'memory.db'));
    insertFixture(store);
    const before = semanticStoreSnapshot(store);
    const exportsDir = join(fixtureRoot, 'exports');
    stage = 'guarded-render';
    const first = writeGuardedExports(store, exportsDir, { labels });
    if (first.warnings.length !== 0 || first.skipped.length !== 0
      || !first.written.includes('summary.md') || !first.written.includes('memory.md')) return 51;
    const firstSummary = readFileSync(join(exportsDir, 'summary.md'), 'utf8');
    const firstMemory = readFileSync(join(exportsDir, 'memory.md'), 'utf8');
    const second = writeGuardedExports(store, exportsDir, { labels });
    const secondSummary = readFileSync(join(exportsDir, 'summary.md'), 'utf8');
    const secondMemory = readFileSync(join(exportsDir, 'memory.md'), 'utf8');
    if (second.warnings.length !== 0 || second.skipped.length !== 0
      || normalizeGeneratedSummaryDate(firstSummary) !== normalizeGeneratedSummaryDate(secondSummary)
      || firstMemory !== secondMemory) return 52;
    if (before !== semanticStoreSnapshot(store)) return 53;

    const currentIndex = firstSummary.indexOf(CURRENT_TITLE);
    const legacyIndex = firstSummary.indexOf('Legacy Epoch Learnings');
    if (currentIndex < 0 || legacyIndex < 0 || currentIndex >= legacyIndex) return 54;
    if (!firstSummary.includes(CURRENT_CONTENT)) return 55;
    if (occurrences(firstMemory, LEGACY_HEADING) !== 1) return 56;
    for (const legacy of LEGACY_RECORDS) {
      if (!firstMemory.includes(legacy.id)
        || !firstMemory.includes(legacy.sprintId)
        || !firstMemory.includes(legacy.content)
        || firstMemory.includes(`## Sprint ${legacy.sprintId} Learnings`)) return 57;
    }
    for (const expected of [CURRENT_ID, OLDER_ID, CURRENT_CONTENT]) {
      if (!firstMemory.includes(expected)) return 58;
    }

    process.stdout.write(canonicalJson({
      checks: SUCCESS_CHECKS,
      kind: OBSERVATION_KIND,
      outcome: 'observed',
      version: 1,
    }));
    return 0;
  } catch (error) {
    // Keep the stdout success protocol exact. Report only bounded machine codes,
    // never a stack/message which could contain source data or private paths.
    const code = error && typeof error === 'object' ? error.code : undefined;
    process.stderr.write(`${canonicalJson({
      kind: 'deckent-memory-compact-observation-failure-v1',
      stage,
      reasonCode: 'MEMORY_COMPACT_OBSERVER_EXCEPTION',
      errorCode: typeof code === 'string' && /^[A-Z][A-Z0-9_]{0,95}$/u.test(code)
        ? code : 'UNCLASSIFIED',
    })}\n`);
    return 59;
  } finally {
    try { store?.close(); } catch { /* observation fails through its non-zero status */ }
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
}

process.exitCode = await observe();
