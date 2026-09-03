// src/cli/repl/native-tool-registry.ts
// ═══ Native tool registry (SP-1 M3) ═════════════════════════════════════════
// Wraps the REPL's existing tool dispatchers (chat-tool-exec: read/write/edit/
// bash; chat-tool-bridge: deckent_* CLI) as native ToolDefinitions for the
// AgentSession. The dispatchers run with NO internal confirm — the AgentSession
// permission engine + guards are the SINGLE gate (no double-prompt), including
// direct, nested deckent_call_tool, CLI-bridge, and MCP-backed dispatch. Legacy tier
// names ('read'|'confirm'|'always') map to the engine's ('silent'|'confirm'|
// 'always'); read→silent. MCP bridge confirms are deliberately pre-approved
// below only after AgentSession has made the live permission decision.

import { createHash } from 'node:crypto';
import { z, type ZodTypeAny } from 'zod';
import { ToolRegistry } from '../../agent/tools/registry.js';
import type { ContentWriter } from '../../agent/tool-result-broker.js';
import type { ToolDefinition, ToolPermissionTier, ToolResult } from '../../agent/tools/types.js';
import type { ToolExposure, ToolExposureKind } from '../../agent/tools/exposure.js';
import { createToolExecDispatcher } from '../commands/chat-tool-exec.js';
import { createCliToolDispatcher } from '../commands/chat-tool-bridge.js';
import { classifyTool } from './tool-permissions.js';
import {
  CLI_BRIDGE_TOOLS,
  WORST_CASE_CLASSIFY_ARGS,
  RUN_FLOW_PROPOSAL_TOOL_NAME,
  RUN_FLOW_PROPOSAL_TOOL_SPEC,
  RUN_FLOW_ESCAPE_HATCH_NOTE,
  RUN_FLOW_ESCAPE_HATCH_NAMES,
} from './cli-bridge-tool-specs.js';
import type { RunFlowController } from './run-flow-controller.js';
import { loadConfig } from '../../core/config.js';
import { ensureProvidersBootstrapped } from './provider-bootstrap.js';
import type { McpToolDispatcher } from '../commands/chat-native.js';
import { SkillPoolManager } from '../../core/skill-pool.js';
import { SkillLoadingCache } from '../../core/skill-cache.js';
import {
  ToolRegistry as CoreToolRegistry,
  type ToolCategory as CoreToolCategory,
  type ToolRiskLevel as CoreToolRiskLevel,
} from '../../core/tool-registry.js';
import { ToolSearchIndex } from '../../core/tool-search.js';
import { summarizeEagerSchema, deferredIndexLine } from '../../core/tool-core.js';
import {
  dispatchToolCall,
  DEFAULT_RISK_THRESHOLD,
  type ConfirmFn,
  type ExecImplFn,
  type ToolDispatchPlan,
  type DispatchResult,
  type DispatchError,
} from '../../core/tool-dispatch.js';

/** Minimal structural shape of the buildMcpBridge return (chat-mcp-bridge.ts). */
export interface NativeMcpBridge {
  listTools(): Array<{ namespacedName: string; descriptor: { description?: string; inputSchema?: Record<string, unknown> } }>;
  dispatch(namespacedName: string, args: Record<string, unknown>, confirmFn: (a: unknown) => Promise<boolean>): Promise<{ ok: boolean; output: string }>;
}

export interface NativeToolRegistryOptions {
  /** Resolved per-call so the REPL's /cd is followed live. */
  cwd: () => string;
  /** Optional connected MCP bridge — its tools register as confirm-tier defs. */
  mcpBridge?: NativeMcpBridge;
  /**
   * Optional skill-dispatch seam (F11). When omitted, the live skill-pool path
   * (`createDefaultSkillDispatcher`) is used. `dispatch(skillId, args)` reuses the
   * established `McpToolDispatcher` contract — tests inject a fake to stay hermetic.
   */
  skillDispatcher?: McpToolDispatcher;
  /**
   * TOOL-REPL-WIRE (354-002) progressive-disclosure bridge — `tool_surface.enabled`,
   * default OFF (undefined/`enabled:false` registers nothing; the rest of this
   * function's output stays byte-identical). When on, registers 3 native meta-tools
   * (`deckent_search_tools` / `deckent_describe_tool` / `deckent_call_tool`) over a
   * catalog bridged from every tool already registered above (core TOOL-1/TOOL-2/
   * TOOL-3 primitives — read-only, never modified here). See
   * `registerToolSurfaceTools` for the plan->risk-gate->confirm->execImpl chain.
   */
  toolSurface?: ToolSurfaceOptions;
  /**
   * TERM-FLOW-UNIFY Sprint-3 dilim (425-001), `terminal.run_flow_v2` — default
   * OFF (omitted, as every current call site does since run.tsx's config->
   * options wiring is a follow-up, keeps this function's output byte-identical
   * to pre-425-001). When enabled, registers `deckent_propose_run` and appends
   * an escape-hatch note to set/plan/start's descriptions — see
   * `registerRunFlowProposalTool`.
   */
  runFlow?: RunFlowRegistryOptions;
  /**
   * 7089 (564-002 hand-completion) — session-scoped tool-result overflow store
   * for the SHARED exec dispatcher. The caller (run.tsx) anchors it at the
   * session's scratch root (`resolveScratchRoot(...).root`), so overflow bytes
   * live in the SAME swept namespace as the scratch checkpoints instead of a
   * second orphan `mkdtemp` dir. Absent → the dispatcher's own legacy
   * per-process store (byte-identical pre-wire behavior).
   */
  contentStore?: ContentWriter;
}

export interface RunFlowRegistryOptions {
  enabled: boolean;
  /** Seam-injected — production callers pass a real RunFlowController
   *  (run-flow-controller.ts's createRunFlowController). */
  controller: RunFlowController;
}

/**
 * Pure resolver for `terminal.run_flow_v2` — mirrors `resolveToolSurfaceOptions`'s
 * fail-closed shape: only a literal `true` enables; anything else (undefined,
 * false, a load-failure `{}` fallback) stays OFF.
 */
export function resolveRunFlowEnabled(raw: { run_flow_v2?: boolean } | undefined): boolean {
  return raw?.run_flow_v2 === true;
}

/**
 * Injection seams for `deckent_call_tool`'s dispatch chain (tool-dispatch.ts).
 * `execImpl` intentionally has NO live-exec default: TOOL-REPL-WIRE's nogo bars
 * real execution (no `handlerRef` resolver exists yet — future cutover work).
 * Omitting it falls back to `NOT_WIRED_EXEC`, which fails closed with a
 * descriptive error rather than silently no-op-succeeding. `confirm` is likewise
 * optional — tool-dispatch.ts already fail-closed-denies a risk-gated call when
 * no confirm fn is supplied, so this seam only needs a real implementation once
 * the approval-card UI (follow-up work) exists.
 */
export interface ToolSurfaceOptions {
  enabled: boolean;
  /** NT-06 progressive disclosure. OPTIONAL and fail-closed: every consumer
   *  gates on `=== true`, so absent ≡ false — direct constructions (tests,
   *  embedders) need not churn; resolveToolSurfaceOptions always emits it
   *  explicitly. */
  progressive?: boolean;
  exposure?: ToolExposure;
  confirm?: ConfirmFn;
  execImpl?: ExecImplFn;
  riskThreshold?: CoreToolRiskLevel;
}

/** Whitelist for {@link resolveToolSurfaceOptions} — mirrors RISK_ORDER's keys.
 *  An invalid config string previously fell through as-is; `RISK_ORDER[bad]` is
 *  undefined so `meetsRiskThreshold` returned false for EVERY risk → the confirm
 *  gate never fired (fail-OPEN, advisor born-607 P0). */
const VALID_RISK_THRESHOLDS: ReadonlySet<string> = new Set(['safe', 'moderate', 'destructive']);

/**
 * born-607 Gap-A: resolve the raw `tool_surface` config block into registry
 * options. Pure + validating: `enabled` must be literally `true` (config default
 * resolves it true; a load-failure `{}` fallback stays OFF — fail-closed), and an
 * invalid `riskThreshold` string is DROPPED (dispatch falls back to its own
 * 'moderate' default) instead of silently disabling the confirm gate.
 * The returned object is intentionally the SAME mutable reference callers pass to
 * both `buildNativeToolRegistry` and `createNativeEngine` — the bridge later fills
 * `execImpl`/`confirm` in place (dispatch reads them per-call), which is what
 * finally arms `deckent_call_tool` with the engine-parity resolver.
 */
export function resolveToolSurfaceOptions(
  raw: { enabled?: boolean; progressive?: boolean; riskThreshold?: string } | undefined,
): ToolSurfaceOptions | undefined {
  if (!raw || raw.enabled !== true) return undefined;
  const opts: ToolSurfaceOptions = { enabled: true, progressive: raw.progressive === true };
  if (typeof raw.riskThreshold === 'string' && VALID_RISK_THRESHOLDS.has(raw.riskThreshold)) {
    opts.riskThreshold = raw.riskThreshold as CoreToolRiskLevel;
  }
  return opts;
}

const LEGACY_TIER: Record<'read' | 'confirm' | 'always', ToolPermissionTier> = {
  read: 'silent',
  confirm: 'confirm',
  always: 'always',
};

// Exec tools that have side-effects — classified as 'confirm' regardless of
// classifyTool result (which doesn't know about these tool names and returns 'read').
// 583/N4: git_add/git_commit join the confirm tier (KARAR-2 — the human seal);
// git_status/log/diff stay silent (read-only).
const EXEC_SIDE_EFFECTING: ReadonlySet<string> = new Set([
  'deckent_write_file',
  'deckent_edit_file',
  'deckent_bash',
  'deckent_git_add',
  'deckent_git_commit',
]);

/** A minimal JSON-schema for each tool's args (provider tool_use input_schema). */
const SCHEMAS: Record<string, Record<string, unknown>> = {
  // 562-002 ranged read: `offset`/`limit` are OPTIONAL — omitting both keeps the
  // pre-562 single-shot full read. Declared as `integer` (the JSON-schema type the
  // catalog bridge maps to z.number()) with `minimum: 1` so a provider that
  // validates the schema never sends the 0/negative values resolveReadFileRange
  // would have to discard anyway.
  deckent_read_file: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Project-relative file path.' },
      offset: { type: 'integer', minimum: 1, description: '1-based first line to return. Omit to start at line 1.' },
      limit: { type: 'integer', minimum: 1, description: 'How many lines to return from offset. Omit to read to the end of the file.' },
    },
    required: ['path'],
  },
  // 583/N2 — silent READ surface (list/grep/glob): pure-Node, capped, scope-guarded.
  deckent_list_dir: { type: 'object', properties: { path: { type: 'string' } } },
  deckent_grep: { type: 'object', properties: { pattern: { type: 'string' }, path: { type: 'string' } }, required: ['pattern'] },
  deckent_glob: { type: 'object', properties: { pattern: { type: 'string' }, path: { type: 'string' } }, required: ['pattern'] },
  deckent_write_file: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] },
  deckent_edit_file: { type: 'object', properties: { path: { type: 'string' }, old: { type: 'string' }, new: { type: 'string' } }, required: ['path', 'old', 'new'] },
  deckent_bash: { type: 'object', properties: { cmd: { type: 'string' } }, required: ['cmd'] },
  // 583/N4 — git surface (status/log/diff silent, add/commit confirm).
  deckent_git_status: { type: 'object', properties: {} },
  deckent_git_log: { type: 'object', properties: { limit: { type: 'number' } } },
  deckent_git_diff: { type: 'object', properties: { staged: { type: 'boolean' } } },
  deckent_git_add: { type: 'object', properties: { paths: { type: 'array', items: { type: 'string' } } } },
  deckent_git_commit: { type: 'object', properties: { message: { type: 'string' } }, required: ['message'] },
};

const DESCRIPTIONS: Record<string, string> = {
  deckent_read_file: 'Read a file within the project. With no offset/limit it returns the whole content, as before. Pass offset (1-based first line) and/or limit (line count) to get a line-numbered slice preceded by a "[deckent] read_file: totalLines=… range=… hasMore=… nextOffset=…" meta line, so a large file can be read in bounded pieces.',
  deckent_list_dir: 'List a directory within the project (dirs suffixed with /).',
  deckent_grep: 'Search project files with a JS regex; returns path:line:text hits (capped).',
  deckent_glob: 'Find project files matching a glob pattern (** / * / ?), capped.',
  deckent_write_file: 'Write content to a file within the project.',
  deckent_edit_file: 'Replace a substring in a file within the project.',
  deckent_bash: 'Run a shell command in the project directory.',
  deckent_git_status: 'Git working-tree status (branch, ahead/behind, changed files).',
  deckent_git_log: 'Recent git commits (sha, subject, author, date; capped).',
  deckent_git_diff: 'Working-tree diff for review (pass staged:true for the staged set; capped).',
  deckent_git_add: 'Stage changes for commit (all changes, or explicit paths).',
  deckent_git_commit: 'Create a git commit from the staged changes with the given message.',
};

function toolResultFrom(output: string): ToolResult {
  const ok = !(output.startsWith('[mcp-error]') || output.startsWith('[deckent-denied]'));
  return { ok, output };
}

function execToolTier(name: string): ToolPermissionTier {
  return EXEC_SIDE_EFFECTING.has(name) ? 'confirm' : 'silent';
}

// ─── 562-002 — deckent_read_file ranged read {path, offset?, limit?} ─────────
// The exec dispatcher (chat-tool-exec.ts) already owns path containment and an
// NT-01 server-side line slice, but its result is post-processed by
// `brokerToolResult` (agent/tool-result-broker.ts): anything over the preview cap
// reaches this file as a PREFIX plus a truncation tail. Slicing that string here
// would slice a truncated preview, so a ranged read instead recovers the full
// bytes through the broker's own `contentStore` seam (see readFullFileText) and
// does the numbering + meta locally. No fs access, no second containment
// implementation, and the read tier stays 'silent'.

/** Resolved line window: 1-based `offset`, `limit === null` ⇒ read to EOF. */
export interface ReadFileRange {
  offset: number;
  limit: number | null;
}

/**
 * Parses deckent_read_file's optional `offset`/`limit`. Deliberately identical in
 * contract to the dispatcher's own `resolveLineRange`: 1-based offset, limit ≥ 1,
 * and a malformed/out-of-contract value is IGNORED rather than guessed at — with
 * neither field usable the call degrades to the pre-562 full read (`null`) instead
 * of a silently wrong slice.
 */
export function resolveReadFileRange(args: Record<string, unknown>): ReadFileRange | null {
  const usable = (raw: unknown): number | null => {
    if (raw === undefined || raw === null) return null;
    const n = Number(raw);
    return Number.isFinite(n) && n >= 1 ? Math.floor(n) : null;
  };
  const offset = usable(args['offset']);
  const limit = usable(args['limit']);
  if (offset === null && limit === null) return null;
  return { offset: offset ?? 1, limit };
}

/**
 * Splits file text into real lines. A trailing newline terminates the last line
 * rather than starting an empty one, so `totalLines` matches what `cat -n` (and a
 * human) counts; an empty file honestly has zero lines.
 */
export function splitFileLines(text: string): string[] {
  if (text.length === 0) return [];
  const lines = text.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/** cat -n gutter width — number right-aligned in 6 columns, then a TAB. */
const READ_LINE_NUMBER_WIDTH = 6;

/** Marker emitted by `renderToolResultEnvelope` (agent/tool-result-broker.ts) when
 *  the rendered string is only a prefix of the real output. Matched here, never
 *  produced: an oversized default read is already honest that it was cut, it just
 *  never said how many lines the file actually has. */
const BROKER_TRUNCATION_MARKER = '[deckent] tool-result truncated:';

export interface RangedReadView {
  output: string;
  totalLines: number;
  returned: number;
  hasMore: boolean;
}

/**
 * Pure renderer for a ranged read: a leading meta line (so the model knows how
 * much of the file it is holding and where the next slice starts) followed by the
 * cat -n numbered slice. An offset past EOF returns meta ONLY — an honest empty
 * answer, never a silently clamped one.
 */
export function renderRangedRead(text: string, range: ReadFileRange): RangedReadView {
  const lines = splitFileLines(text);
  const totalLines = lines.length;
  const start = Math.min(range.offset - 1, totalLines);
  const end = range.limit === null ? totalLines : Math.min(start + range.limit, totalLines);
  const slice = lines.slice(start, end);
  const hasMore = end < totalLines;
  const meta = slice.length === 0
    ? `[deckent] read_file: totalLines=${totalLines} range=empty returned=0 hasMore=false requestedOffset=${range.offset}`
    : `[deckent] read_file: totalLines=${totalLines} range=${start + 1}-${end} returned=${slice.length} hasMore=${hasMore}${hasMore ? ` nextOffset=${end + 1}` : ''}`;
  const numbered = slice.map((line, i) => `${String(start + 1 + i).padStart(READ_LINE_NUMBER_WIDTH, ' ')}\t${line}`);
  return { output: [meta, ...numbered].join('\n'), totalLines, returned: slice.length, hasMore };
}

/**
 * Recovers the COMPLETE text of one file through the exec dispatcher.
 *
 * A dedicated per-call dispatcher is built with an in-memory `contentStore`: when
 * the file exceeds the broker's preview cap the broker hands those full bytes to
 * the store on its way to producing the (discarded) bounded preview, so the exact
 * content is available here without a second containment implementation and
 * without touching the shared dispatcher's real on-disk spill store. Per-call by
 * construction — two concurrent read_file calls cannot capture each other's bytes.
 * Under the cap nothing spills, and `renderToolResultEnvelope` guarantees the
 * returned string is byte-identical to the raw content.
 */
async function readFullFileText(
  cwd: NativeToolRegistryOptions['cwd'],
  path: string,
): Promise<{ ok: true; text: string } | { ok: false; output: string }> {
  const spilled: Buffer[] = [];
  const contentStore: ContentWriter = {
    write(bytes) {
      spilled.push(bytes);
      return { path: '(in-memory ranged-read buffer)', sha256: createHash('sha256').update(bytes).digest('hex') };
    },
  };
  const rendered = await createToolExecDispatcher({ cwd, contentStore }).dispatch('deckent_read_file', { path });
  const captured = spilled[spilled.length - 1];
  if (captured !== undefined) return { ok: true, text: captured.toString('utf8') };
  if (!toolResultFrom(rendered).ok) return { ok: false, output: rendered };
  return { ok: true, text: rendered };
}

/**
 * `deckent_read_file`'s handler. Two paths, and only the second one is new:
 *   • no usable offset/limit → the ORIGINAL shared dispatcher with the ORIGINAL
 *     args, so an untruncated read stays byte-identical to pre-562. The single
 *     addition is honesty on an already-truncated result: one extra full read
 *     appends the real `totalLines` and points at the ranged form.
 *   • offset and/or limit → exact slice + cat -n numbering + totalLines/range meta.
 */
async function dispatchReadFile(
  cwd: NativeToolRegistryOptions['cwd'],
  exec: McpToolDispatcher,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const path = typeof args['path'] === 'string' ? args['path'] : String(args['path'] ?? '');
  const range = resolveReadFileRange(args);
  if (range === null) {
    const rendered = await exec.dispatch('deckent_read_file', args);
    const result = toolResultFrom(rendered);
    if (!rendered.includes(BROKER_TRUNCATION_MARKER)) return result;
    const full = await readFullFileText(cwd, path);
    if (!full.ok) return result;
    return {
      ok: result.ok,
      output: `${rendered}\n[deckent] read_file: totalLines=${splitFileLines(full.text).length}; the content above is a prefix, re-read with {offset, limit} for complete numbered slices.`,
    };
  }
  const full = await readFullFileText(cwd, path);
  if (!full.ok) return toolResultFrom(full.output);
  return { ok: true, output: renderRangedRead(full.text, range).output };
}

/** An MCP server may report `description: ''` (empty string, not undefined) — `??`
 * only substitutes on null/undefined, so a blank string would flow straight into
 * `registry.register()`, which requires a non-empty (post-trim) description and
 * throws, crashing REPL launch (born-552). Treat blank/whitespace-only the same
 * as missing, mirroring validateToolDefinition's own `trim().length === 0` check. */
function mcpToolDescription(description: string | undefined, namespacedName: string): string {
  const trimmed = (description ?? '').trim();
  return trimmed.length > 0 ? trimmed : `MCP tool ${namespacedName}`;
}

function defineFromDispatcher(
  name: string,
  description: string,
  inputSchema: Record<string, unknown>,
  tier: ToolPermissionTier,
  dispatcher: McpToolDispatcher,
  exposure?: ToolExposureKind,
): ToolDefinition {
  return {
    name,
    description,
    inputSchema,
    category: 'coding',
    tier,
    source: 'builtin',
    ...(exposure ? { exposure } : {}),
    handler: async (args) => toolResultFrom(await dispatcher.dispatch(name, args)),
  };
}

/**
 * Default skill-dispatch path (F11) — the same loader a worker's skill-injection
 * uses, so the native REPL agent reaches a deckent skill with worker parity. NO
 * re-implementation of skill execution: existence is resolved through the live
 * `SkillPoolManager` (skill-pool) and the guidance body through `SkillLoadingCache`
 * (the SKILL.md content loader). Project root is resolved per-call via `cwd()` so
 * the REPL's /cd is followed live (mirrors the exec dispatcher) — no wiring change
 * is required at the caller. Returns the resolved skill guidance, or a tagged
 * `[mcp-error]` string (→ ok:false via toolResultFrom) for an unknown/empty skill.
 */
function createDefaultSkillDispatcher(cwd: () => string): McpToolDispatcher {
  return {
    async dispatch(skillId, _args) {
      const root = cwd();
      const skill = new SkillPoolManager(root).getSkill(skillId);
      if (!skill) return `[mcp-error] deckent_skill_dispatch: unknown skill: ${skillId}`;
      const cached = new SkillLoadingCache(root).loadAndCache(skillId);
      const guidance = (cached?.content ?? '').trim() || (skill.description ?? '').trim();
      return guidance.length > 0
        ? guidance
        : `[mcp-error] deckent_skill_dispatch: skill has no guidance content: ${skillId}`;
    },
  };
}

// ─── TOOL-REPL-WIRE (354-002) — progressive-disclosure bridge ══════════════
// Bridges the already-registered native tool surface (exec/CLI-bridge/skill/
// MCP — built above) into the 353 core primitives: tool-registry.ts (TOOL-1,
// catalog), tool-search.ts (TOOL-2, search/describe/planCall), tool-core.ts
// (TOOL-CORE, deferred-index), tool-dispatch.ts (TOOL-3, risk-gated dispatch).
// All four are core/, read-only here — this file only *consumes* them to
// register 3 new native meta-tools. No production `handlerRef` resolver
// exists yet, so `deckent_call_tool` never performs real execution unless a
// caller injects `toolSurface.execImpl` (tests do; production wiring of the
// real dispatch + approval-card UI is explicit follow-up work).

/** Best-effort category bridge: agent tools carry an open, free-form category
 * string; TOOL-1's `ToolCategory` is the fixed set tool-search.ts/tool-core.ts
 * were designed around (deckent_* CLI-bridge command groups). Known CLI-bridge
 * names map to their documented group; anything else (exec/skill/mcp tools)
 * falls into the generic 'catalog' bucket rather than fabricating a group. */
const CORE_CATEGORY_BY_NAME: Readonly<Record<string, CoreToolCategory>> = {
  deckent_status: 'monitoring',
  deckent_doctor: 'monitoring',
  deckent_review: 'monitoring',
  deckent_history: 'knowledge',
  deckent_retro: 'knowledge',
  deckent_models: 'catalog',
};

function bridgeCategory(name: string): CoreToolCategory {
  return CORE_CATEGORY_BY_NAME[name] ?? 'catalog';
}

/** Tier -> risk: lines up with tool-dispatch.ts's DEFAULT_RISK_THRESHOLD
 * ('moderate'), so the existing confirm/always-tier tools require a confirm
 * decision through `deckent_call_tool` too, exactly like they already do
 * through the AgentSession's own permission engine for a direct call. */
// Exported (born-607 P1): the parity resolver honors an EXPLICIT `riskThreshold`
// as an additional ask-floor and needs the same tier→risk bridge this catalog uses.
export const BRIDGE_RISK_BY_TIER: Record<ToolPermissionTier, CoreToolRiskLevel> = {
  silent: 'safe',
  confirm: 'moderate',
  always: 'destructive',
};

/** Generic passthrough — the catalog fallback for a bridged tool whose
 * `inputSchema` declares no enumerable top-level fields (e.g. the CLI-bridge
 * tools' intentionally-open `genericSchema`, `{ properties: {} }`). TOOL-1's
 * `paramsSchema` needs *a* ZodTypeAny even when there is nothing to derive. */
const BRIDGE_PARAMS_SCHEMA = z.record(z.string(), z.unknown());

/** Maps one JSON-schema property node (agent ToolDefinition.inputSchema's
 * `properties[name]`) to its zod primitive. Scoped to exactly what
 * `summarizeEagerSchema` (core/tool-core.ts) reads off a field — base type +
 * optionality — never a general-purpose JSON-schema validator. */
function jsonSchemaPropertyToZod(node: unknown): ZodTypeAny {
  if (!node || typeof node !== 'object' || Array.isArray(node)) return z.unknown();
  const prop = node as { type?: unknown; items?: unknown };
  switch (prop.type) {
    case 'string': return z.string();
    case 'number':
    case 'integer': return z.number();
    case 'boolean': return z.boolean();
    case 'array': return z.array(jsonSchemaPropertyToZod(prop.items));
    case 'object': return jsonSchemaObjectToZod(node as Record<string, unknown>);
    default: return z.unknown();
  }
}

/** Best-effort JSON-schema object -> zod object converter (born-521). Every
 * bridged tool already carries a real `inputSchema` (the `SCHEMAS` map above,
 * or a caller-supplied JSON schema for CLI-bridge/skill/MCP tools) — this only
 * translates that EXISTING declaration into a `ZodTypeAny` so `describe_tool`
 * can report real params; it never re-derives or edits a tool's own schema. */
function jsonSchemaObjectToZod(schema: Record<string, unknown>): ZodTypeAny {
  const properties = schema['properties'];
  if (!properties || typeof properties !== 'object' || Array.isArray(properties)) {
    return BRIDGE_PARAMS_SCHEMA;
  }
  const requiredList = schema['required'];
  const required = new Set(
    Array.isArray(requiredList) ? requiredList.filter((r): r is string => typeof r === 'string') : [],
  );
  const shape: Record<string, ZodTypeAny> = {};
  for (const [key, propSchema] of Object.entries(properties as Record<string, unknown>)) {
    const zodType = jsonSchemaPropertyToZod(propSchema);
    shape[key] = required.has(key) ? zodType : zodType.optional();
  }
  if (Object.keys(shape).length === 0) return BRIDGE_PARAMS_SCHEMA;
  return z.object(shape).catchall(z.unknown());
}

/** Top-level entry: a bridged tool's `inputSchema` (JSON schema) -> the
 * catalog's per-tool `paramsSchema`. Only object-typed schemas route through
 * the field-by-field converter; anything else keeps the generic passthrough. */
function bridgeParamsSchema(inputSchema: Record<string, unknown>): ZodTypeAny {
  return inputSchema['type'] === 'object' ? jsonSchemaObjectToZod(inputSchema) : BRIDGE_PARAMS_SCHEMA;
}

/** Adapts every already-registered native ToolDefinition into a fresh TOOL-1
 * catalog. Self-referential by construction (called with a snapshot of
 * `registry.list()` taken BEFORE the 3 meta-tools below are registered), so
 * `deckent_search_tools`/`describe_tool`/`call_tool` never see themselves. */
function buildToolSurfaceCatalog(defs: readonly ToolDefinition[]): CoreToolRegistry {
  const catalog = new CoreToolRegistry();
  for (const def of defs) {
    catalog.register({
      name: def.name,
      description: def.description,
      paramsSchema: bridgeParamsSchema(def.inputSchema),
      risk: BRIDGE_RISK_BY_TIER[def.tier],
      category: bridgeCategory(def.name),
      handlerRef: `native:${def.name}`,
    });
  }
  return catalog;
}

/** Fails closed with a descriptive error — the task's nogo bars real exec
 * here (no `handlerRef` resolver exists yet); this is the default `execImpl`
 * whenever a caller does not inject one via `toolSurface.execImpl`. */
const NOT_WIRED_EXEC: ExecImplFn = ({ name }) => {
  throw new Error(
    `deckent_call_tool: execution seam not wired for "${name}" — inject toolSurface.execImpl ` +
    '(TOOL-REPL-WIRE 354-002 exposes plan/risk-gate/confirm only; real dispatch is follow-up work).',
  );
};

/**
 * born-633 NESTED-HONESTY item(2) — thrown by `createParityExecImpl`
 * (native-agent-bridge.ts) for a policy-deny / user-reject. Both currently
 * surface as `DispatchResult.status:'error'` (an execImpl throw —
 * tool-dispatch.ts/core has no separate status for this), so these markers are
 * the ONLY signal `toCallToolResult` below has to tell a policy denial apart
 * from a genuine internal error. Exported so native-agent-bridge.ts's throw
 * sites and this file's classifier share the SAME literal strings.
 */
export const PARITY_POLICY_DENIAL_PREFIX = '[denied by policy]';
export const PARITY_USER_REJECTION_PREFIX = '[rejected by user]';

function isApprovalDenialError(error: DispatchError | undefined): boolean {
  if (!error) return false;
  return error.message.startsWith(PARITY_POLICY_DENIAL_PREFIX) || error.message.startsWith(PARITY_USER_REJECTION_PREFIX);
}

/**
 * Duck-types a `ToolResult` (agent/tools/types.ts) out of an execImpl return
 * value. Every REAL nested target's handler always resolves one
 * (`ToolDefinition.handler`'s return type) — this stays defensive only for a
 * test-injected fake execImpl that returns something else (a bare string,
 * e.g. tests/cli/tool-repl-wire.test.ts's `'fake-result'` fixtures). Exported
 * for reuse by native-agent-bridge.ts's toolSink wiring (born-633 item 4) —
 * ONE duck-type check, not two divergent ones.
 */
export function asToolResult(value: unknown): ToolResult | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const v = value as Partial<ToolResult>;
  return typeof v.ok === 'boolean' && typeof v.output === 'string' ? (v as ToolResult) : undefined;
}

/**
 * born-633 NESTED-HONESTY item(1)+(2) — `deckent_call_tool`'s own result must
 * be honest about a NESTED failure, not just its own dispatch mechanics.
 *
 * (1) `dispatchToolCall` reports `status:'executed'` whenever `execImpl` did
 * NOT throw — a target handler that returns a HANDLED `{ok:false, output}`
 * (no throw) still counts as 'executed'. Before this fix the wrapper blindly
 * mapped `status==='executed'` to the outer `ok:true`, masking every nested
 * handled-failure as a success. The inner `ok` is unwrapped here and WINS over
 * the dispatch-level status; the inner `output` (error text) needs no separate
 * handling — it is already nested inside `JSON.stringify(result)` at
 * `result.result.output`.
 *
 * (2) A parity policy-deny/user-reject (`createParityExecImpl`'s thrown
 * `[denied by policy]`/`[rejected by user]`) is indistinguishable at the
 * `DispatchResult.status` level from a genuine internal error — both surface
 * as `status:'error'`. Detected via `isApprovalDenialError` and reclassified
 * with an honest `[approval-denied]` tag — a class DISTINCT from the
 * pre-existing `[deckent-denied]`, which stays reserved for a REAL
 * dispatch-level 'denied' (e.g. the risk-threshold gate with no confirm seam,
 * tests/cli/tool-repl-wire.test.ts:141-149 — unchanged, must not regress) —
 * plus a `status:'denied'` override in the returned JSON envelope (the nested
 * `telemetry.status` is left untouched: it is core/tool-dispatch.ts's own
 * truthful record of the execImpl-throw code path).
 */
function toCallToolResult(result: DispatchResult): ToolResult {
  if (result.status === 'executed') {
    const inner = asToolResult(result.result);
    const ok = inner ? inner.ok : true;
    return { ok, output: `${ok ? '' : '[mcp-error] '}${JSON.stringify(result)}` };
  }
  if (result.status === 'denied') {
    return { ok: false, output: `[deckent-denied] ${JSON.stringify(result)}` };
  }
  if (result.status === 'error' && isApprovalDenialError(result.error)) {
    return { ok: false, output: `[approval-denied] ${JSON.stringify({ ...result, status: 'denied' })}` };
  }
  return { ok: false, output: `[mcp-error] ${JSON.stringify(result)}` };
}

function registerToolSurfaceTools(registry: ToolRegistry, opts: ToolSurfaceOptions): void {
  const catalog = buildToolSurfaceCatalog(registry.list());
  const searchIndex = new ToolSearchIndex(catalog);
  const deferred = deferredIndexLine(catalog.list());

  registry.register({
    name: 'deckent_search_tools',
    description: [
      'Search the deckent tool catalog by keyword (matches tool name/description); returns name, category, risk, and relevance score for each hit. Use this instead of scanning the full tool list.',
      deferred,
    ].filter((s) => s.length > 0).join(' '),
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Keyword(s) to search for.' },
        limit: { type: 'number', description: 'Max results (default 10).' },
        cursor: { type: 'string', description: 'Continuation cursor returned by a previous search.' },
      },
      required: ['query'],
    },
    category: 'catalog',
    tier: 'silent',
    source: 'builtin',
    exposure: 'core',
    handler: async (args) => {
      const query = typeof args['query'] === 'string' ? args['query'] : '';
      const requestedLimit = typeof args['limit'] === 'number' && Number.isFinite(args['limit'])
        ? Math.trunc(args['limit'])
        : 10;
      const limit = Math.max(1, Math.min(50, requestedLimit));
      const rawCursor = typeof args['cursor'] === 'string' ? args['cursor'] : '';
      const offset = /^\d+$/.test(rawCursor) ? Number(rawCursor) : 0;
      const ranked = searchIndex.searchTools(query, { limit: offset + limit + 1 });
      const results = ranked.slice(offset, offset + limit);
      const cursor = ranked.length > offset + limit ? String(offset + limit) : null;
      return { ok: true, output: JSON.stringify({ results, cursor }) };
    },
  });

  registry.register({
    name: 'deckent_describe_tool',
    description: 'Return the full description, category, risk, and parameter summary for one tool by exact name (see deckent_search_tools for discovery).',
    inputSchema: {
      type: 'object',
      properties: { name: { type: 'string', description: 'Exact tool name.' } },
      required: ['name'],
    },
    category: 'catalog',
    tier: 'silent',
    source: 'builtin',
    exposure: 'core',
    handler: async (args) => {
      const name = typeof args['name'] === 'string' ? args['name'] : '';
      const def = searchIndex.describeTool(name);
      if (!def) return { ok: false, output: `[mcp-error] deckent_describe_tool: unknown tool: ${name}` };
      opts.exposure?.reveal(name);
      const params = summarizeEagerSchema(def.paramsSchema);
      return {
        ok: true,
        output: JSON.stringify({ name: def.name, description: def.description, category: def.category, risk: def.risk, params }),
      };
    },
  });

  registry.register({
    name: 'deckent_call_tool',
    description: 'Plan and invoke a tool from the deckent catalog by name (validates args, derives risk, and risk-gates the call behind a confirm decision before executing).',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Exact tool name (see deckent_search_tools/describe_tool).' },
        args: { type: 'object', additionalProperties: true, description: 'Arguments for the target tool.' },
      },
      required: ['name'],
    },
    category: 'catalog',
    // born-607: 'confirm' → 'silent'. call_tool is a ROUTER — its own outer tier
    // asking would (a) double-prompt against the inner per-target gate and (b) an
    // outer "always" would persist a `pattern:'**'` grant (call_tool args carry no
    // path/cmd → primaryResource '') silencing EVERY future nested call. The single
    // gate is the engine-parity resolver the bridge injects as `execImpl` (same
    // deny-rules/tierMap/floor/self-mod/mode checks as the loop's direct path);
    // without that injection the default remains NOT_WIRED_EXEC → fail-closed.
    tier: 'silent',
    source: 'builtin',
    exposure: 'core',
    handler: async (toolArgs) => {
      const name = typeof toolArgs['name'] === 'string' ? toolArgs['name'] : '';
      opts.exposure?.reveal(name);
      const callArgs = (toolArgs['args'] && typeof toolArgs['args'] === 'object' && !Array.isArray(toolArgs['args']))
        ? (toolArgs['args'] as Record<string, unknown>)
        : {};
      const plan: ToolDispatchPlan = { ...searchIndex.planCall(name, callArgs), args: callArgs };
      const result = await dispatchToolCall(plan, {
        execImpl: opts.execImpl ?? NOT_WIRED_EXEC,
        ...(opts.confirm ? { confirm: opts.confirm } : {}),
        riskThreshold: opts.riskThreshold ?? DEFAULT_RISK_THRESHOLD,
      });
      return toCallToolResult(result);
    },
  });
}

/**
 * TERM-FLOW-UNIFY Sprint-3 dilim (425-001). `deckent_propose_run` is 'silent'
 * tier ON PURPOSE — this is the exact fix the design doc's "Net Öneri" calls
 * out (today's generic per-tool confirm fires BEFORE the real plan exists;
 * "Outer permission gerçek plan üretilmeden önce yalnız tool adı/resource
 * üzerinden verilir"). The REAL digest-bound approval gate is
 * plan-preview-card.tsx's y/n keys, driven by the caller's
 * RunFlowController.approve()/reject() — never a generic AgentSession
 * per-tool confirm on this call itself. `generatePlanPreview` (424-001) is
 * READ-ONLY by construction, so this tool never writes a task file either.
 */
function registerRunFlowProposalTool(registry: ToolRegistry, controller: RunFlowController, cwd: () => string): void {
  registry.register({
    name: RUN_FLOW_PROPOSAL_TOOL_NAME,
    description: RUN_FLOW_PROPOSAL_TOOL_SPEC.description,
    inputSchema: RUN_FLOW_PROPOSAL_TOOL_SPEC.schema ?? { type: 'object', properties: {} },
    category: 'coding',
    tier: 'silent',
    source: 'builtin',
    handler: async (args) => {
      const intentSummary = typeof args['intentSummary'] === 'string' ? args['intentSummary'].trim() : '';
      if (intentSummary.length === 0) {
        return { ok: false, output: '[mcp-error] deckent_propose_run: intentSummary is required' };
      }
      // 557-003 → 3331: the lazy, idempotent provider bootstrap now lives in ONE
      // seam (provider-bootstrap.ts) shared with the `/do` slash path through the
      // controller's `ensureProviders` default (run.tsx wireRunFlowMount). Kept on
      // the tool call too so it stays self-sufficient when a host mounts the
      // controller without the seam; the gate makes the second call a no-op.
      await ensureProvidersBootstrapped(cwd(), () => loadConfig(cwd()));
      try {
        const context = await controller.proposeRun(intentSummary);
        return { ok: true, output: JSON.stringify({ state: context.state, preview: context.preview ?? null }) };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { ok: false, output: `[mcp-error] deckent_propose_run: ${message}` };
      }
    },
  });
}

export function buildNativeToolRegistry(opts: NativeToolRegistryOptions): ToolRegistry {
  const registry = new ToolRegistry();

  // Exec tools — NO confirm injected (single gate = AgentSession permission engine).
  const exec = createToolExecDispatcher({
    cwd: opts.cwd,
    ...(opts.contentStore ? { contentStore: opts.contentStore } : {}),
  });
  for (const name of ['deckent_read_file', 'deckent_list_dir', 'deckent_grep', 'deckent_glob', 'deckent_write_file', 'deckent_edit_file', 'deckent_bash', 'deckent_git_status', 'deckent_git_log', 'deckent_git_diff', 'deckent_git_add', 'deckent_git_commit'] as const) {
    const def = defineFromDispatcher(name, DESCRIPTIONS[name]!, SCHEMAS[name]!, execToolTier(name), exec, 'core');
    // 562-002: read_file keeps its tier/exposure/definition and only swaps the
    // handler in — the ranged form needs the broker's full bytes, which the plain
    // dispatcher passthrough cannot expose (see dispatchReadFile).
    registry.register(name === 'deckent_read_file'
      ? { ...def, handler: (args) => dispatchReadFile(opts.cwd, exec, args) }
      : def);
  }

  // CLI-bridge tools — the FULL dispatchable surface (born-596 TERM-TOOL-PARITY:
  // the dispatcher could always run ~29 subcommands, but only six read-only ones
  // were advertised, so the model never saw start/plan/cost/usage/kill/…).
  // Tier comes from classifyTool at each tool's MOST-privileged args
  // (WORST_CASE_CLASSIFY_ARGS) so a static tier can only over-ask, never
  // under-ask — destructive tools land on 'always' via ALWAYS_CONFIRM and the
  // AgentSession permission engine re-confirms them every call.
  const cli = createCliToolDispatcher();
  const genericSchema: Record<string, unknown> = { type: 'object', properties: {}, additionalProperties: true };
  for (const spec of CLI_BRIDGE_TOOLS) {
    const tier = LEGACY_TIER[classifyTool(spec.name, WORST_CASE_CLASSIFY_ARGS[spec.name] ?? {})];
    // TERM-FLOW-UNIFY Sprint-3 dilim (425-001): flag-off (opts.runFlow omitted or
    // disabled, every current call site) leaves `description` byte-identical to
    // pre-425-001 — the note is appended ONLY when terminal.run_flow_v2 is on.
    const description = opts.runFlow?.enabled && RUN_FLOW_ESCAPE_HATCH_NAMES.has(spec.name)
      ? `${spec.description} ${RUN_FLOW_ESCAPE_HATCH_NOTE}`
      : spec.description;
    registry.register(defineFromDispatcher(spec.name, description, spec.schema ?? genericSchema, tier, cli));
  }

  // Skill-dispatch tool (F11) — worker parity: lets the native REPL agent invoke a
  // deckent skill by id and receive its expert guidance as a tool_result. Delegates
  // to the live skill-pool/cache path by default, or an injected seam (tests). Read-
  // only (resolves guidance, no side-effects) → 'silent'. Metadata is technical/model-
  // facing (NOT user-facing i18n). TODO(phase2): a web_search tool stays OUT of scope
  // here — it needs an in-session approval UI / permission-gate, not the single no-op
  // gate these tools share.
  const skillDispatcher = opts.skillDispatcher ?? createDefaultSkillDispatcher(opts.cwd);
  registry.register({
    name: 'deckent_skill_dispatch',
    description: "Invoke a deckent skill by id (skillId + optional args); returns the skill's expert guidance to apply in this turn.",
    inputSchema: {
      type: 'object',
      properties: {
        skillId: { type: 'string', description: 'The skill id to dispatch (see deckent_skill_list).' },
        args: { type: 'object', additionalProperties: true, description: 'Optional skill arguments.' },
      },
      required: ['skillId'],
    },
    category: 'skill',
    tier: 'silent',
    source: 'builtin',
    handler: async (toolArgs) => {
      const skillId = typeof toolArgs['skillId'] === 'string' ? toolArgs['skillId'].trim() : '';
      if (skillId.length === 0) return { ok: false, output: '[mcp-error] deckent_skill_dispatch: skillId required' };
      const skillArgs = (toolArgs['args'] && typeof toolArgs['args'] === 'object' && !Array.isArray(toolArgs['args']))
        ? (toolArgs['args'] as Record<string, unknown>)
        : {};
      return toolResultFrom(await skillDispatcher.dispatch(skillId, skillArgs));
    },
  });

  // MCP tools (external) — always 'confirm' (never silent). The bridge's legacy
  // confirm callback is a no-op approval because every handler invocation is
  // reached only after AgentSession's live mode + live rule-store decision.
  // Nested deckent_call_tool reaches the same decision through the parity exec
  // resolver before invoking this handler, so the bridge must never ask again.
  if (opts.mcpBridge) {
    const alwaysApprove = async (): Promise<boolean> => true;
    const bridge = opts.mcpBridge;
    for (const t of bridge.listTools()) {
      registry.register({
        name: t.namespacedName,
        description: mcpToolDescription(t.descriptor.description, t.namespacedName),
        inputSchema: t.descriptor.inputSchema ?? { type: 'object', additionalProperties: true },
        category: 'mcp',
        tier: 'confirm',
        source: 'mcp',
        handler: async (args) => {
          const r = await bridge.dispatch(t.namespacedName, args, alwaysApprove);
          return { ok: r.ok, output: r.output };
        },
      });
    }
  }

  // TOOL-REPL-WIRE (354-002) — `tool_surface.enabled`, default OFF. When absent
  // or false the block below never runs, so every registration above this line
  // stays byte-identical to the pre-354-002 tool list.
  if (opts.toolSurface?.enabled) {
    registerToolSurfaceTools(registry, opts.toolSurface);
  }

  // TERM-FLOW-UNIFY Sprint-3 dilim (425-001) — `terminal.run_flow_v2`, default
  // OFF. When absent or false the block below never runs, so every
  // registration above this line stays byte-identical to pre-425-001.
  if (opts.runFlow?.enabled) {
    registerRunFlowProposalTool(registry, opts.runFlow.controller, opts.cwd);
  }

  return registry;
}
