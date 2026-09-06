// ═══ chat-tool-bridge — REPL slash → MCP tool → deckent CLI bridge ═══════════
//
// Wires the native REPL's McpToolDispatcher onto the real deckent CLI. When a
// slash command resolves to an MCP tool (chat-slash-registry.ts maps
// /status→deckent_status, /recall→deckent_memory_query, /sprint→deckent_history),
// runChatNativeLoop calls `dispatcher.dispatch(tool, args)`. This dispatcher
// translates that tool name into a `dist/cli/entry.js <subcommand>` spawn.
// Most tools spawn synchronously and return combined stdout, replacing the
// prior NOOP "tool not yet wired" stub. The `start`/`run`/`process submit`
// command-class is long-running (a sprint / one-shot worker / process-mode
// submit runs for minutes) — awaiting it the same way would freeze the whole
// REPL turn, so those route through `spawnDetachedDeckent` (detached-start.ts)
// instead: fire-and-forget, own process group, output captured to a
// `.deckent/recently-works/` log file. See `isDetachedCommandClass`.
//
// Spawn pattern mirrors chat-enterprise-bridge.ts (the sibling slash bridge).
// Tests inject `opts.spawnFn` / `opts.spawnDetachedFn` to stay hermetic (no
// real subprocess spawns).

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import type { McpToolDispatcher } from './chat-native.js';
import { spawnDetachedDeckent, type DetachedSpawnResult } from '../helpers/detached-start.js';
// NT-01/04/05 — the ONE tool-result containment chokepoint.
import {
  brokerToolResult,
  createSessionContentStore,
  type ContentWriter,
  type RawToolResult,
} from '../../agent/tool-result-broker.js';

// ─── Tool → CLI subcommand map ─────────────────────────────────────────────
//
// Allow-list of read-only MCP tools that are safe to spawn headlessly (each
// finishes quickly and never blocks on a stdin confirmation prompt). Tools
// with structured args (deckent_start / run / process / audit / autonomous / …)
// are NOT in this static map — they are arg-aware builders in cliArgsFor
// below. Anything cliArgsFor still can't resolve is refused with a tagged
// error so the headless spawn never hangs. Positional args (e.g.
// `/audit sprint-224`) flow through `args._rest`.

const TOOL_COMMANDS: Readonly<Record<string, readonly string[]>> = {
  deckent_status: ['status'],
  deckent_history: ['history'],
  deckent_retro: ['retro'],
  deckent_doctor: ['doctor'],
  // `models` is a parent command (bare → help); the catalog lives under `list`.
  deckent_models: ['models', 'list'],
  deckent_analyze_project: ['analyze'],
  deckent_review: ['review'],
  deckent_explain: ['explain'],
  deckent_agent_list: ['agent', 'list'],
  deckent_skill_list: ['skill', 'list'],
  deckent_feature_query: ['features'],
  // Cost/observability (read-only). `cost` is a parent command — `cost show` prints
  // budget limits, per-model pricing, and today's spend. `kpi` (bare) prints the
  // scorecard for the current sprint. Exposed to the phone bot (bot-agentic.ts
  // READ_ONLY_BOT_TOOLS). deckent_usage is arg-aware → special-cased in cliArgsFor.
  deckent_cost: ['cost', 'show'],
  deckent_kpi: ['kpi'],
  // config: show (no _rest) is read-only; `config set/import/migrate` mutate
  // config.json and are confirm-gated one layer up (run.tsx classifyTool).
  deckent_config: ['config'],
  // ── Write tools (confirm-gated) ──
  // plan writes .tasks/ JSON from DIRECTIVES; respects the project's configured
  // planning mode. Confirm-gated + the 30s timeout guards a slow AI plan.
  deckent_plan: ['plan'],
  deckent_sync: ['sync'],
  deckent_checkpoint: ['checkpoint'],
  // ── Destructive tools (always-confirm; run.tsx never auto-approves these) ──
  deckent_kill: ['kill'],
  deckent_cleanup: ['cleanup'],
  // recover prompts via readline unless --force; the REPL's always-confirm modal
  // IS the confirmation, so bake in --force to avoid a headless stdin hang.
  deckent_recover: ['recover', '--force'],
  // NOTE: deckent_watch is intentionally NOT here — a live event stream would
  // block the REPL turn forever, not just for a few minutes. deckent_start /
  // deckent_run / deckent_process are handled by the arg-aware builders below
  // (cliArgsFor) and route through the detached spawn path (isDetachedCommandClass)
  // instead of this static map. deckent_audit (provider-backed self-audit gate,
  // 30-60s+) and deckent_set_directives (stdin content) stay excluded here too.
  // deckent_memory_query is special-cased below: it needs the `query` arg
  // appended as the `recall <query>` positional.
};

/**
 * Safety net: kill a headless CLI spawn that runs longer than its budget (ms).
 *
 * Per-command-class budget (born-516): most bridged tools are read-only and
 * finish in seconds, so they use the conservative default. `audit`
 * (provider-backed self-audit gate, documented 30-60s+) and `plan` (AI plan
 * generation) are documented to legitimately run past 30s — a flat timeout
 * killed them mid-run. Add an entry to SPAWN_TIMEOUT_MS_BY_COMMAND for any
 * future tool documented to run long; everything else falls back to
 * DEFAULT_SPAWN_TIMEOUT_MS. The budget stays finite either way — never removed.
 */
const DEFAULT_SPAWN_TIMEOUT_MS = 30_000;
const SPAWN_TIMEOUT_MS_BY_COMMAND: Readonly<Record<string, number>> = {
  audit: 180_000,
  plan: 180_000,
};

/** Resolve the spawn-kill budget (ms) for a resolved CLI argv, keyed off its first token. */
export function resolveSpawnTimeoutMs(cliArgs: readonly string[]): number {
  const cmd = cliArgs[0];
  return (cmd !== undefined ? SPAWN_TIMEOUT_MS_BY_COMMAND[cmd] : undefined) ?? DEFAULT_SPAWN_TIMEOUT_MS;
}

// ─── Spawn injection ────────────────────────────────────────────────────────

/** Async function that invokes the deckent CLI with the given args and returns combined stdout+stderr. */
export type CliToolSpawnFn = (args: string[]) => Promise<string>;

/**
 * NT-05 — what the subprocess ACTUALLY did. The legacy {@link CliToolSpawnFn}
 * shape (one merged, trimmed string) cannot express an exit code, so a command
 * that failed was reported to the model as ordinary output. This is the shape
 * the dispatcher uses in production; stdout and stderr stay separate channels.
 */
export interface CliSpawnOutcome {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
}

/** Async function that invokes the deckent CLI and reports the real outcome. */
export type CliToolSpawnOutcomeFn = (args: string[]) => Promise<CliSpawnOutcome>;

/**
 * NT-05 — typed rejection for a spawn killed by its own kill-budget, so the
 * dispatcher classifies a timeout as `timeout` instead of sniffing the message
 * text. The message is unchanged (`timed out after Ns`) — it is the documented
 * protocol string the model and the existing tests both read.
 */
export class CliSpawnTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`timed out after ${timeoutMs / 1000}s`);
    this.name = 'CliSpawnTimeoutError';
  }
}

export interface CliToolDispatcherOptions {
  /**
   * Inject a fake spawn for hermetic tests; omit for the real child_process
   * spawn. LEGACY string seam: it carries no exit code, so a result from it is
   * only classified by its output markers (see resolveExitTruth). Prefer
   * `spawnOutcomeFn` when the test cares about exit truth.
   */
  spawnFn?: CliToolSpawnFn;
  /** Structured spawn seam (real exit code / signal). Default defaultSpawnOutcomeFn. */
  spawnOutcomeFn?: CliToolSpawnOutcomeFn;
  /** NT-01/04 — overflow content store; omitted → lazy session-scoped mkdtemp. */
  contentStore?: ContentWriter;
  /** NT-01/04 — preview budget in bytes. Default/clamp live in the broker. */
  maxPreviewBytes?: number;
  /** Inject a fake detached-spawn for hermetic tests; omit for the real spawnDetachedDeckent. */
  spawnDetachedFn?: typeof spawnDetachedDeckent;
  /** Project root passed to spawnDetachedDeckent (recently-works log dir + child cwd). Defaults to process.cwd(). */
  projectRoot?: string;
  /** Override the English-default detached-start message labels — see DEFAULT_DETACHED_START_LABELS. */
  detachedLabels?: Partial<DetachedStartLabels>;
  /** Override the English-default permission-denied classification label — see DEFAULT_PERMISSION_DENIED_LABEL. */
  permissionDeniedLabel?: string;
}

function resolveEntryPath(): string {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  // dist/cli/commands/ → ../entry.js → dist/cli/entry.js
  return join(__dirname, '..', 'entry.js');
}

/**
 * NT-05 — the real spawn. Resolves with the subprocess's honest outcome: the
 * exit code, the terminating signal, and stdout/stderr as SEPARATE channels
 * (they used to be concatenated into one buffer, which is why a command that
 * wrote a fatal error to stderr and exited 1 looked identical to a successful
 * one). Rejects with {@link CliSpawnTimeoutError} on the kill-budget and with
 * the raw spawn error (code preserved, born-509) on an OS-level failure.
 */
export function defaultSpawnOutcomeFn(args: string[]): Promise<CliSpawnOutcome> {
  return new Promise<CliSpawnOutcome>((resolve, reject) => {
    const entryPath = resolveEntryPath();
    const child = spawn(process.execPath, [entryPath, ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env },
    });
    let out = '';
    let errOut = '';
    let settled = false;
    // Safety net: if a command runs past its budget (an unexpectedly slow or
    // auth-blocked subcommand), kill it and surface a tagged error rather than
    // freezing the REPL turn forever. Budget is per-command-class — see
    // resolveSpawnTimeoutMs.
    const timeoutMs = resolveSpawnTimeoutMs(args);
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { child.kill('SIGKILL'); } catch { /* already gone */ }
      reject(new CliSpawnTimeoutError(timeoutMs));
    }, timeoutMs);
    child.stdout?.setEncoding('utf-8');
    child.stderr?.setEncoding('utf-8');
    child.stdout?.on('data', (chunk: string) => { out += chunk; });
    child.stderr?.on('data', (chunk: string) => { errOut += chunk; });
    // born-509 spawn-hardening: without this, a spawn-level failure (e.g. ENOENT)
    // is silently dropped and the promise hangs until the timeout fires instead
    // of surfacing the real error immediately.
    child.once('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });
    child.once('close', (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        stdout: out.trim(),
        stderr: errOut.trim(),
        exitCode: typeof code === 'number' ? code : null,
        signal: signal ?? null,
      });
    });
  });
}

/**
 * Back-compatible string wrapper over {@link defaultSpawnOutcomeFn} — the
 * legacy `CliToolSpawnFn` shape (stdout+stderr merged and trimmed, exit code
 * dropped). Kept because it is the exported seam existing callers and the
 * hermetic timeout tests use directly; production dispatch goes through the
 * outcome function so exit truth survives.
 */
export function defaultSpawnFn(args: string[]): Promise<string> {
  return defaultSpawnOutcomeFn(args).then((outcome) =>
    [outcome.stdout, outcome.stderr].filter((part) => part.length > 0).join('\n'),
  );
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Resolve an MCP tool name + args to the deckent CLI argv it would spawn.
 *
 * Returns null for a tool not in the allow-list. Used by both the dispatcher
 * (to spawn) and the REPL confirm modal (to show the user the exact command
 * that will run). deckent_memory_query is NOT covered here — it is special-cased
 * in dispatch because its `query` arg maps to a `recall <query>` positional.
 */
export function cliArgsFor(name: string, args: Record<string, unknown>): string[] | null {
  // ── Arg-aware builders (Sprint 269 follow-up — the /autonomous, /audit and
  // /directives slashes dispatch these tools with structured args; the static
  // map below cannot express them). Long-running actions stay excluded:
  // `autonomous start` runs the engine loop and would block the REPL turn
  // (and be killed by SPAWN_TIMEOUT_MS) — run it standalone via the CLI.
  if (name === 'deckent_autonomous') {
    const action = typeof args['action'] === 'string' ? (args['action'] as string) : '';
    if (action === 'status' || action === 'stop' || action === 'pending') return ['autonomous', action];
    if (action === 'approve' || action === 'reject') {
      const id = typeof args['triggerId'] === 'string' ? (args['triggerId'] as string) : '';
      return id ? ['autonomous', action, id] : null;
    }
    if (action === 'backlog_list') return ['autonomous', 'backlog', 'list'];
    if (action === 'backlog_add') {
      const id = typeof args['id'] === 'string' ? (args['id'] as string) : '';
      const title = typeof args['title'] === 'string' ? (args['title'] as string) : '';
      if (!id || !title) return null;
      const argv = ['autonomous', 'backlog', 'add', '--id', id, '--title', title];
      if (typeof args['cron'] === 'string' && (args['cron'] as string).length > 0) {
        argv.push('--cron', args['cron'] as string);
      }
      return argv;
    }
    return null; // start (long-running) and unknown actions stay excluded
  }
  if (name === 'deckent_audit') {
    const action = typeof args['action'] === 'string' ? (args['action'] as string) : 'gate';
    if (action === 'gate') {
      const sprint = typeof args['sprintId'] === 'string' ? (args['sprintId'] as string) : '';
      return sprint ? ['audit', sprint] : ['audit'];
    }
    if (action === 'query') {
      const argv = ['audit', 'query'];
      if (typeof args['channel'] === 'string' && (args['channel'] as string).length > 0) {
        argv.push('--action', args['channel'] as string);
      }
      return argv;
    }
    if (action === 'compliance') return ['audit', 'compliance'];
    return null; // forward/retention (network/destructive) stay CLI-only
  }
  if (name === 'deckent_usage') {
    const argv: string[] = ['usage'];
    if (typeof args['sprint'] === 'string' && (args['sprint'] as string).length > 0) {
      argv.push('--sprint', args['sprint'] as string);
    }
    if (typeof args['since'] === 'string' && (args['since'] as string).length > 0) {
      argv.push('--since', args['since'] as string);
    }
    if (typeof args['until'] === 'string' && (args['until'] as string).length > 0) {
      argv.push('--until', args['until'] as string);
    }
    return argv;
  }
  if (name === 'deckent_resources') {
    const argv: string[] = ['resources'];
    if (args['log'] === true) {
      argv.push('--log');
    } else if (typeof args['log'] === 'string' && (args['log'] as string).length > 0) {
      argv.push('--log', args['log'] as string);
    }
    return argv;
  }
  if (name === 'deckent_set_directives') {
    const content = typeof args['content'] === 'string' ? (args['content'] as string) : '';
    return content.length > 0 ? ['set-directives', '--content', content] : null;
  }
  // REPL-DETACHED-START (358-003): start/run/process are long-running — the
  // caller routes their resolved argv through spawnDetachedDeckent instead of
  // the synchronous spawnFn (see isDetachedCommandClass + dispatch below).
  // Building real CLI argv here still matters even for the detached path: it
  // is also what the REPL confirm modal shows the user before running.
  if (name === 'deckent_start') {
    const argv: string[] = ['start'];
    if (args['autoApprove'] === true) argv.push('--auto-approve');
    if (args['sandbox'] === true) argv.push('--sandbox');
    if (args['force'] === true) argv.push('--force');
    if (args['dryRun'] === true) argv.push('--dry-run');
    if (typeof args['timeout'] === 'number' && Number.isFinite(args['timeout'])) {
      argv.push('--timeout', String(args['timeout']));
    }
    return argv;
  }
  if (name === 'deckent_run') {
    const description = typeof args['description'] === 'string' ? (args['description'] as string).trim() : '';
    if (!description) return null;
    const argv: string[] = ['run', description];
    if (typeof args['model'] === 'string' && (args['model'] as string).length > 0) {
      argv.push('--model', args['model'] as string);
    }
    if (typeof args['modelEffort'] === 'string' && (args['modelEffort'] as string).length > 0) {
      argv.push('--model-effort', args['modelEffort'] as string);
    }
    if (typeof args['scope'] === 'string' && (args['scope'] as string).length > 0) {
      argv.push('--scope', args['scope'] as string);
    }
    if (typeof args['timeoutMs'] === 'number' && Number.isFinite(args['timeoutMs'])) {
      argv.push('--timeout', String(args['timeoutMs']));
    }
    if (args['keep'] === true) argv.push('--keep');
    if (args['autoApprove'] === true) argv.push('--auto-approve');
    return argv;
  }
  if (name === 'deckent_process') {
    const action = typeof args['action'] === 'string' ? (args['action'] as string) : '';
    if (action === 'submit') {
      const description = typeof args['description'] === 'string' ? (args['description'] as string).trim() : '';
      if (!description) return null;
      const argv: string[] = ['process', 'submit', description];
      if (typeof args['kind'] === 'string' && (args['kind'] as string).length > 0) {
        argv.push('--kind', args['kind'] as string);
      }
      if (typeof args['scopeDir'] === 'string' && (args['scopeDir'] as string).length > 0) {
        argv.push('--scope-dir', args['scopeDir'] as string);
      }
      if (typeof args['provider'] === 'string' && (args['provider'] as string).length > 0) {
        argv.push('--provider', args['provider'] as string);
      }
      if (typeof args['model'] === 'string' && (args['model'] as string).length > 0) {
        argv.push('--model', args['model'] as string);
      }
      return argv;
    }
    if (action === 'status' || action === 'result') {
      const executionId = typeof args['executionId'] === 'string' ? (args['executionId'] as string).trim() : '';
      return executionId ? ['process', action, executionId] : null;
    }
    return null;
  }

  const base = TOOL_COMMANDS[name];
  if (!base) return null;
  const cliArgs = [...base];
  // Positional args from a slash line (e.g. `/config set k v`) arrive as
  // args._rest; append the string entries to the subcommand.
  const rest = args['_rest'];
  if (Array.isArray(rest)) {
    for (const r of rest) if (typeof r === 'string') cliArgs.push(r);
  }
  return cliArgs;
}

// ─── Detached command-class routing ────────────────────────────────────────
//
// `start` (sprint), `run` (one-shot worker), and `process submit` (process-mode
// submit) run for minutes — spawning them through the synchronous
// spawn-and-await-close path (defaultSpawnFn) would freeze the whole REPL
// turn. Decided from the RESOLVED cliArgs (not the tool name) so it stays
// correct regardless of which MCP tool mapped to that argv. Everything else
// (status, config, kill, process status/result, …) is untouched — sync path
// unchanged.

/** True for the `start` / `run` / `process submit` command-class. */
export function isDetachedCommandClass(cliArgs: readonly string[]): boolean {
  const [cmd, sub] = cliArgs;
  return cmd === 'start' || cmd === 'run' || (cmd === 'process' && sub === 'submit');
}

/**
 * String-free mechanism (CLAUDE.md i18n-first): the detached-start
 * confirmation text uses English-default labels the caller may override via
 * `CliToolDispatcherOptions.detachedLabels` — same "labels injected by
 * caller, English default" seam already established in live-footer.ts, which
 * itself defers full en/tr wiring through messages.ts to a follow-up task.
 * messages.ts is outside this task's write scope (task 358-003).
 */
export interface DetachedStartLabels {
  started: string;
  log: string;
  trackHint: string;
}

export const DEFAULT_DETACHED_START_LABELS: DetachedStartLabels = {
  started: 'Started',
  log: 'log',
  trackHint: 'track via /status or the live footer',
};

/**
 * born-538 (TOOL-BRIDGE-ERR-CLASS): a spawn/spawnDetached failure whose errno
 * is EACCES or EPERM means the OS/user identity refused to run the CLI at
 * all — a permission problem, not a broken command. Distinguishing this from
 * a genuine runtime failure (ENOENT, non-zero exit, timeout, …) lets the
 * caller tell the user *why* a tool call failed instead of a one-size-fits-all
 * "[mcp-error]". Node sets `.code` on the Error passed to the child's
 * `'error'` event (born-509's listener, untouched by this change) for a
 * spawn-level OS failure — see child_process docs.
 */
function isPermissionDeniedError(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException | undefined)?.code;
  return code === 'EACCES' || code === 'EPERM';
}

/**
 * String-free mechanism (CLAUDE.md i18n-first), same seam as
 * DetachedStartLabels: the caller may override via
 * `CliToolDispatcherOptions.permissionDeniedLabel`; messages.ts wiring
 * (getMessage + lang) is a follow-up outside this task's write scope.
 */
export const DEFAULT_PERMISSION_DENIED_LABEL = 'permission denied';

function formatDetachedStartMessage(
  cliArgs: readonly string[],
  result: DetachedSpawnResult,
  labels: DetachedStartLabels,
): string {
  const pidStr = result.pid !== null ? String(result.pid) : 'unknown';
  return `${labels.started}: deckent ${cliArgs.join(' ')} (pid ${pidStr}). ${labels.log}: ${result.logPath} — ${labels.trackHint}.`;
}

/**
 * Build an McpToolDispatcher that runs deckent CLI subcommands headlessly.
 *
 * Supports the read-only allow-list (TOOL_COMMANDS) plus deckent_config and
 * deckent_memory_query (recall). Any tool outside the allow-list returns a
 * `[mcp-error] tool not allowed: <name>` string. Per the McpToolDispatcher
 * contract, dispatch NEVER throws: spawn failures, timeouts, and bad args are
 * returned as `[mcp-error] …` strings so the chat loop can surface them as
 * ordinary turn output. Write/destructive confirmation is enforced one layer
 * up (run.tsx, via tool-permissions.classifyTool) before dispatch is called.
 *
 * born-538: a spawn/spawnDetached failure classified as permission-denied
 * (EACCES/EPERM — see isPermissionDeniedError) is tagged `[deckent-denied] …`
 * instead of `[mcp-error] …` — reusing the same denied-vs-error prefix split
 * native-tool-registry.ts already produces and run.tsx already renders
 * distinctly (isDenied/isError, run.tsx ~432-433), so this bridge's denied
 * outcomes now flow through that existing UI path instead of reading as a
 * generic broken-command error.
 *
 * `start` / `run` / `process submit` are the exception to "spawn and await
 * stdout": they route through spawnDetachedDeckent (fire-and-forget, own
 * process group, logged to `.deckent/recently-works/`) so a multi-minute
 * sprint/task never blocks the REPL turn — see isDetachedCommandClass.
 */
export function createCliToolDispatcher(opts: CliToolDispatcherOptions = {}): McpToolDispatcher {
  // A caller-injected legacy string fn wins (existing hermetic tests); nothing
  // injected → the structured spawn, so production keeps the real exit code.
  const spawnFn = opts.spawnFn;
  const spawnOutcomeFn = opts.spawnOutcomeFn ?? defaultSpawnOutcomeFn;
  const spawnDetachedFn = opts.spawnDetachedFn ?? spawnDetachedDeckent;
  const labels: DetachedStartLabels = { ...DEFAULT_DETACHED_START_LABELS, ...opts.detachedLabels };
  const permissionDeniedLabel = opts.permissionDeniedLabel ?? DEFAULT_PERMISSION_DENIED_LABEL;
  const contentStore = opts.contentStore ?? createSessionContentStore();

  const failure = (output: string, reason: RawToolResult['reason']): RawToolResult =>
    ({ output, ok: false, reason });

  const classifySpawnError = (name: string, err: unknown): RawToolResult => {
    if (err instanceof CliSpawnTimeoutError) return failure(`[mcp-error] ${name}: ${err.message}`, 'timeout');
    if (isPermissionDeniedError(err)) return failure(`[deckent-denied] ${name}: ${permissionDeniedLabel}`, 'denied');
    const msg = err instanceof Error ? err.message : String(err);
    return failure(`[mcp-error] ${name}: ${msg}`, 'spawn-error');
  };

  const runTool = async (name: string, args: Record<string, unknown>): Promise<RawToolResult> => {
      let cliArgs: string[];
      if (name === 'deckent_memory_query') {
        const query = typeof args['query'] === 'string' ? (args['query'] as string).trim() : '';
        const cursor = typeof args['cursor'] === 'string' ? (args['cursor'] as string).trim() : '';
        const detailRef = typeof args['detail_ref'] === 'string' ? (args['detail_ref'] as string).trim() : '';
        if (query.length === 0 && detailRef.length === 0) {
          return failure('[mcp-error] recall: query or detail_ref required', 'tool-error');
        }
        cliArgs = [
          'recall',
          ...(query.length > 0 ? [query] : []),
          ...(cursor.length > 0 ? ['--cursor', cursor] : []),
          ...(detailRef.length > 0 ? ['--detail', detailRef] : []),
        ];
      } else {
        const built = cliArgsFor(name, args);
        if (!built) return failure(`[mcp-error] tool not allowed: ${name}`, 'tool-error');
        cliArgs = built;
      }
      if (isDetachedCommandClass(cliArgs)) {
        try {
          // 583/N5: REPL-chat-origin start/run/process-submit are interactive —
          // the detached child streams live worker activity (env twin).
          const result = spawnDetachedFn(cliArgs, { projectRoot: opts.projectRoot, liveTrace: true });
          // Fire-and-forget: the spawn SUCCEEDED, the sprint's own outcome is
          // reported later through its log — never asserted here.
          return { output: formatDetachedStartMessage(cliArgs, result, labels), ok: true };
        } catch (err) {
          return classifySpawnError(name, err);
        }
      }
      try {
        if (spawnFn !== undefined) {
          // Legacy seam: no exit code exists, so ok is left to the output's own
          // protocol markers rather than invented here.
          return { output: await spawnFn(cliArgs), ok: true };
        }
        // NT-05: ok comes from the REAL exit code / signal — never from the
        // mere fact that the promise resolved.
        const outcome = await spawnOutcomeFn(cliArgs);
        const failedBySignal = outcome.signal !== null;
        const failedByExit = outcome.exitCode !== null && outcome.exitCode !== 0;
        return {
          output: outcome.stdout,
          stderr: outcome.stderr,
          exitCode: outcome.exitCode,
          signal: outcome.signal,
          ok: !failedBySignal && !failedByExit,
          reason: failedBySignal ? 'signal' : failedByExit ? 'exit-code' : undefined,
        };
      } catch (err) {
        return classifySpawnError(name, err);
      }
  };

  return {
    async dispatch(name, args) {
      // NT-01/04/05: the single exit — every bridged result is contained and
      // exit-truthed here, so no branch above can hand the loop raw, unbounded
      // output or a fabricated success.
      return brokerToolResult(await runTool(name, args), {
        store: contentStore,
        maxPreviewBytes: opts.maxPreviewBytes,
      });
    },
  };
}
