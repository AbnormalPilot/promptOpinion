import { z } from "zod";
import axios from "axios";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { IMcpTool, textResponse } from "./types";
import { FhirConfig } from "../fhir/client";

const RAG_SERVICE_URL = process.env.RAG_SERVICE_URL || "http://localhost:3001";

class LookupCoveragePolicyTool implements IMcpTool {
  registerTool(server: McpServer, _fhirConfig?: FhirConfig) {
    server.tool(
      "lookup_coverage_policy",
      "Retrieves relevant CMS National Coverage Determination (NCD) policy text for a medication or procedure. Uses semantic search over indexed CMS guidelines. Call this BEFORE drafting a PA letter to ground the clinical justification in actual policy citations.",
      {
        query: z.string().describe("Description of the medication or procedure to look up coverage policy for"),
        diagnosis: z.string().optional().describe("Primary diagnosis to include in the policy search context"),
        top_k: z.number().default(5).describe("Number of policy chunks to return"),
      },
      async ({ query, diagnosis, top_k }) => {
        const searchQuery = diagnosis ? `${query} for ${diagnosis}` : query;

        try {
          const res = await axios.post(
            `${RAG_SERVICE_URL}/query`,
            { query: searchQuery, topK: top_k },
            { timeout: 10000 }
          );

          const results = res.data.results || [];

          if (results.length === 0) {
            return textResponse(JSON.stringify({
              message: "No matching CMS NCD policies found for this query",
              query: searchQuery,
              recommendation: "Proceed with clinical justification based on patient data and standard medical guidelines.",
            }, null, 2));
          }

          return textResponse(JSON.stringify({
            query: searchQuery,
            policies_found: results.length,
            results: results.map((r: any) => ({
              ncd_id: r.ncdId,
              title: r.title,
              section: r.section,
              policy_text: r.text,
              relevance_score: r.relevance_score,
            })),
          }, null, 2));
        } catch (err: any) {
          if (err.code === "ECONNREFUSED") {
            return textResponse(JSON.stringify({
              error: "RAG service unavailable — coverage policy lookup requires the rag-service to be running",
              fallback: "Proceed with clinical justification based on patient data only",
            }, null, 2));
          }
          return textResponse(`Error querying coverage policy: ${err.message}`);
        }
      }
    );
  }
}

export const lookupCoveragePolicy = new LookupCoveragePolicyTool();
