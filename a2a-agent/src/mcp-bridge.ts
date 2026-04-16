/**
 * MCP Bridge — wraps each MCP tool as a Google ADK FunctionTool.
 * Reads FHIR credentials from ADK session state, injects as SHARP headers
 * when calling the MCP server.
 */
import { FunctionTool } from "@google/adk";
import axios from "axios";
import { z } from "zod";

const MCP_SERVER_URL = process.env.MCP_SERVER_URL || "http://localhost:3000";

/** Call an MCP tool via HTTP, injecting SHARP headers from session state */
async function callMcpTool(
  toolName: string,
  args: Record<string, any>,
  state: Record<string, any>
): Promise<any> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
  };

  // Inject SHARP headers if available
  if (state["fhirUrl"]) headers["x-fhir-server-url"] = state["fhirUrl"];
  if (state["fhirToken"]) headers["x-fhir-access-token"] = state["fhirToken"];
  if (state["patientId"]) headers["x-patient-id"] = state["patientId"];

  const res = await axios.post(
    `${MCP_SERVER_URL}/mcp`,
    {
      jsonrpc: "2.0",
      id: Date.now(),
      method: "tools/call",
      params: { name: toolName, arguments: args },
    },
    { headers, timeout: 30000, responseType: "text" }
  );

  // Parse SSE response
  const data = String(res.data);
  const match = data.match(/data: (.+)/);
  if (!match) return { error: "No response from MCP server" };

  const parsed = JSON.parse(match[1]);
  const text = parsed?.result?.content?.[0]?.text;
  if (!text) return parsed?.result || parsed;

  try {
    return JSON.parse(text);
  } catch {
    return { text };
  }
}

function makeTool(
  name: string,
  description: string,
  schema: Record<string, any>
): FunctionTool {
  return new FunctionTool({
    name,
    description,
    parameters: z.object(schema),
    execute: async (input: any, toolContext: any) => {
      const state = {};
      // Extract state from toolContext if available
      if (toolContext?.state) {
        for (const [k, v] of Object.entries(toolContext.state)) {
          (state as any)[k] = v;
        }
      }
      return await callMcpTool(name, input, state);
    },
  });
}

/** All 11 MCP tools as ADK FunctionTools */
export const mcpTools = [
  makeTool("fetch_patient_context", "Load patient demographics, conditions, allergies, procedures from FHIR. Call this FIRST.", {
    patient_id: z.string().optional().describe("FHIR Patient resource ID"),
  }),
  makeTool("fetch_medication_list", "Get patient medication history for step therapy documentation.", {
    patient_id: z.string().optional().describe("FHIR Patient resource ID"),
    status: z.enum(["active", "completed", "all"]).default("active"),
  }),
  makeTool("fetch_clinical_history", "Get recent encounters, labs, and vitals.", {
    patient_id: z.string().optional().describe("FHIR Patient resource ID"),
    lookback_days: z.number().default(180),
  }),
  makeTool("extract_clinical_evidence", "Read unstructured clinical notes and extract PA-supporting evidence.", {
    patient_id: z.string().optional(),
    requested_medication_or_procedure: z.string(),
    lookback_days: z.number().default(365),
  }),
  makeTool("process_clinical_document", "OCR scanned clinical documents from FHIR DocumentReference.", {
    document_id: z.string().optional(),
    patient_id: z.string().optional(),
  }),
  makeTool("lookup_coverage_policy", "Search CMS NCD policies for relevant coverage criteria.", {
    query: z.string().describe("Medication or procedure to look up"),
    diagnosis: z.string().optional(),
    top_k: z.number().default(5),
  }),
  makeTool("check_coverage_requirements", "Analyze step therapy, formulary rules, and coverage criteria.", {
    patient_id: z.string().optional(),
    requested_medication_or_procedure: z.string(),
    payer_name: z.string().optional(),
  }),
  makeTool("check_drug_interactions", "Check drug-drug interactions via RxNorm database.", {
    medication_name: z.string(),
    current_medications: z.array(z.string()).optional(),
  }),
  makeTool("analyze_prior_auth_need", "AI analysis of clinical justification for prior auth.", {
    patient_id: z.string().optional(),
    requested_medication_or_procedure: z.string(),
    requesting_provider: z.string().optional(),
  }),
  makeTool("draft_prior_auth_request", "Generate complete PA letter with NCD citations.", {
    patient_id: z.string().optional(),
    requested_medication_or_procedure: z.string(),
    requesting_provider: z.string().optional(),
    payer_name: z.string().optional(),
  }),
  makeTool("generate_appeal_letter", "Generate PA appeal letter for denied requests.", {
    patient_id: z.string().optional(),
    requested_medication_or_procedure: z.string(),
    denial_reason: z.string(),
    requesting_provider: z.string().optional(),
    payer_name: z.string().optional(),
    original_pa_date: z.string().optional(),
  }),
];
