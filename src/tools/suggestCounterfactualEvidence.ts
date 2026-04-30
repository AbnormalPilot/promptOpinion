import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { IMcpTool, textResponse } from "./types";
import { FhirConfig } from "../fhir/client";
import { callLLM, safeParseJSON } from "../llm/client";
import { COUNTERFACTUAL_SYSTEM } from "../llm/prompts";

class SuggestCounterfactualEvidenceTool implements IMcpTool {
  registerTool(server: McpServer, _fhirConfig?: FhirConfig) {
    server.tool(
      "suggest_counterfactual_evidence",
      "Given a current PA case and predicted approval probability, recommends the SPECIFIC additional evidence that would most increase approval probability. Returns ordered actions ranked by impact-per-effort and the maximum achievable probability if all suggestions are followed.",
      {
        drug: z.string(),
        diagnosis_icd10: z.string(),
        current_probability: z.number().describe("Current predicted approval probability (0-1)"),
        evidence_summary: z.string().describe("What evidence is already documented"),
        primary_denial_risks: z.array(z.string()).optional().describe("Risks identified by the predictor"),
      },
      async ({ drug, diagnosis_icd10, current_probability, evidence_summary, primary_denial_risks }) => {
        try {
          const userMessage = `Identify the most impactful additional evidence to gather.

Drug: ${drug}
Diagnosis ICD-10: ${diagnosis_icd10}
Current predicted approval probability: ${current_probability.toFixed(2)}

Already documented:
${evidence_summary}

${primary_denial_risks?.length ? "Identified denial risks:\n- " + primary_denial_risks.join("\n- ") : ""}

Return concrete, obtainable next steps that maximize approval probability per unit effort.`;

          const raw = await callLLM(COUNTERFACTUAL_SYSTEM, userMessage);
          const parsed = safeParseJSON(raw, {
            current_probability,
            recommended_additions: [],
            max_achievable_probability: current_probability,
            fastest_path_to_approval: [],
          });
          return textResponse(JSON.stringify(parsed, null, 2));
        } catch (err: any) {
          return textResponse(`Error: ${err.message}`);
        }
      }
    );
  }
}

export const suggestCounterfactualEvidence = new SuggestCounterfactualEvidenceTool();
