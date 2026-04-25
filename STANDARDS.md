# Standards Compliance Map

> Audience: judges with deep standards expertise — Dr. Josh Mandel (FHIR architecture, Microsoft Research) and Dr. Stephon Proctor (CHOP, platform innovation).
>
> This document maps every standard ClinicalContext claims compliance with to a specific file, line range, and observable behavior.

---

## TL;DR

| Standard | Version | Spec | Implementation |
|---|---|---|---|
| MCP | SDK 1.25.1 | [modelcontextprotocol.io](https://modelcontextprotocol.io/) | `src/index.ts`, `src/stdio.ts`, `src/tools/*` |
| A2A | v1 | [a2a.dev](https://a2a.dev) | `a2a-agent/src/app-factory.ts`, `a2a-agent/src/server.ts` |
| SHARP | po-community spec | Prompt Opinion extension | `src/sharp/context.ts`, `src/sharp/constants.ts`, `a2a-agent/src/fhir-hook.ts` |
| FHIR | R4 (4.0.1) | [hl7.org/fhir/R4](https://hl7.org/fhir/R4/) | `src/fhir/client.ts`, all FHIR tools |
| SMART scopes | (used to declare access) | [smarthealthit.org](http://www.hl7.org/fhir/smart-app-launch/) | `src/index.ts::capabilities.experimental.scopes` |

---

## 1. Model Context Protocol (MCP)

**Spec:** Anthropic's Model Context Protocol — a standardized way to expose tools, resources, and prompts to LLM agents.
**SDK:** `@modelcontextprotocol/sdk@1.25.1` (`package.json::dependencies`)

### 1.1 Two transports supported

| Transport | Entry point | Use case |
|---|---|---|
| HTTP (Streamable) | `src/index.ts` | Remote / multi-tenant deployment, MCP Marketplace publication |
| stdio | `src/stdio.ts` | Local clients, MCP Inspector, `test-client.ts` |

Both transports register the **same** 11 tools from `src/tools/index.ts`. The transport is the only difference.

### 1.2 Stateless HTTP transport

```typescript
// src/index.ts
const transport = new StreamableHTTPServerTransport({
  sessionIdGenerator: undefined,   // stateless mode
});

res.on("close", () => {
  transport.close();
  server.close();
});

await server.connect(transport);
await transport.handleRequest(req, res, req.body);
```

Per the SDK spec, `sessionIdGenerator: undefined` enables stateless mode where the transport does not maintain a session ID across requests. We construct a fresh `McpServer` per HTTP POST, register tools, handle the call, and tear down. **No across-request state.**

### 1.3 Tool registration

Each tool implements `IMcpTool` and registers itself via `server.tool(name, description, inputSchema, handler)`:

```typescript
// src/tools/types.ts
export interface IMcpTool {
  registerTool(server: McpServer, fhirConfig?: FhirConfig): void;
}

export function textResponse(text: string) {
  return { content: [{ type: "text" as const, text }] };
}
```

Every tool input schema is a Zod object. The MCP SDK derives JSON Schema for the tool catalog automatically.

### 1.4 Capabilities declaration

```typescript
// src/index.ts
const server = new McpServer(
  { name: "clinicalcontext-mcp", version: "1.0.0" },
  {
    capabilities: {
      tools: {},
      experimental: {
        [FHIR_CONTEXT_EXTENSION]: {
          scopes: [
            { name: "patient/Patient.rs", required: true },
            { name: "patient/Condition.rs" },
            // ... see §4 for the full list
          ],
        },
      },
    },
  }
);
```

We expose the **`tools`** capability (canonical) and an **experimental** capability under the Prompt Opinion extension URI declaring the SMART scopes the server reads. This lets the platform validate the launch context up-front.

### 1.5 Tool catalog (11 tools)

| Tool | File | Lines |
|---|---|---|
| `fetch_patient_context` | `src/tools/fetchPatientContext.ts` | full file |
| `fetch_medication_list` | `src/tools/fetchMedicationList.ts` | full file |
| `fetch_clinical_history` | `src/tools/fetchClinicalHistory.ts` | full file |
| `extract_clinical_evidence` | `src/tools/extractClinicalEvidence.ts` | full file |
| `process_clinical_document` | `src/tools/processClinicalDocument.ts` | full file |
| `lookup_coverage_policy` | `src/tools/lookupCoveragePolicy.ts` | full file |
| `check_coverage_requirements` | `src/tools/checkCoverageRequirements.ts` | full file |
| `check_drug_interactions` | `src/tools/checkDrugInteractions.ts` | full file |
| `analyze_prior_auth_need` | `src/tools/analyzePriorAuthNeed.ts` | full file |
| `draft_prior_auth_request` | `src/tools/draftPriorAuthRequest.ts` | full file |
| `generate_appeal_letter` | `src/tools/generateAppealLetter.ts` | full file |

### 1.6 Verifying MCP compliance

```bash
# stdio transport
npm run inspect

# HTTP transport
curl -s -X POST http://localhost:3000/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

The `tools/list` response should return all 11 tools with their schemas.

---

## 2. Agent-to-Agent (A2A) Protocol

**Spec:** A2A v1 — JSON-RPC over HTTP for agent discovery and message exchange.
**SDK:** `@a2a-js/sdk@0.3.10` + `@google/adk@0.3.0` (`a2a-agent/package.json`)

### 2.1 Agent card (discovery)

```typescript
// a2a-agent/src/app-factory.ts (excerpt)
const agentCard = {
  name,
  description,
  version,
  capabilities: { streaming: false, pushNotifications: false },
  skills: [
    { id: "prior-auth-full", name: "Prior Authorization Automation", ... },
    { id: "prior-auth-appeal", name: "Prior Authorization Appeal", ... },
  ],
  supportedInterfaces: [{ protocol: "a2a", url: url }],
  ...(fhirExtensionUri ? { extensions: [fhirExtensionUri] } : {}),
};

app.get("/.well-known/agent-card.json", (_req, res) => res.json(agentCard));
```

The agent card is served at the canonical `/.well-known/agent-card.json` path (RFC 8615 well-known URIs).

**Verify:**

```bash
curl http://localhost:8001/.well-known/agent-card.json
```

### 2.2 JSON-RPC `message/send` handler

```typescript
// a2a-agent/src/app-factory.ts (excerpt)
app.post("/", async (req, res) => {
  const body = req.body;
  const method = body?.method;

  if (method === "message/send") {
    // 1. Extract text from message.parts
    // 2. Build stateDelta from message.metadata (FHIR context)
    // 3. createSession idempotently
    // 4. runner.runAsync(...)
    // 5. Return JSON-RPC response wrapping the agent message
  }
});
```

Compliant with the A2A v1 message envelope: `{ kind, messageId, contextId, role, parts }`.

### 2.3 FHIR-context extension

The agent card's `extensions: [fhirExtensionUri]` field declares that this agent expects FHIR context in `message.metadata`. The default extension URI is `https://promptopinion.ai/schemas/a2a/v1/fhir-context` (overridable via `FHIR_EXTENSION_URI` env).

Calling clients that recognize this extension know to populate `metadata.fhirUrl`, `metadata.fhirToken`, and `metadata.patientId` when sending messages.

### 2.4 Session continuity

```typescript
const contextId = message.contextId || uuidv4();
const sessionId = contextId;
```

Multi-turn conversations work because the `contextId` (provided by the client) maps 1:1 to an ADK `sessionId`. State (including FHIR credentials) persists across turns within the same context.

### 2.5 Verifying A2A compliance

```bash
curl -X POST http://localhost:8001/ \
  -H 'Content-Type: application/json' \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "message/send",
    "params": {
      "message": {
        "kind": "message",
        "role": "user",
        "parts": [{"kind":"text","text":"Draft PA for Ozempic for patient 131926799, payer Aetna"}],
        "metadata": {
          "fhirUrl": "https://hapi.fhir.org/baseR4",
          "patientId": "131926799"
        }
      }
    }
  }'
```

---

## 3. SHARP-on-MCP context propagation

**Spec:** Prompt Opinion's SHARP extension — propagates `fhir_server_url`, `fhir_access_token`, and `patient_id` through MCP/A2A call chains.
**Constants:** `src/sharp/constants.ts`

```typescript
export const SHARP_HEADERS = {
  fhirServerUrl: "x-fhir-server-url",
  fhirAccessToken: "x-fhir-access-token",
  patientId: "x-patient-id",
} as const;

export const FHIR_CONTEXT_EXTENSION = "ai.promptopinion/fhir-context";
```

### 3.1 Three-header propagation

| Header | Purpose | Source preference |
|---|---|---|
| `x-fhir-server-url` | FHIR base URL | A2A metadata → header |
| `x-fhir-access-token` | OAuth bearer token | A2A metadata → header |
| `x-patient-id` | Resolved patient FHIR ID | JWT claim → header → tool arg |

### 3.2 MCP server extraction

```typescript
// src/sharp/context.ts
export function getFhirContext(req: Request): FhirContext | null {
  const url = req.headers[SHARP_HEADERS.fhirServerUrl]?.toString();
  if (!url) return null;
  const token = req.headers[SHARP_HEADERS.fhirAccessToken]?.toString();
  return { url, token };
}

export function getPatientId(req: Request, toolArg?: string): string | null {
  // 1. Try JWT patient claim
  const fhirToken = req.headers[SHARP_HEADERS.fhirAccessToken]?.toString();
  if (fhirToken) {
    try {
      const claims = jose.decodeJwt(fhirToken);
      if (claims["patient"]) return claims["patient"]?.toString() ?? null;
    } catch { /* not a JWT — skip */ }
  }
  // 2. Try x-patient-id header
  const headerPatientId = req.headers[SHARP_HEADERS.patientId]?.toString();
  if (headerPatientId) return headerPatientId;
  // 3. Fallback to tool argument (for local testing)
  return toolArg ?? null;
}
```

The JWT-claim-first pattern aligns with **SMART-on-FHIR launch context**: when the FHIR token is itself a JWT carrying a `patient` claim, that wins. This matches the way EHRs (Epic, Cerner) launch SMART apps with patient context bound to the access token.

### 3.3 A2A bridge injection

```typescript
// a2a-agent/src/mcp-bridge.ts (excerpt)
const headers: Record<string, string> = {
  "Content-Type": "application/json",
  Accept: "application/json, text/event-stream",
};

if (state["fhirUrl"])    headers["x-fhir-server-url"]   = state["fhirUrl"];
if (state["fhirToken"])  headers["x-fhir-access-token"] = state["fhirToken"];
if (state["patientId"])  headers["x-patient-id"]        = state["patientId"];
```

### 3.4 ADK state hydration

```typescript
// a2a-agent/src/fhir-hook.ts
export function extractFhirContext(params: { context: any; request: any }) {
  const meta = context.state?.get?.("a2aMetadata") as Record<string, string> | undefined;
  if (!meta) return undefined;

  // Multi-key normalization (camelCase, snake_case, header-style)
  const url = meta["fhirUrl"] ?? meta["fhir_url"] ?? meta["x-fhir-server-url"];
  const token = meta["fhirToken"] ?? meta["fhir_token"] ?? meta["x-fhir-access-token"];
  const patientId = meta["patientId"] ?? meta["patient_id"] ?? meta["x-patient-id"];

  if (url) context.state.set("fhirUrl", url);
  if (token) context.state.set("fhirToken", token);
  if (patientId) context.state.set("patientId", patientId);
}
```

This runs as `beforeModelCallback`, **before** Gemini sees the prompt. FHIR credentials are placed on session state, not in LLM context.

### 3.5 Tool-schema implication

Because SHARP propagates context, every FHIR-aware tool declares `patient_id` as **optional**:

```typescript
{
  patient_id: z.string().optional().describe("FHIR Patient resource ID (auto-resolved from SHARP context if omitted)"),
  // ...
}
```

The calling agent can omit it; SHARP supplies it.

---

## 4. FHIR R4

**Spec:** HL7 FHIR R4 (4.0.1) — REST API for healthcare resources.
**Test server:** `https://hapi.fhir.org/baseR4` (public, no auth).
**Client:** `src/fhir/client.ts` (axios wrapper).

### 4.1 Resource access list

| Resource | Capability | SMART scope (declared in MCP capabilities) |
|---|---|---|
| `Patient` | `read` | `patient/Patient.rs` (required) |
| `Condition` | `read`, `search` | `patient/Condition.rs` |
| `MedicationRequest` | `read`, `search` | `patient/MedicationRequest.rs` |
| `Observation` | `read`, `search` | `patient/Observation.rs` |
| `Encounter` | `read`, `search` | `patient/Encounter.rs` |
| `AllergyIntolerance` | `read`, `search` | `patient/AllergyIntolerance.rs` |
| `Procedure` | `read`, `search` | `patient/Procedure.rs` |
| `DiagnosticReport` | `read`, `search` | `patient/DiagnosticReport.rs` |
| `DocumentReference` | `read` | `patient/DocumentReference.rs` |

**All access is read-only.** ClinicalContext does not write FHIR resources back.

### 4.2 Search parameter usage

| Tool | Resource | Params |
|---|---|---|
| `fetch_patient_context` | Condition | `patient`, `clinical-status=active` |
| `fetch_patient_context` | Procedure | `patient`, `_sort=-date`, `_count=10` |
| `fetch_medication_list` | MedicationRequest | `patient`, `status` (active/completed/all) |
| `fetch_clinical_history` | Encounter | `patient`, `_sort=-date`, `_count=10` |
| `fetch_clinical_history` | Observation | `patient`, `_sort=-date`, `_count=20` |
| `draft_prior_auth_request` | (parallel) | All of the above |

### 4.3 Standard FHIR conventions honored

- **Bundle entry traversal:** `bundle.entry.map(e => e.resource)` (handles missing `entry` gracefully).
- **Sort syntax:** `_sort=-date` (descending by date).
- **Pagination:** `_count=N` to cap result size.
- **Status filtering:** `clinical-status=active`, `status=active|completed|all`.
- **Resource references:** Where `Condition.code.coding[0].code` is unavailable, falls back to `code.text`.
- **Date fields:** Honors both `onsetDateTime` and `onsetPeriod.start`.

### 4.4 SNOMED → ICD-10 mapping

The HAPI public sandbox returns conditions coded in SNOMED CT. US payers require ICD-10-CM. The `analyze_prior_auth_need` LLM prompt is explicitly instructed to perform the code-system mapping:

```
- Map SNOMED to ICD-10 (e.g., SNOMED 44054006 → ICD-10 E11.9 for Type 2 DM)
```

The output schema separates them:

```json
{
  "primary_diagnosis": {
    "icd10": "E11.9",
    "display": "Type 2 diabetes mellitus without complications",
    "snomed": "44054006"
  }
}
```

This preserves the FHIR-native code while emitting the ICD-10-CM the payer wants on the form. **A clean answer to the long-standing FHIR/ICD-10 impedance mismatch in payer workflows.**

---

## 5. SMART-on-FHIR alignment

While ClinicalContext does not run a SMART launch sequence itself (the platform handles that), it is **launch-ready** in two ways:

### 5.1 Scope declarations

The MCP server's `capabilities.experimental[FHIR_CONTEXT_EXTENSION].scopes` array enumerates exactly the SMART scopes it needs. A SMART-launching platform can match this against the access token's `scope` claim.

### 5.2 Patient-context binding via JWT

Per §3.2, when the access token is a JWT with a `patient` claim, that claim is the authoritative patient ID. This is the SMART-on-FHIR EHR-launch contract.

### 5.3 SMART version

The system targets **SMART App Launch v2.0** semantics — `patient/<Resource>.rs` (read + search) scope syntax (v2), not the older `*.read` (v1) syntax.

---

## 6. Cross-standard interaction matrix

This matrix shows where one standard hands off to another in a real PA flow:

```
SMART-on-FHIR launch
  │
  │  delivers JWT with `patient` claim, access token, FHIR URL
  ▼
A2A v1  message/send
  │
  │  message.metadata embeds the SMART context (or external SHARP)
  ▼
ADK State  (a2aMetadata → fhirUrl/fhirToken/patientId)
  │
  │  fhir-hook.ts normalizes; tools read via state.get(...)
  ▼
MCP HTTP  POST /mcp + 3 SHARP headers
  │
  │  src/sharp/context.ts extracts; JWT claim wins for patient ID
  ▼
FHIR R4  REST calls with Authorization: Bearer <token>
  │
  │  axios client; bundle traversal; null-safe parsing
  ▼
Tool output  (textResponse with structured JSON)
```

**Each boundary is a standard, not a custom protocol.** That is the design thesis: every hop is interoperable.

---

## 7. Verification commands

These commands let an evaluator confirm compliance without reading the code.

| Standard | Command | Expected |
|---|---|---|
| MCP tools/list | `curl -X POST http://localhost:3000/mcp -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'` | 11 tools returned |
| MCP capabilities | Same as above with `method: "initialize"` | Capabilities object including `experimental.ai.promptopinion/fhir-context` |
| A2A agent card | `curl http://localhost:8001/.well-known/agent-card.json` | JSON with name, skills[], supportedInterfaces[] |
| A2A message/send | (See §2.5) | JSON-RPC result with agent message containing PA letter text |
| FHIR live read | `curl 'https://hapi.fhir.org/baseR4/Patient/131926799'` | Robert Barker patient resource |
| SHARP propagation | Set `x-patient-id: 131926799` on MCP request, omit from tool args | Tool resolves patient automatically |

---

## 8. What we deliberately did not build

To keep scope honest:

- **OAuth flow.** We do not implement SMART-on-FHIR token issuance ourselves. We accept tokens; the platform/EHR issues them. This is correct separation of concerns.
- **FHIR write operations.** We never `POST` or `PUT` to FHIR. PA submission to the payer is downstream and out of scope.
- **MCP `resources` and `prompts` capabilities.** We only expose `tools`. Resources and prompts are not needed for this workflow.
- **A2A `streaming` and `pushNotifications` capabilities.** Marked `false` in the agent card. The PA flow finishes in one round-trip; streaming would be a v2 feature.

This is honest scoping — declared in the agent card, not glossed over.
