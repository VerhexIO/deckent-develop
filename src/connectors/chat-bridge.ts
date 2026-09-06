/**
 * BOT chat bridge (§4G) — drive deckent's native agentic chat engine from a
 * messaging connector, so Telegram becomes a full conversational head (not just
 * approve/reject). One inbound text → one agentic reply string.
 *
 * Slice 1 safety posture (advisor): the default provider is the SUBSCRIPTION
 * claude adapter, which never emits tool_use — the model can converse but cannot
 * itself decide to run a tool. Recognized read-only intents (status/recall/
 * history) still ground answers via agenticDispatch; risky actions are DENIED by
 * the default confirm (no destructive surface over chat yet). Slice 2 swaps in a
 * tool_use provider and routes risky actions through the BOT-002 approve gate.
 *
 * Correctness guards the advisor flagged as blocking:
 *  - per-session serialization (a stateful chat corrupts under concurrent turns)
 *  - graceful errors (the bot must always reply, never silently die)
 *  - Telegram 4096-char chunking (sendMessage throws on long replies)
 */

import {
  runChatNativeLoop,
  buildSubscriptionPrompt,
  defaultSubscriptionSpawn,
  type ChatProviderAdapter,
  type McpToolDispatcher,
  type ChatMemoryAdapter,
} from '../cli/commands/chat-native.js';
import { createCliToolDispatcher } from '../cli/commands/chat-tool-bridge.js';
import { createPersistentClaudeSession } from '../cli/commands/chat-session.js';
import { classifyActionRisk, type AgenticAction } from '../cli/commands/agentic-confirm.js';
import {
  makeGatedDispatcher,
  hasRealPendingCheckpoint,
  buildBotSystemPrompt,
  makeBotMemoryReadDispatcher,
  readBotMemoryGrounding,
  summarizeArgs,
  type BotMemoryGroundingV1,
  type BotMemoryPromptLabelsV1,
  type BotMemoryReadAuthorityV1,
  type BotMemoryToolLabelsV1,
} from './bot-agentic.js';
import { parkBotAction, isSprintScopedDestructive, attachApprovalMessageId } from './bot-action-store.js';
import { getCurrentSprintId } from '../monitor/sprint-state.js';
import { createBuiltinRegistry, buildMediaSink, runCapability } from './capabilities/index.js';
import { resolvePolicy } from './capabilities/policy.js';
import { detectPlatform } from './capabilities/platform.js';
import { defaultSpawn } from './capabilities/spawn.js';
import { loadNodemailerTransport } from './capabilities/mail-transport.js';
import { describeCapabilities } from './capabilities/prompt.js';
import type { ArtifactStore, BotCapabilitiesConfig, MediaAttachment } from './capabilities/types.js';
import { approvalCallbackData } from './callback-router.js';
import { markdownToTelegramHtml } from './markdown-to-html.js';
import { getMessage } from '../cli/helpers/messages.js';
import { canonicalJson } from '../core/audit-writer.js';
import { attendedExecutionProjectId } from '../core/attended-execution-approval.js';
import { resolveMemoryReadConfig } from '../core/config.js';
import { buildMemoryReadLabels } from '../core/memory-read-labels.js';
import type { MemoryReadScopeV1 } from '../core/memory-read-contract.js';
import type { PerTurnConnector, ConnectorId } from './types.js';
import type { CapabilityRegistry } from './capabilities/registry.js';
import type { ResolvedPrincipal } from './identity/provider.js';
import { createHash, randomBytes } from 'node:crypto';
import { shortCodeFor } from '../core/approval-short-code.js';

/**
 * Build an out-of-band approval sender bound to a specific connector and capability
 * registry. Returns a curried function `(channelId, id, capId, args) => Promise<boolean>`.
 *
 * - Returns `false` immediately when the connector lacks `sendMessage` (no send surface).
 * - Prefers `sendMessageReturningId` over `sendMessage` (allows message-id capture for
 *   later edits in Task 4).
 * - Builds a buttoned HTML preview: `cap.preview` → `markdownToTelegramHtml`, with
 *   Approve/Reject inline buttons using `approvalCallbackData`.
 * - i18n via `getMessage` (en/tr). `cap.approval.header` key localises the header line.
 */
/**
 * Returns the platform message-id string when `sendMessageReturningId` is
 * available and delivers one, `''` (empty string) when the message was sent
 * via the fallback `sendMessage` (no id), or `false` when the connector has
 * no send surface at all.
 *
 * Callers that only need a boolean (gate: "was approval sent?") can check
 * `result !== false`. Callers that want the id for later edits receive it
 * directly and must handle the `''` (sent, no id) case.
 */
export function makeSendApproval(
  connector: PerTurnConnector,
  registry: CapabilityRegistry,
  lang: string,
): (channelId: string, id: string, capId: string, args: Record<string, unknown>) => Promise<string | false> {
  return async (channelId, id, capId, args) => {
    if (typeof connector.sendMessage !== 'function') return false;
    const cap = registry.get(capId);
    const previewMd = cap ? cap.preview(args as never, lang) : `${capId}(${JSON.stringify(args)})`;
    const header = getMessage('cap.approval.header', lang);
    const shortCode = shortCodeFor(id);
    const nonce = randomBytes(4).toString('hex');
    const html = markdownToTelegramHtml(`🔐 ${header}\n${previewMd}\n#${shortCode}`);
    const buttons: ReadonlyArray<ReadonlyArray<{ text: string; callbackData: string }>> = [[
      { text: getMessage('cap.btn.approve', lang), callbackData: approvalCallbackData('bot', 'approve', shortCode, nonce) },
      { text: getMessage('cap.btn.reject', lang), callbackData: approvalCallbackData('bot', 'reject', shortCode, nonce) },
    ]];
    const msg = { connector: connector.id as ConnectorId, channelId, text: html, parseMode: 'HTML' as const, buttons };
    if (connector.sendMessageReturningId) {
      const mid = await connector.sendMessageReturningId(msg);
      return mid ?? ''; // real id when available; '' means sent but no id
    }
    await connector.sendMessage(msg);
    return ''; // sendMessage-only: sent but no id available
  };
}

/**
 * Tool-side analogue of `makeSendApproval`: build a buttoned approval sender for a
 * risky deckent_* TOOL (not a capability — there is no CapabilityRegistry preview,
 * so the body is `tool(args-summary)`). Same Approve/Reject inline buttons + same
 * `approvalCallbackData` contract, so a button press carries the compact bot
 * approval reference consumed by the callback router. This is what gives risky deckent_*
 * tools a buttoned approval (in groups too) — previously only capabilities had one.
 *
 * Returns the platform message-id when available, `''` when sent without an id, or
 * `false` when the connector has no send surface (→ caller uses the legacy text).
 */
export function makeSendToolApproval(
  connector: PerTurnConnector,
  lang: string,
): (channelId: string, id: string, tool: string, args: Record<string, unknown>) => Promise<string | false> {
  return async (channelId, id, tool, args) => {
    if (typeof connector.sendMessage !== 'function') return false;
    const header = getMessage('cap.approval.header', lang); // generic "Approval required — not executed"
    const argStr = summarizeArgs(args);
    const shortCode = shortCodeFor(id);
    const nonce = randomBytes(4).toString('hex');
    const html = markdownToTelegramHtml(`🔐 ${header}\n${tool}(${argStr})\n#${shortCode}`);
    const buttons: ReadonlyArray<ReadonlyArray<{ text: string; callbackData: string }>> = [[
      { text: getMessage('cap.btn.approve', lang), callbackData: approvalCallbackData('bot', 'approve', shortCode, nonce) },
      { text: getMessage('cap.btn.reject', lang), callbackData: approvalCallbackData('bot', 'reject', shortCode, nonce) },
    ]];
    const msg = { connector: connector.id as ConnectorId, channelId, text: html, parseMode: 'HTML' as const, buttons };
    if (connector.sendMessageReturningId) {
      const mid = await connector.sendMessageReturningId(msg);
      return mid ?? '';
    }
    await connector.sendMessage(msg);
    return '';
  };
}

/** Default provider: subscription claude (API key stripped → session auth, no tool_use). */
function defaultSubscriptionProvider(): ChatProviderAdapter {
  return {
    async send(messages) {
      const prompt = buildSubscriptionPrompt(messages);
      const env: NodeJS.ProcessEnv = { ...process.env };
      delete env['ANTHROPIC_API_KEY'];
      delete env['DECKENT_CLAUDE_API_KEY'];
      const { chunks, wait } = defaultSubscriptionSpawn('claude', ['--print', prompt], env);
      let text = '';
      for await (const chunk of chunks) text += chunk;
      await wait;
      return { text, stopReason: 'end_turn' };
    },
  };
}

/** Slice-1 confirm: auto-approve read-only (safe) intents, DENY risky ones. */
const denyRiskyConfirm = async (action: AgenticAction): Promise<boolean> =>
  classifyActionRisk(action) === 'safe';

export interface ChatResponderDeps {
  /** Chat provider. Default: subscription claude (no tool_use surface). */
  provider?: ChatProviderAdapter;
  /** Tool dispatcher for agenticDispatch/slash. Default: CLI bridge (read-only via confirm). */
  dispatcher?: McpToolDispatcher;
  /** Risky-action gate. Default: deny risky, allow safe (slice 1). */
  confirm?: (action: AgenticAction) => Promise<boolean>;
  /** Conversation memory (per-session history). Omit for stateless turns. */
  memory?: ChatMemoryAdapter;
  maxTurns?: number;
  maxToolHops?: number;
  /** Prior turns to load from memory for context (default 30 when memory wired). */
  resumeLimit?: number;
  /**
   * Slice 2 — agentic mode: use a tool_use-capable persistent provider (the model
   * can drive actions) and route every tool through the GATED dispatcher
   * (read-only auto-exec, risky → park for phone approval). Requires `root` for
   * the durable action store. Default false = slice-1 subscription chat.
   */
  agentic?: boolean;
  /** Project root — required for `agentic` (durable parked-action store). */
  root?: string;
  /** Ack/parked-action message language. */
  lang?: string;
  /**
   * Faz-1 T3 — streaming partial-reply hook. Invoked on every output line with
   * the cumulative reply text so far (`collected.join('')`), so a bot connector
   * can edit a "typing…" placeholder in-place as the reply streams.
   * Optional and additive: existing callers that omit it are unaffected.
   */
  onPartial?: (sessionId: string, partialText: string) => void;
  /**
   * Slice 1 T10 — capabilities config. When provided (and enabled), the builtin
   * capability registry is wired into the gated dispatcher (agentic mode) and the
   * capability catalog is appended to the bot system prompt.
   * Default: undefined → capability surface is OFF (existing behavior preserved).
   */
  capConfig?: BotCapabilitiesConfig;
  /**
   * Static connector reference for media delivery — used as a fallback when no
   * per-turn connector is provided. When absent, capabilities that produce media
   * fall back to honest text.
   */
  capConnector?: { id: string; sendMedia?(channelId: string, media: MediaAttachment): Promise<void> };
  /**
   * Test seam: override the spawn function used by capabilities (e.g. to inject
   * a fake PNG-returning spawn in unit tests without triggering real OS capture).
   * When absent, capabilities use their default spawn (defaultSpawn from spawn.ts).
   */
  capSpawn?: import('./capabilities/types.js').SpawnFn;
  /**
   * Test seam: override the platform id reported to capabilities.
   * When absent, detectPlatform() is called (runtime detection).
   */
  capPlatform?: import('./capabilities/types.js').PlatformId;
  /**
   * Test seam: override the mail transport loader used by capabilities.
   * When absent, capabilities use loadNodemailerTransport (real SMTP).
   * Allows hermetic e2e tests to inject a fake transport spy.
   */
  capMailTransport?: import('./capabilities/types.js').CapabilityContext['loadMailTransport'];
  /**
   * Task 13 — single artifact store threaded from bootstrap construction.
   * When provided, capabilities that produce artifacts (screenshot) register them
   * here, and capabilities that consume artifact ids (send_mail attachIds) resolve
   * them from the SAME store. Ensures an inbound-registered photo is resolvable
   * by send_mail in the same bot session (single-instance per connector invariant).
   * Default: undefined → no artifact context (backward-compat, default-off).
   */
  artifacts?: ArtifactStore;
  /** Hermetic factory seam for the same single-child production lifecycle. */
  persistentProviderFactory?: (input: Readonly<{ systemPrompt: string }>) => PersistentProvider;
}

/** Per-turn media connector — optional 3rd argument to ChatResponder calls. */
export type PerTurnMediaConnector = {
  id: string;
  sendMedia?(channelId: string, media: MediaAttachment): Promise<void>;
};

export interface ChatResponder {
  /**
   * Invoke a chat turn.
   *  - `mediaConnector` is an OPTIONAL 3rd arg (Slice 1.1): when provided, it is
   *    used as the media sink for that turn (overrides the static `capConnector`
   *    dep). Existing 2-arg callers are unaffected.
   *  - `detectedLang` is an OPTIONAL 4th arg (WS1 Task 3): the BCP-47 language
   *    tag detected by STT for this turn (e.g. 'tr', 'en'). Only set for
   *    voice-origin turns whose STT provider returned a language. Absent for
   *    text-origin turns and voice turns whose provider did not detect a language.
   *    Task 5 reads this to inject a reply-language instruction into the turn.
   *  - `principal` is an OPTIONAL 5th arg (ADR-092, identity-wiring review fix):
   *    the per-message RBAC principal resolved by the bootstrap for THIS sender.
   *    When provided, it is set on the turn's CapabilityContext (so an auto-policy
   *    capability invoked during the turn runs under the requester's RBAC — the
   *    Task-2 L2 gate is no longer a no-op on the primary path) AND carried onto
   *    any action the turn PARKS (so the approver authorizes as the requester, not
   *    the last chat sender). Identity-disabled → undefined → behavior unchanged.
   */
  (sessionId: string, text: string, mediaConnector?: PerTurnMediaConnector, detectedLang?: string, principal?: ResolvedPrincipal): Promise<string>;
  /** Release the warm persistent provider child (agentic mode). Best-effort. */
  dispose?(): Promise<void>;
}

/**
 * Build a responder: (sessionId, text) → agentic reply. Stateless/subscription
 * turns serialize per session. Agentic turns serialize globally because the
 * responder owns exactly one warm child; scope/session/revision changes rotate
 * that child before another turn may enter it.
 */
type PersistentProvider = ChatProviderAdapter & { exit?(): Promise<void> };

type BotMemoryAuthorityState =
  | BotMemoryReadAuthorityV1
  | Readonly<{ state: 'HOLD'; reasonCode: string; toolLabels: Readonly<BotMemoryToolLabelsV1> }>;

interface BotMemoryTurnV1 {
  readonly authority: BotMemoryAuthorityState;
  readonly grounding: BotMemoryGroundingV1;
  readonly promptLabels: Readonly<BotMemoryPromptLabelsV1>;
  readonly providerIdentity: string;
  readonly memorySessionId: string;
  readonly language: string;
}

function botIdentityDigest(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function botMemoryScope(root: string, principal: ResolvedPrincipal | undefined): MemoryReadScopeV1 {
  const projectId = attendedExecutionProjectId(root);
  return principal === undefined
    ? Object.freeze({ kind: 'local-project', projectId })
    : Object.freeze({ kind: 'tenant', tenantId: principal.tenantId, projectId });
}

function botMemoryPromptLabels(language: string): Readonly<BotMemoryPromptLabelsV1> {
  return Object.freeze({
    heading: getMessage('bot.memory.context.heading', language),
    guidance: getMessage('bot.memory.context.guidance', language),
    absent: getMessage('bot.memory.context.absent', language),
    hold: (reasonCode: string) => getMessage('bot.memory.context.hold', language, { reason: reasonCode }),
  });
}

function botMemoryToolLabels(language: string): Readonly<BotMemoryToolLabelsV1> {
  return Object.freeze({
    invalidRequest: getMessage('bot.memory.tool.invalid_request', language),
    absent: getMessage('bot.memory.context.absent', language),
    unavailable: (reasonCode: string) => getMessage('bot.memory.tool.unavailable', language, { reason: reasonCode }),
  });
}

function prepareBotMemoryTurn(
  root: string,
  sessionId: string,
  principal: ResolvedPrincipal | undefined,
  fallbackLanguage: string,
): BotMemoryTurnV1 {
  const scope = botMemoryScope(root, principal);
  const principalIdentity = principal === undefined ? null : Object.freeze({
    userId: principal.userId,
    role: principal.role,
    permissions: Object.freeze([...principal.permissions].sort()),
    tenantId: principal.tenantId,
    verified: principal.verified,
    source: principal.source,
  });
  const memorySessionId = `bot-memory-v1:${botIdentityDigest({ sessionId, scope, principal: principalIdentity })}`;
  let language = fallbackLanguage;
  let authority: BotMemoryAuthorityState;
  let grounding: BotMemoryGroundingV1;
  try {
    const config = resolveMemoryReadConfig(root, 'bot');
    language = config.language;
    authority = Object.freeze({
      root,
      scope,
      limits: config.memory_read,
      labels: buildMemoryReadLabels(getMessage, language),
      toolLabels: botMemoryToolLabels(language),
    });
    grounding = readBotMemoryGrounding(authority);
  } catch {
    authority = Object.freeze({
      state: 'HOLD',
      reasonCode: 'MEMORY_READ_CONFIG_UNAVAILABLE',
      toolLabels: botMemoryToolLabels(language),
    });
    grounding = Object.freeze({ state: 'HOLD', reasonCode: 'MEMORY_READ_CONFIG_UNAVAILABLE' });
  }
  const revision = grounding.state === 'HOLD' ? `hold:${grounding.reasonCode}` : grounding.revision;
  return Object.freeze({
    authority,
    grounding,
    promptLabels: botMemoryPromptLabels(language),
    providerIdentity: botIdentityDigest({
      sessionId,
      scope,
      principal: principalIdentity,
      revision,
      limits: 'state' in authority ? null : authority.limits,
      language,
    }),
    memorySessionId,
    language,
  });
}

export function makeChatResponder(deps: ChatResponderDeps = {}): ChatResponder {
  const chains = new Map<string, Promise<unknown>>();
  let agenticChain: Promise<unknown> = Promise.resolve();
  const lang = deps.lang ?? 'en';

  // Capability registry + config — built once per responder (flag-gated default-off).
  const capRegistry = createBuiltinRegistry();
  const capConfig = deps.capConfig ?? { enabled: false };

  // Agentic mode holds ONE warm persistent child across every turn (the whole
  // point — eliminates per-message cold-start); created lazily on first use.
  let persistent: PersistentProvider | undefined;
  let persistentIdentity: string | undefined;
  let externalProviderIdentity: string | undefined;
  let providerLifecycleBlocked = false;
  async function agenticProvider(turn: BotMemoryTurnV1, sessionId: string): Promise<ChatProviderAdapter> {
    if (providerLifecycleBlocked) throw new Error('BOT_PROVIDER_LIFECYCLE_HOLD');
    if (deps.provider) {
      if (externalProviderIdentity !== undefined && externalProviderIdentity !== turn.providerIdentity) {
        throw new Error('BOT_PROVIDER_SCOPE_ROTATION_UNAVAILABLE');
      }
      externalProviderIdentity = turn.providerIdentity;
      return deps.provider;
    }
    if (persistent && persistentIdentity !== turn.providerIdentity) {
      const prior = persistent;
      persistent = undefined;
      persistentIdentity = undefined;
      if (!prior.exit) {
        providerLifecycleBlocked = true;
        throw new Error('BOT_PROVIDER_SCOPE_ROTATION_UNAVAILABLE');
      }
      try {
        await prior.exit();
      } catch {
        providerLifecycleBlocked = true;
        throw new Error('BOT_PROVIDER_LIFECYCLE_HOLD');
      }
    }
    if (!persistent) {
      // Append capability catalog when enabled — bot learns which tools it may call.
      const basePrompt = buildBotSystemPrompt(turn.grounding, turn.promptLabels);
      const capCatalog = describeCapabilities(
        capRegistry,
        (id) => {
          const c = capRegistry.get(id);
          return c ? resolvePolicy(c, { chatKey: sessionId, config: capConfig, edition: 'solo' }) : 'unavailable';
        },
        turn.language,
      );
      const systemPrompt = capCatalog ? basePrompt + capCatalog : basePrompt;
      persistent = deps.persistentProviderFactory
        ? deps.persistentProviderFactory({ systemPrompt })
        : createPersistentClaudeSession({ systemPrompt });
      persistentIdentity = turn.providerIdentity;
    }
    return persistent;
  }

  async function runTurn(sessionId: string, text: string, perTurnMediaConnector?: PerTurnMediaConnector, principal?: ResolvedPrincipal): Promise<string> {
    const collected: string[] = [];

    // Provider + dispatcher differ by mode. Agentic: tool_use provider + GATED
    // dispatcher (the single safety chokepoint — model tool_use is otherwise
    // ungated by the loop). Slice 1: subscription (no tool_use) + deny-risky.
    let provider: ChatProviderAdapter;
    let dispatcher: McpToolDispatcher;
    let confirm: (action: AgenticAction) => Promise<boolean>;
    const memoryTurn = deps.root === undefined
      ? undefined
      : prepareBotMemoryTurn(deps.root, sessionId, principal, lang);

    if (deps.agentic) {
      if (!deps.root) throw new Error('chat-bridge: agentic mode requires `root` for the action store');
      const root = deps.root;
      try {
        provider = await agenticProvider(memoryTurn!, sessionId);
      } catch {
        provider = {
          async send() {
            throw new Error('BOT_PROVIDER_LIFECYCLE_HOLD');
          },
        };
      }
      const baseInner = deps.dispatcher ?? createCliToolDispatcher({ projectRoot: root });
      const inner = makeBotMemoryReadDispatcher(baseInner, memoryTurn!.authority);
      // Slice 1.1: build the media sink from the PER-TURN connector when provided,
      // falling back to the static dep, then to the no-media sentinel.
      // This ensures a chat-turn capability's media (e.g. screenshot → photo) is
      // delivered to the RIGHT connector for that specific chat turn.
      // When neither is available, the no-op sendText path produces honest text-fallback.
      const mediaConn = perTurnMediaConnector ?? deps.capConnector ?? { id: 'unknown' };
      const sendText = async (_channelId: string, _text: string): Promise<void> => {};
      const mediaSink = buildMediaSink(mediaConn, lang, sendText);
      const makeCapCtx = (channelId: string) => ({
        chatKey: channelId,
        project: root,
        lang,
        config: capConfig,
        now: Date.now(),
        platform: deps.capPlatform ?? detectPlatform(),
        spawn: deps.capSpawn ?? defaultSpawn,
        loadMailTransport: deps.capMailTransport ?? loadNodemailerTransport,
        ...(deps.artifacts !== undefined ? { artifacts: deps.artifacts } : {}),
        // Thread the per-message principal so an auto-policy capability invoked
        // DURING this chat turn runs under the requester's RBAC (Task-2 L2 gate).
        // Identity-disabled → principal undefined → fields omitted → gate no-op.
        ...(principal !== undefined ? { principal, tenantId: principal.tenantId } : {}),
      });
      // Bind sendApproval using the per-turn connector (same object used for media in
      // Slice 1.1). Cast to PerTurnConnector — the real connector has sendMessage; when
      // absent (no-media sentinel), makeSendApproval returns false and the dispatcher
      // falls back to the legacy "type approve <id>" text.
      const sendApprovalFn = makeSendApproval(mediaConn as PerTurnConnector, capRegistry, lang);
      // Tool-side buttoned approval (risky deckent_* tools). Same per-turn connector;
      // absent send surface → returns false → dispatcher falls back to legacy text.
      const sendToolApprovalFn = makeSendToolApproval(mediaConn as PerTurnConnector, lang);
      const capGate = {
        has: (id: string) => capRegistry.has(id),
        resolve: (id: string) => {
          const c = capRegistry.get(id);
          return c ? resolvePolicy(c, { chatKey: sessionId, config: capConfig, edition: 'solo' as const }) : 'unavailable' as const;
        },
        runAuto: (id: string, args: Record<string, unknown>) =>
          runCapability(capRegistry, id, args, makeCapCtx(sessionId), sessionId, mediaSink, 'auto'),
        sendApproval: async (id: string, capId: string, args: Record<string, unknown>): Promise<boolean> => {
          const mid = await sendApprovalFn(sessionId, id, capId, args);
          if (mid !== false && mid !== '') {
            // Real message id returned — store it on the parked action so the
            // resolver can edit the message on approve/reject (Task 4).
            attachApprovalMessageId(root, id, mid);
          }
          return mid !== false;
        },
      };
      dispatcher = makeGatedDispatcher({
        inner,
        park: (tool, args) =>
          parkBotAction(root, {
            tool,
            args,
            channelId: sessionId,
            // Bind the active sprint for destructive tools so a later approval
            // can't hit a different/later sprint (re-verified at execute time).
            ...(isSprintScopedDestructive(tool)
              ? { boundSprintId: getCurrentSprintId(root) ?? undefined }
              : {}),
            // Carry the requester's principal so a later approval authorizes as the
            // REQUESTER, not the last chat sender (confused-deputy fix). Identity-
            // disabled → principal undefined → omitted (parked action unchanged).
            ...(principal !== undefined ? { requesterPrincipal: principal } : {}),
          }),
        // Sprint 238 İŞ3: suppress the spurious "checkpoint awaiting approval"
        // alarm — a model-initiated deckent_checkpoint with nothing pending is a
        // no-op, not an approval gate.
        hasPendingCheckpoint: () => hasRealPendingCheckpoint(root),
        lang,
        capabilities: capGate,
        // Buttoned approval for risky deckent_* tools (group buttons). Mirrors
        // capGate.sendApproval: send → store the message id so the resolver can
        // edit it on approve/reject; return false → dispatcher uses legacy text.
        sendToolApproval: async (id: string, tool: string, args: Record<string, unknown>): Promise<boolean> => {
          const mid = await sendToolApprovalFn(sessionId, id, tool, args);
          if (mid !== false && mid !== '') attachApprovalMessageId(root, id, mid);
          return mid !== false;
        },
      });
      confirm = async () => true; // gating lives in the wrapper, not here
    } else {
      provider = deps.provider ?? defaultSubscriptionProvider();
      const inner = deps.dispatcher ?? createCliToolDispatcher(
        deps.root === undefined ? {} : { projectRoot: deps.root },
      );
      dispatcher = memoryTurn === undefined
        ? inner
        : makeBotMemoryReadDispatcher(inner, memoryTurn.authority);
      confirm = deps.confirm ?? denyRiskyConfirm;
    }

    const transcript = await runChatNativeLoop({
      provider,
      dispatcher,
      input: singleMessage(text),
      output: (line) => {
        if (line) {
          collected.push(line);
          deps.onPartial?.(sessionId, collected.join(''));
        }
      },
      // ADR-D-013 Option C (task 375-003): chat-native.ts now gates this
      // flag's dispatch through the command-registry risk class — 'Oku'
      // (status/history/recall) matches dispatch directly, no `confirm`
      // call. `deckent_plan` (the only Değiştir-tier NL tool) still calls
      // `confirm` exactly as before, so `denyRiskyConfirm` / the
      // gated-dispatcher wrapper's approve/deny behavior below is
      // unaffected — this connector's behavior is unchanged, it now simply
      // passes through the same shared gate as the CLI/TUI call-sites.
      agenticDispatch: true,
      agenticConfirm: confirm,
      gracefulErrors: true, // a provider failure becomes a tagged turn, not a throw
      maxTurns: deps.maxTurns ?? 1,
      maxToolHops: deps.maxToolHops ?? 6,
      ...(deps.memory
        ? { memory: deps.memory, sessionId: memoryTurn?.memorySessionId ?? sessionId, resumeLimit: deps.resumeLimit ?? 30 }
        : { sessionId: memoryTurn?.memorySessionId ?? sessionId }),
    });

    const streamed = collected.join('').trim();
    if (streamed) return streamed; // agenticDispatch result / streamed provider text
    return lastAssistantText(transcript);
  }

  const responder = ((sessionId: string, text: string, mediaConnector?: PerTurnMediaConnector, _detectedLang?: string, principal?: ResolvedPrincipal): Promise<string> => {
    if (deps.agentic) {
      const next = agenticChain
        .catch(() => undefined)
        .then(() => runTurn(sessionId, text, mediaConnector, principal));
      agenticChain = next.then(() => undefined, () => undefined);
      return next;
    }
    const prev = chains.get(sessionId) ?? Promise.resolve();
    const next = prev.catch(() => undefined).then(() => runTurn(sessionId, text, mediaConnector, principal));
    chains.set(
      sessionId,
      next.finally(() => {
        if (chains.get(sessionId) === next) chains.delete(sessionId);
      }),
    );
    return next;
  }) as ChatResponder;

  responder.dispose = async (): Promise<void> => {
    try {
      await agenticChain.catch(() => undefined);
      const prior = persistent;
      persistent = undefined;
      persistentIdentity = undefined;
      await prior?.exit?.();
    } catch {
      providerLifecycleBlocked = true;
      // best-effort — the child also dies with the host process
    }
  };

  return responder;
}

async function* singleMessage(text: string): AsyncIterable<string> {
  yield text;
}

function lastAssistantText(transcript: ReadonlyArray<{ role: string; content: string }>): string {
  for (let i = transcript.length - 1; i >= 0; i--) {
    const m = transcript[i];
    if (m && m.role === 'assistant' && m.content.trim().length > 0) return m.content.trim();
  }
  return '';
}

// chunkMessage now lives in the dependency-free message-format.ts so the notify
// hot-path can use it without loading this chat/LLM engine. Re-exported here for
// backward compatibility with existing importers.
export { chunkMessage } from './message-format.js';
