// ─── Localized Messages ──────────────────────────────────────────────

import { CLI_COMMON_MESSAGES } from './message-catalog/cli-common.js';
import { CLI_RUN_MESSAGES } from './message-catalog/cli-run.js';
import { CLI_MEMORY_CATALOG_MESSAGES } from './message-catalog/cli-memory-catalog.js';
import { CLI_GOVERNANCE_MESSAGES } from './message-catalog/cli-governance.js';
import { CLI_RUNTIME_HELP_MESSAGES } from './message-catalog/cli-runtime-help.js';
import { CLI_REFERENCE_MESSAGES } from './message-catalog/cli-reference.js';
import { CLI_TERMINAL_SLASH_MESSAGES } from './message-catalog/cli-terminal-slash.js';
import { CLI_TERMINAL_PICKER_MESSAGES } from './message-catalog/cli-terminal-picker.js';

type MessageMap = Record<string, Record<string, string>>;

/**
 * Base catalog. NEW keys for a bounded feature family belong in their own
 * file under ./message-catalog/ and are merged in below — see
 * `mergeMessageFamilies`. That keeps concurrent tasks off this single
 * ~8k-line literal (no edit collision) while still resolving through one
 * `getMessage()`.
 */
const BASE_MESSAGES: MessageMap = {
  'common.never': {
    en: 'never',
    tr: 'hiç',
  },
  // ─── Generated root/advanced help (CLI surface reform v2.1) ───────
  'cli.root_help.usage': {
    en: 'Usage: deckent [options] [prompt]',
    tr: 'Kullanım: deckent [seçenekler] [prompt]',
  },
  'cli.root_help.prompt_chat': {
    en: 'deckent "<prompt>"     start a native chat session',
    tr: 'deckent "<prompt>"     yerel bir sohbet oturumu başlat',
  },
  'cli.root_help.prompt_do': {
    en: 'deckent do "<goal>"    plan a run from a goal (dry-run first)',
    tr: 'deckent do "<hedef>"   bir hedeften run planla (önce dry-run)',
  },
  'cli.root_help.group.run': { en: 'Run', tr: 'Run' },
  'cli.root_help.group.observe': { en: 'Observe', tr: 'Observe' },
  'cli.root_help.group.control': { en: 'Control', tr: 'Control' },
  'cli.root_help.group.system': { en: 'System', tr: 'System' },
  'cli.root_help.group.advanced': { en: 'Advanced', tr: 'Advanced' },
  'cli.root_help.advanced_link': {
    en: 'deckent help advanced',
    tr: 'deckent help advanced',
  },
  'cli.root_help.deprecated_heading': {
    en: 'Deprecated commands (use the replacement shown):',
    tr: 'Kullanımdan kaldırılacak komutlar (gösterilen karşılığı kullanın):',
  },
  'cli.root_help.deprecated_row': {
    en: '{name} → {replacement}',
    tr: '{name} → {replacement}',
  },
  'cli.root_help.advanced_usage': {
    en: 'Usage: deckent help advanced',
    tr: 'Kullanım: deckent help advanced',
  },
  'cli.root_help.advanced_heading': {
    en: 'Advanced commands',
    tr: 'İleri düzey komutlar',
  },
  'cli.root_help.deprecated_label': {
    en: 'deprecated; use {replacement}',
    tr: 'kullanımdan kaldırılıyor; {replacement} kullanın',
  },
  'cli.root_help.help_command_desc': {
    en: 'Display curated help topics',
    tr: 'Seçilmiş yardım konularını göster',
  },

  // ─── runtime hygiene operator vocabulary (RH14-I18N) ────────────────
  // Only bounded aggregate fields cross this presentation boundary. In
  // particular, paths, authority identities, digests, and secrets are never
  // interpolation inputs for these operator-facing messages.
  'runtime_hygiene.inventory': {
    en: 'Inventory complete: {count} owned artifact(s), {bytes} bytes across {families} family/families.',
    tr: 'Envanter tamamlandı: {families} ailede {count} sahipli artifact, {bytes} bayt.',
  },
  'runtime_hygiene.plan': {
    en: 'Retention plan ready: {count} candidate(s), {bytes} bytes. Nothing was changed.',
    tr: 'Saklama planı hazır: {count} aday, {bytes} bayt. Hiçbir şey değiştirilmedi.',
  },
  'runtime_hygiene.preserve': {
    en: 'PRESERVE: {count} artifact(s) remain active for {family}.',
    tr: 'KORU: {family} için {count} artifact etkin kalıyor.',
  },
  'runtime_hygiene.archive': {
    en: 'ARCHIVE: {count} artifact(s), {bytes} bytes, were durably archived for {family}.',
    tr: 'ARŞİVLE: {family} için {count} artifact, {bytes} bayt, kalıcı olarak arşivlendi.',
  },
  'runtime_hygiene.retire': {
    en: 'RETIRE: {count} verified artifact(s), {bytes} bytes, were retired for {family}.',
    tr: 'EMEKLİ ET: {family} için doğrulanmış {count} artifact, {bytes} bayt, emekli edildi.',
  },
  'runtime_hygiene.hold': {
    en: 'HOLD ({reasonCode}): no artifact was changed; existing runtime evidence was preserved.',
    tr: 'HOLD ({reasonCode}): hiçbir artifact değiştirilmedi; mevcut runtime kanıtı korundu.',
  },
  'runtime_hygiene.receipt': {
    en: 'Durable receipt {receiptState}: hygiene status is {status}.',
    tr: 'Kalıcı makbuz {receiptState}: hygiene durumu {status}.',
  },
  'runtime_hygiene.summary': {
    en: 'Runtime hygiene summary: {families} family/families, {attempted} attempted, {retired} retired, {failures} failure(s).',
    tr: 'Runtime hygiene özeti: {families} aile, {attempted} deneme, {retired} emekli, {failures} hata.',
  },

  // COMPLETE phase
  'hint.COMPLETE': {
    tr: 'Sprint tamamlandı! `deckent retro` ile retrospektif okuyun',
    en: 'Sprint complete! Run `deckent retro` to read retrospective',
  },
  // EXECUTE phase
  'hint.EXECUTE': {
    tr: 'Görevler çalışıyor. `deckent status --watch` ile izleyin',
    en: 'Tasks running. Monitor with `deckent status --watch`',
  },
  // PLAN phase
  'hint.PLAN': {
    tr: '`deckent start` ile run\'ı başlatın',
    en: 'Run `deckent start` to begin the run',
  },
  // IDLE phase
  'hint.IDLE': {
    tr: '`deckent plan` ile run planlayın',
    en: 'Run `deckent plan` to plan a run',
  },

  // OWNER-MODEL-POLICY-001 — user-facing clarification (FAZ-0 item 5): the
  // `default_model` config value is a PREFERRED/default pick, never a hard
  // ceiling. The hard execution limit is the owner active-set.
  'model_policy.default_not_ceiling': {
    tr: '`default_model` TERCİH edilen/varsayılan seçimdir, kesin tavan DEĞİLDİR. '
      + 'Kesin çalıştırma sınırı owner active-set’idir (`deckent models active-set`). '
      + 'explicit-active bir sağlayıcıda yalnız owner’ın aktive ettiği modeller çalışır.',
    en: '`default_model` is a PREFERRED/default pick, NOT a hard ceiling. '
      + 'The hard execution limit is the owner active-set (`deckent models active-set`). '
      + 'Under an explicit-active provider only owner-activated models run.',
  },
  'model_policy.inactive_hold': {
    tr: 'Model {model} ({provider}) owner model policy (explicit-active) altında INACTIVE — '
      + 'planlama, routing, forceModel veya dispatch yapamaz. '
      + '`deckent models activate {model} --provider {provider}` ile aktive edin '
      + 'ya da aktif bir model seçin.',
    en: 'Model {model} ({provider}) is INACTIVE under the owner model policy (explicit-active) — '
      + 'it cannot plan, route, forceModel or dispatch. '
      + 'Activate it with `deckent models activate {model} --provider {provider}` '
      + 'or choose an active model.',
  },
  'model_policy.explicit_active_set': {
    tr: 'Sağlayıcı {provider} explicit-active: yalnız owner’ın aktive ettiği modeller '
      + 'çalıştırılabilir; yeni tespit edilen veya katalog modeli havuza kendiliğinden giremez.',
    en: 'Provider {provider} is explicit-active: only owner-activated models are executable; '
      + 'a newly detected or catalog model never auto-enters the pool.',
  },
  // Generic messages
  'status.tasks_running': {
    tr: '{taskCount} görev çalışıyor',
    en: '{taskCount} tasks running',
  },
  'status.sprint_active': {
    tr: 'Run {sprintId} (sprint) aktif',
    en: 'Run {sprintId} (sprint) active',
  },
  'status.no_sprint': {
    tr: 'Aktif run (sprint) yok',
    en: 'No active run (sprint)',
  },
  'inspect.description': {
    en: 'Inspect canonical runs or task detail',
    tr: 'Canonical run veya görev ayrıntısını incele',
  },
  'inspect.option.json': {
    en: 'Output machine-readable JSON',
    tr: 'Makine tarafından okunabilir JSON çıktısı üret',
  },
  'inspect.option.follow': {
    en: 'Follow live inspector revisions',
    tr: 'Canlı inspector revizyonlarını takip et',
  },
  'inspect.column.run_id': { en: 'Run ID', tr: 'Run ID' },
  'inspect.column.state': { en: 'State', tr: 'Durum' },
  'inspect.column.source': { en: 'Source', tr: 'Kaynak' },
  'inspect.column.settled_at': { en: 'Settled at', tr: 'Sonuçlanma zamanı' },
  'inspect.field.task_id': { en: 'Task ID', tr: 'Görev ID' },
  'inspect.field.status': { en: 'Status', tr: 'Durum' },
  'inspect.field.agent': { en: 'Agent', tr: 'Agent' },
  'inspect.field.model': { en: 'Model', tr: 'Model' },
  'inspect.field.heartbeat': { en: 'Heartbeat', tr: 'Heartbeat' },
  'inspect.field.plan_truncated': { en: 'Plan truncated', tr: 'Plan kısaltıldı' },
  'inspect.field.self_assessment': { en: 'Self-assessment', tr: 'Öz değerlendirme' },
  'inspect.field.lineage': { en: 'Lineage', tr: 'Lineage' },
  'inspect.log_tail.header': {
    en: 'Log tail ({count} lines, truncated: {truncated}):',
    tr: 'Log sonu ({count} satır, kısaltıldı: {truncated}):',
  },
  'inspect.follow.run_status': {
    en: 'Lifecycle: {lifecycle} · phase: {phase} · workers: {workers} · revision: {revision}',
    tr: 'Lifecycle: {lifecycle} · faz: {phase} · worker: {workers} · revizyon: {revision}',
  },
  'inspect.follow.task_status': {
    en: 'Task {taskId} · status: {status} · heartbeat: {heartbeat} · revision: {revision}',
    tr: 'Görev {taskId} · durum: {status} · heartbeat: {heartbeat} · revizyon: {revision}',
  },
  'inspect.error.follow_json': {
    en: 'INSPECT_FOLLOW_JSON_UNSUPPORTED: --follow cannot be combined with --json',
    tr: 'INSPECT_FOLLOW_JSON_UNSUPPORTED: --follow ile --json birlikte kullanılamaz',
  },
  'inspect.error.unknown_task': {
    en: 'INSPECT_TASK_NOT_FOUND: Unknown task ID: {taskId}',
    tr: 'INSPECT_TASK_NOT_FOUND: Bilinmeyen görev ID: {taskId}',
  },

  // ─── catalog network policy (SEC-04, task 418-003) ────────────────────
  'catalog.network_fetch_notice': {
    en: 'Fetching the latest model catalog from models.dev… (set DECKENT_OFFLINE=1 to skip)',
    tr: 'Güncel model kataloğu models.dev üzerinden alınıyor… (atlamak için DECKENT_OFFLINE=1 ayarlayın)',
  },
  'cli.binary_identity.hold': {
    en: 'DECKENT_BINARY_IDENTITY_HOLD: this Deckent source checkout is being driven by a different or unverified CLI build (reason: {issue}).',
    tr: 'DECKENT_BINARY_IDENTITY_HOLD: bu Deckent source checkout farklı veya doğrulanmamış bir CLI build tarafından çalıştırılıyor (neden: {issue}).',
  },
  'cli.binary_identity.warn': {
    en: 'DECKENT_BINARY_IDENTITY_WARN: the build in `dist/` no longer matches this source checkout (reason: {issue}). Continuing — run `npm run build` so the CLI reflects your current source.',
    tr: 'DECKENT_BINARY_IDENTITY_WARN: `dist/` içindeki build bu source checkout ile artık eşleşmiyor (neden: {issue}). Devam ediliyor — CLI güncel kaynağı yansıtsın diye `npm run build` çalıştırın.',
  },
  'cli.binary_identity.paths': {
    en: 'Project checkout: {projectRoot}\nRuntime package: {runtimeRoot}',
    tr: 'Proje checkout: {projectRoot}\nRuntime paketi: {runtimeRoot}',
  },
  'cli.binary_identity.hint': {
    en: 'Run `npm run build`, then use `node dist/cli/entry.js <command>` from this checkout. The diagnostic cross-checkout override never bypasses same-checkout source/build drift.',
    tr: 'Bu checkout içinde `npm run build` çalıştırın, ardından `node dist/cli/entry.js <komut>` kullanın. Diagnostic cross-checkout override aynı-checkout source/build drift kontrolünü asla atlamaz.',
  },
  'cli.binary_identity.override': {
    en: 'DECKENT_BINARY_IDENTITY_OVERRIDE: explicit cross-checkout override accepted (reason: {issue}); runtime behavior may not match this source checkout.',
    tr: 'DECKENT_BINARY_IDENTITY_OVERRIDE: açık cross-checkout override kabul edildi (neden: {issue}); runtime davranışı bu source checkout ile eşleşmeyebilir.',
  },

  // ─── start command ──────────────────────────────────────────────────
  'start.sandbox_not_implemented': {
    en: 'Sandbox mode not yet implemented. Running normally.',
    tr: 'Sandbox modu henüz uygulanmadı. Normal çalışıyor.',
  },
  'start.use_force': {
    en: 'Use --force to skip pre-flight checks.',
    tr: 'Ön kontrolleri atlamak için --force kullanın.',
  },
  'start.exact_capability_required': {
    en: 'Exact approved-plan execution requires a complete detached-child capability. The --exact-* flags are supplied by the run-flow coordinator, not by hand — execute an approved flow through the canonical journey (`deckent do` / the REPL run-flow surface), which spawns this command with the full capability itself.',
    tr: 'Exact onaylı-plan yürütmesi eksiksiz detached-child capability gerektirir. --exact-* bayrakları elle değil run-flow koordinatörü tarafından sağlanır — onaylı bir flow\'u kanonik yolculukla (`deckent do` / REPL run-flow yüzeyi) yürütün; bu komutu tam capability ile kendisi başlatır.',
  },
  // B1a (smoke 2026-08-07, GR-2026-08-07-DOGFOOD-B1A-01): bare `start` used to
  // replan silently — with REAL provider cost — while an approved, unconsumed
  // RunFlow snapshot sat in the store. These messages carry the typed refusal.
  'start.approved_flow_guard.header': {
    en: 'An approved, not-yet-executed plan already exists — refusing to silently replan ({count} flow(s)):',
    tr: 'Onaylı ve henüz yürütülmemiş bir plan zaten var — sessizce yeniden planlama reddediliyor ({count} flow):',
  },
  'start.approved_flow_guard.flow_line': {
    en: '  • flow {flowId} · revision {revision} · planDigest {planDigest} · approved {approvedAt}',
    tr: '  • flow {flowId} · revizyon {revision} · planDigest {planDigest} · onay {approvedAt}',
  },
  'start.approved_flow_guard.more': {
    en: '  … and {count} more approved flow(s).',
    tr: '  … ve {count} onaylı flow daha.',
  },
  'start.approved_flow_guard.remedy': {
    en: 'Execute the approved plan through the canonical journey (`deckent do` / the REPL run-flow surface). To consciously discard it and plan fresh anyway, re-run with --force-replan.',
    tr: 'Onaylı planı kanonik yolculukla yürütün (`deckent do` / REPL run-flow yüzeyi). Bilinçli olarak vazgeçip yine de sıfırdan planlamak için --force-replan ile tekrar çalıştırın.',
  },
  'start.approved_flow_guard.consuming': {
    en: 'Consuming the approved plan through the canonical run-flow machinery: flow {flowId} · revision {revision} · planDigest {planDigest}. A detached run child executes it; follow with `deckent status` / `deckent watch`.',
    tr: 'Onaylı plan kanonik run-flow makinesiyle tüketiliyor: flow {flowId} · revizyon {revision} · planDigest {planDigest}. Detached run child yürütüyor; `deckent status` / `deckent watch` ile izleyin.',
  },
  'start.approved_flow_guard.consumed_duplicate': {
    en: 'This approved flow already has a start attempt (state: {state}) — nothing new was started. Follow with `deckent status`.',
    tr: 'Bu onaylı flow için zaten bir start attempt var (durum: {state}) — yeni bir şey başlatılmadı. `deckent status` ile izleyin.',
  },
  'start.approved_flow_guard.multiple': {
    en: 'Multiple approved, not-yet-executed flows exist — choose one with --consume-approved <flowId>, or discard them consciously with --force-replan.',
    tr: 'Birden çok onaylı ve yürütülmemiş flow var — --consume-approved <flowId> ile birini seçin ya da --force-replan ile bilinçli vazgeçin.',
  },
  'start.approved_flow_guard.v2_required': {
    en: 'Canonical consumption requires config.terminal.run_flow_v2 = true; enable it and re-run, or use --force-replan to consciously plan fresh.',
    tr: 'Kanonik tüketim için config.terminal.run_flow_v2 = true gerekir; etkinleştirip yeniden deneyin ya da --force-replan ile bilinçli sıfırdan planlayın.',
  },
  'start.approved_flow_guard.overridden': {
    en: 'Approved-flow guard overridden via --force-replan — planning fresh; the approved snapshot stays in the store untouched.',
    tr: 'Onaylı-flow koruması --force-replan ile bilinçli geçildi — sıfırdan planlanıyor; onaylı snapshot store\'da dokunulmadan duruyor.',
  },
  'start.exact_attempt_mismatch': {
    en: 'Exact start attempt does not match the approved plan or detached-child capability.',
    tr: 'Exact start attempt, onaylı plan veya detached-child capability ile eşleşmiyor.',
  },
  'start.exact_accepted': {
    en: 'Exact run {flowId} revision {revision} was accepted as attempt {attemptId}; admission is pending.',
    tr: 'Exact run {flowId} revision {revision}, {attemptId} attempt kimliğiyle kabul edildi; admission bekleniyor.',
  },
  'start.exact_duplicate': {
    en: 'Exact run {flowId} revision {revision} is already admitted or terminal as attempt {attemptId}; no duplicate process was started.',
    tr: 'Exact run {flowId} revision {revision}, {attemptId} attempt kimliğiyle zaten admitted veya terminal durumda; duplicate process başlatılmadı.',
  },
  'start.watch_ignored_dry_run': {
    en: 'Note: --watch ignored in dry-run mode (no workers spawned).',
    tr: 'Not: Dry-run modunda --watch görmezden gelindi (worker başlatılmadı).',
  },
  'start.sprint_planned': {
    en: 'Run {number} (sprint) ({id}) planned — {count} tasks:',
    tr: 'Run {number} (sprint) ({id}) planlandı — {count} görev:',
  },
  'start.reasoning': {
    en: 'Reasoning: {reasoning}',
    tr: 'Gerekçe: {reasoning}',
  },
  'start.planning_mode': {
    en: 'Planning mode: {mode}',
    tr: 'Planlama modu: {mode}',
  },
  'planning.proof': {
    en: 'Planner proof: requested={requested} · actual={actual} · model-call={call} · reason={reason}',
    tr: 'Planner kanıtı: istenen={requested} · gerçekleşen={actual} · model-çağrısı={call} · neden={reason}',
  },
  'planning.receipt_ref': {
    en: 'Invocation receipt: {invocationId} · tenant={tenantId} · project={projectId}',
    tr: 'Çağrı makbuzu: {invocationId} · tenant={tenantId} · project={projectId}',
  },
  'start.workers_info': {
    en: 'Workers: {count} | Brain model: {model}',
    tr: 'Worker sayısı: {count} | Brain modeli: {model}',
  },
  'start.dry_run_complete': {
    en: 'Dry-run complete. No workers spawned.',
    tr: 'Dry-run tamamlandı. Worker başlatılmadı.',
  },
  'start.watch_window_created': {
    en: 'Watch window created. Attach with: tmux attach -t deckent:watch',
    tr: 'Watch penceresi oluşturuldu. Bağlanmak için: tmux attach -t deckent:watch',
  },
  'start.watch_no_tmux': {
    en: 'Note: --watch requires an active tmux session. Skipping watch setup.',
    tr: 'Not: --watch aktif bir tmux oturumu gerektirir. Watch kurulumu atlandı.',
  },
  'start.zero_config_created': {
    en: 'Zero-config mode: created temporary DIRECTIVES.md for "{description}"',
    tr: 'Sıfır-yapılandırma modu: "{description}" için geçici DIRECTIVES.md oluşturuldu',
  },
  'start.zero_config_directives_exist': {
    en: 'Warning: DIRECTIVES.md already exists. Using existing file (ignoring description argument).',
    tr: 'Uyarı: DIRECTIVES.md zaten mevcut. Mevcut dosya kullanılıyor (açıklama argümanı görmezden geliniyor).',
  },
  'start.zero_config_cleanup': {
    en: 'Zero-config mode: cleaned up temporary DIRECTIVES.md',
    tr: 'Sıfır-yapılandırma modu: geçici DIRECTIVES.md temizlendi',
  },

  // ─── run command (RUN-CLI-ALIAS, Sprint 378 — 378-001) ───────────────
  'run.alias_note': {
    en: "Note: 'run start|status|retro|history' are aliases for the top-level "
      + "'deckent start|status|retro|history' commands — identical behavior, same handler. "
      + "'sprint' terminology is being renamed to 'run'.",
    tr: "Not: 'run start|status|retro|history', üst-düzey 'deckent start|status|retro|history' "
      + "komutlarının takma adıdır — davranış ve işleyici birebir aynıdır. "
      + "'sprint' terimi 'run' olarak yeniden adlandırılıyor.",
  },

  // ─── run command — canonical model boundary (453-001) ────────────────
  'run.opt_model': {
    en: 'Model to use — an exact provider model ID (e.g. claude-sonnet-5, gpt-5.6-sol). '
      + 'Omit to use the configured default. Moving/legacy aliases (sonnet/opus/haiku/gpt-5/gpt-5.6) are rejected.',
    tr: 'Kullanılacak model — tam sağlayıcı model kimliği (örn. claude-sonnet-5, gpt-5.6-sol). '
      + 'Yapılandırılmış varsayılanı kullanmak için boş bırakın. Hareketli/eski takma adlar (sonnet/opus/haiku/gpt-5/gpt-5.6) reddedilir.',
  },
  // `{providers}` interpolated from `ALL_PROVIDER_NAMES` — see the note above
  // `run.model_err.provider_unverified` (OPENROUTER-PROVIDER, row 477).
  'run.opt_provider': {
    en: 'Explicit provider ownership ({providers}) — required to register an '
      + 'unseen versioned model ID; validated against the canonical registry.',
    tr: 'Açık sağlayıcı sahipliği ({providers}) — görülmemiş sürümlü bir model '
      + 'kimliğini kaydetmek için gereklidir; kanonik registry\'ye karşı doğrulanır.',
  },
  'run.model_err.invalid_id': {
    en: 'Cannot use model "{model}": the model ID is empty or malformed.',
    tr: '"{model}" modeli kullanılamıyor: model kimliği boş veya hatalı biçimlendirilmiş.',
  },
  'run.model_err.legacy_alias': {
    en: 'Cannot use model "{model}": it is a legacy alias — use the exact provider model ID '
      + '(e.g. claude-sonnet-5) instead.',
    tr: '"{model}" modeli kullanılamıyor: bu eski bir takma addır — bunun yerine tam sağlayıcı '
      + 'model kimliğini (örn. claude-sonnet-5) kullanın.',
  },
  'run.model_err.provider_mismatch': {
    en: 'Cannot use model "{model}" with provider "{provider}": the model is owned by a '
      + 'different provider.',
    tr: '"{model}" modeli "{provider}" sağlayıcısıyla kullanılamıyor: model farklı bir '
      + 'sağlayıcıya ait.',
  },
  // OPENROUTER-PROVIDER (row 477): the provider list is INTERPOLATED (`{providers}`),
  // never spelled out in the message text. These two strings hardcoded
  // "claude|codex|gemini|ollama", so adding a provider left the user reading a list
  // that no longer matched what the CLI accepted. Callers pass the runtime set
  // (`ALL_PROVIDER_NAMES`) — zero-hardcode, and both languages stay correct for free.
  'run.model_err.provider_unverified': {
    en: 'Cannot use model "{model}": it is unknown — pass --provider <{providers}> '
      + 'to register it explicitly.',
    tr: '"{model}" modeli kullanılamıyor: bilinmiyor — açıkça kaydetmek için '
      + '--provider <{providers}> geçin.',
  },
  'run.model_err.unknown_provider': {
    en: 'Unknown provider "{provider}" — valid providers: {providers}.',
    tr: 'Bilinmeyen sağlayıcı "{provider}" — geçerli sağlayıcılar: {providers}.',
  },
  'run.budget_hold': {
    en: 'Run held before task creation: execution budget policy is not ready '
      + '(reason: {reason}, required profile: {profile}). Configure an owner-authored '
      + 'worker budget profile; no provider or backend was started.',
    tr: 'Run, görev oluşturulmadan beklemeye alındı: execution budget policy hazır değil '
      + '(neden: {reason}, gerekli profil: {profile}). Owner tarafından yazılmış bir '
      + 'worker budget profili yapılandırın; provider veya backend başlatılmadı.',
  },
  'run.provider_authority_hold': {
    en: 'Run held before task creation: provider execution authority is not ready '
      + '(reason: {reason}, evidence: {evidence}). No task, provider, or backend was started.',
    tr: 'Run, görev oluşturulmadan beklemeye alındı: provider execution authority hazır değil '
      + '(neden: {reason}, kanıt: {evidence}). Görev, provider veya backend başlatılmadı.',
  },
  'run.routing_authority_hold': {
    en: 'Run held before dispatch: routing authority could not produce a valid agent/skill decision '
      + '(reason: {reason}). No provider or backend was started.',
    tr: 'Run dispatch öncesinde beklemeye alındı: routing authority geçerli bir agent/skill '
      + 'kararı üretemedi (neden: {reason}). Provider veya backend başlatılmadı.',
  },
  /** Actionable remedy appended to a hold the operator can actually resolve. */
  'run.provider_authority_hold.remedy_keyring': {
    en: 'Remedy: the provider authority keyring is not provisioned. Inspect it with '
      + '`deckent provider-authority keyring status`; the owner provisions it with '
      + '`deckent provider-authority keyring init`.',
    tr: 'Çözüm: provider authority keyring sağlanmamış. Durumu için '
      + '`deckent provider-authority keyring status`; sahibi '
      + '`deckent provider-authority keyring init` ile sağlar.',
  },
  // ─── task settlement authority (one-shot execution truth) ───────────────
  'task.cmd_desc': {
    en: 'Inspect and reconcile immutable one-shot task settlement evidence',
    tr: 'Tek seferlik görevlerin değişmez settlement kanıtını incele ve uzlaştır',
  },
  'task.settle.desc': {
    en: 'Inspect a task settlement plan; apply only with explicit operator attestation',
    tr: 'Görev settlement planını incele; yalnız açık operatör beyanıyla uygula',
  },
  'task.settle.opt_apply': {
    en: 'Apply an evidence-eligible reconciliation (default: dry-run)',
    tr: 'Kanıtça uygun bir uzlaştırmayı uygula (varsayılan: dry-run)',
  },
  'task.settle.opt_attestation_reason': {
    en: 'Operator-authored reason for the reconciliation (required with --apply)',
    tr: 'Uzlaştırma için operatörün yazdığı gerekçe (--apply ile zorunlu)',
  },
  'task.settle.opt_operator': {
    en: 'Stable operator identifier; only its hash-bound opaque reference is persisted (required with --apply)',
    tr: 'Sabit operatör kimliği; yalnız hash-bound opak referansı kalıcılaştırılır (--apply ile zorunlu)',
  },
  'task.settle.opt_reason_code': {
    en: 'Typed pre-dispatch reason for a declared eventless receipt ({codes})',
    tr: 'Bildirilen eventless receipt için tipli pre-dispatch nedeni ({codes})',
  },
  'task.settle.opt_json': {
    en: 'Emit the stable machine-readable settlement DTO',
    tr: 'Kararlı makine-okunur settlement DTO çıktısı üret',
  },
  'task.settle.apply_guard': {
    en: 'Refused: --apply requires both --attestation-reason <text> and --operator <id>. No receipt event was appended.',
    tr: 'Reddedildi: --apply için hem --attestation-reason <metin> hem --operator <kimlik> zorunludur. Receipt event\'i eklenmedi.',
  },
  'task.settle.invalid_task_id': {
    en: 'Refused: "{taskId}" is not a valid task identifier. Nothing was read or changed.',
    tr: 'Reddedildi: "{taskId}" geçerli bir görev kimliği değil. Hiçbir şey okunmadı veya değiştirilmedi.',
  },
  'task.settle.invalid_reason_code': {
    en: 'Refused: "{reasonCode}" is not an allowed pre-dispatch reason. Allowed values: {codes}. Nothing was changed.',
    tr: 'Reddedildi: "{reasonCode}" izin verilen bir pre-dispatch nedeni değil. İzin verilen değerler: {codes}. Hiçbir şey değiştirilmedi.',
  },
  'task.settle.reason_code_required': {
    en: 'This declared receipt has no dispatch event. --reason-code is required to settle it; allowed values: {codes}. Nothing was changed.',
    tr: 'Bu bildirilmiş receipt dispatch event\'i içermiyor. Kapatmak için --reason-code zorunlu; izin verilen değerler: {codes}. Hiçbir şey değiştirilmedi.',
  },
  'task.settle.reason_code_not_applicable': {
    en: 'Refused: --reason-code {reasonCode} is not applicable while settlement authority reports {authorityReason}. Nothing was changed.',
    tr: 'Reddedildi: settlement authority {authorityReason} bildirirken --reason-code {reasonCode} uygulanamaz. Hiçbir şey değiştirilmedi.',
  },
  'task.settle.not_found': {
    en: 'Task {taskId} or its readable task evidence was not found. Nothing was changed.',
    tr: '{taskId} görevi veya okunabilir görev kanıtı bulunamadı. Hiçbir şey değiştirilmedi.',
  },
  'task.settle.dry_run': {
    en: 'DRY-RUN — task {taskId}: raw={rawStatus}, effective={effectiveStatus}, decision={decision}, reason={reason}. Re-run with --apply plus explicit attestation only after reviewing the evidence.',
    tr: 'DRY-RUN — görev {taskId}: ham={rawStatus}, etkin={effectiveStatus}, karar={decision}, neden={reason}. Kanıtı inceledikten sonra yalnız --apply ve açık beyanla yeniden çalıştırın.',
  },
  'task.settle.applied': {
    en: 'SETTLED — task {taskId}: raw={rawStatus}, effective={effectiveStatus}, receipt={receiptId}, evidence={evidenceRef}.',
    tr: 'SETTLED — görev {taskId}: ham={rawStatus}, etkin={effectiveStatus}, receipt={receiptId}, kanıt={evidenceRef}.',
  },
  'task.settle.already_settled': {
    en: 'UNCHANGED — task {taskId} was already settled: raw={rawStatus}, effective={effectiveStatus}, receipt={receiptId}.',
    tr: 'DEĞİŞMEDİ — {taskId} görevi zaten kapanmıştı: ham={rawStatus}, etkin={effectiveStatus}, receipt={receiptId}.',
  },
  'task.settle.ineligible': {
    en: 'Refused: task {taskId} is not evidence-eligible for reconciliation ({reason}). Nothing was changed.',
    tr: 'Reddedildi: {taskId} görevi kanıta dayalı uzlaştırma için uygun değil ({reason}). Hiçbir şey değiştirilmedi.',
  },
  'task.settle.failed': {
    en: 'Task settlement failed: {message}',
    tr: 'Görev settlement işlemi başarısız: {message}',
  },
  'task.settle.pre_dispatch_reason_line': {
    en: 'Settled typed pre-dispatch reason: {reasonCode}',
    tr: 'Kalıcılaştırılan tipli pre-dispatch nedeni: {reasonCode}',
  },
  'task.settle.requested_pre_dispatch_reason_line': {
    en: 'Requested typed pre-dispatch reason (not yet settled): {reasonCode}',
    tr: 'İstenen tipli pre-dispatch nedeni (henüz kalıcı değil): {reasonCode}',
  },
  'task.settle.decision.eligible': {
    en: 'eligible',
    tr: 'uygun',
  },
  'task.settle.decision.hold': {
    en: 'held',
    tr: 'beklemede',
  },
  'task.settle.decision.already-settled': {
    en: 'already settled',
    tr: 'zaten kapanmış',
  },
  'task.settle.reason.receipt-dispatch-rejected': {
    en: 'the immutable receipt proves dispatch was rejected',
    tr: 'değişmez receipt dispatch işleminin reddedildiğini kanıtlıyor',
  },
  'task.settle.reason.receipt-ready-for-rejection': {
    en: 'the declared receipt has no dispatch event and is ready for a typed pre-dispatch rejection',
    tr: 'bildirilmiş receipt dispatch event\'i içermiyor ve tipli pre-dispatch reddi için hazır',
  },
  'task.settle.reason.legacy-attestation-verified': {
    en: 'legacy absence evidence and operator attestation were verified',
    tr: 'legacy yokluk kanıtı ve operatör beyanı doğrulandı',
  },
  'task.settle.reason.already-settled': {
    en: 'an immutable terminal settlement already exists',
    tr: 'değişmez terminal settlement zaten var',
  },
  'task.settle.reason.receipt-missing': {
    en: 'the expected invocation receipt is missing',
    tr: 'beklenen invocation receipt eksik',
  },
  'task.settle.reason.receipt-ambiguous': {
    en: 'multiple or conflicting receipts prevent a unique decision',
    tr: 'birden çok veya çelişkili receipt tekil kararı engelliyor',
  },
  'task.settle.opt_reproject_status': {
    en: 'Make the task file\'s status agree with its own TERMINAL receipt. Writes nothing new — the receipt is the authority; this only resolves a task surface left behind by a caller that stopped waiting.',
    tr: 'Görev dosyasının status alanını kendi TERMİNAL receipt\'iyle uyumlu hâle getirir. Yeni bir şey yazmaz — authority receipt\'tir; bu yalnız beklemeyi bırakmış bir çağıranın geride bıraktığı görev yüzeyini uzlaştırır.',
  },
  'task.settle.opt_from_result': {
    en: 'Terminalize a dispatch whose worker DID finish and persist a result while the caller stopped waiting. The disposition is read from the worker\'s own selfAssessment, never chosen.',
    tr: 'Worker\'ı BİTİRİP sonucunu yazdığı hâlde çağıran beklemeyi bıraktığı için takılı kalan dispatch\'i terminal yapar. Disposition seçilmez, worker\'ın kendi selfAssessment\'ından okunur.',
  },
  'task.settle.opt_abandon_dispatch': {
    en: 'Terminalize a dispatch that started and then died without a result. The disposition is derived from the absence probe, never chosen: it settles as manual_review_required and refuses while any liveness evidence remains.',
    tr: 'Başlayıp sonuç üretmeden ölen bir dispatch\'i terminal yapar. Disposition seçilmez, yokluk-probe\'undan türetilir: manual_review_required olarak kapanır ve herhangi bir canlılık kanıtı varken reddeder.',
  },
  'task.settle.reason.dispatch-abandoned': {
    en: 'dispatch started and the worker is provably gone; eligible for an abandoned-dispatch settlement',
    tr: 'dispatch başlamış ve worker kanıtlanabilir şekilde yok; terkedilmiş-dispatch kapanışına uygun',
  },
  'task.settle.reason.dispatch-still-live': {
    en: 'liveness evidence remains for this dispatch; it cannot be settled as abandoned',
    tr: 'bu dispatch için canlılık kanıtı duruyor; terkedilmiş olarak kapatılamaz',
  },
  'task.settle.reason.dispatch-started': {
    en: 'dispatch-started evidence exists; NOT_DISPATCHED cannot be asserted',
    tr: 'dispatch-started kanıtı var; NOT_DISPATCHED beyan edilemez',
  },
  'task.settle.reason.terminal-conflict': {
    en: 'existing terminal evidence conflicts with this reconciliation',
    tr: 'mevcut terminal kanıt bu uzlaştırmayla çelişiyor',
  },
  'task.settle.reason.scope-mismatch': {
    en: 'tenant or project scope does not match the receipt authority',
    tr: 'tenant veya proje kapsamı receipt authority ile eşleşmiyor',
  },
  'task.settle.reason.unsupported-task-domain': {
    en: 'this settlement authority is limited to canonical run-* one-shot tasks',
    tr: 'bu settlement authority yalnız canonical run-* one-shot görevleriyle sınırlı',
  },
  'task.settle.reason.task-content-mismatch': {
    en: 'the attested task bytes do not match the task evidence',
    tr: 'beyan edilen görev byte\'ları görev kanıtıyla eşleşmiyor',
  },
  'task.settle.reason.attestation-evidence-mismatch': {
    en: 'the attestation does not bind the current absence evidence',
    tr: 'beyan güncel yokluk kanıtına bağlı değil',
  },
  'task.settle.reason.attestation-required': {
    en: 'explicit operator attestation is required',
    tr: 'açık operatör beyanı gerekli',
  },
  'task.settle.reason.pre-dispatch-reason-required': {
    en: 'a typed pre-dispatch rejection reason is required for this declared receipt',
    tr: 'bu bildirilmiş receipt için tipli bir pre-dispatch red nedeni gerekli',
  },
  'task.settle.reason.absence-evidence-incomplete': {
    en: 'absence evidence is incomplete or unknown',
    tr: 'yokluk kanıtı eksik veya bilinmiyor',
  },
  'task.settle.reason.active-execution-evidence': {
    en: 'live process, backend, or task artifact evidence is present',
    tr: 'canlı process, backend veya görev artifact kanıtı var',
  },
  'task.settle.reason.probe-unsupported': {
    en: 'this environment cannot prove every required absence signal',
    tr: 'bu ortam gerekli tüm yokluk sinyallerini kanıtlayamıyor',
  },
  'task.settlement.evidence_line': {
    en: 'Settlement: raw={rawStatus} · effective={effectiveStatus} · receipt={receiptId} · reason={reasonCode} · evidence={evidenceRefs}',
    tr: 'Settlement: ham={rawStatus} · etkin={effectiveStatus} · receipt={receiptId} · neden={reasonCode} · kanıt={evidenceRefs}',
  },
  'task.settlement.no_receipt_line': {
    en: 'Settlement: raw={rawStatus} · effective={effectiveStatus} · receipt=none · reason={reasonCode} · evidence={evidenceRefs}',
    tr: 'Settlement: ham={rawStatus} · etkin={effectiveStatus} · receipt=yok · neden={reasonCode} · kanıt={evidenceRefs}',
  },
  'task.settlement.none': {
    en: 'none',
    tr: 'yok',
  },
  'review.settlement_reference.valid': {
    en: 'Settlement reference valid: task={taskId} · attempt={attemptId}',
    tr: 'Settlement referansı geçerli: görev={taskId} · deneme={attemptId}',
  },
  'review.settlement_reference.missing': {
    en: 'Settlement reference missing',
    tr: 'Settlement referansı eksik',
  },
  'review.settlement_reference.corrupt': {
    en: 'Settlement reference invalid or unreadable',
    tr: 'Settlement referansı geçersiz veya okunamıyor',
  },
  'review.settlement_reference.legacy': {
    en: 'Legacy settlement reference',
    tr: 'Eski biçimli settlement referansı',
  },
  'task.execution_fence_conflict': {
    en: 'Task {taskId} changed execution state concurrently; dispatch or settlement was refused.',
    tr: '{taskId} görevinin execution durumu eşzamanlı değişti; dispatch veya settlement reddedildi.',
  },
  'task.execution_snapshot_invalid': {
    en: 'Task {taskId} has an invalid canonical execution snapshot; dispatch was refused.',
    tr: '{taskId} görevinin canonical execution snapshot kaydı geçersiz; dispatch reddedildi.',
  },
  'task.execution_already_settled': {
    en: 'Task {taskId} is immutably settled as NOT_DISPATCHED; dispatch was refused.',
    tr: '{taskId} görevi değişmez biçimde NOT_DISPATCHED olarak kapatılmış; dispatch reddedildi.',
  },
  'task.execution_authority_conflict': {
    en: 'Task {taskId} has conflicting immutable execution authority ({reasonCode}); dispatch was refused.',
    tr: '{taskId} görevinin değişmez execution authority kaydı çelişkili ({reasonCode}); dispatch reddedildi.',
  },
  'status.task_settlements.header': {
    en: '\n--- Immutable Task Settlement ---',
    tr: '\n--- Değişmez Görev Settlement Durumu ---',
  },
  'output.invalid_task_id': {
    en: 'Refused: "{taskId}" is not a valid task identifier. Nothing was read.',
    tr: 'Reddedildi: "{taskId}" geçerli bir görev kimliği değil. Hiçbir şey okunmadı.',
  },
  'run.settlement_declared': {
    en: 'Invocation receipt declared: {receiptId}',
    tr: 'Invocation receipt bildirildi: {receiptId}',
  },
  'run.settlement_dispatch_rejected': {
    en: 'Dispatch rejection settled: receipt={receiptId} · reason={reason} · evidence={evidence}',
    tr: 'Dispatch reddi kapatıldı: receipt={receiptId} · neden={reason} · kanıt={evidence}',
  },
  'run.settlement_rejection_incomplete': {
    en: 'Receipt {receiptId} could not reach NOT_DISPATCHED (reason: {reason}); reconciliation is required.',
    tr: '{receiptId} receipt\'i NOT_DISPATCHED durumuna ulaşamadı (neden: {reason}); uzlaştırma gerekiyor.',
  },
  'run.settlement_rejection_failed': {
    en: 'Receipt {receiptId} could not persist its pre-dispatch rejection: {message}',
    tr: '{receiptId} receipt\'inin pre-dispatch reddi kalıcılaştırılamadı: {message}',
  },
  'run.settlement_reconciliation_required': {
    en: 'Dispatch may have started; receipt {receiptId} remains open for reconciliation (evidence: {evidence}). Task evidence was preserved.',
    tr: 'Dispatch başlamış olabilir; {receiptId} receipt\'i uzlaştırma için açık bırakıldı (kanıt: {evidence}). Görev kanıtı korundu.',
  },
  'run.settlement_terminal': {
    en: 'Terminal settlement persisted: receipt={receiptId} · effective={effectiveStatus} · evidence={evidence}',
    tr: 'Terminal settlement kalıcılaştırıldı: receipt={receiptId} · etkin={effectiveStatus} · kanıt={evidence}',
  },
  'run.settlement_backend_mismatch': {
    en: 'Dispatch refused before provider work: declared backend {expected} does not match boundary backend {actual}.',
    tr: 'Dispatch provider çalışmasından önce reddedildi: bildirilen backend {expected}, boundary backend {actual} ile eşleşmiyor.',
  },
  'run.settlement_dispatch_boundary_mismatch': {
    en: 'Dispatch authority mismatch for task {taskId}; provider work was refused.',
    tr: '{taskId} görevi için dispatch authority eşleşmiyor; provider çalışması reddedildi.',
  },
  'run.settlement_dispatch_boundary_missing': {
    en: 'No dispatch authority boundary was published for task {taskId}; the receipt remains open for reconciliation.',
    tr: '{taskId} görevi için dispatch authority boundary yayınlanmadı; receipt uzlaştırma için açık.',
  },
  'run.settlement_terminal_without_dispatch': {
    en: 'Task {taskId} produced terminal evidence without a dispatch authority boundary; settlement was refused.',
    tr: '{taskId} görevi dispatch authority boundary olmadan terminal kanıt üretti; settlement reddedildi.',
  },
  'run.result_identity_mismatch': {
    en: 'Result identity mismatch for task {taskId}. The receipt remains open for reconciliation and task evidence was preserved.',
    tr: '{taskId} görevi için sonuç kimliği eşleşmiyor. Receipt uzlaştırma için açık ve görev kanıtı korunmuş durumda.',
  },
  'cmdCatalog.task.summary': {
    en: 'Inspect or attest evidence-backed one-shot task settlement',
    tr: 'Kanıta dayalı tek seferlik görev settlement durumunu incele veya beyanla kapat',
  },
  'cmdCatalog.provider-authority.summary': {
    en: 'Inspect and rotate host-scoped provider authority integrity keys',
    tr: 'Host kapsamlı provider authority bütünlük anahtarlarını incele ve döndür',
  },
  'cmdCatalog.execution-authority.summary': {
    en: 'Inspect and explicitly reconcile execution authority bindings',
    tr: 'Execution authority bağlarını incele ve açıkça uzlaştır',
  },
  'cmdCatalog.approvals.summary': {
    en: 'Review pending runtime approval requests and decide execution admission (allow/deny)',
    tr: 'Bekleyen runtime onay isteklerini gözden geçir ve execution admission kararını ver (izin/ret)',
  },
  'cmdCatalog.local-llm.summary': {
    en: 'Manage the project-scoped local LLM runtime',
    tr: 'Proje kapsamlı local LLM runtime\'ını yönet',
  },
  'local_llm.cmd_desc': {
    en: 'Manage the project-scoped local LLM runtime',
    tr: 'Proje kapsamlı local LLM runtime\'ını yönet',
  },
  'local_llm.start_desc': {
    en: 'Start the configured local LLM server',
    tr: 'Yapılandırılmış local LLM sunucusunu başlat',
  },
  'local_llm.status_desc': {
    en: 'Inspect local LLM health and advertised models',
    tr: 'Local LLM sağlığını ve sunduğu modelleri incele',
  },
  'local_llm.stop_desc': {
    en: 'Stop the project-scoped local LLM server',
    tr: 'Proje kapsamlı local LLM sunucusunu durdur',
  },
  // ─── execution-authority mount adoption ─────────────────────────────────
  'execution_authority.cmd_desc': {
    en: 'Inspect and reconcile project execution authority bindings',
    tr: 'Proje execution authority bağlarını incele ve uzlaştır',
  },
  'execution_authority.mount_adopt.desc': {
    en: 'Reconcile namespace-local Linux/WSL mount metadata without changing execution authority',
    tr: 'Execution authority\'yi değiştirmeden namespace-local Linux/WSL mount metadata\'sını uzlaştır',
  },
  'execution_authority.mount_adopt.mcp_title': {
    en: 'Execution Authority Reconciliation',
    tr: 'Execution Authority Uzlaştırması',
  },
  'execution_authority.mount_adopt.mcp_desc': {
    en: 'Inspect or explicitly reconcile namespace-local Linux/WSL mount metadata. Stable dev+ino execution authority and its epoch do not change. Dry-run is the default; apply requires operator and justification.',
    tr: 'Namespace-local Linux/WSL mount metadata\'sını incele veya açıkça uzlaştır. Stable dev+ino execution authority ve epoch değişmez. Varsayılan dry-run\'dır; apply için operator ve justification zorunludur.',
  },
  'execution_authority.mount_adopt.mcp_action': {
    en: 'Execution-authority action; currently mount-adopt',
    tr: 'Execution-authority işlemi; şu anda mount-adopt',
  },
  'execution_authority.mount_adopt.opt_apply': {
    en: 'Apply eligible observational metadata reconciliation (default: dry-run)',
    tr: 'Uygun gözlemsel metadata uzlaştırmasını uygula (varsayılan: dry-run)',
  },
  'execution_authority.mount_adopt.opt_operator': {
    en: 'Stable operator identifier; only its SHA-256 digest is persisted',
    tr: 'Sabit operatör kimliği; yalnız SHA-256 özeti kalıcılaştırılır',
  },
  'execution_authority.mount_adopt.opt_justification': {
    en: 'Operator-authored reconciliation justification; only its SHA-256 digest is persisted',
    tr: 'Operatörün uzlaştırma gerekçesi; yalnız SHA-256 özeti kalıcılaştırılır',
  },
  'execution_authority.mount_adopt.opt_json': {
    en: 'Emit the stable machine-readable adoption DTO',
    tr: 'Kararlı makine-okunur adoption DTO çıktısı üret',
  },
  'execution_authority.mount_adopt.apply_guard': {
    en: 'Refused: --apply requires both --operator <id> and --justification <text>. Nothing was changed.',
    tr: 'Reddedildi: --apply için hem --operator <kimlik> hem --justification <metin> zorunludur. Hiçbir şey değiştirilmedi.',
  },
  'execution_authority.mount_adopt.eligible': {
    en: 'DRY-RUN — authority {authorityEpoch}: namespace-local mount observation {previousMountId} → {currentMountId}; optional audited metadata reconciliation is eligible, authority is unchanged.',
    tr: 'DRY-RUN — authority {authorityEpoch}: namespace-local mount gözlemi {previousMountId} → {currentMountId}; opsiyonel audit\'li metadata uzlaştırması uygun, authority değişmedi.',
  },
  'execution_authority.mount_adopt.adopted': {
    en: 'RECONCILED — authority {authorityEpoch}: mount observation {previousMountId} → {currentMountId}; stable generation and epoch were unchanged, immutable evidence was recorded.',
    tr: 'UZLAŞTIRILDI — authority {authorityEpoch}: mount gözlemi {previousMountId} → {currentMountId}; stable generation ve epoch değişmedi, değişmez kanıt kaydedildi.',
  },
  'execution_authority.mount_adopt.not_required': {
    en: 'UNCHANGED — authority {authorityEpoch}: this namespace already records mount observation {currentMountId}; stable dev+ino authority is unchanged.',
    tr: 'DEĞİŞMEDİ — authority {authorityEpoch}: bu namespace zaten {currentMountId} mount gözlemini kaydediyor; stable dev+ino authority değişmedi.',
  },
  'execution_authority.mount_adopt.evidence': {
    en: 'Evidence: {evidenceRefs}',
    tr: 'Kanıt: {evidenceRefs}',
  },
  'execution_authority.mount_adopt.failed': {
    en: 'Execution authority mount-metadata reconciliation was refused ({reason}). Nothing was deleted.',
    tr: 'Execution authority mount-metadata uzlaştırması reddedildi ({reason}). Hiçbir şey silinmedi.',
  },
  // ─── provider-authority keyring (owner-gated integrity material) ──────────
  'provider_authority.cmd_desc': {
    en: 'Inspect and provision the host-scoped provider authority keyring (owner-gated)',
    tr: 'Host kapsamlı provider authority keyring\'ini incele ve sağla (sahip yetkisinde)',
  },
  'provider_authority.keyring.cmd_desc': {
    en: 'Provider authority keyring — status / init / rotate',
    tr: 'Provider authority keyring — status / init / rotate',
  },
  'provider_authority.keyring.status_desc': {
    en: 'Show keyring location and revision state (never prints key material)',
    tr: 'Keyring konumunu ve revizyon durumunu göster (anahtar materyali asla yazılmaz)',
  },
  'provider_authority.keyring.init_desc': {
    en: 'Provision the keyring genesis revision (owner action; refuses if one exists)',
    tr: 'Keyring genesis revizyonunu sağla (sahip işlemi; varsa reddeder)',
  },
  'provider_authority.keyring.rotate_desc': {
    en: 'Rotate the active authority key (requires --expect-revision)',
    tr: 'Aktif authority anahtarını döndür (--expect-revision gerekir)',
  },
  'provider_authority.keyring.opt_expect_revision': {
    en: 'Revision hash the rotation must apply to (from `status`) — prevents clobbering a concurrent update',
    tr: 'Rotasyonun uygulanacağı revizyon hash\'i (`status` çıktısından) — eşzamanlı güncellemeyi ezmeyi önler',
  },
  'provider_authority.keyring.location': {
    en: 'Keyring directory: {dir}',
    tr: 'Keyring dizini: {dir}',
  },
  'provider_authority.keyring.absent': {
    en: 'State: NOT PROVISIONED — every run holds fail-closed with `keyring_unavailable` until the owner runs `deckent provider-authority keyring init`.',
    tr: 'Durum: SAĞLANMAMIŞ — sahibi `deckent provider-authority keyring init` çalıştırana kadar her run `keyring_unavailable` ile fail-closed bekler.',
  },
  'provider_authority.keyring.unreadable': {
    en: 'State: UNREADABLE ({code}) — {message}',
    tr: 'Durum: OKUNAMIYOR ({code}) — {message}',
  },
  'provider_authority.keyring.present': {
    en: 'State: PROVISIONED — keyring {keyringId}, revision {revision}, revision hash {revisionHash}, active key {activeKeyId}, {keyCount} key(s).',
    tr: 'Durum: SAĞLANMIŞ — keyring {keyringId}, revizyon {revision}, revizyon hash {revisionHash}, aktif anahtar {activeKeyId}, {keyCount} anahtar.',
  },
  'provider_authority.keyring.key_line': {
    en: '  - {keyId} [{status}] domains={domains} derivation={derivation} created={createdAt}',
    tr: '  - {keyId} [{status}] alanlar={domains} türetme={derivation} oluşturma={createdAt}',
  },
  'provider_authority.keyring.project_scope_note': {
    en: 'Note: this material is deliberately stored OUTSIDE the project tree — the project directory is mounted into workers, so a project-scoped authority key would be worker-readable.',
    tr: 'Not: bu materyal bilinçli olarak proje ağacının DIŞINDA tutulur — proje dizini worker\'lara mount edilir, proje kapsamlı bir authority anahtarı worker tarafından okunabilir olurdu.',
  },
  'provider_authority.keyring.init_created': {
    en: 'Provisioned: keyring {keyringId} revision {revision} (hash {revisionHash}) at {dir}. Key material was generated locally and never printed.',
    tr: 'Sağlandı: keyring {keyringId} revizyon {revision} (hash {revisionHash}) — {dir}. Anahtar materyali yerel üretildi ve hiç yazdırılmadı.',
  },
  'provider_authority.keyring.init_exists': {
    en: 'Refused: a keyring already exists ({keyringId}, revision {revision}). Use `rotate --expect-revision {revisionHash}` to roll the active key; init never overwrites.',
    tr: 'Reddedildi: keyring zaten var ({keyringId}, revizyon {revision}). Aktif anahtarı döndürmek için `rotate --expect-revision {revisionHash}`; init asla üzerine yazmaz.',
  },
  'provider_authority.keyring.rotated': {
    en: 'Rotated: revision {revision} (hash {revisionHash}), active key {activeKeyId}. Retired keys stay verifiable.',
    tr: 'Döndürüldü: revizyon {revision} (hash {revisionHash}), aktif anahtar {activeKeyId}. Emekli anahtarlar doğrulanabilir kalır.',
  },
  'provider_authority.keyring.rotate_needs_revision': {
    en: 'Refused: --expect-revision <hash> is required. Read the current hash from `deckent provider-authority keyring status`.',
    tr: 'Reddedildi: --expect-revision <hash> zorunludur. Güncel hash\'i `deckent provider-authority keyring status` çıktısından alın.',
  },
  'provider_authority.keyring.rotate_absent': {
    en: 'Refused: no keyring to rotate. Provision one first with `deckent provider-authority keyring init`.',
    tr: 'Reddedildi: döndürülecek keyring yok. Önce `deckent provider-authority keyring init` ile sağlayın.',
  },
  // ─── provider-authority limits (owner-authored policy from live truth) ────
  'provider_authority.limits.cmd_desc': {
    en: 'Provider-limit authority — author the `provider_limits` policy from live provider truth',
    tr: 'Provider-limit authority — `provider_limits` politikasını canlı provider gerçeğinden yaz',
  },
  'provider_authority.limits.init_desc': {
    en: 'Derive and write the global `provider_limits` block for one exact provider scope (owner-confirmed)',
    tr: 'Tek bir kesin provider kapsamı için global `provider_limits` bloğunu türet ve yaz (sahip onaylı)',
  },
  'provider_authority.limits.opt_provider': {
    en: 'Canonical provider id the policy is authored for',
    tr: 'Politikanın yazılacağı kanonik provider id',
  },
  'provider_authority.limits.opt_model': {
    en: 'Exact model api id the live limit source is asked about',
    tr: 'Canlı limit kaynağına sorulacak kesin model api id',
  },
  'provider_authority.limits.opt_auth_mode': {
    en: 'Exact auth mode: subscription | api | hybrid | local',
    tr: 'Kesin auth modu: subscription | api | hybrid | local',
  },
  'provider_authority.limits.opt_transport': {
    en: 'Exact transport: cli | api | http | local-runtime',
    tr: 'Kesin transport: cli | api | http | local-runtime',
  },
  'provider_authority.limits.opt_execution_backend': {
    en: 'Exact execution backend: host-subprocess | docker | tmux | api | in-process',
    tr: 'Kesin execution backend: host-subprocess | docker | tmux | api | in-process',
  },
  'provider_authority.limits.opt_execution_profile_ref': {
    en: 'Adapter-owned execution profile reference the account authority is scoped to',
    tr: 'Account authority kapsamındaki adapter sahipli execution profile referansı',
  },
  'provider_authority.limits.opt_endpoint_ref_hash': {
    en: 'Optional opaque SHA-256 endpoint reference (never a URL)',
    tr: 'İsteğe bağlı opak SHA-256 endpoint referansı (asla URL değil)',
  },
  'provider_authority.limits.opt_tenant': {
    en: 'Tenant id the policy is authored for (solo hosts use `local`)',
    tr: 'Politikanın yazılacağı tenant id (tek kullanıcılı host `local` kullanır)',
  },
  'provider_authority.limits.opt_warn_at_ratio': {
    en: 'Consumption ratio (0..1) at which a run is warned',
    tr: 'Run\'ın uyarılacağı tüketim oranı (0..1)',
  },
  'provider_authority.limits.opt_block_at_ratio': {
    en: 'Consumption ratio (0..1) at which a run is blocked (must be >= warn)',
    tr: 'Run\'ın bloklanacağı tüketim oranı (0..1; warn değerinden küçük olamaz)',
  },
  'provider_authority.limits.opt_ratio_enforcement': {
    en: 'Ratio gate mode: enforce (default) or observe_only; absolute floors and unknown evidence still fail closed',
    tr: 'Ratio gate modu: enforce (varsayılan) veya observe_only; absolute floor ve unknown evidence yine fail-closed kalır',
  },
  'provider_authority.limits.needs_scope': {
    en: 'Refused: an exact scope is required — pass --provider, --model, --auth-mode, --transport, --execution-backend, --execution-profile-ref, --warn-at-ratio and --block-at-ratio. A provider-limit selector is never inferred.',
    tr: 'Reddedildi: kesin kapsam zorunlu — --provider, --model, --auth-mode, --transport, --execution-backend, --execution-profile-ref, --warn-at-ratio ve --block-at-ratio verin. Provider-limit selector asla tahmin edilmez.',
  },
  'provider_authority.limits.invalid_ratio': {
    en: 'Refused: --warn-at-ratio and --block-at-ratio must be finite numbers between 0 and 1.',
    tr: 'Reddedildi: --warn-at-ratio ve --block-at-ratio 0 ile 1 arasında sonlu sayılar olmalıdır.',
  },
  'provider_authority.limits.invalid_enforcement': {
    en: 'Refused: --ratio-enforcement must be enforce or observe_only.',
    tr: 'Reddedildi: --ratio-enforcement enforce veya observe_only olmalıdır.',
  },
  'provider_authority.limits.sources_unavailable': {
    en: 'HOLD: no live provider evidence source authority is registered on this host, so account and quota identity cannot be observed. The policy is deliberately NOT authored from placeholder values — register a live evidence source bundle first.',
    tr: 'HOLD: bu host\'ta kayıtlı canlı provider evidence kaynak yetkisi yok, bu yüzden hesap ve kota kimliği gözlemlenemiyor. Politika bilinçli olarak yer-tutucu değerlerden YAZILMAZ — önce canlı evidence kaynak paketi kaydedin.',
  },
  'provider_authority.limits.hold': {
    en: 'HOLD ({reasonCode}): {detail}\nEvidence: {evidenceRef}\nNothing was written — a provider-limit selector is only ever authored from live provider truth.',
    tr: 'HOLD ({reasonCode}): {detail}\nKanıt: {evidenceRef}\nHiçbir şey yazılmadı — provider-limit selector yalnızca canlı provider gerçeğinden yazılır.',
  },
  'provider_authority.limits.preview': {
    en: 'Derived from live provider truth:\n  provider={provider} authMode={authMode} transport={transport} backend={executionBackend}\n  tenant={tenantId} accountRefHash={accountRefHash} quotaScopeRefHash={quotaScopeRefHash}\n  windows={windows}\n  ratioEnforcement={ratioEnforcement} warnAtRatio={warnAtRatio} blockAtRatio={blockAtRatio}\n  action={action} expectedAuthorityRef={expectedAuthorityRef}\n  authorityRef={authorityRef} policyRef={policyRef}',
    tr: 'Canlı provider gerçeğinden türetildi:\n  provider={provider} authMode={authMode} transport={transport} backend={executionBackend}\n  tenant={tenantId} accountRefHash={accountRefHash} quotaScopeRefHash={quotaScopeRefHash}\n  pencereler={windows}\n  ratioEnforcement={ratioEnforcement} warnAtRatio={warnAtRatio} blockAtRatio={blockAtRatio}\n  eylem={action} expectedAuthorityRef={expectedAuthorityRef}\n  authorityRef={authorityRef} policyRef={policyRef}',
  },
  'provider_authority.limits.confirm': {
    en: 'Apply this CAS-guarded provider_limits transition to the global config layer?',
    tr: 'Bu CAS-korumalı provider_limits geçişi global config katmanına uygulansın mı?',
  },
  'provider_authority.limits.aborted': {
    en: 'Aborted by owner — nothing was written.',
    tr: 'Sahibi tarafından iptal edildi — hiçbir şey yazılmadı.',
  },
  'provider_authority.limits.written': {
    en: 'Applied ({action}): provider_limits authority {authorityRef} at {configPath}.',
    tr: 'Uygulandı ({action}): provider_limits authority {authorityRef} — {configPath}.',
  },
  'provider_authority.limits.refused': {
    en: 'Refused ({reasonCode}): {detail}. No provider-limit authority was changed.',
    tr: 'Reddedildi ({reasonCode}): {detail}. Hiçbir provider-limit authority değiştirilmedi.',
  },

  // ─── provider-observation schema migration ───────────────────────────────
  // Migration mechanics return typed facts only. This CLI-owned catalog is the
  // sole place where those facts become operator-facing prose.
  'provider_observation.migration.inspect': {
    en: 'Provider observation migration inspection: source={sourcePath}, schema={schemaVersion}, action={action}.',
    tr: 'Provider observation migration incelemesi: kaynak={sourcePath}, şema={schemaVersion}, işlem={action}.',
  },
  'provider_observation.migration.dry_run': {
    en: 'Dry-run: provider observations would be migrated to schema v2; nothing was written.',
    tr: 'Dry-run: provider observation kayıtları şema v2’ye taşınacaktı; hiçbir şey yazılmadı.',
  },
  'provider_observation.migration.pending_approval': {
    en: 'Migration is pending approval {approvalId}; no provider observation state was changed.',
    tr: 'Migration {approvalId} onayını bekliyor; hiçbir provider observation durumu değiştirilmedi.',
  },
  'provider_observation.migration.backup': {
    en: 'Backup created at {backupPath} before provider observation migration.',
    tr: 'Provider observation migration öncesinde {backupPath} konumunda yedek oluşturuldu.',
  },
  'provider_observation.migration.migrated': {
    en: 'Migrated {count} provider observation record(s) to schema v2.',
    tr: '{count} provider observation kaydı şema v2’ye taşındı.',
  },
  'provider_observation.migration.adopted': {
    en: 'Adopted existing schema-v2 provider observations at {path}.',
    tr: '{path} konumundaki mevcut şema-v2 provider observation kayıtları benimsendi.',
  },
  'provider_observation.adoption.receipt_persisted': {
    en: 'Adoption receipt {receiptId} persisted.',
    tr: 'Adoption receipt {receiptId} kalıcılaştırıldı.',
  },
  'provider_observation.adoption.replay_verified': {
    en: 'Adoption receipt {receiptId} replay verified.',
    tr: 'Adoption receipt {receiptId} replay doğrulandı.',
  },
  'provider_observation.adoption.hold': {
    en: 'ADOPTION_HOLD ({reasonCode}): {detail}. No receipt was persisted and existing provider observations were preserved.',
    tr: 'ADOPTION_HOLD ({reasonCode}): {detail}. Receipt kalıcılaştırılmadı ve mevcut provider observation kayıtları korundu.',
  },
  'provider_observation.runtime_adoption.preimage': {
    en: 'Project-relative immutable schema-v1 provider-observation preimage.',
    tr: 'Proje göreli değişmez şema-v1 provider-observation ön görüntüsü.',
  },
  'provider_observation.runtime_adoption.apply': {
    en: 'Publish the provider and composite runtime-adoption receipts for the exact plan.',
    tr: 'Tam plan için provider ve bileşik runtime-adoption makbuzlarını yayımla.',
  },
  'provider_observation.runtime_adoption.plan_digest': {
    en: 'Exact SHA-256 digest from the runtime-adoption dry-run.',
    tr: 'Runtime-adoption dry-run çıktısındaki tam SHA-256 özeti.',
  },
  'provider_observation.runtime_adoption.dry_run': {
    en: 'Runtime-adoption dry-run verified; plan {planDigest}; nothing was written.',
    tr: 'Runtime-adoption dry-run doğrulandı; plan {planDigest}; hiçbir şey yazılmadı.',
  },
  'provider_observation.runtime_adoption.receipt_persisted': {
    en: 'Runtime adoption persisted provider receipt {providerReceiptId} and composite receipt {runtimeReceiptId}.',
    tr: 'Runtime adoption provider makbuzu {providerReceiptId} ve bileşik makbuz {runtimeReceiptId} kalıcılaştırıldı.',
  },
  'provider_observation.runtime_adoption.replay_verified': {
    en: 'Runtime adoption replay verified provider receipt {providerReceiptId} and composite receipt {runtimeReceiptId}.',
    tr: 'Runtime adoption replay’i provider makbuzu {providerReceiptId} ve bileşik makbuz {runtimeReceiptId} için doğrulandı.',
  },
  'provider_observation.runtime_adoption.hold': {
    en: 'RUNTIME_ADOPTION_HOLD ({reasonCode}): no database was changed and no composite receipt was accepted.',
    tr: 'RUNTIME_ADOPTION_HOLD ({reasonCode}): hiçbir veritabanı değiştirilmedi ve hiçbir bileşik makbuz kabul edilmedi.',
  },
  'provider_observation.migration.already_v2': {
    en: 'Provider observations already use schema v2; no migration was required.',
    tr: 'Provider observation kayıtları zaten şema v2 kullanıyor; migration gerekmedi.',
  },
  'provider_observation.migration.hold': {
    en: 'HOLD ({reasonCode}): {detail}. Existing provider observations were preserved.',
    tr: 'HOLD ({reasonCode}): {detail}. Mevcut provider observation kayıtları korundu.',
  },
  'provider_observation.migration.error': {
    en: 'Provider observation migration failed ({errorCode}): {detail}.',
    tr: 'Provider observation migration başarısız oldu ({errorCode}): {detail}.',
  },
  'provider_observation.migration.forensic_counts': {
    en: 'Forensic summary: inspected={inspected}, eligible={eligible}, migrated={migrated}, adopted={adopted}, held={held}, rejected={rejected}.',
    tr: 'Forensic özet: incelenen={inspected}, uygun={eligible}, taşınan={migrated}, benimsenen={adopted}, bekletilen={held}, reddedilen={rejected}.',
  },
  'provider_observation.reconciliation.run_id': {
    en: 'Optional run ID filter; repeat to narrow the reconciliation batch.',
    tr: 'İsteğe bağlı run kimliği filtresi; uzlaştırma batch’ini daraltmak için tekrarlayın.',
  },
  'provider_observation.reconciliation.inspect': {
    en: 'Reconciliation inspection: {activeOpenCount} active open provider observation(s).',
    tr: 'Uzlaştırma incelemesi: {activeOpenCount} etkin açık provider observation kaydı.',
  },
  'provider_observation.reconciliation.dry_run': {
    en: 'Dry-run batch plan: {runCount} run(s), {candidateCount} candidate(s), {holdCount} HOLD; nothing was changed.',
    tr: 'Dry-run batch planı: {runCount} run, {candidateCount} aday, {holdCount} HOLD; hiçbir şey değiştirilmedi.',
  },
  'provider_observation.reconciliation.pending_approval': {
    en: 'Reconciliation batch is pending Deckent approval {approvalId}; no provider observation was changed.',
    tr: 'Uzlaştırma batch’i Deckent onayı {approvalId} bekliyor; hiçbir provider observation değiştirilmedi.',
  },
  'provider_observation.reconciliation.applied': {
    en: 'Reconciliation batch applied; approval-bound receipt {receiptId} was verified.',
    tr: 'Uzlaştırma batch’i uygulandı; onaya bağlı makbuz {receiptId} doğrulandı.',
  },
  'provider_observation.reconciliation.replay_verified': {
    en: 'Reconciliation approval-bound receipt {receiptId} replay verified.',
    tr: 'Uzlaştırma onaya bağlı makbuzu {receiptId} yeniden oynatma için doğrulandı.',
  },
  'provider_observation.reconciliation.apply': {
    en: 'Apply only after an exact plan digest and Deckent approval ID are supplied.',
    tr: 'Yalnızca tam plan özeti ve Deckent onay kimliği verildiğinde uygula.',
  },
  'provider_observation.reconciliation.plan_digest': {
    en: 'Exact SHA-256 digest of the inspected reconciliation plan.',
    tr: 'İncelenen uzlaştırma planının tam SHA-256 özeti.',
  },
  'provider_observation.reconciliation.approval_id': {
    en: 'Deckent approval ID for this exact reconciliation plan.',
    tr: 'Bu tam uzlaştırma planının Deckent onay kimliği.',
  },
  'provider_observation.reconciliation.hold': {
    en: 'RECONCILIATION_HOLD ({reasonCode}): no provider observation was changed.',
    tr: 'UZLAŞTIRMA_BEKLET ({reasonCode}): hiçbir provider observation değiştirilmedi.',
  },
  'doctor.provider_limit_authority_name': {
    en: 'Provider limit authority',
    tr: 'Provider limit authority',
  },
  'doctor.provider_limit_authority_ok': {
    en: 'Authored global provider_limits present ({policies} policy(ies)) — the xverify/execution composition can resolve limit scope.',
    tr: 'Global provider_limits bloğu mevcut ({policies} policy) — xverify/execution composition limit scope çözebilir.',
  },
  'doctor.provider_limit_authority_absent': {
    en: 'No owner-authored provider_limits block in the global config layer — the composition holds with provider-authority-unavailable. Remedy: `deckent provider-authority limits init` (never `keyring init`; the keyring is a different authority).',
    tr: "Global config katmanında owner-yazarı provider_limits bloğu yok — composition provider-authority-unavailable ile durur. Çare: `deckent provider-authority limits init` (`keyring init` DEĞİL; keyring farklı bir authority'dir).",
  },
  'doctor.provider_limit_authority_authored_empty': {
    en: 'provider_limits block exists but carries zero policies (authored-empty) — the validator refuses it and the composition still holds. Complete authoring with `deckent provider-authority limits init`.',
    tr: 'provider_limits bloğu var ama sıfır policy taşıyor (authored-empty) — validator reddeder, composition durmaya devam eder. Authoring akışını `deckent provider-authority limits init` ile tamamlayın.',
  },
  'doctor.provider_authority_keyring_name': {
    en: 'Provider authority keyring',
    tr: 'Provider authority keyring',
  },
  'doctor.provider_authority_keyring_ok': {
    en: 'provisioned (revision {revision})',
    tr: 'sağlanmış (revizyon {revision})',
  },
  'doctor.provider_authority_keyring_absent': {
    en: 'not provisioned — every run will hold with `keyring_unavailable`; owner remedy: `deckent provider-authority keyring init`',
    tr: 'sağlanmamış — her run `keyring_unavailable` ile bekler; sahip çözümü: `deckent provider-authority keyring init`',
  },
  'doctor.provider_authority_keyring_unreadable': {
    en: 'unreadable ({code}) — runs will hold; inspect with `deckent provider-authority keyring status`',
    tr: 'okunamıyor ({code}) — run\'lar bekler; `deckent provider-authority keyring status` ile inceleyin',
  },
  // Row 477: E_MODEL_PRICING_UNVERIFIED previously fell into the generic
  // provider_unverified message, which tells the user to "pass --provider" they
  // already passed — misleading. The real remedy is refreshing the verified
  // pricing inventory.
  // ─── xverify — session-level adversarial cross-verification (XVERIFY-TOOL) ──
  'xverify.cmd_desc': {
    en: 'Cross-verify a claim on a DIFFERENT provider; the host derives ALLOW/NO-GO/HOLD from typed evidence',
    tr: 'Bir iddiayı FARKLI sağlayıcıda çapraz doğrula; ALLOW/NO-GO/HOLD kararını typed kanıttan host üretir',
  },
  // ─── approvals — runtime-wide approval inbox + local-terminal decision ──
  'approvals.cmd_desc': {
    en: 'Runtime-wide approval inbox — list pending requests and decide them over the live-authenticated local-terminal channel',
    tr: 'Runtime-genelinde onay kutusu — bekleyen istekleri listele ve canlı-doğrulamalı local-terminal kanalından karara bağla',
  },
  'approvals.list_desc': {
    en: 'List pending approval requests',
    tr: 'Bekleyen onay isteklerini listele',
  },
  'approvals.decide_desc': {
    en: 'Decide one pending approval request; requires an interactive TTY re-authentication',
    tr: 'Bekleyen bir onay isteğini karara bağla; interaktif TTY yeniden-doğrulaması gerektirir',
  },
  'approvals.opt_allow': {
    en: 'Approve the request',
    tr: 'İsteği onayla',
  },
  'approvals.opt_deny': {
    en: 'Deny the request',
    tr: 'İsteği reddet',
  },
  'approvals.opt_reason': {
    en: 'Optional decision reason recorded with the outcome',
    tr: 'Sonuçla birlikte kaydedilecek isteğe bağlı karar gerekçesi',
  },
  'approvals.decide_requires_action': {
    en: 'Exactly one of --allow or --deny is required',
    tr: '--allow veya --deny seçeneklerinden tam olarak biri gereklidir',
  },
  'approvals.authority_disabled': {
    en: 'The approval authority is not enabled — author approval.authority.enabled=true (with tenant_id) in the owner config',
    tr: 'Approval authority etkin değil — owner config\'inde approval.authority.enabled=true (tenant_id ile) yazılmalı',
  },
  'approvals.terminal_window_missing': {
    en: 'The local-terminal re-auth window is not authored — set approval.authority.terminal.max_auth_age_seconds in the owner config',
    tr: 'Local-terminal yeniden-doğrulama penceresi yazılmamış — owner config\'inde approval.authority.terminal.max_auth_age_seconds ayarlanmalı',
  },
  'approvals.runtime_hold': {
    en: 'Approval authority runtime HOLD — reason: {reason}, detail: {detail}',
    tr: 'Approval authority runtime HOLD — neden: {reason}, detay: {detail}',
  },
  'approvals.none_pending': {
    en: 'No pending approval requests',
    tr: 'Bekleyen onay isteği yok',
  },
  'approvals.pending_line': {
    en: '⏳ #{code} · {id} — {summary} (valid until {expiresAt})',
    tr: '⏳ #{code} · {id} — {summary} (son geçerlilik: {expiresAt})',
  },
  'approvals.decide_context': {
    en: 'You are deciding: {summary}\n  Target: {provider}/{model} · {backendScope}\n  Ceiling: at most {maxTokens} tokens · at most {timeoutSec}s of run time\n  What it grants: ONE single limited reachability check of exactly this target — nothing else\n  Valid until: {expiresAt}',
    tr: 'Onayladığın şey: {summary}\n  Hedef: {provider}/{model} · {backendScope}\n  Üst sınır: en çok {maxTokens} jeton · en çok {timeoutSec} saniye çalışma süresi\n  Verdiği yetki: yalnızca bu hedef için TEK bir sınırlı erişim denemesi — başka hiçbir şey değil\n  Son geçerlilik: {expiresAt}',
  },
  'approvals.decided_effect': {
    en: 'What happens now: the waiting job takes this one-time approval, runs the single limited check, and records whether this target is reachable.',
    tr: 'Şimdi ne olacak: bekleyen iş bu tek kullanımlık onayı alır, tek seferlik sınırlı denemeyi yapar ve bu hedefin erişilebilir olup olmadığını kaydeder.',
  },
  'approvals.confirm_prompt': {
    en: 'Confirm your identity to {action} this request: type "yes" to approve as the operator at this terminal: ',
    tr: 'İşlemi {action} için kimliğini doğrula: bu terminaldeki yetkili olarak onaylıyorsan "yes" yaz: ',
  },
  'approvals.action_allow': { en: 'approve', tr: 'onayla' },
  'approvals.action_deny': { en: 'deny', tr: 'reddet' },
  'approvals.decided': {
    en: '✓ Request {id} decided: {action} (identity-verified, this terminal)',
    tr: '✓ İstek {id} karara bağlandı: {action} (kimlik doğrulandı, bu terminal)',
  },
  'approvals.decision_refused': {
    en: 'The decision was not recorded for {id} — result: {kind}, reason: {reason}',
    tr: '{id} için karar kaydedilmedi — sonuç: {kind}, neden: {reason}',
  },
  'xverify.prepare.approval_summary': {
    en: 'Authorize a bounded reachability probe for verifier {provider}/{model} (docker, owner-budgeted)',
    tr: '{provider}/{model} hakemi için sınırlı reachability probe yetkilendir (docker, owner bütçeli)',
  },
  'xverify.prepare.hold': {
    en: 'Candidate evidence preparation HOLD — reason: {reason}, detail: {detail}, evidence: {evidence}. The run continues; the composition will report the same typed hold.',
    tr: 'Aday kanıt hazırlığı HOLD — neden: {reason}, detay: {detail}, kanıt: {evidence}. Koşu devam ediyor; kompozisyon aynı typed hold\'u raporlayacak.',
  },
  'xverify.prepare.waiting_approval': {
    en: 'waiting-approval: {requestId} — decide via `deckent approvals decide {requestId}`',
    tr: 'onay-bekleniyor: {requestId} — karar için: `deckent approvals decide {requestId}`',
  },
  'xverify.prepare.approval_wait_timeout': {
    en: 'approval wait bounded by --timeout ({timeoutMs} ms) expired — request {requestId} is still undecided; reporting the typed approval_undecided hold.',
    tr: '--timeout ile sınırlanan onay bekleyişi ({timeoutMs} ms) doldu — {requestId} isteği hâlâ karara bağlanmadı; typed approval_undecided hold raporlanıyor.',
  },
  'xverify.remedy.limit_unit_unreservable': {
    en: 'The verifier is a subscription provider whose only limit windows are advisory percent-remaining — never numerically reservable, so the adjudication call cannot open a reservation. Either provision a metered/API path for the verifier (usd/token windows), or set cross_verify.allow_non_reservable_subscription_adjudication: true in the owner config to admit it via the typed non-reservable outcome.',
    tr: 'Hakem, tek limit penceresi advisory yüzde-kalan olan bir abonelik sağlayıcısı — sayısal olarak rezerve edilemez, bu yüzden adjudication çağrısı rezervasyon açamaz. Ya hakem için metered/API yolu sağlayın (usd/token pencereleri), ya da owner config\'inde cross_verify.allow_non_reservable_subscription_adjudication: true yaparak typed non-reservable sonucuyla kabul edin.',
  },
  'xverify.remedy.model_inactive': {
    en: 'Missing authority: the verifier model is inactive in the project owner policy. Activate the exact model with deckent models activate, then rerun xverify.',
    tr: 'Eksik yetki: hakem modeli proje sahibinin politikasında pasif. Tam modeli deckent models activate ile etkinleştirip xverify komutunu yeniden çalıştırın.',
  },
  'xverify.remedy.model_activation_authority_unavailable': {
    en: 'Missing authority: the project model-activation store exists but cannot be read safely. Repair its availability or schema before retrying; no verifier call was made.',
    tr: 'Eksik yetki: proje model-aktivasyon deposu var ancak güvenle okunamıyor. Yeniden denemeden önce erişimini veya şemasını düzeltin; hakem çağrısı yapılmadı.',
  },
  'xverify.remedy.usage_unavailable': {
    en: 'The Fable-to-Sol call dispatched, but the canonical transport reported no usable usage, so no numbers were fabricated and the package stays OPEN. Confirm the verifier CLI emits its token counters (provider version/flags), then rerun xverify.',
    tr: 'Fable-Sol çağrısı yapıldı, ancak canonical transport kullanılabilir usage raporlamadı; hiçbir sayı uydurulmadı ve paket OPEN kalıyor. Hakem CLI\'ının token sayaçlarını yaydığını doğrulayın (sağlayıcı sürümü/bayrakları), sonra xverify\'ı yeniden çalıştırın.',
  },
  'xverify.remedy.adjudication_budget_unavailable': {
    en: 'The non-reservable subscription adjudication requires an owner-authored execution_budget.purposes.xverify-adjudication profile with a positive maxTokens ceiling and wall clock; it is missing or its total-token ceiling is not positive, so the arm holds rather than dispatch without a ceiling. Add the profile (maxTokens, maxWallClockSeconds, maxVerificationsPerSprint) to the owner config, then rerun xverify.',
    tr: 'Non-reservable abonelik adjudication\'ı, pozitif maxTokens tavanı ve wall-clock içeren owner-authored bir execution_budget.purposes.xverify-adjudication profili ister; profil eksik ya da total-token tavanı pozitif değil, bu yüzden kol tavansız dispatch etmek yerine HOLD veriyor. Owner config\'ine profili (maxTokens, maxWallClockSeconds, maxVerificationsPerSprint) ekleyip xverify\'ı yeniden çalıştırın.',
  },
  'xverify.remedy.provider_authority_unavailable': {
    en: 'Missing authority: the provider-limit authority runtime. Author the provider_limits envelope (owner config) so the runtime opens, then retry.',
    tr: 'Eksik authority: provider-limit authority runtime\'ı. Owner config\'inde provider_limits envelope\'unu yazın ki runtime açılsın, sonra yeniden deneyin.',
  },
  'xverify.remedy.backend_identity_unavailable': {
    en: 'Missing authority: the digest-pinned Docker runtime identity. Ensure the docker daemon runs and the pinned verifier image (with the provider CLI) is present, then retry.',
    tr: 'Eksik authority: digest-pinli Docker runtime kimliği. Docker daemon\'ın çalıştığından ve pinli verifier imajının (provider CLI ile) mevcut olduğundan emin olun, sonra yeniden deneyin.',
  },
  'xverify.remedy.budget_profile_unavailable': {
    en: 'Missing authority: the owner-authored probe budget. Author execution_budget.purposes.reachability-probe (token ceilings + timeout; usd only for metered API) in the owner config.',
    tr: 'Eksik authority: owner-authored probe bütçesi. Owner config\'inde execution_budget.purposes.reachability-probe yazın (token tavanları + timeout; usd yalnız metered API için).',
  },
  'xverify.remedy.approval_authority_unavailable': {
    en: 'Missing authority: the approval authority runtime. Enable approval.authority (enabled + tenant_id, plus terminal.max_auth_age_seconds for local-terminal decisions) in the owner config.',
    tr: 'Eksik authority: approval authority runtime\'ı. Owner config\'inde approval.authority\'yi etkinleştirin (enabled + tenant_id, local-terminal kararları için terminal.max_auth_age_seconds ile).',
  },
  'xverify.remedy.approval_undecided': {
    en: 'Missing authority: a live-authenticated probe decision. Decide request {requestId} via `deckent approvals decide {requestId} --allow` at an interactive terminal, then rerun xverify.',
    tr: 'Eksik authority: canlı-doğrulamalı probe kararı. İnteraktif terminalde `deckent approvals decide {requestId} --allow` ile {requestId} isteğini karara bağlayın, sonra xverify\'ı yeniden çalıştırın.',
  },
  'xverify.remedy.approval_rejected': {
    en: 'The probe approval {requestId} was denied by the operator. No probe will run for this scope until a new request is approved.',
    tr: 'Probe onayı {requestId} operatör tarafından reddedildi. Yeni bir istek onaylanana kadar bu scope için probe çalışmayacak.',
  },
  'xverify.remedy.approval_untrusted': {
    en: 'The decision for {requestId} carried no live re-authentication and was refused fail-closed. Decide it over a live-authenticated channel (interactive `deckent approvals decide` or the OIDC API).',
    tr: '{requestId} kararı canlı yeniden-doğrulama taşımadığı için fail-closed reddedildi. Kararı canlı-doğrulamalı kanaldan verin (interaktif `deckent approvals decide` veya OIDC API).',
  },
  'xverify.remedy.approval_consumed': {
    en: 'The probe approval {requestId} was already consumed by a prior attempt (single-use). Approve a fresh request to authorize another probe.',
    tr: 'Probe onayı {requestId} önceki bir deneme tarafından tüketildi (tek-kullanımlık). Yeni bir probe yetkilendirmek için taze bir isteği onaylayın.',
  },
  'xverify.remedy.evidence_refresh_hold': {
    en: 'The canonical evidence producer held: {producerReason}. Cooldown/singleflight holds clear by themselves after their window; other reasons name the exact failing source.',
    tr: 'Canonical evidence producer hold verdi: {producerReason}. Cooldown/singleflight hold\'ları pencereleri dolunca kendiliğinden açılır; diğer nedenler hatalı kaynağı adıyla belirtir.',
  },
  'xverify.opt_author': {
    en: 'Provider that authored the claimed work ({providers}) — the verifier must differ. Required.',
    tr: 'İddia edilen işi yapan sağlayıcı ({providers}) — hakem farklı olmak zorundadır. Zorunlu.',
  },
  'xverify.opt_verifier': {
    en: 'Explicit verifier provider (optional; must differ from --author; default: cross_verify.verifier_priority)',
    tr: 'Açık hakem sağlayıcısı (opsiyonel; --author ile aynı olamaz; varsayılan: cross_verify.verifier_priority)',
  },
  'xverify.opt_verifier_model': {
    en: 'Explicit verifier model id (canonical provider API id, e.g. gpt-5.6-sol) — bypasses tier-equivalence resolution, never the author tier floor',
    tr: 'Açık hakem model kimliği (kanonik sağlayıcı API id, örn. gpt-5.6-sol) — tier-eşdeğerlik çözümlemesini atlar, yazar tier tabanını asla atlamaz',
  },
  'xverify.opt_author_model': {
    en: 'Model id that authored the claimed work (canonical provider API id, e.g. claude-opus-5) — the verifier must run at an equal or higher capability tier. Omitted: the resolved default is used and recorded as low-confidence.',
    tr: 'İddia edilen işi üreten model kimliği (kanonik sağlayıcı API id, örn. claude-opus-5) — hakem eşit veya daha yüksek yetenek tier’ında çalışmak zorundadır. Verilmezse: çözümlenen varsayılan kullanılır ve düşük-güven olarak kaydedilir.',
  },
  'xverify.opt_diff': {
    en: 'Attach `git diff HEAD` as evidence context for the verifier',
    tr: 'Hakeme kanıt bağlamı olarak `git diff HEAD` çıktısını ekle',
  },
  'xverify.opt_files': {
    en: 'Comma-separated list of files the claim says were changed — when --diff is also passed, scopes the attached diff to exactly these paths',
    tr: 'İddianın değiştirildiğini söylediği dosyaların virgülle ayrılmış listesi — --diff de verilirse, eklenen diff tam olarak bu dosyalarla sınırlanır',
  },
  'xverify.opt_target': {
    en: 'Comma-separated bounded targets `path:START-END` (1-based inclusive line range) or `path:symbolName` — extracts an exact excerpt so a large file never needs manual prompt surgery',
    tr: 'Virgülle ayrılmış sınırlı hedefler `path:START-END` (1-tabanlı kapsayıcı satır aralığı) veya `path:symbolName` — büyük bir dosyanın elle prompt cerrahisi gerektirmemesi için tam bir kesit çıkarır',
  },
  'xverify.opt_timeout': {
    en: 'Verifier timeout in milliseconds (default: 300000)',
    tr: 'Hakem zaman aşımı, milisaniye (varsayılan: 300000)',
  },
  'xverify.opt_json': {
    en: 'Machine-readable JSON output (for the MCP twin / session-to-session use)',
    tr: 'Makine-okunur JSON çıktısı (MCP eşi / oturumlar-arası kullanım için)',
  },
  'xverify.err.author_required': {
    en: '--author is required and must be one of: {providers}. The verifier is chosen to DIFFER from it.',
    tr: '--author zorunludur ve şunlardan biri olmalıdır: {providers}. Hakem ondan FARKLI seçilir.',
  },
  'xverify.err.unknown_verifier': {
    en: 'Unknown verifier "{provider}" — valid providers: {providers}.',
    tr: 'Bilinmeyen hakem "{provider}" — geçerli sağlayıcılar: {providers}.',
  },
  'xverify.err.self_verify': {
    en: 'Verifier must differ from --author ("{provider}") — self-verification defeats the purpose of an independent second opinion.',
    tr: 'Hakem --author ("{provider}") ile aynı olamaz — öz-doğrulama bağımsız ikinci görüşün amacını boşa çıkarır.',
  },
  'xverify.err.unknown_author_model': {
    en: 'Unknown --author-model "{model}" — it must be a canonical model id present in the model registry. Omit the flag to fall back to the resolved default (recorded as low-confidence).',
    tr: 'Bilinmeyen --author-model "{model}" — model kayıt defterinde bulunan kanonik bir model kimliği olmalıdır. Çözümlenen varsayılana dönmek için bayrağı hiç vermeyin (düşük-güven olarak kaydedilir).',
  },
  'xverify.err.author_model_provider_mismatch': {
    en: '--author-model "{model}" belongs to provider "{modelProvider}", not the claim author "{author}" — the author model must be one the author provider can actually run.',
    tr: '--author-model "{model}" "{modelProvider}" sağlayıcısına aittir, iddia yazarı "{author}" değil — yazar modeli, yazar sağlayıcısının gerçekten çalıştırabildiği bir model olmalıdır.',
  },
  'xverify.err.verifier_tier_below_author': {
    en: 'Verification refused: verifier model {verifierModel} (tier {verifierTier}) sits BELOW the author model {authorModel} (tier {authorTier}). A second opinion is only worth its cost from an equal or higher capability tier. Pass --verifier-model with an equal-or-higher tier model, or state the true author model with --author-model.',
    tr: 'Doğrulama reddedildi: hakem modeli {verifierModel} (tier {verifierTier}), yazar modeli {authorModel} (tier {authorTier}) tier’ının ALTINDA. İkinci görüş ancak eşit veya daha yüksek yetenek tier’ından geldiğinde maliyetini hak eder. --verifier-model ile eşit-veya-üstü tier bir model verin ya da gerçek yazar modelini --author-model ile bildirin.',
  },
  'xverify.err.verifier_tier_floor_unresolvable': {
    en: 'Verification refused: the author/verifier capability tiers could not be resolved from the model registry ({detail}), so the tier floor cannot be proven. Register the exact model ids or pass --author-model with a canonical registry id.',
    tr: 'Doğrulama reddedildi: yazar/hakem yetenek tier’ları model kayıt defterinden çözümlenemedi ({detail}), bu yüzden tier tabanı kanıtlanamaz. Tam model kimliklerini kaydedin ya da --author-model ile kanonik bir kayıt kimliği verin.',
  },
  'xverify.err.target_invalid_spec': {
    en: 'Malformed --target entry "{spec}" — expected path:START-END (1-based inclusive line range) or path:symbolName.',
    tr: 'Bozuk --target girişi "{spec}" — path:START-END (1-tabanlı kapsayıcı satır aralığı) veya path:symbolName bekleniyordu.',
  },
  'xverify.err.target_file_not_found': {
    en: 'Target file not found: "{path}" — check the path is project-relative and exists.',
    tr: 'Hedef dosya bulunamadı: "{path}" — yolun proje-relative olduğundan ve var olduğundan emin olun.',
  },
  'xverify.err.target_range_invalid': {
    en: 'Target range invalid for "{path}": {start}-{end} (file has {total} lines). Ranges are 1-based and inclusive.',
    tr: '"{path}" için hedef aralık geçersiz: {start}-{end} (dosyada {total} satır var). Aralıklar 1-tabanlı ve kapsayıcıdır.',
  },
  'xverify.err.target_symbol_not_found': {
    en: 'Symbol "{symbol}" not found in "{path}" — pass an exact identifier that appears verbatim in the file, or use a path:START-END line range instead.',
    tr: '"{path}" içinde "{symbol}" sembolü bulunamadı — dosyada aynen geçen tam bir tanımlayıcı verin veya yerine path:START-END satır aralığı kullanın.',
  },
  'xverify.dispatching': {
    en: 'Dispatching adversarial verifier (author: {author}, priority: {priority})…',
    tr: 'Hakem gönderiliyor (iddia sahibi: {author}, öncelik: {priority})…',
  },
  'xverify.verdict': {
    en: 'Verdict: {verdict} (verifier: {verifier}) — host adjudication report: {report}',
    tr: 'Karar: {verdict} (hakem: {verifier}) — host adjudication raporu: {report}',
  },
  'xverify.final_only_risk': {
    en: 'Risk: {verifier} reports usage only when the call ends — token ceilings settle afterwards. Containment for this call is the host wall clock: {seconds}s.',
    tr: 'Risk: {verifier} kullanımı yalnız çağrı bitince bildirir — token tavanları sonradan hesaplanır. Bu çağrının sınırı host duvar-saati: {seconds}sn.',
  },
  'xverify.report.execution': {
    en: '**Execution outcome:** {outcome} (initial attempt: {initial}, terminal attempt: {terminal})',
    tr: '**Çalıştırma sonucu:** {outcome} (ilk deneme: {initial}, terminal deneme: {terminal})',
  },
  'xverify.report.cumulative_usage': {
    en: '**Cumulative host usage:** {turns} turns · {tokens} total tokens · {cacheRead} cache-read tokens',
    tr: '**Kümülatif host kullanımı:** {turns} turn · {tokens} toplam token · {cacheRead} cache-read token',
  },
  'xverify.report.verifier_model': {
    en: '**Verifier model:** {model}',
    tr: '**Hakem modeli:** {model}',
  },
  'xverify.report.author_model': {
    en: '**Author model:** {model} ({confidence})',
    tr: '**Yazar modeli:** {model} ({confidence})',
  },
  'xverify.report.author_model_authoritative': {
    en: 'authoritative — stated via --author-model',
    tr: 'yetkili — --author-model ile bildirildi',
  },
  // The tier floor is only as trustworthy as the author-model input it compares
  // against. A substituted default is recorded as exactly that, never as fact.
  'xverify.report.author_model_low_confidence': {
    en: 'LOW CONFIDENCE — resolved default substituted; --author-model was not stated',
    tr: 'DÜŞÜK GÜVEN — çözümlenen varsayılan konuldu; --author-model bildirilmedi',
  },
  'xverify.report.none_dispatched': {
    en: '(none dispatched)',
    tr: '(çalıştırma yok)',
  },
  'xverify.report.tier_admission.normal-tier-admitted': {
    en: '**Tier admission:** normal tier admission (no owner-pair exception used; host/config policy, not a verifier verdict)',
    tr: '**Tier kabulü:** normal tier kabulü (sahip-çifti istisnası kullanılmadı; host/config politikasıdır, hakem kararı değildir)',
  },
  'xverify.report.tier_admission.owner-pair-admitted': {
    en: '**Tier admission:** owner-pair exception admitted (host/config policy; not a verifier verdict)',
    tr: '**Tier kabulü:** sahip-çifti istisnasıyla kabul edildi (host/config politikasıdır; hakem kararı değildir)',
  },
  'xverify.report.tier_decision_ref': {
    en: '**Owner decision reference:** {decisionRef} (opaque reference; not a verifier verdict)',
    tr: '**Sahip karar referansı:** {decisionRef} (opak referans; hakem kararı değildir)',
  },
  // A verifier that was never dispatched produced no verdict. An em dash says
  // that; UNCLEAR would claim the verifier ran and could not decide.
  'xverify.report.no_verdict': {
    en: '— (no verdict — verifier produced no output)',
    tr: '— (karar yok — hakem çıktı üretmedi)',
  },
  'xverify.remedy.no_evidence': {
    en: 'No bounded evidence attached to this claim — pass --files <path[,path...]>, --diff, and/or --target <path:START-END|path:symbol> so the verifier has something concrete to check; an unevidenced claim is unlikely to produce a confident verdict.',
    tr: 'Bu iddiaya sınırlı kanıt eklenmedi — hakemin kontrol edebileceği somut bir şey olması için --files <path[,path...]>, --diff ve/veya --target <path:START-END|path:symbol> verin; kanıtsız bir iddia kararlı bir karar üretme olasılığı düşüktür.',
  },
  // Worker-facing prompt fragments (deliberately EN-only content, keyed for
  // single-source maintenance — the VERIFIER reads these, not the operator).
  'xverify.go_criteria': {
    en: 'The bounded evidence supports every material factual premise of the claim and, when the claim proposes a dependency order, supports that order without a prerequisite reversal.',
    tr: 'Sınırlı kanıt, iddianın her maddi olgusal öncülünü ve iddia bir bağımlılık sırası öneriyorsa önkoşul tersine dönmeden bu sırayı destekler.',
  },
  'xverify.nogo_criteria': {
    en: 'The bounded evidence directly contradicts a material factual premise or proves a concrete safety, correctness, evidence, or dependency-order gap. Missing evidence alone is not NO-GO; it requires UNCLEAR.',
    tr: 'Sınırlı kanıt, maddi bir olgusal öncülü doğrudan çürütür veya somut bir güvenlik, doğruluk, kanıt ya da bağımlılık-sırası boşluğunu kanıtlar. Eksik kanıt tek başına NO-GO değildir; UNCLEAR gerektirir.',
  },
  'xverify.mcp.title': {
    en: 'Cross-verify (host adjudicated)',
    tr: 'Çapraz doğrula (host kararlı)',
  },
  'xverify.mcp.description': {
    en: 'Dispatch an adversarial verifier on a different provider. Provider output is evidence; the host returns CONFIRMED/REFUTED/UNCLEAR plus an authoritative ALLOW/NO-GO/HOLD disposition.',
    tr: 'Farklı sağlayıcıda adversarial hakem çalıştırır. Sağlayıcı çıktısı kanıttır; host CONFIRMED/REFUTED/UNCLEAR ile yetkili ALLOW/NO-GO/HOLD disposition döndürür.',
  },
  'xverify.mcp.claim': {
    en: 'Exact authored claim to cross-verify',
    tr: 'Çapraz doğrulanacak exact authored iddia',
  },
  'xverify.mcp.author': {
    en: 'Provider that authored the claim; verifier must differ',
    tr: 'İddiayı yazan sağlayıcı; hakem farklı olmalıdır',
  },
  'xverify.mcp.verifier': {
    en: 'Explicit verifier provider; must differ from author',
    tr: 'Açık hakem sağlayıcısı; yazardan farklı olmalıdır',
  },
  'xverify.mcp.verifier_model': {
    en: 'Exact canonical verifier model API id',
    tr: 'Exact kanonik hakem model API kimliği',
  },
  'xverify.mcp.diff': {
    en: 'Record a bounded host-side git diff context; v2 evidence remains broker-owned',
    tr: 'Sınırlı host-side git diff bağlamını kaydet; v2 kanıtı broker yönetir',
  },
  'xverify.mcp.files': {
    en: 'Comma-separated exact project-relative evidence files — scopes the diff evidence to exactly these paths when diff is also requested',
    tr: 'Virgülle ayrılmış exact proje-relative kanıt dosyaları — diff de istenirse, diff kanıtı tam olarak bu dosyalarla sınırlanır',
  },
  'xverify.mcp.timeout': {
    en: 'Verifier timeout in milliseconds (default 300000)',
    tr: 'Hakem zaman aşımı, milisaniye (varsayılan 300000)',
  },
  'xverify.mcp.failed': {
    en: 'xverify failed: {error}',
    tr: 'xverify başarısız: {error}',
  },
  'run.model_err.pricing_unverified': {
    en: 'Cannot use model "{model}": its OpenRouter pricing is unverified. '
      + 'Run `deckent openrouter-probe` to refresh the verified free-model inventory, '
      + 'or supply explicit pricing for a paid model.',
    tr: '"{model}" modeli kullanılamıyor: OpenRouter fiyatlandırması doğrulanmamış. '
      + 'Doğrulanmış ücretsiz-model envanterini yenilemek için `deckent openrouter-probe` çalıştırın '
      + 'veya ücretli bir model için açık fiyatlandırma sağlayın.',
  },

  // ─── plan command ───────────────────────────────────────────────────
  'plan.sprint_planned': {
    en: 'Run {number} (sprint) ({id}) planned with {count} tasks:',
    tr: 'Run {number} (sprint) ({id}) {count} görevle planlandı:',
  },
  'plan.reasoning': {
    en: 'Reasoning: {reasoning}',
    tr: 'Gerekçe: {reasoning}',
  },
  'plan.planning_mode': {
    en: 'Planning mode: {mode}',
    tr: 'Planlama modu: {mode}',
  },
  'plan.note_sprint_size': {
    en: 'Note: Run (sprint) size {size} — {reason}',
    tr: 'Not: Run (sprint) boyutu {size} — {reason}',
  },
  'plan.approved': {
    en: 'Plan approved.',
    tr: 'Plan onaylandı.',
  },
  'plan.rejected': {
    en: 'Plan rejected.',
    tr: 'Plan reddedildi.',
  },
  'plan.force_scope_option': {
    en: 'Acknowledge suspect scope paths for this exact plan',
    tr: 'Bu exact plan için şüpheli kapsam yollarını açıkça kabul et',
  },
  'plan.adopt_existing_option': {
    en: 'Explicitly reconcile an existing legacy Sprint projection into this exact plan',
    tr: 'Mevcut legacy Sprint projection’ını bu exact planla açıkça reconcile et',
  },
  'plan.expected_plan_digest_option': {
    en: 'Owner-observed V4 execution-plan digest required for adoption',
    tr: 'Adoption için gerekli, owner tarafından gözlemlenmiş V4 execution-plan digest’i',
  },
  'plan.expected_projection_digest_option': {
    en: 'Owner-observed legacy task-projection digest required for adoption',
    tr: 'Adoption için gerekli, owner tarafından gözlemlenmiş legacy task-projection digest’i',
  },
  'plan.expected_canonical_projection_digest_option': {
    en: 'Owner-observed post-reconciliation task-projection digest required for adoption',
    tr: 'Adoption için gerekli, owner tarafından gözlemlenmiş reconciliation-sonrası task-projection digest’i',
  },
  'plan.adoption_actor_option': {
    en: 'Stable owner/principal identity authorizing projection adoption',
    tr: 'Projection adoption’ını yetkilendiren kalıcı owner/principal kimliği',
  },
  'plan.adoption_justification_option': {
    en: 'Bound operator justification for the one-time projection adoption',
    tr: 'Tek seferlik projection adoption için bağlanan operator gerekçesi',
  },
  'plan.adoption_authority_required': {
    en: 'Exact adoption requires all three expected digests, an adoption actor, and a justification. Run the adoption dry-run first.',
    tr: 'Exact adoption üç expected digest’in tamamını, adoption actor’ını ve gerekçeyi gerektirir. Önce adoption dry-run çalıştırın.',
  },
  'plan.adoption_dependency_hold': {
    en: 'Projection adoption is on HOLD because the fresh plan contains unresolved dependencies.',
    tr: 'Fresh plan çözümlenmemiş dependency içerdiği için projection adoption HOLD durumunda.',
  },
  'plan.adoption_inspection_ready': {
    en: 'Adoption inspection for {sprintId} is ready with {count} exact tasks; no task file or canonical plan was changed.',
    tr: '{sprintId} için adoption incelemesi {count} exact task ile hazır; hiçbir task dosyası veya canonical plan değiştirilmedi.',
  },
  'plan.adoption_approved': {
    en: 'Legacy projection {sprintId} is bound to the approved exact plan. Its additive schema migration remains admission-gated until exact start.',
    tr: 'Legacy projection {sprintId} onaylı exact plana bağlandı. Additive schema migration, exact start’a kadar admission-gated kalacak.',
  },
  'plan.adoption_hold': {
    en: 'Exact projection adoption is on HOLD: {reason}. Existing task files were preserved.',
    tr: 'Exact projection adoption HOLD durumunda: {reason}. Mevcut task dosyaları korundu.',
  },
  'plan.task_projection_invalid_id': {
    en: 'Exact plan task "{taskId}" cannot be represented as a portable task artifact. The canonical plan was not executed.',
    tr: 'Exact plandaki "{taskId}" görevi portable bir task artifact olarak temsil edilemiyor. Canonical plan yürütülmedi.',
  },
  'plan.task_projection_conflict': {
    en: 'Task artifact "{taskId}" conflicts with the exact plan. Existing files were preserved; explicit reconciliation is required.',
    tr: '"{taskId}" task artifact’i exact planla çakışıyor. Mevcut dosyalar korundu; açık reconciliation gerekiyor.',
  },
  'plan.task_projection_directory_hold': {
    en: 'The project task-artifact directory is outside the verified project boundary or is not a regular directory. Planning is on HOLD.',
    tr: 'Projenin task-artifact dizini doğrulanmış proje sınırının dışında veya regular directory değil. Planlama HOLD durumunda.',
  },
  'plan.task_projection_durability_hold': {
    en: 'The platform could not prove durable atomic publication of the exact plan task artifacts. Existing files were preserved; planning is on HOLD.',
    tr: 'Platform, exact plan task artifact’lerinin durable atomic yayımını kanıtlayamadı. Mevcut dosyalar korundu; planlama HOLD durumunda.',
  },
  'plan.mcp_approve_option': {
    en: 'Approve and durably bind the generated exact plan',
    tr: 'Üretilen exact planı onayla ve durable olarak bağla',
  },
  'plan.mcp_ack_scope_option': {
    en: 'Acknowledge suspect scope paths for this exact plan',
    tr: 'Bu exact plan için şüpheli kapsam yollarını açıkça kabul et',
  },
  'plan.prompt_gate_header': {
    en: 'Prompt-gate — {count} finding(s) (persona × intent / decision-space / scope-contract):',
    tr: 'Prompt-gate — {count} bulgu (persona × intent / karar-alanı / kapsam-kontratı):',
  },
  'plan.prompt_gate_blocked': {
    en: 'Plan blocked by prompt-gate: {count} BLOCK finding(s). Review the findings above (persona / scope-silent-drop / scope-satisfiability), fix the DIRECTIVES accordingly, or re-run with --force-prompt-gate.',
    tr: 'Plan prompt-gate tarafından bloke edildi: {count} BLOCK bulgusu. Yukarıdaki bulguları inceleyin (persona / scope-silent-drop / scope-satisfiability), DIRECTIVES\'i buna göre düzeltin ya da --force-prompt-gate ile yeniden koşun.',
  },
  'plan.prompt_gate_override': {
    en: 'Prompt-gate BLOCK bypassed via --force-prompt-gate ({count}).',
    tr: 'Prompt-gate BLOCK --force-prompt-gate ile atlandı ({count}).',
  },
  'plan.override_warnings_header': {
    en: 'Override warnings — {count} warning(s) (forceAgent/forceSkills routing overrides — advisory, plan proceeds):',
    tr: 'Override uyarıları — {count} uyarı (forceAgent/forceSkills routing override\'ları — bilgilendirme, plan devam eder):',
  },

  // ─── run-flow plan-preview card (TERM-FLOW-UNIFY Sprint-3 dilim, 425-001) ──
  // plan-preview-card.tsx's PlanPreviewCardLabels, sourced via buildPlanPreviewCardLabels(lang).
  'runFlow.planPreview.heading': {
    en: 'Plan preview — approve to continue',
    tr: 'Plan önizlemesi — devam etmek için onayla',
  },
  'runFlow.planPreview.digestLabel': {
    en: 'Digest:',
    tr: 'Özet-imza:',
  },
  'runFlow.planPreview.gate.pass': {
    en: 'GATE: PASS',
    tr: 'GATE: GEÇTİ',
  },
  'runFlow.planPreview.gate.fail': {
    en: 'GATE: FAIL',
    tr: 'GATE: BAŞARISIZ',
  },
  'runFlow.planPreview.gate.skipped': {
    en: 'GATE: SKIPPED',
    tr: 'GATE: ATLANDI',
  },
  'runFlow.planPreview.policy.allow': {
    en: 'POLICY: ALLOW',
    tr: 'POLİTİKA: İZİN VER',
  },
  'runFlow.planPreview.policy.deny': {
    en: 'POLICY: DENY',
    tr: 'POLİTİKA: REDDET',
  },
  'runFlow.planPreview.policy.needsApproval': {
    en: 'POLICY: NEEDS APPROVAL',
    tr: 'POLİTİKA: ONAY GEREKLİ',
  },
  'runFlow.planPreview.hint': {
    en: '(y = approve · n = reject · d = details)',
    tr: '(y = onayla · n = reddet · d = detay)',
  },
  'runFlow.planPreview.detailsHeading': {
    en: 'Details',
    tr: 'Detay',
  },
  'runFlow.planPreview.noTasks': {
    en: '(no tasks)',
    tr: '(görev yok)',
  },
  // Dogfood-449 B1 / 452-003 — scope-gate mirror verdict, shared verbatim by
  // formatScopeGateLines (plan-preview-card.tsx) between the REPL card AND
  // the CLI (do.ts's formatRunFlowDoPreview) — the two must never diverge.
  'runFlow.planPreview.scopeGate.fail': {
    en: 'Scope gate: FAIL',
    tr: 'Scope-gate: BAŞARISIZ',
  },
  'runFlow.planPreview.scopeGate.overridden': {
    en: 'Scope gate: overridden via --force-scope — the child will spawn anyway.',
    tr: 'Scope-gate: --force-scope ile bilinçli geçildi — child yine de doğacak.',
  },
  'runFlow.planPreview.topology.pass': {
    en: 'Execution topology: PASS',
    tr: 'Yürütme topolojisi: GEÇTİ',
  },
  'runFlow.planPreview.topology.block': {
    en: 'Execution topology: BLOCK',
    tr: 'Yürütme topolojisi: BLOKE',
  },
  'runFlow.planPreview.topology.concurrency': {
    en: 'Concurrency (configured/effective):',
    tr: 'Eşzamanlılık (yapılandırılmış/etkin):',
  },
  'runFlow.planPreview.topology.collisions': {
    en: 'Shared writers:',
    tr: 'Ortak yazıcılar:',
  },
  'runFlow.planPreview.topology.syntheticEdges': {
    en: 'Safety edges:',
    tr: 'Güvenlik kenarları:',
  },
  'runFlow.planPreview.topology.waves': {
    en: 'Effective waves:',
    tr: 'Etkin dalgalar:',
  },
  'runFlow.planPreview.topology.findings': {
    en: 'Structural findings:',
    tr: 'Yapısal bulgular:',
  },

  // ─── run-flow REPL mount outcomes (TERM-FLOW-UNIFY Sprint-4 mount, 426-002) ─
  // Pushed as a 'bg' transcript line after approve→start / reject on the
  // PlanPreviewCard — buildRunFlowMountLabels(t) in run.tsx.
  'runFlow.mount.started': {
    en: 'Run started — job {jobId}.',
    tr: 'Run başlatıldı — iş {jobId}.',
  },
  'runFlow.mount.rejected': {
    en: 'Run proposal rejected.',
    tr: 'Run önerisi reddedildi.',
  },
  'runFlow.mount.error': {
    en: 'Run flow error: {error}',
    tr: 'Run akışı hatası: {error}',
  },

  // ─── run-flow correlated result-turn (TERM5-UI, sprint-427 task 6) ────────
  // A flowId-correlated job completion pushed as a rich 'bg' transcript turn
  // (verdict-summary + flowId) — buildRunFlowResultLabels(t) in run.tsx.
  'runFlow.result.completed': {
    en: 'Run {flowId} completed — {done}/{total} DONE · {techDebt} TECH_DEBT · {noGo} NO_GO',
    tr: 'Run {flowId} tamamlandı — {done}/{total} DONE · {techDebt} TECH_DEBT · {noGo} NO_GO',
  },
  'runFlow.result.failed': {
    en: 'Run {flowId} failed: {error}',
    tr: 'Run {flowId} başarısız: {error}',
  },
  // SURF-3 result-evidence — per-task evidence lines below the aggregate header.
  'runFlow.result.evidence_files': {
    en: ' — {files} files · +{added}/-{removed}',
    tr: ' — {files} dosya · +{added}/-{removed}',
  },
  'runFlow.result.evidence_tests': {
    en: ' · tests {mark}{coverage}',
    tr: ' · test {mark}{coverage}',
  },
  'runFlow.result.evidence_more': {
    en: '  … {n} more',
    tr: '  … {n} daha',
  },

  // ─── status command ─────────────────────────────────────────────────
  'status.no_active_sprint': {
    en: 'No active run (sprint). Run `deckent start` first.',
    tr: 'Aktif run (sprint) yok. Önce `deckent start` çalıştırın.',
  },
  'status.pending_approvals.header': {
    en: '⏳ Pending approvals: {count} — act in the run terminal or the dashboard:',
    tr: '⏳ Bekleyen onaylar: {count} — run terminalinde veya dashboard\'tan onayla:',
  },
  'status.pending_approvals.more': {
    en: '… and {count} more (run `deckent nervous` to see all)',
    tr: '… ve {count} tane daha (hepsi için: `deckent nervous`)',
  },
  'pause.notification_title': {
    en: 'Run {sprintId} is paused and awaiting a continuation decision',
    tr: '{sprintId} run’ı duraklatıldı ve devam kararı bekliyor',
  },
  'pause.notification_summary': {
    en: '{reason}. Verify the recovery preview, then continue with: {command}',
    tr: '{reason}. Kurtarma önizlemesini doğrulayıp şu komutla devam edin: {command}',
  },
  'pause.post_fix_circuit_breaker_reason': {
    en: '{unresolved}/{total} logical tasks remain NO_GO after the admitted FIX budget ({ratio}%; count threshold {countThreshold}, ratio threshold {ratioThreshold}%). The run was paused to prevent an unbounded repair cascade.',
    tr: 'Kabul edilen FIX bütçesi sonrasında {unresolved}/{total} logical task hâlâ NO_GO ({ratio}%; sayı eşiği {countThreshold}, oran eşiği %{ratioThreshold}). Sınırsız bir düzeltme zincirini önlemek için run duraklatıldı.',
  },
  'pause.exhausted_repair_blocks_dependents_reason': {
    en: 'The admitted FIX budget is exhausted for {unresolvedTasks}, and unfinished dependent tasks remain blocked: {blockedTasks}. The run was paused with its recovery authority preserved; COMPLETE is not an allowed settlement.',
    tr: '{unresolvedTasks} için kabul edilen FIX bütçesi tükendi ve tamamlanmamış bağımlı task’lar bloke kaldı: {blockedTasks}. Recovery authority korunarak run duraklatıldı; COMPLETE geçerli bir settlement değildir.',
  },
  'pause.unresolved_lineage_operator_decision_reason': {
    en: 'Logical tasks remain unresolved after repair settlement: {unresolvedTasks}. The circuit-breaker threshold was not reached, but COMPLETE is still invalid; the run is paused for an explicit recovery or force-finalize decision.',
    tr: 'Repair settlement sonrasında çözümlenmemiş logical task’lar kaldı: {unresolvedTasks}. Circuit-breaker eşiğine ulaşılmadı ancak COMPLETE yine de geçersiz; run açık bir recover veya force-finalize kararı için duraklatıldı.',
  },
  'pause.action_resume': {
    en: 'Resume',
    tr: 'Sürdür',
  },
  'pause.action_finalize': {
    en: 'Force finalize',
    tr: 'Zorla sonlandır',
  },
  'status.dashboard_read_failed': {
    en: 'Failed to read dashboard file.',
    tr: 'Dashboard dosyası okunamadı.',
  },
  'status.read_model_hold': {
    en: 'RUN_STATUS_READ_MODEL_UNAVAILABLE: live run status is held until the canonical persisted read model is republished.',
    tr: 'RUN_STATUS_READ_MODEL_UNAVAILABLE: canlı run durumu canonical persisted read model yeniden yayımlanana kadar HOLD durumundadır.',
  },
  'status.desc': {
    en: 'Show the current run dashboard',
    tr: 'Güncel run dashboard\'ını göster',
  },
  'status.graph_no_active_run': {
    en: 'No active run found — cannot display dependency graph.',
    tr: 'Aktif run bulunamadı — bağımlılık grafiği gösterilemiyor.',
  },
  'status.graph_not_found': {
    en: 'No dependency graph found for {id}.\nStart a run with dependencies to generate the graph.',
    tr: '{id} için bağımlılık grafiği bulunamadı.\nGrafiği oluşturmak için bağımlılıkları olan bir run başlatın.',
  },
  'status.worker_comms.header': {
    en: '--- Worker Comms ---',
    tr: '--- Worker İletişim ---',
  },
  'status.worker_comms.no_shared': {
    en: 'No shared context.',
    tr: 'Paylaşılan bağlam yok.',
  },
  'status.worker_comms.shared_keys': {
    en: 'Shared context: {count} key(s)',
    tr: 'Paylaşılan bağlam: {count} anahtar',
  },
  'status.worker_comms.handoffs': {
    en: 'Handoffs: {pending} pending / {executed} executed',
    tr: 'Handoff\'lar: {pending} bekliyor / {executed} tamamlandı',
  },
  // Neutral-honest wording (task 590-001): does NOT claim "dependencies" as
  // the sole cause — blocked also covers file-collision ordering.
  'status.blocked': {
    en: 'Blocked: {n} task(s) waiting (dependencies or file-collision ordering)',
    tr: 'Bekleyen: {n} görev (bağımlılık ya da dosya-çakışması sıralaması)',
  },
  'status.next_waiting': {
    en: 'Next: {n} task(s) will start as workers free up',
    tr: 'Sıradaki: {n} görev worker boşaldıkça başlayacak',
  },
  'status.stale_warning': {
    en: 'Warning: Dashboard data is {age} old — may be stale',
    tr: 'Uyarı: Dashboard verisi {age} eski — bayat olabilir',
  },

  // ─── cleanup command ─────────────────────────────────────────────────
  'cleanup.sprint_option': {
    en: 'Clean only artifacts owned by the exact sprint ID',
    tr: 'Yalnız exact sprint ID tarafından owned artifaktları temizle',
  },
  'cleanup.decay_complete': {
    en: 'Decay complete: {before} → {after} lines',
    tr: 'Decay tamamlandı: {before} → {after} satır',
  },
  'cleanup.archived_sprints': {
    en: 'Archived: {sprints}',
    tr: 'Arşivlendi: {sprints}',
  },
  'cleanup.removed_items': {
    en: 'Removed: {debt} debt, {patterns} patterns',
    tr: 'Silindi: {debt} borç, {patterns} desen',
  },
  'cleanup.pruned_expired_approvals': {
    en: '{count} expired pending approval(s) pruned (their timeout passed — no longer actionable).',
    tr: '{count} süresi geçmiş bekleyen onay temizlendi (zaman aşımı doldu — artık işlem yapılamaz).',
  },
  'cleanup.complete': {
    en: 'Cleanup complete. Removed artifacts for {count} tasks.',
    tr: 'Temizlik tamamlandı. {count} görevin artifaktları silindi.',
  },
  'cleanup.authority_hold': {
    en: 'Cleanup held for {sprintId}: {reason}. Recover or finalize the run before removing mutable projections.',
    tr: '{sprintId} cleanup işlemi beklemeye alındı: {reason}. Değişebilir projection kayıtlarını kaldırmadan önce run’ı recover veya finalize edin.',
  },
  'cleanup.archive_hold': {
    en: 'Cleanup held: {count} owned task artifact(s) could not be archived and byte-verified ({files}). Live evidence was retained.',
    tr: 'Cleanup beklemeye alındı: {count} owned task artifaktı arşivlenip byte-verify edilemedi ({files}). Live kanıt korundu.',
  },
  'cleanup.dry_run.archive_header': { en: '[dry-run] Would archive:', tr: '[dry-run] Arşivlenecekler:' },
  'cleanup.dry_run.prompt': { en: '  prompt → archive: {file}', tr: '  prompt → arşiv: {file}' },
  'cleanup.dry_run.delete_header': { en: '[dry-run] Would delete:', tr: '[dry-run] Silinecekler:' },
  'cleanup.dry_run.task': { en: '  task: {file}', tr: '  task: {file}' },
  'cleanup.dry_run.lock': { en: '  lock: {file}', tr: '  lock: {file}' },
  'cleanup.dry_run.task_count': {
    en: '  {count} task file(s) (includes .log and .timeout artifacts)',
    tr: '  {count} task dosyası (.log ve .timeout artifaktları dahil)',
  },
  'cleanup.dry_run.lock_count': { en: '  {count} lock file(s)', tr: '  {count} lock dosyası' },
  'cleanup.dry_run.prompt_count': {
    en: '  {count} prompt file(s) → canonical sprint archive',
    tr: '  {count} prompt dosyası → canonical sprint arşivi',
  },
  'cleanup.dry_run.tmux': { en: '  tmux session: deckent-orchestra', tr: '  tmux session: deckent-orchestra' },
  'cleanup.dry_run.reconcile': {
    en: '  Legacy task archives will be reconciled into the canonical namespace',
    tr: '  Legacy task arşivleri canonical namespace içine uzlaştırılacak',
  },
  'cleanup.dry_run.execute': {
    en: '\nRun without --dry-run to execute.',
    tr: '\nUygulamak için --dry-run olmadan çalıştırın.',
  },
  'cleanup.prompts_archived': {
    en: 'Archived {count} prompt file(s) → canonical archive for {sprintId}',
    tr: '{count} prompt dosyası arşivlendi → {sprintId} canonical arşivi',
  },
  'cleanup.legacy_archives_consolidated': {
    en: 'Consolidated {count} legacy task archive entries into canonical sprint archives',
    tr: '{count} legacy task arşiv dizini canonical sprint arşivlerine birleştirildi',
  },
  'lifecycle.execution_lock_bind_failed': {
    en: 'Project leadership could not be bound to execution {sprintId}.',
    tr: 'Project leadership execution {sprintId} ile bağlanamadı.',
  },
  'lifecycle.coordinator_pid_authority_required': {
    en: 'Coordinator PID authority could not be established for execution {sprintId}.',
    tr: 'Execution {sprintId} için coordinator PID authority oluşturulamadı.',
  },
  'kill.settlements_reconciled': {
    en: 'Closed {count} host-owned execution settlement(s) after containment.',
    tr: 'Containment sonrası {count} host-owned execution settlement kapatıldı.',
  },
  'kill.settlement_recovery_failed': {
    en: 'Workers were contained, but host-owned execution settlement recovery failed: {reason}',
    tr: 'Worker containment tamamlandı ancak host-owned execution settlement recovery başarısız oldu: {reason}',
  },

  // ─── finalize command ────────────────────────────────────────────────
  'finalize.no_tasks': {
    en: 'No tasks found in .tasks/ directory. Nothing to finalize.',
    tr: '.tasks/ dizininde görev bulunamadı. Sonlandırılacak bir şey yok.',
  },
  'finalize.complete': {
    en: 'Run {sprintId} (sprint) finalized: {total} tasks ({done} done, {debt} debt, {noGo} no-go). MEMORY.md, RETRO.md, and config updated.',
    tr: 'Run {sprintId} (sprint) sonlandırıldı: {total} görev ({done} tamam, {debt} borç, {noGo} no-go). MEMORY.md, RETRO.md ve config güncellendi.',
  },
  'finalize.aborted': {
    en: 'Run {sprintId} was force-finalized as ABORTED: {done}/{total} logical tasks were done and {unresolved} remained unresolved. No unresolved lineage was promoted to COMPLETE.',
    tr: 'Run {sprintId}, ABORTED olarak zorla kapatıldı: {total} logical taskın {done} tanesi tamamlanmıştı, {unresolved} tanesi unresolved kaldı. Hiçbir unresolved lineage COMPLETE durumuna yükseltilmedi.',
  },
  'finalize.coordinator_terminated': {
    en: 'Coordinator PID {pid} reached verified termination ({escalation}).',
    tr: 'Coordinator PID {pid} doğrulanmış biçimde sonlandı ({escalation}).',
  },
  'finalize.coordinator_hold': {
    en: 'Finalize held: coordinator PID {pid} could not reach verified termination ({reason}). PID authority was preserved.',
    tr: 'Finalize beklemeye alındı: coordinator PID {pid} doğrulanmış biçimde sonlandırılamadı ({reason}). PID authority korundu.',
  },
  'finalize.description': {
    en: 'Finalize a sprint: update MEMORY.md, RETRO.md, IDENTITY.md, config, and run decay',
    tr: 'Bir sprinti sonlandır: MEMORY.md, RETRO.md, IDENTITY.md, config ve run decay güncelle',
  },
  'finalize.sprint_option': { en: 'Specific sprint ID to finalize (e.g. sprint-063); defaults to task auto-detection', tr: 'Sonlandırılacak belirli sprint kimliği (örn. sprint-063); varsayılan görevlerden otomatik algılamadır' },
  'finalize.skip_decay_option': { en: 'Skip the memory/debt decay phase', tr: 'Memory/debt decay aşamasını atla' },
  'finalize.skip_hooks_option': { en: 'Skip plugin afterSprint hooks', tr: 'Plugin afterSprint hooklarını atla' },
  'finalize.force_option': { en: 'Finalize even if tasks are in progress or the sprint is already finalized', tr: 'Görevler sürüyorsa veya sprint zaten sonlandıysa da sonlandır' },
  'finalize.notification_title': { en: 'Sprint {sprintId} finalized', tr: 'Sprint {sprintId} kapandı' },
  'finalize.notification_summary': { en: '{done}/{total} DONE, {debt} TECH_DEBT, {noGo} NO_GO, {unevaluated} UNEVALUATED', tr: '{done}/{total} DONE, {debt} TECH_DEBT, {noGo} NO_GO, {unevaluated} DEĞERLENDİRİLMEDİ' },
  'finalize.attribution_excluded': { en: '{count} work claim(s) excluded: exact attempt attribution was HOLD or unavailable', tr: '{count} iş iddiası dışlandı: exact attempt attribution HOLD veya unavailable durumundaydı' },
  'finalize.mixed_sprints': { en: 'Warning: mixed sprint IDs detected: {sprintIds}. Proceeding with {sprintId}.', tr: 'Uyarı: karışık sprint kimlikleri algılandı: {sprintIds}. {sprintId} ile devam ediliyor.' },
  'finalize.incomplete_tasks': { en: 'Cannot finalize: {count} task(s) are still in progress ({ids}). Use --force to override.', tr: 'Sonlandırılamaz: {count} görev hâlâ sürüyor ({ids}). Geçersiz kılmak için --force kullanın.' },
  'finalize.force_incomplete_tasks': { en: 'Warning: forcing finalize with {count} in-progress task(s).', tr: 'Uyarı: {count} sürmekte olan görevle sonlandırma zorlanıyor.' },
  'finalize.workers_terminated': { en: 'Terminated {count} live worker(s): {ids}', tr: '{count} canlı worker sonlandırıldı: {ids}' },
  'finalize.workers_already_terminated': { en: 'Already terminated: {count} worker(s) were already dead before the sweep ({ids})', tr: 'Zaten sonlandırılmıştı: {count} worker sweep öncesinde zaten ölüydü ({ids})' },
  'finalize.workers_termination_failed': { en: 'Cannot finalize: {count} worker(s) could not be terminated ({ids}); terminal settlement is on HOLD.', tr: 'Sonlandırılamaz: {count} worker sonlandırılamadı ({ids}); terminal settlement HOLD durumunda.' },
  'finalize.already_finalized': { en: 'Sprint {sprintId} has already been finalized. Use --force to re-finalize.', tr: 'Sprint {sprintId} zaten sonlandırıldı. Yeniden sonlandırmak için --force kullanın.' },

  // ─── doctor command ──────────────────────────────────────────────────
  'doctor.checks_passed': {
    en: 'Result: {passed}/{total} checks passed',
    tr: 'Sonuç: {passed}/{total} kontrol geçti',
  },

  // ─── doctor: daemon hygiene (B-ZOMBIE i18n-centralization, Task 333-010) ──
  'doctor.daemon_header': {
    en: 'Daemon Hygiene:',
    tr: 'Daemon Hijyeni:',
  },
  'doctor.daemon_clean': {
    en: 'No stale deckent daemons detected.',
    tr: 'Eskimiş deckent daemon süreci bulunamadı.',
  },
  'doctor.daemon_found': {
    en: '{count} stale deckent daemon(s) detected (advisory — deckent never auto-kills):',
    tr: '{count} eskimiş deckent daemon süreci bulundu (tavsiye — deckent asla otomatik öldürmez):',
  },
  'doctor.daemon_entry': {
    en: 'PID {pid} — {kind}, running for {age}',
    tr: 'PID {pid} — {kind}, {age} süredir çalışıyor',
  },
  'doctor.daemon_kill_hint': {
    en: 'To stop them, run: {killCmd}   (Windows: {winKillCmd})',
    tr: 'Durdurmak için çalıştırın: {killCmd}   (Windows: {winKillCmd})',
  },
  'doctor.daemon_unsupported': {
    en: 'Process listing not supported on {platform} — stale-daemon check skipped.',
    tr: '{platform} platformunda süreç listeleme desteklenmiyor — eskimiş daemon kontrolü atlandı.',
  },
  'doctor.daemon_check_failed': {
    en: 'Could not list processes — stale-daemon check skipped (advisory).',
    tr: 'Süreç listesi alınamadı — eskimiş daemon kontrolü atlandı (tavsiye).',
  },

  // ─── doctor: worker image readiness + --fix-image (F1-IMG, Sprint 270 — 270-008) ──
  'doctor.image_ready': {
    en: 'Worker image ready — provider CLIs + ca-certificates present',
    tr: 'Worker imajı hazır — sağlayıcı CLI\'ları + ca-certificates mevcut',
  },
  'doctor.image_not_ready': {
    en: 'Worker image {state} — rebuild needed before docker-backend workers can run',
    tr: 'Worker imajı {state} — docker-backend worker\'lar çalışmadan önce yeniden derleme gerekli',
  },
  'doctor.image_missing_clis': {
    en: 'Missing provider CLIs: {clis}',
    tr: 'Eksik sağlayıcı CLI\'ları: {clis}',
  },
  'doctor.image_missing_cacerts': {
    en: 'Missing ca-certificates (TLS will fail for codex/gemini)',
    tr: 'ca-certificates eksik (codex/gemini için TLS başarısız olur)',
  },
  'doctor.image_build_hint': {
    en: 'Build: {cmd}',
    tr: 'Derleme: {cmd}',
  },
  'doctor.image_fix_hint': {
    en: 'Run `deckent doctor --fix-image` to rebuild it (asks for confirmation first).',
    tr: 'Yeniden derlemek için `deckent doctor --fix-image` çalıştırın (önce onay ister).',
  },
  'doctor.image_fix_confirm': {
    en: 'Rebuild the worker image now? This runs: {cmd}',
    tr: 'Worker imajı şimdi yeniden derlensin mi? Şu komut çalışır: {cmd}',
  },
  'doctor.image_fix_declined': {
    en: 'Image rebuild cancelled — nothing was built.',
    tr: 'İmaj yeniden derlemesi iptal edildi — hiçbir şey derlenmedi.',
  },
  'doctor.image_fix_running': {
    en: 'Rebuilding worker image: {cmd}',
    tr: 'Worker imajı yeniden derleniyor: {cmd}',
  },
  'doctor.image_fix_done': {
    en: 'Worker image rebuilt successfully.',
    tr: 'Worker imajı başarıyla yeniden derlendi.',
  },
  'doctor.image_fix_failed': {
    en: 'Worker image build failed (exit {code}). See the build output above.',
    tr: 'Worker imaj derlemesi başarısız (çıkış {code}). Yukarıdaki derleme çıktısına bakın.',
  },

  // ─── doctor: worker resources (Sprint 271 — 271-006) ─────────────────
  'doctor.resources_header': {
    en: 'Worker Resources:',
    tr: 'Worker Kaynakları:',
  },
  'doctor.resources_limits': {
    en: 'Memory: {limit} / swap: {swap} — max workers: {workers}',
    tr: 'Bellek: {limit} / swap: {swap} — maksimum worker: {workers}',
  },
  'doctor.resources_ceiling': {
    en: 'RAM ceiling: {ceiling} ({workers} × {limit}) — host: {host} ({pct}%)',
    tr: 'RAM tavanı: {ceiling} ({workers} × {limit}) — host: {host} ({pct}%)',
  },
  'doctor.resources_warn_ceiling': {
    en: '[WARN] Worker RAM ceiling ({ceiling}) is {pct}% of host — consider lowering max_workers or worker_memory_limit',
    tr: '[WARN] Worker RAM tavanı ({ceiling}) host\'un %{pct}\'i — max_workers veya worker_memory_limit düşürmeyi düşünün',
  },
  'doctor.resources_monitor_on': {
    en: 'Resource monitor: enabled (interval: {interval}ms)',
    tr: 'Kaynak izleme: etkin (aralık: {interval}ms)',
  },
  'doctor.resources_monitor_off': {
    en: 'Resource monitor: disabled (set resource_monitor.enabled=true to enable)',
    tr: 'Kaynak izleme: devre dışı (etkinleştirmek için resource_monitor.enabled=true ayarlayın)',
  },

  // ─── doctor: honest ready/missing/one-command-fix summary (ONB-HONEST, Sprint 357 — 357-014) ──
  'doctor.honest_header': {
    en: 'Honest Summary:',
    tr: 'Dürüst Özet:',
  },
  'doctor.honest_all_ready': {
    en: '{ready} ready — you are all set!',
    tr: '{ready} hazır — her şey tamam!',
  },
  'doctor.honest_summary_with_fix': {
    en: '{ready} ready · {missing} missing ({fixable} fixed by `deckent doctor --fix`)',
    tr: '{ready} hazır · {missing} eksik ({fixable}\'i `deckent doctor --fix` ile düzelir)',
  },
  'doctor.honest_summary_no_fix': {
    en: '{ready} ready · {missing} missing',
    tr: '{ready} hazır · {missing} eksik',
  },
  'doctor.honest_missing_line': {
    en: '  - {name}: {explanation}',
    tr: '  - {name}: {explanation}',
  },
  'doctor.honest_fixable_suffix': {
    en: ' (fixed automatically by `deckent doctor --fix`)',
    tr: ' (`deckent doctor --fix` ile otomatik düzelir)',
  },
  'doctor.honest_explain_generic': {
    en: '{name} needs attention: {message}',
    tr: '{name} dikkat gerektiriyor: {message}',
  },
  'doctor.honest_explain_platform': {
    en: 'Your operating system is not fully supported yet.',
    tr: 'İşletim sisteminiz henüz tam olarak desteklenmiyor.',
  },
  'doctor.honest_explain_node': {
    en: 'Node.js is missing or too old — deckent needs it to run.',
    tr: 'Node.js kurulu değil veya çok eski — deckent\'in çalışması için gerekli.',
  },
  'doctor.honest_explain_git': {
    en: 'git is not installed — deckent uses it for safe rollbacks and history.',
    tr: 'git kurulu değil — deckent güvenli geri-alma ve geçmiş için kullanır.',
  },
  'doctor.honest_explain_tmux': {
    en: 'tmux is not installed — needed to run Claude-based runs.',
    tr: 'tmux kurulu değil — Claude tabanlı runları çalıştırmak için gerekli.',
  },
  'doctor.honest_explain_docker': {
    en: 'Docker is not ready — needed for isolated worker containers.',
    tr: 'Docker hazır değil — izole worker konteynerleri için gerekli.',
  },
  'doctor.honest_explain_claude_cli': {
    en: 'The Claude CLI is missing or you are not logged in.',
    tr: 'Claude CLI kurulu değil veya oturum açılmamış.',
  },
  'doctor.honest_explain_workspace': {
    en: 'This project has not been initialized yet.',
    tr: 'Bu proje henüz başlatılmamış.',
  },
  'doctor.honest_explain_brain_dir': {
    en: 'deckent\'s memory folder is missing or incomplete.',
    tr: 'deckent\'in hafıza klasörü eksik veya tamamlanmamış.',
  },
  'doctor.honest_explain_directives': {
    en: 'No run goals have been defined yet.',
    tr: 'Henüz run hedefleri tanımlanmamış.',
  },
  'doctor.honest_explain_brain_budget': {
    en: 'deckent\'s memory has grown past its healthy size.',
    tr: 'deckent\'in hafızası sağlıklı boyutunu aştı.',
  },
  'doctor.honest_explain_debt': {
    en: 'There are unresolved critical issues from past runs.',
    tr: 'Geçmiş runlardan çözülmemiş kritik sorunlar var.',
  },
  'doctor.honest_explain_locks': {
    en: 'Some old task locks were left behind and need cleanup.',
    tr: 'Bazı eski görev kilitleri temizlenmeyi bekliyor.',
  },
  'doctor.honest_explain_deck_security': {
    en: 'Your secrets file may be exposed in git history.',
    tr: 'Gizli bilgiler dosyanız git geçmişinde açığa çıkmış olabilir.',
  },
  'doctor.honest_explain_write_permissions': {
    en: 'deckent cannot write to its own working folders.',
    tr: 'deckent kendi çalışma klasörlerine yazamıyor.',
  },
  'doctor.honest_explain_gitignore': {
    en: 'Sensitive database files are not properly ignored by git.',
    tr: 'Hassas veritabanı dosyaları git tarafından düzgün yok sayılmıyor.',
  },

  // ─── doctor: subprocess .deck visibility (SEC-02, ADR-G-005, Task 411-002) ──
  'doctor.deck_subprocess_visibility_warn': {
    en: 'subprocess workers can read .deck from disk — use the docker backend (shadowed) for sensitive environments.',
    tr: 'subprocess worker\'lar .deck\'i okuyabilir; hassas ortamda docker backend (shadow\'lu) kullanın.',
  },
  'doctor.deck_subprocess_visibility_ok': {
    en: '.deck subprocess visibility: not applicable',
    tr: '.deck subprocess görünürlüğü: uygulanamaz',
  },

  // ─── doctor: platform profile (ONB-2-DILIM-3, Sprint 368 — 368-002) ──
  'doctor.platform_profile_header': {
    en: 'Platform Profile:',
    tr: 'Platform Profili:',
  },
  'doctor.platform_profile_line': {
    en: '{platform} — {label}',
    tr: '{platform} — {label}',
  },
  'doctor.platform_profile_adapted_header': {
    en: 'Platform-specific check adaptations (no silent skips):',
    tr: 'Platforma özgü check uyarlamaları (sessiz-geçiş yok):',
  },
  'doctor.platform_adapt_tmux': {
    en: 'tmux is not natively available on Windows — the tmux requirement is skipped on this platform (use WSL2, or set spawn_backend to docker/subprocess for full support).',
    tr: 'tmux Windows\'ta yerel olarak mevcut değil — tmux gereksinimi bu platformda atlanıyor (WSL2 kullanın veya tam destek için spawn_backend\'i docker/subprocess yapın).',
  },
  'doctor.platform_adapt_permissions': {
    en: 'Windows uses NTFS ACLs, not POSIX permission bits — a chmod-based restriction (e.g. owner-only 0600) is not enforced the same way; write-access checks still work but cannot guarantee equivalent protection.',
    tr: 'Windows POSIX izin bitleri yerine NTFS ACL\'leri kullanır — chmod-tabanlı bir kısıtlama (örn. yalnız-sahip 0600) aynı şekilde uygulanmaz; yazma-erişim kontrolleri çalışır ama eşdeğer koruma garanti edilmez.',
  },
  'doctor.platform_adapt_paths': {
    en: 'Windows uses backslash path separators — checks that compare literal path strings (e.g. .gitignore entries) may behave differently even though internal path handling is normalized.',
    tr: 'Windows ters-eğik-çizgi yol ayırıcıları kullanır — dahili yol işleme normalize edilmiş olsa da, literal yol dizesi karşılaştıran kontroller (örn. .gitignore girdileri) farklı davranabilir.',
  },
  // checkTmux "not required" reason labels (369-002, DOCTOR-FOLLOWUPS — honest-label fix
  // for the win32 branch, which used to fall through to "subprocess backend" even with
  // no spawn_backend override configured).
  'doctor.tmux_not_required_docker': {
    en: 'not required (docker backend)',
    tr: 'gerekli değil (docker backend)',
  },
  'doctor.tmux_not_required_subprocess': {
    en: 'not required (subprocess backend)',
    tr: 'gerekli değil (subprocess backend)',
  },
  'doctor.tmux_not_required_win32': {
    en: 'not required (Windows — tmux not supported natively)',
    tr: 'gerekli değil (Windows — tmux yerel olarak desteklenmiyor)',
  },
  'doctor.platform_label_win32_native': {
    en: 'Windows (native)',
    tr: 'Windows (native)',
  },
  'doctor.platform_label_wsl': {
    en: 'WSL2/Linux (fully supported)',
    tr: 'WSL2/Linux (tam destekli)',
  },
  'doctor.platform_label_linux': {
    en: 'Linux (fully supported)',
    tr: 'Linux (tam destekli)',
  },
  'doctor.platform_label_darwin': {
    en: 'macOS (fully supported)',
    tr: 'macOS (tam destekli)',
  },
  'doctor.platform_label_untested': {
    en: '{platform} (untested — may work)',
    tr: '{platform} (test edilmedi — çalışabilir)',
  },

  // ─── doctor: config-based auth state (ONB-2-DILIM-3, Sprint 368 — 368-002) ──
  'doctor.auth_state_header': {
    en: 'Auth State (config-based, no network):',
    tr: 'Auth Durumu (config-tabanlı, ağ-çağrısı yok):',
  },
  'doctor.auth_state_connected': {
    en: '{provider}: connected',
    tr: '{provider}: bağlı',
  },
  'doctor.auth_state_missing': {
    en: '{provider}: missing',
    tr: '{provider}: eksik',
  },
  'doctor.auth_state_unknown': {
    en: '{provider}: unknown',
    tr: '{provider}: bilinmiyor',
  },
  'doctor.provider_auth_confirmed': {
    en: 'authentication confirmed ({method})',
    tr: 'kimlik doğrulama onaylandı ({method})',
  },
  'doctor.provider_auth_method_subscription': {
    en: 'subscription session',
    tr: 'abonelik oturumu',
  },
  'doctor.provider_auth_method_api_key': {
    en: 'API key',
    tr: 'API anahtarı',
  },
  'doctor.provider_auth_method_unclassified': {
    en: 'provider session',
    tr: 'sağlayıcı oturumu',
  },
  'doctor.provider_auth_logged_out': {
    en: 'CLI present but NOT logged in — run: {command}',
    tr: 'CLI mevcut ama oturum AÇILMAMIŞ — çalıştırın: {command}',
  },
  'doctor.provider_auth_unknown': {
    en: 'CLI present but authentication could not be verified',
    tr: 'CLI mevcut ama kimlik doğrulama teyit edilemedi',
  },
  'doctor.provider_auth_check_name': {
    en: '{provider} authentication',
    tr: '{provider} kimlik doğrulaması',
  },
  'doctor.provider_auth_recommendation': {
    en: '{count} provider authentication warning(s) remain. Start only with providers whose authentication is confirmed.',
    tr: '{count} sağlayıcı kimlik doğrulama uyarısı sürüyor. Yalnız kimlik doğrulaması onaylanmış sağlayıcılarla başlatın.',
  },
  'doctor.provider_local_runtime_available': {
    en: 'local runtime available (authentication not required)',
    tr: 'yerel çalışma zamanı kullanılabilir (kimlik doğrulama gerekmiyor)',
  },
  'doctor.provider_diagnostics_auth_missing': {
    en: 'binary OK, authentication missing',
    tr: 'binary hazır, kimlik doğrulama eksik',
  },
  'doctor.provider_diagnostics_auth_unverified': {
    en: 'binary OK, authentication unverified',
    tr: 'binary hazır, kimlik doğrulama teyit edilmedi',
  },

  // ─── mode command (MODE-HELP-FIX, Sprint 376 — 376-002) ──────────────
  'mode.group_desc': {
    en: 'Get/set deckent_style (run (sprint) | task | process)',
    tr: 'deckent_style al/ayarla (run (sprint) | task | process)',
  },
  'mode.run_desc': {
    en: 'Switch to run mode (bridge alias — stores deckent_style: "sprint")',
    tr: 'Run moduna geç (köprü-alias — deckent_style: "sprint" olarak saklanır)',
  },
  'mode.run_switched': {
    en: '\u2713 Switched to run mode (stored as "sprint" — bridge alias)',
    tr: '\u2713 Run moduna geçildi ("sprint" olarak saklandı — köprü-alias)',
  },
  'mode.rename_note': {
    en: "Note: 'sprint' will soon be renamed to 'run' (naming decision pending rollout).",
    tr: "Not: 'sprint' yakında 'run' olarak anılacak (isimlendirme kararı, uygulanması bekleniyor).",
  },
  'mode.show_desc': {
    en: 'Show current mode',
    tr: 'Mevcut modu göster',
  },
  'mode.sprint_desc': {
    en: 'Switch to sprint mode',
    tr: 'Sprint moduna geç',
  },
  'mode.task_desc': {
    en: 'Switch to task mode',
    tr: 'Task moduna geç',
  },
  'mode.process_desc': {
    en: 'Switch to process mode (continuous request-handling — ERP / automation via MCP + REST)',
    tr: 'Process moduna geç (sürekli istek-işleme — ERP / otomasyon, MCP + REST üzerinden)',
  },
  'mode.auto_desc': {
    en: 'Auto-detect mode from context',
    tr: 'Bağlamdan modu otomatik algıla',
  },
  'mode.global_desc': {
    en: 'Set global default (sprint|task|process)',
    tr: 'Genel varsayılanı ayarla (sprint|task|process)',
  },

  // ─── attach command ─────────────────────────────────────────────────
  'attach.no_active_session': {
    en: 'No active session. Run `deckent start` first.',
    tr: 'Aktif oturum yok. Önce `deckent start` çalıştırın.',
  },

  // ─── kill command ──────────────────────────────────────────────────
  'kill.worker_killed': {
    en: 'Worker for task {taskId} killed.',
    tr: '{taskId} görevi için worker durduruldu.',
  },
  'kill.worker_not_found': {
    en: 'Worker not found: {taskId}',
    tr: 'Worker bulunamadı: {taskId}',
  },
  'kill.task_status_updated': {
    en: 'Task {taskId} status updated to PAUSED.',
    tr: '{taskId} görev durumu PAUSED olarak güncellendi.',
  },
  'kill.task_not_found': {
    en: 'Warning: Task file not found for {taskId} (worker was killed).',
    tr: 'Uyarı: {taskId} için görev dosyası bulunamadı (worker durduruldu).',
  },
  'kill.locks_released': {
    en: '{count} lock(s) released for task {taskId}.',
    tr: '{taskId} görevi için {count} kilit serbest bırakıldı.',
  },
  'kill.prompts_cleaned': {
    en: '{count} prompt file(s) cleaned for task {taskId}.',
    tr: '{taskId} görevi için {count} prompt dosyası temizlendi.',
  },
  'kill.all_killed': {
    en: '{count} worker(s) killed.',
    tr: '{count} worker durduruldu.',
  },
  'kill.sprints_aborted': {
    en: '{count} sprint(s) aborted; no active workers remained.',
    tr: '{count} sprint sonlandırıldı; aktif worker kalmamıştı.',
  },
  'kill.no_active_workers': {
    en: 'No active workers found.',
    tr: 'Aktif worker bulunamadı.',
  },
  'kill.all_confirm_warning': {
    en: '⚠ This will cascade-kill ALL active workers and the controller. This cannot be undone.',
    tr: '⚠ Bu, TÜM aktif worker\'ları ve controller\'ı cascade-kill eder. Geri alınamaz.',
  },
  'kill.all_confirm_prompt': {
    en: 'Kill all?',
    tr: 'Hepsini öldür?',
  },
  'kill.all_aborted': {
    en: 'Aborted — no workers killed. Pass --force or --user-explicit to skip this prompt.',
    tr: 'İptal edildi — worker öldürülmedi. Bu onayı atlamak için --force veya --user-explicit kullanın.',
  },
  'agent.delete_confirm_prompt': {
    en: 'Permanently delete agent \'{name}\' and all its files?',
    tr: '\'{name}\' agent\'ını ve tüm dosyalarını kalıcı olarak sil?',
  },
  'agent.delete_aborted': {
    en: 'Aborted — agent \'{name}\' not deleted. Pass --force to skip this prompt.',
    tr: 'İptal edildi — \'{name}\' agent\'ı silinmedi. Bu onayı atlamak için --force kullanın.',
  },
  'agent.create.description': {
    en: 'Create a custom agent (use --prompt/--description for wizard-style setup)',
    tr: 'Özel bir agent oluştur (--prompt/--description ile yönlendirmeli kurulum)',
  },
  'agent.create.option_model': {
    en: 'Canonical provider API model ID (defaults to the active config)',
    tr: 'Canonical provider API model kimliği (varsayılan: aktif config)',
  },
  'agent.create.option_triggers': {
    en: 'Trigger keywords for task routing',
    tr: 'Task routing için tetikleyici anahtar kelimeler',
  },
  'agent.create.option_prompt': {
    en: 'Set the agent system prompt content directly (written to PROMPT.md)',
    tr: 'Agent system prompt içeriğini doğrudan ayarla (PROMPT.md dosyasına yazılır)',
  },
  'agent.create.option_description': {
    en: 'Set the agent description',
    tr: 'Agent açıklamasını ayarla',
  },
  'agent.create.invalid_name': {
    en: 'Invalid agent name "{name}". Use alphanumeric characters and hyphens only.',
    tr: 'Geçersiz agent adı "{name}". Yalnız alfanümerik karakter ve tire kullanın.',
  },
  'agent.create.invalid_model': {
    en: 'Invalid or unregistered canonical model "{model}". Registered API IDs: {models}',
    tr: 'Geçersiz veya kayıtlı olmayan canonical model "{model}". Kayıtlı API kimlikleri: {models}',
  },
  'agent.create.trigger_empty': {
    en: 'Empty trigger keyword',
    tr: 'Boş tetikleyici anahtar kelime',
  },
  'agent.create.trigger_invalid': {
    en: 'Invalid trigger "{trigger}": use alphanumeric chars, hyphens, underscores, dots, or wildcards',
    tr: 'Geçersiz tetikleyici "{trigger}": alfanümerik karakter, tire, alt çizgi, nokta veya joker kullanın',
  },
  'agent.create.invalid_triggers': {
    en: 'Invalid triggers:\n  {errors}',
    tr: 'Geçersiz tetikleyiciler:\n  {errors}',
  },
  'agent.create.exists': {
    en: 'Agent "{name}" already exists.',
    tr: '"{name}" agent\'ı zaten var.',
  },
  'agent.create.default_description': {
    en: 'Custom agent: {name}',
    tr: 'Özel agent: {name}',
  },
  'agent.create.created': {
    en: 'Agent "{name}" created at {path}',
    tr: '"{name}" agent\'ı {path} konumunda oluşturuldu',
  },
  'agent.create.file': { en: '  - {file}', tr: '  - {file}' },
  'agent.create.model': { en: '  Model: {model}', tr: '  Model: {model}' },
  'agent.create.description_value': {
    en: '  Description: {description}',
    tr: '  Açıklama: {description}',
  },
  'agent.create.triggers': { en: '  Triggers: {triggers}', tr: '  Tetikleyiciler: {triggers}' },
  'agent.create.prompt': {
    en: '  Prompt: (custom, {chars} chars)',
    tr: '  Prompt: (özel, {chars} karakter)',
  },
  'test.model_invalid': {
    en: 'Invalid or unregistered canonical model: {model}',
    tr: 'Geçersiz veya kayıtlı olmayan canonical model: {model}',
  },
  'analyze.vocabulary_bootstrap': {
    en: 'Routing vocabulary bootstrap: {count} project domain(s) derived — {status} ({path})',
    tr: 'Routing sözlük-bootstrap: {count} proje-domain\'i türetildi — {status} ({path})',
  },
  // ─── agent lint (ROUTING-V3 Slice-1, 446) ────────────────────────────
  'agent.lint.header': {
    en: 'Agent catalog lint (V3 capabilities) — {agents} agents × {cells} sweep cells',
    tr: 'Agent katalog lint\'i (V3 capabilities) — {agents} agent × {cells} tarama-hücresi',
  },
  'agent.lint.no_capabilities': {
    en: '{count} agent(s) carry no capabilities block (excluded from the sweep): {ids}',
    tr: '{count} agent capabilities bloğu taşımıyor (taramaya girmedi): {ids}',
  },
  'agent.lint.unreachable': {
    en: 'UNREACHABLE: {agentId} — never wins a sweep cell. Nearest miss: {detail}',
    tr: 'ERİŞİLEMEZ: {agentId} — hiçbir tarama-hücresini kazanamıyor. En yakın kaçış: {detail}',
  },
  'agent.lint.gap': {
    en: 'GAP: {workType} × {domain} — no capable agent ({reasons})',
    tr: 'BOŞLUK: {workType} × {domain} — yetkin agent yok ({reasons})',
  },
  'agent.lint.overlap': {
    en: 'OVERLAP: {a} <-> {b} — {pct}% capability similarity (differentiate or merge)',
    tr: 'ÖRTÜŞME: {a} <-> {b} — %{pct} yetkinlik-benzerliği (ayrıştırın ya da birleştirin)',
  },
  'agent.lint.clean': {
    en: 'Catalog clean: every agent reachable, no coverage gaps.',
    tr: 'Katalog temiz: tüm agent\'lar erişilebilir, kapsama boşluğu yok.',
  },
  // ─── checkpoint command (MSG-003, §4G) ───────────────────────────────
  'checkpoint.list_empty': {
    en: 'No checkpoints found.',
    tr: 'Checkpoint bulunamadı.',
  },
  'checkpoint.col_sprint': { en: 'Run', tr: 'Run' },
  'checkpoint.col_phase': { en: 'Phase', tr: 'Faz' },
  'checkpoint.col_status': { en: 'Status', tr: 'Durum' },
  'checkpoint.col_summary': { en: 'Summary', tr: 'Özet' },
  'checkpoint.col_created': { en: 'Created', tr: 'Oluşturuldu' },
  'checkpoint.approved': {
    en: 'Checkpoint {sprintId}/{phase} approved.',
    tr: 'Checkpoint {sprintId}/{phase} onaylandı.',
  },
  'checkpoint.rejected': {
    en: 'Checkpoint {sprintId}/{phase} rejected.',
    tr: 'Checkpoint {sprintId}/{phase} reddedildi.',
  },
  'checkpoint.not_found': {
    en: 'Checkpoint not found: {sprintId}/{phase}',
    tr: 'Checkpoint bulunamadı: {sprintId}/{phase}',
  },
  // ─── checkpoint notify (589-003, waitForHumanApproval) ───────────────
  'checkpoint.notify_pending_title': {
    en: 'Approval pending: {phase}',
    tr: 'Onay bekleniyor: {phase}',
  },
  'checkpoint.notify_escalation_title': {
    en: '[Reminder] Approval still pending: {phase}',
    tr: '[Hatırlatma] Onay hâlâ bekleniyor: {phase}',
  },
  'checkpoint.notify_escalation_summary': {
    en: '{summary} — pending approval for {elapsedMinutes} minute(s).',
    tr: '{summary} — {elapsedMinutes} dakikadır onay bekliyor.',
  },
  'checkpoint.notify_timeout_title': {
    en: '[TIMEOUT] Approval not received: {phase}',
    tr: '[TIMEOUT] Onay alınamadı: {phase}',
  },
  'checkpoint.notify_timeout_summary': {
    en: '{summary} — no approval/rejection within {timeoutMinutes} minutes; the run is being parked (ABORTED).',
    tr: '{summary} — {timeoutMinutes} dakika içinde onay/red gelmedi, sprint parklanıyor (ABORTED).',
  },
  // ─── checkpoint CLI option descriptions (589-004) ─────────────────────
  'checkpoint.pending_option': {
    en: 'Show only pending checkpoints',
    tr: 'Sadece bekleyen checkpoint\'leri göster',
  },
  'checkpoint.json_option': {
    en: 'Output as JSON',
    tr: 'JSON olarak çıktıla',
  },
  'checkpoint.lang_option': {
    en: 'Language override (en|tr)',
    tr: 'Dil geçersiz kılma değeri (en|tr)',
  },
  // ─── nervous command (MSG-002, §4G) ──────────────────────────────────
  'nervous.dashboard_title': { en: '🧠 Deckent Nervous System', tr: '🧠 Deckent Nervous System' },
  'nervous.no_pending': { en: 'No pending notifications.', tr: 'Bekleyen bildirim yok.' },
  'nervous.pending_header': { en: 'Pending:', tr: 'Bekleyen:' },
  'nervous.actions_label': { en: 'Actions:', tr: 'Eylemler:' },
  'nervous.recent_header': { en: 'Recent (last {count}):', tr: 'Son ({count}):' },
  'nervous.label_autonomous': { en: '(autonomous)', tr: '(otonom)' },
  'nervous.label_accepted': { en: '(accepted)', tr: '(kabul edildi)' },
  'nervous.label_rejected': { en: '(rejected by user)', tr: '(kullanıcı reddetti)' },
  'nervous.config_summary': {
    en: 'Config: mode={mode} · overrides={overrides} · quiet={quiet}',
    tr: 'Yapılandırma: mod={mode} · override={overrides} · sessiz={quiet}',
  },
  'nervous.recommendations_header': {
    en: 'Brain inbox — recommendations ({count}):',
    tr: 'Brain gelen-kutusu — öneriler ({count}):',
  },
  'nervous.no_recommendations': {
    en: 'No open recommendations.',
    tr: 'Açık öneri yok.',
  },
  'nervous.recommendations_hint': {
    en: 'Run `deckent nervous recommendations` for the full inbox; dismiss with `--dismiss <id>`.',
    tr: 'Tam gelen-kutusu için `deckent nervous recommendations`; kapatmak için `--dismiss <id>`.',
  },
  'nervous.rec_dismissed': { en: '✓ Recommendation dismissed: {id}', tr: '✓ Öneri kapatıldı: {id}' },
  'nervous.rec_not_found': {
    en: 'Open recommendation not found: {id}',
    tr: 'Açık öneri bulunamadı: {id}',
  },
  'nervous.accepted': { en: '✓ Accepted: {action}', tr: '✓ Kabul edildi: {action}' },
  'nervous.rejected': { en: '✗ Rejected: {action}{reason}', tr: '✗ Reddedildi: {action}{reason}' },
  'nervous.reject_reason': { en: ' (reason: {reason})', tr: ' (sebep: {reason})' },
  'nervous.edited': { en: '✎ Edited & accepted: {action}', tr: '✎ Düzenlendi & kabul edildi: {action}' },
  'nervous.undone': { en: '↩ Undone: {action} ({id})', tr: '↩ Geri alındı: {action} ({id})' },
  'nervous.not_found_pending': {
    en: 'Pending notification not found: {id}',
    tr: 'Bekleyen bildirim bulunamadı: {id}',
  },
  'nervous.not_found_reversible': {
    en: 'No reversible action found: {id}',
    tr: 'Geri alınabilir eylem bulunamadı: {id}',
  },
  'nervous.history_empty': { en: 'No history records found.', tr: 'Geçmiş kaydı bulunamadı.' },
  'nervous.history_header': { en: 'Nervous System History:', tr: 'Nervous System Geçmişi:' },
  'nervous.log_watching': {
    en: '--- watching for new entries (Ctrl+C to exit) ---',
    tr: '--- yeni kayıtlar izleniyor (çıkmak için Ctrl+C) ---',
  },
  'nervous.time_just_now': { en: 'just now', tr: 'az önce' },
  'nervous.time_minutes': { en: '{n}m ago', tr: '{n}dk önce' },
  'nervous.time_hours': { en: '{n}h ago', tr: '{n}sa önce' },
  'nervous.time_days': { en: '{n}d ago', tr: '{n}g önce' },
  'nervous.slash_id_required': {
    en: '[nervous] id required: /nervous {sub} <id>',
    tr: '[nervous] id gerekli: /nervous {sub} <id>',
  },
  'nervous.slash_not_found': { en: '[nervous] not found: {id}', tr: '[nervous] bulunamadı: {id}' },
  'nervous.slash_empty': {
    en: 'nervous: no pending notifications',
    tr: 'nervous: bekleyen bildirim yok',
  },
  'nervous.sent_to_executor': {
    en: '✓ Sent to the nervous executor: {action}',
    tr: '✓ Nervous executor\'a iletildi: {action}',
  },
  'nervous.dismissed_no_executor': {
    en: '⚠ {action} — no live nervous process, dismissed without executing',
    tr: '⚠ {action} — canlı nervous süreci yok, çalıştırılmadan kapatıldı',
  },
  'nervous.slash_edit_payload_required': {
    en: '[nervous edit] payload required: /nervous edit <id> key=val ... or {json}',
    tr: '[nervous edit] payload gerekli: /nervous edit <id> key=val ... veya {json}',
  },
  'nervous.slash_edit_invalid_json': {
    en: '[nervous edit] invalid JSON payload: {detail}',
    tr: '[nervous edit] geçersiz JSON payload: {detail}',
  },
  'nervous.slash_edit_invalid_kv': {
    en: '[nervous edit] invalid key=value argument: {arg}',
    tr: '[nervous edit] geçersiz key=value argümanı: {arg}',
  },
  // ─── config nervous command (MSG-004, §4G) ───────────────────────────
  'config_nervous.mode_set': { en: '✓ Mode set to: {preset}', tr: '✓ Mod ayarlandı: {preset}' },
  'nervous.enabled_banner': {
    en: '✓ Nervous System enabled (authority: {mode}).\n  Safety contract: medium/high-risk actions surface as suggestions you approve; 5 safety-floor actions (kill-sprint, destructive-git, …) ALWAYS require explicit approval — no silent destructive auto-run.\n  Operate: deckent nervous (dashboard) · deckent nervous accept/reject <id>',
    tr: '✓ Nervous System açıldı (yetki: {mode}).\n  Güvenlik sözleşmesi: orta/yüksek-riskli eylemler onayladığın öneri olarak çıkar; 5 safety-floor eylem (sprint-kill, yıkıcı-git, …) HER ZAMAN açık onay ister — yıkıcı sessiz-çalışma yok.\n  Kullan: deckent nervous (dashboard) · deckent nervous accept/reject <id>',
  },
  'nervous.already_enabled': {
    en: 'Nervous System is already enabled (authority: {mode}). Open it with: deckent nervous',
    tr: 'Nervous System zaten açık (yetki: {mode}). Açmak için: deckent nervous',
  },
  'nervous.approve_timeout.auto': {
    en: 'Auto-proceed: non-safety-floor approvals auto-apply after {secs}s if not approved (safety-floor always waits for you). Disable with config.nervous_system.approve_timeout_ms=0.',
    tr: 'Auto-proceed: safety-floor olmayan onaylar {secs}s içinde onaylanmazsa otomatik uygulanır (safety-floor her zaman seni bekler). Kapatmak: config.nervous_system.approve_timeout_ms=0.',
  },
  'nervous.approve_timeout.never': {
    en: 'Auto-proceed: DISABLED — every approval waits for your explicit accept/reject.',
    tr: 'Auto-proceed: KAPALI — her onay senin açık accept/reject kararını bekler.',
  },
  'config_nervous.invalid_preset': {
    en: 'Invalid preset: "{preset}". Valid values: {values}',
    tr: 'Geçersiz preset: "{preset}". Geçerli değerler: {values}',
  },
  'config_nervous.invalid_action': {
    en: 'Invalid action ID: "{id}". Run `deckent config nervous list` to see all 30 actions.',
    tr: 'Geçersiz eylem ID: "{id}". Tüm eylemleri görmek için `deckent config nervous list` çalıştırın.',
  },
  'config_nervous.safety_floor_blocked': {
    en: '⚠ Safety floor action "{id}" cannot be set to "{policy}".',
    tr: '⚠ Safety floor eylemi "{id}" "{policy}" yapılamaz.',
  },
  'config_nervous.safety_floor_note': {
    en: 'Safety floor actions always require explicit user approval.',
    tr: 'Safety floor eylemleri her zaman açık kullanıcı onayı gerektirir.',
  },
  'config_nervous.invalid_policy': {
    en: 'Invalid policy: "{policy}". Valid values: {values}',
    tr: 'Geçersiz policy: "{policy}". Geçerli değerler: {values}',
  },
  'config_nervous.override_set': {
    en: '✓ Override set: {id} → {policy}',
    tr: '✓ Override ayarlandı: {id} → {policy}',
  },
  'config_nervous.matrix_title': {
    en: 'Nervous System Authority Matrix:',
    tr: 'Nervous System Yetki Matrisi:',
  },
  'config_nervous.col_preset': { en: 'Preset', tr: 'Preset' },
  'config_nervous.col_low': { en: 'Low Risk', tr: 'Düşük Risk' },
  'config_nervous.col_medium': { en: 'Medium Risk', tr: 'Orta Risk' },
  'config_nervous.col_high': { en: 'High Risk', tr: 'Yüksek Risk' },
  'config_nervous.col_description': { en: 'Description', tr: 'Açıklama' },
  'config_nervous.active_marker': { en: ' ◀ active', tr: ' ◀ aktif' },
  'config_nervous.preset_strict': {
    en: 'Enterprise / new user — all medium/high actions require approval',
    tr: 'Enterprise / yeni kullanıcı — tüm medium/high eylemler onay bekler',
  },
  'config_nervous.preset_balanced': {
    en: 'Default — low-risk autonomous, medium 30m suggestion, high approval',
    tr: 'Varsayılan — düşük risk otonom, orta 30dk öneri, yüksek onay',
  },
  'config_nervous.preset_autopilot': {
    en: 'Trusted user — low/medium autonomous, high 5m suggestion',
    tr: 'Güvenilir kullanıcı — düşük/orta otonom, yüksek 5dk öneri',
  },
  'config_nervous.preset_full_auto': {
    en: 'CI/CD / hands-off — all autonomous (except safety floor)',
    tr: 'CI/CD / hands-off — tümü otonom (safety floor hariç)',
  },
  'config_nervous.active_overrides': { en: 'Active Overrides:', tr: 'Aktif Override\'lar:' },
  'config_nervous.no_overrides': { en: 'No active overrides.', tr: 'Aktif override yok.' },
  'config_nervous.safety_floor_label': {
    en: 'Safety Floor (always approve):',
    tr: 'Safety Floor (her zaman onay):',
  },
  'config_nervous.reset_done': {
    en: '✓ Action overrides reset to preset defaults.',
    tr: '✓ Eylem override\'ları preset varsayılanına sıfırlandı.',
  },
  'config_nervous.interactive_title': {
    en: '🧠 Nervous System Configuration',
    tr: '🧠 Nervous System Yapılandırması',
  },
  'config_nervous.current_mode': { en: 'Current mode: {mode}', tr: 'Mevcut mod: {mode}' },
  'config_nervous.available_presets': { en: 'Available presets:', tr: 'Mevcut presetler:' },
  'config_nervous.preset_current': { en: ' (current)', tr: ' (mevcut)' },
  'config_nervous.non_interactive': {
    en: '(Non-interactive mode — use subcommands to modify config)',
    tr: '(Etkileşimsiz mod — değiştirmek için subcommand kullanın)',
  },
  'config_nervous.ni_mode': { en: 'Mode: {mode}', tr: 'Mod: {mode}' },
  'config_nervous.ni_overrides': { en: 'Overrides: {count}', tr: 'Override: {count}' },
  'config_nervous.select_prompt': {
    en: 'Select preset (1-{max}) or press Enter to keep "{mode}": ',
    tr: 'Preset seç (1-{max}) veya "{mode}" için Enter: ',
  },
  'config_nervous.no_change': {
    en: 'No change — mode remains: {mode}',
    tr: 'Değişiklik yok — mod: {mode}',
  },
  'config_nervous.mode_updated': { en: '✓ Mode updated to: {mode}', tr: '✓ Mod güncellendi: {mode}' },
  'config_nervous.invalid_selection': {
    en: 'Invalid selection: "{value}"',
    tr: 'Geçersiz seçim: "{value}"',
  },
  'config_nervous.reset_prompt': { en: 'Reset overrides? [y/N]: ', tr: 'Override\'ları sıfırla? [y/N]: ' },
  'config_nervous.overrides_reset': { en: '✓ Overrides reset.', tr: '✓ Override\'lar sıfırlandı.' },
  'config_nervous.unknown_key': {
    en: 'Unknown nervous config key: "{key}". Supported: mode',
    tr: 'Bilinmeyen nervous config anahtarı: "{key}". Desteklenen: mode',
  },

  // ─── nervous MCP tools (589-001) ──────────────────────────────────────
  'nervous.mcp.id_required': { en: 'id is required', tr: 'id gerekli' },
  'nervous.mcp.invalid_notification_id': {
    en: 'Invalid notification ID: {id}',
    tr: 'Geçersiz bildirim ID\'si: {id}',
  },
  'nervous.mcp.accept_stub': {
    en: 'Notification {id} accepted (nervous inactive — history-only stub).',
    tr: 'Bildirim {id} kabul edildi (nervous devre dışı — yalnızca geçmiş kaydı).',
  },
  'nervous.mcp.accept_queued': {
    en: 'Notification {id} accepted. Action queued for Executor.',
    tr: 'Bildirim {id} kabul edildi. Eylem Executor için kuyruğa alındı.',
  },
  'nervous.mcp.reject_stub': {
    en: 'Notification {id} rejected (nervous inactive — history-only stub).',
    tr: 'Bildirim {id} reddedildi (nervous devre dışı — yalnızca geçmiş kaydı).',
  },
  'nervous.mcp.reject_queued': {
    en: 'Notification {id} rejected. Decision queued for Executor.',
    tr: 'Bildirim {id} reddedildi. Karar Executor için kuyruğa alındı.',
  },
  'nervous.mcp.reject_reason_suffix': {
    en: ' Reason: {reason}',
    tr: ' Sebep: {reason}',
  },
  'nervous.mcp.subscribed': {
    en: 'Subscribed to Nervous System notifications{sprintSuffix}',
    tr: 'Nervous System bildirimlerine abone olundu{sprintSuffix}',
  },
  'nervous.mcp.subscribed_for_sprint': {
    en: ' for {sprintId}',
    tr: ' — {sprintId} için',
  },
  'nervous.mcp.panic_task_id_required': {
    en: 'panic: id requires a non-empty taskId',
    tr: 'panic: id boş olmayan bir taskId gerektirir',
  },
  'nervous.mcp.panic_queued': {
    en: 'PanicGuard approval queued for task {taskId}.',
    tr: '{taskId} görevi için PanicGuard onayı kuyruğa alındı.',
  },
  'nervous.mcp.subscribe.title': { en: 'Nervous Subscribe', tr: 'Nervous Abone Ol' },
  'nervous.mcp.subscribe.sprint_id_desc': {
    en: 'Sprint ID to subscribe to (default: active sprint)',
    tr: 'Abone olunacak Sprint ID (varsayılan: aktif sprint)',
  },
  'nervous.mcp.subscribe.root_desc': {
    en: 'Project root path (for panic event scan)',
    tr: 'Proje kök dizini (panic olay taraması için)',
  },
  'nervous.mcp.accept.title': { en: 'Nervous Accept', tr: 'Nervous Kabul Et' },
  'nervous.mcp.accept.id_desc': {
    en: 'Notification ID to accept, or "panic:<taskId>" for PanicGuard approval',
    tr: 'Kabul edilecek bildirim ID\'si veya PanicGuard onayı için "panic:<taskId>"',
  },
  'nervous.mcp.accept.root_desc': {
    en: 'Project root path (for panic approval IPC write)',
    tr: 'Proje kök dizini (panic onay IPC yazımı için)',
  },
  'nervous.mcp.reject.title': { en: 'Nervous Reject', tr: 'Nervous Reddet' },
  'nervous.mcp.reject.id_desc': {
    en: 'Notification ID to reject',
    tr: 'Reddedilecek bildirim ID\'si',
  },
  'nervous.mcp.reject.reason_desc': { en: 'Reason for rejection', tr: 'Reddetme sebebi' },
  'nervous.mcp.reject.root_desc': {
    en: 'Project root path (for IPC queue write)',
    tr: 'Proje kök dizini (IPC kuyruğu yazımı için)',
  },
  'nervous.mcp.status.title': { en: 'Nervous Status', tr: 'Nervous Durumu' },
  'nervous.mcp.root_desc': { en: 'Project root path', tr: 'Proje kök dizini' },
  'nervous.mcp.config.title': { en: 'Nervous Config', tr: 'Nervous Yapılandırması' },
  'nervous.mcp.config.action_desc': {
    en: 'Config action: read current, set authority preset, set per-action override, list all actions, or reset overrides',
    tr: 'Yapılandırma eylemi: mevcut değeri oku, yetki preseti ayarla, eylem-bazlı override ayarla, tüm eylemleri listele veya override\'ları sıfırla',
  },
  'nervous.mcp.config.preset_desc': {
    en: 'Authority mode preset (required for set_preset)',
    tr: 'Yetki modu preseti (set_preset için gerekli)',
  },
  'nervous.mcp.config.overrides_desc': {
    en: 'Action overrides map { actionId: policy } (for set_override)',
    tr: 'Eylem override haritası { actionId: policy } (set_override için)',
  },
  'nervous.mcp.config.preset_required': {
    en: 'preset is required for set_preset',
    tr: 'set_preset için preset gerekli',
  },
  'nervous.mcp.config.invalid_preset': {
    en: 'Invalid preset: {preset}',
    tr: 'Geçersiz preset: {preset}',
  },
  'nervous.mcp.config.preset_set': {
    en: 'Authority mode set to: {preset}',
    tr: 'Yetki modu ayarlandı: {preset}',
  },
  'nervous.mcp.config.overrides_required': {
    en: 'overrides map is required for set_override',
    tr: 'set_override için overrides haritası gerekli',
  },
  'nervous.mcp.config.overrides_updated': {
    en: 'Action overrides updated',
    tr: 'Eylem override\'ları güncellendi',
  },
  'nervous.mcp.config.reset_done': {
    en: 'Nervous config reset to defaults (balanced, no overrides)',
    tr: 'Nervous yapılandırması varsayılana sıfırlandı (balanced, override yok)',
  },
  'nervous.mcp.config.unknown_action': {
    en: 'Unknown action: {action}',
    tr: 'Bilinmeyen eylem: {action}',
  },
  'nervous.mcp.compensate.no_action_available': {
    en: 'No compensating action available for "{actionId}" — Nervous only recommends this action under its advisory authority; the underlying resource was never modified directly by Nervous, so there is nothing on disk to reverse.',
    tr: '"{actionId}" için telafi eylemi yok — Nervous bu eylemi advisory authority kapsamında yalnızca önerir; ilgili kaynak Nervous tarafından doğrudan değiştirilmedi, bu yüzden diskte geri alınacak bir şey yok.',
  },
  'nervous.mcp.compensate.no_reversal_impl': {
    en: '"{actionId}" has no reversal implementation — treat as unavailable, not success.',
    tr: '"{actionId}" için geri alma uygulaması yok — başarı değil, kullanılamaz olarak değerlendirin.',
  },
  'nervous.mcp.compensate.no_sprint_id': {
    en: 'ORPHAN_TASK_ARCHIVE record has no payload.sprintId — cannot locate the archive directory to restore from.',
    tr: 'ORPHAN_TASK_ARCHIVE kaydında payload.sprintId yok — geri yüklenecek arşiv dizini bulunamıyor.',
  },
  'nervous.mcp.compensate.no_archive_dir': {
    en: 'No archive directory found at {archiveDir} — already restored, or never archived.',
    tr: '{archiveDir} konumunda arşiv dizini bulunamadı — zaten geri yüklenmiş veya hiç arşivlenmemiş.',
  },
  'nervous.mcp.compensate.archive_empty': {
    en: 'Archive directory {archiveDir} is empty — nothing to restore.',
    tr: '{archiveDir} arşiv dizini boş — geri yüklenecek bir şey yok.',
  },
  'nervous.mcp.compensate.all_conflict': {
    en: 'All {count} archived file(s) already exist in .tasks/ — restore skipped to avoid overwriting live files.',
    tr: 'Arşivlenmiş {count} dosyanın tümü .tasks/ içinde zaten var — canlı dosyaların üzerine yazmamak için geri yükleme atlandı.',
  },
  'nervous.mcp.compensate.restored_with_conflicts': {
    en: 'Restored {restored} file(s) from {archiveDir} to .tasks/ ({skipped} skipped — already present).',
    tr: '{archiveDir} konumundan .tasks/ dizinine {restored} dosya geri yüklendi ({skipped} atlandı — zaten mevcut).',
  },
  'nervous.mcp.compensate.restored': {
    en: 'Restored {restored} file(s) from {archiveDir} to .tasks/.',
    tr: '{archiveDir} konumundan .tasks/ dizinine {restored} dosya geri yüklendi.',
  },

  // ─── spawn command ─────────────────────────────────────────────────
  'spawn.worker_spawned': {
    en: 'Worker spawned for task {taskId} (model: {model}).',
    tr: '{taskId} görevi için worker başlatıldı (model: {model}).',
  },
  'spawn.final_only_containment_hold': {
    en: 'Final-only live-usage containment is unavailable ({reasonCode}); spawn was blocked before provider work.',
    tr: 'Final-only canlı kullanım containment kullanılamıyor ({reasonCode}); spawn provider çalışmasından önce engellendi.',
  },

  // ─── init command ────────────────────────────────────────────────────
  'init.select_language': {
    en: 'Select language:',
    tr: 'Dil seçin:',
  },
  'init.select_plan': {
    en: 'Select your plan:',
    tr: 'Planınızı seçin:',
  },
  'init.unmetered_backend_budget_hold': {
    en: 'Finite worker budgets cannot run on the unmetered subprocess backend; execution_budget.unmetered_backend is set to hold. Use Docker or another measured-stream backend.',
    tr: 'Sonlu worker bütçeleri ölçümsüz subprocess backend\'inde çalışamaz; execution_budget.unmetered_backend hold olarak ayarlandı. Docker veya measured-stream destekli bir backend kullanın.',
  },
  'init.enter_project_name': {
    en: 'Project name:',
    tr: 'Proje adı:',
  },
  'init.auto_detecting': {
    en: 'Auto-detecting system, subscription, and project...',
    tr: 'Sistem, abonelik ve proje otomatik algılanıyor...',
  },
  'init.recommendation': {
    en: 'Recommendation:',
    tr: 'Öneri:',
  },
  'init.initialized': {
    en: 'Deckent initialized for "{name}" ({mode}, {language}).',
    tr: 'Deckent "{name}" için başlatıldı ({mode}, {language}).',
  },
  'init.next_steps': {
    en: 'Next steps:',
    tr: 'Sonraki adımlar:',
  },
  'init.next_step_directives': {
    en: '  1. Edit DIRECTIVES.md with your project goals',
    tr: '  1. Proje hedeflerinizi DIRECTIVES.md dosyasına yazın',
  },
  'init.next_step_start': {
    en: '  2. Run `deckent start` to begin your first run',
    tr: '  2. İlk run\'ı başlatmak için `deckent start` çalıştırın',
  },
  'init.option_yes': {
    en: 'Use non-interactive defaults; never install missing prerequisites',
    tr: 'Etkileşimsiz varsayılanları kullan; eksik önkoşulları asla kurma',
  },
  'init.option_install': {
    en: 'Explicitly install supported missing prerequisites without prompting',
    tr: 'Desteklenen eksik önkoşulları açık yetkiyle ve sormadan kur',
  },
  'init.option_no_install': {
    en: 'Detect missing prerequisites but never install them',
    tr: 'Eksik önkoşulları algıla ancak asla kurma',
  },

  // ─── init outcome contract (RC2-A / INIT-01, Sprint 412 — 412-001) ──────
  'init.outcome_header': {
    en: 'Setup outcome: {outcome}',
    tr: 'Kurulum sonucu: {outcome}',
  },
  'init.outcome_ready_message': {
    en: 'All usage blockers are clear — a provider and the required checks are in place.',
    tr: 'Tüm kullanım engelleri temizlendi — bir provider ve zorunlu kontroller yerinde.',
  },
  'init.outcome_setup_incomplete_message': {
    en: 'Setup files were written, but deckent cannot run tasks yet — resolve the following first:',
    tr: 'Kurulum dosyaları yazıldı, ama deckent henüz görev çalıştıramaz — önce şunların çözülmesi gerekiyor:',
  },
  'init.outcome_failed_message': {
    en: 'Init did not complete — see the failed step(s) above, fix the issue, then retry.',
    tr: 'Init tamamlanamadı — yukarıdaki başarısız adım(lar)ı görün, sorunu düzeltin, sonra tekrar deneyin.',
  },
  'init.outcome_blockers_header': {
    en: 'Blockers:',
    tr: 'Engeller:',
  },
  'init.outcome_fix_label': {
    en: 'Fix',
    tr: 'Çözüm',
  },
  'init.outcome_blocker_no_provider': {
    en: 'No AI provider CLI was detected (Claude, Codex, or Gemini) — deckent has no provider to execute tasks with.',
    tr: 'Hiçbir AI provider CLI algılanmadı (Claude, Codex veya Gemini) — deckent\'in görev çalıştıracağı bir provider yok.',
  },
  'init.outcome_remediation_no_provider': {
    en: 'Install a provider CLI and authenticate, e.g.: {cmd}',
    tr: 'Bir provider CLI kurup oturum açın, örn.: {cmd}',
  },
  'init.outcome_blocker_doctor_check': {
    en: '{name} check failed: {message}',
    tr: '{name} kontrolü başarısız: {message}',
  },
  'init.outcome_remediation_doctor_check': {
    en: 'Run `deckent doctor` for full diagnostics and fix hints.',
    tr: 'Tam tanı ve çözüm ipuçları için `deckent doctor` çalıştırın.',
  },
  'init.outcome_blocker_doctor_verification_failed': {
    en: 'Could not verify environment health — the doctor check step itself failed ({error}).',
    tr: 'Ortam sağlığı doğrulanamadı — doctor kontrol adımının kendisi başarısız oldu ({error}).',
  },
  'init.outcome_remediation_doctor_verification_failed': {
    en: 'Run `deckent doctor` manually to see the full report.',
    tr: 'Tam raporu görmek için `deckent doctor` komutunu elle çalıştırın.',
  },

  // ─── init: non-interactive environment guard (RC2C / born-652, Sprint 413 — 413-001) ──
  'init.non_interactive_requires_yes': {
    en: 'Non-interactive environment detected (no TTY on stdin) — re-run with `deckent init --yes` for an unattended setup.',
    tr: 'Etkileşimsiz (non-interactive) ortam algılandı (stdin bir TTY değil) — insansız kurulum için `deckent init --yes` ile tekrar çalıştırın.',
  },

  // ─── init: .deck security-file write failure (RC1-A follow-up, i18n-gate) ──
  'init.deck_security_write_failed': {
    en: 'WARN: failed to write .deck security files: {error}',
    tr: 'UYARI: .deck güvenlik dosyaları yazılamadı: {error}',
  },

  // ─── init: backend transaction — CLI+daemon (RC2-B / INIT-02, Sprint 412 — 412-002) ──
  'init.docker_backend_selected': {
    en: 'Docker CLI + daemon detected → spawn_backend: docker (isolated worker containers)',
    tr: 'Docker CLI + daemon algılandı → spawn_backend: docker (izole worker container\'ları)',
  },
  'init.docker_image_missing_hint': {
    en: 'deckent-worker image not found — build with:',
    tr: 'deckent-worker imajı bulunamadı — şu komutla derleyin:',
  },
  'init.docker_daemon_down_fallback': {
    en: 'Docker CLI found, but the daemon is not running — fell back to the subprocess backend (deckent still works). To use Docker: start the daemon (e.g. `sudo systemctl start docker` on Linux, or open Docker Desktop), then run `deckent config set spawn_backend docker`.',
    tr: 'Docker CLI bulundu ama daemon çalışmıyor — subprocess backend\'e düşüldü (deckent yine de çalışır). Docker kullanmak için: daemon\'ı başlatın (Linux\'ta örn. `sudo systemctl start docker`, ya da Docker Desktop\'ı açın), sonra `deckent config set spawn_backend docker` çalıştırın.',
  },
  'init.docker_image_decline_fallback': {
    en: 'Worker image not built — fell back to the subprocess backend (deckent still works). To use Docker: build the image ({cmd}), then run `deckent config set spawn_backend docker`.',
    tr: 'Worker imajı derlenmedi — subprocess backend\'e düşüldü (deckent yine de çalışır). Docker kullanmak için: imajı derleyin ({cmd}), sonra `deckent config set spawn_backend docker` çalıştırın.',
  },
  'init.docker_image_build_failed_fallback': {
    en: 'Worker image build failed — fell back to the subprocess backend (deckent still works). Fix the build error, run `{cmd}` again, then `deckent config set spawn_backend docker`.',
    tr: 'Worker imaj derlemesi başarısız oldu — subprocess backend\'e düşüldü (deckent yine de çalışır). Derleme hatasını düzeltin, `{cmd}` komutunu tekrar çalıştırın, sonra `deckent config set spawn_backend docker` çalıştırın.',
  },

  // ─── evolve command ─────────────────────────────────────────────────
  'evolve.no_sprint_data': {
    en: 'No sprint data found. Run some sprints first to see evolution trends.',
    tr: 'Sprint verisi bulunamadı. Evrim trendlerini görmek için önce birkaç sprint çalıştırın.',
  },
  'evolve.report_header': {
    en: '\nEvolution Report — {count} sprints analyzed\n',
    tr: '\nEvrim Raporu — {count} sprint analiz edildi\n',
  },
  'evolve.nogo_trend': {
    en: 'NO_GO trend: {icon} {direction}',
    tr: 'NO_GO trendi: {icon} {direction}',
  },
  'evolve.agent_trends': {
    en: 'Agent Trends:',
    tr: 'Ajan Trendleri:',
  },
  'evolve.skill_trends': {
    en: 'Skill Trends:',
    tr: 'Yetenek Trendleri:',
  },

  // ─── sync command ────────────────────────────────────────────────────
  'sync.deckent_not_found': {
    en: 'DECKENT.md not found. Run deckent init first.',
    tr: 'DECKENT.md bulunamadı. Önce deckent init çalıştırın.',
  },
  'sync.dry_run_prefix': {
    en: '[dry-run] ',
    tr: '[kuru-çalıştırma] ',
  },
  'sync.skill_manifest_created': {
    en: '{prefix}Skill manifest created: .deckent/skills/{id}/manifest.json',
    tr: '{prefix}Skill manifesti oluşturuldu: .deckent/skills/{id}/manifest.json',
  },
  'sync.skill_manifest_updated': {
    en: '{prefix}Skill manifest updated: .deckent/skills/{id}/manifest.json',
    tr: '{prefix}Skill manifesti güncellendi: .deckent/skills/{id}/manifest.json',
  },
  'sync.skill_manifest_kept_local': {
    en: 'Warning: skill manifest "{id}" kept as a local definition',
    tr: 'Uyarı: "{id}" skill manifesti yerel tanım olarak korundu',
  },
  'sync.skill_manifest_issue': {
    en: 'Warning: skill manifest "{id}" could not be synced ({reason})',
    tr: 'Uyarı: "{id}" skill manifesti eşitlenemedi ({reason})',
  },
  'sync.skill_manifest_summary': {
    en: 'Skill manifests: {changed} changed, {unchanged} unchanged',
    tr: 'Skill manifestleri: {changed} değişti, {unchanged} değişmedi',
  },
  'sync.workspace_updated': {
    en: '{prefix}Workspace artifact updated: {path}',
    tr: '{prefix}Workspace artifactı güncellendi: {path}',
  },
  'sync.workspace_summary': {
    en: 'Workspace artifacts: {changed} changed, {unchanged} unchanged',
    tr: 'Workspace artifactları: {changed} değişti, {unchanged} değişmedi',
  },

  // ─── set-directives command ──────────────────────────────────────────
  'set_directives.updated': {
    en: 'DIRECTIVES.md updated ({count} task blocks detected)',
    tr: 'DIRECTIVES.md güncellendi ({count} görev bloğu algılandı)',
  },
  'set_directives.file_not_found': {
    en: 'File not found: {path}',
    tr: 'Dosya bulunamadı: {path}',
  },
  'set_directives.empty_content': {
    en: 'Content is empty. Provide --content, --file, or pipe content via stdin.',
    tr: 'İçerik boş. --content, --file kullanın ya da stdin üzerinden içerik pipe edin.',
  },
  'set_directives.no_input': {
    en: 'No input provided. Use --content <string>, --file <path>, or pipe content via stdin.',
    tr: 'Giriş sağlanmadı. --content <string>, --file <path> kullanın ya da stdin üzerinden içerik pipe edin.',
  },

  // ─── error codes (structured) ─────────────────────────────────────
  'error.tmux_not_found': {
    en: 'tmux not found. Install: brew install tmux (macOS) / sudo apt install tmux (Linux). Or use spawn_backend: "subprocess" in config.',
    tr: 'tmux bulunamadi. Kurulum: brew install tmux (macOS) / sudo apt install tmux (Linux). Veya config\'de spawn_backend: "subprocess" kullanin.',
  },
  'error.claude_not_found': {
    en: 'Claude CLI not found. Install: npm install -g @anthropic-ai/claude-code',
    tr: 'Claude CLI bulunamadi. Kurulum: npm install -g @anthropic-ai/claude-code',
  },
  'error.no_directives': {
    en: 'DIRECTIVES.md not found. Create it with run goals, or run: deckent init',
    tr: 'DIRECTIVES.md bulunamadi. Run hedeflerinizi yazin veya calistirin: deckent init',
  },
  'error.config_invalid': {
    en: 'Configuration is invalid. Run: deckent doctor to diagnose',
    tr: 'Yapilandirma gecersiz. Tani icin calistirin: deckent doctor',
  },
  'error.scope_violation': {
    en: 'Worker exceeded assigned scope. Check task scope boundaries.',
    tr: 'Worker atanan kapsami asti. Gorev kapsam sinirlarini kontrol edin.',
  },
  'error.lock_conflict': {
    en: 'Another worker holds the lock. Wait or run: deckent cleanup',
    tr: 'Baska bir worker kilidi tutuyor. Bekleyin veya calistirin: deckent cleanup',
  },
  'error.usage_exceeded': {
    en: 'Usage threshold reached. Run has been auto-paused.',
    tr: 'Kullanim esigi asildi. Run otomatik olarak duraklatildi.',
  },
  'error.build_failed': {
    en: 'Build failed. Run your project\'s type check / lint command to check for errors.',
    tr: 'Derleme başarısız. Hataları kontrol için projenizin tip kontrolü / lint komutunu çalıştırın.',
  },
  'error.git_not_found': {
    en: 'git not found. Install git to use deckent.',
    tr: 'git bulunamadi. deckent kullanmak icin git kurun.',
  },
  'error.node_version_low': {
    en: 'Node.js version too low. Upgrade to {floor}.',
    tr: 'Node.js sürümü çok düşük. {floor} sürümüne yükseltin.',
  },
  'tui.intro': {
    en: 'deckent — pinned-bottom TUI (experimental). Type /exit to quit.',
    tr: 'deckent — alt-sabit TUI (deneysel). /exit ile çık.',
  },
  'tui.thinking': {
    en: 'thinking…',
    tr: 'düşünüyor…',
  },
  'tui.confirm_hint': {
    en: '(y = allow · a = always allow · N = deny)',
    tr: '(y = izin · a = hep izin · N = reddet)',
  },
  // Per-card position when several tool calls are queued for approval in one turn
  // ([1/3], [2/3], …). Numeric notation — identical across locales by design, but
  // routed through getMessage so it stays i18n-owned (template, not hardcoded).
  'tui.confirm_progress': {
    en: '[{index}/{total}]',
    tr: '[{index}/{total}]',
  },
  'tui.confirm_granted': {
    en: 'allowed',
    tr: 'izin verildi',
  },
  'tui.confirm_always': {
    en: 'always allowed',
    tr: 'hep izin verildi',
  },
  'tui.confirm_denied': {
    en: 'denied',
    tr: 'reddedildi',
  },
  'tui.queued': {
    en: 'queued',
    tr: 'kuyrukta',
  },
  'tui.menu_hint': {
    en: '↑↓ move · Enter select · Tab complete · Esc close',
    tr: '↑↓ gez · Enter seç · Tab tamamla · Esc kapat',
  },
  // TERM-AT-REF (583/N2b) — hint under the InputBar's `@` path menu.
  'tui.atref_menu_hint': {
    en: '↑↓ move · Tab/Enter insert path · Esc close',
    tr: '↑↓ gez · Tab/Enter yolu ekle · Esc kapat',
  },
  'tui.switched': {
    en: 'switched to',
    tr: 'geçildi',
  },
  'tui.switch_usage': {
    en: 'usage: /model <id> · /provider <name>. current:',
    tr: 'kullanım: /model <id> · /provider <ad>. aktif:',
  },
  'tui.approval_set': {
    en: 'approval mode',
    tr: 'onay modu',
  },
  'tui.approval_usage': {
    en: 'usage: /approve suggest|auto-edit|full-auto. current:',
    tr: 'kullanım: /approve suggest|auto-edit|full-auto. aktif:',
  },
  'tui.queue_cleared': {
    en: 'queue cleared',
    tr: 'kuyruk temizlendi',
  },
  'tui.cd_to': {
    en: 'working dir',
    tr: 'dizin',
  },
  'tui.cd_fail': {
    en: 'cannot change dir',
    tr: 'dizin değiştirilemedi',
  },
  'tui.generating': {
    en: 'generating…',
    tr: 'üretiliyor…',
  },
  'tui.ready': {
    en: 'ready · your turn',
    tr: 'hazır · sıra sende',
  },
  'tui.confirm_run': {
    en: 'Run',
    tr: 'Çalıştır',
  },
  'tui.cmd_cancelled': {
    en: 'cancelled',
    tr: 'iptal edildi',
  },
  'tui.resume_list_header': {
    en: 'Past chat sessions:',
    tr: 'Geçmiş sohbet oturumları:',
  },
  'tui.resume_hint': {
    en: 'Tip: /resume <number> to continue a session',
    tr: 'İpucu: /resume <numara> ile oturumu sürdür',
  },
  'tui.resume_none': {
    en: 'No past chat sessions yet.',
    tr: 'Henüz geçmiş sohbet oturumu yok.',
  },
  'tui.resume_loaded': {
    en: 'Resuming session "{session}" — last {count} turn(s):',
    tr: '"{session}" oturumu sürdürülüyor — son {count} tur:',
  },
  'tui.resume_not_found': {
    en: 'No turns found for session "{session}".',
    tr: '"{session}" oturumu için tur bulunamadı.',
  },
  'tui.resume_no_memory': {
    en: 'Memory store is not available — cannot resume.',
    tr: 'Hafıza deposu kullanılamıyor — sürdürülemez.',
  },
  'tui.resume_turn_count': {
    en: '{count} turns',
    tr: '{count} tur',
  },
  'tool.wrote_file': {
    en: 'wrote file',
    tr: 'dosya yazıldı',
  },
  'tool.edited_file': {
    en: 'edited file',
    tr: 'dosya düzenlendi',
  },
  'tool.read_file': {
    en: 'read file',
    tr: 'dosya okundu',
  },
  'tool.ran_cmd': {
    en: 'ran command',
    tr: 'komut çalıştırıldı',
  },
  'native.run_tool': {
    en: 'Run tool',
    tr: 'Aracı çalıştır',
  },
  'native.tool_ran': {
    en: 'tool ran',
    tr: 'araç çalıştı',
  },
  // 560-005 (RCA §7) — this line used to claim "its context window may be
  // full", conflating a genuinely empty (output-side) turn with a real
  // context-window overflow (that has its own typed class, see
  // 'native-context.admission-denied' below). Fixed wording: no context-window
  // claim, an honest output-generation label instead.
  'native.empty-response': {
    en: 'The model returned no visible output this turn — an output-generation issue, not a full context window. Try again or switch model (/model).',
    tr: 'Model bu turda görünür bir çıktı döndürmedi — bu bir çıktı-üretim sorunudur, bağlam penceresinin dolması değil. Tekrar deneyin veya model değiştirin (/model).',
  },
  'native.truncated': {
    en: 'response truncated — the model hit its output/context token limit',
    tr: 'yanıt kesildi — model çıktı/context token limitine takıldı',
  },
  'native.context-compacted': {
    en: 'context window near its limit — oldest messages were compacted to keep the session responsive',
    tr: 'context penceresi limite yaklaştı — oturum yanıt verebilsin diye en eski mesajlar sıkıştırıldı',
  },
  'native.switch.missing-api-key': {
    en: 'switch failed — {provider} needs an API key: set {detail}',
    tr: 'geçiş başarısız — {provider} için API anahtarı gerekli: {detail} tanımlayın',
  },
  'native.switch.missing-ollama-host': {
    en: 'switch failed — ollama needs a host: set {detail} in .deckent/config.json',
    tr: 'geçiş başarısız — ollama için host gerekli: .deckent/config.json içinde {detail} tanımlayın',
  },
  'native.switch.missing-local-llm-endpoint': {
    en: 'switch failed — local-llm needs an endpoint: set {detail} in .deckent/config.json',
    tr: 'geçiş başarısız — local-llm için endpoint gerekli: .deckent/config.json içinde {detail} tanımlayın',
  },
  'native.switch.missing-native-model': {
    en: 'switch failed — local-llm needs an exact model ID: set {detail} (deckent config set native_model <id>) to one of the endpoint\'s published /models IDs',
    tr: 'geçiş başarısız — local-llm için tam model kimliği gerekli: {detail} değerini (deckent config set native_model <id>) endpoint\'in /models listesindeki kimliklerden biri yapın',
  },
  'native.model_identity.unknown': {
    en: 'model identity mismatch — "{model}" is not published by this endpoint; published IDs: {published}. Fix native_model to an exact published ID.',
    tr: 'model kimliği uyuşmuyor — "{model}" bu endpoint tarafından yayımlanmıyor; yayımlanan kimlikler: {published}. native_model değerini yayımlanan tam bir kimlikle düzeltin.',
  },
  'native.model_identity.unreachable': {
    en: 'model identity for "{model}" could not be verified — endpoint /models unreachable ({detail}); the server may still be starting (cold start). The first turn may fail until it is ready — no silent fallback was applied.',
    tr: '"{model}" model kimliği doğrulanamadı — endpoint /models erişilemez ({detail}); sunucu hâlâ başlıyor olabilir (cold start). Hazır olana dek ilk tur başarısız olabilir — sessiz fallback uygulanmadı.',
  },
  'native.switch.unsupported-native-provider': {
    en: 'switch failed — "{detail}" has no native tool-use transport; valid: claude, openai, ollama, deepseek, qwen, glm, local-llm',
    tr: 'geçiş başarısız — "{detail}" için native tool-use transport yok; geçerli: claude, openai, ollama, deepseek, qwen, glm, local-llm',
  },
  'native.provider_status': {
    en: 'Provider: {provider} · Model: {model} · Endpoint: {health}',
    tr: 'Sağlayıcı: {provider} · Model: {model} · Endpoint: {health}',
  },
  'native.endpoint_health.healthy': { en: 'healthy', tr: 'sağlıklı' },
  'native.endpoint_health.unhealthy': { en: 'unhealthy', tr: 'sağlıksız' },
  'native.endpoint_health.unknown': { en: 'unknown', tr: 'bilinmiyor' },
  'native.context.effective': {
    en: 'Context: configured {configured} · effective {effective} · native budget derived from {budgetSource}',
    tr: 'Bağlam: yapılandırılan {configured} · etkin {effective} · native bütçe kaynağı: {budgetSource}',
  },
  'native.context.restart_required': {
    en: 'Context: configured {configured} · effective {effective} · restart required · native budget derived from {budgetSource}',
    tr: 'Bağlam: yapılandırılan {configured} · etkin {effective} · yeniden başlatma gerekli · native bütçe kaynağı: {budgetSource}',
  },
  'native.context.unavailable': {
    en: 'Context: configured {configured} · effective unavailable (live server metadata unavailable)',
    tr: 'Bağlam: yapılandırılan {configured} · etkin değer kullanılamıyor (canlı sunucu metadata erişilemiyor)',
  },
  'native.context.budget_source.effective': {
    en: 'effective server context',
    tr: 'etkin sunucu bağlamı',
  },
  'native.switch.legacy-model-alias': {
    en: 'switch failed — "{detail}" is a legacy alias; use an exact provider API model ID such as claude-sonnet-5 or gpt-5.6-sol',
    tr: 'geçiş başarısız — "{detail}" eski bir takma addır; claude-sonnet-5 veya gpt-5.6-sol gibi tam sağlayıcı API model kimliği kullanın',
  },
  // REPL-575 K6 — an unrecognized non-claude model id refused instead of shipped
  // at the Anthropic transport with a false 'switched' report.
  'native.switch.unknown-model': {
    en: 'switch failed — unknown model "{detail}": use an exact registered provider API model ID or switch provider first',
    tr: 'geçiş başarısız — bilinmeyen model "{detail}": tam kayıtlı sağlayıcı API model kimliği kullanın veya önce sağlayıcı değiştirin',
  },
  'native.switch.model-inactive': {
    en: 'switch failed — model "{detail}" is inactive under the owner policy; activate it with deckent models activate',
    tr: 'geçiş başarısız — "{detail}" modeli sahip politikasında pasif; deckent models activate ile etkinleştirin',
  },
  'native.switch.model-authority-unavailable': {
    en: 'switch failed — the project model authority cannot be read safely; no provider call was made',
    tr: 'geçiş başarısız — proje model yetkisi güvenle okunamıyor; sağlayıcı çağrısı yapılmadı',
  },
  // native-transport.ts:247 produces errorCode 'no-transport' when detectTransport
  // finds nothing configured at all — this key was missing, so localizeNativeError
  // (run.tsx) fell back to the raw (Turkish-hardcoded, provider-detect.ts) reason
  // string regardless of `lang` (Task 387-001).
  'native.switch.no-transport': {
    en: 'switch failed — no native transport configured: set ANTHROPIC_API_KEY / OPENAI_API_KEY / openai_base_url / ollama_host',
    tr: 'geçiş başarısız — native transport tanımlı değil: ANTHROPIC_API_KEY / OPENAI_API_KEY / openai_base_url / ollama_host tanımlayın',
  },
  // Native-agent budget/checkpoint codes are mechanism data; user-facing
  // rendering belongs exclusively to this CLI i18n boundary.
  'native-budget.rounds-exhausted': {
    en: 'Model-round budget exhausted.',
    tr: 'Model turu bütçesi tükendi.',
  },
  'native-budget.toolcalls-exhausted': {
    en: 'Tool-call budget exhausted.',
    tr: 'Araç çağrısı bütçesi tükendi.',
  },
  'native-budget.walltime-exhausted': {
    en: 'Session time budget exhausted.',
    tr: 'Oturum süre bütçesi tükendi.',
  },
  'native-budget.tokens-exhausted': {
    en: 'Cumulative token budget exhausted.',
    tr: 'Toplam token bütçesi tükendi.',
  },
  'native-budget.noprogress-terminated': {
    en: 'Session stopped after repeated rounds without progress.',
    tr: 'Oturum, ilerleme sağlamayan tekrarlı turlardan sonra durduruldu.',
  },
  'native.checkpoint.saved': {
    en: 'Scratch checkpoint saved.',
    tr: 'Scratch checkpoint kaydedildi.',
  },
  'native.checkpoint.epoch-advanced': {
    en: 'Working-context epoch advanced to {n}.',
    tr: 'Çalışma bağlamı dönemi {n} olarak ilerletildi.',
  },
  'native.checkpoint.degraded': {
    en: 'Scratch checkpoint could not be saved; the session continues without checkpoint recovery.',
    tr: 'Scratch checkpoint kaydedilemedi; oturum checkpoint kurtarması olmadan sürüyor.',
  },
  // ─── Context-lifecycle UX (560-005, RCA §7) ──────────────────────────────
  // Five typed states, each with its own wording — a terminal OUTPUT exhaustion
  // must never read like a context-window overflow, and vice versa. Only the
  // INPUT_CONTEXT_OVERFLOW line below claims the context window is full; every
  // output-side line explicitly says it is NOT that, by construction.
  'native-context.admission-denied': {
    en: 'The conversation\'s context window is full even after compacting older messages — this turn cannot be sent as-is. Start a fresh context epoch (/renew) or shorten the request.',
    tr: 'Konuşmanın bağlam penceresi, eski mesajlar sıkıştırıldıktan sonra bile dolu — bu tur olduğu gibi gönderilemez. Yeni bir bağlam dönemi başlatın (/renew) veya isteği kısaltın.',
  },
  'native.output-ceiling-reached': {
    en: 'The model hit its output token ceiling mid-answer — continuing generation automatically from where it stopped. This is an output limit, not a full context window.',
    tr: 'Model, yanıt sırasında çıktı token tavanına ulaştı — kaldığı yerden üretim otomatik olarak sürdürülüyor. Bu bir çıktı sınırıdır, bağlam penceresinin dolması değil.',
  },
  'native-output.continuation-exhausted': {
    en: 'Automatic continuation gave up after repeated attempts — the output ceiling kept cutting the answer short. This is an output-generation limit, not a full context window.',
    tr: 'Otomatik devam denemesi art arda denendikten sonra vazgeçildi — çıktı tavanı yanıtı sürekli kesti. Bu bir çıktı-üretim sınırıdır, bağlam penceresinin dolması değil.',
  },
  'native.empty-visible-with-reasoning': {
    en: 'The model spent its output budget on hidden reasoning without producing visible text yet — continuing automatically to recover a visible answer. This is an output issue, not a full context window.',
    tr: 'Model çıktı bütçesini görünür metin üretmeden gizli akıl yürütmeye harcadı — görünür bir yanıt kurtarmak için otomatik olarak sürdürülüyor. Bu bir çıktı sorunudur, bağlam penceresinin dolması değil.',
  },
  'native.reference-expansion-checkpoint': {
    en: 'Expanded reference material pushed this turn\'s context near its limit — saving a checkpoint before continuing.',
    tr: 'Genişletilmiş referans içeriği bu turun bağlamını sınırına yaklaştırdı — devam etmeden önce bir checkpoint kaydediliyor.',
  },
  // 562-003 — REFERENCE_EXPANSION family: informational, never a rejection. Fires
  // when at-ref.ts's expandAtRefs (562-001) could not fit one or more `@ref`
  // references inline within the measured budget and fell back to a descriptor
  // (path + size + digest) that the model reads itself via deckent_read_file.
  'native.reference-descriptor-fallback': {
    en: '{n} reference(s) exceeded the measured budget; switched to tool-mediated partial reads.',
    tr: '{n} referans ölçülen bütçeye sığmadı; araçlı parçalı okumaya geçildi.',
  },
  // NATIVE-BUDGET-RENEWAL (557-002) — the exhaustion offer + the `/renew` replies.
  // `{dimension}` is one of the `native-budget.*-exhausted` lines above; a renewal
  // restarts ONLY the working-budget epoch — billing/usage counters keep accruing,
  // so the offer says so rather than implying a free reset.
  'native-budget.renewal-offer': {
    en: '{dimension} Continue with /renew (billing keeps counting; only the working limits restart) or close the session.',
    tr: '{dimension} /renew ile devam edin (faturalama işlemeye devam eder; yalnız çalışma limitleri sıfırlanır) ya da oturumu kapatın.',
  },
  'native-budget.renew-confirmed': {
    en: 'Working budget renewed — epoch {epoch}. Billing and usage counters keep accruing; only the working limits restarted.',
    tr: 'Çalışma bütçesi yenilendi — dönem {epoch}. Faturalama ve kullanım sayaçları işlemeye devam eder; yalnız çalışma limitleri sıfırlandı.',
  },
  'native-budget.renew-unavailable': {
    en: '/renew is not available on the legacy loop engine — restart without --legacy-loop (or set terminal.native_agent: true) to use it.',
    tr: '/renew eski döngü motorunda kullanılamıyor — kullanmak için --legacy-loop olmadan yeniden başlatın (veya terminal.native_agent: true yapın).',
  },
  'native-budget.remaining': {
    en: 'Remaining budget: {rounds} rounds · {toolCalls} tool calls.',
    tr: 'Kalan bütçe: {rounds} tur · {toolCalls} araç çağrısı.',
  },
  'tui.render_error': {
    en: 'REPL render error',
    tr: 'REPL render hatası',
  },
  'tui.tool_telemetry_mismatch': {
    en: '[deckent] warning: {found} action tag(s) found, {executed} executed — {malformed} malformed/skipped',
    tr: '[deckent] uyarı: {found} aksiyon-etiketi bulundu, {executed} yürütüldü — {malformed} hatalı/atlandı',
  },

  // ─── chat REPL loop + slash subactions (Sprint 269 — 269-003) ────────
  // NOTE: the en templates for max_turns/max_tool_hops/provider_error/
  // agentic_no_match are byte-identical to the previous hardcoded strings —
  // existing substring assertions stay green.
  'chat.max_turns_reached': {
    en: '[chat-native] maxTurns ({max}) reached — ending session.',
    tr: '[chat-native] maxTurns ({max}) sınırına ulaşıldı — oturum kapatılıyor.',
  },
  'chat.max_tool_hops_reached': {
    en: '[chat-native] maxToolHops ({max}) reached — aborting tool chain.',
    tr: '[chat-native] maxToolHops ({max}) sınırına ulaşıldı — araç zinciri durduruluyor.',
  },
  'chat.provider_error': {
    en: '[chat-native] error: {message}',
    tr: '[chat-native] hata: {message}',
  },
  // TERMINAL-I18N-NATIVE-001 — the readline Ollama network-failure hint (was a
  // Turkish literal in entry.ts, rendered in English sessions too).
  'chat.ollama_unreachable': {
    en: "Ollama ({host}) is unreachable: {reason}. Start it with 'ollama serve' or point DECKENT_OLLAMA_HOST at another host.",
    tr: "Ollama ({host}) erişilemedi: {reason}. 'ollama serve' ile başlatın veya DECKENT_OLLAMA_HOST ile farklı bir host belirtin.",
  },
  'chat.no_provider_found': {
    en: 'No AI CLI found. Searched: claude (Anthropic), codex (OpenAI), gemini (Google), cursor (Cursor).\nInstall options:\n  • claude  — https://claude.ai/download  (npm: {claudeHint})\n  • codex   — {codexHint}\n  • gemini  — {geminiHint}\n  • cursor  — {cursorHint}\nAlternatives:\n  • deckent chat --native  — built-in chat (no host CLI required)\n  • deckent serve          — open dashboard chat in your browser',
    tr: 'AI CLI bulunamadı. Arananlar: claude (Anthropic), codex (OpenAI), gemini (Google), cursor (Cursor).\nKurulum seçenekleri:\n  • claude  — https://claude.ai/download  (npm: {claudeHint})\n  • codex   — {codexHint}\n  • gemini  — {geminiHint}\n  • cursor  — {cursorHint}\nAlternatifler:\n  • deckent chat --native  — yerleşik sohbet (host CLI gerekmez)\n  • deckent serve          — dashboard sohbetini tarayıcıda aç',
  },
  'chat.unknown_tool': {
    en: 'Unknown --tool "{tool}". Expected one of: {valid}.',
    tr: 'Bilinmeyen --tool "{tool}". Beklenen: {valid}.',
  },
  'approvals.rules_desc': {
    en: 'Persistent approval rules (approval-rules.json) — list, disable, enable, remove',
    tr: 'Kalıcı onay kuralları (approval-rules.json) — listele, devre-dışı bırak, etkinleştir, sil',
  },
  'approvals.rules_list_desc': {
    en: 'List rules with status',
    tr: 'Kuralları durumlarıyla listele',
  },
  'approvals.rules_none': {
    en: 'No approval rules recorded.',
    tr: 'Kayıtlı onay kuralı yok.',
  },
  'approvals.rules_row': {
    en: '{id} · {state} · {decision} {idPrefix}* {summaryIncludes} · tier≤{tier} · by {createdBy} ({source}) — {reason}',
    tr: '{id} · {state} · {decision} {idPrefix}* {summaryIncludes} · seviye≤{tier} · {createdBy} ({source}) — {reason}',
  },
  'approvals.rules_state_active': { en: 'active', tr: 'aktif' },
  'approvals.rules_state_disabled': { en: 'DISABLED', tr: 'DEVRE-DIŞI' },
  'approvals.rules_disable_desc': {
    en: 'Disable a rule (kept for audit; re-enable any time)',
    tr: 'Kuralı devre-dışı bırak (denetim için saklanır; her an yeniden etkinleştirilebilir)',
  },
  'approvals.rules_enable_desc': { en: 'Re-enable a disabled rule', tr: 'Devre-dışı kuralı yeniden etkinleştir' },
  'approvals.rules_remove_desc': { en: 'Remove a rule permanently', tr: 'Kuralı kalıcı olarak sil' },
  'approvals.rules_updated': {
    en: '{id}: {action} recorded.',
    tr: '{id}: {action} kaydedildi.',
  },
  'approvals.rules_not_found': {
    en: 'Rule {id} not found.',
    tr: '{id} kuralı bulunamadı.',
  },
  'approvals.rules_apply_desc': {
    en: 'Apply active rules to the current pending inbox (routine-tier automatable kinds only)',
    tr: 'Aktif kuralları bekleyen kutuya uygula (yalnız routine-seviye otomatikleştirilebilir türler)',
  },
  'approvals.rules_applied': {
    en: '#{code} {id}: {action} by {ruleId} — {result}',
    tr: '#{code} {id}: {ruleId} ile {action} — {result}',
  },
  'approvals.rules_apply_none': {
    en: 'No pending request is automatable by the active rules.',
    tr: 'Aktif kurallarla otomatikleştirilebilecek bekleyen istek yok.',
  },
  'approvals.rules_fault': {
    en: 'WARNING: approval-rules.json is partially unreadable — invalid entries are ignored, never treated as authority.',
    tr: 'UYARI: approval-rules.json kısmen okunamıyor — geçersiz girdiler yok sayılır, asla otorite sayılmaz.',
  },
  'approvals.rule_advice': {
    en: '   ↳ rule {ruleId} would {decision} this (advisory — automatic application arrives with the rule authorization envelope, D2b)',
    tr: '   ↳ {ruleId} kuralı bunu {decision} yapardı (öneri — otomatik uygulama rule-yetki zarfıyla gelir, D2b)',
  },
  'approvals.opt_always': {
    en: 'after deciding, promote this decision into a persistent routine-tier rule (approval-rules.json)',
    tr: 'karardan sonra bu kararı kalıcı routine-seviye kurala terfi ettir (approval-rules.json)',
  },
  'approvals.rule_promoted': {
    en: 'Rule {ruleId} recorded: {decision} {idPrefix}* — remove any time with: deckent approvals rules remove {ruleId}',
    tr: '{ruleId} kuralı kaydedildi: {decision} {idPrefix}* — istediğin an sil: deckent approvals rules remove {ruleId}',
  },
  'approvals.origin_not_migrated': {
    en: '{id} belongs to the {origin} surface — its decision path migrates to the broker in D2b; for now decide it with: {hint}',
    tr: '{id} {origin} yüzeyine ait — karar yolu D2b ile broker yüzeyine taşınacak; şimdilik şuradan karar ver: {hint}',
  },
  'approvals.settleback_done': {
    en: '↳ {origin} store settled back ({legacyId}).',
    tr: '↳ {origin} deposuna karar geri yazıldı ({legacyId}).',
  },
  'approvals.settleback_failed': {
    en: 'WARNING: broker decision recorded but the {origin} settle-back failed ({reason}) — resolve the legacy store manually.',
    tr: 'UYARI: broker kararı kaydedildi ama {origin} geri-yazımı başarısız ({reason}) — legacy depoyu elle çözün.',
  },
  'approvals.code_unknown': {
    en: 'Short code #{code} matches no CURRENT pending request (codes never outlive the inbox — list again or use the full id).',
    tr: '#{code} kısa-kodu ŞU ANKİ bekleyen isteklerle eşleşmiyor (kodlar kutudan uzun yaşamaz — yeniden listeleyin ya da tam id kullanın).',
  },
  'approvals.code_ambiguous': {
    en: 'Short code #{code} is ambiguous here ({ids}) — use the full id.',
    tr: '#{code} kısa-kodu burada belirsiz ({ids}) — tam id kullanın.',
  },
  'approvals.federated.header': {
    en: '— other pending decisions (federated inbox, read-only) —',
    tr: '— diğer bekleyen kararlar (federe kutu, salt-okunur) —',
  },
  'approvals.federated.row': {
    en: '#{code} · [{origin}] {id} — {summary}  ·  decide: {hint}',
    tr: '#{code} · [{origin}] {id} — {summary}  ·  karar: {hint}',
  },
  'approvals.federated.row_unreadable': {
    en: '[{origin}] {id} — UNREADABLE store (visible, not decidable here)',
    tr: '[{origin}] {id} — OKUNAMAYAN depo (görünür; burada karar verilemez)',
  },
  'approvals.federated.none': {
    en: 'No pending decisions on any other surface.',
    tr: 'Diğer yüzeylerde bekleyen karar yok.',
  },
  'approvals.federated.hint_confirmation': {
    en: 'deckent confirmations decide|run',
    tr: 'deckent confirmations decide|run',
  },
  'approvals.federated.hint_autonomous': {
    en: 'deckent autonomous approve|reject <id>',
    tr: 'deckent autonomous approve|reject <id>',
  },
  'approvals.federated.hint_nervous': {
    en: 'deckent nervous accept|reject <code>',
    tr: 'deckent nervous accept|reject <kod>',
  },
  'approvals.federated.hint_panic': {
    en: 'deckent nervous accept <panic-id>',
    tr: 'deckent nervous accept <panic-id>',
  },
  'approvals.federated.hint_checkpoint': {
    en: 'deckent checkpoint approve|reject',
    tr: 'deckent checkpoint approve|reject',
  },
  'approvals.federated.hint_bot': {
    en: 'chat: approve|reject <id>',
    tr: 'sohbet: approve|reject <id>',
  },
  'approvals.federated.hint_pairing': {
    en: 'deckent gateway (pairing approve)',
    tr: 'deckent gateway (eşleşme onayı)',
  },
  'confirmations.cmd_desc': {
    en: 'Custom-confirmation inbox — pending acceptance-matrix routes (llm/human/code adapters)',
    tr: 'Custom-confirmation kutusu — bekleyen kabul-matrisi yönlendirmeleri (llm/insan/kod adapterları)',
  },
  'confirmations.list_desc': {
    en: 'List pending confirmation requests',
    tr: 'Bekleyen confirmation isteklerini listele',
  },
  'confirmations.list_empty': {
    en: 'No pending confirmations.',
    tr: 'Bekleyen confirmation yok.',
  },
  'confirmations.list_row': {
    en: '{id} · {adapter} · {kind}·{verdict} · risk {riskTier} · generation {generation} · expires {expiresAt} · task {taskId} ({sprintId}) — {statement}',
    tr: '{id} · {adapter} · {kind}·{verdict} · risk {riskTier} · nesil {generation} · süre sonu {expiresAt} · görev {taskId} ({sprintId}) — {statement}',
  },
  'confirmations.quarantine_row': {
    en: 'QUARANTINED · {file} · {reasonCode} · evidence {sourceReference}',
    tr: 'KARANTİNADA · {file} · {reasonCode} · kanıt {sourceReference}',
  },
  'confirmations.decide_desc': {
    en: 'Decide one HUMAN-adapter confirmation (interactive terminal, single-shot)',
    tr: 'Bir INSAN-adapter confirmation kararı ver (interaktif terminal, tek atış)',
  },
  'confirmations.run_desc': {
    en: 'Run pending LLM-adapter confirmations through cross-provider adjudication (xverify runtime)',
    tr: 'Bekleyen LLM-adapter confirmation isteklerini çapraz-sağlayıcı hakemlikten geçir (xverify runtime)',
  },
  'confirmations.opt_confirm': {
    en: 'record a CONFIRMED verdict',
    tr: 'CONFIRMED verdict kaydet',
  },
  'confirmations.opt_reject': {
    en: 'record a FAILED verdict',
    tr: 'FAILED verdict kaydet',
  },
  'confirmations.opt_reason': {
    en: 'why (recorded verbatim on the settlement)',
    tr: 'gerekçe (settlement üzerine aynen kaydedilir)',
  },
  'confirmations.opt_run_id': {
    en: 'run a single pending llm confirmation',
    tr: 'tek bir bekleyen llm confirmation isteğini işle',
  },
  'confirmations.opt_run_author': {
    en: 'author provider when the request carries none',
    tr: 'istek yazar-sağlayıcı taşımıyorsa kullanılacak sağlayıcı',
  },
  'confirmations.opt_run_timeout': {
    en: 'verifier timeout in milliseconds',
    tr: 'hakem zaman aşımı (milisaniye)',
  },
  'confirmations.llm_reason': {
    en: 'cross-provider adjudication verdict={verdict}',
    tr: 'çapraz-sağlayıcı hakemlik verdict={verdict}',
  },
  'confirmations.err_not_pending': {
    en: 'Confirmation {id} is not pending (unknown or already settled).',
    tr: '{id} confirmation isteği beklemede değil (bilinmiyor ya da zaten karara bağlanmış).',
  },
  'confirmations.err_expired': {
    en: 'Confirmation {id} expired and is parked as UNDECIDABLE; a late decision cannot revive it.',
    tr: '{id} confirmation isteğinin süresi doldu ve UNDECIDABLE olarak park edildi; geç karar isteği yeniden canlandıramaz.',
  },
  'confirmations.err_wrong_adapter': {
    en: 'Confirmation {id} belongs to the {adapter} adapter — this surface only handles {expected}.',
    tr: '{id} confirmation isteği {adapter} adapterına ait — bu yüzey yalnız {expected} işler.',
  },
  'confirmations.err_flag_required': {
    en: 'Exactly one of --confirm / --reject is required, together with --reason.',
    tr: '--confirm / --reject bayraklarından tam olarak biri ve --reason zorunludur.',
  },
  'confirmations.err_no_tty': {
    en: 'Decision refused: no interactive terminal present (a confirmation decision needs a live human).',
    tr: 'Karar reddedildi: interaktif terminal yok (confirmation kararı canlı insan ister).',
  },
  'confirmations.confirm_prompt': {
    en: 'Authenticate to record this decision: type "yes" if you are the authority at this terminal: ',
    tr: 'Kararı kaydetmek için kimliğini doğrula: bu terminaldeki yetkili olarak onaylıyorsan "yes" yaz: ',
  },
  'confirmations.decided': {
    en: '{id} settled: {verdict} (by {decidedBy}) — {reason}',
    tr: '{id} karara bağlandı: {verdict} ({decidedBy}) — {reason}',
  },
  'confirmations.run_skip_author': {
    en: '{id} skipped: no author provider recorded — pass --author to adjudicate it.',
    tr: '{id} atlandı: yazar sağlayıcı kaydı yok — hakemlik için --author verin.',
  },
  'confirmations.run_unclear': {
    en: '{id} stays pending: adjudication returned {verdict} (no settlement without a decisive verdict).',
    tr: '{id} beklemede kalıyor: hakemlik {verdict} döndürdü (kesin verdict olmadan settlement yok).',
  },
  'confirmations.run_none': {
    en: 'No pending llm-adapter confirmations.',
    tr: 'Bekleyen llm-adapter confirmation yok.',
  },
  // Acceptance-confirmation lifecycle copy belongs to the presentation catalog;
  // the typed confirmation mechanism exposes states and evidence only.
  'acceptance.confirmation.list': {
    en: 'Acceptance confirmations awaiting review: {count}',
    tr: 'İnceleme bekleyen kabul doğrulamaları: {count}',
  },
  'acceptance.confirmation.route': {
    en: 'Route acceptance confirmation {confirmationId} through the authenticated {surface} surface.',
    tr: '{confirmationId} kabul doğrulamasını kimliği doğrulanmış {surface} yüzeyi üzerinden yönlendirin.',
  },
  'acceptance.confirmation.hold': {
    en: 'Acceptance confirmation {confirmationId} is on HOLD ({reason}). No result was applied.',
    tr: '{confirmationId} kabul doğrulaması HOLD durumunda ({reason}). Hiçbir sonuç uygulanmadı.',
  },
  'acceptance.confirmation.corrupt': {
    en: 'Acceptance confirmation {confirmationId} is corrupt and cannot be used. No result was applied.',
    tr: '{confirmationId} kabul doğrulaması bozuk ve kullanılamaz. Hiçbir sonuç uygulanmadı.',
  },
  'acceptance.confirmation.foreign': {
    en: 'Acceptance confirmation {confirmationId} belongs to another tenant and cannot be used on this surface.',
    tr: '{confirmationId} kabul doğrulaması başka bir tenant\'a ait ve bu yüzeyde kullanılamaz.',
  },
  'acceptance.confirmation.provider_separation': {
    en: 'Acceptance confirmation {confirmationId} is independent of the provider and model used to perform the work.',
    tr: '{confirmationId} kabul doğrulaması, işi gerçekleştiren sağlayıcı ve modelden bağımsızdır.',
  },
  'acceptance.confirmation.runtime_audit': {
    en: 'Runtime audit recorded acceptance confirmation {confirmationId} with outcome {outcome}.',
    tr: 'Runtime denetimi {confirmationId} kabul doğrulamasını {outcome} sonucuyla kaydetti.',
  },
  'acceptance.confirmation.created': {
    en: 'Acceptance confirmation {confirmationId} was created. Continue on the authenticated {surface} surface.',
    tr: '{confirmationId} kabul doğrulaması oluşturuldu. Kimliği doğrulanmış {surface} yüzeyinde devam edin.',
  },
  'acceptance.confirmation.routed': {
    en: 'Acceptance confirmation {confirmationId} was routed to the authenticated {surface} surface.',
    tr: '{confirmationId} kabul doğrulaması, kimliği doğrulanmış {surface} yüzeyine yönlendirildi.',
  },
  'acceptance.confirmation.prepared': {
    en: 'Acceptance confirmation {confirmationId} is PREPARED; its result has not been applied yet.',
    tr: '{confirmationId} kabul doğrulaması PREPARED durumunda; sonucu henüz uygulanmadı.',
  },
  'acceptance.confirmation.applied': {
    en: 'Acceptance confirmation {confirmationId} is APPLIED.',
    tr: '{confirmationId} kabul doğrulaması APPLIED durumunda.',
  },
  'acceptance.confirmation.replay': {
    en: 'Acceptance confirmation {confirmationId} was already applied; the existing result was replayed without another change.',
    tr: '{confirmationId} kabul doğrulaması daha önce uygulandı; mevcut sonuç yeni bir değişiklik yapılmadan yeniden gösterildi.',
  },
  'acceptance.confirmation.tenant_mismatch': {
    en: 'Acceptance confirmation {confirmationId} belongs to another tenant and cannot be used on this surface.',
    tr: '{confirmationId} kabul doğrulaması başka bir tenant\'a ait ve bu yüzeyde kullanılamaz.',
  },
  'acceptance.confirmation.corruption': {
    en: 'Acceptance confirmation {confirmationId} could not be read safely. No result was applied.',
    tr: '{confirmationId} kabul doğrulaması güvenli biçimde okunamadı. Hiçbir sonuç uygulanmadı.',
  },
  'acceptance.confirmation.authority_hold': {
    en: 'Acceptance confirmation {confirmationId} is on authority HOLD. Try again after authority is restored.',
    tr: '{confirmationId} kabul doğrulaması authority HOLD durumunda. Yetki yeniden sağlandıktan sonra tekrar deneyin.',
  },
  'acceptance.confirmation.service_unavailable': {
    en: 'The acceptance confirmation service is unavailable. No result was applied; try again later.',
    tr: 'Kabul doğrulama servisi kullanılamıyor. Hiçbir sonuç uygulanmadı; daha sonra tekrar deneyin.',
  },
  'acceptance.confirmation.pending': {
    en: 'Acceptance confirmation {confirmationId} is pending. Continue on the authenticated {surface} surface.',
    tr: '{confirmationId} kabul doğrulaması beklemede. Kimliği doğrulanmış {surface} yüzeyinde devam edin.',
  },
  'acceptance.confirmation.confirmed': {
    en: 'Acceptance confirmation {confirmationId} was confirmed on the authenticated {surface} surface.',
    tr: '{confirmationId} kabul doğrulaması, kimliği doğrulanmış {surface} yüzeyinde onaylandı.',
  },
  'acceptance.confirmation.residual': {
    en: 'Acceptance confirmation {confirmationId} has residual evidence ({reason}); review it on the authenticated {surface} surface.',
    tr: '{confirmationId} kabul doğrulamasında artık kanıt var ({reason}); kimliği doğrulanmış {surface} yüzeyinde inceleyin.',
  },
  'acceptance.confirmation.expired': {
    en: 'Acceptance confirmation {confirmationId} expired. Start a new request from the authenticated {surface} surface.',
    tr: '{confirmationId} kabul doğrulamasının süresi doldu. Kimliği doğrulanmış {surface} yüzeyinden yeni bir istek başlatın.',
  },
  'acceptance.confirmation.conflict': {
    en: 'Acceptance confirmation {confirmationId} conflicts with existing evidence ({reason}); no decision was recorded.',
    tr: '{confirmationId} kabul doğrulaması mevcut kanıtla çelişiyor ({reason}); karar kaydedilmedi.',
  },
  'acceptance.confirmation.reconciliation_hold': {
    en: 'Acceptance confirmation {confirmationId} is on reconciliation HOLD ({reason}). Resolve it on the authenticated {surface} surface.',
    tr: '{confirmationId} kabul doğrulaması uzlaştırma HOLD durumunda ({reason}). Kimliği doğrulanmış {surface} yüzeyinde çözümleyin.',
  },
  'acceptance.confirmation.authenticated_surface_route': {
    en: 'Open the authenticated {surface} surface to review acceptance confirmation {confirmationId}.',
    tr: '{confirmationId} kabul doğrulamasını incelemek için kimliği doğrulanmış {surface} yüzeyini açın.',
  },
  'approval.lifecycle.stage.initial': {
    en: 'Approval requested',
    tr: 'Onay istendi',
  },
  'approval.lifecycle.stage.renotify': {
    en: 'Approval reminder',
    tr: 'Onay hatırlatması',
  },
  'approval.lifecycle.stage.alternate-channel': {
    en: 'Approval escalated to an alternate channel',
    tr: 'Onay alternatif kanala yükseltildi',
  },
  'approval.lifecycle.stage.park-alert': {
    en: 'Approval is about to park',
    tr: 'Onay park edilmek üzere',
  },
  'approval.lifecycle.stage.expired': {
    en: 'Approval expired',
    tr: 'Onayın süresi doldu',
  },
  'approval.lifecycle.risk.routine': {
    en: 'Routine risk',
    tr: 'Rutin risk',
  },
  'approval.lifecycle.risk.elevated': {
    en: 'Elevated risk',
    tr: 'Yükseltilmiş risk',
  },
  'approval.lifecycle.risk.critical': {
    en: 'Critical risk',
    tr: 'Kritik risk',
  },
  'approval.lifecycle.timeout.park-undecidable': {
    en: 'Timed out and parked as UNDECIDABLE',
    tr: 'Zaman aşımına uğradı ve UNDECIDABLE olarak park edildi',
  },
  'approval.lifecycle.timeout.park-alert': {
    en: 'Timed out and parked with an alert',
    tr: 'Zaman aşımına uğradı ve uyarıyla park edildi',
  },
  'approval.lifecycle.timeout.deny-expire': {
    en: 'Timed out and denied; access was not granted',
    tr: 'Zaman aşımına uğradı ve reddedildi; erişim verilmedi',
  },
  'approval.lifecycle.timeout.request-default': {
    en: 'Timed out with the request policy default',
    tr: 'İstek policy varsayılanıyla zaman aşımına uğradı',
  },
  'approvals.lifecycle_detail': {
    en: 'origin={origin} · risk={riskTier} · stage={stage} · expires={expiresAt}',
    tr: 'kaynak={origin} · risk={riskTier} · aşama={stage} · süre sonu={expiresAt}',
  },
  'approvals.federated.row_quarantined': {
    en: 'QUARANTINED · {origin} · {id} · {reason} · evidence {sourceReference}',
    tr: 'KARANTİNADA · {origin} · {id} · {reason} · kanıt {sourceReference}',
  },
  'approvals.federated.row_lifecycle': {
    en: '#{code} · [{origin}] {id} — {summary} · risk={riskTier} · stage={stage} · expires={expiresAt} · decide: {hint}',
    tr: '#{code} · [{origin}] {id} — {summary} · risk={riskTier} · aşama={stage} · süre sonu={expiresAt} · karar: {hint}',
  },
  'approvals.lifecycle_disabled_hold': {
    en: 'Approval lifecycle is disabled; creation is held fail-closed.',
    tr: 'Onay lifecycle devre dışı; oluşturma fail-closed olarak bekletiliyor.',
  },
  'approvals.lifecycle_disabled': {
    en: 'Approval lifecycle is disabled; no pending request was created.',
    tr: 'Onay lifecycle devre dışı; bekleyen istek oluşturulmadı.',
  },
  'approvals.expired': {
    en: 'Approval {id} expired at {expiresAt}; no late decision was applied.',
    tr: '{id} onayının süresi {expiresAt} tarihinde doldu; geç karar uygulanmadı.',
  },
  'approvals.late_decision': {
    en: 'Approval {id} is already terminal ({state}); the late decision was rejected.',
    tr: '{id} onayı zaten terminal durumda ({state}); geç karar reddedildi.',
  },
  'approvals.quarantined': {
    en: 'Approval {id} is quarantined or unavailable ({reason}); no decision was applied.',
    tr: '{id} onayı karantinada veya kullanılamıyor ({reason}); karar uygulanmadı.',
  },
  'chat.tool_cli_missing': {
    en: 'Provider "{tool}" CLI not found in PATH. {details}',
    tr: '"{tool}" sağlayıcısının CLI aracı PATH üzerinde bulunamadı. {details}',
  },
  'chat.agentic_no_match': {
    en: '[agentic] no matching intent — falling back to chat.',
    tr: '[agentic] eşleşen niyet yok — sohbete dönülüyor.',
  },
  'chat.mcp_not_wired': {
    en: 'The external MCP client is not wired into the REPL yet — it is on the roadmap (F9 phase 2). Use `claude mcp add deckent -- npx deckent-mcp` to reach deckent tools from a host CLI.',
    tr: 'Harici MCP istemcisi REPL\'e henüz bağlı değil — yol haritasında (F9 faz 2). Deckent araçlarına host CLI üzerinden erişmek için: `claude mcp add deckent -- npx deckent-mcp`.',
  },
  'chat.mcp_client_disabled': {
    en: 'MCP servers are configured but the external MCP client is disabled. Set "mcp_client_enabled": true in .deckent/config.json to connect them.',
    tr: 'MCP sunucuları yapılandırılmış ama harici MCP istemcisi kapalı. Bağlanmak için .deckent/config.json içinde "mcp_client_enabled": true ayarlayın.',
  },
  // born-697 (SURF-3 approval last-mile) — visible closure line for a terminal
  // approve/deny. Param-free of `{result}` (the worker runs cross-process async,
  // so no result is known at decision time) — only the request `{summary}`.
  'approval.terminal.approved': {
    en: '✅ Approved — {summary}',
    tr: '✅ Onaylandı — {summary}',
  },
  'approval.terminal.rejected': {
    en: '✖ Rejected — {summary}',
    tr: '✖ Reddedildi — {summary}',
  },
  // REPL-575 K5 — localized tool confirm-prompt summaries (injected into
  // chat-tool-exec via ToolExecLabels; the mechanism module stays string-free).
  'tool.confirm_write': {
    en: 'Write file: {path} ({chars} chars)',
    tr: 'Dosya yaz: {path} ({chars} karakter)',
  },
  'tool.confirm_edit': {
    en: 'Edit file: {path}',
    tr: 'Dosya düzenle: {path}',
  },
  'tool.confirm_bash': {
    en: 'Run command: {cmd}',
    tr: 'Komut çalıştır: {cmd}',
  },
  // 583/N4 — git confirm summaries (add/commit = the human seal, KARAR-2).
  'tool.confirm_git_add': {
    en: 'Stage changes: {paths}',
    tr: 'Değişiklikleri stage et: {paths}',
  },
  'tool.confirm_git_commit': {
    en: 'Commit: {subject}',
    tr: 'Commit: {subject}',
  },
  'chat.slash_unknown_subaction': {
    en: '{command}: unknown subaction "{sub}". See /help for usage.',
    tr: '{command}: bilinmeyen alt-aksiyon "{sub}". Kullanım için /help.',
  },
  'chat.autonomous_id_required': {
    en: 'Usage: /autonomous {sub} <id>',
    tr: 'Kullanım: /autonomous {sub} <id>',
  },
  'chat.autonomous_title_required': {
    en: 'Usage: /autonomous backlog add <title> [--cron <expr>]',
    tr: 'Kullanım: /autonomous backlog add <başlık> [--cron <ifade>]',
  },
  'chat.audit_not_in_mcp': {
    en: 'Audit action "{sub}" is not available over MCP yet — run it via the CLI: deckent audit {sub}',
    tr: '"{sub}" audit aksiyonu henüz MCP\'de yok — CLI ile çalıştırın: deckent audit {sub}',
  },
  'chat.directives_set_usage': {
    en: 'Usage: /directives set <content>',
    tr: 'Kullanım: /directives set <içerik>',
  },
  'chat.directives_not_found': {
    en: 'DIRECTIVES.md not found under {root}.',
    tr: 'DIRECTIVES.md bulunamadı: {root}.',
  },

  // ─── chat --native / --local wiring (Sprint 323 — 323-015) ───────────
  // NOTE: native_repl_banner + native_provider_disconnected en templates are
  // byte-identical to the prior hardcoded strings — existing substring
  // assertions (chat-native-flags "provider not yet connected") stay green.
  'chat.native_repl_banner': {
    en: 'Deckent native chat. Type :exit to quit.',
    tr: 'Deckent yerel sohbet. Çıkmak için :exit yazın.',
  },
  'chat.native_provider_disconnected': {
    en: '[native] provider not yet connected to a real LLM',
    tr: '[native] sağlayıcı henüz gerçek bir LLM\'e bağlı değil',
  },
  'chat.local_unavailable': {
    en: 'Local LLM runtime not reachable at {host}: {reason}\n  • Install Ollama: https://ollama.com/download\n  • Start it: `ollama serve`\n  • Pull a model: `ollama pull llama3`\n  • Or point at a remote host: DECKENT_OLLAMA_HOST=<url>',
    tr: 'Yerel LLM çalışma-zamanı erişilemez ({host}): {reason}\n  • Ollama kur: https://ollama.com/download\n  • Başlat: `ollama serve`\n  • Model indir: `ollama pull llama3`\n  • Veya uzak host göster: DECKENT_OLLAMA_HOST=<url>',
  },
  'chat.local_launching': {
    en: 'Deckent local chat → {host} ({model})',
    tr: 'Deckent yerel sohbet → {host} ({model})',
  },

  // ─── autonomous command (Sprint 228 — 228-001 i18n retrofit) ─────────
  'autonomous.disabled': {
    en: 'Autonomous mode is disabled. Run `deckent autonomous enable` (or set config.autonomous.enabled=true in .deckent/config.json) to run the engine.',
    tr: 'Otonom mod kapalı. Motoru çalıştırmak için `deckent autonomous enable` çalıştırın (veya .deckent/config.json içinde config.autonomous.enabled=true yapın).',
  },
  'autonomous.enabled_banner': {
    en: '✓ Autonomous mode enabled ({path}).\n  Safety contract: every machine-initiated item passes RBAC → policy → risk gates; approval-required & risk-tagged items PARK for your sign-off — destructive ops never auto-run silently.\n  Start: deckent autonomous start · Add work: deckent autonomous backlog add · Review pending: deckent autonomous pending',
    tr: '✓ Otonom mod açıldı ({path}).\n  Güvenlik sözleşmesi: her makine-başlatımlı iş RBAC → policy → risk kapılarından geçer; onay-gerektiren & risk-etiketli işler onayın için PARK eder — yıkıcı işlemler sessizce çalışmaz.\n  Başlat: deckent autonomous start · İş ekle: deckent autonomous backlog add · Bekleyenler: deckent autonomous pending',
  },
  'autonomous.already_enabled': {
    en: 'Autonomous mode is already enabled ({path}). Start it with: deckent autonomous start',
    tr: 'Otonom mod zaten açık ({path}). Başlatmak için: deckent autonomous start',
  },
  'autonomous.start_banner': {
    en: 'Autonomous runtime started — {flows} flow(s), {pending} pending backlog item(s), default-deny + approval-gate active',
    tr: 'Otonom runtime başladı — {flows} flow, {pending} pending backlog maddesi, default-deny + onay-kapısı aktif',
  },
  'autonomous.start_no_work': {
    en: 'No pending work — backlog has no pending or scheduled items (all done/failed). Queue one with: deckent autonomous plan "<goal>" — the loop will idle until work is added.',
    tr: 'Bekleyen iş yok — backlog\'da pending veya zamanlanmış madde yok (hepsi done/failed). Kuyruğa iş ekle: deckent autonomous plan "<hedef>" — iş eklenene kadar döngü boşta bekler.',
  },
  'autonomous.start_done': {
    en: 'Autonomous loop finished ({iterations} cycles, reason: {reason})',
    tr: 'Otonom döngü tamamlandı ({iterations} cycle, sebep: {reason})',
  },
  'autonomous.status_header': {
    en: 'Autonomous runtime status',
    tr: 'Otonom runtime durumu',
  },
  'autonomous.status_pending': {
    en: 'Pending approvals: {count}',
    tr: 'Bekleyen onay: {count}',
  },
  'autonomous.status_no_audit': {
    en: 'No audit events yet.',
    tr: 'Henüz audit kaydı yok.',
  },
  'autonomous.status_recent_audit': {
    en: 'Recent audit ({count}):',
    tr: 'Son audit ({count}):',
  },
  'autonomous.stop_marker_written': {
    en: 'Stop signal written — active loop will halt after the in-flight cycle.',
    tr: 'Durdurma sinyali yazıldı — aktif döngü mevcut cycle sonrası duracak.',
  },
  'autonomous.cleanup_done': {
    en: 'Swept {count} stray autonomous run-artifact(s) from .tasks/.',
    tr: '.tasks/ içinden {count} adet artık otonom run-artifact temizlendi.',
  },
  // ─── autonomous approve/reject/pending + live feedback (APPROVE-002, §4G) ──
  'autonomous.approve_done': {
    en: '✓ Approved: {triggerId} (decision recorded — applied when this trigger is next re-evaluated).',
    tr: '✓ Onaylandı: {triggerId} (karar kaydedildi — bu tetik tekrar değerlendirildiğinde uygulanır).',
  },
  'autonomous.reject_done': {
    en: '✗ Rejected: {triggerId}',
    tr: '✗ Reddedildi: {triggerId}',
  },
  'autonomous.resolve_not_found': {
    en: 'No pending trigger found: {triggerId}',
    tr: 'Bekleyen tetik bulunamadı: {triggerId}',
  },
  'autonomous.id_required': {
    en: 'A trigger id is required.',
    tr: 'Tetik id gerekli.',
  },
  'autonomous.pending_header': {
    en: 'Pending approvals ({count}):',
    tr: 'Bekleyen onaylar ({count}):',
  },
  'autonomous.pending_none': {
    en: 'No pending approvals.',
    tr: 'Bekleyen onay yok.',
  },
  'autonomous.pending_row': {
    en: '  - {triggerId} | {action} | by {requestedBy} | {enqueuedAt}',
    tr: '  - {triggerId} | {action} | {requestedBy} | {enqueuedAt}',
  },
  'autonomous.tick': {
    en: '[autonomous] {outcome} — {action} ({triggerId}): {reason}',
    tr: '[autonomous] {outcome} — {action} ({triggerId}): {reason}',
  },
  'autonomous.notify_pending_title': {
    en: 'Autonomous approval required',
    tr: 'Otonom onay gerekiyor',
  },
  'autonomous.notify_pending_summary': {
    en: '{action} ({triggerId}) is awaiting human approval — tap a button below or run: deckent autonomous approve {triggerId}',
    tr: '{action} ({triggerId}) insan onayı bekliyor — aşağıdaki butona dokun ya da çalıştır: deckent autonomous approve {triggerId}',
  },
  'autonomous.action_approve': {
    en: '✓ Approve',
    tr: '✓ Onayla',
  },
  'autonomous.action_reject': {
    en: '✗ Reject',
    tr: '✗ Reddet',
  },
  'autonomous.audit_row': {
    en: '  - {ts} {action} -> {outcome}: {reason}',
    tr: '  - {ts} {action} -> {outcome}: {reason}',
  },
  // ─── autonomous flow-reporter (CORE-UNIFORMITY slice 1) ──────────────
  'autonomous.flow_line': { en: '{icon} {label} [{entryId}] {detail}', tr: '{icon} {label} [{entryId}] {detail}' },
  'autonomous.flow_picked': { en: 'picked', tr: 'seçildi' },
  'autonomous.flow_jit_detail': { en: 'JIT detail', tr: 'JIT detay' },
  'autonomous.flow_spawned': { en: 'spawned', tr: 'başlatıldı' },
  'autonomous.flow_brain_verdict': { en: 'Brain', tr: 'Brain' },
  'autonomous.flow_audit_verdict': { en: 'Auditor', tr: 'Denetçi' },
  'autonomous.flow_cross_verify': { en: 'Cross-verify', tr: 'Çapraz-doğrulama' },
  'autonomous.flow_done': { en: 'done', tr: 'tamam' },
  'autonomous.flow_failed': { en: 'failed', tr: 'başarısız' },
  'autonomous.flow_parked': { en: 'parked', tr: 'beklemede' },

  // ─── autonomous plan subcommand (Task 8 — goal planner) ──────────────
  'autonomous.plan_header': {
    en: 'Planned {count} item(s) from goal:',
    tr: 'Hedeften {count} madde planlandı:',
  },
  'autonomous.plan_row': {
    en: '  [{kind}/{policy}] {id}: {summary}',
    tr: '  [{kind}/{policy}] {id}: {summary}',
  },
  'autonomous.plan_written': {
    en: 'Wrote {count} item(s) to the backlog (pending). Review: deckent autonomous backlog list',
    tr: '{count} madde backlog’a yazıldı (pending). Gözden geçir: deckent autonomous backlog list',
  },
  'autonomous.plan_mission_written': {
    en: 'Wrote {count} item(s) atomically to MissionStore mission {missionId} (pending).',
    tr: '{count} madde MissionStore mission {missionId} içine atomik yazıldı (pending).',
  },
  'autonomous.plan_mission_replayed': {
    en: 'MissionStore mission {missionId} already contains the exact {count}-item plan; no duplicate was created.',
    tr: 'MissionStore mission {missionId} aynı {count} maddelik planı zaten içeriyor; mükerrer kayıt oluşturulmadı.',
  },
  'autonomous.plan_dryrun': {
    en: 'Dry-run — nothing written.',
    tr: 'Dry-run — hiçbir şey yazılmadı.',
  },
  'autonomous.plan_empty': {
    en: 'The planner returned no valid items.',
    tr: 'Planner geçerli madde döndürmedi.',
  },
  'autonomous.plan_none_added': {
    en: 'No new items queued — {skipped} already active in the backlog (pending/running/parked). Wait for them to finish, or remove them first: deckent autonomous backlog remove <id>',
    tr: 'Yeni madde eklenmedi — {skipped} madde backlog\'da zaten aktif (pending/running/parked). Bitmelerini bekle veya önce kaldır: deckent autonomous backlog remove <id>',
  },
  'autonomous.plan_kind_rejected': {
    en: 'Goal-v2 rejected item {id} ({kind}) before persistence: {reason}. Live-admitted kinds: {allowed}.',
    tr: 'Goal-v2, {id} ({kind}) maddesini kalıcı kayıttan önce reddetti: {reason}. Canlı kabul edilen türler: {allowed}.',
  },

  // ─── autonomous backlog subcommand (Task 7) ──────────────────────────
  'autonomous.backlog.added': {
    en: 'Backlog entry added: {id}',
    tr: 'Backlog kaydı eklendi: {id}',
  },
  'autonomous.backlog.removed': {
    en: 'Backlog entry removed: {id}',
    tr: 'Backlog kaydı silindi: {id}',
  },
  'autonomous.backlog.empty': {
    en: 'No backlog entries.',
    tr: 'Backlog kaydı yok.',
  },
  'autonomous.backlog.not_found': {
    en: 'Backlog entry not found: {id}',
    tr: 'Backlog kaydı bulunamadı: {id}',
  },
  'autonomous.backlog.duplicate': {
    en: 'Backlog entry already exists: {id}',
    tr: 'Backlog kaydı zaten var: {id}',
  },
  'autonomous.backlog.id_required': {
    en: 'An entry id is required: pass it positionally (remove <id>) or via --id <id>.',
    tr: 'Kayıt id gerekli: ya konumsal (remove <id>) ya da --id <id> ile verin.',
  },
  'autonomous.backlog.invalid_cron': {
    en: 'Invalid cron expression "{cron}": {error}',
    tr: 'Geçersiz cron ifadesi "{cron}": {error}',
  },
  'autonomous.backlog.capability_required': {
    en: 'kind=capability requires --capability <verb> (e.g. fs.read, db.query).',
    tr: 'kind=capability için --capability <fiil> gerekli (örn. fs.read, db.query).',
  },
  'autonomous.backlog.invalid_args': {
    en: 'Invalid --args JSON: {error}',
    tr: 'Geçersiz --args JSON: {error}',
  },

  // ─── audit read-side (compliance + SIEM forward) ──────────────────────
  'audit.compliance.summary': {
    en: 'Compliance ({sprint}): events={count} auditChainIntact={chain} rbacEnforcement={rbac} tenantIsolation={tenant}',
    tr: 'Uyumluluk ({sprint}): olay={count} denetimZinciriSağlam={chain} rbacZorlama={rbac} kiracıİzolasyonu={tenant}',
  },
  'audit.compliance.actor_row': {
    en: '  actor {actor}: {count} event(s)',
    tr: '  aktör {actor}: {count} olay',
  },
  'audit.forward.done': {
    en: 'Forwarded {count} audit record(s) → {out}',
    tr: '{count} denetim kaydı iletildi → {out}',
  },
  'audit.forward.sent': {
    en: 'Forwarded {count} audit record(s) → {url}',
    tr: '{count} denetim kaydı iletildi → {url}',
  },
  'audit.forward.syslog_sent': {
    en: 'Forwarded {count} audit record(s) → syslog {protocol}://{host}:{port}',
    tr: '{count} denetim kaydı iletildi → syslog {protocol}://{host}:{port}',
  },
  'audit.retention.plan': {
    en: 'Retention plan ({sprint}): scanned={scanned} keep={keep} archive={archive} prune={prune} — dry-run, nothing written (use --apply)',
    tr: 'Saklama planı ({sprint}): taranan={scanned} tutulan={keep} arşiv={archive} silinecek={prune} — deneme çalıştırması, hiçbir şey yazılmadı (--apply kullanın)',
  },
  'audit.retention.applied': {
    en: 'Retention applied ({sprint}): kept={keep} archived={archive} pruned={prune}',
    tr: 'Saklama uygulandı ({sprint}): tutulan={keep} arşivlenen={archive} silinen={prune}',
  },
  'audit.retention.invalid_keep_days': {
    en: '--keep-days must be a non-negative number, got "{value}"',
    tr: '--keep-days negatif olmayan bir sayı olmalı, girilen: "{value}"',
  },
  'audit.retention.invalid_keep_count': {
    en: '--keep-count must be a non-negative integer, got "{value}"',
    tr: '--keep-count negatif olmayan bir tamsayı olmalı, girilen: "{value}"',
  },
  'autonomous.backlog.summary': {
    en: 'Backlog: {total} entries — pending:{pending} running:{running} parked:{parked} done:{done} failed:{failed}',
    tr: 'Backlog: {total} kayıt — bekleyen:{pending} çalışan:{running} beklemede:{parked} tamam:{done} hata:{failed}',
  },
  'autonomous.backlog.list_header': {
    en: 'Backlog ({count} entries):',
    tr: 'Backlog ({count} kayıt):',
  },
  'autonomous.backlog.list_row': {
    en: '  - [{status}] {id}: {title} (kind:{kind} policy:{policy})',
    tr: '  - [{status}] {id}: {title} (tür:{kind} politika:{policy})',
  },

  // ─── autonomous MCP tools (Sprint 589 Task 589-002 i18n — autonomous-approval.ts / autonomous-surface.ts) ──
  'autonomous.mcp.root_desc': {
    en: 'Project root path (default: cwd)',
    tr: 'Proje kök yolu (varsayılan: cwd)',
  },
  'autonomous.mcp_approve.title': {
    en: 'Autonomous Approve',
    tr: 'Otonom Onayla',
  },
  'autonomous.mcp_approve.id_desc': {
    en: 'Trigger/backlog-entry id to approve (alternative to triggerId)',
    tr: 'Onaylanacak trigger/backlog kaydı id’si (triggerId’ye alternatif)',
  },
  'autonomous.mcp_approve.trigger_id_desc': {
    en: 'Trigger/backlog-entry id to approve (preferred over id)',
    tr: 'Onaylanacak trigger/backlog kaydı id’si (id yerine tercih edilir)',
  },
  'autonomous.mcp_approve.reason_desc': {
    en: 'Reason recorded with the approve decision',
    tr: 'Onay kararıyla birlikte kaydedilecek gerekçe',
  },
  'autonomous.mcp_approve.id_required': {
    en: 'triggerId (or id) is required for approve.',
    tr: 'Onaylamak için triggerId (veya id) gerekli.',
  },
  'autonomous.mcp_reject.title': {
    en: 'Autonomous Reject',
    tr: 'Otonom Reddet',
  },
  'autonomous.mcp_reject.id_desc': {
    en: 'Trigger/backlog-entry id to reject (alternative to triggerId)',
    tr: 'Reddedilecek trigger/backlog kaydı id’si (triggerId’ye alternatif)',
  },
  'autonomous.mcp_reject.trigger_id_desc': {
    en: 'Trigger/backlog-entry id to reject (preferred over id)',
    tr: 'Reddedilecek trigger/backlog kaydı id’si (id yerine tercih edilir)',
  },
  'autonomous.mcp_reject.reason_desc': {
    en: 'Reason recorded with the reject decision',
    tr: 'Ret kararıyla birlikte kaydedilecek gerekçe',
  },
  'autonomous.mcp_reject.id_required': {
    en: 'triggerId (or id) is required for reject.',
    tr: 'Reddetmek için triggerId (veya id) gerekli.',
  },
  'autonomous.mcp_backlog.title': {
    en: 'Autonomous Backlog',
    tr: 'Otonom Backlog',
  },
  'autonomous.mcp_backlog.action_desc': {
    en: 'Action to perform',
    tr: 'Gerçekleştirilecek aksiyon',
  },
  'autonomous.mcp_backlog.id_desc': {
    en: 'Entry id — required for add/remove',
    tr: 'Kayıt id’si — add/remove için gerekli',
  },
  'autonomous.mcp_backlog.entry_title_desc': {
    en: 'Entry title — required for add',
    tr: 'Kayıt başlığı — add için gerekli',
  },
  'autonomous.mcp_backlog.kind_desc': {
    en: 'Entry kind (task=inline description, sprint=directives ref, capability=F8 broker verb — capability entries additionally need spec.capabilityTarget, not settable here; use deckent_autonomous for those). Default: task',
    tr: 'Kayıt türü (task=satır içi açıklama, sprint=directives referansı, capability=F8 broker fiili — capability kayıtları ayrıca spec.capabilityTarget gerektirir, burada ayarlanamaz; bunun için deckent_autonomous kullanın). Varsayılan: task',
  },
  'autonomous.mcp_backlog.description_desc': {
    en: 'Task description or directives ref — used by action=add',
    tr: 'Görev açıklaması veya directives referansı — action=add tarafından kullanılır',
  },
  'autonomous.mcp_backlog.policy_desc': {
    en: 'Execution policy for action=add. Default: auto',
    tr: 'action=add için çalıştırma politikası. Varsayılan: auto',
  },
  'autonomous.mcp_backlog.cron_desc': {
    en: '5-field cron expression — entry recurs at this cadence (omit for one-off). Validated at intake; a malformed expression is rejected immediately.',
    tr: '5 alanlı cron ifadesi — kayıt bu sıklıkta tekrarlanır (tek seferlik için boş bırakın). Girişte doğrulanır; hatalı bir ifade hemen reddedilir.',
  },
  'autonomous.mcp_backlog.id_required_add': {
    en: 'id is required for action=add.',
    tr: 'action=add için id gerekli.',
  },
  'autonomous.mcp_backlog.title_required_add': {
    en: 'title is required for action=add.',
    tr: 'action=add için title gerekli.',
  },
  'autonomous.mcp_backlog.invalid_cron': {
    en: 'Invalid cron "{cron}": {error}',
    tr: 'Geçersiz cron "{cron}": {error}',
  },
  'autonomous.mcp_backlog.duplicate': {
    en: 'Entry "{id}" already exists.',
    tr: '"{id}" kaydı zaten var.',
  },
  'autonomous.mcp_backlog.id_required_remove': {
    en: 'id is required for action=remove.',
    tr: 'action=remove için id gerekli.',
  },
  'autonomous.mcp_backlog.not_found': {
    en: 'Entry "{id}" not found.',
    tr: '"{id}" kaydı bulunamadı.',
  },
  'autonomous.mcp_status.title': {
    en: 'Autonomous Status',
    tr: 'Otonom Durum',
  },

  // ─── deckent_autonomous (combined engine tool, 591-004 i18n) ────────────
  'autonomous.mcp_engine.title': {
    en: 'Autonomous Engine',
    tr: 'Otonom Motor',
  },
  'autonomous.mcp_engine.action_desc': {
    en: 'Action to perform. status=query engine state; start=spawn the real autonomous loop as a '
      + 'detached background process (honest no-op if disabled/already running — see spawned field); '
      + 'stop=write stop marker; backlog_add/list/remove=manage work queue; '
      + 'pending=list parked approvals; approve/reject=resolve a parked trigger.',
    tr: 'Gerçekleştirilecek aksiyon. status=motor durumunu sorgular; start=gerçek otonom döngüyü '
      + 'ayrık (detached) bir arka plan süreci olarak başlatır (devre dışıysa/zaten çalışıyorsa dürüst '
      + 'bir no-op — bkz. spawned alanı); stop=durdurma işareti yazar; backlog_add/list/remove=iş '
      + 'kuyruğunu yönetir; pending=bekleyen onayları listeler; approve/reject=bekleyen bir '
      + 'tetikleyiciyi çözümler.',
  },
  'autonomous.mcp_engine.id_desc': {
    en: 'Entry/trigger id — required for backlog_add, backlog_remove, approve, reject',
    tr: 'Kayıt/tetikleyici id’si — backlog_add, backlog_remove, approve, reject için gerekli',
  },
  'autonomous.mcp_engine.title_desc': {
    en: 'Entry title — required for backlog_add',
    tr: 'Kayıt başlığı — backlog_add için gerekli',
  },
  'autonomous.mcp_engine.kind_desc': {
    en: 'Entry kind (task=inline description, sprint=directives ref, capability=F8 broker verb). Default: task',
    tr: 'Kayıt türü (task=satır içi açıklama, sprint=directives referansı, capability=F8 broker fiili). Varsayılan: task',
  },
  'autonomous.mcp_engine.description_desc': {
    en: 'Task description or directives ref — used by backlog_add',
    tr: 'Görev açıklaması veya directives referansı — backlog_add tarafından kullanılır',
  },
  'autonomous.mcp_engine.policy_desc': {
    en: 'Execution policy for backlog_add. Default: auto',
    tr: 'backlog_add için çalıştırma politikası. Varsayılan: auto',
  },
  'autonomous.mcp_engine.cron_desc': {
    en: '5-field cron expression for backlog_add — entry recurs at this cadence (omit for one-off)',
    tr: 'backlog_add için 5 alanlı cron ifadesi — kayıt bu sıklıkta tekrarlanır (tek seferlik için boş bırakın)',
  },
  'autonomous.mcp_engine.capability_desc': {
    en: 'kind=capability: dotted verb to invoke (e.g. fs.read, db.query) — backlog_add',
    tr: 'kind=capability: çağrılacak noktalı fiil (örn. fs.read, db.query) — backlog_add',
  },
  'autonomous.mcp_engine.capability_args_desc': {
    en: 'kind=capability: JSON object of handler args — backlog_add',
    tr: 'kind=capability: handler argümanlarının JSON nesnesi — backlog_add',
  },
  'autonomous.mcp_engine.connector_desc': {
    en: 'kind=capability: preferred backend/connector id (e.g. odoo, imap) — backlog_add',
    tr: 'kind=capability: tercih edilen backend/connector id’si (örn. odoo, imap) — backlog_add',
  },
  'autonomous.mcp_engine.trigger_id_desc': {
    en: 'Trigger ID to approve or reject (alternative to `id` for approve/reject)',
    tr: 'Onaylanacak veya reddedilecek tetikleyici ID’si (approve/reject için `id`ye alternatif)',
  },
  'autonomous.mcp_engine.reason_desc': {
    en: 'Reason recorded with approve/reject decision',
    tr: 'Approve/reject kararıyla birlikte kaydedilecek gerekçe',
  },
  'autonomous.mcp_engine.start_already_running': {
    en: 'Autonomous loop already running (pid {pid}, started {startedAt}). Not spawning a '
      + 'duplicate — use action=stop to signal it to exit cleanly.',
    tr: 'Otonom döngü zaten çalışıyor (pid {pid}, başlangıç {startedAt}). Yinelenen bir süreç '
      + 'başlatılmıyor — temiz çıkış için action=stop kullanın.',
  },
  'autonomous.mcp_engine.start_disabled': {
    en: 'Autonomous mode is disabled (config.autonomous.enabled is not true) — no loop was '
      + 'spawned. Enable it first (`deckent autonomous enable`), then call start again.',
    tr: 'Otonom mod kapalı (config.autonomous.enabled true değil) — hiçbir döngü başlatılmadı. '
      + 'Önce etkinleştirin (`deckent autonomous enable`), sonra start’ı tekrar çağırın.',
  },
  'autonomous.mcp_engine.start_spawn_failed': {
    en: 'Failed to spawn the autonomous loop: {message}',
    tr: 'Otonom döngü başlatılamadı: {message}',
  },
  'autonomous.mcp_engine.start_spawned': {
    en: 'Autonomous loop spawned as a detached background process (pid {pid}). Use '
      + 'action=status to check progress, action=stop to signal a clean stop.',
    tr: 'Otonom döngü ayrık (detached) bir arka plan süreci olarak başlatıldı (pid {pid}). '
      + 'İlerlemeyi kontrol etmek için action=status, temiz durdurma için action=stop kullanın.',
  },
  'autonomous.mcp_engine.start_no_pid': {
    en: 'Autonomous loop spawn requested, but the child process reported no pid — it may have failed to start.',
    tr: 'Otonom döngü başlatma isteği gönderildi, ancak alt süreç pid bildirmedi — başlatılamamış olabilir.',
  },
  'autonomous.mcp_engine.id_required_backlog_add': {
    en: 'id is required for backlog_add',
    tr: 'backlog_add için id gerekli',
  },
  'autonomous.mcp_engine.title_required_backlog_add': {
    en: 'title is required for backlog_add',
    tr: 'backlog_add için title gerekli',
  },
  'autonomous.mcp_engine.id_required_backlog_remove': {
    en: 'id is required for backlog_remove',
    tr: 'backlog_remove için id gerekli',
  },
  'autonomous.mcp_engine.id_required_approve': {
    en: 'triggerId (or id) is required for approve',
    tr: 'approve için triggerId (veya id) gerekli',
  },
  'autonomous.mcp_engine.id_required_reject': {
    en: 'triggerId (or id) is required for reject',
    tr: 'reject için triggerId (veya id) gerekli',
  },
  'autonomous.mcp_engine.unknown_action': {
    en: 'Unknown action: {action}',
    tr: 'Bilinmeyen aksiyon: {action}',
  },

  // ─── autonomous-mission command (Sprint 296 — Task 296-001 i18n) ─────────
  'autonomous_mission.create_list.created': {
    en: 'Mission created: {id} — {title} ({count} item(s))',
    tr: 'Misyon oluşturuldu: {id} — {title} ({count} madde)',
  },
  'autonomous_mission.create_goal.created': {
    en: 'Goal mission created: {id} — {goal}',
    tr: 'Hedef misyonu oluşturuldu: {id} — {goal}',
  },
  'autonomous_mission.engine_disabled_warning': {
    en: 'Warning: the autonomous engine is disabled — this mission is queued but will NOT be processed until you run `deckent autonomous enable`.',
    tr: 'Uyarı: otonom motor devre dışı — bu misyon kuyruğa alındı ancak `deckent autonomous enable` çalıştırılana kadar İŞLENMEYECEK.',
  },
  'autonomous_mission.list.empty': {
    en: 'No autonomous missions found.',
    tr: 'Otonom misyon bulunamadı.',
  },
  'autonomous_mission.list.header': {
    en: 'Autonomous missions ({count}):',
    tr: 'Otonom misyonlar ({count}):',
  },
  'autonomous_mission.items_file_error': {
    en: 'Failed to load items file: {error}',
    tr: 'Madde dosyası yüklenemedi: {error}',
  },

  // ─── mission deliver (mission-deliver.ts) ─────────────────────────────────
  'mission.settled.title': {
    en: 'Mission settled: {title}',
    tr: 'Misyon tamamlandı: {title}',
  },
  'mission.settled.summary': {
    en: 'Mission {id} finished with status: {status}',
    tr: '{id} misyonu {status} durumuyla tamamlandı',
  },

  // ─── memory backup subcommand ──────────────────────────────────
  'trace.desc': {
    en: 'Trace extraction, immutable migration, and governed training-corpus tooling',
    tr: 'Trace çıkarma, immutable migration ve yönetişimli eğitim-korpusu araçları',
  },
  'trace.extract.desc': {
    en: 'Extract aligned + general training examples from Claude Code session transcript(s)',
    tr: 'Claude Code oturum transkript(ler)inden aligned + general eğitim örnekleri çıkar',
  },
  'trace.extract.arg.input': {
    en: 'Path to a transcript JSONL file, or a directory containing multiple transcripts',
    tr: 'Transkript JSONL dosyası ya da birden çok transkript içeren dizin yolu',
  },
  'trace.extract.opt.out': {
    en: 'Output directory for aligned.jsonl/general.jsonl',
    tr: 'aligned.jsonl/general.jsonl için çıktı dizini',
  },
  'trace.extract.opt.system': {
    en: "System prompt to prepend to each example (default: deckent's agentic system prompt)",
    tr: 'Her örneğin başına eklenecek system prompt (varsayılan: deckent agentic system prompt)',
  },
  'trace.extract.error.not_found': {
    en: 'Input path not found: {path}',
    tr: 'Girdi yolu bulunamadı: {path}',
  },
  'trace.extract.summary': {
    en: 'Extracted {aligned} aligned + {general} general example(s) from {files} transcript file(s) -> {outDir} ({redacted} redacted).',
    tr: '{files} transkript dosyasından {aligned} aligned + {general} general örnek çıkarıldı -> {outDir} ({redacted} redaksiyonlu).',
  },
  'trace.opt.json': {
    en: 'Emit stable machine-readable JSON',
    tr: 'Kararlı ve makine-okunur JSON üret',
  },
  'trace.error': {
    en: 'Trace command failed [{code}]: {message}',
    tr: 'Trace komutu başarısız [{code}]: {message}',
  },
  'trace.migrate.desc': {
    en: 'Reconcile historical JSONL traces into a canonical immutable projection (dry-run by default)',
    tr: 'Geçmiş JSONL trace kayıtlarını canonical immutable projection ile uzlaştır (varsayılan dry-run)',
  },
  'trace.migrate.arg.inputs': {
    en: 'One or more project-relative trace files or directories',
    tr: 'Bir veya daha çok proje-relative trace dosyası ya da dizini',
  },
  'trace.migrate.opt.out': {
    en: 'New no-clobber migration output directory',
    tr: 'Yeni, üzerine yazılmayan migration çıktı dizini',
  },
  'trace.migrate.opt.apply': {
    en: 'Publish the reconciled projection; omission remains side-effect-free',
    tr: "Uzlaştırılmış projection'ı yayınla; verilmezse işlem side-effect-free kalır",
  },
  'trace.migrate.opt.allow_training': {
    en: 'Explicitly admit structurally valid records for training',
    tr: 'Yapısal olarak geçerli kayıtları eğitim için açıkça kabul et',
  },
  'trace.migrate.opt.weight': {
    en: 'Positive training weight (requires --allow-training; default 1)',
    tr: 'Pozitif eğitim ağırlığı (--allow-training gerektirir; varsayılan 1)',
  },
  'trace.migrate.opt.require_consent': {
    en: 'Require observed per-record consent authority for train-ready disposition',
    tr: 'Train-ready kararı için kayıt üzerinde gözlenen consent authority iste',
  },
  'trace.migrate.opt.require_lineage': {
    en: 'Require observed run or sprint lineage for train-ready disposition',
    tr: 'Train-ready kararı için gözlenen run veya sprint lineage iste',
  },
  'trace.migrate.opt.exclude': {
    en: 'Policy-exclude every record while retaining the immutable projection',
    tr: "Immutable projection'ı koruyarak tüm kayıtları policy ile dışla",
  },
  'trace.migrate.opt.policy_version': {
    en: 'Explicit policy authority version',
    tr: 'Açık policy authority sürümü',
  },
  'trace.migrate.opt.contract_version': {
    en: 'Explicit migration contract version',
    tr: 'Açık migration contract sürümü',
  },
  'trace.migrate.summary': {
    en: 'Trace migration {mode}/{status}: id={migrationId}, parsed={parsed}, projected={projected}, malformed={malformed}, output={outputPath}',
    tr: 'Trace migration {mode}/{status}: id={migrationId}, parsed={parsed}, projected={projected}, malformed={malformed}, çıktı={outputPath}',
  },
  'trace.corpus.desc': {
    en: 'Build and audit manifest-authorized Deckent training corpora',
    tr: 'Manifest-authorized Deckent eğitim korpuslarını üret ve denetle',
  },
  'trace.corpus.build.desc': {
    en: 'Build a fail-closed ShareGPT corpus from a verified migration',
    tr: "Doğrulanmış migration'dan fail-closed ShareGPT korpusu üret",
  },
  'trace.corpus.lint.desc': {
    en: 'Verify corpus schema, provenance, causality, secrets, duplicates, and manifest reconciliation',
    tr: 'Korpus şeması, provenance, causality, secret, duplicate ve manifest uzlaşmasını doğrula',
  },
  'trace.corpus.arg.migration': {
    en: 'Project-relative canonical migration directory',
    tr: 'Proje-relative canonical migration dizini',
  },
  'trace.corpus.arg.corpus': {
    en: 'Project-relative ShareGPT corpus JSONL file',
    tr: 'Proje-relative ShareGPT korpus JSONL dosyası',
  },
  'trace.corpus.opt.out': {
    en: 'New no-clobber corpus output file',
    tr: 'Yeni, üzerine yazılmayan korpus çıktı dosyası',
  },
  'trace.corpus.opt.manifest': {
    en: 'Pipeline manifest path (default: <corpus>.manifest.json)',
    tr: 'Pipeline manifest yolu (varsayılan: <corpus>.manifest.json)',
  },
  'trace.corpus.build.summary': {
    en: 'Canonical corpus published: {written} train-ready record(s), {rejected} held out -> {outputPath}',
    tr: 'Canonical korpus yayınlandı: {written} train-ready kayıt, {rejected} dışarıda tutuldu -> {outputPath}',
  },
  'trace.corpus.lint.ok': {
    en: 'Corpus verified: {valid} valid record(s), zero violations.',
    tr: 'Korpus doğrulandı: {valid} geçerli kayıt, sıfır ihlal.',
  },
  'trace.corpus.lint.failed': {
    en: 'Corpus verification failed: {valid} valid record(s), {violations} violation(s).',
    tr: 'Korpus doğrulaması başarısız: {valid} geçerli kayıt, {violations} ihlal.',
  },
  'memory.backup.desc': {
    en: 'Create a WAL-safe backup of memory.db',
    tr: 'memory.db dosyasının WAL-güvenli yedeğini oluştur',
  },
  'memory.backup.not_found': {
    en: 'memory.db not found. Nothing to backup.',
    tr: 'memory.db bulunamadı. Yedeklenecek dosya yok.',
  },
  'memory.backup.success': {
    en: 'Backup created: {path} ({count} entries)',
    tr: 'Yedek oluşturuldu: {path} ({count} giriş)',
  },
  'memory.backup.checkpoint_done': {
    en: 'WAL checkpoint complete',
    tr: 'WAL checkpoint tamamlandı',
  },
  'memory.backup.error': {
    en: 'Backup failed: {error}',
    tr: 'Yedekleme başarısız: {error}',
  },
  'memory.export.not_found': {
    en: 'memory.db not found. Run migration first.',
    tr: 'memory.db bulunamadı. Önce migration çalıştırın.',
  },
  'memory.export.success': {
    en: 'Exported {count} .md files to .brain/exports/.',
    tr: '.brain/exports/ dizinine {count} .md dosyası aktarıldı.',
  },
  'memory.export.guard_hold': {
    en: 'Export held: preserved {files} because existing snapshots contain more authority data than this memory.db ({written} safe file(s) written). Reconcile the project database before retrying.',
    tr: 'Export bekletildi: mevcut snapshot bu memory.db dosyasından daha fazla otorite verisi içerdiği için {files} korundu ({written} güvenli dosya yazıldı). Yeniden denemeden önce proje veritabanını uzlaştırın.',
  },

  // ─── inbound bot command acks (BOT-002, §4G) ───────────────────
  'bot.approve_ack': {
    en: '✅ Approved: {id}',
    tr: '✅ Onaylandı: {id}',
  },
  'bot.reject_ack': {
    en: '❌ Rejected: {id}',
    tr: '❌ Reddedildi: {id}',
  },
  'bot.approve_ack_ctx': {
    en: '✅ Approved: {id} — {what}',
    tr: '✅ Onaylandı: {id} — {what}',
  },
  'bot.reject_ack_ctx': {
    en: '❌ Rejected: {id} — {what}',
    tr: '❌ Reddedildi: {id} — {what}',
  },
  'bot.not_found': {
    en: '⚠️ No pending approval found (unknown or expired): {id}',
    tr: '⚠️ Bekleyen onay bulunamadı (bilinmiyor veya süresi doldu): {id}',
  },
  'bot.resolve_failed': {
    en: '⚠️ Could not process {action} for {id} — please try again.',
    tr: '⚠️ {id} için {action} işlenemedi — lütfen tekrar deneyin.',
  },
  'bot.listen_desc': {
    en: 'Listen for inbound approve/reject commands from messaging connectors',
    tr: 'Mesaj connector\'larından gelen approve/reject komutlarını dinle',
  },
  'bot.group_desc': {
    en: 'Messaging-connector bot — listen/start/stop/status for inbound approve/reject',
    tr: 'Mesaj-connector botu — gelen approve/reject için listen/start/stop/status',
  },
  'approval.channel.decided': {
    en: 'Approval {id} was decided.',
    tr: '{id} onayı karara bağlandı.',
  },
  'approval.channel.idempotent': {
    en: 'Approval {id} already has this decision.',
    tr: '{id} onayı için bu karar zaten kaydedildi.',
  },
  'approval.channel.expired': {
    en: 'Approval {id} has expired.',
    tr: '{id} onayının süresi doldu.',
  },
  'approval.channel.rejected': {
    en: 'Approval decision was rejected ({reason}).',
    tr: 'Onay kararı reddedildi ({reason}).',
  },
  'approval.channel.unauthorized': {
    en: 'This channel is not authorized to decide approval {id} (unknown chat binding or identity). Use: deckent approvals decide #{id}',
    tr: 'Bu kanal {id} onayı için yetkili değil (tanımsız chat-bağı ya da kimlik). CLI: deckent approvals decide #{id}',
  },
  'approval.channel.critical_cli_only': {
    en: 'Approval {id} is critical-tier: channels are view-only. Decide via CLI: deckent approvals decide #{id}',
    tr: '{id} onayı critical-seviye: kanallar yalnızca görüntüler. Karar CLI ile: deckent approvals decide #{id}',
  },
  'approval.channel.ambiguous': {
    en: 'Approval code {code} is ambiguous; use the CLI with a full id: {ids}.',
    tr: '{code} onay kodu belirsiz; CLI üzerinde tam kimlik kullanın: {ids}.',
  },
  'approval.channel.nonce_exhausted': {
    en: 'This approval action has expired or was already used. Request a new approval message.',
    tr: 'Bu onay eyleminin süresi doldu veya eylem daha önce kullanıldı. Yeni bir onay mesajı isteyin.',
  },
  'approval.channel.unknown': {
    en: 'Approval code {code} is unknown or no longer pending.',
    tr: '{code} onay kodu bilinmiyor veya artık beklemede değil.',
  },
  'approval.channel.runtime_hold': {
    en: 'Approval relay unavailable ({reason}/{detail}); bot connectors continue.',
    tr: 'Onay relay kullanılamıyor ({reason}/{detail}); bot connector’ları çalışmaya devam ediyor.',
  },
  'approval.channel.cross_decided': {
    en: 'Decision made on channel {channel}.',
    tr: 'Karar {channel} kanalında verildi.',
  },
  'approval.channel.transport_error': {
    en: 'Approval channel {channel} failed: {detail}',
    tr: 'Onay kanalı {channel} başarısız oldu: {detail}',
  },
  'bot.listen_none': {
    en: 'No messaging connectors configured for inbound commands — nothing to listen on. Set notify_connectors.{telegram|discord}.{enabled,token,chat_id} (token via .deck).',
    tr: 'Inbound komutlar için yapılandırılmış mesaj connector\'ı yok — dinlenecek bir şey yok. notify_connectors.{telegram|discord}.{enabled,token,chat_id} ayarla (token .deck ile).',
  },
  'bot.listen_active': {
    en: '🟢 Listening for approve/reject on: {connectors}. Reply "approve <id>" or "reject <id>" from the configured chat. Ctrl-C to stop.',
    tr: '🟢 approve/reject dinleniyor: {connectors}. Yapılandırılmış sohbetten "approve <id>" veya "reject <id>" yaz. Durdurmak için Ctrl-C.',
  },
  'bot.listen_stopped': {
    en: 'Stopped listening for inbound commands.',
    tr: 'Inbound komut dinleme durduruldu.',
  },
  'bot.nervous_active': {
    en: '🧠 Nervous system active (always-on): approvals from any source are consumed and acknowledged here.',
    tr: '🧠 Nervous sistemi aktif (daima-açık): herhangi bir kaynaktan gelen onaylar burada tüketilir ve onaylandığı yazılır.',
  },
  'bot.chat_thinking': {
    en: '💭 thinking…',
    tr: '💭 düşünüyorum…',
  },
  'bot.chat_empty': {
    en: '(no response)',
    tr: '(yanıt yok)',
  },
  'bot.chat_error': {
    en: '⚠️ Could not process that message — try again.',
    tr: '⚠️ Bu mesaj işlenemedi — tekrar dene.',
  },
  'bot.action_done': {
    en: '✅ Executed {tool}:',
    tr: '✅ {tool} çalıştırıldı:',
  },
  'bot.action_rejected': {
    en: '❌ Rejected — {tool} was not executed.',
    tr: '❌ Reddedildi — {tool} çalıştırılmadı.',
  },
  'bot.action_failed': {
    en: '⚠️ {tool} failed: {error}',
    tr: '⚠️ {tool} başarısız: {error}',
  },

  // ─── curated bot command surface (BOT-003 slice 2c) ────────────
  'bot.unknown_command': {
    en: 'Unknown command. Type /help to see what I can do — or just write naturally and I\'ll act (asking approval for risky things).',
    tr: 'Bilinmeyen komut. Neler yapabildiğimi görmek için /help yaz — ya da doğal dilde yaz, ben hallederim (riskli işler için onay isterim).',
  },
  'bot.help_body': {
    en: [
      '🤖 deckent bot — commands:',
      '  /help      this list',
      '  /status    current run status',
      '  /history   recent runs',
      '  /pending   actions awaiting your approval',
      '',
      '🔐 approve <id>  /  reject <id>   — approve or reject a parked action',
      '',
      '💬 Or just write naturally — ask anything, or tell me what to do.',
      '   I run read-only things instantly and ask "approve <id>" before anything risky.',
    ].join('\n'),
    tr: [
      '🤖 deckent bot — komutlar:',
      '  /help      bu liste',
      '  /status    aktif run durumu',
      '  /history   son run\'lar',
      '  /pending   onayını bekleyen işlemler',
      '',
      '🔐 approve <id>  /  reject <id>   — parklanmış işlemi onayla veya reddet',
      '',
      '💬 Ya da doğal dilde yaz — soru sor veya ne yapmamı istediğini söyle.',
      '   Salt-okunur şeyleri anında yaparım, riskli her şeyden önce "approve <id>" isterim.',
    ].join('\n'),
  },
  'bot.pending_header': {
    en: '🔐 Actions awaiting your approval:',
    tr: '🔐 Onayını bekleyen işlemler:',
  },
  'bot.pending_none': {
    en: 'No actions awaiting approval.',
    tr: 'Onay bekleyen işlem yok.',
  },
  'bot.pending_row': {
    en: '  • {tool}({args}) — approve {id} / reject {id}',
    tr: '  • {tool}({args}) — approve {id} / reject {id}',
  },
  'bot.pending_approval_row': {
    en: '  • [{kind}] {title} — approve {id} / reject {id}',
    tr: '  • [{kind}] {title} — approve {id} / reject {id}',
  },
  'bot.action_expired': {
    en: '⏲️ Expired — {tool} was not executed (the approval was too old). Ask again if you still want it.',
    tr: '⏲️ Süresi doldu — {tool} çalıştırılmadı (onay çok eskidi). Hâlâ istiyorsan tekrar iste.',
  },
  'bot.action_sprint_changed': {
    en: '🛡️ Not executed — {tool} was tied to run {sprint}, which is no longer the active run. Refusing so a stale command can\'t hit a different run.',
    tr: '🛡️ Çalıştırılmadı — {tool}, {sprint} run\'ına bağlıydı ama o artık aktif run değil. Bayat bir komut başka run\'ı vurmasın diye reddedildi.',
  },
  'bot.kill_done': {
    en: '✅ Killed run {sprint} (pid {pid}).',
    tr: '✅ {sprint} run\'ı öldürüldü (pid {pid}).',
  },
  'bot.kill_reused': {
    en: '🛡️ Not executed — run {sprint}\'s process is gone and its pid now belongs to something else. Refusing to signal a foreign process.',
    tr: '🛡️ Çalıştırılmadı — {sprint} run\'ının process\'i gitmiş ve pid\'i artık başka bir şeye ait. Yabancı bir process\'e sinyal göndermeyi reddediyorum.',
  },
  'bot.kill_already_stopped': {
    en: 'ℹ️ Run {sprint} is already stopped — nothing to kill.',
    tr: 'ℹ️ {sprint} run\'ı zaten durmuş — öldürülecek bir şey yok.',
  },

  // ─── serve command ──────────────────────────────────────────────────
  'serve.listening': {
    en: 'Deckent is ready — http://{host}:{port}',
    tr: 'Deckent hazır — http://{host}:{port}',
  },
  'serve.token_injected': {
    en: '  Token     API token auto-injected into dashboard HTML (localhost: no extra step)',
    tr: '  Token     API token dashboard HTML\'ine otomatik enjekte edildi (localhost: ek adım yok)',
  },
  'serve.terminal_enabled': {
    en: '  Terminal  embedded PTY enabled (token auto-injected for localhost callers)',
    tr: '  Terminal  gömülü PTY aktif (localhost arayanlar için token otomatik enjekte)',
  },
  'serve.terminal_disabled': {
    en: '  Terminal  disabled — pass --terminal on localhost to enable',
    tr: '  Terminal  kapalı — etkinleştirmek için localhost\'ta --terminal geçin',
  },
  'serve.terminal_non_localhost_warning': {
    en: 'Warning: terminal disabled — non-localhost host requires explicit --no-terminal',
    tr: 'Uyarı: terminal kapatıldı — localhost-dışı host açıkça --no-terminal gerektirir',
  },
  'serve.stop_hint': {
    en: '  Stop      Ctrl+C',
    tr: '  Durdurmak Ctrl+C',
  },
  'serve.port_tip': {
    en: '  Tips      deckent serve --port <n>  --host <addr>',
    tr: '  İpuçları  deckent serve --port <n>  --host <adres>',
  },
  'serve.daemon_meta_failed': {
    en: 'Warning: could not write the desktop handshake file (.deckent/serve-daemon.json) — the server runs normally, but a desktop shell cannot auto-adopt this daemon: {error}',
    tr: 'Uyarı: desktop el-sıkışma dosyası (.deckent/serve-daemon.json) yazılamadı — sunucu normal çalışıyor, ancak desktop kabuğu bu daemon\'ı otomatik devralamaz: {error}',
  },
  'serve.approval_authority_hold': {
    en: 'Attended execution approval authority is on HOLD ({reason}/{detail}); API decisions cannot authorize unsupported remote execution.',
    tr: 'Attended execution approval authority HOLD durumunda ({reason}/{detail}); API kararları desteklenmeyen remote execution için yetki veremez.',
  },
  'api.approval.fresh_oidc_required': {
    en: 'Fresh OIDC step-up authentication is required.',
    tr: 'Yeni bir OIDC step-up kimlik doğrulaması gereklidir.',
  },
  'api.approval.idempotency_required': {
    en: 'Idempotency-Key header is required.',
    tr: 'Idempotency-Key başlığı gereklidir.',
  },
  'api.approval.authority_unavailable': {
    en: 'Attended execution approval authority is unavailable.',
    tr: 'Attended execution approval authority kullanılamıyor.',
  },
  'api.approval.decision_rejected': {
    en: 'Approval decision rejected: {reason}',
    tr: 'Approval kararı reddedildi: {reason}',
  },
  'api.approval.request_expired': {
    en: 'Approval request expired.',
    tr: 'Approval isteğinin süresi doldu.',
  },
  'api.approval.decision_failed': {
    en: 'Approval decision failed: {error}',
    tr: 'Approval kararı başarısız oldu: {error}',
  },
  // 591-006: approvals-route (not decision-boundary) human-readable strings —
  // GET /api/approvals/:id and POST /api/approvals/:id/decision's own
  // id/lookup/gate errors. Deliberately `api.approvals.*` (plural) to stay
  // distinct from the decision-boundary `api.approval.*` (singular) family
  // above.
  'api.approvals.invalid_id': {
    en: 'Invalid approval id',
    tr: 'Geçersiz approval id\'si',
  },
  'api.approvals.not_found': {
    en: 'Approval not found',
    tr: 'Approval bulunamadı',
  },
  'api.approvals.api_decide_disabled': {
    en: 'Approval API decisions are disabled — set approval.api_decide: true in .deckent/config.json to enable POST /api/approvals/:id/decision',
    tr: 'Approval API kararları kapalı — POST /api/approvals/:id/decision\'ı etkinleştirmek için .deckent/config.json içinde approval.api_decide: true ayarlayın',
  },
  'api.approvals.already_decided': {
    en: 'Approval already {category}',
    tr: 'Approval zaten {category}',
  },
  'autonomous.approval_request_summary': {
    en: 'Approve Goal-v2 item {id}: {title}',
    tr: 'Goal-v2 iş kalemini onayla {id}: {title}',
  },
  // SEC-03 (415-003): raw-token stderr redaction — a bearer token must never
  // land in a process-log stream (CI/journald/log-shippers capture stderr
  // verbatim). These log a short fingerprint + the 0600 file the real value
  // was persisted to, instead of the token itself.
  'serve.token.auto_generated': {
    en: '[deckent:info] Auto-generated API token (active for /api/* Bearer auth) — fingerprint {fingerprint}, full token in {path} (0600)',
    tr: '[deckent:info] Otomatik üretilen API token (aktif /api/* Bearer auth için) — parmak izi {fingerprint}, tam token {path} dosyasında (0600)',
  },
  'serve.token.auto_minted': {
    en: '[deckent:info] Auto-minted localhost API token (this is the ACTIVE token for /api/* Bearer auth; the dashboard on localhost receives it automatically) — fingerprint {fingerprint}, full token in {path} (0600)',
    tr: '[deckent:info] Otomatik oluşturulan localhost API token (bu /api/* Bearer auth için AKTİF token; localhost\'taki dashboard bunu otomatik alır) — parmak izi {fingerprint}, tam token {path} dosyasında (0600)',
  },
  'serve.token.terminal_minted': {
    en: '[deckent:info] Terminal session token (embedded web terminal only — NOT the /api/* API token) — fingerprint {fingerprint}, full token in {path} (0600)',
    tr: '[deckent:info] Terminal oturum token\'ı (yalnızca gömülü web terminali — /api/* API token\'ı DEĞİL) — parmak izi {fingerprint}, tam token {path} dosyasında (0600)',
  },
  'serve.token.persist_failed': {
    en: '[deckent:warn] Could not persist the {file} token file — {error}. The active token still works for auth; only the on-disk copy is missing.',
    tr: '[deckent:warn] {file} token dosyası kalıcı hale getirilemedi — {error}. Aktif token auth için hâlâ çalışıyor; yalnızca disk kopyası eksik.',
  },
  'serve.token.posix_chmod_failed': {
    en: '[deckent:warn] Could not set owner-only (0600) permissions on {path} — {error}',
    tr: '[deckent:warn] {path} üzerinde yalnızca-sahip (0600) izinleri ayarlanamadı — {error}',
  },
  'serve.token.win_acl_unavailable': {
    en: '[deckent:warn] Could not determine the current Windows user (USERNAME unset) — skipping icacls hardening for {path}. The file may be readable by other accounts.',
    tr: '[deckent:warn] Mevcut Windows kullanıcısı belirlenemedi (USERNAME tanımsız) — {path} için icacls sıkılaştırması atlanıyor. Dosya diğer hesaplar tarafından okunabilir olabilir.',
  },
  'serve.token.win_acl_warn': {
    en: '[deckent:warn] icacls hardening issue for {path}: {detail}. The file may be readable by other accounts.',
    tr: '[deckent:warn] {path} için icacls sıkılaştırma sorunu: {detail}. Dosya diğer hesaplar tarafından okunabilir olabilir.',
  },

  // ─── bot daemon (start/stop/status) ────────────────────────────
  'bot.daemon_desc': {
    en: 'Run the bot listener as a background daemon',
    tr: 'Bot dinleyicisini arka plan daemon\'ı olarak çalıştır',
  },
  'bot.stop_desc': {
    en: 'Stop the bot daemon',
    tr: 'Bot daemon\'ını durdur',
  },
  'bot.status_desc': {
    en: 'Show whether the bot daemon is running',
    tr: 'Bot daemon\'ının çalışıp çalışmadığını göster',
  },
  'bot.root_option': {
    en: 'Project root override',
    tr: 'Proje kökü geçersiz kılma değeri',
  },
  'bot.lang_option': {
    en: 'Language override (en|tr)',
    tr: 'Dil geçersiz kılma değeri (en|tr)',
  },
  'bot.daemon_started': {
    en: '🟢 Bot daemon started (pid {pid}). Always-on while this machine is up. Stop with: deckent bot stop',
    tr: '🟢 Bot daemon başladı (pid {pid}). Makine açık olduğu sürece çalışır. Durdurmak için: deckent bot stop',
  },
  'bot.daemon_reboot_note': {
    en: 'Note: a daemon does NOT survive a reboot/crash — use a systemd/pm2 service for that.',
    tr: 'Not: daemon yeniden başlatma/çökmeden SONRA yaşamaz — bunun için systemd/pm2 servisi kullan.',
  },
  'bot.daemon_already': {
    en: 'ℹ️ Bot daemon is already running (pid {pid}).',
    tr: 'ℹ️ Bot daemon zaten çalışıyor (pid {pid}).',
  },
  'bot.daemon_spawn_failed': {
    en: '⚠️ Failed to start the bot daemon.',
    tr: '⚠️ Bot daemon başlatılamadı.',
  },
  'bot.daemon_pid_record_failed': {
    en: '⚠️ Bot listener started, but its process ownership record could not be claimed. The listener was stopped safely.',
    tr: '⚠️ Bot dinleyicisi başladı ancak process ownership kaydı alınamadı. Dinleyici güvenli biçimde durduruldu.',
  },
  'bot.daemon_ownership_unknown': {
    en: '⛔ Bot process ownership cannot be proven (pid {pid}, reason {reason}); no signal or new daemon was issued.',
    tr: '⛔ Bot process ownership kanıtlanamıyor (pid {pid}, neden {reason}); sinyal gönderilmedi ve yeni daemon başlatılmadı.',
  },
  'bot.daemon_stopped': {
    en: '🛑 Bot daemon stopped (pid {pid}).',
    tr: '🛑 Bot daemon durduruldu (pid {pid}).',
  },
  'bot.daemon_not_running': {
    en: 'Bot daemon is not running.',
    tr: 'Bot daemon çalışmıyor.',
  },
  'bot.daemon_status_running': {
    en: '🟢 Bot daemon is running (pid {pid}).',
    tr: '🟢 Bot daemon çalışıyor (pid {pid}).',
  },

  // ─── resources command (Sprint 271 T-004) ────────────────────────────────
  'resources.snapshot_title': {
    en: 'Live Worker Resource Snapshot',
    tr: 'Canlı Worker Kaynak Anlık Görüntüsü',
  },
  'resources.log_title': {
    en: 'Resource Log Summary',
    tr: 'Kaynak Log Özeti',
  },
  'resources.docker_unavailable': {
    en: 'Docker is not available — cannot retrieve resource data.',
    tr: 'Docker mevcut değil — kaynak verisi alınamıyor.',
  },
  'resources.no_containers': {
    en: 'No deckent worker containers running.',
    tr: 'Çalışan deckent worker container\'ı yok.',
  },
  'resources.log_not_found': {
    en: 'Resource log not found: {path}',
    tr: 'Kaynak log bulunamadı: {path}',
  },
  'resources.log_empty': {
    en: 'Resource log is empty — no samples recorded.',
    tr: 'Kaynak log boş — hiç örnek kaydedilmemiş.',
  },
  'resources.table_header_container': {
    en: 'Container',
    tr: 'Container',
  },
  'resources.table_header_task': {
    en: 'Task',
    tr: 'Görev',
  },
  'resources.table_header_mem_usage': {
    en: 'Mem Usage',
    tr: 'Bellek Kullanımı',
  },
  'resources.table_header_mem_limit': {
    en: 'Mem Limit',
    tr: 'Bellek Limiti',
  },
  'resources.table_header_mem_pct': {
    en: 'Mem%',
    tr: 'Bellek%',
  },
  'resources.table_header_cpu_pct': {
    en: 'CPU%',
    tr: 'CPU%',
  },
  'resources.config_line': {
    en: 'Config: memory_limit={limit}/swap={swap}, max_workers={workers}, RAM ceiling={ceiling}',
    tr: 'Yapılandırma: memory_limit={limit}/swap={swap}, max_workers={workers}, RAM tavanı={ceiling}',
  },
  'resources.log_header_task': {
    en: 'Task',
    tr: 'Görev',
  },
  'resources.log_header_peak_mem': {
    en: 'Peak Mem',
    tr: 'Tepe Bellek',
  },
  'resources.log_header_avg_mem': {
    en: 'Avg Mem',
    tr: 'Ort. Bellek',
  },
  'resources.log_header_peak_cpu': {
    en: 'Peak CPU%',
    tr: 'Tepe CPU%',
  },
  'resources.log_header_duration': {
    en: 'Duration(s)',
    tr: 'Süre(s)',
  },
  'resources.sprint_peak': {
    en: 'Run concurrent peak: {peak} ({containers} containers)',
    tr: 'Run eşzamanlı tepe: {peak} ({containers} container)',
  },

  // ─── usage command ─────────────────────────────────────────────────
  'usage.option.sprint': { en: 'Show per-task breakdown for run N', tr: 'Run N için görev bazında dökümü gösterin' },
  'usage.option.since': { en: 'Set the usage window start (ISO date)', tr: 'Kullanım aralığının başlangıcını belirleyin (ISO tarihi)' },
  'usage.option.until': { en: 'Set the usage window end (ISO date)', tr: 'Kullanım aralığının sonunu belirleyin (ISO tarihi)' },
  'usage.option.json': { en: 'Output stable JSON', tr: 'Kararlı JSON çıktısı üretin' },
  'usage.option.lineage': { en: 'Show archived lineage-aware usage authority', tr: 'Arşivlenmiş soy farkındalıklı kullanım otoritesini gösterin' },
  'usage.option.baseline_sprint': { en: 'Select the baseline sprint archive', tr: 'Temel sprint arşivini seçin' },
  'usage.option.candidate_sprint': { en: 'Select the candidate sprint archive', tr: 'Aday sprint arşivini seçin' },
  'usage.option.apply': { en: 'Publish a digest-bound canary receipt (default: dry-run)', tr: 'Digest bağlı canary makbuzu yayımlayın (varsayılan: dry-run)' },
  'usage.option.decision_digest': { en: 'Require this dry-run decision digest when applying', tr: 'Uygularken bu dry-run karar digest değerini zorunlu tutun' },
  'usage.option.environment': { en: 'Use this receipt environment scope', tr: 'Bu makbuz ortam kapsamını kullanın' },
  'usage.option.tenant': { en: 'Use this receipt tenant scope', tr: 'Bu makbuz tenant kapsamını kullanın' },
  'usage.lineage_header': { en: 'Lineage Usage (Archived)', tr: 'Soy Kullanımı (Arşivlenmiş)' },
  'usage.lineage_col_attempts': { en: 'Attempts', tr: 'Denemeler' },
  'usage.lineage_col_in': { en: 'In', tr: 'Giren' },
  'usage.lineage_col_out': { en: 'Out', tr: 'Çıkan' },
  'usage.lineage_col_cache_r': { en: 'CacheR', tr: 'ÖnbellekO' },
  'usage.lineage_col_cache_c': { en: 'CacheC', tr: 'ÖnbellekY' },
  'usage.lineage_col_ref_usd': { en: 'RefUSD', tr: 'RefUSD' },
  'usage.lineage_col_billed': { en: 'Billed', tr: 'Faturalı' },
  'usage.lineage_billed_unknown': { en: 'unknown', tr: 'bilinmiyor' },
  'usage.lineage_denominator': { en: '{logical} logical task(s) / {attempts} attempt(s)', tr: '{logical} mantıksal görev / {attempts} deneme' },
  'usage.canary.both_sprints_required': { en: 'Both --baseline-sprint and --candidate-sprint are required.', tr: 'Hem --baseline-sprint hem --candidate-sprint zorunludur.' },
  'usage.canary.mutually_exclusive': { en: 'Canary sprint options cannot be combined with window, sprint, or lineage options.', tr: 'Canary sprint seçenekleri aralık, sprint veya soy seçenekleriyle birleştirilemez.' },
  'usage.canary.apply_requires_comparison': { en: '--apply requires baseline and candidate sprint options.', tr: '--apply temel ve aday sprint seçeneklerini gerektirir.' },
  'usage.canary.scope_requires_comparison': { en: 'Receipt digest and scope options require baseline and candidate sprint options.', tr: 'Makbuz digest ve kapsam seçenekleri temel ve aday sprint seçeneklerini gerektirir.' },
  'usage.canary.apply_digest_mismatch': { en: '--apply requires the exact --decision-digest from the dry-run.', tr: '--apply dry-run çıktısındaki tam --decision-digest değerini gerektirir.' },
  'usage.canary.summary': { en: 'Canary {mode}: {decision} — cost authority: {authority} ({digest})', tr: 'Canary {mode}: {decision} — maliyet otoritesi: {authority} ({digest})' },
  'usage.no_transcript_dir': {
    en: 'Transcript directory not found — no usage data available.',
    tr: 'Transkript dizini bulunamadı — kullanım verisi mevcut değil.',
  },
  'usage.no_data': {
    en: 'No usage data found for the selected period.',
    tr: 'Seçilen dönem için kullanım verisi bulunamadı.',
  },
  'usage.header_window': {
    en: 'Usage — last {days} days',
    tr: 'Kullanım — son {days} gün',
  },
  'usage.header_since_until': {
    en: 'Usage — {since} to {until}',
    tr: 'Kullanım — {since} → {until}',
  },
  'usage.header_sprint': {
    en: 'Usage — Run {sprint}',
    tr: 'Kullanım — Run {sprint}',
  },
  'usage.col_model': {
    en: 'Model',
    tr: 'Model',
  },
  'usage.col_calls': {
    en: 'Calls',
    tr: 'Çağrı',
  },
  'usage.col_input': {
    en: 'Input',
    tr: 'Girdi',
  },
  'usage.col_output': {
    en: 'Output',
    tr: 'Çıktı',
  },
  'usage.col_cw': {
    en: 'CW',
    tr: 'ÖB',
  },
  'usage.col_cost': {
    en: 'Limit $',
    tr: 'Limit $',
  },
  'usage.col_hit_rate': {
    en: 'Hit%',
    tr: 'İsabet%',
  },
  'usage.col_task': {
    en: 'Task',
    tr: 'Görev',
  },
  'usage.col_boot_cw': {
    en: 'Boot-CW',
    tr: 'Başl-ÖB',
  },
  'usage.totals': {
    en: 'TOTAL',
    tr: 'TOPLAM',
  },
  'usage.budget_ref': {
    en: 'Weekly budget reference: ~${budget} equiv',
    tr: 'Haftalık bütçe referansı: ~${budget} eşdeğer',
  },
  'usage.no_sprint_data': {
    en: 'No run data found. Sessions could not be mapped to run {sprint} tasks.',
    tr: 'Run verisi bulunamadı. Oturumlar run {sprint} görevlerine eşlenemedi.',
  },
  'usage.cache_gate': {
    en: 'Cache gate: {status} (warm-share {share}%, warmer: {taskId})',
    tr: 'Önbellek kapısı: {status} (ısıtma payı %{share}, ısıtıcı: {taskId})',
  },
  'usage.cache_gate_na': {
    en: 'Cache gate: N/A (single-session run)',
    tr: 'Önbellek kapısı: N/A (tek oturumlu run)',
  },
  'usage.unknown_models': {
    en: '⚠ No price found for model(s): {models} — their burn is counted as $0. Run `deckent config update-pricing` or add the model to .deckent/cost-config.json.',
    tr: '⚠ Şu model(ler) için fiyat bulunamadı: {models} — yakımları $0 sayılıyor. `deckent config update-pricing` çalıştırın veya modeli .deckent/cost-config.json dosyasına ekleyin.',
  },

  // ─── kpi command (Sprint 330 KPI Faz-1, Task 9) ──────────────────────
  'kpi.title': {
    en: 'KPI Scorecard — {sprint}',
    tr: 'KPI Karnesi — {sprint}',
  },
  'kpi.header_kpi': {
    en: 'KPI',
    tr: 'KPI',
  },
  'kpi.header_value': {
    en: 'Value',
    tr: 'Değer',
  },
  'kpi.header_target': {
    en: 'Target',
    tr: 'Hedef',
  },
  'kpi.header_status': {
    en: 'Status',
    tr: 'Durum',
  },
  'kpi.no_data': {
    en: 'No KPI data available for {sprint}.',
    tr: '{sprint} için KPI verisi bulunamadı.',
  },

  // ─── interrogation (Sprint 276 PLAN-INT-1) ───────────────────────────
  'interrogate.intro': {
    en: 'Directive Interrogation — challenging your plan before coding:',
    tr: 'Direktif Sorgulaması — kodlamadan önce planınızı zorluyoruz:',
  },
  'interrogate.draft_header': {
    en: '## Interrogation Refinements',
    tr: '## Sorgulama İyileştirmeleri',
  },
  'interrogate.q_pain': {
    en: 'Is this a real pain point or a feature wish? What breaks today without it?',
    tr: 'Bu gerçek bir acı noktası mı yoksa özellik isteği mi? Bugün bu olmadan ne bozuluyor?',
  },
  'interrogate.q_wedge': {
    en: 'What is the narrowest shippable slice that delivers value immediately?',
    tr: 'Değeri hemen sunan en dar gönderilebilir dilim nedir?',
  },
  'interrogate.q_hidden': {
    en: 'Are there existing capabilities in the codebase that already solve part of this?',
    tr: 'Kod tabanında bunu kısmen zaten çözen mevcut yetenekler var mı?',
  },
  'interrogate.q_premise': {
    en: 'What assumption in this plan could be wrong? What would invalidate it?',
    tr: 'Bu plandaki hangi varsayım yanlış olabilir? Onu geçersiz kılacak ne var?',
  },
  'interrogate.q_effort': {
    en: 'Is there a 10x simpler alternative that gets 80% of the value at 10% of the effort?',
    tr: 'Çabanın %10\'uyla değerin %80\'ini sağlayan 10 kat daha basit bir alternatif var mı?',
  },

  // ─── docs track command (ADR-090) ───────────────────────────────────────
  'docs.track.scanned': {
    en: 'Scanned {count} docs ({stale} need attention).',
    tr: '{count} doküman tarandı ({stale} dikkat gerektiriyor).',
  },
  'docs.track.none': {
    en: 'No tracked docs found.',
    tr: 'İzlenen doküman bulunamadı.',
  },
  'docs.track.header': {
    en: 'rank  state           score  path',
    tr: 'kod   durum           skor   yol',
  },
  'docs.track.synced': {
    en: 'Synced {count} docs to memory.db (no front-matter written).',
    tr: '{count} doküman memory.db ile senkronlandı (front-matter yazılmadı).',
  },
  'docs.track.check_clean': {
    en: 'Doc-tracking check passed — no critical-stale docs.',
    tr: 'Doküman kontrolü geçti — kritik-bayat doküman yok.',
  },
  'docs.track.check_violations': {
    en: '{count} critical-stale doc(s) found:',
    tr: '{count} kritik-bayat doküman bulundu:',
  },
  'mcp.writer_lease.denied': {
    en: "Write tool '{tool}' is held by another deckent window (pid {pid}). Read tools work here; mutations run in that window — the lease transfers automatically when it exits.",
    tr: "'{tool}' yazma aracı başka bir deckent penceresinde (pid {pid}) kilitli. Okuma araçları burada çalışır; değişiklikler o pencerede yürür — pencere kapanınca yetki otomatik devrolur.",
  },

  // ─── process command (ADR-022 CLI/MCP parity) ───────────────────────────
  'process.submit_success': {
    en: 'Submitted. executionId: {executionId} | status: {status}',
    tr: 'Gönderildi. executionId: {executionId} | durum: {status}',
  },
  'process.status_found': {
    en: 'executionId: {executionId} | status: {status} | title: {title} | kind: {kind}',
    tr: 'executionId: {executionId} | durum: {status} | başlık: {title} | tür: {kind}',
  },
  'process.result_found': {
    en: 'executionId: {executionId} | status: {status} | title: {title} | result: {result}',
    tr: 'executionId: {executionId} | durum: {status} | başlık: {title} | sonuç: {result}',
  },
  'process.not_found': {
    en: 'No entry found for executionId: {executionId}',
    tr: 'executionId için kayıt bulunamadı: {executionId}',
  },
  'process.description_required': {
    en: 'Description is required for submit',
    tr: 'Submit için açıklama gereklidir',
  },
  'process.executionId_required': {
    en: 'executionId is required',
    tr: 'executionId gereklidir',
  },

  // ─── CLI i18n sweep — recall/remember/recover/features/history/config/retro/explain/web ───
  'recall.db_not_found': {
    en: 'Memory V2 DB not found. Run `deckent memory rebuild` first.',
    tr: 'Memory V2 veritabanı bulunamadı. Önce `deckent memory rebuild` komutunu çalıştırın.',
  },
  'recall.no_results': {
    en: 'No results for "{query}".',
    tr: '"{query}" için sonuç bulunamadı.',
  },
  'recall.results_header': {
    en: '\n  {count} result(s) for "{query}":\n',
    tr: '\n  "{query}" için {count} sonuç:\n',
  },
  'remember.db_not_found': {
    en: 'Memory V2 DB not found. Run `deckent memory rebuild` first.',
    tr: 'Memory V2 veritabanı bulunamadı. Önce `deckent memory rebuild` çalıştırın.',
  },
  'remember.stored': {
    en: '  Stored: [{type}] {title}',
    tr: '  Kaydedildi: [{type}] {title}',
  },
  'remember.tags': {
    en: '  Tags: {tags}',
    tr: '  Etiketler: {tags}',
  },
  'recover.warn_ipc_cleanup_failed': { en: '  Warning: IPC cleanup failed: {error}', tr: '  Uyarı: IPC temizliği başarısız: {error}' },
  'recover.warn_lock_cleanup_failed': { en: '  Warning: Lock cleanup failed: {error}', tr: '  Uyarı: Kilit temizliği başarısız: {error}' },
  'recover.warn_spawn_lock_cleanup_failed': { en: '  Warning: Spawn lock cleanup failed: {error}', tr: '  Uyarı: Spawn kilidi temizliği başarısız: {error}' },
  'recover.warn_task_archive_failed': { en: '  Warning: Task archive failed: {error}', tr: '  Uyarı: Görev arşivleme başarısız: {error}' },
  'recover.preview_header': { en: '\n  Recovery preview for {sprintId} (dry-run):', tr: '\n  {sprintId} için kurtarma önizlemesi (dry-run):' },
  'recover.audit_gate': { en: '  Audit gate:      {gate}', tr: '  Denetim kapısı:  {gate}' },
  'recover.preview_orphan_ipc': { en: '  Orphan IPC dirs: {count} would be removed', tr: '  Artık IPC dizinleri: {count} kaldırılacak' },
  'recover.preview_stale_locks': { en: '  Stale locks:     {count} would be cleared', tr: '  Bayat kilitler:  {count} temizlenecek' },
  'recover.preview_stale_spawnlocks': { en: '  Stale spawnlocks:{count} would be cleared', tr: '  Bayat spawnlock: {count} temizlenecek' },
  'recover.preview_task_files': { en: '  Task files:      {count} would be archived', tr: '  Görev dosyaları: {count} arşivlenecek' },
  'recover.checkpoint_disposition': { en: '  Resume checkpoint: {disposition} ({digest})', tr: '  Sürdürme checkpoint’i: {disposition} ({digest})' },
  'recover.paused_remediation': { en: '  Run is PAUSED. Resume with `{resumeCommand}` or finalize with `{finalizeCommand}`.', tr: '  Run PAUSED durumda. `{resumeCommand}` ile sürdürün veya `{finalizeCommand}` ile sonlandırın.' },
  'recover.preview_run_to_execute': { en: '\n  Run without --dry-run to execute.\n', tr: '\n  Çalıştırmak için --dry-run olmadan tekrar deneyin.\n' },
  'recover.confirm_header': { en: '\n  ⚠ Recovery will clean up run {sprintId}:', tr: '\n  ⚠ Kurtarma, {sprintId} run\'ını temizleyecek:' },
  'recover.confirm_remove_ipc': { en: '    - Remove orphan IPC directories (dead PIDs only)', tr: '    - Artık IPC dizinlerini kaldır (yalnızca ölü PID\'ler)' },
  'recover.confirm_clear_locks': { en: '    - Clear stale lock files (>5min)', tr: '    - Bayat kilit dosyalarını temizle (>5dk)' },
  'recover.confirm_archive_tasks': { en: '    - Archive terminal task files (DONE/NO_GO)', tr: '    - Sonlanmış görev dosyalarını arşivle (DONE/NO_GO)' },
  'recover.confirm_preserve_active': { en: '    - Preserve active tasks (PENDING/EXECUTING)\n', tr: '    - Aktif görevleri koru (PENDING/EXECUTING)\n' },
  'recover.confirm_hint': { en: '  Use --force to skip this confirmation, or --dry-run to preview.\n', tr: '  Bu onayı atlamak için --force, önizleme için --dry-run kullanın.\n' },
  'recover.confirm_prompt': { en: '  Proceed? (y/N)  ', tr: '  Devam edilsin mi? (y/N) ' },
  'recover.aborted': { en: '  Aborted.', tr: '  İptal edildi.' },
  'recover.recovering': { en: '\n  Recovering run {sprintId}...', tr: '\n  {sprintId} run\'ı kurtarılıyor...' },
  'recover.result_orphan_ipc': { en: '  Orphan IPC dirs: {count} removed', tr: '  Artık IPC dizinleri: {count} kaldırıldı' },
  'recover.result_stale_locks': { en: '  Stale locks:     {count} cleared', tr: '  Bayat kilitler:  {count} temizlendi' },
  'recover.result_stale_spawnlocks': { en: '  Stale spawnlocks:{count} cleared', tr: '  Bayat spawnlock: {count} temizlendi' },
  'recover.result_task_files': { en: '  Task files:      {archived} archived, {preserved} preserved', tr: '  Görev dosyaları: {archived} arşivlendi, {preserved} korundu' },
  'recover.complete': { en: '\n  ✓ Recovery complete. Run {sprintId} is ready for restart.\n', tr: '\n  ✓ Kurtarma tamamlandı. {sprintId} run\'ı yeniden başlatmaya hazır.\n' },
  'recover.restore_success': { en: '  ✓ Restored {count} task file(s) from the {sprintId} pre-archive snapshot (rollback).', tr: '  ✓ {sprintId} pre-archive snapshot\'ından {count} task dosyası geri yüklendi (rollback).' },
  'recover.restore_failed': { en: '  Restore failed for {sprintId}: {error}', tr: '  {sprintId} için geri-yükleme başarısız: {error}' },
  'recover.snapshot_required': { en: 'Recovery stopped: a verified snapshot for {sprintId} could not be created.', tr: 'Kurtarma durduruldu: {sprintId} için doğrulanmış snapshot oluşturulamadı.' },
  'recover.dry_run_restore_conflict': { en: '--dry-run and --restore-tasks cannot be combined; no action was taken.', tr: '--dry-run ve --restore-tasks birlikte kullanılamaz; hiçbir işlem yapılmadı.' },
  'recover.json_requires_force': { en: 'Mutating JSON recovery requires explicit --force.', tr: 'Değişiklik yapan JSON kurtarma açıkça --force gerektirir.' },
  'recover.restore_requires_force': { en: 'Snapshot restoration requires explicit --force.', tr: 'Snapshot geri yükleme açıkça --force gerektirir.' },
  'recover.archive_incomplete': { en: 'Recovery stopped: archive evidence is incomplete (expected {expected}, archived {actual}).', tr: 'Kurtarma durduruldu: arşiv kanıtı eksik (beklenen {expected}, arşivlenen {actual}).' },
  'recover.resume_restore_conflict': { en: '--resume and --restore-tasks are mutually exclusive.', tr: '--resume ve --restore-tasks birlikte kullanılamaz.' },
  'recover.resume_json_conflict': { en: '--resume streams the canonical resume command and cannot be combined with --json.', tr: '--resume canonical resume komutunun çıktısını aktarır ve --json ile birlikte kullanılamaz.' },
  'recover.resume_option': { en: 'Resume a canonically PAUSED/ORPHANED run through its durable checkpoint', tr: 'Canonical PAUSED/ORPHANED run’ı kalıcı checkpoint üzerinden sürdür' },
  'recover.auto_approve_option': { en: 'Forward auto-approval to the resumed worker run', tr: 'Otomatik onayı sürdürülen worker run’ına aktar' },
  'recover.force_scope_option': { en: 'Preserve explicit approval for intentional new write paths while resuming', tr: 'Sürdürürken bilinçli yeni yazma yolları için açık onayı koru' },
  'recover.resume_authority_missing': { en: 'Run {sprintId} has no canonical resumable PAUSED/ORPHANED authority.', tr: '{sprintId} için canonical, sürdürülebilir PAUSED/ORPHANED authority bulunamadı.' },
  'recover.resume_entry_missing': { en: 'Deckent CLI entry path is unavailable.', tr: 'Deckent CLI giriş yolu kullanılamıyor.' },
  'recover.invalid_sprint_id': { en: 'Invalid sprint id: {sprintId}', tr: 'Geçersiz sprint kimliği: {sprintId}' },
  'recover.active_authority_refused': { en: 'Recovery refused: run {sprintId} still has live coordinator authority.', tr: 'Kurtarma reddedildi: {sprintId} run’ının canlı coordinator authority kaydı sürüyor.' },
  'recover.approval_required': { en: 'Recovery mutation requires an explicit exact-identity approval for {sprintId}.', tr: '{sprintId} recovery mutation işlemi açık ve exact-identity bağlı onay gerektirir.' },
  'recover.approval_mismatch': { en: 'Recovery approval no longer matches the exact generation or fence for {sprintId}.', tr: 'Recovery onayı artık {sprintId} için exact generation veya fence ile eşleşmiyor.' },
  'recover.settlement_authority_missing': { en: 'Recovery stopped: no canonical settlement authority was derived for {sprintId}.', tr: 'Kurtarma durduruldu: {sprintId} için canonical settlement authority üretilemedi.' },
  'recover.settlement_failed': { en: 'Recovery settlement failed for {sprintId} ({code}).', tr: '{sprintId} recovery settlement işlemi başarısız ({code}).' },
  'recover.description': { en: 'Recover a crashed or stuck sprint through the canonical recovery operation', tr: 'Çökmüş veya takılmış bir sprinti canonical recovery operation ile kurtar' },
  'recover.dry_run_option': { en: 'Preview recovery without making changes', tr: 'Değişiklik yapmadan kurtarmayı önizle' },
  'recover.force_option': { en: 'Skip interactive confirmation', tr: 'Etkileşimli onayı atla' },
  'recover.skip_audit_option': { en: 'Skip the audit gate', tr: 'Denetim kapısını atla' },
  'recover.restore_tasks_option': { en: 'Restore task files from the pre-archive snapshot instead of recovering forward', tr: 'İleri kurtarma yerine görev dosyalarını pre-archive snapshot’tan geri yükle' },
  'recover.json_option': { en: 'Output the stable recovery result as JSON', tr: 'Kararlı kurtarma sonucunu JSON olarak çıktıla' },
  'recover.separator': { en: '  ─────────────────────────────────────────', tr: '  ─────────────────────────────────────────' },
  'recover.internal_error': { en: 'Recovery failed due to an internal operation error.', tr: 'Kurtarma dahili bir operation hatası nedeniyle başarısız oldu.' },
  'recover.unknown_error': { en: 'unknown error', tr: 'bilinmeyen hata' },
  'pause.provider_auth_hold': {
    en: 'Provider {provider} authentication failed at task {taskId}; healthy providers were not stopped. Re-authenticate, then resume this run.',
    tr: '{provider} provider kimlik doğrulaması {taskId} görevinde başarısız oldu; sağlıklı provider\'lar durdurulmadı. Yeniden giriş yapıp bu run\'ı sürdürün.',
  },
  'pause.provider_usage_hold': {
    en: 'Provider {provider} usage authority stopped dispatch at task {taskId}; healthy providers were not stopped. Restore provider availability, then resume this run.',
    tr: '{provider} provider kullanım authority\'si {taskId} görevinde dispatch\'i durdurdu; sağlıklı provider\'lar durdurulmadı. Provider erişimini yenileyip bu run\'ı sürdürün.',
  },
  'prompt_gate.test_not_discoverable': {
    en: 'Planned test path "{path}" is not discoverable by {runner}: {config} includes only [{include}].',
    tr: 'Planlanan "{path}" test yolu {runner} tarafından keşfedilemiyor: {config} yalnız [{include}] desenlerini kapsıyor.',
  },
  'prompt_gate.test_not_discoverable_fix': {
    en: 'Move the test under a configured include path or amend {config}; do not dispatch workers with a proof command the runner cannot discover.',
    tr: 'Testi yapılandırılmış bir include yoluna taşıyın veya {config} dosyasını düzenleyin; runner\'ın keşfedemediği proof komutuyla worker dispatch etmeyin.',
  },
  'prompt_gate.capability_message': {
    en: "Agent '{agentId}' is a review/advisory persona that is denied the Write tool, but this task writes source code — it cannot produce the diff.",
    tr: "'{agentId}' agent'ı Write tool'u reddedilmiş bir review/advisory persona, ama bu görev kaynak kod yazıyor — diff üretemez.",
  },
  'prompt_gate.capability_fix': {
    en: "Route to an implementer persona (bug-fixer / api-builder / the domain's implementer).",
    tr: "Bir implementer persona'ya yönlendirin (bug-fixer / api-builder / domain'in implementer'ı).",
  },
  'prompt_gate.mandate_message': {
    en: "Agent 'refactorer' carries a \"zero functional changes\" mandate, but this task's intent is '{intent}' (behavior-changing) — the persona fights the task.",
    tr: "'refactorer' agent'ı \"zero functional changes\" mandate'i taşıyor, ama bu görevin intent'i '{intent}' (davranış değiştiren) — persona görevle çelişiyor.",
  },
  'prompt_gate.mandate_fix': {
    en: "Route to bug-fixer (corrective) or the domain implementer; keep refactorer for intent='refactor' only.",
    tr: "bug-fixer'a (düzeltici) veya domain implementer'ına yönlendirin; refactorer'ı yalnız intent='refactor' için saklayın.",
  },
  'prompt_gate.role_message': {
    en: "Agent '{agentId}' is a {role} persona, but this task is construction work (writes source) — a review stance ≠ building the feature and risks a mismatched approach.",
    tr: "'{agentId}' agent'ı bir {role} persona, ama bu görev construction işi (kaynak yazıyor) — review duruşu ≠ özelliği inşa etmek ve uyumsuz bir yaklaşım riski taşır.",
  },
  'prompt_gate.role_fix_security': {
    en: "Route to an implementer (bug-fixer / api-builder) + the 'secure-coding' skill — the auditor persona reviews security, it does not build it.",
    tr: "Bir implementer'a (bug-fixer / api-builder) + 'secure-coding' skill'ine yönlendirin — auditor persona güvenliği denetler, inşa etmez.",
  },
  'prompt_gate.role_fix_generic': {
    en: "Route to an implementer persona for the task's domain.",
    tr: "Görevin domain'i için bir implementer persona'ya yönlendirin.",
  },
  'prompt_gate.domain_mismatch_fallback': {
    en: 'agent domain ≠ task domain',
    tr: "agent domain'i ≠ görev domain'i",
  },
  'prompt_gate.domain_message': {
    en: "Agent '{agentId}' domain mismatch: {mismatch}.",
    tr: "'{agentId}' agent'ı domain uyumsuzluğu: {mismatch}.",
  },
  'prompt_gate.domain_fix': {
    en: "Consider '{suggestedAgent}'.",
    tr: "'{suggestedAgent}' değerlendirin.",
  },
  'prompt_gate.decision_space_message': {
    en: 'goCriteria offers a choice ("…VEYA/OR…"); when scope enables only one branch this hands the worker a false decision and invites hesitation.',
    tr: 'goCriteria bir seçim sunuyor ("…VEYA/OR…"); scope yalnız bir dalı mümkün kıldığında bu worker\'a yanlış bir karar verir ve tereddüde davet eder.',
  },
  'prompt_gate.decision_space_fix': {
    en: 'State a preferred order ("prefer X; if infeasible, Y") or split into two goCriteria items.',
    tr: 'Tercih edilen bir sıra belirtin ("önce X; imkansızsa Y") veya iki ayrı goCriteria maddesine bölün.',
  },
  'prompt_gate.premise_message': {
    en: "Premise may be stale: the description claims '{symbol}' is missing/absent, but it occurs {count}× in the repo — the fix may already exist.",
    tr: "Premise bayat olabilir: description '{symbol}' sembolünün eksik/yok olduğunu iddia ediyor, ama repo'da {count} kez geçiyor — fix zaten var olabilir.",
  },
  'prompt_gate.premise_fix': {
    en: "Verify '{symbol}' against the codebase before implementing; if it already exists, narrow the task to the true remaining gap (or close it).",
    tr: "Implement etmeden önce '{symbol}' sembolünü codebase'e karşı doğrulayın; zaten varsa görevi gerçek kalan boşluğa daraltın (veya kapatın).",
  },
  'prompt_gate.scope_silent_drop_warning_message': {
    en: 'Write authority would silently shrink at render time: {warning}',
    tr: 'Write authority render zamanında sessizce küçülür: {warning}',
  },
  'prompt_gate.scope_silent_drop_warning_fix': {
    en: 'Qualify the path (directory prefix) or fix the entry in DIRECTIVES — the worker would never see this file in its WRITE list.',
    tr: 'Yolu niteleyin (dizin prefix\'i) veya DIRECTIVES\'teki girdiyi düzeltin — worker bu dosyayı WRITE listesinde asla göremez.',
  },
  'prompt_gate.scope_silent_drop_rejected_message': {
    en: 'Write path rejected by the scope sanitizer (absolute/traversal): "{path}"',
    tr: 'Write yolu scope sanitizer tarafından reddedildi (absolute/traversal): "{path}"',
  },
  'prompt_gate.scope_silent_drop_rejected_fix': {
    en: 'Use a repo-relative path without ".." segments.',
    tr: '".." segmenti içermeyen repo-relative bir yol kullanın.',
  },
  'prompt_gate.scope_silent_drop_unreported_message': {
    en: 'Write authority silently shrinks at render time: "{path}" is dropped by the scope sanitizer without any warning or rejection, so the worker never sees it in its WRITE list.',
    tr: 'Write authority render zamanında sessizce küçülüyor: "{path}" scope sanitizer tarafından hiçbir uyarı veya red üretmeden düşürülüyor; worker bu dosyayı WRITE listesinde asla göremez.',
  },
  'prompt_gate.scope_silent_drop_unreported_fix': {
    en: 'Remove the path from filesWrite and re-scope the task, or use a path the sanitizer preserves. Globally protected roots (package.json, tsconfig.json, lockfiles) are never writable by a worker — that wiring needs a separate authorized change.',
    tr: 'Yolu filesWrite\'tan çıkarıp görevi yeniden kapsamlandırın veya sanitizer\'ın koruduğu bir yol kullanın. Global korumalı kök dosyalar (package.json, tsconfig.json, lockfile\'lar) worker tarafından ASLA yazılamaz — o wiring ayrı ve yetkili bir değişiklik ister.',
  },
  'prompt_gate.satisfiability_message': {
    en: '[{code}] {message}',
    tr: '[{code}] {message}',
  },
  'prompt_gate.satisfiability_fix_proof_path_missing': {
    en: "Fix the proof command's path or add '{path}' to scope.filesWrite (new-file proofs are legitimate only with write authority).",
    tr: "Proof komutunun yolunu düzeltin veya '{path}' dosyasını scope.filesWrite'a ekleyin (yeni-dosya proof'ları yalnız write authority ile geçerlidir).",
  },
  'prompt_gate.satisfiability_fix_mentioned_not_writable': {
    en: "Add '{path}' to scope.filesWrite/directories, or reword the task so it does not require writing it.",
    tr: "'{path}' dosyasını scope.filesWrite/directories'e ekleyin, veya görevi onu yazmayı gerektirmeyecek şekilde yeniden ifade edin.",
  },
  'prompt_gate.satisfiability_fix_declared_unchanged': {
    en: "'{path}' is declared unchanged but is in filesWrite — drop it from the write list or drop the declaration.",
    tr: "'{path}' değişmedi olarak belirtilmiş ama filesWrite içinde — write listesinden çıkarın veya beyanı kaldırın.",
  },
  'resume.invalid_sprint_id': { en: 'Invalid run id: {sprintId}', tr: 'Geçersiz run kimliği: {sprintId}' },
  'resume.checkpoint_missing': { en: 'No checkpoint found for run "{sprintId}".', tr: '"{sprintId}" run\'ı için checkpoint bulunamadı.' },
  'resume.status_hint': { en: 'Run "deckent status" to see available runs.', tr: 'Kullanılabilir run\'ları görmek için "deckent status" çalıştırın.' },
  'resume.checkpoint_unreadable': { en: 'Checkpoint for run "{sprintId}" is malformed or unreadable.', tr: '"{sprintId}" run\'ının checkpoint\'i bozuk veya okunamıyor.' },
  'resume.pause_restore_failed': {
    en: 'Run {sprintId} failed to resume and its prior pause authority could not be restored; use deckent status before taking further action.',
    tr: '{sprintId} run\'ı sürdürülemedi ve önceki pause authority geri yüklenemedi; başka işlem yapmadan önce deckent status çalıştırın.',
  },
  'resume.header': { en: '\nResuming run {sprintId} from checkpoint #{checkpoint}', tr: '\n{sprintId} run\'ı checkpoint #{checkpoint} üzerinden sürdürülüyor' },
  'resume.summary': { en: '  Written: {timestamp}\n  Phase: {phase}\n  Completed tasks: {completed}\n  Pending tasks: {pending}\n  Active workers: {active}', tr: '  Yazım: {timestamp}\n  Faz: {phase}\n  Tamamlanan görev: {completed}\n  Bekleyen görev: {pending}\n  Aktif worker: {active}' },
  'resume.stale_header': { en: '\n  ⚠ Stale workers detected: {count}', tr: '\n  ⚠ Bayat worker tespit edildi: {count}' },
  'resume.stale_item': { en: '    - {workerId} (task {taskId}): {reason}, age {age}min', tr: '    - {workerId} (görev {taskId}): {reason}, yaş {age}dk' },
  'resume.stale_action': { en: '  Proven-stale workers will be stopped and their tasks resumed.', tr: '  Bayatlığı kanıtlanan worker\'lar durdurulacak ve görevleri sürdürülecek.' },
  'resume.crash_completed': { en: '\n  ✓ Tasks completed before crash: {taskIds}', tr: '\n  ✓ Çökmeden önce tamamlanan görevler: {taskIds}' },
  'resume.settlement_hold': {
    en: '\nHOLD: host settlement is pending or invalid for {tasks}; no task was reset or spawned.',
    tr: '\nHOLD: {tasks} için host settlement bekliyor veya geçersiz; hiçbir görev sıfırlanmadı ya da başlatılmadı.',
  },
  'resume.settlement_reconciling': {
    en: '\nReconciling host settlement before checkpoint restore: {tasks}.',
    tr: '\nCheckpoint restore öncesinde host settlement uzlaştırılıyor: {tasks}.',
  },
  'resume.settlement_state_required': {
    en: 'Resume HOLD: settlement-first recovery for {sprintId} requires its matching durable run state.',
    tr: 'Resume HOLD: {sprintId} için settlement-first recovery eşleşen kalıcı run durumunu gerektirir.',
  },
  'resume.dry_run': { en: '\n[dry-run] Would resume {count} task(s): {taskIds}. No workers spawned.', tr: '\n[dry-run] {count} görev sürdürülecek: {taskIds}. Worker başlatılmadı.' },
  'resume.none': { en: '(none)', tr: '(yok)' },
  'resume.nothing': { en: '\nAll tasks already completed or are not proven safe to resume.', tr: '\nTüm görevler tamamlanmış veya sürdürmenin güvenli olduğu kanıtlanmamış.' },
  'resume.terminalizing': { en: '\nPublishing missing terminal authority for {sprintId} ({mode}) without redispatching work.', tr: '\n{sprintId} için eksik terminal authority, iş yeniden dispatch edilmeden yayımlanıyor ({mode}).' },
  'resume.retro_hint': { en: 'Run "deckent retro" to see the retrospective.', tr: 'Retrospektifi görmek için "deckent retro" çalıştırın.' },
  'resume.config_failed': { en: 'Failed to load config: {error}', tr: 'Config yüklenemedi: {error}' },
  'resume.stale_killing': { en: '\nStopping proven-stale workers...', tr: '\nBayatlığı kanıtlanan worker\'lar durduruluyor...' },
  'resume.commit_failed': { en: 'Resume HOLD: durable state could not be committed: {error}', tr: 'Resume HOLD: durable durum commit edilemedi: {error}' },
  'resume.reset_tasks': { en: '  Reset {count} task(s) to PENDING: {taskIds}.', tr: '  {count} görev PENDING durumuna alındı: {taskIds}.' },
  'resume.artifact_cleanup_failed': { en: 'Resume HOLD: stale artifact could not be removed: {path}', tr: 'Resume HOLD: bayat artefact kaldırılamadı: {path}' },
  'resume.reset_artifacts': { en: '  Reset {count} stale worker artifact(s).', tr: '  {count} bayat worker artefact\'ı sıfırlandı.' },
  'resume.spawning': { en: '\nSpawning {count} pending task(s)...\n', tr: '\n{count} bekleyen görev başlatılıyor...\n' },
  'resume.preplanned_failed': { en: 'Resume HOLD: preplanned run could not be rebuilt: {error}', tr: 'Resume HOLD: preplanned run yeniden oluşturulamadı: {error}' },
  'resume.other_sprint_active': { en: 'Resume HOLD: another run owns the runtime state: {sprintId}', tr: 'Resume HOLD: runtime durumu başka bir run\'a ait: {sprintId}' },
  'resume.state_clear_failed': { en: 'Resume HOLD: stale state for {sprintId} could not be cleared.', tr: 'Resume HOLD: {sprintId} için bayat durum temizlenemedi.' },
  'resume.pause_clear_failed': { en: 'Resume HOLD: pause authority for {sprintId} could not be cleared safely.', tr: 'Resume HOLD: {sprintId} pause authority güvenli biçimde temizlenemedi.' },
  'resume.not_complete': { en: 'Run resumed but did not complete (status: {status}).', tr: 'Run sürdürüldü ancak tamamlanmadı (durum: {status}).' },
  'resume.completed': { en: '\nRun resumed and completed.', tr: '\nRun sürdürüldü ve tamamlandı.' },
  'resume.outcome_running': {
    en: 'Recovery outcome: resumed-running. The canonical coordinator authority remains active.',
    tr: 'Recovery sonucu: resumed-running. Canonical coordinator authority aktif kalıyor.',
  },
  'resume.outcome_paused': {
    en: 'Recovery outcome: resumed-paused. The run is durably paused; this is not an internal command failure. Resume: {recoveryCommand} · Abort: {finalizeCommand}',
    tr: 'Recovery sonucu: resumed-paused. Run kalıcı olarak duraklatıldı; bu bir dahili komut hatası değildir. Sürdür: {recoveryCommand} · Sonlandır: {finalizeCommand}',
  },
  'resume.outcome_aborted': {
    en: 'Recovery outcome: aborted. The run reached a truthful terminal ABORTED authority.',
    tr: 'Recovery sonucu: aborted. Run dürüst terminal ABORTED authority durumuna ulaştı.',
  },
  'resume.outcome_failed': {
    en: 'Recovery outcome: failed ({reason}).',
    tr: 'Recovery sonucu: failed ({reason}).',
  },
  'resume.failed': { en: 'Run resume failed: {error}', tr: 'Run sürdürme başarısız: {error}' },
  'features.manifest_not_found': { en: 'features-manifest.json not found. Run `node scripts/sync-manifest.mjs` to generate.', tr: 'features-manifest.json bulunamadı. Oluşturmak için `node scripts/sync-manifest.mjs` çalıştırın.' },
  'features.feature_not_found': { en: 'feature "{name}" not found.', tr: '"{name}" özelliği bulunamadı.' },
  'features.invalid_category': { en: 'invalid category "{name}". Valid: {valid}', tr: 'geçersiz kategori "{name}". Geçerli: {valid}' },
  'features.empty_category': { en: '(no features in this category)', tr: '(bu kategoride özellik yok)' },
  'features.detail_feature': { en: 'Feature', tr: 'Özellik' },
  'features.detail_category': { en: 'Category', tr: 'Kategori' },
  'features.detail_label': { en: 'Label', tr: 'Etiket' },
  'features.detail_files': { en: 'Files', tr: 'Dosyalar' },
  'features.detail_description': { en: 'Description', tr: 'Açıklama' },
  'features.header_all': { en: 'All Categories', tr: 'Tüm Kategoriler' },
  'features.header_title': { en: 'Deckent Features — {category}', tr: 'Deckent Özellikleri — {category}' },
  'features.header_meta': { en: 'Run: {sprint} | Generated: {generated}', tr: 'Run: {sprint} | Oluşturma: {generated}' },
  'features.total': { en: 'Total: {count} features', tr: 'Toplam: {count} özellik' },
  'history.no_history': { en: 'No run history found.', tr: 'Run geçmişi bulunamadı.' },
  'history.no_match': { en: 'No matching run history found.', tr: 'Eşleşen run geçmişi bulunamadı.' },
  'history.desc': { en: 'Show run history', tr: 'Run geçmişini göster' },
  'history.opt_last': { en: 'Show only last N runs', tr: 'Yalnızca son N run\'ı göster' },
  'history.opt_trend': { en: 'Show success rate/coverage trend analysis for last 5 runs', tr: 'Son 5 run için başarı oranı/kapsam trend analizini göster' },
  'history.trend_header': { en: '--- Trend (last {n} runs) ---', tr: '--- Trend (son {n} run) ---' },
  'config.set': { en: 'Set {key} = {value}', tr: '{key} = {value} olarak ayarlandı' },
  'config.invalid': { en: 'Invalid config: {errors}', tr: 'Geçersiz yapılandırma: {errors}' },
  'config.provider_alias_conflict': {
    en: 'Conflicting provider settings in the {layer} config: {flatKey}={flatValue} differs from {groupedKey}={groupedValue}. Remove one definition or make both values equal.',
    tr: '{layer} yapılandırmasında çakışan provider ayarları var: {flatKey}={flatValue}, {groupedKey}={groupedValue} değerinden farklı. Tanımlardan birini kaldırın veya iki değeri eşitleyin.',
  },
  // 592-003: cross_verify provider-name hardening — a typo in
  // verifier_priority / verifier_model's keys (e.g. "cursro") used to pass
  // silently as an inert string; both entries now fail typed config
  // validation against the live ALL_PROVIDER_NAMES set (core/types.ts).
  'config.cross_verify_unknown_verifier_priority': {
    en: 'cross_verify.verifier_priority contains unknown provider "{provider}" — valid providers: {providers}.',
    tr: 'cross_verify.verifier_priority bilinmeyen bir sağlayıcı içeriyor: "{provider}" — geçerli sağlayıcılar: {providers}.',
  },
  'config.cross_verify_unknown_verifier_model_provider': {
    en: 'cross_verify.verifier_model contains unknown provider key "{provider}" — valid providers: {providers}.',
    tr: 'cross_verify.verifier_model bilinmeyen bir sağlayıcı anahtarı içeriyor: "{provider}" — geçerli sağlayıcılar: {providers}.',
  },
  'config.key_not_found': { en: 'Key not found: {key}', tr: 'Anahtar bulunamadı: {key}' },
  'config.exported': { en: 'Config exported to {path}', tr: 'Yapılandırma {path} dosyasına dışa aktarıldı' },
  'config.imported': { en: 'Config imported from {path}', tr: 'Yapılandırma {path} dosyasından içe aktarıldı' },
  'config.migrate_up_to_date': { en: 'Config is already up to date — no migration needed.', tr: 'Yapılandırma zaten güncel — geçiş gerekmiyor.' },
  'config.migrate_dry_run': { en: '[dry-run] Would add {count} missing field(s):', tr: '[dry-run] {count} eksik alan eklenecek:' },
  'config.migrate_complete': { en: 'Migration complete. Added {count} field(s):', tr: 'Geçiş tamamlandı. {count} alan eklendi:' },
  'config.migrate_backup': { en: 'Backup saved to: {path}', tr: 'Yedek kaydedildi: {path}' },
  'retro.none_found': { en: 'No retrospective found. Run `deckent start` to complete a run first.', tr: 'Retrospektif bulunamadı. Önce bir run tamamlamak için `deckent start` çalıştırın.' },
  'retro.no_previous_sprint': { en: 'No previous run found for comparison.', tr: 'Karşılaştırma için önceki run bulunamadı.' },
  'dashboard.sprint_line': { en: 'Run: {id} (#{number})', tr: 'Run: {id} (#{number})' },
  'dashboard.phase_status': { en: 'Phase: {phase}  Status: {status}', tr: 'Faz: {phase}  Durum: {status}' },
  'dashboard.col_id': { en: 'ID', tr: 'ID' },
  'dashboard.col_task': { en: 'Task', tr: 'Görev' },
  'dashboard.col_status': { en: 'Status', tr: 'Durum' },
  'dashboard.col_elapsed': { en: 'Elapsed', tr: 'Geçen' },
  'dashboard.col_agent': { en: 'Agent', tr: 'Ajan' },
  'dashboard.col_skill': { en: 'Skill', tr: 'Yetenek' },
  'dashboard.progress': { en: '{done}/{total} done {active} active {blocked} pending', tr: '{done}/{total} tamam {active} aktif {blocked} bekliyor' },
  'dashboard.no_alerts': { en: 'No alerts.', tr: 'Uyarı yok.' },
  'dashboard.alerts_label': { en: 'Alerts:', tr: 'Uyarılar:' },
  'dashboard.no_active_sprint': { en: 'No active run. Run deckent start first.', tr: 'Aktif run yok. Önce `deckent start` çalıştırın.' },

  // ─── gateway connector ──────────────────────────────────────────────
  'gateway.unbound': {
    tr: 'Bu sohbet bir projeye bağlı değil. `/projects` ile listeyi gör, `/use <isim>` ile bağla.',
    en: 'This chat is not bound to a project. Use `/projects` to list, `/use <name>` to bind.',
  },
  'gateway.bound_ok': {
    tr: 'Bağlandı: {project}. Artık mesajların bu projeye gider.',
    en: 'Bound to {project}. Your messages now go to this project.',
  },
  'gateway.unbind_ok': {
    tr: 'Bağlantı kaldırıldı. `/use <isim>` ile yeniden bağla.',
    en: 'Unbound. Use `/use <name>` to bind again.',
  },
  'gateway.not_bound': {
    tr: 'Zaten bağlı değilsin.',
    en: 'Not bound to anything.',
  },
  'gateway.whoami': {
    tr: 'Bağlı proje: {project}',
    en: 'Bound project: {project}',
  },
  'gateway.projects_header': {
    tr: 'Kayıtlı projeler:',
    en: 'Registered projects:',
  },
  'gateway.projects_row': {
    tr: '• {name} — {path}',
    en: '• {name} — {path}',
  },
  'gateway.use_usage': {
    tr: 'Kullanım: /use <proje-ismi veya path>',
    en: 'Usage: /use <project-name or path>',
  },
  'gateway.use_unknown': {
    tr: 'Bilinmeyen proje: {name}. `/projects` ile listele.',
    en: 'Unknown project: {name}. List with `/projects`.',
  },

  // ─── gateway daemon lifecycle ───────────────────────────────────────
  'gateway.listen_active': {
    tr: 'Gateway dinleyici aktif: {connectors}',
    en: 'Gateway listener active: {connectors}',
  },
  'gateway.listen_none': {
    tr: 'Bağlantı kurulamadı — aktif connector yok.',
    en: 'No connectors active — gateway listener not started.',
  },
  'gateway.listen_stopped': {
    tr: 'Gateway dinleyici durduruldu.',
    en: 'Gateway listener stopped.',
  },
  'gateway.daemon_started': {
    tr: 'Gateway daemon başlatıldı (PID: {pid}). Oturum kapanınca devam eder.',
    en: 'Gateway daemon started (PID: {pid}). Continues after terminal close.',
  },
  'gateway.daemon_already': {
    tr: 'Gateway daemon zaten çalışıyor (PID: {pid}).',
    en: 'Gateway daemon already running (PID: {pid}).',
  },
  'gateway.daemon_stopped': {
    tr: 'Gateway daemon durduruldu (PID: {pid}).',
    en: 'Gateway daemon stopped (PID: {pid}).',
  },
  'gateway.daemon_not_running': {
    tr: 'Gateway daemon çalışmıyor.',
    en: 'Gateway daemon is not running.',
  },
  'gateway.daemon_status_running': {
    tr: 'Gateway daemon çalışıyor (PID: {pid}).',
    en: 'Gateway daemon running (PID: {pid}).',
  },
  'gateway.daemon_reboot_note': {
    tr: 'Not: Daemon, yeniden başlatmada otomatik başlamaz — OS supervisor (systemd/pm2) kurun.',
    en: 'Note: Daemon does not survive reboot automatically — set up an OS supervisor (systemd/pm2).',
  },
  'gateway.group_desc': {
    tr: 'Proje kapsamlı mesajlaşma gateway oturumlarını ve eşleştirmeyi yönetin',
    en: 'Manage project-scoped messaging gateway sessions and pairing',
  },
  'gateway.runtime_desc': {
    tr: 'Dahili: bir projeye bağlı runtime child (supervisor spawn eder; doğrudan kullanım için değil)',
    en: 'Internal: per-project runtime child (spawned by the supervisor; not for direct use)',
  },
  'gateway.pair_approved': {
    tr: 'Eşleştirme onaylandı: {chatKey} → {project}',
    en: 'Pairing approved: {chatKey} → {project}',
  },
  'gateway.pair_unknown_code': {
    tr: 'Bilinmeyen eşleştirme kodu: {code}',
    en: 'Unknown pairing code: {code}',
  },
  'gateway.pair_rejected': {
    tr: 'Eşleştirme reddedildi: {code}',
    en: 'Pairing rejected: {code}',
  },
  'gateway.pair_list_empty': {
    tr: 'Bekleyen eşleştirme yok.',
    en: 'No pending pairings.',
  },
  'gateway.pair_list_row': {
    tr: '• {code} — {chatKey} ({requestedAt})',
    en: '• {code} — {chatKey} ({requestedAt})',
  },
  'gateway.pair_usage': {
    tr: 'Kullanım: deckent gateway pair approve <code> <project> | reject <code> | list',
    en: 'Usage: deckent gateway pair approve <code> <project> | reject <code> | list',
  },
  'gateway.pair_needed': {
    tr: 'Bu sohbet {project} için yetkili değil. Eşleştirme kodu: {code}. Sahibi şunu çalıştırsın: deckent gateway pair approve {code} {project}',
    en: 'This chat is not authorized for {project}. Pairing code: {code}. Ask the owner to run: deckent gateway pair approve {code} {project}',
  },

  // ─── capability: mail ────────────────────────────────────────────────
  'cap.mail.title': {
    en: 'Send email',
    tr: 'Mail gönder',
  },
  'cap.mail.recipient_denied': {
    en: 'Recipient not allowed by policy: {to}',
    tr: 'Alıcı policy ile izinli değil: {to}',
  },
  'cap.mail.smtp_missing': {
    en: 'SMTP is not configured in .deck.',
    tr: 'SMTP .deck\'te yapılandırılmamış.',
  },
  'cap.mail.sent': {
    en: 'Mail sent to {to} · {subject} ({id})',
    tr: 'Mail gönderildi: {to} · {subject} ({id})',
  },
  'cap.mail.failed': {
    en: 'Mail failed: {error}',
    tr: 'Mail başarısız: {error}',
  },
  'cap.mail.preview': {
    en: '📧 *Send email*\n*To:* {to}\n*Subject:* {subject}\n*Body:* {body}',
    tr: '📧 *Mail gönderilecek*\n*Kime:* {to}\n*Konu:* {subject}\n*Gövde:* {body}',
  },
  'cap.mail.attach_unknown': {
    en: 'Attachment not found: {id}',
    tr: 'Ek bulunamadı: {id}',
  },
  'cap.mail.preview_attach': {
    en: '*Attachment:* {files}',
    tr: '*Ek:* {files}',
  },

  // ─── capability: gate (dispatcher-level policy messages) ────────────
  'cap.gate.unavailable': {
    en: "Capability '{id}' is not available.",
    tr: "'{id}' yeteneği kullanılamıyor.",
  },
  'cap.gate.denied': {
    en: "Capability '{id}' is denied by policy.",
    tr: "'{id}' yeteneği policy ile reddedildi.",
  },
  'cap.approval.ack': {
    en: 'Approval requested for {cap}; awaiting the user\'s decision.',
    tr: '{cap} için onay istendi; kullanıcının kararı bekleniyor.',
  },
  'cap.approval.header': {
    en: 'Approval required — not executed',
    tr: 'Onay gerekli — çalıştırılmadı',
  },
  'cap.btn.approve': {
    en: '✅ Approve',
    tr: '✅ Onayla',
  },
  'cap.btn.reject': {
    en: '❌ Reject',
    tr: '❌ Reddet',
  },
  'cap.approval.approved': {
    en: '✅ Approved — {result}',
    tr: '✅ Onaylandı — {result}',
  },
  'cap.approval.rejected': {
    en: '❌ Rejected',
    tr: '❌ Reddedildi',
  },
  // Ack returned when a risky deckent_* TOOL's approval was delivered as a buttoned
  // message (the user has Approve/Reject buttons) — the tool-side twin of cap.approval.ack.
  'tool.approval.ack': {
    en: 'Approval requested for {tool} — tap Approve/Reject on the message above; nothing has run yet.',
    tr: '{tool} için onay istendi — yukarıdaki mesajda Onayla/Reddet butonuna bas; henüz hiçbir şey çalışmadı.',
  },
  // ApprovalBroker.decideChecked() 'expired' outcome (born-437-004) — a bot-button
  // press or CLI approve/reject on a request whose TTL already elapsed. No decision
  // is recorded for this outcome; the user is told honestly instead of silence.
  'approval.decide.expired': {
    en: 'This approval request expired at {expiresAt} — no action was taken.',
    tr: 'Bu onay isteğinin süresi {expiresAt} tarihinde doldu — herhangi bir işlem yapılmadı.',
  },
  'approval.broker_authority_pending': {
    en: 'Decision channel authority is pending; CLI: deckent approvals decide #{code}',
    tr: 'Karar kanal-otoritesi bekliyor; CLI: deckent approvals decide #{code}',
  },

  // ─── capability: screenshot ──────────────────────────────────────────
  'cap.screenshot.title': {
    en: 'Screenshot',
    tr: 'Ekran görüntüsü',
  },
  'cap.screenshot.unsupported': {
    en: 'Screenshot is not supported on this platform.',
    tr: 'Bu platformda ekran görüntüsü desteklenmiyor.',
  },
  'cap.screenshot.failed': {
    en: 'Screenshot failed: {error}',
    tr: 'Ekran görüntüsü başarısız: {error}',
  },
  'cap.screenshot.caption': {
    en: 'Screen capture',
    tr: 'Ekran yakalandı',
  },
  'cap.screenshot.preview': {
    en: 'capture {display} display',
    tr: '{display} ekranı yakala',
  },
  'cap.media.fallback': {
    en: '[media: {filename} — this connector cannot display it]',
    tr: '[medya: {filename} — bu connector gösteremiyor]',
  },

  // ─── Inbound media artifact attachment notice (Task 8 — inbound media → artifact) ──
  'cap.inbound.attached': {
    en: '[attached: {id}, {filename}]',
    tr: '[ek: {id}, {filename}]',
  },

  // ─── Voice wiring (Task 11 — inbound STT → turn, reply-in-kind TTS) ─────────
  'voice.transcribe.error': {
    en: '[voice: transcription unavailable — sending voice note as text]',
    tr: '[ses: transkripsiyon mevcut değil — ses notu metin olarak gönderildi]',
  },
  'voice.tts.error': {
    en: '[voice: synthesis failed — sending reply as text]',
    tr: '[ses: sentez başarısız — yanıt metin olarak gönderildi]',
  },

  // ─── Voice capability context (WS2 Task 3) ────────────────────────────────
  'voice.capability_context': {
    en: 'You are a voice-capable assistant: your replies may be spoken aloud and the user may send or request voice messages. Never claim you cannot access, hear, or produce audio.',
    tr: 'Sesli bir asistansın: yanıtların sesli okunabilir ve kullanıcı sesli mesaj gönderebilir ya da isteyebilir. ASLA sesi duyamadığını, ona erişemediğini veya üretemediğini söyleme.',
  },

  // ─── Voice reply-language instructions (WS1 Task 5) ────────────────────────
  'voice.reply_lang_forced': {
    en: 'Reply ONLY in {language}. Do not mix languages.',
    tr: 'SADECE {language} dilinde yanıtla. Dilleri karıştırma.',
  },
  'voice.reply_lang_mirror': {
    en: 'Reply in the same language the user used. Do not mix languages.',
    tr: 'Kullanıcının kullandığı dilde yanıtla. Dilleri karıştırma.',
  },

  // ─── Voice health-check (Task 5 — bot-start honest-warn) ─────────────────
  'voice.wrapper_unreachable': {
    en: '⚠️ Voice is configured (provider={provider}) but the backend is unreachable at {url} — voice replies will fall back to text. {detail}',
    tr: '⚠️ Ses yapılandırıldı (sağlayıcı={provider}) ancak arka uç {url} adresine ulaşılamıyor — ses yanıtları metin olarak gönderilecek. {detail}',
  },

  // ─── Connector-surface RBAC / Identity (ADR-092) ─────────────────────────
  'rbac.unauthorized': {
    en: 'Not authorized: this action needs the "{permission}" permission.',
    tr: 'Yetkin yok: bu işlem için "{permission}" izni gerekiyor.',
  },
  'identity.verify_prompt': {
    en: "I can't verify who you are yet. To link your account, message me privately: {method}",
    tr: 'Kimliğini henüz doğrulayamıyorum. Hesabını bağlamak için bana özelden yaz: {method}',
  },
  'identity.binding_unconfigured': {
    en: 'This channel is not configured for per-user authorization.',
    tr: 'Bu kanal kullanıcı-bazlı yetkilendirme için yapılandırılmamış.',
  },

  // ─── Open Health Snapshot (Task 15 — MESSAGES-KEYS, migrated from
  // health-snapshot.ts LOCAL_MESSAGES; text byte-identical, see 351-001) ────
  'health.auth': { en: 'auth', tr: 'oturum' },
  'health.mcp': { en: 'mcp', tr: 'mcp' },
  'health.mem': { en: 'mem', tr: 'bellek' },
  'health.mode': { en: 'mode', tr: 'mod' },
  'health.unknown': { en: 'unknown', tr: 'bilinmiyor' },
  'health.logged_in': { en: 'logged in', tr: 'oturum açık' },
  'health.logged_out': { en: 'logged out', tr: 'oturum kapalı' },

  // ─── TERM-LIVE footer labels (Task 16 — MESSAGES-KEYS-2, sole-authority
  // addition; cited by 353-007's docImpact note; en text is byte-identical to
  // live-footer.ts's DEFAULT_LIVE_FOOTER_LABELS so a future REPL-wiring task
  // can swap options.labels for getMessage(...) calls with no visible diff) ──
  'live_footer.idle': { en: 'idle', tr: 'boşta' },
  'live_footer.running': { en: 'Running', tr: 'Çalışıyor' },
  'live_footer.elapsed': { en: 'Elapsed', tr: 'Geçen süre' },
  'live_footer.provider': { en: 'Provider', tr: 'Sağlayıcı' },
  'live_footer.auth': { en: 'Auth', tr: 'Oturum' },
  'live_footer.next': { en: 'Next', tr: 'Sıradaki' },
  'live_footer.healthy': { en: 'healthy', tr: 'sağlıklı' },
  'live_footer.degraded': { en: 'degraded', tr: 'sorunlu' },
  'live_footer.unknown': { en: 'unknown', tr: 'bilinmiyor' },
  'live_footer.logged_in': { en: 'logged-in', tr: 'oturum açık' },
  'live_footer.logged_out': { en: 'logged-out', tr: 'oturum kapalı' },

  // ─── TERM-CONNECT /connect step descriptions (Task 16 — MESSAGES-KEYS-2,
  // sole-authority addition; cited by 353-010's docImpact note — the exact 7
  // descriptionKey values already emitted by connect-wizard.ts's ConnectStep
  // objects) ──────────────────────────────────────────────────────────────
  'connect.step.install_cli': {
    en: 'Install the {provider} CLI: {instruction}',
    tr: '{provider} CLI\'ını kurun: {instruction}',
  },
  'connect.step.login': {
    en: 'Log in to {provider}.',
    tr: '{provider} hesabına giriş yapın.',
  },
  'connect.step.mcp_unsupported': {
    en: '{host} does not support MCP attachment yet.',
    tr: '{host} henüz MCP bağlantısını desteklemiyor.',
  },
  'connect.step.attach_mcp': {
    en: 'Attach deckent to {host} via MCP.',
    tr: 'Deckent\'i MCP üzerinden {host}\'a bağlayın.',
  },
  'connect.step.ide_cursor_setup': {
    en: 'Set up the Cursor IDE integration.',
    tr: 'Cursor IDE entegrasyonunu kurun.',
  },
  'connect.step.ide_terminal_guidance': {
    en: 'Running in a plain terminal — no IDE integration needed.',
    tr: 'Düz bir terminalde çalışıyorsunuz — IDE entegrasyonu gerekmiyor.',
  },
  'connect.step.wsl_recommended': {
    en: 'WSL is recommended over {shell} for the best experience.',
    tr: 'En iyi deneyim için {shell} yerine WSL önerilir.',
  },

  // ─── `deckent connect` auth-state guidance (PSL-6-DILIM, Sprint 369 —
  // 369-006). Shown only when buildAuthStateReport (doctor.ts, 368-002) finds
  // a provider "missing" — names the env var / .deck key to set, NEVER a
  // secret value (the {cmd} placeholder is always a literal `<value>`).
  'connect.auth_state.hint': {
    en: 'Set {envKey} (e.g. `{cmd}`), or add {deckKey} to your .deck file and reference it as $DECK:{deckKey} in config.',
    tr: '{envKey} ortam değişkenini ayarlayın (örn. `{cmd}`), ya da .deck dosyanıza {deckKey} ekleyip config içinde $DECK:{deckKey} olarak referans verin.',
  },

  // ─── REPL mode indicator (Task 354-001 REPL-SURFACE-WIRE — sole-authority
  // addition; cited by 354-001's ReplLabels.modeAsk/modeRun/modeControl
  // fallback text ('Ask'/'Run'/'Control', resolveModeLabel in app.tsx).
  // Naming mirrors every other ReplLabels field's existing tui.* key) ───────
  'tui.mode_ask': { en: 'Ask', tr: 'Sor' },
  'tui.mode_run': { en: 'Run', tr: 'Çalıştır' },
  'tui.mode_control': { en: 'Control', tr: 'Kontrol' },

  // ─── `/term` mode dispatch (term-mode.ts /term refactor — /ask·/run·/control
  // retired as transition commands; app.tsx handleSubmit renders these via
  // ReplLabels.termSwitched/termStatus/termUsage, run.tsx wires them).
  // {mode}/{approval} are substituted by app.tsx (confirmProgress precedent) ──
  'tui.term_switched': {
    en: 'terminal mode switched: {mode}',
    tr: 'terminal modu değişti: {mode}',
  },
  'tui.term_status': {
    en: 'terminal mode: {mode} · write approval: {approval}',
    tr: 'terminal modu: {mode} · yazma onayı: {approval}',
  },
  'tui.term_usage': {
    en: 'usage: /term ask|run|control — file-write approval is separate: /approve suggest|auto-edit|full-auto',
    tr: 'kullanım: /term ask|run|control — dosya-yazma onayı ayrıdır: /approve suggest|auto-edit|full-auto',
  },

  // ─── /resume picker (APP-SURFACE-WIRE 358-006 — ReplLabels.resumeHeader/
  // resumeHint/resumeSwitched/resumeNotFound/resumeAmbiguous; buildResumePickerLines/
  // resolveResumeCommand in app.tsx, wired by run.tsx's buildReplLabels. Distinct
  // from tui.resume_list_header/tui.resume_hint/etc. above — those serve the
  // OLDER loop-side /resume in chat-native.ts/chat-resume.ts, a different feature
  // with different placeholders ({session} vs {arg}); Task 387-001) ────────────
  // SURF-3 multi-flow-inbox — read-only `/runs` list of concurrent run-flows.
  'tui.inbox_header': { en: 'Active runs', tr: 'Aktif koşular' },
  // `status` takes no argument — it reports the active run. The per-run
  // drill-down surface is `inspect`, so the hint pointed operators at a command
  // that answers with "too many arguments".
  'tui.inbox_hint': {
    en: 'Tip: `deckent inspect <id>` opens one',
    tr: 'İpucu: birini açmak için `deckent inspect <id>`',
  },
  'tui.inbox_empty': {
    en: 'No runs yet — start one with `deckent do "<goal>"`',
    tr: 'Henüz koşu yok — başlatmak için `deckent do "<hedef>"`',
  },
  'tui.inbox_state_collecting': { en: 'collecting', tr: 'toplanıyor' },
  'tui.inbox_state_proposed': { en: 'proposed', tr: 'önerildi' },
  'tui.inbox_state_previewing': { en: 'previewing', tr: 'önizleme' },
  'tui.inbox_state_awaiting_approval': { en: 'awaiting approval', tr: 'onay bekliyor' },
  'tui.inbox_state_approved': { en: 'approved', tr: 'onaylandı' },
  'tui.inbox_state_starting': { en: 'starting', tr: 'başlıyor' },
  'tui.inbox_state_running': { en: 'running', tr: 'çalışıyor' },
  'tui.inbox_state_completed': { en: 'completed', tr: 'tamamlandı' },
  'tui.inbox_state_failed': { en: 'failed', tr: 'başarısız' },
  'tui.inbox_state_cancelled': { en: 'cancelled', tr: 'iptal edildi' },
  'tui.inbox_state_blocked': { en: 'blocked', tr: 'engellendi' },
  // SURF-3 multi-flow-inbox D2 — `/runs <n>` single-flow detail.
  'tui.inbox_detail_header': { en: 'Run {id} · {state}', tr: 'Koşu {id} · {state}' },
  'tui.inbox_detail_id': { en: '  id: {id}', tr: '  id: {id}' },
  'tui.inbox_detail_intent': { en: '  intent: {intent}', tr: '  hedef: {intent}' },
  'tui.inbox_detail_progress': { en: '  progress: {done}/{total}', tr: '  ilerleme: {done}/{total}' },
  'tui.inbox_detail_started': { en: '  started: {started}', tr: '  başladı: {started}' },
  'tui.inbox_not_found': {
    en: 'No run #{arg} — `/runs` lists them',
    tr: '#{arg} numaralı koşu yok — listelemek için `/runs`',
  },
  // SURF-3 multi-flow-inbox D3b — live `/runs --follow` card footers (list + detail).
  'tui.inbox_follow_nav_hint': {
    en: '↑↓ select · ↵ open · Esc close · ⟳ live',
    tr: '↑↓ seç · ↵ aç · Esc kapat · ⟳ canlı',
  },
  'tui.inbox_follow_detail_hint': {
    en: '↑↓ browse · Esc back · ⟳ live',
    tr: '↑↓ gez · Esc geri · ⟳ canlı',
  },
  // F-3 read-only liveness — row marks + detail lines for live-claiming flows.
  'tui.inbox_liveness_dead': { en: 'process died', tr: 'süreç öldü' },
  'tui.inbox_liveness_unknown': { en: 'unverified', tr: 'doğrulanamadı' },
  'tui.inbox_detail_liveness_dead': {
    en: '  liveness: process died (pid {pid})',
    tr: '  canlılık: süreç öldü (pid {pid})',
  },
  'tui.inbox_detail_liveness_unknown': {
    en: '  liveness: unverified — the run predates pid tracking',
    tr: '  canlılık: doğrulanamadı — koşu pid takibinden eski',
  },
  // F-3b rich detail — human-readable `/runs <n>` + `deckent runs <n>`.
  'tui.inbox_detail_origin': { en: '  origin: {origin}', tr: '  kaynak: {origin}' },
  'tui.inbox_detail_tasks': { en: '  tasks: {count}', tr: '  görev: {count}' },
  'tui.inbox_detail_updated': { en: '  updated: {time}', tr: '  güncellendi: {time}' },
  'tui.inbox_detail_closed': { en: '  closed: {time}', tr: '  kapandı: {time}' },
  'tui.inbox_detail_duration': { en: '  duration: {duration}', tr: '  süre: {duration}' },
  'tui.inbox_detail_summary': { en: '  summary: {summary}', tr: '  özet: {summary}' },
  'tui.inbox_detail_reason': { en: '  reason: {reason}', tr: '  neden: {reason}' },
  // SURF-6 — cross-surface parity: the SAME content hash the Desktop preview shows.
  'tui.inbox_detail_digest': { en: '  digest: {digest}', tr: '  plan-imzası: {digest}' },
  // SURF-6 — in-card decision keys (Telegraph vocabulary: STOP/SLOW AHEAD/FULL AHEAD).
  'tui.inbox_decide_hint_awaiting': {
    en: 'a approve · f full ahead · r reject',
    tr: 'a onayla (ağır yol) · f tam yol · r reddet (dur)',
  },
  'tui.inbox_decide_hint_approved': { en: 's start', tr: 's başlat' },
  'tui.inbox_time_just_now': { en: 'just now', tr: 'az önce' },
  'tui.inbox_time_minutes_ago': { en: '{n} min ago', tr: '{n} dk önce' },
  'tui.inbox_time_hours_ago': { en: '{n} h ago', tr: '{n} sa önce' },
  'tui.inbox_time_days_ago': { en: '{n} d ago', tr: '{n} gün önce' },
  // F-3 `deckent runs --close-stale` — operator stale-run sweep output.
  'runs.close_stale.none': {
    en: 'No stale runs — every live-claiming flow is verified alive or already closed.',
    tr: 'Bayat koşu yok — canlı görünen her akış ya doğrulandı ya da zaten kapalı.',
  },
  'runs.close_stale.dry_header': {
    en: 'Stale runs that would be closed ({count}):',
    tr: 'Kapatılacak bayat koşular ({count}):',
  },
  'runs.close_stale.dry_hint': {
    en: 'Dry-run — nothing was written. Run `deckent runs --close-stale --yes` to close them.',
    tr: 'Ön-izleme — hiçbir şey yazılmadı. Kapatmak için `deckent runs --close-stale --yes` çalıştır.',
  },
  'runs.close_stale.apply_header': {
    en: 'Closed {count} stale run(s):',
    tr: '{count} bayat koşu kapatıldı:',
  },
  'runs.close_stale.entry_dead': {
    en: 'process died (pid {pid}) → failed',
    tr: 'süreç öldü (pid {pid}) → başarısız',
  },
  'runs.close_stale.entry_dead_cancelled': {
    en: 'process died (pid {pid}), legacy record → cancelled',
    tr: 'süreç öldü (pid {pid}), eski kayıt → iptal',
  },
  'runs.close_stale.entry_unverifiable': {
    en: 'unverifiable (no pid recorded) → cancelled',
    tr: 'doğrulanamaz (pid kaydı yok) → iptal',
  },
  // 524-013 `deckent runs --retire-superseded` — pending-approval duplicate hygiene.
  'runs.retire_superseded.none': {
    en: 'No superseded runs — every plan awaiting approval is the newest for its source.',
    tr: 'Eskimiş koşu yok — onay bekleyen her plan, kaynağının en yenisi.',
  },
  'runs.retire_superseded.dry_header': {
    en: 'Superseded runs awaiting approval that would be retired ({count}):',
    tr: 'Emekliye ayrılacak, onay bekleyen eskimiş koşular ({count}):',
  },
  'runs.retire_superseded.apply_header': {
    en: 'Retired {count} superseded run(s):',
    tr: '{count} eskimiş koşu emekliye ayrıldı:',
  },
  'runs.retire_superseded.entry': {
    en: 'superseded by {by} → cancelled',
    tr: '{by} tarafından geçildi → iptal',
  },
  'runs.retire_superseded.failed': {
    en: 'not retired: {detail}',
    tr: 'emekliye ayrılmadı: {detail}',
  },
  'runs.retire_superseded.dry_hint': {
    en: 'Dry-run — nothing was written. Run `deckent runs --retire-superseded --yes` to retire them.',
    tr: 'Ön-izleme — hiçbir şey yazılmadı. Emekliye ayırmak için `deckent runs --retire-superseded --yes` çalıştır.',
  },
  // SURF-6 `deckent runs <n> --approve|--reject|--start` — cross-surface decide.
  'runs.decide.approved': {
    en: 'Approved — revision {revision} · digest {digest}',
    tr: 'Onaylandı — revizyon {revision} · özet {digest}',
  },
  'runs.decide.rejected': { en: 'Rejected.', tr: 'Reddedildi.' },
  'runs.decide.rejected_reason': { en: 'Rejected — {reason}', tr: 'Reddedildi — {reason}' },
  'runs.decide.started': {
    en: 'Run started (detached) — job {jobId}',
    tr: 'Koşu başlatıldı (arka planda) — iş {jobId}',
  },
  'runs.decide.start_duplicate': {
    en: 'Already started — idempotent, nothing was spawned again.',
    tr: 'Zaten başlatılmış — idempotent, yeniden başlatılmadı.',
  },
  'runs.decide.flag_conflict': {
    en: '--approve and --reject are mutually exclusive.',
    tr: '--approve ile --reject birlikte kullanılamaz.',
  },
  'runs.decide.reason_without_reject': {
    en: '--reason is only valid with --reject.',
    tr: '--reason yalnız --reject ile kullanılır.',
  },
  // 583/N1 — `deckent runs <n> --diff`: the run's real footprint, line-level.
  'runs.diff.header': {
    en: 'Diff — {n} file(s), base {base}',
    tr: 'Diff — {n} dosya, taban {base}',
  },
  'runs.diff.empty': { en: 'No changes in this run\'s footprint.', tr: 'Bu koşunun ayak izinde değişiklik yok.' },
  'runs.diff.no_base': {
    en: 'Note: no recorded start commit (pre-N1 run) — showing the working tree vs HEAD.',
    tr: 'Not: kayıtlı başlangıç-commit\'i yok (N1-öncesi koşu) — çalışma ağacı HEAD\'e karşı gösteriliyor.',
  },
  'runs.diff.not_git': { en: 'This project is not a git repository — no diff available.', tr: 'Bu proje bir git deposu değil — diff üretilemiyor.' },
  'runs.diff.truncated': { en: '… diff truncated (size cap).', tr: '… diff kırpıldı (boyut sınırı).' },
  // 583/N4 — the post-run incele→commit flow (`runs <n> --commit`, KARAR-2).
  'runs.commit.not_terminal': {
    en: 'Run {id} is {state} — commit is a post-run step (wait for a terminal state).',
    tr: 'Koşu {id} {state} durumunda — commit koşu-sonu adımıdır (terminal durumu bekleyin).',
  },
  'runs.commit.not_git': {
    en: 'This project is not a git repository — nothing to commit.',
    tr: 'Bu proje bir git deposu değil — commit edilecek bir şey yok.',
  },
  'runs.commit.clean': {
    en: 'Working tree clean — nothing to commit.',
    tr: 'Çalışma ağacı temiz — commit edilecek değişiklik yok.',
  },
  'runs.commit.header': {
    en: 'Commit proposal — {n} file(s), +{ins} −{del}:',
    tr: 'Commit önerisi — {n} dosya, +{ins} −{del}:',
  },
  'runs.commit.suggested': { en: 'Message:', tr: 'Mesaj:' },
  'runs.commit.prompt': { en: 'Commit? [y/N] ', tr: 'Commit edilsin mi? [y/N] ' },
  'runs.commit.aborted': {
    en: 'Commit aborted — nothing was staged or committed.',
    tr: 'Commit iptal edildi — hiçbir şey stage edilmedi, commit atılmadı.',
  },
  'runs.commit.noninteractive': {
    en: 'Non-interactive session — pass --yes to commit (and --message to set the message).',
    tr: 'Etkileşimsiz oturum — commit için --yes verin (mesajı --message ile belirleyin).',
  },
  'runs.commit.staged': { en: 'Staged {n} file(s).', tr: '{n} dosya stage edildi.' },
  'runs.commit.done': { en: 'Committed {sha}.', tr: 'Commit edildi: {sha}.' },
  'runs.commit.add_failed': { en: 'git add failed: {error}', tr: 'git add başarısız: {error}' },
  'runs.commit.commit_failed': { en: 'git commit failed: {error}', tr: 'git commit başarısız: {error}' },
  'runs.decide.gate_warn': {
    en: 'Warning: the plan gate is FAIL ({n} blocking finding(s)) — the run will refuse at start unless overridden.',
    tr: 'Uyarı: plan kapısı FAIL ({n} blocker) — koşu, override edilmedikçe start anında reddedecek.',
  },
  'runs.decide.needs_row': {
    en: 'Decision flags need a run number: deckent runs <n> --approve | --reject | --start',
    tr: 'Karar bayrakları koşu numarası ister: deckent runs <n> --approve | --reject | --start',
  },
  'tui.resume_picker_header': { en: 'Recent sessions', tr: 'Son oturumlar' },
  'tui.resume_picker_hint': {
    en: 'Tip: /resume <number> to continue a session',
    tr: 'İpucu: bir oturumu sürdürmek için /resume <numara>',
  },
  'tui.resume_picker_switched': { en: 'resumed: {id}', tr: 'sürdürülüyor: {id}' },
  'tui.resume_picker_not_found': { en: 'session not found: {arg}', tr: 'oturum bulunamadı: {arg}' },
  'tui.resume_picker_ambiguous': {
    en: 'ambiguous — matches: {matches}',
    tr: 'belirsiz — eşleşenler: {matches}',
  },

  // ─── busy-controls: /queue /interrupt /steer (APP-SURFACE-WIRE 358-006 —
  // ReplLabels.busy*; renderBusyDecision in app.tsx, wired by run.tsx's
  // buildReplLabels. Task 387-001) ──────────────────────────────────────────
  'tui.busy_queue_status': {
    en: 'queue: {count} background · {state}',
    tr: 'kuyruk: {count} arkaplan · {state}',
  },
  'tui.busy_state_busy': { en: 'busy', tr: 'meşgul' },
  'tui.busy_state_idle': { en: 'idle', tr: 'boşta' },
  // TERMINAL-TOOLS-008 — a real abort: the provider stream is torn down now
  // (a tool call already running finishes; nothing new is proposed).
  'tui.busy_interrupted': {
    en: 'interrupted — the provider stream was stopped; pending input cleared',
    tr: 'kesildi — sağlayıcı akışı durduruldu; bekleyen girdi temizlendi',
  },
  'tui.busy_interrupt_idle': { en: 'nothing running to interrupt', tr: 'kesilecek bir şey çalışmıyor' },
  'tui.busy_interrupt_dup': { en: 'interrupt already requested', tr: 'kesme zaten istendi' },
  'tui.busy_steer_queued': {
    en: 'steer note queued (#{position}) — applied at turn end',
    tr: 'yönlendirme notu sıraya alındı (#{position}) — tur sonunda uygulanacak',
  },
  'tui.busy_steer_idle': { en: 'nothing running to steer', tr: 'yönlendirilecek bir şey çalışmıyor' },
  'tui.busy_steer_empty': { en: 'usage: /steer <message>', tr: 'kullanım: /steer <mesaj>' },

  // ─── ApprovalCard (APP-APPROVAL-WIRE 355-011 — ApprovalCardLabels; wired by
  // run.tsx's buildApprovalLabels. `progress` reuses tui.confirm_progress
  // (identical "[{index}/{total}]" template, no need for a duplicate key).
  // Task 387-001) ────────────────────────────────────────────────────────────
  'tui.approval_card_hint': {
    en: '(y = approve · n = deny · a = approve similar · d = details)',
    tr: '(y = onayla · n = reddet · a = benzerlerini onayla · d = detay)',
  },
  'tui.approval_card_details_heading': { en: 'Details', tr: 'Detaylar' },
  'tui.approval_card_no_args': { en: '(no arguments)', tr: '(argüman yok)' },
  'tui.approval_risk_none': { en: 'NONE', tr: 'YOK' },
  'tui.approval_risk_low': { en: 'LOW', tr: 'DÜŞÜK' },
  'tui.approval_risk_medium': { en: 'MEDIUM', tr: 'ORTA' },
  'tui.approval_risk_high': { en: 'HIGH', tr: 'YÜKSEK' },
  'tui.approval_risk_critical': { en: 'CRITICAL', tr: 'KRİTİK' },

  // ─── `deckent plan-nl` preview/backup lines (Task 354-008 DIR-1-CMD —
  // sole-authority addition; cited by 354-008's own directive "yenisi
  // gerekirse notes→Task 15" for the two plain-English strings in
  // src/cli/commands/plan-nl.ts's formatPlanNlPreview()/backup print line —
  // the post-write confirmation itself already reuses the existing
  // set_directives.updated key, so it needs no new entry here) ─────────────
  'plan_nl.preview_banner': {
    en: 'Deckent Plan (NL) — preview only, DIRECTIVES.md was NOT modified. Re-run with --write to save.',
    tr: 'Deckent Plan (NL) — yalnızca önizleme, DIRECTIVES.md değiştirilmedi. Kaydetmek için --write ile tekrar çalıştırın.',
  },
  'plan_nl.backup_created': {
    en: 'Backed up existing DIRECTIVES.md → {path}',
    tr: 'Mevcut DIRECTIVES.md yedeklendi → {path}',
  },

  // ─── ApprovalCard labels (Task 355-011 APP-APPROVAL-WIRE — sole-authority
  // addition; cited by app.tsx's DEFAULT_APPROVAL_CARD_LABELS fallback comment
  // "until messages round-8 (Task 15, MESSAGES-KEYS-4) wires localized keys".
  // English values mirror DEFAULT_APPROVAL_CARD_LABELS byte-for-byte) ────────
  'approval_card.hint': {
    en: '(y = approve · n = deny · a = approve similar · d = details)',
    tr: '(y = onayla · n = reddet · a = benzerlerini onayla · d = detay)',
  },
  // Numeric position notation — identical across locales by design, same
  // precedent as the existing tui.confirm_progress key.
  'approval_card.progress': {
    en: '[{index}/{total}]',
    tr: '[{index}/{total}]',
  },
  'approval_card.details_heading': {
    en: 'Details',
    tr: 'Detay',
  },
  'approval_card.no_args': {
    en: '(no arguments)',
    tr: '(argüman yok)',
  },
  'approval_card.risk_none': { en: 'NONE', tr: 'YOK' },
  'approval_card.risk_low': { en: 'LOW', tr: 'DÜŞÜK' },
  'approval_card.risk_medium': { en: 'MEDIUM', tr: 'ORTA' },
  'approval_card.risk_high': { en: 'HIGH', tr: 'YÜKSEK' },
  'approval_card.risk_critical': { en: 'CRITICAL', tr: 'KRİTİK' },

  // ─── `deckent do "<goal>"` (Task 355-010 GOLDENFLOW-CMD — sole-authority
  // addition; cited by 355-010's own docImpact: "all do.ts user-facing
  // strings are plain English literals ... A follow-up task should add do.*
  // keys to messages.ts". English values mirror do.ts's literal strings
  // byte-for-byte (formatDoPlanPreview + registerDo)) ────────────────────────
  'do.preview_banner_run': {
    en: 'Deckent Do — plan preview ({count} task(s)). Confirm below to start the run now.',
    tr: 'Deckent Do — plan önizleme ({count} görev). Run\'ı şimdi başlatmak için aşağıdan onaylayın.',
  },
  'do.preview_banner_dry_run': {
    en: 'Deckent Do — plan preview (dry-run; {count} task(s)). Nothing was started. Re-run with --run to execute.',
    tr: 'Deckent Do — plan önizleme (dry-run; {count} görev). Hiçbir şey başlatılmadı. Çalıştırmak için --run ile tekrar çalıştırın.',
  },
  'do.what_will_happen': {
    en: 'What will happen:',
    tr: 'Ne olacak:',
  },
  'do.task_files': {
    en: 'files: {files}',
    tr: 'dosyalar: {files}',
  },
  'do.task_scope': {
    en: 'scope: {scope}',
    tr: 'kapsam: {scope}',
  },
  'do.task_go_criteria': {
    en: 'goCriteria: {goCriteria}',
    tr: 'goCriteria: {goCriteria}',
  },
  'do.empty_goal': {
    en: 'do: goal must not be empty',
    tr: 'do: hedef boş olamaz',
  },
  'do.confirm_start': {
    en: 'Proceed and start this run now?',
    tr: 'Devam edilsin ve run şimdi başlatılsın mı?',
  },
  'do.dry_run_complete': {
    en: 'Dry-run complete — nothing was started. The exact proposal remains awaiting approval.',
    tr: 'Dry-run tamamlandı — hiçbir şey başlatılmadı. Exact öneri onay beklemeye devam ediyor.',
  },
  'do.dry_run_approve_hint': {
    en: 'Approve and start this exact proposal ({flowId}) without replanning: {command}',
    tr: 'Bu exact öneriyi ({flowId}) yeniden planlamadan onaylayıp başlatın: {command}',
  },
  // F-2 — planning-phase heartbeat (the propose/plan step is a real LLM call).
  'do.planning_started': {
    en: '⏳ Planning with the LLM… (timeout: {timeoutMin} min — tune with brain_plan_timeout_ms)',
    tr: '⏳ Plan LLM ile hazırlanıyor… (zaman-aşımı: {timeoutMin} dk — brain_plan_timeout_ms ile ayarlanır)',
  },
  'do.planning_progress': {
    en: '⏳ Planning… {elapsed}s',
    tr: '⏳ Planlanıyor… {elapsed}s',
  },
  'do.gate_blocked': {
    en: 'Prompt gate: {count} blocking finding(s) — run NOT started (the detached child would die at PLAN with the same verdict). Fix the plan or re-run with an adjusted goal.',
    tr: 'Prompt-gate: {count} engelleyici bulgu — koşu BAŞLATILMADI (detached-child PLAN fazında aynı kararla ölecekti). Planı düzeltin ya da hedefi ayarlayıp yeniden deneyin.',
  },
  'do.scope_gate_blocked': {
    en: 'Scope gate: run NOT started (the detached child would die at PLAN with the same verdict). Fix the write paths, or acknowledge intentional new paths with --force-scope.\n{message}',
    tr: 'Scope-gate: koşu BAŞLATILMADI (detached-child PLAN fazında aynı kararla ölecekti). Yazma-yollarını düzeltin ya da bilinçli yeni-yolları --force-scope ile onaylayın.\n{message}',
  },
  'do.write_allowlist_option': {
    en: 'Bind the exact plan to an existing-file closed write allowlist; repeat paths after the option',
    tr: 'Exact planı mevcut dosyalardan oluşan kapalı write allowlist’e bağla; option sonrasında path’leri sıralayın',
  },
  'do.write_allowlist_requires_run_flow': {
    en: '--write-allowlist requires the canonical RunFlow path (terminal.run_flow_v2=true); no plan was created.',
    tr: '--write-allowlist canonical RunFlow yolunu gerektirir (terminal.run_flow_v2=true); plan oluşturulmadı.',
  },
  'do.closed_write_scope_blocked': {
    en: 'Closed write scope blocked the plan before approval. Every allowed path must already be tracked and every task write must be allowlisted; --force-scope cannot override this authority. Violations: {violations}',
    tr: 'Kapalı write scope planı onaydan önce durdurdu. İzin verilen her path zaten tracked olmalı ve her task write allowlist içinde bulunmalı; --force-scope bu authority’yi aşamaz. İhlaller: {violations}',
  },
  // do.scope_gate_preview_fail / do.scope_gate_overridden (the preview-only
  // renderings) were retired by 452-003 — the preview verdict text now comes
  // from runFlow.planPreview.scopeGate.* (see above), shared verbatim with
  // the REPL card via formatScopeGateLines (plan-preview-card.tsx).
  'do.cancelled': {
    en: 'Cancelled at stage "{stage}" ({reason}). Nothing was started.',
    tr: '"{stage}" aşamasında iptal edildi ({reason}). Hiçbir şey başlatılmadı.',
  },
  'do.finished': {
    en: 'Run finished — exitCode {exitCode} ({outcome}).',
    tr: 'Run tamamlandı — exitCode {exitCode} ({outcome}).',
  },
  'do.outcome_success': { en: 'success', tr: 'başarılı' },
  'do.outcome_failure': { en: 'failure', tr: 'başarısız' },

  // ─── REPL `/do <goal>` slash (452-002 REPL-DO-SLASH-WIRE) — the two NON-run
  // edges of the terminal.run_flow_v2 gate. Flag-ON drives the SAME RunFlow
  // preview→approval chain the native `deckent_propose_run` tool and CLI
  // `deckent do` use (no new controller); only these off/usage notices are
  // string-surfaces owned here (mechanism modules stay string-free — run.tsx's
  // buildDoSlashLabels resolves these via getMessage, English default). ───────
  'do.slash_flag_off': {
    en: '/do requires the RunFlow surface — enable terminal.run_flow_v2 in .deckent/config.json.',
    tr: '/do için RunFlow yüzeyi gerekir — .deckent/config.json içinde terminal.run_flow_v2 açın.',
  },
  'do.slash_usage': {
    en: 'usage: /do <goal> — describe what to plan and run (e.g. /do add a health endpoint).',
    tr: 'kullanım: /do <hedef> — planlanıp çalıştırılacak işi yazın (örn. /do sağlık ucu ekle).',
  },
  'do.slash_no_providers': {
    en: '/do cannot plan yet: no provider is registered for model {model} (needs provider "{provider}"); registered: {registered}. Check `deckent connect`, then point providers.brain or the active mode\'s brain_model at a reachable provider.',
    tr: '/do henüz planlayamıyor: {model} modeli için kayıtlı sağlayıcı yok ("{provider}" sağlayıcısı gerekir); kayıtlı: {registered}. `deckent connect` ile durumu görün, sonra providers.brain veya aktif modun brain_model değerini erişilebilir bir sağlayıcıya yöneltin.',
  },

  // ─── `deckent doctor --fix` (keys added by Task 356-015; wired into
  // formatDoctorFixLines() by Task 367-006, closing the standing
  // "TODO(docImpact, Task 15)" — English values mirror
  // formatDoctorFixLines()'s literal strings byte-for-byte, pinned by
  // tests/cli/messages-round9-keys.test.ts. The conditional "attempted
  // (N FAILED)" header is split into two keys (_ok / _failed) since
  // getMessage() only does flat {var} substitution, same precedent as
  // do.preview_banner_run/do.preview_banner_dry_run) ─────────────────────
  'doctor.fix_nothing_to_repair': {
    en: 'doctor --fix: nothing to repair — all safe-fix checks passed.',
    tr: 'doctor --fix: onarılacak bir şey yok — tüm güvenli-onarım kontrolleri geçti.',
  },
  'doctor.fix_dry_run_header': {
    en: 'doctor --fix (dry-run) — {count} safe repair(s) available:',
    tr: 'doctor --fix (dry-run) — {count} güvenli onarım mevcut:',
  },
  'doctor.fix_would_fix_line': {
    en: '  [would fix] {description}',
    tr: '  [onarılacak] {description}',
  },
  'doctor.fix_apply_hint': {
    en: 'Run `deckent doctor --fix --yes` to apply.',
    tr: 'Uygulamak için `deckent doctor --fix --yes` çalıştırın.',
  },
  'doctor.fix_apply_header_ok': {
    en: 'doctor --fix --yes — {count} repair(s) attempted:',
    tr: 'doctor --fix --yes — {count} onarım denendi:',
  },
  'doctor.fix_apply_header_failed': {
    en: 'doctor --fix --yes — {count} repair(s) attempted ({failed} FAILED):',
    tr: 'doctor --fix --yes — {count} onarım denendi ({failed} BAŞARISIZ):',
  },
  'doctor.fix_line_fixed': {
    en: '  [fixed] {description}',
    tr: '  [onarıldı] {description}',
  },
  'doctor.fix_line_failed': {
    en: '  [FAILED] {description} — {error}',
    tr: '  [BAŞARISIZ] {description} — {error}',
  },

  // ─── `deckent doctor --fix` enrichment (Task 367-006 ONB-2-DOCTOR-FIX):
  // reversible-report "before value" line + the honest "manual" (not
  // auto-fixable) section ───────────────────────────────────────────────
  'doctor.fix_previous_value_line': {
    en: '        before: {previousValue}',
    tr: '        önce: {previousValue}',
  },
  'doctor.fix_no_auto_fixable_but_manual': {
    en: 'doctor --fix: no auto-fixable issues found — {count} check(s) need manual attention (see below).',
    tr: 'doctor --fix: otomatik onarılabilir bir sorun yok — {count} kontrol elle ilgi bekliyor (aşağıya bakın).',
  },
  'doctor.fix_manual_header': {
    en: 'Manual (not auto-fixable — {count} check(s) need your attention):',
    tr: 'Manuel (otomatik onarılamaz — {count} kontrol dikkatinizi bekliyor):',
  },
  'doctor.fix_manual_line': {
    en: '  [manual] {name} — {message}',
    tr: '  [manuel] {name} — {message}',
  },

  // ─── limits command (Sprint 361 Task 361-002, LIMIT-GATE-WIRE) ─────────
  'limits.header': {
    en: 'Subscription Limits',
    tr: 'Abonelik Limitleri',
  },
  'limits.unavailable': {
    en: 'Limit probe unavailable: {reason}',
    tr: 'Limit probu kullanılamıyor: {reason}',
  },
  'limits.col_window': {
    en: 'Window',
    tr: 'Pencere',
  },
  'limits.col_usage': {
    en: 'Usage',
    tr: 'Kullanım',
  },
  'limits.col_resets': {
    en: 'Resets',
    tr: 'Sıfırlanma',
  },
  'limits.window_session': {
    en: 'Session',
    tr: 'Oturum',
  },
  'limits.window_week_all': {
    en: 'Week (all models)',
    tr: 'Hafta (tüm modeller)',
  },
  'limits.window_week_fable': {
    en: 'Week (Fable)',
    tr: 'Hafta (Fable)',
  },
  'limits.no_reset': {
    en: '—',
    tr: '—',
  },
  'limits.verdict_ok': {
    en: 'OK — usage is within safe limits.',
    tr: 'OK — kullanım güvenli sınırlar içinde.',
  },
  'limits.verdict_unknown': {
    en: 'UNKNOWN — live limit evidence is unavailable.',
    tr: 'BİLİNMİYOR — canlı limit kanıtına ulaşılamıyor.',
  },
  'limits.verdict_warn': {
    en: 'WARNING — {window} usage at {pct}% is approaching the limit.',
    tr: 'UYARI — {window} kullanımı %{pct} ile limite yaklaşıyor.',
  },
  'limits.verdict_block': {
    en: 'BLOCKED — {window} usage at {pct}% has reached the limit (resets {reset}).',
    tr: 'ENGELLENDİ — {window} kullanımı %{pct} ile limite ulaştı (sıfırlanma: {reset}).',
  },
  'limits.gate_enabled': {
    en: 'Start-gate: enabled (limit_gate.enabled = true)',
    tr: 'Başlangıç-kapısı: açık (limit_gate.enabled = true)',
  },
  'limits.gate_disabled': {
    en: 'Start-gate: disabled (limit_gate.enabled = false)',
    tr: 'Başlangıç-kapısı: kapalı (limit_gate.enabled = false)',
  },
  'limits.force_bypass': {
    en: '[limit-gate] Blocked verdict bypassed via --force.',
    tr: '[limit-gate] Engelleme --force ile aşıldı.',
  },
  'limits.start_gate_blocked': {
    en: '[limit-gate] Run start blocked — {window} usage at {pct}% (resets {reset}). Use --force to override.',
    tr: '[limit-gate] Run başlatma engellendi — {window} kullanımı %{pct} (sıfırlanma: {reset}). Aşmak için --force kullanın.',
  },
  'limits.start_gate_warn': {
    en: '[limit-gate] Warning: {window} usage at {pct}% — proceeding.',
    tr: '[limit-gate] Uyarı: {window} kullanımı %{pct} — devam ediliyor.',
  },
  'limits.start_gate_unknown': {
    en: '[limit-gate] Limit state is unknown — advisory policy is proceeding without a live signal.',
    tr: '[limit-gate] Limit durumu bilinmiyor — advisory policy canlı sinyal olmadan devam ediyor.',
  },

  // ─── openrouter-probe command (OPENROUTER-LIVE-PREP, Sprint 365 Task 365-004) ─
  'openrouter_probe.header': {
    en: 'OpenRouter Live Probe',
    tr: 'OpenRouter Canlı Probu',
  },
  'openrouter_probe.unavailable': {
    en: 'OpenRouter probe unavailable: {reason}',
    tr: 'OpenRouter probu kullanılamıyor: {reason}',
  },
  'openrouter_probe.fetch_failed': {
    en: 'OpenRouter live fetch failed: {reason}',
    tr: 'OpenRouter canlı-çağrısı başarısız: {reason}',
  },
  'openrouter_probe.summary': {
    en: '{count} free model(s) found — cache written to {cacheFile}',
    tr: '{count} ücretsiz model bulundu — önbellek {cacheFile} konumuna yazıldı',
  },
  'openrouter_probe.model_line': {
    en: '  - {id} ({context} ctx, {modality})',
    tr: '  - {id} ({context} bağlam, {modality})',
  },
  'openrouter_probe.more': {
    en: '  … and {count} more',
    tr: '  … ve {count} tane daha',
  },

  // ─── onboarding wizard core (ONB-WIZARD-CORE, Sprint 361 Task 361-009) ─
  'onboarding.mcp.host_not_installed': {
    en: '{host}: CLI not installed — MCP attach skipped',
    tr: '{host}: CLI kurulu değil — MCP bağlama atlandı',
  },
  'onboarding.mcp.unsupported': {
    en: '{host}: this CLI does not support MCP attach',
    tr: '{host}: bu CLI MCP bağlamayı desteklemiyor',
  },
  'onboarding.mcp.already_attached': {
    en: '{host}: MCP already attached',
    tr: '{host}: MCP zaten bağlı',
  },
  'onboarding.mcp.attach_suggested': {
    en: '{host}: MCP attach suggested',
    tr: '{host}: MCP bağlama önerildi',
  },
  'onboarding.question.workspace_scope': {
    en: 'Where should this configuration live?',
    tr: 'Bu yapılandırma nerede saklansın?',
  },
  'onboarding.choice.workspace_scope.project': {
    en: 'This project only',
    tr: 'Yalnızca bu proje',
  },
  'onboarding.choice.workspace_scope.global': {
    en: 'Global (all projects on this machine)',
    tr: 'Global (bu makinedeki tüm projeler)',
  },
  'onboarding.question.plan_mode': {
    en: 'Select a working mode',
    tr: 'Bir çalışma modu seçin',
  },
  'onboarding.choice.plan_mode.performance': {
    en: 'performance (premium tier, max power)',
    tr: 'performans (premium katman, maksimum güç)',
  },
  'onboarding.choice.plan_mode.balanced': {
    en: 'balanced (standard brain + premium workers)',
    tr: 'dengeli (standart brain + premium worker)',
  },
  'onboarding.choice.plan_mode.economic': {
    en: 'economic (standard tier, cost-efficient)',
    tr: 'ekonomik (standart katman, maliyet-etkin)',
  },
  'onboarding.choice.plan_mode.api': {
    en: 'api (pay-per-use, premium brain + standard workers)',
    tr: 'api (kullandıkça öde, premium brain + standart worker)',
  },
  'onboarding.choice.plan_mode.max_plan': {
    en: 'max_plan (Claude Max subscription, performance preset)',
    tr: 'max_plan (Claude Max aboneliği, performans ön ayarı)',
  },
  'onboarding.choice.plan_mode.max5x_plan': {
    en: 'max5x_plan (Claude Max 5x subscription, higher usage ceiling)',
    tr: 'max5x_plan (Claude Max 5x aboneliği, daha yüksek kullanım tavanı)',
  },
  'onboarding.choice.plan_mode.pro_plan': {
    en: 'pro_plan (Claude Pro subscription, economic preset)',
    tr: 'pro_plan (Claude Pro aboneliği, ekonomik ön ayar)',
  },
  'onboarding.provider.none_authenticated': {
    en: 'No authenticated provider found — sign in to a provider CLI (claude / codex / gemini) and re-run onboarding.',
    tr: 'Kimliği doğrulanmış bir sağlayıcı bulunamadı — bir sağlayıcı CLI\'sine (claude / codex / gemini) giriş yapıp onboarding\'i yeniden çalıştırın.',
  },

  // ─── onboarding Ink UI (WIZARD-INK, Sprint 362 Task 362-011) ───────────
  'onboarding.ui.step.provider_detect': {
    en: 'Provider Detection',
    tr: 'Sağlayıcı Tespiti',
  },
  'onboarding.ui.step.auth_status': {
    en: 'Authentication Status',
    tr: 'Kimlik Doğrulama Durumu',
  },
  'onboarding.ui.step.mcp_suggestion': {
    en: 'MCP Attach',
    tr: 'MCP Bağlama',
  },
  'onboarding.ui.step.workspace_mode': {
    en: 'Workspace & Mode',
    tr: 'Çalışma Alanı ve Mod',
  },
  'onboarding.ui.step.summary': {
    en: 'Summary',
    tr: 'Özet',
  },
  'onboarding.ui.provider.present': {
    en: '{provider}: found (v{version})',
    tr: '{provider}: bulundu (v{version})',
  },
  'onboarding.ui.provider.missing': {
    en: '{provider}: not found',
    tr: '{provider}: bulunamadı',
  },
  'onboarding.ui.auth.logged-in': {
    en: '{provider}: logged in ({method})',
    tr: '{provider}: giriş yapıldı ({method})',
  },
  'onboarding.ui.auth.logged-out': {
    en: '{provider}: not logged in',
    tr: '{provider}: giriş yapılmamış',
  },
  'onboarding.ui.auth.unknown': {
    en: '{provider}: login status unknown',
    tr: '{provider}: giriş durumu bilinmiyor',
  },
  'onboarding.ui.question.mcp_attach': {
    en: 'Attach the recommended MCP servers?',
    tr: 'Önerilen MCP sunucuları bağlansın mı?',
  },
  'onboarding.ui.choice.mcp_attach.accept': {
    en: 'Yes, attach ({hosts})',
    tr: 'Evet, bağla ({hosts})',
  },
  'onboarding.ui.choice.mcp_attach.skip': {
    en: 'No, skip',
    tr: 'Hayır, atla',
  },
  'onboarding.ui.question.apply': {
    en: 'Apply this configuration?',
    tr: 'Bu yapılandırma uygulansın mı?',
  },
  'onboarding.ui.choice.apply.apply': {
    en: 'Apply',
    tr: 'Uygula',
  },
  'onboarding.ui.choice.apply.cancel': {
    en: 'Cancel',
    tr: 'İptal',
  },
  'onboarding.ui.progress': {
    en: 'Step {index}/{total}',
    tr: 'Adım {index}/{total}',
  },
  'onboarding.ui.hint.question': {
    en: '↑/↓ move · Enter select · s skip (default) · Esc cancel',
    tr: '↑/↓ hareket · Enter seç · s atla (varsayılan) · Esc iptal',
  },
  'onboarding.ui.hint.info': {
    en: 'Enter continue · Esc cancel',
    tr: 'Enter devam · Esc iptal',
  },
  'onboarding.ui.summary.config_path': {
    en: 'Config path: {path}',
    tr: 'Yapılandırma yolu: {path}',
  },
  'onboarding.ui.summary.mode': {
    en: 'Mode: {mode} (brain/worker tier: {strategy})',
    tr: 'Mod: {mode} (brain/worker katmanı: {strategy})',
  },
  'onboarding.ui.summary.scope': {
    en: 'Scope: {scope} (root: {root})',
    tr: 'Kapsam: {scope} (kök: {root})',
  },
  'onboarding.ui.summary.providers': {
    en: 'Providers — brain: {brain}, worker: {worker}, fallback: {fallback}',
    tr: 'Sağlayıcılar — brain: {brain}, worker: {worker}, fallback: {fallback}',
  },
  'onboarding.ui.summary.mcp_actions': {
    en: 'MCP attach actions: {count} ({hosts})',
    tr: 'MCP bağlama eylemleri: {count} ({hosts})',
  },
  'onboarding.ui.summary.mcp_none': {
    en: 'MCP attach actions: none',
    tr: 'MCP bağlama eylemleri: yok',
  },
  'onboarding.ui.summary.global_scope_error': {
    en: 'Global scope resolution failed: {error}',
    tr: 'Global kapsam çözümlemesi başarısız: {error}',
  },
  'onboarding.ui.done.applied': {
    en: 'Configuration plan confirmed.',
    tr: 'Yapılandırma planı onaylandı.',
  },
  'onboarding.ui.done.cancelled': {
    en: 'Onboarding cancelled — nothing changed.',
    tr: 'Onboarding iptal edildi — hiçbir şey değişmedi.',
  },

  // ─── onboard entry-wire (ONB-ENTRY-WIRE, Sprint 363 Task 363-005) ──────
  'onboarding.plan.title': {
    en: '=== Deckent Onboarding Plan ===',
    tr: '=== Deckent Onboarding Planı ===',
  },
  'onboarding.plan.section.providers': {
    en: 'Providers:',
    tr: 'Sağlayıcılar:',
  },
  'onboarding.plan.section.auth': {
    en: 'Authentication:',
    tr: 'Kimlik Doğrulama:',
  },
  'onboarding.plan.section.mcp': {
    en: 'MCP Attach:',
    tr: 'MCP Bağlama:',
  },
  'onboarding.plan.section.summary': {
    en: 'Summary:',
    tr: 'Özet:',
  },
  'onboarding.plan.not_applied': {
    en: 'No files were written — this was a plan preview only.',
    tr: 'Hiçbir dosya yazılmadı — bu yalnızca bir plan önizlemesiydi.',
  },

  // ─── onboard apply-wire (ONB-APPLY-WIRE, Sprint 367 Task 367-005) ──────
  'onboarding.apply.preview.title': {
    en: '=== Deckent Onboarding Apply Preview (dry-run) ===',
    tr: '=== Deckent Onboarding Uygulama Önizlemesi (dry-run) ===',
  },
  'onboarding.apply.result.title': {
    en: '=== Deckent Onboarding Apply ===',
    tr: '=== Deckent Onboarding Uygulama ===',
  },
  'onboarding.apply.section.changes': {
    en: 'Field changes:',
    tr: 'Alan değişiklikleri:',
  },
  'onboarding.apply.field_change': {
    en: '{key}: {previous} -> {next}',
    tr: '{key}: {previous} -> {next}',
  },
  'onboarding.apply.value_none': {
    en: '(none)',
    tr: '(yok)',
  },
  'onboarding.apply.no_changes': {
    en: 'No changes — the target config already matches this plan.',
    tr: 'Değişiklik yok — hedef yapılandırma zaten bu planla eşleşiyor.',
  },
  'onboarding.apply.confirm_prompt': {
    en: 'Apply this configuration to {path}?',
    tr: 'Bu yapılandırma {path} konumuna uygulansın mı?',
  },
  'onboarding.apply.cancelled': {
    en: 'Apply cancelled — no changes were written.',
    tr: 'Uygulama iptal edildi — hiçbir değişiklik yazılmadı.',
  },
  'onboarding.apply.applied': {
    en: 'Applied — configuration written to {path}.',
    tr: 'Uygulandı — yapılandırma {path} konumuna yazıldı.',
  },
  'onboarding.apply.verification_failed': {
    en: 'Warning: post-write verification failed: {errors}',
    tr: 'Uyarı: yazım sonrası doğrulama başarısız oldu: {errors}',
  },
  'onboarding.apply.dry_run_notice': {
    en: 'Dry-run — no changes were written.',
    tr: 'Dry-run — hiçbir değişiklik yazılmadı.',
  },

  // ─── onboarding chat meta-intents (ONB-CHAT-DILIM-2, Sprint 368 Task 368-004) ──
  'onboarding.suggestion.connect_provider': {
    en: 'Run `deckent connect` to sign in to a provider CLI (claude / codex / gemini).',
    tr: 'Bir sağlayıcı CLI\'sine (claude / codex / gemini) giriş yapmak için `deckent connect` çalıştırın.',
  },
  'onboarding.chat.suggestion.show_limits': {
    en: 'Run `deckent limits` to see your current subscription-window usage.',
    tr: 'Mevcut abonelik-penceresi kullanımınızı görmek için `deckent limits` çalıştırın.',
  },
  'onboarding.chat.suggestion.start_sprint': {
    en: 'Once setup is done, run `deckent plan` then `deckent start` to plan and launch a run.',
    tr: 'Kurulum bittiğinde bir run planlayıp başlatmak için `deckent plan`, ardından `deckent start` çalıştırın.',
  },
  'onboarding.chat.suggestion.run_doctor': {
    en: 'Run `deckent doctor` to diagnose and fix common setup problems.',
    tr: 'Yaygın kurulum sorunlarını teşhis edip düzeltmek için `deckent doctor` çalıştırın.',
  },

  // ─── cu-status (TOOL-CU CLI surface, Sprint 374 Task 374-002) ───────────────
  'cuStatus.title': {
    en: 'Computer-Use Status',
    tr: 'Bilgisayar-Kullanımı Durumu',
  },
  'cuStatus.flag_disabled': {
    en: 'Flag: disabled — {reason}',
    tr: 'Bayrak: kapalı — {reason}',
  },
  'cuStatus.how_to_enable': {
    en: 'To enable: set "computer_use": { "enabled": true, "allowed_capabilities": [...] } in .deckent/config.json (project or global), then rerun `deckent cu-status`.',
    tr: 'Açmak için: .deckent/config.json (proje veya global) dosyasına "computer_use": { "enabled": true, "allowed_capabilities": [...] } ekleyin, ardından `deckent cu-status` komutunu tekrar çalıştırın.',
  },
  'cuStatus.flag_enabled': {
    en: 'Flag: enabled',
    tr: 'Bayrak: açık',
  },
  'cuStatus.platform_known': {
    en: 'Platform: {platform} (known)',
    tr: 'Platform: {platform} (bilinen)',
  },
  'cuStatus.platform_unsupported': {
    en: 'Platform: {platform} (unsupported — no capability mapping for this platform)',
    tr: 'Platform: {platform} (desteklenmiyor — bu platform için yetenek eşlemesi yok)',
  },
  'cuStatus.allowed_capabilities_line': {
    en: 'Allowed capabilities: {list}',
    tr: 'İzinli yetenekler: {list}',
  },
  'cuStatus.allowed_capabilities_empty': {
    en: '(none)',
    tr: '(yok)',
  },
  'cuStatus.capabilities_header': {
    en: 'Capabilities:',
    tr: 'Yetenekler:',
  },
  'cuStatus.capability_available': {
    en: '  {kind}: available',
    tr: '  {kind}: mevcut',
  },
  'cuStatus.capability_unavailable': {
    en: '  {kind}: unavailable — {reason}',
    tr: '  {kind}: kullanılamıyor — {reason}',
  },
  'cuStatus.config_load_error': {
    en: 'could not resolve project configuration ({error}) — treating computer_use as unavailable',
    tr: 'proje yapılandırması çözülemedi ({error}) — computer_use kullanılamaz kabul ediliyor',
  },

  // ─── ADR-D-012 TERM-5 CommandRisk ladder (cmdCatalog.risk.*) ─────────────
  // Canonical 4-class plain-risk-language (src/cli/command-registry.ts
  // CommandRisk), consumed via src/cli/helpers/risk-language.ts. Key names
  // match the ADR's own draft spec (ADR-D-012 § Decision item 2).
  'cmdCatalog.risk.oku': { en: 'Read', tr: 'Oku' },
  'cmdCatalog.risk.oku.desc': {
    en: 'Read-only — displays information, changes nothing.',
    tr: 'Salt-okunur — bilgi gösterir, hiçbir şeyi değiştirmez.',
  },
  'cmdCatalog.risk.degistir': { en: 'Modify', tr: 'Değiştir' },
  'cmdCatalog.risk.degistir.desc': {
    en: 'Local-state modification — writes local project/session state, generally reversible.',
    tr: 'Yerel-durum değişikliği — yerel proje/oturum durumuna yazar, genelde geri alınabilir.',
  },
  'cmdCatalog.risk.calistir': { en: 'Execute', tr: 'Çalıştır' },
  'cmdCatalog.risk.calistir.desc': {
    en: 'Executes or spawns a process/action — starts something, often not reversible by re-running it.',
    tr: 'Bir süreç/eylem çalıştırır veya başlatır — bir şey başlatır, yeniden çalıştırarak geri alınamayabilir.',
  },
  'cmdCatalog.risk.otonom': { en: 'Autonomous', tr: 'Otonom' },
  'cmdCatalog.risk.otonom.desc': {
    en: 'Opens a continuous, human-out-of-the-loop decision/work loop.',
    tr: 'Sürekli, insan-döngü-dışı bir karar/iş döngüsü açar.',
  },

  // ─── desktop shell (DESK-1, born-496) ─────────────────────────────────
  // Consumed via src/desktop/src/main/i18n.ts's t()/getDesktopStrings() —
  // never call getMessage directly from desktop main-process modules.
  'desktop.tray.open': { en: 'Open Deckent', tr: "Deckent'i Aç" },
  'desktop.tray.quit': { en: 'Quit', tr: 'Çıkış' },
  'desktop.tray.tooltip': { en: 'Deckent Desktop', tr: 'Deckent Masaüstü' },
  'desktop.connection.add_title': { en: 'Add Connection', tr: 'Bağlantı Ekle' },
  'desktop.connection.kind.local': { en: 'Local', tr: 'Yerel' },
  'desktop.connection.kind.wsl': { en: 'WSL', tr: 'WSL' },
  'desktop.connection.kind.ssh': { en: 'SSH', tr: 'SSH' },
  'desktop.connection.kind.container': { en: 'Container', tr: 'Konteyner' },
  'desktop.connection.kind_not_yet_supported': {
    en: '{kind} connections are not yet available.',
    tr: '{kind} bağlantıları henüz kullanılamıyor.',
  },
  'desktop.connection.connect_button': { en: 'Connect', tr: 'Bağlan' },
  'desktop.connection.delete_confirm': {
    en: 'Delete connection "{label}"?',
    tr: '"{label}" bağlantısını sil?',
  },
  'desktop.connecting.spawning': {
    en: 'Starting deckent daemon…',
    tr: 'deckent daemon başlatılıyor…',
  },
  'desktop.connecting.adopting': {
    en: 'Connecting to running daemon…',
    tr: 'Çalışan daemon\'a bağlanılıyor…',
  },
  'desktop.connecting.health_check': {
    en: 'Checking daemon health…',
    tr: 'Daemon sağlığı kontrol ediliyor…',
  },
  'desktop.connecting.retry': {
    en: 'Retrying connection…',
    tr: 'Bağlantı yeniden deneniyor…',
  },
  'desktop.error.node_not_found': {
    en: 'Node.js was not found on the target. Install Node.js {floor} to run deckent.',
    tr: "Hedefte Node.js bulunamadı. deckent'i çalıştırmak için Node.js {floor} yükleyin.",
  },
  'desktop.error.deckent_not_found': {
    en: 'deckent was not found on the target. Install it with `npm install -g deckent`.',
    tr: "Hedefte deckent bulunamadı. `npm install -g deckent` ile yükleyin.",
  },
  'desktop.error.port_conflict': {
    en: 'Port {port} is already in use on the target.',
    tr: '{port} portu hedefte zaten kullanımda.',
  },
  'desktop.error.daemon_crashed': {
    en: 'The deckent daemon crashed unexpectedly.',
    tr: 'deckent daemon beklenmedik şekilde çöktü.',
  },
  'desktop.error.health_timeout': {
    en: 'The daemon did not become healthy in time.',
    tr: 'Daemon zamanında sağlıklı hale gelmedi.',
  },
  'desktop.error.view_logs': { en: 'View Logs', tr: 'Günlükleri Görüntüle' },
  'desktop.window.minimize_to_tray_hint': {
    en: 'Deckent keeps running in the tray. Right-click the tray icon to reopen or quit.',
    tr: "Deckent, sistem tepsisinde çalışmaya devam eder. Yeniden açmak veya çıkmak için tepsi simgesine sağ tıklayın.",
  },
  'desktop.update.available': {
    en: 'A new version is available.',
    tr: 'Yeni bir sürüm mevcut.',
  },
  'desktop.update.downloading': { en: 'Downloading update…', tr: 'Güncelleme indiriliyor…' },
  'desktop.update.restart_to_apply': {
    en: 'Restart Deckent to apply the update.',
    tr: "Güncellemeyi uygulamak için Deckent'i yeniden başlatın.",
  },
  'desktop.update.check_for_updates': {
    en: 'Check for Updates',
    tr: 'Güncellemeleri Denetle',
  },
  'desktop.menu.help': { en: 'Help', tr: 'Yardım' },
  // D4-2 — former renderer-local supplementary copy, promoted to this SSOT
  // (src/desktop/src/shared/desktop-messages.ts lists the served keys).
  'desktop.app.browser_fallback_notice': {
    en: 'Desktop bridge unavailable — running in browser preview mode.',
    tr: 'Masaüstü köprüsü kullanılamıyor — tarayıcı önizleme kipinde çalışıyor.',
  },
  'desktop.connection.list_title': { en: 'Connections', tr: 'Bağlantılar' },
  'desktop.connection.list_loading': { en: 'Loading…', tr: 'Yükleniyor…' },
  'desktop.connection.empty_state': {
    en: 'No saved connections yet. Add one below to get started.',
    tr: 'Kayıtlı bağlantı yok. Başlamak için aşağıdan bir tane ekleyin.',
  },
  'desktop.connection.list_error': {
    en: 'Could not load saved connections.',
    tr: 'Kayıtlı bağlantılar yüklenemedi.',
  },
  'desktop.connection.field_label': { en: 'Name', tr: 'Ad' },
  'desktop.connection.field_kind': { en: 'Kind', tr: 'Tür' },
  'desktop.connection.field_project_path': { en: 'Project path', tr: 'Proje yolu' },
  'desktop.connection.field_host': { en: 'Host', tr: 'Sunucu' },
  'desktop.connection.field_port': { en: 'Port', tr: 'Port' },
  'desktop.connection.field_auto_start': {
    en: "Start the daemon automatically if it isn't running",
    tr: 'Daemon çalışmıyorsa otomatik başlat',
  },
  'desktop.connection.field_orphan_shutdown': {
    en: 'Stop this daemon on quit (only if this app started it)',
    tr: "Çıkışta bu daemon'u durdur (yalnız bu uygulama başlattıysa)",
  },
  'desktop.connection.submit_button': { en: 'Save connection', tr: 'Bağlantıyı kaydet' },
  'desktop.connection.delete_button': { en: 'Delete', tr: 'Sil' },
  'desktop.connection.validation_required': {
    en: 'This field is required.',
    tr: 'Bu alan zorunludur.',
  },
  'desktop.connection.validation_port': {
    en: 'Enter a port between 1 and 65535.',
    tr: '1 ile 65535 arasında bir port girin.',
  },
  'desktop.connection.add_error': {
    en: 'Could not save this connection.',
    tr: 'Bağlantı kaydedilemedi.',
  },
  'desktop.connection.remove_error': {
    en: 'Could not delete this connection.',
    tr: 'Bağlantı silinemedi.',
  },
  'desktop.connecting.title': { en: 'Connecting', tr: 'Bağlanılıyor' },
  'desktop.connecting.idle': { en: 'Preparing…', tr: 'Hazırlanıyor…' },
  'desktop.connecting.connected': {
    en: 'Connected — loading dashboard…',
    tr: 'Bağlandı — panel yükleniyor…',
  },
  'desktop.error.title': { en: 'Connection failed', tr: 'Bağlantı başarısız' },
  'desktop.error.unknown': {
    en: 'Something went wrong while connecting.',
    tr: 'Bağlanırken bir sorun oluştu.',
  },
  'desktop.error.back_button': { en: 'Back to connections', tr: 'Bağlantılara dön' },
  // D4-2 — daemon-lifecycle errorKey'leri (öksüzdüler: renderer ham-anahtar basıyordu).
  'desktop.daemon.spawn_failed': {
    en: 'Could not start the daemon: {message}',
    tr: 'Daemon başlatılamadı: {message}',
  },
  'desktop.daemon.health_timeout': {
    en: 'The daemon did not respond in time.',
    tr: 'Daemon zamanında yanıt vermedi.',
  },
  // D4-3 — post-connect app shell (Console/Chat/Approval/History).
  'desktop.shell.nav.console': { en: 'Bridge', tr: 'Köprü' },
  'desktop.shell.nav.chat': { en: 'Chat', tr: 'Sohbet' },
  'desktop.shell.nav.approval': { en: 'Approvals', tr: 'Onaylar' },
  'desktop.shell.nav.history': { en: 'Runs', tr: 'Koşular' },
  'desktop.shell.connected_to': { en: 'Connected: {origin}', tr: 'Bağlı: {origin}' },
  'desktop.shell.flows_empty': {
    en: 'No flows yet — start one with `deckent do "<goal>"`.',
    tr: 'Henüz akış yok — `deckent do "<hedef>"` ile başlatın.',
  },
  'desktop.shell.flag_run_flow_off': {
    en: 'This daemon has terminal.run_flow_v2 disabled — the Console needs it enabled.',
    tr: 'Bu daemonda terminal.run_flow_v2 kapalı — Konsol için açık olması gerekir.',
  },
  'desktop.shell.live_events': { en: 'Live events', tr: 'Canlı olaylar' },
  'desktop.shell.approvals_pending': {
    en: '{count} pending approval(s)',
    tr: '{count} bekleyen onay',
  },
  'desktop.shell.chat_coming': {
    en: 'Chat arrives with the real-workflow slice (SURF-5).',
    tr: 'Sohbet, gerçek-iş-akışı dilimiyle (SURF-5) geliyor.',
  },
  'desktop.shell.load_error': {
    en: 'Could not reach the daemon. Check the connection and retry.',
    tr: 'Daemona ulaşılamadı. Bağlantıyı kontrol edip yeniden deneyin.',
  },
  // D4-4 — «Köprüüstü» four-shell design.
  'desktop.shell.console.course': { en: 'Course', tr: 'Rota' },
  'desktop.shell.console.log': { en: "Ship's log", tr: 'Seyir defteri' },
  'desktop.shell.approval.title': { en: 'Pending orders', tr: 'Bekleyen emirler' },
  'desktop.shell.approval.empty': { en: 'No pending orders.', tr: 'Bekleyen emir yok.' },
  'desktop.shell.history.title': { en: 'Voyage ledger', tr: 'Sefer kayıtları' },
  'desktop.shell.chat.eyebrow': { en: 'Watch radio', tr: 'Vardiya telsizi' },
  // DT-1 «Telsiz» (583 tasarım-turu) — the Desktop's real chat.
  'desktop.shell.radio.empty_hint': {
    en: 'The watch radio is open — ask deckent anything about this project.',
    tr: 'Vardiya telsizi açık — deckent\'e bu projeyle ilgili her şeyi sorabilirsiniz.',
  },
  'desktop.shell.radio.placeholder': { en: 'Transmit a message…', tr: 'Mesaj geçin…' },
  'desktop.shell.radio.send': { en: 'Transmit', tr: 'Gönder' },
  'desktop.shell.radio.role_operator': { en: 'bridge', tr: 'köprü' },
  'desktop.shell.radio.role_deckent': { en: 'deckent', tr: 'deckent' },
  'desktop.shell.radio.gate_off': {
    en: 'Remote chat is disabled on this daemon (api.control_mutations) — Desktop-spawned daemons enable it automatically; for an adopted daemon, enable the flag on its side.',
    tr: 'Bu daemonda uzaktan sohbet kapalı (api.control_mutations) — Desktop\'ın başlattığı daemonlarda otomatik açıktır; devralınan daemon için bayrağı daemon tarafında açın.',
  },
  'desktop.shell.radio.failed': {
    en: 'transmission failed: {message}',
    tr: 'iletim başarısız: {message}',
  },
  // SURF-5 — real-workflow organs: «Emir» (propose) + preview + «Telgraf».
  'desktop.shell.console.order_placeholder': {
    en: 'State the goal — a new course order for the crew…',
    tr: 'Hedefi yazın — mürettebata yeni bir rota emri…',
  },
  'desktop.shell.console.order_submit': { en: 'Issue order', tr: 'Emri ver' },
  'desktop.shell.order_failed': {
    en: 'The order could not be planned. Check the daemon log and retry.',
    tr: 'Emir planlanamadı. Daemon günlüğünü kontrol edip yeniden deneyin.',
  },
  'desktop.shell.preview.title': { en: 'Planned course', tr: 'Planlanan rota' },
  'desktop.shell.preview.meta': {
    en: 'Gate: {gate} · Policy: {policy} · Digest: {digest}',
    tr: 'Kapı: {gate} · Politika: {policy} · Özet: {digest}',
  },
  // SURF-6 kuyruk-D — gate-fail visibility: the blocking findings surface in
  // the preview instead of hiding behind a bare 'Gate: fail' summary line.
  'desktop.shell.preview.gate_findings': {
    en: 'Gate blockers ({n}):',
    tr: 'Kapı blockerları ({n}):',
  },
  // 583/N1 — the run's line-level footprint in the Console (GAP-4 closes).
  'desktop.shell.diff.title': { en: 'Changes ({n} files)', tr: 'Değişiklikler ({n} dosya)' },
  'desktop.shell.diff.empty': { en: 'No changes in this run\'s footprint.', tr: 'Bu koşunun ayak izinde değişiklik yok.' },
  'desktop.shell.diff.no_base': {
    en: 'No recorded start commit — showing the working tree vs HEAD.',
    tr: 'Kayıtlı başlangıç-commit\'i yok — çalışma ağacı HEAD\'e karşı gösteriliyor.',
  },
  'desktop.shell.diff.not_git': { en: 'Not a git repository — no diff available.', tr: 'Git deposu değil — diff üretilemiyor.' },
  'desktop.shell.diff.truncated': { en: '… truncated (size cap).', tr: '… kırpıldı (boyut sınırı).' },
  'desktop.shell.telegraph.title': { en: 'Engine telegraph', tr: 'Makine telgrafı' },
  'desktop.shell.telegraph.stop': { en: 'STOP', tr: 'DUR' },
  'desktop.shell.telegraph.slow': { en: 'SLOW AHEAD', tr: 'AĞIR YOL' },
  'desktop.shell.telegraph.full': { en: 'FULL AHEAD', tr: 'TAM YOL' },
  'desktop.shell.console.cancel': { en: 'Abort voyage', tr: 'Seferi iptal et' },
  'desktop.shell.approval.allow': { en: 'Allow', tr: 'İzin ver' },
  'desktop.shell.approval.deny': { en: 'Deny', tr: 'Reddet' },
  'desktop.shell.approval.decide_off': {
    en: 'Remote decisions are disabled on this daemon (approval.api_decide) — decide from the terminal.',
    tr: 'Bu daemonda uzaktan karar kapalı (approval.api_decide) — kararı terminalden verin.',
  },
  // 583/N3 «Makine Dairesi» — the Desktop PTY panel (ADR-G-029 secondary surface).
  'desktop.shell.nav.terminal': { en: 'Engine Room', tr: 'Makine Dairesi' },
  // KABUL Gün-1 A1/A4 — sol-ray grupları + «Changes» görünümü.
  'desktop.shell.nav.group_voyage': { en: 'Voyage', tr: 'Seyir' },
  'desktop.shell.nav.group_work': { en: 'Work', tr: 'Çalışma' },
  'desktop.shell.nav.changes': { en: 'Changes', tr: 'Değişiklikler' },
  'desktop.shell.changes.commit': { en: 'Commit', tr: 'Commit' },
  'desktop.shell.changes.gate_off': {
    en: 'Remote commit is disabled on this daemon (api.control_mutations) — Desktop-spawned daemons enable it automatically; use `deckent runs <n> --commit` in the terminal otherwise.',
    tr: 'Bu daemonda uzaktan commit kapalı (api.control_mutations) — Desktop\'ın başlattığı daemonlarda otomatik açıktır; aksi hâlde terminalden `deckent runs <n> --commit` kullanın.',
  },
  // 588/F1 «Köprü» — operasyon-merkezi + Worker-Penceresi kelimeleri.
  'desktop.shell.bridge.phase_label': { en: 'Phase', tr: 'Faz' },
  'desktop.shell.bridge.workers_title': { en: 'Workers', tr: 'Worker\'lar' },
  'desktop.shell.bridge.files_title': { en: 'Files in motion', tr: 'Hareketteki dosyalar' },
  'desktop.shell.bridge.no_sprint': {
    en: 'No live run — issue an order below to set sail.',
    tr: 'Canlı run yok — yelken açmak için aşağıdan emir verin.',
  },
  'desktop.shell.bridge.hb_age': { en: '{n}s', tr: '{n}sn' },
  'desktop.shell.worker.back': { en: '← Bridge', tr: '← Köprü' },
  'desktop.shell.worker.tab_live': { en: 'Live', tr: 'Canlı' },
  'desktop.shell.worker.tab_task': { en: 'Task', tr: 'Görev' },
  'desktop.shell.worker.tab_plan': { en: 'Plan', tr: 'Plan' },
  'desktop.shell.worker.tab_result': { en: 'Result', tr: 'Sonuç' },
  'desktop.shell.worker.log_unavailable': {
    en: 'No log yet — the worker has not written its first line.',
    tr: 'Henüz log yok — worker ilk satırını yazmadı.',
  },
  'desktop.shell.worker.go_criteria': { en: 'GO criteria', tr: 'GO ölçütleri' },
  'desktop.shell.worker.scope': { en: 'Write scope', tr: 'Yazma-kapsamı' },
  'desktop.shell.worker.no_plan': { en: 'No .plan written yet.', tr: 'Henüz .plan yazılmadı.' },
  'desktop.shell.worker.no_result': { en: 'No result yet.', tr: 'Henüz sonuç yok.' },
  'desktop.shell.worker.assessment': { en: 'Self-assessment', tr: 'Öz-değerlendirme' },
  'desktop.shell.bridge.past_flows': { en: 'Past voyages ({n})', tr: 'Geçmiş seferler ({n})' },
  'desktop.shell.bridge.past_flows_more': { en: '… {n} more in Runs.', tr: '… {n} tanesi daha Koşular\'da.' },
  'desktop.shell.worker.stream_on': { en: 'stream live · {n} line(s)', tr: 'akış canlı · {n} satır' },
  'desktop.shell.worker.stream_down': {
    en: 'stream disconnected — retrying…',
    tr: 'akış koptu — yeniden deneniyor…',
  },
  'desktop.shell.worker.files_changed': { en: 'Files changed ({n})', tr: 'Değişen dosyalar ({n})' },
  'desktop.shell.worker.notes': { en: 'Notes', tr: 'Notlar' },
  'desktop.shell.worker.raw': { en: 'raw', tr: 'ham' },
  'desktop.shell.worker.not_found': { en: 'Task not found (it may be archived).', tr: 'Görev bulunamadı (arşivlenmiş olabilir).' },
  // KABUL Gün-1 A2 — Runs detay-sayfası kelimeleri.
  'desktop.shell.runs.goal': { en: 'Goal', tr: 'Hedef' },
  'desktop.shell.runs.gate': { en: 'Plan gate', tr: 'Plan kapısı' },
  'desktop.shell.runs.tasks': { en: '{done}/{total} tasks', tr: '{done}/{total} görev' },
  'desktop.shell.runs.revision': { en: 'Revision {r}', tr: 'Revizyon {r}' },
  'desktop.shell.term.title': { en: 'Engine room', tr: 'Makine dairesi' },
  'desktop.shell.term.new_session': { en: 'New session:', tr: 'Yeni oturum:' },
  'desktop.shell.term.kind_shell': { en: 'Shell', tr: 'Shell' },
  'desktop.shell.term.kind_deckent': { en: 'deckent', tr: 'deckent' },
  'desktop.shell.term.kind_claude': { en: 'Claude', tr: 'Claude' },
  'desktop.shell.term.kind_gemini': { en: 'Gemini', tr: 'Gemini' },
  'desktop.shell.term.kind_codex': { en: 'Codex', tr: 'Codex' },
  'desktop.shell.term.close_session': { en: 'Close session', tr: 'Oturumu kapat' },
  'desktop.shell.term.connecting': { en: 'Connecting…', tr: 'Bağlanıyor…' },
  'desktop.shell.term.reconnecting': {
    en: 'Connection lost — reconnecting…',
    tr: 'Bağlantı koptu — yeniden bağlanılıyor…',
  },
  'desktop.shell.term.disabled': {
    en: 'This daemon\'s terminal surface is off (non-local bind or --no-terminal) — start the daemon locally to open the engine room.',
    tr: 'Bu daemonun terminal yüzeyi kapalı (yerel-dışı bind veya --no-terminal) — makine dairesini açmak için daemonu yerelde başlatın.',
  },
  'desktop.shell.term.shell_kind_off': {
    en: 'Plain shell sessions are disabled by config (terminal.allowShellKind) — deckent/AI sessions stay available.',
    tr: 'Düz shell oturumları config ile kapalı (terminal.allowShellKind) — deckent/AI oturumları açık.',
  },
  'desktop.shell.term.sessions_empty': {
    en: 'No live sessions — open one below deck.',
    tr: 'Canlı oturum yok — güverte altında bir tane açın.',
  },
  'desktop.shell.term.exited': { en: 'exited ({code})', tr: 'kapandı ({code})' },
  // D4-1 «Köprüüstü» — watch (vardiya) theme system.
  'desktop.theme.title': { en: 'Watch', tr: 'Vardiya' },
  'desktop.theme.watch.nova': { en: 'Nova', tr: 'Nova' },
  // 589/R1 — NOVA-kabuğu + Komuta-sahnesi (Jarvis-nötr yeni-kök).
  'desktop.nova.nav.command': { en: 'Command', tr: 'Komuta' },
  'desktop.nova.nav.terminal': { en: 'Terminal', tr: 'Terminal' },
  'desktop.nova.nav.classic': { en: 'Classic view', tr: 'Klasik görünüm' },
  'desktop.nova.palette.placeholder': { en: 'search scenes & actions…', tr: 'sahne ve eylem ara…' },
  'desktop.nova.scene.idle': { en: 'system ready — awaiting orders', tr: 'sistem hazır — emir bekleniyor' },
  'desktop.nova.scene.connecting': { en: 'linking…', tr: 'bağlanıyor…' },
  'desktop.nova.scene.offline': { en: 'daemon unreachable', tr: 'daemon erişilemez' },
  'desktop.nova.scene.ready': { en: 'READY', tr: 'HAZIR' },
  'desktop.nova.river.you': { en: 'you', tr: 'sen' },
  'desktop.nova.river.deckent': { en: 'deckent', tr: 'deckent' },
  'desktop.nova.cmd.placeholder': { en: 'tell deckent — ask, order, decide…', tr: 'deckent\'e söyle — soru, emir, karar…' },
  'desktop.nova.cmd.hint': { en: 'enter = talk · ctrl+enter = ORDER (start work) · ⌘K palette', tr: 'enter = konuş · ctrl+enter = EMİR (iş başlat) · ⌘K palet' },
  'desktop.nova.order.sent': { en: 'order received — drafting the plan…', tr: 'emir alındı — plan hazırlanıyor…' },
  'desktop.nova.order.previewing': { en: 'previewing the plan…', tr: 'plan önizleniyor…' },
  'desktop.nova.order.preview_title': { en: 'Order preview', tr: 'Emir önizlemesi' },
  'desktop.nova.order.gate_fail': { en: 'plan gate: FAIL — starting will be refused unless overridden', tr: 'plan kapısı: FAIL — override edilmedikçe start reddedilir' },
  'desktop.nova.order.full_ahead': { en: 'FULL AHEAD', tr: 'TAM YOL' },
  'desktop.nova.order.dismiss': { en: 'dismiss', tr: 'vazgeç' },
  'desktop.nova.order.started': { en: 'run started — the core is waking.', tr: 'koşu başladı — çekirdek uyanıyor.' },
  'desktop.nova.order.failed': { en: 'order failed', tr: 'emir başarısız' },
  'desktop.nova.river.tool': { en: 'tool', tr: 'araç' },
  'desktop.nova.focus.empty': { en: 'no narrative yet — the worker is thinking…', tr: 'henüz anlatı yok — worker düşünüyor…' },

  // ─── Versioned `.deckent/workspace` artifact contract ────────────────
  'workspace.identity.template': {
    en: '# Project Identity\nName: {projectName}\nLanguage: {language}\nLanguage Authority: detected\nFramework: {framework}\nTest: {testFramework}\nBuild: {buildTool}\nRuntime: {runtime}\nPlatform: runtime-resolved (macOS · Linux · Windows native · WSL)',
    tr: '# Proje Kimliği\nName: {projectName}\nLanguage: {language}\nLanguage Authority: detected\nFramework: {framework}\nTest: {testFramework}\nBuild: {buildTool}\nRuntime: {runtime}\nPlatform: runtime-resolved (macOS · Linux · Windows native · WSL)',
  },
  'workspace.title.environment_tools': { en: 'Environment Tools', tr: 'Ortam Araçları' },
  'workspace.title.boot': { en: 'Boot', tr: 'Başlatma' },
  'workspace.title.worker_guide': { en: 'Worker Guide', tr: 'Worker Rehberi' },
  'workspace.stats.comment': {
    en: 'Tracked volatile-stat snapshot. Refresh explicitly with docs:stats:refresh; init never derives local runtime values.',
    tr: 'Takip edilen volatile-stat snapshot. docs:stats:refresh ile açıkça yenile; init local runtime değerleri türetmez.',
  },
  'workspace.tools.package_intro': {
    en: 'Commands declared by this project package:',
    tr: 'Bu projenin package manifestinde tanımlanan komutlar:',
  },
  'workspace.tools.no_package': {
    en: 'No package.json scripts were detected. Add project-native build, test and lint commands here.',
    tr: 'package.json scripti algılanmadı. Projeye özgü build, test ve lint komutlarını buraya ekleyin.',
  },
  'workspace.tools.mcp_intro': {
    en: 'This table is generated from the canonical MCP TOOL_CATALOG; filenames are never interpreted as tools.',
    tr: 'Bu tablo canonical MCP TOOL_CATALOG üzerinden üretilir; dosya adları asla tool olarak yorumlanmaz.',
  },
  'workspace.tools.cli_intro': {
    en: 'This table is generated from the registered cross-surface command tree; helper module filenames are excluded.',
    tr: 'Bu tablo kayıtlı cross-surface command tree üzerinden üretilir; helper module dosya adları dışlanır.',
  },
  'workspace.tools.header.script': { en: 'Script', tr: 'Script' },
  'workspace.tools.header.command': { en: 'Command', tr: 'Komut' },
  'workspace.tools.header.mcp_name': { en: 'MCP Name', tr: 'MCP Adı' },
  'workspace.tools.header.effect': { en: 'Effect', tr: 'Etki' },
  'workspace.tools.header.approval': { en: 'Approval', tr: 'Onay' },
  'workspace.tools.header.idempotent': { en: 'Idempotent', tr: 'Idempotent' },
  'workspace.tools.header.category': { en: 'Category', tr: 'Kategori' },
  'workspace.tools.header.risk': { en: 'Risk', tr: 'Risk' },
  'workspace.tools.header.surfaces': { en: 'Surfaces', tr: 'Yüzeyler' },
  'workspace.tools.total': { en: 'Total: {count}', tr: 'Toplam: {count}' },
  'workspace.tools.effect.read_only': { en: 'read-only', tr: 'salt-okunur' },
  'workspace.tools.effect.mutating': { en: 'mutating', tr: 'değiştirici' },
  'workspace.tools.effect.destructive': { en: 'destructive', tr: 'yıkıcı' },
  'workspace.tools.approval.not_required': { en: 'not required by effect class', tr: 'effect class gereği zorunlu değil' },
  'workspace.tools.approval.required': { en: 'required by runtime policy', tr: 'runtime policy gereği zorunlu' },
  'workspace.common.yes': { en: 'yes', tr: 'evet' },
  'workspace.common.no': { en: 'no', tr: 'hayır' },
  'workspace.common.not_detected': { en: '(not detected)', tr: '(algılanmadı)' },
  'workspace.boot.sequence': {
    en: '1. **Load authority** — Brain reads `DIRECTIVES.md`, effective config and `.brain/memory.db`; generated projections never create policy.\n2. **Plan and admit** — the exact DAG, provider/model/auth/budget/reachability and write scope are resolved before dispatch.\n3. **Spawn** — the configured platform adapter launches only admitted workers.\n4. **Execute** — workers publish host-observed heartbeat, activity and result-ingress artifacts.\n5. **Evaluate** — Brain reconciles disk truth, tests, scope, cost and policy evidence into GO, FIX or typed HOLD/NO_GO.\n6. **Fix** — eligible failures enter the bounded FIX DAG; `processQueue` never fabricates dependency completion.\n7. **Finalize and archive** — terminal settlement, Retrospective, memory, trace and projections are published before canonical retention runs.',
    tr: '1. **Authority yükle** — Brain `DIRECTIVES.md`, effective config ve `.brain/memory.db` kaynaklarını okur; generated projectionlar policy üretmez.\n2. **Planla ve admit et** — exact DAG, provider/model/auth/budget/reachability ve write scope dispatch öncesi çözülür.\n3. **Spawn** — yapılandırılmış platform adapterı yalnız admitted workerları başlatır.\n4. **Execute** — workerlar host-observed heartbeat, activity ve result-ingress artefaktlarını yayımlar.\n5. **Evaluate** — Brain disk truth, test, scope, cost ve policy kanıtını GO, FIX veya typed HOLD/NO_GO kararına uzlaştırır.\n6. **Fix** — uygun hatalar bounded FIX DAG’a girer; `processQueue` dependency completion uydurmaz.\n7. **Finalize ve archive** — canonical retention çalışmadan önce terminal settlement, Retrospective, memory, trace ve projectionlar yayımlanır.',
  },
  'workspace.boot.recovery': {
    en: 'Recovery is diagnostics-first and fail-closed. Never start with kill or cleanup.\n\n```bash\n# 1. Inspect without mutation\ndeckent status --json\ndeckent doctor\n\n# 2. Preview the canonical recovery operation\ndeckent recover <sprint-id> --dry-run\n\n# 3. Resume only a canonically PAUSED/ORPHANED run\ndeckent recover <sprint-id> --resume\n\n# 4. Execute mutating recovery only after exact owner approval\ndeckent recover <sprint-id>\n\n# 5. Run a new one-shot description; this is not a historical task-id replay\ndeckent run "<description>"\n```\n\nMCP parity: `deckent_status {}` then `deckent_recover { sprintId, dryRun: true }`. A mutating MCP recovery additionally requires an exact identity/generation/fence-bound `approval`. `deckent_run` accepts `{ description }`, never `{ taskId }`. `kill` and `cleanup` are separate destructive operations and require their own live owner decision.',
    tr: 'Recovery diagnostics-first ve fail-closed çalışır. Asla kill veya cleanup ile başlama.\n\n```bash\n# 1. Mutation yapmadan incele\ndeckent status --json\ndeckent doctor\n\n# 2. Canonical recovery operationı önizle\ndeckent recover <sprint-id> --dry-run\n\n# 3. Yalnız canonical PAUSED/ORPHANED runı sürdür\ndeckent recover <sprint-id> --resume\n\n# 4. Mutating recoveryyi ancak exact owner onayı sonrası çalıştır\ndeckent recover <sprint-id>\n\n# 5. Yeni bir one-shot açıklama çalıştır; bu historical task-id replay değildir\ndeckent run "<description>"\n```\n\nMCP paritesi: önce `deckent_status {}`, sonra `deckent_recover { sprintId, dryRun: true }`. Mutating MCP recovery ayrıca exact identity/generation/fence-bound `approval` ister. `deckent_run` `{ description }` kabul eder; `{ taskId }` kabul etmez. `kill` ve `cleanup` ayrı destructive operationlardır ve kendi canlı owner kararlarını gerektirir.',
  },
  'workspace.worker.contract': {
    en: 'This contract is generated from worker runtime schemas and prompt policy. It is supporting context; the compiled, digest-bound task prompt remains the attempt authority.\n\n### Result ingress vs canonical result\n\nWorkers write `.tasks/task-{id}.result` ingress claims: `taskId`, `workerId`, `filesChanged` (string array), `linesAdded`, `linesRemoved`, `testsPassed` (boolean), `coverage` (0–100), `selfAssessment` and `notes` (single string). Do not estimate token usage. Provider/model, token/cost, disk diff, tests and TypeScript evidence are host-authored in the canonical schema `{schemaVersion}` result.\n\nCanonical schema-required fields (derived at runtime): `{requiredFields}`.\n\n### Heartbeat\n\nCreate `.tasks/task-{id}.hb` before work. Increment `sequence`; use a fresh UTC ISO timestamp; keep `currentAction` concise. Heartbeat content is activity context—not standalone process-liveness or terminal authority.\n\n### Objective Definition of Done\n\n- DONE — {done}\n- GO_WITH_TECH_DEBT — {techDebt}\n- NO_GO — {noGo}\n\nThere is no percentage threshold. Evidence for each criterion decides the verdict.\n\n### Verification and honest-result gate\n\nThe `.verify-ran` marker is verifier-authored evidence; never create or claim it manually. Before DONE, compare baseline, end state and the actual criterion evidence. If a dependency has not settled, do not busy-wait or infer success from `processQueue`; report the exact NO_GO/HOLD condition.\n\n### Scope, ADR-037 authority and forbidden anti-patterns\n\n`scope.filesWrite` is the exact write allow-list; protocol artifacts under `.tasks/` are the only lifecycle exception. Do not mutate dependencies or run project-wide build from a worker. If a required capability or authority is unavailable, write a concrete NO_GO/HOLD reason instead of fabricating completion.\n\n| Anti-pattern | Status | Reason |\n|---|---|---|\n| `it.skip(...)` without a justification | forbidden | hides failed evidence |\n| `stub()` or a hardcoded empty implementation | forbidden | creates a false GO |\n| writing outside `scope.filesWrite` | forbidden | violates ADR-037 authority |\n| claiming DONE without verifier evidence | forbidden | violates the honest-result gate |',
    tr: 'Bu contract worker runtime schemaları ve prompt policy üzerinden üretilir. Supporting contexttir; compiled ve digest-bound task prompt attempt authority olarak kalır.\n\n### Result ingress ve canonical result\n\nWorker `.tasks/task-{id}.result` ingress claimlerini yazar: `taskId`, `workerId`, `filesChanged` (string array), `linesAdded`, `linesRemoved`, `testsPassed` (boolean), `coverage` (0–100), `selfAssessment` ve `notes` (tek string). Token usage tahmini yapma. Provider/model, token/cost, disk diff, test ve TypeScript kanıtı canonical schema `{schemaVersion}` sonucunda host tarafından yazılır.\n\nCanonical schema-required alanlar (runtime’da türetilir): `{requiredFields}`.\n\n### Heartbeat\n\nİşe başlamadan `.tasks/task-{id}.hb` oluştur. `sequence` değerini artır; taze UTC ISO timestamp kullan; `currentAction` kısa olsun. Heartbeat içeriği activity contexttir—tek başına process-liveness veya terminal authority değildir.\n\n### Objective Definition of Done\n\n- DONE — {done}\n- GO_WITH_TECH_DEBT — {techDebt}\n- NO_GO — {noGo}\n\nPercentage threshold yoktur. Verdicti her kriterin kanıtı belirler.\n\n### Verification ve honest-result gate\n\n`.verify-ran` marker verifier-authored kanıttır; elle oluşturma veya varmış gibi claim etme. DONE öncesi baseline, end state ve gerçek kriter kanıtını karşılaştır. Bir dependency settle olmadıysa busy-wait yapma veya `processQueue` üzerinden başarı varsayma; exact NO_GO/HOLD koşulunu bildir.\n\n### Scope, ADR-037 authority ve yasak anti-patternler\n\n`scope.filesWrite` exact write allow-listtir; `.tasks/` altındaki protocol artefaktları tek lifecycle istisnasıdır. Worker içinden dependency mutation veya project-wide build çalıştırma. Gerekli capability veya authority unavailable ise completion uydurmak yerine concrete NO_GO/HOLD nedeni yaz.\n\n| Anti-pattern | Durum | Neden |\n|---|---|---|\n| Gerekçesiz `it.skip(...)` | yasak | başarısız kanıtı gizler |\n| `stub()` veya hardcoded boş implementation | yasak | false GO üretir |\n| `scope.filesWrite` dışına yazma | yasak | ADR-037 authority ihlalidir |\n| verifier kanıtı olmadan DONE claim etme | yasak | honest-result gate ihlalidir |',
  },
  'workspace.worker.dod.done': {
    en: 'Every Definition-of-Done item is verified with evidence.',
    tr: 'Her Definition-of-Done maddesi kanıtla doğrulandı.',
  },
  'workspace.worker.dod.tech_debt': {
    en: 'Core items are verified; each minor open item is named explicitly.',
    tr: 'Core maddeler doğrulandı; her minor açık madde exact olarak adlandırıldı.',
  },
  'workspace.worker.dod.no_go': {
    en: 'At least one critical item is unverified; the exact blocker is named.',
    tr: 'En az bir critical madde doğrulanmadı; exact blocker adlandırıldı.',
  },

  'desktop.theme.watch.day-watch': { en: 'Day watch', tr: 'Gündüz seyri' },
  'desktop.theme.watch.night-watch': { en: 'Night watch', tr: 'Gece seyri' },
  'desktop.theme.watch.open-sea': { en: 'Open sea', tr: 'Açık deniz' },

  // ─── CLI command descriptions (559-002: commander .description() single source) ───
  'sprint.notify_started_title': {
    en: 'Sprint {sprintId} started',
    tr: 'Sprint {sprintId} başladı',
  },
  'sprint.notify_started_summary': {
    en: 'Sprint {sprintId} spawned successfully with {tasks} task(s); execution is underway.',
    tr: 'Sprint {sprintId} {tasks} görevle başarıyla başlatıldı; yürütme sürüyor.',
  },
  'sprint.notify_fix_started_title': {
    en: 'Sprint {sprintId} entered the FIX phase',
    tr: 'Sprint {sprintId} FIX fazına girdi',
  },
  'sprint.notify_fix_started_summary': {
    en: 'Evaluation found unresolved work in sprint {sprintId}; repair tasks are being dispatched.',
    tr: 'Değerlendirme sprint {sprintId} içinde çözülmemiş iş buldu; onarım görevleri gönderiliyor.',
  },
  'cli.gateway.listen.desc': {
    en: 'Run the gateway listener in the foreground (attaches every paired connector)',
    tr: 'Gateway dinleyicisini ön planda çalıştırın (eşleşmiş tüm connector\'lara bağlanır)',
  },
  'cli.gateway.start.desc': {
    en: 'Start the gateway daemon in the background',
    tr: 'Gateway daemon\'ını arka planda başlatın',
  },
  'cli.gateway.stop.desc': {
    en: 'Stop the running gateway daemon',
    tr: 'Çalışan gateway daemon\'ını durdurun',
  },
  'cli.gateway.status.desc': {
    en: 'Show whether the gateway daemon is running',
    tr: 'Gateway daemon\'ının çalışıp çalışmadığını gösterin',
  },
  'cli.gateway.pair.list.desc': {
    en: 'List pending pairing requests',
    tr: 'Bekleyen eşleşme isteklerini listeleyin',
  },
  'cli.gateway.pair.approve.desc': {
    en: 'Approve a pairing request and bind it to a project',
    tr: 'Bir eşleşme isteğini onaylayın ve bir projeye bağlayın',
  },
  'cli.gateway.pair.reject.desc': {
    en: 'Reject a pending pairing request',
    tr: 'Bekleyen bir eşleşme isteğini reddedin',
  },
  'cli.program.desc': {
    en: 'AI agent orchestration system — your AI development team, orchestrated.',
    tr: 'AI agent orkestrasyon sistemi — kendi AI geliştirme ekibiniz, orkestre edilmiş.',
  },
  'cli.agent.desc': {
    en: 'Manage agent pool',
    tr: 'Agent havuzunu yönetin',
  },
  'cli.agent.lint.desc': {
    en: 'Lint the agent catalog: reachability, coverage gaps, capability overlaps (V3)',
    tr: 'Agent kataloğunu denetleyin: erişilebilirlik, kapsam boşlukları, yetenek çakışmaları (V3)',
  },
  'cli.agent.list.desc': {
    en: 'List all agents in the pool',
    tr: 'Havuzdaki tüm agent\'ları listeleyin',
  },
  'cli.agent.stats.desc': {
    en: 'Show sprint-by-sprint performance for an agent',
    tr: 'Bir agent\'ın sprint bazında performansını gösterin',
  },
  'cli.agent.enable.desc': {
    en: 'Enable an agent',
    tr: 'Bir agent\'ı etkinleştirin',
  },
  'cli.agent.disable.desc': {
    en: 'Disable an agent',
    tr: 'Bir agent\'ı devre dışı bırakın',
  },
  'cli.agent.delete.desc': {
    en: 'Delete an agent from the pool',
    tr: 'Bir agent\'ı havuzdan silin',
  },
  'cli.agent.edit.desc': {
    en: 'Edit an agent configuration',
    tr: 'Bir agent yapılandırmasını düzenleyin',
  },
  'cli.agent.reclassify.desc': {
    en: 'Reclassify a recorded task outcome (delta-applies agent/skill stats)',
    tr: 'Kayıtlı bir görev sonucunu yeniden sınıflandırın (agent/skill istatistiklerine delta uygular)',
  },
  'cli.agent.info.desc': {
    en: 'Show detailed agent information',
    tr: 'Ayrıntılı agent bilgisini gösterin',
  },
  'cli.analyze.desc': {
    en: 'Analyze project stack, size, and recommended methodology',
    tr: 'Proje stack\'ini, boyutunu ve önerilen metodolojiyi analiz edin',
  },
  'cli.archive_debt.desc': {
    en: 'Report tech-debt status (DB-first; resolved debt is auto-managed in memory.db)',
    tr: 'Teknik borç durumunu raporlayın (DB-first; çözülen borç memory.db içinde otomatik yönetilir)',
  },
  'cmdCatalog.archive.summary': {
    en: 'Inspect, reconcile, and verify canonical sprint archives',
    tr: 'Canonical sprint arşivlerini inceleyin, uzlaştırın ve doğrulayın',
  },
  'archive.description': {
    en: 'Inspect, reconcile, and verify canonical sprint evidence archives',
    tr: 'Canonical sprint kanıt arşivlerini inceleyin, uzlaştırın ve doğrulayın',
  },
  'archive.inspect.description': {
    en: 'Build a read-only inventory without changing archive state',
    tr: 'Arşiv durumunu değiştirmeden salt-okunur envanter oluşturun',
  },
  'archive.reconcile.description': {
    en: 'Reconcile scattered evidence into canonical sprint archives (dry-run by default)',
    tr: 'Dağınık kanıtları canonical sprint arşivlerinde uzlaştırın (varsayılan dry-run)',
  },
  'archive.verify.description': {
    en: 'Verify manifest coverage and every archived artifact digest',
    tr: 'Manifest kapsamını ve arşivlenen her artifact digest’ini doğrulayın',
  },
  'archive.terminal.inspect.description': {
    en: 'Inspect canonical hot/archive journal parity without changing state',
    tr: 'Durumu değiştirmeden canonical hot/archive journal eşliğini inceleyin',
  },
  'archive.terminal.verify.description': {
    en: 'Verify terminal receipt, archive integrity, and Brain adoption without changing state',
    tr: 'Durumu değiştirmeden terminal receipt, arşiv bütünlüğü ve Brain adoption doğrulayın',
  },
  'archive.terminal.repair.description': {
    en: 'Repair one proven strict-prefix terminal journal with receipt-bound authority',
    tr: 'Kanıtlanmış tek strict-prefix terminal journal’ı receipt-bound authority ile onarın',
  },
  'archive.option.exact_sprint': { en: 'Select exactly one sprint ID', tr: 'Tam olarak bir sprint ID seçin' },
  'archive.option.hot_journal': { en: 'Use this exact hot journal path', tr: 'Bu tam hot journal yolunu kullanın' },
  'archive.option.receipt': { en: 'Use this exact terminal receipt identity', tr: 'Bu tam terminal receipt kimliğini kullanın' },
  'archive.option.final_sequence': { en: 'Require this final event sequence', tr: 'Bu final event sequence değerini zorunlu tutun' },
  'archive.option.final_digest': { en: 'Require this final event SHA-256', tr: 'Bu final event SHA-256 değerini zorunlu tutun' },
  'archive.option.expected_archive_digest': { en: 'Require this archived preimage SHA-256', tr: 'Bu arşivlenmiş preimage SHA-256 değerini zorunlu tutun' },
  'archive.option.expected_hot_digest': { en: 'Require this hot journal SHA-256', tr: 'Bu hot journal SHA-256 değerini zorunlu tutun' },
  'archive.option.reason': { en: 'Record the operator repair reason', tr: 'Operatör onarım nedenini kaydedin' },
  'archive.value.missing': { en: 'missing', tr: 'eksik' },
  'archive.value.none': { en: 'none', tr: 'yok' },
  'archive.terminal.relation.identical': { en: 'byte-identical', tr: 'byte-identical' },
  'archive.terminal.relation.strict_prefix': { en: 'strict-prefix', tr: 'strict-prefix' },
  'archive.terminal.relation.unproven': { en: 'unproven', tr: 'kanıtlanmamış' },
  'archive.terminal.inspect_report': {
    en: '{sprintId} terminal parity: archive={archivedDigest}, hot={hotDigest}, relation={relation}',
    tr: '{sprintId} terminal eşliği: arşiv={archivedDigest}, hot={hotDigest}, ilişki={relation}',
  },
  'archive.terminal.repair_ok': {
    en: '{sprintId} terminal repair {disposition}: journal={digest}, manifest={manifestDigest}, Brain-index={brainIndexDigest}, guarded-summary={guardedSummaryDigest}',
    tr: '{sprintId} terminal onarımı {disposition}: journal={digest}, manifest={manifestDigest}, Brain-index={brainIndexDigest}, guarded-summary={guardedSummaryDigest}',
  },
  'archive.terminal.verify_ok': {
    en: '{sprintId} terminal archive verified: manifest={manifestDigest}',
    tr: '{sprintId} terminal arşivi doğrulandı: manifest={manifestDigest}',
  },
  'archive.terminal.verify_failed': {
    en: '{sprintId} terminal archive verification failed: {reasons}',
    tr: '{sprintId} terminal arşiv doğrulaması başarısız: {reasons}',
  },
  'archive.option.sprint': { en: 'Select one sprint ID', tr: 'Tek bir sprint ID seçin' },
  'archive.option.all': { en: 'Select every discovered sprint', tr: 'Bulunan tüm sprintleri seçin' },
  'archive.option.json': { en: 'Output stable JSON', tr: 'Kararlı JSON çıktısı üretin' },
  'archive.option.apply': { en: 'Apply the reconciliation plan', tr: 'Uzlaştırma planını uygulayın' },
  'archive.option.retire_legacy': {
    en: 'Retire verified legacy copies after canonical publication',
    tr: 'Canonical yayın sonrası doğrulanmış legacy kopyaları emekliye ayırın',
  },
  'archive.mode.apply': { en: 'apply', tr: 'uygula' },
  'archive.mode.dry_run': { en: 'dry-run', tr: 'dry-run' },
  'archive.report': {
    en: '{sprintId} [{mode}] artifacts={artifacts} bytes={bytes} published={published} deduplicated={deduplicated} retired={retired} conflicts={conflicts} failures={failures}',
    tr: '{sprintId} [{mode}] artifact={artifacts} byte={bytes} yayınlanan={published} tekilleştirilen={deduplicated} emekli={retired} çakışma={conflicts} hata={failures}',
  },
  'archive.verify.ok': {
    en: '{sprintId} archive verified ({checked} artifacts)',
    tr: '{sprintId} arşivi doğrulandı ({checked} artifact)',
  },
  'archive.verify.failed': {
    en: '{sprintId} archive verification failed: missing={missing}, mismatched={mismatched}, untracked={untracked}',
    tr: '{sprintId} arşiv doğrulaması başarısız: eksik={missing}, uyuşmayan={mismatched}, izlenmeyen={untracked}',
  },
  'archive.error.selection_required': {
    en: 'Select exactly one of --sprint <id> or --all.',
    tr: '--sprint <id> veya --all seçeneklerinden tam olarak birini seçin.',
  },
  'archive.error.selection_conflict': {
    en: '--sprint and --all cannot be combined.',
    tr: '--sprint ve --all birlikte kullanılamaz.',
  },
  'archive.error.retire_requires_apply': {
    en: '--retire-legacy requires --apply.',
    tr: '--retire-legacy için --apply gerekir.',
  },
  'archive.error.reconcile_failed': {
    en: 'Archive reconciliation failed: {error}',
    tr: 'Arşiv uzlaştırması başarısız: {error}',
  },
  'archive.error.terminal_failed': {
    en: 'Terminal archive operation failed ({code}). Check the JSON failure envelope for mutation, seal, application, and verification state.',
    tr: 'Terminal arşiv işlemi başarısız oldu ({code}). Mutation, seal, application ve verification state için JSON failure envelope’u kontrol edin.',
  },
  'cli.attach.desc': {
    en: 'Attach to the tmux orchestra session',
    tr: 'tmux orchestra oturumuna bağlanın',
  },
  'cli.audit_verify.desc': {
    en: 'Verify the audit log HMAC chain for tamper evidence',
    tr: 'Kurcalama kanıtı için audit log HMAC zincirini doğrulayın',
  },
  'cli.audit.desc': {
    en: 'Run Brain Self-Audit Gate for a sprint, or query/export/retain audit log events (query | compliance | forward | retention)',
    tr: 'Bir sprint için Brain Self-Audit Gate çalıştırın veya audit log olaylarını sorgulayın/dışa aktarın/saklayın (query | compliance | forward | retention)',
  },
  'cli.autonomous_mission.desc': {
    en: 'Manage autonomous missions created from work lists or goals',
    tr: 'İş listelerinden veya hedeflerden oluşturulan autonomous mission\'ları yönetin',
  },
  'cli.autonomous_mission.create_list.desc': {
    en: 'Create an autonomous mission from one or more work items',
    tr: 'Bir veya daha fazla iş kaleminden autonomous mission oluşturun',
  },
  'cli.autonomous_mission.create_goal.desc': {
    en: 'Create an autonomous mission that runs until its goal is reached',
    tr: 'Hedefine ulaşılana kadar çalışan autonomous mission oluşturun',
  },
  'cli.autonomous_mission.list.desc': {
    en: 'List all missions (summary table)',
    tr: 'Tüm mission\'ları listeleyin (özet tablo)',
  },
  'cli.autonomous.desc': {
    en: 'Autonomous runtime — authority-bounded continuous loop',
    tr: 'Autonomous runtime — yetki sınırlı sürekli döngü',
  },
  'cli.autonomous.enable.desc': {
    en: 'Enable autonomous mode (one command instead of editing config; default stays OFF)',
    tr: 'Autonomous modu etkinleştirin (config düzenlemek yerine tek komut; varsayılan OFF kalır)',
  },
  'cli.autonomous.start.desc': {
    en: 'Start the autonomous loop (default-deny + human-approval gate)',
    tr: 'Autonomous döngüyü başlatın (default-deny + insan onayı kapısı)',
  },
  'cli.autonomous.plan.desc': {
    en: 'Decompose a high-level goal into pending autonomous backlog items',
    tr: 'Üst düzey bir hedefi bekleyen autonomous backlog kalemlerine ayrıştırın',
  },
  'cli.autonomous.status.desc': {
    en: 'Show autonomous runtime summary (pending + last audit events)',
    tr: 'Autonomous runtime özetini gösterin (bekleyenler + son audit olayları)',
  },
  'cli.autonomous.stop.desc': {
    en: 'Signal the autonomous loop to stop cleanly',
    tr: 'Autonomous döngüye temiz şekilde durma sinyali gönderin',
  },
  'cli.autonomous.cleanup.desc': {
    en: 'Sweep stray autonomous run-artifacts (task-run-*, _*.pid) from .tasks/',
    tr: 'Başıboş autonomous run-artifact\'larını (task-run-*, _*.pid) .tasks/ içinden temizleyin',
  },
  'cli.autonomous.pending.desc': {
    en: 'List parked approvals awaiting human accept/reject',
    tr: 'İnsan kabul/ret kararı bekleyen park edilmiş onayları listeleyin',
  },
  'cli.autonomous.approve.desc': {
    en: 'Approve a parked trigger — resolves the running loop\'s gate',
    tr: 'Park edilmiş bir tetikleyiciyi onaylayın — çalışan döngünün kapısını çözer',
  },
  'cli.autonomous.reject.desc': {
    en: 'Reject a parked trigger — resolves the running loop\'s gate',
    tr: 'Park edilmiş bir tetikleyiciyi reddedin — çalışan döngünün kapısını çözer',
  },
  'cli.autonomous.backlog.desc': {
    en: 'Manage the autonomous backlog (add / list / remove entries)',
    tr: 'Autonomous backlog\'u yönetin (kayıt ekleyin / listeleyin / kaldırın)',
  },
  'cli.autonomous.add.desc': {
    en: 'Add a new entry to the autonomous backlog',
    tr: 'Autonomous backlog\'a yeni bir kayıt ekleyin',
  },
  'cli.autonomous.list.desc': {
    en: 'List autonomous backlog entries',
    tr: 'Autonomous backlog kayıtlarını listeleyin',
  },
  'cli.autonomous.remove.desc': {
    en: 'Remove an entry from the autonomous backlog (positional id or --id)',
    tr: 'Autonomous backlog\'dan bir kaydı kaldırın (konumsal id veya --id)',
  },
  'cli.chat.desc': {
    en: 'Start a conversational session with Deckent. Uses your installed AI CLI.',
    tr: 'Deckent ile sohbet oturumu başlatın. Kurulu AI CLI\'ınızı kullanır.',
  },
  'cli.checkpoint.desc': {
    en: 'Manage human checkpoints — list, approve, or reject pending checkpoints',
    tr: 'İnsan checkpoint\'lerini yönetin — bekleyenleri listeleyin, onaylayın veya reddedin',
  },
  'cli.checkpoint.list.desc': {
    en: 'List all checkpoints',
    tr: 'Tüm checkpoint\'leri listeleyin',
  },
  'cli.checkpoint.approve.desc': {
    en: 'Approve a pending checkpoint',
    tr: 'Bekleyen bir checkpoint\'i onaylayın',
  },
  'cli.checkpoint.reject.desc': {
    en: 'Reject a pending checkpoint',
    tr: 'Bekleyen bir checkpoint\'i reddedin',
  },
  'cli.cleanup.desc': {
    en: 'Clean up after a sprint',
    tr: 'Sprint sonrası temizlik yapın',
  },
  'cli.config_nervous.nervous.desc': {
    en: 'Configure Nervous System authority mode and action overrides',
    tr: 'Nervous System yetki modunu ve aksiyon override\'larını yapılandırın',
  },
  'cli.config_nervous.set.desc': {
    en: 'Set a nervous system configuration value',
    tr: 'Bir nervous system yapılandırma değeri atayın',
  },
  'cli.config_nervous.override.desc': {
    en: 'Set a per-action policy override',
    tr: 'Aksiyon bazlı bir policy override\'ı atayın',
  },
  'cli.config_nervous.list.desc': {
    en: 'Show current authority matrix with all presets',
    tr: 'Mevcut yetki matrisini tüm preset\'lerle gösterin',
  },
  'cli.config_nervous.reset.desc': {
    en: 'Reset all action overrides to preset defaults',
    tr: 'Tüm aksiyon override\'larını preset varsayılanlarına sıfırlayın',
  },
  'cli.config.desc': {
    en: 'Show or modify project configuration',
    tr: 'Proje yapılandırmasını görüntüleyin veya değiştirin',
  },
  'cli.config.set.desc': {
    en: 'Set a configuration value',
    tr: 'Bir yapılandırma değeri atayın',
  },
  'cli.config.get.desc': {
    en: 'Get a configuration value by key (supports dot notation)',
    tr: 'Anahtara göre bir yapılandırma değeri okuyun (nokta gösterimini destekler)',
  },
  'cli.config.export.desc': {
    en: 'Export config to stdout or a file',
    tr: 'Config\'i stdout\'a veya bir dosyaya aktarın',
  },
  'cli.config.import.desc': {
    en: 'Import config from a JSON file',
    tr: 'Config\'i bir JSON dosyasından içe aktarın',
  },
  'cli.config.list.desc': {
    en: 'List all config parameters grouped by category',
    tr: 'Tüm config parametrelerini kategoriye göre gruplu listeleyin',
  },
  'cli.config.keys.desc': {
    en: 'List all config parameter keys',
    tr: 'Tüm config parametre anahtarlarını listeleyin',
  },
  'cli.config.migrate.desc': {
    en: 'Migrate config.json to the latest full format (adds missing fields with defaults)',
    tr: 'config.json\'ı en güncel tam formata taşıyın (eksik alanları varsayılanlarla ekler)',
  },
  'cli.connect.desc': {
    en: 'Diagnose provider/MCP/IDE/shell connection status (read-only — no changes are made)',
    tr: 'Provider/MCP/IDE/shell bağlantı durumunu teşhis edin (salt-okunur — hiçbir değişiklik yapılmaz)',
  },
  'cli.cost.desc': {
    en: 'User Safety Shield — cost management & estimation',
    tr: 'User Safety Shield — maliyet yönetimi ve tahmini',
  },
  'cli.cost.show.desc': {
    en: 'Display model pricing (read-only)',
    tr: 'Model fiyatlandırmasını gösterin (salt-okunur)',
  },
  'cli.cost.update.desc': {
    en: 'Fetch latest pricing from LiteLLM + OpenRouter',
    tr: 'En güncel fiyatlandırmayı LiteLLM + OpenRouter\'dan çekin',
  },
  'cli.cost.budget.desc': {
    en: 'View or set cost budgets',
    tr: 'Maliyet bütçelerini görüntüleyin veya ayarlayın',
  },
  'cli.cu_status.desc': {
    en: 'Show computer-use configuration and availability for each capability',
    tr: 'Computer-use yapılandırmasını ve her yeteneğin kullanılabilirliğini gösterin',
  },
  'cli.dashboard.desc': {
    en: 'Show terminal dashboard with auto-refresh (see also: deckent status --watch)',
    tr: 'Terminal dashboard\'u otomatik yenilemeyle gösterin (ayrıca bkz. deckent status --watch)',
  },
  'cli.do.desc': {
    en: 'Golden-flow: turn a goal into a sprint plan (dry-run preview by default; --run to actually start it)',
    tr: 'Golden-flow: bir hedefi sprint planına dönüştürün (varsayılan dry-run önizleme; gerçekten başlatmak için --run)',
  },
  'cli.docs.desc': {
    en: 'Manage user-defined documents',
    tr: 'Kullanıcı tanımlı dokümanları yönetin',
  },
  'cli.docs.add.desc': {
    en: 'Add a document to managed docs',
    tr: 'Yönetilen dokümanlara bir doküman ekleyin',
  },
  'cli.docs.remove.desc': {
    en: 'Remove a document from managed docs',
    tr: 'Yönetilen dokümanlardan bir dokümanı kaldırın',
  },
  'cli.docs.list.desc': {
    en: 'List all managed documents',
    tr: 'Tüm yönetilen dokümanları listeleyin',
  },
  'cli.docs.update.desc': {
    en: 'Update rules for an existing managed doc',
    tr: 'Mevcut bir yönetilen dokümanın kurallarını güncelleyin',
  },
  'cli.docs.run.desc': {
    en: 'Run managed doc updates without a sprint',
    tr: 'Yönetilen doküman güncellemelerini sprint olmadan çalıştırın',
  },
  'cli.docs.track.desc': {
    en: 'Track doc freshness (hash + DCR + stale)',
    tr: 'Doküman tazeliğini izleyin (hash + DCR + stale)',
  },
  'cli.docs.scan.desc': {
    en: 'Hash + timestamp + rank all docs; write front-matter; sync memory.db',
    tr: 'Tüm dokümanları hash\'leyin, zaman damgalayın ve sıralayın; front-matter yazın; memory.db\'yi eşitleyin',
  },
  'cli.docs.status.desc': {
    en: 'Report tracked docs by rank + stale state',
    tr: 'İzlenen dokümanları rank ve stale durumuna göre raporlayın',
  },
  'cli.docs.sync.desc': {
    en: 'Update memory.db only (no front-matter writes)',
    tr: 'Yalnız memory.db\'yi güncelleyin (front-matter yazılmaz)',
  },
  'cli.help_command.desc': {
    en: 'Print help for deckent or a specific command',
    tr: 'Deckent veya belirli bir komut için yardımı yazdır',
  },
  'cli.doctor.desc': {
    en: 'Check system dependencies and health',
    tr: 'Sistem bağımlılıklarını ve sağlığını kontrol edin',
  },
  'cli.evolve.desc': {
    en: 'Evolution analysis — cross-sprint trends and prompt suggestions',
    tr: 'Evrim analizi — sprint\'ler arası eğilimler ve prompt önerileri',
  },
  'cli.evolve.report.desc': {
    en: 'Show cross-sprint agent/skill trend report',
    tr: 'Sprint\'ler arası agent/skill eğilim raporunu gösterin',
  },
  'cli.explain.desc': {
    en: 'Explain what the last sprint did in human-friendly language',
    tr: 'Son sprint\'in ne yaptığını insan diliyle açıklayın',
  },
  'cli.features.desc': {
    en: 'List features from .deckent/settings/features-manifest.json by category',
    tr: '.deckent/settings/features-manifest.json içindeki özellikleri kategoriye göre listeleyin',
  },
  'cli.flow.desc': {
    en: 'Manage scheduled flows (process mode)',
    tr: 'Zamanlanmış flow\'ları yönetin (process modu)',
  },
  'cli.flow.list.desc': {
    en: 'List all scheduled flows',
    tr: 'Tüm zamanlanmış flow\'ları listeleyin',
  },
  'cli.flow.add.desc': {
    en: 'Add a new scheduled flow (cron: 5-field expression, e.g. "* * * * *")',
    tr: 'Yeni bir zamanlanmış flow ekleyin (cron: 5 alanlı ifade, örn. "* * * * *")',
  },
  'cli.flow.run.desc': {
    en: 'Run the flow-runtime tick once (--once) or start the daemon',
    tr: 'Flow-runtime tick\'ini bir kez çalıştırın (--once) veya daemon\'ı başlatın',
  },
  'cli.flow.approve.desc': {
    en: 'Approve a pending event-triggered flow dispatch so it can proceed',
    tr: 'Bekleyen event-tetikli bir flow dispatch\'ini onaylayın ki ilerleyebilsin',
  },
  'cli.heartbeat.desc': {
    en: 'Run proactive heartbeat tasks from .deckent/HEARTBEAT.md',
    tr: '.deckent/HEARTBEAT.md içindeki proaktif heartbeat görevlerini çalıştırın',
  },
  'cli.help.help_info.desc': {
    en: 'Show quick-reference help (localized)',
    tr: 'Hızlı başvuru yardımını gösterin (yerelleştirilmiş)',
  },
  'cli.image.desc': {
    en: 'Worker Docker image management',
    tr: 'Worker Docker imajı yönetimi',
  },
  'cli.image.build.desc': {
    en: 'Build the deckent-worker Docker image from the packaged Dockerfile.worker',
    tr: 'deckent-worker Docker imajını paketlenmiş Dockerfile.worker\'dan derleyin',
  },
  'cli.image.build.opt_tag': {
    en: 'Docker image tag to build (default: {default})',
    tr: 'Derlenecek Docker imajı etiketi (varsayılan: {default})',
  },
  'cli.image.build.opt_dry_run': {
    en: 'Print the resolved Dockerfile path + build plan without building (no docker spawn)',
    tr: 'Derleme yapmadan çözümlenen Dockerfile yolunu ve derleme planını yazdır (docker başlatılmaz)',
  },
  'cli.image.build.opt_with_codex': {
    en: 'Install Codex CLI (INSTALL_CODEX=true build-arg)',
    tr: 'Codex CLI\'ı yükle (INSTALL_CODEX=true derleme argümanı)',
  },
  'cli.image.build.opt_with_gemini': {
    en: 'Install Gemini CLI (INSTALL_GEMINI=true build-arg)',
    tr: 'Gemini CLI\'ı yükle (INSTALL_GEMINI=true derleme argümanı)',
  },
  'cli.image.build.opt_with_ollama': {
    en: 'Install Ollama CLI (INSTALL_OLLAMA=true build-arg)',
    tr: 'Ollama CLI\'ı yükle (INSTALL_OLLAMA=true derleme argümanı)',
  },
  'cli.image.build.opt_with_cursor': {
    en: 'Install Cursor CLI (INSTALL_CURSOR=true build-arg)',
    tr: 'Cursor CLI\'ı yükle (INSTALL_CURSOR=true derleme argümanı)',
  },
  'cli.image.build.opt_image': {
    en: 'Deprecated alias for --tag',
    tr: '--tag için kullanımdan kaldırılmış takma ad',
  },
  'cli.image.build.opt_lang': {
    en: 'Language override (en|tr)',
    tr: 'Dil geçersiz kılma değeri (en|tr)',
  },
  'image.dry_run_dockerfile': {
    en: 'Dockerfile: {path}{status}',
    tr: 'Dockerfile: {path}{status}',
  },
  'image.dry_run_not_found': {
    en: ' (NOT FOUND)',
    tr: ' (BULUNAMADI)',
  },
  'image.dry_run_build': {
    en: 'Build: {cmd}',
    tr: 'Derleme: {cmd}',
  },
  'image.dry_run_tag': {
    en: 'Image tag: {tag}',
    tr: 'İmaj etiketi: {tag}',
  },
  'image.dockerfile_missing': {
    en: 'Packaged Dockerfile.worker not found at {path}. Reinstall deckent (the Dockerfile ships in the npm package) or report this packaging error.',
    tr: 'Paketlenmiş Dockerfile.worker {path} konumunda bulunamadı. deckent paketini yeniden yükleyin (Dockerfile npm paketiyle gelir) veya bu paketleme hatasını bildirin.',
  },
  'image.build_running': {
    en: 'Building worker image: {cmd}',
    tr: 'Worker imajı derleniyor: {cmd}',
  },
  'image.build_done': {
    en: 'Worker image built successfully.',
    tr: 'Worker imajı başarıyla derlendi.',
  },
  'image.build_failed': {
    en: 'Worker image build failed (exit {code}). See the build output above.',
    tr: 'Worker imaj derlemesi başarısız (çıkış {code}). Yukarıdaki derleme çıktısına bakın.',
  },
  'image.docker_unavailable': {
    en: 'docker command not found — install Docker and ensure it is on PATH, or switch spawn_backend to "subprocess".',
    tr: 'docker komutu bulunamadı — Docker\'ı yükleyip PATH üzerinde olduğundan emin olun veya spawn_backend değerini "subprocess" olarak değiştirin.',
  },
  'image.docker_launch_failed': {
    en: 'could not launch docker: {error}',
    tr: 'docker başlatılamadı: {error}',
  },
  'image.build_launch_error': {
    en: 'deckent image build: {detail}',
    tr: 'deckent image build: {detail}',
  },
  'cli.init.desc': {
    en: 'Initialize a new Deckent project',
    tr: 'Yeni bir Deckent projesi başlatın',
  },
  'cli.kill.desc': {
    en: 'Kill a running worker',
    tr: 'Çalışan bir worker\'ı sonlandırın',
  },
  'cli.kpi.desc': {
    en: 'Show the KPI scorecard for the current (or a specific) sprint',
    tr: 'Mevcut (veya belirtilen) sprint için KPI karnesini gösterin',
  },
  'cli.limits.desc': {
    en: 'Check live subscription-window usage (session/week) and the configured start-gate thresholds',
    tr: 'Canlı abonelik-penceresi kullanımını (oturum/hafta) ve yapılandırılmış start-gate eşiklerini kontrol edin',
  },
  'cli.mcp.desc': {
    en: 'Manage MCP servers (Claude-parity)',
    tr: 'MCP sunucularını yönetin (Claude-parity)',
  },
  'cli.mcp.add.desc': {
    en: 'Add an MCP server (stdio or http) — writes to .mcp.json by scope',
    tr: 'Bir MCP sunucusu ekleyin (stdio veya http) — scope\'a göre .mcp.json dosyasına yazar',
  },
  'cli.mcp.list.desc': {
    en: 'List registered MCP servers (merged: local > project > user)',
    tr: 'Kayıtlı MCP sunucularını listeleyin (birleşik: local > project > user)',
  },
  'cli.mcp.remove.desc': {
    en: 'Remove an MCP server (searches all scopes if --scope omitted)',
    tr: 'Bir MCP sunucusunu kaldırın (--scope verilmezse tüm scope\'larda arar)',
  },
  'cli.mcp.get.desc': {
    en: 'Show details for an MCP server (from merged view)',
    tr: 'Bir MCP sunucusunun ayrıntılarını gösterin (birleşik görünümden)',
  },
  'cli.memory.desc': {
    en: 'Memory V2 management',
    tr: 'Memory V2 yönetimi',
  },
  'cli.memory.rebuild.desc': {
    en: 'Rebuild memory.db from .brain/exports/*.md files',
    tr: 'memory.db\'yi .brain/exports/*.md dosyalarından yeniden oluşturun',
  },
  'cli.memory.export.desc': {
    en: 'Export memory.db to .brain/exports/*.md',
    tr: 'memory.db\'yi .brain/exports/*.md olarak dışa aktarın',
  },
  'cli.memory.stats.desc': {
    en: 'Show memory.db statistics',
    tr: 'memory.db istatistiklerini gösterin',
  },
  'cli.memory.relations.desc': {
    en: 'Manage memory relations',
    tr: 'Memory ilişkilerini yönetin',
  },
  'cli.memory.list.desc': {
    en: 'List all relations in memory.db',
    tr: 'memory.db içindeki tüm ilişkileri listeleyin',
  },
  'cli.memory.review.desc': {
    en: 'Review pending relations from backfill preview',
    tr: 'Backfill önizlemesinden gelen bekleyen ilişkileri gözden geçirin',
  },
  'cli.models.desc': {
    en: 'Manage and browse the model catalog',
    tr: 'Model kataloğunu yönetin ve gezinin',
  },
  'cli.models.list.desc': {
    en: 'List available models from the catalog',
    tr: 'Katalogdaki kullanılabilir modelleri listeleyin',
  },
  'cli.models.activate.desc': {
    en: 'Allow a detected model to enter the routing pool',
    tr: 'Tespit edilen bir modelin routing havuzuna girmesine izin verin',
  },
  'cli.models.deactivate.desc': {
    en: 'Remove a model from the routing pool (detection still sees it)',
    tr: 'Bir modeli routing havuzundan çıkarın (tespit onu görmeye devam eder)',
  },
  'cli.models.activation.desc': {
    en: 'Show recorded model activation decisions (unrecorded = active)',
    tr: 'Kayıtlı model aktivasyon kararlarını gösterin (kayıtsız = aktif)',
  },
  'cli.models.policy.desc': {
    en: 'Show or set a provider activation policy (implicit-active | explicit-active)',
    tr: 'Bir provider aktivasyon policy\'sini gösterin veya ayarlayın (implicit-active | explicit-active)',
  },
  'cli.models.active_set.desc': {
    en: 'Show the resolved owner active execution set + snapshot digest',
    tr: 'Çözümlenmiş owner aktif execution set\'ini + snapshot digest\'ini gösterin',
  },
  'cli.models.refresh.desc': {
    en: 'Force-refresh the model catalog (invalidates 24h cache)',
    tr: 'Model kataloğunu zorla yenileyin (24 saatlik cache\'i geçersiz kılar)',
  },
  'cli.models.tier.desc': {
    en: 'Look up the tier of a specific model by ID or API ID',
    tr: 'Belirli bir modelin tier\'ını ID veya API ID ile sorgulayın',
  },
  'cli.nervous.desc': {
    en: 'Nervous System dashboard — monitor, accept, reject proactive suggestions',
    tr: 'Nervous System panosu — proaktif önerileri izleyin, kabul edin, reddedin',
  },
  'cli.nervous.enable.desc': {
    en: 'Enable the Nervous System (one command; default stays OFF, human-approval preserved)',
    tr: 'Nervous System\'i etkinleştirin (tek komut; varsayılan OFF kalır, insan onayı korunur)',
  },
  'cli.nervous.accept.desc': {
    en: 'Accept a pending nervous system suggestion',
    tr: 'Bekleyen bir nervous system önerisini kabul edin',
  },
  'cli.nervous.reject.desc': {
    en: 'Reject a pending nervous system suggestion',
    tr: 'Bekleyen bir nervous system önerisini reddedin',
  },
  'cli.nervous.edit.desc': {
    en: 'Modify and accept a pending suggestion',
    tr: 'Bekleyen bir öneriyi değiştirip kabul edin',
  },
  'cli.nervous.undo.desc': {
    en: 'Undo a recent reversible action',
    tr: 'Yakın zamanda yapılmış geri alınabilir bir aksiyonu geri alın',
  },
  'cli.nervous.history.desc': {
    en: 'View nervous system action history',
    tr: 'Nervous system aksiyon geçmişini görüntüleyin',
  },
  'cli.nervous.recommendations.desc': {
    en: 'View the Brain inbox — nervous proposals awaiting disposition',
    tr: 'Brain gelen kutusunu görüntüleyin — karar bekleyen nervous önerileri',
  },
  'cli.nervous.log.desc': {
    en: 'View raw nervous system log',
    tr: 'Ham nervous system log\'unu görüntüleyin',
  },
  'cli.nervous.accept_panic.desc': {
    en: 'Approve a PanicGuard-blocked worker kill (writes IPC marker)',
    tr: 'PanicGuard tarafından engellenmiş bir worker kill\'ini onaylayın (IPC marker yazar)',
  },
  'cli.nervous.baseline_refresh.desc': {
    en: 'Refresh directives_protection baseline to current DIRECTIVES.md content',
    tr: 'directives_protection baseline\'ını güncel DIRECTIVES.md içeriğine yenileyin',
  },
  'cli.onboard.desc': {
    en: 'Run the onboarding wizard',
    tr: 'Onboarding sihirbazını çalıştırın',
  },
  'cli.openrouter_probe.desc': {
    en: 'Live-probe OpenRouter free models via $DECK:OPENROUTER_API_KEY and refresh the local cache',
    tr: 'OpenRouter ücretsiz modellerini $DECK:OPENROUTER_API_KEY ile canlı yoklayın ve yerel cache\'i yenileyin',
  },
  'cli.output.desc': {
    en: 'Show captured output for a specific worker task',
    tr: 'Belirli bir worker görevi için yakalanan çıktıyı gösterin',
  },
  'cli.plan_nl.desc': {
    en: 'Turn a free-form goal into a DIRECTIVES.md scaffold (single-task template; preview by default)',
    tr: 'Serbest biçimli bir hedefi DIRECTIVES.md iskeletine dönüştürün (tek-görev şablonu; varsayılan önizleme)',
  },
  'cli.plan.desc': {
    en: 'Plan a sprint without executing it',
    tr: 'Bir sprint\'i çalıştırmadan planlayın',
  },
  'cli.plugin.desc': {
    en: 'Manage plugins',
    tr: 'Plugin\'leri yönetin',
  },
  'cli.plugin.install.desc': {
    en: 'Install a plugin from npm, git URL, or local path',
    tr: 'npm, git URL veya yerel yoldan bir plugin kurun',
  },
  'cli.plugin.remove.desc': {
    en: 'Remove an installed plugin',
    tr: 'Kurulu bir plugin\'i kaldırın',
  },
  'cli.plugin.update.desc': {
    en: 'Update a plugin (remove existing and re-install from source)',
    tr: 'Bir plugin\'i güncelleyin (mevcudu kaldırıp kaynağından yeniden kurar)',
  },
  'cli.plugin.list.desc': {
    en: 'List installed plugins',
    tr: 'Kurulu plugin\'leri listeleyin',
  },
  'cli.plugin.info.desc': {
    en: 'Show plugin info (accepts absolute or relative path)',
    tr: 'Plugin bilgisini gösterin (mutlak veya göreli yol kabul eder)',
  },
  'cli.plugin.test.desc': {
    en: 'Test a plugin: validate manifest and entrypoint, run hooks if available',
    tr: 'Bir plugin\'i test edin: manifest ve entrypoint doğrulanır, varsa hook\'lar çalıştırılır',
  },
  'cli.plugin.create.desc': {
    en: 'Create a new plugin scaffold',
    tr: 'Yeni bir plugin iskeleti oluşturun',
  },
  'cli.process.desc': {
    en: 'Process-mode execution surface — submit tasks/capabilities and poll their status',
    tr: 'Process-mode execution yüzeyi — görev/yetenek gönderin ve durumlarını yoklayın',
  },
  'cli.process.submit.desc': {
    en: 'Submit an ExecutionRequest (policy-gated: read-only auto-runs, side-effecting parks for approval)',
    tr: 'Bir ExecutionRequest gönderin (policy-gated: salt-okunur olanlar otomatik çalışır, yan etkili olanlar onay için park edilir)',
  },
  'cli.process.status.desc': {
    en: 'Poll the status of a prior submission by executionId',
    tr: 'Önceki bir gönderimin durumunu executionId ile yoklayın',
  },
  'cli.process.result.desc': {
    en: 'Show the full result of a submission (status + lastResult)',
    tr: 'Bir gönderimin tam sonucunu gösterin (status + lastResult)',
  },
  'cli.rbac.desc': {
    en: 'Role-based access control — check permissions and list roles',
    tr: 'Rol tabanlı erişim denetimi — izinleri kontrol edin ve rolleri listeleyin',
  },
  'cli.rbac.check.desc': {
    en: 'Check whether a role has permission to perform an action',
    tr: 'Bir rolün bir aksiyonu gerçekleştirme iznine sahip olup olmadığını kontrol edin',
  },
  'cli.rbac.roles.desc': {
    en: 'List all roles and their effective permissions',
    tr: 'Tüm rolleri ve etkin izinlerini listeleyin',
  },
  'cli.rbac.grant.desc': {
    en: 'Assign a role to a user',
    tr: 'Bir kullanıcıya rol atayın',
  },
  'cli.rbac.revoke.desc': {
    en: 'Remove the role assignment for a user',
    tr: 'Bir kullanıcının rol atamasını kaldırın',
  },
  'cli.recall.desc': {
    en: 'Search project memory — ADRs, sprint learnings, patterns, debt',
    tr: 'Proje belleğinde arayın — ADR\'ler, sprint öğrenimleri, pattern\'ler, borç',
  },
  'cli.remember.desc': {
    en: 'Store a note in project memory',
    tr: 'Proje belleğine bir not kaydedin',
  },
  'cli.resources.desc': {
    en: 'Show live docker worker resource usage or analyze resource log',
    tr: 'Canlı docker worker kaynak kullanımını gösterin veya kaynak log\'unu analiz edin',
  },
  'cli.resume.desc': {
    en: 'Resume a sprint from its latest checkpoint',
    tr: 'Bir sprint\'i son checkpoint\'inden devam ettirin',
  },
  'cli.retro.desc': {
    en: 'Show the latest sprint retrospective',
    tr: 'En son sprint retrospektifini gösterin',
  },
  'cli.review.desc': {
    en: 'Review sprint tasks with evaluations',
    tr: 'Sprint görevlerini değerlendirmeleriyle birlikte gözden geçirin',
  },
  'cli.run.desc': {
    en: 'Run a single one-shot task without a sprint cycle',
    tr: 'Sprint döngüsü olmadan tek seferlik bir görev çalıştırın',
  },
  'cli.runs.desc': {
    en: 'List run-flows (the multi-flow inbox) — plus per-run decide: --approve/--reject/--retire/--start',
    tr: 'Run-flow\'ları listeleyin (çoklu-flow gelen kutusu) — ayrıca run bazında karar: --approve/--reject/--retire/--start',
  },
  'cli.serve.desc': {
    en: 'Start HTTP API server with SSE support',
    tr: 'HTTP API sunucusunu SSE desteğiyle başlatın',
  },
  'cli.set_directives.desc': {
    en: 'Write sprint goals to DIRECTIVES.md (content, file, or stdin)',
    tr: 'Sprint hedeflerini DIRECTIVES.md dosyasına yazın (içerik, dosya veya stdin)',
  },
  'cli.skill_marketplace.search.desc': {
    en: 'Search skills in the marketplace registry',
    tr: 'Marketplace kayıt defterinde skill arayın',
  },
  'cli.skill_marketplace.publish.desc': {
    en: 'Validate, sign (Ed25519) and publish a skill to the marketplace',
    tr: 'Bir skill\'i doğrulayın, imzalayın (Ed25519) ve marketplace\'e yayınlayın',
  },
  'cli.skill.desc': {
    en: 'Manage skill pool',
    tr: 'Skill havuzunu yönetin',
  },
  'cli.skill.list.desc': {
    en: 'List all skills',
    tr: 'Tüm skill\'leri listeleyin',
  },
  'cli.skill.attribution.desc': {
    en: 'Inspect or apply the causal skill-attribution cutover',
    tr: 'Nedensel skill-atıf geçişini inceleyin veya uygulayın',
  },
  'cli.skill.attribution.opt.apply': {
    en: 'Apply the lossless cutover and write its immutable receipt',
    tr: 'Kayıpsız geçişi uygulayın ve immutable receipt yazın',
  },
  'cli.skill.attribution.state': {
    en: 'Skill attribution cutover: {state}',
    tr: 'Skill atıf geçişi: {state}',
  },
  'cli.skill.attribution.inventory': {
    en: 'Legacy inventory — learnings: {learnings}, history: {history}, synergy: {synergy}, evolved rules: {rules}, sidecar: {sidecar}',
    tr: 'Legacy envanter — learnings: {learnings}, geçmiş: {history}, synergy: {synergy}, evolved rule: {rules}, sidecar: {sidecar}',
  },
  'cli.skill.attribution.dry_run': {
    en: 'Nothing changed. Re-run with --apply to commit the lossless cutover.',
    tr: 'Hiçbir şey değişmedi. Kayıpsız geçişi commit etmek için --apply ile yeniden çalıştırın.',
  },
  'cli.skill.attribution.committed': {
    en: 'Causal skill-attribution cutover committed ({receiptDigest}).',
    tr: 'Nedensel skill-atıf geçişi commit edildi ({receiptDigest}).',
  },
  'cli.skill.create.desc': {
    en: 'Create a custom skill',
    tr: 'Özel bir skill oluşturun',
  },
  'cli.skill.create.profile_required': {
    en: 'Skill "{name}" was not created because a required routing profile could not be generated ({reason}). Add a specific description and routing triggers, then try again.',
    tr: 'Zorunlu yönlendirme profili üretilemediği için "{name}" skill\'i oluşturulmadı ({reason}). Belirli bir açıklama ve yönlendirme tetikleyicileri ekleyip yeniden deneyin.',
  },
  'cli.skill.install.desc': {
    en: 'Install a skill from local path or git URL (supports version pinning: url#tag)',
    tr: 'Yerel yoldan veya git URL\'den bir skill kurun (sürüm sabitlemeyi destekler: url#tag)',
  },
  'cli.skill.update.desc': {
    en: 'Update an installed skill from its original source',
    tr: 'Kurulu bir skill\'i orijinal kaynağından güncelleyin',
  },
  'cli.skill.enable.desc': {
    en: 'Enable a skill',
    tr: 'Bir skill\'i etkinleştirin',
  },
  'cli.skill.disable.desc': {
    en: 'Disable a skill',
    tr: 'Bir skill\'i devre dışı bırakın',
  },
  'cli.skill.delete.desc': {
    en: 'Delete a skill',
    tr: 'Bir skill\'i silin',
  },
  'cli.skill.info.desc': {
    en: 'Show skill details',
    tr: 'Skill ayrıntılarını gösterin',
  },
  'cli.skill.stats.heading': {
    en: '  Skill attribution statistics:',
    tr: '  Skill atıf istatistikleri:',
  },
  'cli.skill.stats.credited_uses': {
    en: '    Credited uses:    {count}',
    tr: '    Kredili kullanım: {count}',
  },
  'cli.skill.stats.success_rate': {
    en: '    Success rate:     {value}',
    tr: '    Başarı oranı:     {value}',
  },
  'cli.skill.stats.selected': {
    en: '    Selected:         {count}',
    tr: '    Seçildi:          {count}',
  },
  'cli.skill.stats.delivered': {
    en: '    Prompt-delivered: {count}',
    tr: '    Prompta ulaştı:   {count}',
  },
  'cli.skill.stats.credited': {
    en: '    Causally credited:{count}',
    tr: '    Nedensel kredi:   {count}',
  },
  'cli.skill.stats.last_sprint': {
    en: '    Last sprint:      {value}',
    tr: '    Son sprint:       {value}',
  },
  'cli.spawn.desc': {
    en: 'Manually spawn a worker for a task (BLOCKS until the worker exits on the docker backend; fire-and-forget on tmux/subprocess)',
    tr: 'Bir görev için elle worker başlatın (docker backend\'inde worker çıkana kadar BLOKLAR; tmux/subprocess\'te fire-and-forget)',
  },
  'cli.start.desc': {
    en: 'Start a new sprint (optionally with a one-line description for zero-config mode)',
    tr: 'Yeni bir sprint başlatın (zero-config mod için isteğe bağlı tek satırlık açıklamayla)',
  },
  'cli.sync.desc': {
    en: 'Sync adapter files and detect out-of-band changes since last sprint',
    tr: 'Adapter dosyalarını eşitleyin ve son sprint\'ten bu yana oluşan dış değişiklikleri tespit edin',
  },
  'cli.test_run.test.desc': {
    en: 'Run a test sprint (no retro, no memory update, no decay)',
    tr: 'Test sprint\'i çalıştırın (retro yok, memory güncellemesi yok, decay yok)',
  },
  'cli.truth.desc': {
    en: 'Resolve the 4-level feature truth-chain (code → wired → enabled → proof) for manifest truth-blocks',
    tr: 'Manifest truth-block\'ları için 4 seviyeli feature truth-chain\'i çözün (code → wired → enabled → proof)',
  },
  'cli.upgrade.desc': {
    en: 'Self-update deckent',
    tr: 'deckent\'i kendi kendine güncelleyin',
  },
  'cli.usage.desc': {
    en: 'Show token/limit consumption from Claude Code transcripts',
    tr: 'Claude Code transcript\'lerinden token/limit tüketimini gösterin',
  },
  'cli.watch.desc': {
    en: 'Follow a live worker (docker logs / tmux pane / subprocess log) with --follow <taskId>, or open the tmux dashboard split',
    tr: 'Canlı bir worker\'ı --follow <taskId> ile takip edin (docker logs / tmux pane / subprocess log) veya tmux dashboard split\'ini açın',
  },

  // ─── MCP tool descriptions (559-004) ────────────────────────────────────────
  // A tool with a CLI counterpart SHARES that command's `cli.*.desc` /
  // `<cmd>.desc` key above — the shared sentence has exactly one source, so the
  // two surfaces cannot drift. The `mcp.<tool>.detail` keys below are ADDITIVE
  // MCP-surface affordance (prerequisites, destructive warnings, action enums,
  // return shape) appended to that shared sentence; they never restate it.
  // `mcp.<tool>.desc` keys belong to tools with no commander counterpart.
  // Binding table: src/mcp/tools/description-catalog.ts.
  'mcp.init.detail': {
    en: 'Creates every required directory (.deckent/, .brain/, .tasks/, .locks/, .claude/rules/) and configuration file (config.json, DECKENT.md, DIRECTIVES.md, brain files). Safe to re-run — existing config fields are preserved via merge and files are written only when missing. Next: deckent_set_directives → deckent_plan → deckent_start.',
    tr: 'Gerekli tüm dizinleri (.deckent/, .brain/, .tasks/, .locks/, .claude/rules/) ve yapılandırma dosyalarını (config.json, DECKENT.md, DIRECTIVES.md, brain dosyaları) oluşturur. Yeniden çalıştırmak güvenlidir — mevcut config alanları merge ile korunur, dosyalar yalnızca eksikse yazılır. Sonraki adım: deckent_set_directives → deckent_plan → deckent_start.',
  },
  'mcp.set_directives.detail': {
    en: 'The brain engine parses "## Task N:" or "## Görev N:" blocks into run tasks. Each block should carry: Model (an exact provider API ID, e.g. {modelId} — see deckent_models for the live catalog; legacy aliases [{legacyAliases}] are rejected), optional Provider (explicit ownership: {providers}, required when it cannot be inferred from the id prefix), Effort (low/normal/high), Skills, Files, Scope and Description. Prerequisite: deckent_init. Overwrites DIRECTIVES.md on every call; run deckent_plan afterwards to preview the tasks.',
    tr: 'Brain motoru "## Task N:" veya "## Görev N:" bloklarını run görevlerine çevirir. Her blok şunları taşımalıdır: Model (tam provider API ID\'si, örn. {modelId} — canlı katalog için deckent_models; eski alias\'lar [{legacyAliases}] reddedilir), isteğe bağlı Provider (açık sahiplik: {providers}, id ön ekinden çıkarılamadığında zorunlu), Effort (low/normal/high), Skills, Files, Scope ve Description. Ön koşul: deckent_init. Her çağrıda DIRECTIVES.md üzerine yazar; ardından görevleri önizlemek için deckent_plan çalıştırın.',
  },
  'mcp.plan.detail': {
    en: 'Reads DIRECTIVES.md, analyses the task blocks and returns the proposed task list with model assignments, wave breakdown and risk assessment — without executing anything. Use it to validate directives before deckent_start. Prerequisite: deckent_init + deckent_set_directives.',
    tr: 'DIRECTIVES.md dosyasını okur, görev bloklarını çözümler ve önerilen görev listesini model atamaları, dalga dağılımı ve risk değerlendirmesiyle döndürür — hiçbir şey çalıştırmadan. deckent_start öncesi direktifleri doğrulamak için kullanın. Ön koşul: deckent_init + deckent_set_directives.',
  },
  'mcp.start.detail': {
    en: 'Runs the complete lifecycle in the background: PLAN → SPAWN → EXECUTE → EVALUATE → FIX → RETRO → DECAY → COMPLETE. Pre-spawn cost admission always runs: acknowledgeCost=true or force=true may acknowledge a numeric budget overrun but can never override unknown pricing or an unavailable gate. Returns immediately with a jobId while the run continues asynchronously — poll deckent_status and evaluate with deckent_review. Prerequisite: deckent_init + deckent_set_directives.',
    tr: 'Tüm yaşam döngüsünü arka planda çalıştırır: PLAN → SPAWN → EXECUTE → EVALUATE → FIX → RETRO → DECAY → COMPLETE. Spawn öncesi maliyet kabulü her zaman çalışır: acknowledgeCost=true veya force=true sayısal bütçe aşımını kabul edebilir, ancak bilinmeyen fiyatlandırmayı veya kullanılamayan bir gate\'i asla geçersiz kılamaz. Hemen bir jobId döndürür, run eşzamansız sürer — deckent_status ile izleyin, deckent_review ile değerlendirin. Ön koşul: deckent_init + deckent_set_directives.',
  },
  // ─── deckent_start (591-005 i18n) ───────────────────────────────────
  'mcp.start.title': { en: 'Start Run', tr: 'Run Başlat' },
  'mcp.start.auto_approve_desc': {
    en: 'Auto-approve worker tool calls with --dangerously-skip-permissions. CLI default is false; set true only when the caller has confirmed the run is safe under the CLI/MCP parity contract.',
    tr: 'Worker araç çağrılarını --dangerously-skip-permissions ile otomatik onaylar. CLI varsayılanı false\'tur; yalnızca çağıran run\'ın CLI/MCP parity contractı kapsamında güvenli olduğunu onayladığında true verin.',
  },
  'mcp.start.acknowledge_cost_desc': {
    en: 'Acknowledge a numeric over-budget estimate. Unknown pricing or an unavailable gate still blocks. Equivalent to CLI --force from the cost-gate perspective.',
    tr: 'Sayısal bütçe aşımı tahminini kabul eder. Bilinmeyen fiyatlandırma veya kullanılamayan bir gate yine de engeller. Cost-gate açısından CLI --force ile eşdeğerdir.',
  },
  'mcp.start.acknowledge_scope_paths_desc': {
    en: 'Bypass the pre-spawn SCOPE gate (Dimension B). By default a run is blocked before spawn when a task\'s filesWrite path does not exist and looks like a typo/wrong-directory (an orphan-file mode). Set true to allow such paths as intentional new files. Equivalent to CLI --force-scope; independent of acknowledgeCost/force.',
    tr: 'Spawn öncesi SCOPE gate\'ini (Dimension B) atlar. Varsayılan olarak, bir görevin filesWrite yolu mevcut değilse ve typo/yanlış-dizin gibi görünüyorsa (orphan-file modu) run spawn öncesi engellenir. Bu yolları kasıtlı yeni dosyalar olarak kabul etmek için true verin. CLI --force-scope ile eşdeğerdir; acknowledgeCost/force\'tan bağımsızdır.',
  },
  'mcp.start.acknowledge_prompt_gate_desc': {
    en: 'Bypass the plan-time G-series prompt gate BLOCK (persona-capability / decision-space / scope-contract findings — born-628). By default a run halts at PLAN when a task\'s finalized (persona × intent) fit fails a hard lint. Set true to allow such tasks to spawn anyway. Equivalent to CLI --force-prompt-gate; independent of acknowledgeCost/force/acknowledgeScopePaths.',
    tr: 'Plan-zamanı G-serisi prompt gate BLOCK\'unu atlar (persona-capability / decision-space / scope-contract bulguları — born-628). Varsayılan olarak, bir görevin nihai (persona × intent) uyumu sert bir lint\'i geçemediğinde run PLAN\'da durur. Bu tür görevlerin yine de spawn olmasına izin vermek için true verin. CLI --force-prompt-gate ile eşdeğerdir; acknowledgeCost/force/acknowledgeScopePaths\'ten bağımsızdır.',
  },
  'mcp.start.dry_run_desc': {
    en: 'Plan the run without spawning workers. Returns the planned tasks list so you can review before committing. No workers are started, no files are changed.',
    tr: 'Worker başlatmadan run\'ı planlar. İncelemeniz için planlanan görev listesini döndürür. Hiçbir worker başlatılmaz, hiçbir dosya değişmez.',
  },
  'mcp.start.force_desc': {
    en: 'Skip the sprint-lock pre-flight and acknowledge a numeric cost overrun. Unknown pricing or an unavailable cost gate still blocks. Equivalent to CLI --force.',
    tr: 'Sprint-lock ön kontrolünü atlar ve sayısal bir maliyet aşımını kabul eder. Bilinmeyen fiyatlandırma veya kullanılamayan bir cost gate yine de engeller. CLI --force ile eşdeğerdir.',
  },
  'mcp.start.timeout_desc': {
    en: 'Run maximum duration in milliseconds (default: 30 minutes = 1800000). Run is marked TIMEOUT if workers do not complete within this window.',
    tr: 'Run\'ın azami süresi (milisaniye, varsayılan: 30 dakika = 1800000). Worker\'lar bu pencere içinde tamamlanmazsa run TIMEOUT olarak işaretlenir.',
  },
  'mcp.start.sandbox_desc': {
    en: 'Run in sandbox mode: stashes local git changes before spawning and restores them after the run completes. Safe experimentation — no permanent changes on failure.',
    tr: 'Sandbox modunda çalışır: spawn öncesi yerel git değişikliklerini stash\'ler, run tamamlandığında geri yükler. Güvenli deneme — başarısızlıkta kalıcı değişiklik olmaz.',
  },
  'mcp.start.flow_id_desc': {
    en: 'TERM-FLOW-UNIFY (426-001): consume an approved RunFlow snapshot instead of planning fresh — requires revision, planDigest and config.terminal.run_flow_v2=true. Must be supplied together with revision + planDigest.',
    tr: 'TERM-FLOW-UNIFY (426-001): sıfırdan planlamak yerine onaylı bir RunFlow snapshot\'ını tüketir — revision, planDigest ve config.terminal.run_flow_v2=true gerektirir. revision + planDigest ile birlikte sağlanmalıdır.',
  },
  'mcp.start.revision_desc': {
    en: 'RunFlow proposal revision to CAS-verify against the approved snapshot (used with flowId).',
    tr: 'Onaylı snapshot\'a karşı CAS-doğrulaması yapılacak RunFlow proposal revizyonu (flowId ile kullanılır).',
  },
  'mcp.start.plan_digest_desc': {
    en: 'RunFlow planDigest to CAS-verify against the approved snapshot (used with flowId).',
    tr: 'Onaylı snapshot\'a karşı CAS-doğrulaması yapılacak RunFlow planDigest\'i (flowId ile kullanılır).',
  },
  'mcp.start.flow_params_incomplete': {
    en: 'flowId, revision and planDigest must be supplied together.',
    tr: 'flowId, revision ve planDigest birlikte sağlanmalıdır.',
  },
  'mcp.start.flow_v2_disabled': {
    en: 'flowId requires config.terminal.run_flow_v2 = true.',
    tr: 'flowId için config.terminal.run_flow_v2 = true gerekir.',
  },
  'mcp.start.lock_already_running': {
    en: 'Run already running (PID {pid}, env: {env}, run: {sprintId}, started: {acquiredAt}). Use force=true to override.',
    tr: 'Run zaten çalışıyor (PID {pid}, env: {env}, run: {sprintId}, başlangıç: {acquiredAt}). Geçersiz kılmak için force=true kullanın.',
  },
  'mcp.start.dry_run_complete': {
    en: 'Dry-run complete. No workers spawned. Review tasks, then call deckent_start without dryRun to execute.',
    tr: 'Dry-run tamamlandı. Worker başlatılmadı. Görevleri inceleyin, ardından çalıştırmak için deckent_start\'ı dryRun olmadan çağırın.',
  },
  'mcp.start.run_started': {
    en: 'Run started in background. Use deckent_status to track progress.',
    tr: 'Run arka planda başlatıldı. İlerlemeyi izlemek için deckent_status kullanın.',
  },
  'mcp.start.estimated_duration_fallback': {
    en: '~10-30 minutes',
    tr: '~10-30 dakika',
  },
  'mcp.start.run_failed_at_phase': {
    en: 'Run failed at phase {phase}: {message}',
    tr: 'Run {phase} fazında başarısız oldu: {message}',
  },
  'mcp.start.phase_unknown': { en: 'unknown', tr: 'bilinmiyor' },
  'mcp.start.cost_limit_warning_title': { en: 'Cost limit warning', tr: 'Maliyet limiti uyarısı' },
  'mcp.status.detail': {
    en: 'Returns agents (active workers with task assignments), progress (done/total, progress bar, ETA), alerts (stale workers, boundary violations, lock issues), job (background job state RUNNING/COMPLETE/FAILED plus sprintId and metrics), agentAssignments and skillAssignments. Safe to call at any time and to poll repeatedly; no prerequisite.',
    tr: 'Şunları döndürür: agents (görev atamalarıyla aktif worker\'lar), progress (tamamlanan/toplam, ilerleme çubuğu, ETA), alerts (bayat worker, sınır ihlali, kilit sorunları), job (arka plan iş durumu RUNNING/COMPLETE/FAILED ile sprintId ve metrikler), agentAssignments ve skillAssignments. Her an çağrılabilir ve tekrar tekrar yoklanabilir; ön koşulu yoktur.',
  },
  'mcp.inspect.detail': {
    en: 'Serves the exact projections the `deckent inspect --json` face serves. Without arguments: the run listing — the current run from the run-status authority plus archived runs from settlement records. With taskId: the task drill-down (task json, plan truncation flag, result evidence, heartbeat, lineage). Read-only; lifecycle always comes from the run-status authority and is never re-inferred here.',
    tr: '`deckent inspect --json` yüzeyinin sunduğu projeksiyonların aynısını sunar. Argümansız: run listesi — run-status authority\'den güncel run ve settlement kayıtlarından arşivlenmiş run\'lar. taskId ile: görev ayrıntısı (task json, plan kırpma bayrağı, result kanıtı, heartbeat, lineage). Salt okunur; yaşam döngüsü daima run-status authority\'den gelir, burada yeniden çıkarsanmaz.',
  },
  'mcp.doctor.detail': {
    en: 'Checks Node.js version, git availability, tmux installation, provider CLI auth, workspace directories (.deckent/, .brain/, .tasks/), brain memory budget, tech-debt level and stale lock files. Returns a healthScore (0-100) with per-check pass/fail status and recommendations. Use it when a run fails unexpectedly, or before starting a new one — fix what it reports, then re-run until healthScore reaches 100.',
    tr: 'Node.js sürümünü, git kullanılabilirliğini, tmux kurulumunu, provider CLI kimlik doğrulamasını, workspace dizinlerini (.deckent/, .brain/, .tasks/), brain bellek bütçesini, teknik borç düzeyini ve bayat kilit dosyalarını denetler. Kontrol başına geçti/kaldı durumu ve önerilerle birlikte healthScore (0-100) döndürür. Bir run beklenmedik şekilde başarısız olduğunda veya yeni bir run öncesi kullanın — bildirilenleri düzeltip healthScore 100 olana dek yeniden çalıştırın.',
  },
  'mcp.retro.detail': {
    en: 'Reads the retrospective from the Memory V2 DB (.brain/memory.db `retro` entries): full content (run ID, task outcomes, GO/NO_GO decisions, learnings, agent performance notes) plus up to 5 extracted highlights. Every run keeps its own retro entry — pass sprintId for an older one.',
    tr: 'Retrospektifi Memory V2 veritabanından (.brain/memory.db `retro` kayıtları) okur: tam içerik (run ID, görev sonuçları, GO/NO_GO kararları, öğrenimler, agent performans notları) ve en fazla 5 öne çıkan madde. Her run kendi retro kaydını tutar — eski bir tanesi için sprintId geçin.',
  },
  'mcp.history.detail': {
    en: 'Reads archived run logs from .brain/sprints/: the last N run markdown logs sorted by run ID, plus a trend analysis (improving/declining/stable) over task completion rates. Use it to understand long-term project health, compare run performance or review past decisions.',
    tr: 'Arşivlenmiş run loglarını .brain/sprints/ dizininden okur: run ID\'ye göre sıralı son N markdown log ve görev tamamlama oranları üzerinden trend analizi (iyileşen/gerileyen/sabit). Uzun vadeli proje sağlığını anlamak, run performanslarını karşılaştırmak veya geçmiş kararları gözden geçirmek için kullanın.',
  },
  'mcp.analyze_project.detail': {
    en: 'Detects language, framework, test framework, build tool, CI system, project size (by file count) and a methodology recommendation, then returns config suggestions such as plan mode and worker count. Useful before init to pick the right configuration, or to verify stack detection. Modifies no files.',
    tr: 'Dili, framework\'ü, test framework\'ünü, build aracını, CI sistemini, proje boyutunu (dosya sayısına göre) ve önerilen metodolojiyi tespit eder; ardından plan modu ve worker sayısı gibi config önerileri döndürür. Doğru yapılandırmayı seçmek için init öncesi ya da stack tespitini doğrulamak için kullanışlıdır. Hiçbir dosyayı değiştirmez.',
  },
  'mcp.sync.detail': {
    en: 'Ensures the AI adapter files (CLAUDE.md, AGENTS.md) import DECKENT.md as the single source of truth. Additive only — prepends the @DECKENT.md reference when missing and never overwrites existing content. Use it when an adapter file loses its Deckent reference after a manual edit or a merge conflict. Requires DECKENT.md to exist (run deckent_init first).',
    tr: 'AI adapter dosyalarının (CLAUDE.md, AGENTS.md) tek doğruluk kaynağı olarak DECKENT.md\'yi içe aktarmasını sağlar. Yalnızca eklemeli — @DECKENT.md referansı eksikse başa ekler, mevcut içeriğin üzerine asla yazmaz. Bir adapter dosyası elle düzenleme veya merge çakışması sonrası Deckent referansını kaybettiğinde kullanın. DECKENT.md\'nin var olmasını gerektirir (önce deckent_init).',
  },
  'mcp.config.detail': {
    en: 'Three actions against .deckent/config.json: "read" returns the fully resolved config (3-layer merge of defaults + global + project); "get" returns one key by dot-notation (e.g. "brain_provider", "max_workers"); "set" writes a key/value pair with validation. Common keys: brain_provider, worker_provider, max_workers, mode, routing_engine.',
    tr: '.deckent/config.json üzerinde üç eylem: "read" tam çözümlenmiş config\'i döndürür (varsayılan + global + proje 3 katmanlı merge); "get" nokta gösterimiyle tek bir anahtarı döndürür (örn. "brain_provider", "max_workers"); "set" doğrulamayla bir anahtar/değer çifti yazar. Sık anahtarlar: brain_provider, worker_provider, max_workers, mode, routing_engine.',
  },
  'mcp.review.detail': {
    en: 'For each task returns selfAssessment (the worker\'s own DONE/GO_WITH_TECH_DEBT/NO_GO), testsPassed, filesChanged, notes and the decision (approved/rejected/pending). GO means complete with passing tests, NO_GO means rework is needed, GO_WITH_TECH_DEBT means done with known follow-up. Use auto=true to approve every DONE task whose tests passed.',
    tr: 'Her görev için şunları döndürür: selfAssessment (worker\'ın kendi DONE/GO_WITH_TECH_DEBT/NO_GO değerlendirmesi), testsPassed, filesChanged, notes ve karar (approved/rejected/pending). GO testleri geçen tamamlanmış işi, NO_GO yeniden çalışma gerektiğini, GO_WITH_TECH_DEBT bilinen takip işiyle tamamlandığını belirtir. Testleri geçen tüm DONE görevlerini otomatik onaylamak için auto=true kullanın.',
  },
  'mcp.run.detail': {
    en: 'Creates a task JSON file and spawns a worker immediately, returning a jobId for tracking — no PLAN/EVALUATE/RETRO phases. Use it for a quick isolated task such as fixing one bug, writing a single test file or updating a doc, and monitor the spawned worker with deckent_status.',
    tr: 'Bir task JSON dosyası oluşturup worker\'ı hemen başlatır ve izleme için jobId döndürür — PLAN/EVALUATE/RETRO fazları yoktur. Tek bir hatayı düzeltmek, tek bir test dosyası yazmak veya bir dokümanı güncellemek gibi hızlı ve izole işler için kullanın; başlatılan worker\'ı deckent_status ile izleyin.',
  },
  'mcp.kill.detail': {
    en: 'Stops one or all running workers: sets task status to PAUSED, removes heartbeat files and releases every file lock the task owns. Use it for a stuck worker (stale heartbeat), a resource hog or a restart. Afterwards run deckent_cleanup to remove task artifacts, then deckent_start. force and userExplicit are pass-through panic-guard bypass markers — even when both are set the bypass is only recorded in the audit trail, and kill still requires explicit user intent.',
    tr: 'Bir veya tüm çalışan worker\'ları durdurur: görev durumunu PAUSED yapar, heartbeat dosyalarını siler ve görevin sahip olduğu tüm dosya kilitlerini serbest bırakır. Takılmış (bayat heartbeat), aşırı kaynak tüketen veya yeniden başlatılması gereken worker\'lar için kullanın. Sonrasında görev artefaktlarını temizlemek için deckent_cleanup, ardından deckent_start çalıştırın. force ve userExplicit yalnızca aktarılan panic-guard bypass işaretleridir — ikisi de verilse bile bypass sadece audit trail\'e yazılır ve kill yine açık kullanıcı iradesi gerektirir.',
  },
  'mcp.cleanup.detail': {
    en: 'Deletes every task file (.json, .plan, .hb, .result, .paused, .log) from .tasks/ and every lock file from .locks/. With decay=true it also runs memory decay on .brain/ files that exceed the line budget (trimming MEMORY.md, RETRO.md and run logs). Use dryRun=true first to preview exactly what would be deleted. Typically run after deckent_review, or before a fresh run following a kill.',
    tr: '.tasks/ dizinindeki tüm görev dosyalarını (.json, .plan, .hb, .result, .paused, .log) ve .locks/ dizinindeki tüm kilit dosyalarını siler. decay=true ile satır bütçesini aşan .brain/ dosyalarında bellek decay\'i de çalıştırır (MEMORY.md, RETRO.md ve run loglarını kırpar). Neyin silineceğini görmek için önce dryRun=true kullanın. Genellikle deckent_review sonrası veya bir kill\'in ardından yeni run öncesi çalıştırılır.',
  },
  'mcp.help.detail': {
    en: 'Returns version, initialization state, run status, agent/skill counts, routing engine, available workflows, a recommended next action and the full tool + resource catalog. Use it when you are unsure what to do next or want to understand Deckent\'s capabilities.',
    tr: 'Sürümü, başlatma durumunu, run durumunu, agent/skill sayılarını, routing motorunu, kullanılabilir iş akışlarını, önerilen sonraki adımı ve tam araç + kaynak kataloğunu döndürür. Sonraki adımdan emin değilseniz veya Deckent\'in yeteneklerini anlamak istiyorsanız kullanın.',
  },
  'mcp.agent_list.detail': {
    en: 'Serves the same read model `deckent agent list` renders, so both surfaces always agree. Each record carries the four catalog facets kept separate: enabled (owner intent), routable (dispatchable now, with typed reasons), validity (schema conformance) and provenance (declared source, observed layer, resolved path). Records the resolver rejected are reported as validity "invalid" with the resolver diagnostics rather than silently dropped; archived records are never listed.',
    tr: '`deckent agent list` komutunun render ettiği read model\'in aynısını sunar, böylece iki yüzey daima uyuşur. Her kayıt ayrı tutulan dört katalog yüzünü taşır: enabled (owner iradesi), routable (şu an dispatch edilebilir mi, tipli gerekçelerle), validity (şema uyumu) ve provenance (bildirilen kaynak, gözlenen katman, çözümlenen yol). Resolver\'ın reddettiği kayıtlar sessizce düşürülmez, resolver tanılarıyla birlikte validity "invalid" olarak bildirilir; arşivlenmiş kayıtlar hiç listelenmez.',
  },
  'mcp.skill_list.detail': {
    en: 'Returns id, name, category and trigger keywords for each skill, read from the .deckent/skills/ directory. Use it to see which skills are available for task routing, check skill coverage or audit skill assignments before planning a run.',
    tr: 'Her skill için id, ad, kategori ve tetikleyici anahtar kelimeleri .deckent/skills/ dizininden okuyarak döndürür. Görev yönlendirmesi için hangi skill\'lerin kullanılabilir olduğunu görmek, skill kapsamını denetlemek veya run planlamadan önce skill atamalarını gözden geçirmek için kullanın.',
  },
  'mcp.checkpoint.detail': {
    en: 'Checkpoints pause run execution at configured phases (plan/evaluate/fix) until a human approves or rejects. Use action=list to see what is pending, and action=approve or action=reject with sprintId and phase to respond.',
    tr: 'Checkpoint\'ler run yürütmesini yapılandırılmış fazlarda (plan/evaluate/fix) bir insan onaylayana veya reddedene dek duraklatır. Bekleyenleri görmek için action=list, yanıt vermek için sprintId ve phase ile action=approve veya action=reject kullanın.',
  },
  'mcp.docs.detail': {
    en: 'Actions: "add" registers a file, "remove" unregisters it, "list" shows all, "update" modifies section rules, "run" triggers doc updates without a run, "track-scan" performs a DB-only doc-tracking scan (hash + DCR + stale) and "track-status" lists tracked doc health. Auto sections receive generated content (metrics, debt, history); protected sections are never touched.',
    tr: 'Eylemler: "add" bir dosyayı kaydeder, "remove" kaydını siler, "list" tümünü gösterir, "update" bölüm kurallarını değiştirir, "run" run olmadan doküman güncellemelerini tetikler, "track-scan" yalnızca DB üzerinden doküman izleme taraması yapar (hash + DCR + bayatlık) ve "track-status" izlenen doküman sağlığını listeler. Auto bölümler üretilen içerikle (metrikler, borç, geçmiş) güncellenir; korumalı bölümlere asla dokunulmaz.',
  },
  'mcp.explain.detail': {
    en: 'Reads the run log from .brain/sprints/ and the retrospective from the Memory V2 DB to summarise goal, task outcomes (completed/failed/tech debt), duration and key learnings. Use it right after a run for a quick overview. Supports a specific run lookup, verbose mode for full detail and JSON output.',
    tr: 'Run logunu .brain/sprints/ dizininden ve retrospektifi Memory V2 veritabanından okuyarak hedefi, görev sonuçlarını (tamamlandı/başarısız/teknik borç), süreyi ve temel öğrenimleri özetler. Bir run\'ın hemen ardından hızlı bakış için kullanın. Belirli bir run sorgusunu, tam ayrıntı için verbose modu ve JSON çıktısını destekler.',
  },
  'mcp.memory_query.detail': {
    en: 'Use it when you need context about a past decision or how something was done. Supports full-text search with Turkish normalisation, type and status filters, and a run range.',
    tr: 'Geçmiş bir karar veya bir işin nasıl yapıldığı hakkında bağlama ihtiyaç duyduğunuzda kullanın. Türkçe normalleştirmeli tam metin arama, tür ve durum filtreleri ile run aralığı destekler.',
  },
  'mcp.watch.detail': {
    en: 'On this surface the stream is delivered as MCP logging notifications: an initial backfill of recent events followed by new events pushed as they arrive. Auto-unsubscribes on client disconnect or error.',
    tr: 'Bu yüzeyde akış MCP logging bildirimleri olarak iletilir: önce yakın geçmiş olaylarının backfill\'i, ardından geldikçe iletilen yeni olaylar. İstemci bağlantısı koptuğunda veya hata oluştuğunda abonelik kendiliğinden sonlanır.',
  },
  'mcp.nervous_subscribe.desc': {
    en: 'Subscribe to Nervous System notifications for the current run. Registers this MCP client for push notifications and surfaces currently pending PanicGuard kill approvals as PANIC_GUARD_KILL_PENDING events.',
    tr: 'Güncel run için Nervous System bildirimlerine abone olun. Bu MCP istemcisini push bildirimlerine kaydeder ve bekleyen PanicGuard kill onaylarını PANIC_GUARD_KILL_PENDING olayları olarak yüzeye çıkarır.',
  },
  'mcp.nervous_accept.detail': {
    en: 'The action is then executed by the Executor. An id of the form "panic:<taskId>" approves a PanicGuard-blocked kill.',
    tr: 'Aksiyon ardından Executor tarafından çalıştırılır. "panic:<taskId>" biçimindeki bir id, PanicGuard tarafından engellenmiş bir kill\'i onaylar.',
  },
  'mcp.nervous_reject.detail': {
    en: 'The action will NOT be executed. A reason may optionally be supplied.',
    tr: 'Aksiyon çalıştırılmayacaktır. İsteğe bağlı olarak bir gerekçe verilebilir.',
  },
  'mcp.nervous_status.desc': {
    en: 'Show the Nervous System dashboard: pending notifications, recent history and the current configuration.',
    tr: 'Nervous System panosunu gösterin: bekleyen bildirimler, yakın geçmiş ve güncel yapılandırma.',
  },
  'mcp.nervous_config.detail': {
    en: 'Reads or modifies the authority mode preset and the per-action overrides, and lists the available actions.',
    tr: 'Yetki modu ön ayarını ve aksiyon bazlı override\'ları okur veya değiştirir, ayrıca kullanılabilir aksiyonları listeler.',
  },
  'mcp.feature_query.detail': {
    en: 'Lists features by category (active, lightly_used, dormant, dead, all) or looks one up by ID, returning metadata including files, description and category. Reads .deckent/settings/features-manifest.json; regenerate it with `node scripts/sync-manifest.mjs`.',
    tr: 'Özellikleri kategoriye göre (active, lightly_used, dormant, dead, all) listeler veya ID ile tek bir özelliği getirir; dosyalar, açıklama ve kategori dahil meta veriyi döndürür. .deckent/settings/features-manifest.json dosyasını okur; yeniden üretmek için `node scripts/sync-manifest.mjs` çalıştırın.',
  },
  'mcp.truth.detail': {
    en: 'Covers every truth-block declared in .deckent/settings/features-manifest.json and flags half-wire candidates (code shipped but no production call-site). Read-only. Pass check=true to also diff those candidates against the pinned .deckent/truth-baseline.json ratchet.',
    tr: '.deckent/settings/features-manifest.json içinde bildirilen her truth-block\'u kapsar ve half-wire adaylarını (kod var ama production çağrı noktası yok) işaretler. Salt okunur. Bu adayları sabitlenmiş .deckent/truth-baseline.json ratchet\'iyle karşılaştırmak için check=true geçin.',
  },
  'mcp.audit.detail': {
    en: 'action="gate" (default) runs the Brain Self-Audit Gate for a run — tsc, vitest, honesty and observability checks — returning PASS or GATE_FAILURE and writing .deckent/<sprintId>-gate.json. action="query" filters audit-log events by channel/tenant with an optional limit. action="compliance" builds a compliance report (audit-chain integrity, RBAC, tenant isolation) over the retained trail. action="retention" plans retention via keepDays/keepCount and is dry-run by default with ZERO writes; apply=true is DESTRUCTIVE — it archives the planned partition and permanently deletes pruned events from the run event stream. The CLI "forward" subcommand (SIEM export) is intentionally not exposed over MCP because it requires network egress.',
    tr: 'action="gate" (varsayılan) bir run için Brain Self-Audit Gate\'i çalıştırır — tsc, vitest, dürüstlük ve gözlemlenebilirlik kontrolleri — PASS veya GATE_FAILURE döndürür ve .deckent/<sprintId>-gate.json dosyasını yazar. action="query" audit-log olaylarını kanal/tenant ile, isteğe bağlı limitle filtreler. action="compliance" saklanan iz üzerinden uyumluluk raporu üretir (audit-chain bütünlüğü, RBAC, tenant izolasyonu). action="retention" keepDays/keepCount ile saklama planlar ve varsayılan olarak dry-run\'dır, HİÇBİR yazma yapmaz; apply=true DESTRUCTIVE\'dir — planlanan bölümü arşivler ve budanan olayları run olay akışından kalıcı olarak siler. CLI\'daki "forward" alt komutu (SIEM dışa aktarımı) ağ çıkışı gerektirdiği için MCP üzerinde bilinçli olarak sunulmaz.',
  },
  'mcp.recover.detail': {
    en: 'Runs the audit, cleans orphan IPC directories (dead PIDs only), clears stale locks (>5 min) and archives terminal task files while preserving active tasks. Use dryRun=true to preview first. DESTRUCTIVE: it modifies .tasks/, .locks/ and .deckent/.',
    tr: 'Audit\'i çalıştırır, öksüz IPC dizinlerini (yalnız ölü PID\'ler) temizler, bayat kilitleri (>5 dk) kaldırır ve terminal görev dosyalarını arşivlerken aktif görevleri korur. Önce önizlemek için dryRun=true kullanın. DESTRUCTIVE: .tasks/, .locks/ ve .deckent/ dizinlerini değiştirir.',
  },
  'mcp.models.detail': {
    en: 'Actions: "list" lists available models (optionally filtered by provider); "refresh" force-refreshes the catalog from models.dev and invalidates the 24h cache; "tier" looks up a model\'s tier (premium_plus/premium/standard/economy). Catalog sources: remote (models.dev live), cache (~/.deckent/cache/models-catalog.json, 24h TTL) and bundled (offline fallback).',
    tr: 'Eylemler: "list" kullanılabilir modelleri listeler (isteğe bağlı provider filtresiyle); "refresh" kataloğu models.dev üzerinden zorla yeniler ve 24 saatlik önbelleği geçersiz kılar; "tier" bir modelin katmanını (premium_plus/premium/standard/economy) getirir. Katalog kaynakları: uzak (models.dev canlı), önbellek (~/.deckent/cache/models-catalog.json, 24 saat TTL) ve gömülü (çevrimdışı yedek).',
  },
  'mcp.autonomous.detail': {
    en: 'Query status, start or stop the loop, manage the backlog (add/list/remove) and resolve approval gates (pending/approve/reject). "start" spawns the real loop as a DETACHED background process and never blocks this MCP stdio transport — it reports spawned=false with an honest reason instead of spawning when autonomous.enabled is not true in project config, or when a previously spawned loop is still alive.',
    tr: 'Durumu sorgular, döngüyü başlatır veya durdurur, backlog\'u yönetir (add/list/remove) ve onay kapılarını çözer (pending/approve/reject). "start" gerçek döngüyü DETACHED bir arka plan süreci olarak başlatır ve bu MCP stdio taşımasını asla bloke etmez — proje config\'inde autonomous.enabled true değilse veya daha önce başlatılmış bir döngü hâlâ canlıysa başlatmak yerine dürüst bir gerekçeyle spawned=false bildirir.',
  },
  'mcp.process.detail': {
    en: 'action=submit injects an ExecutionRequest that is policy-gated — read-only capabilities auto-run while side-effecting ones park for approval; action=status and action=result poll a prior submission by executionId.',
    tr: 'action=submit, policy ile kapılanan bir ExecutionRequest enjekte eder — salt okunur yetenekler kendiliğinden çalışır, yan etkili olanlar onay için park edilir; action=status ve action=result önceki bir gönderimi executionId ile yoklar.',
  },
  'mcp.usage.detail': {
    en: 'Default: a last-7-day model-level summary (calls, tokens, limit-cost, cache hit%). With sprint: the per-task breakdown plus the cache-gate report for that run. With lineage: the canonical logical-root usage/billing aggregate (the same authority as core/lineage-usage-authority.ts) projected for caller-supplied tasks and attempts — no MCP-side billing recalculation.',
    tr: 'Varsayılan: son 7 günün model düzeyinde özeti (çağrı, token, limit maliyeti, önbellek isabet %). sprint ile: o run için görev bazlı döküm ve cache-gate raporu. lineage ile: canonical logical-root kullanım/faturalama toplamı (core/lineage-usage-authority.ts ile aynı authority) çağıranın verdiği görev ve denemeler için projekte edilir — MCP tarafında yeniden faturalama hesabı yapılmaz.',
  },
  'mcp.xverify.detail': {
    en: 'Both interactive sessions can call the advisory referee in-band: the verifier is always chosen to DIFFER from the declared author. Provider output is evidence only — the host derives CONFIRMED/REFUTED/UNCLEAR plus the authoritative ALLOW/NO-GO/HOLD disposition.',
    tr: 'Her iki etkileşimli oturum da danışma hakemini hat içinde çağırabilir: doğrulayıcı daima bildirilen yazardan FARKLI seçilir. Sağlayıcı çıktısı yalnızca kanıttır — CONFIRMED/REFUTED/UNCLEAR ile yetkili ALLOW/NO-GO/HOLD disposition\'ını host türetir.',
  },
  'mcp.kpi.detail': {
    en: 'Scorecard (default) returns { sprintId, kpis } with cost, token, cache, retry, completion and quality metrics. With the trend argument it returns { kpiId, series: [{ periodKey, value, status }] }. Delegates to KpiService as the single source; read-only.',
    tr: 'Karne (varsayılan) maliyet, token, önbellek, yeniden deneme, tamamlanma ve kalite metrikleriyle { sprintId, kpis } döndürür. trend argümanıyla { kpiId, series: [{ periodKey, value, status }] } döndürür. Tek kaynak olarak KpiService\'e devreder; salt okunur.',
  },
  'mcp.cost.detail': {
    en: 'Returns budget limits, per-model pricing (input/output per MTok) and today\'s spend from the resource log. Delegates to the project cost-config single source; read-only, with no cost math reimplemented here.',
    tr: 'Bütçe limitlerini, model başına fiyatlandırmayı (MTok başına giriş/çıkış) ve kaynak logundan bugünkü harcamayı döndürür. Proje cost-config tek kaynağına devreder; salt okunur, burada maliyet hesabı yeniden uygulanmaz.',
  },
  'mcp.agent_manage.desc': {
    en: 'Manage the agent pool: add a custom agent, remove one, or promote a temp agent (generated for a run under .tasks/agents/) into the persistent pool at .deckent/agents/temp-<id>/. Uses the existing AgentPoolManager API — no new agent lifecycle concept. See also deckent_agent_list for read-only listing.',
    tr: 'Agent havuzunu yönetin: özel bir agent ekleyin, birini kaldırın veya geçici bir agent\'ı (bir run için .tasks/agents/ altında üretilmiş) .deckent/agents/temp-<id>/ kalıcı havuzuna terfi ettirin. Mevcut AgentPoolManager API\'sini kullanır — yeni bir agent yaşam döngüsü kavramı getirmez. Salt okunur listeleme için ayrıca deckent_agent_list.',
  },
  'mcp.skill_manage.desc': {
    en: 'Manage the skill pool: add a custom skill, remove one, or list the skills available in the marketplace registry (falling back to the local .deckent/skills/ listing when the registry is unreachable). Uses the existing SkillPoolManager and RegistryClient APIs. See also deckent_skill_list for read-only local listing.',
    tr: 'Skill havuzunu yönetin: özel bir skill ekleyin, birini kaldırın veya marketplace registry\'sinde kullanılabilir skill\'leri listeleyin (registry erişilemezse yerel .deckent/skills/ listesine düşer). Mevcut SkillPoolManager ve RegistryClient API\'lerini kullanır. Salt okunur yerel listeleme için ayrıca deckent_skill_list.',
  },
  'mcp.memory_manage.desc': {
    en: 'Manage project memory: insert a new entry, update fields on an existing entry, or trigger decay (soft-deleting entries older than the retention window). Uses the existing MemoryStore public API directly against .brain/memory.db. See also deckent_memory_query for read-only search.',
    tr: 'Proje belleğini yönetin: yeni kayıt ekleyin, mevcut bir kaydın alanlarını güncelleyin veya decay tetikleyin (saklama penceresinden eski kayıtları soft-delete eder). Mevcut MemoryStore genel API\'sini doğrudan .brain/memory.db üzerinde kullanır. Salt okunur arama için ayrıca deckent_memory_query.',
  },
  'mcp.autonomous_backlog.detail': {
    en: 'Operates on .deckent/autonomous/backlog.json: list entries, add a one-off or recurring task entry, or remove an entry by id. Talks directly to the orchestra/autonomous/backlog.ts durable store (loadBacklog / validateBacklogEntry / atomic write) with no cli/ layer dependency (ADR-D-004 C3). See also deckent_autonomous_status and deckent_autonomous.',
    tr: '.deckent/autonomous/backlog.json üzerinde çalışır: kayıtları listeler, tek seferlik veya yinelenen bir görev kaydı ekler ya da id ile bir kaydı kaldırır. cli/ katmanına bağımlı olmadan doğrudan orchestra/autonomous/backlog.ts kalıcı deposuyla konuşur (loadBacklog / validateBacklogEntry / atomik yazma; ADR-D-004 C3). Ayrıca deckent_autonomous_status ve deckent_autonomous.',
  },
  'mcp.autonomous_status.detail': {
    en: 'Read-only: backlog totals by status, stop-marker presence and the pending-approval count, read straight from .deckent/autonomous/{backlog.json,stop,pending.json} with no engine process contact — the same stateless shape as deckent_autonomous action=status. See also deckent_autonomous_backlog for backlog mutation.',
    tr: 'Salt okunur: duruma göre backlog toplamları, stop işaretçisinin varlığı ve bekleyen onay sayısı; doğrudan .deckent/autonomous/{backlog.json,stop,pending.json} dosyalarından, motor süreciyle temas kurmadan okunur — deckent_autonomous action=status ile aynı durumsuz şekil. Backlog değişikliği için ayrıca deckent_autonomous_backlog.',
  },
  'mcp.nervous_edit.detail': {
    en: 'Builds an accept-with-edited-payload PLAN for a pending Nervous System notification and returns the plan only — nothing is executed here; applying it is a separate injectable step (nervous-bridge.ts applyNervousBridgePlan).',
    tr: 'Bekleyen bir Nervous System bildirimi için düzenlenmiş-payload ile kabul PLANI üretir ve yalnız planı döndürür — burada hiçbir şey çalıştırılmaz; planı uygulamak ayrı ve enjekte edilebilir bir adımdır (nervous-bridge.ts applyNervousBridgePlan).',
  },
  'mcp.nervous_undo.detail': {
    en: 'Builds an undo PLAN for the most recent reversible accepted action, or for a specific record id, and returns { supported: false, reason } when nothing undoable is found. Plan-only — never mutates the audit trail.',
    tr: 'En son geri alınabilir kabul edilmiş aksiyon için ya da belirli bir kayıt id\'si için geri alma PLANI üretir; geri alınabilir bir şey bulunmazsa { supported: false, reason } döndürür. Yalnız plan — audit trail\'i asla değiştirmez.',
  },
  'mcp.autonomous_approve.detail': {
    en: 'Targets a backlog entry parked by the G2/G3 policy gate as `policy: approval-required`, or any other parked trigger id. Exec-free: records the accept decision to .deckent/autonomous/{pending.json,decisions.json} through the approval-adapter public API; the running loop replays the trigger on its next cycle. Nothing is executed here. See also deckent_autonomous_reject and deckent_autonomous action=pending.',
    tr: 'G2/G3 policy gate\'i tarafından `policy: approval-required` olarak park edilmiş bir backlog kaydını veya park edilmiş herhangi bir tetikleyici id\'sini hedefler. Çalıştırma içermez: kabul kararını approval-adapter genel API\'si üzerinden .deckent/autonomous/{pending.json,decisions.json} dosyalarına yazar; çalışan döngü tetikleyiciyi bir sonraki turunda yeniden oynatır. Burada hiçbir şey çalıştırılmaz. Ayrıca deckent_autonomous_reject ve deckent_autonomous action=pending.',
  },
  'mcp.autonomous_reject.detail': {
    en: 'Targets a backlog entry parked by the G2/G3 policy gate as `policy: approval-required`, or any other parked trigger id. Exec-free: records the reject decision to .deckent/autonomous/{pending.json,decisions.json} through the approval-adapter public API; the running loop then never replays the trigger. Nothing is executed here. See also deckent_autonomous_approve and deckent_autonomous action=pending.',
    tr: 'G2/G3 policy gate\'i tarafından `policy: approval-required` olarak park edilmiş bir backlog kaydını veya park edilmiş herhangi bir tetikleyici id\'sini hedefler. Çalıştırma içermez: ret kararını approval-adapter genel API\'si üzerinden .deckent/autonomous/{pending.json,decisions.json} dosyalarına yazar; çalışan döngü tetikleyiciyi bir daha oynatmaz. Burada hiçbir şey çalıştırılmaz. Ayrıca deckent_autonomous_approve ve deckent_autonomous action=pending.',
  },
  'mcp.execution_authority.detail': {
    en: 'On this surface the reconcile path is limited to namespace-local Linux/WSL mount metadata and never changes execution authority itself. Dry-run by default; pass apply=true to write the reconciled mount metadata.',
    tr: 'Bu yüzeyde uzlaştırma yolu namespace-local Linux/WSL mount metadata\'sıyla sınırlıdır ve execution authority\'nin kendisini asla değiştirmez. Varsayılan dry-run\'dır; uzlaştırılmış mount metadata\'sını yazmak için apply=true geçin.',
  },
  'mcp.approvals.detail': {
    en: 'Serves the canonical ApprovalBroker read model — the SAME source as the CLI — and returns each pending request id, summary and expiry. READ-ONLY: this surface never decides, allows or denies. Deciding stays CLI-only behind an interactive live-authenticated TTY, so there is no self-approval path over MCP.',
    tr: 'Canonical ApprovalBroker read model\'ini sunar — CLI ile AYNI kaynak — ve bekleyen her isteğin id\'sini, özetini ve son geçerlilik zamanını döndürür. SALT OKUNUR: bu yüzey asla karar vermez, izin vermez veya reddetmez. Karar vermek yalnız CLI\'da, etkileşimli canlı kimlik doğrulamalı TTY arkasında kalır; MCP üzerinden self-approval yolu yoktur.',
  },

  // ─── cost gate result/warning messages (task 591-001) ─────────────────
  // Human-readable sentences for src/core/cost-gate.ts. Typed codes
  // (COST_GATE_EXCEEDED, COST_PRICING_UNKNOWN, ceilingTripped, …) stay as-is —
  // only the prose `message` fields resolve through this family.
  'cost_gate.pricing_unknown': {
    en: 'Pricing evidence is unavailable for model(s): {models}. Supply fresh provider/model pricing evidence before execution; acknowledgeCost does not override unknown pricing.',
    tr: 'Model(ler) için fiyatlandırma kanıtı mevcut değil: {models}. Çalıştırmadan önce güncel sağlayıcı/model fiyatlandırma kanıtı sağlayın; acknowledgeCost bilinmeyen fiyatlandırmayı geçersiz kılmaz.',
  },
  'cost_gate.token_limit_exceeded': {
    en: 'Sprint estimated {estimatedTokens} tokens exceeds per-request token limit {budgetTokens}. Raise the request budget.maxTokens or set acknowledgeCost=true (MCP) / --force (CLI).',
    tr: 'Sprint tahmini {estimatedTokens} token, istek başına token limiti {budgetTokens} değerini aşıyor. İstek budget.maxTokens değerini artırın veya acknowledgeCost=true (MCP) / --force (CLI) ayarlayın.',
  },
  'cost_gate.budget_exceeded_sprint': {
    en: 'Sprint cost {estimatedUsd} exceeds budget {budgetUsd}. Override with acknowledgeCost=true (MCP) / --force (CLI) or raise cost_limits.sprint_max_usd in .deckent/cost-config.json.',
    tr: 'Sprint maliyeti {estimatedUsd}, bütçe {budgetUsd} değerini aşıyor. acknowledgeCost=true (MCP) / --force (CLI) ile geçersiz kılın veya .deckent/cost-config.json içindeki cost_limits.sprint_max_usd değerini artırın.',
  },
  'cost_gate.budget_exceeded_request': {
    en: 'Sprint cost {estimatedUsd} exceeds budget {budgetUsd} (per-request limit). Raise the request budget.maxUsd or set acknowledgeCost=true (MCP) / --force (CLI).',
    tr: 'Sprint maliyeti {estimatedUsd}, bütçe {budgetUsd} (istek başına limit) değerini aşıyor. İstek budget.maxUsd değerini artırın veya acknowledgeCost=true (MCP) / --force (CLI) ayarlayın.',
  },
  'cost_gate.spend_warn_day': {
    en: 'Projected daily spend {projected} exceeds daily limit {limit} (spent {spent} + sprint estimate {sprintEstimate}).',
    tr: 'Öngörülen günlük harcama {projected}, günlük limit {limit} değerini aşıyor (harcanan {spent} + sprint tahmini {sprintEstimate}).',
  },
  'cost_gate.spend_warn_month': {
    en: 'Projected monthly spend {projected} exceeds monthly limit {limit} (spent {spent} + sprint estimate {sprintEstimate}).',
    tr: 'Öngörülen aylık harcama {projected}, aylık limit {limit} değerini aşıyor (harcanan {spent} + sprint tahmini {sprintEstimate}).',
  },

  // ─── scope gate result/reason messages (task 591-003) ─────────────────
  // Human-readable sentences for src/core/scope-gate.ts. Typed codes
  // (SCOPE_GATE_SUSPECT, ScopePathClass values, etc.) stay as-is — only the
  // prose `reason`/`message`/`greenfieldNotice` fields resolve through this family.
  'disposition.remediation.forced_skill_unavailable': {
    en: 'Create or activate the required skill before retrying this task.',
    tr: 'Bu görevi yeniden denemeden önce gerekli skill’i oluşturun veya etkinleştirin.',
  },
  'disposition.remediation.provider_adapter_unavailable': {
    en: 'Restore provider authentication or access before retrying this task.',
    tr: 'Bu görevi yeniden denemeden önce provider kimlik doğrulamasını veya erişimini geri yükleyin.',
  },
  'disposition.remediation.default': {
    en: 'Resolve the host-side admission issue before retrying this task.',
    tr: 'Bu görevi yeniden denemeden önce host tarafındaki kabul sorununu çözün.',
  },
  'disposition.notification.title': {
    en: 'Task {taskId} was not dispatched',
    tr: 'Görev {taskId} dispatch edilmedi',
  },
  'disposition.notification.message': {
    en: 'Reason: {reasonCode}. Disposition: {disposition}. Next step: {remediationHint}',
    tr: 'Neden: {reasonCode}. Disposition: {disposition}. Sonraki adım: {remediationHint}',
  },
  'scope_gate.reason.confirmed': {
    en: 'exists in the repo',
    tr: 'repoda mevcut',
  },
  'scope_gate.reason.glob_confirmed': {
    en: 'scope pattern matching {count} tracked file(s)',
    tr: 'scope pattern {count} takip edilen dosya ile eşleşiyor',
  },
  'scope_gate.reason.glob_no_match': {
    en: 'glob pattern matches no tracked file — likely a wrong-directory pattern',
    tr: 'glob pattern hiçbir takip edilen dosyayla eşleşmiyor — muhtemelen yanlış dizin pattern\'i',
  },
  'scope_gate.reason.parallel_tree_mirror': {
    en: 'parallel-tree mirror: this task declared both this directory and the directory holding the same-named file',
    tr: 'paralel-ağaç yansıması: bu görev hem bu dizini hem de aynı isimli dosyayı barındıran dizini bildirdi',
  },
  'scope_gate.reason.wrong_dir_suggestion': {
    en: 'no such file; a file with the same name exists at {suggestion}',
    tr: 'böyle bir dosya yok; aynı isimde bir dosya {suggestion} konumunda mevcut',
  },
  'scope_gate.reason.new_plausible': {
    en: 'new file in an existing directory',
    tr: 'mevcut bir dizinde yeni dosya',
  },
  'scope_gate.reason.greenfield': {
    en: 'greenfield repo (no tracked directories) — path validation has no signal',
    tr: 'greenfield repo (takip edilen dizin yok) — yol doğrulamasının sinyali yok',
  },
  'scope_gate.reason.intentional_new_dir': {
    en: 'new directory \'{parent}\' — no such directory yet, but its established tracked ancestor \'{ancestor}\' ({count} tracked files) makes this look like an intentional new directory, not a typo (WARN, not blocked)',
    tr: 'yeni dizin \'{parent}\' — henüz böyle bir dizin yok, ancak yerleşik takip edilen üst dizini \'{ancestor}\' ({count} takip edilen dosya) bunun bir yazım hatası değil kasıtlı yeni bir dizin olduğunu gösteriyor (UYARI, engellenmedi)',
  },
  'scope_gate.reason.invented_dir': {
    en: 'no such file and its directory \'{parent}\' is not in the repo',
    tr: 'böyle bir dosya yok ve \'{parent}\' dizini repoda değil',
  },
  'scope_gate.reason.directory_in_files_write': {
    en: 'this path is a tracked directory, but filesWrite accepts exact file paths only',
    tr: 'bu yol takip edilen bir dizin; ancak filesWrite yalnız exact dosya yollarını kabul eder',
  },
  'scope_gate.resolution.drop_duplicate': {
    en: 'duplicate of \'{suggestion}\', already planned as a write in the same task',
    tr: '\'{suggestion}\' ile aynı; aynı görevde zaten yazma olarak planlanmış',
  },
  'scope_gate.resolution.auto_replace': {
    en: 'unambiguous — \'{suggestion}\' is the only tracked file with this basename',
    tr: 'net — \'{suggestion}\' bu basename\'e sahip tek takip edilen dosya',
  },
  'scope_gate.message.header': {
    en: 'Scope gate: {count} write path(s) do not exist and look like a typo or wrong directory:',
    tr: 'Scope gate: {count} yazma yolu mevcut değil ve yazım hatası veya yanlış dizin gibi görünüyor:',
  },
  'scope_gate.message.hint_suggestion': {
    en: ' → did you mean \'{suggestion}\'?',
    tr: ' → şunu mu demek istediniz: \'{suggestion}\'?',
  },
  'scope_gate.message.more_suspects': {
    en: '… and {count} more',
    tr: '… ve {count} tane daha',
  },
  'scope_gate.message.footer': {
    en: 'If these are intentional new files, override with acknowledgeScopePaths=true (MCP) / --force-scope (CLI). If a path should be an existing file, fix the DIRECTIVES scope before spawning.',
    tr: 'Bunlar kasıtlı yeni dosyalarsa, acknowledgeScopePaths=true (MCP) / --force-scope (CLI) ile geçersiz kılın. Bir yol mevcut bir dosya olmalıysa, spawn etmeden önce DIRECTIVES scope\'unu düzeltin.',
  },
  'scope_gate.message.directory_in_files_write_header': {
    en: 'Scope gate: {count} filesWrite path(s) resolve to directories and cannot enter dispatch:',
    tr: 'Scope gate: {count} filesWrite yolu dizine çözümleniyor ve dispatch aşamasına giremez:',
  },
  'scope_gate.message.directory_in_files_write_footer': {
    en: 'Move each directory to scope.directories or replace it with exact file paths. --force-scope cannot override this structural error.',
    tr: 'Her dizini scope.directories alanına taşıyın veya exact dosya yollarıyla değiştirin. --force-scope bu yapısal hatayı geçersiz kılamaz.',
  },
  'scope_gate.notice.greenfield': {
    en: 'Scope gate: greenfield repo (no tracked directories) — {count} write path(s) could not be validated against tracked files; proceeding advisory-only (born-584).',
    tr: 'Scope gate: greenfield repo (takip edilen dizin yok) — {count} yazma yolu takip edilen dosyalara karşı doğrulanamadı; sadece danışma amaçlı devam ediliyor (born-584).',
  },
  // ─── batch surface contract (702-001) ───────────────────────────────────
  'cli.batch.deprecated_forwarding': {
    en: 'Command "{oldCommand}" is deprecated; use "{replacement}" instead.',
    tr: '"{oldCommand}" komutu kullanımdan kaldırılıyor; bunun yerine "{replacement}" kullanın.',
  },
  'cli.batch.deprecated.dashboard': { en: 'Command "dashboard" is deprecated; use "status --watch" instead.', tr: '"dashboard" komutu kullanımdan kaldırılıyor; bunun yerine "status --watch" kullanın.' },
  'cli.batch.deprecated.attach': { en: 'Command "attach" is deprecated; use "watch" instead.', tr: '"attach" komutu kullanımdan kaldırılıyor; bunun yerine "watch" kullanın.' },
  'cli.batch.deprecated.output': { en: 'Command "output" is deprecated; use "watch --logs" instead.', tr: '"output" komutu kullanımdan kaldırılıyor; bunun yerine "watch --logs" kullanın.' },
  'cli.batch.deprecated.plan_nl': { en: 'Command "plan-nl" is deprecated; use "do" instead.', tr: '"plan-nl" komutu kullanımdan kaldırılıyor; bunun yerine "do" kullanın.' },
  'cli.batch.deprecated.archive_debt': { en: 'Command "archive-debt" is deprecated; use "status --debt" instead.', tr: '"archive-debt" komutu kullanımdan kaldırılıyor; bunun yerine "status --debt" kullanın.' },
  'cli.batch.deprecated.confirmations': { en: 'Command "confirmations" is deprecated; use "approvals" instead.', tr: '"confirmations" komutu kullanımdan kaldırılıyor; bunun yerine "approvals" kullanın.' },
  'cli.batch.deprecated.checkpoint': { en: 'Command "checkpoint" is deprecated; use "approvals" instead.', tr: '"checkpoint" komutu kullanımdan kaldırılıyor; bunun yerine "approvals" kullanın.' },
  'cli.batch.deprecated.audit_verify': { en: 'Command "audit-verify" is deprecated; use "audit verify" instead.', tr: '"audit-verify" komutu kullanımdan kaldırılıyor; bunun yerine "audit verify" kullanın.' },
  'cli.batch.deprecated.autonomous_mission': { en: 'Command "autonomous-mission" is deprecated; use "autonomous mission" instead.', tr: '"autonomous-mission" komutu kullanımdan kaldırılıyor; bunun yerine "autonomous mission" kullanın.' },
  'cli.batch.deprecated.explain': { en: 'Command "explain" is deprecated; use "retro --explain" instead.', tr: '"explain" komutu kullanımdan kaldırılıyor; bunun yerine "retro --explain" kullanın.' },
  'cli.batch.deprecated.recall': { en: 'Command "recall" is deprecated; use "memory recall" instead.', tr: '"recall" komutu kullanımdan kaldırılıyor; bunun yerine "memory recall" kullanın.' },
  'cli.batch.deprecated.remember': { en: 'Command "remember" is deprecated; use "memory remember" instead.', tr: '"remember" komutu kullanımdan kaldırılıyor; bunun yerine "memory remember" kullanın.' },
  'cli.batch.limits.unavailable': { en: 'unavailable', tr: 'kullanılamıyor' },
  'cli.batch.truth.no_proof': { en: '—', tr: '—' },
  'approvals.federated.class.confirmation': { en: 'confirmation', tr: 'confirmation' },
  'approvals.federated.class.autonomous': { en: 'autonomous', tr: 'otonom' },
  'approvals.federated.class.nervous': { en: 'nervous', tr: 'nervous' },
  'approvals.federated.class.panic': { en: 'panic', tr: 'panik' },
  'approvals.federated.class.checkpoint': { en: 'checkpoint', tr: 'checkpoint' },
  'approvals.federated.class.bot': { en: 'bot', tr: 'bot' },
  'approvals.federated.class.pairing': { en: 'pairing', tr: 'eşleşme' },
  'approvals.opt_class': { en: 'Filter the federated inbox by class', tr: 'Federe gelen kutusunu sınıfa göre filtrele' },
  'approvals.class_invalid': { en: 'Unknown approval class "{class}". Choose one of: {valid}.', tr: 'Bilinmeyen onay sınıfı "{class}". Şunlardan birini seçin: {valid}.' },
  'limits.opt_claude': { en: 'Show Claude provider limits', tr: 'Claude sağlayıcı limitlerini göster' },
  'limits.opt_codex': { en: 'Show Codex provider limits', tr: 'Codex sağlayıcı limitlerini göster' },
  'limits.opt_cursor': { en: 'Show Cursor provider limits', tr: 'Cursor sağlayıcı limitlerini göster' },
  'cli.audit.verify.desc': { en: 'Verify the audit log integrity chain', tr: 'Audit log bütünlük zincirini doğrulayın' },
  'cli.autonomous.mission.desc': { en: 'Manage an autonomous mission', tr: 'Otonom bir misyonu yönetin' },
  'cli.memory.recall.desc': { en: 'Recall matching memories', tr: 'Eşleşen anıları geri çağırın' },
  'cli.memory.remember.desc': { en: 'Remember a durable note', tr: 'Kalıcı bir notu hatırlayın' },
  // ─── Intelligence command (707-004) ───────────────────────────────
  'cli.intelligence.desc': {
    en: 'Inspect and run competitor intelligence',
    tr: 'Rakip istihbaratını inceleyin ve çalıştırın',
  },
  'cli.intelligence.watch.desc': {
    en: 'Manage competitor-watch execution',
    tr: 'Rakip izleme çalıştırmasını yönetin',
  },
  'cli.intelligence.watch.run.desc': {
    en: 'Run the canonical competitor-watch capability',
    tr: 'Kanonik rakip izleme yeteneğini çalıştırın',
  },
  'cli.intelligence.watch.run.opt.dry_run': {
    en: 'Preview without persisting events, cursors, or notifications',
    tr: 'Olayları, imleçleri veya bildirimleri kaydetmeden önizleyin',
  },
  'cli.intelligence.watch.run.opt.input': {
    en: 'Read source definitions from a JSON fixture',
    tr: 'Kaynak tanımlarını bir JSON fikstüründen okuyun',
  },
  'cli.intelligence.schedule.desc': {
    en: 'Ensure and report the canonical daily watch flow',
    tr: 'Kanonik günlük izleme akışını sağlayın ve raporlayın',
  },
  'cli.intelligence.status.desc': {
    en: 'Show watch event history and last-run state',
    tr: 'İzleme olay geçmişini ve son çalıştırma durumunu gösterin',
  },
  'cli.intelligence.watch.run.completed': {
    en: 'Watch completed: {alertCount} alerts, {issueCount} issues (dry-run: {dryRun}).',
    tr: 'İzleme tamamlandı: {alertCount} uyarı, {issueCount} sorun (deneme: {dryRun}).',
  },
  'cli.intelligence.watch.run.not_completed': {
    en: 'Watch did not complete: {kind}.',
    tr: 'İzleme tamamlanmadı: {kind}.',
  },
  'cli.intelligence.schedule.registered': {
    en: 'Watch flow registered: {id} ({cron}, {timezone}).',
    tr: 'İzleme akışı kaydedildi: {id} ({cron}, {timezone}).',
  },
  'cli.intelligence.schedule.existing': {
    en: 'Watch flow already registered: {id} ({cron}, {timezone}).',
    tr: 'İzleme akışı zaten kayıtlı: {id} ({cron}, {timezone}).',
  },
  'cli.intelligence.status.summary': {
    en: 'Watch status: {eventCount} events; last run: {lastRun}.',
    tr: 'İzleme durumu: {eventCount} olay; son çalışma: {lastRun}.',
  },
  'cli.intelligence.status.never': {
    en: 'never',
    tr: 'hiç',
  },
  'cli.intelligence.error': {
    en: 'Intelligence command failed: {message}.',
    tr: 'İstihbarat komutu başarısız oldu: {message}.',
  },
  'cli.retro.opt.explain': { en: 'Explain the retrospective task evidence', tr: 'Retrospektif görev kanıtını açıklayın' },
  'cli.retro.opt.task': { en: 'Explain one specific task', tr: 'Belirli bir görevi açıklayın' },
};

/** A separately-authored catalog file merged into the base map. */
export type MessageCatalogFamily = Readonly<Record<string, Readonly<Record<string, string>>>>;

/**
 * Merge family catalogs into the base catalog, REJECTING any key that is
 * already defined (by the base map or by an earlier family). A duplicate key
 * is a real defect — two owners rendering different text for one key — so it
 * throws at module load instead of letting last-write-wins decide silently.
 *
 * Exported for tests: this is the mechanism that lets family catalogs live in
 * separate files without creating cross-task key collisions.
 */
export function mergeMessageFamilies(
  base: MessageMap,
  families: Readonly<Record<string, MessageCatalogFamily>>,
): MessageMap {
  const merged: MessageMap = { ...base };
  const collisions: string[] = [];
  for (const [familyName, family] of Object.entries(families)) {
    for (const [key, row] of Object.entries(family)) {
      if (Object.prototype.hasOwnProperty.call(merged, key)) {
        collisions.push(`${familyName}:${key}`);
        continue;
      }
      merged[key] = { ...row };
    }
  }
  if (collisions.length > 0) {
    throw new Error(`message-catalog family key collision: ${collisions.join(', ')}`);
  }
  return merged;
}

/**
 * Registered catalog families. Add a family here (plus a file under
 * ./message-catalog/) instead of appending to BASE_MESSAGES.
 */
export const MESSAGE_CATALOG_FAMILIES: Readonly<Record<string, MessageCatalogFamily>> = Object.freeze({
  'cli-common': CLI_COMMON_MESSAGES,
  'cli-run': CLI_RUN_MESSAGES,
  'cli-memory-catalog': CLI_MEMORY_CATALOG_MESSAGES,
  'cli-governance': CLI_GOVERNANCE_MESSAGES,
  'cli-runtime-help': CLI_RUNTIME_HELP_MESSAGES,
  'cli-reference': CLI_REFERENCE_MESSAGES,
  'cli-terminal-slash': CLI_TERMINAL_SLASH_MESSAGES,
  'cli-terminal-picker': CLI_TERMINAL_PICKER_MESSAGES,
});

const MESSAGES: MessageMap = mergeMessageFamilies(BASE_MESSAGES, MESSAGE_CATALOG_FAMILIES);

/** All catalog keys — lets tests/tools enumerate keys without re-parsing this source file. */
export const MESSAGE_KEYS: readonly string[] = Object.freeze(Object.keys(MESSAGES));

/**
 * Languages a catalog key actually carries — lets tests/tools prove a key is a real
 * bilingual pair instead of an English-only row that silently falls back for `tr`.
 * Returns an empty list for an unknown key.
 */
export function getMessageLanguages(key: string): readonly string[] {
  const entry = MESSAGES[key];
  return Object.freeze(entry ? Object.keys(entry) : []);
}

// Row 450 twin (508-001 for `deckent doctor` -> 522-019 for the desktop
// surface): the Node.js runtime floor comes from package.json's own
// `engines.node`, never a source literal. A top-level-await DYNAMIC JSON
// import (not createRequire/readFileSync, and not a static import — the
// project's root tsconfig module target rejects import-attribute syntax on
// static import declarations) is required here specifically because this
// module is bundled directly into the Electron renderer (see
// src/desktop/src/renderer/i18n-fallback.ts's "dependency-free" contract) —
// a Node-only fs/module read would break in that sandboxed browser context.
// A JSON import resolves live in Node (main process, CLI) and gets inlined
// as plain data by Rollup at renderer build time; Node's own ESM loader
// resolves this await before any importer's synchronous code runs, so no
// caller of getMessage() needs to change.
const NODE_ENGINE_FLOOR: string =
  ((await import('../../../package.json', { with: { type: 'json' } })).default as { engines?: { node?: string } })
    .engines?.node ?? '';

/** Keys whose {floor} placeholder is filled from NODE_ENGINE_FLOOR when the caller omits it. */
const NODE_FLOOR_MESSAGE_KEYS = new Set<string>(['desktop.error.node_not_found', 'error.node_version_low']);

/**
 * Get a localized message by key.
 * Supports variable interpolation with {varName} placeholders.
 * Returns the key itself if not found.
 */
export function getMessage(
  key: string,
  lang: string,
  vars?: Record<string, string>,
): string {
  const entry = MESSAGES[key];
  if (!entry) {
    if (process.env['NODE_ENV'] !== 'production') {
      process.stderr.write(`[getMessage] missing i18n key: "${key}" (lang: ${lang})\n`);
    }
    return key;
  }

  const normalizedLang = lang === 'tr' ? 'tr' : 'en';
  const template = entry[normalizedLang] ?? entry['en'] ?? key;

  // node-floor keys always resolve {floor} from the manifest, even when the
  // caller (e.g. the desktop getStrings()/fallback paths, which never pass
  // vars) supplies none — caller-supplied vars still win via spread order.
  const effectiveVars = NODE_FLOOR_MESSAGE_KEYS.has(key)
    ? { floor: NODE_ENGINE_FLOOR, ...vars }
    : vars;

  if (!effectiveVars) return template;

  return template.replace(/\{(\w+)\}/g, (_, varName: string) => {
    return effectiveVars[varName] ?? `{${varName}}`;
  });
}

const SUPPORTED_LANGS = ['en', 'tr'] as const;

/**
 * Determine the effective UI language.
 * Priority: DECKENT_LANGUAGE > DECKENT_LANG > configLanguage > LC_ALL > LANG > 'en'.
 * Normalizes locale-style values (e.g. "tr_TR" -> "tr").
 */
export function resolveLanguage(configLanguage?: string): string {
  const candidates = [
    process.env['DECKENT_LANGUAGE'],
    process.env['DECKENT_LANG'],
    configLanguage,
    process.env['LC_ALL'],
    process.env['LANG'],
  ];

  for (const candidate of candidates) {
    if (!candidate) continue;
    const normalized = candidate.slice(0, 2).toLowerCase();
    if ((SUPPORTED_LANGS as readonly string[]).includes(normalized)) {
      return normalized;
    }
  }

  return 'en';
}

/** Backward-compatible language entrypoint. */
export function getLanguage(configLanguage?: string): string {
  return resolveLanguage(configLanguage);
}
