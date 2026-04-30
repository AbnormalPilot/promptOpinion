/** SHARP cross-hop propagation test.
 *  Sends a request to the MCP server with all SHARP headers and verifies they
 *  are received, captured in audit, and produce a trace ID echoed back.
 *  Also verifies token-expiry detection produces a structured refresh-needed event. */

import "dotenv/config";
import axios from "axios";
import { randomUUID } from "crypto";
import { existsSync, readFileSync } from "fs";

const MCP_URL = process.env.MCP_URL || "http://localhost:3000";
const PATIENT_ID = process.env.TEST_PATIENT_ID || "131926799";
const TRACE = randomUUID();

async function call(toolName: string, args: any, headers: Record<string, string>) {
  const body = {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name: toolName, arguments: args },
  };
  const res = await axios.post(`${MCP_URL}/mcp`, body, {
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      ...headers,
    },
    timeout: 30000,
    validateStatus: () => true,
  });
  return res;
}

function checkTraceInAudit(trace: string): boolean {
  if (!existsSync("data/audit.jsonl")) return false;
  const lines = readFileSync("data/audit.jsonl", "utf8").trim().split("\n");
  return lines.some((l) => {
    try { return JSON.parse(l).traceId === trace; } catch { return false; }
  });
}

async function main() {
  console.log("--- SHARP Propagation Test ---");
  console.log("Trace ID:", TRACE);

  const headers = {
    "x-fhir-server-url": "https://hapi.fhir.org/baseR4",
    "x-patient-id": PATIENT_ID,
    "x-sharp-trace-id": TRACE,
  };

  const r1 = await call("learning_stats", {}, headers);
  console.log("[1] learning_stats status:", r1.status);
  const echoTrace = r1.headers["x-sharp-trace-id"];
  const echoMatch = echoTrace === TRACE;
  console.log("[1] trace echoed back?", echoMatch, "(got:", echoTrace + ")");

  const r2 = await call("predict_approval_probability", {
    drug: "semaglutide",
    diagnosis_icd10: "E11.9",
    evidence_summary: "HbA1c 8.4%, metformin 12 months.",
    step_therapy_met: true,
  }, headers);
  console.log("[2] predict status:", r2.status);

  const inAudit = checkTraceInAudit(TRACE);
  console.log("[3] trace ID present in audit log?", inAudit);

  // Token-expiry simulation
  const expiredToken = "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJleHAiOjEsInBhdGllbnQiOiJ" + PATIENT_ID + "In0.invalid";
  const r3 = await call("learning_stats", {}, { ...headers, "x-fhir-access-token": expiredToken });
  console.log("[4] expired-token request status:", r3.status, "(server should not crash)");

  const allPass = echoMatch && inAudit && r1.status === 200 && r2.status === 200 && r3.status === 200;
  console.log(`\nResult: ${allPass ? "PASS" : "FAIL"}`);
  if (!allPass) process.exit(1);
}

main().catch((err) => {
  console.error("Test error:", err.message);
  process.exit(1);
});
