# TERMINAL-OPERATOR-SURFACE-CLOSURE-001 — v2 kapanış paketi (planlandı, başlamadı)

OUTCOME_ID: TERMINAL-OPERATOR-SURFACE-CLOSURE-001
DOGFOOD_MODE: ON
BASE_SHA: 90041c27f2af45ed8cc7557b25c88214ca58720b
BRANCH: main
WORKSPACE_MODE: MAIN
PARENT_MASTER_ID: ECOSYSTEM-001
MASTER_ORDER: 7099
PREREQUISITE: 3331 (landed 2449b6e4f) → 3332 (landed 13d2c80ef) → 3333 RECOVERY-BORN-PLANNER-HOST-COMPLETED-WIRING-001 (OPEN — üretim-kaynak `/do` planlaması bu kapanmadan mümkün değil)
OWNER_DECISION_REF: owner-live-2026-09-04-terminal-audit-closure-v2
STATUS: PLANNED — BASE_SHA paket başlangıcında yeniden ölçülür (3331 landing sonrası)

## Sonuç

Native terminal, 2026-09-04 owner audit'inde tespit edilen 20 BLOCKS_CURRENT_DONE bulgusunu tek
production-surface kapanışında kapatır. Kullanıcı sonucu: açılış temiz, başlık ve altbilgi aynı
gerçeği söyler, her slash komutu okunabilir kart/picker ile cevap verir, uzun işlem sırasında araç
adı/süre/token görünür, onaylar tek klavyeli kart ailesinden geçer, hatalar typed ve sonraki güvenli
eylemi söyler, checkpoint gerçeği doğru etiketlenir ve kalıcıdır. Dogfood sonucu: aynı yüzey
Deckent'in kendi Goal/Flow/Run zincirini `/do` ile yürütür ve kanıtı bu paketten üretir.

## Owner kararları (2026-09-04, sorgu-cevap)

1. Paketleme: 7099 kapanış + ayrı outcome'lar (7101–7104).
2. Yürütme: önce ADR-D-007 recovery (3331), sonra dogfood.
3. Platform kanıtı: Linux + WSL + Windows native; macOS ve SSH/tmux typed HOLD.
4. Provider kimliği: `native_provider` + erişilebilirlik kapısı; `chat_provider` deprecate + migrasyon.
5. Açılış: temiz; `terminal.startup.recent_sessions` config anahtarı, varsayılan kapalı.
6. Sprint satırları: listede kalır, gerçek rehydrate (7089 (2) bağlı).
7. Maskot: yön A — ayrı outcome 7102; bu pakette yalnız durum satırı zenginleşir.
8. Onaylar: tüm onaylar tek klavyeli kart ailesinde.
9. Çalışma alanı: doğrudan main; dört runtime dosyası commit dışı.
10. `/usage`: provider-neutral depo — ayrı outcome 7101.
11. Checkpoint konumu: `.deckent/runtime/sessions/<id>/checkpoints` (7089 amendment).
12. ADR-G-010 amendment: evet (7102 içinde).

## Dependency DAG — 6 hat (her hat tek writer; dosya çakışması yok)

| Hat | Kapsam | Bulgu | Hot files | MASTER bağı |
|---|---|---|---|---|
| L1 provider kimliği | `native_provider` + erişilebilirlik kapısı tek çözücü; başlık/altbilgi aynı kaynaktan; `health.auth` tr etiketi "oturum" değil; auth probe zaman aşımı gerçek probe ile hizalı; local-llm için endpoint sağlığı; `id (apiId)` tekrarı; `chat_provider` deprecate + migrasyon; receipt `brain_provider` tutarlılığı | 2, 3, ek R | health-snapshot.ts, entry.ts, run.tsx, status-row.tsx, provider-switch.ts, config.ts (migrasyon), run-proposal-compiler.ts | 7077 readiness |
| L2 slash sözleşmesi | Zorunlu argüman + picker/prompt (`/recall`); deprecated filtresi (`/checkpoint` dışarı); köprü spawn env'ine dil aktarımı; `/queue /interrupt /steer` kaydı; `/agent /skill` alias | 7, 8, K | chat-slash-registry.ts, chat-tool-bridge.ts | 7085, 7088 |
| L3 köprü renderer | Tool-keyed renderer: `--json` → kart/picker (doctor, history, agents, skills, models aktif-set + `--json`, sync özet export, audit action picker + verdict kartı); `/mcp` gerçek list/call dispatcher; native tool onayı approval-card'a | 10, 11, 12, 14 | app.tsx (dispatch), picker-specs.ts, yeni renderer modülü, models.ts, sync.ts (export), mcp-bridge.ts, native-agent-bridge.ts | 7104 (sync semantiği ayrı) |
| L4 canlı durum | Başlık Ink içinde ve reaktif; oturum kimliği DROP_ORDER'da atılamaz; turn içi araç adı/süre/token/bağlam %; typed hata satırı + sonraki eylem; sprint satırı gerçek rehydrate; temiz açılış + `terminal.startup.recent_sessions` | 4, 5, 13, A, B | app.tsx (busy/status), status-row.tsx, native-agent-bridge.ts (event → durum), session-resume.ts, config-entries.ts | 7089 (2) |
| L5 checkpoint | Yanlış `corrupt` etiketi → `degraded` + neden kaydı; fence'li JSON onarımı; `.deckent/runtime/sessions/<id>/checkpoints` (gitignore); başarısız sıkıştırmada usage yazılmaz | 6 | session.ts, scratch-checkpoint.ts, native-agent-bridge.ts, .gitignore | 7086, 7089 (3) amendment |
| L6 kapılar | `repl_surface` alan-bazlı default; lint-i18n kapsamı `src/cli/repl/**` + `.tsx`; string-free test tüm repl; ~54 literal; verdict metin taşıyıcı; ASCII degrade tüm işaretler; reduced-motion anahtarı; genişlik birliği + rows reaktif; Ctrl+C picker çift işleme; Esc onay kartında; `DECKENT_INK_DEBUG` redaksiyon; `--version` pipe-güvenli | C, F, G, H, I, L, M, Q | config.ts, lint-i18n-hardcode.mjs, string-free-closure.test.ts, run.tsx, app.tsx, dual-stream.ts, live-footer.ts, input-bar.tsx, picker.ts, approval-card.tsx, splash.ts | 5040 kısmi |

Sıra: L6 (kapılar) ve L1 (kimlik) önce, çünkü L3/L4 onların sözleşmesine dayanır; L2 ve L5
paralel; L3 ve L4 son. Tek writer per hot file: `app.tsx` L3 ve L4 arasında sıralı kilit.

## Yürütme

- Giriş: native terminal `/do` (3331 sonrası) → Goal/Flow/Run; provider/model/worker sayısı
  effective config + registry + capacity'den çözülür, bu capsule sabit değer taşımaz.
- Her hat = bağımsız DAG lane; fan-in sonrası tek verification pass + XVerify (farklı provider).
- Kanıt: her hat için hermetik test + gerçek binary (tmux pane capture) + Windows-native koşum
  (owner makinesi) + i18n en/tr ekran görüntüsü metni.

## Verification manifest

- Production wiring zinciri hat başına: producer → consumer → entrypoint → config enablement →
  gerçek çalıştırma kanıtı.
- `npm run lint:gates` yeşil; scoped vitest yeşil; `npm run build:all`; full suite 5 landing'de bir
  kuralına tabi.
- Platform: Linux/WSL gerçek binary + Windows native gerçek binary; macOS/SSH typed HOLD.
- Design-critic pass: durum satırı ve kart ailesi için `deckent-design-critic`.

## Finite budget ve stop koşulları

- Bir implementation pass + bir bağımsız verification pass per hat; unchanged fingerprint'e FIX yok.
- Hot file dışı mutation typed `SCOPE_HOLD`; provider credential mutation yasak.
- Feature ekleme yasak: maskot (7102), usage (7101), perf (7103), sync semantiği (7104) bu pakete
  girmez.

## DONE

1. 20 BLOCKS bulgusunun her biri disk kanıtı + gerçek binary kanıtıyla kapalı.
2. 7099 evidence satırında v2 proof zinciri (commit SHA'ları, XVerify receipt'leri, platform kanıtı).
3. 7085/7088/7089(2)/7086 bağlı maddeler kendi satırlarında VERIFY veya DONE.
4. Capsule silinir (delete-on-consume); train node'u tüketilir.
