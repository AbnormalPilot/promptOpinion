import "dotenv/config";
import express from "express";
import cors from "cors";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import * as tools from "./tools/index";
import { IMcpTool } from "./tools/types";
import { getFhirContext, getPatientId } from "./sharp/context";

const PORT = parseInt(process.env.PORT || "3000", 10);

const app = express();
app.use(cors());

// Health check
app.get("/health", (_req, res) => {
  res.json({ status: "ok", server: "clinicalcontext-mcp", version: "1.0.0" });
});

// MCP endpoint — stateless, fresh server per request
app.all("/mcp", async (req, res) => {
  // Extract SHARP context from headers (if present)
  const fhirConfig = getFhirContext(req) || undefined;

  const server = new McpServer(
    { name: "clinicalcontext-mcp", version: "1.0.0" },
    { capabilities: { tools: {} } }
  );

  for (const tool of Object.values<IMcpTool>(tools)) {
    tool.registerTool(server, fhirConfig);
  }

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless
  });

  req.on("close", () => transport.close());
  await server.connect(transport);
  await transport.handleRequest(req, res);
});

app.listen(PORT, () => {
  console.log(`ClinicalContext MCP Server running on http://localhost:${PORT}`);
  console.log(`MCP endpoint: http://localhost:${PORT}/mcp`);
  console.log(`Health check: GET http://localhost:${PORT}/health`);
});
