# ClinicalContext — Prompt Opinion Marketplace Listing

## Headline

**Closed-loop, self-learning prior authorization.**

The only healthcare-MCP server where every prior auth makes the next one
stronger. 18 tools. FHIR-native. Calibrated. Adversarially reviewed. Court-grade
provenance. Dose-safety pre-flight.

---

## App name

```
ClinicalContext
```

## Tagline (~80 chars)

```
Closed-loop, self-learning prior authorization. 18 MCP tools. FHIR-native.
```

## Short description (~250 chars)

```
ClinicalContext is the first closed-loop prior-auth MCP server. 18 tools
chain FHIR retrieval, CMS-NCD RAG, calibrated approval prediction,
adversarial review, dose-safety pre-flight, and an outcome-recording memory
store — so every PA you ship calibrates the next one.
```

---

## Why ClinicalContext (vs other healthcare-MCP servers)

| Capability | the-momentum/fhir-mcp | wso2 healthcare | AWS HealthLake | AgentCare | **ClinicalContext** |
|---|---|---|---|---|---|
| FHIR R4 read | yes | yes | yes | yes | **yes** |
| RAG over CMS NCD | no | no | partial | no | **244-chunk local** |
| Drug-interaction check | no | no | no | no | **RxNorm live** |
| OCR scanned chart pages | no | no | no | no | **tesseract.js** |
| Approval-probability prediction | no | no | no | no | **calibrated, Brier-tracked** |
| Counterfactual evidence suggestion | no | no | no | no | **yes** |
| Adversarial self-review | no | no | no | no | **yes** |
| Outcome recording → memory store | no | no | no | no | **yes (closed loop)** |
| Court-grade audit log | no | partial | partial | no | **per-call signed** |
| Dose-safety categorical pre-flight | no | no | no | no | **yes (pregnancy, allergies, MTC)** |
| PHI redaction before LLM | no | partial | yes | no | **yes** |
| SHARP context propagation | n/a | n/a | n/a | n/a | **3-header standard** |

The five differentiators we lead with:

1. **Closed-loop memory.** `record_pa_outcome` writes the prediction + actual
   outcome into a local memory store. Subsequent predictions use comparable
   priors and a Brier-calibrated probability — the system literally gets more
   accurate per request.
2. **Calibration, surfaced.** `/health` exposes a live Brier score and a
   reliability diagram. Most healthcare AI hides its uncertainty. We publish it.
3. **Adversarial review.** Before the letter goes out, an adversarial pass
   reads it like the payer's denial team and flags weaknesses with the exact
   denial reason that would be cited.
4. **Court-grade provenance.** Every tool call lands in an append-only audit
   log with FHIR-field citations on every clinical claim. Nothing the model
   asserts is unsourced.
5. **Dose-safety pre-flight.** Categorical contraindications (e.g.
   atorvastatin in pregnancy) refuse the call before any LLM token is spent.

---

## The 18 tools, by group

### FHIR retrieval (3)

- `fetch_patient_context` — demographics + active conditions + allergies + procedures.
- `fetch_medication_list` — full medication history for step-therapy documentation.
- `fetch_clinical_history` — encounters, labs, vitals over a configurable window.

### Unstructured + scanned data (2)

- `extract_clinical_evidence` — LLM extraction over physician free-text notes
  with direct-quote citations.
- `process_clinical_document` — tesseract.js OCR over FHIR DocumentReference
  binaries.

### Coverage + safety (3)

- `lookup_coverage_policy` — local-embedding RAG over 244 CMS NCD chunks.
- `check_coverage_requirements` — step-therapy + formulary analysis against
  the patient's actual medication history.
- `check_drug_interactions` — public NLM RxNorm REST drug-interaction check.

### Drafting (3)

- `analyze_prior_auth_need` — clinical justification + SNOMED→ICD-10 mapping +
  confidence + safety flags.
- `draft_prior_auth_request` — full payer-ready PA letter with NCD citations
  and a confidence badge.
- `generate_appeal_letter` — denial-rebuttal letter with regulatory leverage.

### v2 self-learning layer (7)

- `predict_approval_probability` — calibrated probability of approval given
  drug + ICD-10 + payer + evidence. Returns confidence band, key factors,
  comparable priors used, primary denial risks.
- `suggest_counterfactual_evidence` — given a current probability, what
  evidence (already in the chart, already in FHIR) would raise it most?
- `adversarial_review` — payer's-denial-team critique of a draft letter, with
  severity-tagged weaknesses and required fixes.
- `patient_explainer` — sixth-grade-reading-level patient-facing explanation
  of what the PA is, what insurance is deciding, and what to do next.
- `cost_alternative_analysis` — RxNorm-grounded clinically-equivalent
  alternatives ranked by PA likelihood and patient cost.
- `record_pa_outcome` — append a prediction + actual outcome to the memory
  store; closes the loop.
- `learning_stats` — `memory_size`, `calibration_brier`, `reliability_diagram`,
  `top_weakness_patterns`. Exposed at `/health` too.

---

## Standards compliance

| Standard | Compliance |
|---|---|
| MCP | SDK 1.25.x, stdio + HTTP transports, **18 registered tools** |
| A2A | v1 agent card at `/.well-known/agent-card.json`, JSON-RPC `message/send` |
| SHARP | Three-header propagation, JWT-claim-first patient resolution |
| FHIR R4 | Read-only against HAPI public R4; 9 resource types; full SMART scope set |

---

## Architecture (one paragraph)

A2A agent (Google ADK + Gemini 2.5 Flash) on port 8001 chains MCP tools on
port 3000, which calls a local RAG service on port 3001 backed by `vectra` +
`@xenova/transformers`. Stateless server, JWT-claim-first patient resolution,
zero patient data on disk except the append-only `pa_memory.jsonl` outcome
store and `audit.log`.

---

## Sample workflow

Single prompt to the A2A agent:

```
Draft a prior authorization for Ozempic (semaglutide 0.5mg weekly) for
patient 131926799. Payer Aetna. Requesting provider Dr. Smith.
```

What happens, end-to-end:

1. Tools 1–3 fetch the FHIR record.
2. Tools 4–8 check interactions, retrieve NCD policy, run coverage analysis.
3. Tools 9–10 analyze and draft.
4. **Tool 12 predicts** — say 0.42, too risky.
5. **Tool 13 suggests** — adding the documented metformin trial duration and
   BMI would lift the probability.
6. **Tool 14 adversarially reviews** the draft and flags one more weakness.
7. Re-predict — 0.81.
8. After submission, **tool 17 records** the outcome.
9. **Tool 18 reports** Brier score and memory growth.

Approximate runtime for the full v2 chain: 90–120 s. Numbers above are
illustrative — see `[FILL FROM eval/REPORT.md]` for the measured eval set.

---

## Test patients (HAPI public R4)

- `131926799` — Robert Barker (Type 2 DM + HTN; canonical GLP-1 step-up case).
- `98067569` — Roscoe Arbuckle (osteoarthritis with chronic knee pain).

---

## SHARP context configuration

```json
{
  "sharp_context": {
    "patient_id": "{{patient_id}}",
    "fhir_base_url": "{{fhir_base_url}}",
    "fhir_token": "{{fhir_token}}"
  }
}
```

The token never enters the LLM context window.

---

## SMART scope declarations (read-only)

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

---

## Pricing / usage notes (Prompt Opinion conventions)

- **Free tier:** unlimited offline tools (FHIR retrieval, RxNorm,
  `record_pa_outcome`, `learning_stats`). Bring-your-own-Groq key for the
  10 LLM tools.
- **Hosted tier:** flat per-PA pricing (drafted-letter is the meter unit).
  Memory store and Brier calibration are per-tenant and isolated.
- **Self-host:** MIT license, Docker Compose, no third-party RAG dependency.

---

## Tags

```
healthcare, prior-authorization, mcp, a2a, fhir, sharp, self-learning,
calibration, adversarial-review, rag, cms-ncd, rxnorm, ocr, payer-automation,
smart-on-fhir, hipaa, glp-1, step-therapy, audit-log, dose-safety
```

Lead five: `healthcare`, `prior-authorization`, `mcp`, `self-learning`, `fhir`.

---

## Versioning

- **v2.0.0** — closed-loop self-learning layer (tools 12–18), Brier
  calibration, adversarial review, dose-safety pre-flight.
- **v1.0.x** — initial 11-tool baseline.

---

## Pre-publish QA checklist

- [ ] All three services healthy in Docker (`/health` 200 from each).
- [ ] `tools/list` returns **18** tools.
- [ ] `agent-card.json` reachable and valid JSON.
- [ ] `npx tsx test-client.ts 131926799` exits 0 with all 18 tools `ok` or
      `skipped`-with-reason; no `error`.
- [ ] `/health` exposes `calibration_brier` and `memory_size`.
- [ ] No FHIR token logging (`grep -r "fhirToken" src/ a2a-agent/src/` clean).
- [ ] Listing description proofread.
- [ ] Marketplace URL pasted into `SUBMISSION.md`.
