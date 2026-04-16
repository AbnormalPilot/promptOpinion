# Agents Assemble: Healthcare AI Hackathon — Build Guide

## Overview

- **Hackathon:** Agents Assemble — The Healthcare AI Endgame
- **URL:** https://agents-assemble.devpost.com/
- **Platform:** Prompt Opinion (https://promptopinion.ai)
- **Submission Deadline:** May 11, 2026 @ 11:00pm EDT
- **Winners Announced:** On or around May 27, 2026
- **Prize Pool:** $25,000 USD total
  - 1st: $7,500 | 2nd: $5,000 | 3rd: $2,500 | 10x Honorable Mentions: $1,000 each
- **Getting Started Video:** https://youtu.be/Qvs_QK4meHc

---

## What We Are Building

**Track: Option 1 — MCP Server (Superpower)**

We are building a **ClinicalContext MCP Server** — a standards-compliant MCP server that pulls patient data from a FHIR R4 server, reasons over it using an LLM, and generates a complete **Prior Authorization request** draft.

### Why Prior Authorization?

Prior authorization (PA) is the process where clinicians must get insurance approval before prescribing a medication or procedure. It is:
- The #1 most hated administrative burden in US healthcare
- Takes 20–40 minutes of a nurse or physician's time per request
- Delays care for patients (avg. 3 business days wait)
- Costs the US healthcare system ~$35 billion/year

Our MCP server reduces this from ~20 minutes to under 2 minutes by:
1. Fetching relevant patient FHIR data automatically
2. Using an LLM to reason over diagnoses, medications, and history
3. Drafting a complete, payer-ready prior auth letter

---

## Judging Criteria (Optimize for These)

### 1. The AI Factor
**What judges want:** A solution that is *impossible* with traditional rule-based software.
**How we satisfy it:** LLM reasoning over unstructured clinical context — interpreting diagnosis codes, inferring clinical necessity, and drafting natural language justification letters. No rule-based system can do this.

### 2. Potential Impact
**What judges want:** A clear, quantifiable hypothesis for outcomes improvement.
**How we satisfy it:** "Reduces prior auth time from ~20 minutes to under 2 minutes per request. For a clinic processing 40 PA requests/day, this saves ~12 hours of clinical staff time daily."

### 3. Feasibility
**What judges want:** Could this work in a real healthcare system today? Does it respect HIPAA, safety, and regulatory constraints?
**How we satisfy it:**
- Use synthetic/de-identified FHIR data only (HAPI public test server)
- SHARP context propagation for secure token handling
- Mention HIPAA compliance posture in demo
- LLM output is a draft — physician reviews before submission (human in the loop)

---

## Judges (Know Your Audience)

| Judge | Role | What Impresses Them |
|---|---|---|
| Alice Zheng, MD, MBA, MPH | VC, ex-McKinsey, women's health x AI | Business impact, scalability, ROI |
| Josh Mandel, MD | Chief Architect for Health, Microsoft Research | FHIR compliance, open standards, interoperability |
| Joshua Hickey | Principal TPM, Mayo Clinic | Real clinical workflow fit, feasibility |
| Parth Tripathi | Staff Engineer, Google Vertex AI | Technical architecture, AI integration quality |
| Piyush Mathur, MD | Staff Anesthesiologist, Cleveland Clinic | Clinical accuracy, safety guardrails |
| Stephon Proctor, PhD | ACHIO, Children's Hospital of Philadelphia | Platform integration, standards compliance |

**Key insight:** At least 3 of 6 judges are practicing clinicians. They will immediately recognize if a use case is real or fabricated. Prior authorization is universally hated — every clinician will nod when they see it.

---

## Technical Architecture

```
┌─────────────────────────────────────────────────────────┐
│                   Prompt Opinion Platform                │
│  ┌─────────────────────────────────────────────────┐    │
│  │              A2A Agent Workspace                │    │
│  │  (Any agent can invoke our MCP tools)           │    │
│  └──────────────────┬──────────────────────────────┘    │
└─────────────────────┼───────────────────────────────────┘
                      │ MCP protocol (SHARP context)
                      ▼
┌─────────────────────────────────────────────────────────┐
│              ClinicalContext MCP Server                  │
│                                                          │
│  Tools:                                                  │
│  ├── fetch_patient_context      (FHIR Patient + Conditions) │
│  ├── fetch_medication_list      (FHIR MedicationRequest) │
│  ├── fetch_clinical_history     (FHIR Encounters + Obs)  │
│  ├── analyze_prior_auth_need    (LLM reasoning layer)    │
│  └── draft_prior_auth_request   (LLM generation layer)   │
└──────────┬──────────────────────────┬───────────────────┘
           │                          │
           ▼                          ▼
┌─────────────────┐        ┌──────────────────────┐
│  HAPI FHIR R4   │        │   Google Gemini API  │
│  Test Server    │        │  (gemini-2.0-flash)  │
│  (Public)       │        │   Free Tier          │
└─────────────────┘        └──────────────────────┘
```

---

## MCP Tools — Full Specification

### Tool 1: `fetch_patient_context`
```json
{
  "name": "fetch_patient_context",
  "description": "Fetches patient demographics and active conditions from FHIR. Requires patient ID via SHARP context.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "patient_id": { "type": "string", "description": "FHIR Patient resource ID" }
    },
    "required": ["patient_id"]
  }
}
```
**Returns:** Patient name, DOB, gender, active conditions (with ICD-10 codes), coverage/insurance info.

---

### Tool 2: `fetch_medication_list`
```json
{
  "name": "fetch_medication_list",
  "description": "Fetches current active medications for a patient from FHIR.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "patient_id": { "type": "string" },
      "status": { "type": "string", "default": "active", "enum": ["active", "completed", "all"] }
    },
    "required": ["patient_id"]
  }
}
```
**Returns:** Medication name, dosage, frequency, prescribing provider, start date.

---

### Tool 3: `fetch_clinical_history`
```json
{
  "name": "fetch_clinical_history",
  "description": "Fetches recent encounter notes and relevant observations for prior auth clinical justification.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "patient_id": { "type": "string" },
      "lookback_days": { "type": "integer", "default": 180 }
    },
    "required": ["patient_id"]
  }
}
```
**Returns:** Recent encounter summaries, relevant lab values, clinical notes snippets.

---

### Tool 4: `analyze_prior_auth_need`
```json
{
  "name": "analyze_prior_auth_need",
  "description": "Uses LLM to analyze patient data and identify what clinical justification is needed for the prior auth request.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "patient_id": { "type": "string" },
      "requested_medication_or_procedure": { "type": "string" },
      "requesting_provider": { "type": "string" }
    },
    "required": ["patient_id", "requested_medication_or_procedure"]
  }
}
```
**Returns:** Clinical justification summary, relevant diagnosis codes, suggested supporting evidence, confidence score.

---

### Tool 5: `draft_prior_auth_request`
```json
{
  "name": "draft_prior_auth_request",
  "description": "Generates a complete prior authorization request letter ready for payer submission.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "patient_id": { "type": "string" },
      "requested_medication_or_procedure": { "type": "string" },
      "requesting_provider": { "type": "string" },
      "payer_name": { "type": "string" }
    },
    "required": ["patient_id", "requested_medication_or_procedure"]
  }
}
```
**Returns:** Formatted prior auth letter (plain text + structured JSON), ICD-10/CPT codes, clinical summary, supporting evidence citations.

---

## FHIR Integration

### Test Server
- **Base URL:** `https://hapi.fhir.org/baseR4`
- **No authentication required** (public test server)
- **FHIR Version:** R4 (4.0.1)

### Key FHIR Endpoints to Use

```bash
# Get patient
GET /Patient/{id}

# Get active conditions
GET /Condition?patient={id}&clinical-status=active

# Get medications
GET /MedicationRequest?patient={id}&status=active

# Get encounters
GET /Encounter?patient={id}&_sort=-date&_count=10

# Get observations (labs, vitals)
GET /Observation?patient={id}&_sort=-date&_count=20
```

### SHARP Context
SHARP is Prompt Opinion's extension spec for propagating healthcare context through MCP call chains. Always include SHARP headers when registering tools on the platform:

```json
{
  "sharp_context": {
    "patient_id": "{{patient_id}}",
    "fhir_base_url": "{{fhir_base_url}}",
    "fhir_token": "{{fhir_token}}"
  }
}
```

This allows the Prompt Opinion platform to automatically inject patient context into tool calls without requiring the calling agent to manually pass credentials.

---

## Project Structure

```
clinicalcontext-mcp/
├── src/
│   ├── index.ts              # MCP server entry point
│   ├── tools/
│   │   ├── fetchPatientContext.ts
│   │   ├── fetchMedicationList.ts
│   │   ├── fetchClinicalHistory.ts
│   │   ├── analyzePriorAuthNeed.ts
│   │   └── draftPriorAuthRequest.ts
│   ├── fhir/
│   │   ├── client.ts         # FHIR R4 HTTP client
│   │   ├── parsers.ts        # Parse FHIR resources into clean types
│   │   └── types.ts          # FHIR resource TypeScript types
│   ├── llm/
│   │   ├── client.ts         # Google Gemini API client
│   │   ├── prompts.ts        # All LLM prompt templates
│   │   └── parsers.ts        # Parse LLM outputs
│   └── sharp/
│       └── context.ts        # SHARP context extraction helpers
├── tests/
│   ├── tools.test.ts
│   └── fixtures/             # Sample FHIR responses for testing
├── package.json
├── tsconfig.json
└── README.md
```

---

## Google Gemini API Setup

### Why Gemini
- **Free tier:** 1,500 requests/day on `gemini-2.0-flash` — more than enough for development and demo
- **No credit card required** to get started
- **One judge is from Google Vertex AI** (Parth Tripathi) — using Google's stack is a subtle signal of alignment
- Strong at structured JSON output and long-context clinical reasoning

### Get Your Free API Key
1. Go to https://aistudio.google.com/apikey
2. Sign in with Google
3. Click "Create API Key"
4. Copy key into your `.env` as `GEMINI_API_KEY`

### Free Tier Limits (gemini-2.0-flash)
| Limit | Amount |
|---|---|
| Requests per minute | 15 RPM |
| Requests per day | 1,500 RPD |
| Tokens per minute | 1,000,000 TPM |
| Cost | $0 |

### Installation
```bash
npm install @google/generative-ai
```

### LLM Client Implementation (`src/llm/client.ts`)
```typescript
import { GoogleGenerativeAI } from "@google/generative-ai";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

export const model = genAI.getGenerativeModel({
  model: "gemini-2.0-flash",
  generationConfig: {
    responseMimeType: "application/json", // Forces structured JSON output
    temperature: 0.2,                     // Low temp for clinical accuracy
    maxOutputTokens: 2048,
  },
});

export async function callGemini(systemPrompt: string, userMessage: string): Promise<string> {
  const result = await model.generateContent({
    systemInstruction: systemPrompt,
    contents: [{ role: "user", parts: [{ text: userMessage }] }],
  });
  return result.response.text();
}
```

### Structured JSON Output Pattern
Gemini reliably returns JSON when you set `responseMimeType: "application/json"` and instruct it clearly in the system prompt:

```typescript
// Always parse with a fallback
export function safeParseJSON<T>(text: string, fallback: T): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    console.error("Failed to parse Gemini JSON output:", text);
    return fallback;
  }
}
```

---

## LLM Prompt Templates

### Analyze Prior Auth Need — System Prompt
```
You are a clinical documentation specialist with expertise in prior authorization requirements for US health insurers.

Given patient FHIR data (conditions, medications, recent encounters), analyze what clinical justification is needed for the requested medication or procedure.

Return a JSON object with:
- "clinical_rationale": string (1-2 sentence clinical justification)
- "primary_diagnosis_code": string (ICD-10)
- "supporting_diagnosis_codes": string[]
- "evidence_points": string[] (specific clinical facts from the data supporting medical necessity)
- "prior_treatments_tried": string[] (relevant medications/procedures already attempted)
- "confidence": number (0-1)

Base your analysis ONLY on the provided patient data. Do not fabricate clinical details.
```

### Draft Prior Auth Letter — System Prompt
```
You are a clinical documentation specialist writing prior authorization letters to health insurance companies.

Write a professional, complete prior authorization request letter based on the provided patient data and clinical analysis.

The letter must include:
1. Patient identification (name, DOB, member ID if available)
2. Requesting provider information
3. Requested medication/procedure with NDC or CPT code if available
4. Primary and supporting ICD-10 diagnosis codes
5. Clinical necessity statement (2-3 paragraphs)
6. Documentation of prior treatments tried and failed (if applicable)
7. Supporting clinical evidence from the patient record

Tone: Professional, clinical, factual. Do not editorialize.
Format: Standard business letter format.

IMPORTANT: This is a DRAFT for physician review before submission. Include a clear header stating this.
```

---

## Build Timeline

### Week 1 (Now) — Setup & Foundation
- [ ] Create Prompt Opinion account
- [ ] Watch getting started video: https://youtu.be/Qvs_QK4meHc
- [ ] Initialize MCP server project (TypeScript + `@modelcontextprotocol/sdk`)
- [ ] Implement FHIR client with HAPI test server
- [ ] Implement `fetch_patient_context` tool
- [ ] Implement `fetch_medication_list` tool

### Week 2 — Core Tools
- [ ] Implement `fetch_clinical_history` tool
- [ ] Set up Google Gemini API client (`@google/generative-ai`)
- [ ] Implement `analyze_prior_auth_need` tool with LLM
- [ ] Write and test LLM prompts with real FHIR data

### Week 3 — Integration
- [ ] Implement `draft_prior_auth_request` tool
- [ ] Add SHARP context extraction throughout
- [ ] Deploy MCP server (Railway / Render / Fly.io)
- [ ] Register and publish to Prompt Opinion Marketplace
- [ ] Test end-to-end invocation from the platform

### Week 4 — Polish
- [ ] Add error handling and graceful failures
- [ ] Add safety guardrails (PII logging, output disclaimers)
- [ ] Test with multiple synthetic patients
- [ ] Write README and submission description

### Week 5 (Final) — Demo & Submit
- [ ] Record 3-minute demo video (script below)
- [ ] Submit on Devpost with all required materials
- [ ] Submit **at least 2 days early** — signals seriousness to organizers

---

## Demo Video Script (3 minutes)

**[0:00–0:20] — The Problem**
> "A physician wants to prescribe Humira for a patient with Crohn's disease. Before the patient can receive it, the clinic must file a prior authorization request with their insurer. This takes a nurse 20 minutes: pulling the chart, identifying the diagnosis codes, documenting prior treatments, and writing the justification letter. Our MCP server does this in 90 seconds."

**[0:20–1:30] — Live Demo Inside Prompt Opinion**
- Show Prompt Opinion platform
- Invoke `fetch_patient_context` with a test patient ID
- Show FHIR data being returned (real synthetic data)
- Invoke `analyze_prior_auth_need` — show LLM reasoning output
- Invoke `draft_prior_auth_request` — show the complete letter

**[1:30–2:30] — SHARP Context & Interoperability**
- Show how SHARP context passes the patient ID automatically
- Show the tool listed in the Prompt Opinion Marketplace
- Show it being invokable by another agent in the platform

**[2:30–3:00] — Impact & Close**
> "For a clinic processing 40 prior auth requests per day, this saves 12 hours of clinical staff time daily. Because it's built on MCP and FHIR open standards, any agent in the Prompt Opinion ecosystem — or any future compliant platform — can invoke it immediately."

---

## Feasibility & Compliance Notes (Mention in Demo)

- **Data:** Using only synthetic/de-identified data from public HAPI FHIR test server. No real PHI at any point.
- **Human in the Loop:** The tool generates a *draft* — explicitly labeled. A physician reviews and approves before submission. This avoids practicing medicine without a license.
- **HIPAA Posture:** In production deployment, the FHIR token is injected via SHARP context (never hardcoded). No patient data is logged or stored by the MCP server.
- **Safety:** LLM output includes confidence scores. Low-confidence outputs trigger a warning to the reviewing clinician.
- **Regulatory:** Prior auth drafting is administrative (not clinical decision-making), keeping this in a safe regulatory category.

---

## Key Resources

| Resource | URL |
|---|---|
| Hackathon Page | https://agents-assemble.devpost.com/ |
| Getting Started Video | https://youtu.be/Qvs_QK4meHc |
| Prompt Opinion Platform | https://promptopinion.ai |
| HAPI FHIR Public Server | https://hapi.fhir.org/baseR4 |
| FHIR R4 Spec | https://hl7.org/fhir/R4/ |
| MCP SDK (TypeScript) | https://github.com/modelcontextprotocol/typescript-sdk |
| MCP SDK (Python) | https://github.com/modelcontextprotocol/python-sdk |
| Google Gemini API Docs | https://ai.google.dev/gemini-api/docs |
| Google AI Studio (get free API key) | https://aistudio.google.com/apikey |
| Gemini Node.js SDK | https://www.npmjs.com/package/@google/generative-ai |
| Synthea (FHIR test data generator) | https://synthea.mitre.org |

---

## Winning Checklist

- [ ] MCP server exposes 4–5 clean, well-described tools
- [ ] At least one tool uses genuine LLM reasoning (not just a lookup)
- [ ] FHIR data is live (not mocked) in the demo
- [ ] SHARP context is implemented correctly
- [ ] Published and invokable in Prompt Opinion Marketplace
- [ ] Demo video is under 3 minutes and shows everything working
- [ ] Impact is quantified with a specific number
- [ ] Feasibility/compliance is addressed explicitly
- [ ] Submitted at least 2 days before the deadline