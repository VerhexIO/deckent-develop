// ═══ Ink REPL App (Sprint 224 — native TUI via React-for-CLI) ════════════════
//
// Why Ink: the hand-rolled raw-ANSI TUI could not deliver native feel (multi-line
// overwrite, broken queue, cursor drift). Ink's full-frame reconciler owns the
// render — completed turns live in <Static> (rendered once, scroll naturally),
// the streaming reply + a persistent status anchor live below, and the input is
// the LAST element so it is ALWAYS pinned at the bottom. claude-code uses the
// same base. Engine vs view: runChatNativeLoop stays the engine; this App drives
// it via an input iterator + output callback and renders the state. String-free:
// all user-facing labels arrive via props (getMessage resolved by the caller).

import { Box, Text, Static, useInput, useApp } from 'ink';
import { InkPaletteContext, useInkPalette } from './ink-palette-context.js';
import type { SessionAuthority } from './session-authority.js';
import type { InkPalette } from './ink-palette.js';
import { useState, useRef, useEffect, Component, type ReactElement, type ReactNode } from 'react';
import { homedir } from 'node:os';
import {
  runChatNativeLoop, type ChatProviderAdapter, type McpToolDispatcher, type ChatMemoryAdapter,
  buildNervousOutput, buildInterrogateOutput, resolveNativeSlashText,
} from '../commands/chat-native.js';
import { renderMarkdown } from '../commands/chat-render.js';
import { InputBar, type CaretStyle, type ShortcutsPanel } from './input-bar.js';
import { StatusRow } from './status-row.js';
import { resolveCtrlC, CTRL_C_EXIT_WINDOW_MS } from './interrupt-policy.js';
import { useTerminalColumns } from './use-terminal-columns.js';
import { expandAtRefs } from './at-ref.js';
import { resolveSlash, type SlashRegistry } from '../commands/chat-slash-registry.js';
import type { ChatMode } from '../commands/chat-mode.js';
import type { ReplEngine } from './native-agent-bridge.js';
import type { ProviderMessage } from '../../agent/provider-tooluse/types.js';
import { listLedgerSessions, readLedgerSession, type LedgerStoreOptions } from './session-ledger.js';
import type { ActiveSelection } from './provider-switch.js';
import { createStreamSegmenter, type StreamSegmenter } from './stream-segmenter.js';
import { measuredOnTurnEnd } from './native-elapsed.js';
import { buildLiveFooter, type LiveFooterLabels, type LiveFooterState } from '../helpers/live-footer.js';
import { initialTermModeState, parseTermCommand, applyModeTarget, TERM_MODES, ALLOWED_RISKS_BY_MODE, type TermMode, type TermModeState } from './term-mode.js';
import {
  gateAction, resolveShellLine, isDeniedShellOutput, pushShellNote, buildShellNotePrefix, renderTermGateDenied,
  type ShellNote, type TermGateDecision,
} from './term-gate.js';
import { renderCommandRisk } from '../helpers/risk-language.js';
import { PickerCard } from './picker-card.js';
import { resolvePickerGlyphs, pickerLinesFor, resolvePickerArg, pickerStateWord, type PickerKind, type PickerScope, type PickerSpec } from './picker.js';
import type { PickerLabels } from './picker-labels.js';
import { buildApprovalPickerSpec, buildTermPickerSpec, buildResumePickerSpec, buildConfigKeyPickerSpec, buildConfigValuePickerSpec, formatConfigValue, type ConfigKeyEntry } from './picker-specs.js';
import { APPROVAL_MODES, type ApprovalMode } from '../../agent/permission-types.js';
import { createChatTurnQueue, type ChatTurnQueue, type ChatTurnBgEvent, type ChatTurnPayload } from './chat-turn-queue.js';
import { createInputQueue, type InputQueue } from './input-queue.js';
import { listRecentSessions, pickSession, type SessionRecord } from '../helpers/session-resume.js';
import {
  initialBusyControlsState, markBusy, markIdle, parseBusyCommand,
  resolveQueueCommand, applyInterrupt, applySteer,
  type BusyControlsState, type QueueStatusDecision, type InterruptDecision, type SteerDecision,
} from './busy-controls.js';
import { ApprovalCard, createApprovalCardQueue, type ApprovalCardLabels, type ApprovalCardQueue } from './approval-card.js';
import { composeDualStream } from './dual-stream.js';
import type { ApprovalTerminalChannel } from './approval-terminal-channel.js';
import type { ApprovalStreamEvent } from '../../core/approval-eventstream.js';
import { PlanPreviewCard, type PlanPreviewCardLabels } from './plan-preview-card.js';
import { InboxCard } from './inbox-card.js';
import { requireInjectedLabel } from '../helpers/injected-label.js';
import type { InboxRow, InboxLabels, InboxDecisionVerb } from './run-flow-inbox.js';
import type { RunFlowContext, PlanPreview } from '../../core/run-flow-contract.js';
import type { RunFlowController } from './run-flow-controller.js';
import { RunFlowProviderHoldError, type RunFlowProviderHoldDetails } from './run-flow-controller.js';

export type ConfirmAnswer = 'y' | 'a' | 'n';
// toolName is optional: the dispatcher passes it so an 'a' (always) decision can
// be applied to the SAME-tool remainder still waiting in the confirm queue. The
// ALWAYS-confirm tier (kill/cleanup) omits it on purpose (never auto-applies 'a').
export type ConfirmTrigger = (summary: string, toolName?: string) => Promise<ConfirmAnswer>;

/** One queued confirm request — its prompt, the tool it gates, and its resolver. */
export interface ConfirmRequest {
  summary: string;
  toolName?: string;
  /** TERMINAL-TOOLS-013 — a one-time card (the operator's own `!` shell line):
   *  no "always" option, an 'a' answer resolves as 'y', never cascades and
   *  never reaches the allow-list. §4: "A longer grant is a separate governed flow." */
  oneTime?: boolean;
  resolve: (answer: ConfirmAnswer) => void;
}

/** The confirm card to render now (queue head) + its position within the burst. */
export interface ConfirmHead {
  summary: string;
  index: number;   // 1-based position of this card within the active burst
  total: number;   // total cards in the active burst (grows if more arrive mid-burst)
  oneTime: boolean;
}

/** FIFO confirm queue (view-layer authority). */
export interface ConfirmQueue {
  /** Enqueue a request. A pending head is NEVER overwritten — the new one waits. */
  enqueue(req: ConfirmRequest): void;
  /** Answer the current head; advance to the next. Deny does NOT cancel the rest. */
  answer(answer: ConfirmAnswer): void;
  /** The card to show now, or null when the queue is empty. */
  head(): ConfirmHead | null;
  /** Pending count (including the shown head). */
  size(): number;
}

/**
 * Pure FIFO confirm queue — the fix for the H1 single-slot fragility
 * (docs/reviews/sprint-285/repl-tool-root-cause.md). The engine dispatches tool
 * calls sequentially (chat-native.ts for…of await), so in practice one confirm
 * is pending at a time; but a re-entrant/concurrent trigger used to OVERWRITE the
 * single resolver slot and orphan the first request. A queue makes both the
 * sequential and the concurrent path safe: every request is shown in arrival
 * order, none is dropped.
 *
 * String-free (i18n-first): holds no user-facing text of its own; the caller
 * passes the localized `summary`. `onChange` re-renders the head (React setState).
 */
export function createConfirmQueue(onChange: () => void): ConfirmQueue {
  const pending: ConfirmRequest[] = [];
  let answered = 0; // answered so far in the current burst (drives the [i/N] index)

  const head = (): ConfirmHead | null => {
    const h = pending[0];
    if (!h) return null;
    return { summary: h.summary, index: answered + 1, total: answered + pending.length, oneTime: h.oneTime === true };
  };

  const enqueue = (req: ConfirmRequest): void => {
    pending.push(req); // never overwrite a pending head — append and wait its turn
    onChange();
  };

  const answer = (a: ConfirmAnswer): void => {
    const current = pending.shift();
    if (!current) return;
    answered += 1;
    // TERMINAL-TOOLS-013 — a one-time card cannot grant: 'a' collapses to 'y'.
    const effective: ConfirmAnswer = a === 'a' && current.oneTime ? 'y' : a;
    current.resolve(effective);
    // "always" applies to the same-tool remainder: queued requests for the SAME
    // tool already cleared run.tsx's perms gate and won't re-check it, so resolve
    // them here with the same allow decision (claude-code "always allow" feel).
    if (effective === 'a' && current.toolName) {
      for (let i = pending.length - 1; i >= 0; i--) {
        if (pending[i]!.toolName === current.toolName) {
          const [same] = pending.splice(i, 1);
          answered += 1;
          same!.resolve('a');
        }
      }
    }
    if (pending.length === 0) answered = 0; // burst drained → reset the counter
    onChange();
  };

  return { enqueue, answer, head, size: () => pending.length };
}

/**
 * REPL-SURFACE-WIRE (354-001) — pure, testable helpers.
 *
 * app.tsx is a mounted Ink component (no ink-testing-library dependency in
 * this repo — see tests/cli/repl-tool-multi-tag-repro.test.ts, sprint 285 —
 * so it cannot be rendered in tests). Decision logic that a follow-up test
 * needs to exercise is pulled out as plain, JSX-free exports, same pattern as
 * `createConfirmQueue` above.
 */

/** Resolve the mode-indicator label (Ask/Run/Control) from the injected set
 * (run.tsx `tui.mode_*`). TERMINAL-TOOLS-002: no English fallback — a missing
 * injection is a typed InjectedLabelMissingError (REPL error boundary). */
export function resolveModeLabel(mode: TermMode, labels: Pick<ReplLabels, 'modeAsk' | 'modeRun' | 'modeControl'>): string {
  if (mode === 'ask') return requireInjectedLabel('modeAsk', labels.modeAsk);
  if (mode === 'run') return requireInjectedLabel('modeRun', labels.modeRun);
  return requireInjectedLabel('modeControl', labels.modeControl);
}

/** Map drained ChatTurnPayloads (ChatTurnQueue.drainAsTurns()) to the flat
 * turn-text format the 'bg' Turn role renders — one string per payload. */
export function bgPayloadsToTurnTexts(payloads: readonly ChatTurnPayload[]): string[] {
  return payloads.map((p) => p.events.map((e) => e.summary).join('\n'));
}

/**
 * TERM5-UI (sprint-427, task 6) — drains a flowId-correlated `ChatTurnBgEvent`
 * through the SAME `ChatTurnQueue` every generic bg-turn already flows
 * through (`enqueueCorrelatedResult`, chat-turn-queue.ts), returning the
 * turn-text(s) to push right away. `enqueueCorrelatedResult` produces
 * immediately while idle ("idle REPL uyanır", per its own doc comment) or
 * returns `[]` while a turn is in flight — the event stays buffered and
 * surfaces later through the EXISTING turn-end `drainAsTurns()` drain,
 * unchanged. `enabled=true`: the caller (run.tsx) already gates registration
 * of the sink that calls this on `runFlowController`'s own presence. Pure
 * aside from the injected `queue` — same "pull decision logic out of the Ink
 * component" pattern as {@link bgPayloadsToTurnTexts} above (ink-testing-
 * library is not a project dependency).
 */
export function drainRunFlowResultTurns(queue: ChatTurnQueue, event: ChatTurnBgEvent): string[] {
  return bgPayloadsToTurnTexts(queue.enqueueCorrelatedResult(event, true));
}

/**
 * APP-SURFACE-WIRE (358-006) — pure, testable helpers for the startup
 * resume-teaser, the /resume picker (session-resume.ts), and the busy-controls
 * state machine (busy-controls.ts). Same "pull decision logic out of the Ink
 * component" pattern as the 354-001/355-011 blocks above (ink-testing-library
 * is not a project dependency — tests/cli/repl/app-surface-wire.test.tsx).
 */

/** Session entries the teaser/picker shows (both the startup teaser and the
 * bare-`/resume` list). One shared limit keeps the teaser numbering and the
 * picker numbering aligned, so "/resume 2" always picks the teaser's row 2. */
export const RESUME_RECENT_LIMIT = 5;

/** Minimal structural shape of ChatMemoryAdapter.listChatSessions results. */
interface ChatSessionSummaryLike { sessionId: string; lastAt: string; preview: string }

/** Map memory-backed chat sessions into the picker's SessionRecord shape so
 * pickSession can resolve over ONE combined list (disk sprint sessions first,
 * chat sessions after — the merge with the pre-existing loop-side /resume). */
export function chatSessionsToRecords(summaries: readonly ChatSessionSummaryLike[]): SessionRecord[] {
  return summaries.map((s) => ({
    id: s.sessionId,
    title: s.preview.length > 0 ? s.preview : s.sessionId,
    date: s.lastAt,
    status: 'chat',
  }));
}

/** Merge every resumable source into one picker namespace. Ledger entries are
 * authoritative on id collisions; legacy memory and sprint-job projections
 * remain readable without migrating or deleting either source. */
export function mergeResumeSessionRecords(
  disk: readonly SessionRecord[],
  ledger: readonly SessionRecord[],
  legacy: readonly SessionRecord[],
): { disk: SessionRecord[]; resumable: SessionRecord[] } {
  const ledgerIds = new Set(ledger.map((record) => record.id));
  const seen = new Set(ledgerIds);
  const resumable = [...ledger];
  for (const record of legacy) {
    if (seen.has(record.id)) continue;
    seen.add(record.id);
    resumable.push(record);
  }
  return {
    disk: disk.filter((record) => !ledgerIds.has(record.id) && !seen.has(record.id)),
    resumable,
  };
}

export interface NativeResumeResult {
  source: 'ledger' | 'legacy' | 'missing';
  messages: ProviderMessage[];
  turnCount: number;
  outputTokens: number;
}

/** Ledger-first native re-hydration with an in-place legacy dual-read fallback. */
export function hydrateNativeResume(
  sessionId: string,
  cwd: string,
  engine: Pick<ReplEngine, 'hydrateTranscript'>,
  memory?: Pick<ChatMemoryAdapter, 'getChatHistory'>,
  ledgerOptions: LedgerStoreOptions = {},
): NativeResumeResult {
  const ledger = readLedgerSession(sessionId, { ...ledgerOptions, cwd });
  if (ledger.turnCount > 0) {
    // 564-004 hand-completion — the ledger's on-disk row count continues the
    // bridge recorder's turn numbering, so post-resume rows never restart at 0
    // and collide with the rows just hydrated. The legacy branch below stays
    // offset-free on purpose: its session has no ledger rows yet, and turnCount
    // there counts user messages, not ledger lines.
    engine.hydrateTranscript?.(ledger.messages, { nextTurnIndex: ledger.turnCount });
    return {
      source: 'ledger',
      messages: ledger.messages,
      turnCount: ledger.turnCount,
      outputTokens: ledger.totals.outputTokens,
    };
  }
  const messages = (memory?.getChatHistory(sessionId) ?? [])
    .filter((message): message is { role: 'user' | 'assistant'; content: string } =>
      (message.role === 'user' || message.role === 'assistant') && typeof message.content === 'string')
    .map((message): ProviderMessage => ({ role: message.role, content: message.content }));
  if (messages.length > 0) {
    engine.hydrateTranscript?.(messages);
    return {
      source: 'legacy',
      messages,
      turnCount: messages.filter((message) => message.role === 'user').length,
      outputTokens: 0,
    };
  }
  return { source: 'missing', messages: [], turnCount: 0, outputTokens: 0 };
}

/** Compact an ISO timestamp to `YYYY-MM-DD HH:MM`; falls back to the raw value
 * (same display rule as chat-resume.ts's private shortTime). */
function shortSessionTime(iso: string): string {
  const m = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/.exec(iso);
  return m ? `${m[1]} ${m[2]}` : iso;
}

/**
 * Render the teaser/picker lines for the combined session list. Returns []
 * when BOTH lists are empty — the caller renders NOTHING then (degrade-safe:
 * a fresh checkout with no `.deckent/runtime/jobs/` shows no teaser at all).
 * Numbering is continuous across disk→chat so one number-space serves
 * `/resume <n>` for every visible row.
 */
export function buildResumePickerLines(
  disk: readonly SessionRecord[],
  chat: readonly SessionRecord[],
  labels: Pick<ReplLabels, 'resumeHeader' | 'resumeHint'>,
): string[] {
  const combined = [...disk, ...chat];
  if (combined.length === 0) return [];
  const lines: string[] = [requireInjectedLabel('resumeHeader', labels.resumeHeader)];
  combined.forEach((s, i) => {
    lines.push(`  ${i + 1}. ${s.title} · ${s.status} · ${shortSessionTime(s.date)}`);
  });
  lines.push(requireInjectedLabel('resumeHint', labels.resumeHint));
  return lines;
}

/** What the App should do with a `/resume` input (decided pure, applied in JSX). */
export type ResumeCommandDecision =
  | { readonly kind: 'passthrough' }
  | { readonly kind: 'list'; readonly lines: string[] }
  | { readonly kind: 'switch'; readonly sessionId: string; readonly forwardToLoop: boolean; readonly line: string }
  | { readonly kind: 'reject'; readonly line: string };

/**
 * Resolve a `/resume` input against the local picker lists, MERGING with the
 * pre-existing loop-side /resume (chat-native.ts) instead of shadowing it:
 * - no local sessions at all → 'passthrough' (loop behavior byte-identical);
 * - bare `/resume` → 'list' (the numbered picker, teaser-aligned);
 * - resolved pick → 'switch' — a chat-session pick sets forwardToLoop so the
 *   caller loads the resolved id directly; it is never re-queued as a model
 *   turn. A sprint-session-only pick switches locally;
 * - unknown literal id → 'passthrough' (the loop may know it, e.g. an older
 *   chat session beyond the picker window);
 * - numeric out-of-range / ambiguous → 'reject' — forwarding a NUMBER would
 *   let the loop resolve it against a DIFFERENT list and silently resume the
 *   wrong session, so numbers never pass through.
 */
export function resolveResumeCommand(
  arg: string,
  disk: readonly SessionRecord[],
  chat: readonly SessionRecord[],
  labels: Pick<ReplLabels, 'resumeHeader' | 'resumeHint' | 'resumeSwitched' | 'resumeNotFound' | 'resumeAmbiguous'>,
): ResumeCommandDecision {
  const combined = [...disk, ...chat];
  if (combined.length === 0) return { kind: 'passthrough' };
  const trimmed = arg.trim();
  if (trimmed.length === 0) return { kind: 'list', lines: buildResumePickerLines(disk, chat, labels) };
  const picked = pickSession(trimmed, combined);
  if (picked.kind === 'found') {
    return {
      kind: 'switch',
      sessionId: picked.session.id,
      // Same-object check is safe: `combined` holds the caller's own records.
      forwardToLoop: chat.includes(picked.session),
      line: requireInjectedLabel('resumeSwitched', labels.resumeSwitched).replace('{id}', picked.session.id),
    };
  }
  if (picked.kind === 'ambiguous') {
    const ids = picked.matches.map((m) => m.id).join(' · ');
    return { kind: 'reject', line: requireInjectedLabel('resumeAmbiguous', labels.resumeAmbiguous).replace('{matches}', ids) };
  }
  if (/^\d+$/.test(trimmed)) {
    return { kind: 'reject', line: requireInjectedLabel('resumeNotFound', labels.resumeNotFound).replace('{arg}', trimmed) };
  }
  return { kind: 'passthrough' };
}

/** Map a busy-controls decision to its display line (labels injected by the
 * caller — run.tsx `tui.busy_*`; TERMINAL-TOOLS-002: no English defaults, a
 * missing injection throws the typed guard error). */
export function renderBusyDecision(
  decision: QueueStatusDecision | InterruptDecision | SteerDecision,
  labels: Pick<ReplLabels,
    'busyQueueStatus' | 'busyStateBusy' | 'busyStateIdle' | 'busyInterrupted' | 'busyInterruptUnavailable' |
    'busyInterruptIdle' | 'busyInterruptDup' | 'busySteerQueued' | 'busySteerIdle' | 'busySteerEmpty'>,
): string {
  const need = (field: keyof typeof labels): string => requireInjectedLabel(field, labels[field]);
  switch (decision.kind) {
    case 'queue-status': {
      const state = decision.busy ? need('busyStateBusy') : need('busyStateIdle');
      return need('busyQueueStatus')
        .replace('{count}', String(decision.pendingBackgroundBuckets))
        .replace('{state}', state);
    }
    case 'interrupted':
      // TERMINAL-TOOLS-008 — say what actually happened: a real abort, or only
      // cleared input because this engine has no abort seam.
      return decision.aborted ? need('busyInterrupted') : need('busyInterruptUnavailable');
    case 'interrupt-noop':
      return decision.reason === 'idle' ? need('busyInterruptIdle') : need('busyInterruptDup');
    case 'steer-queued':
      return need('busySteerQueued').replace('{position}', String(decision.position));
    case 'steer-noop':
      return decision.reason === 'idle' ? need('busySteerIdle') : need('busySteerEmpty');
  }
}

/** Turn-end steer drain → next-turn inputs: drained notes STEER the work, so
 * they jump ahead of the already-queued messages (FIFO among themselves).
 * Pure — the inputIter applies the result as its new pending queue. */
export function steerNotesToInputs(drained: readonly string[], pendingQueue: readonly string[]): string[] {
  return [...drained, ...pendingQueue];
}

/**
 * F11-016-STAB (360-009) — pure, testable stabilization helpers (same
 * "pull decision logic out of the Ink component" pattern as the 354-001 /
 * 355-011 / 358-006 blocks above — ink-testing-library is not a project
 * dependency, see tests/cli/repl/f11-016-stab.test.tsx).
 */

/**
 * Map a confirm-modal keypress to its ConfirmAnswer — or null when the key
 * must be IGNORED. The previous inline mapping treated EVERY key as deny
 * except lowercase y/a: an uppercase 'Y' (an emphatic approve) DENIED the
 * tool call, and stray navigation keys (arrows, Tab, mouse-wheel escape
 * sequences) or text typed for the input bar (inactive while the modal is
 * open) mowed down the whole confirm burst one card per keystroke. Only the
 * documented keys decide now: y/Y approve, a/A always-approve, n/N deny,
 * Enter/Esc deny (the hint's capital-N default — both already denied before,
 * behavior preserved); anything else keeps the card waiting.
 */
export function confirmKeyToAnswer(
  input: string,
  key: { return?: boolean; escape?: boolean; ctrl?: boolean; meta?: boolean },
  opts: { oneTime?: boolean } = {},
): ConfirmAnswer | null {
  if (key.return || key.escape) return 'n'; // default = deny (hint shows capital N)
  if (key.ctrl || key.meta) return null;    // shortcuts/sequences never decide a card
  const ch = input.toLowerCase();
  if (ch === 'y') return 'y';
  // TERMINAL-TOOLS-013 — a one-time card has no "always": the key is ignored.
  if (ch === 'a') return opts.oneTime ? null : 'a';
  if (ch === 'n') return 'n';
  return null; // arrows, Tab, stray/pasted text → card stays pending
}

/**
 * Build the turn(s) one completed reply segment appends: the '● deckent'
 * head exactly once per reply, then the segment. Pure — id/head bookkeeping
 * happens at the CALL site, never inside a React setState updater. The
 * previous pushSegment mutated the `headPushed`/`idRef` refs INSIDE the
 * updater; React may re-invoke an updater (batched renders), and an impure
 * one can duplicate or drop the head row. Same hazard removed from
 * pushTurn / the tool sink / the foot push (objects built before setTurns).
 */
export function buildSegmentTurns(
  headAlreadyPushed: boolean,
  nextId: number,
  markdown: string,
): { turns: Turn[]; nextId: number } {
  const turns: Turn[] = [];
  let id = nextId;
  if (!headAlreadyPushed) turns.push({ id: id++, role: 'head', text: '' });
  turns.push({ id: id++, role: 'seg', text: markdown });
  return { turns, nextId: id };
}

/** Code-point-safe queue-preview truncation. The old inline `q.slice(0, 60)`
 * counted UTF-16 code units and could bisect a surrogate pair (an emoji in a
 * queued message), leaving a lone surrogate that garbles the row. Slices
 * whole code points instead. TERMINAL-TOOLS-004: the caller derives `max`
 * from the live terminal width (queuePreviewCells) — 60 stays the default
 * for the pure helper's existing callers/tests. */
export function truncateQueuePreview(text: string, max = 60): string {
  const points = [...text];
  return points.length > max ? points.slice(0, max).join('') + '…' : text;
}

/** Queue-preview budget for a terminal width: the row prefix (`  ⋯ <label> N: `)
 *  keeps ~16 cells; never below 20 so a narrow terminal still shows something. */
export function queuePreviewCells(columns: number): number {
  return Math.max(20, Math.floor(columns) - 16);
}

/**
 * REPL-CLEAR-ANSI (389-002, born-530) — `clearScreen` used to only reset the
 * JS/Ink `turns` state; Ink's `<Static>` already flushed every prior turn
 * straight to the REAL terminal (write-once, never redrawn — that is what
 * "Static" means), so old lines survived on screen/scrollback even after the
 * JS state emptied. `\x1b[2J` erases the visible screen, `\x1b[3J` erases the
 * scrollback buffer (xterm extension, widely supported), `\x1b[H` homes the
 * cursor — the same combination Node's own `console.clear()` uses on a TTY.
 * Ink's OWN `instance.clear()` (node_modules/ink/build/ink.js) does NOT help
 * here — it only resets the dynamic-region log-update bookkeeping, never the
 * scrollback, and isn't reachable from inside this component anyway (only
 * exposed via the top-level `render()` return in run.tsx, out of this task's
 * write scope). A raw write is therefore the only option, and matches the
 * codebase's own existing precedent (run.tsx's alt-screen-enter write:
 * `process.stdout.write('\x1b[?1049h\x1b[2J\x1b[H')`).
 */
export const CLEAR_SCREEN_ANSI = '\x1b[2J\x1b[3J\x1b[H';

/** Minimal duck-typed stdout shape — lets tests pass a fake stream instead of
 *  a real TTY. */
export interface ClearableStdout { isTTY?: boolean; write(chunk: string): unknown; }

/** Write the real terminal clear-screen sequence. Guarded on `isTTY`: a
 *  piped/non-interactive stdout must never receive raw escape codes
 *  (ink-tui skill precedent — never assume an interactive terminal). */
export function writeClearScreenAnsi(stream: ClearableStdout = process.stdout): void {
  if (stream.isTTY) stream.write(CLEAR_SCREEN_ANSI);
}

/**
 * REPL-CLEAR-ANSI (389-002, born-530) — honest in-flight-stream cancel for
 * `/clear`. No mid-turn provider-abort seam exists anywhere in this codebase
 * (same documented gap the 358-006 interrupt comment above notes for
 * busy-controls.ts) — the turn that was streaming when `/clear` fired keeps
 * running against the real provider underneath; there is no seam here to
 * kill it. What CAN be honestly cancelled is the VIEW: `clearScreen` bumps a
 * clear-epoch, and every render callback a turn still reaches (`output`, the
 * tool sink) compares the epoch ITS turn started under against the CURRENT
 * one — a turn that started before the bump is stale from that point on, and
 * its remaining tokens/tool-results are silently dropped instead of being
 * drawn onto the just-cleared screen. A turn that starts fresh (post-clear)
 * stamps the new epoch and renders normally — "cancels what it CAN", same
 * precedent as the existing interrupt.
 */
export function isTurnLive(turnEpoch: number, clearEpoch: number): boolean {
  return turnEpoch === clearEpoch;
}

/**
 * APP-APPROVAL-WIRE (355-011) — pure, testable helpers for the ApprovalCard +
 * dual-stream wiring (same "pull decision logic out of the Ink component"
 * pattern as resolveModeLabel/bgPayloadsToTurnTexts above — ink-testing-library
 * is not a project dependency, see repl-surface-wire.test.tsx / approval-card.test.tsx).
 */

/**
 * born-697 (SURF-3 approval last-mile) — build the visible transcript line for a
 * terminal approve/deny. Pure + exported so it is testable without mounting Ink
 * (same "pull decision logic out of the component" seam as confirmKeyToAnswer /
 * buildSegmentTurns). `{summary}` is interpolated from the request; the templates
 * are the injected `approval.terminal.*` rows (run.tsx) — TERMINAL-TOOLS-002
 * removed the English fallbacks (typed guard error instead).
 */
export function formatApprovalClosure(
  decision: 'allow' | 'deny',
  summary: string,
  labels: Pick<ReplLabels, 'approvalApproved' | 'approvalRejected'>,
): string {
  const template = decision === 'allow'
    ? requireInjectedLabel('approvalApproved', labels.approvalApproved)
    : requireInjectedLabel('approvalRejected', labels.approvalRejected);
  return template.replace('{summary}', summary);
}

/** Sentinel used only to reserve dual-stream "approval wants space" priority
 * below — never rendered (filtered out before the footer maps to <Text>). */
const DUAL_STREAM_APPROVAL_PLACEHOLDER = '\u0000dual-stream-approval-placeholder';

/**
 * Compress the live-footer (status) region to its dual-stream-tested min-1-line
 * floor (composeDualStream, dual-stream.ts) while an approval is pending, so
 * ApprovalCard — rendered above it — never has to compete with it for space,
 * and the footer itself never fully disappears ("footer kaybolmaz"). No
 * pending approval -> `footerLines` returned unchanged (byte-identical to the
 * pre-355-011 footer render). `height=2` deliberately does not depend on the
 * real terminal size: only composeDualStream's min-1 FLOOR behavior is used
 * here (verified for any height >= 1 by dual-stream.test.ts), not its actual
 * row budget — ApprovalCard renders its own real Ink box separately.
 */
export function resolveFooterLines(footerLines: string[], hasPendingApproval: boolean): string[] {
  if (!hasPendingApproval) return footerLines;
  const composed = composeDualStream({
    statusLines: footerLines,
    approvalLines: [DUAL_STREAM_APPROVAL_PLACEHOLDER],
    width: 4096,
    height: 2,
  });
  return composed.filter((line) => line !== DUAL_STREAM_APPROVAL_PLACEHOLDER);
}

/**
 * born-508 (382-003): stdin-ownership mutex. Ink's `useInput` does not
 * "consume" an event — every ACTIVE hook in the tree receives the SAME
 * keypress. Before this fix, InputBar stayed active (`confirm === null`)
 * while an ApprovalCard was ALSO active (its own `head !== null`), so a
 * queued chat message containing a bare 'y' (e.g. "yes, that works") fed the
 * SAME keystroke to both — mapApprovalKey('y') === 'approve' could silently
 * approve a destructive tool call mid-typing. This truth table is the single
 * place that decides which of the three REPL stdin consumers (legacy confirm
 * modal, InputBar, ApprovalCard) may be active at once — exactly one, ever.
 * The confirm modal wins ties (it is the older, always-blocking gate; an
 * approval landing mid-modal must not starve it or the modal orphans).
 * Pure/JSX-free — same "pull decision logic out of the Ink component"
 * pattern as confirmKeyToAnswer/resolveModeLabel above (ink-testing-library
 * is not a project dependency; see tests/cli/approval-inputbar-mutex.test.tsx).
 */
export interface StdinOwner {
  confirmActive: boolean;
  inputBarActive: boolean;
  approvalCardActive: boolean;
}

export function resolveStdinOwner(confirmOpen: boolean, approvalPending: boolean): StdinOwner {
  return {
    confirmActive: confirmOpen,
    inputBarActive: !confirmOpen && !approvalPending,
    // ApprovalCard ANDs this with its own `head !== null` internally — the
    // gate here only needs to defer to a higher-priority open confirm modal.
    approvalCardActive: !confirmOpen,
  };
}

/**
 * TERM-FLOW-UNIFY Sprint-4 mount (426-002) — pure, testable helpers for
 * mounting run-flow-controller.ts's RunFlowController + plan-preview-card.tsx
 * into the REPL (same "pull decision logic out of the Ink component" pattern
 * as resolveStdinOwner/resolveFooterLines above — ink-testing-library is not
 * a project dependency, see tests/cli/run-flow-mount.test.ts). Deliberately
 * a FOURTH stdin consumer computed OUTSIDE resolveStdinOwner's own return
 * shape (not folded into `StdinOwner`) — tests/cli/approval-inputbar-mutex.test.tsx
 * (out of this task's write scope) asserts `resolveStdinOwner`'s exact 3-key
 * return via `toEqual`, so widening that shape would break an out-of-scope
 * test; the InputBar/PlanPreviewCard exclusion is instead ANDed in directly
 * at the two JSX call sites below.
 */

/** Derive the PlanPreviewCard's `preview` prop from the controller's live
 *  context — null whenever the flow is not AWAITING_APPROVAL (proposed-but-
 *  not-yet-previewed, approved, rejected, cancelled, …), so the card only
 *  ever shows a REAL, currently-actionable preview. */
export function deriveRunFlowPreview(ctx: RunFlowContext): PlanPreview | null {
  return ctx.state === 'AWAITING_APPROVAL' ? (ctx.preview ?? null) : null;
}

/** Whether PlanPreviewCard may own stdin this render — defers to the legacy
 *  confirm modal AND a genuinely pending ApprovalCard (both higher-priority,
 *  pre-existing stdin consumers), same precedence rule resolveStdinOwner
 *  documents for ApprovalCard vs. the confirm modal. */
export function resolveRunFlowCardActive(confirmOpen: boolean, approvalPending: boolean): boolean {
  return !confirmOpen && !approvalPending;
}

/** Whether the live InboxCard (SURF-3 D3a `/runs --follow`) may own stdin this
 *  render. It is the LOWEST-priority consumer — a view-only follow surface that
 *  defers to the confirm modal, a pending ApprovalCard, AND a pending
 *  PlanPreviewCard (runFlowPending). Same JSX-AND precedence pattern as
 *  resolveRunFlowCardActive; resolveStdinOwner's 3-key return is NOT extended. */
export function resolveInboxCardActive(confirmOpen: boolean, approvalPending: boolean, runFlowPending: boolean): boolean {
  return !confirmOpen && !approvalPending && !runFlowPending;
}

/** TERMINAL-PICKER-002 — the value picker is the LOWEST-priority stdin
 *  consumer: it defers to the confirm modal, ApprovalCard, PlanPreviewCard AND
 *  the inbox card. Same JSX-AND precedence pattern; `resolveStdinOwner`'s
 *  pinned 3-key shape is untouched. */
export function resolvePickerCardActive(confirmOpen: boolean, approvalPending: boolean, runFlowPending: boolean, inboxOpen: boolean): boolean {
  return !confirmOpen && !approvalPending && !runFlowPending && !inboxOpen;
}

/** TERMINAL-PICKER-005 — below 40 display columns a card cannot hold a row
 *  plus its facts (platform matrix): the same choices print as numbered
 *  transcript lines and a typed `<n|id>` selects. Pure. */
export const PICKER_CARD_MIN_COLUMNS = 40;
export function resolvePickerSurfaceMode(columns: number): 'card' | 'lines' {
  return columns >= PICKER_CARD_MIN_COLUMNS ? 'card' : 'lines';
}

/** TERMINAL-PICKER-002 — a BARE selection command opens the picker; a typed
 *  argument keeps the direct path byte-identical. Pure. */
export function resolvePickerRequest(trimmed: string): { kind: PickerKind } | null {
  const bare = trimmed.trim().toLowerCase();
  if (bare === '/model') return { kind: 'model' };
  if (bare === '/provider') return { kind: 'provider' };
  // TERMINAL-PICKER-003 — the session-only choices.
  if (bare === '/approve') return { kind: 'approve' };
  if (bare === '/term') return { kind: 'term' };
  if (bare === '/resume') return { kind: 'resume' };
  // TERMINAL-PICKER-004 — the settings menu (typed /config <sub> stays on the CLI bridge).
  if (bare === '/config') return { kind: 'config-key' };
  return null;
}

/** Localized labels for the approve/reject/error lines pushed to the
 *  transcript after a PlanPreviewCard decision (buildRunFlowMountLabels, run.tsx).
 *  `started`/`error` are `{jobId}`/`{error}` templates (same convention as
 *  ReplLabels' other templated fields, e.g. `resumeSwitched`). */
export interface RunFlowMountLabels {
  started: string;
  rejected: string;
  error: string;
}

/** The outcome of a PlanPreviewCard decision, after the controller's
 *  approve()/startApproved()/reject() calls have run (side effects already
 *  happened by the time this is built — this only formats the RESULT). */
export type RunFlowOutcome =
  | { readonly kind: 'started'; readonly jobId: string }
  | { readonly kind: 'rejected' }
  | { readonly kind: 'error'; readonly message: string };

export function formatRunFlowOutcomeLine(outcome: RunFlowOutcome, labels: RunFlowMountLabels): string {
  switch (outcome.kind) {
    case 'started':
      return labels.started.replace('{jobId}', outcome.jobId);
    case 'rejected':
      return labels.rejected;
    case 'error':
      return labels.error.replace('{error}', outcome.message);
  }
}

/** Localized labels for the two NON-run edges of the REPL `/do <goal>` slash
 *  (452-002 REPL-DO-SLASH-WIRE). `flagOff` = terminal.run_flow_v2 off (no
 *  controller mounted); `usage` = bare `/do` with no goal. Injected by run.tsx's
 *  `buildDoSlashLabels(t)` (required — TERMINAL-TOOLS-002 removed the English
 *  default object). The RUN edge carries no string of its own — it reuses the
 *  shared RunFlow chain (proposeRun → deriveRunFlowPreview → PlanPreviewCard),
 *  so this component stays string-free per the i18n-FIRST rule. */
export interface DoSlashLabels {
  flagOff: string;
  usage: string;
  /** 3331 — typed NO_PROVIDERS hold template ({model} {provider} {registered}). */
  noProviders: string;
}

/**
 * 3331 — localize a {@link RunFlowProviderHoldError} through the injected
 * `do.slash_no_providers` template (same `.replace('{…}')` precedent as
 * run.tsx's renew/compact labels). Pure; string-free beyond punctuation.
 */
export function formatDoSlashNoProviders(template: string, details: RunFlowProviderHoldDetails): string {
  return template
    .replace('{model}', details.model)
    .replace('{provider}', details.provider ?? '?')
    .replace('{registered}', details.registered.length > 0 ? details.registered.join(', ') : '—');
}

/** Dependency-injected effect seam for the REPL `/do <goal>` slash (452-002),
 *  extracted from handleSubmit so the wiring is unit-testable without mounting
 *  Ink (ink-testing-library is not a project dependency — same pure-helper
 *  extraction precedent as deriveRunFlowPreview/formatRunFlowOutcomeLine above,
 *  cited verbatim by app-surface-wire.test.tsx). */
export interface ReplDoSlashDeps {
  /** The SESSION's single RunFlowController (run.tsx `wireRunFlowMount`, boot-
   *  time) when terminal.run_flow_v2 is on; undefined → flag-off notice, no
   *  fs/planner side effect at all. */
  controller: RunFlowController | undefined;
  labels: DoSlashLabels;
  /** Push an informational transcript line (app.tsx → pushTurn('seg', …)). */
  emit: (text: string) => void;
  /** Sync the PlanPreviewCard from the controller's post-propose context — the
   *  SAME `setRunFlowPreview(deriveRunFlowPreview(ctx))` seam the native
   *  `deckent_propose_run` tool feeds (registerToolSink effect below). This one
   *  line is where `/do` joins the shared machinery: downstream PlanPreviewCard +
   *  handleRunFlowApprove/Reject is literally the same code the tool path uses. */
  setPreview: (preview: PlanPreview | null) => void;
  /** Report a controller error as a transcript line (formatRunFlowOutcomeLine). */
  reportError: (message: string) => void;
}

/**
 * Drive the REPL `/do <goal>` command through the SAME RunFlow chain CLI
 * `deckent do` and the native `deckent_propose_run` tool use — never a second
 * controller/approval implementation. Flag-off (no controller) → honest i18n
 * notice with ZERO fs/planner side effects. Empty goal → usage hint, guarded
 * BEFORE `proposeRun` so a bare `/do` never trips the controller's own
 * non-empty-string throw. Otherwise: proposeRun(goal) → deriveRunFlowPreview →
 * setPreview (→ PlanPreviewCard → approve/reject, all shared).
 *
 * Single-flow-per-instance (run-flow-controller.ts header: "COLLECTING →
 * PROPOSAL_READY is a one-way door"): a second `/do`, or a `/do` after the LLM
 * already proposed this session, surfaces the reducer's RunFlowTransitionError
 * through `reportError` rather than crashing the REPL — an Ink input callback
 * must never throw. That limit is inherited from the mandated controller reuse,
 * not introduced here.
 */
export async function runReplDoSlash(goal: string, deps: ReplDoSlashDeps): Promise<void> {
  if (!deps.controller) {
    deps.emit(deps.labels.flagOff);
    return;
  }
  const trimmed = goal.trim();
  if (trimmed.length === 0) {
    deps.emit(deps.labels.usage);
    return;
  }
  try {
    const ctx = await deps.controller.proposeRun(trimmed);
    deps.setPreview(deriveRunFlowPreview(ctx));
  } catch (err) {
    if (err instanceof RunFlowProviderHoldError) {
      deps.reportError(formatDoSlashNoProviders(deps.labels.noProviders, err.details));
      return;
    }
    deps.reportError(err instanceof Error ? err.message : String(err));
  }
}

/**
 * Tap one ApprovalTerminalChannel event stream: forwards every event to its
 * single downstream consumer (ApprovalCard's own `events` prop) UNCHANGED,
 * while also feeding a second, app.tsx-local queue purely so the App can
 * derive a `hasPendingApproval` boolean for dual-stream layout — WITHOUT a
 * second independent subscription (the channel's AsyncIterable is backed by
 * one single-consumer queue; two parallel `for await` readers would race and
 * split delivery between ApprovalCard and the App).
 */
export async function* tapApprovalEvents(
  source: AsyncIterable<ApprovalStreamEvent>,
  tracker: ApprovalCardQueue,
): AsyncGenerator<ApprovalStreamEvent> {
  for await (const event of source) {
    tracker.ingest(event);
    yield event;
  }
}

/** A completed tool action, rendered as a claude-code-style change block. The
 * caller (run.tsx) localizes `verb`/`note`; the App owns the colored layout. */
export interface ToolInfo {
  verb: string;       // localized, e.g. "dosya yazıldı"
  failed?: boolean;   // denied/cancelled/errored → render dim with ✗ (honest, no fake success)
  target: string;     // path / command
  added?: number;     // lines added → green
  removed?: number;   // lines removed → red
  note?: string;      // extra dim detail (e.g. truncated output)
}
export type ToolSink = (info: ToolInfo) => void;

/** Localized labels — injected by the caller (i18n-first; component is string-free). */
export interface ReplLabels {
  thinking: string;     // "düşünüyor…"
  generating: string;   // "üretiliyor…"
  ready: string;        // "hazır · sıra sende"
  queued: string;       // "kuyrukta"
  confirmHint: string;  // "(y = izin · a = hep izin · N = reddet)"
  /** TERMINAL-TOOLS-013 — hint for a one-time card (no "always"). */
  confirmHintOnce: string;
  /** TERMINAL-TOOLS-013 — status anchor while a card owns stdin ("input paused · …"). */
  inputPaused: string;
  confirmProgress: string; // "[{index}/{total}]" — per-card position (i18n template)
  menuHint: string;     // "↑↓ gez · Enter seç · Tab tamamla · Esc kapat"
  /** `/` menu scroll hints, `{n}` templates (tui.menu_more_above/below) —
   * TERMINAL-TOOLS-001; required: InputBar has no fallback text and throws a
   * typed InjectedLabelMissingError when they are absent. */
  menuMoreAbove: string; // "↑ {n} daha"
  menuMoreBelow: string; // "↓ {n} daha"
  switched: string;     // "geçildi"
  switchUsage: string;  // "kullanım: /model <ad> · /provider <ad>"
  approvalSet: string;  // "onay modu"
  approvalUsage: string;// "kullanım: /approve suggest|auto-edit|full-auto. aktif:"
  queueCleared: string; // "kuyruk temizlendi"
  cdTo: string;         // "dizin"
  cdFail: string;       // "dizin değiştirilemedi"
  /** Mode-indicator labels (Ask/Run/Control) — REPL-SURFACE-WIRE (354-001)
   * seam, wired to tui.mode_* by run.tsx. TERMINAL-TOOLS-002: every field
   * below is REQUIRED — the mechanism owns no English fallback; a missing
   * injection throws InjectedLabelMissingError (see helpers/injected-label.ts). */
  modeAsk: string;
  modeRun: string;
  modeControl: string;
  /** `/term` dispatch lines (term-mode.ts refactor — /ask·/run·/control retired).
   * `{mode}`/`{approval}` are i18n templates (same precedent as confirmProgress);
   * wired to tui.term_* keys by run.tsx. */
  termSwitched: string; // "terminal mode switched: {mode}"
  termStatus: string;   // "terminal mode: {mode} · write approval: {approval}"
  termUsage: string;    // "usage: /term ask|run|control — ..."
  /** APP-SURFACE-WIRE (358-006) — resume-teaser/picker + busy-controls labels
   * (tui.resume_picker_* / tui.busy_* keys, run.tsx). */
  resumeHeader: string;    // "Recent sessions"
  resumeHint: string;      // "Tip: /resume <number> to continue a session"
  resumeSwitched: string;  // "resumed: {id}"
  resumeNotFound: string;  // "session not found: {arg}"
  resumeAmbiguous: string; // "ambiguous — matches: {matches}"
  busyQueueStatus: string; // "queue: {count} background · {state}"
  busyStateBusy: string;   // "busy"
  busyStateIdle: string;   // "idle"
  busyInterrupted: string; // "interrupted — the provider stream was aborted"
  /** TERMINAL-TOOLS-008 — the honest line when this engine has no abort seam
   * (legacy loop): only pending input was cleared. */
  busyInterruptUnavailable: string;
  busyInterruptIdle: string; // "nothing running to interrupt"
  busyInterruptDup: string;  // "interrupt already requested"
  busySteerQueued: string;   // "steer note queued (#{position}) — applied at turn end"
  busySteerIdle: string;     // "nothing running to steer"
  busySteerEmpty: string;    // "usage: /steer <message>"
  /** REPL-TURN-EXCEPTION-SURFACE (387-003) — turn-loop exception label
   * (tui.turn_error, `{error}` template). */
  turnError: string; // "turn failed: {error}"
  /** REPL-MODEL-BUSY-GATE (388-001) — `/model`/`/provider` busy-reject warning
   * (tui.switch_busy, `{kind}` template). */
  switchBusy: string; // "cannot switch {kind} while a turn is in progress — wait for it to finish, or /interrupt first"
  /** born-697 (SURF-3 approval last-mile) — the visible closure line pushed to
   * the transcript when the user decides an approval on the terminal. `{summary}`
   * is the request summary (approval.terminal.* keys, run.tsx). Without these,
   * a terminal approve/deny silently retired the card with no confirmation of
   * what was decided. */
  approvalApproved: string; // "✅ Approved — {summary}"
  approvalRejected: string; // "✖ Rejected — {summary}"
  /** TERM-AT-REF (583/N2b) — localized hint under the InputBar's `@` path
   * menu (tui.atref_menu_hint; same injected-labels route as `menuHint`). */
  atMenuHint: string;
  /** TERMINAL-TOOLS-002 — the Ctrl-R reverse-history prompt of the composer
   * (tui.reverse_search). Was a readline-ism literal inside input-bar.tsx. */
  reverseSearch: string; // the Ctrl-R prompt text
  /** TERMINAL-TOOLS-006 — Ctrl-C policy hints (interrupt-policy.ts); each
   * names the next key, shown for the second-press window (tui.ctrl_c_*). */
  ctrlCDraftCleared: string; // "draft discarded · Ctrl-C again to exit"
  ctrlCInterrupt: string;    // "interrupt requested · Ctrl-C again to exit"
  ctrlCArm: string;          // "Ctrl-C again to exit"
  /** TERMINAL-TOOLS-011 — Ask/Run/Control gate denial (tui.term_gate_denied;
   * templates {target} {risk} {mode} {suggested}). */
  termGateDenied: string;
}

/** TERMINAL-TOOLS-003 — composer caret carrier (input-bar.tsx CaretStyle);
 *  run.tsx resolves 'marker' when theme.ts reports color suppression. */
export type { CaretStyle } from './input-bar.js';

/**
 * NATIVE-SLASH-BRIDGE (387-002) — resolve a slash line for the native-engine
 * REPL surface. `handleSubmit` below special-cases ~15 of the 37 SLASH_CATALOG
 * commands directly (exit/cancel/clear/term/queue/interrupt/steer/resume/cd/
 * model/provider/approve); when `nativeEngine` drives the turn (the default
 * REPL engine, M5-NATIVE-FLIP), every OTHER command — /help, /kill, /cleanup,
 * /recover, /nervous, /interrogate, /mcp, /sync, /checkpoint, /autonomous,
 * /audit, /usage, /resources, /directives, /status, /recall, /plan, /sprint,
 * /retro, /doctor, /models, /analyze, /review, /explain, /agents, /skills,
 * /features, /config — silently fell through to a PLAIN-TEXT chat turn
 * (born-493): the legacy loop (runChatNativeLoop, chat-native.ts) resolves
 * every one of these inside its OWN for-await loop, but the native engine
 * bypasses that loop entirely (this component drives its own turn-by-turn
 * dispatch), so none of chat-native.ts's slash handling ever ran.
 *
 * `/nervous` and `/interrogate` are resolved BEFORE calling resolveSlash —
 * the SAME precedence chat-native.ts's own loop uses (its early interception
 * runs before its own resolveSlash call) — because resolveSlash's OWN
 * `/nervous` branch needs an injected NervousPendingStore this bridge does
 * not have; the direct file-backed helpers (chat-nervous-bridge.ts, reused
 * via chat-native.ts's `buildNervousOutput`) give full accept/reject/list
 * behavior with zero extra wiring. `/resume` is NOT handled here — app.tsx
 * already has its own picker (`resolveResumeCommand`, task 358-006) higher up
 * in `handleSubmit`, unrelated to this bridge.
 *
 * Pure aside from the read-only file I/O inside the imported chat-native.ts
 * helpers (no React/Ink dependency) — the same "pull decision logic out of
 * the component" pattern as resolveResumeCommand/renderBusyDecision above.
 */
export type NativeSlashResult =
  | { kind: 'reply'; text: string }
  | { kind: 'dispatch'; tool: string; args: Record<string, unknown> }
  | { kind: 'passthrough' };

export function resolveNativeSlash(
  trimmed: string,
  ctx: { registry: SlashRegistry; cwd: string; lang: string; chatMode: ChatMode },
): NativeSlashResult {
  if (trimmed === '/nervous' || trimmed.startsWith('/nervous ')) {
    const args = trimmed.split(/\s+/).slice(1);
    return { kind: 'reply', text: buildNervousOutput(ctx.cwd, args, false, ctx.lang) };
  }
  if (trimmed === '/interrogate' || trimmed.startsWith('/interrogate ')) {
    return { kind: 'reply', text: buildInterrogateOutput(ctx.cwd, ctx.lang) };
  }
  const action = resolveSlash(trimmed, ctx.registry);
  if (action.action === 'agentic') return { kind: 'dispatch', tool: action.tool, args: action.args };
  if (action.action === 'help' || action.action === 'message' || action.action === 'show-directives') {
    return {
      kind: 'reply',
      text: resolveNativeSlashText(action, { chatMode: ctx.chatMode, lang: ctx.lang, directivesRoot: ctx.cwd }),
    };
  }
  // 'exit' / 'clear' (already handled earlier in handleSubmit before this
  // bridge runs) / 'nervous-list' / 'nervous-plan' (only ever returned when a
  // NervousPendingStore is passed to resolveSlash — this bridge doesn't pass
  // one, see doc comment above) / 'none' (unknown slash, or a meta-command
  // with no agenticTool like /model — /cd — /term, already handled earlier).
  return { kind: 'passthrough' };
}

/**
 * REPL-MODEL-BUSY-GATE (388-001) — decide whether a `/model`/`/provider`
 * switch may apply now. `handleSubmit`'s switch branch used to call `onSwitch`
 * unconditionally the instant the command was typed — INCLUDING while a turn
 * was streaming (`working === true`, set by `inputIter` for the FULL duration
 * of a turn on both the native-engine and legacy-loop paths). `onSwitch`
 * (run.tsx) splices the shared provider/model backend the in-flight turn is
 * still reading from — a TOCTOU race: the second half of a streaming/tool-
 * dispatching turn could end up served by a DIFFERENT backend than the half
 * that started it (corrupted-output/crash race, born-533). Gating on
 * `working` refuses the switch while busy instead of racing it — the current
 * turn finishes on the backend it started with, and the user re-issues the
 * command once idle (the same reject-not-silently-drop precedent as
 * `renderBusyDecision`'s interrupt-noop/steer-noop branches above). A bare
 * `/model`/`/provider` with no argument is a read-only status query (nothing
 * to splice) and is NOT gated by this function — the caller only invokes it
 * on the actual-switch path. Pure — same "pull decision logic out of the Ink
 * component" pattern as resolveStdinOwner/confirmKeyToAnswer above
 * (ink-testing-library is not a project dependency; see
 * tests/cli/repl-model-busy-gate.test.ts).
 */
export type SwitchGateDecision = { kind: 'apply' } | { kind: 'rejected'; line: string };

export function resolveSwitchGate(
  working: boolean,
  kind: 'model' | 'provider',
  labels: Pick<ReplLabels, 'switchBusy'>,
): SwitchGateDecision {
  if (!working) return { kind: 'apply' };
  const line = requireInjectedLabel('switchBusy', labels.switchBusy).replace('{kind}', kind);
  return { kind: 'rejected', line };
}

/**
 * REPL-TURN-EXCEPTION-SURFACE (387-003) — drive the native-engine turn loop
 * with per-turn exception isolation. Previously (app.tsx's `nativeEngine`
 * effect branch) a SINGLE line's exception — anything the engine call itself
 * throws (a bug inside the AgentSession tool loop, a `confirm`/`toolSink`
 * callback throwing, etc. — NOT the engine's own graceful 'error'/'notice'
 * AgentEvents, which native-agent-bridge.ts's `runTurn` already renders via
 * `output`) propagated straight out of the raw inline `for await` loop, past
 * the caller's `.catch(() => exit())`, and tore down the WHOLE REPL with zero
 * user-visible signal (read as a silent freeze — born-551). Catching it HERE,
 * inside the loop body, both (a) surfaces it via `onTurnError` instead of
 * vanishing and (b) lets the `for await` request its NEXT value from `lines`
 * — which resumes app.tsx's `inputIter` generator past its `yield`, running
 * the SAME turn-end cleanup (finalizeReply/markIdle/setWorking(false)) a
 * normal turn already gets, so the turn AFTER a crash is not stuck "working"
 * forever. Pure aside from the injected `engine`/`now` calls — same "pull
 * decision logic out of the Ink component" pattern as
 * tapApprovalEvents/buildSegmentTurns above (ink-testing-library is not a
 * project dependency; see tests/cli/repl-turn-exception.test.ts).
 */
export async function runNativeTurnLoop(
  lines: AsyncIterable<string>,
  engine: ReplEngine,
  cbs: {
    output: (text: string) => void;
    onTurnStats: (stats: { elapsedMs: number; tokens?: number }) => void;
    onTurnError: (message: string) => void;
    /**
     * REPL-575 K3 — chat persistence for the native engine. Called once per
     * completed turn with the user's input line and the assistant text that was
     * streamed to the screen. Absent → no persistence (byte-identical to the
     * pre-K3 loop). Without this the default engine never wrote turns to
     * memory.db, so `/resume` showed nothing for the just-had conversation.
     */
    persistTurn?: (userInput: string, assistantText: string) => void;
  },
  now: () => number = Date.now,
): Promise<void> {
  for await (const line of lines) {
    const startMs = now();
    // Accumulate the streamed assistant text so the completed turn can be
    // persisted (what the user saw == what /resume replays). A turn that only
    // ran tools with no visible text yields '' — still persist the user line so
    // the session is recoverable.
    let assistantText = '';
    const captureOutput = cbs.persistTurn
      ? (text: string) => { assistantText += text; cbs.output(text); }
      : cbs.output;
    try {
      await engine(line, { output: captureOutput, onTurnEnd: measuredOnTurnEnd(startMs, now, cbs.onTurnStats) });
      cbs.persistTurn?.(line, assistantText);
    } catch (err) {
      cbs.onTurnError(err instanceof Error ? err.message : String(err));
    }
  }
}

/** Format a turn-loop exception as the visible error line pushed into the
 * transcript. The `⚠ ` prefix is owned by this function (same prefix
 * ReplErrorBoundary below already uses for render errors) — kept OUT of the
 * label so the localized `tui.turn_error` row (run.tsx) is not forced to
 * embed a decorative glyph. `label` is the injected `{error}` template;
 * TERMINAL-TOOLS-002 removed the English fallback (typed guard error). */
export function formatTurnErrorLine(message: string, label: string): string {
  return `⚠ ${requireInjectedLabel('turnError', label).replace('{error}', message)}`;
}

/**
 * Error boundary — a render error in any child shows a one-line message instead
 * of crashing the whole REPL (enterprise robustness).
 *
 * i18n (269-003): the component is string-free — the caller injects the
 * localized `label` (getMessage('tui.render_error', lang)); English default.
 */
/**
 * String-free boundary (TERMINAL-TOOLS-001): `label` is a REQUIRED injected
 * catalog row (run.tsx `t('tui.render_error')`) — the mechanism owns no
 * English default any more. `describeError` (run.tsx buildReplErrorDescriber)
 * turns a typed error into the session-language catalog explanation; without
 * it the boundary prints the error's own `message` verbatim, which for typed
 * Deckent errors is a technical code, never authored prose.
 */
export interface ReplErrorBoundaryProps {
  children: ReactNode;
  label: string;
  describeError?: (err: Error) => string;
}

export class ReplErrorBoundary extends Component<ReplErrorBoundaryProps, { err: Error | null }> {
  state: { err: Error | null } = { err: null };
  // TERMINAL-READABILITY-001 — a class component reads the palette through
  // contextType (hooks are unavailable here); unmounted instances (tests
  // calling render() directly) have no context and paint plain text.
  static override contextType = InkPaletteContext;
  declare context: InkPalette | undefined;
  static getDerivedStateFromError(err: Error): { err: Error } { return { err }; }
  override render(): ReactNode {
    if (this.state.err) {
      const describe = this.props.describeError ?? ((err: Error): string => err.message);
      return <Text {...(this.context?.error ?? {})}>{`⚠ ${this.props.label}: ${describe(this.state.err)}`}</Text>;
    }
    return this.props.children;
  }
}

export interface ReplAppProps {
  provider: ChatProviderAdapter;
  dispatcher: McpToolDispatcher;
  labels: ReplLabels;
  providerName: string;
  cwd: string;
  registerConfirm: (trigger: ConfirmTrigger) => void;
  /** TERMINAL-TOOLS-011 — registers the Ask/Run/Control action gate run.tsx's
   * askConfirm consults BEFORE any approval-mode shortcut (allow-list,
   * auto-edit, full-auto): Ask is a real read-only posture on every path. The
   * gate prints the localized denial line itself and returns false. */
  registerActionGate?: (gate: (toolName: string, args: Record<string, unknown>) => boolean) => void;
  /** Register the sink the dispatcher calls to render a tool/change block. */
  registerToolSink: (sink: ToolSink) => void;
  /** Slash command catalog for the interactive `/` menu. */
  slashRegistry: SlashRegistry;
  /** Initial model/provider selection (shown in the status bar). */
  initialSelection: ActiveSelection;
  /** Switch model/provider; returns the resulting active selection. A present
   *  `switchError` means the switch was REFUSED (e.g. missing API key) — the
   *  previous selection stays live and the message is shown to the user
   *  instead of a false "switched" confirmation. */
  onSwitch: (sel: Partial<ActiveSelection>) => ActiveSelection & { switchError?: string };
  /** Set the agentic approval mode (suggest / auto-edit / full-auto). */
  onApprovalMode: (mode: 'suggest' | 'auto-edit' | 'full-auto') => void;
  /** SURF-3 multi-flow-inbox — renders the `/runs` command for the raw slash
   *  line: the list (bare `/runs`) or one flow's detail (`/runs <n>`). Injected
   *  by run.tsx (which owns projectRoot + i18n); absent → `/runs` falls through
   *  as a normal turn. */
  runInboxProvider?: (input: string) => string;
  /** SURF-3 D3a/D3b — returns the CURRENT structured rows for the live
   *  `/runs --follow` card (polled on an interval; the card renders + highlights
   *  them itself). Injected by run.tsx. Absent → `--follow` falls back to the
   *  static list. */
  inboxFollowFeed?: () => InboxRow[];
  /** SURF-3 D3b — localized labels for the live inbox card (row/detail render +
   *  nav footers). Injected by run.tsx (buildInboxLabels) — required. */
  inboxLabels: InboxLabels;
  /** TERMINAL-PICKER-002 — localized labels for the value picker (run.tsx
   *  buildPickerLabels) — required. */
  pickerLabels: PickerLabels;
  /** TERMINAL-PICKER-002 — spec builders per picker kind, evaluated on every
   *  open (policy/availability re-resolved). Absent → bare `/model` and
   *  `/provider` keep printing the usage/status line. Injected by run.tsx. */
  pickerSpecs?: Partial<Record<PickerKind, () => PickerSpec>>;
  /** TERMINAL-PICKER-002 — the "save as default" seam (run.tsx → setConfigValues
   *  with native_provider / native_model). Absent → only the session scope is
   *  offered. */
  saveDefault?: (kind: 'model' | 'provider', id: string) => { ok: true } | { ok: false; error: string };
  /** TERMINAL-PICKER-004 — CONFIG_METADATA entries with their current project
   *  values (run.tsx; provider keys widened to VALID_PROVIDERS). Absent → bare
   *  `/config` keeps the CLI-bridge path. */
  configEntries?: () => ConfigKeyEntry[];
  /** TERMINAL-PICKER-004 — writes one setting through setConfigValues (the
   *  same seam as `deckent config set`); the value is the picked option text. */
  saveConfigValue?: (key: string, value: string) => { ok: true } | { ok: false; error: string };
  /** TERMINAL-POSTURE-001 — the Ask/Run/Control posture the session starts in
   *  (run.tsx resolves `terminal.posture`; absent → the term-mode default). */
  initialTermMode?: TermMode;
  /** TERMINAL-READABILITY-002 — OSC 8 hyperlinks in rendered replies; run.tsx
   *  resolves it from the host evidence + `terminal.links` (default: off). */
  hyperlinks?: boolean;
  /** TERMINAL-PROVIDER-EVIDENCE-001 — the shared provider-evidence store:
   *  opening /model or /provider kicks a bounded refresh, and an open picker
   *  is rebuilt (same identity, cursor realigned) when evidence lands. */
  pickerEvidence?: {
    refresh: () => Promise<void>;
    subscribe: (listener: () => void) => () => void;
  };
  /** TERMINAL-SESSION-AUTHORITY-001 — the surface-independent posture +
   *  approval holder (run.tsx). The App mirrors its own state into it on
   *  every /term and /approve so both surfaces share one authority. */
  sessionAuthority?: SessionAuthority;
  /** TERMINAL-PICKER-002 — ASCII glyphs (dumb terminal / no UTF-8 locale). */
  pickerAscii?: boolean;
  /** TERMINAL-PICKER-002 — words-only rendering (NO_COLOR / suppression). */
  pickerNoColor?: boolean;
  /** SURF-6 — in-card decision executor for the live inbox card (approve /
   *  full-ahead / reject / start on the focused run's detail). Injected by
   *  run.tsx (shared decision service); absent → decision keys are inert. */
  inboxDecide?: (flowId: string, verb: InboxDecisionVerb) => string;
  /** Optional chat-memory adapter — persists turns and powers /resume. */
  memory?: ChatMemoryAdapter;
  /** Active chat session id (new turns append here; /resume switches it). */
  sessionId?: string;
  /** UI language for loop-emitted strings (/resume picker). */
  lang?: string;
  /** When set (native flag on), drives the turn INSTEAD of runChatNativeLoop. */
  nativeEngine?: ReplEngine;
  /** repl_surface.enabled config-flag seam (default-off). The caller (run.tsx)
   * resolves the real project-config flag and passes it here; absent/false →
   * this component renders byte-identical to the pre-354-001 App. */
  replSurfaceEnabled?: boolean;
  /** Live-footer state-feed seam (buildLiveFooter, helpers/live-footer.ts).
   * Polled on an interval while `replSurfaceEnabled` is true; the real
   * heartbeat/dashboard-state reader is Task 354-014 (STATE-FEED). */
  stateFeed?: () => LiveFooterState;
  /** Localized live-footer labels (run.tsx buildLiveFooterLabels, the
   * `live_footer.*` catalog rows) — required; live-footer.ts validates the
   * full set and owns no English default (TERMINAL-TOOLS-002). */
  liveFooterLabels: LiveFooterLabels;
  /** Registers the sink used to enqueue a background-completed event.
   * Buffered by ChatTurnQueue and drained as brand-new turn(s) at turn-end —
   * NEVER injected mid-turn (Hermes rule, chat-turn-queue.ts). */
  registerBgEventSink?: (enqueue: (event: ChatTurnBgEvent) => void) => void;
  /** APP-APPROVAL-WIRE (355-011) — `repl_surface.approvals ?? false` seam,
   * resolved by the caller (run.tsx) and INDEPENDENT of `replSurfaceEnabled`
   * (a different feature landed the same sprint). Absent/false -> ApprovalCard
   * never renders and the footer/layout stays byte-identical to the
   * pre-355-011 render. */
  approvalsEnabled?: boolean;
  /** The runtime-wide-ApprovalBroker terminal bridge (createApprovalTerminalChannel,
   * approval-terminal-channel.ts, Task 355-004) — its `events`/`decide` pass
   * straight through to <ApprovalCard>. Absent -> no card, regardless of
   * `approvalsEnabled` (nothing to subscribe to). */
  approvalChannel?: ApprovalTerminalChannel;
  /** Localized approval-card labels (run.tsx buildApprovalLabels, the
   * `approval_card.*` rows) — required; the mechanism owns no English set. */
  approvalLabels: ApprovalCardLabels;
  /**
   * TERM-FLOW-UNIFY Sprint-4 mount (426-002) — `terminal.run_flow_v2` seam
   * (run.tsx's `wireRunFlowMount`). Present only when the flag is on AND the
   * native engine is active; absent -> PlanPreviewCard never renders and the
   * InputBar/stdin-mutex render stays byte-identical to the pre-426-002 App.
   */
  runFlowController?: RunFlowController;
  /** Localized plan-preview card labels (run.tsx buildPlanPreviewCardLabels(lang))
   * — required regardless of whether a controller is mounted. */
  runFlowCardLabels: PlanPreviewCardLabels;
  /** Localized approve/reject/error transcript lines (run.tsx
   * buildRunFlowMountLabels(t), `runFlow.mount.*`) — required. */
  runFlowMountLabels: RunFlowMountLabels;
  /** 452-002 — labels for the `/do <goal>` slash's two non-run edges (flag-off
   * notice + bare-usage hint). Injected by run.tsx's buildDoSlashLabels(t) —
   * required. The run edge reuses `runFlowController` (no new string). */
  doSlashLabels: DoSlashLabels;
  /**
   * TERM5-UI (sprint-427, task 6) — registers the sink run.tsx's
   * `wireRunFlowResultWatch` feeds a flowId-correlated, already-localized
   * `ChatTurnBgEvent` (verdict-summary + flowId, `buildRunFlowResultEvent`)
   * into. Present only when `runFlowController` is present (same flag gate);
   * absent -> the ChatTurnQueue.enqueueCorrelatedResult path is never
   * reached, byte-identical to the pre-427-006 render.
   */
  registerRunFlowResultSink?: (enqueue: (event: ChatTurnBgEvent) => void) => void;
  /** TERM-AT-REF (583/N2b) — project-path candidates for the InputBar's `@`
   * fuzzy menu. Injected by run.tsx (cached walkProjectFiles lister, capped
   * ~2000 entries); absent → typing `@` never opens a menu (render
   * byte-identical to the pre-583/N2b App). */
  atRefPathProvider?: (prefix: string) => string[];
  /** TERM-AT-REF (583/N2b) — scope-guarded project-file reader (rel path →
   * content, `null` = missing/binary/out-of-scope) used to expand `@path`
   * tokens into the OUTBOUND prompt at the submit boundary (expandAtRefs,
   * at-ref.ts). Injected by run.tsx (createScopedAtRefReader — resolves under
   * the live cwd, rejects escapes incl. symlinks); absent → submitted lines
   * pass through byte-identical. */
  atRefReader?: (rel: string) => string | null;
  /** TERMINAL-TOOLS-003 — composer caret carrier; run.tsx passes 'marker'
   * when theme.ts reports color suppression (NO_COLOR / --no-color), so the
   * caret keeps a non-color carrier once Ink's inverse attribute is gone. */
  caretStyle: CaretStyle;
  /** TERMINAL-TOOLS-010 — catalog-built `?` shortcuts panel (run.tsx
   * buildShortcutsPanel); required so keyboard help is always discoverable. */
  shortcutsPanel: ShortcutsPanel;
}

const AT_REF_OUTPUT_RESERVE_TOKENS = 32_000;
const AT_REF_SAFETY_RESERVE_TOKENS = 16_000;
const AT_REF_CHARS_PER_TOKEN_UPPER_BOUND = 3;
const AT_REF_REMAINING_CONTEXT_SHARE = 0.5;

/**
 * Convert the live model's effective token window into a conservative @ref
 * inline budget. The provider admission gate remains authoritative: an absent
 * or throwing getter returns undefined, preserving the pre-budget inline path.
 */
export function deriveAtRefExpansionBudgetChars(
  getContextBudgetTokens: (() => number | undefined) | undefined,
  transcriptChars: number,
): number | undefined {
  if (!getContextBudgetTokens) return undefined;
  try {
    const contextTokens = getContextBudgetTokens();
    if (contextTokens === undefined || !Number.isFinite(contextTokens) || contextTokens <= 0) return undefined;
    const transcriptTokens = Math.ceil(Math.max(0, transcriptChars) / AT_REF_CHARS_PER_TOKEN_UPPER_BOUND);
    const remainingTokens = Math.max(
      0,
      Math.floor(contextTokens) - AT_REF_OUTPUT_RESERVE_TOKENS - AT_REF_SAFETY_RESERVE_TOKENS - transcriptTokens,
    );
    return Math.floor(remainingTokens * AT_REF_CHARS_PER_TOKEN_UPPER_BOUND * AT_REF_REMAINING_CONTEXT_SHARE);
  } catch {
    return undefined;
  }
}

/** TERMINAL-PICKER-003 — `/approve <mode>` built from the enum SSOT (no literals). */
const APPROVE_COMMAND_RE = new RegExp(`^\\/approve(?:\\s+(${APPROVAL_MODES.join('|')}))?$`, 'i');

interface TurnStats { elapsedMs: number; tokens?: number; }
// Streaming model: a reply is a 'head' (● deckent) then a series of 'seg' units
// (prose lines / finished code+table blocks) that flow into <Static> as they
// complete, then a 'foot' (⏱ stats). Each lands in scrollback immediately, so
// the user reads in real time and the dynamic region stays tiny (no drift).
// Exported for buildSegmentTurns' tests (360-009) — shape-only, no behavior.
export interface Turn { id: number; role: 'user' | 'head' | 'seg' | 'foot' | 'tool' | 'bg'; text: string; tool?: ToolInfo; stats?: TurnStats; }

// TERMINAL-READABILITY-001 — no color literal in the App: every color is a
// palette role (ink-palette-context) the host theme paints; emphasis is weight
// (bold) or the inverse focus role, secondary text is the muted role, and SGR
// dim is never emitted (VS Code halves it, light themes lose it).

/** Animated braille spinner (no extra dep). */
function Spinner(): ReactElement {
  const palette = useInkPalette();
  const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  const [i, setI] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setI((n) => (n + 1) % frames.length), 80);
    return () => clearInterval(id);
  }, []);
  return <Text {...palette.accent}>{frames[i]}</Text>;
}

function DeckentHeader(): ReactElement {
  const palette = useInkPalette();
  return <Text><Text {...palette.accent}>● </Text><Text bold>deckent</Text></Text>;
}

function TurnView({ turn, hyperlinks }: { turn: Turn; hyperlinks: boolean }): ReactElement {
  const palette = useInkPalette();
  if (turn.role === 'user') {
    return (
      <Box marginTop={1}>
        <Text {...palette.muted}>{'› '}</Text>
        <Text>{turn.text}</Text>
      </Box>
    );
  }
  if (turn.role === 'tool' && turn.tool) {
    const { verb, target, added, removed, note, failed } = turn.tool;
    const hasDelta = added !== undefined || removed !== undefined || note !== undefined;
    // Denied/errored action: honest "✗ verb target" with NO success delta —
    // never let a blocked write look like it landed (REPL-TOOL-DEBT-1).
    if (failed) {
      return (
        <Box marginTop={1}>
          <Text {...palette.muted}><Text {...palette.error}>✗ </Text>{verb}<Text {...palette.muted}> {target}</Text></Text>
        </Box>
      );
    }
    return (
      <Box flexDirection="column" marginTop={1}>
        <Text><Text {...palette.accent}>● </Text><Text bold>{verb}</Text><Text {...palette.muted}> {target}</Text></Text>
        {hasDelta && (
          <Text>
            {'  ⎿ '}
            {added !== undefined ? <Text {...palette.success}>+{added} </Text> : null}
            {removed !== undefined ? <Text {...palette.error}>-{removed} </Text> : null}
            {note !== undefined ? <Text {...palette.muted}>{note}</Text> : null}
          </Text>
        )}
      </Box>
    );
  }
  if (turn.role === 'head') return <Box marginTop={1}><DeckentHeader /></Box>;
  if (turn.role === 'bg') {
    // Background-completed-work turn (ChatTurnQueue.drainAsTurns()) — flows in
    // as its OWN new turn, never folded into an in-flight reply.
    return (
      <Box flexDirection="column" marginTop={1}>
        {turn.text.split('\n').map((line, i) => (
          <Text key={i} {...palette.muted}><Text {...palette.accent}>{'» '}</Text>{line}</Text>
        ))}
      </Box>
    );
  }
  if (turn.role === 'foot') {
    const s = turn.stats;
    return <Text {...palette.muted}>{`⏱ ${s ? (s.elapsedMs / 1000).toFixed(1) : '0'}s${s?.tokens ? ` · ${s.tokens} tok` : ''}`}</Text>;
  }
  // 'seg' — one completed reply line/block, rendered markdown, no margin (flows
  // directly under the head + previous segments).
  return <Text>{renderMarkdown(turn.text, true, { hyperlinks })}</Text>;
}

export function ReplApp(props: ReplAppProps): ReactElement {
  const palette = useInkPalette();
  const { provider, dispatcher, labels, registerConfirm, registerActionGate, registerToolSink, slashRegistry, initialSelection, onSwitch, onApprovalMode, memory, sessionId, lang, nativeEngine, replSurfaceEnabled = false, stateFeed, liveFooterLabels, registerBgEventSink, approvalsEnabled = false, approvalChannel, approvalLabels, runFlowController, runFlowCardLabels, runFlowMountLabels, doSlashLabels, registerRunFlowResultSink, runInboxProvider, inboxFollowFeed, inboxLabels, inboxDecide, atRefPathProvider, atRefReader, caretStyle, shortcutsPanel, pickerLabels, pickerSpecs, saveDefault, configEntries, saveConfigValue, initialTermMode, pickerAscii = false, pickerNoColor = false } = props;
  const { exit } = useApp();
  // TERMINAL-TOOLS-004 — live width for the status row + queue preview (reflows on resize).
  const columns = useTerminalColumns();
  const [selection, setSelection] = useState<ActiveSelection>(initialSelection);
  const [approval, setApproval] = useState<ApprovalMode>('suggest');
  const [cwd, setCwd] = useState(props.cwd);

  const [turns, setTurns] = useState<Turn[]>([]);
  const transcriptCharsRef = useRef(0);
  const [partial, setPartial] = useState(''); // in-progress (incomplete) reply line
  const [busy, setBusy] = useState(false);
  const [working, setWorking] = useState(false); // a turn is in progress (streaming)
  const [queued, setQueued] = useState<string[]>([]);
  const [confirm, setConfirm] = useState<ConfirmHead | null>(null);

  const [sessionTok, setSessionTok] = useState(0);
  const idRef = useRef(1);
  const lastStats = useRef<TurnStats | null>(null);
  // REPL-CLEAR-ANSI (389-002): clearEpoch bumps on every clearScreen() call;
  // turnEpoch stamps the epoch the CURRENTLY in-flight turn started under
  // (inputIter, at dequeue). isTurnLive compares the two — see its doc
  // comment above for the full "cancel what you can" rationale.
  const clearEpoch = useRef(0);
  const turnEpoch = useRef(0);
  const headPushed = useRef(false);       // ● deckent header emitted for this turn?
  const segmenter = useRef<StreamSegmenter | null>(null);
  // F11-016 (368-003 wire): the raw useRef<string[]> FIFO is replaced by the
  // pure input-queue core — same FIFO, plus the hardened contract (blank +
  // double-fire-Enter swallow, ESC clear resets the dup-guard). Lazy-init once,
  // mirroring the confirmQueue pattern below.
  const queue = useRef<InputQueue | null>(null);
  if (queue.current === null) queue.current = createInputQueue();
  const wake = useRef<(() => void) | null>(null);
  // FIFO confirm queue (replaces the single-slot resolver — H1 fix). Lazy-init
  // once; onChange mirrors the head into `confirm` state so React re-renders it.
  const confirmQueue = useRef<ConfirmQueue | null>(null);
  if (confirmQueue.current === null) {
    confirmQueue.current = createConfirmQueue(() => setConfirm(confirmQueue.current!.head()));
  }
  const started = useRef(false);

  // REPL-SURFACE-WIRE (354-001) seam state — inert unless replSurfaceEnabled;
  // when it stays false (the default) none of this affects the render output.
  // TERMINAL-POSTURE-001 — the boot posture comes from config (run.tsx
  // resolveConfiguredPosture over terminal.posture; default run).
  const [termMode, setTermMode] = useState<TermModeState>(initialTermModeState(initialTermMode));
  // TERMINAL-TOOLS-011 — the gate reads the LIVE mode from callbacks registered
  // once (confirm trigger, action gate), so mirror the state into a ref.
  const termModeRef = useRef<TermModeState>(termMode);
  termModeRef.current = termMode;
  /** `!` shell outputs waiting to ride ahead of the next prompt (bounded). */
  const shellNotesRef = useRef<ShellNote[]>([]);
  /** TERMINAL-TOOLS-013 — true only while the operator's own `!` line is being
   *  dispatched, so its confirm card is enqueued one-time (no "always" grant). */
  const shellConfirmRef = useRef(false);
  const denyLine = (gate: Extract<TermGateDecision, { kind: 'deny' }>, target: string): string =>
    renderTermGateDenied(gate, target, {
      template: labels.termGateDenied,
      riskLabel: (risk) => renderCommandRisk(risk, lang ?? 'en').label,
      modeLabel: (mode) => resolveModeLabel(mode, labels),
    });

  // TERMINAL-PICKER-002 — ONE apply path for a model/provider switch, shared by
  // the typed `/model <id>` branch and the picker's commit (no duplicated
  // logic). Returns true when the backend actually switched.
  const runSwitch = (kind: 'model' | 'provider', rawArg: string): boolean => {
    // TERMINAL-PICKER-005 — a number typed after a narrow-surface listing of
    // this kind selects that row (a blocked row is refused with its reason).
    let arg = rawArg;
    const listed = narrowPickerRef.current;
    if (/^\d+$/.test(rawArg) && listed?.kind === kind) {
      const hit = resolvePickerArg(rawArg, listed.spec.candidates);
      if (hit.kind !== 'found') { pushTurn('seg', pickerLabels.notFound.replace('{arg}', rawArg)); return false; }
      if (hit.candidate.state === 'blocked') { pushTurn('seg', pickerStateWord(hit.candidate, pickerLabels)); return false; }
      arg = hit.candidate.id;
    }
    // born-533 (388-001): refuse to splice the backend mid-turn — see
    // resolveSwitchGate's doc comment above.
    const gate = resolveSwitchGate(working, kind, labels);
    if (gate.kind === 'rejected') { pushTurn('seg', gate.line); return false; }
    const next = onSwitch(kind === 'model' ? { model: arg } : { provider: arg });
    if (next.switchError) {
      // Honest failure: selection (and status bar) stay on what actually
      // serves the turns — no false "switched" confirmation.
      pushTurn('seg', next.switchError);
      return false;
    }
    setSelection({ provider: next.provider, model: next.model });
    pushTurn('seg', `${labels.switched}: ${next.provider}${next.model ? ` · ${next.model}` : ''}`);
    return true;
  };

  // TERMINAL-PICKER-002 — the picker's commit: session switch first; the
  // `default` scope additionally pins the choice in the project config through
  // the injected seam. A failed default write never un-switches the session.
  // TERMINAL-PICKER-003 — the session-only apply closures, shared by the typed
  // forms (/approve <mode>, /term <mode>, /resume <n|id>) and the picker.
  const runApprove = (mode: ApprovalMode): void => {
    onApprovalMode(mode); setApproval(mode);
    props.sessionAuthority?.setApproval(mode);
    // born-493 (387-002) — also retarget the native AgentSession's OWN
    // permission engine (see ReplEngine.setApprovalMode doc comment,
    // native-agent-bridge.ts). No-op for the legacy engine (nativeEngine
    // undefined) or a test fake that doesn't attach the method.
    nativeEngine?.setApprovalMode?.(mode);
    pushTurn('seg', `${labels.approvalSet}: ${mode}`);
  };
  const runTerm = (target: TermMode): void => {
    const result = applyModeTarget(termModeRef.current, target);
    if (result.changed) setTermMode(result.state);
    props.sessionAuthority?.setPosture(target);
    pushTurn('seg', requireInjectedLabel('termSwitched', labels.termSwitched)
      .replace('{mode}', resolveModeLabel(result.state.mode, labels)));
  };
  /** The merged session list the typed /resume resolves against (disk jobs + ledger + memory). */
  const mergedResumeRecords = () => mergeResumeSessionRecords(
    recentSessions.current ?? [],
    chatSessionsToRecords(listLedgerSessions(RESUME_RECENT_LIMIT, { cwd: props.cwd })),
    chatSessionsToRecords(memory?.listChatSessions?.(RESUME_RECENT_LIMIT) ?? []),
  );
  /** Apply a resolved /resume decision — ONE path for the typed form and the picker. */
  const applyResumeDecision = (decision: ResumeCommandDecision): void => {
    if (decision.kind === 'passthrough') return;
    if (decision.kind === 'list') { pushTurn('bg', decision.lines.join('\n')); return; }
    if (decision.kind === 'reject') { pushTurn('seg', decision.line); return; }
    setActiveSessionId(decision.sessionId);
    activeSessionIdRef.current = decision.sessionId;
    if (decision.forwardToLoop) {
      if (nativeEngine?.hydrateTranscript) {
        const hydrated = hydrateNativeResume(decision.sessionId, props.cwd, nativeEngine, memory);
        setSessionTok(hydrated.outputTokens);
        pushTurn('seg', decision.line);
      } else {
        // Legacy engine retains its own command parser; native mode
        // never takes this branch and therefore never leaks /resume
        // into a provider turn.
        queue.current!.enqueue(`/resume ${decision.sessionId}`);
        setQueued([...queue.current!.snapshot()]);
        if (wake.current) { const w = wake.current; wake.current = null; w(); }
      }
    } else {
      // Sprint-session pick: switch the active session pointer locally
      // (deep context-load for sprint sessions is loop-side follow-up).
      pushTurn('seg', decision.line);
    }
  };

  /** Build the spec for a bare selection command, or null when nothing can be
   *  offered (no injected builder; /resume without sessions). */
  const buildPickerSpecFor = (kind: PickerKind): PickerSpec | null => {
    if (kind === 'model' || kind === 'provider') return pickerSpecs?.[kind]?.() ?? null;
    if (kind === 'approve') return buildApprovalPickerSpec(APPROVAL_MODES, approval, (m) => pickerLabels.approveFacts[m]);
    if (kind === 'term') {
      return buildTermPickerSpec(TERM_MODES, termModeRef.current.mode,
        (mode) => [...ALLOWED_RISKS_BY_MODE[mode]].map((risk) => renderCommandRisk(risk, lang ?? 'en').label).join(' · '),
        (mode) => resolveModeLabel(mode, labels));
    }
    if (kind === 'resume') {
      const merged = mergedResumeRecords();
      const records = [...merged.disk, ...merged.resumable];
      if (records.length === 0) return null;
      return buildResumePickerSpec(records, activeSessionIdRef.current ?? null, (r) => [r.status, shortSessionTime(r.date)]);
    }
    if (kind === 'config-key') {
      if (!configEntries) return null;
      return buildConfigKeyPickerSpec(configEntries(), (e) => [
        e.category,
        pickerLabels.configFacts.current.replace('{value}', formatConfigValue(e.current)),
        pickerLabels.configFacts.default.replace('{value}', formatConfigValue(e.defaultValue)),
      ]);
    }
    if (kind === 'config-value') {
      const entry = pickerConfigKey.current;
      if (!entry?.options) return null;
      return buildConfigValuePickerSpec(entry.key, entry.options, entry.current);
    }
    return null;
  };

  // TERMINAL-PICKER-002/003 — the picker's commit. model/provider: session
  // switch first; the `default` scope additionally pins the choice in the
  // project config through the injected seam (a failed write never
  // un-switches the session). approve/term/resume: the same apply closures
  // the typed forms use.
  const commitPicker = (kind: PickerKind, id: string, scope: PickerScope): void => {
    setPicker(null);
    if (kind === 'approve') { runApprove(id as ApprovalMode); return; }
    if (kind === 'term') { runTerm(id as TermMode); return; }
    if (kind === 'resume') {
      const merged = mergedResumeRecords();
      applyResumeDecision(resolveResumeCommand(id, merged.disk, merged.resumable, labels));
      return;
    }
    // TERMINAL-PICKER-004 — key stage → value stage for that key; value stage
    // → one write through the injected seam (the confirm scope decided apply).
    if (kind === 'config-key') {
      const entry = configEntries?.().find((e) => e.key === id) ?? null;
      pickerConfigKey.current = entry;
      const valueSpec = buildPickerSpecFor('config-value');
      if (valueSpec) setPicker({ kind: 'config-value', spec: valueSpec });
      return;
    }
    if (kind === 'config-value') {
      const entry = pickerConfigKey.current;
      pickerConfigKey.current = null;
      if (!entry || scope !== 'apply') return;
      if (!saveConfigValue) { pushTurn('seg', pickerLabels.configWriteFailed.replace('{error}', pickerLabels.seamMissing)); return; }
      const out = saveConfigValue(entry.key, id);
      pushTurn('seg', out.ok
        ? pickerLabels.committed.config.replace('{key}', entry.key).replace('{value}', id)
        : pickerLabels.configWriteFailed.replace('{error}', out.error));
      return;
    }
    if (kind !== 'model' && kind !== 'provider') return;
    if (!runSwitch(kind, id)) return;
    if (scope !== 'default') return;
    if (!saveDefault) { pushTurn('seg', pickerLabels.defaultWriteFailed.replace('{error}', pickerLabels.seamMissing)); return; }
    const out = saveDefault(kind, id);
    pushTurn('seg', out.ok
      ? pickerLabels.committed.default.replace('{value}', id)
      : pickerLabels.defaultWriteFailed.replace('{error}', out.error));
  };
  const [footerLines, setFooterLines] = useState<string[]>([]);
  const bgQueue = useRef<ChatTurnQueue | null>(null);
  if (bgQueue.current === null) bgQueue.current = createChatTurnQueue();

  // APP-SURFACE-WIRE (358-006) seam state — inert unless replSurfaceEnabled.
  // recentSessions: the disk sprint-session snapshot the teaser showed (picker
  // numbering must match it). activeSessionId: /resume switches it; shown in
  // the bottom bar when it differs from the launch session. busyCtl: the
  // /queue-/interrupt-/steer state machine (ref only — no render reads it
  // directly; decision lines re-render via pushTurn).
  const recentSessions = useRef<SessionRecord[] | null>(null);
  const [activeSessionId, setActiveSessionId] = useState<string | undefined>(sessionId);
  // Mirror activeSessionId into a ref: the native turn-loop lives in a useEffect
  // whose deps intentionally exclude activeSessionId (re-running it would restart
  // the loop), so its persist callback (REPL-575 K3) must read the CURRENT
  // session through this ref, not the stale closure value.
  const activeSessionIdRef = useRef<string | undefined>(sessionId);
  const busyCtl = useRef<BusyControlsState>(initialBusyControlsState());

  // APP-APPROVAL-WIRE (355-011) seam state — inert unless approvalsEnabled AND
  // an approvalChannel is supplied; independent of replSurfaceEnabled (a
  // different feature). approvalTracker is always created (a bare, never-fed
  // queue is inert) but approvalEvents — the tapped subscription ApprovalCard
  // actually reads from — is only ever created behind the flag, so a flag-off
  // render never subscribes to anything and stays byte-identical.
  const [approvalPending, setApprovalPending] = useState(false);
  const approvalTracker = useRef<ApprovalCardQueue | null>(null);
  if (approvalTracker.current === null) {
    approvalTracker.current = createApprovalCardQueue(() => setApprovalPending(approvalTracker.current!.head() !== null));
  }
  const approvalEvents = useRef<AsyncIterable<ApprovalStreamEvent> | null>(null);
  if (approvalsEnabled && approvalChannel && approvalEvents.current === null) {
    approvalEvents.current = tapApprovalEvents(approvalChannel.events, approvalTracker.current);
  }

  // TERM-FLOW-UNIFY Sprint-4 mount (426-002) seam state — inert unless
  // runFlowController is supplied (run.tsx's `terminal.run_flow_v2` gate).
  // Synced from the controller's own context (single source of truth) inside
  // the registerToolSink effect below, right after a completed tool call.
  const [runFlowPreview, setRunFlowPreview] = useState<PlanPreview | null>(null);
  const runFlowPending = runFlowPreview !== null;
  // SURF-3 D3a — the live `/runs --follow` inbox card is open (view-only,
  // Esc-close). Only mountable when a feed was injected (flag/wire on).
  const [inboxOpen, setInboxOpen] = useState(false);
  // TERMINAL-PICKER-002 — the open value picker (null = closed). Opened by a
  // bare selection command; closed by Esc / commit / interrupt.
  const [picker, setPicker] = useState<{ kind: PickerKind; spec: PickerSpec } | null>(null);
  // TERMINAL-PROVIDER-EVIDENCE-001 — when evidence lands while a model /
  // provider picker is open, rebuild its spec in place: the card keeps its
  // identity (key = kind) and realigns the cursor by candidate id.
  const pickerEvidence = props.pickerEvidence;
  const pickerRef = useRef(picker);
  pickerRef.current = picker;
  useEffect(() => {
    if (!pickerEvidence) return undefined;
    return pickerEvidence.subscribe(() => {
      const open = pickerRef.current;
      if (!open || (open.kind !== 'model' && open.kind !== 'provider')) return;
      const spec = buildPickerSpecFor(open.kind);
      if (spec) setPicker({ kind: open.kind, spec });
    });
  }, [pickerEvidence]);
  // TERMINAL-PICKER-004 — the setting chosen in the key stage; the value stage applies to it.
  const pickerConfigKey = useRef<ConfigKeyEntry | null>(null);
  // TERMINAL-PICKER-005 — the last numbered listing printed on a narrow
  // surface; a following typed `/model <n>` resolves its number against it.
  const narrowPickerRef = useRef<{ kind: PickerKind; spec: PickerSpec } | null>(null);

  // 360-009: turn objects are built BEFORE setTurns so every updater stays
  // pure (append-only) — React may re-invoke an updater, and the previous
  // inline `idRef.current++` / `headPushed.current` mutations inside it could
  // duplicate or drop rows (the '● deckent' head in particular).
  const pushTurn = (role: Turn['role'], text: string): void => {
    const turn: Turn = { id: idRef.current++, role, text };
    setTurns((t) => [...t, turn]);
  };

  useEffect(() => {
    transcriptCharsRef.current = turns.reduce((total, turn) => total + turn.text.length, 0);
  }, [turns]);

  // Push one completed reply segment (a line or a finished code/table block);
  // emit the '● deckent' head once per reply, before the first segment.
  const pushSegment = (markdown: string): void => {
    const built = buildSegmentTurns(headPushed.current, idRef.current, markdown);
    headPushed.current = true;
    idRef.current = built.nextId;
    setTurns((t) => [...t, ...built.turns]);
  };

  // F11-016-STAB (360-009): ONE clear routine for both clear surfaces (the
  // /clear command below + InputBar's Ctrl-L onClear — previously two drifting
  // inline copies). Also RECREATES the segmenter: the old instance still
  // buffered the pre-clear in-flight partial line / open block, so the very
  // next streamed token resurfaced pre-clear text onto the just-cleared screen
  // (output() renders `segmenter.partial()` verbatim).
  const clearScreen = (): void => {
    // 389-002 (born-530): a real terminal clear — <Static> already flushed
    // every prior turn permanently, so the JS-state reset below cannot erase
    // it on its own (see writeClearScreenAnsi's doc comment above).
    writeClearScreenAnsi();
    // Bump the clear-epoch so a still-streaming turn's remaining output is
    // recognized as stale by `output`/the tool sink and silently dropped
    // instead of drawing pre-clear content onto the just-cleared screen.
    clearEpoch.current += 1;
    setTurns([]); setPartial(''); headPushed.current = false;
    segmenter.current = createStreamSegmenter((seg) => pushSegment(seg.markdown));
  };

  useEffect(() => {
    // Enqueue instead of overwriting a single slot: N tool calls = N cards, asked
    // in arrival order. The promise resolves when the queue answers this request.
    registerConfirm((summary: string, toolName?: string) => new Promise<ConfirmAnswer>((resolve) => {
      // TERMINAL-TOOLS-011 — a model-proposed tool that the current terminal
      // mode does not allow is refused BEFORE a card is queued (Ask = read-only),
      // with the localized reason instead of a silent 'n'.
      if (toolName) {
        const gate = gateAction(termModeRef.current, { tool: toolName, args: {} });
        if (gate.kind === 'deny') { pushTurn('seg', denyLine(gate, toolName)); resolve('n'); return; }
      }
      confirmQueue.current!.enqueue({
        summary,
        resolve,
        ...(toolName ? { toolName } : {}),
        // TERMINAL-TOOLS-013 — the operator's own `!` line is a one-time
        // decision: no "always", nothing reaches the allow-list.
        oneTime: shellConfirmRef.current && toolName === 'deckent_bash',
      });
    }));
  }, [registerConfirm]);

  // TERMINAL-TOOLS-011 — the dispatcher-side gate (run.tsx askConfirm): same
  // ladder, same denial line, consulted before every approval-mode shortcut.
  useEffect(() => {
    registerActionGate?.((toolName, args) => {
      const gate = gateAction(termModeRef.current, { tool: toolName, args });
      if (gate.kind === 'deny') { pushTurn('seg', denyLine(gate, toolName)); return false; }
      return true;
    });
  }, [registerActionGate]);

  // Tool/change blocks: a completed tool action becomes a 'tool' turn in the
  // history (rendered as ● verb target / ⎿ +added -removed). Finalize any live
  // reply first so the block lands AFTER the text that requested it.
  useEffect(() => {
    registerToolSink((info: ToolInfo) => {
      // 389-002: a stale (pre-clear) turn's tool-result block must not land
      // on the just-cleared screen either — same epoch guard as `output`.
      if (!isTurnLive(turnEpoch.current, clearEpoch.current)) return;
      segmenter.current?.flush(); setPartial(''); // commit any in-flight reply first
      const turn: Turn = { id: idRef.current++, role: 'tool', text: '', tool: info };
      setTurns((t) => [...t, turn]); // pure updater — id consumed above (360-009)
      // TERM-FLOW-UNIFY Sprint-4 mount (426-002): a completed tool call may
      // have been `deckent_propose_run` (native-tool-registry.ts) — sync the
      // card's preview from the controller's OWN context (single source of
      // truth, no duplicate state) rather than special-casing the tool name.
      if (runFlowController) setRunFlowPreview(deriveRunFlowPreview(runFlowController.getContext()));
    });
  }, [registerToolSink, runFlowController]);

  // Live-footer state-feed seam: poll it while enabled (Task 354-014 wires the
  // real heartbeat/dashboard-state reader; this component only renders it).
  useEffect(() => {
    if (!replSurfaceEnabled || !stateFeed) { setFooterLines([]); return; }
    const tick = (): void => setFooterLines(buildLiveFooter(stateFeed(), { labels: liveFooterLabels }));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [replSurfaceEnabled, stateFeed, liveFooterLabels]);

  // Background-completed-work sink: buffered by ChatTurnQueue — never
  // injected mid-turn (drained only at turn-end, see inputIter below).
  useEffect(() => {
    if (!registerBgEventSink) return;
    registerBgEventSink((event) => bgQueue.current!.enqueueBg(event));
  }, [registerBgEventSink]);

  // TERM5-UI (sprint-427, task 6): flowId-correlated result-turn sink — unlike
  // the generic bg-event sink above, this drains IMMEDIATELY (drainRunFlowResultTurns
  // -> enqueueCorrelatedResult), so an idle REPL renders the rich verdict-summary
  // turn the moment it lands rather than waiting for the next user turn to end.
  useEffect(() => {
    if (!registerRunFlowResultSink) return;
    registerRunFlowResultSink((event) => {
      for (const text of drainRunFlowResultTurns(bgQueue.current!, event)) pushTurn('bg', text);
    });
  }, [registerRunFlowResultSink]);

  // APP-SURFACE-WIRE (358-006): startup resume-teaser. One disk read per mount
  // (listRecentSessions is degrade-safe: missing/unreadable jobs dir → []).
  // Renders NOTHING when the source is empty — the teaser only ever appears
  // when there are sessions to resume, and it flows into <Static> as a one-off
  // turn so it scrolls away naturally (render order untouched).
  useEffect(() => {
    if (!replSurfaceEnabled || recentSessions.current !== null) return;
    recentSessions.current = listRecentSessions(props.cwd, RESUME_RECENT_LIMIT);
    const merged = mergeResumeSessionRecords(
      recentSessions.current,
      chatSessionsToRecords(listLedgerSessions(RESUME_RECENT_LIMIT, { cwd: props.cwd })),
      chatSessionsToRecords(memory?.listChatSessions?.(RESUME_RECENT_LIMIT) ?? []),
    );
    const lines = buildResumePickerLines(merged.disk, merged.resumable, labels);
    if (lines.length > 0) pushTurn('bg', lines.join('\n'));
    // labels/props.cwd are mount-stable (run.tsx passes literals); the ref
    // guard makes this one-shot even if the deps ever re-fired.
  }, [replSurfaceEnabled]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    // One segmenter for the whole session: completed lines/blocks emit into
    // <Static> immediately (flow into scrollback, readable in real time, like
    // Claude Code); the dynamic region only ever holds the in-progress partial
    // line → no tall re-render, no drift.
    segmenter.current = createStreamSegmenter((seg) => pushSegment(seg.markdown));

    const finalizeReply = (): void => {
      segmenter.current?.flush();   // emit the trailing partial line / open block
      setPartial('');
      if (headPushed.current) {     // close the reply with a stats footer
        const stats = lastStats.current ?? undefined;
        lastStats.current = null;
        headPushed.current = false;
        const foot: Turn = { id: idRef.current++, role: 'foot', text: '', ...(stats ? { stats } : {}) };
        setTurns((t) => [...t, foot]); // pure updater — id consumed above (360-009)
      }
    };

    async function* inputIter(): AsyncGenerator<string> {
      for (;;) {
        while (queue.current!.size() > 0) {
          const line = queue.current!.dequeue() as string;
          setQueued([...queue.current!.snapshot()]);
          pushTurn('user', line);
          setWorking(true);
          // 389-002: stamp the epoch THIS turn is starting under — output()/
          // the tool sink compare against clearEpoch.current on every call, so
          // a /clear mid-turn only affects turns already in flight, never this
          // fresh one.
          turnEpoch.current = clearEpoch.current;
          // 358-006: busy-controls turn-start. Unconditional on purpose — with
          // the surface flag off nothing can feed the machine (commands fall
          // through to chat), so this stays invisible; gating would only add a
          // second code path to keep in sync.
          busyCtl.current = markBusy();
          if (replSurfaceEnabled) bgQueue.current!.userTurnActive = true;
          // TERM-AT-REF (583/N2b): expand `@path` tokens at the submit boundary —
          // the transcript above (pushTurn) keeps the RAW typed line; only the
          // OUTBOUND prompt carries the injected file contents (expandAtRefs:
          // ≤5 refs, 32KB/file cap, extras/unreadables noted in the prompt).
          // Slash lines are never expanded — they are commands, not chat prompts
          // (e.g. a forwarded `/resume <id>` must reach the loop verbatim).
          // Both engines (nativeEngine + runChatNativeLoop) consume THIS
          // iterator, so one seam covers both.
          const contextBudgetGetter = (nativeEngine as ReplEngine & {
            getContextBudgetTokens?: () => number | undefined;
          } | undefined)?.getContextBudgetTokens;
          const expansionBudgetChars = deriveAtRefExpansionBudgetChars(
            contextBudgetGetter,
            transcriptCharsRef.current + line.length,
          );
          const expanded = atRefReader && !line.startsWith('/')
            ? expandAtRefs(line, atRefReader, expansionBudgetChars === undefined ? {} : { expansionBudgetChars }).prompt
            : line;
          // TERMINAL-TOOLS-011 — pending `!` shell outputs ride ahead of this
          // prompt (chat turns only; a slash line is a command, not a prompt).
          const shellPrefix = line.startsWith('/') ? '' : buildShellNotePrefix(shellNotesRef.current);
          if (shellPrefix.length > 0) shellNotesRef.current = [];
          yield shellPrefix + expanded;
          finalizeReply(); // turn finished streaming → close it out
          // 358-006: turn-end steer drain (busy-controls markIdle) — the SAME
          // "never mid-turn" contract as the ChatTurnQueue drain below: notes
          // buffered while busy surface only now, re-queued ahead of pending
          // input so they steer the immediately-following turn.
          const turnEnd = markIdle(busyCtl.current);
          busyCtl.current = turnEnd.state;
          if (turnEnd.drainedSteerNotes.length > 0) {
            const merged = steerNotesToInputs(turnEnd.drainedSteerNotes, queue.current!.snapshot());
            queue.current!.clear();
            for (const steered of merged) queue.current!.enqueue(steered);
            setQueued([...queue.current!.snapshot()]);
          }
          if (replSurfaceEnabled) {
            bgQueue.current!.userTurnActive = false;
            // Drain buffered bg-completed work as brand-new turn(s) — never
            // injected mid-turn (Hermes rule; drainAsTurns() itself no-ops
            // while userTurnActive is true, so this can only fire post-turn).
            for (const text of bgPayloadsToTurnTexts(bgQueue.current!.drainAsTurns())) {
              pushTurn('bg', text);
            }
          }
          setWorking(false);
        }
        await new Promise<void>((r) => { wake.current = r; });
      }
    }

    const output = (text: string) => {
      // 389-002: a /clear fired since this turn started — drop its straggler
      // tokens instead of feeding them into the (fresh, post-clear) segmenter.
      if (!isTurnLive(turnEpoch.current, clearEpoch.current)) return;
      segmenter.current?.feed(text);
      setPartial(segmenter.current?.partial() ?? '');
    };
    const onTurnEnd = (s: { elapsedMs: number; usage?: { outputTokens?: number } }) => {
      const tokens = s.usage?.outputTokens;
      lastStats.current = { elapsedMs: s.elapsedMs, ...(tokens !== undefined ? { tokens } : {}) };
      if (tokens) setSessionTok((n) => n + tokens);
    };

    if (nativeEngine) {
      void runNativeTurnLoop(inputIter(), nativeEngine, {
        output,
        onTurnStats: (st) => {
          lastStats.current = { elapsedMs: st.elapsedMs, ...(st.tokens !== undefined ? { tokens: st.tokens } : {}) };
          const tok = st.tokens;
          if (tok) setSessionTok((n) => n + tok);
        },
        // 387-003: a per-turn exception no longer unwinds the whole loop —
        // flush any in-flight partial/segment first (finalizeReply, same as a
        // normal turn-end) so ordering stays correct, then surface the error
        // as a visible transcript line instead of silently exiting.
        onTurnError: (message) => {
          finalizeReply();
          pushTurn('seg', formatTurnErrorLine(message, labels.turnError));
        },
        // REPL-575 K3 — persist native turns so /resume can replay them. The
        // legacy engine (else-branch below) already passes memory/sessionId to
        // runChatNativeLoop; the native path dropped every turn on the floor.
        // Uses activeSessionIdRef so a mid-session /resume switch re-targets the
        // right session. Best-effort: a memory write failure must not kill the
        // turn loop.
        ...(memory ? {
          persistTurn: (userInput: string, assistantText: string) => {
            const target = activeSessionIdRef.current ?? sessionId;
            if (!target) return;
            try {
              memory.appendChatTurn(target, 'user', userInput);
              if (assistantText.length > 0) memory.appendChatTurn(target, 'assistant', assistantText);
            } catch { /* persistence is best-effort — never break the loop */ }
          },
        } : {}),
      }).then(() => exit()).catch(() => exit());
    } else {
      void runChatNativeLoop({
        provider,
        dispatcher,
        // The loop's built-in risky-confirm (requireConfirmIfRisky) uses readline,
        // which fights Ink's raw-mode stdin and hangs the REPL. In the Ink path,
        // confirmation is owned by the dispatcher gate (run.tsx classifyTool →
        // Ink confirm modal), so auto-approve here and let that single authority
        // ask. Read-only tools pass through; write/destructive ones still prompt.
        agenticConfirm: async () => true,
        // ADR-D-013 Option C (task 375-003): activates chat-native.ts's
        // natural-language → deckent_* tool classifier for this REPL too.
        // Its command-registry class-gate skips the `agenticConfirm` stub
        // above entirely for 'Oku' (read-only) matches; any other tier
        // still passes through the always-true stub here, same as the
        // slash-dispatch path a few lines up — its real gate is the SAME
        // dispatcher-level classifyTool check (run.tsx) already relied on.
        agenticDispatch: true,
        // Chat persistence + /resume: when a memory adapter is wired, every turn
        // is saved under sessionId and /resume can list/load prior sessions.
        ...(memory ? { memory } : {}),
        ...(sessionId ? { sessionId } : {}),
        ...(lang ? { lang } : {}),
        input: inputIter(),
        // Stream tokens straight through the segmenter: completed lines/blocks flow
        // into the scrollback immediately (real-time readable — Alperen: "yukarıya
        // yazdır, beklemeyelim"); the in-progress partial line shows live + small.
        output,
        thinkingIndicator: { start: () => setBusy(true), stop: () => setBusy(false) },
        interactiveTty: true,
        layoutEnabled: false,
        gracefulErrors: true,
        onTurnEnd,
      }).then(() => exit()).catch(() => exit());
    }
  }, [provider, dispatcher, exit, nativeEngine]);

  // 358-006 interrupt canceller (busy-controls Canceller seam): no mid-turn
  // provider-abort seam exists in runChatNativeLoop/nativeEngine yet, so
  // "interrupt" honestly cancels what it CAN — the not-yet-started queued
  // inputs (true mid-turn abort is loop-side follow-up work).
  const cancelPendingInputs = (): void => { queue.current!.clear(); setQueued([]); };
  // TERMINAL-TOOLS-008 — the interrupt canceller: clear the queue AND abort the
  // turn in flight (native engine → session.cancel → AbortController → the
  // provider stream is torn down now). Returns whether a real abort seam fired
  // so the transcript line stays honest — the legacy engine has none.
  const cancelActiveTurn = (): boolean => {
    cancelPendingInputs();
    return nativeEngine?.cancelTurn?.() ?? false;
  };

  const handleSubmit = async (line: string): Promise<void> => {
    const trimmed = line.trim();
    if (trimmed.length === 0) return;
    if (['/exit', '/quit', ':exit', ':quit'].includes(trimmed.toLowerCase())) { exit(); return; }
    // TERMINAL-TOOLS-011 — `!<cmd>` shell passthrough (parity: Claude Code /
    // Codex / Hermes). Gated by the Ask/Run/Control ladder (Çalıştır), then
    // by the SAME exec dispatcher every bash tool call uses (approval modes,
    // y/n card, cwd scope, timeouts). The output is shown here and, unless
    // denied, rides ahead of the NEXT prompt as a bounded [shell] note —
    // never injected as a fabricated transcript entry.
    const shellCmd = resolveShellLine(trimmed);
    if (shellCmd !== null) {
      pushTurn('user', trimmed);
      const gate = gateAction(termModeRef.current, { tool: 'deckent_bash', args: { cmd: shellCmd } });
      if (gate.kind === 'deny') { pushTurn('seg', denyLine(gate, trimmed)); return; }
      shellConfirmRef.current = true;
      const out = await dispatcher.dispatch('deckent_bash', { cmd: shellCmd }).finally(() => { shellConfirmRef.current = false; });
      // A denial already rendered its honest-outcome block (dim ✗ cancelled)
      // through the dispatcher's toolSink — never echo the raw marker.
      if (!isDeniedShellOutput(out)) {
        pushTurn('seg', out);
        shellNotesRef.current = pushShellNote(shellNotesRef.current, { cmd: shellCmd, output: out });
      }
      return;
    }
    // TERMINAL-PICKER-002/003 — a BARE selection command opens the interactive
    // picker (candidates re-resolved on every open): /model and /provider from
    // the injected builders, /approve /term /resume built in-app from the
    // session's own state. Typed arguments keep their direct paths. A kind
    // without a buildable spec (e.g. /resume with no sessions) falls through
    // to its existing handler.
    const pickerRequest = resolvePickerRequest(trimmed);
    if (pickerRequest) {
      const spec = buildPickerSpecFor(pickerRequest.kind);
      if (spec) {
        pushTurn('user', trimmed);
        // TERMINAL-PROVIDER-EVIDENCE-001 — kick a bounded evidence refresh; the
        // subscription above rebuilds the open card when it lands.
        if (pickerRequest.kind === 'model' || pickerRequest.kind === 'provider') void pickerEvidence?.refresh();
        if (resolvePickerSurfaceMode(columns) === 'lines') {
          // TERMINAL-PICKER-005 — too narrow for a card: numbered transcript
          // lines; the next typed `<command> <n|id>` resolves against them.
          narrowPickerRef.current = { kind: pickerRequest.kind, spec };
          pushTurn('bg', pickerLinesFor(spec, pickerLabels, resolvePickerGlyphs(pickerAscii), trimmed).join('\n'));
          return;
        }
        setPicker({ kind: pickerRequest.kind, spec });
        return;
      }
    }
    if (trimmed.toLowerCase() === '/cancel') {
      pushTurn('user', trimmed);
      queue.current!.clear(); setQueued([]);
      pushTurn('seg', labels.queueCleared);
      return;
    }
    // /clear must clear the Ink screen (history), not just the loop transcript.
    if (trimmed.toLowerCase() === '/clear') {
      clearScreen();
      return;
    }
    // /term [ask|run|control] — term-mode.ts mode dispatch. Replaces the
    // retired /ask·/run·/control transition commands (those names stay free
    // for future first-class commands). Every branch prints a VISIBLE line —
    // a silent badge-only switch reads as "nothing happened".
    // TERMINAL-TOOLS-008 — `/interrupt` aborts the turn in flight on EVERY
    // surface-flag state (parity: Esc/`/interrupt` stop the turn in Claude
    // Code and Codex). /queue and /steer stay behind the surface flag below.
    const busyAction = parseBusyCommand(trimmed);
    if (busyAction.kind === 'interrupt') {
      pushTurn('user', trimmed);
      const r = applyInterrupt(busyCtl.current, cancelActiveTurn);
      busyCtl.current = r.state;
      pushTurn('seg', renderBusyDecision(r.decision, labels));
      return;
    }
    // Inert unless replSurfaceEnabled: keeps flag-off behavior byte-identical
    // (the string falls through to a normal chat message, exactly as before).
    // TERMINAL-PICKER-003 — `/term` on EVERY surface: the Ask/Run/Control gate
    // (TERMINAL-TOOLS-011) applies regardless of repl_surface.enabled, so the
    // posture switch must be reachable without the flag (a default install
    // starts in Ask). A bare `/term` opened the picker above when a spec could
    // be built; here it is the typed switch, the status line, or usage.
    {
      const termCmd = parseTermCommand(trimmed);
      if (termCmd.kind !== 'none') {
        pushTurn('user', trimmed);
        const usage = requireInjectedLabel('termUsage', labels.termUsage);
        if (termCmd.kind === 'switch') {
          runTerm(termCmd.target);
        } else if (termCmd.kind === 'status') {
          // Status names BOTH gates: term-mode (command risk) AND the agentic
          // approval mode — file writes are gated by /approve, not /term.
          const status = requireInjectedLabel('termStatus', labels.termStatus)
            .replace('{mode}', resolveModeLabel(termMode.mode, labels))
            .replace('{approval}', approval);
          pushTurn('seg', `${status}\n${usage}`);
        } else {
          pushTurn('seg', usage);
        }
        return;
      }
    }
    if (replSurfaceEnabled) {
      // 358-006: /queue · /steer — busy-controls.ts dispatch (`/interrupt` is
      // handled above, unconditionally). Same inertness rule: flag off →
      // these fall through to a chat message.
      if (busyAction.kind === 'queue' || busyAction.kind === 'steer') {
        pushTurn('user', trimmed);
        if (busyAction.kind === 'queue') {
          pushTurn('seg', renderBusyDecision(resolveQueueCommand(busyCtl.current, bgQueue.current!), labels));
        } else {
          const r = applySteer(busyCtl.current, busyAction.message);
          busyCtl.current = r.state;
          pushTurn('seg', renderBusyDecision(r.decision, labels));
        }
        return;
      }
      // SURF-3 multi-flow-inbox — `/runs` read-only list of concurrent run-flows
      // (cross-process disk scan). Handled here on the native path; the legacy
      // loop has its own `/runs` branch (chat-native.ts), so the command never
      // silently degrades to a chat turn on either engine. Absent provider
      // (flag/wire off) → falls through as a normal turn.
      // SURF-3 D3a — `/runs --follow` (or `-f`) opens the live, self-refreshing
      // inbox card (view-only, Esc-close). Only when a feed was injected; else it
      // falls through to the static list below.
      if (/^\/runs\s+(?:--follow|-f)\s*$/i.test(trimmed) && inboxFollowFeed) {
        pushTurn('user', trimmed);
        setInboxOpen(true);
        return;
      }
      if (/^\/runs(?:\s+.*)?$/i.test(trimmed) && runInboxProvider) {
        // Bare `/runs` → the list; `/runs <n>` → that flow's detail (D2).
        pushTurn('user', trimmed);
        pushTurn('bg', runInboxProvider(trimmed));
        return;
      }
      // 358-006: /resume picker (session-resume.ts pickSession) merged with the
      // loop-side /resume — only a non-passthrough decision is handled here;
      // 'passthrough' falls to the queue push below, i.e. the loop's existing
      // memory-backed /resume, byte-identical (also the whole flag-off path).
      const resume = trimmed.match(/^\/resume(?:\s+(.*))?$/i);
      if (resume) {
        const merged = mergedResumeRecords();
        const decision = resolveResumeCommand(resume[1] ?? '', merged.disk, merged.resumable, labels);
        const literalId = (resume[1] ?? '').trim();
        if (decision.kind === 'passthrough' && literalId.length > 0 && nativeEngine?.hydrateTranscript) {
          pushTurn('user', trimmed);
          const hydrated = hydrateNativeResume(literalId, props.cwd, nativeEngine, memory);
          if (hydrated.source === 'missing') {
            pushTurn('seg', requireInjectedLabel('resumeNotFound', labels.resumeNotFound).replace('{arg}', literalId));
          } else {
            setActiveSessionId(literalId);
            activeSessionIdRef.current = literalId;
            setSessionTok(hydrated.outputTokens);
            pushTurn('seg', requireInjectedLabel('resumeSwitched', labels.resumeSwitched).replace('{id}', literalId));
          }
          return;
        }
        if (decision.kind !== 'passthrough') {
          pushTurn('user', trimmed);
          applyResumeDecision(decision);
          return;
        }
      }
    }
    // /cd <path> — change the working dir (file tools + status follow it live).
    const cd = trimmed.match(/^\/cd(?:\s+(.+))?$/i);
    if (cd) {
      pushTurn('user', trimmed);
      const arg = cd[1]?.trim();
      if (arg) {
        try {
          process.chdir(arg.startsWith('~') ? arg.replace(/^~/, homedir()) : arg);
          setCwd(process.cwd());
          pushTurn('seg', `${labels.cdTo}: ${process.cwd()}`);
        } catch { pushTurn('seg', `${labels.cdFail}: ${arg}`); }
      } else { pushTurn('seg', process.cwd()); }
      return;
    }
    // /model <id> · /provider <name> — runtime switch (handled here, not the loop).
    const sw = trimmed.match(/^\/(model|provider)(?:\s+(\S+))?$/i);
    if (sw) {
      const kind = (sw[1] as string).toLowerCase() as 'model' | 'provider';
      const arg = sw[2];
      pushTurn('user', trimmed);
      if (arg) {
        runSwitch(kind, arg);
      } else {
        pushTurn('seg', `${labels.switchUsage}\n${selection.provider}${selection.model ? ` · ${selection.model}` : ''}`);
      }
      return;
    }
    // /approve <mode> — agentic approval mode (suggest / auto-edit / full-auto).
    const ap = trimmed.match(APPROVE_COMMAND_RE);
    if (ap) {
      pushTurn('user', trimmed);
      const mode = ap[1]?.toLowerCase() as ApprovalMode | undefined;
      if (mode) runApprove(mode);
      else pushTurn('seg', `${labels.approvalUsage} (${approval})`);
      return;
    }
    // /do <goal> (452-002 REPL-DO-SLASH-WIRE) — drives the SAME RunFlow chain the
    // native `deckent_propose_run` tool uses via the session's ONE
    // `runFlowController` (run.tsx wireRunFlowMount). Flag-off (controller
    // undefined) → honest i18n notice, zero fs/planner side effects; the run edge
    // reuses setRunFlowPreview(deriveRunFlowPreview(ctx)) — the exact seam the
    // registerToolSink effect feeds — so preview → approval is identical to the
    // tool path. Handled here (not via resolveSlash/native-bridge) like /model,
    // /cd, /term: its catalog entry carries no agenticTool, so resolveSlash
    // returns 'none' and it would otherwise fall through to a chat turn.
    const doMatch = trimmed.match(/^\/do(?:\s+(.+))?$/i);
    if (doMatch) {
      pushTurn('user', trimmed);
      await runReplDoSlash(doMatch[1] ?? '', {
        controller: runFlowController,
        labels: doSlashLabels,
        emit: (text) => pushTurn('seg', text),
        setPreview: setRunFlowPreview,
        reportError: (message) =>
          pushTurn('bg', formatRunFlowOutcomeLine({ kind: 'error', message }, runFlowMountLabels)),
      });
      return;
    }
    // NATIVE-SLASH-BRIDGE (387-002) — see resolveNativeSlash's doc comment
    // above. Only active when the native engine drives the turn: the legacy
    // engine (nativeEngine undefined) already resolves every slash command
    // inside runChatNativeLoop's own for-await loop below — bridging here too
    // would double-dispatch it.
    if (nativeEngine && trimmed.startsWith('/')) {
      const chatModeNow: ChatMode = termMode.mode === 'control' ? 'enterprise' : 'user';
      const bridged = resolveNativeSlash(trimmed, { registry: slashRegistry, cwd, lang: lang ?? 'en', chatMode: chatModeNow });
      if (bridged.kind !== 'passthrough') {
        pushTurn('user', trimmed);
        if (bridged.kind === 'reply') {
          pushTurn('seg', bridged.text);
        } else {
          // 'dispatch' — reuse the SAME confirm-gated `dispatcher` the legacy
          // engine already uses for slash-triggered CLI-bridge tools
          // (run.tsx's dispatcher: classifyTool tier → askConfirm/
          // askConfirmAlways → confirmTrigger). This is what makes /kill
          // real confirm-gated (its 'always' tier ignores full-auto) and
          // makes a 'confirm'-tier tool (e.g. /sync) skip the y/n prompt once
          // /approve full-auto is set (askConfirm already checks the mode).
          // TERMINAL-TOOLS-011 — the Ask/Run/Control ladder decides first
          // (§10.2): the slash entry's registry risk tag, else the tool's
          // confirm tier; a denial names the mode that would allow it.
          const entry = slashRegistry.find((c) => c.agenticTool === bridged.tool);
          const gate = gateAction(termModeRef.current, { tool: bridged.tool, args: bridged.args, declaredRisk: entry?.risk });
          if (gate.kind === 'deny') { pushTurn('seg', denyLine(gate, trimmed)); return; }
          const dispatchResult = await dispatcher.dispatch(bridged.tool, bridged.args);
          pushTurn('seg', dispatchResult);
        }
        return;
      }
    }
    const enq = queue.current!.enqueue(trimmed);
    if (enq.kind === 'swallowed') return; // double-fire Enter quirk — nothing new to queue or wake
    setQueued([...queue.current!.snapshot()]);
    if (wake.current) { const w = wake.current; wake.current = null; w(); }
  };

  // TERM-FLOW-UNIFY Sprint-4 mount (426-002) — PlanPreviewCard decisions.
  // Side effects (controller.approve/startApproved/reject) run here; the
  // outcome is formatted by the pure formatRunFlowOutcomeLine above and
  // pushed as a 'bg' transcript line (same role the resume-teaser/busy-
  // controls decisions already use for system-generated status lines — no
  // new Turn role needed). Errors are caught, never thrown out of the
  // handler (an Ink useInput callback throwing would crash the whole REPL).
  const mountLabels = runFlowMountLabels;
  const handleRunFlowApprove = (preview: PlanPreview): void => {
    if (!runFlowController) return;
    setRunFlowPreview(null);
    try {
      runFlowController.approve({ id: 'repl-user' });
      const finalCtx = runFlowController.startApproved ? runFlowController.startApproved() : runFlowController.getContext();
      pushTurn('bg', formatRunFlowOutcomeLine({ kind: 'started', jobId: finalCtx.handle?.jobId ?? preview.flowId }, mountLabels));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      pushTurn('bg', formatRunFlowOutcomeLine({ kind: 'error', message }, mountLabels));
    }
  };
  const handleRunFlowReject = (): void => {
    if (!runFlowController) return;
    setRunFlowPreview(null);
    try {
      runFlowController.reject();
      pushTurn('bg', formatRunFlowOutcomeLine({ kind: 'rejected' }, mountLabels));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      pushTurn('bg', formatRunFlowOutcomeLine({ kind: 'error', message }, mountLabels));
    }
  };

  // born-508: resolve which of {confirm modal, InputBar, ApprovalCard} owns
  // stdin this render — exactly one, ever (see resolveStdinOwner above).
  const stdinOwner = resolveStdinOwner(confirm !== null, approvalPending);

  // Confirm modal owns input only while it is open (single-key y / a / N). The
  // queue resolves the current head and advances to the next card (deny does not
  // cancel the rest); onChange updates `confirm` (null when the queue drains).
  // 360-009: keys route through confirmKeyToAnswer — only documented keys
  // decide a card (case-insensitive y/a/n + Enter/Esc = deny default); stray
  // navigation/typed keys no longer mow the burst down one card per keystroke.
  useInput((input, key) => {
    const answer = confirmKeyToAnswer(input, key, { oneTime: confirm?.oneTime === true });
    if (answer !== null) confirmQueue.current!.answer(answer);
  }, { isActive: stdinOwner.confirmActive });

  // 358-006: Esc→interrupt while a turn is in flight (BUSY_KEY_ACTIONS contract,
  // busy-controls.ts). Double-Esc is idempotent by construction — the second
  // press resolves to interrupt-noop, the canceller never re-fires, and no
  // duplicate line is pushed. Inactive while the confirm modal owns input;
  // inert unless the surface flag is on (flag-off key handling unchanged).
  // TERMINAL-TOOLS-008 — Esc arrives through the composer (InputBar onEscape:
  // only an Esc no menu consumed), on every surface-flag state; while idle it
  // is a no-op so a stray Esc never prints a line. The old App-level useInput
  // was gated behind repl_surface.enabled AND fired even while a menu was
  // being closed with the same key.
  const handleEscapeInterrupt = (): void => {
    if (!working || confirm !== null) return;
    const r = applyInterrupt(busyCtl.current, cancelActiveTurn);
    busyCtl.current = r.state;
    if (r.decision.kind === 'interrupted') pushTurn('seg', renderBusyDecision(r.decision, labels));
  };

  // TERMINAL-TOOLS-006 — Ctrl-C / Ctrl-D policy (interrupt-policy.ts). Ink's
  // exitOnCtrlC is OFF (run.tsx): one Ctrl-C used to tear the session down
  // with a half-typed draft. Now: a draft is discarded, a running turn gets
  // the busy-controls interrupt, an idle empty composer arms — and only a
  // second press inside CTRL_C_EXIT_WINDOW_MS exits. The hint (catalog,
  // `tui.ctrl_c_*`) names the next key and lives for the window.
  const ctrlCArmedAt = useRef<number | null>(null);
  const [interruptHint, setInterruptHint] = useState<{ text: string; at: number } | null>(null);
  useEffect(() => {
    if (interruptHint === null) return;
    const id = setTimeout(() => { setInterruptHint(null); ctrlCArmedAt.current = null; }, CTRL_C_EXIT_WINDOW_MS);
    return () => clearTimeout(id);
  }, [interruptHint]);
  const handleInterrupt = (signal: 'int' | 'eof', draftNonEmpty: boolean): void => {
    const now = Date.now();
    const decision = resolveCtrlC({ signal, draftNonEmpty, working, armedAt: ctrlCArmedAt.current, now });
    if (decision.kind === 'exit') { exit(); return; }
    ctrlCArmedAt.current = decision.armedAt;
    if (decision.kind === 'interrupt-turn') {
      const r = applyInterrupt(busyCtl.current, cancelActiveTurn);
      busyCtl.current = r.state;
      // Honest hint: only a REAL abort says so; no seam / nothing to interrupt
      // falls back to the plain arm hint.
      const aborted = r.decision.kind === 'interrupted' && r.decision.aborted;
      if (r.decision.kind === 'interrupted') pushTurn('seg', renderBusyDecision(r.decision, labels));
      setInterruptHint({ text: aborted ? labels.ctrlCInterrupt : labels.ctrlCArm, at: now });
      return;
    }
    setInterruptHint({ text: decision.kind === 'clear-draft' ? labels.ctrlCDraftCleared : labels.ctrlCArm, at: now });
  };
  // While a modal/card owns stdin the InputBar is inactive, so Ctrl-C must
  // still reach the policy (otherwise it would be silently swallowed).
  const inputBarActiveNow = stdinOwner.inputBarActive && !runFlowPending && !inboxOpen && picker === null;
  useInput((input, key) => {
    if (key.ctrl && input === 'c') handleInterrupt('int', false);
  }, { isActive: !inputBarActiveNow });

  // Persistent phase anchor — the orientation signal ("am I working / done?").
  const phase: 'thinking' | 'generating' | 'idle' =
    busy ? 'thinking' : working ? 'generating' : 'idle';

  return (
    <Box flexDirection="column">
      <Static items={turns}>{(turn) => <TurnView key={turn.id} turn={turn} hyperlinks={props.hyperlinks === true} />}</Static>

      {/* In-progress (incomplete) line — the only streamed text in the dynamic
          region (one line). Completed lines/blocks already flowed into <Static>
          above (readable in real time, native scrollback, no tall re-render). */}
      {partial.length > 0 && <Text>{partial}</Text>}

      {/* Confirm modal — one card per queued tool call, with an [i/N] position. */}
      {confirm && (
        <Box flexDirection="column" marginTop={1}>
          <Text {...palette.info}>{confirm.summary}</Text>
          <Text {...palette.muted}>{`${labels.confirmProgress.replace('{index}', String(confirm.index)).replace('{total}', String(confirm.total))} ${confirm.oneTime ? labels.confirmHintOnce : labels.confirmHint}`}</Text>
        </Box>
      )}

      {/* Queue preview — what is waiting while deckent is busy. */}
      {queued.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          {queued.map((q, i) => (
            <Text key={i} {...palette.muted}>{`  ⋯ ${labels.queued} ${i + 1}: ${truncateQueuePreview(q, queuePreviewCells(columns))}`}</Text>
          ))}
        </Box>
      )}

      {/* APP-APPROVAL-WIRE (355-011): the runtime-wide-ApprovalBroker card —
          inert unless approvalsEnabled AND an approvalChannel is supplied
          (flag-off render stays byte-identical). Rendered BEFORE the footer
          block below so a pending approval sits "üst" (on top) of it — Ink's
          natural top-to-bottom Box flow, no manual layout math needed. The
          card itself renders null while nothing is pending. */}
      {approvalsEnabled && approvalChannel && approvalEvents.current && (
        <ApprovalCard
          events={approvalEvents.current}
          onDecide={approvalChannel.decide}
          onClosure={(request, decision) => {
            // born-697 — reflect the terminal's OWN decision as a visible
            // transcript line (the relay excludes the deciding channel from
            // cross-decided, so nothing else would).
            pushTurn('seg', formatApprovalClosure(decision, request.summary, labels));
          }}
          decidedBy="terminal"
          channel="terminal"
          labels={approvalLabels}
          isActive={stdinOwner.approvalCardActive}
        />
      )}

      {/* TERM-FLOW-UNIFY Sprint-4 mount (426-002): the native `deckent_propose_run`
          plan-preview card — inert unless runFlowController is supplied
          (flag-off render stays byte-identical). Rendered after ApprovalCard so
          it defers to a genuinely pending approval for stdin ownership (see
          resolveRunFlowCardActive above). */}
      {runFlowController && runFlowPreview && (
        <PlanPreviewCard
          preview={runFlowPreview}
          labels={runFlowCardLabels}
          onApprove={handleRunFlowApprove}
          onReject={handleRunFlowReject}
          isActive={resolveRunFlowCardActive(stdinOwner.confirmActive, approvalPending)}
        />
      )}

      {/* SURF-3 D3a: the live `/runs --follow` inbox card — inert unless a feed
          was injected AND `/runs --follow` opened it. Rendered LAST among the
          cards so it defers to the confirm modal / ApprovalCard / PlanPreviewCard
          for stdin (resolveInboxCardActive), and owns stdin only for Esc. */}
      {inboxFollowFeed && (
        <InboxCard
          open={inboxOpen}
          feed={inboxFollowFeed}
          labels={inboxLabels}
          onClose={() => setInboxOpen(false)}
          isActive={resolveInboxCardActive(stdinOwner.confirmActive, approvalPending, runFlowPending)}
          {...(inboxDecide ? { onDecide: inboxDecide } : {})}
        />
      )}

      {/* TERMINAL-PICKER-002 — the interactive value picker (bare /model,
          /provider …). Rendered after the inbox card: the lowest-priority
          stdin consumer (resolvePickerCardActive). While a turn is in flight
          the card is read-only and Enter renders the busy reason in-card. */}
      {picker && (
        <PickerCard
          key={`${picker.kind}:${picker.spec.titleSubject ?? ''}`}
          spec={picker.spec}
          labels={pickerLabels}
          glyphs={resolvePickerGlyphs(pickerAscii)}
          columns={columns}
          rows={process.stdout.rows ?? 24}
          noColor={pickerNoColor}
          isActive={resolvePickerCardActive(stdinOwner.confirmActive, approvalPending, runFlowPending, inboxOpen)}
          readOnlyReason={working
            ? (picker.kind === 'model' || picker.kind === 'provider' ? labels.switchBusy.replace('{kind}', picker.kind) : pickerLabels.readOnlyBusy)
            : null}
          onCommit={(id, scope) => commitPicker(picker.kind, id, scope)}
          onClose={() => setPicker(null)}
          // TERMINAL-PICKER-007 — Ctrl-C only closes the card; the app-level
          // hook (active while the input bar is not the owner) already arms
          // the two-press exit policy for the SAME keypress.
          onInterrupt={() => setPicker(null)}
        />
      )}

      {/* REPL-SURFACE-WIRE (354-001): mode indicator + live-footer — both
          inert unless replSurfaceEnabled (flag-off render stays byte-identical
          to the pre-354-001 App). Footer lines pass through resolveFooterLines
          (355-011 dual-stream seam) — a no-op unless a pending approval is
          compressing it down to its tested min-1-line floor, so the footer
          never fully disappears while the ApprovalCard above it is visible. */}
      {replSurfaceEnabled && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold>{`[${resolveModeLabel(termMode.mode, labels)}]`}</Text>
          {resolveFooterLines(footerLines, approvalPending).map((line, i) => <Text key={i} {...palette.muted}>{line}</Text>)}
        </Box>
      )}

      {/* Persistent status anchor (always present → "where am I / busy or done"). */}
      <Box marginTop={1}>
        {/* TERMINAL-TOOLS-013: while a card owns stdin the anchor SAYS so
            instead of promising "your turn" (textual carrier, not layout). */}
        {phase === 'idle'
          ? <Text {...palette.muted}>{inputBarActiveNow ? `✓ ${labels.ready}` : labels.inputPaused}</Text>
          : <><Spinner /><Text bold> deckent </Text><Text {...palette.muted}>{`· ${phase === 'thinking' ? labels.thinking : labels.generating}`}</Text></>}
        {/* TERMINAL-TOOLS-006: transient Ctrl-C hint (names the next key). */}
        {interruptHint ? <Text {...palette.info}>{`  · ${interruptHint.text}`}</Text> : null}
      </Box>

      {/* Pinned input with a VISIBLE cursor + interactive /menu — always last. */}
      <InputBar
        // TERM-FLOW-UNIFY Sprint-4 mount (426-002): a pending plan-preview card is
        // a fourth stdin consumer — `runFlowPending` is always false when
        // runFlowController is absent (the flag-off default), so this AND is a
        // no-op then (`x && !false === x`, byte-identical to the pre-426-002 prop).
        // SURF-3 D3a: the live `/runs --follow` card is a fifth consumer —
        // typing is suspended while it is up (Esc closes it), same no-op-when-off
        // property (`inboxOpen` is false until `--follow`).
        active={stdinOwner.inputBarActive && !runFlowPending && !inboxOpen && picker === null}
        onSubmit={handleSubmit}
        onInterrupt={handleInterrupt}
        onEscape={handleEscapeInterrupt}
        onClear={clearScreen}
        slashRegistry={slashRegistry}
        menuHint={labels.menuHint}
        menuMoreAbove={labels.menuMoreAbove}
        menuMoreBelow={labels.menuMoreBelow}
        reverseSearchLabel={labels.reverseSearch}
        caretStyle={caretStyle}
        shortcutsPanel={shortcutsPanel}
        // TERM-AT-REF (583/N2b): `@` path menu — inert (menu never opens)
        // unless run.tsx injects a provider; hint via the same labels route.
        pathProvider={atRefPathProvider}
        atMenuHint={labels.atMenuHint}
      />

      {/* TERMINAL-TOOLS-004: ONE width-aware line (status-row.tsx) — the old
          flex row of separate <Text> items lost its spacing and wrapped the cwd
          at ≤100 columns. `resumedId` is visible only after a /resume picker
          switch (358-006, gated upstream). */}
      <StatusRow
        columns={columns}
        input={{
          brand: 'deckent',
          provider: selection.provider,
          model: selection.model ?? undefined,
          cwd,
          sessionTok,
          approval: approval !== 'suggest' ? approval : undefined,
          resumedId: activeSessionId && activeSessionId !== sessionId ? activeSessionId : undefined,
        }}
      />
    </Box>
  );
}
