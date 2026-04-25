# Safety, Compliance, and Clinical Posture

> Audience: practicing-clinician judges (Dr. Mathur, Dr. Mandel) and platform-integration judges (Joshua Hickey, Dr. Proctor) evaluating **Feasibility**.
>
> Thesis: prior-authorization drafting is one of the few healthcare-AI workflows that is **regulatorily safe today** — and ClinicalContext is engineered to keep it that way.

---

## 1. Safety summary

| Pillar | Mechanism | Where to verify |
|---|---|---|
| **Synthetic data only** | All testing on HAPI public R4 sandbox; no real PHI | `.env.example`, `src/fhir/client.ts` |
| **Human in the loop** | Every output labeled "DRAFT — FOR PHYSICIAN REVIEW BEFORE SUBMISSION" | `src/llm/prompts.ts` (DRAFT_PRIOR_AUTH_SYSTEM) |
| **Hallucination guards** | LLM prompts require FHIR-field citation for every clinical claim | `src/llm/prompts.ts` (RULES sections) |
| **Confidence scoring** | Every LLM tool returns 0.0–1.0 confidence; downstream tools surface low-confidence warnings | `analyze_prior_auth_need`, `draft_prior_auth_request` |
| **Drug-interaction safety** | RxNorm REST check before letter drafting | `src/tools/checkDrugInteractions.ts` |
| **Allergy surfacing** | `fetch_patient_context` always returns `AllergyIntolerance` resources for the patient | `src/tools/fetchPatientContext.ts` |
| **Token redaction** | FHIR access tokens never logged, never in LLM prompts | `src/sharp/context.ts`, `a2a-agent/src/fhir-hook.ts` |
| **Stateless server** | MCP server holds no patient data between requests | `src/index.ts::res.on("close", ...)` |
| **Regulatory category** | PA drafting is administrative documentation, not clinical decision-making | This document, §6 |

---

## 2. HIPAA posture

ClinicalContext is engineered for a HIPAA-compliant deployment, even though hackathon testing uses synthetic data.

### Data at rest

> **The MCP server stores zero patient data.**

- Stateless HTTP transport; `sessionIdGenerator: undefined` in `StreamableHTTPServerTransport`.
- Per-request `McpServer` instance, torn down on `res.close`.
- No database, no file cache, no log line containing PHI.

### Data in transit

- All FHIR I/O is HTTPS in production deployment (HAPI public is HTTPS too).
- A2A → MCP traffic is HTTP-only on a private network; in production this would be HTTPS via reverse proxy.
- Tokens transit only as `Authorization: Bearer <token>` to FHIR and as `x-fhir-access-token` between A2A agent and MCP server.

### Token handling

- Tokens enter the system **only** in:
  - A2A `message.metadata.fhirToken` (or `fhir_token`, or `x-fhir-access-token`)
  - MCP server `x-fhir-access-token` request header
- Tokens are written to ADK session state via `context.state.set("fhirToken", ...)` so tools can read them — but the LLM **never** receives them.
- `fhir-hook.ts` runs as `beforeModelCallback`, so tokens are placed in state *before* Gemini sees the prompt, never as part of it.
- No `console.log` statement in the codebase prints `fhirToken` or `Authorization`. Verifiable: `grep -r "fhirToken" src/ a2a-agent/src/` returns extraction code only.

### Logging discipline

| Allowed | Disallowed |
|---|---|
| Tool name | Tool arguments |
| Patient ID *count* (presence) | Patient ID *value* in production |
| Resource type counts | Resource bodies |
| Error class names | Stack traces with PHI in messages |
| Latencies | OAuth tokens |

Today the code logs minimally; for production you would route all logs through a structured logger with explicit redaction filters (`pino` with `redact: ["fhirToken", "Authorization"]`).

### BAA-readiness

For real deployment, signed Business Associate Agreements are required with:

- The FHIR provider (Epic, Cerner, Athena, etc.) — covered by SMART-on-FHIR launch contracts.
- The LLM vendor (Groq) — requires Groq's BAA addendum.
- The platform (Prompt Opinion) — via Marketplace listing.

ClinicalContext does not need a BAA itself in production because **it stores nothing**. It is a stateless transformation service.

---

## 3. Hallucination guards

The single largest failure mode for clinical AI is fabricating facts. ClinicalContext defends against this in five layers.

### Layer 1: Prompt-level field citation requirement

Every LLM system prompt includes explicit `RULES` sections forcing the model to cite source fields:

```
RULES:
- Every clinical fact must come from the provided patient data
- Cite specific lab values with dates (e.g., "HbA1c of 8.2% on 04/10/2026")
- If prior treatment data is missing, write "No prior treatment documentation available
  in the electronic health record"
- NEVER fabricate clinical details
```

(Source: `src/llm/prompts.ts::DRAFT_PRIOR_AUTH_SYSTEM`)

### Layer 2: Structured-output schemas

Every LLM tool uses `response_format: { type: "json_object" }` with a fixed schema. This makes the model's output mechanically inspectable — fields like `evidence_points`, `data_sources`, and `safety_flags` are required.

Example output schema for `analyze_prior_auth_need`:

```json
{
  "evidence_points": ["specific clinical fact with value, e.g. 'HbA1c 8.2% on 2026-04-10 ...'"],
  "data_sources": ["FHIR resource types used"],
  "safety_flags": ["items the reviewing physician must verify before submission"],
  "confidence": 0.0
}
```

### Layer 3: Confidence scoring

Every LLM tool returns a 0.0–1.0 confidence. The `DRAFT_PRIOR_AUTH_SYSTEM` and `ANALYZE_PRIOR_AUTH_SYSTEM` prompts include explicit calibration:

```
- 0.9+ = strong evidence + step therapy met
- 0.7–0.9 = good evidence, minor gaps
- 0.5–0.7 = some evidence, significant gaps
- <0.5 = weak case, recommend gathering more data
```

The agent's orchestration prompt (`a2a-agent/src/agent.ts`) is instructed to "highlight the confidence score and any safety flags" in its final response.

### Layer 4: RAG grounding for policy claims

When a letter cites coverage policy, the citation comes from the RAG retrieval (`lookup_coverage_policy`) — actual CMS NCD text, not the model's training data. The 244-chunk index covers the relevant National Coverage Determinations.

### Layer 5: Human-in-the-loop labeling

The drafted letter's first line is hard-coded into the system prompt:

```
HEADER: "DRAFT — FOR PHYSICIAN REVIEW BEFORE SUBMISSION" (bold, centered)
```

A physician must read and sign before anything is filed with a payer. This is not a soft suggestion — it is the regulatory boundary that keeps PA drafting on the safe side of practicing medicine.

---

## 4. Drug-safety guardrail

`check_drug_interactions` runs against the **NLM RxNorm** REST API (free, no key, public service):

```
GET https://rxnav.nlm.nih.gov/REST/interaction/list.json?rxcuis=<csv>
```

The agent's orchestration prompt places this **before** `draft_prior_auth_request` in the workflow. Any flagged interaction surfaces in the letter's `safety_flags` array and the agent's final response includes an explicit caution.

Patient allergies are surfaced via `fetch_patient_context` (which reads `AllergyIntolerance`) and made available to the drafting LLM. The system prompt explicitly checks for contraindications:

> "CONTRAINDICATIONS: Check allergies and current medications for contraindications to the requested treatment."
> (`src/llm/prompts.ts::ANALYZE_PRIOR_AUTH_SYSTEM`)

---

## 5. Failure-mode inventory

A clinical system must be evaluated by what happens when it goes wrong. Each row below is a real failure mode and the implemented response.

| # | Failure mode | Symptom | Implemented response |
|---|---|---|---|
| 1 | FHIR server is down | Tool returns error | Tool returns `Error: <reason>` text response; agent surfaces it; user sees "FHIR unavailable" not a fabricated letter |
| 2 | Patient ID is invalid / 404 | `fhir.read` returns `null` | Tool returns `"Patient <id> not found"` text response; downstream chain halts |
| 3 | FHIR returns malformed/incomplete data | Missing fields | Null-safe parsing throughout; missing → `null` (never silent default) |
| 4 | LLM returns invalid JSON | Parse fails | `safeParseJSON` returns `{ error: "...", raw: <truncated> }` — never crashes |
| 5 | LLM hallucinates a fact | Letter contains made-up value | Layered defense: prompt rules + structured schema + confidence score + human review |
| 6 | RAG returns no relevant chunks | `lookup_coverage_policy` returns empty | Drafting tool falls back to general PA criteria; surfaces "no specific NCD found" in the letter |
| 7 | Drug-interaction lookup fails | RxNorm down | Tool returns warning; agent surfaces "drug-safety check unavailable" — does NOT proceed silently |
| 8 | OCR fails on scanned doc | tesseract.js error | Tool returns error; analysis proceeds without that document; letter notes the gap |
| 9 | LLM rate-limited (Groq 429) | Tool throws | Wrapped error: `"Groq rate limit hit. Wait a moment and retry."` — no fabricated fallback |
| 10 | Token expired | FHIR returns 401 | Error propagates; agent reports auth failure |
| 11 | Network timeout | axios `ECONNABORTED` | 15s FHIR timeout, 30s LLM timeout, 30s MCP-bridge timeout — clear timeout error to caller |

**Principle:** when in doubt, **report the failure**, never invent the answer.

---

## 6. Regulatory category

This is the most important section for clinician judges.

### What ClinicalContext is

> **An administrative documentation assistant.** It composes prior-authorization request letters from existing structured + unstructured patient data. The output is a **draft document** that a licensed physician reviews, edits if necessary, and signs before transmission to a payer.

### What ClinicalContext is **not**

- **Not** a clinical decision-support tool. It does not recommend a course of treatment. The prescribing decision is upstream — the physician has already decided to prescribe Drug X; ClinicalContext only assembles the paperwork.
- **Not** a diagnostic device. It does not interpret images, classify disease, or generate diagnoses. It maps existing diagnoses (already coded in the chart) to the codes the payer wants.
- **Not** practicing medicine. The output is administrative. The physician's signature is the medical act.

### Why this matters

Under FDA's Software as a Medical Device (SaMD) framework and the 21st Century Cures Act §3060, software that **transcribes, communicates, or formats** existing clinical decisions is *excluded* from device regulation. ClinicalContext sits in this safe harbor by design.

This is not an accident. The narrowness of the use case is the wedge — wider clinical-AI use cases are regulatorily fraught and slow to deploy. PA drafting is the rare workflow where AI can ship into a real EHR session **today**.

### CMS Final Rule (April 2024) alignment

CMS's January 2024 Final Rule on prior authorization (CMS-0057-F) explicitly contemplates electronic prior-authorization workflows under the Patient Access API. ClinicalContext's standards-first design (FHIR R4 + SMART scopes + electronic submission) sits cleanly inside that regulatory direction.

---

## 7. Privacy of clinical reasoning

The system handles three distinct data flows. Each has a privacy note:

1. **Patient data → LLM (Groq).** Patient FHIR data is sent to Groq for reasoning. In production this requires a Groq BAA. The data sent is de-identified to the extent possible: we send the resources the model needs, never the full bundle.
2. **Coverage queries → RAG service.** Queries to the local RAG service are *coverage-policy lookups* (e.g., "GLP-1 receptor agonist coverage criteria"). They contain no PHI. The RAG service runs locally — queries never leave the network.
3. **Drug interactions → RxNorm.** Queries contain RxCUI codes only — no patient identifier. RxNorm is a public NLM service.

For a stricter posture, swap Groq for an on-prem LLM (e.g., a self-hosted Llama on AWS PrivateLink) with no architectural change — the abstraction in `src/llm/client.ts` is one client interface.

---

## 8. Audit trail

Every PA letter generated by `draft_prior_auth_request` includes a `data_sources` array (FHIR resource types used) and an `all_icd10_codes` array. This gives the reviewing physician a quick attestation: "this letter cites FHIR data of types X, Y, Z and ICD-10 codes A, B, C — does this match what I expect for this patient?"

For a richer audit trail in production, capture:

```
{
  "draft_id": uuid,
  "timestamp": ISO,
  "patient_id": <id>,
  "tool_chain": [{ tool, latency_ms, status }],
  "fhir_resources_read": [{ type, id, last_updated }],
  "llm_model": "llama-3.3-70b-versatile",
  "rag_chunks_cited": [{ ncd_id, similarity }],
  "confidence": 0.0,
  "physician_signed_off_by": <user_id>,
  "submitted_to_payer_at": ISO
}
```

This is straightforward to add — a 50-line audit middleware in front of the MCP `/mcp` route. It is intentionally not in the hackathon submission to keep the surface area auditable, but the design supports it cleanly.

---

## 9. What a clinician should know in 30 seconds

If you are a practicing clinician evaluating this submission, here are the four things to know:

1. **The letter is a draft, not a transmission.** You see it, you sign it. Standard PA workflow.
2. **Every fact comes from the chart.** The model is instructed to cite FHIR fields; missing data is reported as missing, not invented.
3. **Drug interactions and allergies are checked before drafting.** RxNorm runs. Allergies are surfaced.
4. **The output includes a confidence score and safety flags.** Low confidence = "go gather more data before sending."

Everything else is plumbing.

---

## 10. Independent review checklist

For your own attestation that the safety claims above hold, here is a five-minute review path:

1. Open `src/llm/prompts.ts`. Read the `RULES` block at the bottom of `DRAFT_PRIOR_AUTH_SYSTEM`. Confirm the never-fabricate rule.
2. Open `src/llm/client.ts`. Confirm `response_format: { type: "json_object" }` and a 30s abort signal.
3. Open `src/index.ts`. Confirm `res.on("close", () => { transport.close(); server.close(); })` — proves statelessness.
4. Open `a2a-agent/src/fhir-hook.ts`. Confirm tokens are written to state only; nothing returned into the LLM call.
5. Run `grep -r "fhirToken\|Authorization" src/ a2a-agent/src/`. Confirm no `console.log` of either.

If all five hold, the safety posture in this document is the safety posture in the code.
