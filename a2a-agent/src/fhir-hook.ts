/**
 * beforeModelCallback — extracts FHIR context from A2A message metadata
 * and writes it to ADK session state so tools can access it.
 *
 * FHIR credentials NEVER appear in the LLM prompt.
 *
 * ADK calls beforeModelCallback with { context: CallbackContext, request: LlmRequest }.
 * context.state is an ADK State object — must use .get()/.set(), not bracket indexing.
 */
export function extractFhirContext(params: { context: any; request: any }): undefined {
  const { context } = params;
  const meta = context.state?.get?.("a2aMetadata") as Record<string, string> | undefined;
  if (!meta) return undefined;

  // Support multiple key conventions (camelCase, snake_case, header-style)
  const url = meta["fhirUrl"] ?? meta["fhir_url"] ?? meta["x-fhir-server-url"];
  const token = meta["fhirToken"] ?? meta["fhir_token"] ?? meta["x-fhir-access-token"];
  const patientId = meta["patientId"] ?? meta["patient_id"] ?? meta["x-patient-id"];

  if (url) {
    context.state.set("fhirUrl", url);
    context.state.set("fhir_url", url);
  }
  if (token) {
    context.state.set("fhirToken", token);
    context.state.set("fhir_token", token);
  }
  if (patientId) {
    context.state.set("patientId", patientId);
    context.state.set("patient_id", patientId);
  }

  return undefined;
}
