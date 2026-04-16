"use client";

import { useState } from "react";

interface PatientData {
  patient: {
    id: string;
    name: string;
    birthDate: string;
    gender: string;
    address: string | null;
  };
  conditions: { display: string; code: string | null; onsetDate: string | null }[];
  medications: { medication: string; code: string | null; status: string; authoredOn: string | null; dosage: string | null }[];
  encounters: { type: string; date: string | null; reason: string | null }[];
  observations: { code: string; value: string | null; date: string | null; category: string | null }[];
}

interface Analysis {
  clinical_rationale: string;
  primary_diagnosis_code: string;
  primary_diagnosis_display: string;
  supporting_diagnosis_codes: string[];
  evidence_points: string[];
  prior_treatments_tried: string[];
  confidence: number;
  missing_information: string[];
}

interface Draft {
  letter: string;
  summary: string;
  icd10_codes: string[];
  cpt_codes: string[];
  confidence: number;
}

export default function Home() {
  const [patientId, setPatientId] = useState("98067569");
  const [patientData, setPatientData] = useState<PatientData | null>(null);
  const [medication, setMedication] = useState("Adalimumab (Humira) 40mg subcutaneous injection");
  const [provider, setProvider] = useState("Dr. Smith");
  const [payer, setPayer] = useState("Blue Cross Blue Shield");
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [loading, setLoading] = useState("");
  const [error, setError] = useState("");

  async function fetchPatient() {
    setLoading("patient");
    setError("");
    setPatientData(null);
    setAnalysis(null);
    setDraft(null);
    try {
      const res = await fetch(`/api/patient?id=${patientId}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setPatientData(data);
    } catch (err: any) {
      setError(err.message);
    }
    setLoading("");
  }

  async function runAnalysis() {
    if (!patientData) return;
    setLoading("analyze");
    setError("");
    setAnalysis(null);
    try {
      const res = await fetch("/api/prior-auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ patientData, medication, provider, action: "analyze" }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setAnalysis(data);
    } catch (err: any) {
      setError(err.message);
    }
    setLoading("");
  }

  async function generateDraft() {
    if (!patientData) return;
    setLoading("draft");
    setError("");
    setDraft(null);
    try {
      const res = await fetch("/api/prior-auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ patientData, medication, provider, payer, action: "draft" }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      if (data.analysis) setAnalysis(data.analysis);
      setDraft(data.draft);
    } catch (err: any) {
      setError(err.message);
    }
    setLoading("");
  }

  return (
    <div className="flex flex-col min-h-screen">
      {/* Header */}
      <header className="border-b border-wise-light px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-wise-green rounded-full" />
          <span className="text-lg font-semibold tracking-tight">ClinicalContext</span>
        </div>
        <span className="text-sm text-wise-gray font-medium">Prior Auth Automation</span>
      </header>

      <main className="flex-1 max-w-6xl mx-auto w-full px-6 py-10">
        {/* Hero */}
        <section className="mb-12">
          <h1 className="wise-display text-5xl md:text-7xl mb-4">
            Prior Auth<br />in 90 seconds.
          </h1>
          <p className="text-lg text-wise-dark max-w-xl font-medium">
            Fetch patient data from FHIR, analyze clinical necessity with AI,
            and generate a complete prior authorization draft — ready for physician review.
          </p>
        </section>

        {/* Step 1: Patient Lookup */}
        <section className="mb-10">
          <h2 className="text-sm font-semibold text-wise-gray uppercase tracking-wider mb-4">
            Step 1 — Patient Lookup
          </h2>
          <div className="flex gap-3 items-center">
            <input
              type="text"
              value={patientId}
              onChange={(e) => setPatientId(e.target.value)}
              placeholder="Enter FHIR Patient ID"
              className="px-4 py-2.5 border border-wise-light rounded-[10px] text-base font-medium w-64 focus:outline-none focus:ring-2 focus:ring-wise-green"
            />
            <button
              onClick={fetchPatient}
              disabled={!!loading || !patientId}
              className="wise-btn bg-wise-green text-wise-dark-green font-semibold px-6 py-2.5 rounded-full disabled:opacity-50"
            >
              {loading === "patient" ? "Fetching..." : "Fetch Patient"}
            </button>
          </div>
        </section>

        {/* Error */}
        {error && (
          <div className="mb-6 px-4 py-3 bg-red-50 border border-wise-danger/20 rounded-2xl text-wise-danger text-sm font-medium">
            {error}
          </div>
        )}

        {/* Patient Data Cards */}
        {patientData && (
          <section className="mb-10 grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Demographics */}
            <div className="wise-card rounded-[30px] p-6">
              <h3 className="text-sm font-semibold text-wise-gray uppercase tracking-wider mb-3">Patient</h3>
              <p className="text-2xl font-semibold mb-1">{patientData.patient.name}</p>
              <p className="text-wise-dark font-medium">
                {patientData.patient.gender} · DOB: {patientData.patient.birthDate}
              </p>
              {patientData.patient.address && (
                <p className="text-wise-gray text-sm mt-1">{patientData.patient.address}</p>
              )}
              <p className="text-wise-gray text-sm mt-1">ID: {patientData.patient.id}</p>
            </div>

            {/* Conditions */}
            <div className="wise-card rounded-[30px] p-6">
              <h3 className="text-sm font-semibold text-wise-gray uppercase tracking-wider mb-3">
                Active Conditions ({patientData.conditions.length})
              </h3>
              {patientData.conditions.length === 0 ? (
                <p className="text-wise-gray text-sm">No active conditions found</p>
              ) : (
                <ul className="space-y-2">
                  {patientData.conditions.map((c, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <span className="mt-1.5 w-2 h-2 bg-wise-green rounded-full shrink-0" />
                      <div>
                        <p className="font-medium text-sm">{c.display}</p>
                        {c.code && <p className="text-xs text-wise-gray">{c.code}</p>}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Medications */}
            <div className="wise-card rounded-[30px] p-6">
              <h3 className="text-sm font-semibold text-wise-gray uppercase tracking-wider mb-3">
                Medications ({patientData.medications.length})
              </h3>
              {patientData.medications.length === 0 ? (
                <p className="text-wise-gray text-sm">No active medications</p>
              ) : (
                <ul className="space-y-2">
                  {patientData.medications.map((m, i) => (
                    <li key={i} className="text-sm">
                      <span className="font-medium">{m.medication}</span>
                      {m.dosage && <span className="text-wise-gray"> — {m.dosage}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Observations */}
            <div className="wise-card rounded-[30px] p-6">
              <h3 className="text-sm font-semibold text-wise-gray uppercase tracking-wider mb-3">
                Recent Observations ({patientData.observations.length})
              </h3>
              {patientData.observations.length === 0 ? (
                <p className="text-wise-gray text-sm">No recent observations</p>
              ) : (
                <ul className="space-y-1.5">
                  {patientData.observations.slice(0, 8).map((o, i) => (
                    <li key={i} className="text-sm flex justify-between">
                      <span className="font-medium truncate mr-2">{o.code}</span>
                      <span className="text-wise-gray shrink-0">{o.value || "—"}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        )}

        {/* Step 2: Prior Auth Form */}
        {patientData && (
          <section className="mb-10">
            <h2 className="text-sm font-semibold text-wise-gray uppercase tracking-wider mb-4">
              Step 2 — Prior Authorization Request
            </h2>
            <div className="wise-card rounded-[30px] p-6 space-y-4">
              <div>
                <label className="block text-sm font-semibold text-wise-dark mb-1">
                  Medication / Procedure
                </label>
                <input
                  type="text"
                  value={medication}
                  onChange={(e) => setMedication(e.target.value)}
                  className="w-full px-4 py-2.5 border border-wise-light rounded-[10px] text-sm font-medium focus:outline-none focus:ring-2 focus:ring-wise-green"
                />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-wise-dark mb-1">
                    Requesting Provider
                  </label>
                  <input
                    type="text"
                    value={provider}
                    onChange={(e) => setProvider(e.target.value)}
                    className="w-full px-4 py-2.5 border border-wise-light rounded-[10px] text-sm font-medium focus:outline-none focus:ring-2 focus:ring-wise-green"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-wise-dark mb-1">
                    Insurance Payer
                  </label>
                  <input
                    type="text"
                    value={payer}
                    onChange={(e) => setPayer(e.target.value)}
                    className="w-full px-4 py-2.5 border border-wise-light rounded-[10px] text-sm font-medium focus:outline-none focus:ring-2 focus:ring-wise-green"
                  />
                </div>
              </div>
              <div className="flex gap-3 pt-2">
                <button
                  onClick={runAnalysis}
                  disabled={!!loading || !medication}
                  className="wise-btn bg-[rgba(22,51,0,0.08)] text-wise-black font-semibold px-5 py-2.5 rounded-full disabled:opacity-50"
                >
                  {loading === "analyze" ? "Analyzing..." : "Analyze Need"}
                </button>
                <button
                  onClick={generateDraft}
                  disabled={!!loading || !medication}
                  className="wise-btn bg-wise-green text-wise-dark-green font-semibold px-5 py-2.5 rounded-full disabled:opacity-50"
                >
                  {loading === "draft" ? "Generating..." : "Generate Full Draft"}
                </button>
              </div>
            </div>
          </section>
        )}

        {/* Analysis Results */}
        {analysis && (
          <section className="mb-10">
            <h2 className="text-sm font-semibold text-wise-gray uppercase tracking-wider mb-4">
              Clinical Analysis
            </h2>
            <div className="wise-card rounded-[30px] p-6">
              <div className="flex items-center gap-3 mb-4">
                <ConfidenceBadge value={analysis.confidence} />
                <span className="text-sm font-semibold text-wise-dark">
                  {analysis.primary_diagnosis_code} — {analysis.primary_diagnosis_display}
                </span>
              </div>
              <p className="text-sm text-wise-dark font-medium mb-4">
                {analysis.clinical_rationale}
              </p>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <h4 className="text-xs font-semibold text-wise-gray uppercase mb-2">Evidence Points</h4>
                  <ul className="space-y-1">
                    {analysis.evidence_points.map((e, i) => (
                      <li key={i} className="text-sm flex gap-2">
                        <span className="text-wise-green">•</span> {e}
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  {analysis.missing_information.length > 0 && (
                    <>
                      <h4 className="text-xs font-semibold text-wise-gray uppercase mb-2">Missing Information</h4>
                      <ul className="space-y-1">
                        {analysis.missing_information.map((m, i) => (
                          <li key={i} className="text-sm flex gap-2">
                            <span className="text-wise-warning">•</span> {m}
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                </div>
              </div>
            </div>
          </section>
        )}

        {/* Draft Letter */}
        {draft && (
          <section className="mb-10">
            <h2 className="text-sm font-semibold text-wise-gray uppercase tracking-wider mb-4">
              Prior Authorization Draft
            </h2>
            <div className="wise-card rounded-[30px] p-6">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <ConfidenceBadge value={draft.confidence} />
                  <span className="text-sm font-medium text-wise-dark">{draft.summary}</span>
                </div>
                <button
                  onClick={() => navigator.clipboard.writeText(draft.letter)}
                  className="wise-btn text-xs font-semibold bg-wise-mint text-wise-dark-green px-3 py-1.5 rounded-full"
                >
                  Copy Letter
                </button>
              </div>

              <div className="flex gap-2 mb-4 flex-wrap">
                {draft.icd10_codes.map((c, i) => (
                  <span key={i} className="text-xs font-semibold bg-wise-mint text-wise-dark-green px-2.5 py-1 rounded-full">
                    ICD-10: {c}
                  </span>
                ))}
                {draft.cpt_codes.map((c, i) => (
                  <span key={i} className="text-xs font-semibold bg-wise-light text-wise-dark px-2.5 py-1 rounded-full">
                    CPT: {c}
                  </span>
                ))}
              </div>

              <div className="bg-gray-50 rounded-2xl p-5 whitespace-pre-wrap text-sm font-[400] leading-relaxed text-wise-dark max-h-[600px] overflow-y-auto">
                {draft.letter}
              </div>
            </div>
          </section>
        )}

        {/* Loading overlay */}
        {loading && loading !== "patient" && (
          <div className="fixed inset-0 bg-white/60 flex items-center justify-center z-50">
            <div className="wise-card rounded-[30px] p-8 text-center bg-white">
              <div className="w-10 h-10 border-3 border-wise-green border-t-transparent rounded-full animate-spin mx-auto mb-4" />
              <p className="font-semibold text-wise-dark">
                {loading === "analyze" ? "Analyzing clinical data..." : "Generating prior auth draft..."}
              </p>
              <p className="text-sm text-wise-gray mt-1">This may take 10-15 seconds</p>
            </div>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-wise-light px-6 py-4 text-center text-sm text-wise-gray">
        ClinicalContext MCP Server · Built for Agents Assemble Hackathon · Uses synthetic FHIR data only
      </footer>
    </div>
  );
}

function ConfidenceBadge({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const color = pct >= 70 ? "bg-wise-green text-wise-dark-green" : pct >= 40 ? "bg-wise-warning text-wise-black" : "bg-wise-danger/10 text-wise-danger";
  return (
    <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${color}`}>
      {pct}% confidence
    </span>
  );
}
