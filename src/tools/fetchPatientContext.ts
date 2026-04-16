import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { IMcpTool, textResponse } from "./types";
import { FhirClient, FhirConfig } from "../fhir/client";

class FetchPatientContextTool implements IMcpTool {
  registerTool(server: McpServer, fhirConfig?: FhirConfig) {
    server.tool(
      "fetch_patient_context",
      "Fetches patient demographics and active conditions from FHIR R4",
      { patient_id: z.string().optional().describe("FHIR Patient resource ID (auto-resolved from SHARP context if omitted)") },
      async ({ patient_id }) => {
        const pid = patient_id || fhirConfig?.patientId;
        if (!pid) return textResponse("Error: No patient_id provided via argument or SHARP context");
        const fhir = new FhirClient(fhirConfig);

        const [patient, conditions] = await Promise.all([
          fhir.read(`Patient/${pid}`),
          fhir.search("Condition", { patient: pid, "clinical-status": "active" }),
        ]);

        if (!patient) return textResponse(`Patient ${pid} not found`);

        const result = {
          patient: {
            id: patient.id,
            name: formatName(patient.name),
            birthDate: patient.birthDate,
            gender: patient.gender,
            address: formatAddress(patient.address),
          },
          activeConditions: conditions.map((c: any) => ({
            code: c.code?.coding?.[0]?.code || "unknown",
            system: c.code?.coding?.[0]?.system || "",
            display: c.code?.coding?.[0]?.display || c.code?.text || "Unknown condition",
            onsetDate: c.onsetDateTime || c.onsetPeriod?.start || null,
          })),
        };

        return textResponse(JSON.stringify(result, null, 2));
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
  return [a.line?.join(", "), a.city, a.state, a.postalCode, a.country].filter(Boolean).join(", ");
}

export const fetchPatientContext = new FetchPatientContextTool();
