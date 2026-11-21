/**
 * Live preview runtime for the JavaScript / React playground and ML Arena
 * React items. Bundled (React, ReactDOM, Sucrase) by scripts/build-preview.mjs
 * into public/arena-preview/runtime.js and loaded inside a sandboxed iframe
 * (sandbox="allow-scripts", no same-origin), so the learner's code can't read
 * the app's cookies or storage.
 *
 * Protocol (postMessage):
 *   parent -> frame  { type: "run", code, component?, props?, mode: "react" | "script" }
 *   frame -> parent  { source: "lx-preview", type: "ready" | "reset" | "done" | "error" | "console", text?, level? }
 */
import * as React from "react";
import * as ReactDOM from "react-dom";
import * as ReactDOMClient from "react-dom/client";
import * as jsxRuntime from "react/jsx-runtime";
import { transform } from "sucrase";

const MODULES = {
  react: React,
  "react-dom": ReactDOM,
  "react-dom/client": ReactDOMClient,
  "react/jsx-runtime": jsxRuntime,
};

const post = (msg) => window.parent.postMessage({ source: "lx-preview", ...msg }, "*");

function format(value) {
  if (typeof value === "string") return value;
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  try {
    return JSON.stringify(value, (_, v) => (typeof v === "function" ? `[Function ${v.name || "anonymous"}]` : v)) ?? String(value);
  } catch {
    return String(value);
  }
}

for (const level of ["log", "info", "warn", "error"]) {
  const original = console[level];
  console[level] = (...args) => {
    post({ type: "console", level, text: args.map(format).join(" ").slice(0, 2000) });
    original.apply(console, args);
  };
}
window.addEventListener("error", (e) => post({ type: "error", text: e.error ? format(e.error) : e.message }));
window.addEventListener("unhandledrejection", (e) => post({ type: "error", text: `Unhandled rejection: ${format(e.reason)}` }));

class Boundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error) {
    post({ type: "error", text: format(error) });
  }
  render() {
    return this.state.error ? null : this.props.children;
  }
}

let root = null;

function run({ code, component, props, mode }) {
  post({ type: "reset" });
  if (root) {
    root.unmount();
    root = null;
  }
  const mount = document.getElementById("root");
  mount.innerHTML = "";

  let compiled;
  try {
    compiled = transform(String(code ?? ""), { transforms: ["jsx", "imports"], jsxRuntime: "automatic", production: true }).code;
  } catch (e) {
    post({ type: "error", text: `SyntaxError: ${String(e.message).replace(/^Error transforming [^:]*: /, "")}` });
    return;
  }
  const mod = { exports: {} };
  const require = (name) => {
    if (name in MODULES) return MODULES[name];
    throw new Error(`Only react and react-dom can be imported here (not "${name}").`);
  };
  const names = component ? [component, "App"] : ["App"];
  const tail = `\n;return {${names.map((n) => `${JSON.stringify(n)}: typeof ${n} === "undefined" ? undefined : ${n}`).join(", ")}};`;
  let local;
  try {
    local = new Function("exports", "require", "module", compiled + tail)(mod.exports, require, mod) ?? {};
  } catch (e) {
    post({ type: "error", text: format(e) });
    return;
  }
  if (mode === "script") {
    post({ type: "done" });
    return;
  }
  const exported = mod.exports ?? {};
  const Comp =
    (component && (local[component] ?? exported[component])) ?? exported.default ?? local.App ?? exported.App;
  if (typeof Comp !== "function") {
    post({
      type: "error",
      text: component
        ? `Define ${component} to see it here.`
        : "Export a component (export default function App() { ... }) to see it here.",
    });
    return;
  }
  root = ReactDOMClient.createRoot(mount);
  root.render(React.createElement(Boundary, null, React.createElement(Comp, props ?? {})));
  post({ type: "done" });
}

window.addEventListener("message", (event) => {
  if (event.source !== window.parent) return;
  const msg = event.data;
  if (msg && msg.type === "run") run(msg);
});

post({ type: "ready" });
