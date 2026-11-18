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
