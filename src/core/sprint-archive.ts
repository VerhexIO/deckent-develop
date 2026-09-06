/**
 * Canonical sprint archive authority.
 *
 * Physical evidence belongs under one bounded namespace:
 *   <archive_path>/<sprint-id>/
 *     manifest.json
 *     tasks/
 *     evaluations/
 *     scheduler/
 *     heartbeat/
 *     docs/
 *
 * `.brain/memory.db` remains the semantic-learning authority. Reconciliation
 * writes only a small, searchable manifest reference there; raw evidence is
 * never duplicated into Brain by this module.
 */

import { createHash, randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import {
  closeSync,
  constants as fsConstants,
  copyFileSync,
  existsSync,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdtempSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  readSync,
  realpathSync,
  renameSync,
  rmdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
  type Stats,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep, win32 } from 'node:path';

import {
  ARCHIVE_DIR,
  ARCHIVE_SPRINTS_SUBDIR,
  BRAIN_DIR,
  DECKENT_DIR,
  MEMORY_DB_FILE,
  PROJECT_CONFIG_PATH,
  TASKS_DIR,
} from './constants.js';
import { canonicalJson } from './audit-writer.js';
import { DeckentError } from './errors.js';
import { writeGuardedExports } from './memory-export.js';
import type { MemoryExportRenderOptions } from './memory-export.js';
import { MemoryStore } from './memory-store.js';
import type { SprintTerminalReceiptV1 } from './sprint-terminal-publication.js';
import { debugLog } from './utils.js';

export const SPRINT_ARCHIVE_MANIFEST_KIND = 'deckent.sprint-archive-manifest';
export const SPRINT_ARCHIVE_MANIFEST_VERSION = 1;
export const SPRINT_ARCHIVE_MANIFEST_FILE = 'manifest.json';
export const SPRINT_ARCHIVE_TASKS_SUBDIR = 'tasks';
export const TASK_ARTIFACT_PRESERVED_SUBDIR = 'preserved';
export const TASK_ARTIFACT_PRESERVATION_MARKER_FILE = 'preservation-marker.json';
export const TASK_ARTIFACT_PRESERVATION_MARKER_KIND = 'deckent.task-artifact-preservation';

const DEFAULT_ARCHIVE_BASE = join(DECKENT_DIR, ARCHIVE_DIR, ARCHIVE_SPRINTS_SUBDIR);
const LEGACY_TASK_ARCHIVE_SUBDIR = 'archive';
const HASH_BUFFER_BYTES = 1024 * 1024;
const SPRINT_ID_PATTERN = /^sprint-(\d+)$/u;
const TERMINAL_SEAL_RECEIPT_FILE = 'terminal-seal-receipt.json';
const TERMINAL_SEAL_APPLICATION_FILE = 'terminal-seal-application.json';

export type SprintArchiveArtifactFamily =
  | 'run'
  | 'tasks'
  | 'evaluations'
  | 'metrics'
  | 'scheduler'
  | 'heartbeat'
  | 'docs'
  | 'audits'
  | 'unknown';

export interface TaskArtifactPreservationMarker {
  readonly kind: typeof TASK_ARTIFACT_PRESERVATION_MARKER_KIND;
  readonly version: 1;
  readonly sprintId: string;
  readonly reason: 'non-terminal';
  readonly restorePath: string;
  readonly entries: readonly string[];
  readonly recordedAt: string;
}

export interface TaskArtifactArchivePlan {
  readonly archive: readonly string[];
  readonly preserve: readonly string[];
  /** Exact-sprint hidden/unclassified residue sweep; defaults to true. */
  readonly sweepResidue?: boolean;
}

export interface TaskArtifactArchiveResult {
  readonly destination: string;
  readonly preservedDestination: string;
  readonly archived: string[];
  readonly preserved: string[];
  readonly consolidated: string[];
  readonly residueSwept: string[];
  readonly failures: string[];
}

export interface SprintArchiveManifestArtifact {
  readonly path: string;
  readonly family: SprintArchiveArtifactFamily;
  readonly bytes: number;
  readonly sha256: string;
  readonly sources: readonly string[];
}

export interface SprintArchiveMemoryReference {
  readonly id: string;
  readonly type: string;
  readonly digest: string;
  readonly updatedAt: string;
}

export interface SprintArchiveManifest {
  readonly kind: typeof SPRINT_ARCHIVE_MANIFEST_KIND;
  readonly schemaVersion: typeof SPRINT_ARCHIVE_MANIFEST_VERSION;
  readonly sprintId: string;
  readonly terminalOutcome: string | null;
  readonly artifactCount: number;
  readonly totalBytes: number;
  readonly familyCounts: Readonly<Record<SprintArchiveArtifactFamily, number>>;
  readonly artifacts: readonly SprintArchiveManifestArtifact[];
  readonly conflicts: readonly {
    path: string;
    variants: readonly string[];
  }[];
  readonly memoryReferences: readonly SprintArchiveMemoryReference[];
  readonly contentDigest: string;
}

export interface SprintArchiveReconcileOptions {
  readonly apply?: boolean;
  /** Retire only verified legacy sources; live/hot runtime sources are never retired. */
  readonly retireLegacySources?: boolean;
  readonly indexMemory?: boolean;
}

export interface SprintArchiveReconcileReport {
  readonly sprintId: string;
  readonly archiveDir: string;
  readonly manifestPath: string;
  readonly applied: boolean;
  readonly discovered: number;
  readonly published: number;
  readonly deduplicated: number;
  readonly retired: number;
  readonly conflicts: number;
  readonly failures: readonly string[];
  readonly manifest: SprintArchiveManifest;
}

export interface SprintArchiveVerificationReport {
  readonly sprintId: string;
  readonly ok: boolean;
  readonly checked: number;
  readonly missing: readonly string[];
  readonly mismatched: readonly string[];
  readonly untracked: readonly string[];
  readonly manifestDigestValid: boolean;
}

export interface SprintArchiveArtifactPublication {
  readonly path: string;
  readonly bytes: number;
  readonly sha256: string;
  readonly state: 'published' | 'deduplicated' | 'conflict';
  readonly sourceRetired: boolean;
}

/** Stable failure codes for callers that must fail closed before archive mutation. */
export type SprintArchivePublicationErrorCode =
  | 'ARCHIVE_UNSAFE_NAMESPACE'
  | 'ARCHIVE_UNSAFE_DESTINATION_PATH'
  | 'ARCHIVE_TERMINAL_PUBLICATION_REJECTED';

export class SprintArchivePublicationError extends Error {
  readonly code: SprintArchivePublicationErrorCode;

  constructor(code: SprintArchivePublicationErrorCode, path: string) {
    super(`${code}:${path}`);
    this.name = 'SprintArchivePublicationError';
    this.code = code;
  }
}

interface ArchiveCandidate {
  readonly source: string;
  readonly targetRelative: string;
  readonly family: SprintArchiveArtifactFamily;
  readonly retireLegacy: boolean;
}

interface PublishedCandidate extends ArchiveCandidate {
  readonly actualTargetRelative: string;
  readonly bytes: number;
  readonly sha256: string;
  readonly state: 'published' | 'deduplicated' | 'planned' | 'conflict';
}

function assertSprintId(sprintId: string): void {
  if (!SPRINT_ID_PATTERN.test(sprintId)) {
    throw new DeckentError('INVALID_SPRINT_ID', `INVALID_SPRINT_ID:${sprintId}`);
  }
}

function relativePortable(root: string, path: string): string {
  const projected = relative(root, path);
  if (projected === '') return '.';
  if (projected.startsWith('..') || isAbsolute(projected)) return basename(path);
  return projected.split(sep).join('/');
}

function safeConfiguredArchiveBase(projectRoot: string): string {
  let configured: string | null = null;
  try {
    const configPath = join(projectRoot, PROJECT_CONFIG_PATH);
    if (existsSync(configPath)) {
      const parsed = JSON.parse(readFileSync(configPath, 'utf-8')) as {
        sprint_file_retention?: { archive_path?: unknown };
      } | null;
      const value = parsed?.sprint_file_retention?.archive_path;
      if (typeof value === 'string' && value.trim() !== '') configured = value.trim();
    }
  } catch (error) {
    debugLog('sprintArchive:config', error);
  }

  const candidate = resolve(projectRoot, configured ?? DEFAULT_ARCHIVE_BASE);
  const projected = relative(resolve(projectRoot), candidate);
  if (projected === '' || projected.startsWith('..') || isAbsolute(projected)) {
    return resolve(projectRoot, DEFAULT_ARCHIVE_BASE);
  }
  return candidate;
}

export function resolveSprintArchiveDir(projectRoot: string, sprintId: string): string {
  assertSprintId(sprintId);
  return join(safeConfiguredArchiveBase(projectRoot), sprintId);
}

export function resolveTaskArtifactArchiveDir(projectRoot: string, sprintId: string): string {
  return join(resolveSprintArchiveDir(projectRoot, sprintId), SPRINT_ARCHIVE_TASKS_SUBDIR);
}

/** Canonical-first, migration-aware read roots. No directory is created. */
export function resolveTaskArtifactReadDirs(projectRoot: string, sprintId: string): readonly string[] {
  assertSprintId(sprintId);
  const configuredBase = safeConfiguredArchiveBase(projectRoot);
  const candidates: string[] = [
    resolveTaskArtifactArchiveDir(projectRoot, sprintId),
    join(configuredBase, `${sprintId}-tasks`),
    join(projectRoot, DECKENT_DIR, ARCHIVE_DIR, ARCHIVE_SPRINTS_SUBDIR, `${sprintId}-tasks`),
    join(projectRoot, BRAIN_DIR, ARCHIVE_DIR, ARCHIVE_SPRINTS_SUBDIR, `${sprintId}-tasks`),
    join(projectRoot, BRAIN_DIR, ARCHIVE_DIR, `${sprintId}-tasks`),
    join(projectRoot, TASKS_DIR, LEGACY_TASK_ARCHIVE_SUBDIR, sprintId),
  ];
  const stagingRoot = join(projectRoot, TASKS_DIR, LEGACY_TASK_ARCHIVE_SUBDIR);
  try {
    candidates.push(...readdirSync(stagingRoot, { withFileTypes: true })
      .filter(entry => entry.isDirectory()
        && (entry.name === sprintId || entry.name.startsWith(`${sprintId}-`)))
      .map(entry => join(stagingRoot, entry.name)));
  } catch { /* no staging archive */ }
  return [...new Set(candidates.map(path => resolve(path)))].filter(path => existsSync(path));
}

function sprintNumber(sprintId: string): string {
  const match = SPRINT_ID_PATTERN.exec(sprintId);
  if (!match?.[1]) {
    throw new DeckentError('INVALID_SPRINT_ID', `INVALID_SPRINT_ID:${sprintId}`);
  }
  return match[1];
}

/** Exact ownership predicate; foreign hidden worker artifacts never cross sprint boundaries. */
export function isSprintOwnedTaskArtifact(name: string, sprintId: string): boolean {
  const number = sprintNumber(sprintId);
  return name.startsWith(`task-${number}-`)
    || name.startsWith(`${number}-`)
    || name.startsWith(`.prompt-${number}-`)
    || name.startsWith(`.worker-${number}-`);
}

function hashFile(path: string): string {
  const descriptor = openSync(path, 'r');
  const hash = createHash('sha256');
  const buffer = Buffer.allocUnsafe(HASH_BUFFER_BYTES);
  try {
    for (;;) {
      const bytesRead = readSync(descriptor, buffer, 0, buffer.length, null);
      if (bytesRead === 0) break;
      hash.update(buffer.subarray(0, bytesRead));
    }
  } finally {
    closeSync(descriptor);
  }
  return hash.digest('hex');
}

function fileIdentity(path: string): { bytes: number; sha256: string } {
  const metadata = lstatSync(path);
  if (!metadata.isFile()) {
    throw new DeckentError(
      'ARCHIVE_SOURCE_NOT_REGULAR_FILE',
      `ARCHIVE_SOURCE_NOT_REGULAR_FILE:${path}`,
    );
  }
  return { bytes: statSync(path).size, sha256: hashFile(path) };
}

function conflictDestination(destination: string, sha256: string): string {
  return join(dirname(destination), 'conflicts', `${basename(destination)}.${sha256.slice(0, 16)}`);
}

/**
 * Check every currently-existing component before mkdir/copy can touch the
 * archive. `lstat` deliberately rejects both symlinks and Windows junctions.
 */
function assertArchivePublicationDestinationSafe(
  projectRoot: string,
  destination: string,
): void {
  const root = resolve(projectRoot);
  const target = resolve(destination);
  const projected = relative(root, target);
  if (projected === '' || projected === '..' || projected.startsWith(`..${sep}`) || isAbsolute(projected)) {
    throw new SprintArchivePublicationError('ARCHIVE_UNSAFE_DESTINATION_PATH', destination);
  }
  const segments = projected.split(sep);
  let current = root;
  for (let index = 0; index < segments.length; index += 1) {
    current = join(current, segments[index]!);
    try {
      const metadata = lstatSync(current);
      if (metadata.isSymbolicLink() || (index < segments.length - 1 && !metadata.isDirectory())) {
        throw new SprintArchivePublicationError('ARCHIVE_UNSAFE_DESTINATION_PATH', current);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    }
  }
}

function terminalSidecarExists(archiveDir: string): boolean {
  for (const filename of [TERMINAL_SEAL_RECEIPT_FILE, TERMINAL_SEAL_APPLICATION_FILE]) {
    try {
      lstatSync(join(archiveDir, filename));
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return true;
    }
  }
  return false;
}

function identicalFileIdentity(
  left: { readonly bytes: number; readonly sha256: string },
  right: { readonly bytes: number; readonly sha256: string },
): boolean {
  return left.bytes === right.bytes && left.sha256 === right.sha256;
}

function retireExactPublishedSource(source: string, destination: string): boolean {
  if (resolve(source) === resolve(destination)) return false;
  // Re-read both identities immediately before unlinking; an old comparison is
  // not proof that the source still names the archived bytes.
  const destinationIdentity = fileIdentity(destination);
  const sourceIdentity = fileIdentity(source);
  if (!identicalFileIdentity(destinationIdentity, sourceIdentity)) {
    throw new DeckentError(
      'ARCHIVE_RETIREMENT_DIGEST_MISMATCH',
      `ARCHIVE_RETIREMENT_DIGEST_MISMATCH:${source}`,
    );
  }
  unlinkSync(source);
  return true;
}

function publishVerifiedCopy(source: string, requestedDestination: string): {
  destination: string;
  state: 'published' | 'deduplicated' | 'conflict';
  identity: { bytes: number; sha256: string };
} {
  const identity = fileIdentity(source);
  let destination = requestedDestination;
  let state: 'published' | 'deduplicated' | 'conflict' = 'published';
  if (existsSync(destination)) {
    const existing = fileIdentity(destination);
    if (existing.bytes === identity.bytes && existing.sha256 === identity.sha256) {
      return { destination, state: 'deduplicated', identity };
    }
    destination = conflictDestination(destination, identity.sha256);
    state = 'conflict';
    if (existsSync(destination)) {
      const conflict = fileIdentity(destination);
      if (conflict.bytes === identity.bytes && conflict.sha256 === identity.sha256) {
        return { destination, state, identity };
      }
      throw new DeckentError(
        'ARCHIVE_CONFLICT_COLLISION',
        `ARCHIVE_CONFLICT_COLLISION:${destination}`,
      );
    }
  }

  mkdirSync(dirname(destination), { recursive: true, mode: 0o700 });
  const temporary = join(dirname(destination), `.${basename(destination)}.${process.pid}.${randomUUID()}.tmp`);
  try {
    copyFileSync(source, temporary, fsConstants.COPYFILE_EXCL | fsConstants.COPYFILE_FICLONE);
    const temporaryIdentity = fileIdentity(temporary);
    if (temporaryIdentity.bytes !== identity.bytes || temporaryIdentity.sha256 !== identity.sha256) {
      throw new DeckentError(
        'ARCHIVE_COPY_DIGEST_MISMATCH',
        `ARCHIVE_COPY_DIGEST_MISMATCH:${source}`,
      );
    }
    const descriptor = openSync(temporary, 'r');
    try { fsyncSync(descriptor); } finally { closeSync(descriptor); }
    try {
      linkSync(temporary, destination);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      const winner = fileIdentity(destination);
      if (winner.bytes !== identity.bytes || winner.sha256 !== identity.sha256) throw error;
      state = 'deduplicated';
    }
    const directoryDescriptor = openSync(dirname(destination), 'r');
    try { fsyncSync(directoryDescriptor); } finally { closeSync(directoryDescriptor); }
  } finally {
    try { unlinkSync(temporary); } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  return { destination, state, identity };
}

/**
 * Publish one sprint-owned file without clobbering prior evidence. Different
 * bytes for the same logical path are retained below a hash-addressed
 * `conflicts/` directory. Source retirement happens only after the published
 * bytes independently match the source digest.
 */
export function publishSprintArchiveArtifact(
  projectRoot: string,
  sprintId: string,
  source: string,
  targetRelative: string,
  options: { readonly retireSource?: boolean } = {},
): SprintArchiveArtifactPublication {
  assertSprintId(sprintId);
  const archiveDir = resolveSprintArchiveDir(projectRoot, sprintId);
  const destination = resolve(archiveDir, targetRelative);
  if (
    targetRelative.trim() === ''
    || isAbsolute(targetRelative)
    || !destination.startsWith(`${resolve(archiveDir)}${sep}`)
  ) {
    throw new DeckentError(
      'INVALID_ARCHIVE_TARGET',
      `INVALID_ARCHIVE_TARGET:${targetRelative}`,
    );
  }

  if (!isSprintArchiveNamespaceSafe(projectRoot, sprintId)) {
    throw new SprintArchivePublicationError('ARCHIVE_UNSAFE_NAMESPACE', archiveDir);
  }
  assertArchivePublicationDestinationSafe(projectRoot, destination);

  if (terminalSidecarExists(archiveDir)) {
    const sourceIdentity = fileIdentity(source);
    let destinationIdentity: { bytes: number; sha256: string };
    try {
      destinationIdentity = fileIdentity(destination);
    } catch {
      throw new SprintArchivePublicationError('ARCHIVE_TERMINAL_PUBLICATION_REJECTED', destination);
    }
    if (!identicalFileIdentity(destinationIdentity, sourceIdentity)) {
      throw new SprintArchivePublicationError('ARCHIVE_TERMINAL_PUBLICATION_REJECTED', destination);
    }
    return {
      path: relative(archiveDir, destination).split(sep).join('/'),
      ...destinationIdentity,
      state: 'deduplicated',
      sourceRetired: options.retireSource === true && retireExactPublishedSource(source, destination),
    };
  }

  const publication = publishVerifiedCopy(source, destination);
  const sourceRetired = options.retireSource === true
    && retireExactPublishedSource(source, publication.destination);
  return {
    path: relative(archiveDir, publication.destination).split(sep).join('/'),
    ...publication.identity,
    state: publication.state,
    sourceRetired,
  };
}

function moveVerified(source: string, requestedDestination: string): string {
  const published = publishVerifiedCopy(source, requestedDestination);
  const destinationIdentity = fileIdentity(published.destination);
  const sourceIdentity = fileIdentity(source);
  if (
    destinationIdentity.bytes !== sourceIdentity.bytes
    || destinationIdentity.sha256 !== sourceIdentity.sha256
  ) {
    throw new DeckentError(
      'ARCHIVE_MOVE_PRECONDITION_FAILED',
      `ARCHIVE_MOVE_PRECONDITION_FAILED:${source}`,
    );
  }
  unlinkSync(source);
  return published.destination;
}

function listFilesRecursively(root: string): string[] {
  if (!existsSync(root)) return [];
  const files: string[] = [];
  const pending = [root];
  while (pending.length > 0) {
    const current = pending.pop()!;
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) pending.push(path);
      else if (entry.isFile()) files.push(path);
    }
  }
  return files.sort();
}

/**
 * Live task settlement. Every source is retired only after an independently
 * hashed destination exists. Legacy `.tasks/archive/<sprint>` is folded into
 * the same canonical task directory.
 */
export function archiveTaskArtifacts(
  projectRoot: string,
  sprintId: string,
  plan: TaskArtifactArchivePlan = { archive: [], preserve: [] },
): TaskArtifactArchiveResult {
  assertSprintId(sprintId);
  const destination = resolveTaskArtifactArchiveDir(projectRoot, sprintId);
  const preservedDestination = join(destination, TASK_ARTIFACT_PRESERVED_SUBDIR);
  const result: TaskArtifactArchiveResult = {
    destination,
    preservedDestination,
    archived: [],
    preserved: [],
    consolidated: [],
    residueSwept: [],
    failures: [],
  };
  const tasksDir = join(projectRoot, TASKS_DIR);
  if (!existsSync(tasksDir)) return result;
  const preserveSet = new Set(plan.preserve);

  const settle = (name: string, targetDir: string, bucket: string[]): void => {
    const source = join(tasksDir, name);
    if (!existsSync(source)) return;
    if (!isSprintOwnedTaskArtifact(name, sprintId)) {
      result.failures.push(`${name}:SPRINT_OWNERSHIP_MISMATCH`);
      return;
    }
    try {
      moveVerified(source, join(targetDir, name));
      bucket.push(name);
    } catch (error) {
      result.failures.push(name);
      debugLog('archiveTaskArtifacts:move', error);
    }
  };

  for (const name of plan.archive) {
    if (!preserveSet.has(name)) settle(name, destination, result.archived);
  }
  for (const name of preserveSet) settle(name, preservedDestination, result.preserved);

  if (result.preserved.length > 0) {
    writeTaskArtifactPreservationMarker(projectRoot, sprintId, result.preserved);
  }

  const legacyRoot = join(tasksDir, LEGACY_TASK_ARCHIVE_SUBDIR);
  let legacyDirs: string[] = [];
  try {
    legacyDirs = readdirSync(legacyRoot, { withFileTypes: true })
      .filter(entry => entry.isDirectory()
        && (entry.name === sprintId || entry.name.startsWith(`${sprintId}-`)))
      .map(entry => join(legacyRoot, entry.name));
  } catch { /* no legacy staging root */ }
  for (const legacyDir of legacyDirs) {
    for (const source of listFilesRecursively(legacyDir)) {
      const rel = relative(legacyDir, source);
      const name = basename(source);
      if (
        !isSprintOwnedTaskArtifact(name, sprintId)
        && name !== TASK_ARTIFACT_PRESERVATION_MARKER_FILE
      ) continue;
      try {
        moveVerified(source, join(destination, rel));
        result.consolidated.push(rel.split(sep).join('/'));
      } catch (error) {
        result.failures.push(rel.split(sep).join('/'));
        debugLog('archiveTaskArtifacts:legacy', error);
      }
    }
    removeEmptyTree(legacyDir);
  }

  // Mid-run prompt cleanup historically used one unowned staging bucket.
  // Filename identity is sufficient for task-bound prompts/workers, so fold
  // only the exact sprint's files and leave ambiguous auditor residue intact.
  const orphanStaging = join(legacyRoot, '_orphaned');
  for (const source of listFilesRecursively(orphanStaging)) {
    const name = basename(source);
    if (!isSprintOwnedTaskArtifact(name, sprintId)) continue;
    try {
      moveVerified(source, join(destination, name));
      result.consolidated.push(`_orphaned/${name}`);
    } catch (error) {
      result.failures.push(`_orphaned/${name}`);
      debugLog('archiveTaskArtifacts:orphan-staging', error);
    }
  }
  removeEmptyTree(orphanStaging);

  if (plan.sweepResidue !== false) {
    let rootEntries: string[] = [];
    try { rootEntries = readdirSync(tasksDir); } catch (error) { debugLog('archiveTaskArtifacts:read', error); }
    for (const name of rootEntries) {
      if (!isSprintOwnedTaskArtifact(name, sprintId)) continue;
      const source = join(tasksDir, name);
      try {
        if (!lstatSync(source).isFile()) continue;
        moveVerified(source, join(destination, name));
        result.residueSwept.push(name);
      } catch (error) {
        result.failures.push(name);
        debugLog('archiveTaskArtifacts:residue', error);
      }
    }
  }
  return result;
}

export function writeTaskArtifactPreservationMarker(
  projectRoot: string,
  sprintId: string,
  entries: readonly string[],
): string | null {
  assertSprintId(sprintId);
  if (entries.length === 0) return null;
  const preservedDestination = join(
    resolveTaskArtifactArchiveDir(projectRoot, sprintId),
    TASK_ARTIFACT_PRESERVED_SUBDIR,
  );
  const marker: TaskArtifactPreservationMarker = {
    kind: TASK_ARTIFACT_PRESERVATION_MARKER_KIND,
    version: 1,
    sprintId,
    reason: 'non-terminal',
    restorePath: TASKS_DIR,
    entries: [...new Set(entries)].sort(),
    recordedAt: new Date().toISOString(),
  };
  const markerPath = join(preservedDestination, TASK_ARTIFACT_PRESERVATION_MARKER_FILE);
  writeJsonAtomic(markerPath, marker);
  return markerPath;
}

function removeEmptyTree(root: string): void {
  if (!existsSync(root)) return;
  let entries;
  try { entries = readdirSync(root, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    if (entry.isDirectory()) removeEmptyTree(join(root, entry.name));
  }
  try { if (readdirSync(root).length === 0) rmdirSync(root); } catch { /* evidence remains */ }
}

function addDirectoryCandidates(
  candidates: ArchiveCandidate[],
  root: string,
  sourceRoot: string,
  targetRoot: string,
  family: SprintArchiveArtifactFamily,
  retireLegacy: boolean,
  filter?: (path: string) => boolean,
): void {
  for (const source of listFilesRecursively(sourceRoot)) {
    if (filter && !filter(source)) continue;
    candidates.push({
      source,
      targetRelative: join(targetRoot, relative(sourceRoot, source)),
      family,
      retireLegacy: retireLegacy && !resolve(source).startsWith(`${resolve(root, DECKENT_DIR, 'recently-works')}${sep}`),
    });
  }
}

function terminalOutcomeFromReceipt(projectRoot: string, sprintId: string, archiveDir: string): string | null {
  const candidates = [
    join(archiveDir, `${sprintId}-terminal-receipt.json`),
    join(projectRoot, DECKENT_DIR, 'recently-works', `${sprintId}-terminal-receipt.json`),
  ];
  for (const path of candidates) {
    try {
      const parsed = JSON.parse(readFileSync(path, 'utf-8')) as {
        terminalOutcome?: unknown;
        receipt?: { terminalOutcome?: unknown };
      };
      const outcome = parsed.receipt?.terminalOutcome ?? parsed.terminalOutcome;
      if (typeof outcome === 'string') return outcome;
    } catch { /* try next authority */ }
  }
  return null;
}

function collectHeartbeatCandidates(
  candidates: ArchiveCandidate[],
  projectRoot: string,
  sprintId: string,
): void {
  const prefix = `${sprintNumber(sprintId)}-`;
  const roots = [
    { root: join(projectRoot, TASKS_DIR, 'worker-heartbeat-authority'), target: 'heartbeat/docker' },
    { root: join(projectRoot, DECKENT_DIR, 'runtime', 'worker-heartbeat-authority'), target: 'heartbeat/in-process' },
  ];
  for (const item of roots) {
    if (!existsSync(item.root)) continue;
    let directories;
    try { directories = readdirSync(item.root, { withFileTypes: true }); } catch { continue; }
    for (const entry of directories) {
      if (!entry.isDirectory()) continue;
      const attemptRoot = join(item.root, entry.name);
      try {
        const parsed = JSON.parse(readFileSync(join(attemptRoot, 'identity.json'), 'utf-8')) as {
          identity?: { taskId?: unknown };
        };
        if (typeof parsed.identity?.taskId !== 'string' || !parsed.identity.taskId.startsWith(prefix)) continue;
      } catch {
        continue;
      }
      addDirectoryCandidates(candidates, projectRoot, attemptRoot, join(item.target, entry.name), 'heartbeat', false);
    }
  }
}

function isSprintTaskEndpoint(taskId: unknown, sprintId: string): taskId is string {
  if (typeof taskId !== 'string') return false;
  const number = sprintNumber(sprintId);
  return new RegExp(`^(?:task-)?${number}-[A-Za-z0-9][A-Za-z0-9._-]*$`, 'u').test(taskId);
}

interface ArchivedPromptRuntimeBinding {
  readonly coreArtifactPath: string;
  readonly coreSha256: string;
  readonly coreBytes: number;
}

/**
 * A runtime receipt is archive authority only when its filename, payload, and
 * provider channel all identify the same exact invocation. The manifest then
 * seals both this provenance receipt and the full-digest core bytes it names.
 */
function archivedPromptRuntimeBinding(
  value: unknown,
  filename: string,
  sprintId: string,
): ArchivedPromptRuntimeBinding | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const receipt = value as Record<string, unknown>;
  const runtime = receipt.runtimeDelivery;
  if (!runtime || typeof runtime !== 'object' || Array.isArray(runtime)) return null;
  const binding = runtime as Record<string, unknown>;
  if (receipt.version !== 2
    || receipt.source !== 'worker-prompt'
    || !isSprintTaskEndpoint(receipt.taskId, sprintId)
    || typeof binding.attemptId !== 'string'
    || !/^[a-z0-9][a-z0-9._-]*$/iu.test(binding.attemptId)
    || typeof binding.provider !== 'string'
    || !/^[a-z0-9][a-z0-9._-]*$/iu.test(binding.provider)
    || typeof binding.coreArtifactPath !== 'string'
    || typeof binding.coreSha256 !== 'string'
    || !/^[a-f0-9]{64}$/u.test(binding.coreSha256)
    || !Number.isSafeInteger(binding.coreBytes)
    || (binding.coreBytes as number) < 0
    || typeof binding.roleProfile !== 'string'
    || binding.roleProfile.length === 0
    || !Array.isArray(binding.contextSuppressionFlags)
    || !binding.contextSuppressionFlags.every(flag => typeof flag === 'string')
    || typeof binding.providerArgvSha256 !== 'string'
    || !/^[a-f0-9]{64}$/u.test(binding.providerArgvSha256)) return null;

  const expectedChannel = binding.provider === 'claude'
    ? 'claude-system-prompt-file'
    : binding.provider === 'codex'
      ? 'codex-model-instructions-file'
      : null;
  const safeProvider = binding.provider.replace(/[^a-z0-9_-]/giu, '_');
  const expectedFilename = `task-${receipt.taskId}.attempt-${binding.attemptId}.`
    + `${safeProvider}.prompt-delivery.json`;
  if (expectedChannel === null
    || binding.injectionChannel !== expectedChannel
    || filename !== expectedFilename) return null;

  return {
    coreArtifactPath: binding.coreArtifactPath,
    coreSha256: binding.coreSha256,
    coreBytes: binding.coreBytes as number,
  };
}

/** Handoff filenames are not authority; endpoints and terminal status are. */
function collectSettledHandoffCandidates(
  candidates: ArchiveCandidate[],
  projectRoot: string,
  sprintId: string,
): void {
  const handoffDir = join(projectRoot, TASKS_DIR, 'handoffs');
  let entries;
  try { entries = readdirSync(handoffDir, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    const source = join(handoffDir, entry.name);
    try {
      const metadata = lstatSync(source);
      if (!metadata.isFile() || metadata.isSymbolicLink()) continue;
      const value = JSON.parse(readFileSync(source, 'utf8')) as Record<string, unknown>;
      if (!isSprintTaskEndpoint(value.fromTaskId, sprintId)
          || !isSprintTaskEndpoint(value.toTaskId, sprintId)
          || (value.status !== 'ready' && value.status !== 'failed')
          || value.id !== `${value.fromTaskId}-to-${value.toTaskId}`) continue;
      candidates.push({
        source,
        targetRelative: join(SPRINT_ARCHIVE_TASKS_SUBDIR, 'handoffs', entry.name),
        family: 'tasks',
        retireLegacy: true,
      });
    } catch {
      // Malformed handoffs are live protocol authority, never archive input.
    }
  }
}

function collectArchiveCandidates(projectRoot: string, sprintId: string): ArchiveCandidate[] {
  const candidates: ArchiveCandidate[] = [];
  const archiveDir = resolveSprintArchiveDir(projectRoot, sprintId);
  const taskTarget = SPRINT_ARCHIVE_TASKS_SUBDIR;
  const legacyTaskDirs = [
    join(projectRoot, BRAIN_DIR, ARCHIVE_DIR, ARCHIVE_SPRINTS_SUBDIR, `${sprintId}-tasks`),
    join(projectRoot, BRAIN_DIR, ARCHIVE_DIR, `${sprintId}-tasks`),
    join(safeConfiguredArchiveBase(projectRoot), `${sprintId}-tasks`),
    join(projectRoot, DECKENT_DIR, ARCHIVE_DIR, ARCHIVE_SPRINTS_SUBDIR, `${sprintId}-tasks`),
  ];
  const tasksArchiveRoot = join(projectRoot, TASKS_DIR, LEGACY_TASK_ARCHIVE_SUBDIR);
  try {
    legacyTaskDirs.push(...readdirSync(tasksArchiveRoot, { withFileTypes: true })
      .filter(entry => entry.isDirectory()
        && (entry.name === sprintId || entry.name.startsWith(`${sprintId}-`)))
      .map(entry => join(tasksArchiveRoot, entry.name)));
  } catch { /* no tasks-local legacy archive */ }
  for (const dir of [...new Set(legacyTaskDirs.map(path => resolve(path)))]) {
    if (dir === resolveTaskArtifactArchiveDir(projectRoot, sprintId)) continue;
    addDirectoryCandidates(
      candidates,
      projectRoot,
      dir,
      taskTarget,
      'tasks',
      true,
      path => isSprintOwnedTaskArtifact(basename(path), sprintId)
        || basename(path) === TASK_ARTIFACT_PRESERVATION_MARKER_FILE,
    );
  }

  const liveTasks = join(projectRoot, TASKS_DIR);
  if (existsSync(join(projectRoot, DECKENT_DIR, 'recently-works', `${sprintId}-terminal-receipt.json`))) {
    let entries: string[] = [];
    try { entries = readdirSync(liveTasks); } catch { /* absent */ }
    for (const name of entries) {
      if (!isSprintOwnedTaskArtifact(name, sprintId)) continue;
      // Attempt receipts enter only as a verified receipt + referenced-core pair.
      if (name.endsWith('.prompt-delivery.json')) continue;
      const source = join(liveTasks, name);
      try {
        if (lstatSync(source).isFile()) {
          candidates.push({ source, targetRelative: join(taskTarget, name), family: 'tasks', retireLegacy: false });
        }
      } catch { /* disappeared during read */ }
    }
    // Runtime prompt receipts are the sole authority for selecting immutable
    // worker-core bytes. Never sweep unreferenced (including legacy short-hash)
    // core files into a new canonical sprint archive.
    for (const name of entries.filter(name => name.endsWith('.prompt-delivery.json'))) {
      const receiptPath = join(liveTasks, name);
      try {
        const binding = archivedPromptRuntimeBinding(
          JSON.parse(readFileSync(receiptPath, 'utf8')) as unknown,
          name,
          sprintId,
        );
        if (!binding) continue;
        const coreName = `.worker-core-${binding.coreSha256}.md`;
        const canonicalCoreSource = join(resolve(projectRoot, TASKS_DIR), coreName);
        const coreSource = resolve(projectRoot, binding.coreArtifactPath);
        if (basename(binding.coreArtifactPath) !== coreName
          || coreSource !== canonicalCoreSource
          || !existsSync(coreSource)) continue;
        const identity = fileIdentity(coreSource);
        if (identity.sha256 !== binding.coreSha256 || identity.bytes !== binding.coreBytes) continue;
        candidates.push({
          source: receiptPath,
          targetRelative: join(taskTarget, name),
          family: 'tasks',
          retireLegacy: false,
        });
        candidates.push({
          source: coreSource,
          targetRelative: join(taskTarget, 'worker-cores', coreName),
          family: 'tasks',
          retireLegacy: false,
        });
      } catch { /* malformed receipt is retained as evidence but grants no core authority */ }
    }
  }

  // Self-healing sweep (live sprint-668 defect, 2026-08-25): the retention/
  // cleanup pass archives delivery receipts and retires their live copies
  // BEFORE this sweep ever sees them, so the referenced worker-core pair was
  // never manifested and terminal verification stayed permanently mismatched.
  // Reconcile describes canonical truth, so archived receipts are swept too;
  // core bytes still come only from the immutable live core artifact.
  {
    const archivedTasksDir = join(
      resolveSprintArchiveDir(projectRoot, sprintId), 'tasks',
    );
    let archivedEntries: string[] = [];
    try { archivedEntries = readdirSync(archivedTasksDir); } catch { /* absent */ }
    for (const name of archivedEntries.filter(entry => entry.endsWith('.prompt-delivery.json'))) {
      const receiptPath = join(archivedTasksDir, name);
      try {
        const binding = archivedPromptRuntimeBinding(
          JSON.parse(readFileSync(receiptPath, 'utf8')) as unknown,
          name,
          sprintId,
        );
        if (!binding) continue;
        const coreName = `.worker-core-${binding.coreSha256}.md`;
        const canonicalCoreSource = join(resolve(projectRoot, TASKS_DIR), coreName);
        const coreSource = resolve(projectRoot, binding.coreArtifactPath);
        if (basename(binding.coreArtifactPath) !== coreName
          || coreSource !== canonicalCoreSource
          || !existsSync(coreSource)) continue;
        const identity = fileIdentity(coreSource);
        if (identity.sha256 !== binding.coreSha256 || identity.bytes !== binding.coreBytes) continue;
        if (!candidates.some(candidate => candidate.targetRelative === join(taskTarget, 'worker-cores', coreName))) {
          candidates.push({
            source: coreSource,
            targetRelative: join(taskTarget, 'worker-cores', coreName),
            family: 'tasks',
            retireLegacy: false,
          });
        }
      } catch { /* malformed archived receipt grants no core authority */ }
    }
  }

  const recentWorks = join(projectRoot, DECKENT_DIR, 'recently-works');
  if (existsSync(recentWorks)) {
    let entries: string[] = [];
    try { entries = readdirSync(recentWorks); } catch { /* absent */ }
    for (const name of entries) {
      if (!name.startsWith(`${sprintId}-`)) continue;
      const source = join(recentWorks, name);
      try {
        if (lstatSync(source).isFile()) {
          candidates.push({ source, targetRelative: name, family: 'run', retireLegacy: false });
        }
      } catch { /* disappeared during read */ }
    }
  }

  addDirectoryCandidates(
    candidates,
    projectRoot,
    join(projectRoot, DECKENT_DIR, 'runtime', 'evaluations', sprintId),
    'evaluations',
    'evaluations',
    false,
  );
  const schedulerCandidates = [
    join(projectRoot, DECKENT_DIR, 'runtime', 'scheduler-shadow', `${sprintId}.jsonl`),
    join(projectRoot, DECKENT_DIR, ARCHIVE_DIR, 'scheduler-shadow', `${sprintId}.jsonl`),
  ];
  for (const source of schedulerCandidates) {
    if (existsSync(source)) candidates.push({
      source,
      targetRelative: join('scheduler', basename(source)),
      family: 'scheduler',
      retireLegacy: source.includes(`${sep}${ARCHIVE_DIR}${sep}`),
    });
  }
  const legacyMetrics = join(
    projectRoot, DECKENT_DIR, ARCHIVE_DIR, 'metrics', `metrics-${sprintId}.jsonl.gz`,
  );
  if (existsSync(legacyMetrics)) candidates.push({
    source: legacyMetrics,
    targetRelative: join('metrics', 'legacy-metrics.jsonl.gz'),
    family: 'metrics',
    retireLegacy: true,
  });
  const job = join(projectRoot, DECKENT_DIR, 'runtime', 'jobs', `${sprintId}.json`);
  if (existsSync(job)) candidates.push({ source: job, targetRelative: 'job.json', family: 'run', retireLegacy: false });
  const checkpoint = join(projectRoot, DECKENT_DIR, `${sprintId}-checkpoint.json`);
  if (existsSync(checkpoint)) candidates.push({
    source: checkpoint,
    targetRelative: basename(checkpoint),
    family: 'run',
    retireLegacy: false,
  });

  const docs = [
    {
      source: join(projectRoot, BRAIN_DIR, ARCHIVE_DIR, 'directives', `DIRECTIVES-${sprintId}.md`),
      target: 'docs/DIRECTIVES.md',
    },
    { source: join(projectRoot, BRAIN_DIR, 'sprints', `${sprintId}.md`), target: 'docs/brain-sprint.md' },
  ];
  for (const item of docs) {
    if (existsSync(item.source)) candidates.push({
      source: item.source,
      targetRelative: item.target,
      family: 'docs',
      retireLegacy: false,
    });
  }
  addDirectoryCandidates(
    candidates,
    projectRoot,
    join(projectRoot, BRAIN_DIR, ARCHIVE_DIR, 'audits', sprintId),
    'audits',
    'audits',
    false,
  );
  addDirectoryCandidates(
    candidates,
    projectRoot,
    join(projectRoot, 'docs', 'audits', sprintId),
    'audits/project-docs',
    'audits',
    false,
  );
  const supervisorLog = join(projectRoot, BRAIN_DIR, 'logs', `${sprintId}-supervisor.log`);
  if (existsSync(supervisorLog)) candidates.push({
    source: supervisorLog,
    targetRelative: 'supervisor.log',
    family: 'run',
    retireLegacy: false,
  });
  collectHeartbeatCandidates(candidates, projectRoot, sprintId);
  collectSettledHandoffCandidates(candidates, projectRoot, sprintId);

  // Existing canonical evidence is included during manifest construction, not
  // copied back onto itself.
  return candidates.filter(candidate => {
    const source = resolve(candidate.source);
    const target = resolve(archiveDir, candidate.targetRelative);
    return source !== target && existsSync(source);
  });
}

function familyForCanonicalPath(path: string): SprintArchiveArtifactFamily {
  const normalized = path.split(sep).join('/');
  if (normalized.startsWith('tasks/')) return 'tasks';
  if (normalized.startsWith('evaluations/')) return 'evaluations';
  if (normalized.startsWith('metrics/')) return 'metrics';
  if (normalized.startsWith('scheduler/')) return 'scheduler';
  if (normalized.startsWith('heartbeat/')) return 'heartbeat';
  if (normalized.startsWith('docs/')) return 'docs';
  if (normalized.startsWith('audits/')) return 'audits';
  return 'run';
}

function readMemoryReferences(projectRoot: string, sprintId: string): SprintArchiveMemoryReference[] {
  const dbPath = join(projectRoot, BRAIN_DIR, MEMORY_DB_FILE);
  if (!existsSync(dbPath)) return [];
  const number = Number.parseInt(sprintNumber(sprintId), 10);
  let db: Database.Database | null = null;
  try {
    db = new Database(dbPath, { readonly: true, fileMustExist: true });
    const rows = db.prepare(`
      SELECT id, type, updated_at AS updatedAt, content, metadata
      FROM entries
      WHERE deleted_at IS NULL
        AND id != ?
        AND (sprint_id = ? OR sprint_num = ?)
      ORDER BY id
    `).all(`archive-${sprintId}`, sprintId, number) as Array<{
      id: string;
      type: string;
      updatedAt: string;
      content: string;
      metadata: string;
    }>;
    return rows.map(row => ({
      id: row.id,
      type: row.type,
      updatedAt: row.updatedAt,
      digest: createHash('sha256').update(JSON.stringify(row)).digest('hex'),
    }));
  } catch (error) {
    debugLog('sprintArchive:memoryRefs', error);
    return [];
  } finally {
    db?.close();
  }
}

function emptyFamilyCounts(): Record<SprintArchiveArtifactFamily, number> {
  return {
    run: 0,
    tasks: 0,
    evaluations: 0,
    metrics: 0,
    scheduler: 0,
    heartbeat: 0,
    docs: 0,
    audits: 0,
    unknown: 0,
  };
}

function manifestPayloadDigest(manifest: Omit<SprintArchiveManifest, 'contentDigest'>): string {
  return createHash('sha256').update(JSON.stringify(manifest)).digest('hex');
}

function writeJsonAtomic(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = join(dirname(path), `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`);
  let descriptor: number | undefined;
  try {
    descriptor = openSync(temporary, 'wx', 0o600);
    writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`, 'utf-8');
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    renameSync(temporary, path);
    const directoryDescriptor = openSync(dirname(path), 'r');
    try { fsyncSync(directoryDescriptor); } finally { closeSync(directoryDescriptor); }
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    try { unlinkSync(temporary); } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
}

function upsertMemoryArchiveIndex(
  projectRoot: string,
  manifest: SprintArchiveManifest,
  archiveDir: string,
): void {
  const dbPath = safeBrainDatabasePath(projectRoot);
  if (!dbPath) return;
  const store = new MemoryStore(dbPath);
  try {
    const familySummary = Object.entries(manifest.familyCounts)
      .filter(([, count]) => count > 0)
      .map(([family, count]) => `${family}=${count}`)
      .join(', ');
    const id = `archive-${manifest.sprintId}`;
    const content = [
      `Canonical archive: ${relativePortable(projectRoot, archiveDir)}`,
      `Outcome: ${manifest.terminalOutcome ?? 'UNKNOWN'}`,
      `Artifacts: ${manifest.artifactCount}`,
      `Bytes: ${manifest.totalBytes}`,
      `Families: ${familySummary}`,
      `Manifest digest: sha256:${manifest.contentDigest}`,
    ].join('\n');
    const summary = `${manifest.artifactCount} artifacts; ${manifest.terminalOutcome ?? 'UNKNOWN'}`;
    const tags = ['sprint-archive', manifest.sprintId, manifest.terminalOutcome ?? 'unknown'];
    const existing = store.getById(id);
    const metadata: Record<string, unknown> = {
      kind: SPRINT_ARCHIVE_MANIFEST_KIND,
      schemaVersion: SPRINT_ARCHIVE_MANIFEST_VERSION,
      manifestPath: relativePortable(projectRoot, join(archiveDir, SPRINT_ARCHIVE_MANIFEST_FILE)),
      manifestDigest: `sha256:${manifest.contentDigest}`,
      artifactCount: manifest.artifactCount,
      totalBytes: manifest.totalBytes,
    };
    try {
      const previous = existing ? JSON.parse(existing.metadata) as Record<string, unknown> : null;
      if (previous && previous.manifestDigest === metadata.manifestDigest
          && typeof previous.guardedSummarySha256 === 'string'
          && SHA256_HEX_PATTERN.test(previous.guardedSummarySha256.slice('sha256:'.length))) {
        metadata.guardedSummarySha256 = previous.guardedSummarySha256;
      }
    } catch { /* malformed historical metadata is replaced by the canonical index */ }
    if (
      existing?.type === 'sprint-archive'
      && existing.source === 'brain'
      && existing.title === `${manifest.sprintId} archive evidence`
      && existing.content === content
      && existing.summary === summary
      && existing.tag_text === tags.join(' ')
      && existing.status === 'active'
      && existing.priority === 'normal'
      && existing.sprint_id === manifest.sprintId
      && existing.sprint_num === Number.parseInt(sprintNumber(manifest.sprintId), 10)
      && existing.lang === 'en'
      && existing.decay_exempt
      && existing.metadata === JSON.stringify(metadata)
      && (existing.tenant_id ?? null) === null
      && existing.deleted_at === null
    ) return;
    store.upsert({
      id,
      type: 'sprint-archive',
      title: `${manifest.sprintId} archive evidence`,
      content,
      summary,
      source: 'brain',
      status: 'active',
      sprint_id: manifest.sprintId,
      sprint_num: Number.parseInt(sprintNumber(manifest.sprintId), 10),
      tags,
      decay_exempt: true,
      metadata,
    }, 'sprint-archive-reconciler');
  } finally {
    store.close();
  }
}

export function reconcileSprintArchive(
  projectRoot: string,
  sprintId: string,
  options: SprintArchiveReconcileOptions = {},
): SprintArchiveReconcileReport {
  assertSprintId(sprintId);
  const apply = options.apply === true;
  const archiveDir = resolveSprintArchiveDir(projectRoot, sprintId);
  const manifestPath = join(archiveDir, SPRINT_ARCHIVE_MANIFEST_FILE);
  const priorManifest = readManifest(manifestPath);
  const candidates = collectArchiveCandidates(projectRoot, sprintId);
  const published: PublishedCandidate[] = [];
  const failures: string[] = [];
  const plannedIdentities = new Map<string, { bytes: number; sha256: string }>();
  let retired = 0;

  for (const candidate of candidates) {
    try {
      const identity = fileIdentity(candidate.source);
      const requestedDestination = join(archiveDir, candidate.targetRelative);
      if (!apply) {
        const requestedIdentity = plannedIdentities.get(resolve(requestedDestination))
          ?? (existsSync(requestedDestination) ? fileIdentity(requestedDestination) : null);
        let plannedDestination = requestedDestination;
        let state: PublishedCandidate['state'] = 'planned';
        if (
          requestedIdentity
          && (requestedIdentity.bytes !== identity.bytes || requestedIdentity.sha256 !== identity.sha256)
        ) {
          plannedDestination = conflictDestination(requestedDestination, identity.sha256);
          state = 'conflict';
          const conflictIdentity = plannedIdentities.get(resolve(plannedDestination))
            ?? (existsSync(plannedDestination) ? fileIdentity(plannedDestination) : null);
          if (
            conflictIdentity
            && (conflictIdentity.bytes !== identity.bytes || conflictIdentity.sha256 !== identity.sha256)
          ) {
            throw new DeckentError(
              'ARCHIVE_CONFLICT_COLLISION',
              `ARCHIVE_CONFLICT_COLLISION:${plannedDestination}`,
            );
          }
        }
        plannedIdentities.set(resolve(plannedDestination), identity);
        published.push({
          ...candidate,
          actualTargetRelative: relative(archiveDir, plannedDestination),
          ...identity,
          state,
        });
        continue;
      }
      const publication = publishVerifiedCopy(candidate.source, requestedDestination);
      const actualTargetRelative = relative(archiveDir, publication.destination);
      published.push({
        ...candidate,
        actualTargetRelative,
        ...publication.identity,
        state: publication.state,
      });
      if (options.retireLegacySources === true && candidate.retireLegacy) {
        const destinationIdentity = fileIdentity(publication.destination);
        if (
          destinationIdentity.bytes !== publication.identity.bytes
          || destinationIdentity.sha256 !== publication.identity.sha256
        ) {
          throw new DeckentError(
            'ARCHIVE_RETIREMENT_DIGEST_MISMATCH',
            `ARCHIVE_RETIREMENT_DIGEST_MISMATCH:${candidate.source}`,
          );
        }
        unlinkSync(candidate.source);
        removeEmptyTree(dirname(candidate.source));
        retired += 1;
      }
    } catch (error) {
      failures.push(`${relativePortable(projectRoot, candidate.source)}:${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const sourceMap = new Map<string, Set<string>>();
  for (const artifact of priorManifest?.artifacts ?? []) {
    sourceMap.set(artifact.path, new Set(artifact.sources));
  }
  for (const item of published) {
    const key = item.actualTargetRelative.split(sep).join('/');
    const sources = sourceMap.get(key) ?? new Set<string>();
    sources.add(relativePortable(projectRoot, item.source));
    sourceMap.set(key, sources);
  }

  // Inspect/dry-run must describe existing canonical truth as well as newly
  // discovered legacy candidates. Earlier code returned an empty manifest for
  // a fully reconciled archive because it enumerated canonical files only in
  // apply mode.
  // The application receipt binds the final manifest digest and therefore is
  // an integrity sidecar, not a manifest member (including it would create a
  // self-referential digest). Its own digest is bound by terminal verification.
  const terminalApplicationPath = join(archiveDir, TERMINAL_SEAL_APPLICATION_FILE);
  const artifactFiles = listFilesRecursively(archiveDir)
    .filter(path => path !== manifestPath && path !== terminalApplicationPath);
  const plannedOnly = apply ? [] : published;
  const artifactsByPath = new Map<string, SprintArchiveManifestArtifact>();
  for (const path of artifactFiles) {
    const rel = relative(archiveDir, path).split(sep).join('/');
    const identity = fileIdentity(path);
    artifactsByPath.set(rel, {
      path: rel,
      family: familyForCanonicalPath(rel),
      ...identity,
      sources: [...(sourceMap.get(rel) ?? new Set([rel]))].sort(),
    });
  }
  for (const item of plannedOnly) {
    const rel = item.actualTargetRelative.split(sep).join('/');
    const existing = artifactsByPath.get(rel);
    if (existing && existing.bytes === item.bytes && existing.sha256 === item.sha256) {
      artifactsByPath.set(rel, {
        ...existing,
        sources: [...(sourceMap.get(rel) ?? new Set(existing.sources))].sort(),
      });
      continue;
    }
    artifactsByPath.set(rel, {
      path: rel,
      family: item.family,
      bytes: item.bytes,
      sha256: item.sha256,
      sources: [relativePortable(projectRoot, item.source)],
    });
  }
  const artifacts = [...artifactsByPath.values()];

  const grouped = new Map<string, Set<string>>();
  for (const artifact of artifacts) {
    const conflictMatch = /^(.*\/)?conflicts\/(.+)\.[0-9a-f]{16}$/u.exec(artifact.path);
    const logicalPath = conflictMatch
      ? `${conflictMatch[1] ?? ''}${conflictMatch[2] ?? ''}`
      : artifact.path;
    const variants = grouped.get(logicalPath) ?? new Set<string>();
    variants.add(artifact.path);
    grouped.set(logicalPath, variants);
  }
  const conflicts = [...grouped.entries()]
    .filter(([, variants]) => variants.size > 1)
    .map(([path, variants]) => ({ path, variants: [...variants].sort() }))
    .sort((left, right) => left.path.localeCompare(right.path));
  artifacts.sort((left, right) => left.path.localeCompare(right.path));
  const familyCounts = emptyFamilyCounts();
  let totalBytes = 0;
  for (const artifact of artifacts) {
    familyCounts[artifact.family] += 1;
    totalBytes += artifact.bytes;
  }
  const memoryReferences = readMemoryReferences(projectRoot, sprintId);
  const payload: Omit<SprintArchiveManifest, 'contentDigest'> = {
    kind: SPRINT_ARCHIVE_MANIFEST_KIND,
    schemaVersion: SPRINT_ARCHIVE_MANIFEST_VERSION,
    sprintId,
    terminalOutcome: terminalOutcomeFromReceipt(projectRoot, sprintId, archiveDir),
    artifactCount: artifacts.length,
    totalBytes,
    familyCounts,
    artifacts,
    conflicts,
    memoryReferences,
  };
  const manifest: SprintArchiveManifest = { ...payload, contentDigest: manifestPayloadDigest(payload) };
  if (apply && failures.length === 0) {
    writeJsonAtomic(manifestPath, manifest);
    if (options.indexMemory !== false) upsertMemoryArchiveIndex(projectRoot, manifest, archiveDir);
  }

  return {
    sprintId,
    archiveDir,
    manifestPath,
    applied: apply,
    discovered: candidates.length,
    published: published.filter(item => item.state === 'published').length,
    deduplicated: published.filter(item => item.state === 'deduplicated').length,
    retired,
    conflicts: published.filter(item => item.state === 'conflict').length,
    failures,
    manifest,
  };
}

function readManifest(path: string): SprintArchiveManifest | null {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as SprintArchiveManifest;
    if (
      parsed.kind !== SPRINT_ARCHIVE_MANIFEST_KIND
      || parsed.schemaVersion !== SPRINT_ARCHIVE_MANIFEST_VERSION
      || !SPRINT_ID_PATTERN.test(parsed.sprintId)
      || !Array.isArray(parsed.artifacts)
    ) return null;
    return parsed;
  } catch {
    return null;
  }
}

export interface SprintArchiveTerminalEventIdentity {
  readonly sequence: number;
  readonly digest: string;
}

export interface SprintArchiveTerminalSealRequest {
  readonly receipt: SprintTerminalReceiptV1;
  readonly finalEvent: SprintArchiveTerminalEventIdentity;
  /** Must resolve to the one canonical hot journal for this sprint. */
  readonly hotJournalPath?: string;
  /** Null means that no archived journal is expected to exist. */
  readonly expectedArchivedPreimageSha256: string | null;
  readonly expectedHotJournalSha256: string;
  readonly operatorReason: string;
  /** Operator repair requests require compact Brain + guarded export adoption. */
  readonly adoptBrain?: boolean;
  /** Canonical digest of the outer lifecycle events requested by the ingress. */
  readonly terminalEventsProjectionSha256?: string | null;
  /** Canonical digest of the post-seal policy admitted by the outer ingress. */
  readonly postSealPolicySha256?: string | null;
}

export type SprintArchiveTerminalSealHoldReason =
  | 'missing_terminal_marker'
  | 'terminal_identity_mismatch'
  | 'invalid_final_event'
  | 'invalid_hot_journal_path'
  | 'invalid_archive_path'
  | 'invalid_operator_reason'
  | 'invalid_expected_digest'
  | 'preimage_mismatch'
  | 'sequence_counter_mismatch'
  | 'append_race'
  | 'non_prefix_divergence'
  | 'manifest_conflict'
  | 'archive_tampered'
  | 'untracked_artifact'
  | 'seal_locked'
  | 'seal_write_failed'
  | 'brain_adoption_failed'
  | 'application_not_applied';

export interface SprintArchiveTerminalSealReceipt {
  readonly kind: 'deckent.sprint-archive-terminal-seal';
  readonly version: 1;
  readonly sprintId: string;
  readonly runId: string;
  readonly coordinatorGeneration: number;
  readonly terminalOutcome: string;
  readonly logicalSettlementDigest: string;
  readonly priorAuthorityVersion: number;
  readonly authorityVersion: number;
  readonly terminalReceipt: SprintTerminalReceiptV1;
  readonly finalEvent: SprintArchiveTerminalEventIdentity;
  readonly canonicalHotJournalPath: string;
  readonly expectedArchivedPreimageSha256: string | null;
  readonly hotJournalSha256: string;
  readonly archivedJournalSha256: string;
  readonly operatorReason: string;
  readonly operatorReasonSha256: string;
  readonly brainAdoptionRequired: boolean;
  readonly terminalEventsProjectionSha256: string | null;
  readonly postSealPolicySha256: string | null;
  readonly repairedHistoryPath: string | null;
  readonly repairedHistorySha256: string | null;
  readonly sequenceCounterValue: number;
  readonly sequenceCounterSha256: string;
  readonly expectedArchivedSequencePreimageSha256: string | null;
  readonly repairedSequenceHistoryPath: string | null;
  readonly repairedSequenceHistorySha256: string | null;
  readonly originalDisposition: 'sealed' | 'repaired';
}

export interface SprintArchiveTerminalApplicationReceipt {
  readonly kind: 'deckent.sprint-archive-terminal-application';
  readonly version: 1;
  readonly sprintId: string;
  readonly state: 'staged' | 'applied';
  readonly sealReceiptSha256: string;
  readonly manifestDigest?: string;
  readonly brainAdopted?: boolean;
  readonly brainIndexSha256?: string | null;
  readonly guardedSummarySha256?: string | null;
}

export interface SprintArchiveTerminalSealResult {
  readonly disposition: 'sealed' | 'repaired' | 'idempotent' | 'hold';
  readonly terminalComplete: boolean;
  readonly reasonCode?: SprintArchiveTerminalSealHoldReason;
  readonly receipt?: SprintArchiveTerminalSealReceipt;
  readonly applicationReceipt?: SprintArchiveTerminalApplicationReceipt;
  /**
   * Exact verification produced inside the same terminal commit.
   *
   * This is output-only authority: callers cannot inject it through the seal
   * request.  The first writer therefore hands its already-validated Brain
   * projection to the outer finalizer without forcing an immediate detached
   * SQLite/WAL re-open.  Later public/replay verification remains independent.
   */
  readonly verification?: SprintArchiveTerminalVerificationReport;
}

export interface SprintArchiveTerminalVerificationReport {
  readonly sprintId: string;
  readonly ok: boolean;
  readonly reasonCodes: readonly SprintArchiveTerminalSealHoldReason[];
  readonly manifestDigest: string | null;
  readonly sealReceiptSha256: string | null;
  readonly brainIndexSha256: string | null;
  readonly guardedSummarySha256: string | null;
}

const SHA256_HEX_PATTERN = /^[a-f0-9]{64}$/u;
const OPERATOR_REASON_CONTROL_PATTERN = /[\u0000-\u001f\u007f]/u;

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function isTerminalReceipt(value: unknown): value is SprintTerminalReceiptV1 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Partial<SprintTerminalReceiptV1>;
  return record.version === 1
    && typeof record.sprintId === 'string' && record.sprintId.length > 0
    && typeof record.runId === 'string' && record.runId.length > 0
    && Number.isSafeInteger(record.coordinatorGeneration) && (record.coordinatorGeneration ?? 0) > 0
    && (record.terminalOutcome === 'COMPLETE' || record.terminalOutcome === 'ABORTED')
    && typeof record.logicalSettlementDigest === 'string'
    && SHA256_HEX_PATTERN.test(record.logicalSettlementDigest)
    && Number.isSafeInteger(record.priorAuthorityVersion) && (record.priorAuthorityVersion ?? -1) >= 0
    && Number.isSafeInteger(record.authorityVersion) && (record.authorityVersion ?? -1) >= 0;
}

function exactReceiptEquals(value: unknown, receipt: SprintTerminalReceiptV1): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const wrapper = value as Record<string, unknown>;
  const record = wrapper.receipt && typeof wrapper.receipt === 'object' && !Array.isArray(wrapper.receipt)
    ? wrapper.receipt as Record<string, unknown>
    : wrapper;
  return record.version === receipt.version
    && record.sprintId === receipt.sprintId
    && record.runId === receipt.runId
    && record.coordinatorGeneration === receipt.coordinatorGeneration
    && record.terminalOutcome === receipt.terminalOutcome
    && record.logicalSettlementDigest === receipt.logicalSettlementDigest
    && record.priorAuthorityVersion === receipt.priorAuthorityVersion
    && record.authorityVersion === receipt.authorityVersion;
}

function readJournalSnapshot(path: string): {
  readonly bytes: Buffer;
  readonly sequence: number;
  readonly digest: string;
} | null {
  try {
    const metadata = lstatSync(path);
    if (!metadata.isFile() || metadata.isSymbolicLink()) return null;
    const bytes = readFileSync(path);
    const lines = bytes.toString('utf8').split(/\r?\n/u).filter(line => line !== '');
    const finalLine = lines.at(-1);
    if (!finalLine) return null;
    const parsed = JSON.parse(finalLine) as { sequence?: unknown };
    if (!Number.isSafeInteger(parsed.sequence) || (parsed.sequence as number) < 1) return null;
    return { bytes, sequence: parsed.sequence as number, digest: sha256(finalLine) };
  } catch {
    return null;
  }
}

function readSequenceSnapshot(path: string): { readonly bytes: Buffer; readonly value: number; readonly digest: string } | null {
  try {
    const metadata = lstatSync(path);
    if (!metadata.isFile() || metadata.isSymbolicLink()) return null;
    const bytes = readFileSync(path);
    const raw = bytes.toString('utf8');
    if (!/^(?:0|[1-9]\d*)$/u.test(raw)) return null;
    const value = Number(raw);
    if (!Number.isSafeInteger(value) || value < 0) return null;
    return { bytes, value, digest: sha256(bytes) };
  } catch {
    return null;
  }
}

/** Retire only the exact counter bound by an applied terminal seal. */
function retireHotSequenceCounter(
  projectRoot: string,
  sprintId: string,
  expected: Pick<SprintArchiveTerminalSealReceipt, 'sequenceCounterValue' | 'sequenceCounterSha256'>,
): boolean {
  const path = join(projectRoot, DECKENT_DIR, 'recently-works', `${sprintId}-seq`);
  if (!existsSync(path)) return true;
  const before = readSequenceSnapshot(path);
  if (!before || before.value !== expected.sequenceCounterValue
      || before.digest !== expected.sequenceCounterSha256) return false;
  const confirmed = readSequenceSnapshot(path);
  if (!confirmed || !confirmed.bytes.equals(before.bytes)
      || confirmed.value !== expected.sequenceCounterValue
      || confirmed.digest !== expected.sequenceCounterSha256) return false;
  try {
    unlinkSync(path);
  } catch {
    return false;
  }
  return !existsSync(path);
}

/** Pure path adapter used by native authority and win32 regression tests. */
export function isSprintArchivePathContained(
  root: string,
  candidate: string,
  flavor: 'native' | 'win32' = 'native',
): boolean {
  const pathApi = flavor === 'win32' ? win32 : { resolve, relative, isAbsolute };
  const projected = pathApi.relative(pathApi.resolve(root), pathApi.resolve(candidate));
  return projected !== '' && projected !== '..'
    && !projected.startsWith(`..${flavor === 'win32' ? '\\' : sep}`)
    && !pathApi.isAbsolute(projected);
}

/** Reject symlink/junction redirection in every existing namespace component below the project root. */
function isArchiveNamespaceLinkFree(projectRoot: string, candidate: string): boolean {
  const root = resolve(projectRoot);
  const target = resolve(candidate);
  const projected = relative(root, target);
  if (projected === '' || projected === '..' || projected.startsWith(`..${sep}`) || isAbsolute(projected)) {
    return false;
  }
  let current = root;
  for (const segment of projected.split(sep)) {
    current = join(current, segment);
    try {
      if (lstatSync(current).isSymbolicLink()) return false;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return true;
      return false;
    }
  }
  return true;
}

/** Public fail-closed namespace predicate shared by outer lifecycle replay admission. */
export function isSprintArchiveNamespaceSafe(projectRoot: string, sprintId: string): boolean {
  const archiveDir = resolveSprintArchiveDir(projectRoot, sprintId);
  if (!isArchiveNamespaceLinkFree(projectRoot, archiveDir)) return false;
  try {
    return lstatSync(archiveDir).isDirectory();
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ENOENT';
  }
}

function canonicalHotJournalPath(projectRoot: string, sprintId: string, supplied?: string): string | null {
  const canonical = resolve(projectRoot, DECKENT_DIR, 'recently-works', `${sprintId}-events.jsonl`);
  if (supplied !== undefined && resolve(supplied) !== canonical) return null;
  try {
    if (!isArchiveNamespaceLinkFree(projectRoot, canonical)) return null;
    const rootReal = realpathSync(resolve(projectRoot));
    const hotReal = realpathSync(canonical);
    const metadata = lstatSync(canonical);
    if (!metadata.isFile() || metadata.isSymbolicLink()
        || !isSprintArchivePathContained(rootReal, hotReal)) return null;
  } catch {
    return null;
  }
  return canonical;
}

function terminalMarker(projectRoot: string, sprintId: string): unknown | null {
  const path = join(projectRoot, DECKENT_DIR, 'recently-works', `${sprintId}-terminal-receipt.json`);
  try {
    const metadata = lstatSync(path);
    if (!metadata.isFile() || metadata.isSymbolicLink()) return null;
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

function sealReceiptDigest(receipt: SprintArchiveTerminalSealReceipt): string {
  return sha256(canonicalJson(receipt));
}

function deterministicHistoryPath(sprintId: string, digest: string): string {
  return `journal-history/${sprintId}-events.jsonl.${digest}`;
}

function deterministicSequenceHistoryPath(sprintId: string, digest: string): string {
  return `sequence-history/${sprintId}-seq.${digest}`;
}

function exactSealReceipt(value: unknown, expected: SprintArchiveTerminalSealReceipt): boolean {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && canonicalJson(value) === canonicalJson(expected);
}

function readJson(path: string): unknown | null {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
}

function sealHold(
  reasonCode: SprintArchiveTerminalSealHoldReason,
  receipt?: SprintArchiveTerminalSealReceipt,
  applicationReceipt?: SprintArchiveTerminalApplicationReceipt,
): SprintArchiveTerminalSealResult {
  return {
    disposition: 'hold',
    terminalComplete: false,
    reasonCode,
    ...(receipt ? { receipt } : {}),
    ...(applicationReceipt ? { applicationReceipt } : {}),
  };
}

/**
 * Load a SQLite authority as a detached, process-owned snapshot.
 *
 * Opening a WAL-mode database with SQLite's file-backed `readonly` option can
 * still create or touch `-shm`.  Terminal verification must be observational,
 * so it never gives SQLite the authority path.  Exact source DB/WAL bytes are
 * copied under a process-owned temp directory after a before/after stat CAS;
 * SQLite may create SHM only beside that detached copy.  Concurrent snapshot
 * drift is rejected fail-closed and no authority bytes are written.
 */
interface ImmutableSqliteSnapshot {
  readonly directory: string;
  readonly databasePath: string;
}

function sameFileSnapshot(
  before: Stats,
  after: Stats,
): boolean {
  return before.dev === after.dev && before.ino === after.ino && before.size === after.size
    && before.mtimeMs === after.mtimeMs && before.ctimeMs === after.ctimeMs;
}

function removeImmutableSqliteSnapshot(directory: string): void {
  try {
    for (const entry of readdirSync(directory)) {
      try { unlinkSync(join(directory, entry)); } catch { /* bounded process-owned residue */ }
    }
    rmdirSync(directory);
  } catch { /* process temp cleanup is best-effort */ }
}

function immutableSqliteSnapshot(path: string): ImmutableSqliteSnapshot | null {
  const walPath = `${path}-wal`;
  let directory: string | null = null;
  try {
    const linkMetadata = lstatSync(path);
    if (!linkMetadata.isFile() || linkMetadata.isSymbolicLink()) return null;
    const databaseBefore = statSync(path);
    const walPresent = existsSync(walPath);
    const walBefore = walPresent ? statSync(walPath) : null;
    if (walPresent && (!lstatSync(walPath).isFile() || lstatSync(walPath).isSymbolicLink())) return null;
    const databaseBytes = readFileSync(path);
    const walBytes = walPresent ? readFileSync(walPath) : null;
    const databaseConfirmation = readFileSync(path);
    const walConfirmation = walPresent ? readFileSync(walPath) : null;
    const databaseAfter = statSync(path);
    const walStillPresent = existsSync(walPath);
    const walAfter = walStillPresent ? statSync(walPath) : null;
    if (!databaseBytes.equals(databaseConfirmation)
        || walBytes !== null && (walConfirmation === null || !walBytes.equals(walConfirmation))
        || !sameFileSnapshot(databaseBefore, databaseAfter) || walPresent !== walStillPresent
        || walBefore !== null && (walAfter === null || !sameFileSnapshot(walBefore, walAfter))) return null;
    if (databaseBytes.length < 100
        || databaseBytes.subarray(0, 16).toString('binary') !== 'SQLite format 3\0') return null;
    if (walBytes !== null && walBytes.length > 0) {
      if (walBytes.length < 32) return null;
      const magic = walBytes.readUInt32BE(0);
      const declaredPageSize = walBytes.readUInt32BE(8);
      const pageSize = declaredPageSize === 1 ? 65_536 : declaredPageSize;
      if ((magic !== 0x377f0682 && magic !== 0x377f0683)
          || pageSize < 512 || pageSize > 65_536 || (pageSize & (pageSize - 1)) !== 0
          || (walBytes.length - 32) % (pageSize + 24) !== 0) return null;
    }

    directory = mkdtempSync(join(tmpdir(), 'deckent-brain-projection-'));
    const databasePath = join(directory, MEMORY_DB_FILE);
    writeFileSync(databasePath, databaseBytes, { mode: 0o600 });
    if (walBytes !== null && walBytes.length > 0) {
      writeFileSync(`${databasePath}-wal`, walBytes, { mode: 0o600 });
    }
    return { directory, databasePath };
  } catch {
    if (directory !== null) removeImmutableSqliteSnapshot(directory);
    return null;
  }
}

interface BrainArchiveProjectionEntry {
  readonly id: string;
  readonly type: string;
  readonly content: string;
  readonly summary: string | null;
  readonly metadata: string;
}

/**
 * Brain adoption may never escape the repo-local `.brain` namespace through
 * a symlink or junction. Resolve the project root once so a workspace entered
 * through a symlink remains valid, while the namespace and DB leaf themselves
 * must be ordinary directory/file entries under that canonical root.
 */
function safeBrainDatabasePath(projectRoot: string): string | null {
  const brainDir = join(projectRoot, BRAIN_DIR);
  const dbPath = join(brainDir, MEMORY_DB_FILE);
  try {
    const brainMetadata = lstatSync(brainDir);
    const databaseMetadata = lstatSync(dbPath);
    if (!brainMetadata.isDirectory() || brainMetadata.isSymbolicLink()
        || !databaseMetadata.isFile() || databaseMetadata.isSymbolicLink()) return null;
    const canonicalRoot = realpathSync(projectRoot);
    const canonicalBrain = realpathSync(brainDir);
    const canonicalDatabase = realpathSync(dbPath);
    if (canonicalBrain !== join(canonicalRoot, BRAIN_DIR)
        || dirname(canonicalDatabase) !== canonicalBrain
        || basename(canonicalDatabase) !== MEMORY_DB_FILE) return null;
    return dbPath;
  } catch {
    return null;
  }
}

function readBrainProjectionEntry(
  dbPath: string,
  sprintId: string,
): BrainArchiveProjectionEntry | null {
  const snapshot = immutableSqliteSnapshot(dbPath);
  if (!snapshot) return null;
  let db: Database.Database | null = null;
  try {
    db = new Database(snapshot.databasePath, { readonly: true, fileMustExist: true });
    return db.prepare(`
      SELECT id, type, content, summary, metadata
      FROM entries
      WHERE id = ? AND deleted_at IS NULL
    `).get(`archive-${sprintId}`) as BrainArchiveProjectionEntry | undefined ?? null;
  } catch {
    return null;
  } finally {
    try { db?.close(); } finally { removeImmutableSqliteSnapshot(snapshot.directory); }
  }
}

const TRUSTED_BRAIN_PROJECTION = Symbol('trusted-brain-projection');

interface TrustedBrainProjection {
  readonly [TRUSTED_BRAIN_PROJECTION]: true;
  readonly sprintId: string;
  readonly manifestDigest: string;
  readonly brainIndexSha256: string;
  /** The guarded summary digest recorded in this sprint's archive-index row. */
  readonly guardedSummarySha256: string;
}

function brainAdoptionProjection(
  projectRoot: string,
  sprintId: string,
  manifestDigest: string,
  refresh: boolean,
  renderOptions?: MemoryExportRenderOptions,
): TrustedBrainProjection | null {
  const dbPath = safeBrainDatabasePath(projectRoot);
  if (!dbPath) return null;
  let entry: BrainArchiveProjectionEntry | null = null;
  const summaryPath = join(projectRoot, BRAIN_DIR, 'exports', 'summary.md');
  if (refresh) {
    const store = new MemoryStore(dbPath);
    try {
      const adopted = store.getById(`archive-${sprintId}`);
      if (!adopted) return null;
      const guarded = writeGuardedExports(store, join(projectRoot, BRAIN_DIR, 'exports'), renderOptions);
      if (guarded.warnings.length > 0 || !guarded.written.includes('summary.md')) return null;
      const guardedSummarySha256 = hashFile(summaryPath);
      if (!SHA256_HEX_PATTERN.test(guardedSummarySha256)) return null;
      let metadata: Record<string, unknown>;
      try { metadata = JSON.parse(adopted.metadata) as Record<string, unknown>; } catch { return null; }
      if (metadata.manifestDigest !== `sha256:${manifestDigest}`) return null;
      // Bind the exact guarded export rendered by this adoption to the archive
      // row. The global summary is intentionally refreshed by later canonical
      // adoptions, so replay validates this immutable per-sprint binding rather
      // than requiring unrelated later summary bytes to remain unchanged.
      store.update(adopted.id, {
        metadata: JSON.stringify({ ...metadata, guardedSummarySha256: `sha256:${guardedSummarySha256}` }),
      }, 'terminal-archive-seal');
      const bound = store.getById(adopted.id);
      if (!bound) return null;
      entry = {
        id: bound.id,
        type: bound.type,
        content: bound.content,
        summary: bound.summary,
        metadata: bound.metadata,
      };
    } finally {
      store.close();
    }
  } else {
    entry = readBrainProjectionEntry(dbPath, sprintId);
  }
  if (!entry) return null;
  let metadata: Record<string, unknown>;
  try { metadata = JSON.parse(entry.metadata) as Record<string, unknown>; } catch { return null; }
  if (metadata.manifestDigest !== `sha256:${manifestDigest}`
      || typeof metadata.guardedSummarySha256 !== 'string'
      || !SHA256_HEX_PATTERN.test(metadata.guardedSummarySha256.slice('sha256:'.length))) return null;
  return {
    [TRUSTED_BRAIN_PROJECTION]: true,
    sprintId,
    manifestDigest,
    brainIndexSha256: sha256(canonicalJson({
      id: entry.id,
      type: entry.type,
      content: entry.content,
      summary: entry.summary,
      metadata: entry.metadata,
    })),
    guardedSummarySha256: metadata.guardedSummarySha256.slice('sha256:'.length),
  };
}

function validateRepairedHistory(
  archiveDir: string,
  receipt: SprintArchiveTerminalSealReceipt,
): boolean {
  if (receipt.expectedArchivedPreimageSha256 === null) {
    return receipt.repairedHistoryPath === null && receipt.repairedHistorySha256 === null;
  }
  if (receipt.expectedArchivedPreimageSha256 === receipt.hotJournalSha256) {
    return receipt.repairedHistoryPath === null && receipt.repairedHistorySha256 === null;
  }
  const expectedRelative = deterministicHistoryPath(receipt.sprintId, receipt.expectedArchivedPreimageSha256);
  if (receipt.repairedHistoryPath !== expectedRelative
      || receipt.repairedHistorySha256 !== receipt.expectedArchivedPreimageSha256) return false;
  const history = resolve(archiveDir, receipt.repairedHistoryPath);
  return isSprintArchivePathContained(archiveDir, history) && hashFile(history) === receipt.repairedHistorySha256;
}

function validateRepairedSequenceHistory(
  archiveDir: string,
  receipt: SprintArchiveTerminalSealReceipt,
): boolean {
  const expected = receipt.expectedArchivedSequencePreimageSha256;
  if (expected === null || expected === receipt.sequenceCounterSha256) {
    return receipt.repairedSequenceHistoryPath === null
      && receipt.repairedSequenceHistorySha256 === null;
  }
  const expectedRelative = deterministicSequenceHistoryPath(receipt.sprintId, expected);
  if (receipt.repairedSequenceHistoryPath !== expectedRelative
      || receipt.repairedSequenceHistorySha256 !== expected) return false;
  const history = resolve(archiveDir, receipt.repairedSequenceHistoryPath);
  return isSprintArchivePathContained(archiveDir, history) && hashFile(history) === expected;
}

/** Read-only terminal-complete verification; never reconciles or refreshes Brain. */
function verifySprintArchiveTerminalWithProjection(
  projectRoot: string,
  sprintId: string,
  hotJournalPath: string | undefined,
  trustedBrainProjection?: TrustedBrainProjection,
): SprintArchiveTerminalVerificationReport {
  assertSprintId(sprintId);
  if (!isSprintArchiveNamespaceSafe(projectRoot, sprintId)) {
    return {
      sprintId,
      ok: false,
      reasonCodes: ['invalid_archive_path'],
      manifestDigest: null,
      sealReceiptSha256: null,
      brainIndexSha256: null,
      guardedSummarySha256: null,
    };
  }
  const reasons: SprintArchiveTerminalSealHoldReason[] = [];
  const archiveDir = resolveSprintArchiveDir(projectRoot, sprintId);
  const hot = canonicalHotJournalPath(projectRoot, sprintId, hotJournalPath);
  if (!hot) reasons.push('invalid_hot_journal_path');
  const sealValue = readJson(join(archiveDir, TERMINAL_SEAL_RECEIPT_FILE));
  const applicationValue = readJson(join(archiveDir, TERMINAL_SEAL_APPLICATION_FILE));
  const seal = sealValue as Partial<SprintArchiveTerminalSealReceipt> | null;
  const application = applicationValue as Partial<SprintArchiveTerminalApplicationReceipt> | null;
  const sealStructurallyValid = seal?.kind === 'deckent.sprint-archive-terminal-seal'
    && seal.version === 1 && seal.sprintId === sprintId && isTerminalReceipt(seal.terminalReceipt)
    && typeof seal.operatorReason === 'string' && seal.operatorReason.trim() === seal.operatorReason
    && seal.operatorReason.length > 0 && !OPERATOR_REASON_CONTROL_PATTERN.test(seal.operatorReason)
    && typeof seal.operatorReasonSha256 === 'string' && seal.operatorReasonSha256 === sha256(seal.operatorReason)
    && typeof seal.priorAuthorityVersion === 'number'
    && seal.priorAuthorityVersion === seal.terminalReceipt.priorAuthorityVersion
    && seal.runId === seal.terminalReceipt.runId
    && seal.coordinatorGeneration === seal.terminalReceipt.coordinatorGeneration
    && seal.terminalOutcome === seal.terminalReceipt.terminalOutcome
    && seal.logicalSettlementDigest === seal.terminalReceipt.logicalSettlementDigest
    && seal.authorityVersion === seal.terminalReceipt.authorityVersion
    && typeof seal.brainAdoptionRequired === 'boolean'
    && (seal.terminalEventsProjectionSha256 === null
      || (typeof seal.terminalEventsProjectionSha256 === 'string'
        && SHA256_HEX_PATTERN.test(seal.terminalEventsProjectionSha256)))
    && (seal.postSealPolicySha256 === null
      || (typeof seal.postSealPolicySha256 === 'string'
        && SHA256_HEX_PATTERN.test(seal.postSealPolicySha256)));
  if (!sealStructurallyValid) reasons.push('terminal_identity_mismatch');
  const typedSeal = sealStructurallyValid ? seal as SprintArchiveTerminalSealReceipt : null;
  const sealSha = typedSeal ? sealReceiptDigest(typedSeal) : null;
  const applicationStructurallyValid = typedSeal !== null
    && application?.kind === 'deckent.sprint-archive-terminal-application'
    && application.version === 1 && application.sprintId === sprintId
    && application.state === 'applied' && application.sealReceiptSha256 === sealSha
    && typeof application.manifestDigest === 'string'
    && application.brainAdopted === typedSeal.brainAdoptionRequired
    && (typedSeal.brainAdoptionRequired
      ? typeof application.brainIndexSha256 === 'string'
        && SHA256_HEX_PATTERN.test(application.brainIndexSha256)
        && typeof application.guardedSummarySha256 === 'string'
        && SHA256_HEX_PATTERN.test(application.guardedSummarySha256)
      : application.brainIndexSha256 === null && application.guardedSummarySha256 === null);
  if (!applicationStructurallyValid) reasons.push('application_not_applied');
  if (typedSeal?.brainAdoptionRequired === true && application?.brainAdopted !== true) {
    reasons.push('brain_adoption_failed');
  }
  const typedApplication = applicationStructurallyValid
    ? application as SprintArchiveTerminalApplicationReceipt
    : null;

  if (typedSeal) {
    const marker = terminalMarker(projectRoot, sprintId);
    if (!marker || !exactReceiptEquals(marker, typedSeal.terminalReceipt)
        || typedSeal.priorAuthorityVersion !== typedSeal.terminalReceipt.priorAuthorityVersion
        || typedSeal.runId !== typedSeal.terminalReceipt.runId
        || typedSeal.authorityVersion !== typedSeal.terminalReceipt.authorityVersion) {
      reasons.push('terminal_identity_mismatch');
    }
    const hotSnapshot = hot ? readJournalSnapshot(hot) : null;
    const canonicalJournal = join(archiveDir, `${sprintId}-events.jsonl`);
    const archivedSnapshot = readJournalSnapshot(canonicalJournal);
    if (!hotSnapshot || !archivedSnapshot
        || !hotSnapshot.bytes.equals(archivedSnapshot.bytes)
        || sha256(hotSnapshot.bytes) !== typedSeal.hotJournalSha256
        || sha256(archivedSnapshot.bytes) !== typedSeal.archivedJournalSha256
        || hotSnapshot.sequence !== typedSeal.finalEvent.sequence
        || hotSnapshot.digest !== typedSeal.finalEvent.digest) reasons.push('append_race');
    try {
      if (!validateRepairedHistory(archiveDir, typedSeal)) reasons.push('preimage_mismatch');
    } catch {
      reasons.push('preimage_mismatch');
    }
    const hotSequencePath = join(projectRoot, DECKENT_DIR, 'recently-works', `${sprintId}-seq`);
    const archivedSequence = readSequenceSnapshot(join(archiveDir, `${sprintId}-seq`));
    const hotSequenceRetired = !existsSync(hotSequencePath);
    if (!archivedSequence
        || archivedSequence.value !== typedSeal.finalEvent.sequence
        || archivedSequence.digest !== typedSeal.sequenceCounterSha256
        || !hotSequenceRetired) {
      reasons.push('sequence_counter_mismatch');
    }
    try {
      if (!validateRepairedSequenceHistory(archiveDir, typedSeal)) reasons.push('sequence_counter_mismatch');
    } catch {
      reasons.push('sequence_counter_mismatch');
    }
  }

  const verified = verifySprintArchive(projectRoot, sprintId);
  const manifest = readManifest(join(archiveDir, SPRINT_ARCHIVE_MANIFEST_FILE));
  if (!verified.ok || !manifest) reasons.push(verified.untracked.length > 0 ? 'untracked_artifact' : 'archive_tampered');
  if (typedApplication && manifest?.contentDigest !== typedApplication.manifestDigest) reasons.push('archive_tampered');

  let brainIndexSha256: string | null = null;
  let guardedSummarySha256: string | null = null;
  if (typedApplication?.brainAdopted === true && manifest) {
    const projection = trustedBrainProjection?.[TRUSTED_BRAIN_PROJECTION] === true
        && trustedBrainProjection.sprintId === sprintId
        && trustedBrainProjection.manifestDigest === manifest.contentDigest
      ? trustedBrainProjection
      : brainAdoptionProjection(projectRoot, sprintId, manifest.contentDigest, false);
    if (!projection
        || projection.brainIndexSha256 !== typedApplication.brainIndexSha256
        || projection.guardedSummarySha256 !== typedApplication.guardedSummarySha256) {
      reasons.push('brain_adoption_failed');
    } else {
      brainIndexSha256 = projection.brainIndexSha256;
      guardedSummarySha256 = projection.guardedSummarySha256;
    }
  }
  return {
    sprintId,
    ok: reasons.length === 0,
    reasonCodes: [...new Set(reasons)],
    manifestDigest: manifest?.contentDigest ?? null,
    sealReceiptSha256: sealSha,
    brainIndexSha256,
    guardedSummarySha256,
  };
}

/**
 * Public verification always observes Brain through a fresh detached immutable
 * DB/WAL snapshot. The writer-owned projection used during the first commit is
 * intentionally unavailable through this API.
 */
export function verifySprintArchiveTerminal(
  projectRoot: string,
  sprintId: string,
  hotJournalPath?: string,
): SprintArchiveTerminalVerificationReport {
  return verifySprintArchiveTerminalWithProjection(projectRoot, sprintId, hotJournalPath);
}

/**
 * Terminal-only authority. Every repair is exact-preimage CAS-bound and first
 * publishes a durable staged application receipt. A later failure can leave
 * repaired bytes, but can never be reported terminal-complete until the
 * manifest, compact Brain index, and guarded summary are bound by `applied`.
 */
export function sealSprintArchiveTerminal(
  projectRoot: string,
  sprintId: string,
  request: SprintArchiveTerminalSealRequest,
  renderOptions?: MemoryExportRenderOptions,
): SprintArchiveTerminalSealResult {
  assertSprintId(sprintId);
  const { receipt, finalEvent } = request;
  if (typeof request.operatorReason !== 'string') return sealHold('invalid_operator_reason');
  const reason = request.operatorReason.trim();
  if (reason.length === 0 || reason !== request.operatorReason
      || reason.length > 2048 || OPERATOR_REASON_CONTROL_PATTERN.test(reason)) {
    return sealHold('invalid_operator_reason');
  }
  if (!SHA256_HEX_PATTERN.test(request.expectedHotJournalSha256)
      || (request.expectedArchivedPreimageSha256 !== null
        && !SHA256_HEX_PATTERN.test(request.expectedArchivedPreimageSha256))
      || (request.terminalEventsProjectionSha256 !== undefined
        && request.terminalEventsProjectionSha256 !== null
        && !SHA256_HEX_PATTERN.test(request.terminalEventsProjectionSha256))
      || (request.postSealPolicySha256 !== undefined
        && request.postSealPolicySha256 !== null
        && !SHA256_HEX_PATTERN.test(request.postSealPolicySha256))) {
    return sealHold('invalid_expected_digest');
  }
  if (!isTerminalReceipt(receipt) || receipt.sprintId !== sprintId || !Number.isSafeInteger(finalEvent.sequence)
      || finalEvent.sequence < 1 || !SHA256_HEX_PATTERN.test(finalEvent.digest)) {
    return sealHold('terminal_identity_mismatch');
  }
  const hotJournal = canonicalHotJournalPath(projectRoot, sprintId, request.hotJournalPath);
  if (!hotJournal) return sealHold('invalid_hot_journal_path');
  const marker = terminalMarker(projectRoot, sprintId);
  if (!marker) return sealHold('missing_terminal_marker');
  if (!exactReceiptEquals(marker, receipt)) return sealHold('terminal_identity_mismatch');
  if (request.adoptBrain === true && !safeBrainDatabasePath(projectRoot)) {
    return sealHold('brain_adoption_failed');
  }

  const archiveDir = resolveSprintArchiveDir(projectRoot, sprintId);
  if (!isSprintArchiveNamespaceSafe(projectRoot, sprintId)) return sealHold('invalid_archive_path');
  try { mkdirSync(archiveDir, { recursive: true, mode: 0o700 }); } catch {
    return sealHold('invalid_archive_path');
  }
  try {
    if (!isArchiveNamespaceLinkFree(projectRoot, archiveDir)
        || !lstatSync(archiveDir).isDirectory()) return sealHold('invalid_archive_path');
  } catch {
    return sealHold('invalid_archive_path');
  }
  const lockDir = join(projectRoot, DECKENT_DIR, 'runtime', 'archive-seal-locks');
  mkdirSync(lockDir, { recursive: true, mode: 0o700 });
  const lockPath = join(lockDir, `${sprintId}.lock`);
  let lockDescriptor: number;
  try { lockDescriptor = openSync(lockPath, 'wx', 0o600); } catch { return sealHold('seal_locked'); }
  try {
    const first = readJournalSnapshot(hotJournal);
    if (!first) return sealHold('invalid_final_event');
    if (first.sequence !== finalEvent.sequence || first.digest !== finalEvent.digest) {
      return sealHold('terminal_identity_mismatch');
    }
    if (sha256(first.bytes) !== request.expectedHotJournalSha256) return sealHold('preimage_mismatch');
    const second = readJournalSnapshot(hotJournal);
    if (!second || !first.bytes.equals(second.bytes)) return sealHold('append_race');

    const canonicalJournal = join(archiveDir, `${sprintId}-events.jsonl`);
    const archivedSequencePath = join(archiveDir, `${sprintId}-seq`);
    const sealPath = join(archiveDir, TERMINAL_SEAL_RECEIPT_FILE);
    const applicationPath = join(archiveDir, TERMINAL_SEAL_APPLICATION_FILE);
    const priorSeal = readJson(sealPath);
    const priorSealRecord = priorSeal && typeof priorSeal === 'object' && !Array.isArray(priorSeal)
      ? priorSeal as Partial<SprintArchiveTerminalSealReceipt>
      : null;
    const priorApplicationValue = readJson(applicationPath);
    const priorApplicationRecord = priorApplicationValue && typeof priorApplicationValue === 'object'
      && !Array.isArray(priorApplicationValue)
      ? priorApplicationValue as Partial<SprintArchiveTerminalApplicationReceipt>
      : null;
    if (existsSync(sealPath) && !priorSealRecord
        || existsSync(applicationPath) && !priorApplicationRecord) {
      return sealHold('terminal_identity_mismatch');
    }

    const priorSealMatchesRequest = priorSealRecord?.kind === 'deckent.sprint-archive-terminal-seal'
      && priorSealRecord.version === 1
      && priorSealRecord.sprintId === sprintId
      && exactReceiptEquals(priorSealRecord.terminalReceipt, receipt)
      && priorSealRecord.finalEvent?.sequence === finalEvent.sequence
      && priorSealRecord.finalEvent.digest === finalEvent.digest
      && priorSealRecord.canonicalHotJournalPath === relativePortable(projectRoot, hotJournal)
      && priorSealRecord.expectedArchivedPreimageSha256 === request.expectedArchivedPreimageSha256
      && priorSealRecord.hotJournalSha256 === request.expectedHotJournalSha256
      && priorSealRecord.archivedJournalSha256 === request.expectedHotJournalSha256
      && priorSealRecord.operatorReason === reason
      && priorSealRecord.brainAdoptionRequired === (request.adoptBrain === true)
      && priorSealRecord.terminalEventsProjectionSha256
        === (request.terminalEventsProjectionSha256 ?? null)
      && priorSealRecord.postSealPolicySha256
        === (request.postSealPolicySha256 ?? null);
    if (priorSealRecord && !priorSealMatchesRequest) return sealHold('terminal_identity_mismatch');
    const typedPriorSeal = priorSealMatchesRequest
      ? priorSealRecord as SprintArchiveTerminalSealReceipt
      : null;
    const priorSealSha = typedPriorSeal ? sealReceiptDigest(typedPriorSeal) : null;
    if (priorApplicationRecord && (!typedPriorSeal
        || priorApplicationRecord.kind !== 'deckent.sprint-archive-terminal-application'
        || priorApplicationRecord.version !== 1
        || priorApplicationRecord.sprintId !== sprintId
        || (priorApplicationRecord.state !== 'staged' && priorApplicationRecord.state !== 'applied')
        || priorApplicationRecord.sealReceiptSha256 !== priorSealSha)) {
      return sealHold('terminal_identity_mismatch');
    }

    // An applied seal owns the immutable sequence counter after hot retirement.
    // Validate the complete caller projection before any counter read, reconcile,
    // or write, then use the fresh terminal verifier as the idempotency gate.
    if (priorApplicationRecord?.state === 'applied') {
      if (!typedPriorSeal) return sealHold('terminal_identity_mismatch');
      const typedSeal = typedPriorSeal;
      const typedApplication = priorApplicationRecord as SprintArchiveTerminalApplicationReceipt;
      if (!retireHotSequenceCounter(projectRoot, sprintId, typedSeal)) {
        return sealHold('sequence_counter_mismatch', typedSeal, typedApplication);
      }
      const verified = verifySprintArchiveTerminal(projectRoot, sprintId, hotJournal);
      return verified.ok
        ? { disposition: 'idempotent', terminalComplete: true, receipt: typedSeal,
          applicationReceipt: typedApplication, verification: verified }
        : sealHold(verified.reasonCodes[0] ?? 'application_not_applied', typedSeal, typedApplication);
    }

    const hotSequencePath = join(projectRoot, DECKENT_DIR, 'recently-works', `${sprintId}-seq`);
    const hotSequence = readSequenceSnapshot(hotSequencePath);
    const archivedSequenceBefore = readSequenceSnapshot(archivedSequencePath);
    // Cleanup retires the hot counter only after a terminal seal is durable.
    // A staged/seal-only replay therefore resumes from the immutable archived
    // counter, but only when that snapshot is exactly bound by the prior seal.
    const sequenceSnapshot = hotSequence ?? (typedPriorSeal
      && archivedSequenceBefore?.value === typedPriorSeal.sequenceCounterValue
      && archivedSequenceBefore.digest === typedPriorSeal.sequenceCounterSha256
      ? archivedSequenceBefore
      : null);
    if (!sequenceSnapshot || sequenceSnapshot.value !== finalEvent.sequence) {
      return sealHold('sequence_counter_mismatch');
    }

    const expectedPreimage = request.expectedArchivedPreimageSha256;
    const isRepair = expectedPreimage !== null && expectedPreimage !== request.expectedHotJournalSha256;
    const repairedHistoryPath = isRepair ? deterministicHistoryPath(sprintId, expectedPreimage) : null;
    const priorSequencePreimage = priorSealRecord?.expectedArchivedSequencePreimageSha256;
    const expectedSequencePreimage = priorSealRecord
      ? (priorSequencePreimage === null || (typeof priorSequencePreimage === 'string'
          && SHA256_HEX_PATTERN.test(priorSequencePreimage)) ? priorSequencePreimage : undefined)
      : archivedSequenceBefore?.digest ?? null;
    if (expectedSequencePreimage === undefined) return sealHold('terminal_identity_mismatch');
    const isSequenceRepair = expectedSequencePreimage !== null
      && expectedSequencePreimage !== sequenceSnapshot.digest;
    const repairedSequenceHistoryPath = isSequenceRepair
      ? deterministicSequenceHistoryPath(sprintId, expectedSequencePreimage)
      : null;
    const sealReceipt: SprintArchiveTerminalSealReceipt = {
      kind: 'deckent.sprint-archive-terminal-seal',
      version: 1,
      sprintId,
      runId: receipt.runId,
      coordinatorGeneration: receipt.coordinatorGeneration,
      terminalOutcome: receipt.terminalOutcome,
      logicalSettlementDigest: receipt.logicalSettlementDigest,
      priorAuthorityVersion: receipt.priorAuthorityVersion,
      authorityVersion: receipt.authorityVersion,
      terminalReceipt: { ...receipt },
      finalEvent: { ...finalEvent },
      canonicalHotJournalPath: relativePortable(projectRoot, hotJournal),
      expectedArchivedPreimageSha256: expectedPreimage,
      hotJournalSha256: request.expectedHotJournalSha256,
      archivedJournalSha256: request.expectedHotJournalSha256,
      operatorReason: reason,
      operatorReasonSha256: sha256(reason),
      brainAdoptionRequired: request.adoptBrain === true,
      terminalEventsProjectionSha256: request.terminalEventsProjectionSha256 ?? null,
      postSealPolicySha256: request.postSealPolicySha256 ?? null,
      repairedHistoryPath,
      repairedHistorySha256: isRepair ? expectedPreimage : null,
      sequenceCounterValue: finalEvent.sequence,
      sequenceCounterSha256: sequenceSnapshot.digest,
      expectedArchivedSequencePreimageSha256: expectedSequencePreimage,
      repairedSequenceHistoryPath,
      repairedSequenceHistorySha256: isSequenceRepair ? expectedSequencePreimage : null,
      originalDisposition: isRepair ? 'repaired' : 'sealed',
    };
    const sealSha = sealReceiptDigest(sealReceipt);
    const staged: SprintArchiveTerminalApplicationReceipt = {
      kind: 'deckent.sprint-archive-terminal-application',
      version: 1,
      sprintId,
      state: 'staged',
      sealReceiptSha256: sealSha,
    };
    if (priorSeal && !exactSealReceipt(priorSeal, sealReceipt)) return sealHold('terminal_identity_mismatch');
    if (priorApplicationRecord && canonicalJson(priorApplicationRecord) !== canonicalJson(staged)) {
      return sealHold('terminal_identity_mismatch');
    }

    // Fail closed before publishing the durable stage when the supplied
    // journal is not an exact strict-prefix repair (or a valid staged replay).
    const preStageJournal = readJournalSnapshot(canonicalJournal);
    if (isRepair) {
      if (preStageJournal && sha256(preStageJournal.bytes) === expectedPreimage) {
        if (!first.bytes.subarray(0, preStageJournal.bytes.length).equals(preStageJournal.bytes)) {
          return sealHold('non_prefix_divergence');
        }
      } else if (!priorSeal || !preStageJournal || !preStageJournal.bytes.equals(first.bytes)) {
        return sealHold('preimage_mismatch');
      }
    } else if (expectedPreimage === null) {
      if (preStageJournal && (!priorSeal || !preStageJournal.bytes.equals(first.bytes))) {
        return sealHold('preimage_mismatch');
      }
    } else if (!preStageJournal || sha256(preStageJournal.bytes) !== expectedPreimage
        || !preStageJournal.bytes.equals(first.bytes)) {
      return sealHold('preimage_mismatch');
    }

    if (isSequenceRepair) {
      if (archivedSequenceBefore?.digest === expectedSequencePreimage) {
        if (archivedSequenceBefore.value > finalEvent.sequence) return sealHold('sequence_counter_mismatch');
      } else if (!priorSeal || archivedSequenceBefore?.digest !== sequenceSnapshot.digest) {
        return sealHold('sequence_counter_mismatch');
      }
    } else if (expectedSequencePreimage === null) {
      if (archivedSequenceBefore && (!priorSeal || archivedSequenceBefore.digest !== sequenceSnapshot.digest)) {
        return sealHold('sequence_counter_mismatch');
      }
    } else if (archivedSequenceBefore?.digest !== sequenceSnapshot.digest) {
      return sealHold('sequence_counter_mismatch');
    }

    const manifestPath = join(archiveDir, SPRINT_ARCHIVE_MANIFEST_FILE);
    if (!priorSeal && existsSync(manifestPath)) {
      const verified = verifySprintArchive(projectRoot, sprintId);
      if (verified.missing.length || verified.mismatched.length || !verified.manifestDigestValid) {
        return sealHold('archive_tampered');
      }
      if (verified.untracked.length) return sealHold('untracked_artifact');
      if ((readManifest(manifestPath)?.conflicts.length ?? 1) > 0) return sealHold('manifest_conflict');
    } else if (!priorSeal && listFilesRecursively(archiveDir).some(path => {
      const exact = resolve(path);
      return exact !== resolve(canonicalJournal) && exact !== resolve(archivedSequencePath);
    })) {
      return sealHold('untracked_artifact');
    }

    try {
      if (!priorSeal) writeJsonAtomic(sealPath, sealReceipt);
      if (!priorApplicationRecord) writeJsonAtomic(applicationPath, staged);
    } catch {
      return sealHold('seal_write_failed', sealReceipt, staged);
    }

    const canonicalSnapshot = readJournalSnapshot(canonicalJournal);
    if (isRepair) {
      const historyPath = resolve(archiveDir, repairedHistoryPath!);
      if (!isSprintArchivePathContained(archiveDir, historyPath)) {
        return sealHold('preimage_mismatch', sealReceipt, staged);
      }
      if (canonicalSnapshot && sha256(canonicalSnapshot.bytes) === expectedPreimage) {
        if (!first.bytes.subarray(0, canonicalSnapshot.bytes.length).equals(canonicalSnapshot.bytes)) {
          return sealHold('non_prefix_divergence', sealReceipt, staged);
        }
        const history = publishVerifiedCopy(canonicalJournal, historyPath);
        if (history.identity.sha256 !== expectedPreimage || hashFile(history.destination) !== expectedPreimage) {
          return sealHold('preimage_mismatch', sealReceipt, staged);
        }
        const casSnapshot = readJournalSnapshot(canonicalJournal);
        if (!casSnapshot || sha256(casSnapshot.bytes) !== expectedPreimage) {
          return sealHold('preimage_mismatch', sealReceipt, staged);
        }
        try { writeFileAtomic(canonicalJournal, first.bytes); } catch {
          return sealHold('seal_write_failed', sealReceipt, staged);
        }
      } else if (!canonicalSnapshot || !canonicalSnapshot.bytes.equals(first.bytes)) {
        return sealHold('preimage_mismatch', sealReceipt, staged);
      }
      try {
        if (!validateRepairedHistory(archiveDir, sealReceipt)) {
          return sealHold('preimage_mismatch', sealReceipt, staged);
        }
      } catch {
        return sealHold('preimage_mismatch', sealReceipt, staged);
      }
    } else if (expectedPreimage === null) {
      if (canonicalSnapshot && !canonicalSnapshot.bytes.equals(first.bytes)) {
        return sealHold('preimage_mismatch', sealReceipt, staged);
      }
      if (!canonicalSnapshot) {
        try { writeFileAtomic(canonicalJournal, first.bytes); } catch {
          return sealHold('seal_write_failed', sealReceipt, staged);
        }
      }
    } else if (!canonicalSnapshot || sha256(canonicalSnapshot.bytes) !== expectedPreimage
        || !canonicalSnapshot.bytes.equals(first.bytes)) {
      return sealHold('preimage_mismatch', sealReceipt, staged);
    }

    const archivedSequence = readSequenceSnapshot(archivedSequencePath);
    if (isSequenceRepair) {
      const historyPath = resolve(archiveDir, repairedSequenceHistoryPath!);
      if (!isSprintArchivePathContained(archiveDir, historyPath)) {
        return sealHold('sequence_counter_mismatch', sealReceipt, staged);
      }
      if (archivedSequence?.digest === expectedSequencePreimage) {
        const history = publishVerifiedCopy(archivedSequencePath, historyPath);
        if (history.identity.sha256 !== expectedSequencePreimage
            || hashFile(history.destination) !== expectedSequencePreimage) {
          return sealHold('sequence_counter_mismatch', sealReceipt, staged);
        }
        const casSequence = readSequenceSnapshot(archivedSequencePath);
        if (casSequence?.digest !== expectedSequencePreimage) {
          return sealHold('sequence_counter_mismatch', sealReceipt, staged);
        }
        try { writeFileAtomic(archivedSequencePath, sequenceSnapshot.bytes); } catch {
          return sealHold('seal_write_failed', sealReceipt, staged);
        }
      } else if (archivedSequence?.digest !== sequenceSnapshot.digest) {
        return sealHold('sequence_counter_mismatch', sealReceipt, staged);
      }
      try {
        if (!validateRepairedSequenceHistory(archiveDir, sealReceipt)) {
          return sealHold('sequence_counter_mismatch', sealReceipt, staged);
        }
      } catch {
        return sealHold('sequence_counter_mismatch', sealReceipt, staged);
      }
    } else if (expectedSequencePreimage === null) {
      if (!archivedSequence) {
        try { writeFileAtomic(archivedSequencePath, sequenceSnapshot.bytes); } catch {
          return sealHold('seal_write_failed', sealReceipt, staged);
        }
      } else if (archivedSequence.digest !== sequenceSnapshot.digest) {
        return sealHold('sequence_counter_mismatch', sealReceipt, staged);
      }
    } else if (archivedSequence?.digest !== sequenceSnapshot.digest) {
      return sealHold('sequence_counter_mismatch', sealReceipt, staged);
    }

    const third = readJournalSnapshot(hotJournal);
    const archived = readJournalSnapshot(canonicalJournal);
    const finalHotSequence = readSequenceSnapshot(hotSequencePath);
    const finalArchivedSequence = readSequenceSnapshot(archivedSequencePath);
    if (!third || !archived || !third.bytes.equals(first.bytes) || !archived.bytes.equals(first.bytes)
        || !finalArchivedSequence
        || finalArchivedSequence.value !== finalEvent.sequence
        || finalArchivedSequence.digest !== sequenceSnapshot.digest
        || (finalHotSequence !== null
          && (finalHotSequence.value !== finalEvent.sequence
            || finalHotSequence.digest !== finalArchivedSequence.digest))
        || (finalHotSequence === null && !typedPriorSeal)) {
      return sealHold('append_race', sealReceipt, staged);
    }

    const reconciled = reconcileSprintArchive(projectRoot, sprintId, {
      apply: true,
      retireLegacySources: true,
      indexMemory: request.adoptBrain === true,
    });
    if (reconciled.failures.length || reconciled.manifest.conflicts.length) {
      return sealHold('manifest_conflict', sealReceipt, staged);
    }
    const archiveVerification = verifySprintArchive(projectRoot, sprintId);
    if (!archiveVerification.ok) {
      return sealHold(archiveVerification.untracked.length ? 'untracked_artifact' : 'archive_tampered',
        sealReceipt, staged);
    }

    const brain = request.adoptBrain === true
      ? brainAdoptionProjection(projectRoot, sprintId, reconciled.manifest.contentDigest, true, renderOptions)
      : null;
    if (request.adoptBrain === true && !brain) {
      return sealHold('brain_adoption_failed', sealReceipt, staged);
    }
    const applied: SprintArchiveTerminalApplicationReceipt = {
      ...staged,
      state: 'applied',
      manifestDigest: reconciled.manifest.contentDigest,
      brainAdopted: request.adoptBrain === true,
      brainIndexSha256: brain?.brainIndexSha256 ?? null,
      guardedSummarySha256: brain?.guardedSummarySha256 ?? null,
    };
    try { writeJsonAtomic(applicationPath, applied); } catch {
      return sealHold('seal_write_failed', sealReceipt, staged);
    }
    if (!retireHotSequenceCounter(projectRoot, sprintId, sealReceipt)) {
      return sealHold('sequence_counter_mismatch', sealReceipt, applied);
    }
    const terminalVerification = verifySprintArchiveTerminalWithProjection(
      projectRoot,
      sprintId,
      hotJournal,
      brain ?? undefined,
    );
    if (!terminalVerification.ok) {
      return sealHold(terminalVerification.reasonCodes[0] ?? 'application_not_applied', sealReceipt, applied);
    }
    return {
      disposition: priorSeal ? 'idempotent' : sealReceipt.originalDisposition,
      terminalComplete: true,
      receipt: sealReceipt,
      applicationReceipt: applied,
      verification: terminalVerification,
    };
  } finally {
    closeSync(lockDescriptor);
    try { unlinkSync(lockPath); } catch { /* a stale lock is safer than deleting a foreign lock */ }
  }
}

function writeFileAtomic(path: string, bytes: Buffer): void {
  const directory = dirname(path);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const temporary = join(directory, `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`);
  let descriptor: number | undefined;
  try {
    descriptor = openSync(temporary, 'wx', 0o600);
    writeFileSync(descriptor, bytes);
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    renameSync(temporary, path);
    const directoryDescriptor = openSync(directory, 'r');
    try {
      fsyncSync(directoryDescriptor);
    } finally {
      closeSync(directoryDescriptor);
    }
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    try {
      unlinkSync(temporary);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
}

export function verifySprintArchive(projectRoot: string, sprintId: string): SprintArchiveVerificationReport {
  assertSprintId(sprintId);
  const archiveDir = resolveSprintArchiveDir(projectRoot, sprintId);
  const manifestPath = join(archiveDir, SPRINT_ARCHIVE_MANIFEST_FILE);
  const manifest = readManifest(manifestPath);
  if (!manifest || manifest.sprintId !== sprintId) {
    return {
      sprintId,
      ok: false,
      checked: 0,
      missing: [SPRINT_ARCHIVE_MANIFEST_FILE],
      mismatched: [],
      untracked: [],
      manifestDigestValid: false,
    };
  }
  const missing: string[] = [];
  const mismatched: string[] = [];
  for (const artifact of manifest.artifacts) {
    const path = resolve(archiveDir, artifact.path);
    if (!path.startsWith(`${resolve(archiveDir)}${sep}`) || !existsSync(path)) {
      missing.push(artifact.path);
      continue;
    }
    const identity = fileIdentity(path);
    if (identity.bytes !== artifact.bytes || identity.sha256 !== artifact.sha256) {
      mismatched.push(artifact.path);
    }
  }
  // Replay check: every archived runtime delivery receipt must resolve to the
  // exact manifested core bytes it names. Digest-only evidence is insufficient.
  for (const artifact of manifest.artifacts.filter(
    item => item.path.endsWith('.prompt-delivery.json'),
  )) {
    try {
      const receipt = JSON.parse(readFileSync(join(archiveDir, artifact.path), 'utf8')) as {
        runtimeDelivery?: {
          coreArtifactPath?: unknown;
          coreSha256?: unknown;
          coreBytes?: unknown;
        };
      };
      const binding = receipt.runtimeDelivery;
      if (!binding || typeof binding.coreSha256 !== 'string'
        || !/^[a-f0-9]{64}$/u.test(binding.coreSha256)
        || !Number.isSafeInteger(binding.coreBytes)) {
        mismatched.push(artifact.path);
        continue;
      }
      const corePath = `tasks/worker-cores/.worker-core-${binding.coreSha256}.md`;
      const expectedSourcePath = `.tasks/.worker-core-${binding.coreSha256}.md`;
      const coreArtifact = manifest.artifacts.find(item => item.path === corePath);
      if (binding.coreArtifactPath !== expectedSourcePath
        || !coreArtifact || coreArtifact.sha256 !== binding.coreSha256
        || coreArtifact.bytes !== binding.coreBytes) mismatched.push(artifact.path);
    } catch {
      mismatched.push(artifact.path);
    }
  }
  const tracked = new Set(manifest.artifacts.map(artifact => artifact.path));
  const untracked = listFilesRecursively(archiveDir)
    .filter(path => path !== manifestPath && path !== join(archiveDir, TERMINAL_SEAL_APPLICATION_FILE))
    .map(path => relative(archiveDir, path).split(sep).join('/'))
    .filter(path => !tracked.has(path));
  const { contentDigest: _digest, ...payload } = manifest;
  const manifestDigestValid = manifestPayloadDigest(payload) === manifest.contentDigest;
  return {
    sprintId,
    ok: missing.length === 0 && mismatched.length === 0 && untracked.length === 0 && manifestDigestValid,
    checked: manifest.artifacts.length,
    missing,
    mismatched,
    untracked,
    manifestDigestValid,
  };
}

function collectSprintIdsFromDirectory(ids: Set<string>, directory: string): void {
  if (!existsSync(directory)) return;
  let entries;
  try { entries = readdirSync(directory, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    const matches = entry.name.match(/sprint-(\d+)/gu) ?? [];
    for (const match of matches) ids.add(match);
  }
}

/** Bounded source-root discovery; it never recursively scans the repository. */
export function discoverSprintArchiveIds(projectRoot: string): readonly string[] {
  const ids = new Set<string>();
  const roots = [
    join(projectRoot, TASKS_DIR),
    join(projectRoot, TASKS_DIR, LEGACY_TASK_ARCHIVE_SUBDIR),
    join(projectRoot, BRAIN_DIR, ARCHIVE_DIR),
    join(projectRoot, BRAIN_DIR, ARCHIVE_DIR, ARCHIVE_SPRINTS_SUBDIR),
    join(projectRoot, BRAIN_DIR, 'sprints'),
    join(projectRoot, DECKENT_DIR, ARCHIVE_DIR, ARCHIVE_SPRINTS_SUBDIR),
    join(projectRoot, DECKENT_DIR, 'recently-works'),
    join(projectRoot, DECKENT_DIR, 'runtime', 'evaluations'),
    join(projectRoot, DECKENT_DIR, 'runtime', 'scheduler-shadow'),
    join(projectRoot, DECKENT_DIR, 'runtime', 'jobs'),
  ];
  for (const root of roots) collectSprintIdsFromDirectory(ids, root);
  const dbPath = join(projectRoot, BRAIN_DIR, MEMORY_DB_FILE);
  if (existsSync(dbPath)) {
    let db: Database.Database | null = null;
    try {
      db = new Database(dbPath, { readonly: true, fileMustExist: true });
      const rows = db.prepare(`
        SELECT DISTINCT sprint_id AS sprintId, sprint_num AS sprintNum
        FROM entries
        WHERE deleted_at IS NULL AND (sprint_id IS NOT NULL OR sprint_num > 0)
      `).all() as Array<{ sprintId: string | null; sprintNum: number }>;
      for (const row of rows) {
        if (row.sprintId && SPRINT_ID_PATTERN.test(row.sprintId)) ids.add(row.sprintId);
        else if (row.sprintNum > 0) ids.add(`sprint-${row.sprintNum}`);
      }
    } catch (error) {
      debugLog('sprintArchive:discoverMemory', error);
    } finally {
      db?.close();
    }
  }
  return [...ids].sort((left, right) => Number(sprintNumber(left)) - Number(sprintNumber(right)));
}
