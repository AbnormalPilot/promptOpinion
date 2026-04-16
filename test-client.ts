/**
 * Test client for ClinicalContext MCP Server (stdio transport).
 * Spawns the server as a child process and tests all tools.
 *
 * Usage: npx tsx test-client.ts [patient_id]
 */
import "dotenv/config";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const TEST_PATIENT_ID = process.argv[2] || "592912";

async function main() {
  console.log("Spawning MCP server via stdio...");

  const transport = new StdioClientTransport({
    command: "npx",
    args: ["tsx", "src/stdio.ts"],
    env: { ...process.env },
  });

  const client = new Client({ name: "test-client", version: "1.0.0" });
  await client.connect(transport);
  console.log("Connected!\n");

  // List tools
  console.log("=== Available Tools ===");
  const { tools } = await client.listTools();
  for (const tool of tools) {
    console.log(`  - ${tool.name}: ${tool.description}`);
  }
  console.log();

  // Test 1: fetch_patient_context
  console.log("=== Test 1: fetch_patient_context ===");
  try {
    const result = await client.callTool({
      name: "fetch_patient_context",
      arguments: { patient_id: TEST_PATIENT_ID },
    });
    console.log(truncate(result.content));
  } catch (e: any) {
    console.log("Error:", e.message);
  }
  console.log();

  // Test 2: fetch_medication_list
  console.log("=== Test 2: fetch_medication_list ===");
  try {
    const result = await client.callTool({
      name: "fetch_medication_list",
      arguments: { patient_id: TEST_PATIENT_ID, status: "active" },
    });
    console.log(truncate(result.content));
  } catch (e: any) {
    console.log("Error:", e.message);
  }
  console.log();

  // Test 3: fetch_clinical_history
  console.log("=== Test 3: fetch_clinical_history ===");
  try {
    const result = await client.callTool({
      name: "fetch_clinical_history",
      arguments: { patient_id: TEST_PATIENT_ID, lookback_days: 365 },
    });
    console.log(truncate(result.content));
  } catch (e: any) {
    console.log("Error:", e.message);
  }
  console.log();

  // Test 4 & 5: LLM tools (need GROQ_API_KEY)
  if (process.env.GROQ_API_KEY) {
    console.log("=== Test 4: analyze_prior_auth_need ===");
    try {
      const result = await client.callTool({
        name: "analyze_prior_auth_need",
        arguments: {
          patient_id: TEST_PATIENT_ID,
          requested_medication_or_procedure: "Adalimumab (Humira) 40mg subcutaneous injection",
          requesting_provider: "Dr. Smith",
        },
      });
      console.log(truncate(result.content));
    } catch (e: any) {
      console.log("Error:", e.message);
    }
    console.log();

    console.log("=== Test 5: draft_prior_auth_request ===");
    try {
      const result = await client.callTool({
        name: "draft_prior_auth_request",
        arguments: {
          patient_id: TEST_PATIENT_ID,
          requested_medication_or_procedure: "Adalimumab (Humira) 40mg subcutaneous injection",
          requesting_provider: "Dr. Smith",
          payer_name: "Blue Cross Blue Shield",
        },
      });
      console.log(truncate(result.content));
    } catch (e: any) {
      console.log("Error:", e.message);
    }
  } else {
    console.log("=== Skipping LLM tools (no GROQ_API_KEY) ===");
    console.log("Set GROQ_API_KEY in .env to test tools 4 & 5");
  }

  console.log("\nAll tests done!");
  await client.close();
  process.exit(0);
}

function truncate(content: any): string {
  const text = typeof content === "string" ? content : JSON.stringify(content, null, 2);
  if (text.length > 2000) return text.slice(0, 2000) + "\n... (truncated)";
  return text;
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
