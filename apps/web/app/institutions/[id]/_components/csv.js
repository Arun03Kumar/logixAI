/**
 * Small CSV helpers for student import and sign-in sheets. Handles quoted
 * fields, "" escapes, commas or tabs (pasted from a spreadsheet) and CRLF.
 */

export function parseCsv(text) {
  const src = text.replace(/^﻿/, "");
  const firstLine = src.split(/\r?\n/, 1)[0] ?? "";
  const sep = firstLine.includes("\t") && !firstLine.includes(",") ? "\t" : ",";
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"' && field === "") quoted = true;
    else if (c === sep) {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ""));
}

const HEADERS = {
  name: ["name", "full name", "student name", "student"],
  rollNumber: ["roll number", "roll no", "roll no.", "roll", "rollno", "roll_number", "admission number", "admission no", "enrollment number", "enrolment number", "usn", "registration number", "reg no"],
  email: ["email", "email address", "e-mail", "mail"],
  batch: ["batch", "class", "section", "class/section", "group"],
};

/**
 * Rows of { name, rollNumber, email, batch } from parsed CSV. The first row
 * is a header when it names the columns; otherwise columns are taken in that
 * order. Returns { rows, columns } where columns says what was recognised.
 */
export function toStudentRows(table) {
  if (!table.length) return { rows: [], columns: [] };
  const head = table[0].map((h) => h.trim().toLowerCase());
  const index = {};
  for (const [key, names] of Object.entries(HEADERS)) {
    const i = head.findIndex((h) => names.includes(h));
    if (i >= 0) index[key] = i;
  }
  const hasHeader = index.name !== undefined;
  const cols = hasHeader ? index : { name: 0, rollNumber: 1, email: 2, batch: 3 };
  const body = hasHeader ? table.slice(1) : table;
  const cell = (r, key) => (cols[key] === undefined ? "" : (r[cols[key]] ?? "").trim());
  return {
    rows: body.map((r) => ({ name: cell(r, "name"), rollNumber: cell(r, "rollNumber"), email: cell(r, "email"), batch: cell(r, "batch") })),
    columns: Object.keys(cols),
  };
}

const quote = (v) => {
  const s = String(v ?? "");
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export const toCsv = (rows) => rows.map((r) => r.map(quote).join(",")).join("\r\n") + "\r\n";

/** Saves text as a file in the browser. */
export function downloadText(filename, text, type = "text/csv;charset=utf-8") {
  const url = URL.createObjectURL(new Blob(["﻿", text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const TEMPLATE_CSV = toCsv([
  ["Name", "Roll number", "Email", "Batch"],
  ["Asha Verma", "9A-01", "", "Class 9A"],
  ["Ravi Kumar", "9A-02", "ravi@example.com", "Class 9A"],
]);
