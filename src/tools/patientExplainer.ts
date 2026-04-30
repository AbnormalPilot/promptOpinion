import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { IMcpTool, textResponse } from "./types";
import { FhirConfig } from "../fhir/client";
import { callLLM, safeParseJSON } from "../llm/client";
import { PATIENT_EXPLAINER_SYSTEM } from "../llm/prompts";

class PatientExplainerTool implements IMcpTool {
  registerTool(server: McpServer, _fhirConfig?: FhirConfig) {
    server.tool(
      "patient_explainer",
      "Generates a plain-English (6th-grade reading level) summary of the PA situation for the patient and family. Explains what is being requested, why, what insurance does next, timeline, and what the patient can do. Reduces patient anxiety and improves shared decision-making.\n\noutputSchema (JSON): { what_is_happening: string, why_you_need_it: string, what_insurance_decides: string, what_you_can_do: string[], estimated_timeline: string, if_denied_what_happens: string, questions_to_ask_your_doctor: string[], reading_level_grade: number }\n\n[fhir_context_required: false]",
      {
        drug: z.string(),
        clinical_reason: z.string().describe("Plain summary of why the medication is needed"),
        payer: z.string().optional(),
        is_appeal: z.boolean().optional().describe("Set true if this is an appeal of a denial"),
      },
      async ({ drug, clinical_reason, payer, is_appeal }) => {
        try {
          const userMessage = `Write a patient-facing explanation.

Medication/procedure: ${drug}
Clinical reason: ${clinical_reason}
Insurance: ${payer || "patient's insurance"}
Is this an appeal of a denial? ${is_appeal ? "yes" : "no"}`;

          const raw = await callLLM(PATIENT_EXPLAINER_SYSTEM, userMessage);
          const parsed = safeParseJSON(raw, {
            what_is_happening: "Could not generate explanation.",
            why_you_need_it: "",
            what_insurance_decides: "",
            what_you_can_do: [],
            estimated_timeline: "",
            if_denied_what_happens: "",
            questions_to_ask_your_doctor: [],
            reading_level_grade: 6,
          });
          return textResponse(JSON.stringify(parsed, null, 2));
        } catch (err: any) {
          return textResponse(`Error: ${err.message}`);
        }
      }
    );
  }
}

export const patientExplainer = new PatientExplainerTool();
