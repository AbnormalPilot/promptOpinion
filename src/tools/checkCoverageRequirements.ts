import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { IMcpTool, textResponse } from "./types";
import { FhirClient, FhirConfig } from "../fhir/client";
import { callLLM, safeParseJSON } from "../llm/client";
import { COVERAGE_CHECK_SYSTEM } from "../llm/prompts";

class CheckCoverageRequirementsTool implements IMcpTool {
  registerTool(server: McpServer, fhirConfig?: FhirConfig) {
    server.tool(
      "check_coverage_requirements",
      "Analyzes payer-specific step therapy, formulary requirements, and coverage criteria for a medication. Call this AFTER fetch_patient_context and BEFORE drafting the PA letter to identify step therapy gaps and documentation requirements.",
      {
        patient_id: z.string().optional().describe("FHIR Patient resource ID (auto-resolved from SHARP context if omitted)"),
        requested_medication_or_procedure: z.string().describe("The medication or procedure requiring prior auth"),
        payer_name: z.string().optional().describe("Insurance payer name for payer-specific analysis"),
      },
      async ({ patient_id, requested_medication_or_procedure, payer_name }) => {
        try {
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
              birthDate: patient.birthDate || null,
              gender: patient.gender || null,
              age: calculateAge(patient.birthDate),
            },
            conditions: conditions.map((c: any) => ({
              display: c.code?.coding?.[0]?.display || c.code?.text || "Unknown",
              code: c.code?.coding?.[0]?.code || null,
              clinicalStatus: c.clinicalStatus?.coding?.[0]?.code || null,
              onsetDate: c.onsetDateTime || null,
            })),
            medicationHistory: allMedications.map((m: any) => ({
              medication: m.medicationCodeableConcept?.coding?.[0]?.display || m.medicationCodeableConcept?.text || "Unknown",
              status: m.status || null,
              authoredOn: m.authoredOn || null,
              reasonCode: m.reasonCode?.[0]?.coding?.[0]?.display || null,
            })),
            allergies: allergies.map((a: any) => ({
              substance: a.code?.coding?.[0]?.display || a.code?.text || "Unknown",
              type: a.type || null,
              criticality: a.criticality || null,
            })),
            relevantLabs: observations.map((o: any) => ({
              code: o.code?.coding?.[0]?.display || o.code?.text || "Unknown",
              value: o.valueQuantity ? `${o.valueQuantity.value} ${o.valueQuantity.unit || ""}`.trim() : o.valueString || null,
              date: o.effectiveDateTime || null,
            })),
          };

          const userMessage = `Analyze coverage requirements and step therapy for:
- Requested: ${requested_medication_or_procedure}
- Payer: ${payer_name || "Generic US commercial insurance"}
- Patient data: ${JSON.stringify(patientData, null, 2)}`;

          const llmResponse = await callLLM(COVERAGE_CHECK_SYSTEM, userMessage);
          const result = safeParseJSON(llmResponse, { error: "Failed to parse coverage analysis", raw: llmResponse });
          return textResponse(JSON.stringify(result, null, 2));
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

export const checkCoverageRequirements = new CheckCoverageRequirementsTool();
