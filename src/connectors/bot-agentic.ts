/**
 * BOT-003 slice 2 — bot agentic safety core (§4G).
 *
 * Slice 2 swaps the chat bridge to a tool_use-capable provider so the model can
 * drive actions. But runChatNativeLoop does NOT confirm-gate model-driven
 * tool_use (chat-native.ts:671 dispatches directly), and all three tool paths
 * (model tool_use / slash / agenticDispatch) funnel through dispatcher.dispatch.
 * So the dispatcher is the single safety chokepoint:
 *
 *   - read-only tools  → execute immediately (grounded answers)
 *   - risky tools      → PARK an approval, return an informed NOT-EXECUTED result
 *                        ("approve <id>"), and run nothing. The user approves
 *                        from their phone (BOT-002), which executes it (slice 2b).
 *
 * Tool surface is the CLI bridge (sprint ops) — deliberately NOT raw shell /
 * file-write: bash over Telegram is RCE even for the owner (compromised account,
 * fat-finger), even when gated. The bot system prompt advertises ONLY these.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { McpToolDispatcher } from '../cli/commands/chat-native.js';
import { getMessage } from '../cli/helpers/messages.js';
import { canonicalJson } from '../core/audit-writer.js';
import { BRAIN_DIR, MEMORY_DB_FILE } from '../core/constants.js';
import type { MemoryReadLabelsV1, MemoryReadLimitsV1, MemoryReadScopeV1 } from '../core/memory-read-contract.js';
import { MemoryReadRenderHoldError, readMemoryDetail, readMemoryView, renderMemoryReadView } from '../core/memory-read-service.js';
import { MemoryStore } from '../core/memory-store.js';
import type { PolicyResolution } from './capabilities/policy.js';

/**
 * Risky tools require human approval before executing. Everything not explicitly
 * read-only is risky (fail-safe default) — an unknown/new tool is never
 * auto-executed over a messaging channel.
 */
const READ_ONLY_BOT_TOOLS: ReadonlySet<string> = new Set([
  'deckent_status',
  'deckent_history',
  'deckent_retro',
  'deckent_doctor',
  'deckent_models',
  'deckent_analyze_project',
  'deckent_review',
  'deckent_explain',
  'deckent_agent_list',
  'deckent_skill_list',
  'deckent_feature_query',
  'deckent_memory_query',
  // Cost/usage observability surface — read-only, fast, no state change. Each MUST
  // also be wired in cliArgsFor (chat-tool-bridge.ts) → CLI subcommand, else the bot's
  // inner dispatcher refuses it with "tool not allowed". Exposed so the phone bot can
  // answer "bugünkü maliyet / token kullanımı / KPI" from live data.
  'deckent_cost',
  'deckent_usage',
  'deckent_kpi',
]);

/** True when a tool changes state / is destructive → must be approval-gated. */
export function isRiskyBotTool(name: string): boolean {
  return !READ_ONLY_BOT_TOOLS.has(name);
}

/**
 * True when a real checkpoint is awaiting human approval right now — i.e. a
 * `.deckent/checkpoints/checkpoint-*.json` with `status: "pending"`. Mirrors the
 * checkpoint CLI's storage contract (cli/commands/checkpoint.ts) without
 * importing it (keeps connectors independent of cli/commands).
 *
 * Sprint 238 İŞ3: the agentic bot would PARK a model-initiated `deckent_checkpoint`
 * call as "🔐 APPROVAL REQUIRED", which the user read as a real pending checkpoint
 * and panicked over — even though nothing was pending and the sprint was never
 * blocked ([[project_spurious_bot_checkpoint_notify]]). This guard lets the
 * dispatcher answer benignly when there is genuinely nothing to approve.
 */
export function hasRealPendingCheckpoint(root: string): boolean {
  const dir = join(root, '.deckent', 'checkpoints');
  if (!existsSync(dir)) return false;
  try {
    for (const f of readdirSync(dir)) {
      if (!f.startsWith('checkpoint-') || !f.endsWith('.json')) continue;
      try {
        const cp = JSON.parse(readFileSync(join(dir, f), 'utf-8')) as { status?: string };
        if (cp.status === 'pending') return true;
      } catch { /* skip malformed checkpoint file */ }
    }
  } catch { /* unreadable dir → treat as nothing pending */ }
  return false;
}

/** Park a risky action for later approval; returns the approval id. */
export type ParkAction = (tool: string, args: Record<string, unknown>) => string;

/**
 * Capability gate injected into the dispatcher. Provides per-capability policy
 * resolution so capability tool calls are routed through the SAME single
 * chokepoint rather than a parallel path (one-chokepoint invariant).
 */
export interface CapabilityGate {
  /** True when `id` names a registered capability tool (e.g. 'screenshot'). */
  has(id: string): boolean;
  /** Resolve the policy decision for a capability tool. */
  resolve(id: string): PolicyResolution;
  /** Execute a capability that resolved to 'auto'. */
  runAuto(id: string, args: Record<string, unknown>): Promise<string>;
  /**
   * Optional: send a buttoned approval request message to the user. When
   * present and returns true the action id was successfully communicated via
   * a rich (button-carrying) message; the dispatcher then returns a short
   * acknowledgement instead of the legacy "type approve <id>" text.
   * Returns false (or rejects) → dispatcher falls back to the legacy message.
   */
  sendApproval?(id: string, capId: string, args: Record<string, unknown>): Promise<boolean>;
}

export interface GatedDispatcherDeps {
  /** Underlying dispatcher that actually runs read-only tools (CLI bridge). */
  readonly inner: McpToolDispatcher;
  /** Persist a risky action and return its approval id. */
  readonly park: ParkAction;
  /** Optional language for the parked-action message (default 'en'). */
  readonly lang?: string;
  /**
   * Optional probe for a real pending checkpoint. When provided and it returns
   * false, a model-initiated `deckent_checkpoint` call is answered benignly
   * instead of parked — killing the spurious "checkpoint awaiting approval"
   * alarm (Sprint 238 İŞ3). Omitted → legacy behavior (checkpoint is parked).
   */
  readonly hasPendingCheckpoint?: () => boolean;
  /**
   * Optional capability gate. When provided and `capabilities.has(name)` is
   * true, the capability branch handles the call at the TOP of dispatch (before
   * the existing checkpoint-guard / risky-park / safe-exec logic) — preserving
   * the single-chokepoint invariant.
   */
  readonly capabilities?: CapabilityGate;
  /**
   * Optional: send a buttoned approval message for a risky deckent_* TOOL (not a
   * capability) — the tool-side analogue of `capabilities.sendApproval`. When
   * present and it returns true, the parked tool's approval was delivered as an
   * interactive (Approve/Reject button) message, so the dispatcher returns a short
   * ack instead of the legacy "type approve <id>" text. Returns false (or rejects)
   * → the dispatcher falls back to the legacy parked-action text. Omitted → legacy
   * text always (byte-for-byte unchanged). This is what makes group approvals
   * buttoned: risky deckent_* tools previously had NO button path, only capabilities did.
   */
  readonly sendToolApproval?: (
    id: string,
    tool: string,
    args: Record<string, unknown>,
  ) => Promise<boolean>;
}

/**
 * Wrap a dispatcher so risky tools are parked (not executed) and read-only tools
 * pass through. The single safety chokepoint for all three loop tool paths.
 */
export function makeGatedDispatcher(deps: GatedDispatcherDeps): McpToolDispatcher {
  const lang = deps.lang ?? 'en';
  return {
    async dispatch(name: string, args: Record<string, unknown>): Promise<string> {
      // Capability branch — MUST come first to preserve the one-chokepoint
      // invariant: capability tool calls route through THIS dispatcher, not a
      // parallel path. Non-capability names fall through to the existing logic.
      if (deps.capabilities?.has(name)) {
        const decision = deps.capabilities.resolve(name);
        if (decision === 'unavailable') return getMessage('cap.gate.unavailable', lang, { id: name });
        if (decision === 'deny') return getMessage('cap.gate.denied', lang, { id: name });
        if (decision === 'confirm') {
          const id = deps.park(name, args);
          const sent = deps.capabilities.sendApproval
            ? await deps.capabilities.sendApproval(id, name, args).catch(() => false)
            : false;
          return sent ? approvalRequestedAck(name, lang) : parkedActionMessage(id, name, args, lang);
        }
        // decision === 'auto'
        return deps.capabilities.runAuto(name, args);
      }
      // Sprint 238 İŞ3: a model-initiated `deckent_checkpoint` with NOTHING
      // pending is a no-op — parking it as "approval required" produces a false
      // "checkpoint awaiting approval" alarm (the sprint is not blocked). Answer
      // benignly when there is no real pending checkpoint; a genuine pending
      // checkpoint still goes through the gate below.
      if (
        name === 'deckent_checkpoint' &&
        deps.hasPendingCheckpoint &&
        !deps.hasPendingCheckpoint()
      ) {
        return noPendingCheckpointMessage(lang);
      }
      if (isRiskyBotTool(name)) {
        const id = deps.park(name, args);
        // Prefer a buttoned approval (same UX as capabilities) so the user taps
        // Approve/Reject instead of typing "approve <id>" — works in groups too.
        // sendToolApproval absent or failing → legacy parked text (unchanged).
        const sent = deps.sendToolApproval
          ? await deps.sendToolApproval(id, name, args).catch(() => false)
          : false;
        return sent ? toolApprovalRequestedAck(name, lang) : parkedActionMessage(id, name, args, lang);
      }
      try {
        return await deps.inner.dispatch(name, args);
      } catch (err) {
        // Surface as a tagged result so the loop continues (model reports it).
        return `[mcp-error] ${name}: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  };
}

/**
 * Short acknowledgement returned when `sendApproval` successfully delivered a
 * buttoned approval request. The user already received the interactive message;
 * the model should relay that approval has been requested and await the decision.
 */
function approvalRequestedAck(capId: string, lang: string): string {
  return getMessage('cap.approval.ack', lang, { cap: capId });
}

/**
 * Short ack returned when a risky deckent_* TOOL's approval was delivered as a
 * buttoned message (the user already has Approve/Reject buttons). The tool-side
 * analogue of `approvalRequestedAck`; the model relays that approval was requested
 * and awaits the decision rather than dumping the "type approve <id>" text.
 */
function toolApprovalRequestedAck(tool: string, lang: string): string {
  return getMessage('tool.approval.ack', lang, { tool });
}

/**
 * Load-bearing tool_result for a parked action: it MUST state the action was NOT
 * executed and how to approve it, so the model relays that instead of claiming
 * success (the hollow-DONE failure mode, conversational form).
 */
function parkedActionMessage(
  id: string,
  tool: string,
  args: Record<string, unknown>,
  lang: string,
): string {
  const argStr = summarizeArgs(args);
  if (lang === 'tr') {
    return (
      `🔐 ONAY GEREKLİ — ÇALIŞTIRILMADI: ${tool}(${argStr}). ` +
      `Bu işlem insan onayı bekliyor; henüz hiçbir şey yapılmadı. ` +
      `Onaylamak için yaz: approve ${id} — reddetmek için: reject ${id}.`
    );
  }
  return (
    `🔐 APPROVAL REQUIRED — NOT EXECUTED: ${tool}(${argStr}). ` +
    `This action is awaiting human approval; nothing has run yet. ` +
    `To approve, reply: approve ${id} — to reject: reject ${id}.`
  );
}

/**
 * Benign tool_result for `deckent_checkpoint` when nothing is pending. States
 * plainly that the sprint is NOT blocked so the model relays "nothing to do"
 * rather than an alarming "approval required" (Sprint 238 İŞ3).
 */
function noPendingCheckpointMessage(lang: string): string {
  if (lang === 'tr') {
    return 'Şu an onay bekleyen bir checkpoint yok — sprint bloke değil, yapılacak bir şey yok.';
  }
  return 'No checkpoint is awaiting approval — the sprint is not blocked; nothing to do.';
}

export function summarizeArgs(args: Record<string, unknown>): string {
  const keys = Object.keys(args ?? {});
  if (keys.length === 0) return '';
  return keys
    .map((k) => {
      const v = args[k];
      const s = typeof v === 'string' ? v : JSON.stringify(v);
      return `${k}: ${s.length > 120 ? s.slice(0, 117) + '…' : s}`;
    })
    .join(', ');
}

/**
 * Bot-specific agentic system prompt. Advertises ONLY the CLI sprint tools (no
 * shell/file surface) using the generic <deckent_tool>{name,args} directive that
 * chat-session parses into tool_use. Tells the model risky tools need approval
 * so it sets expectations honestly.
 */
export const DECKENT_BOT_SYSTEM_PROMPT = [
  'Sen deckent projesinin Telegram asistanısın — kullanıcının telefonundan',
  'projeyi sohbet ederek yönetmesini sağlarsın. Canlı veriye veya bir aksiyona',
  'ihtiyacın olduğunda ŞU formatta bir tool direktifi yay (başka bir şey ekleme):',
  '<deckent_tool>{"name":"<tool>","args":{...}}</deckent_tool>',
  '',
  'Salt-okunur tool\'lar (anında çalışır): deckent_status (sprint durumu),',
  'deckent_history, deckent_retro, deckent_doctor, deckent_models,',
  'deckent_analyze_project, deckent_review, deckent_explain, deckent_agent_list,',
  'deckent_skill_list, deckent_feature_query, deckent_memory_query{query|cursor|detail_ref},',
  'deckent_cost (bugünkü harcama), deckent_usage (token/limit kullanımı),',
  'deckent_kpi (KPI skor kartı).',
  '',
  'Durum-değiştiren tool\'lar (insan ONAYI gerekir, sen çağırsan bile HEMEN',
  'çalışmaz): deckent_plan{directive}, deckent_set_directives{content},',
  'deckent_config, deckent_autonomous{action}, deckent_sync, deckent_kill,',
  'deckent_cleanup, deckent_recover, deckent_checkpoint. Bunları çağırdığında',
  'sistem bir onay-kapısı açar; kullanıcı mesajdaki Onayla/Reddet butonuna basana',
  '(ya da "approve <id>" yazana) kadar HİÇBİR ŞEY yapılmaz. Asla "yaptım/başlattım"',
  'deme — onay istendiğini söyle.',
  '',
  'Aksiyon gerekmeyen sorulara normal metinle, kullanıcının dilinde cevap ver.',
].join('\n');

export interface BotMemoryPromptLabelsV1 {
  readonly heading: string;
  readonly guidance: string;
  readonly absent: string;
  readonly hold: (reasonCode: string) => string;
}

export interface BotMemoryToolLabelsV1 {
  readonly invalidRequest: string;
  readonly absent: string;
  readonly unavailable: (reasonCode: string) => string;
}

export type BotMemoryGroundingV1 =
  | Readonly<{ state: 'AVAILABLE'; rendered: string; revision: string }>
  | Readonly<{ state: 'ABSENT'; revision: string }>
  | Readonly<{ state: 'HOLD'; reasonCode: string }>;

export interface BotMemoryReadAuthorityV1 {
  readonly root: string;
  readonly scope: MemoryReadScopeV1;
  readonly limits: Readonly<MemoryReadLimitsV1>;
  readonly labels: Readonly<MemoryReadLabelsV1>;
  readonly toolLabels: Readonly<BotMemoryToolLabelsV1>;
}

function withReadonlyMemory<T>(root: string, reader: (store: MemoryStore) => T): T {
  const store = new MemoryStore(join(root, BRAIN_DIR, MEMORY_DB_FILE), { readOnly: true });
  try {
    return reader(store);
  } finally {
    store.close();
  }
}

/** Canonical, scope-bound grounding snapshot. Missing/unreadable storage is a typed HOLD. */
export function readBotMemoryGrounding(authority: BotMemoryReadAuthorityV1): BotMemoryGroundingV1 {
  try {
    const view = withReadonlyMemory(authority.root, (store) => readMemoryView(store, {
      consumer: 'bot',
      scope: authority.scope,
      query: {},
      limits: authority.limits,
      includeCritical: true,
    }));
    if (view.state === 'HOLD') return Object.freeze({ state: 'HOLD', reasonCode: view.reasonCode });
    if (view.state === 'ABSENT') {
      return Object.freeze({ state: 'ABSENT', revision: view.selectionRevisionDigest });
    }
    return Object.freeze({
      state: 'AVAILABLE',
      rendered: renderMemoryReadView(view, authority.labels),
      revision: view.selectionRevisionDigest,
    });
  } catch (error: unknown) {
    const reasonCode = error instanceof MemoryReadRenderHoldError
      ? error.reasonCode
      : 'MEMORY_SOURCE_UNAVAILABLE';
    return Object.freeze({ state: 'HOLD', reasonCode });
  }
}

function exactMemoryToolArgs(args: Record<string, unknown>): Readonly<{
  query: string;
  cursor: string;
  detailRef: string;
}> | null {
  if (args === null || Array.isArray(args) || typeof args !== 'object'
    || Object.keys(args).some((key) => !['query', 'cursor', 'detail_ref'].includes(key))) return null;
  if (args['query'] !== undefined && typeof args['query'] !== 'string') return null;
  if (args['cursor'] !== undefined && typeof args['cursor'] !== 'string') return null;
  if (args['detail_ref'] !== undefined && typeof args['detail_ref'] !== 'string') return null;
  const query = (args['query'] as string | undefined)?.trim() ?? '';
  const cursor = (args['cursor'] as string | undefined)?.trim() ?? '';
  const detailRef = (args['detail_ref'] as string | undefined)?.trim() ?? '';
  if ((args['query'] !== undefined && query.length === 0)
    || (args['cursor'] !== undefined && cursor.length === 0)
    || (args['detail_ref'] !== undefined && detailRef.length === 0)
    || (detailRef.length > 0 && (query.length > 0 || cursor.length > 0))
    || (detailRef.length === 0 && query.length === 0)
    || (cursor.length > 0 && query.length === 0)) return null;
  return Object.freeze({ query, cursor, detailRef });
}

/**
 * Replace only the bot memory tool with the canonical per-turn read authority.
 * Every other tool is delegated byte-for-byte to the existing gated dispatcher.
 */
export function makeBotMemoryReadDispatcher(
  inner: McpToolDispatcher,
  authority: BotMemoryReadAuthorityV1 | Readonly<{
    state: 'HOLD';
    reasonCode: string;
    toolLabels: Readonly<BotMemoryToolLabelsV1>;
  }>,
): McpToolDispatcher {
  return {
    async dispatch(name, args) {
      if (name !== 'deckent_memory_query') return inner.dispatch(name, args);
      const parsed = exactMemoryToolArgs(args);
      if (parsed === null) return authority.toolLabels.invalidRequest;
      if ('state' in authority) return authority.toolLabels.unavailable(authority.reasonCode);
      try {
        if (parsed.detailRef.length > 0) {
          const detail = withReadonlyMemory(authority.root, (store) => readMemoryDetail(store, {
            consumer: 'bot', scope: authority.scope, detailRef: parsed.detailRef,
          }));
          return detail.state === 'AVAILABLE'
            ? canonicalJson(detail)
            : authority.toolLabels.unavailable(detail.reasonCode);
        }
        const view = withReadonlyMemory(authority.root, (store) => readMemoryView(store, {
          consumer: 'bot', scope: authority.scope, query: { text: parsed.query },
          limits: authority.limits,
          ...(parsed.cursor.length > 0 ? { cursor: parsed.cursor } : {}),
        }));
        if (view.state === 'HOLD') return authority.toolLabels.unavailable(view.reasonCode);
        if (view.state === 'ABSENT') return authority.toolLabels.absent;
        return renderMemoryReadView(view, authority.labels);
      } catch (error: unknown) {
        const reasonCode = error instanceof MemoryReadRenderHoldError
          ? error.reasonCode
          : 'MEMORY_SOURCE_UNAVAILABLE';
        return authority.toolLabels.unavailable(reasonCode);
      }
    },
  };
}

/**
 * Build the bot's conversational system prompt from a canonical bounded memory
 * snapshot supplied by the caller. Volatile sprint progress stays tool-driven.
 */
export function buildBotSystemPrompt(
  grounding?: BotMemoryGroundingV1,
  labels?: Readonly<BotMemoryPromptLabelsV1>,
): string {
  if (!grounding || !labels) return DECKENT_BOT_SYSTEM_PROMPT;
  const context = grounding.state === 'AVAILABLE'
    ? grounding.rendered
    : grounding.state === 'ABSENT'
      ? labels.absent
      : labels.hold(grounding.reasonCode);
  return [
    DECKENT_BOT_SYSTEM_PROMPT,
    '',
    labels.guidance,
    '',
    `## ${labels.heading}`,
    context,
  ].join('\n');
}
