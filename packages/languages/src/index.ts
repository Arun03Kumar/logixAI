/**
 * Language registry.
 *
 * Adding a language should only need a new entry here (plus a Docker image
 * with its toolchain). Every service and the web app reads from this list,
 * so the DB enum, the judge and the UI selectors stay in sync.
 *
 * This module is pure data, so it is safe to import in the browser.
 */

export const LANGUAGE_IDS = ["JAVA", "CPP", "PYTHON", "PYTHON_ML"] as const;

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
  /** Per-test time limit = base limit × this (slower runtimes get more time). */
  timeMultiplier: number;
  /** Memory limit for the sandbox, in MB. */
  memoryMb: number;
  /**
   * Where the runtime is offered: "dsa" for practice problems and exams,
   * "arena" for ML Arena (Python with NumPy, Pandas and scikit-learn).
   */
  purpose: LanguagePurpose;
}

export type LanguagePurpose = "dsa" | "arena";

export const LANGUAGES: Readonly<Record<LanguageId, LanguageDefinition>> = {
  JAVA: {
    id: "JAVA",
    label: "Java",
    monacoId: "java",
    dockerImage: "openjdk:26-slim-bookworm",
    sourceFile: "Main.java",
    compileCommand: "javac -J-XX:+UseSerialGC -J-XX:TieredStopAtLevel=1 Main.java",
    runCommand: "java -XX:+UseSerialGC -XX:TieredStopAtLevel=1 -Xss64m Main",
    timeMultiplier: 2,
    memoryMb: 512,
    purpose: "dsa",
  },
  CPP: {
    id: "CPP",
    label: "C++",
    monacoId: "cpp",
    dockerImage: "gcc:latest",
    sourceFile: "main.cpp",
    compileCommand: "g++ -O2 -std=c++17 -pipe -o main main.cpp",
    runCommand: "./main",
    timeMultiplier: 1,
    memoryMb: 256,
    purpose: "dsa",
  },
  PYTHON: {
    id: "PYTHON",
    label: "Python",
    monacoId: "python",
    dockerImage: "python:3.9-slim",
    sourceFile: "main.py",
    compileCommand: null,
    runCommand: "python3 -B main.py",
    timeMultiplier: 3,
    memoryMb: 256,
    purpose: "dsa",
  },
  PYTHON_ML: {
    id: "PYTHON_ML",
    label: "Python (ML)",
    monacoId: "python",
    // Built from judge-images/python-ml (npm run judge:images).
    dockerImage: "logixai/python-ml:1",
    sourceFile: "main.py",
    compileCommand: null,
    runCommand: "python3 -B main.py",
    // Importing NumPy / scikit-learn alone takes most of a second.
    timeMultiplier: 3,
    memoryMb: 512,
    purpose: "arena",
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

/** Languages offered for a purpose (practice problems and exams by default). */
export function listLanguages(purpose: LanguagePurpose = "dsa"): LanguageDefinition[] {
  return LANGUAGE_IDS.map((id) => LANGUAGES[id]).filter((l) => l.purpose === purpose);
}
