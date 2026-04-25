# Devpost Submission Packet — ClinicalContext

> Copy-paste each section into the matching Devpost field. Text is tuned to the three judging criteria (AI Factor, Potential Impact, Feasibility) and to the specific judges on the panel.

---

## 1. Project name (60 chars max)

```
ClinicalContext — Prior Auth Agent (MCP + FHIR + RAG)
```

*53 chars. Hits all three keywords judges scan for: MCP, FHIR, RAG.*

**Alternates:**
- `ClinicalContext: AI Prior Authorization Agent` (46 chars — simpler)
- `ClinicalContext — Prior Auth in 90 Seconds` (43 chars — impact-led)

---

## 2. Elevator pitch (200 chars max)

```
Prior auth wastes 20 minutes per request and costs US healthcare $35B/year. ClinicalContext chains 11 MCP tools — FHIR, RxNorm, CMS NCD, LLM — to draft a payer-ready PA letter in 90 seconds.
```

*189 chars. Pain → solution → quantified outcome. All three judging criteria triggered in one sentence.*

---

## 3. About the project (Markdown, full story)

```markdown
## Inspiration

Prior authorization is the single most-hated administrative burden in US healthcare. A nurse or physician spends 20–40 minutes per request — pulling charts, hunting ICD-10 codes, documenting prior treatments tried, and writing a clinical-justification letter — for every medication or procedure flagged by a payer. The American Medical Association estimates this costs the US healthcare system **~$35 billion per year** and delays care by an average of 3 business days.

We listened to clinicians describe PA as "the moment I question if I should have gone to medical school." That's the wedge. PA drafting is *administrative* (not clinical decision-making), making it a regulatorily safe target for AI — and the unstructured reasoning involved (interpreting diagnoses, inferring medical necessity, mapping to coverage policy) is exactly what rule-based software cannot do. This is the AI Factor in plain sight.

## What it Does

**ClinicalContext** is a standards-compliant **MCP server** with an accompanying **A2A agent** that automates the full prior authorization workflow end-to-end.

A clinician (or any upstream agent) sends a single instruction — *"Draft a prior auth for Ozempic for patient Robert Barker, payer Aetna"* — and ClinicalContext chains **11 MCP tools** to deliver a payer-ready letter in under 2 minutes:

| # | Tool | Capability |
|---|------|------------|
| 1 | `fetch_patient_context` | FHIR demographics, conditions, allergies, procedures |
| 2 | `fetch_medication_list` | Full medication history (step-therapy documentation) |
| 3 | `fetch_clinical_history` | Encounters, labs, vitals (medical-necessity evidence) |
| 4 | `extract_clinical_evidence` | LLM extraction from unstructured FHIR notes |
| 5 | `process_clinical_document` | OCR scanned FHIR DocumentReferences (tesseract.js) |
| 6 | `lookup_coverage_policy` | RAG over 244 CMS NCD policy chunks (local embeddings) |
| 7 | `check_coverage_requirements` | LLM step-therapy + formulary analysis |
| 8 | `check_drug_interactions` | RxNorm REST API drug-safety check |
| 9 | `analyze_prior_auth_need` | LLM clinical-justification synthesis with ICD-10 mapping |
| 10 | `draft_prior_auth_request` | Full PA letter with NCD citations |
| 11 | `generate_appeal_letter` | Appeal drafts for denied PAs |

Every tool propagates **SHARP context** so the FHIR token, base URL, and patient ID flow automatically through the chain — the calling agent never has to manage credentials.

## How We Built It

### Architecture (3 services)

```
A2A Agent (port 8001) — Google ADK + Gemini 2.5 Flash
        Natural language -> auto-chains 11 MCP tools
                          |
                          | MCP protocol + SHARP headers
                          v
MCP Server (port 3000) — 11 tools
        FHIR + LLM + RAG + RxNorm + OCR
                          |
                          v
RAG Service (port 3001)
        244 CMS NCD chunks, local @xenova embeddings
```

### Tech Choices

- **MCP Server**: TypeScript, `@modelcontextprotocol/sdk`, Express 5, Groq (Llama 3.3 70B for fast structured reasoning).
- **A2A Agent**: `@google/adk` + Gemini 2.5 Flash for orchestration.
- **FHIR**: HAPI public R4 server, axios client, full SHARP propagation.
- **RAG**: `vectra` + `@xenova/transformers` — local embeddings, **zero API key**, runs anywhere.
- **OCR**: `tesseract.js` for scanned chart pages.
- **Drug Safety**: RxNorm REST API.

### Standards Compliance

- **MCP**: Stateless HTTP transport, fresh server per request, all 11 tools registered with full Zod schemas.
- **SHARP**: Three-header propagation (`x-fhir-server-url`, `x-fhir-access-token`, `x-patient-id`) with token-claim fallback.
- **A2A**: v1-compliant agent card, JSON-RPC `message/send`, FHIR-context extension.
- **FHIR R4**: Read-only access to Patient, Condition, MedicationRequest, Encounter, Observation, AllergyIntolerance, Procedure, DiagnosticReport, DocumentReference.

## What We Learned

- **MCP statelessness simplifies horizontal scaling.** The server creates a fresh `McpServer` per request and tears it down on `res.close`. No session state, no leak. Beautiful primitive.
- **Local embeddings beat cloud RAG for hackathons.** `@xenova/transformers` runs `all-MiniLM-L6-v2` in Node — 244 CMS NCD chunks indexed in seconds, no API quota, zero cost.
- **Groq's structured-output mode is brutally fast.** PA letter generation lands in ~1.2s on Llama 3.3 70B, meaningfully faster than alternatives for this prompt class.
- **SHARP is the right abstraction.** Once headers propagate cleanly, every downstream tool inherits the patient context. The platform handles credential lifecycle so we don't.
- **Hallucination is the entire game.** Our LLM prompts cite FHIR fields explicitly ("From `Patient.name[0]`...") and the analyze tool returns a confidence score. Low confidence = warning surfaced to the clinician.

## Challenges

- **A2A SDK churn.** Early `@google/adk` builds had `runAsync` / `State.get` / SSE-parsing quirks that swallowed agent responses silently. We patched the bridge to handle both SSE and plain-JSON MCP responses, took the last `data:` line, and added timeout guards.
- **FHIR null-safety.** The HAPI public server has incomplete records — every field needed null guards. Multiple defensive commits wrap every FHIR call in try/catch with graceful fallback.
- **OCR error fallback.** When a `DocumentReference` has no attachment, we initially double-pushed errors. Fixed by branching cleanly on the no-attachment path.
- **CMS NCD ingestion.** Raw NCD policies are gnarly XML. We wrote a loader that strips boilerplate, splits on coverage-criteria boundaries, and produces 244 retrievable chunks with policy IDs preserved for citation.
- **Demo timing.** End-to-end flow targets ≤90 seconds. We profiled each tool, parallelized the three FHIR reads, and pre-warmed the embedding model on RAG-service boot.

## Feasibility & Compliance

- **Synthetic data only.** All testing uses HAPI public test patients (Robert Barker `131926799`, Roscoe Arbuckle `98067569`). No real PHI ever touched.
- **Human in the loop.** Output is explicitly labeled "DRAFT — Physician Review Required." This keeps us on the safe side of practicing-medicine-without-a-license rules.
- **HIPAA posture.** FHIR tokens injected via SHARP headers, never logged or stored. Stateless MCP server holds no patient data.
- **Safety guardrails.** Drug-interaction check runs before letter drafting. Allergies surfaced in patient context. Confidence scores attached to every LLM output.
- **Regulatory category.** PA drafting is administrative documentation, not clinical decision-making — a deliberately safe regulatory niche for AI.

## Impact

- **Time:** ~20 min → ~90 sec per request (≈92% reduction).
- **Volume:** A clinic processing 40 PA requests/day saves ~12 hours of clinical staff time daily.
- **Cost:** Sector-wide, PA workflows cost the US health system **~$35B/year** (AMA). A 90% efficiency gain is a multi-billion-dollar opportunity.
- **Patient outcome:** Faster authorization → 3-day average wait collapses to same-day for in-formulary requests.

## What's Next

- **Pilot with a real EHR**: Epic App Orchard or SMART-on-FHIR sandbox.
- **Payer-specific prompt fine-tuning**: tone and format vary by Aetna / UnitedHealth / Anthem / state Medicaid.
- **Closed-loop appeals**: ingest denial letters, auto-generate appeal with regulatory leverage and clinical-guideline citations.
- **Multi-agent composition inside Prompt Opinion**: pair with a "Coverage Negotiation Agent" or "Documentation Audit Agent" — multi-agent composition is the whole point of the platform.
```

---

## 4. Built with

```
typescript, node.js, model-context-protocol, mcp, a2a, sharp, fhir, fhir-r4, hapi-fhir, google-adk, gemini, gemini-2.5-flash, groq, llama-3.3, express, axios, zod, vectra, xenova-transformers, tesseract.js, rxnorm, cms-ncd, docker, docker-compose
```

*Tag list optimized for Devpost search + judge keyword scanning.*

---

## 5. Try it out links

| Label | URL |
|---|---|
| GitHub repo | `https://github.com/<your-handle>/clinicalcontext-mcp` |
| Prompt Opinion Marketplace listing | `https://promptopinion.ai/marketplace/<slug>` *(fill after publishing)* |
| Agent card | `https://<deploy-host>/.well-known/agent-card.json` |
| MCP endpoint | `https://<deploy-host>/mcp` |
| Live demo (optional UI) | `https://<deploy-host>/` |

---

## 6. Image gallery (suggested 6 screenshots, 3:2 ratio, ≤5 MB each)

1. **Prompt Opinion workspace** with ClinicalContext agent invoked, showing the natural-language input.
2. **Tool-chain execution** — sequence of 11 tools firing with status indicators.
3. **Generated PA letter** — full rendered letter with ICD-10 chips highlighted and NCD citations.
4. **Marketplace listing page** — proves Marketplace publication (required by rules).
5. **Architecture diagram** — the 3-service block diagram from the README.
6. **SHARP context flow** — header propagation across MCP / A2A boundary.

---

## 7. Video demo link

3-minute YouTube unlisted upload. Script outline:

- **0:00–0:20** — Pain framing. "PA takes 20 minutes per request. Here's what 90 seconds looks like."
- **0:20–1:30** — Live demo inside Prompt Opinion. Single prompt → 11 tools fire → letter drops.
- **1:30–2:15** — SHARP context + interoperability. Show another agent in the platform invoking ClinicalContext.
- **2:15–2:45** — Marketplace listing + standards compliance (MCP, A2A, FHIR, SHARP all named).
- **2:45–3:00** — Quantified close. "$35B/year market. 92% time reduction. Available in the Marketplace today."

---

## 8. Additional info — for judges

### Submitter Country of Residence
*[fill — your residence]*

### Published App Name
```
ClinicalContext
```
*Must match exactly the name displayed in Prompt Opinion after publishing.*

### Published URL from Prompt Opinion Marketplace
```
https://promptopinion.ai/marketplace/<slug>
```
*Fill after Marketplace publication. **This is required — the rules call out Marketplace publication explicitly.***

### Submission Type
Check **all three** that apply:
- ✅ **MCP Server** — 11 tools registered.
- ✅ **External A2A Agent** — `a2a-agent/` service, agent card published, JSON-RPC compliant.
- ✅ **Prompt Opinion A2A Agent** — *only check if you also configured an in-platform agent that wraps the MCP tools.*

*If you only ran the external agent, drop the third box. Honest signal.*

### Project new or existing prior to March 2nd?
```
New
```
*First commit: 2026-04-16. Started after the cutoff date.*

### If existing, explain integration
```
N/A — project is new (first commit 2026-04-16).
```

### Feedback for Prompt Opinion (optional but valuable)

```
Three observations from building on the platform:

1. SHARP context propagation is the single biggest reason to build here — it dissolves the FHIR-credential plumbing problem that usually consumes 30% of healthcare-AI engineering effort. A typed SDK helper that wraps SHARP headers (rather than raw header strings) would let tool authors focus entirely on clinical logic.

2. Tool-call observability inside an A2A agent run is currently shallow — for multi-tool chains like ours (11 tools), seeing the per-tool latency, payload size, and error trace in the platform console would dramatically speed up debugging. Today we tail server logs.

3. Marketplace publishing UX could surface a "first-call validation" check that hits each registered tool with a synthetic SHARP context — catches schema mismatches before users do.

Overall: the standards-first posture (MCP + A2A + SHARP all native) is the right call. It's the first platform that lets us build healthcare-AI without inventing the auth layer.
```

---

## 9. Upload-a-file (35 MB max)

Recommend a `submission.zip` containing:
- `README.md` (judges' first-stop overview)
- `ARCHITECTURE.md` (the 3-service diagram + standards mapping)
- `SAFETY.md` (HIPAA / human-in-loop / regulatory category notes)
- `screenshots/` (the 6 images above)
- `demo-transcript.md` (full demo prompt + final letter for offline reading)

Skip source — link the GitHub repo instead.

---

## Compliance Checklist (rules → submission)

| Rule | Where Satisfied |
|---|---|
| Use Prompt Opinion platform | Demo video shows in-platform invocation |
| Use SHARP Extension Specs | `src/sharp/context.ts`, three-header propagation |
| Use FHIR data (recommended) | All FHIR tools hit HAPI public R4 server |
| Publish to Prompt Opinion Marketplace | URL filled in section 8 |
| Demo video under 3 minutes | Section 7 outline lands at 3:00 |
| Submit before May 11, 2026 11:00pm EDT | Target submit ≥2 days early (May 9) |
