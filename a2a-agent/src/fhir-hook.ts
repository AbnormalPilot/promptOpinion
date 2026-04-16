/**
 * beforeModelCallback — extracts FHIR context from A2A message metadata
 * and writes it to ADK session state so tools can access it.
 *
 * FHIR credentials NEVER appear in the LLM prompt.
 */
export function extractFhirContext(ctx: any): undefined {
  const meta = ctx.state?.["a2aMetadata"] as Record<string, string> | undefined;
  if (!meta) return undefined;

  // Support multiple key conventions (camelCase, snake_case, header-style)
  const url = meta["fhirUrl"] ?? meta["fhir_url"] ?? meta["x-fhir-server-url"];
  const token = meta["fhirToken"] ?? meta["fhir_token"] ?? meta["x-fhir-access-token"];
  const patientId = meta["patientId"] ?? meta["patient_id"] ?? meta["x-patient-id"];

  if (url) {
    ctx.state["fhirUrl"] = url;
    ctx.state["fhir_url"] = url;
  }
  if (token) {
    ctx.state["fhirToken"] = token;
    ctx.state["fhir_token"] = token;
  }
  if (patientId) {
    ctx.state["patientId"] = patientId;
    ctx.state["patient_id"] = patientId;
  }

  return undefined;
}
