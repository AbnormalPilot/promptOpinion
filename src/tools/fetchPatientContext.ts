import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { IMcpTool, textResponse } from "./types";
import { FhirClient, FhirConfig } from "../fhir/client";

class FetchPatientContextTool implements IMcpTool {
  registerTool(server: McpServer, fhirConfig?: FhirConfig) {
    server.tool(
      "fetch_patient_context",
      "Call this FIRST to load a complete patient profile: demographics, active conditions, allergies, and recent procedures from FHIR R4. This is the starting point for any prior authorization workflow.\n\n[fhir_context_required: true]",
      { patient_id: z.string().optional().describe("FHIR Patient resource ID (auto-resolved from SHARP context if omitted)") },
      async ({ patient_id }) => {
        try {
          const pid = patient_id || fhirConfig?.patientId;
          if (!pid) return textResponse("Error: No patient_id provided via argument or SHARP context");
          const fhir = new FhirClient(fhirConfig);

          const [patient, conditions, allergies, procedures] = await Promise.all([
            fhir.read(`Patient/${pid}`),
            fhir.search("Condition", { patient: pid, "clinical-status": "active" }),
            fhir.search("AllergyIntolerance", { patient: pid }),
            fhir.search("Procedure", { patient: pid, _sort: "-date", _count: "10" }),
          ]);

          if (!patient) return textResponse(`Patient ${pid} not found`);

          const result = {
            patient: {
              id: patient.id,
              name: formatName(patient.name),
              birthDate: patient.birthDate || null,
              gender: patient.gender || null,
              age: calculateAge(patient.birthDate),
              address: formatAddress(patient.address),
              identifier: patient.identifier?.map((i: any) => ({ system: i.system, value: i.value })) || [],
            },
            activeConditions: conditions.map((c: any) => ({
              code: c.code?.coding?.[0]?.code || "unknown",
              system: c.code?.coding?.[0]?.system || "",
              display: c.code?.coding?.[0]?.display || c.code?.text || "Unknown condition",
              onsetDate: c.onsetDateTime || c.onsetPeriod?.start || null,
            })),
            allergies: allergies.map((a: any) => ({
              substance: a.code?.coding?.[0]?.display || a.code?.text || "Unknown",
              type: a.type || null,
              criticality: a.criticality || null,
              reaction: a.reaction?.[0]?.manifestation?.[0]?.coding?.[0]?.display || null,
            })),
            recentProcedures: procedures.map((p: any) => ({
              procedure: p.code?.coding?.[0]?.display || p.code?.text || "Unknown",
              code: p.code?.coding?.[0]?.code || null,
              status: p.status || null,
              performedDate: p.performedDateTime || p.performedPeriod?.start || null,
            })),
          };

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

function formatAddress(addresses: any[]): string | null {
  if (!addresses?.length) return null;
  const a = addresses[0];
  return [a.line?.join(", "), a.city, a.state, a.postalCode, a.country].filter(Boolean).join(", ");
}

function calculateAge(birthDate: string | undefined): number | null {
  if (!birthDate) return null;
  const birth = new Date(birthDate);
  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  if (now.getMonth() < birth.getMonth() || (now.getMonth() === birth.getMonth() && now.getDate() < birth.getDate())) age--;
  return age;
}

export const fetchPatientContext = new FetchPatientContextTool();
