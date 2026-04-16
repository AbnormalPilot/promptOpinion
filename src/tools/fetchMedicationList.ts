import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { IMcpTool, textResponse } from "./types";
import { FhirClient, FhirConfig } from "../fhir/client";

class FetchMedicationListTool implements IMcpTool {
  registerTool(server: McpServer, fhirConfig?: FhirConfig) {
    server.tool(
      "fetch_medication_list",
      "Fetches current medications for a patient from FHIR R4",
      {
        patient_id: z.string().describe("FHIR Patient resource ID"),
        status: z.enum(["active", "completed", "all"]).default("active").describe("Medication status filter"),
      },
      async ({ patient_id, status }) => {
        const fhir = new FhirClient(fhirConfig);

        const params: Record<string, string> = { patient: patient_id };
        if (status !== "all") params.status = status;

        const medications = await fhir.search("MedicationRequest", params);

        const result = medications.map((m: any) => ({
          medication: m.medicationCodeableConcept?.coding?.[0]?.display
            || m.medicationCodeableConcept?.text
            || m.medicationReference?.display
            || "Unknown medication",
          code: m.medicationCodeableConcept?.coding?.[0]?.code || null,
          status: m.status,
          intent: m.intent,
          authoredOn: m.authoredOn || null,
          dosageInstruction: m.dosageInstruction?.[0]?.text
            || m.dosageInstruction?.[0]?.patientInstruction
            || null,
          requester: m.requester?.display || null,
        }));

        return textResponse(JSON.stringify({ patientId: patient_id, medications: result }, null, 2));
      }
    );
  }
}

export const fetchMedicationList = new FetchMedicationListTool();
