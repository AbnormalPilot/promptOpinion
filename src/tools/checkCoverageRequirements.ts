import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { IMcpTool, textResponse } from "./types";
import { FhirClient, FhirConfig } from "../fhir/client";
import { callLLM, safeParseJSON } from "../llm/client";

const COVERAGE_CHECK_SYSTEM = `You are a prior authorization coverage specialist with deep expertise in US health insurance formulary requirements, step therapy protocols, and coverage determination criteria.

Given patient clinical data and the requested medication/procedure, analyze the coverage requirements:

1. Identify the likely step therapy requirements (what medications must be tried first)
2. Evaluate whether the patient's medication history satisfies step therapy
3. Identify quantity limits or age restrictions
4. Flag any required diagnostic tests or criteria
5. Assess documentation requirements

Return a JSON object with:
- "step_therapy_analysis": {
    "required_prior_medications": string[] (what must typically be tried first),
    "patient_has_tried": string[] (from their FHIR medication history),
    "step_therapy_met": boolean (true if requirements appear satisfied),
    "gaps": string[] (step therapy requirements not yet met)
  }
- "coverage_criteria": string[] (typical payer requirements for this medication/procedure)
- "documentation_needed": string[] (what documentation the payer will want to see)
- "quantity_limit_notes": string (any typical quantity or dosage restrictions)
- "age_gender_criteria": string (any age or gender restrictions that apply)
- "likelihood_of_approval": string ("high" | "medium" | "low")
- "approval_rationale": string (why you assessed this likelihood)
- "recommended_actions": string[] (what to do before submitting to maximize approval chances)
- "common_denial_reasons": string[] (why PAs for this medication typically get denied)

Base analysis on the patient's actual FHIR data. Common formulary knowledge is acceptable for coverage criteria, but clearly distinguish between patient-specific findings and general formulary patterns.`;

class CheckCoverageRequirementsTool implements IMcpTool {
  registerTool(server: McpServer, fhirConfig?: FhirConfig) {
    server.tool(
      "check_coverage_requirements",
      "Analyzes payer-specific step therapy, formulary requirements, and coverage criteria for a medication. Uses AI to evaluate whether the patient's treatment history meets typical prior authorization requirements and identifies gaps before submission.",
      {
        patient_id: z.string().optional().describe("FHIR Patient resource ID (auto-resolved from SHARP context if omitted)"),
        requested_medication_or_procedure: z.string().describe("The medication or procedure requiring prior auth"),
        payer_name: z.string().optional().describe("Insurance payer name for payer-specific analysis"),
      },
      async ({ patient_id, requested_medication_or_procedure, payer_name }) => {
        const pid = patient_id || fhirConfig?.patientId;
        if (!pid) return textResponse("Error: No patient_id provided via argument or SHARP context");
        const fhir = new FhirClient(fhirConfig);

        // Fetch comprehensive patient data for coverage analysis
        const [patient, conditions, allMedications, allergies, observations] = await Promise.all([
          fhir.read(`Patient/${pid}`),
          fhir.search("Condition", { patient: pid }),
          fhir.search("MedicationRequest", { patient: pid }), // all meds, not just active
          fhir.search("AllergyIntolerance", { patient: pid }),
          fhir.search("Observation", { patient: pid, _sort: "-date", _count: "10" }),
        ]);

        if (!patient) return textResponse(`Patient ${pid} not found`);

        const patientData = {
          patient: {
            name: formatName(patient.name),
            birthDate: patient.birthDate,
            gender: patient.gender,
            age: calculateAge(patient.birthDate),
          },
          conditions: conditions.map((c: any) => ({
            display: c.code?.coding?.[0]?.display || c.code?.text,
            code: c.code?.coding?.[0]?.code,
            clinicalStatus: c.clinicalStatus?.coding?.[0]?.code,
            onsetDate: c.onsetDateTime,
          })),
          medicationHistory: allMedications.map((m: any) => ({
            medication: m.medicationCodeableConcept?.coding?.[0]?.display || m.medicationCodeableConcept?.text || "Unknown",
            status: m.status,
            authoredOn: m.authoredOn,
            reasonCode: m.reasonCode?.[0]?.coding?.[0]?.display || null,
          })),
          allergies: allergies.map((a: any) => ({
            substance: a.code?.coding?.[0]?.display || a.code?.text || "Unknown",
            type: a.type,
            criticality: a.criticality,
          })),
          relevantLabs: observations.map((o: any) => ({
            code: o.code?.coding?.[0]?.display || o.code?.text,
            value: o.valueQuantity ? `${o.valueQuantity.value} ${o.valueQuantity.unit || ""}` : o.valueString || null,
            date: o.effectiveDateTime,
          })),
        };

        const userMessage = `Analyze coverage requirements and step therapy for:
- Requested: ${requested_medication_or_procedure}
- Payer: ${payer_name || "Generic US commercial insurance"}
- Patient data: ${JSON.stringify(patientData, null, 2)}`;

        try {
          const llmResponse = await callLLM(COVERAGE_CHECK_SYSTEM, userMessage);
          const result = safeParseJSON(llmResponse, { error: "Failed to parse coverage analysis", raw: llmResponse });
          return textResponse(JSON.stringify(result, null, 2));
        } catch (err: any) {
          return textResponse(`LLM Error: ${err.message}`);
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

export const checkCoverageRequirements = new CheckCoverageRequirementsTool();
