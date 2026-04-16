# ClinicalContext MCP Server

## What This Is
MCP server for healthcare prior authorization automation. Fetches patient data from FHIR R4, reasons over it with Gemini LLM, generates prior auth request drafts.

Built for the "Agents Assemble" healthcare AI hackathon on Prompt Opinion platform.

## Tech Stack
- TypeScript + Node.js 20+
- `@modelcontextprotocol/sdk` — MCP protocol
- `axios` — FHIR R4 HTTP client
- `@google/generative-ai` — Gemini 2.0 Flash (free tier)
- `express` — HTTP transport for Prompt Opinion
- `zod` — schema validation
- `jose` — JWT decoding for SHARP context

## Project Structure
```
src/
├── index.ts          # HTTP server (Express + StreamableHTTP transport)
├── stdio.ts          # Stdio server (local testing, MCP Inspector)
├── fhir/client.ts    # FHIR R4 HTTP client
├── llm/client.ts     # Gemini API client
├── llm/prompts.ts    # System prompts for analysis + letter drafting
├── sharp/
│   ├── constants.ts  # SHARP header names
│   └── context.ts    # Extract FHIR context from HTTP headers
└── tools/
    ├── types.ts                  # IMcpTool interface
    ├── index.ts                  # Barrel export
    ├── fetchPatientContext.ts    # Patient demographics + conditions
    ├── fetchMedicationList.ts    # Active medications
    ├── fetchClinicalHistory.ts   # Encounters + observations
    ├── analyzePriorAuthNeed.ts   # LLM: clinical justification analysis
    └── draftPriorAuthRequest.ts  # LLM: full prior auth letter
```

## Running Locally
```bash
npm install
cp .env.example .env  # Add your GEMINI_API_KEY

# Stdio mode (local testing)
npm run start:stdio

# HTTP mode (for Prompt Opinion)
npm run start

# MCP Inspector
npm run inspect

# Run test client
npx tsx test-client.ts [patient_id]
```

## Key Design Decisions
- **Stateless HTTP transport** — fresh McpServer per request, matches po-community-mcp pattern
- **Tools don't depend on Express** — accept FhirConfig optionally, work in both stdio and HTTP mode
- **SHARP context is additive** — tools work without it (direct patient_id arg), SHARP headers override in HTTP mode
- **Default FHIR server** — hapi.fhir.org/baseR4 (public, no auth, synthetic data)

## FHIR Test Data
- Public server: https://hapi.fhir.org/baseR4
- Known test patient with conditions: `98067569` (Roscoe Arbuckle, osteoarthritis)
- Find more: `curl "https://hapi.fhir.org/baseR4/Condition?_count=5&clinical-status=active&_include=Condition:patient"`

## SHARP-on-MCP Headers
When running in HTTP mode behind Prompt Opinion:
- `x-fhir-server-url` — FHIR base URL
- `x-fhir-access-token` — Bearer token (patient ID extracted from JWT `patient` claim)
- `x-patient-id` — Fallback patient ID header

## Commands
- `npm run start` — HTTP server on port 3000
- `npm run start:stdio` — Stdio server
- `npm run inspect` — MCP Inspector
- `npm run build` — TypeScript compile to dist/
