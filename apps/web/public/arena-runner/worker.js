/*
 * ML Arena browser runner: a Web Worker hosting Pyodide.
 *
 * Messages (each with an `id`, answered with the same `id`):
 *   { type: "init", version }          load Pyodide (once per worker)
 *   { type: "prepare", sources }       load the packages these sources import
 *   { type: "run", program, input }    run one test -> { exitOk, stdout, stderr, timeMs }
 *
 * The page enforces time limits by terminating this worker (Python can't be
 * interrupted otherwise), so one test runs per message.
 */
/* global importScripts, loadPyodide, LogixPyRunner */
importScripts("./core.js");

let pyodideReady = null;

function init(version) {
  if (!pyodideReady) {
    const base = `https://cdn.jsdelivr.net/pyodide/v${version}/full/`;
    importScripts(`${base}pyodide.js`);
    pyodideReady = loadPyodide({ indexURL: base });
  }
  return pyodideReady;
}

self.onmessage = async (event) => {
  const { id, type } = event.data;
  try {
    let result = null;
    if (type === "init") {
      await init(event.data.version);
    } else if (type === "prepare") {
      await LogixPyRunner.prepare(await pyodideReady, event.data.sources);
    } else if (type === "run") {
      result = await LogixPyRunner.runOne(await pyodideReady, event.data.program, event.data.input);
    } else {
      throw new Error(`unknown message ${type}`);
    }
    self.postMessage({ id, ok: true, result });
  } catch (e) {
    self.postMessage({ id, ok: false, error: String((e && e.message) || e) });
  }
};
