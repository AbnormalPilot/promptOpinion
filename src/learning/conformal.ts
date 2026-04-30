/** Inductive split-conformal prediction for the calibration log.
 *
 * Given a calibration set of (predicted, actual) pairs and a target miscoverage
 * alpha, returns a finite-sample interval [lower, upper] such that, if the
 * calibration data is exchangeable with the new query, the true outcome lies
 * inside the interval with probability >= 1 - alpha.
 *
 * Non-conformity score: s_i = |predicted_i - actual_i|.
 * Quantile uses the conformal correction: ceil((n+1)*(1-alpha)) / n.
 */
import { existsSync, readFileSync } from "fs";

const CALIB_PATH = process.env.CALIBRATION_PATH || "data/calibration.jsonl";

interface CalibPoint { predicted: number; actual: 0 | 1 }

function loadScores(): number[] {
  if (!existsSync(CALIB_PATH)) return [];
  const lines = readFileSync(CALIB_PATH, "utf8").trim().split("\n").filter(Boolean);
  const out: number[] = [];
  for (const l of lines) {
    try {
      const p = JSON.parse(l) as CalibPoint;
      if (typeof p.predicted === "number" && (p.actual === 0 || p.actual === 1)) {
        out.push(Math.abs(p.predicted - p.actual));
      }
    } catch { /* skip malformed */ }
  }
  return out;
}

export function conformalInterval(p: number, alpha = 0.1): { lower: number; upper: number; n_calibration: number; coverage_target: number } {
  const scores = loadScores();
  const n = scores.length;
  if (n < 10) {
    return { lower: 0, upper: 1, n_calibration: 0, coverage_target: 1 - alpha };
  }
  const sorted = [...scores].sort((a, b) => a - b);
  // Conformal quantile index: ceil((n+1)*(1-alpha)) (1-indexed). Clamp to [1,n].
  const k = Math.min(n, Math.max(1, Math.ceil((n + 1) * (1 - alpha))));
  const q = sorted[k - 1];
  const lower = Math.max(0, p - q);
  const upper = Math.min(1, p + q);
  return { lower, upper, n_calibration: n, coverage_target: 1 - alpha };
}

export function _internalTest(): { ok: boolean; details: string } {
  // Synthetic: predictions ~ Uniform(0,1), actuals = Bernoulli(predicted).
  // With n=200 the empirical coverage on a held-out batch should hit ~1-alpha.
  const path = CALIB_PATH;
  const orig = existsSync(path) ? readFileSync(path, "utf8") : null;
  try {
    const fs = require("fs");
    const lines: string[] = [];
    for (let i = 0; i < 200; i++) {
      const pred = Math.random();
      const actual = Math.random() < pred ? 1 : 0;
      lines.push(JSON.stringify({ predicted: pred, actual, ts: "t", drug: "x" }));
    }
    fs.mkdirSync(require("path").dirname(path), { recursive: true });
    fs.writeFileSync(path, lines.join("\n") + "\n");
    const r = conformalInterval(0.5, 0.1);
    const ok = r.n_calibration === 200 && r.lower <= 0.5 && r.upper >= 0.5 && (r.upper - r.lower) > 0.1;
    return { ok, details: JSON.stringify(r) };
  } finally {
    const fs = require("fs");
    if (orig === null) { try { fs.unlinkSync(path); } catch {} }
    else fs.writeFileSync(path, orig);
  }
}

if (process.env.CONFORMAL_SELFTEST === "1") {
  const r = _internalTest();
  console.log(`[conformal selftest] ok=${r.ok} ${r.details}`);
}
