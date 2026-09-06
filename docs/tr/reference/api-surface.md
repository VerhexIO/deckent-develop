# HTTP ve SSE API surface

## Product-user perspektifi

Local server'ı `deckent serve` ile başlat; `deckent dashboard` monitoring-oriented consumer'dır ve embedded terminal kendi session route'larını kullanır. API v1 alias'ları `/api/v1/<path>` biçiminden `/api/<path>` biçimine normalize edilir. Explicit exemption dışında tüm `/api/*` route'ları configured bearer middleware'den geçer; policy loopback'i muaf tutmadıkça remote call'lar rate-limit edilir. [Kanıt: `src/cli/commands/serve.ts:72`; `src/api/server.ts:745-817`]

Server strict loopback/file-origin CORS uygular. Orchestration-control mutation'ları emergency control-mutation flag açmadıkça HTTP üzerinden disabled'dır; terminal/Desktop amaçlanan control surface'tir. [Kanıt: `src/api/server.ts:775-831`; `src/api/server.ts:570-600`]

### Source-verified request pattern'leri

```bash
curl http://127.0.0.1:3100/api/health
curl -H "Authorization: Bearer $DECKENT_API_TOKEN" http://127.0.0.1:3100/api/status
curl -N "http://127.0.0.1:3100/api/events?token=$DECKENT_API_TOKEN"
```

İlk request explicit authentication exemption'dır. Status request configured bearer kullanır; yalnız explicitly permitted SSE path'leri query token kabul edebilir. OIDC exchange de identity'yi kendi gate'iyle kurduğu için generic bearer check'ten exempt'tir. Her route'un bearer gerektirdiğini söyleyen veya control mutation'ları normally available gösteren archived API example'ları bayattır; control mutation'ları default-disabled kalır. Bu örnekler source-verified syntax'tır, runtime endpoint smoke değildir—audit server'ı başlatmadı. [Kanıt: `src/api/server.ts:570-600,798-831,1033-1062,2187-2203`; `src/api/middleware/token.ts:22-45`; `src/core/config-types.ts:1058-1059`]

### Core read ve diagnostic route'ları

| Method ve path | Contract | Kanıt |
|---|---|---|
| `GET /health`, `GET /api/health` | Daima erişilen health; loopback ayrıca version, PID, project root ve terminal capability alır. | `src/api/server.ts:817-831` |
| `GET /api/status` | Reconciled project/sprint status. | `src/api/server.ts:857-885` |
| `GET /api/sprint`, `/api/sprint/live`, `/api/sprint/task/:id` | Sprint summary, live view ve task detail. | `src/api/server.ts:886-892,1233-1249` |
| `GET /api/history` | Sprint history. | `src/api/server.ts:893-897` |
| `GET /api/config`, `/api/config/defaults` | Current project-file view ve defaults view. | `src/api/server.ts:898-911` |
| `GET /api/doctor` | Readiness diagnostics. | `src/api/server.ts:912-917` |
| `GET /api/memory` | Bounded, principal-scoped compatibility projection döndürür: `{content, schemaVersion:1, view}`. Global export-file bypass değildir. | `src/api/memory-search-endpoint.ts` |
| `GET /api/memory/search?v=1&q=&type=&status=&sprint_min=&mode=&limit=&cursor=` | Versioned bounded view. Verified principal tenant/local-project scope'u belirler; URL parameter tenant seçemez. `AVAILABLE`, `ABSENT` ve typed `HOLD` açıktır. | `src/api/memory-search-endpoint.ts`; `src/core/memory-read-service.ts` |
| `GET /api/memory/detail?v=1&ref=` | Bir opaque detail reference için aynı scope altında yeniden doğrulanan versioned complete-entry read. | `src/api/memory-search-endpoint.ts`; `src/core/memory-read-service.ts` |
| `GET /api/memory/search?q=` | Legacy array compatibility. Successful read array shape'i korur; unavailable/held read empty success array değil typed non-200 response'tur. | `src/api/memory-search-endpoint.ts` |
| `GET /api/debt`, `/api/tasks`, `/api/workers`, `/api/agents` | Debt, task, worker ve agent görünümü. | `src/api/server.ts:926-984` |
| `GET /api/routing/distribution` | Routing distribution görünümü. | `src/api/server.ts:985-1001` |
| `GET /api/job/:id`, `/api/worker/:id/log` | Detached job ve worker-log snapshot'ları. | `src/api/server.ts:1002-1032` |
| `GET /api/coverage` | Sprint coverage history ve configured Brain budget. | `src/api/coverage-endpoint.ts:2-60` |
| `GET /api/docs/health` | Doc tracking ve rank×state aggregation. | `src/api/docs-health-endpoint.ts:2-44` |
| `GET /api/evaluate-health?n=` | Evaluation-fault/abort health count'ları. | `src/api/evaluate-health-endpoint.ts:2-146` |
| `GET /api/limits` | Subscription-window usage probe. | `src/api/limits-endpoint.ts:2-109` |
| `GET /api/kpi`, `/api/kpi/trend?kpiId=&n=` | KPI scorecard ve ordered trend. | `src/api/kpi-endpoint.ts:2-95`; `src/api/kpi-trend-endpoint.ts:2-106` |
| `GET /api/git/status`, `/api/git/diff`, `/api/git/proposal` | Read-only repository status/diff/proposal görünümü. | `src/api/server.ts:1254-1275` |

### Lifecycle, interaction ve control route'ları

| Method ve path | Contract | Güncel durum | Kanıt |
|---|---|---|---|
| `POST /api/plan` | Sprint plan parse/build eder. | ⚠️ control mutation gate uygulanır. | `src/api/server.ts:1414-1498`; `src/api/server.ts:570-600` |
| `POST /api/start` | Detached lifecycle job başlatır. | ⚠️ control mutation gate uygulanır; bu audit'te çalıştırılmadı. | `src/api/server.ts:1396-1413`; OQ-20 |
| `POST /api/chat`, `GET /api/chat/stream` | Non-streaming JSON chat ve SSE chat. | ✅ wired; provider readiness yine gerekir. | `src/api/server.ts:1063-1132,1499-1521` |
| `POST /api/kill/all`, `POST /api/kill/:id` | Lifecycle execution durdurur. | ⚠️ destructive/control-gated ve owner-policy sensitive. | `src/api/server.ts:1522-1547`; `src/api/server.ts:570-600` |
| `POST /api/set-directives`, `POST /api/directives` | Directive input'u değiştirir. | ⚠️ control mutation gate uygulanır. | `src/api/server.ts:1548-1566`; `src/api/server.ts:570-600` |
| `POST /api/cleanup` | Lifecycle artifact'larını temizler. | ⚠️ destructive/control-gated. | `src/api/server.ts:1567-1621`; `src/api/server.ts:570-600` |
| `POST /api/config` | Project configuration persist eder. | ⚠️ state-changing. | `src/api/server.ts:1622-1652` |
| `POST /api/webhooks/:channel` | Connector/webhook ingress. | ⚠️ adapter ve auth policy'ye bağlı. | `src/api/server.ts:1653-1703` |
| `GET /api/approvals`, `/api/approvals/:id`, `/api/approvals/history` | Masked argument ile pending/detail/history read view'ları. | ✅ wired read surface. | `src/api/server.ts:1276-1320`; `src/api/approval-history-endpoint.ts:188-212` |
| `POST /api/approvals/:id/decision` | Attributable approval decision. | ⚠️ flag/policy gated. | `src/api/server.ts:1704-1734` |
| `POST /api/reactive/webhook` | Reactive input'u normalize ve append eder. | ⚠️ autonomous/reactive config'e bağlı. | `src/api/reactive-endpoint.ts:2-40` |

### Goal, Mission, Flow ve Process route'ları

| Method ve path | Contract | Güncel durum | Kanıt |
|---|---|---|---|
| `GET /api/missions`, `/api/missions/:id` | Tenant-filtered `MissionView` list/detail. | ✅ wired read surface. | `src/api/missions-route.ts:2-79` |
| `POST /api/process/submit` | `ExecutionRequest` submit eder. | ⚠️ request risk'i approval için park edebilir. | `src/api/process-endpoint.ts:2-79` |
| `GET /api/process/status/:id`, `/api/process/result/:id` | Process state ve last result. | ✅ wired read surface. | `src/api/process-endpoint.ts:43-67` |
| `POST /api/run-flow/propose` | NL intent → durable flow proposal ve gerçek plan preview. | ⚠️ `terminal.run_flow_v2` gated. | `src/api/run-flow-routes.ts:88-109,516-535` |
| `GET /api/run-flow/list`, `/:flowId`, `/:flowId/preview`, `/:flowId/diff` | List, state, preview ve repository footprint. | ⚠️ aynı feature gate ve tenant isolation. | `src/api/run-flow-routes.ts:516-558` |
| `POST /api/run-flow/:flowId/decision|start|cancel` | Exact flow approve/reject, start veya cancel eder. | ⚠️ gated; state-changing path'ler burada çalıştırılmadı. | `src/api/run-flow-routes.ts:559-570`; OQ-20 |
| `GET /api/run-flow/:flowId/events` | Flow-scoped SSE; global stream değildir. | ⚠️ feature-gated. | `src/api/run-flow-event-stream.ts:7-34,226-260` |

`src/api/run-flow-routes.ts` header comment'i hâlâ dört route ve start endpoint yok derken dispatcher artık list/diff/start/cancel da sunuyor. Tablo executable dispatch'i izler; stale comment diff finding'dir. [Kanıt: `src/api/run-flow-routes.ts:20-45,516-570`]

### Autonomous, Nervous, evolution ve enterprise route'ları

| Namespace | Method ve path'ler | Authority notu | Kanıt |
|---|---|---|---|
| Autonomous | GET `status`, `pending`, `backlog`, `lineage/:correlationId`; POST `approve/:id`, `reject/:id` | Tenant/approval policy uygulanır; autonomous engine default-off kalır. | `src/api/autonomous-endpoint.ts:2-6,102-205`; `src/core/config.ts:1727-1736` |
| Nervous | GET `pending`, `status`, `recommendations`; POST `accept/:id`, `reject/:id`, `recommendations/dismiss/:id` | Suggest/act ve panic-guard policy uygulanır. | `src/api/nervous-endpoint.ts:2-5,109-176` |
| Evolution | GET `genealogy`, `retirement`, `prompt-metrics` | Read-oriented evolution projection'ları. | `src/api/evolution-endpoint.ts:17-45` |
| Enterprise reads | GET `tenants`, `rbac`, `audit`, `rate`, `missions-audit` | Missing data empty 200 view dönebilir. | `src/api/enterprise-endpoint.ts:1-8,253-305` |
| Enterprise writes | POST/PUT/DELETE `tenants[/:id]`, `rbac[/:id]`, `rate[/:id]` | Admin-RBAC gated ve audit-logged. | `src/api/server.ts:832-856`; `src/api/enterprise-endpoint.ts:540-930` |
| Identity | GET `/api/auth/me`; POST `/api/auth/oidc/exchange` | OIDC exchange, login henüz bearer taşımadığı için kendi gate'ine sahiptir. | `src/api/auth-me-endpoint.ts:141-170`; `src/api/oidc-callback-endpoint.ts:294-330` |

### Stream ve terminal

| Surface | Contract | Kanıt |
|---|---|---|
| `GET /api/events` | Global dashboard SSE. Query-token yalnız explicitly permitted path'lerde kullanılabilir. | `src/api/server.ts:1033-1062`; `src/api/middleware/token.ts:22-45` |
| `GET /api/output-stream?taskId=&sprintId=` | Scoped output SSE. | `src/api/output-stream.ts:6-15,394-402` |
| `GET /api/workers/:taskId/logs/stream` | Per-worker log SSE. | `src/api/worker-logs.ts:7-20,68-90` |
| `GET /api/terminal/token` | Valid API bearer isteyen loopback-only terminal-token bootstrap. | `src/api/server.ts:2567-2633` |
| `POST/GET /api/terminal/sessions`, `DELETE /api/terminal/sessions/:id` | Independent terminal auth altında PTY veya AI session create/list/kill. | `src/api/server.ts:2634-2708` |
| `/api/terminal/ws` | WebSocket terminal transport; generic API-auth bypass terminal token için authority değildir. | `src/api/server.ts`; `src/api/terminal/` |

### TERM-RPC

`POST /api/rpc` versioned request/response envelope taşır. Catalog `session.list`, `session.resume`, `run.status`, `run.start-detached`, `approval.list` ve `approval.decide` içerir; server handler map'te ayrıca `limits.get` vardır. Güncel write wiring `run.start-detached` ve `approval.decide` destekler; `session.resume` explicitly unsupported kalır. [Kanıt: `src/core/term-rpc.ts:143-183`; `src/api/rpc-write-handlers.ts:120-199`; `src/api/server.ts:621-742,1385-1395`]

### Cross-verify receipt ve onay-kararı sınırı

- Cross-verify (`deckent xverify`) iki FARKLI provider arasında host-adjudicated'dır (author ≠ verifier; same-provider self-verify yasaktır). Bir iddia kapanışa YALNIZ tam zincirle ulaşır: gerçek terminal verdict + gerçek provider call + provider-reported usage + terminally-closed settlement + durable verdict receipt (`cross-verify-verdict:sha256:…`). `HOLD`/`UNCLEAR` kapanış değildir. [Kanıt: `CLOSURE-OS-PRODUCT-TRANSITION-BRIEF.md` §12.2]
- Onay kararı bir mutation'dır. MCP `deckent_approvals` aracı READ-ONLY pending inbox'tur (`ApprovalBroker.list('pending')`) — allow/deny/decide/self-approval sunmaz. Karar YALNIZ `deckent approvals decide` CLI yüzeyinde interactive live-auth arkasında ya da flag/policy-gated HTTP `POST /api/approvals/:id/decision` / `approval.decide` RPC ile verilir. [Kanıt: `src/mcp/tools/approvals.ts`; `src/cli/commands/approvals.ts`]
- Local-terminal auth bağımsızdır: `/api/terminal/token` loopback-only'dir ve geçerli API bearer gerektirir; WebSocket terminal transport genel API-auth bypass'ıyla yetkilendirilmez. [Kanıt: `src/api/server.ts:2567-2708`]

## Dogfood / repository gerçeği

- ✅ Central bearer, rate, CORS ve control-mutation gate'leri route dispatch'ten önce çalışır. [Kanıt: `src/api/server.ts:745-856`]
- ⚠️ API surface watch-only dashboard'dan geniştir; control mutation'ları default olarak disabled ve birden çok feature namespace flag-gated'dir. [Kanıt: `src/api/server.ts:570-600,817-856`; `src/api/run-flow-routes.ts:516-523`]
- ⚠️ Bu audit source ve gerçek CLI registration inceledi; API server başlatmadı veya external state mutate etmedi. Runtime endpoint smoke `HOLD`'dur. [Kanıt: task boundary; OQ-20]
