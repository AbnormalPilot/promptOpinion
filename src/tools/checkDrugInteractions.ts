import { z } from "zod";
import axios from "axios";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { IMcpTool, textResponse } from "./types";
import { FhirConfig } from "../fhir/client";

const RXNAV_BASE = "https://rxnav.nlm.nih.gov/REST";
const TIMEOUT_MS = 10_000;

async function resolveRxCUI(name: string): Promise<string | null> {
  const res = await axios.get(`${RXNAV_BASE}/rxcui.json`, {
    params: { name, search: 2 },
    timeout: TIMEOUT_MS,
  });
  const idGroup = res.data?.idGroup;
  const rxnormId = idGroup?.rxnormId;
  if (Array.isArray(rxnormId) && rxnormId.length > 0) return rxnormId[0];
  return null;
}

async function getSingleDrugInteractions(
  rxcui: string
): Promise<{ drug: string; description: string; severity: string }[]> {
  const res = await axios.get(`${RXNAV_BASE}/interaction/interaction.json`, {
    params: { rxcui, sources: "DrugBank" },
    timeout: TIMEOUT_MS,
  });

  const interactionTypeGroup: any[] =
    res.data?.interactionTypeGroup ?? [];

  const results: { drug: string; description: string; severity: string }[] = [];

  for (const typeGroup of interactionTypeGroup) {
    for (const interactionType of typeGroup.interactionType ?? []) {
      for (const pair of interactionType.interactionPair ?? []) {
        const concepts: any[] = pair.interactionConcept ?? [];
        // The two drugs in the pair — pick the one that is NOT the queried drug
        const drugNames = concepts.map(
          (c: any) =>
            c.minConceptItem?.name ?? c.sourceConceptItem?.name ?? "Unknown"
        );
        results.push({
          drug: drugNames.join(" + "),
          description: pair.description ?? "",
          severity: pair.severity ?? "unknown",
        });
      }
    }
  }

  return results;
}

async function getPairwiseInteractions(
  rxcui1: string,
  rxcui2: string
): Promise<{ description: string; severity: string }[]> {
  const res = await axios.get(`${RXNAV_BASE}/interaction/list.json`, {
    params: { rxcuis: `${rxcui1}+${rxcui2}` },
    timeout: TIMEOUT_MS,
  });

  const fullInteractionTypeGroup: any[] =
    res.data?.fullInteractionTypeGroup ?? [];

  const results: { description: string; severity: string }[] = [];

  for (const typeGroup of fullInteractionTypeGroup) {
    for (const interactionType of typeGroup.fullInteractionType ?? []) {
      for (const pair of interactionType.interactionPair ?? []) {
        results.push({
          description: pair.description ?? "",
          severity: pair.severity ?? "unknown",
        });
      }
    }
  }

  return results;
}

class CheckDrugInteractionsTool implements IMcpTool {
  registerTool(server: McpServer, _fhirConfig?: FhirConfig) {
    server.tool(
      "check_drug_interactions",
      "Checks drug-drug interactions using the National Library of Medicine RxNorm database. Call this before prescribing to verify safety against the patient's current medications. No API key required — uses public NLM data.",
      {
        medication_name: z
          .string()
          .describe("The drug to check interactions for"),
        current_medications: z
          .array(z.string())
          .optional()
          .describe(
            "List of the patient's current medications to check pairwise against"
          ),
      },
      async ({ medication_name, current_medications }) => {
        try {
          // 1. Resolve primary drug to RxCUI
          let primaryRxCUI: string | null = null;
          try {
            primaryRxCUI = await resolveRxCUI(medication_name);
          } catch (err: any) {
            return textResponse(
              JSON.stringify(
                { error: `Failed to resolve RxCUI for "${medication_name}": ${err.message}` },
                null,
                2
              )
            );
          }

          if (!primaryRxCUI) {
            return textResponse(
              JSON.stringify(
                {
                  error: `Could not find an RxCUI for "${medication_name}". Verify the spelling or try a generic name.`,
                },
                null,
                2
              )
            );
          }

          // 2. Fetch single-drug interactions from DrugBank via RxNorm
          let interactions: { drug: string; description: string; severity: string }[] = [];
          try {
            interactions = await getSingleDrugInteractions(primaryRxCUI);
          } catch (_err) {
            // Non-fatal — continue with empty list
          }

          // 3. Pairwise interactions against current medications (if provided)
          const pairwise_interactions: {
            drug1: string;
            drug2: string;
            description: string;
            severity: string;
          }[] = [];

          if (current_medications && current_medications.length > 0) {
            for (const med of current_medications) {
              let medRxCUI: string | null = null;
              try {
                medRxCUI = await resolveRxCUI(med);
              } catch (_err) {
                // Skip unresolvable medication
                continue;
              }

              if (!medRxCUI) continue;

              let pairs: { description: string; severity: string }[] = [];
              try {
                pairs = await getPairwiseInteractions(primaryRxCUI, medRxCUI);
              } catch (_err) {
                continue;
              }

              for (const pair of pairs) {
                pairwise_interactions.push({
                  drug1: medication_name,
                  drug2: med,
                  description: pair.description,
                  severity: pair.severity,
                });
              }
            }
          }

          const response: Record<string, unknown> = {
            medication: medication_name,
            rxcui: primaryRxCUI,
            interactions,
          };

          if (current_medications !== undefined) {
            response.pairwise_interactions = pairwise_interactions;
          }

          return textResponse(JSON.stringify(response, null, 2));
        } catch (err: any) {
          return textResponse(`Error: ${err.message}`);
        }
      }
    );
  }
}

export const checkDrugInteractions = new CheckDrugInteractionsTool();
