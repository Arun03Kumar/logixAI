/**
 * Output comparison used for every test case.
 *
 * Lenient about whitespace the student can't see: Windows line endings,
 * trailing spaces at the end of a line and blank lines at the end. Strict
 * about everything else.
 */
export function normalizeOutput(text: string): string[] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n").map((line) => line.trimEnd());
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

export function outputsMatch(expected: string, actual: string): boolean {
  const a = normalizeOutput(expected);
  const b = normalizeOutput(actual);
  return a.length === b.length && a.every((line, i) => line === b[i]);
}


export { jsonOutputsMatch, jsonValuesMatch } from "@logixai/contracts";
