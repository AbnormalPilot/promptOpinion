# Prompt Opinion Marketplace Listing Copy

> Copy-paste-ready text for publishing ClinicalContext to the Prompt Opinion Marketplace. Required by hackathon rules ("Configure and publish your project to the Prompt Opinion Marketplace so it can be discovered and invoked within the platform").

---

## 1. App Name

```
ClinicalContext
```

(Must match exactly what you put in the Devpost "Published App Name" field.)

---

## 2. Tagline (~80 characters)

```
Prior authorization in 90 seconds — FHIR-native, MCP-powered, CMS-NCD-grounded.
```

*78 characters.*

---

## 3. Short description (~250 characters, listing card)

```
ClinicalContext automates the full prior-authorization workflow with 11 chained MCP tools — FHIR patient data, drug-safety checks, CMS NCD policy retrieval, SNOMED→ICD-10 mapping, and physician-ready letter drafting. Standards-native. Stateless. Safe.
```

*250 characters.*

---

## 4. Long description (listing detail page, ~600–800 words)

```markdown
**ClinicalContext** is a standards-compliant MCP server with an accompanying A2A
agent that reduces prior authorization from twenty minutes per request to under
two minutes — without sacrificing clinical accuracy or regulatory posture.

## What it solves

Prior authorization is the most-hated administrative burden in US healthcare.
Nurses and physicians spend 20–40 minutes per request — pulling charts, hunting
ICD-10 codes, documenting prior treatments tried, and writing justification
letters. The American Medical Association estimates this costs the US health
system **~$35 billion per year** and delays care by an average of three business
days.

ClinicalContext eliminates the drafting bottleneck. Send a single natural-language
prompt — *"Draft a prior auth for Ozempic for patient 131926799, payer Aetna"* —
and the agent chains eleven MCP tools to produce a payer-ready letter in under
ninety seconds.

## How it works

1. **Pulls FHIR data** — demographics, active conditions, full medication
   history, recent encounters, lab values, allergies, and procedures.
2. **Extracts unstructured evidence** — uses an LLM to read free-text physician
   notes and surface PA-relevant findings with direct quotes.
3. **OCRs scanned attachments** — runs tesseract.js over FHIR DocumentReference
   binaries when structured data is incomplete.
4. **Looks up coverage policy** — local-embedding RAG over 244 CMS National
   Coverage Determination chunks.
5. **Checks drug safety** — RxNorm REST drug-interaction lookup before drafting.
6. **Analyzes coverage requirements** — step-therapy and formulary analysis from
   the patient's actual medication history.
7. **Synthesizes clinical justification** — maps SNOMED CT codes to ICD-10-CM,
   computes a confidence score, surfaces safety flags.
8. **Drafts the letter** — full payer-ready PA letter with NCD citations.
9. **Drafts appeals** — when a denial occurs, generates a regulatorily-leveraged
   appeal letter.

## Why it qualifies for production

- **Stateless MCP server.** No patient data on disk. Every request creates a
  fresh server instance, torn down on response close.
- **SHARP context propagation.** The FHIR access token, base URL, and patient
  ID flow through three standardized headers. The token never enters the LLM
  prompt context.
- **Hallucination guards.** Every LLM prompt requires FHIR-field citation;
  every output includes a confidence score; the analyze tool surfaces a
  safety-flags array for the reviewing physician.
- **Human in the loop.** Every drafted letter carries the bold header
  "DRAFT — FOR PHYSICIAN REVIEW BEFORE SUBMISSION." A physician reads, edits if
  necessary, and signs before transmission.
- **Regulatory category.** Prior-auth drafting is administrative documentation,
  not clinical decision-making — a deliberately safe FDA SaMD classification
  under 21st Century Cures Act §3060.

## Standards compliance

| Standard | Compliance |
|---|---|
| MCP | SDK 1.25.1, both stdio and HTTP transports, 11 registered tools |
| A2A | v1 agent card at /.well-known/agent-card.json, JSON-RPC message/send |
| SHARP | Three-header propagation with JWT-claim-first patient resolution |
| FHIR R4 | Read-only against HAPI public R4; 9 resource types, full SMART scope set |

## Use cases inside Prompt Opinion

- **Compose with another agent.** Pair ClinicalContext with a documentation-audit
  agent or a coverage-negotiation agent for end-to-end PA cycle automation.
- **Single-shot from a clinician's workspace.** A licensed physician sends one
  prompt, reviews the draft, signs.
- **Appeal pipeline.** Ingest denial reasons → generate counter-arguments with
  clinical guidelines and regulatory citations.

## What you get

- 11 MCP tools, fully documented in the `/.well-known/` manifest.
- A2A v1 agent ready to be invoked from any compatible workspace.
- All source code MIT-licensed on GitHub.
- HIPAA-ready architecture (BAAs required with downstream LLM and EHR vendors
  for production deployment).

## Test patients

Two HAPI public R4 patients prepared for evaluation:
- `131926799` — Robert Barker (Type 2 DM + HTN, classic GLP-1 step-up case)
- `98067569` — Roscoe Arbuckle (osteoarthritis with chronic knee pain)

## Built for the Agents Assemble hackathon

ClinicalContext was built specifically for the Agents Assemble: Healthcare AI
Endgame challenge. It uses the platform's SHARP extension, publishes via the
Marketplace, and demonstrates standards-first interoperability across MCP, A2A,
and FHIR.
```

---

## 5. Tool catalog (per-tool listing copy)

For each tool, provide a name, one-line description, and example invocation.

### `fetch_patient_context`

> Loads a complete patient profile — demographics, active conditions, allergies, recent procedures — from FHIR R4. Call this first.

```json
{ "patient_id": "131926799" }
```

### `fetch_medication_list`

> Returns the patient's medication history (active, completed, or all) for step-therapy documentation.

```json
{ "patient_id": "131926799", "status": "all" }
```

### `fetch_clinical_history`

> Returns recent encounters, labs, and vitals — the medical-necessity evidence pool for PA letters.

```json
{ "patient_id": "131926799", "lookback_days": 180 }
```

### `extract_clinical_evidence`

> Reads unstructured physician notes via FHIR DocumentReferences and extracts PA-relevant findings with direct quotes.

```json
{
  "patient_id": "131926799",
  "requested_medication_or_procedure": "Ozempic 0.5mg weekly",
  "lookback_days": 365
}
```

### `process_clinical_document`

> OCRs scanned FHIR DocumentReference attachments via tesseract.js to make image-only chart pages searchable.

```json
{ "document_id": "abc123" }
```

### `lookup_coverage_policy`

> Retrieves CMS National Coverage Determination policy text via local-embedding similarity search across 244 NCD chunks.

```json
{ "query": "GLP-1 receptor agonist coverage criteria", "top_k": 5 }
```

### `check_coverage_requirements`

> Analyzes step therapy, formulary rules, and quantity limits against the patient's actual medication history.

```json
{
  "patient_id": "131926799",
  "requested_medication_or_procedure": "Ozempic 0.5mg weekly",
  "payer_name": "Aetna"
}
```

### `check_drug_interactions`

> Calls the public NLM RxNorm REST API to detect drug-drug interactions before drafting a PA.

```json
{
  "medication_name": "Ozempic",
  "current_medications": ["metformin", "amlodipine"]
}
```

### `analyze_prior_auth_need`

> Synthesizes clinical justification: maps SNOMED to ICD-10, evaluates step therapy, returns evidence points and a confidence score.

```json
{
  "patient_id": "131926799",
  "requested_medication_or_procedure": "Ozempic 0.5mg weekly",
  "requesting_provider": "Dr. Smith"
}
```

### `draft_prior_auth_request`

> Generates a complete, submission-ready PA letter with ICD-10 codes, prior-treatment table, NCD citations, and a confidence badge.

```json
{
  "patient_id": "131926799",
  "requested_medication_or_procedure": "Ozempic 0.5mg weekly",
  "requesting_provider": "Dr. Smith",
  "payer_name": "Aetna"
}
```

### `generate_appeal_letter`

> Drafts an appeal letter for a denied PA — clinical-guideline citations, regulatory leverage, and explicit denial-reason rebuttals.

```json
{
  "patient_id": "131926799",
  "requested_medication_or_procedure": "Ozempic 0.5mg weekly",
  "denial_reason": "Step therapy not met",
  "payer_name": "Aetna"
}
```

---

## 6. Tags / categories

```
healthcare, prior-authorization, fhir, fhir-r4, mcp, a2a, sharp, llm, rag,
cms-ncd, rxnorm, ocr, payer-automation, smart-on-fhir, hipaa, ehr-integration,
clinical-documentation, glp-1, step-therapy, drug-interactions
```

Pick the top 5–8 the Marketplace allows. Lead with: `healthcare`, `prior-authorization`, `mcp`, `a2a`, `fhir`.

---

## 7. Logo / visual assets

The Marketplace listing should include:

- **App icon** (square PNG, 512×512) — clean wordmark on neutral background.
- **Hero image** (16:9, 1920×1080) — the architecture diagram from `assets/architecture.svg`.
- **Screenshots** (3–6 total):
  1. Workspace prompt being typed.
  2. Tool chain executing in the platform.
  3. Rendered PA letter.
  4. Marketplace tool catalog page.
  5. Architecture diagram.
  6. Confidence badge + safety flags close-up.

---

## 8. SHARP context configuration

When configuring the listing, declare the SHARP context expectations explicitly:

```json
{
  "sharp_context": {
    "patient_id": "{{patient_id}}",
    "fhir_base_url": "{{fhir_base_url}}",
    "fhir_token": "{{fhir_token}}"
  }
}
```

This tells the platform to inject these variables automatically when an upstream agent invokes ClinicalContext.

---

## 9. Recommended scope declarations (SMART)

If the Marketplace lets you declare required SMART scopes, include:

```
patient/Patient.rs
patient/Condition.rs
patient/MedicationRequest.rs
patient/Encounter.rs
patient/Observation.rs
patient/AllergyIntolerance.rs
patient/Procedure.rs
patient/DiagnosticReport.rs
patient/DocumentReference.rs
```

All read-only. No write scopes.

---

## 10. Sample workflow / quick-start for marketplace consumers

A concrete copy-paste example for someone discovering ClinicalContext through the Marketplace:

```
Prompt: "Draft a prior authorization for Adalimumab (Humira) 40mg subcutaneous
injection every 14 days, for patient 131926799, requesting provider Dr. Smith,
payer Blue Cross Blue Shield."

Expected runtime: ~90 seconds
Expected output: full PA letter, ICD-10 codes (M30.x family for inflammatory
condition), step-therapy summary, drug-interaction check, NCD citation, confidence
score.
```

---

## 11. Versioning + changelog (for marketplace updates)

Initial publication: **v1.0.0**

Subsequent updates should follow semver:
- **v1.0.x** — bug fixes, prompt-tuning, doc improvements.
- **v1.x.0** — new tools, new resource types, new payers.
- **v2.0.0** — breaking changes to tool schemas or SHARP convention.

Maintain a `CHANGELOG.md` at the repo root for marketplace release notes.

---

## 12. Pre-publish QA checklist

- [ ] All three services running healthy in Docker (`/health` returns 200 for each).
- [ ] `tools/list` MCP call returns all 11 tools.
- [ ] `agent-card.json` reachable and valid JSON.
- [ ] Test patient `131926799` returns a successful PA letter end-to-end.
- [ ] No `console.log` of FHIR tokens or patient bundles (run `grep -r "fhirToken" src/ a2a-agent/src/`).
- [ ] Marketplace listing screenshots all rendered at 1920×1080.
- [ ] Listing description proofread (no typos — the listing is judge-visible).
- [ ] Hackathon-required Marketplace URL pasted into Devpost `SUBMISSION.md`.
