import type { LanguageDefinition } from "@logixai/contracts";

export interface ExecOptions {
  /** Written to the process's stdin, then stdin is closed. */
  stdin?: string;
  /** Host-side watchdog. The in-container `timeout` should fire first. */
  timeoutMs: number;
  /** stdout/stderr beyond this many bytes are dropped (and flagged). */
  maxOutputBytes: number;
}

export interface ExecResult {
  /** null when the watchdog had to abandon the process. */
  exitCode: number | null;
  stdout: string;
  stderr: string;
  /** The host-side watchdog fired. */
  timedOut: boolean;
  /** Output was cut at maxOutputBytes. */
  outputLimited: boolean;
  durationMs: number;
}

/** An isolated environment for one submission: write code, compile, run tests. */
export interface Sandbox {
  exec(command: string[], options: ExecOptions): Promise<ExecResult>;
  destroy(): Promise<void>;
}

export interface SandboxFactory {
  create(language: LanguageDefinition): Promise<Sandbox>;
}
