import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { IMcpTool, textResponse } from "./types";
import { FhirClient, FhirConfig } from "../fhir/client";
import { callLLM, safeParseJSON } from "../llm/client";
import { DRAFT_PRIOR_AUTH_SYSTEM } from "../llm/prompts";
import { retrieveSimilar, formatPriorCases } from "../memory/store";
import { patternsForPrompt } from "../learning/patterns";
import { checkDoseSafety, severityOf, DoseSafetyFinding } from "../clinical/dosing";
import { memoryCite } from "../provenance/types";
import { scrubPHIObject } from "../audit/redact";
import { writeAudit } from "../audit/middleware";

class DraftPriorAuthRequestTool implements IMcpTool {
  registerTool(server: McpServer, fhirConfig?: FhirConfig) {
    server.tool(
      "draft_prior_auth_request",
      "Generates a complete, submission-ready PA letter. Self-learning: retrieves similar past cases from memory and injects denial-pattern warnings harvested from prior adversarial reviews. Runs a dose-safety pre-check (renal, pediatric, pregnancy) and surfaces blocks before drafting. Provenance array binds every clinical claim to a FHIR resource and field.",
      {
        patient_id: z.string().optional().describe("FHIR Patient resource ID (auto-resolved from SHARP context if omitted)"),
        requested_medication_or_procedure: z.string().describe("The medication or procedure requiring prior auth"),
        requesting_provider: z.string().optional().describe("Name of requesting provider"),
        payer_name: z.string().optional().describe("Insurance payer name"),
        policy_context: z.string().optional().describe("CMS NCD policy text from lookup_coverage_policy (optional)"),
        clinical_analysis: z.string().optional().describe("Output from analyze_prior_auth_need (optional, avoids redundant analysis)"),
        diagnosis_icd10: z.string().optional().describe("Primary ICD-10 (improves memory retrieval; falls back to LLM-derived)"),
      },
      async ({ patient_id, requested_medication_or_procedure, requesting_provider, payer_name, policy_context, clinical_analysis, diagnosis_icd10 }) => {
        try {
          const pid = patient_id || fhirConfig?.patientId;
          if (!pid) return textResponse("Error: No patient_id provided via argument or SHARP context");
          const fhir = new FhirClient(fhirConfig);

          const [patient, conditions, medications, allergies, encounters, observations] = await Promise.all([
            fhir.read(`Patient/${pid}`),
            fhir.search("Condition", { patient: pid, "clinical-status": "active" }),
            fhir.search("MedicationRequest", { patient: pid }),
            fhir.search("AllergyIntolerance", { patient: pid }),
            fhir.search("Encounter", { patient: pid, _sort: "-date", _count: "5" }),
            fhir.search("Observation", { patient: pid, _sort: "-date", _count: "15" }),
          ]);

          if (!patient) return textResponse(`Patient ${pid} not found`);

          // Pre-flight clinical safety: renal, pediatric, pregnancy
          const age = calculateAge(patient.birthDate);
          const egfr = pickEgfr(observations);
          const pregnant = isPregnant(conditions);
          const safety: DoseSafetyFinding[] = checkDoseSafety({
            drug: requested_medication_or_procedure,
            age,
            egfr,
            pregnant,
          });
          const safetySeverity = severityOf(safety);
          if (safetySeverity === "block") {
            return textResponse(JSON.stringify({
              blocked: true,
              reason: "Dose-safety pre-check produced a BLOCK-level finding. Resolve before drafting PA.",
              findings: safety,
              recommendation: "Confirm clinical context with the prescribing physician before regenerating.",
            }, null, 2));
          }

          const patientData = {
            patient: {
              id: patient.id,
              name: formatName(patient.name),
              birthDate: patient.birthDate || null,
              gender: patient.gender || null,
              age,
              identifier: patient.identifier?.map((i: any) => ({ system: i.system, value: i.value })) || [],
            },
            activeConditions: conditions.map((c: any) => ({
              code: c.code?.coding?.[0]?.code || null,
              system: c.code?.coding?.[0]?.system || null,
              display: c.code?.coding?.[0]?.display || c.code?.text || "Unknown",
              onsetDate: c.onsetDateTime || null,
              fhirId: c.id,
            })),
            medicationHistory: medications.map((m: any) => ({
              medication: m.medicationCodeableConcept?.coding?.[0]?.display || m.medicationCodeableConcept?.text || "Unknown",
              code: m.medicationCodeableConcept?.coding?.[0]?.code || null,
              status: m.status || null,
              authoredOn: m.authoredOn || null,
              fhirId: m.id,
            })),
            allergies: allergies.map((a: any) => ({
              substance: a.code?.coding?.[0]?.display || a.code?.text || "Unknown",
              criticality: a.criticality || null,
              fhirId: a.id,
            })),
            recentEncounters: encounters.map((e: any) => ({
              type: e.type?.[0]?.coding?.[0]?.display || e.type?.[0]?.text || "Unknown",
              date: e.period?.start || null,
              fhirId: e.id,
            })),
            observations: observations.map((o: any) => ({
              code: o.code?.coding?.[0]?.display || o.code?.text || "Unknown",
              value: o.valueQuantity ? `${o.valueQuantity.value} ${o.valueQuantity.unit || ""}`.trim() : o.valueString || null,
              date: o.effectiveDateTime || null,
              fhirId: o.id,
            })),
            data_completeness: assessCompleteness(conditions, medications, observations),
          };

          // Self-learning retrieval
          const dxForRetrieval = diagnosis_icd10 || (conditions[0]?.code?.coding?.[0]?.code) || "";
          const evidenceSummary = clinical_analysis ? clinical_analysis.slice(0, 2000) : JSON.stringify({
            conditions: patientData.activeConditions.map((c) => c.display),
            recentLabs: patientData.observations.slice(0, 5).map((o) => `${o.code}=${o.value}`),
          });
          const priors = await retrieveSimilar({
            drug: requested_medication_or_procedure,
            diagnosis_icd10: dxForRetrieval,
            payer: payer_name,
            evidence_summary: evidenceSummary,
          }, 3);
          const learningPatterns = patternsForPrompt();

          // PHI scrub before LLM payload: explicitly null out direct identifiers
          // (name, identifiers, full DOB) before running the deep regex scrubber
          // over the rest (free-text observation valueStrings, embedded SSN/phone/etc.).
          // Age + condition codes preserved — they are needed for clinical reasoning.
          const llmSafeStaged = {
            ...patientData,
            patient: {
              ...patientData.patient,
              name: "[REDACTED-NAME]",
              birthDate: patientData.patient.birthDate ? patientData.patient.birthDate.slice(0, 4) : null,
              identifier: [],
            },
          };
          const { value: llmSafePatientData, report: redactionReport } = scrubPHIObject(llmSafeStaged);
          writeAudit({
            type: "phi_scrubbed",
            traceId: undefined,
            tool: "draft_prior_auth_request",
            patient_fhir_id: pid,
            redacted_count: redactionReport.redacted,
            redacted_kinds: redactionReport.kinds,
          });

          let userMessage = `Draft a prior authorization request letter:
- Requested: ${requested_medication_or_procedure}
- Provider: ${requesting_provider || "Not specified"}
- Payer: ${payer_name || "Insurance Company"}
- Patient data: ${JSON.stringify(llmSafePatientData, null, 2)}`;

          if (clinical_analysis) {
            userMessage += `\n\n--- PRIOR CLINICAL ANALYSIS ---\n${clinical_analysis}\n--- END ANALYSIS ---\nIncorporate this analysis into the letter.`;
          }
          if (policy_context) {
            userMessage += `\n\n--- RELEVANT CMS COVERAGE POLICY ---\n${policy_context}\n--- END POLICY ---\nCite specific NCD section numbers in the letter.`;
          }
          if (priors.length > 0) {
            userMessage += `\n\n--- COMPARABLE PRIOR CASES (LEARN FROM OUTCOMES) ---\n${formatPriorCases(priors)}\n--- END PRIOR CASES ---\nIf prior denial reasons appear above, proactively address them in this draft.`;
          }
          if (learningPatterns) {
            userMessage += `\n\n--- RECURRING WEAKNESS PATTERNS (auto-harvested from past adversarial reviews; AVOID THESE) ---\n${learningPatterns}\n--- END PATTERNS ---`;
          }
          if (safety.length > 0) {
            userMessage += `\n\n--- DOSE SAFETY FINDINGS (ADDRESS IN LETTER) ---\n${safety.map((f) => `[${f.level}] ${f.message}${f.recommendation ? " | " + f.recommendation : ""}`).join("\n")}\n--- END SAFETY ---`;
          }

          const draftRaw = await callLLM(DRAFT_PRIOR_AUTH_SYSTEM, userMessage);
          const draft = safeParseJSON<any>(draftRaw, { error: "Failed to generate letter", raw: draftRaw });

          // Augment provenance with memory + safety citations
          const memoryProv = priors.map((p) => memoryCite(p.case.id, p.case.outcome === "approved" || p.case.outcome === "appealed_won" ? "approved" : p.case.outcome === "denied" ? "denied" : "appealed", p.similarity));
          if (Array.isArray(draft?.provenance)) {
            draft.provenance.push(...memoryProv);
          } else {
            draft.provenance_extras = { memory: memoryProv };
          }
          draft.learning = {
            prior_cases_used: priors.length,
            patterns_injected: !!learningPatterns,
            dose_safety: safety,
            data_completeness: patientData.data_completeness,
          };

          return textResponse(JSON.stringify(draft, null, 2));
        } catch (err: any) {
          return textResponse(`Error: ${err.message}`);
        }
      }
    );
  }
}

function formatName(names: any[]): string {
  if (!names?.length) return "Unknown";
  const n = names[0];
  return `${n.given?.join(" ") || ""} ${n.family || ""}`.trim();
}

function calculateAge(birthDate: string | undefined): number | null {
  if (!birthDate) return null;
  const birth = new Date(birthDate);
  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  if (now.getMonth() < birth.getMonth() || (now.getMonth() === birth.getMonth() && now.getDate() < birth.getDate())) age--;
  return age;
}

function pickEgfr(observations: any[]): number | null {
  if (!observations?.length) return null;
  const candidates = observations.filter((o: any) => {
    const code = (o.code?.coding?.[0]?.display || o.code?.text || "").toLowerCase();
    return /egfr|glomerular/i.test(code);
  });
  for (const c of candidates) {
    const v = c.valueQuantity?.value;
    if (typeof v === "number") return v;
  }
  return null;
}

function isPregnant(conditions: any[]): boolean {
  if (!conditions?.length) return false;
  return conditions.some((c: any) => {
    const t = (c.code?.coding?.[0]?.display || c.code?.text || "").toLowerCase();
    return /pregnan/i.test(t);
  });
}

function assessCompleteness(conditions: any[], meds: any[], obs: any[]): "complete" | "partial" | "insufficient" {
  const hasConditions = (conditions?.length || 0) > 0;
  const hasMeds = (meds?.length || 0) > 0;
  const hasObs = (obs?.length || 0) > 0;
  const score = [hasConditions, hasMeds, hasObs].filter(Boolean).length;
  return score >= 3 ? "complete" : score === 2 ? "partial" : "insufficient";
}

export const draftPriorAuthRequest = new DraftPriorAuthRequestTool();
