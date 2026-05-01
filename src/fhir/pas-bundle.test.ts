/**
 * tsx-runnable test for buildPasBundle.
 * Run: npx tsx src/fhir/pas-bundle.test.ts
 */
import assert from "node:assert/strict";
import { buildPasBundle } from "./pas-bundle";

const { bundle, warnings, missing } = buildPasBundle({
  patient: {
    id: "131926799",
    name: "Robert Barker",
    birthDate: "1960-04-12",
    gender: "male",
  },
  activeConditions: [
    { code: "E11.9", system: "http://hl7.org/fhir/sid/icd-10-cm", display: "Type 2 diabetes mellitus", fhirId: "cond-1" },
    { code: "I10", system: "http://hl7.org/fhir/sid/icd-10-cm", display: "Essential hypertension", fhirId: "cond-2" },
  ],
  observations: [
    { code: "HbA1c", value: "8.2 %", date: "2026-04-01", fhirId: "obs-1" },
    { code: "BP systolic", value: "145 mmHg", date: "2026-03-15", fhirId: "obs-2" },
    { code: "eGFR", value: "62 mL/min", date: "2026-02-01", fhirId: "obs-3" },
  ],
  requested_medication_or_procedure: "Ozempic 1mg",
  requesting_provider: "Dr. Jane Smith",
  payer_name: "Aetna",
  primary_icd10: "E11.9",
});

// Bundle shape
assert.equal(bundle.resourceType, "Bundle");
assert.equal(bundle.type, "collection");
assert.ok(Array.isArray(bundle.entry) && bundle.entry.length > 0);

// Exactly one Claim with use=preauthorization
const claims = bundle.entry.filter((e: any) => e.resource.resourceType === "Claim");
assert.equal(claims.length, 1, "exactly one Claim");
assert.equal(claims[0].resource.use, "preauthorization");
assert.equal(claims[0].resource.status, "active");
assert.ok(claims[0].resource.item?.[0]?.productOrService);
assert.ok(claims[0].resource.insurance?.[0]?.coverage);
assert.ok(claims[0].resource.provider);
assert.ok(claims[0].resource.priority);

// Includes MedicationRequest
const meds = bundle.entry.filter((e: any) => e.resource.resourceType === "MedicationRequest");
assert.equal(meds.length, 1, "one MedicationRequest");
assert.equal(meds[0].resource.intent, "proposal");
assert.equal(meds[0].resource.status, "draft");

// Non-empty supportingInfo chain
assert.ok(Array.isArray(claims[0].resource.supportingInfo));
assert.ok(claims[0].resource.supportingInfo.length > 0, "non-empty supportingInfo");

// Missing required-fields surface
assert.ok(missing.includes("payer_member_id"), "missing payer_member_id");
assert.ok(missing.includes("provider_npi"), "missing provider_npi");

// Warnings array exists
assert.ok(Array.isArray(warnings));

console.log("PAS bundle test PASSED");
console.log("Resources emitted:", bundle.entry.map((e: any) => e.resource.resourceType).join(", "));
console.log("Missing:", missing);
console.log("Warnings:", warnings.length);
