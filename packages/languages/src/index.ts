/**
 * Language registry.
 *
 * Adding a language should only need a new entry here (plus a Docker image
 * with its toolchain). Every service and the web app reads from this list,
 * so the DB enum, the judge and the UI selectors stay in sync.
 *
 * This module is pure data, so it is safe to import in the browser.
 */

export const LANGUAGE_IDS = ["JAVA", "CPP", "PYTHON"] as const;

export type LanguageId = (typeof LANGUAGE_IDS)[number];

export interface LanguageDefinition {
  /** Stable identifier stored in the DB and sent over the wire. */
  id: LanguageId;
  /** Human-readable name for the UI. */
  label: string;
  /** Language id understood by the Monaco editor. */
  monacoId: string;
  /** Docker image that contains the compiler / runtime. */
  dockerImage: string;
  /** File name the source code is written to inside the container. */
  sourceFile: string;
  /** Compile step, or null for interpreted languages. Runs inside the container. */
  compileCommand: string | null;
  /** Command that runs the program; test input is piped to its stdin. */
  runCommand: string;
}

export const LANGUAGES: Readonly<Record<LanguageId, LanguageDefinition>> = {
  JAVA: {
    id: "JAVA",
    label: "Java",
    monacoId: "java",
    dockerImage: "openjdk:26-slim-bookworm",
    sourceFile: "Main.java",
    compileCommand: "javac Main.java",
    runCommand: "java Main",
  },
  CPP: {
    id: "CPP",
    label: "C++",
    monacoId: "cpp",
    dockerImage: "gcc:latest",
    sourceFile: "main.cpp",
    compileCommand: "g++ main.cpp -o main",
    runCommand: "stdbuf -oL -eL ./main",
  },
  PYTHON: {
    id: "PYTHON",
    label: "Python",
    monacoId: "python",
    dockerImage: "python:3.9-slim",
    sourceFile: "test.py",
    compileCommand: null,
    runCommand: "python3 test.py",
  },
};

export const DEFAULT_LANGUAGE: LanguageId = "JAVA";

export function isLanguageId(value: unknown): value is LanguageId {
  return (
    typeof value === "string" &&
    (LANGUAGE_IDS as readonly string[]).includes(value)
  );
}

/** Case-insensitive lookup; returns undefined for unsupported languages. */
export function findLanguage(value: string): LanguageDefinition | undefined {
  const id = value.toUpperCase();
  return isLanguageId(id) ? LANGUAGES[id] : undefined;
}

export function listLanguages(): LanguageDefinition[] {
  return LANGUAGE_IDS.map((id) => LANGUAGES[id]);
}
