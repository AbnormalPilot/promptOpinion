# Architecture

> Technical deep-dive for the ClinicalContext system. Audience: judges with engineering / platform / FHIR backgrounds (Mandel, Tripathi, Proctor, Hickey).

---

## 1. Topology

ClinicalContext is a **three-process system** with single-direction dependencies. Each process has its own healthcheck and can be deployed and scaled independently.

```
                           ┌──────────────────────────────────┐
                           │    Prompt Opinion Workspace      │
                           │    (any agent in the platform)   │
                           └─────────────────┬────────────────┘
                                             │
             A2A v1 JSON-RPC                 │   message/send
             + SHARP context (metadata)      │
                                             ▼
┌────────────────────────────────────────────────────────────────┐
│  A2A Agent  ::  Node 20  ::  port 8001                         │
│  ─────────────────────────────────────────────────────────     │
│  @google/adk    Gemini 2.5 Flash    @a2a-js/sdk                │
│                                                                │
│  ┌──────────────────────┐    ┌──────────────────────────┐     │
│  │ app-factory.ts       │    │ agent.ts                 │     │
│  │  - Agent card        │    │  - Orchestration prompt  │     │
│  │  - JSON-RPC handler  │    │  - Tool order policy     │     │
│  │  - Session creation  │    └──────────────────────────┘     │
│  └──────────────────────┘                                      │
│                                                                │
│  ┌──────────────────────┐    ┌──────────────────────────┐     │
│  │ fhir-hook.ts         │    │ mcp-bridge.ts            │     │
│  │  beforeModelCallback │    │  FunctionTool wrappers   │     │
│  │  - extracts SHARP    │    │  - reads ADK State       │     │
│  │  - writes to State   │    │  - injects 3 headers     │     │
│  └──────────────────────┘    │  - parses SSE/JSON       │     │
│                              └──────┬───────────────────┘     │
└─────────────────────────────────────┼──────────────────────────┘
                                      │
                                      │  HTTP POST /mcp
                                      │  + 3 SHARP headers
                                      ▼
┌────────────────────────────────────────────────────────────────┐
│  MCP Server  ::  Node 20  ::  port 3000                        │
│  ─────────────────────────────────────────────────────────     │
│  @modelcontextprotocol/sdk    Express 5    Groq    Zod         │
│                                                                │
│  src/index.ts ──► creates fresh McpServer per request          │
│                   StreamableHTTPServerTransport                │
│                   sessionIdGenerator: undefined  (stateless)   │
│                                                                │
│   ┌──────────────────┐  ┌──────────────────┐                   │
│   │ sharp/context.ts │  │ sharp/constants  │                   │
│   │  - getFhirContext│  │  - 3 header names│                   │
│   │  - getPatientId  │  │  - extension URI │                   │
│   │  - JWT claim     │  └──────────────────┘                   │
│   └──────────────────┘                                         │
│                                                                │
│   ┌──────────────────────────────────────────────────────┐     │
│   │ tools/  (11 implementations registering on McpServer)│     │
│   └─────────┬────────────┬────────────┬────────────┬─────┘     │
│             │            │            │            │           │
│             ▼            ▼            ▼            ▼           │
│         FHIR client   Groq LLM     RAG client   RxNorm/OCR     │
└────────┬─────────────────┬───────────────┬───────────────┬─────┘
         │                 │               │               │
         ▼                 ▼               ▼               ▼
   ┌──────────┐      ┌────────────┐   ┌────────────┐  ┌──────────┐
   │ HAPI R4  │      │ Groq cloud │   │ RAG svc    │  │ RxNorm   │
   │ public   │      │ Llama 3.3  │   │ port 3001  │  │ public   │
   └──────────┘      └────────────┘   └─────┬──────┘  └──────────┘
                                            │
                                            ▼
                                  ┌──────────────────────┐
                                  │ vectra index         │
                                  │ 244 CMS NCD chunks   │
                                  │ all-MiniLM-L6-v2     │
                                  │ (xenova local)       │
                                  └──────────────────────┘
```

### Why three processes?

| Concern | Owned by | Why split |
|---|---|---|
| Natural-language reasoning + tool orchestration | A2A agent | Different runtime profile (LLM-bound), different SDK churn risk |
| Tool surface + standards layer | MCP server | Stateless, horizontally scalable, the artifact other agents reuse |
| Vector retrieval + embedding model warm-up | RAG service | Long startup (model load), CPU-bound; isolating it lets the rest stay zippy |

---

## 2. Request lifecycle

### A user prompt → A2A agent

1. Client (Prompt Opinion workspace OR `curl`) POSTs to `http://localhost:8001/`:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "message/send",
  "params": {
    "message": {
      "kind": "message",
      "role": "user",
      "parts": [{"kind": "text", "text": "Draft PA for Ozempic, patient 131926799, payer Aetna"}],
      "metadata": {
        "fhirUrl": "https://hapi.fhir.org/baseR4",
        "fhirToken": "<bearer-or-empty>",
        "patientId": "131926799"
      }
    }
  }
}
```

2. `app-factory.ts` extracts text, builds a `stateDelta` from `message.metadata`, calls `sessionService.createSession({...state: stateDelta})`, and starts the ADK runner.

3. `fhir-hook.ts` (`beforeModelCallback`) normalizes header conventions and writes them onto `context.state` so tools can read via `state.get("fhirUrl")`. **FHIR credentials never enter the LLM prompt context.**

4. Gemini 2.5 Flash receives the prompt + the 11 `FunctionTool` schemas exported by `mcp-bridge.ts`. It plans which tools to call, in what order.

### A2A agent → MCP server

5. For each tool call, `mcp-bridge.ts::callMcpTool` does:

```ts
headers["x-fhir-server-url"] = state.get("fhirUrl")
headers["x-fhir-access-token"] = state.get("fhirToken")
headers["x-patient-id"] = state.get("patientId")
POST /mcp { jsonrpc, method: "tools/call", params: { name, arguments } }
```

6. The bridge tolerates **both** SSE streams (`data: <json>\n`) and plain JSON responses — the latest production `@modelcontextprotocol/sdk` returns SSE; older returned JSON. The bridge takes the **last** `data:` line for SSE (skipping intermediate progress events).

### MCP server execution

7. `src/index.ts` creates a fresh `McpServer` per request (no shared state), registers all 11 tools, and connects a `StreamableHTTPServerTransport` with `sessionIdGenerator: undefined` (stateless mode — required by the SDK to skip session bookkeeping).

8. `sharp/context.ts` extracts the FHIR URL/token/patient-id from headers. **Patient ID resolution order:**
   - JWT claim `patient` if `x-fhir-access-token` is a valid JWT (`jose.decodeJwt`)
   - `x-patient-id` header
   - Tool argument fallback (for local testing)

9. The tool executes — pulling FHIR data, calling Groq, hitting RAG, etc. — and returns a `textResponse(...)`.

10. On `res.close`, both transport and `McpServer` are torn down. **Zero shared state between requests.**

### Tool → downstream services

- **FHIR tools** → `FhirClient` (axios). Reads only. Bearer-token if present. 15s timeout.
- **LLM tools** → `callLLM(systemPrompt, userMessage)` against Groq Llama-3.3-70B with `response_format: json_object`, `temperature: 0.2`, `max_tokens: 4096`. 30s abort signal.
- **RAG tool (`lookup_coverage_policy`)** → POST to `http://rag-service:3001/search` with the query; receives top-k chunks with NCD policy IDs.
- **OCR tool** → `tesseract.js` against the binary content fetched from FHIR `DocumentReference.content[].attachment`.
- **RxNorm tool** → `https://rxnav.nlm.nih.gov/REST/interaction/list.json` (no key required).

---

## 3. SHARP context propagation

SHARP is the Prompt Opinion extension that propagates healthcare context (FHIR base URL, OAuth token, patient ID) through MCP / A2A call chains without forcing tool authors to invent token plumbing.

```
┌──────────────────────────────────────────────────────────────────┐
│   Prompt Opinion workspace (or curl)                             │
│                                                                  │
│   message.metadata: {                                            │
│     fhirUrl, fhirToken, patientId                                │
│   }                                                              │
└──────────────────────┬───────────────────────────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────────────────────────┐
│   A2A Agent — app-factory.ts                                     │
│   stateDelta = { fhirUrl, fhirToken, patientId, a2aMetadata }    │
│   sessionService.createSession({ ..., state: stateDelta })       │
└──────────────────────┬───────────────────────────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────────────────────────┐
│   ADK runner → fhir-hook.ts (beforeModelCallback)                │
│   normalizes camelCase / snake_case / header-style keys          │
│   context.state.set("fhirUrl", ...)                              │
│   ⚠ token never enters the LLM context window                    │
└──────────────────────┬───────────────────────────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────────────────────────┐
│   mcp-bridge.ts — for each tool call                             │
│   headers = {                                                    │
│     "x-fhir-server-url":  state.get("fhirUrl"),                  │
│     "x-fhir-access-token": state.get("fhirToken"),               │
│     "x-patient-id":        state.get("patientId"),               │
│   }                                                              │
│   POST /mcp                                                      │
└──────────────────────┬───────────────────────────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────────────────────────┐
│   MCP Server — sharp/context.ts                                  │
│   getFhirContext(req) → { url, token? }                          │
│   getPatientId(req) → JWT claim → header → tool arg              │
│   FhirClient(config) auto-attaches Authorization: Bearer ...     │
└──────────────────────────────────────────────────────────────────┘
```

**Defining choices:**

- **No credential parameters in tool schemas.** `patient_id` is `optional` everywhere — SHARP-resolved by default.
- **JWT-claim-first pattern.** If the FHIR token is a JWT with a `patient` claim, that wins over the header. Matches SMART-on-FHIR launch context behavior.
- **Multi-key normalization.** Real-world platforms send `fhirUrl`, `fhir_url`, or `x-fhir-server-url`. The hook accepts all three.
- **Token redaction.** Tokens are never logged. The MCP server logs only `[mcp]` request paths and tool names.

---

## 4. MCP statelessness

```ts
// src/index.ts
app.post("/mcp", async (req, res) => {
  const server = new McpServer({...}, {capabilities: {tools: {}}});
  for (const tool of Object.values<IMcpTool>(tools)) {
    tool.registerTool(server, fhirConfig);
  }
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,  // stateless
  });
  res.on("close", () => { transport.close(); server.close(); });
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});
```

**Why stateless:**

- **Horizontal scaling for free** — load balance any request to any replica.
- **No leak surface** — patient context lives only on the request `req` object and is GC'd after `res.close`.
- **Crash safety** — process restart leaves no orphaned session state.
- **HIPAA-friendly** — there is no "patient data on disk" question because there is no patient data on disk.

**Trade-offs accepted:**

- Per-request `McpServer` construction has small overhead (~1ms). Negligible vs. the 200–1500ms LLM/RAG/FHIR latency that dominates the chain.
- Cannot maintain across-call session continuity inside the MCP server. Continuity lives at the A2A-agent layer (`sessionId` in `Runner.runAsync`), which is the right place for it.

---

## 5. RAG pipeline

### Indexing (one-time, on RAG service boot)

```
CMS NCD raw XML  ──►  cms-loader.ts
                      ├── strips boilerplate, header/footer artifacts
                      ├── splits on coverage-criteria boundaries
                      └── 244 chunks  (≈ 80–250 tokens each)

                ──►  embeddings.ts
                      └── @xenova/transformers
                          all-MiniLM-L6-v2 (384-dim)
                          local — no API call, no key

                ──►  vector-store.ts
                      └── vectra LocalIndex (in-process, file-backed)
                          { id, text, metadata: { ncd_id, section } }
```

### Query path

```
tool: lookup_coverage_policy(query, top_k = 5)
  POST http://rag-service:3001/search
       { query, top_k }
  
  RAG service:
     embed(query) -> 384-dim vector
     vectra.queryItems(vec, top_k)
     return top_k chunks with similarity scores + NCD IDs
  
  ─► reasoning chain has ground truth to cite
```

### Why local embeddings

| Cloud RAG | Local (xenova) |
|---|---|
| OpenAI/Cohere API key required | Zero keys |
| Rate limits during demo | Unlimited |
| Cold-start request latency | Pre-warmed on boot |
| Cost per query | $0 |
| Privacy of query terms | Never leaves the box |

For 244 chunks, the all-MiniLM-L6-v2 model is more than enough. The model is ~22 MB and loads in ~3 seconds on first use.

---

## 6. FHIR data access

### Resources read (read-only, by SMART scope)

| Resource | Used by tools | SMART scope |
|---|---|---|
| `Patient` | 1, 2, 3, 4, 5, 7, 9, 10, 11 | `patient/Patient.rs` |
| `Condition` | 1, 7, 9, 10, 11 | `patient/Condition.rs` |
| `MedicationRequest` | 2, 7, 8, 9, 10, 11 | `patient/MedicationRequest.rs` |
| `Encounter` | 3, 4, 9, 10, 11 | `patient/Encounter.rs` |
| `Observation` | 3, 4, 9, 10, 11 | `patient/Observation.rs` |
| `AllergyIntolerance` | 1, 8, 9, 10, 11 | `patient/AllergyIntolerance.rs` |
| `Procedure` | 1, 9, 10, 11 | `patient/Procedure.rs` |
| `DiagnosticReport` | 4 (optional) | `patient/DiagnosticReport.rs` |
| `DocumentReference` | 5 (OCR) | `patient/DocumentReference.rs` |

These scopes are **declared in MCP server capabilities** (`src/index.ts::capabilities.experimental[FHIR_CONTEXT_EXTENSION].scopes`) so the platform can validate launch context up-front.

### Parallelization strategy

Tools that need multiple resource types fetch them in parallel:

```ts
const [patient, conditions, medications, allergies, encounters, observations] = await Promise.all([
  fhir.read(`Patient/${pid}`),
  fhir.search("Condition", { patient: pid, "clinical-status": "active" }),
  fhir.search("MedicationRequest", { patient: pid }),
  fhir.search("AllergyIntolerance", { patient: pid }),
  fhir.search("Encounter", { patient: pid, _sort: "-date", _count: "5" }),
  fhir.search("Observation", { patient: pid, _sort: "-date", _count: "15" }),
]);
```

This collapses 6 sequential round-trips into 1 — material for HAPI public, which has tail latency.

### Defensive parsing

Every FHIR field access is null-safe (`?.`/`||`). Three rounds of bug-fix commits (`a7c6501`, `4215494`, `f5ec9bd`) hardened parsers against malformed/missing fields on the public sandbox.

---

## 7. Deployment topology

### Local development

Three terminals:

```
TERM 1  npm run start                         # MCP server  3000
TERM 2  cd rag-service && npm run start       # RAG svc     3001
TERM 3  cd a2a-agent && npm run start         # A2A agent   8001
```

### Single-machine Docker

```
docker compose up --build
```

Docker compose enforces healthcheck-based startup ordering (`mcp-server` waits for `rag-service`, `a2a-agent` waits for `mcp-server`). Each service has its own `/health` endpoint.

### Production deployment recommendation

| Service | Recommended host | Notes |
|---|---|---|
| MCP server | Render/Fly/Railway/Cloud Run | Stateless, scale to N replicas |
| RAG service | Same provider, single replica | Holds index in memory; pin one instance |
| A2A agent | Same provider | One per tenant if multi-tenant |

Network rules:
- Only A2A agent must be publicly reachable (Prompt Opinion calls it).
- MCP server can be private — only A2A agent calls it.
- RAG service is private — only MCP server calls it.

---

## 8. Observability hooks

| Layer | What's logged | Format |
|---|---|---|
| A2A agent | `[a2a] message/send sessionId=<uuid> textLen=<n>` | `console.log` |
| A2A bridge | `[mcp-bridge] Timeout calling tool <name>` etc. | `console.error` |
| MCP server | `MCP request error:` + stack on 5xx | `console.error` |
| FHIR client | Errors propagate; 404 → `null`/`[]` | exception |

**Never logged:** FHIR tokens, full patient bundles (only counts), LLM prompt contents.

For production, swap `console.log` for a structured logger (`pino`, `winston`) and stream to your APM. The current logging is intentionally minimal for HIPAA posture.

---

## 9. AI integration depth

This section addresses the "AI Factor" judging criterion explicitly.

| Reasoning task | Where it lives | Why an LLM is needed |
|---|---|---|
| Mapping SNOMED CT → ICD-10 | `analyze_prior_auth_need` prompt | Code-system mapping is incomplete in deterministic tables; LLM handles novel synonyms and unspecified codes |
| Inferring medical necessity from labs + vitals + history | `analyze_prior_auth_need` | Requires synthesizing across resource types and weighing severity — pure pattern matching cannot |
| Step-therapy reasoning | `check_coverage_requirements` | Payer rules are textual ("must try at least one second-generation oral antidiabetic for ≥3 months"); LLM matches against patient's actual med history |
| Drafting clinical-quality letters | `draft_prior_auth_request` | Generates payer-appropriate prose with the right structure, tone, and citations — language generation, not lookup |
| Extracting evidence from unstructured notes | `extract_clinical_evidence` | Free-text physician notes have no schema; LLM extracts and quotes |
| Drafting appeals with regulatory leverage | `generate_appeal_letter` | Combines clinical evidence with applicable regulations (Mental Health Parity, ERISA, state PA laws) — synthesis |
| RAG over CMS NCD policy | `lookup_coverage_policy` + downstream chains | Retrieves authoritative policy text so generation is grounded, not invented |

**No traditional rule-based system can do this end-to-end.** That is the AI Factor case.

---

## 10. Future architectural moves

| Move | Rationale | Effort |
|---|---|---|
| Replace HAPI test server with Epic/Cerner SMART-on-FHIR sandbox | Real EHR posture for pilot | 2–3 days |
| Add Redis cache layer in front of FHIR | Cut PA workflow time below 60s | 1 day |
| Per-payer prompt library | Aetna / UnitedHealth / Anthem tones | 3–5 days |
| Closed-loop appeal ingestion | Read denial PDF → auto-appeal | 5–7 days |
| Multi-tenant SHARP context | Production marketplace use | 1 week |
| WebSocket streaming on A2A | Live tool-call visibility in workspace | 2 days |
