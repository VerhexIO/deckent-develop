# RECOVERY-BORN-NATIVE-DO-SLASH-PROVIDER-BOOTSTRAP-001

OUTCOME_ID: RECOVERY-BORN-NATIVE-DO-SLASH-PROVIDER-BOOTSTRAP-001
DOGFOOD_MODE: ON
DOGFOOD_HEALTH: DEGRADED
RECOVERY_SEAM: ADR-D-007
BASE_SHA: 90041c27f2af45ed8cc7557b25c88214ca58720b
BRANCH: main
WORKSPACE_MODE: MAIN
PARENT_MASTER_ID: RECOVERY-DOGFOOD-BORN-001
CANONICAL_CLASS_LINK: NATIVE-RUNFLOW-BOOTSTRAP-001 (7083)
OWNER_DECISION_REF: owner-live-2026-09-04-terminal-audit-closure-v2

## Sonuç

Native terminalde `/do <hedef>` slash komutu, `deckent_propose_run` tool yolunun 557-003 ile
kazandığı lazy provider bootstrap'ından geçmediği için boş provider registry ile planlayıcıya ulaşır
ve `Provider not found: "codex"` ham hatası transkripte düşer. Bu paket tek şeyi kapatır: run-flow
controller `proposeRun` öncesi tek lazy-idempotent bootstrap seam'i (tool ve slash aynı çözücü) ve
bootstrap sonrası provider hâlâ yoksa typed `NO_PROVIDERS` HOLD. Dogfood engine'in native `/do`
ingress'i bu paketle ayağa kalkar; sonraki outcome (7099 v2) dogfood'a bu ingress'ten döner.

## Admission snapshot — 2026-09-04

- `main` HEAD `90041c27f2af45ed8cc7557b25c88214ca58720b`, origin/main'den 1 commit ileride,
  push yapılmamış.
- Korunacak runtime dirty truth (commit DIŞI): `.brain/ERRORS-critical.md`,
  `.deckent/provider-execution-observations.db`, `.deckent/settings/repl-history`,
  `.deckent/runtime/local-llm.pid` (stale, PID 781593 ölü).
- Aktif Deckent worker/coordinator/container yok: `.tasks` boş, `docker ps` boş. Canlı süreç
  yalnız `dist/cli/entry.js bot listen` (PID 2898110); bu paket botu durdurmaz/başlatmaz.
- `deckent connect` (read-only): claude ve codex CLI logged-in; `auth_mode=subscription`.
- Effective config: `mode=performance` → `modes.performance.brain_model=gpt-5.6-sol` → provider
  `codex`; `providers.brain=codex`; `terminal.run_flow_v2=true`; `native_provider=local-llm`.
- dist `2026-09-03 21:18` ≥ en yeni `src/cli` değişikliği: gözlenen davranış canlı kod.
- 711 recovery capsule'ı yerel `GO / DOGFOOD_READY` ile durur, 3327–3329 authenticated settlement
  bekler; bu paket ona dokunmaz.

## Kök neden (disk kanıtı)

- `src/cli/repl/app.tsx:768` `runReplDoSlash` → `deps.controller.proposeRun` doğrudan.
- `src/cli/repl/run-flow-controller.ts:184` `proposeRun` → `planRunFlow` → `compileRunProposal`
  (`run-flow-plan-service.ts:625`) → `defaultRunProposalPlanner` (`run-proposal-compiler.ts:170`)
  → `callZeroConfigPlanner` → `resolveAdapter` (`planner.ts:1541/674`) →
  `providerRegistry.getProvider(getProviderForModel(model))` → `provider.ts:478`
  `ProviderNotFoundError`; `run-proposal-compiler.ts:322` `RunProposalPlanError` ile sarar.
- Tek registrar `bootstrapProviders` (`provider.ts:1465`); REPL boot (`entry.ts:748`) çağırmaz.
  557-003 lazy bootstrap yalnız `native-tool-registry.ts:764` tool handler'ında; slash yolu onu
  görmez. `do.ts:239` CLI yolu bootstrap eder.
- Typed sözlük hazır ve kullanılmıyor: `PlannerFailureReason.no_providers` (`planner.ts:687`).

## Authority

- Recovery paketi yetkisi: Alperen 2026-09-04, "Önce ADR-D-007 recovery ile /do, sonra dogfood"
  (`owner-live-2026-09-04-terminal-audit-closure-v2`).
- Çalışma alanı: owner kararı ile doğrudan `main`; dört runtime dosyası commit dışı.
- Commit: owner kararıyla paket sonunda tek commit; push yok.
- Build: `npm run build:all` paket sonunda, aktif worker/container yokken; bot restart yok.

## Exact scope

Production write allowlist (tek yazar bu oturum):

- `src/cli/repl/provider-bootstrap.ts` (yeni) — `ensureProvidersBootstrapped(config, root)`:
  dinamik `core/provider.js` import, `listProviders().length === 0` kapısı, idempotent
  `bootstrapProviders`, bootstrap hatasını yutup mevcut listeyi döner.
- `src/cli/repl/run-flow-controller.ts` — `RunFlowControllerDeps.ensureProviders?` seam'i;
  `proposeRun` planlamadan önce seam'i bekler; cause zincirinde `ProviderNotFoundError` görürse
  typed `RunFlowProviderHoldError` (`code: 'NO_PROVIDERS'`, model, provider, registered, flowId)
  fırlatır.
- `src/cli/repl/native-tool-registry.ts` — 557-003 inline bootstrap yerine aynı helper.
- `src/cli/repl/run.tsx` — `wireRunFlowMount` production default `ensureProviders`;
  `buildDoSlashLabels` `noProviders` şablonu.
- `src/cli/repl/app.tsx` — `DoSlashLabels.noProviders`; `runReplDoSlash` typed HOLD'u yerelleştirir
  (`formatDoSlashNoProviders` saf helper).
- `src/cli/helpers/messages.ts` — `do.slash_no_providers` (en+tr).

Test/script allowlist: `tests/cli/repl/provider-bootstrap.test.ts` (yeni),
`tests/cli/run-flow-controller-provider-hold.test.ts` (yeni), `tests/cli/repl-do-slash-wire.test.ts`,
`tests/cli/run-flow-mount.test.ts`, `tests/cli/native-propose-run-bootstrap.test.ts`.

Governance transaction: `docs/MASTER-PLAN.md` (3331 born satırı, 7099 DependsOn/evidence,
7089 amendment, 7101–7104 owner-admitted C satırları), iki generated projection, bu capsule,
`TERMINAL-OPERATOR-SURFACE-CLOSURE-001.md` capsule'ı, `productization-train-2026-09-04.md`.

Negative scope: `planner.ts`, `provider.ts`, `run-proposal-compiler.ts`, `run-flow-plan-service.ts`
değişmez; config/credential mutation yok; `.brain/memory.db`, `.tasks`, `.locks` dokunulmaz; feature
yok; başlık/altbilgi provider uyumsuzluğu (7099 hat-1) bu pakete girmez.

## Dependency DAG

1. T1 — kırmızı testler: helper idempotency; controller `ensureProviders` sırası ve `NO_PROVIDERS`
   eşlemesi; mount default seam; `/do` slash HOLD yerelleştirme (en+tr); 557-003 testi yeşil kalır.
2. T2 — `provider-bootstrap.ts` helper (T1'e bağlı).
3. T3 — controller seam + typed hold (T2).
4. T4 — tool handler helper'a geçer (T2).
5. T5 — mount default + label + i18n + app.tsx eşleme (T3).
6. T6 — `npx tsc --noEmit`, scoped vitest, `lint:gates` alt kümesi (i18n-hardcode, hermetic,
   readability, parity, master-plan, operating-policy), `npm run build:all`.
7. T7 — gerçek binary kanıtı: tmux altında `deckent` → `/do <hedef>` → PlanPreviewCard; ayrıca
   `providers.brain` için sahte provider ile typed HOLD satırı (env/config mutasyonsuz: test
   düzeyinde) — production HOLD yolu birim testle, bootstrap yolu gerçek binary ile.

## Verification manifest

- Hermetik testler: `core/provider.js` mock'lu; gerçek CLI probe yok; tmpdir; spawnSync yok.
- Production wiring zinciri: `entry.ts` → `run.tsx wireRunFlowMount` (default seam) →
  `run-flow-controller.proposeRun` → `ensureProvidersBootstrapped` → `bootstrapProviders` →
  planner. Test-only import yok; `/do` slash ve `deckent_propose_run` aynı controller örneğini
  kullanır.
- Gerçek binary: tmux pane capture'da plan önizleme kartı, flowId ve task özetleri; `.deckent/runtime`
  altında proposal event'i.
- Independent pass: farklı provider ile XVerify (owner gate'i; capsule kapanışı XVerify'sız
  `LOCAL_VERIFIED` olarak raporlanır, closure değil).
- Remote CI: ADVISORY, beklenmez.

## Finite budget ve stop koşulları

- Bir implementation pass + bir bağımsız verification pass; aynı failure fingerprint'i için ikinci
  FIX turu yok.
- Allowlist dışı mutation ihtiyacı typed `SCOPE_HOLD`.
- Bootstrap sonrası codex provider `detectAvailableProviders` ile available çıkmazsa sonuç typed
  `NO_PROVIDERS` HOLD'dur; auth/credential mutation ile "yeşile boyama" yasak.
- Kill/cleanup, bot restart, push, MASTER closure disposition ayrı owner gate'leridir.

## DONE

1. Hermetik test battery yeşil (5 dosya), `tsc --noEmit` yeşil, ilgili lint gate'leri yeşil.
2. `npm run build:all` yeşil; dist=src.
3. Gerçek binary tmux kanıtı: native `/do` plan önizlemesi üretir (Linux/WSL).
4. MASTER 3331 → VERIFY, evidence satırında commit SHA ve kanıt özeti; 7083 birinci bulgusu
   evidence'a bağlanır.
5. Return-to-dogfood: 7099 v2 paketi `/do` ile Goal/Flow/Run'a alınır; bu capsule 3331 DONE olunca
   silinir (delete-on-consume).

### LOCAL_VERIFIED — 2026-09-04 (landing evidence)

- Tek seam: `src/cli/repl/provider-bootstrap.ts` `ensureProvidersBootstrapped(root, loadCfg)`; tool
  handler (`native-tool-registry.ts`) ve controller `ensureProviders` default'u (`run.tsx`
  `wireRunFlowMount`) aynı fonksiyonu çağırır. Typed hold: `RunFlowProviderHoldError`
  (`code: NO_PROVIDERS`, details flowId/model/provider/registered), REPL'de
  `do.slash_no_providers` en+tr ile yerelleştirilir (`app.tsx formatDoSlashNoProviders`).
- Hermetik battery: `provider-bootstrap.test.ts` (5), `run-flow-controller-provider-hold.test.ts`
  (4), `repl-do-slash-wire.test.ts` (+3), `run-flow-mount.test.ts` (+3, 1 mevcut assertion seam'e
  göre güncellendi), `native-propose-run-bootstrap.test.ts` ve `run-flow-controller.test.ts`
  değişmeden yeşil — 6 dosya / 88 test PASS; `string-free-closure.test.ts` PASS.
- `npx tsc --noEmit` exit 0; gate'ler: i18n-hardcode ✓, no-model-literal ✓, terminal-readability ✓,
  no-spawnsync ✓, operating-policy ✓ (capsule hygiene clean); hermeticity: aynı 18132 unresolved
  sayısı, yalnız `messages.ts` callsite digest kayması → baseline ratchet (HEAD-vs-tree diff ile
  doğrulandı, yeni unresolved edge yok; `scripts/lint-test-hermeticity.mjs` receipt manifestine
  eklendi).
- Build: `npm run build:all` ve `npm run build` `clean` adımında `E_CLEAN_ACTIVE_EXECUTION_HOLD`
  (`E_CLEAN_BOT_ACTIVE`, `.deckent/bot.pid` canlı) → bot durdurma owner gate'i; `npx tsc` +
  `node scripts/copy-assets.mjs` ile dist güncellendi (dist/cli/repl/provider-bootstrap.js,
  run-flow-controller.js, app.js, run.js, native-tool-registry.js, helpers/messages.js —
  2026-09-04 02:07). Dashboard/desktop kaynakları bu pakette değişmedi.
- Gerçek binary (Linux/WSL, tmux 3.4): `deckent` → boot 2 s → `/do 3331 gerçek-binary kanıtı: …`
  → 56 s'de PlanPreviewCard: 3 görev, goNogo kriterleri, `GATE: GEÇTİ · POLİTİKA: İZİN VER ·
  Yürütme topolojisi: GEÇTİ · Eşzamanlılık 8/2 · Etkin dalgalar 1:[1,2] 2:[3] · Özet-imza
  2762f110c0ef…` ve `(y = onayla · n = reddet · d = detay)`; onay verilmeden Ctrl+C ile çıkıldı
  (run başlatılmadı). Pane capture: scratchpad `tmux-3331-boot.txt`, `tmux-3331-do.txt`.
- Negative yol (typed NO_PROVIDERS) production'da config mutasyonu gerektirdiği için gerçek
  binary ile değil hermetik testle kanıtlandı (capsule T7 planı gereği).
- Kalan owner gate'leri: XVerify (farklı provider), MASTER 3331 DONE + capsule delete-on-consume,
  push. Return-to-dogfood sınırı: 7099 v2 paketi `/do` ile başlatılabilir.
- Gate defteri (2026-09-04): `lint:gates` zinciri `layer-shims` adımında durur — **HEAD'de de aynı 9
  ihlal** (mcp/tools/run.ts → cli mesaj kataloğu crossing, orchestra/task-mode-runner SCC),
  `update-readme-stats --check` (README.md, README.tr.md, IDENTITY.md stale) ve
  `audit-operation-ingress --check` (task-builder/task-mode-runner MISSING_BASELINE_SITE) de HEAD'de
  kırmızı; üçü de bu paketin dosyalarına dokunmaz, `RELATED_BUT_NONBLOCKING` (repo-hygiene drift,
  owner admission bekler). Diğer 22 gate tek tek exit 0; hermeticity ratchet sonrası yeşil;
  `lint-master-plan --write` OK (574 satır, 215 receipt, projection senkron).
- MASTER kimlik-süreklilik kuralı gereği 7099 DependsOn ve 7089 Acceptance hücreleri HEAD değeriyle
  korundu; 3331 önkoşulu 7099 Evidence'ında, 7089 owner amendment'ı 7089 Evidence'ında kayıtlıdır.
