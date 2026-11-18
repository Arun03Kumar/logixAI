"use client";
import { useState } from "react";
import Link from "next/link";
import toast from "react-hot-toast";
import { BrainCircuit, Trash2 } from "lucide-react";
import {
  Button,
  Card,
  EmptyState,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  cn,
} from "@logixai/ui";
import { arenaApi } from "@/app/lib/api/arena";
import { identityApi } from "@/app/lib/api/identity";
import { useApi } from "@/app/lib/api/useApi";
import { MasteryBar } from "@/app/arena/_components/bits";
import { canView, formatDate } from "../../labels";

const pct = (v) => `${Math.round((v ?? 0) * 100)}%`;

/** Mastery heat cell: stronger tint = higher mastery. */
function Heat({ value }) {
  const tone =
    value >= 0.8 ? "bg-success-soft text-success" : value >= 0.5 ? "bg-primary-soft text-primary-soft-foreground" : value > 0 ? "bg-warning-soft text-warning" : "bg-muted text-muted-foreground";
  return <span className={cn("inline-block min-w-11 rounded px-1.5 py-0.5 text-center text-xs tabular-nums", tone)}>{pct(value)}</span>;
}

function AssignForm({ institutionId, batches, tracks, onAssigned }) {
  const [batchId, setBatchId] = useState("");
  const [trackId, setTrackId] = useState("");
  const [due, setDue] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const created = await arenaApi.assignTrack(institutionId, {
        batchId,
        trackId,
        dueAt: due ? new Date(`${due}T23:59:59`).toISOString() : null,
      });
      onAssigned(created);
      toast.success(`${created.trackTitle} assigned.`);
      setTrackId("");
      setDue("");
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
      <div className="space-y-1">
        <span className="text-xs font-medium text-muted-foreground">Batch</span>
        <Select value={batchId} onValueChange={setBatchId}>
          <SelectTrigger className="w-44" aria-label="Batch">
            <SelectValue placeholder="Choose a batch" />
          </SelectTrigger>
          <SelectContent>
            {batches.map((b) => (
              <SelectItem key={b.id} value={b.id}>
                {b.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1">
        <span className="text-xs font-medium text-muted-foreground">Track</span>
        <Select value={trackId} onValueChange={setTrackId}>
          <SelectTrigger className="w-60" aria-label="Track">
            <SelectValue placeholder="Choose a track" />
          </SelectTrigger>
          <SelectContent>
            {tracks.map((t) => (
              <SelectItem key={t.id} value={t.id}>
                {t.title}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1">
        <label htmlFor="arena-due" className="text-xs font-medium text-muted-foreground">
          Due (optional)
        </label>
        <Input id="arena-due" type="date" value={due} onChange={(e) => setDue(e.target.value)} className="w-40" />
      </div>
      <Button type="submit" variant="primary" disabled={!batchId || !trackId || saving}>
        {saving ? "Assigning…" : "Assign"}
      </Button>
    </form>
  );
}

function Report({ institutionId, batches, assignments }) {
  const [pick, setPick] = useState(() => (assignments[0] ? `${assignments[0].batchId}|${assignments[0].trackId}` : ""));
  const [batchId, trackId] = pick ? pick.split("|") : ["", ""];
  const report = useApi(() => arenaApi.batchReport(institutionId, batchId, trackId), [institutionId, pick], {
    enabled: Boolean(pick),
  });
  const batchName = (id) => batches.find((b) => b.id === id)?.name ?? "Batch";

  if (!assignments.length) return null;
  const r = report.data;
  const weakest = r?.topicAverages.length ? r.topicAverages.indexOf(Math.min(...r.topicAverages)) : -1;

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
        <h2 className="font-semibold">Batch report</h2>
        <Select value={pick} onValueChange={setPick}>
          <SelectTrigger className="w-72" aria-label="Assignment to report on">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {assignments.map((a) => (
              <SelectItem key={a.id} value={`${a.batchId}|${a.trackId}`}>
                {batchName(a.batchId)} · {a.trackTitle}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {report.loading ? (
        <div className="p-5">
          <Skeleton className="h-32" />
        </div>
      ) : report.error ? (
        <EmptyState title="Couldn't load the report" description={report.error.message} />
      ) : r && r.rows.length === 0 ? (
        <EmptyState title="No students in this batch yet" description="Students appear here once they join with an invite code for the batch." />
      ) : r ? (
        <>
          {weakest >= 0 && r.topicAverages[weakest] < 0.5 ? (
            <p className="border-t border-border bg-warning-soft px-5 py-2.5 text-sm">
              The batch is weakest on <span className="font-medium">{r.topics[weakest].title}</span> (average{" "}
              {pct(r.topicAverages[weakest])}). Worth a class session.
            </p>
          ) : null}
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Student</TableHead>
                  <TableHead>Solved</TableHead>
                  <TableHead className="min-w-36">Mastery</TableHead>
                  {r.topics.map((t, i) => (
                    <TableHead key={t.id} className="whitespace-nowrap text-center" title={t.title}>
                      <span className="block max-w-24 truncate">{t.title}</span>
                      <span className="text-[11px] font-normal text-muted-foreground">avg {pct(r.topicAverages[i])}</span>
                    </TableHead>
                  ))}
                  <TableHead>XP</TableHead>
                  <TableHead>Last active</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {r.rows.map((row) => (
                  <TableRow key={row.userId}>
                    <TableCell>
                      <p className="font-medium">{row.name}</p>
                      <p className="text-xs text-muted-foreground">{row.email}</p>
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {row.solvedCount}/{r.track.itemCount}
                    </TableCell>
                    <TableCell>
                      <MasteryBar value={row.mastery} />
                    </TableCell>
                    {row.topicMastery.map((m, i) => (
                      <TableCell key={i} className="text-center">
                        <Heat value={m} />
                      </TableCell>
                    ))}
                    <TableCell className="tabular-nums">{row.xp}</TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">{formatDate(row.lastActiveAt)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      ) : null}
    </Card>
  );
}

function StaffView({ institutionId }) {
  const batches = useApi(() => identityApi.listBatches(institutionId), [institutionId]);
  const tracks = useApi(() => arenaApi.tracks(), []);
  const assignments = useApi(() => arenaApi.assignments(institutionId), [institutionId]);

  if (batches.loading || tracks.loading || assignments.loading) return <Skeleton className="h-40" />;
  if (assignments.error || tracks.error) {
    return (
      <Card>
        <EmptyState
          title="ML Arena isn't reachable"
          description={(assignments.error ?? tracks.error).message}
          action={
            <Button size="sm" onClick={assignments.reload}>
              Retry
            </Button>
          }
        />
      </Card>
    );
  }
  const rows = assignments.data ?? [];
  const batchName = (id) => batches.data?.find((b) => b.id === id)?.name ?? "Removed batch";

  const remove = async (a) => {
    if (!window.confirm(`Stop assigning ${a.trackTitle} to ${batchName(a.batchId)}? Students keep their progress.`)) return;
    try {
      await arenaApi.unassignTrack(institutionId, a.id);
      assignments.setData((list) => list.filter((x) => x.id !== a.id));
    } catch (err) {
      toast.error(err.message);
    }
  };

  return (
    <div className="space-y-6">
      <Card className="space-y-4 p-5">
        <div>
          <h2 className="font-semibold">Assign practice</h2>
          <p className="text-sm text-muted-foreground">
            Students in the batch see the track on their ML Arena page, and you can follow their progress below.
          </p>
        </div>
        {batches.data?.length ? (
          <AssignForm
            institutionId={institutionId}
            batches={batches.data}
            tracks={tracks.data}
            onAssigned={(a) => assignments.setData((list) => [a, ...(list ?? [])])}
          />
        ) : (
          <p className="text-sm text-muted-foreground">Create a batch first, in the Batches tab.</p>
        )}
        {rows.length ? (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {rows.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm">
                <Link href={`/arena/tracks/${a.trackId}`} className="font-medium hover:text-primary">
                  {a.trackTitle}
                </Link>
                <span className="text-muted-foreground">→ {batchName(a.batchId)}</span>
                <span className="text-muted-foreground">{a.dueAt ? `due ${formatDate(a.dueAt)}` : "no due date"}</span>
                <Button variant="ghost" size="icon-sm" className="ml-auto" aria-label={`Remove ${a.trackTitle}`} onClick={() => remove(a)}>
                  <Trash2 />
                </Button>
              </li>
            ))}
          </ul>
        ) : null}
      </Card>
      <Report key={rows.map((a) => a.id).join()} institutionId={institutionId} batches={batches.data ?? []} assignments={rows} />
    </div>
  );
}

function StudentView({ institutionId }) {
  const assignments = useApi(() => arenaApi.assignments(institutionId), [institutionId]);
  if (assignments.loading) return <Skeleton className="h-24" />;
  const rows = assignments.data ?? [];
  if (!rows.length) {
    return (
      <Card>
        <EmptyState
          icon={<BrainCircuit />}
          title="No practice assigned yet"
          description="Your instructors can assign ML Arena tracks to your batch. You can still practise anything in ML Arena."
          action={
            <Button asChild size="sm">
              <Link href="/arena">Open ML Arena</Link>
            </Button>
          }
        />
      </Card>
    );
  }
  return (
    <Card className="overflow-hidden">
      <ul className="divide-y divide-border">
        {rows.map((a) => (
          <li key={a.id}>
            <Link href={`/arena/tracks/${a.trackId}`} className="flex items-center gap-3 px-5 py-3 hover:bg-accent">
              <span className="font-medium">{a.trackTitle}</span>
              <span className="ml-auto text-sm text-muted-foreground">{a.dueAt ? `Due ${formatDate(a.dueAt)}` : ""}</span>
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/** ML Arena inside an institution: staff assign tracks and see reports; students see their assignments. */
export default function ArenaTab({ institutionId, myRole }) {
  return canView(myRole) ? <StaffView institutionId={institutionId} /> : <StudentView institutionId={institutionId} />;
}
