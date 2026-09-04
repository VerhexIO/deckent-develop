# RECOVERY-BORN-PLANNER-HOST-COMPLETED-WIRING-001 — PLANNED (fresh snapshot yeni oturumda)

OUTCOME_ID: RECOVERY-BORN-PLANNER-HOST-COMPLETED-WIRING-001
DOGFOOD_MODE: ON
DOGFOOD_HEALTH: DEGRADED
RECOVERY_SEAM: ADR-D-007
BASE_SHA: 13d2c80ef053d0d19e6a7c94f4df7cea205b3f03
BRANCH: main
WORKSPACE_MODE: MAIN
PARENT_MASTER_ID: RECOVERY-DOGFOOD-BORN-001
DEPENDS_ON: RECOVERY-BORN-PLANNER-DEPENDENCY-SHAPE-001 (3332, landed 13d2c80ef)
OWNER_DECISION_REF: owner-live-2026-09-04-terminal-audit-closure-v2 ("Üçüncü recovery: host-completed wiring, yeni oturumda")
STATUS: PLANNED — BASE_SHA ve runtime durumu paket başında `deckent-authority-bootstrap` ile yeniden ölçülür

## Sonuç

Native `/do` ve CLI `deckent do`, üretim kaynağına yazan her görev için `productionWiring` V2 bloğunu
planlayıcı LLM'den bekliyor. Kontrat (`src/core/production-wiring-contract.ts:340`) exactKeys, digest-pinned
`verifierAssets` (`sha256:<64 hex>`) ve linux/wsl2-linux/darwin/win32 `hostProofProgram` istiyor; bir LLM bu
gerçekleri plan anında bilemez. 3332 sonrası ledger ve retry mesajı bunu kesin adlandırdı:
`tasks.0.productionWiring:required` (1. deneme) ve `:invalid` (2. deneme). Bu paket sorumluluğu doğru yere
taşır: model yalnız kimlikleri önerir (producer, canonicalConsumer, affectedIngresses, enablementAuthority,
proofTargets, changeKind, disposition); host `hostProofProgram`'ı trusted verifier asset digest'leri ve platform
matrisiyle tamamlar, kontratı doğrular; authored digest asla kabul edilmez.

## Kök neden (disk kanıtı)

- `src/orchestra/planner.ts` prompt (`:462`, örnek `:498`): modelden tam V2 blok ister, `sha256:<64 lowercase hex>`
  dahil. `parsePlannerResponseDetailed` wiring stage: `parseProductionWiringContractV2Input` null → `:invalid`;
  `deriveProductionWiringApplicability(scope).state === 'required'` ve blok yok → `:required`.
- `deriveProductionWiringApplicability` (`src/core/task-types.ts:468`): test-only ve docs-only dışı her yazım
  scope'u `required`.
- Kanıt: `.brain/ERRORS.md` `planner:contractViolation` girdileri (2026-09-04 03:0x), invocations.db
  `inv-…` `consumer_settled validation_failed` x2.

## Tasarım (owner seçimi: host-completed wiring)

1. Prompt, modelden yalnız kimlik alanlarını ister (`productionWiringProposal` v1: changeKind, producer,
   canonicalConsumer, affectedIngresses, enablementAuthority, proofTargets, disposition); `hostProofProgram`
   istenmez. Prompt-authority değişikliği olduğu için owner/ADR amendment noktası açıkça raporlanır.
2. Host completion: `completeProductionWiringFromProposal(proposal, ctx)` — verifierAssets'i trusted harness
   kataloğundan (`scripts/production-wiring-host-proof-harness.mjs` ve kayıtlı asset'ler) gerçek sha256 ile,
   platform programını platform-matrix authority'sinden doldurur; `createProductionWiringContractV2` +
   coverage doğrulaması geçmeden plan kabul edilmez.
3. Geçersiz/eksik kimlik → typed `validation_failed` + issue-path (3332 mekanizması) ile tek retry.
4. Geriye uyumluluk: model tam V2 blok gönderirse authored digest reddedilir (`authored JSON never supplies
   a contract or program digest` kuralı korunur), kimlikler alınıp host tamamlar.

## Scope adayları (fresh snapshot'ta receipt manifestine digest'lenir)

- `src/orchestra/planner.ts`, `src/core/production-wiring-contract.ts`, `src/core/task-types.ts`
- `tests/orchestra/planner-host-completed-wiring.test.ts` (yeni), `tests/core/production-wiring-contract.test.ts`
- Governance: MASTER (3333 receipt + VERIFY), projections, bu capsule, train; hermeticity ratchet gerekirse.
- Negative scope: task-builder/worker custody, provider adapter'ları, run-flow servisleri; feature yok.

## Verification manifest

- Hermetik: kimlik-önerisi → host-completion → geçerli kontrat; geçersiz kimlik → typed hold; authored digest
  reddi; 4-platform program üretimi.
- Gerçek kanıt: `DECKENT_DEBUG=1 deckent do "<7099 v2 L1>"` plan önizlemesi; native REPL `/do` kartı; sonra
  7099 v2 L1 onayı ile dogfood run (owner: bot'u landing'lerde durdurma izni verildi).
- Gate'ler: tsc, planner battery (30 pre-existing kırmızı HEAD ile aynı olmalı, yeni kırmızı yok), i18n,
  model-literal, hermeticity, operating-policy, master-plan.

## Finite budget ve stop koşulları

- Bir implementation pass + bir bağımsız verification pass; unchanged fingerprint'e FIX yok.
- Wiring kontrat authority'sini gevşetmek YASAK; yalnız sorumluluk taşınır (model kimlik, host gerçek).
- Allowlist dışı mutation typed `SCOPE_HOLD`.

## Handoff receipt (operating-policy §8)

```json
{
  "schemaVersion": 1,
  "outcomeId": "RECOVERY-BORN-PLANNER-HOST-COMPLETED-WIRING-001",
  "role": "supervisor",
  "baseSha": "13d2c80ef053d0d19e6a7c94f4df7cea205b3f03",
  "headSha": "13d2c80ef053d0d19e6a7c94f4df7cea205b3f03",
  "branch": "main",
  "policyDigest": "sha256:c4c96a971833ee892174b7d361e08c7f0eb53c629873381235deaa573594d863",
  "scopeDigest": "sha256:4e5c1476fd6d2fafb0c4ae07c28ed234c0053a113386f20ddf475034aa4b076f",
  "filesChanged": [],
  "verification": [
    "3332 landed 13d2c80ef: planner battery no new red vs HEAD; tsc 0; hermeticity ratchet; dist tsc+copy-assets",
    "deckent do L1 x3: ledger validation_failed; retry named tasks.0.productionWiring:required / :invalid"
  ],
  "findings": [
    {
      "class": "BLOCKS_CURRENT_DONE",
      "reasonCode": "PLANNER_WIRING_CONTRACT_NOT_LLM_PRODUCIBLE"
    },
    {
      "class": "RELATED_BUT_NONBLOCKING",
      "reasonCode": "LINT_GATES_PREEXISTING_RED_LAYER_SHIMS_README_STATS_OPERATION_INGRESS"
    },
    {
      "class": "RELATED_BUT_NONBLOCKING",
      "reasonCode": "BUILD_CLEAN_BOT_ACTIVE_HOLD"
    }
  ],
  "openActions": [
    "fresh deckent-authority-bootstrap snapshot",
    "admission receipt GR-... for 3333 with HEAD digests of the scope list",
    "design host-completed wiring: model proposes identities, host fills hostProofProgram from trusted harness + platform matrix",
    "TDD → tsc → gates → dist → real `deckent do` + native `/do` proof with 7099 v2 L1 goal",
    "land 3333, then start 7099 v2 L1 via /do (approve card), stop bot for build:all per owner decision"
  ],
  "recommendedNextAction": "Open RECOVERY-BORN-PLANNER-HOST-COMPLETED-WIRING-001 (3333) in a fresh session; do not start 7099 v2 dogfood before it lands",
  "receiptDigest": "sha256:123051e3ef249cb7df275c94750c78effbb6b64df20af647248d7cd67aea06c0"
}
```

## DONE

1. Test battery + tsc + gate'ler yeşil; dist=src.
2. CLI `deckent do` ve native `/do` 7099 v2 L1 hedefi için plan önizlemesi üretir.
3. MASTER 3333 → VERIFY, receipt consumed; 7099 v2 dogfood başlar; capsule 3333 DONE olunca silinir.
