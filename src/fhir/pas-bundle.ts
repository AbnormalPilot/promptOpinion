/**
 * Da Vinci PAS (Prior Authorization Support) STU 2.1 Bundle emitter.
 * Spec: http://hl7.org/fhir/us/davinci-pas/STU2.1/
 *
 * Pure function — no network calls. Builds a FHIR R4 collection Bundle
 * containing a Claim (use=preauthorization) plus supporting resources.
 */

export interface PasPatient {
  id?: string;
  name?: string;
  birthDate?: string | null;
  gender?: string | null;
  identifier?: Array<{ system?: string; value?: string }>;
}

export interface PasCondition {
  code?: string | null;
  system?: string | null;
  display?: string;
  fhirId?: string;
  onsetDate?: string | null;
}

export interface PasObservation {
  code?: string;
  value?: string | null;
  date?: string | null;
  fhirId?: string;
}

export interface PasBundleInput {
  patient: PasPatient;
  activeConditions?: PasCondition[];
  observations?: PasObservation[];
  requested_medication_or_procedure: string;
  requesting_provider?: string;
  payer_name?: string;
  primary_icd10?: string;
  payer_member_id?: string;
  provider_npi?: string;
}

export interface PasBundleResult {
  bundle: any;
  warnings: string[];
  missing: string[];
}

const NOW = () => new Date().toISOString();
const ICD10 = "http://hl7.org/fhir/sid/icd-10-cm";
const RXNORM = "http://www.nlm.nih.gov/research/umls/rxnorm";

export function buildPasBundle(input: PasBundleInput): PasBundleResult {
  const warnings: string[] = [];
  const missing: string[] = [];

  if (!input.payer_member_id) missing.push("payer_member_id");
  if (!input.provider_npi) missing.push("provider_npi");
  if (!input.primary_icd10) warnings.push("No primary_icd10 supplied; Claim.diagnosis is best-effort from active conditions.");
  if (!input.requesting_provider) warnings.push("No requesting_provider supplied; Claim.provider uses placeholder display.");
  if (!input.payer_name) warnings.push("No payer_name supplied; Coverage.payor uses placeholder display.");

  const patientId = input.patient?.id || "unknown-patient";
  const patientUrn = `urn:uuid:patient-${patientId}`;
  const coverageUrn = `urn:uuid:coverage-${patientId}`;
  const providerUrn = `urn:uuid:provider-${patientId}`;
  const medRequestUrn = `urn:uuid:medreq-${patientId}`;
  const claimUrn = `urn:uuid:claim-${patientId}`;

  // Patient (year-only DOB per spec body — NOT a downstream LLM call, but we
  // still narrow precision in keeping with the rest of the codebase.)
  const birthYear = input.patient?.birthDate ? String(input.patient.birthDate).slice(0, 4) : undefined;
  const patientResource: any = {
    resourceType: "Patient",
    id: patientId,
    name: input.patient?.name ? [{ text: input.patient.name }] : undefined,
    birthDate: birthYear,
    gender: input.patient?.gender || undefined,
    identifier: input.patient?.identifier?.length ? input.patient.identifier : undefined,
  };

  // Coverage
  const coverageResource: any = {
    resourceType: "Coverage",
    id: `coverage-${patientId}`,
    status: "active",
    beneficiary: { reference: patientUrn },
    payor: [{ display: input.payer_name || "Unknown Payer" }],
    subscriberId: input.payer_member_id || undefined,
  };

  // Practitioner (requesting provider)
  const practitionerResource: any = {
    resourceType: "Practitioner",
    id: `provider-${patientId}`,
    name: [{ text: input.requesting_provider || "Unknown Provider" }],
    identifier: input.provider_npi
      ? [{ system: "http://hl7.org/fhir/sid/us-npi", value: input.provider_npi }]
      : undefined,
  };

  // MedicationRequest for the requested drug/procedure
  const medRequestResource: any = {
    resourceType: "MedicationRequest",
    id: `medreq-${patientId}`,
    status: "draft",
    intent: "proposal",
    medicationCodeableConcept: {
      text: input.requested_medication_or_procedure,
      coding: [{ system: RXNORM, display: input.requested_medication_or_procedure }],
    },
    subject: { reference: patientUrn },
    requester: { reference: providerUrn },
    authoredOn: NOW(),
  };

  // Conditions — relevant subset
  const conditions = (input.activeConditions || []).slice(0, 5);
  const conditionResources = conditions.map((c, i) => ({
    resourceType: "Condition",
    id: c.fhirId || `cond-${patientId}-${i}`,
    clinicalStatus: { coding: [{ system: "http://terminology.hl7.org/CodeSystem/condition-clinical", code: "active" }] },
    code: {
      text: c.display,
      coding: c.code ? [{ system: c.system || ICD10, code: c.code, display: c.display }] : undefined,
    },
    subject: { reference: patientUrn },
    onsetDateTime: c.onsetDate || undefined,
  }));

  // Observations — top 5 most recent
  const observations = (input.observations || [])
    .slice()
    .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")))
    .slice(0, 5);
  const observationResources = observations.map((o, i) => ({
    resourceType: "Observation",
    id: o.fhirId || `obs-${patientId}-${i}`,
    status: "final",
    code: { text: o.code },
    subject: { reference: patientUrn },
    effectiveDateTime: o.date || undefined,
    valueString: o.value || undefined,
  }));

  // Claim supportingInfo chain
  const supportingInfo = [
    ...conditionResources.map((c, i) => ({
      sequence: i + 1,
      category: { coding: [{ system: "http://terminology.hl7.org/CodeSystem/claiminformationcategory", code: "patientreasonforvisit" }] },
      valueReference: { reference: `urn:uuid:${c.id}` },
    })),
    ...observationResources.map((o, i) => ({
      sequence: conditionResources.length + i + 1,
      category: { coding: [{ system: "http://terminology.hl7.org/CodeSystem/claiminformationcategory", code: "info" }] },
      valueReference: { reference: `urn:uuid:${o.id}` },
    })),
  ];

  // Claim — required fields per FHIR R4 Claim
  const primaryDx = input.primary_icd10 || conditions[0]?.code || undefined;
  const claimResource: any = {
    resourceType: "Claim",
    id: `claim-${patientId}`,
    status: "active",
    type: { coding: [{ system: "http://terminology.hl7.org/CodeSystem/claim-type", code: "professional" }] },
    use: "preauthorization",
    patient: { reference: patientUrn },
    created: NOW(),
    provider: { reference: providerUrn },
    priority: { coding: [{ system: "http://terminology.hl7.org/CodeSystem/processpriority", code: "normal" }] },
    insurance: [{ sequence: 1, focal: true, coverage: { reference: coverageUrn } }],
    diagnosis: primaryDx
      ? [{ sequence: 1, diagnosisCodeableConcept: { coding: [{ system: ICD10, code: primaryDx }] } }]
      : undefined,
    item: [{
      sequence: 1,
      productOrService: {
        text: input.requested_medication_or_procedure,
        coding: [{ system: RXNORM, display: input.requested_medication_or_procedure }],
      },
      extension: [{
        url: "http://hl7.org/fhir/us/davinci-pas/StructureDefinition/extension-itemPreAuthIssueDate",
        valueDate: NOW().slice(0, 10),
      }],
    }],
    supportingInfo: supportingInfo.length ? supportingInfo : undefined,
  };

  const entry = [
    { fullUrl: claimUrn, resource: claimResource },
    { fullUrl: patientUrn, resource: patientResource },
    { fullUrl: providerUrn, resource: practitionerResource },
    { fullUrl: coverageUrn, resource: coverageResource },
    { fullUrl: medRequestUrn, resource: medRequestResource },
    ...conditionResources.map((r) => ({ fullUrl: `urn:uuid:${r.id}`, resource: r })),
    ...observationResources.map((r) => ({ fullUrl: `urn:uuid:${r.id}`, resource: r })),
  ];

  const bundle = {
    resourceType: "Bundle",
    type: "collection",
    timestamp: NOW(),
    entry,
  };

  return { bundle, warnings, missing };
}
