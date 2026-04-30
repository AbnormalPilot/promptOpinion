import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { IMcpTool, textResponse } from "./types";
import { FhirConfig } from "../fhir/client";
import { callLLM, safeParseJSON } from "../llm/client";
import { ADVERSARIAL_SYSTEM } from "../llm/prompts";
import { recordFindings } from "../learning/patterns";

interface AdversarialResponse {
  weaknesses: Array<{
    severity: "critical" | "major" | "minor";
    category: string;
    finding: string;
    denial_reason_if_used: string;
    fix: string;
  }>;
  denial_probability_if_submitted_as_is: number;
  must_fix_before_submission: string[];
  overall_assessment: string;
}

class AdversarialReviewTool implements IMcpTool {
  registerTool(server: McpServer, _fhirConfig?: FhirConfig) {
    server.tool(
      "adversarial_review",
      "Acts as a payer medical reviewer searching for reasons to DENY the draft. Returns ranked weaknesses, denial reasons that would be cited, and required fixes. Findings are recorded to the patterns store and auto-fed into future draft prompts. Call this after draft_prior_auth_request and before submission.",
      {
        drug: z.string(),
        draft_letter: z.string().describe("The full PA letter text to be critiqued"),
        clinical_context: z.string().optional().describe("Optional patient/evidence summary for context"),
      },
      async ({ drug, draft_letter, clinical_context }) => {
        try {
          const userMessage = `You are reviewing the following PA draft. Find weaknesses.

${clinical_context ? `--- CLINICAL CONTEXT ---\n${clinical_context}\n--- END CONTEXT ---\n\n` : ""}--- PA DRAFT TO CRITIQUE ---
${draft_letter}
--- END DRAFT ---`;

          const raw = await callLLM(ADVERSARIAL_SYSTEM, userMessage);
          const parsed = safeParseJSON<AdversarialResponse>(raw, {
            weaknesses: [],
            denial_probability_if_submitted_as_is: 0.5,
            must_fix_before_submission: [],
            overall_assessment: "Could not parse adversarial output.",
          });

          // Self-learning: feed findings into pattern store for future prompt augmentation
          if (parsed.weaknesses?.length) {
            const findings = parsed.weaknesses.map((w) => `${w.category}: ${w.finding}`);
            recordFindings(drug, findings);
          }

          return textResponse(JSON.stringify(parsed, null, 2));
        } catch (err: any) {
          return textResponse(`Error: ${err.message}`);
        }
      }
    );
  }
}

export const adversarialReview = new AdversarialReviewTool();
