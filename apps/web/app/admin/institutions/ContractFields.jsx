"use client";
import {
  Field,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
} from "@logixai/ui";

/** YYYY-MM-DD of an instant in India, matching contractFromForm's IST day bounds. */
const istDay = (d) => d.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
const today = () => istDay(new Date());
const inAYear = () => {
  const d = new Date();
  d.setFullYear(d.getFullYear() + 1);
  return istDay(d);
};

export const emptyContractForm = () => ({
  model: "per_seat",
  seats: "",
  rupees: "",
  startsAt: today(),
  endsAt: inAYear(),
  notes: "",
});

/** From a stored contract (ContractView) to form strings. */
export const contractToForm = (c) =>
  c
    ? {
        model: c.model,
        seats: c.seats == null ? "" : String(c.seats),
        rupees: String(c.pricePaise / 100),
        startsAt: istDay(new Date(c.startsAt)),
        endsAt: istDay(new Date(c.endsAt)),
        notes: c.notes ?? "",
      }
    : emptyContractForm();

/** Form strings to the API's ContractSchema; dates are start/end of day in IST. */
export const contractFromForm = (f) => ({
  model: f.model,
  seats: f.seats === "" ? null : Number(f.seats),
  pricePaise: Math.round(Number(f.rupees || 0) * 100),
  startsAt: new Date(`${f.startsAt}T00:00:00+05:30`).toISOString(),
  endsAt: new Date(`${f.endsAt}T23:59:59+05:30`).toISOString(),
  notes: f.notes,
});

export default function ContractFields({ value, onChange, errors = {}, idPrefix = "c" }) {
  const set = (patch) => onChange({ ...value, ...patch });
  const perSeat = value.model === "per_seat";
  const id = (s) => `${idPrefix}-${s}`;
  return (
    <div className="grid gap-4 rounded-lg border border-border p-4 sm:grid-cols-3">
      <Field label="Pricing" htmlFor={id("model")}>
        <Select value={value.model} onValueChange={(model) => set({ model })}>
          <SelectTrigger id={id("model")} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="per_seat">Per student seat</SelectItem>
            <SelectItem value="flat">Flat fee (band)</SelectItem>
          </SelectContent>
        </Select>
      </Field>
      <Field
        label={perSeat ? "Seats (students)" : "Student limit"}
        htmlFor={id("seats")}
        hint={perSeat ? "New students can't join past this." : "Leave empty for no limit."}
        error={errors.seats}
      >
        <Input id={id("seats")} type="number" min={1} value={value.seats} onChange={(e) => set({ seats: e.target.value })} />
      </Field>
      <Field label={perSeat ? "Price per seat (₹ / year)" : "Price for the term (₹)"} htmlFor={id("price")} error={errors.pricePaise}>
        <Input id={id("price")} type="number" min={0} step="0.01" value={value.rupees} onChange={(e) => set({ rupees: e.target.value })} />
      </Field>
      <Field label="Starts" htmlFor={id("starts")} error={errors.startsAt}>
        <Input id={id("starts")} type="date" value={value.startsAt} onChange={(e) => set({ startsAt: e.target.value })} />
      </Field>
      <Field label="Ends" htmlFor={id("ends")} error={errors.endsAt}>
        <Input id={id("ends")} type="date" value={value.endsAt} onChange={(e) => set({ endsAt: e.target.value })} />
      </Field>
      <Field label="Notes" htmlFor={id("notes")} className="sm:col-span-3" hint="Purchase order, invoice number, contact. Only LogixAI sees this.">
        <Textarea id={id("notes")} rows={2} value={value.notes} onChange={(e) => set({ notes: e.target.value })} />
      </Field>
    </div>
  );
}
