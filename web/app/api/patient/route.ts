import axios from "axios";

const FHIR_BASE = process.env.FHIR_BASE_URL || "https://hapi.fhir.org/baseR4";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const patientId = searchParams.get("id");

  if (!patientId) {
    return Response.json({ error: "Missing patient id" }, { status: 400 });
  }

  try {
    const fhir = axios.create({
      baseURL: FHIR_BASE,
      headers: { Accept: "application/fhir+json" },
      timeout: 15000,
    });

    const [patientRes, conditionsRes, medsRes, encountersRes, obsRes] =
      await Promise.all([
        fhir.get(`Patient/${patientId}`).catch(() => null),
        fhir
          .get("Condition", {
            params: { patient: patientId, "clinical-status": "active" },
          })
          .catch(() => null),
        fhir
          .get("MedicationRequest", {
            params: { patient: patientId, status: "active" },
          })
          .catch(() => null),
        fhir
          .get("Encounter", {
            params: { patient: patientId, _sort: "-date", _count: "5" },
          })
          .catch(() => null),
        fhir
          .get("Observation", {
            params: { patient: patientId, _sort: "-date", _count: "15" },
          })
          .catch(() => null),
      ]);

    if (!patientRes?.data) {
      return Response.json({ error: "Patient not found" }, { status: 404 });
    }

    const p = patientRes.data;
    const name = p.name?.[0];

    const patient = {
      id: p.id,
      name: `${name?.given?.join(" ") || ""} ${name?.family || ""}`.trim(),
      birthDate: p.birthDate,
      gender: p.gender,
      address: p.address?.[0]
        ? [
            p.address[0].line?.join(", "),
            p.address[0].city,
            p.address[0].state,
            p.address[0].postalCode,
          ]
            .filter(Boolean)
            .join(", ")
        : null,
    };

    const conditions = (conditionsRes?.data?.entry || []).map((e: any) => ({
      display:
        e.resource.code?.coding?.[0]?.display ||
        e.resource.code?.text ||
        "Unknown",
      code: e.resource.code?.coding?.[0]?.code || null,
      onsetDate: e.resource.onsetDateTime || null,
    }));

    const medications = (medsRes?.data?.entry || []).map((e: any) => ({
      medication:
        e.resource.medicationCodeableConcept?.coding?.[0]?.display ||
        e.resource.medicationCodeableConcept?.text ||
        "Unknown",
      code: e.resource.medicationCodeableConcept?.coding?.[0]?.code || null,
      status: e.resource.status,
      authoredOn: e.resource.authoredOn || null,
      dosage: e.resource.dosageInstruction?.[0]?.text || null,
    }));

    const encounters = (encountersRes?.data?.entry || []).map((e: any) => ({
      type:
        e.resource.type?.[0]?.coding?.[0]?.display ||
        e.resource.type?.[0]?.text ||
        "Unknown",
      date: e.resource.period?.start || null,
      reason:
        e.resource.reasonCode?.[0]?.coding?.[0]?.display ||
        e.resource.reasonCode?.[0]?.text ||
        null,
    }));

    const observations = (obsRes?.data?.entry || []).map((e: any) => {
      const o = e.resource;
      let value = null;
      if (o.valueQuantity)
        value = `${o.valueQuantity.value} ${o.valueQuantity.unit || ""}`.trim();
      else if (o.valueString) value = o.valueString;
      else if (o.valueCodeableConcept)
        value = o.valueCodeableConcept.coding?.[0]?.display;

      return {
        code: o.code?.coding?.[0]?.display || o.code?.text || "Unknown",
        value,
        date: o.effectiveDateTime || null,
        category: o.category?.[0]?.coding?.[0]?.code || null,
      };
    });

    return Response.json({
      patient,
      conditions,
      medications,
      encounters,
      observations,
    });
  } catch (err: any) {
    return Response.json(
      { error: err.message || "Failed to fetch patient data" },
      { status: 500 }
    );
  }
}
