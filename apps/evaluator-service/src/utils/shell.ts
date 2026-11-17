import { LANGUAGES, type LanguageId } from "@logixai/contracts";

/**
 * Quotes a value for POSIX sh so it is passed through literally:
 * wrap in single quotes and turn every ' into '\'' (close, escaped quote, reopen).
 */
export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * Prints `value` followed by a newline. Uses printf rather than echo because
 * dash's echo (the /bin/sh in the Debian-based judge images) expands
 * backslash escapes, which corrupts code like printf("%d\n").
 */
function printLiteral(value: string): string {
  return `printf '%s\\n' ${shellQuote(value)}`;
}

/**
 * Builds the `sh -c` script that writes the source file, compiles it when the
 * language needs it, and runs it with the test input on stdin. Commands come
 * from the shared language registry.
 */
export function buildRunCommand(
  language: LanguageId,
  code: string,
  input: string,
): string {
  const { sourceFile, compileCommand, runCommand } = LANGUAGES[language];
  const steps = [`${printLiteral(code)} > ${sourceFile}`];
  if (compileCommand) steps.push(compileCommand);
  steps.push(`${printLiteral(input)} | ${runCommand}`);
  return steps.join(" && ");
}
