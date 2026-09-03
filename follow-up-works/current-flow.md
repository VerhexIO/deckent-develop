# GEÇİCİ AKIŞ — TEK AKTİF İMLEÇ

> Bu dosya yalnız kısa vadeli çalışma imlecidir. İş ve kapanış SSOT'u
> `docs/MASTER-PLAN.md`; kalıcı bütün-repo analiz kaydı
> `follow-up-works/deckent-full-code-truth-analysis-2026-08-30.md` dosyasındadır.
> Tamamlanan ayrıntılı recovery günlüğünün kalıcı kanıtı Git geçmişi ve
> `.analysis/audits/` altındaki makine kayıtlarıdır.

## Şu an — 2026-09-04 Europe/Istanbul

- Branch: `main`.
- HEAD ve `origin/main`: `f6ce016a89ddcdf07c84cd9475250c4e5c4c78e3`.
- Önceki Terminal/Fable 5.1 goal'i: `complete`; aktif sistem goal'i yoktur.
- Canonical sprint lifecycle: `IDLE`; aktif/resumable sprint, coordinator veya Docker
  worker/container yoktur.
- Sprint-713 canonical `deckent cleanup --sprint sprint-713` ile kapatıldı:
  7 sprint dosyası retention arşivine alındı, 0 task artifact silindi.
- `.brain/memory.db` değiştirilmedi.
- Alperen'in 2026-09-04 canlı ve açık talimatıyla, aktif Deckent run/worker/container
  olmadığı doğrulandıktan sonra kalan sprint-dışı `.tasks` seti Deckent cleanup
  kullanılmadan geri alınabilir biçimde taşındı; yeni `.tasks` dizini boştur.

## Tamamlanan ürün zemini

### Motor A — exact task/attempt custody

- Main landing: `67a734c87`.
- Final gerçek WSL2/Docker canary:
  - task `canary-1788433556479`
  - attempt `b6d8aa45-19e0-89d3-8ede-fac68c18c8ad`
  - mode `normal-docker-exact`
  - accepted result `diskVerified:true`
  - effect landing → accepted result → evaluation → finalizer → settlement → archive
    zinciri durable reread ile doğrulandı.
  - fresh-process reopen ikinci worker/container doğurmadı.
- Machine receipt:
  `.analysis/audits/motor-a-wsl2-docker-canary-2026-09-03.json`
  sha256 `02836a467b6eae81689fa1bd3434311f0a49640f8179d27acba39e2e3bf84f82`.
- Networkless installed-package proof:
  `.analysis/audits/motor-a-linux-wsl2-networkless-install-2026-09-03.json`
  sha256 `3da177733c030dfe694499340b594ad044600b584d8dab6f5c29f1db7dae5ea4`.
- macOS 8031 ve Windows-native 8032 owner-deferred; başarıya çevrilmedi.

### Terminal ve Fable 5.1

- Final main/origin landing: `f6ce016a8`.
- Terminal operator yüzeyi Linux/WSL2 gerçek binary ile doğrulandı.
- Claude Fable 5.1 registry → activation → argv → worker image → XVerify zinciri
  exact model kimliğiyle bağlandı.
- MASTER `TERMINAL-OPERATOR-SURFACE-CLOSURE-001` satırı `VERIFY`; macOS,
  Windows-native ve SSH/tmux gerçek-host HOLD'ları nedeniyle elle `DONE` yapılmadı.

## MASTER güncellemesi

- `RECOVERY-BORN-711-NORMAL-DOCKER-EXACT-ATTEMPT-CUSTODY-001` ve Linux/WSL2
  children 3327–3329 `OPEN → VERIFY` yükseltildi.
- Gerçek receipt, commit, task/attempt ve platform kanıtları satırlara bağlandı.
- Hiçbir satır sahte `DONE` yapılmadı; authenticated Closure OS disposition bekliyor.
- `STATE-RETENTION-001`, `REPO-CLEANUP-001` ve `REPO-CLEANUP-APPLY-001`
  kalan `.tasks` gerçeğiyle güncellendi.
- `node scripts/lint-master-plan.mjs --write` sonucu:
  569 satır, 481 aktif, 214 receipt, 13 blocker; projectionlar senkron.

## Sprint dışı `.tasks` temizliği — fiziksel temizlik tamam, ürün açığı açık

- Taşınan set: 92 dosya / 271705 byte.
- Geri dönüş dizini:
  `/tmp/deckent-tasks-recovery-20260904T011107+0300`.
- Taşıma sonrası relative-path+size+sha256 JSON manifest digest:
  `6e7be541e7602b5d4f825293acad661b027fe8b8a0f32d2ec9ac8e46046713ed`.
- Yeni `.tasks` dizini: 0 entry, mode `0755`, owner `alperen:alperen`.
- Aileler:
  - 29 terminal XVerify task claim
  - 19 XVerify result
  - 11 XVerify plan
  - 12 provider-execution observation
  - 18 worker-heartbeat authority record
  - repair queue, deck shadow ve worker-core metadata
- Bu kayıtlar sprint ID taşımadığı için bugünkü canonical `deckent cleanup` bunları
  tanımadı. Owner, bu tek fiziksel temizlik için açık istisna verdi; byte'lar
  kalıcı silinmedi ve `/tmp` geri dönüş dizinine taşındı.
- Ürün açığı kapanmış sayılmaz: XVerify/observation/heartbeat kayıtlarının canonical
  retention/archive/restore consumer'ı hâlâ yoktur. `REPO-CLEANUP-001` ve
  `REPO-CLEANUP-APPLY-001` bu nedenle otomatik `DONE` yapılmadı.

## Local LLM notu

- Local server canlı ve `Qwen3.8-27B` API model adını yayımlıyor.
- Project config şu anda daha ayrıntılı `Qwen3.8-27B-Q4_K_M` adını taşıyor.
- Terminal sohbet probe'u çalıştı; fakat exact-ID worker routing için bu ad farkı
  düzeltilmeden local model bir dogfood worker authority'si sayılmayacak.

## Kabul edilmiş sıra ve bir sonraki imleç

1. Claude yan oturumunun terminal bug paketini main'e almadan önce çakışma ve kanıt
   kontrolü yap; ardından source/dist eşitliğini ölç, gerekli build'i al ve owner
   koordinasyonuyla bot restart/reconnect yap.
2. Sprint-dışı XVerify/observation/heartbeat kayıtları için canonical
   retention/archive/restore açığını ayrı bir ürün outcome'u olarak kapat.
3. Motor A 3326–3329 için authenticated Closure OS disposition turunu hazırla;
   Terminal 7099'un platform HOLD'larını ayrı tut.
4. Local LLM exact API model kimliğini effective config/registry üzerinden hizala ve
   yalnız gerçek reachability + routing kanıtından sonra worker kullanımına aç.
5. Yeni product dogfood goal'i: kabul edilmiş C sırasının sonraki child'ı
   `4034 OPERATION-EFFECT-CONTEXT-001`.
6. 4034 tamamlanınca aynı dogfood döngüsüyle 4035+ child DAG'a devam et; permission
   4040 ve approval 4050 kapsamlarına taşma.

Yeni Goal/Mission/Flow/Run henüz başlatılmadı. İlk yeni run temiz ve dürüst baseline
sağlanmadan açılmayacak.
