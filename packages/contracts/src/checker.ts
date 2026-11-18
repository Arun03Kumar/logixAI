// Shared by evaluator-service (judging) and arena-service (content checks).
/**
 * JSON comparison for ML Arena: numbers match within
 * `absTol + relTol * |expected|`, arrays element by element, objects key by
 * key. Non-finite floats are written as the strings "nan", "inf" and "-inf"
 * by the harness, so they compare as strings.
 */
export function jsonValuesMatch(
  expected: unknown,
  actual: unknown,
  tol: { absTol: number; relTol: number },
): boolean {
  if (typeof expected === "number") {
    return (
      typeof actual === "number" &&
      Number.isFinite(actual) &&
      Math.abs(actual - expected) <= tol.absTol + tol.relTol * Math.abs(expected)
    );
  }
  if (Array.isArray(expected)) {
    return (
      Array.isArray(actual) &&
      actual.length === expected.length &&
      expected.every((e, i) => jsonValuesMatch(e, actual[i], tol))
    );
  }
  if (expected !== null && typeof expected === "object") {
    if (actual === null || typeof actual !== "object" || Array.isArray(actual)) return false;
    const keys = Object.keys(expected);
    return (
      keys.length === Object.keys(actual).length &&
      keys.every(
        (k) =>
          Object.prototype.hasOwnProperty.call(actual, k) &&
          jsonValuesMatch((expected as Record<string, unknown>)[k], (actual as Record<string, unknown>)[k], tol),
      )
    );
  }
  return expected === actual;
}

export function jsonOutputsMatch(
  expected: string,
  actual: string,
  tol: { absTol: number; relTol: number },
): boolean {
  let e: unknown;
  let a: unknown;
  try {
    e = JSON.parse(expected);
    a = JSON.parse(actual.trim());
  } catch {
    return false;
  }
  return jsonValuesMatch(e, a, tol);
}

/* ── Metrics for dataset challenges ── */

export const METRICS = ["accuracy", "f1", "r2", "rmse", "mae"] as const;
export type Metric = (typeof METRICS)[number];

/** Error metrics: lower is better. */
export const LOWER_IS_BETTER: Readonly<Record<Metric, boolean>> = {
  accuracy: false,
  f1: false,
  r2: false,
  rmse: true,
  mae: true,
};

/**
 * Scores predictions against true values. Returns null when they can't be
 * compared (wrong length, non-numbers for regression). f1 is binary with
 * positive class 1.
 */
export function metricScore(metric: Metric, truth: unknown[], predicted: unknown): number | null {
  if (!Array.isArray(predicted) || predicted.length !== truth.length || truth.length === 0) return null;
  const n = truth.length;
  if (metric === "accuracy") {
    let right = 0;
    for (let i = 0; i < n; i++) if (sameLabel(truth[i], predicted[i])) right++;
    return right / n;
  }
  if (metric === "f1") {
    let tp = 0;
    let fp = 0;
    let fn = 0;
    for (let i = 0; i < n; i++) {
      const t = sameLabel(truth[i], 1);
      const p = sameLabel(predicted[i], 1);
      if (t && p) tp++;
      else if (p) fp++;
      else if (t) fn++;
    }
    return tp === 0 ? 0 : (2 * tp) / (2 * tp + fp + fn);
  }
  const y = truth.map(Number);
  const p = predicted.map((v) => (typeof v === "number" ? v : Number.NaN));
  if (p.some((v) => !Number.isFinite(v))) return null;
  if (metric === "mae") return y.reduce((s, v, i) => s + Math.abs(v - p[i]!), 0) / n;
  const sse = y.reduce((s, v, i) => s + (v - p[i]!) ** 2, 0);
  if (metric === "rmse") return Math.sqrt(sse / n);
  const mean = y.reduce((s, v) => s + v, 0) / n;
  const sst = y.reduce((s, v) => s + (v - mean) ** 2, 0);
  return sst === 0 ? 0 : 1 - sse / sst;
}

/** Labels compare as numbers when both are numeric (1 == 1.0 == true), else as strings. */
function sameLabel(a: unknown, b: unknown): boolean {
  const num = (v: unknown) => (typeof v === "boolean" ? Number(v) : typeof v === "number" ? v : null);
  const x = num(a);
  const y = num(b);
  if (x !== null && y !== null) return x === y;
  return String(a) === String(b);
}

export function metricPasses(metric: Metric, score: number | null, threshold: number): boolean {
  if (score === null || !Number.isFinite(score)) return false;
  return LOWER_IS_BETTER[metric] ? score <= threshold : score >= threshold;
}

export const formatScore = (metric: Metric, score: number) =>
  `${metric} ${metric === "accuracy" || metric === "f1" || metric === "r2" ? score.toFixed(4) : score.toPrecision(5)}`;
