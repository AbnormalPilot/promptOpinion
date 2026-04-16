import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { IMcpTool, textResponse } from "./types";
import { FhirClient, FhirConfig } from "../fhir/client";
import { callLLM, safeParseJSON } from "../llm/client";
import { DRAFT_PRIOR_AUTH_SYSTEM } from "../llm/prompts";

class DraftPriorAuthRequestTool implements IMcpTool {
  registerTool(server: McpServer, fhirConfig?: FhirConfig) {
    server.tool(
      "draft_prior_auth_request",
      "Generates a complete, submission-ready prior authorization letter with ICD-10 codes, step therapy documentation, and clinical evidence citations. Uses a single optimized LLM call for speed. Call this as the final step after analysis.",
      {
        patient_id: z.string().optional().describe("FHIR Patient resource ID (auto-resolved from SHARP context if omitted)"),
        requested_medication_or_procedure: z.string().describe("The medication or procedure requiring prior auth"),
        requesting_provider: z.string().optional().describe("Name of requesting provider"),
        payer_name: z.string().optional().describe("Insurance payer name"),
        policy_context: z.string().optional().describe("CMS NCD policy text from lookup_coverage_policy (optional)"),
        clinical_analysis: z.string().optional().describe("Output from analyze_prior_auth_need (optional, avoids redundant analysis)"),
      },
      async ({ patient_id, requested_medication_or_procedure, requesting_provider, payer_name, policy_context, clinical_analysis }) => {
        const pid = patient_id || fhirConfig?.patientId;
        if (!pid) return textResponse("Error: No patient_id provided via argument or SHARP context");
        const fhir = new FhirClient(fhirConfig);

        // Fetch comprehensive patient data (parallel)
        const [patient, conditions, medications, allergies, encounters, observations] = await Promise.all([
          fhir.read(`Patient/${pid}`),
          fhir.search("Condition", { patient: pid, "clinical-status": "active" }),
          fhir.search("MedicationRequest", { patient: pid }), // ALL meds for step therapy
          fhir.search("AllergyIntolerance", { patient: pid }),
          fhir.search("Encounter", { patient: pid, _sort: "-date", _count: "5" }),
          fhir.search("Observation", { patient: pid, _sort: "-date", _count: "15" }),
        ]);

        if (!patient) return textResponse(`Patient ${pid} not found`);

        const patientData = {
          patient: {
            id: patient.id,
            name: formatName(patient.name),
            birthDate: patient.birthDate,
            gender: patient.gender,
            age: calculateAge(patient.birthDate),
            address: formatAddress(patient.address),
            identifier: patient.identifier?.map((i: any) => ({ system: i.system, value: i.value })),
          },
          activeConditions: conditions.map((c: any) => ({
            code: c.code?.coding?.[0]?.code,
            system: c.code?.coding?.[0]?.system,
            display: c.code?.coding?.[0]?.display || c.code?.text,
            onsetDate: c.onsetDateTime,
          })),
          medicationHistory: medications.map((m: any) => ({
            medication: m.medicationCodeableConcept?.coding?.[0]?.display || m.medicationCodeableConcept?.text || "Unknown",
            code: m.medicationCodeableConcept?.coding?.[0]?.code,
            status: m.status,
            authoredOn: m.authoredOn,
          })),
          allergies: allergies.map((a: any) => ({
            substance: a.code?.coding?.[0]?.display || a.code?.text || "Unknown",
            criticality: a.criticality,
          })),
          recentEncounters: encounters.map((e: any) => ({
            type: e.type?.[0]?.coding?.[0]?.display || e.type?.[0]?.text,
            date: e.period?.start,
            reason: e.reasonCode?.[0]?.coding?.[0]?.display || e.reasonCode?.[0]?.text,
          })),
          observations: observations.map((o: any) => ({
            code: o.code?.coding?.[0]?.display || o.code?.text,
            value: o.valueQuantity ? `${o.valueQuantity.value} ${o.valueQuantity.unit || ""}` : o.valueString || null,
            date: o.effectiveDateTime,
          })),
        };

        // Single LLM call — no separate analysis step
        let userMessage = `Draft a prior authorization request letter:
- Requested: ${requested_medication_or_procedure}
- Provider: ${requesting_provider || "Not specified"}
- Payer: ${payer_name || "Insurance Company"}
- Patient data: ${JSON.stringify(patientData, null, 2)}`;

        if (clinical_analysis) {
          userMessage += `\n\n--- PRIOR CLINICAL ANALYSIS ---\n${clinical_analysis}\n--- END ANALYSIS ---\nIncorporate this analysis into the letter.`;
        }

        if (policy_context) {
          userMessage += `\n\n--- RELEVANT CMS COVERAGE POLICY ---\n${policy_context}\n--- END POLICY ---\nCite specific NCD section numbers in the letter.`;
        }

        try {
          const draftRaw = await callLLM(DRAFT_PRIOR_AUTH_SYSTEM, userMessage);
          const draft = safeParseJSON(draftRaw, { error: "Failed to generate letter", raw: draftRaw });
          return textResponse(JSON.stringify(draft, null, 2));
        } catch (err: any) {
          return textResponse(`LLM Error: ${err.message}`);
        }
      }
    );
  }
}

function formatName(names: any[]): string {
  if (!names?.length) return "Unknown";
  const n = names[0];
  return `${n.given?.join(" ") || ""} ${n.family || ""}`.trim();
}

function formatAddress(addresses: any[]): string | null {
  if (!addresses?.length) return null;
  const a = addresses[0];
  return [a.line?.join(", "), a.city, a.state, a.postalCode].filter(Boolean).join(", ");
}

function calculateAge(birthDate: string | undefined): number | null {
  if (!birthDate) return null;
  const birth = new Date(birthDate);
  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  if (now.getMonth() < birth.getMonth() || (now.getMonth() === birth.getMonth() && now.getDate() < birth.getDate())) age--;
  return age;
}

export const draftPriorAuthRequest = new DraftPriorAuthRequestTool();
