import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { FhirConfig } from "../fhir/client";

/** Tool registration — no Express dependency */
export interface IMcpTool {
  registerTool(server: McpServer, fhirConfig?: FhirConfig): void;
}

/** Standard text response helper */
export function textResponse(text: string) {
  return { content: [{ type: "text" as const, text }] };
}
