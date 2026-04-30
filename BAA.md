# Business Associate Agreement — Template

> **This is a hackathon-grade reference template, not legal counsel.** Any production deployment of ClinicalContext that touches Protected Health Information (PHI) within the United States MUST execute a fully-negotiated, attorney-reviewed Business Associate Agreement (BAA) with each Covered Entity before processing live data. This file exists to demonstrate that the deployment posture has been considered — not to substitute for that work.

## Why a BAA matters here

ClinicalContext is a Business Associate under 45 CFR § 160.103 when it processes PHI on behalf of a Covered Entity (a hospital, clinic, payer, or self-insured employer plan). The BAA is the contractual instrument that allocates HIPAA Security Rule and Privacy Rule responsibilities between the Covered Entity and the Business Associate. Without an executed BAA in place, the Covered Entity cannot legally disclose PHI to ClinicalContext, and the Business Associate cannot legally use or disclose it.

## What this template covers

The sections below mirror the structure of the OCR-recommended sample BAA (https://www.hhs.gov/hipaa/for-professionals/covered-entities/sample-business-associate-agreement-provisions/index.html) with our specific implementation details inlined.

### 1. Permitted Uses and Disclosures

ClinicalContext may use and disclose PHI only:
- To carry out prior authorization automation, appeal letter generation, and clinical-evidence retrieval as commissioned by the Covered Entity.
- To perform internal data aggregation services per 45 CFR § 164.504(e)(2)(i)(B), specifically: maintaining the case-memory store and calibration log that comprise the system's self-learning loop.
- For management, administration, and legal responsibilities of the Business Associate, where permitted under 45 CFR § 164.504(e)(4).

ClinicalContext SHALL NOT:
- Sell PHI or use it for marketing without a separate, explicit authorization.
- Disclose PHI to a third party unless required by law and tracked in the audit log.
- Use PHI to train large language models offered as a separate product. (Memory retrieval IS used, but stays inside the deployed instance — see "Cross-Tenant Isolation" below.)

### 2. Safeguards (45 CFR § 164.308, § 164.310, § 164.312)

| Safeguard | Implementation in ClinicalContext |
|---|---|
| Administrative — risk analysis | `SAFETY.md`, `LEARNING.md` posture documents; threat model in `RESEARCH-V2.md`. |
| Administrative — audit controls | `src/audit/middleware.ts` writes structured JSONL of every request: trace ID, HMAC-hashed patient ID, tool name, timestamp, redaction report. Token values are never logged (`tokenPresent: boolean` only). |
| Administrative — workforce training | Operator-facing only. Out of scope for this code repo. |
| Physical — facility access | Inherited from the deploying organization's infrastructure. |
| Technical — access control | Stateless MCP (no shared state between requests); SHARP-propagated FHIR tokens are forwarded but never persisted. |
| Technical — audit logs | See `data/audit.jsonl` schema in `LEARNING.md`. Logs are append-only and contain no token material. |
| Technical — integrity | Per-file mutex (`src/util/jsonl.ts`) ensures concurrent writes do not interleave. Calibration math is deterministic given input. |
| Technical — transmission security | All outbound calls (Groq, RxNorm, FHIR HAPI, RAG service) are HTTPS. Internal MCP↔RAG can be configured for TLS in production. |

### 3. PHI minimization in third-party calls

`src/audit/redact.ts::scrubPHIObject` is invoked in `src/tools/draftPriorAuthRequest.ts` and `src/tools/analyzePriorAuthNeed.ts` BEFORE assembling the LLM payload. Patient name, identifiers, and birthDate (beyond year) are redacted. The audit log records the count and kinds of fields redacted per request.

### 4. Subcontractors

ClinicalContext relies on the following sub-business-associates by default:
- **Groq, Inc.** — for LLM inference. A BAA with Groq is required if PHI is included in prompts. PHI minimization (§3) reduces but does not eliminate the obligation.
- **xenova/transformers (local)** — runs in-process, no network egress. No BAA needed.
- **National Library of Medicine (RxNorm)** — public API, queried with non-PHI drug names only.
- **HAPI public FHIR R4 server** — DEMO ONLY. Production deployments must point `FHIR_BASE_URL` at the Covered Entity's own FHIR endpoint.

Any deployment must enumerate its actual subcontractor chain and obtain BAAs from each.

### 5. Reporting Breaches

`src/audit/middleware.ts` produces the audit trail necessary for breach detection. A breach (defined per 45 CFR § 164.402) must be reported to the Covered Entity within the window specified in the executed BAA — commonly 24 to 72 hours.

### 6. Termination

On termination of the BAA:
- All PHI in the deployment's `data/memory.jsonl`, `data/audit.jsonl`, and `data/calibration.jsonl` MUST be returned or destroyed.
- The MCP server's per-request stateless model means in-flight memory clears on `res.close`.
- A `scripts/wipe-phi.ts` helper SHOULD be implemented before production. (Open issue.)

### 7. Cross-Tenant Isolation

The self-learning memory and calibration stores accumulate per-deployment. A multi-tenant SaaS offering of ClinicalContext MUST partition these stores per Covered Entity — comingling cases from Hospital A and Hospital B in a single memory index would violate the BAA's permitted-uses clause. The `MEMORY_PATH`, `AUDIT_LOG_PATH`, `PATTERNS_PATH`, and `CALIBRATION_PATH` env vars enable per-tenant directories.

### 8. Read-Only Mode (recommended for compliance review)

A future `READ_ONLY=1` env flag (per `RESEARCH-V2.md` recommendation borrowed from AWS HealthLake MCP) will short-circuit all FHIR `POST/PUT/DELETE` paths. This is currently not implemented because we do not yet write to FHIR — but the flag is reserved for symmetry with the AWS HealthLake convention.

## What's intentionally out of scope here

- State-level laws beyond HIPAA (e.g., California CMIA, Texas HB 300).
- 42 CFR Part 2 (substance use disorder records) — requires an additional consent layer not modeled in this codebase.
- GDPR / UK DPA / PIPEDA / India DPDP — production deployments outside the United States have additional obligations.
- Data residency requirements imposed by individual Covered Entities.

A real BAA negotiation will close these gaps. This document declares the posture so that the negotiation has a starting point.
