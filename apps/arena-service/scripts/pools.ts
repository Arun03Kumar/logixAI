// Prints how many items each mock-interview and contest slot can draw from (free / all).
// Usage: npx tsx scripts/pools.ts
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadCatalog } from "../src/content/catalog.js";
import { poolFor } from "../src/content/practiceConfig.js";

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "content");
const c = loadCatalog(dir);
for (const m of c.practice.mocks) {
  console.log(m.id.padEnd(24), m.slots.map((s) => `${s.label} ${poolFor(c, s, true).length}/${poolFor(c, s, false).length}`).join(" · "));
}
const weekly = c.practice.contests?.weekly;
if (weekly) console.log("weekly contest".padEnd(24), weekly.slots.map((s) => `${s.label} ${poolFor(c, s, false).length}`).join(" · "));
