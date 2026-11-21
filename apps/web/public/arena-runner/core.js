/*
 * Runs one ML Arena test in Pyodide, the way the judge runs it in a container:
 * the item's judge program (learner code already inside) reads the test's
 * input from stdin, prints the JSON result on stdout, and exits with status 1
 * after writing the error to stderr when the code fails.
 *
 * Shared, unchanged, by the browser worker (public/arena-runner/worker.js) and
 * the content parity check (apps/arena-service/scripts/check-browser-parity.ts),
 * so what the check proves is what learners run. Plain script: it defines
 * globalThis.LogixPyRunner.
 */
(function (root) {
  "use strict";

  /**
   * Loads the packages imported by the judge program and, for Python items, the
   * learner's code (numpy, pandas, scipy, duckdb, ...). Each source is scanned
   * on its own: one that doesn't parse (SQL, or code with a syntax error) must
   * not hide the other's imports.
   */
  async function prepare(pyodide, sources) {
    for (const source of sources) await pyodide.loadPackagesFromImports(source);
  }

  function byteSink() {
    const bytes = [];
    return {
      raw: (b) => {
        bytes.push(b);
      },
      text: () => new TextDecoder().decode(new Uint8Array(bytes)),
    };
  }

  /**
   * Runs `program` with `input` on stdin, in fresh globals.
   * Returns { exitOk, stdout, stderr, timeMs }.
   */
  async function runOne(pyodide, program, input) {
    const out = byteSink();
    const err = byteSink();
    // Byte-level reader: the line-based `stdin` callback truncates long inputs.
    const bytes = new TextEncoder().encode(input);
    let offset = 0;
    pyodide.setStdin({
      read: (buffer) => {
        const n = Math.min(buffer.length, bytes.length - offset);
        buffer.set(bytes.subarray(offset, offset + n));
        offset += n;
        return n;
      },
    });
    pyodide.setStdout({ raw: out.raw });
    pyodide.setStderr({ raw: err.raw });

    const globals = pyodide.globals.get("dict")();
    let exitOk = true;
    let failure = "";
    const started = performance.now();
    try {
      // The harness points sys.stdout at stderr; undo that from the previous test.
      pyodide.runPython("import sys\nsys.stdout = sys.__stdout__\nsys.stderr = sys.__stderr__");
      pyodide.runPython(program, { globals });
    } catch (e) {
      exitOk = false;
      // The harness exits with SystemExit(1) after writing the error to stderr.
      // Anything else is unexpected: report it like a crash.
      const type = e && e.type;
      if (type !== "SystemExit") failure = String((e && e.message) || e);
    } finally {
      try {
        pyodide.runPython("import sys\nsys.__stdout__.flush()\nsys.__stderr__.flush()");
      } catch {
        /* nothing to flush */
      }
      globals.destroy();
    }
    const timeMs = Math.round(performance.now() - started);
    return { exitOk, stdout: out.text(), stderr: err.text() + failure, timeMs };
  }

  root.LogixPyRunner = { prepare, runOne };
})(typeof globalThis !== "undefined" ? globalThis : self);
