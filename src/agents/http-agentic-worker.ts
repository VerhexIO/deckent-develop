// ═══ http-agentic-worker — provider-agnostic HTTP agentic loop (F1-013 v1) ═══
//
// AS-2 Faz-2 enabler. Today a CLI-less provider (OpenAI-compatible / Bedrock /
// any `/chat/completions` API) can `chat()` but CANNOT run an agentic sprint
// worker — `OpenAICompatibleAdapter.spawn()` throws. This module is the v1
// single-task, end-to-end, headless agentic loop that closes that gap:
//
//   • `runHttpAgenticWorker(opts)` — drives the injected `send()` (one
//     `/chat/completions` round with tools) in a tool-use cycle, executing the
//     model's tool calls through the EXISTING `chat-tool-exec` executor layer
//     (read/write/edit/bash), with ADR-037 scope enforcement on write/edit.
//   • `runHttpWorkerEntry(argv, projectDir, deps)` — the subprocess entry shim
//     `OpenAICompatibleAdapter.spawn()` launches: reads `.tasks/task-{id}.json`,
//     drives the loop, and writes the `.hb` heartbeat + `.result` in the exact
//     api-surface shape Brain ingests (mirrors `agentic-worker-entry.ts`).
//
// Reuse, NOT duplication (do NOT edit `agentic-worker-runner.ts`):
//   • System prompt parity → `buildSystemPrompt` (shared CLI/agentic source
//     builders) is imported verbatim, so the HTTP path carries byte-identical
//     scope/goNogo/verify-precedence/ADR text.
//   • Tool schemas → `OLLAMA_TOOLS` (vendor-doc-confirmed OpenAI-compatible
//     shape — see agentic-worker-tools.ts header) are advertised verbatim.
//   • Scope guard → `isPathInScope` (scope-guard.ts).
//   • Tool execution → `createToolExecDispatcher` (chat-tool-exec.ts, READ-only).
//   • Result plumbing → `computeNumstat` + `EntryResultFile` shape
//     (agentic-worker-entry.ts) + `normalizeUsage` (token-usage.ts).
// The loop itself is `send()`-based (OpenAI tool_calls), a genuinely different
// cycle from the Ollama `/api/chat` runner — only small glue (arg parse, tool
// name map, test-command sniff) is re-created here because the runner does not
// export it and must not be edited.
//
// SCOPE_INSUFFICIENT event-stream emission parity with the Ollama runner landed
// in phase-2 (334-005): an out-of-scope write/edit now ALSO emits the same
// WORKER→BRAIN:SCOPE_INSUFFICIENT event (same channel + payload + writeEvent
// helper) the Ollama runner emits, in addition to feeding the error to the model.
//
// v1 scope: ONE task uçtan uca. Explicit phase-2 follow-ups (noted, not stubbed):
//   TODO(phase2): multi-worker concurrency on a single adapter instance.
//   TODO(phase2): full ollama tool-loop parity surface (streaming, tool retries).

import { fileURLToPath } from 'node:url';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import {
  createToolExecDispatcher,
  type ToolExecOptions,
} from '../cli/commands/chat-tool-exec.js';
import type { McpToolDispatcher } from '../cli/commands/chat-native.js';
import { OLLAMA_TOOLS, wrapDispatcherWithApprovalGate, type ApprovalGateLike } from './agentic-worker-tools.js';
import { setupWorkerApprovalGateFromEnv } from './worker-approval-env.js';
import { isPathInScope } from './scope-guard.js';
import {
  writeEvent,
  getCurrentSprintId,
  SCOPE_INSUFFICIENT_CHANNEL,
  type DeckentEvent,
} from '../orchestra/event-stream.js';
import {
  buildSystemPrompt,
  DEFAULT_MAX_ITERATIONS,
  type SelfAssessment,
  type AgenticRunnerScope,
  type AgenticRunnerGoNogo,
} from './agentic-worker-runner.js';
import {
  computeNumstat,
  readHostCompiledWorkerPrompt,
  type EntryResultFile,
  type EntryTokenUsage,
} from './agentic-worker-entry.js';
import { normalizeUsage } from '../core/token-usage.js';
import { writeTaskHeartbeatFile } from '../core/worker-activity-heartbeat.js';

// ─── Public types ─────────────────────────────────────────────────────────────

export { DEFAULT_MAX_ITERATIONS };

/** Default provider label when the caller does not name the concrete provider. */
export const DEFAULT_HTTP_PROVIDER = 'openai-compatible';

/**
 * OpenAI `/chat/completions` message (superset: includes the `tool` role and
 * the assistant's `tool_calls`, used by the agentic loop). Structurally equal to
 * `OpenAICompatibleAdapter`'s widened `ChatMessage`; kept local so the loop
 * (agents/) carries no provider (providers/) import.
 */
export interface HttpAgenticMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: HttpAgenticToolCall[];
  tool_call_id?: string;
  name?: string;
}

/**
 * OpenAI tool-call shape. `arguments` is a JSON string on the wire (OpenAI) but
 * we accept a pre-parsed object too (lenient — some gateways return objects).
 */
export interface HttpAgenticToolCall {
  id?: string;
  type?: 'function';
  function: { name: string; arguments: string | Record<string, unknown> };
}

/** One model turn: assistant text + any tool calls + optional usage capture. */
export interface HttpAgenticTurn {
  content: string;
  toolCalls: HttpAgenticToolCall[];
  /** Provider-reported token usage for this turn (already extracted, no re-count). */
  usage?: { inputTokens: number; outputTokens: number };
}

/**
 * Injected provider turn fn — runs ONE `/chat/completions` round with `tools`
 * and returns the parsed turn. Production binds `OpenAICompatibleAdapter.send`;
 * tests inject a scripted fake so no network is ever touched. This is the single
 * seam that keeps the loop provider-agnostic AND hermetic.
 */
export type HttpAgenticSend = (
  messages: HttpAgenticMessage[],
  model: string,
  opts: { tools: readonly unknown[] },
) => Promise<HttpAgenticTurn>;

/**
 * Injected event-stream emitter — the seam that makes scope-violation emission
 * hermetic. Production binds {@link buildDefaultEmitEvent} (the EXACT Ollama-runner
 * contract: `getCurrentSprintId` gate → `writeEvent(projectRoot, sprintId, source,
 * target, channel, payload)`); tests inject a fake recorder so the emission is
 * asserted with no disk write. The `(source, target, channel, payload)` shape
 * mirrors `writeEvent`, so the reused SCOPE_INSUFFICIENT contract is fully visible
 * to the seam — no new event shape is introduced.
 */
export type HttpAgenticEventEmitter = (
  source: DeckentEvent['source'],
  target: DeckentEvent['target'],
  channel: string,
  payload: unknown,
) => void;

/** Token usage returned by the loop. `provider` is configurable (not ollama-fixed). */
export interface HttpAgenticTokenUsage {
  inputTokens: number;
  outputTokens: number;
  provider: string;
  /** Remote API cost is filled server-side by the orchestrator; loop reports 0. */
  cost: number;
}

export interface HttpAgenticResult {
  taskId: string;
  filesChanged: string[];
  testsPassed?: boolean;
  selfAssessment: SelfAssessment;
  notes: string;
  iterations: number;
  terminationReason: 'task_done' | 'no_tool_calls' | 'max_iterations' | 'api_error';
  tokenUsage: HttpAgenticTokenUsage;
}

export interface HttpAgenticRunnerOptions {
  taskId: string;
  /** Provider model id (e.g. `deepseek-chat`) — forwarded to `send`. */
  model: string;
  /** Task instructions surfaced to the model as the first user turn. */
  prompt: string;
  scope: AgenticRunnerScope;
  goNogo: AgenticRunnerGoNogo;
  /** Optional pre-rendered operative-ADR block (== CLI `adrBlock`); omitted when absent. */
  operativeAdrs?: string;
  /** Project root — resolves relative paths; also the `cwd` for tool execution. */
  projectRoot: string;
  /** Concrete provider id for `tokenUsage.provider` (default `openai-compatible`). */
  provider?: string;
  /** Default 25 (== runner DEFAULT_MAX_ITERATIONS). */
  maxIterations?: number;
  /** REQUIRED injected provider turn fn — keeps the loop pure + hermetic. */
  send: HttpAgenticSend;
  /**
   * Optional tool dispatcher override. Default builds a `createToolExecDispatcher`
   * and maps native tool names (`read_file`) → chat-tool-exec (`deckent_read_file`).
   * Scope-guard wraps the call BEFORE dispatch either way.
   */
  dispatcher?: McpToolDispatcher;
  /**
   * Optional event-stream emitter override. Default mirrors the Ollama runner's
   * SCOPE_INSUFFICIENT contract (write to the project's event stream when a sprint
   * is active, no-op otherwise). Tests inject a fake to assert emission hermetically.
   */
  emitEvent?: HttpAgenticEventEmitter;
  logger?: (line: string) => void;
  /**
   * born-611 (APR-P0): when supplied AND `enabled`, the tool dispatcher is
   * wrapped with `wrapDispatcherWithApprovalGate` (risky tool-classes gate
   * through `guard()` before dispatch). Omitted/disabled → byte-identical
   * dispatcher reference. Gate construction + external-decision driving is
   * the entry's job — see `worker-approval-env.ts`.
   */
  approvalGate?: { enabled: boolean; gate: ApprovalGateLike; scopeId: string };
}

// ─── Tool argument parsing + dispatch glue ────────────────────────────────────
// Re-created (not duplicated loop logic) because agentic-worker-runner.ts does
// not export these and must not be edited; OpenAI delivers `arguments` as a JSON
// STRING, so string→object parsing is mandatory here.

function parseToolArgs(
  raw: string | Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (raw == null) return {};
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return typeof parsed === 'object' && parsed !== null
        ? (parsed as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  }
  if (typeof raw === 'object') return raw;
  return {};
}

/** Maps the native (model-facing) tool names onto the chat-tool-exec surface. */
const TOOL_NAME_MAP: Record<string, string> = {
  read_file: 'deckent_read_file',
  write_file: 'deckent_write_file',
  edit_file: 'deckent_edit_file',
  run_bash: 'deckent_bash',
};

function buildDefaultDispatcher(projectRoot: string): McpToolDispatcher {
  // Scope is ENFORCED by the loop before dispatch, so the confirm hook is not
  // the security boundary here → auto-approve.
  const opts: ToolExecOptions = { cwd: projectRoot, confirm: async () => true };
  const inner = createToolExecDispatcher(opts);
  return {
    async dispatch(name, args) {
      const mapped = TOOL_NAME_MAP[name];
      if (!mapped) return `[mcp-error] unknown tool: ${name}`;
      return inner.dispatch(mapped, args);
    },
  };
}

// ─── Scope-violation event emitter (Ollama-runner contract parity) ────────────
// Mirrors agentic-worker-runner.ts: gate on an active sprint id, then writeEvent
// to the project event stream. Same channel + payload + helper as the Ollama
// runner — no new event shape. No active sprint id → no-op (e.g. ad-hoc invocations
// and the existing hermetic loop tests that do not seed sprint-state).
function buildDefaultEmitEvent(projectRoot: string): HttpAgenticEventEmitter {
  return (source, target, channel, payload) => {
    const sprintId = getCurrentSprintId(projectRoot);
    if (sprintId) {
      writeEvent(projectRoot, sprintId, source, target, channel, payload);
    }
  };
}

// ─── Test-command sniffer (testsPassed derivation) ────────────────────────────

const TEST_CMD_PATTERNS = [
  /\bvitest\b/i,
  /\bnpm\s+(test|t)\b/i,
  /\bpnpm\s+(test|t)\b/i,
  /\byarn\s+(test|t)\b/i,
  /\bpytest\b/i,
  /\bcargo\s+test\b/i,
  /\bgo\s+test\b/i,
];

function looksLikeTestCommand(cmd: string): boolean {
  return TEST_CMD_PATTERNS.some(re => re.test(cmd));
}

function bashOutputSuggestsFailure(output: string): boolean {
  // chat-tool-exec's defaultBashRun appends `[exit N]` for N!=0.
  return /\[exit\s+\d+\]\s*$/.test(output.trim());
}

// ─── Loop ─────────────────────────────────────────────────────────────────────

/**
 * Drive an HTTP (OpenAI-compatible) provider through the agentic tool-calling
 * loop. Loop body per turn:
 *   1. `send(messages, model, { tools })` → `{ content, toolCalls, usage }`.
 *   2. No tool calls → content-only turn → terminate (filesChanged>0 ? DONE : NO_GO).
 *   3. For each tool call:
 *      • `task_done` → terminate with the model's assessment (honest defaults
 *        when missing — mirrors the Ollama runner).
 *      • `write_file` / `edit_file` → scope-guard. Out-of-scope returns an error
 *        STRING to the model (no dispatch, no disk write) so it can self-correct.
 *      • Otherwise dispatch via chat-tool-exec.
 *      • Append `{ role:'tool', tool_call_id, content }` so the model sees the outcome.
 *   4. Tally filesChanged (post-dispatch success only) + testsPassed.
 *   5. Loop up to `maxIterations`, then terminate (filesChanged>0 ? GO_WITH_TECH_DEBT : NO_GO).
 */
export async function runHttpAgenticWorker(
  opts: HttpAgenticRunnerOptions,
): Promise<HttpAgenticResult> {
  const {
    taskId,
    model,
    prompt,
    scope,
    goNogo,
    operativeAdrs,
    projectRoot,
    provider = DEFAULT_HTTP_PROVIDER,
    maxIterations = DEFAULT_MAX_ITERATIONS,
    send,
    dispatcher: injectedDispatcher,
    emitEvent: injectedEmitEvent,
    logger = () => undefined,
    approvalGate,
  } = opts;

  const baseDispatcher = injectedDispatcher ?? buildDefaultDispatcher(projectRoot);
  // born-611: approval-gate sarımı — flag-off/absent yolunda wrapper YOK,
  // referans bire-bir baseDispatcher (wrapDispatcherWithApprovalGate kontratı).
  const dispatcher = approvalGate
    ? wrapDispatcherWithApprovalGate(baseDispatcher, {
        enabled: approvalGate.enabled,
        gate: approvalGate.gate,
        scopeId: approvalGate.scopeId,
      })
    : baseDispatcher;
  const emitEvent = injectedEmitEvent ?? buildDefaultEmitEvent(projectRoot);

  const messages: HttpAgenticMessage[] = [
    { role: 'system', content: buildSystemPrompt(scope, goNogo, operativeAdrs) },
    { role: 'user', content: prompt },
  ];

  const filesChanged = new Set<string>();
  let testsPassed: boolean | undefined;
  let iterations = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  const tokenUsage = (): HttpAgenticTokenUsage => ({
    inputTokens,
    outputTokens,
    provider,
    cost: 0,
  });

  for (let iter = 0; iter < maxIterations; iter++) {
    iterations = iter + 1;

    let turn: HttpAgenticTurn;
    try {
      turn = await send(messages, model, { tools: OLLAMA_TOOLS });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger(`[http-agentic] send failed: ${msg}`);
      return {
        taskId,
        filesChanged: [...filesChanged],
        testsPassed,
        selfAssessment: 'NO_GO',
        notes: `Provider /chat/completions failed: ${msg}`,
        iterations,
        terminationReason: 'api_error',
        tokenUsage: tokenUsage(),
      };
    }

    if (turn.usage) {
      if (Number.isFinite(turn.usage.inputTokens)) inputTokens += turn.usage.inputTokens;
      if (Number.isFinite(turn.usage.outputTokens)) outputTokens += turn.usage.outputTokens;
    }

    const assistantContent = turn.content ?? '';
    const toolCalls = turn.toolCalls ?? [];

    // Echo the assistant turn so the model sees its own prior tool_calls next round.
    messages.push({
      role: 'assistant',
      content: assistantContent,
      tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
    });

    // Termination: content-only turn (the "final answer").
    if (toolCalls.length === 0) {
      const sa: SelfAssessment = filesChanged.size > 0 ? 'DONE' : 'NO_GO';
      const note =
        filesChanged.size > 0
          ? `Model finished with content-only turn after ${filesChanged.size} file change(s). Assistant: ${assistantContent.slice(0, 300)}`
          : `Model returned no tool calls and no files were changed. Assistant: ${assistantContent.slice(0, 300)}`;
      return {
        taskId,
        filesChanged: [...filesChanged],
        testsPassed,
        selfAssessment: sa,
        notes: note,
        iterations,
        terminationReason: 'no_tool_calls',
        tokenUsage: tokenUsage(),
      };
    }

    for (const call of toolCalls) {
      const name = call.function?.name ?? '';
      const args = parseToolArgs(call.function?.arguments);
      const callId = call.id ?? `call-${iter}-${name}`;

      // Termination: task_done.
      if (name === 'task_done') {
        const rawSa = String(args['selfAssessment'] ?? '').toUpperCase();
        const saValid =
          rawSa === 'DONE' || rawSa === 'GO_WITH_TECH_DEBT' || rawSa === 'NO_GO';
        // Honest default when the model omits a valid assessment: demonstrably-done
        // work is GO_WITH_TECH_DEBT (not punished as NO_GO); empty-handed → NO_GO.
        const validSa: SelfAssessment = saValid
          ? (rawSa as SelfAssessment)
          : filesChanged.size > 0
            ? 'GO_WITH_TECH_DEBT'
            : 'NO_GO';
        const rawNote = args['notes'];
        const note =
          typeof rawNote === 'string' && rawNote.trim()
            ? rawNote
            : saValid
              ? 'task_done called without notes'
              : `task_done called without a valid selfAssessment; defaulted to ${validSa} (${filesChanged.size} file change(s))`;
        logger(`[http-agentic] task_done: ${validSa}`);
        return {
          taskId,
          filesChanged: [...filesChanged],
          testsPassed,
          selfAssessment: validSa,
          notes: note,
          iterations,
          terminationReason: 'task_done',
          tokenUsage: tokenUsage(),
        };
      }

      // Scope-guard for write/edit (hard-reject — ADR-037 RBAC).
      if (name === 'write_file' || name === 'edit_file') {
        const targetPath = String(args['path'] ?? '');
        if (!isPathInScope(targetPath, scope, projectRoot)) {
          const errMsg = `[scope-violation] ${name}: path "${targetPath}" is outside the assigned task scope. Allowed files: ${scope.filesWrite.join(', ') || '(none)'} ; Allowed directories: ${scope.directories.join(', ') || '(none)'}. Choose a path inside the scope or call task_done with NO_GO if no in-scope path is suitable.`;
          // Provider-symmetric observability (Yasa #2): emit the SAME
          // WORKER→BRAIN:SCOPE_INSUFFICIENT event the Ollama runner emits so the
          // Auditor/Brain see scope violations from HTTP-provider workers too. One
          // event per violation. The model-facing error feed below is unchanged.
          emitEvent('worker', 'brain', SCOPE_INSUFFICIENT_CHANNEL, {
            taskId,
            attemptedPath: targetPath,
            reason: errMsg,
            goCriteria: goNogo.goCriteria,
            currentScope: { filesWrite: scope.filesWrite, directories: scope.directories },
          });
          messages.push({ role: 'tool', content: errMsg, tool_call_id: callId, name });
          logger(`[http-agentic] scope rejection: ${targetPath}`);
          continue;
        }
      }

      let result: string;
      try {
        result = await dispatcher.dispatch(name, args);
      } catch (err) {
        result = `[mcp-error] ${name}: ${err instanceof Error ? err.message : String(err)}`;
      }

      // Track filesChanged on post-dispatch success only.
      if ((name === 'write_file' || name === 'edit_file') && !result.startsWith('[mcp-error]')) {
        filesChanged.add(String(args['path'] ?? ''));
      }

      // testsPassed sniffer for run_bash.
      if (name === 'run_bash') {
        const cmd = String(args['cmd'] ?? args['command'] ?? '');
        if (looksLikeTestCommand(cmd)) {
          testsPassed = !bashOutputSuggestsFailure(result);
        }
      }

      messages.push({ role: 'tool', content: result, tool_call_id: callId, name });
    }
  }

  // Termination: max iterations reached.
  const sa: SelfAssessment = filesChanged.size > 0 ? 'GO_WITH_TECH_DEBT' : 'NO_GO';
  const note =
    filesChanged.size > 0
      ? `Reached maxIterations=${maxIterations} after ${filesChanged.size} file change(s) without task_done — task incomplete.`
      : `Reached maxIterations=${maxIterations} with no file changes and no task_done — model did not converge.`;
  return {
    taskId,
    filesChanged: [...filesChanged],
    testsPassed,
    selfAssessment: sa,
    notes: note,
    iterations,
    terminationReason: 'max_iterations',
    tokenUsage: tokenUsage(),
  };
}

// ─── Subprocess entry shim (mirrors agentic-worker-entry.ts) ───────────────────

const TASKS_DIR_NAME = '.tasks';

interface TaskJson {
  id?: string;
  description?: string;
  scope?: { directories?: string[]; filesRead?: string[]; filesWrite?: string[] };
  goNogo?: { goCriteria?: string; noGoCriteria?: string; techDebtAcceptable?: string };
}

export interface RunHttpWorkerEntryDeps {
  /** Override the loop — tests inject a scripted result; prod uses runHttpAgenticWorker. */
  runner?: (opts: HttpAgenticRunnerOptions) => Promise<HttpAgenticResult>;
  /**
   * Override the provider turn fn — tests inject a scripted `send` (no network).
   * When omitted, the entry binds a REAL `OpenAICompatibleAdapter.send` (built by
   * a runtime dynamic import — no static providers/ cycle).
   */
  send?: HttpAgenticSend;
  /** Hermetic seam for asserting the config-resolved host endpoint contract. */
  sendFactory?: (connection: {
    model: string;
    baseURL: string;
    apiKeyEnv?: string;
    provider: string;
  }) => Promise<HttpAgenticSend>;
}

export interface RunHttpWorkerEntryReturn {
  exitCode: number;
  resultPath: string;
  result: EntryResultFile;
}

function ensureTasksDir(projectDir: string): string {
  const dir = join(projectDir, TASKS_DIR_NAME);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

function writeResultFile(taskId: string, projectDir: string, result: EntryResultFile): string {
  const tasksDir = ensureTasksDir(projectDir);
  const resultPath = join(tasksDir, `task-${taskId}.result`);
  writeFileSync(resultPath, JSON.stringify(result, null, 2), 'utf-8');
  return resultPath;
}

function writeHeartbeat(
  taskId: string,
  projectDir: string,
  status: string,
  sequence: number,
  filesChangedCount: number,
  provider: string,
): void {
  const tasksDir = ensureTasksDir(projectDir);
  const hb = {
    workerId: `${provider}-${taskId}`,
    taskId,
    status,
    currentAction: 'http-agentic-worker-entry',
    timestamp: new Date().toISOString(),
    filesChangedCount,
    sequence,
  };
  try {
    writeTaskHeartbeatFile(join(tasksDir, `task-${taskId}.hb`), hb);
  } catch {
    // Non-fatal: a heartbeat write failure must not stop the worker.
  }
}

function zeroTokenUsage(provider: string, model: string): EntryTokenUsage {
  return { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, provider, model };
}

function buildNoGoResult(
  taskId: string,
  reason: string,
  provider: string,
  model: string,
): EntryResultFile {
  return {
    taskId,
    filesChanged: [],
    linesAdded: 0,
    linesRemoved: 0,
    testsPassed: false,
    coverage: 0,
    selfAssessment: 'NO_GO',
    notes: reason,
    tokenUsage: zeroTokenUsage(provider, model),
    evaluationDecision: 'NO_GO',
  };
}

async function buildResultFromLoop(
  runResult: HttpAgenticResult,
  projectDir: string,
  provider: string,
  model: string,
): Promise<EntryResultFile> {
  const { linesAdded, linesRemoved, diffNote } = await computeNumstat(
    projectDir,
    runResult.filesChanged,
  );
  const notes = diffNote ? `${runResult.notes}\n[diff] ${diffNote}` : runResult.notes;
  // Funnel the accumulated provider usage through the canonical normalizer so a
  // malformed/negative count is clamped before it reaches `.result`. cacheRead
  // stays 0 (openai-compat usage carries no cache-read in this loop's capture).
  const normalized = normalizeUsage({
    inputTokens: runResult.tokenUsage?.inputTokens,
    outputTokens: runResult.tokenUsage?.outputTokens,
    source: 'provider-adapter',
  });
  return {
    taskId: runResult.taskId,
    filesChanged: runResult.filesChanged,
    linesAdded,
    linesRemoved,
    // Honest "not measured" (null) rather than a fabricated measurement — Brain's
    // coverageOptional / isCoverageStructurallyAbsent consume null exactly as for
    // claude/codex workers (provider parity).
    testsPassed: runResult.testsPassed ?? null,
    coverage: null,
    selfAssessment: runResult.selfAssessment,
    notes,
    tokenUsage: {
      inputTokens: normalized.inputTokens,
      outputTokens: normalized.outputTokens,
      cacheReadTokens: normalized.cacheReadTokens,
      provider: runResult.tokenUsage?.provider ?? provider,
      model,
    },
    evaluationDecision: runResult.selfAssessment,
  };
}

/**
 * Build the real (network) provider turn fn from argv via a RUNTIME dynamic
 * import of the adapter — only fires inside the spawned subprocess, never in
 * tests (which inject `deps.send`), so agents/ keeps no static providers/ import.
 */
async function buildRealSend(
  model: string,
  baseURL: string,
  apiKeyEnv: string | undefined,
  provider: string,
): Promise<HttpAgenticSend> {
  const { OpenAICompatibleAdapter } = await import('../providers/openai-compatible.js');
  // Row 477: vendor extensions (e.g. OpenRouter's `reasoning`) arrive as JSON in
  // an env var rather than argv — the spawn path shells out through a cmd.exe
  // wrapper on win32, and quoting JSON through a shell is not portable. Malformed
  // JSON is IGNORED rather than fatal: a bad extension knob must never take down a
  // worker that would otherwise run correctly (it degrades to the provider default).
  let extraBody: Record<string, unknown> | undefined;
  const rawExtraBody = process.env['DECKENT_HTTP_EXTRA_BODY'];
  if (rawExtraBody) {
    try {
      const parsed: unknown = JSON.parse(rawExtraBody);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        extraBody = parsed as Record<string, unknown>;
      }
    } catch {
      // ignored — fall through to provider defaults
    }
  }
  const adapter = new OpenAICompatibleAdapter({
    name: provider,
    baseURL,
    apiKeyEnv,
    ...(apiKeyEnv ? {} : { authMode: 'none' as const }),
    models: [model],
    ...(extraBody ? { extraBody } : {}),
  });
  return async (messages, m, o) => {
    const res = await adapter.send(
      messages as unknown as import('../providers/openai-compatible.js').ChatMessage[],
      m,
      { tools: o.tools },
    );
    return {
      content: res.content,
      toolCalls: (res.toolCalls ?? []) as HttpAgenticToolCall[],
      ...(res.usage ? { usage: res.usage } : {}),
    };
  };
}

/**
 * Drive a single task end-to-end. Invocation:
 *   `node dist/agents/http-agentic-worker.js <taskId> <model> <baseURL> [apiKeyEnv] [provider]`
 * Returns `{ exitCode, resultPath, result }` so tests assert without `process.exit`.
 */
export async function runHttpWorkerEntry(
  argv: string[],
  projectDir: string,
  deps: RunHttpWorkerEntryDeps = {},
): Promise<RunHttpWorkerEntryReturn> {
  const runner = deps.runner ?? runHttpAgenticWorker;

  const taskId = argv[0];
  const model = argv[1];
  const baseURL = argv[2];
  const apiKeyEnv = argv[3] || undefined;
  const provider = argv[4] && argv[4].length > 0 ? argv[4] : DEFAULT_HTTP_PROVIDER;

  if (!taskId || !model || !baseURL) {
    const reason = `http-agentic-worker-entry: missing argv (got [${argv.join(', ')}]; expected <taskId> <model> <baseURL> [apiKeyEnv] [provider])`;
    const fallbackId = taskId && taskId.length > 0 ? taskId : 'unknown';
    const r = buildNoGoResult(fallbackId, reason, provider, model ?? 'unknown');
    const p = writeResultFile(fallbackId, projectDir, r);
    return { exitCode: 1, resultPath: p, result: r };
  }

  writeHeartbeat(taskId, projectDir, 'EXECUTING', 1, 0, provider);

  let taskJson: TaskJson;
  try {
    const taskPath = join(projectDir, TASKS_DIR_NAME, `task-${taskId}.json`);
    taskJson = JSON.parse(readFileSync(taskPath, 'utf-8')) as TaskJson;
  } catch (err) {
    const reason = `http-agentic-worker-entry: failed to read task json: ${err instanceof Error ? err.message : String(err)}`;
    const r = buildNoGoResult(taskId, reason, provider, model);
    const p = writeResultFile(taskId, projectDir, r);
    writeHeartbeat(taskId, projectDir, 'NO_GO', 2, 0, provider);
    return { exitCode: 1, resultPath: p, result: r };
  }

  let compiledPrompt: string;
  try {
    compiledPrompt = readHostCompiledWorkerPrompt(projectDir, taskId);
  } catch (err) {
    const reason = `http-agentic-worker-entry: compiled prompt unavailable: ${err instanceof Error ? err.message : String(err)}`;
    const r = buildNoGoResult(taskId, reason, provider, model);
    const p = writeResultFile(taskId, projectDir, r);
    writeHeartbeat(taskId, projectDir, 'NO_GO', 2, 0, provider);
    return { exitCode: 1, resultPath: p, result: r };
  }

  let send: HttpAgenticSend;
  try {
    send =
      deps.send ??
      (await (deps.sendFactory ?? (connection => buildRealSend(
        connection.model,
        connection.baseURL,
        connection.apiKeyEnv,
        connection.provider,
      )))({ model, baseURL, apiKeyEnv, provider }));
  } catch (err) {
    const reason = `http-agentic-worker-entry: failed to build provider send: ${err instanceof Error ? err.message : String(err)}`;
    const r = buildNoGoResult(taskId, reason, provider, model);
    const p = writeResultFile(taskId, projectDir, r);
    writeHeartbeat(taskId, projectDir, 'NO_GO', 2, 0, provider);
    return { exitCode: 1, resultPath: p, result: r };
  }

  const runnerOpts: HttpAgenticRunnerOptions = {
    taskId,
    model,
    prompt: compiledPrompt,
    scope: {
      directories: taskJson.scope?.directories ?? [],
      filesRead: taskJson.scope?.filesRead ?? [],
      filesWrite: taskJson.scope?.filesWrite ?? [],
    },
    goNogo: {
      goCriteria: taskJson.goNogo?.goCriteria ?? '',
      noGoCriteria: taskJson.goNogo?.noGoCriteria ?? '',
      techDebtAcceptable: taskJson.goNogo?.techDebtAcceptable,
    },
    projectRoot: projectDir,
    provider,
    send,
  };

  // born-611: approval-gate env-kontratı (orchestrator `approval.gate_enabled`
  // iken DECKENT_APPROVAL_GATE enjekte eder; yokken sıfır-ayakizi — gate kurulmaz).
  const approvalSetup = setupWorkerApprovalGateFromEnv(projectDir, taskId);
  if (approvalSetup.approvalGate) runnerOpts.approvalGate = approvalSetup.approvalGate;

  let runResult: HttpAgenticResult;
  try {
    runResult = await runner(runnerOpts);
  } catch (err) {
    const reason = `http-agentic-worker-entry: loop threw: ${err instanceof Error ? err.message : String(err)}`;
    const r = buildNoGoResult(taskId, reason, provider, model);
    const p = writeResultFile(taskId, projectDir, r);
    writeHeartbeat(taskId, projectDir, 'NO_GO', 2, 0, provider);
    return { exitCode: 1, resultPath: p, result: r };
  } finally {
    approvalSetup.dispose();
  }

  const result = await buildResultFromLoop(runResult, projectDir, provider, model);
  const resultPath = writeResultFile(taskId, projectDir, result);
  writeHeartbeat(
    taskId,
    projectDir,
    result.selfAssessment === 'NO_GO' ? 'NO_GO' : 'DONE',
    2,
    result.filesChanged.length,
    provider,
  );

  return {
    exitCode: result.selfAssessment === 'NO_GO' ? 1 : 0,
    resultPath,
    result,
  };
}

// ─── CLI shim (canonical ESM main-guard) ──────────────────────────────────────

function isInvokedAsMain(): boolean {
  try {
    if (!process.argv[1]) return false;
    return process.argv[1] === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

if (isInvokedAsMain()) {
  runHttpWorkerEntry(process.argv.slice(2), process.cwd())
    .then(({ exitCode }) => {
      process.exit(exitCode);
    })
    .catch((err: unknown) => {
      // Last-resort net — runHttpWorkerEntry already writes a NO_GO .result on
      // any caught error; this covers an unhandled rejection at the shim boundary.
      // eslint-disable-next-line no-console
      console.error('[http-agentic-worker-entry] fatal:', err);
      process.exit(1);
    });
}
