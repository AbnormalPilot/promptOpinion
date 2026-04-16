/**
 * MCP Bridge — wraps each MCP tool as a Google ADK FunctionTool.
 * Reads FHIR credentials from ADK session state, injects as SHARP headers
 * when calling the MCP server.
 *
 * NOTE: toolContext.state is an ADK State object — must use .get(), not bracket indexing.
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

  let res: any;
  try {
    res = await axios.post(
      `${MCP_SERVER_URL}/mcp`,
      {
        jsonrpc: "2.0",
        id: Date.now(),
        method: "tools/call",
        params: { name: toolName, arguments: args },
      },
      { headers, timeout: 30000, responseType: "text" }
    );
  } catch (err: any) {
    if (err.code === "ECONNABORTED" || err.code === "ETIMEDOUT") {
      console.error(`[mcp-bridge] Timeout calling tool ${toolName}`);
      return { error: `Timeout calling MCP tool ${toolName}` };
    }
    console.error(`[mcp-bridge] Network error calling tool ${toolName}:`, err.message);
    return { error: `Network error calling MCP tool ${toolName}: ${err.message}` };
  }

  // Parse SSE or plain JSON response.
  // SSE format: one or more "data: <json>\n" lines; we want the last non-empty data line.
  const raw = String(res.data).trim();

  let jsonStr: string | null = null;

  // Try SSE: collect all "data: ..." lines and take the last one
  const sseLines = raw.split(/\r?\n/).filter((l) => l.startsWith("data: "));
  if (sseLines.length > 0) {
    jsonStr = sseLines[sseLines.length - 1].slice("data: ".length).trim();
  } else if (raw.startsWith("{") || raw.startsWith("[")) {
    // Plain JSON fallback
    jsonStr = raw;
  }

  if (!jsonStr) {
    console.error(`[mcp-bridge] No parseable response from MCP for tool ${toolName}:`, raw.slice(0, 200));
    return { error: "No response from MCP server" };
  }

  let parsed: any;
  try {
    parsed = JSON.parse(jsonStr);
  } catch (e) {
    console.error(`[mcp-bridge] Failed to parse MCP response JSON for tool ${toolName}:`, jsonStr.slice(0, 200));
    return { error: "Invalid JSON response from MCP server" };
  }

  const text = parsed?.result?.content?.[0]?.text;
  if (!text) return parsed?.result ?? parsed;

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
    parameters: z.object(schema) as any,
    execute: async (input: any, toolContext: any) => {
      // toolContext.state is an ADK State object — use .get() to read values
      const state: Record<string, any> = {};
      if (toolContext?.state) {
        for (const key of ["fhirUrl", "fhir_url", "fhirToken", "fhir_token", "patientId", "patient_id"]) {
          const val = toolContext.state.get(key);
          if (val !== undefined) state[key] = val;
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
