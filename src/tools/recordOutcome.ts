import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { IMcpTool, textResponse } from "./types";
import { FhirConfig } from "../fhir/client";
import { recordCase } from "../memory/store";
import { logPrediction } from "../learning/calibration";

class RecordOutcomeTool implements IMcpTool {
  registerTool(server: McpServer, _fhirConfig?: FhirConfig) {
    server.tool(
      "record_pa_outcome",
      "Records the actual outcome of a submitted PA into the self-learning memory store. This is the WRITE side of the learning loop — every recorded outcome improves future predictions, retrievals, and drafts. Should be called after the payer responds.",
      {
        drug: z.string(),
        diagnosis_icd10: z.string(),
        payer: z.string().optional(),
        evidence_summary: z.string(),
        predicted_probability: z.number().optional().describe("What the predictor said before submission"),
        outcome: z.enum(["approved", "denied", "appealed_won", "appealed_lost", "pending"]),
        denial_reason: z.string().optional(),
        adversarial_findings: z.array(z.string()).optional(),
        patient_age: z.number().optional(),
        step_therapy_met: z.boolean().optional(),
      },
      async (args) => {
        try {
          const record = await recordCase({
            drug: args.drug,
            diagnosis_icd10: args.diagnosis_icd10,
            payer: args.payer,
            evidence_summary: args.evidence_summary,
            predicted_probability: args.predicted_probability,
            outcome: args.outcome,
            denial_reason: args.denial_reason,
            adversarial_findings: args.adversarial_findings,
            patient_age: args.patient_age,
            step_therapy_met: args.step_therapy_met,
          });

          // Calibration log: predicted vs actual
          if (args.predicted_probability != null && args.outcome !== "pending") {
            const actual: 0 | 1 = (args.outcome === "approved" || args.outcome === "appealed_won") ? 1 : 0;
            logPrediction({
              ts: new Date().toISOString(),
              predicted: args.predicted_probability,
              actual,
              drug: args.drug,
              payer: args.payer,
            });
          }

          return textResponse(JSON.stringify({
            recorded: true,
            case_id: record.id,
            note: "Memory + calibration log updated. Future predictions for similar cases will incorporate this outcome.",
          }, null, 2));
        } catch (err: any) {
          return textResponse(`Error: ${err.message}`);
        }
      }
    );
  }
}

export const recordOutcome = new RecordOutcomeTool();
