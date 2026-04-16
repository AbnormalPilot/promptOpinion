import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { IMcpTool, textResponse } from "./types";
import { FhirClient, FhirConfig } from "../fhir/client";
import { callLLM, safeParseJSON } from "../llm/client";
import { ANALYZE_PRIOR_AUTH_SYSTEM } from "../llm/prompts";

class AnalyzePriorAuthNeedTool implements IMcpTool {
  registerTool(server: McpServer, fhirConfig?: FhirConfig) {
    server.tool(
      "analyze_prior_auth_need",
      "AI-powered clinical analysis that evaluates medical necessity, maps SNOMED to ICD-10, validates step therapy compliance, and generates a structured justification with confidence scoring. Call this AFTER fetching patient data to get the clinical reasoning before drafting the PA letter.",
      {
        patient_id: z.string().optional().describe("FHIR Patient resource ID (auto-resolved from SHARP context if omitted)"),
        requested_medication_or_procedure: z.string().describe("The medication or procedure requiring prior auth"),
        requesting_provider: z.string().optional().describe("Name of requesting provider"),
        policy_context: z.string().optional().describe("CMS NCD policy text from lookup_coverage_policy (optional, improves accuracy)"),
      },
      async ({ patient_id, requested_medication_or_procedure, requesting_provider, policy_context }) => {
        const pid = patient_id || fhirConfig?.patientId;
        if (!pid) return textResponse("Error: No patient_id provided via argument or SHARP context");
        const fhir = new FhirClient(fhirConfig);

        // Fetch ALL data including full med history + allergies (parallel)
        const [patient, conditions, allMedications, allergies, observations] = await Promise.all([
          fhir.read(`Patient/${pid}`),
          fhir.search("Condition", { patient: pid, "clinical-status": "active" }),
          fhir.search("MedicationRequest", { patient: pid }), // ALL meds, not just active
          fhir.search("AllergyIntolerance", { patient: pid }),
          fhir.search("Observation", { patient: pid, _sort: "-date", _count: "20" }),
        ]);

        if (!patient) return textResponse(`Patient ${pid} not found`);

        const patientData = {
          patient: {
            id: patient.id,
            name: formatName(patient.name),
            birthDate: patient.birthDate,
            gender: patient.gender,
            age: calculateAge(patient.birthDate),
          },
          activeConditions: conditions.map((c: any) => ({
            code: c.code?.coding?.[0]?.code,
            system: c.code?.coding?.[0]?.system,
            display: c.code?.coding?.[0]?.display || c.code?.text,
            onsetDate: c.onsetDateTime,
          })),
          medicationHistory: allMedications.map((m: any) => ({
            medication: m.medicationCodeableConcept?.coding?.[0]?.display || m.medicationCodeableConcept?.text || "Unknown",
            code: m.medicationCodeableConcept?.coding?.[0]?.code,
            status: m.status, // active, completed, stopped, cancelled
            authoredOn: m.authoredOn,
            reasonCode: m.reasonCode?.[0]?.coding?.[0]?.display || null,
          })),
          allergies: allergies.map((a: any) => ({
            substance: a.code?.coding?.[0]?.display || a.code?.text || "Unknown",
            type: a.type,
            criticality: a.criticality,
          })),
          recentObservations: observations.slice(0, 15).map((o: any) => ({
            code: o.code?.coding?.[0]?.display || o.code?.text,
            value: o.valueQuantity ? `${o.valueQuantity.value} ${o.valueQuantity.unit || ""}` : o.valueString || null,
            date: o.effectiveDateTime,
          })),
        };

        let userMessage = `Analyze prior authorization need for:
- Requested: ${requested_medication_or_procedure}
- Provider: ${requesting_provider || "Not specified"}
- Patient data: ${JSON.stringify(patientData, null, 2)}`;

        if (policy_context) {
          userMessage += `\n\n--- RELEVANT CMS COVERAGE POLICY ---\n${policy_context}\n--- END POLICY ---\nCite specific NCD section numbers in your analysis where applicable.`;
        }

        try {
          const llmResponse = await callLLM(ANALYZE_PRIOR_AUTH_SYSTEM, userMessage);
          const analysis = safeParseJSON(llmResponse, { error: "Failed to parse LLM response", raw: llmResponse });
          return textResponse(JSON.stringify(analysis, null, 2));
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

export const analyzePriorAuthNeed = new AnalyzePriorAuthNeedTool();
