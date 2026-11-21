// Bundles preview-runtime/runtime.js (React, ReactDOM, Sucrase) into
// public/arena-preview/runtime.js for the sandboxed live-preview iframe.
// Runs before `next dev` and `next build` (predev / prebuild). The output is
// generated, so it's git-ignored.
import { build } from "esbuild";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

await build({
  entryPoints: [path.join(root, "preview-runtime", "runtime.js")],
  outfile: path.join(root, "public", "arena-preview", "runtime.js"),
  bundle: true,
  minify: true,
  format: "iife",
  target: "es2020",
  define: { "process.env.NODE_ENV": '"production"' },
  legalComments: "none",
  logLevel: "warning",
});
console.log("Built public/arena-preview/runtime.js");
