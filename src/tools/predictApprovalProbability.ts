import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { IMcpTool, textResponse } from "./types";
import { FhirConfig } from "../fhir/client";
import { callLLM, safeParseJSON } from "../llm/client";
import { PREDICT_APPROVAL_SYSTEM } from "../llm/prompts";
import { retrieveSimilar, formatPriorCases } from "../memory/store";
import { calibratedProbability, brierScore } from "../learning/calibration";

interface PredictResponse {
  predicted_probability: number;
  confidence_band: "low" | "medium" | "high";
  key_factors: Array<{ factor: string; direction: "positive" | "negative"; weight: number; rationale: string }>;
  comparable_priors_used: string[];
  primary_denial_risks: string[];
  would_likely_succeed_on_appeal: boolean;
  rationale: string;
  raw_probability?: number;
  calibration_applied?: boolean;
  calibration_brier?: number | null;
  prior_cases_count?: number;
}

class PredictApprovalProbabilityTool implements IMcpTool {
  registerTool(server: McpServer, _fhirConfig?: FhirConfig) {
    server.tool(
      "predict_approval_probability",
      "Predicts the probability that a payer will approve this PA on first submission. Uses a calibrated LLM forecaster grounded in similar past cases retrieved from the self-learning memory store. Returns probability, confidence band, key factors, and primary denial risks. Calls retrieveSimilar() to anchor the prediction in real outcomes.",
      {
        drug: z.string().describe("Medication or procedure being requested"),
        diagnosis_icd10: z.string().describe("Primary ICD-10 diagnosis code"),
        payer: z.string().optional().describe("Payer name (commercial, Medicare, Medicaid, specific name)"),
        evidence_summary: z.string().describe("Plain-text summary of clinical evidence assembled so far (output of analyze_prior_auth_need + extract_clinical_evidence)"),
        step_therapy_met: z.boolean().optional().describe("Whether step therapy is documented as satisfied"),
        patient_age: z.number().optional().describe("Patient age in years"),
      },
      async ({ drug, diagnosis_icd10, payer, evidence_summary, step_therapy_met, patient_age }) => {
        try {
          const priors = await retrieveSimilar({ drug, diagnosis_icd10, payer, evidence_summary }, 3);
          const priorText = formatPriorCases(priors);

          const userMessage = `Forecast first-submission approval probability.

Drug: ${drug}
Diagnosis ICD-10: ${diagnosis_icd10}
Payer: ${payer || "unspecified"}
Step therapy met: ${step_therapy_met ?? "unknown"}
Patient age: ${patient_age ?? "unknown"}

Evidence summary:
${evidence_summary}

--- COMPARABLE PRIOR CASES (most similar first) ---
${priorText}
--- END PRIOR CASES ---

Use the prior cases to anchor your prediction. If priors with similar profile were denied, factor that in.`;

          const raw = await callLLM(PREDICT_APPROVAL_SYSTEM, userMessage);
          const parsed = safeParseJSON<PredictResponse>(raw, {
            predicted_probability: 0.5,
            confidence_band: "low",
            key_factors: [],
            comparable_priors_used: [],
            primary_denial_risks: ["LLM parse failed"],
            would_likely_succeed_on_appeal: false,
            rationale: "Could not parse model output.",
          });

          const rawP = clamp(parsed.predicted_probability, 0, 1);
          const calibrated = calibratedProbability(rawP);

          const out: PredictResponse = {
            ...parsed,
            predicted_probability: calibrated,
            raw_probability: rawP,
            calibration_applied: Math.abs(calibrated - rawP) > 0.01,
            calibration_brier: brierScore(),
            prior_cases_count: priors.length,
          };
          return textResponse(JSON.stringify(out, null, 2));
        } catch (err: any) {
          return textResponse(`Error: ${err.message}`);
        }
      }
    );
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

export const predictApprovalProbability = new PredictApprovalProbabilityTool();
