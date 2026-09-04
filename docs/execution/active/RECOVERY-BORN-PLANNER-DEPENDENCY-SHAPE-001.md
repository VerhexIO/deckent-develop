# RECOVERY-BORN-PLANNER-DEPENDENCY-SHAPE-001

OUTCOME_ID: RECOVERY-BORN-PLANNER-DEPENDENCY-SHAPE-001
DOGFOOD_MODE: ON
DOGFOOD_HEALTH: DEGRADED
RECOVERY_SEAM: ADR-D-007
BASE_SHA: 2449b6e4ff10ea39a97307b42982ef41c0b8cc9a
BRANCH: main
WORKSPACE_MODE: MAIN
PARENT_MASTER_ID: RECOVERY-DOGFOOD-BORN-001
OWNER_DECISION_REF: owner-live-2026-09-04-terminal-audit-closure-v2 (ikinci recovery onayı: "İkinci bounded recovery: planner bağımlılık şekli")

## Sonuç

7099 v2 hat L1 native `/do` ile iki kez planlanamadı: codex planlayıcısı JSON döndürdü (exit 0) ama
`tasks[n].dependencies` girdileri sayısal indeks olduğu için `PlannerTaskSchema` (`z.array(z.string())`)
reddetti; kod bunu `parse_failed` diye etiketledi, schema-retry aynı şekli tekrarladı ve ham neden
ledger'a yazılmadı. Bu paket şema-öncesi deterministik bağımlılık-şekli koersiyonu, `validation_failed`
ayrımı + stage/issue-path diagnostiği ve issue-bilgili retry geri bildirimi ekler. Engine kalkınca 7099
v2 L1 dogfood'a döner.

## Admission snapshot — 2026-09-04

- HEAD `2449b6e4ff10ea39a97307b42982ef41c0b8cc9a` (3331 landing), origin/main'den 2 commit ileride, push yok.
- Runtime dirty truth commit dışı: `.brain/ERRORS-critical.md`, `.deckent/provider-execution-observations.db`,
  `.deckent/settings/repl-history`, `.deckent/runtime/local-llm.pid`.
- `.tasks` boş, `docker ps` boş, bot listen canlı (dokunulmaz). Docker 29.1.3 erişilebilir.
- Kanıt: `.deckent/runtime/invocations.db` → `inv-0eaf44e7…` ve `inv-2c4a4138…` her biri 2 deneme,
  `transport_settled succeeded exit 0` (63–73 s) + `consumer_settled rejected parse_failed`;
  `DECKENT_DEBUG=1 deckent do "<L1>"` → `parsePlannerResponse:validation` Zod issues:
  `tasks[2..4].dependencies[*]: Expected string, received number`.

## Kök neden (disk kanıtı)

- `src/orchestra/planner.ts:96` `dependencies: z.array(z.string())`; `:428 parsePlannerResponse`
  safeParse başarısızlığında yalnız `debugLog` + `null`; `:1693` ve `:1699` settle `parse_failed`
  (şema hatası ile JSON hatası ayrılmıyor; `validation_failed` sözlükte var, `:695`); retry prompt'u
  (`:1694`) ihlali adlandırmıyor; `:1933 normalizePlannerDependencies` yalnız string ref çözer.
- Prompt (`:341`) "Specify dependencies in the dependencies array" — biçim (başlık dizesi) söylenmiyor.

## Authority ve scope

- Yetki: Alperen 2026-09-04 ikinci recovery onayı; doğrudan main; paket sonunda tek commit; push yok.
- Production write allowlist: `src/orchestra/planner.ts` (koersiyon helper'ı, detaylı parse sonucu,
  settle reason/stage/issues, retry geri bildirimi). Test allowlist:
  `tests/orchestra/planner-dependency-shape.test.ts` (yeni). Governance: MASTER (3332 + receipt),
  generated projections, bu capsule, train; hermeticity baseline ratchet gerekirse
  `scripts/lint-test-hermeticity.mjs`.
- Negative scope: prompt-authority/compiled-prompt kataloğu, `prompt-god-template.ts`, provider
  adapter'ları, run-flow servisleri değişmez; config mutation yok; feature yok.

## Dependency DAG

1. T1 kırmızı testler: koersiyon (1-tabanlı, 'Task N', aralık dışı, kendine referans, string
   dokunulmaz); parse-detay stage ayrımı (json/schema); zero-config e2e injected spawnFn ile sayısal
   bağımlılık → plan; retry prompt'unda ihlal yolu.
2. T2 planner.ts uygulaması (T1).
3. T3 tsc, planner test battery, gate alt kümesi, `tsc + copy-assets` (clean bot-gated).
4. T4 gerçek kanıt: CLI `deckent do "<L1>"` dry-run plan önizlemesi; native REPL `/do` L1 kartı.

## Verification manifest

- Hermetik: spawn injected, git mock'lu (planner-zeroconfig emsali), tmpdir yok, spawnSync yok.
- Wiring: `callZeroConfigPlanner` → `parsePlannerResponse` → koersiyon → şema → settle; native `/do`
  ve CLI `do` aynı `defaultRunProposalPlanner` yolunu kullanır.
- Ledger: invocations.db `consumer_settled` payload'ında `reasonCode` + `stage` + bounded `issues`.
- XVerify ve DONE owner gate'i; capsule kapanışı LOCAL_VERIFIED.

## Finite budget ve stop koşulları

- Bir implementation pass + bir bağımsız verification pass; aynı failure fingerprint'ine ikinci FIX yok.
- Allowlist dışı mutation typed `SCOPE_HOLD`. Koersiyon belirsizse (0-tabanlı/1-tabanlı çakışması)
  1-tabanlı kural sabittir; diğer her şey görünür düşer, sessiz tahmin yok.

## DONE

1. Test battery + tsc + gate'ler yeşil; dist=src.
2. CLI ve native `/do` ile L1 hedefi plan önizlemesi üretir (gerçek codex çağrısı).
3. MASTER 3332 → VERIFY, receipt consumed, evidence; return-to-dogfood: 7099 v2 L1 `/do` ile başlar;
   capsule 3332 DONE olunca silinir.

### LOCAL_VERIFIED — 2026-09-04 (landing evidence) + typed residual HOLD

- Uygulama: `coercePlannerDependencyShape`, `parsePlannerResponseDetailed`, `describePlannerParseFailure`,
  `describePlannerContractViolation`; zero-config yolunda tek düzeltici retry artık parse/şema/wiring/
  identity ve model-politikası ihlallerinin hepsini kapsar ve ihlali tam yol + model API ID ile
  adlandırır; ledger `consumer_settled` `validation_failed` ayrımı; `debugLog('planner:contractViolation')`.
- Testler: `tests/orchestra/planner-dependency-shape.test.ts` 11/11; planner battery'de yeni kırmızı
  yok — 30 başarısızlık HEAD scratch-worktree koşumuyla birebir aynı (pre-existing
  `validateProductionWiringAuthority` sınıfı: ai-planner-honest-fallback 4, dep-normalize 12,
  planner-edge 4, planner-invocation-receipt 6, planner-zeroconfig 3, run-proposal-compiler 1).
- tsc exit 0; hermeticity aynı 1421/18132 sayı, digest ratchet; i18n, model-literal, spawnsync,
  operating-policy temiz; dist `tsc` + `copy-assets` (clean adımı bot aktif, typed HOLD).
- Gerçek binary (`DECKENT_DEBUG=1 deckent do "<L1>"`, 3 koşum): ledger `validation_failed`
  (önce `parse_failed` idi); retry mesajı sırasıyla `tasks.0.productionWiring:required` ve
  `tasks.0.productionWiring:invalid` ihlallerini adlandırdı. Plan yine üretilmedi.
- **Residual typed HOLD (kapsam dışı, ayrı born satırı gerekir):** `productionWiring` V2 kontratı
  (`src/core/production-wiring-contract.ts:340` exactKeys + digest-pinned `verifierAssets` +
  4-platform `hostProofProgram`) LLM tarafından güvenilir üretilemiyor; üretim-kaynak yazan her
  `/do` hedefi bu aşamada düşer. Çözüm sınıfı: host-completed wiring (model producer/consumer/
  ingress kimliklerini önerir, host digest ve platform programını doldurur) veya authored
  DIRECTIVES ile structured yol. Owner kararı bekler.
- Kalan owner gate'leri: XVerify, DONE, push. Bu capsule 3332 DONE olunca silinir.
