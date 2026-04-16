# ClinicalContext — Prior Authorization Automation

## Architecture

3-service system for the "Agents Assemble" healthcare AI hackathon:

```
┌─────────────────────────────────────────────────┐
│           A2A Agent (port 8001)                 │
│  Google ADK + Gemini 2.5 Flash                  │
│  Natural language → auto-chains 11 MCP tools    │
└──────────────────┬──────────────────────────────┘
                   │ MCP protocol + SHARP headers
                   ▼
┌─────────────────────────────────────────────────┐
│         MCP Server (port 3000) — 11 tools       │
│  FHIR: patient, meds, history                   │
│  LLM: analyze, draft, appeal, coverage          │
│  RAG: coverage policy lookup                    │
│  API: drug interactions (RxNorm)                │
│  OCR: scanned documents (tesseract.js)          │
└──────────────────┬──────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────┐
│       RAG Service (port 3001)                   │
│  244 CMS NCD policy chunks                      │
│  vectra + xenova/transformers embeddings        │
└─────────────────────────────────────────────────┘
```

## Tech Stack
- **MCP Server**: TypeScript, @modelcontextprotocol/sdk, Express 5, Groq (llama-3.3-70b)
- **RAG Service**: vectra, @xenova/transformers (local embeddings, no API key)
- **A2A Agent**: @google/adk, @a2a-js/sdk, Gemini 2.5 Flash
- **FHIR**: axios client, HAPI R4 public server
- **OCR**: tesseract.js
- **Drug Safety**: RxNorm REST API (free, no key)

## 11 MCP Tools

| # | Tool | Type | Purpose |
|---|------|------|---------|
| 1 | fetch_patient_context | FHIR | Demographics + conditions + allergies + procedures |
| 2 | fetch_medication_list | FHIR | Full medication history for step therapy |
| 3 | fetch_clinical_history | FHIR | Encounters + labs + vitals |
| 4 | extract_clinical_evidence | FHIR+LLM | Unstructured note evidence extraction |
| 5 | process_clinical_document | FHIR+OCR | OCR scanned documents |
| 6 | lookup_coverage_policy | RAG | CMS NCD policy text retrieval |
| 7 | check_coverage_requirements | LLM | Step therapy + formulary analysis |
| 8 | check_drug_interactions | API | RxNorm drug interaction check |
| 9 | analyze_prior_auth_need | LLM+RAG | Clinical justification with ICD-10 mapping |
| 10 | draft_prior_auth_request | LLM+RAG | Complete PA letter |
| 11 | generate_appeal_letter | LLM+RAG | Appeal for denied PA |

## Running

```bash
# MCP Server (local)
npm install && npm run start

# RAG Service
cd rag-service && npm install && npm run start

# A2A Agent
cd a2a-agent && npm install && npm run start

# All via Docker
docker compose up --build

# MCP Inspector
npm run inspect

# Test client
npx tsx test-client.ts 131926799
```

## Key Patients for Testing
- `131926799` — Robert Barker: Type 2 DM, HTN, metformin, amlodipine, HbA1c 8.2%
- `98067569` — Roscoe Arbuckle: Osteoarthritis, knee pain

## SHARP-on-MCP Headers
- `x-fhir-server-url` — FHIR base URL
- `x-fhir-access-token` — Bearer token (patient from JWT claim)
- `x-patient-id` — Fallback patient ID

## Environment Variables
```
GROQ_API_KEY        — MCP server LLM (required)
FHIR_BASE_URL       — Default: https://hapi.fhir.org/baseR4
RAG_SERVICE_URL     — Default: http://localhost:3001
GOOGLE_API_KEY      — A2A agent Gemini (for A2A only)
```
