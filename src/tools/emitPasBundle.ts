import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { IMcpTool, textResponse } from "./types";
import { FhirClient, FhirConfig } from "../fhir/client";
import { buildPasBundle } from "../fhir/pas-bundle";

class EmitPasBundleTool implements IMcpTool {
  registerTool(server: McpServer, fhirConfig?: FhirConfig) {
    server.tool(
      "emit_pas_bundle",
      "Emits a Da Vinci PAS (Prior Authorization Support) STU 2.1 FHIR R4 Bundle (collection) containing a Claim with use=preauthorization, Patient, Practitioner, Coverage, MedicationRequest, plus supporting Conditions and Observations. Pure assembly — no LLM letter generation.",
      {
        patient_id: z.string().optional().describe("FHIR Patient resource ID (auto-resolved from SHARP context if omitted)"),
        requested_medication_or_procedure: z.string().describe("The medication or procedure requiring prior auth"),
        requesting_provider: z.string().optional().describe("Name of requesting provider"),
        payer_name: z.string().optional().describe("Insurance payer name"),
        primary_icd10: z.string().optional().describe("Primary ICD-10 diagnosis code"),
        payer_member_id: z.string().optional().describe("Subscriber/member ID for Coverage resource"),
        provider_npi: z.string().optional().describe("Requesting provider NPI"),
      },
      async ({ patient_id, requested_medication_or_procedure, requesting_provider, payer_name, primary_icd10, payer_member_id, provider_npi }) => {
        try {
          const pid = patient_id || fhirConfig?.patientId;
          if (!pid) return textResponse("Error: No patient_id provided via argument or SHARP context");
          const fhir = new FhirClient(fhirConfig);
          const [patient, conditions, observations] = await Promise.all([
            fhir.read(`Patient/${pid}`),
            fhir.search("Condition", { patient: pid, "clinical-status": "active" }),
            fhir.search("Observation", { patient: pid, _sort: "-date", _count: "15" }),
          ]);
          if (!patient) return textResponse(`Patient ${pid} not found`);

          const result = buildPasBundle({
            patient: {
              id: patient.id,
              name: patient.name?.[0] ? `${patient.name[0].given?.join(" ") || ""} ${patient.name[0].family || ""}`.trim() : undefined,
              birthDate: patient.birthDate || null,
              gender: patient.gender || null,
              identifier: patient.identifier?.map((i: any) => ({ system: i.system, value: i.value })) || [],
            },
            activeConditions: conditions.map((c: any) => ({
              code: c.code?.coding?.[0]?.code || null,
              system: c.code?.coding?.[0]?.system || null,
              display: c.code?.coding?.[0]?.display || c.code?.text || "Unknown",
              fhirId: c.id,
              onsetDate: c.onsetDateTime || null,
            })),
            observations: observations.map((o: any) => ({
              code: o.code?.coding?.[0]?.display || o.code?.text || "Unknown",
              value: o.valueQuantity ? `${o.valueQuantity.value} ${o.valueQuantity.unit || ""}`.trim() : o.valueString || null,
              date: o.effectiveDateTime || null,
              fhirId: o.id,
            })),
            requested_medication_or_procedure,
            requesting_provider,
            payer_name,
            primary_icd10,
            payer_member_id,
            provider_npi,
          });

          return textResponse(JSON.stringify(result, null, 2));
        } catch (err: any) {
          return textResponse(`Error: ${err.message}`);
        }
      }
    );
  }
}

export const emitPasBundle = new EmitPasBundleTool();
