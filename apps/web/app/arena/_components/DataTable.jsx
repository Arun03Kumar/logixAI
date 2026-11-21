"use client";
import { cn } from "@logixai/ui";

/** {"columns": [...], "data": [[...]]} — how the judge encodes SQL results and DataFrames. */
export function isTableValue(v) {
  return Boolean(v) && typeof v === "object" && Array.isArray(v.columns) && Array.isArray(v.data);
}

/** Parses a judge JSON string; undefined when it isn't JSON. */
export function parseJson(text) {
  if (text == null || text === "") return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** Numbers to 6 significant digits (grading uses exact values with a tolerance). */
export function cellText(v) {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : String(Number(v.toPrecision(6)));
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

const rowKey = (row) => row.map(cellText).join("␟");

/**
 * A small scrollable table. `highlight` is a Set of row keys to mark (rows
 * that the other table doesn't have), used to show differences.
 */
export default function DataTable({ columns, rows, caption, highlight, tone = "danger", maxRows = 50, className }) {
  const shown = rows.slice(0, maxRows);
  return (
    <figure className={cn("min-w-0 space-y-1", className)}>
      {caption ? <figcaption className="text-xs font-medium text-muted-foreground">{caption}</figcaption> : null}
      <div className="max-h-72 overflow-auto rounded-md border border-border">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-muted">
            <tr>
              {columns.map((c, i) => (
                <th key={`${c}-${i}`} scope="col" className="whitespace-nowrap px-2 py-1.5 text-left font-medium">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 ? (
              <tr>
                <td colSpan={columns.length || 1} className="px-2 py-2 text-muted-foreground">
                  (no rows)
                </td>
              </tr>
            ) : (
              shown.map((row, i) => {
                const marked = highlight?.has(rowKey(row));
                return (
                  <tr
                    key={i}
                    className={cn(
                      "border-t border-border",
                      marked && (tone === "danger" ? "bg-danger-soft" : "bg-success-soft"),
                    )}
                  >
                    {row.map((v, j) => (
                      <td
                        key={j}
                        className={cn(
                          "whitespace-nowrap px-2 py-1 font-mono tabular-nums",
                          (v === null || v === undefined) && "text-muted-foreground italic",
                        )}
                      >
                        {cellText(v)}
                      </td>
                    ))}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      {rows.length > maxRows ? (
        <p className="text-xs text-muted-foreground">
          Showing {maxRows} of {rows.length} rows.
        </p>
      ) : null}
    </figure>
  );
}

/**
 * Expected and actual tables side by side; rows only one side has are
 * highlighted (green: missing from yours, red: extra in yours).
 */
export function TableDiff({ expected, actual }) {
  const count = (rows) => {
    const m = new Map();
    for (const r of rows) m.set(rowKey(r), (m.get(rowKey(r)) ?? 0) + 1);
    return m;
  };
  const e = count(expected.data);
  const a = count(actual.data);
  const onlyIn = (x, y) => new Set([...x.keys()].filter((k) => (x.get(k) ?? 0) > (y.get(k) ?? 0)));
  const sameColumns =
    expected.columns.length === actual.columns.length &&
    expected.columns.every((c, i) => String(c).toLowerCase() === String(actual.columns[i]).toLowerCase());
  return (
    <div className="space-y-2">
      {!sameColumns ? (
        <p className="text-xs text-danger">
          Columns differ: expected <span className="font-mono">{expected.columns.join(", ")}</span>, got{" "}
          <span className="font-mono">{actual.columns.join(", ") || "(none)"}</span>.
        </p>
      ) : null}
      {expected.data.length !== actual.data.length ? (
        <p className="text-xs text-danger">
          Expected {expected.data.length} {expected.data.length === 1 ? "row" : "rows"}, got {actual.data.length}.
        </p>
      ) : null}
      <div className="grid gap-3 xl:grid-cols-2">
        <DataTable caption="Expected" columns={expected.columns} rows={expected.data} highlight={onlyIn(e, a)} tone="success" />
        <DataTable caption="Your result" columns={actual.columns} rows={actual.data} highlight={onlyIn(a, e)} />
      </div>
    </div>
  );
}
