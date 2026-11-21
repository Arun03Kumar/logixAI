"use client";
import { parseJson } from "./DataTable";

/*
 * Charts for system-design simulations (items with `visual`):
 *  - timeline: rows [time, allowed] or [time, key, allowed] — one lane per key,
 *    a dot per request, green when allowed and red when rejected;
 *  - bars: { label: number } — e.g. requests or peak load per server.
 * Returns nothing when the value doesn't have that shape (e.g. code that crashed).
 */

function pick(visual, json) {
  const value = parseJson(json);
  return visual.field ? value?.[visual.field] : value;
}

function timelineRows(data) {
  if (!Array.isArray(data) || data.length === 0) return null;
  const rows = data.map((r) =>
    Array.isArray(r) && r.length === 3 ? { t: r[0], key: String(r[1]), ok: r[2] } : Array.isArray(r) && r.length === 2 ? { t: r[0], key: "", ok: r[1] } : null,
  );
  return rows.every((r) => r && typeof r.t === "number" && typeof r.ok === "boolean") ? rows : null;
}

function Timeline({ rows, caption }) {
  const keys = [...new Set(rows.map((r) => r.key))];
  const t0 = Math.min(...rows.map((r) => r.t));
  const t1 = Math.max(...rows.map((r) => r.t));
  const span = Math.max(1, t1 - t0);
  const left = keys.some(Boolean) ? 44 : 8;
  const width = 600;
  const lane = 26;
  const height = keys.length * lane + 22;
  const x = (t) => left + ((t - t0) / span) * (width - left - 12);
  const seen = new Map();
  const ticks = Array.from({ length: 5 }, (_, i) => Math.round(t0 + (span * i) / 4));
  const allowed = rows.filter((r) => r.ok).length;
  return (
    <figure className="space-y-1">
      <figcaption className="text-xs text-muted-foreground">
        {caption} · {allowed} allowed, {rows.length - allowed} rejected
      </figcaption>
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full" role="img" aria-label={`${caption}: ${allowed} of ${rows.length} allowed`}>
        {keys.map((k, i) => (
          <g key={k}>
            <line x1={left} x2={width - 8} y1={i * lane + 13} y2={i * lane + 13} className="text-border" stroke="currentColor" />
            {k ? (
              <text x={4} y={i * lane + 17} className="fill-current text-muted-foreground" fontSize="11">
                {k.length > 6 ? `${k.slice(0, 6)}…` : k}
              </text>
            ) : null}
          </g>
        ))}
        {rows.map((r, i) => {
          const lanei = keys.indexOf(r.key);
          const slot = `${r.key}@${r.t}`;
          const n = seen.get(slot) ?? 0;
          seen.set(slot, n + 1);
          const cy = lanei * lane + 13 + ((n % 3) - 1) * 6 * (n > 0 ? 1 : 0);
          return (
            <circle key={i} cx={x(r.t)} cy={cy} r={4} className={r.ok ? "text-success" : "text-danger"} fill="currentColor" fillOpacity={r.ok ? 0.9 : 0.75}>
              <title>{`${r.t} ms${r.key ? ` · ${r.key}` : ""} · ${r.ok ? "allowed" : "rejected"}`}</title>
            </circle>
          );
        })}
        {ticks.map((t, i) => (
          <text key={i} x={x(t)} y={height - 4} textAnchor={i === 0 ? "start" : i === 4 ? "end" : "middle"} className="fill-current text-muted-foreground" fontSize="10">
            {t} ms
          </text>
        ))}
      </svg>
    </figure>
  );
}

function Bars({ entries, caption }) {
  const max = Math.max(1, ...entries.map(([, v]) => v));
  return (
    <figure className="space-y-1">
      <figcaption className="text-xs text-muted-foreground">{caption}</figcaption>
      <ul className="space-y-1">
        {entries.map(([label, v]) => (
          <li key={label} className="grid grid-cols-[6rem_1fr_3rem] items-center gap-2 text-xs">
            <span className="truncate font-mono">{label}</span>
            <span className="h-3 rounded-sm bg-muted">
              <span className="block h-3 rounded-sm bg-primary" style={{ width: `${(v / max) * 100}%` }} />
            </span>
            <span className="text-right font-mono tabular-nums">{v}</span>
          </li>
        ))}
      </ul>
    </figure>
  );
}

export default function SimChart({ visual, json, caption }) {
  if (!visual || json == null) return null;
  const data = pick(visual, json);
  const label = caption ?? visual.title ?? "";
  if (visual.kind === "timeline") {
    const rows = timelineRows(data);
    return rows ? <Timeline rows={rows} caption={label} /> : null;
  }
  if (visual.kind === "bars" && data && typeof data === "object" && !Array.isArray(data)) {
    const entries = Object.entries(data).filter(([, v]) => typeof v === "number");
    return entries.length ? <Bars entries={entries} caption={label} /> : null;
  }
  return null;
}
