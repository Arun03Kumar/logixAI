"use client";
import { useMemo, useState } from "react";
import toast from "react-hot-toast";
import { Clock, X } from "lucide-react";
import {
  Button,
  Card,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Spinner,
} from "@logixai/ui";
import LoadMore from "@/app/components/LoadMore";
import { examApi } from "@/app/lib/api/exams";
import { identityApi } from "@/app/lib/api/identity";
import { usePagedApi } from "@/app/lib/api/usePagedApi";

const label = (m) => [m.name, m.rollNumber].filter(Boolean).join(" · ");

/**
 * Extra minutes for individual students (accommodations, late starts after a
 * power cut). Applies to the duration and the closing time, and moves the
 * deadline of a student who is writing right now.
 */
export default function ExtraTimePanel({ institutionId, exam }) {
  const [extraTime, setExtraTime] = useState(exam.extraTime ?? {});
  const [filter, setFilter] = useState("");
  const [userId, setUserId] = useState("");
  const [minutes, setMinutes] = useState("15");
  const [busy, setBusy] = useState(false);
  const students = usePagedApi(
    (cursor) => identityApi.listMembers(institutionId, { cursor, limit: 100, role: "student" }),
    [institutionId],
  );
  // Only students the exam is set for.
  const eligible = useMemo(
    () =>
      students.items.filter((m) => !exam.batchIds.length || m.batchIds.some((b) => exam.batchIds.includes(b))),
    [students.items, exam.batchIds],
  );
  const byId = new Map(students.items.map((m) => [m.userId, m]));
  const needle = filter.trim().toLowerCase();
  const choices = eligible.filter((m) => !needle || label(m).toLowerCase().includes(needle) || m.email?.toLowerCase().includes(needle));

  const save = async (id, value) => {
    setBusy(true);
    try {
      const res = await examApi.setExtraTime(exam.id, id, value);
      setExtraTime(res.extraTime);
      toast.success(value ? `Gave ${value} extra minutes.` : "Extra time removed.");
      if (value) setUserId("");
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  const entries = Object.entries(extraTime);
  return (
    <Card className="space-y-4 p-5">
      <div>
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <Clock className="size-4" />
          Extra time
        </h2>
        <p className="text-xs text-muted-foreground">
          Added to the student&apos;s duration and to the closing time. If they&apos;re writing now, their timer moves
          straight away.
        </p>
      </div>
      {entries.length ? (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {entries.map(([id, mins]) => (
            <li key={id} className="flex items-center gap-3 px-3 py-2 text-sm">
              <span className="min-w-0 flex-1 truncate">{byId.get(id) ? label(byId.get(id)) : "Student"}</span>
              <span className="font-medium tabular-nums">+{mins} min</span>
              <Button variant="ghost" size="icon-sm" aria-label="Remove extra time" disabled={busy} onClick={() => save(id, 0)}>
                <X />
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="flex flex-wrap items-end gap-2">
        <Input
          aria-label="Find a student"
          placeholder="Find by name or roll number"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="w-56"
        />
        <Select value={userId} onValueChange={setUserId}>
          <SelectTrigger className="w-64" aria-label="Student">
            <SelectValue placeholder={students.loading ? "Loading students…" : "Choose a student"} />
          </SelectTrigger>
          <SelectContent>
            {choices.slice(0, 200).map((m) => (
              <SelectItem key={m.userId} value={m.userId}>
                {label(m)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <label className="flex items-center gap-2 text-sm">
          <Input
            type="number"
            min={1}
            max={600}
            value={minutes}
            onChange={(e) => setMinutes(e.target.value)}
            className="w-20"
            aria-label="Extra minutes"
          />
          min
        </label>
        <Button
          variant="primary"
          disabled={busy || !userId || !(Number(minutes) >= 1 && Number(minutes) <= 600)}
          onClick={() => save(userId, Math.round(Number(minutes)))}
        >
          {busy ? <Spinner className="text-primary-foreground" /> : null}
          Give extra time
        </Button>
      </div>
      {students.hasMore ? (
        <div className="-mx-5 -mb-5">
          <LoadMore list={students} label="Load more students" />
        </div>
      ) : null}
    </Card>
  );
}
