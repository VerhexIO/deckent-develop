import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// ─── Path Constants ──────────────────────────────────────────────────
export const DECKENT_DIR = '.deckent' as const;
export const PROJECT_CONFIG_PATH = join(DECKENT_DIR, 'config.json');
export const GLOBAL_DECKENT_DIR = join(homedir(), '.deckent');
export const GLOBAL_CONFIG_PATH = join(GLOBAL_DECKENT_DIR, 'config.json');
export const GLOBAL_CREDENTIALS_DIR = join(GLOBAL_DECKENT_DIR, 'credentials');

export const BRAIN_DIR = '.brain' as const;
export const TASKS_DIR = '.tasks' as const;
export const LOCKS_DIR = '.locks' as const;
export const CONTRACTS_DIR = '.contracts' as const;
export const CLAUDE_RULES_DIR = join('.claude', 'rules');
export const WORKSPACE_DIR = join(DECKENT_DIR, 'workspace');
export const PLUGINS_DIR = join(DECKENT_DIR, 'plugins');
// ─── Purpose-folder roots (de-scatter: settings = config-like JSON,
//     runtime = ephemeral per-run state, nervous = nervous-system files) ──
export const SETTINGS_DIR = join(DECKENT_DIR, 'settings');
export const RUNTIME_DIR = join(DECKENT_DIR, 'runtime');
/** Detached CLI stdout/stderr logs. Runtime retention owns this namespace. */
export const DETACHED_LOGS_DIR = join(RUNTIME_DIR, 'logs', 'detached');
export const RUN_STATUS_READ_MODEL_FILE = join(RUNTIME_DIR, 'run-status-read-model.json');
export const JOBS_DIR = join(RUNTIME_DIR, 'jobs');
export const DECISIONS_LOG_DIR = join(RUNTIME_DIR, 'decisions');
// Sprint 157 T-001: per-attempt forensic record of every Brain evaluation
// decision. Layout: <EVALUATIONS_DIR>/<sprintId>/<taskId>-attempt-<N>.json
// (see src/orchestra/evaluation-audit-trail.ts). Auditor-readable, append-
// only (overwrites at the same attemptNum slot).
export const EVALUATIONS_DIR = join(RUNTIME_DIR, 'evaluations');
export const DOCS_CONFIG_FILE = join(SETTINGS_DIR, 'docs.json');
export const FEATURES_MANIFEST_FILE = join(SETTINGS_DIR, 'features-manifest.json');
export const RESOURCE_LOG_FILE = join(SETTINGS_DIR, 'resource-log.jsonl');
// ─── Nervous System runtime files (ADR-040) ──────────────────────────
// All nervous-system runtime artifacts live under one purpose-folder.
// NOTE: observer.ts `isObserverNoiseFile` matches these via substring
// (`nervous-`, `nervous-ipc`, `panic-ipc`) — the new paths still satisfy it.
export const NERVOUS_DIR = join(DECKENT_DIR, 'nervous');
export const NERVOUS_LOG_FILE = join(NERVOUS_DIR, 'nervous-log.jsonl');
export const NERVOUS_HISTORY_FILE = join(NERVOUS_DIR, 'nervous-history.jsonl');
export const NERVOUS_PENDING_FILE = join(NERVOUS_DIR, 'nervous-pending.json');
export const NERVOUS_IPC_DIR = join(NERVOUS_DIR, 'nervous-ipc');
export const PANIC_IPC_DIR = join(NERVOUS_DIR, 'panic-ipc');
// ─── Autonomous engine files (sibling family of the nervous constants above) ──
export const AUTONOMOUS_DIR = join(DECKENT_DIR, 'autonomous');
/** Project-relative location of the autonomous approval queue. Joined with the
 *  project root by {@link autonomousPendingPath}. */
export const AUTONOMOUS_PENDING_FILE = join(AUTONOMOUS_DIR, 'pending.json');
/**
 * Canonical absolute path of the autonomous approval queue for `projectRoot`.
 * This is the ONE resolver every surface must share: the autonomous loop parks
 * triggers here, and the API / MCP / CLI accept-reject ingresses read from here.
 * APPROVAL-001 T1 made that read path load-bearing (an id absent from this file
 * is refused fail-closed), so a private per-file copy of the path that drifted
 * by one segment would silently 403 every real approval and park the loop
 * forever. Import this; never re-inline it. Lives in this leaf constants module
 * (no ApprovalStore/run-status import chain) so the MCP and connector surfaces
 * that resolve it stay free of that transitive load.
 */
export function autonomousPendingPath(projectRoot: string): string {
  return join(projectRoot, AUTONOMOUS_PENDING_FILE);
}
// ─── Sprint identity files (single source of truth for getCurrentSprintId) ──
// Resolution order in core/event-stream.getCurrentSprintId: SPRINT_ACTIVE_FILE
// (explicit override, if present + parseable) → SPRINT_STATE_FILE (written by
// writeSprintState during execution). Centralized here so every consumer
// (core/monitor/cli) derives the same paths from DECKENT_DIR.
export const SPRINT_STATE_FILE = join(DECKENT_DIR, 'sprint-state.json');
export const SPRINT_ACTIVE_FILE = join(DECKENT_DIR, 'sprint-active.json');
/** Durable parked-run continuation authority. Shared by lifecycle, status, and recovery surfaces. */
export const SPRINT_PAUSE_STATE_FILE = join(DECKENT_DIR, 'pause-state.json');
// ─── Per-sprint ephemeral artifacts (events, metrics, gate, archives) ──
export const RECENT_WORKS_DIR = join(DECKENT_DIR, 'recently-works');
export const MEMORY_DB_FILE = 'memory.db' as const;
export const MEMORY_EXPORTS_DIR = 'exports' as const;
export const DASHBOARD_FILE = '.dashboard' as const;

// ─── Memory Files (relative to BRAIN_DIR) ────────────────────────────
export const ERRORS_FILE = 'ERRORS.md' as const;
export const ERRORS_MAX_LINES = 600 as const; // Sprint 140 pre-flight: 200→600 (3x)
export const ERRORS_CRITICAL_FILE = 'ERRORS-critical.md' as const;
// Critical configuration/hold forensics need a longer, independent window than
// the high-volume general error stream so normal rotation cannot erase them.
export const ERRORS_CRITICAL_MAX_LINES = 2000 as const;
export const ERRORS_CRITICAL_CLASS_RE = /^(?:CONFIG_.*|.*_HOLD)$/;
export const MEMORY_FILE = 'MEMORY.md' as const;
/**
 * @deprecated since Sprint 179 (W3-6). Memory V2 source of truth is
 * `.brain/memory.db` (SQLite) + `.brain/exports/decisions.md` (auto-generated export).
 * This legacy filename is retained for backward compatibility checks but is no
 * longer the canonical ADR storage location. New ADRs go through MemoryStore.
 */
export const DECISIONS_FILE = 'DECISIONS.md' as const;
/** @deprecated since Sprint 179 — see DECISIONS_FILE. Legacy export cap. */
export const DECISIONS_MAX_LINES = 1200 as const; // Sprint 140 pre-flight: explicit cap (ADR governance, 37+ ADR canlı)
/** Memory V2 auto-generated decisions export (relative to BRAIN_DIR/MEMORY_EXPORTS_DIR). */
export const DECISIONS_EXPORT_FILE = 'decisions.md' as const;
export const DEBT_FILE = 'DEBT.md' as const;
export const PATTERNS_FILE = 'PATTERNS.md' as const;
export const RETRO_FILE = 'RETRO.md' as const;
export const PROJECT_IDENTITY_FILE = 'PROJECT-IDENTITY.md' as const;
export const SPRINTS_DIR = 'sprints' as const;
export const ARCHIVE_DIR = 'archive' as const;
// W7-temizlik (Alperen, 2026-07-07): .brain/archive iki alt-klasöre ayrıldı —
// sprint-task arşivleri `archive/sprints/`, DIRECTIVES kopyaları `archive/directives/`.
// Okuyucular geriye-uyum için eski düz-yerleşimi de tarar (mevcut kullanıcı-projeleri).
export const ARCHIVE_SPRINTS_SUBDIR = 'sprints' as const;
export const ARCHIVE_DIRECTIVES_SUBDIR = 'directives' as const;

// ─── Agent Files ─────────────────────────────────────────────────────
export const AGENTS_FILE = 'AGENTS.md' as const;
export const CLAUDE_FILE = 'CLAUDE.md' as const;
export const DIRECTIVES_FILE = 'DIRECTIVES.md' as const;
export const DECKENT_FILE = 'DECKENT.md' as const;

// ─── Memory Limits ───────────────────────────────────────────────────
// Sprint 140 pre-flight: Self-Analysis Ayna Sprint için 5000 satır toplam budget
// hedefi (Sprint 139 öncesi 900 satır toplam). Her kategori 3-5x büyütüldü.
// Motivasyon: 400-1000 task read-only analysis sprint'inde worker raporları
// .deckent/sprint-140-analysis/ altına yazılacak ama brain özet + cross-ref
// .brain/ altına aktarılacak, 900 satır budget 5.5x yetersiz.
export const MEMORY_MAX_LINES = 1500 as const;       // 300→1500 (5x)
export const PATTERNS_MAX_LINES = 800 as const;      // 150→800 (5.3x)
export const RETRO_MAX_LINES = 400 as const;         // 120→400 (3.3x)
export const SPRINT_LOG_MAX_LINES = 500 as const;    // 100→500 (5x)

// ─── Task File Extensions ────────────────────────────────────────────
export const TASK_FILE_EXTENSIONS = ['.json', '.plan', '.hb', '.result', '.paused', '.log'] as const;

// ─── tmux ────────────────────────────────────────────────────────────
export const TMUX_SESSION_NAME = 'deckent' as const;
export const TMUX_BRAIN_WINDOW = 'brain' as const;
export const TMUX_AUDITOR_WINDOW = 'auditor' as const;
export const TMUX_DASHBOARD_WINDOW = 'dashboard' as const;
export const TMUX_WORKER_PREFIX = 'w-' as const;

// ─── Tech Debt Escalation ────────────────────────────────────────────
export const DEBT_HIGH_PRIORITY_SPRINTS = 2 as const;
export const DEBT_CRITICAL_SPRINTS = 3 as const;
export const DEBT_TABLE_HEADER = '| ID | Description | Task | Sprint | Priority | Open | Resolved | Fixed In | Created |' as const;

// ─── Defaults ────────────────────────────────────────────────────────
export const DEFAULT_LANGUAGE = 'en' as const;
export const DEFAULT_MODE = 'performance' as const;
export const DECKENT_VERSION: string = (() => {
  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    const pkgPath = join(__dirname, '..', '..', 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as { version?: string };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
})();
export const SUPPORTED_LANGUAGES = ['en', 'tr'] as const;

// ─── Brain AI Planner ───────────────────────────────────────────────
// Sprint 184: bumped from 60s → 900s. Empirically Claude opus on 16K-char zero-config
// prompt took 434s; 60s caused SIGTERM and silent failure ("AI planner failed"). 900s
// gives 2x headroom for larger DIRECTIVES (manifest-driven 90+ task generation).
export const BRAIN_PLAN_TIMEOUT_MS = 900_000 as const;

// ─── Timing (deprecated — prefer config: scan_interval, heartbeat_timeout) ──
/** @deprecated Use config.scan_interval instead. Kept for backward compat & tests. */
export const AUDITOR_SCAN_INTERVAL_MS = 30_000 as const;
/** @deprecated Use config.heartbeat_timeout instead. Kept for backward compat & tests. */
export const HEARTBEAT_STALE_THRESHOLD_MS = 120_000 as const;
/** @deprecated Use config.lock_stale_threshold instead. Kept for backward compat & tests. */
export const LOCK_STALE_THRESHOLD_MS = 300_000 as const;
export const HEARTBEAT_WRITE_INTERVAL_MS = 15_000 as const;
export const LOCK_TIMEOUT_MS = 30_000 as const;

// ─── Memory Budget (deprecated — prefer config: memory_budget, decay_after_sprints) ──
/** @deprecated Use config.memory_budget instead. Kept for backward compat & tests. */
// Sprint 140 pre-flight: 900→5000 (5.5x). MEMORY 1500 + PATTERNS 800 + RETRO 400
// + SPRINT_LOG 500 + ERRORS 600 + DECISIONS 1200 = 5000 toplam hedef.
export const BRAIN_TOTAL_LINE_BUDGET = 5000 as const;
/** @deprecated Use config.decay_after_sprints instead. Kept for backward compat & tests. */
// Sprint 140 pre-flight: 8→20 (2.5x), self-analysis sprint'i büyük hacim üretecek,
// decay'i yavaşlat ki analiz raporları hemen silinmesin.
export const MEMORY_DECAY_SPRINTS = 20 as const;
export const PATTERN_DECAY_SPRINTS = 25 as const;
