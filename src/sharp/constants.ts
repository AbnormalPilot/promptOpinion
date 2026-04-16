// SHARP-on-MCP header names (matches po-community-mcp spec)
export const SHARP_HEADERS = {
  fhirServerUrl: "x-fhir-server-url",
  fhirAccessToken: "x-fhir-access-token",
  patientId: "x-patient-id",
} as const;

// Prompt Opinion FHIR context extension key
export const FHIR_CONTEXT_EXTENSION = "ai.promptopinion/fhir-context";
