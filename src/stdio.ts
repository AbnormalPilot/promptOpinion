import "dotenv/config";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as tools from "./tools/index";
import { IMcpTool } from "./tools/types";

const server = new McpServer(
  { name: "clinicalcontext-mcp", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

// Register all tools (no FHIR config = uses default HAPI server)
for (const tool of Object.values<IMcpTool>(tools)) {
  tool.registerTool(server);
}

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("ClinicalContext MCP Server running on stdio");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
