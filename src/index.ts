import "dotenv/config";
import express from "express";
import cors from "cors";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import * as tools from "./tools/index";
import { IMcpTool } from "./tools/types";
import { getFhirContext, getPatientId } from "./sharp/context";
import { FHIR_CONTEXT_EXTENSION } from "./sharp/constants";
import { auditMiddleware, writeAudit } from "./audit/middleware";
import { memorySize } from "./memory/store";
import { brierScore } from "./learning/calibration";

const PORT = parseInt(process.env.PORT || "3000", 10);

const app = express();
app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(auditMiddleware);

// Health check
app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    server: "clinicalcontext-mcp",
    version: "2.0.0",
    learning: {
      memory_size: memorySize(),
      calibration_brier: brierScore(),
    },
  });
});

// MCP endpoint — stateless, fresh server per request
app.post("/mcp", async (req, res) => {
  try {
    const ctx = getFhirContext(req);
    const sharpPatientId = getPatientId(req);
    const fhirConfig = ctx
      ? { ...ctx, patientId: sharpPatientId || undefined }
      : sharpPatientId
        ? { patientId: sharpPatientId }
        : undefined;

    const server = new McpServer(
      { name: "clinicalcontext-mcp", version: "1.0.0" },
      {
        capabilities: {
          tools: {},
          experimental: {
            [FHIR_CONTEXT_EXTENSION]: {
              scopes: [
                { name: "patient/Patient.rs", required: true },
                { name: "patient/Condition.rs" },
                { name: "patient/MedicationRequest.rs" },
                { name: "patient/Observation.rs" },
                { name: "patient/Encounter.rs" },
                { name: "patient/AllergyIntolerance.rs" },
                { name: "patient/Procedure.rs" },
                { name: "patient/DiagnosticReport.rs" },
                { name: "patient/DocumentReference.rs" },
              ],
            },
          },
        },
      }
    );

    for (const tool of Object.values<IMcpTool>(tools)) {
      tool.registerTool(server, fhirConfig);
    }

    writeAudit({ type: "mcp_session_open", traceId: req.traceId, patientHash: req.patientHash, tools: Object.keys(tools).length });

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });

    res.on("close", () => {
      transport.close();
      server.close();
    });

    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error("MCP request error:", err);
    if (!res.headersSent) {
      res.status(500).json({ error: "Internal server error" });
    }
  }
});

// GET /mcp — SSE stream (not needed in stateless mode)
app.get("/mcp", (_req, res) => {
  res.status(405).json({ error: "Method not allowed in stateless mode" });
});

// DELETE /mcp — session close (not needed in stateless mode)
app.delete("/mcp", (_req, res) => {
  res.status(405).json({ error: "Method not allowed in stateless mode" });
});

app.listen(PORT, () => {
  console.log(`ClinicalContext MCP Server running on http://localhost:${PORT}`);
  console.log(`MCP endpoint: POST http://localhost:${PORT}/mcp`);
  console.log(`Health check: GET http://localhost:${PORT}/health`);
});
