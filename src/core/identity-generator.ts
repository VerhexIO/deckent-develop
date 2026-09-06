// ═══ Identity Generator ═══════════════════════════════════════════
// Manages .deckent/workspace/IDENTITY.md lifecycle:
//   - syncIdentityToDb: syncs managed IDENTITY.md → memory.db `identity` entry (Step 1b)
//   - runPostFinalizeHooks: orchestrates post-sprint hook chain (Steps 1-4)
//
// IDENTITY.md ownership split (ADR-046):
//   - AUTOGEN blocks (identity-tests, identity-summary, identity-status): managed by
//     scripts/update-readme-stats.mjs (registration-based counts, run via `npm run docs:stats`)
//   - ## Project Status section: autoSection in .deckent/docs.json (managed-docs pipeline)
//     NOTE: managed-docs content-generators.ts uses file-based MCP count (vs registration-based
//     in update-readme-stats.mjs). `update-readme-stats.mjs` is authoritative — it runs as
//     `prepublishOnly` gate (`npm run docs:stats:check`). The managed-docs AUTOGEN block
//     preservation ensures `identity-status` AUTOGEN values survive sprint finalization.
//
// @deprecated regenerateProjectIdentity — Sprint 166 ADR-046. Use managed-docs chain instead.

import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  BRAIN_DIR, PROJECT_IDENTITY_FILE, SPRINTS_DIR, MEMORY_DB_FILE, WORKSPACE_DIR,
} from './constants.js';
import { debugLog } from './utils.js';
import { parseWorkspaceArtifactHeader, workspaceArtifactDigest } from './workspace-artifact-contract.js';

// ─── Types ────────────────────────────────────────────────────────

export interface IdentityMetrics {
  sprintId: string;
  totalTasks: number;
  completedTasks: number;
  techDebtTasks: number;
  noGoTasks: number;
  coveragePercent: number;
  durationMs: number;
}

export interface IdentityContext {
  projectRoot: string;
  metrics: IdentityMetrics;
  /** Override total sprint count (otherwise counted from .brain/sprints/) */
  totalSprints?: number;
  /** Override ADR count (otherwise counted from DB) */
  adrCount?: number;
  /** Override CLI command count */
  cliCommandCount?: number;
  /** Override MCP tool count */
  mcpToolCount?: number;
}

export interface IdentityRegenResult {
  success: boolean;
  filePath: string;
  adrCount: number;
  totalSprints: number;
  reason?: string;
}

// ─── Core Logic ───────────────────────────────────────────────────

/**
 * Count ADRs from the memory DB if available.
 */
function countAdrsFromDb(projectRoot: string): number {
  try {
    const dbPath = join(projectRoot, BRAIN_DIR, MEMORY_DB_FILE);
    if (!existsSync(dbPath)) return 0;
    // Dynamic import avoided — use synchronous SQLite read via raw require
    // We use a lightweight approach: count files or parse exports
    const exportsDir = join(projectRoot, BRAIN_DIR, 'exports');
    const summaryPath = join(exportsDir, 'summary.md');
    if (!existsSync(summaryPath)) return 0;
    const content = readFileSync(summaryPath, 'utf-8');
    // Count ADR rows in the summary table (lines matching "| adr-NNN |")
    const adrLines = content.split('\n').filter(l => /^\|\s*adr-\d+/.test(l));
    return adrLines.length;
  } catch (e) {
    debugLog('countAdrsFromDb', e);
    return 0;
  }
}

/**
 * Count total sprints from .brain/sprints/ directory.
 */
function countTotalSprints(projectRoot: string): number {
  try {
    const sprintsPath = join(projectRoot, BRAIN_DIR, SPRINTS_DIR);
    if (!existsSync(sprintsPath)) return 1;
    return readdirSync(sprintsPath).filter(f => f.endsWith('.md')).length || 1;
  } catch {
    return 1;
  }
}

/**
 * Extract sprint number from sprint ID (e.g., "sprint-143" → 143).
 */
function extractSprintNum(sprintId: string): number | null {
  const match = sprintId.match(/sprint-(\d+)/);
  return match ? parseInt(match[1]!, 10) : null;
}

/**
 * @deprecated Sprint 166 (ADR-046) — identityRegen step delegated to managed-docs chain.
 * `.brain/PROJECT-IDENTITY.md` is superseded by `.deckent/workspace/IDENTITY.md`
 * (managed via docs.json "identity-md" entry). Sprint 168 C0a-1 (BUG-GG) flipped
 * the runtime default in `runPostFinalizeHooks` so this function is NO LONGER invoked
 * unless the caller explicitly opts in via `skipIdentityRegen: false`.
 *
 * Regenerate PROJECT-IDENTITY.md with live metrics from the completed sprint.
 */
export function regenerateProjectIdentity(ctx: IdentityContext): IdentityRegenResult {
  const { projectRoot, metrics } = ctx;
  const brainPath = join(projectRoot, BRAIN_DIR);
  const filePath = join(brainPath, PROJECT_IDENTITY_FILE);

  const totalSprints = ctx.totalSprints
    ?? extractSprintNum(metrics.sprintId)
    ?? countTotalSprints(projectRoot);

  const adrCount = ctx.adrCount ?? countAdrsFromDb(projectRoot);
  const cliCommandCount = ctx.cliCommandCount ?? 41;
  const mcpToolCount = ctx.mcpToolCount ?? 22;

  try {
    mkdirSync(brainPath, { recursive: true });

    if (!existsSync(filePath)) {
      // Create minimal identity file
      const content = buildMinimalIdentity(metrics, totalSprints, adrCount, cliCommandCount, mcpToolCount);
      writeFileSync(filePath, content, 'utf-8');
      return { success: true, filePath, adrCount, totalSprints, reason: 'created' };
    }

    // Read existing content and update Current State section
    const existing = readFileSync(filePath, 'utf-8');
    const updated = updateCurrentStateSection(existing, metrics, totalSprints, adrCount, cliCommandCount, mcpToolCount);

    if (updated === existing) {
      return { success: true, filePath, adrCount, totalSprints, reason: 'unchanged' };
    }

    writeFileSync(filePath, updated, 'utf-8');
    return { success: true, filePath, adrCount, totalSprints, reason: 'updated' };
  } catch (e) {
    debugLog('regenerateProjectIdentity', e);
    return { success: false, filePath, adrCount, totalSprints, reason: `error: ${e}` };
  }
}

// ─── Content Builders ─────────────────────────────────────────────

function buildMinimalIdentity(
  metrics: IdentityMetrics,
  totalSprints: number,
  adrCount: number,
  cliCommandCount: number,
  mcpToolCount: number,
): string {
  return [
    '# Project Identity',
    '',
    '## Current State',
    `- Last Sprint: ${metrics.sprintId}`,
    `- Total Sprints: ${totalSprints}`,
    `- Completed Tasks: ${metrics.completedTasks}`,
    `- Coverage: ${metrics.coveragePercent.toFixed(1)}%`,
    `- No-Go Rate: ${metrics.noGoTasks > 0 && metrics.totalTasks > 0 ? ((metrics.noGoTasks / metrics.totalTasks) * 100).toFixed(1) : '0.0'}%`,
    `- ADR Count: ${adrCount}`,
    `- CLI Commands: ${cliCommandCount}+`,
    `- MCP Tools: ${mcpToolCount}`,
    '',
  ].join('\n');
}

function updateCurrentStateSection(
  content: string,
  metrics: IdentityMetrics,
  totalSprints: number,
  adrCount: number,
  cliCommandCount: number,
  mcpToolCount: number,
): string {
  const lines = content.split('\n');
  const newLines: string[] = [];
  let inCurrentState = false;
  let replacedCurrentState = false;

  const stateLines = [
    `- Last Sprint: ${metrics.sprintId}`,
    `- Total Sprints: ${totalSprints}`,
    `- Completed Tasks: ${metrics.completedTasks}`,
    `- Coverage: ${metrics.coveragePercent.toFixed(1)}%`,
    `- No-Go Rate: ${metrics.noGoTasks > 0 && metrics.totalTasks > 0 ? ((metrics.noGoTasks / metrics.totalTasks) * 100).toFixed(1) : '0.0'}%`,
    `- ADR Count: ${adrCount}`,
    `- CLI Commands: ${cliCommandCount}+`,
    `- MCP Tools: ${mcpToolCount}`,
  ];

  for (const line of lines) {
    if (line === '## Current State') {
      inCurrentState = true;
      replacedCurrentState = true;
      newLines.push('## Current State');
      newLines.push(...stateLines);
      continue;
    }

    if (inCurrentState) {
      if (line.startsWith('## ')) {
        inCurrentState = false;
        newLines.push('');
        newLines.push(line);
      }
      // Skip old state lines
      continue;
    }

    newLines.push(line);
  }

  // If no Current State section existed, append one
  if (!replacedCurrentState) {
    newLines.push('');
    newLines.push('## Current State');
    newLines.push(...stateLines);
    newLines.push('');
  }

  return newLines.join('\n');
}

// ─── Memory Export Hook ───────────────────────────────────────────

export interface MemoryExportResult {
  success: boolean;
  filesWritten: string[];
  errors: string[];
}

/**
 * Run memory export: read from DB, write to .brain/exports/*.md.
 * This regenerates all 4 export files from the SQLite DB.
 */
export async function runMemoryExport(
  projectRoot: string,
  renderOptions: import('./memory-export.js').MemoryExportRenderOptions = {},
): Promise<MemoryExportResult> {
  const result: MemoryExportResult = { success: true, filesWritten: [], errors: [] };

  try {
    const dbPath = join(projectRoot, BRAIN_DIR, MEMORY_DB_FILE);
    if (!existsSync(dbPath)) {
      result.success = false;
      result.errors.push('memory.db not found');
      return result;
    }

    const { MemoryStore } = await import('./memory-store.js');
    const { writeGuardedExports } = await import('./memory-export.js');

    const store = new MemoryStore(dbPath, { readOnly: true });
    try {
      const exportsDir = join(projectRoot, BRAIN_DIR, 'exports');
      const guarded = writeGuardedExports(store, exportsDir, renderOptions);
      result.filesWritten.push(...guarded.written);
      result.errors.push(...guarded.warnings);
      result.success = guarded.skipped.length === 0;
    } finally {
      store.close();
    }
  } catch (e) {
    result.success = false;
    result.errors.push(`memory export failed: ${e}`);
  }

  return result;
}

// ─── Identity DB Sync ─────────────────────────────────────────────

export interface IdentitySyncResult {
  success: boolean;
  /** The memory.db `identity` entry id that was written, or null on skip. */
  entryId: string | null;
  /** `created` | `updated` | a skip/error reason. */
  reason: string;
}

/**
 * Mirror the managed `.deckent/workspace/IDENTITY.md` document into the
 * memory.db `identity` entry.
 *
 * B9 (Memory V2): the DB `identity` entry froze (2026-04-16) because nothing
 * refreshed it after a sprint. The managed IDENTITY.md doc is the identity
 * source of truth (ADR-046, docs.json "identity-md"); this keeps the DB entry
 * — what `deckent recall` / memory queries read — in sync with it.
 *
 * The existing entry is updated in place (matched by `type='identity'`, so a
 * legacy `project-identity` id is preserved); a missing entry is created with
 * the canonical `identity-project` id. Missing IDENTITY.md or DB is a
 * graceful no-op — never throws into the finalize chain.
 */
export async function syncIdentityToDb(projectRoot: string): Promise<IdentitySyncResult> {
  const identityPath = join(projectRoot, WORKSPACE_DIR, 'IDENTITY.md');
  if (!existsSync(identityPath)) {
    return { success: false, entryId: null, reason: 'IDENTITY.md not found' };
  }
  const dbPath = join(projectRoot, BRAIN_DIR, MEMORY_DB_FILE);
  if (!existsSync(dbPath)) {
    return { success: false, entryId: null, reason: 'memory.db not found' };
  }

  try {
    const content = readFileSync(identityPath, 'utf-8');
    const header = parseWorkspaceArtifactHeader(content);
    const source = header?.provenance === 'stack-detector' ? 'system' : 'user';
    const changedBy = `workspace-identity-sync:${source}`;
    const { MemoryStore } = await import('./memory-store.js');
    const store = new MemoryStore(dbPath);
    try {
      const existing = store.getByType('identity')[0];
      const entryId = existing?.id ?? 'identity-project';
      store.upsert({
        id: entryId,
        type: 'identity',
        title: 'Project Identity',
        content,
        source,
        status: 'active',
        decay_exempt: true,
        tags: ['identity', 'project'],
        metadata: {
          projectionOf: '.deckent/workspace/IDENTITY.md',
          workspaceArtifactSchema: header?.schemaVersion ?? 0,
          workspaceArtifactProvenance: header?.provenance ?? 'legacy-unversioned',
          contentSha256: workspaceArtifactDigest(content),
        },
      }, changedBy);
      return { success: true, entryId, reason: existing ? 'updated' : 'created' };
    } finally {
      store.close();
    }
  } catch (e) {
    debugLog('syncIdentityToDb', e);
    return { success: false, entryId: null, reason: `error: ${e}` };
  }
}

// ─── AUTOGEN Scope Validation ────────────────────────────────────

export interface AutogenScopeValidation {
  ok: boolean;
  findings: string[];
  mcpToolCount: number | null;
  blocks: { id: string; found: boolean; containsProjectStatus?: boolean }[];
}

/**
 * Validate that IDENTITY.md AUTOGEN blocks cover the expected sections
 * and that MCP tool count matches the registered count.
 *
 * Called by lint-identity-md.mjs and tests to prevent AUTOGEN drift.
 */
export function validateIdentityAutogenScope(projectRoot: string): AutogenScopeValidation {
  const identityPath = join(projectRoot, WORKSPACE_DIR, 'IDENTITY.md');
  if (!existsSync(identityPath)) {
    return { ok: false, findings: ['IDENTITY.md not found'], mcpToolCount: null, blocks: [] };
  }

  const content = readFileSync(identityPath, 'utf-8');
  const findings: string[] = [];
  const blocks: AutogenScopeValidation['blocks'] = [];
  let mcpToolCount: number | null = null;

  // Check identity-status block exists and covers Project Status table
  const statusStart = '<!-- AUTOGEN:START id="identity-status" -->';
  const statusEnd = '<!-- AUTOGEN:END id="identity-status" -->';
  const statusStartIdx = content.indexOf(statusStart);
  const statusEndIdx = content.indexOf(statusEnd);

  if (statusStartIdx === -1 || statusEndIdx === -1 || statusEndIdx <= statusStartIdx) {
    findings.push('identity-status AUTOGEN block missing or malformed');
    blocks.push({ id: 'identity-status', found: false });
  } else {
    const block = content.slice(statusStartIdx + statusStart.length, statusEndIdx);

    // Verify MCP Tools row exists and extract count
    const mcpMatch = block.match(/\|\s*MCP Tools\s*\|\s*(\d+)\s*\|/);
    if (!mcpMatch) {
      findings.push('identity-status AUTOGEN block missing MCP Tools row');
    } else {
      mcpToolCount = parseInt(mcpMatch[1]!, 10);
      if (mcpToolCount < 31) {
        findings.push(`MCP Tools count ${mcpToolCount} is below expected minimum 31`);
      }
    }

    // Verify that ## Project Status heading immediately precedes the AUTOGEN block
    const headingBefore = content.lastIndexOf('## Project Status', statusStartIdx);
    const contentBetween = headingBefore !== -1
      ? content.slice(headingBefore + '## Project Status'.length, statusStartIdx).trim()
      : '';
    const containsProjectStatus = headingBefore !== -1 && contentBetween === '';

    if (!containsProjectStatus) {
      findings.push('## Project Status heading does not immediately precede identity-status AUTOGEN block');
    }

    blocks.push({ id: 'identity-status', found: true, containsProjectStatus });
  }

  // Check identity-summary block exists and contains MCP count
  const summaryStart = '<!-- AUTOGEN:START id="identity-summary" -->';
  const summaryEnd = '<!-- AUTOGEN:END id="identity-summary" -->';
  const summaryStartIdx = content.indexOf(summaryStart);
  const summaryEndIdx = content.indexOf(summaryEnd);

  if (summaryStartIdx === -1 || summaryEndIdx === -1 || summaryEndIdx <= summaryStartIdx) {
    findings.push('identity-summary AUTOGEN block missing or malformed');
    blocks.push({ id: 'identity-summary', found: false });
  } else {
    const block = content.slice(summaryStartIdx + summaryStart.length, summaryEndIdx);
    const summaryMcpMatch = block.match(/MCP:\s*(\d+)\s*tools/);
    if (!summaryMcpMatch) {
      findings.push('identity-summary AUTOGEN block missing MCP tools line');
    } else {
      const summaryCount = parseInt(summaryMcpMatch[1]!, 10);
      if (mcpToolCount !== null && summaryCount !== mcpToolCount) {
        findings.push(
          `MCP count mismatch: identity-status=${mcpToolCount} vs identity-summary=${summaryCount}`,
        );
      }
    }
    blocks.push({ id: 'identity-summary', found: true });
  }

  return { ok: findings.length === 0, findings, mcpToolCount, blocks };
}

// ─── Post-Finalize Hook Chain ─────────────────────────────────────

export interface PostFinalizeHookOptions {
  projectRoot: string;
  sprintId: string;
  metrics: IdentityMetrics;
  /** Optional callback for rule regeneration (renumbered to Step 4) */
  onRuleRegen?: (projectRoot: string) => void | Promise<void>;
  /** Skip memory export step */
  skipMemoryExport?: boolean;
  /** Optional caller-owned labels for the guarded memory export render. */
  memoryExportRenderOptions?: import('./memory-export.js').MemoryExportRenderOptions;
  /**
   * Skip identity regeneration step.
   *
   * **Default: `true` — Sprint 168 C0a-1 BUG-GG fix (Sprint 166 T5 deprecated enforcement).**
   *
   * When this field is omitted or `undefined`, Step 2 (`regenerateProjectIdentity`)
   * is bypassed. The `@deprecated` annotation added in Sprint 166 T5 had no runtime
   * effect on its own (TypeScript annotations are compile-time/IDE hints), so the
   * Step was still firing each finalize cycle and mutating `.brain/PROJECT-IDENTITY.md`.
   * Sprint 168 flips the runtime default to `true` so callers must explicitly opt in
   * by passing `skipIdentityRegen: false` to invoke the deprecated step.
   *
   * @deprecated Sprint 166 — Step 2 (identityRegen) is deprecated. Managed-docs chain
   * handles `.deckent/workspace/IDENTITY.md` via docs.json "identity-md" entry.
   * Will be removed in a future sprint once all call-sites are migrated to the
   * managed-docs chain. Prefer omitting the field (default skips).
   */
  skipIdentityRegen?: boolean;
  /** Skip ADR file sync step (Step 3 — Bug M Sprint 166 T1) */
  skipAdrInsert?: boolean;
  /** Override directory containing `NNN-*.md` ADR files (default: `<projectRoot>/docs/adr`) */
  adrDir?: string;
}

/** Bug M Sprint 166 T1 — result of Step 3 ADR file sync run. */
export interface AdrInsertResult {
  inserted: number;
  updated: number;
  skipped: number;
  errors: string[];
  ids: string[];
}

export interface PostFinalizeHookResult {
  memoryExport: MemoryExportResult | null;
  /** B9 — managed IDENTITY.md → memory.db `identity` entry sync (Step 1b). */
  identitySync: IdentitySyncResult | null;
  /**
   * @deprecated Sprint 166 — identityRegen step delegated to managed-docs chain.
   * Sprint 168 C0a-1 (BUG-GG) made the default runtime behavior to skip Step 2;
   * this field is therefore `null` on the common path. It becomes non-null only when
   * the caller explicitly opts in with `skipIdentityRegen: false`.
   */
  identityRegen: IdentityRegenResult | null;
  /** Bug M Sprint 166 T1 — populated when adrInsert step ran (Step 3). */
  adrInsert: AdrInsertResult | null;
  ruleRegenCalled: boolean;
  errors: string[];
}

/**
 * Run the post-finalize hook chain.
 *
 * Step Ordering Contract (Sprint 166 T1 — Step Ordering Contract Section 5.1):
 *   Step 1  — memory export   → exports/* regenerate
 *   Step 1b — identity sync   → managed IDENTITY.md → memory.db `identity` (B9)
 *   Step 2  — identity regen  → PROJECT-IDENTITY.md update (deprecated, skipped)
 *   Step 3  — adr insert      → docs/adr/*.md → memory.db upsert (Bug M fix)
 *   Step 4  — rule regen      → .claude/rules/*.md (renumbered from Step 3)
 *
 * Step 3 must run BEFORE Step 4 so that newly accepted ADRs (e.g. ADR-046)
 * are present in the DB when rules are regenerated. ADR-046 documents this
 * contract; do not reorder without updating the ADR.
 *
 * Changelog and sprint-log are already handled by doc-updaters registry
 * via updateProjectDocs() in finalizeSprint steps 9.
 *
 * Each step is fail-safe: errors are logged but don't block subsequent steps.
 */
export async function runPostFinalizeHooks(opts: PostFinalizeHookOptions): Promise<PostFinalizeHookResult> {
  const result: PostFinalizeHookResult = {
    memoryExport: null,
    identitySync: null,
    identityRegen: null,
    adrInsert: null,
    ruleRegenCalled: false,
    errors: [],
  };

  // Step 1: Memory export → exports/* regenerate
  if (!opts.skipMemoryExport) {
    try {
      result.memoryExport = await runMemoryExport(opts.projectRoot, opts.memoryExportRenderOptions);
      debugLog('postFinalizeHooks:memoryExport',
        `${result.memoryExport.filesWritten.length} files written, ${result.memoryExport.errors.length} errors`);
    } catch (e) {
      result.errors.push(`memoryExport: ${e}`);
      debugLog('postFinalizeHooks:memoryExport', e);
    }
  }

  // Step 1b: Sync managed IDENTITY.md → memory.db `identity` entry (B9).
  // Without this the DB identity entry stays frozen at its init-seed value.
  try {
    result.identitySync = await syncIdentityToDb(opts.projectRoot);
    debugLog('postFinalizeHooks:identitySync', result.identitySync.reason);
  } catch (e) {
    result.errors.push(`identitySync: ${e}`);
    debugLog('postFinalizeHooks:identitySync', e);
  }

  // Step 2: PROJECT-IDENTITY.md auto-regen (DEPRECATED — Sprint 166 ADR-046)
  // Managed-docs chain (docs.json "identity-md") handles .deckent/workspace/IDENTITY.md.
  //
  // Sprint 168 C0a-1 (BUG-GG): runtime default flipped to skip. The Sprint 166 T5
  // `@deprecated` JSDoc annotation alone had no effect on dispatch (annotations are
  // compile-time only). Step 2 must now be explicitly opted in via
  // `skipIdentityRegen: false`. Omitting the field — the common path — skips Step 2
  // and leaves `result.identityRegen === null`.
  if (opts.skipIdentityRegen === false) {
    try {
      result.identityRegen = regenerateProjectIdentity({
        projectRoot: opts.projectRoot,
        metrics: opts.metrics,
      });
      debugLog('postFinalizeHooks:identityRegen',
        `${result.identityRegen.reason} adrCount=${result.identityRegen.adrCount}`);
    } catch (e) {
      result.errors.push(`identityRegen: ${e}`);
      debugLog('postFinalizeHooks:identityRegen', e);
    }
  }

  // Step 3: ADR file sync — docs/adr/*.md → memory.db (Bug M Sprint 166 T1)
  // Unconditional invocation pattern: runs whenever the DB exists. Failure
  // (missing dir, malformed file) is captured in result.adrInsert.errors
  // but does not block Step 4.
  if (!opts.skipAdrInsert) {
    try {
      const dbPath = join(opts.projectRoot, BRAIN_DIR, MEMORY_DB_FILE);
      if (existsSync(dbPath)) {
        const { MemoryStore } = await import('./memory-store.js');
        const { syncAdrFilesToDb } = await import('./adr-file-sync.js');
        const adrDir = opts.adrDir ?? join(opts.projectRoot, 'docs', 'adr');
        const store = new MemoryStore(dbPath);
        try {
          const syncResult = syncAdrFilesToDb(store, adrDir, { changedBy: 'post-finalize' });
          result.adrInsert = {
            inserted: syncResult.inserted,
            updated: syncResult.updated,
            skipped: syncResult.skipped,
            errors: syncResult.errors,
            ids: syncResult.ids,
          };
          debugLog('postFinalizeHooks:adrInsert',
            `inserted=${syncResult.inserted} updated=${syncResult.updated} skipped=${syncResult.skipped}`);
        } finally {
          store.close();
        }
      } else {
        result.adrInsert = { inserted: 0, updated: 0, skipped: 0, errors: ['memory.db not found'], ids: [] };
      }
    } catch (e) {
      result.errors.push(`adrInsert: ${e}`);
      debugLog('postFinalizeHooks:adrInsert', e);
    }
  }

  // Step 4: Rule regen hook point (renumbered from Step 3 per ADR-046)
  if (opts.onRuleRegen) {
    try {
      await opts.onRuleRegen(opts.projectRoot);
      result.ruleRegenCalled = true;
      debugLog('postFinalizeHooks:ruleRegen', 'Rule regeneration hook called');
    } catch (e) {
      result.errors.push(`ruleRegen: ${e}`);
      debugLog('postFinalizeHooks:ruleRegen', e);
    }
  }

  return result;
}
