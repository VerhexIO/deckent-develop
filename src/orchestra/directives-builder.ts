// ─── DIRECTIVES.md Builder — NL→DIRECTIVES üretici çekirdeği (DIR-1) ───────
//
// Deterministic generator: structured intent (tasks[]: {title,desc,files,scope,
// deps,model,skills,goCriteria[],nogo[]}) → canonical DIRECTIVES.md text.
//
// Round-trip contract: buildDirectives(intent) output is read back losslessly by
// the UNCHANGED parseStructuredDirectives (task-builder.ts) — title/scope/files/
// deps/model/effort/skills land in its native ParsedDirectiveTask fields. That
// parser has no dedicated goCriteria/nogo field (it treats everything after
// `### Description` as one opaque description string), so goCriteria/nogo are
// serialized into a `### goNogo` sub-block INSIDE that description text — a
// format this module owns both ends of (extractGoNogo mirrors buildDirectives'
// own writer) without touching or duplicating the parser itself.
//
// This task deliberately stops at markdown generation — no LLM call, no NL
// understanding. The NL→structured-intent step is an explicit follow-up.

import type { ModelType, TaskEffort } from '../core/types.js';
import {
  createGoNoGoCriterionItem,
  type GoNoGoCriterionItem,
  type ProductionWiringPlanEvidenceV2,
} from '../core/task-types.js';
import { productionWiringContractV2InputFromCanonical } from '../core/production-wiring-contract.js';
import { DeckentError, ErrorRegistry } from '../core/errors.js';
import type { ParsedDirectiveTask } from './task-builder.js';

// ═══ Types ═══════════════════════════════════════════════════════════════

export interface DirectiveBuildTask {
  title: string;
  desc: string;
  /** Exact read-only files. Never widened into files/directories write authority. */
  reads?: string[];
  files: string[];
  scope: string[];
  deps: string[];
  model?: ModelType;
  effort?: TaskEffort;
  /** undefined = auto-select (omit `Skills:` line); [] = explicitly none (`Skills: none`). */
  skills?: string[];
  /** Exact task-local verification command; persisted as Task.verification. */
  test?: string;
  /** Host-completed V2 authority; serialized without derived digests for the canonical reader. */
  productionWiring?: ProductionWiringPlanEvidenceV2;
  goCriteria: string[];
  nogo: string[];
  /** Optional lossless machine-readable projection; display arrays stay unchanged. */
  criteriaItems?: GoNoGoCriterionItem[];
  /** U1-G2 (PCOMP-8): traceability METADATA (flowId/revision/actor…) — written as
   *  its own `- Meta:` line, NEVER merged into desc (desc feeds intent
   *  classification; a flowId hex once matched the 'cd' devops keyword). */
  meta?: Record<string, string>;
}

export interface DirectiveBuildIntent {
  /** Document title suffix, e.g. "# DIRECTIVES — <title>". Purely cosmetic — discarded
   * by parseStructuredDirectives (everything before the first `## Task N:` heading is
   * ignored), so it is only guarded against fracturing that first split. */
  title?: string;
  /** Optional `## Goal` prose section. Same discard/guard rule as `title`. */
  goal?: string;
  tasks: DirectiveBuildTask[];
}

export interface ExtractedGoNogo {
  goCriteria: string[];
  nogo: string[];
}

export interface ExtractedStructuredGoNogo extends ExtractedGoNogo {
  items: GoNoGoCriterionItem[];
}

// ═══ Fragility guards (0-kırılganlık foundation) ════════════════════════
//
// parseStructuredDirectives scans directive-label lines (Model:/Files:/etc.) and
// `## Task N:` headings ANYWHERE in a task block, not just where this builder
// intends them. A free-text field that both contains one of those patterns AND is
// emitted so the pattern can BEGIN A PHYSICAL LINE would silently corrupt parsing —
// a stray `## Task 2:` line would fracture the block split; a stray `Model:` line
// would override the task's actual model. Reject that input outright rather than
// emit a directive that *looks* well-formed but parses wrong.
//
// The guard therefore follows the EMISSION CHANNEL, not the field's free-text-ness:
//   - `title` → interpolated into `## Task N: <title>`; `desc` → pushed raw as its
//     own multi-line block. Content here CAN start a line ⇒ guarded.
//   - `goCriteria`/`nogo` → joined by escapeListItem onto ONE line; `criteriaItems`
//     → JSON.stringify onto ONE line. Both escape `\n`/`\r`, so no item content can
//     ever begin a line ⇒ NOT guarded, and it round-trips losslessly.
// RECOVERY-DO-DOGFOOD (measured 2026-08-09): guarding the single-line channels was a
// false-positive fail-closed that killed whole runs at plan-compile — the AI planner
// wrote the ordinary evidence phrase "file:line citation of …" and `Files?` matched
// it. Nine everyday English/Turkish phrasings hit the same wall. Same lesson as
// born-677 below: NL-authored text must round-trip, not be rejected.
// Open residual: JSON.stringify does not escape U+2028/U+2029, which JS regex treats
// as line terminators under /m — today that yields a typed malformed-projection
// refusal (fail-closed, never silent corruption); escaping them is a separate slice.

const RESERVED_LABEL_RE =
  /^\s*-?\s*(?:Model|Effort|Provider|Agent|Skills|Dependencies|Priority|Auth|Backend|ModelEffort|Test|Smoke|Files?|Reads?|Oku|Okuma|Dosya|Scope|Kapsam)\s*:/i;
const TASK_HEADING_RE = /^##\s+(?:G[öo]rev|Task)\s+\d+[^:]*:/m;
const SECTION_HEADING_RE = /^\s*###\s+(?:Description|goNogo)\b/im;

function assertNoHeadingCollision(field: string, value: string): void {
  if (TASK_HEADING_RE.test(value)) {
    throw new DeckentError('DECKENT_E074', 
      `directives-builder: "${field}" contains a "## Task N:" heading pattern — would fracture parseStructuredDirectives' block split`,
    );
  }
  if (SECTION_HEADING_RE.test(value)) {
    throw new DeckentError('DECKENT_E074', 
      `directives-builder: "${field}" contains a reserved "### Description"/"### goNogo" heading`,
    );
  }
}

function assertSafeField(field: string, value: string): void {
  assertNoHeadingCollision(field, value);
  for (const rawLine of value.split('\n')) {
    if (RESERVED_LABEL_RE.test(rawLine)) {
      throw new DeckentError('DECKENT_E074', 
        `directives-builder: "${field}" contains a reserved directive-label line ("${rawLine.trim()}") — would be mis-parsed as a task directive`,
      );
    }
  }
}

function assertNoDelimiterCollision(field: string, items: readonly string[], delimiter: string): void {
  for (const item of items) {
    if (item.includes(delimiter)) {
      throw new DeckentError('DECKENT_E074', 
        `directives-builder: "${field}" item "${item}" contains the "${delimiter}" join delimiter — would not round-trip`,
      );
    }
  }
}

function assertNonEmpty(field: string, value: string): void {
  if (!value.trim()) throw new DeckentError('DECKENT_E074', `directives-builder: "${field}" must not be empty`);
}

// ═══ Delimiter-safe escaping (goCriteria/nogo) ══════════════════════════
//
// goCriteria/nogo items are frequently user/NL-authored free text (e.g. an NL
// target embedded verbatim by a caller) and must not be rejected just because
// they happen to contain the '; ' join delimiter, a literal backslash, or an
// embedded newline (born-677: an ordinary semicolon in NL prose hard-errored).
// This module owns BOTH the writer (buildTaskBlock) and the reader
// (splitCriteriaLine/extractGoNogo) for this `- goCriteria: a; b` line format,
// so a private, reversible backslash-escape can replace the previous
// reject-on-collision check without touching the external, unchanged
// parseStructuredDirectives parser (which owns the ','-delimited Files/Scope/
// Dependencies/Skills lines — those keep their hard collision check).

function escapeListItem(item: string, delimiter: string): string {
  let out = '';
  for (const ch of item) {
    if (ch === '\\' || ch === delimiter) out += `\\${ch}`;
    else if (ch === '\n') out += '\\n';
    else if (ch === '\r') out += '\\r';
    else out += ch;
  }
  return out;
}

function splitEscaped(joined: string, delimiter: string): string[] {
  const parts: string[] = [];
  let cur = '';
  for (let i = 0; i < joined.length; i++) {
    const ch = joined[i];
    if (ch === '\\' && i + 1 < joined.length) {
      cur += ch + joined[i + 1];
      i++;
    } else if (ch === delimiter) {
      parts.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  parts.push(cur);
  return parts;
}

/** Exported (PCOMP-6 D5): the single unescape used by every DIRECTIVES reader —
 *  sprint-utils' goNogo extraction shares it so `\;` never leaks into task JSON. */
export function unescapeListItem(item: string): string {
  let out = '';
  for (let i = 0; i < item.length; i++) {
    const ch = item[i];
    if (ch === '\\' && i + 1 < item.length) {
      const next = item[i + 1];
      if (next === 'n') out += '\n';
      else if (next === 'r') out += '\r';
      else out += next;
      i++;
    } else {
      out += ch;
    }
  }
  return out;
}

// ═══ Writer ══════════════════════════════════════════════════════════════

/**
 * Render a scope entry for the `- Scope:` line. A directory gains its trailing
 * slash; a FILE path keeps its exact shape.
 *
 * Measured 2026-08-10: appending unconditionally turned every file entry into a
 * phantom directory — a re-plan proposal reported `src/core/run-status-authority.ts/`
 * among a task's directories, and any consumer treating that list as directories
 * inherits a path that cannot exist. A final segment carrying an extension is a
 * file; anything else is a directory.
 */
function normalizeScopeDir(dir: string): string {
  if (dir.endsWith('/')) return dir;
  const lastSegment = dir.slice(dir.lastIndexOf('/') + 1);
  // A leading dot is a dotfile/dotdir marker, not an extension separator.
  const looksLikeFile = /\.[A-Za-z0-9]+$/.test(lastSegment) && !lastSegment.startsWith('.');
  return looksLikeFile ? dir : `${dir}/`;
}

function validateTask(task: DirectiveBuildTask): void {
  assertNonEmpty('title', task.title);
  assertNonEmpty('desc', task.desc);
  if (task.files.length === 0) throw new DeckentError('DECKENT_E074', 'directives-builder: "files" must contain at least one entry (DISTINCT-FILE)');
  if (task.goCriteria.length === 0) throw new DeckentError('DECKENT_E074', 'directives-builder: "goCriteria" must contain at least one entry');
  if (task.nogo.length === 0) throw new DeckentError('DECKENT_E074', 'directives-builder: "nogo" must contain at least one entry');

  // Only the raw-emitted fields carry the collision guard — see the channel rule
  // above. `title` lands inside the `## Task N:` heading and `desc` is pushed as
  // its own unescaped, multi-line block, so content there really can start a
  // physical line. goCriteria/nogo/criteriaItems are single-line encoded and are
  // deliberately NOT guarded: rejecting them broke real runs (RECOVERY-DO-DOGFOOD).
  assertSafeField('title', task.title);
  assertSafeField('desc', task.desc);
  for (const item of task.criteriaItems ?? []) {
    const canonical = createGoNoGoCriterionItem(item);
    if (canonical.id !== item.id) {
      throw new DeckentError(
        'DECKENT_E074',
        `directives-builder: criterion id "${item.id}" is not the canonical host-derived identity`,
      );
    }
  }

  assertNoDelimiterCollision('files', task.files, ',');
  if (task.reads) assertNoDelimiterCollision('reads', task.reads, ',');
  assertNoDelimiterCollision('scope', task.scope, ',');
  assertNoDelimiterCollision('deps', task.deps, ',');
  if (task.skills) assertNoDelimiterCollision('skills', task.skills, ',');
  if (task.test !== undefined) {
    assertNonEmpty('test', task.test);
    if (/\r|\n/.test(task.test)) {
      throw new DeckentError('DECKENT_E074', 'directives-builder: "test" must be one physical command line');
    }
    assertSafeField('test', task.test);
  }
  // goCriteria/nogo items are escaped instead of rejected — see escapeListItem above.
}

function buildTaskBlock(task: DirectiveBuildTask, seq: number): string[] {
  validateTask(task);

  const lines: string[] = [];
  lines.push(`## Task ${seq}: ${task.title}`);
  if (task.model) lines.push(`- Model: ${task.model}`);
  if (task.effort) lines.push(`- Effort: ${task.effort}`);
  if (task.skills !== undefined) {
    lines.push(`- Skills: ${task.skills.length > 0 ? task.skills.join(', ') : 'none'}`);
  }
  lines.push(`- Files: ${task.files.join(', ')}`);
  if (task.reads && task.reads.length > 0) lines.push(`- Reads: ${task.reads.join(', ')}`);
  if (task.test) lines.push(`- Test: ${task.test}`);
  if (task.productionWiring) {
    lines.push(`- ProductionWiring: ${JSON.stringify(
      productionWiringContractV2InputFromCanonical(task.productionWiring.contract),
    )}`);
  }
  if (task.meta && Object.keys(task.meta).length > 0) {
    // U1-G2: metadata as a dedicated line — readers keep it OUT of content flows.
    const metaStr = Object.entries(task.meta)
      .map(([k, v]) => `${k}=${escapeListItem(String(v), ';')}`)
      .join('; ');
    lines.push(`- Meta: ${metaStr}`);
  }
  lines.push(`- Scope: ${task.scope.map(normalizeScopeDir).join(', ')}`);
  lines.push(`- Dependencies: ${task.deps.length > 0 ? task.deps.join(', ') : 'none'}`);
  lines.push('### Description');
  lines.push(task.desc.trim());
  lines.push('### goNogo');
  lines.push(`- goCriteria: ${task.goCriteria.map(item => escapeListItem(item, ';')).join('; ')}`);
  lines.push(`- nogo: ${task.nogo.map(item => escapeListItem(item, ';')).join('; ')}`);
  if (task.criteriaItems && task.criteriaItems.length > 0) {
    const criteriaItems = JSON.stringify(task.criteriaItems)
      .replace(/\u2028/g, '\\u2028')
      .replace(/\u2029/g, '\\u2029');
    lines.push(`- criteriaItems: ${criteriaItems}`);
  }
  return lines;
}

/**
 * Build a canonical DIRECTIVES.md document from structured intent. Deterministic —
 * identical input always produces identical output (no LLM call, no clock/random).
 */
export function buildDirectives(intent: DirectiveBuildIntent): string {
  if (!intent.tasks || intent.tasks.length === 0) {
    throw new DeckentError('DECKENT_E074', 'directives-builder: intent.tasks must contain at least one task');
  }
  if (intent.title) assertNoHeadingCollision('title', intent.title);
  if (intent.goal) assertNoHeadingCollision('goal', intent.goal);

  const lines: string[] = [];
  lines.push(`# DIRECTIVES — ${intent.title ?? 'Structured Sprint'}`);
  if (intent.goal) {
    lines.push('');
    lines.push('## Goal');
    lines.push(intent.goal.trim());
  }
  intent.tasks.forEach((task, idx) => {
    lines.push('');
    lines.push(...buildTaskBlock(task, idx + 1));
  });
  return `${lines.join('\n').trimEnd()}\n`;
}

// ═══ Reader ══════════════════════════════════════════════════════════════

const GO_NOGO_HEADING_RE = /^\s*###\s+goNogo\s*$/im;

function splitCriteriaLine(section: string, label: 'goCriteria' | 'nogo'): string[] {
  const lineRe = new RegExp(`^\\s*-\\s*${label}\\s*:\\s*(.*)$`, 'im');
  const match = lineRe.exec(section);
  if (!match?.[1]) return [];
  return splitEscaped(match[1], ';')
    .map(s => unescapeListItem(s.trim()))
    .filter(Boolean);
}

function canonicalItemsFromStatements(
  goCriteria: readonly string[],
  nogo: readonly string[],
): GoNoGoCriterionItem[] {
  return [
    ...goCriteria.map(statement => createGoNoGoCriterionItem({
      polarity: 'go',
      statement,
      evidenceRequirements: [statement],
    })),
    ...nogo.map(statement => createGoNoGoCriterionItem({
      polarity: 'no-go',
      statement,
      evidenceRequirements: [statement],
    })),
  ];
}

function parseStructuredCriteriaItems(section: string): GoNoGoCriterionItem[] | null {
  const match = /^\s*-\s*criteriaItems\s*:\s*(.*)$/im.exec(section);
  if (!match) return null;
  try {
    const value = JSON.parse(match[1] ?? '');
    if (!Array.isArray(value) || value.length === 0) {
      throw ErrorRegistry.createError('DECKENT_E074', {
        message: 'items must be a non-empty array',
      });
    }
    return value.map((candidate, index) => {
      if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
        throw ErrorRegistry.createError('DECKENT_E074', {
          message: `item ${index} is not an object`,
        });
      }
      const record = candidate as Record<string, unknown>;
      if (
        (record['polarity'] !== 'go' && record['polarity'] !== 'no-go')
        || typeof record['statement'] !== 'string'
        || !Array.isArray(record['evidenceRequirements'])
        || record['evidenceRequirements'].some(requirement => typeof requirement !== 'string')
      ) {
        throw ErrorRegistry.createError('DECKENT_E074', {
          message: `item ${index} has an invalid shape`,
        });
      }
      const canonical = createGoNoGoCriterionItem({
        polarity: record['polarity'],
        statement: record['statement'],
        evidenceRequirements: record['evidenceRequirements'] as string[],
      });
      if (record['id'] !== canonical.id) {
        throw ErrorRegistry.createError('DECKENT_E074', {
          message: `item ${index} id is not canonical`,
        });
      }
      return canonical;
    });
  } catch (error) {
    throw new DeckentError(
      'DECKENT_E074',
      `directives-builder: malformed criteriaItems projection (${error instanceof Error ? error.message : String(error)})`,
    );
  }
}

interface ExtractedGoNogoState extends ExtractedStructuredGoNogo {
  encodedItems: boolean;
}

function extractGoNogoState(description: string): ExtractedGoNogoState {
  const headingMatch = GO_NOGO_HEADING_RE.exec(description);
  if (!headingMatch) {
    return { goCriteria: [], nogo: [], items: [], encodedItems: false };
  }
  const section = description.slice(headingMatch.index + headingMatch[0].length);
  const goCriteria = splitCriteriaLine(section, 'goCriteria');
  const nogo = splitCriteriaLine(section, 'nogo');
  const encoded = parseStructuredCriteriaItems(section);
  return {
    goCriteria,
    nogo,
    items: encoded ?? canonicalItemsFromStatements(goCriteria, nogo),
    encodedItems: encoded !== null,
  };
}

/**
 * Read the `### goNogo` sub-block back out of a real ParsedDirectiveTask.description
 * string. Symmetric counterpart to buildTaskBlock's own `### goNogo` writer — not a
 * general-purpose markdown parser.
 */
export function extractGoNogo(description: string): ExtractedGoNogo {
  const { goCriteria, nogo } = extractGoNogoState(description);
  return { goCriteria, nogo };
}

/** Machine-readable counterpart that preserves the legacy display reader. */
export function extractStructuredGoNogo(description: string): ExtractedStructuredGoNogo {
  const { encodedItems: _encodedItems, ...extracted } = extractGoNogoState(description);
  return extracted;
}

function extractDescBody(description: string): string {
  const headingMatch = GO_NOGO_HEADING_RE.exec(description);
  if (!headingMatch) return description.trim();
  return description.slice(0, headingMatch.index).trim();
}

/**
 * Reconstruct a DirectiveBuildTask from a real ParsedDirectiveTask (the output of
 * task-builder.ts's parseStructuredDirectives). Used to verify the round-trip
 * contract: buildDirectives → parseStructuredDirectives → reconstructBuildTask
 * must deep-equal the original intent task.
 */
export function reconstructBuildTask(parsed: ParsedDirectiveTask): DirectiveBuildTask {
  const { goCriteria, nogo, items, encodedItems } = extractGoNogoState(parsed.description);
  return {
    title: parsed.title,
    desc: extractDescBody(parsed.description),
    ...(parsed.scope.filesRead.length > 0 ? { reads: [...parsed.scope.filesRead] } : {}),
    files: [...parsed.scope.filesWrite],
    scope: [...parsed.scope.directories],
    deps: parsed.dependencies ?? [],
    model: parsed.forceModel,
    effort: parsed.forceEffort,
    skills: parsed.forceSkills,
    ...(parsed.testTarget ? { test: parsed.testTarget } : {}),
    ...(parsed.productionWiring?.version === 2
      ? { productionWiring: parsed.productionWiring }
      : {}),
    goCriteria,
    nogo,
    ...(encodedItems ? { criteriaItems: items } : {}),
    ...(parsed.meta ? { meta: parsed.meta } : {}),
  };
}
