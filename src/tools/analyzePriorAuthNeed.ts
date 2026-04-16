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
      "Uses LLM to analyze patient data and identify clinical justification needed for prior authorization",
      {
        patient_id: z.string().optional().describe("FHIR Patient resource ID (auto-resolved from SHARP context if omitted)"),
        requested_medication_or_procedure: z.string().describe("The medication or procedure requiring prior auth"),
        requesting_provider: z.string().optional().describe("Name of requesting provider"),
      },
      async ({ patient_id, requested_medication_or_procedure, requesting_provider }) => {
        const pid = patient_id || fhirConfig?.patientId;
        if (!pid) return textResponse("Error: No patient_id provided via argument or SHARP context");
        const fhir = new FhirClient(fhirConfig);

        const [patient, conditions, medications, observations] = await Promise.all([
          fhir.read(`Patient/${pid}`),
          fhir.search("Condition", { patient: pid, "clinical-status": "active" }),
          fhir.search("MedicationRequest", { patient: pid, status: "active" }),
          fhir.search("Observation", { patient: pid, _sort: "-date", _count: "20" }),
        ]);

        if (!patient) return textResponse(`Patient ${pid} not found`);

        const patientData = {
          patient: { id: patient.id, name: formatName(patient.name), birthDate: patient.birthDate, gender: patient.gender },
          activeConditions: conditions.map((c: any) => ({
            code: c.code?.coding?.[0]?.code,
            display: c.code?.coding?.[0]?.display || c.code?.text,
            system: c.code?.coding?.[0]?.system,
          })),
          currentMedications: medications.map((m: any) => ({
            medication: m.medicationCodeableConcept?.coding?.[0]?.display || m.medicationCodeableConcept?.text || "Unknown",
            status: m.status,
            authoredOn: m.authoredOn,
          })),
          recentObservations: observations.slice(0, 10).map((o: any) => ({
            code: o.code?.coding?.[0]?.display || o.code?.text,
            value: o.valueQuantity ? `${o.valueQuantity.value} ${o.valueQuantity.unit || ""}` : o.valueString || null,
            date: o.effectiveDateTime,
          })),
        };

        const userMessage = `Analyze prior authorization need for:
- Requested: ${requested_medication_or_procedure}
- Provider: ${requesting_provider || "Not specified"}
- Patient data: ${JSON.stringify(patientData, null, 2)}`;

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

export const analyzePriorAuthNeed = new AnalyzePriorAuthNeedTool();
