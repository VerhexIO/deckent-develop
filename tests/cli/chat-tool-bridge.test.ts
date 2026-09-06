import { describe, it, expect, vi } from 'vitest';
import {
  createCliToolDispatcher,
  cliArgsFor,
  type CliToolSpawnFn,
} from '../../src/cli/commands/chat-tool-bridge.js';

// All tests inject a fake spawnFn — no real subprocess is ever launched, so
// the suite is hermetic (no dist/, no deckent state, no network).

describe('createCliToolDispatcher — chat-tool-bridge.ts', () => {
  it('deckent_status → spawns the `status` subcommand and returns its stdout', async () => {
    const spawnFn = vi.fn().mockResolvedValue('Sprint sprint-223 — 13/13 DONE') as unknown as CliToolSpawnFn;
    const d = createCliToolDispatcher({ spawnFn });
    const out = await d.dispatch('deckent_status', { root: '.' });
    expect(out).toBe('Sprint sprint-223 — 13/13 DONE');
    expect(spawnFn).toHaveBeenCalledWith(['status']);
  });

  it('deckent_history → spawns the `history` subcommand', async () => {
    const spawnFn = vi.fn().mockResolvedValue('sprint-222\nsprint-223') as unknown as CliToolSpawnFn;
    const d = createCliToolDispatcher({ spawnFn });
    const out = await d.dispatch('deckent_history', { root: '.' });
    expect(out).toBe('sprint-222\nsprint-223');
    expect(spawnFn).toHaveBeenCalledWith(['history']);
  });

  it('deckent_memory_query → appends query as `recall <query>` positional', async () => {
    const spawnFn = vi.fn().mockResolvedValue('adr-027 Hybrid Spawn Backend') as unknown as CliToolSpawnFn;
    const d = createCliToolDispatcher({ spawnFn });
    const out = await d.dispatch('deckent_memory_query', { query: 'docker' });
    expect(out).toBe('adr-027 Hybrid Spawn Backend');
    expect(spawnFn).toHaveBeenCalledWith(['recall', 'docker']);
  });

  it('deckent_memory_query without query or detail_ref → mcp-error, no spawn', async () => {
    const spawnFn = vi.fn() as unknown as CliToolSpawnFn;
    const d = createCliToolDispatcher({ spawnFn });
    const out = await d.dispatch('deckent_memory_query', {});
    expect(out).toBe('[mcp-error] recall: query or detail_ref required');
    expect(spawnFn).not.toHaveBeenCalled();
  });

  it('deckent_memory_query forwards opaque continuation and detail references without inventing a query', async () => {
    const spawnFn = vi.fn().mockResolvedValue('complete entry') as unknown as CliToolSpawnFn;
    const d = createCliToolDispatcher({ spawnFn });
    await d.dispatch('deckent_memory_query', {
      detail_ref: 'memory-read-detail-v1.reference',
      cursor: 'memory-read-cursor-v1.reference',
    });
    expect(spawnFn).toHaveBeenCalledWith([
      'recall',
      '--cursor', 'memory-read-cursor-v1.reference',
      '--detail', 'memory-read-detail-v1.reference',
    ]);
  });

  it('deckent_plan → spawns `plan` (confirm-gated one layer up in run.tsx)', async () => {
    const spawnFn = vi.fn().mockResolvedValue('planned') as unknown as CliToolSpawnFn;
    const d = createCliToolDispatcher({ spawnFn });
    const out = await d.dispatch('deckent_plan', { mode: 'auto' });
    expect(out).toBe('planned');
    expect(spawnFn).toHaveBeenCalledWith(['plan']);
  });

  it('unknown tool → tool not allowed, no spawn', async () => {
    const spawnFn = vi.fn() as unknown as CliToolSpawnFn;
    const d = createCliToolDispatcher({ spawnFn });
    const out = await d.dispatch('deckent_made_up', { target: 'all' });
    expect(out).toBe('[mcp-error] tool not allowed: deckent_made_up');
    expect(spawnFn).not.toHaveBeenCalled();
  });

  it('spawn rejection → tagged mcp-error, never throws', async () => {
    const spawnFn = vi.fn().mockRejectedValue(new Error('ENOENT')) as unknown as CliToolSpawnFn;
    const d = createCliToolDispatcher({ spawnFn });
    const out = await d.dispatch('deckent_status', {});
    expect(out).toBe('[mcp-error] deckent_status: ENOENT');
  });

  // ─── Faz A: expanded read-only command coverage ──────────────────────────

  it.each([
    ['deckent_retro', ['retro']],
    ['deckent_doctor', ['doctor']],
    ['deckent_models', ['models', 'list']],
    ['deckent_analyze_project', ['analyze']],
    ['deckent_review', ['review']],
    ['deckent_explain', ['explain']],
    ['deckent_agent_list', ['agent', 'list']],
    ['deckent_skill_list', ['skill', 'list']],
    ['deckent_feature_query', ['features']],
    // Phone-bot cost/observability surface (bot-agentic READ_ONLY_BOT_TOOLS).
    ['deckent_cost', ['cost', 'show']],
    ['deckent_kpi', ['kpi']],
  ])('%s → spawns %j', async (tool, expectedArgs) => {
    const spawnFn = vi.fn().mockResolvedValue('ok') as unknown as CliToolSpawnFn;
    const d = createCliToolDispatcher({ spawnFn });
    const out = await d.dispatch(tool, { root: '.' });
    expect(out).toBe('ok');
    expect(spawnFn).toHaveBeenCalledWith(expectedArgs);
  });

  it('appends _rest positional args to the subcommand (e.g. /explain sprint-224)', async () => {
    const spawnFn = vi.fn().mockResolvedValue('explain ok') as unknown as CliToolSpawnFn;
    const d = createCliToolDispatcher({ spawnFn });
    const out = await d.dispatch('deckent_explain', { _rest: ['sprint-224'] });
    expect(out).toBe('explain ok');
    expect(spawnFn).toHaveBeenCalledWith(['explain', 'sprint-224']);
  });

  it('deckent_config (show) → spawns `config`', async () => {
    const spawnFn = vi.fn().mockResolvedValue('{...}') as unknown as CliToolSpawnFn;
    const d = createCliToolDispatcher({ spawnFn });
    await d.dispatch('deckent_config', {});
    expect(spawnFn).toHaveBeenCalledWith(['config']);
  });

  it('deckent_config set → spawns `config set <k> <v>` via _rest', async () => {
    const spawnFn = vi.fn().mockResolvedValue('✓') as unknown as CliToolSpawnFn;
    const d = createCliToolDispatcher({ spawnFn });
    await d.dispatch('deckent_config', { _rest: ['set', 'max_workers', '4'] });
    expect(spawnFn).toHaveBeenCalledWith(['config', 'set', 'max_workers', '4']);
  });

  it.each([
    ['deckent_plan', ['plan']],
    ['deckent_sync', ['sync']],
    ['deckent_checkpoint', ['checkpoint']],
    ['deckent_kill', ['kill']],
    ['deckent_cleanup', ['cleanup']],
  ])('%s → spawns %j (Faz E write/destructive)', async (tool, expected) => {
    const spawnFn = vi.fn().mockResolvedValue('ok') as unknown as CliToolSpawnFn;
    const d = createCliToolDispatcher({ spawnFn });
    await d.dispatch(tool, {});
    expect(spawnFn).toHaveBeenCalledWith(expected);
  });

  it('deckent_recover → bakes in --force (avoids headless readline hang)', async () => {
    const spawnFn = vi.fn().mockResolvedValue('recovered') as unknown as CliToolSpawnFn;
    const d = createCliToolDispatcher({ spawnFn });
    await d.dispatch('deckent_recover', { _rest: ['sprint-224'] });
    expect(spawnFn).toHaveBeenCalledWith(['recover', '--force', 'sprint-224']);
  });

  it('deckent_kill passes through user flags via _rest', async () => {
    const spawnFn = vi.fn().mockResolvedValue('killed') as unknown as CliToolSpawnFn;
    const d = createCliToolDispatcher({ spawnFn });
    await d.dispatch('deckent_kill', { _rest: ['--all'] });
    expect(spawnFn).toHaveBeenCalledWith(['kill', '--all']);
  });

  // Sprint 269 follow-up: deckent_audit is now bridged (the /audit slash needs
  // it). gate/query/compliance map to CLI argv; forward/retention (network /
  // destructive) stay excluded and return the not-allowed error.
  it('deckent_audit gate/query/compliance → bridged to audit CLI argv', async () => {
    const spawnFn = vi.fn().mockResolvedValue('ok') as unknown as CliToolSpawnFn;
    const d = createCliToolDispatcher({ spawnFn });
    await d.dispatch('deckent_audit', { action: 'gate', sprintId: 'sprint-224' });
    expect(spawnFn).toHaveBeenCalledWith(['audit', 'sprint-224']);
    await d.dispatch('deckent_audit', { action: 'query', channel: 'rbac.check' });
    expect(spawnFn).toHaveBeenCalledWith(['audit', 'query', '--action', 'rbac.check']);
    await d.dispatch('deckent_audit', { action: 'compliance' });
    expect(spawnFn).toHaveBeenCalledWith(['audit', 'compliance']);
  });

  it('deckent_audit forward/retention stay excluded (network/destructive)', async () => {
    const spawnFn = vi.fn() as unknown as CliToolSpawnFn;
    const d = createCliToolDispatcher({ spawnFn });
    const out = await d.dispatch('deckent_audit', { action: 'retention' });
    expect(out).toBe('[mcp-error] tool not allowed: deckent_audit');
    expect(spawnFn).not.toHaveBeenCalled();
  });

  it('deckent_autonomous read/write actions bridge; start stays excluded (long-running)', async () => {
    const spawnFn = vi.fn().mockResolvedValue('ok') as unknown as CliToolSpawnFn;
    const d = createCliToolDispatcher({ spawnFn });
    await d.dispatch('deckent_autonomous', { action: 'status' });
    expect(spawnFn).toHaveBeenCalledWith(['autonomous', 'status']);
    await d.dispatch('deckent_autonomous', { action: 'approve', triggerId: 't-1' });
    expect(spawnFn).toHaveBeenCalledWith(['autonomous', 'approve', 't-1']);
    await d.dispatch('deckent_autonomous', {
      action: 'backlog_add', id: 'nightly-doc', title: 'Nightly doc', cron: '0 6 * * *',
    });
    expect(spawnFn).toHaveBeenCalledWith([
      'autonomous', 'backlog', 'add', '--id', 'nightly-doc', '--title', 'Nightly doc', '--cron', '0 6 * * *',
    ]);
    const out = await d.dispatch('deckent_autonomous', { action: 'start' });
    expect(out).toBe('[mcp-error] tool not allowed: deckent_autonomous');
  });

  it('deckent_set_directives bridges with --content; empty content rejected', async () => {
    const spawnFn = vi.fn().mockResolvedValue('ok') as unknown as CliToolSpawnFn;
    const d = createCliToolDispatcher({ spawnFn });
    await d.dispatch('deckent_set_directives', { content: '# DIRECTIVES — Sprint X' });
    expect(spawnFn).toHaveBeenCalledWith(['set-directives', '--content', '# DIRECTIVES — Sprint X']);
    const out = await d.dispatch('deckent_set_directives', { content: '' });
    expect(out).toBe('[mcp-error] tool not allowed: deckent_set_directives');
  });

  it('ignores a non-array _rest (defensive)', async () => {
    const spawnFn = vi.fn().mockResolvedValue('ok') as unknown as CliToolSpawnFn;
    const d = createCliToolDispatcher({ spawnFn });
    await d.dispatch('deckent_review', { _rest: 'not-an-array' });
    expect(spawnFn).toHaveBeenCalledWith(['review']);
  });
});

describe('cliArgsFor — resolved argv (shared by dispatch + confirm modal)', () => {
  it('maps an allow-listed tool to its subcommand', () => {
    expect(cliArgsFor('deckent_status', {})).toEqual(['status']);
    expect(cliArgsFor('deckent_agent_list', {})).toEqual(['agent', 'list']);
  });

  it('appends _rest positional args', () => {
    expect(cliArgsFor('deckent_config', { _rest: ['set', 'k', 'v'] })).toEqual(['config', 'set', 'k', 'v']);
  });

  it('returns null for a tool not in the allow-list', () => {
    expect(cliArgsFor('deckent_made_up', {})).toBeNull();
    expect(cliArgsFor('deckent_memory_query', { query: 'x' })).toBeNull();
  });
});
