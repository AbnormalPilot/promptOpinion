# ClinicalContext

> **Prior authorization in 90 seconds, not 20 minutes — and every PA the system handles makes the next one stronger.**
> Standards-compliant **MCP server** (18 tools) + **A2A agent** for closed-loop, self-learning, court-grade-cited prior authorization on real FHIR data.

[![MCP](https://img.shields.io/badge/MCP-1.25.1-blue)](https://modelcontextprotocol.io/) [![A2A](https://img.shields.io/badge/A2A-v1-green)](https://a2a.dev) [![FHIR](https://img.shields.io/badge/FHIR-R4-red)](https://hl7.org/fhir/R4/) [![SHARP](https://img.shields.io/badge/SHARP-context-purple)](https://promptopinion.ai) [![License](https://img.shields.io/badge/license-MIT-lightgrey)](LICENSE)

Built for the **[Agents Assemble: The Healthcare AI Endgame](https://agents-assemble.devpost.com/)** hackathon (May 2026).

---

## What's different

Most PA-automation submissions stop at "generate a letter." ClinicalContext closes the loop:

1. **Predict** approval probability against retrieved similar prior cases — calibrated, not optimistic.
2. **Counterfactual** recommendations: "what evidence would lift this from 0.42 → 0.81?"
3. **Draft** with self-injected weakness patterns harvested from past adversarial reviews.
4. **Adversarial review** by a denying-reviewer LLM before submission.
5. **Record outcome** — every approval/denial improves the next prediction (memory + temperature scaling + pattern bucket).

See [LEARNING.md](LEARNING.md) for the full architecture and [eval/REPORT.md](eval/REPORT.md) for the cold-vs-warm learning curve numbers.

---

## TL;DR for Judges

| Criterion | How ClinicalContext Scores |
|---|---|
| **AI Factor** | LLM reasoning over unstructured FHIR + RAG over 244 CMS NCD chunks + a **closed self-learning loop** (memory retrieval, calibration logging, harvested adversarial patterns, counterfactual evidence recommender). Probabilistic, not rule-based. |
| **Potential Impact** | **20 min → 90 sec per request**. At 40 PA/day per clinic, **~12 staff hours saved daily**. Closed loop means accuracy compounds: published Brier score and reliability diagram in `/health` and `eval/REPORT.md`. PA workflows cost ~$35B/yr (AMA). |
| **Feasibility** | Stateless MCP, SHARP-propagated FHIR tokens (audit-logged with HMAC-hashed patient IDs), PHI redaction middleware on outbound LLM calls, dose-safety pre-flight (renal/pediatric/pregnancy block before draft), human-in-the-loop draft labeling, court-grade provenance citations on every claim. |

**Submission type:** MCP Server + External A2A Agent (both tracks covered)
**Marketplace listing:** *[fill after publishing]*
**Demo video:** *[fill after recording]* (under 3 minutes)

---

## Table of Contents

- [The Problem](#the-problem)
- [Architecture](#architecture)
- [The 18-Tool Chain](#the-18-tool-chain)
- [Self-Learning Loop](#self-learning-loop)
- [Standards Compliance](#standards-compliance)
- [Quick Start](#quick-start)
- [Demo Workflow](#demo-workflow)
- [Safety & Compliance](#safety--compliance)
- [Project Structure](#project-structure)
- [Documentation Map](#documentation-map)

---

## The Problem

Prior authorization (PA) is the single most-hated administrative burden in US healthcare:

- **20–40 minutes** of nurse/physician time per request — pulling charts, hunting ICD-10 codes, documenting prior treatments, writing justification letters.
- **3 business days** average wait that delays patient care.
- **~$35 billion/year** in administrative cost (American Medical Association estimate).
- **Universally hated** — every clinician judge on this panel has filled one out this week.

PA drafting is *administrative* (not clinical decision-making), making it a regulatorily safe target for AI. The reasoning involved — interpreting diagnoses, inferring medical necessity, mapping coverage policy — is exactly what rule-based software cannot do.

ClinicalContext closes this gap.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                  Prompt Opinion Platform                     │
│            (any agent in the workspace can invoke)           │
└──────────────────────────┬──────────────────────────────────┘
                           │  A2A JSON-RPC + SHARP context
                           ▼
┌─────────────────────────────────────────────────────────────┐
│            A2A Agent  (port 8001)                            │
│            @google/adk + Gemini 2.5 Flash                    │
│            Natural language → auto-chains 11 MCP tools       │
└──────────────────────────┬──────────────────────────────────┘
                           │  MCP HTTP + SHARP headers
                           │  (x-fhir-server-url, x-fhir-access-token, x-patient-id)
                           ▼
┌─────────────────────────────────────────────────────────────┐
│            MCP Server  (port 3000)                           │
│            @modelcontextprotocol/sdk + Express 5             │
│                                                              │
│            FHIR tools  ──►  HAPI R4 (axios)                  │
│            LLM tools   ──►  Groq Llama 3.3 70B               │
│            RAG tools   ──►  RAG Service (port 3001)          │
│            Safety tools──►  RxNorm REST (free)               │
│            OCR tools   ──►  tesseract.js                     │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│            RAG Service  (port 3001)                          │
│            vectra + @xenova/transformers                     │
│            244 CMS NCD policy chunks · local embeddings      │
│            Zero API keys · all-MiniLM-L6-v2                  │
└─────────────────────────────────────────────────────────────┘
```

**Key architectural decisions:**

- **Stateless MCP server** — fresh `McpServer` per HTTP request, torn down on `res.close`. Trivially horizontally scalable.
- **SHARP context propagation** — FHIR token, base URL, and patient ID flow through three headers; tools never see raw credentials in code.
- **Local embeddings** — `@xenova/transformers` runs `all-MiniLM-L6-v2` directly in Node. No OpenAI key, no rate limits, runs anywhere.
- **Three-process topology** — clean separation between agent (LLM orchestration), MCP server (tool surface), and RAG service (retrieval). Each has its own healthcheck and can be scaled independently.

See [`ARCHITECTURE.md`](./ARCHITECTURE.md) for the full deep-dive.

---

## The 18-Tool Chain

### Core PA workflow (1–11)

| # | Tool | Type | What It Does |
|---|------|------|--------------|
| 1 | `fetch_patient_context` | FHIR | Demographics, active conditions, allergies, recent procedures |
| 2 | `fetch_medication_list` | FHIR | Full medication history (active + completed) for step-therapy documentation |
| 3 | `fetch_clinical_history` | FHIR | Encounters, labs, vitals — medical-necessity evidence |
| 4 | `extract_clinical_evidence` | FHIR + LLM | Reads unstructured FHIR notes, extracts PA-relevant findings with quotes |
| 5 | `process_clinical_document` | FHIR + OCR | OCRs scanned FHIR `DocumentReference` attachments via tesseract.js |
| 6 | `lookup_coverage_policy` | RAG | Retrieves CMS NCD policy text chunks via local-embedding similarity search |
| 7 | `check_coverage_requirements` | LLM | Step-therapy + formulary analysis from patient FHIR data |
| 8 | `check_drug_interactions` | API | RxNorm REST drug-drug interaction safety check |
| 9 | `analyze_prior_auth_need` | LLM + RAG | Clinical justification with ICD-10 mapping + confidence score |
| 10 | `draft_prior_auth_request` | LLM + RAG + Memory | Complete PA letter — auto-injects similar prior cases + harvested weakness patterns + dose-safety pre-check + court-grade provenance |
| 11 | `generate_appeal_letter` | LLM + RAG | Drafts appeals for denied PAs with regulatory leverage |

### Probabilistic + self-learning layer (12–18) — *new*

| # | Tool | Type | What It Does |
|---|------|------|--------------|
| 12 | `predict_approval_probability` | LLM + Memory | Calibrated forecast of first-submission approval, anchored in retrieved similar prior cases. Returns probability, confidence band, key factors, and primary denial risks. Calibration auto-applied. |
| 13 | `suggest_counterfactual_evidence` | LLM | Given current evidence + probability, identifies the SPECIFIC additional evidence that would lift approval probability the most, ranked by impact-per-effort. |
| 14 | `adversarial_review` | LLM + Patterns | Acts as a denying payer reviewer searching for reasons to reject. Findings are auto-bucketed into the patterns store and reinjected into future drafts. |
| 15 | `patient_explainer` | LLM | 6th-grade plain-English summary of the PA situation for the patient and family. |
| 16 | `cost_alternative_analysis` | RxNorm + LLM | Therapeutic alternatives that may avoid PA entirely or lower patient cost. Surfaces a `best_no_pa_option`. |
| 17 | `record_pa_outcome` | Memory + Calibration | Writes the actual outcome to memory. Closes the learning loop — every recorded case improves future predictions, retrievals, and drafts. |
| 18 | `learning_stats` | Introspection | Returns memory size, Brier score, reliability diagram, top weakness patterns. Trust-by-transparency. |

**The agent chains these automatically** — a single natural-language prompt triggers the right subset and assembles the result. See [`a2a-agent/src/agent.ts`](./a2a-agent/src/agent.ts) for the orchestration instruction.

---

## Self-Learning Loop

Every PA the system handles makes the **next** one stronger. Three persistent stores compound knowledge:

- **`data/memory.jsonl`** — case memory, embedded for similarity retrieval. Top-3 nearest neighbors are injected into the next draft prompt as priors. Denial reasons from neighbors become explicit warnings the next draft must address.
- **`data/patterns.json`** — adversarial weakness patterns auto-bucketed across 12 categories. Top-5 frequent patterns are auto-merged into the draft system prompt as "AVOID THESE" rules.
- **`data/calibration.jsonl`** — predicted vs actual log. Brier score + reliability diagram + temperature scaling pull future predictions toward the base rate when the model is over-confident.

The `eval/` runner executes the 20-scenario golden set twice — **cold** (empty memory) and **warm** (memory + patterns populated) — and emits a measurable learning curve to `eval/REPORT.md`.

**Measured numbers (offline heuristic predictor + memory retrieval, 20 scenarios — final post-fixer run):**

| Metric | Cold | Warm | Delta |
|---|---|---|---|
| Brier score (lower better) | **0.052** | **0.039** | **26% better calibration** |
| 0.5-threshold accuracy | 95% | 95% | — |
| Memory size | 0 cases | 20 cases | +20 |

(Earlier runs reported a steeper 0.047 → 0.024 delta — that pass triggered the temperature-scaling blend at N≥5; the post-fixer build raises the threshold to N≥10 with a slope guard, so the warm pass shows the smaller, more honest improvement that comes purely from memory retrieval rather than calibration overcorrection. See REVIEW.md H2.)

The closed-loop signal is the Brier delta: predictions become measurably more calibrated as the system accumulates outcomes. The eval runs offline (no LLM key needed) so judges can reproduce the numbers without a Groq account. Re-run with `GROQ_API_KEY=... npx tsx eval/run.ts` to use the LLM-backed predictor.

See [`LEARNING.md`](./LEARNING.md) for the full architecture and [`eval/REPORT.md`](./eval/REPORT.md) for the per-scenario breakdown.

---

## Standards Compliance

| Standard | Spec | Where Implemented |
|---|---|---|
| **MCP** | [modelcontextprotocol.io](https://modelcontextprotocol.io/) | `src/index.ts` (HTTP transport), `src/stdio.ts` (stdio transport) |
| **A2A** | [a2a.dev](https://a2a.dev) v1 | `a2a-agent/src/app-factory.ts` (agent card, JSON-RPC `message/send`) |
| **SHARP** | [Prompt Opinion extension spec](https://promptopinion.ai) | `src/sharp/context.ts` (header extraction + JWT claim fallback) |
| **FHIR R4** | [hl7.org/fhir/R4](https://hl7.org/fhir/R4/) | `src/fhir/client.ts` (axios client against HAPI public R4) |
| **Da Vinci PAS** | http://hl7.org/fhir/us/davinci-pas/STU2.1/ | src/fhir/pas-bundle.ts (Claim use=preauthorization + Bundle) |

**FHIR resources accessed (read-only):** Patient, Condition, MedicationRequest, Encounter, Observation, AllergyIntolerance, Procedure, DiagnosticReport, DocumentReference.

See [`STANDARDS.md`](./STANDARDS.md) for an explicit per-spec compliance map.

---

## Quick Start

### Prerequisites

- Node.js ≥ 20
- A free [Groq API key](https://console.groq.com/keys) — for the LLM tools
- A free [Google AI Studio key](https://aistudio.google.com/apikey) — for the A2A agent (Gemini)
- (No FHIR auth needed — defaults to the HAPI public R4 server.)

### Install + Run (3 services, local)

```bash
# 1. Clone and install
git clone <this-repo> clinicalcontext
cd clinicalcontext
cp .env.example .env  # paste your GROQ_API_KEY and GOOGLE_API_KEY

# 2. MCP server (root)
npm install
npm run start                                # http://localhost:3000

# 3. RAG service (new terminal)
cd rag-service && npm install && npm run start    # http://localhost:3001

# 4. A2A agent (new terminal)
cd a2a-agent && npm install && npm run start      # http://localhost:8001
```

### One-shot Docker

```bash
docker compose up --build
```

### Smoke test

```bash
# Hit the MCP server with the test client
npx tsx test-client.ts 131926799

# Get the A2A agent card
curl http://localhost:8001/.well-known/agent-card.json

# Inspect MCP tools interactively
npm run inspect
```

### Test patients on HAPI public R4

| ID | Name | Scenario |
|---|---|---|
| `131926799` | Robert Barker | Type 2 DM + HTN, on metformin + amlodipine, HbA1c 8.2% — classic GLP-1 step-up case |
| `98067569`  | Roscoe Arbuckle | Osteoarthritis with chronic knee pain — biologic candidacy |

---

## Demo Workflow

> `npm run demo`  # full v2 chain end-to-end, offline-friendly

A clinician (or upstream agent) sends:

> "Draft a prior authorization for Ozempic (semaglutide) for patient 131926799. Payer is Aetna. Requesting provider Dr. Smith."

The agent then:

1. **`fetch_patient_context`** → loads Robert Barker's demographics, T2DM + HTN conditions, no relevant allergies.
2. **`fetch_medication_list`** → metformin 1000mg BID (active), amlodipine 5mg daily (active). No prior GLP-1 exposure.
3. **`fetch_clinical_history`** → HbA1c 8.2% on 2026-04-10, BP 142/88, BMI 31.4.
4. **`check_drug_interactions`** → Ozempic + metformin: no significant interaction. Cleared.
5. **`lookup_coverage_policy`** → retrieves CMS NCD chunks for GLP-1 receptor agonists.
6. **`check_coverage_requirements`** → step-therapy met (metformin trial > 3 months, A1c > 7%), in-formulary.
7. **`analyze_prior_auth_need`** → primary ICD-10 `E11.9` (T2DM uncomplicated), secondary `I10` (essential HTN), confidence 0.91.
8. **`draft_prior_auth_request`** → complete payer letter with provenance back to FHIR resource IDs.

Final agent response = a markdown-formatted PA packet ready for physician sign-off. **Runtime: ~90 seconds end-to-end.**

See [`DEMO-SCRIPT.md`](./DEMO-SCRIPT.md) for the full 3-minute video shooting script.

---

## Safety & Compliance

ClinicalContext is built on five safety pillars:

1. **Synthetic data only.** All testing uses HAPI public R4 patients. No real PHI ever touched.
2. **Human in the loop.** Every output is explicitly labeled `DRAFT — FOR PHYSICIAN REVIEW BEFORE SUBMISSION`.
3. **HIPAA posture.** FHIR tokens injected via SHARP headers, never logged or stored. The MCP server is stateless — holds zero patient data between requests.
4. **Hallucination guards.** LLM prompts require every clinical claim to cite a FHIR field; the analyze tool returns a confidence score; low confidence triggers a warning to the reviewing clinician.
5. **Regulatory category.** PA drafting is administrative documentation, not clinical decision-making — a deliberately safe regulatory niche for AI.

See [`SAFETY.md`](./SAFETY.md) for the full safety model.

---

## Project Structure

```
clinicalcontext/
├── src/                          # MCP server (TypeScript)
│   ├── index.ts                  # HTTP transport entry point
│   ├── stdio.ts                  # stdio transport entry (for MCP Inspector)
│   ├── tools/                    # 11 MCP tool implementations
│   ├── fhir/client.ts            # FHIR R4 axios client
│   ├── llm/{client,prompts}.ts   # Groq client + clinical prompts
│   └── sharp/{context,constants}.ts  # SHARP header extraction
├── a2a-agent/                    # A2A agent (TypeScript)
│   └── src/
│       ├── server.ts             # A2A v1 endpoint
│       ├── agent.ts              # Gemini orchestration prompt
│       ├── mcp-bridge.ts         # MCP tool wrapping for ADK
│       ├── fhir-hook.ts          # SHARP context injection hook
│       └── app-factory.ts        # Agent card + JSON-RPC handlers
├── rag-service/                  # RAG service (TypeScript)
│   └── src/
│       ├── index.ts              # Express server
│       ├── cms-loader.ts         # CMS NCD chunking pipeline
│       ├── embeddings.ts         # @xenova/transformers wrapper
│       └── vector-store.ts       # vectra index
├── docker-compose.yml            # 3-service orchestration
├── Dockerfile                    # MCP server image
├── README.md                     # ← you are here
├── ARCHITECTURE.md               # Technical deep-dive
├── SAFETY.md                     # Compliance + clinical safety
├── STANDARDS.md                  # Per-spec compliance map
├── DEMO-SCRIPT.md                # 3-min video shooting script
├── MARKETPLACE.md                # Prompt Opinion listing copy
├── CHALLENGES.md                 # Engineering log
└── SUBMISSION.md                 # Devpost field-by-field copy
```

---

## Documentation Map

| Document | Audience | What's In It |
|---|---|---|
| [`README.md`](./README.md) | Everyone | Pitch, architecture, quick start, standards |
| [`ARCHITECTURE.md`](./ARCHITECTURE.md) | Technical judges (Mandel, Tripathi, Proctor) | Service topology, MCP statelessness, SHARP propagation, RAG pipeline |
| [`SAFETY.md`](./SAFETY.md) | Clinical judges (Mathur, Hickey) | HIPAA, hallucination guards, regulatory category, drug-safety checks |
| [`STANDARDS.md`](./STANDARDS.md) | Mandel (FHIR architect) | Per-spec compliance proof with file:line citations |
| [`DEMO-SCRIPT.md`](./DEMO-SCRIPT.md) | Submitter (you) | 3-min beat-by-beat script for the demo video |
| [`MARKETPLACE.md`](./MARKETPLACE.md) | Submitter (you) | Listing copy + assets for Prompt Opinion publishing |
| [`CHALLENGES.md`](./CHALLENGES.md) | All judges | Engineering log of real bugs fought + fixes |
| [`SUBMISSION.md`](./SUBMISSION.md) | Submitter (you) | Devpost field-by-field copy-paste packet |

---

## License

MIT — see [`LICENSE`](./LICENSE).

---

## Acknowledgements

- **Prompt Opinion** for the platform, SHARP spec, and hackathon.
- **HAPI FHIR** team for the public R4 sandbox.
- **CMS** for publishing the NCD coverage policy database.
- **NLM** for the open RxNorm API.

---

> *"The era of building AI in silos is over." — Agents Assemble*
