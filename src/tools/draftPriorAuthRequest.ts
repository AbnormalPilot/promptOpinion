import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { IMcpTool, textResponse } from "./types";
import { FhirClient, FhirConfig } from "../fhir/client";
import { callLLM, safeParseJSON } from "../llm/client";
import { ANALYZE_PRIOR_AUTH_SYSTEM, DRAFT_PRIOR_AUTH_SYSTEM } from "../llm/prompts";

class DraftPriorAuthRequestTool implements IMcpTool {
  registerTool(server: McpServer, fhirConfig?: FhirConfig) {
    server.tool(
      "draft_prior_auth_request",
      "Generates a complete prior authorization request letter ready for payer submission",
      {
        patient_id: z.string().describe("FHIR Patient resource ID"),
        requested_medication_or_procedure: z.string().describe("The medication or procedure requiring prior auth"),
        requesting_provider: z.string().optional().describe("Name of requesting provider"),
        payer_name: z.string().optional().describe("Insurance payer name"),
      },
      async ({ patient_id, requested_medication_or_procedure, requesting_provider, payer_name }) => {
        const fhir = new FhirClient(fhirConfig);

        const [patient, conditions, medications, encounters, observations] = await Promise.all([
          fhir.read(`Patient/${patient_id}`),
          fhir.search("Condition", { patient: patient_id, "clinical-status": "active" }),
          fhir.search("MedicationRequest", { patient: patient_id }),
          fhir.search("Encounter", { patient: patient_id, _sort: "-date", _count: "5" }),
          fhir.search("Observation", { patient: patient_id, _sort: "-date", _count: "15" }),
        ]);

        if (!patient) return textResponse(`Patient ${patient_id} not found`);

        const patientData = {
          patient: {
            id: patient.id,
            name: formatName(patient.name),
            birthDate: patient.birthDate,
            gender: patient.gender,
            address: formatAddress(patient.address),
            identifier: patient.identifier?.map((i: any) => ({ system: i.system, value: i.value })),
          },
          activeConditions: conditions.map((c: any) => ({
            code: c.code?.coding?.[0]?.code,
            display: c.code?.coding?.[0]?.display || c.code?.text,
            system: c.code?.coding?.[0]?.system,
            onsetDate: c.onsetDateTime,
          })),
          medications: medications.map((m: any) => ({
            medication: m.medicationCodeableConcept?.coding?.[0]?.display || m.medicationCodeableConcept?.text || "Unknown",
            code: m.medicationCodeableConcept?.coding?.[0]?.code,
            status: m.status,
            authoredOn: m.authoredOn,
          })),
          recentEncounters: encounters.map((e: any) => ({
            type: e.type?.[0]?.coding?.[0]?.display || e.type?.[0]?.text,
            date: e.period?.start,
            reason: e.reasonCode?.[0]?.coding?.[0]?.display || e.reasonCode?.[0]?.text,
          })),
          observations: observations.map((o: any) => ({
            code: o.code?.coding?.[0]?.display || o.code?.text,
            value: o.valueQuantity ? `${o.valueQuantity.value} ${o.valueQuantity.unit || ""}` : o.valueString || null,
            date: o.effectiveDateTime,
          })),
        };

        try {
          // Step 1: Analyze
          const analysisPrompt = `Analyze prior authorization need for:
- Requested: ${requested_medication_or_procedure}
- Provider: ${requesting_provider || "Not specified"}
- Patient data: ${JSON.stringify(patientData, null, 2)}`;

          const analysisRaw = await callLLM(ANALYZE_PRIOR_AUTH_SYSTEM, analysisPrompt);
          const analysis = safeParseJSON(analysisRaw, null);

          // Step 2: Draft letter
          const draftPrompt = `Draft a prior authorization request letter:
- Requested: ${requested_medication_or_procedure}
- Provider: ${requesting_provider || "Not specified"}
- Payer: ${payer_name || "Insurance Company"}
- Patient data: ${JSON.stringify(patientData, null, 2)}
- Clinical analysis: ${analysis ? JSON.stringify(analysis, null, 2) : "Analysis unavailable — use patient data directly"}`;

          const draftRaw = await callLLM(DRAFT_PRIOR_AUTH_SYSTEM, draftPrompt);
          const draft = safeParseJSON(draftRaw, { error: "Failed to generate letter", raw: draftRaw });

          return textResponse(JSON.stringify(draft, null, 2));
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

function formatAddress(addresses: any[]): string | null {
  if (!addresses?.length) return null;
  const a = addresses[0];
  return [a.line?.join(", "), a.city, a.state, a.postalCode].filter(Boolean).join(", ");
}

export const draftPriorAuthRequest = new DraftPriorAuthRequestTool();
