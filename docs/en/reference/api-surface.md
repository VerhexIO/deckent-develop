# HTTP and SSE API surface

## Product-user perspective

Start the local server with `deckent serve`; `deckent dashboard` is the monitoring-oriented consumer and the embedded terminal has its own session routes. API v1 aliases are normalized from `/api/v1/<path>` to `/api/<path>`. All `/api/*` routes pass the configured bearer middleware except its explicit exemptions; remote calls are rate-limited unless policy exempts loopback. [Evidence: `src/cli/commands/serve.ts:72`; `src/api/server.ts:745-817`]

The server uses strict loopback/file-origin CORS handling. Orchestration-control mutations are disabled over HTTP unless the emergency control-mutation flag re-enables them; terminal/Desktop is the intended control surface. [Evidence: `src/api/server.ts:775-831`; `src/api/server.ts:570-600`]

### Source-verified request patterns

```bash
curl http://127.0.0.1:3100/api/health
curl -H "Authorization: Bearer $DECKENT_API_TOKEN" http://127.0.0.1:3100/api/status
curl -N "http://127.0.0.1:3100/api/events?token=$DECKENT_API_TOKEN"
```

The first request is an explicit authentication exemption. The status request uses the configured bearer, and only explicitly permitted SSE paths may accept the query token. OIDC exchange is also exempt from the generic bearer check because it establishes identity through its own gate. Archived API examples that say every route requires bearer auth or show control mutations as normally available are stale; control mutations remain default-disabled. These examples are source-verified syntax, not runtime endpoint smoke—the audit did not start the server. [Evidence: `src/api/server.ts:570-600,798-831,1033-1062,2187-2203`; `src/api/middleware/token.ts:22-45`; `src/core/config-types.ts:1058-1059`]

### Core read and diagnostic routes

| Method and path | Contract | Evidence |
|---|---|---|
| `GET /health`, `GET /api/health` | Always-accessible health; loopback additionally receives version, PID, project root, and terminal capability. | `src/api/server.ts:817-831` |
| `GET /api/status` | Reconciled project/sprint status. | `src/api/server.ts:857-885` |
| `GET /api/sprint`, `/api/sprint/live`, `/api/sprint/task/:id` | Sprint summary, live view, and task detail. | `src/api/server.ts:886-892,1233-1249` |
| `GET /api/history` | Sprint history. | `src/api/server.ts:893-897` |
| `GET /api/config`, `/api/config/defaults` | Current project-file view and defaults view. | `src/api/server.ts:898-911` |
| `GET /api/doctor` | Readiness diagnostics. | `src/api/server.ts:912-917` |
| `GET /api/memory` | Bounded, principal-scoped compatibility projection: `{content, schemaVersion:1, view}`. It is not a global export-file bypass. | `src/api/memory-search-endpoint.ts` |
| `GET /api/memory/search?v=1&q=&type=&status=&sprint_min=&mode=&limit=&cursor=` | Versioned bounded view. The verified principal determines tenant/local-project scope; URL parameters cannot select a tenant. `AVAILABLE`, `ABSENT`, and typed `HOLD` are explicit. | `src/api/memory-search-endpoint.ts`; `src/core/memory-read-service.ts` |
| `GET /api/memory/detail?v=1&ref=` | Versioned complete-entry read for one opaque detail reference, revalidated against the same scope. | `src/api/memory-search-endpoint.ts`; `src/core/memory-read-service.ts` |
| `GET /api/memory/search?q=` | Legacy array compatibility. Successful reads retain the array shape; an unavailable/held read is a typed non-200 response, never an empty success array. | `src/api/memory-search-endpoint.ts` |
| `GET /api/debt`, `/api/tasks`, `/api/workers`, `/api/agents` | Debt, task, worker, and agent views. | `src/api/server.ts:926-984` |
| `GET /api/routing/distribution` | Routing distribution view. | `src/api/server.ts:985-1001` |
| `GET /api/job/:id`, `/api/worker/:id/log` | Detached job and worker-log snapshots. | `src/api/server.ts:1002-1032` |
| `GET /api/coverage` | Sprint coverage history and configured Brain budget. | `src/api/coverage-endpoint.ts:2-60` |
| `GET /api/docs/health` | Doc tracking and rank×state aggregation. | `src/api/docs-health-endpoint.ts:2-44` |
| `GET /api/evaluate-health?n=` | Evaluation-fault/abort health counts. | `src/api/evaluate-health-endpoint.ts:2-146` |
| `GET /api/limits` | Subscription-window usage probe. | `src/api/limits-endpoint.ts:2-109` |
| `GET /api/kpi`, `/api/kpi/trend?kpiId=&n=` | KPI scorecard and ordered trend. | `src/api/kpi-endpoint.ts:2-95`; `src/api/kpi-trend-endpoint.ts:2-106` |
| `GET /api/git/status`, `/api/git/diff`, `/api/git/proposal` | Read-only repository status/diff/proposal views. | `src/api/server.ts:1254-1275` |

### Lifecycle, interaction, and control routes

| Method and path | Contract | Current status | Evidence |
|---|---|---|---|
| `POST /api/plan` | Parse/build a sprint plan. | ⚠️ control mutation gate applies. | `src/api/server.ts:1414-1498`; `src/api/server.ts:570-600` |
| `POST /api/start` | Start a detached lifecycle job. | ⚠️ control mutation gate applies; not executed in this audit. | `src/api/server.ts:1396-1413`; OQ-20 |
| `POST /api/chat`, `GET /api/chat/stream` | Non-streaming JSON chat and SSE chat. | ✅ wired; provider readiness still applies. | `src/api/server.ts:1063-1132,1499-1521` |
| `POST /api/kill/all`, `POST /api/kill/:id` | Stop lifecycle execution. | ⚠️ destructive/control-gated and owner-policy sensitive. | `src/api/server.ts:1522-1547`; `src/api/server.ts:570-600` |
| `POST /api/set-directives`, `POST /api/directives` | Replace directive input. | ⚠️ control mutation gate applies. | `src/api/server.ts:1548-1566`; `src/api/server.ts:570-600` |
| `POST /api/cleanup` | Cleanup lifecycle artifacts. | ⚠️ destructive/control-gated. | `src/api/server.ts:1567-1621`; `src/api/server.ts:570-600` |
| `POST /api/config` | Persist project configuration. | ⚠️ state-changing. | `src/api/server.ts:1622-1652` |
| `POST /api/webhooks/:channel` | Connector/webhook ingress. | ⚠️ adapter and auth policy dependent. | `src/api/server.ts:1653-1703` |
| `GET /api/approvals`, `/api/approvals/:id`, `/api/approvals/history` | Pending/detail/history read views with masked arguments. | ✅ wired read surface. | `src/api/server.ts:1276-1320`; `src/api/approval-history-endpoint.ts:188-212` |
| `POST /api/approvals/:id/decision` | Attributable approval decision. | ⚠️ flag/policy gated. | `src/api/server.ts:1704-1734` |
| `POST /api/reactive/webhook` | Normalize and append reactive input. | ⚠️ autonomous/reactive configuration dependent. | `src/api/reactive-endpoint.ts:2-40` |

### Goal, Mission, Flow, and Process routes

| Method and path | Contract | Current status | Evidence |
|---|---|---|---|
| `GET /api/missions`, `/api/missions/:id` | Tenant-filtered `MissionView` list/detail. | ✅ wired read surface. | `src/api/missions-route.ts:2-79` |
| `POST /api/process/submit` | Submit an `ExecutionRequest`. | ⚠️ request risk may park for approval. | `src/api/process-endpoint.ts:2-79` |
| `GET /api/process/status/:id`, `/api/process/result/:id` | Process state and last result. | ✅ wired read surface. | `src/api/process-endpoint.ts:43-67` |
| `POST /api/run-flow/propose` | NL intent → durable flow proposal and real plan preview. | ⚠️ `terminal.run_flow_v2` gated. | `src/api/run-flow-routes.ts:88-109,516-535` |
| `GET /api/run-flow/list`, `/:flowId`, `/:flowId/preview`, `/:flowId/diff` | List, state, preview, and repository footprint. | ⚠️ same feature gate and tenant isolation. | `src/api/run-flow-routes.ts:516-558` |
| `POST /api/run-flow/:flowId/decision|start|cancel` | Approve/reject, start, or cancel an exact flow. | ⚠️ gated; state-changing paths were not exercised here. | `src/api/run-flow-routes.ts:559-570`; OQ-20 |
| `GET /api/run-flow/:flowId/events` | Flow-scoped SSE, never a global stream. | ⚠️ feature-gated. | `src/api/run-flow-event-stream.ts:7-34,226-260` |

The header comment in `src/api/run-flow-routes.ts` still says there are four routes and no start endpoint, while the dispatcher now exposes list/diff/start/cancel as well. The table follows executable dispatch, and the stale comment is a diff finding. [Evidence: `src/api/run-flow-routes.ts:20-45,516-570`]

### Autonomous, Nervous, evolution, and enterprise routes

| Namespace | Methods and paths | Authority notes | Evidence |
|---|---|---|---|
| Autonomous | GET `status`, `pending`, `backlog`, `lineage/:correlationId`; POST `approve/:id`, `reject/:id` | Tenant/approval policy applies; autonomous engine remains default-off. | `src/api/autonomous-endpoint.ts:2-6,102-205`; `src/core/config.ts:1727-1736` |
| Nervous | GET `pending`, `status`, `recommendations`; POST `accept/:id`, `reject/:id`, `recommendations/dismiss/:id` | Suggest/act and panic-guard policy apply. | `src/api/nervous-endpoint.ts:2-5,109-176` |
| Evolution | GET `genealogy`, `retirement`, `prompt-metrics` | Read-oriented evolution projections. | `src/api/evolution-endpoint.ts:17-45` |
| Enterprise reads | GET `tenants`, `rbac`, `audit`, `rate`, `missions-audit` | Missing data can return empty 200 views. | `src/api/enterprise-endpoint.ts:1-8,253-305` |
| Enterprise writes | POST/PUT/DELETE `tenants[/:id]`, `rbac[/:id]`, `rate[/:id]` | Admin-RBAC gated and audit-logged. | `src/api/server.ts:832-856`; `src/api/enterprise-endpoint.ts:540-930` |
| Identity | GET `/api/auth/me`; POST `/api/auth/oidc/exchange` | OIDC exchange has its own gate because login has no bearer yet. | `src/api/auth-me-endpoint.ts:141-170`; `src/api/oidc-callback-endpoint.ts:294-330` |

### Streams and terminal

| Surface | Contract | Evidence |
|---|---|---|
| `GET /api/events` | Global dashboard SSE. Query-token use is limited to explicitly permitted paths. | `src/api/server.ts:1033-1062`; `src/api/middleware/token.ts:22-45` |
| `GET /api/output-stream?taskId=&sprintId=` | Scoped output SSE. | `src/api/output-stream.ts:6-15,394-402` |
| `GET /api/workers/:taskId/logs/stream` | Per-worker log SSE. | `src/api/worker-logs.ts:7-20,68-90` |
| `GET /api/terminal/token` | Loopback-only terminal-token bootstrap requiring a valid API bearer. | `src/api/server.ts:2567-2633` |
| `POST/GET /api/terminal/sessions`, `DELETE /api/terminal/sessions/:id` | Create/list/kill PTY or AI sessions under independent terminal auth. | `src/api/server.ts:2634-2708` |
| `/api/terminal/ws` | WebSocket terminal transport; token is not authorized by the generic API-auth bypass. | `src/api/server.ts`; `src/api/terminal/` |

### TERM-RPC

`POST /api/rpc` carries a versioned request/response envelope. The catalog contains `session.list`, `session.resume`, `run.status`, `run.start-detached`, `approval.list`, and `approval.decide`; `limits.get` is also present in the server handler map. Current write wiring supports `run.start-detached` and `approval.decide`, while `session.resume` remains explicitly unsupported. [Evidence: `src/core/term-rpc.ts:143-183`; `src/api/rpc-write-handlers.ts:120-199`; `src/api/server.ts:621-742,1385-1395`]

### Cross-verify receipt and approval-decision boundary

- Cross-verify (`deckent xverify`) is host-adjudicated across two DIFFERENT providers (author ≠ verifier; same-provider self-verify is forbidden). A claim reaches closure only through the full chain: genuine terminal verdict + actual provider call + provider-reported usage + terminally-closed settlement + a durable verdict receipt (`cross-verify-verdict:sha256:…`). `HOLD`/`UNCLEAR` is not closure. [Evidence: `CLOSURE-OS-PRODUCT-TRANSITION-BRIEF.md` §12.2]
- Approval decisions are a mutation. The MCP `deckent_approvals` tool is a READ-ONLY pending inbox (`ApprovalBroker.list('pending')`) — it exposes no allow/deny/decide/self-approval. A decision is taken only on the `deckent approvals decide` CLI surface behind interactive live-auth, or through the flag/policy-gated HTTP `POST /api/approvals/:id/decision` / `approval.decide` RPC. [Evidence: `src/mcp/tools/approvals.ts`; `src/cli/commands/approvals.ts`]
- Local-terminal auth is independent: `/api/terminal/token` is loopback-only and requires a valid API bearer; the WebSocket terminal transport is not authorized by the generic API-auth bypass. [Evidence: `src/api/server.ts:2567-2708`]

## Dogfood / repository reality

- ✅ Central bearer, rate, CORS, and control-mutation gates precede route dispatch. [Evidence: `src/api/server.ts:745-856`]
- ⚠️ The API surface is broader than a watch-only dashboard, but control mutations are intentionally disabled by default and multiple feature namespaces are flag-gated. [Evidence: `src/api/server.ts:570-600,817-856`; `src/api/run-flow-routes.ts:516-523`]
- ⚠️ This audit inspected source and real CLI registration; it did not start the API server or mutate external state. Runtime endpoint smoke is `HOLD`, not implied by route registration. [Evidence: task boundary; OQ-20]
