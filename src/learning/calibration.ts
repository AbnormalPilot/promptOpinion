import { existsSync, mkdirSync, readFileSync, appendFileSync } from "fs";
import { dirname } from "path";

export interface CalibrationPoint {
  ts: string;
  predicted: number;
  actual: 0 | 1;
  drug: string;
  payer?: string;
}

const CALIB_PATH = process.env.CALIBRATION_PATH || "data/calibration.jsonl";

function ensureDir(path: string) {
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

// Calibration records serialise to ~120 bytes — well under PIPE_BUF on every
// supported OS (512B macOS, 4KB Linux), so appendFileSync is POSIX-atomic for
// these payloads even under concurrent Express handlers. No mutex needed.
// Memory + audit JSONLs (which DO exceed PIPE_BUF) use src/util/jsonl.ts.
export function logPrediction(p: CalibrationPoint) {
  ensureDir(CALIB_PATH);
  try {
    appendFileSync(CALIB_PATH, JSON.stringify(p) + "\n");
  } catch (err) {
    console.error("calibration write failed:", (err as Error).message);
  }
}

function loadPoints(): CalibrationPoint[] {
  if (!existsSync(CALIB_PATH)) return [];
  return readFileSync(CALIB_PATH, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
}

/** Brier score = mean squared error between predicted prob and actual outcome. Lower is better. */
export function brierScore(): number | null {
  const pts = loadPoints();
  if (pts.length === 0) return null;
  const sum = pts.reduce((s, p) => s + Math.pow(p.predicted - p.actual, 2), 0);
  return sum / pts.length;
}

/** Reliability bins: predicted in [0,0.2),[0.2,0.4),... vs actual rate. */
export function reliabilityDiagram(): Array<{ bin: string; predicted_avg: number; actual_rate: number; n: number }> {
  const pts = loadPoints();
  const bins = [0, 0.2, 0.4, 0.6, 0.8, 1.01];
  const out: Array<{ bin: string; predicted_avg: number; actual_rate: number; n: number }> = [];
  for (let i = 0; i < bins.length - 1; i++) {
    const inBin = pts.filter((p) => p.predicted >= bins[i] && p.predicted < bins[i + 1]);
    if (inBin.length === 0) {
      out.push({ bin: `${bins[i].toFixed(1)}-${bins[i + 1].toFixed(1)}`, predicted_avg: 0, actual_rate: 0, n: 0 });
      continue;
    }
    const predAvg = inBin.reduce((s, p) => s + p.predicted, 0) / inBin.length;
    const actRate = inBin.reduce((s, p) => s + p.actual, 0) / inBin.length;
    out.push({ bin: `${bins[i].toFixed(1)}-${bins[i + 1].toFixed(1)}`, predicted_avg: predAvg, actual_rate: actRate, n: inBin.length });
  }
  return out;
}

/** Simple temperature scaling: if model is over-confident, push probabilities toward 0.5. */
export function calibratedProbability(rawP: number): number {
  const pts = loadPoints();
  if (pts.length < 5) return rawP;
  // estimate temperature via slope of (predicted, actual)
  const meanP = pts.reduce((s, p) => s + p.predicted, 0) / pts.length;
  const meanA = pts.reduce((s, p) => s + p.actual, 0) / pts.length;
  let num = 0, den = 0;
  for (const p of pts) {
    num += (p.predicted - meanP) * (p.actual - meanA);
    den += (p.predicted - meanP) ** 2;
  }
  const slope = den === 0 ? 1 : num / den;
  // if slope < 1: model over-confident; pull toward base rate
  if (slope >= 0.9 && slope <= 1.1) return rawP;
  const baseRate = meanA;
  const blend = Math.max(0.3, Math.min(1, slope));
  return blend * rawP + (1 - blend) * baseRate;
}
