import { z } from "zod";
import axios from "axios";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { IMcpTool, textResponse } from "./types";
import { FhirConfig } from "../fhir/client";
import { callLLM, safeParseJSON } from "../llm/client";
import { COST_ALTERNATIVE_SYSTEM } from "../llm/prompts";

const RXNAV_BASE = "https://rxnav.nlm.nih.gov/REST";

async function relatedDrugs(rxcui: string): Promise<Array<{ name: string; rxcui: string; tty: string }>> {
  try {
    const res = await axios.get(`${RXNAV_BASE}/rxcui/${rxcui}/related.json`, {
      params: { tty: "SCD+SBD+IN" },
      timeout: 8000,
    });
    const groups: any[] = res.data?.relatedGroup?.conceptGroup ?? [];
    const out: Array<{ name: string; rxcui: string; tty: string }> = [];
    for (const g of groups) {
      for (const c of g.conceptProperties ?? []) {
        out.push({ name: c.name, rxcui: c.rxcui, tty: c.tty });
      }
    }
    return out.slice(0, 8);
  } catch {
    return [];
  }
}

async function resolveRxCUI(name: string): Promise<string | null> {
  try {
    const res = await axios.get(`${RXNAV_BASE}/rxcui.json`, {
      params: { name, search: 2 },
      timeout: 6000,
    });
    const ids = res.data?.idGroup?.rxnormId;
    return Array.isArray(ids) && ids.length > 0 ? ids[0] : null;
  } catch {
    return null;
  }
}

class CostAlternativeAnalysisTool implements IMcpTool {
  registerTool(server: McpServer, _fhirConfig?: FhirConfig) {
    server.tool(
      "cost_alternative_analysis",
      "Suggests therapeutic alternatives to the requested drug that may avoid PA entirely or lower patient cost. Combines RxNorm related-drug lookup with LLM clinical-equivalence reasoning and tier estimation. Surfaces a 'best_no_pa_option' so clinicians can sometimes skip PA altogether.",
      {
        drug: z.string(),
        diagnosis_icd10: z.string(),
        patient_allergies: z.array(z.string()).optional(),
        patient_meds: z.array(z.string()).optional(),
      },
      async ({ drug, diagnosis_icd10, patient_allergies, patient_meds }) => {
        try {
          const rxcui = await resolveRxCUI(drug);
          const related = rxcui ? await relatedDrugs(rxcui) : [];
          const userMessage = `Suggest therapeutic alternatives.

Requested drug: ${drug}
RxNorm RxCUI: ${rxcui || "unresolved"}
Diagnosis ICD-10: ${diagnosis_icd10}
Patient allergies: ${patient_allergies?.join(", ") || "none documented"}
Patient current meds: ${patient_meds?.join(", ") || "none documented"}

RxNorm-related drugs (raw):
${related.map((r) => `- ${r.name} [${r.tty}, rxcui ${r.rxcui}]`).join("\n") || "(none)"}

Provide alternatives with tier estimates and PA likelihood. Highlight any that likely avoid PA entirely.`;

          const raw = await callLLM(COST_ALTERNATIVE_SYSTEM, userMessage);
          const parsed = safeParseJSON(raw, {
            requested_drug: drug,
            pa_likelihood_for_requested: "unknown",
            alternatives: [],
            best_no_pa_option: null,
            reasoning: "Could not parse model output.",
          });
          return textResponse(JSON.stringify({
            ...parsed,
            rxnorm_rxcui: rxcui,
            rxnorm_related_count: related.length,
          }, null, 2));
        } catch (err: any) {
          return textResponse(`Error: ${err.message}`);
        }
      }
    );
  }
}

export const costAlternativeAnalysis = new CostAlternativeAnalysisTool();
