import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { IMcpTool, textResponse } from "./types";
import { FhirClient, FhirConfig } from "../fhir/client";

class FetchClinicalHistoryTool implements IMcpTool {
  registerTool(server: McpServer, fhirConfig?: FhirConfig) {
    server.tool(
      "fetch_clinical_history",
      "Fetches recent encounters, lab results, and vital signs from FHIR R4. Provides the clinical evidence trail needed to demonstrate medical necessity in a prior authorization request.",
      {
        patient_id: z.string().optional().describe("FHIR Patient resource ID (auto-resolved from SHARP context if omitted)"),
        lookback_days: z.number().default(180).describe("How many days of history to fetch"),
      },
      async ({ patient_id, lookback_days }) => {
        const pid = patient_id || fhirConfig?.patientId;
        if (!pid) return textResponse("Error: No patient_id provided via argument or SHARP context");
        const fhir = new FhirClient(fhirConfig);

        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - lookback_days);
        const dateParam = `ge${cutoffDate.toISOString().split("T")[0]}`;

        const [encounters, observations] = await Promise.all([
          fhir.search("Encounter", { patient: pid, date: dateParam, _sort: "-date", _count: "10" }),
          fhir.search("Observation", { patient: pid, date: dateParam, _sort: "-date", _count: "20" }),
        ]);

        const result = {
          patientId: pid,
          lookbackDays: lookback_days,
          encounters: encounters.map((e: any) => ({
            type: e.type?.[0]?.coding?.[0]?.display || e.type?.[0]?.text || "Unknown",
            status: e.status,
            period: { start: e.period?.start, end: e.period?.end },
            reasonCode: e.reasonCode?.[0]?.coding?.[0]?.display || e.reasonCode?.[0]?.text || null,
          })),
          observations: observations.map((o: any) => ({
            code: o.code?.coding?.[0]?.display || o.code?.text || "Unknown",
            value: formatObservationValue(o),
            date: o.effectiveDateTime || o.effectivePeriod?.start || null,
            category: o.category?.[0]?.coding?.[0]?.code || null,
          })),
        };

        return textResponse(JSON.stringify(result, null, 2));
      }
    );
  }
}

function formatObservationValue(obs: any): string | null {
  if (obs.valueQuantity) return `${obs.valueQuantity.value} ${obs.valueQuantity.unit || ""}`.trim();
  if (obs.valueCodeableConcept) return obs.valueCodeableConcept.coding?.[0]?.display || obs.valueCodeableConcept.text;
  if (obs.valueString) return obs.valueString;
  if (obs.valueBoolean !== undefined) return String(obs.valueBoolean);
  return null;
}

export const fetchClinicalHistory = new FetchClinicalHistoryTool();
