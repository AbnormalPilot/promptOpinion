import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { IMcpTool, textResponse } from "./types";
import { FhirClient, FhirConfig } from "../fhir/client";

class FetchMedicationListTool implements IMcpTool {
  registerTool(server: McpServer, fhirConfig?: FhirConfig) {
    server.tool(
      "fetch_medication_list",
      "Fetches the patient's medication history from FHIR R4 including active, completed, and stopped medications. Essential for documenting step therapy compliance in prior authorization requests.",
      {
        patient_id: z.string().optional().describe("FHIR Patient resource ID (auto-resolved from SHARP context if omitted)"),
        status: z.enum(["active", "completed", "all"]).default("active").describe("Medication status filter"),
      },
      async ({ patient_id, status }) => {
        try {
          const pid = patient_id || fhirConfig?.patientId;
          if (!pid) return textResponse("Error: No patient_id provided via argument or SHARP context");
          const fhir = new FhirClient(fhirConfig);

          const params: Record<string, string> = { patient: pid };
          if (status !== "all") params.status = status;

          const medications = await fhir.search("MedicationRequest", params);

          const result = medications.map((m: any) => ({
            medication: m.medicationCodeableConcept?.coding?.[0]?.display
              || m.medicationCodeableConcept?.text
              || m.medicationReference?.display
              || "Unknown medication",
            code: m.medicationCodeableConcept?.coding?.[0]?.code || null,
            status: m.status || null,
            intent: m.intent || null,
            authoredOn: m.authoredOn || null,
            dosageInstruction: m.dosageInstruction?.[0]?.text
              || m.dosageInstruction?.[0]?.patientInstruction
              || null,
            requester: m.requester?.display || null,
          }));

          return textResponse(JSON.stringify({ patientId: pid, medications: result }, null, 2));
        } catch (err: any) {
          return textResponse(`Error: ${err.message}`);
        }
      }
    );
  }
}

export const fetchMedicationList = new FetchMedicationListTool();
