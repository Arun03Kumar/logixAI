"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Pause, Play, Shuffle, StepForward } from "lucide-react";
import { Badge, Button, Card, Container, PageHeader } from "@logixai/ui";
import ArenaShell from "../../_components/ArenaShell";
import { Stat } from "../../_components/bits";
import { LabNav, Slider, mulberry32, normal, r2 } from "../LabBits";

/** Cluster colours from the design tokens (k is capped at 6). */
const COLORS = ["fill-primary", "fill-info", "fill-success", "fill-warning", "fill-danger", "fill-muted-foreground"];
const STROKES = ["stroke-primary", "stroke-info", "stroke-success", "stroke-warning", "stroke-danger", "stroke-muted-foreground"];

function makePoints(seed, blobs, spread) {
  const rand = mulberry32(seed);
  const centres = Array.from({ length: blobs }, () => [1.5 + rand() * 7, 1.5 + rand() * 7]);
  return Array.from({ length: 160 }, (_, i) => {
    const c = centres[i % blobs];
    return [c[0] + normal(rand) * spread, c[1] + normal(rand) * spread];
  });
}

const dist2 = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2;
const nearest = (p, cs) => cs.reduce((best, c, i) => (dist2(p, c) < dist2(p, cs[best]) ? i : best), 0);

/** k-means++: spread the starting centroids out. */
function initCentroids(points, k, seed, plusPlus) {
  const rand = mulberry32(seed);
  if (!plusPlus) return Array.from({ length: k }, () => points[Math.floor(rand() * points.length)]);
  const cs = [points[Math.floor(rand() * points.length)]];
  while (cs.length < k) {
    const d = points.map((p) => Math.min(...cs.map((c) => dist2(p, c))));
    const total = d.reduce((s, v) => s + v, 0);
    let r = rand() * total;
    let i = 0;
    while (r > d[i] && i < d.length - 1) r -= d[i++];
    cs.push(points[i]);
  }
  return cs;
}

function step(points, centroids) {
  const labels = points.map((p) => nearest(p, centroids));
  const next = centroids.map((c, j) => {
    const mine = points.filter((_, i) => labels[i] === j);
    if (!mine.length) return c; // an empty cluster keeps its centroid
    return [mine.reduce((s, p) => s + p[0], 0) / mine.length, mine.reduce((s, p) => s + p[1], 0) / mine.length];
  });
  return { labels, centroids: next };
}

const inertia = (points, centroids) => points.reduce((s, p) => s + dist2(p, centroids[nearest(p, centroids)]), 0);

function converge(points, k, seed) {
  let cs = initCentroids(points, k, seed, true);
  for (let i = 0; i < 50; i++) cs = step(points, cs).centroids;
  return inertia(points, cs);
}

const SIZE = 340;
const px = (v) => r2((v / 10) * SIZE);
const py = (v) => r2(SIZE - (v / 10) * SIZE);

function ElbowChart({ values, k }) {
  const W = 320;
  const H = 130;
  const max = Math.max(...values);
  const x = (i) => r2(20 + (i / (values.length - 1)) * (W - 30));
  const y = (v) => r2(H - 18 - (v / max) * (H - 30));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Inertia for k from 1 to 6">
      <rect width={W} height={H} rx="6" className="fill-muted" />
      <polyline points={values.map((v, i) => `${x(i)},${y(v)}`).join(" ")} fill="none" strokeWidth="2" className="stroke-primary" />
      {values.map((v, i) => (
        <g key={i}>
          <circle cx={x(i)} cy={y(v)} r={i + 1 === k ? 5 : 3} className={i + 1 === k ? "fill-primary" : "fill-muted-foreground"} />
          <text x={x(i)} y={H - 4} textAnchor="middle" className="fill-muted-foreground text-[10px]">
            {i + 1}
          </text>
        </g>
      ))}
    </svg>
  );
}

export default function KMeansLab() {
  const [seed, setSeed] = useState(4);
  const [blobs, setBlobs] = useState(3);
  const [spread, setSpread] = useState(0.7);
  const [k, setK] = useState(3);
  const [plusPlus, setPlusPlus] = useState(true);
  const [initSeed, setInitSeed] = useState(1);
  const points = useMemo(() => makePoints(seed, blobs, spread), [seed, blobs, spread]);
  const setup = `${seed}|${blobs}|${spread}|${k}|${initSeed}|${plusPlus}`;
  const fresh = () => ({ setup, centroids: initCentroids(points, k, initSeed, plusPlus), iteration: 0, moved: true });
  const [state, setState] = useState(fresh);
  const [playing, setPlaying] = useState(false);

  // Restart when the data or the setup changes (state reset during render, not in an effect).
  if (state.setup !== setup) {
    setState(fresh());
    setPlaying(false);
  }
  const running = playing && state.moved;

  useEffect(() => {
    if (!running) return undefined;
    const t = setTimeout(() => {
      setState((s) => {
        const { centroids } = step(points, s.centroids);
        const moved = centroids.some((c, i) => dist2(c, s.centroids[i]) > 1e-9);
        return { ...s, centroids, iteration: moved ? s.iteration + 1 : s.iteration, moved };
      });
    }, 450);
    return () => clearTimeout(t);
  }, [running, state, points]);

  const advance = () =>
    setState((s) => {
      const { centroids } = step(points, s.centroids);
      const moved = centroids.some((c, i) => dist2(c, s.centroids[i]) > 1e-9);
      return { ...s, centroids, iteration: moved ? s.iteration + 1 : s.iteration, moved };
    });

  const labels = points.map((p) => nearest(p, state.centroids));
  const elbow = useMemo(() => [1, 2, 3, 4, 5, 6].map((kk) => converge(points, kk, 7)), [points]);

  return (
    <ArenaShell>
      <Container size="xl" className="space-y-6">
        <PageHeader
          title="K-means lab"
          description="Assign every point to its nearest centroid, move each centroid to the mean of its points, repeat until nothing moves."
          actions={<LabNav />}
        />
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
          <Card className="space-y-4 p-4">
            <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="mx-auto w-full max-w-[520px]" role="img" aria-label="Points coloured by their cluster, with centroids">
              <rect width={SIZE} height={SIZE} rx="8" className="fill-muted" />
              {points.map((p, i) => (
                <circle key={i} cx={px(p[0])} cy={py(p[1])} r="3.5" className={`${COLORS[labels[i]]} opacity-70`} />
              ))}
              {state.centroids.map((c, j) => (
                <g key={j} transform={`translate(${px(c[0])},${py(c[1])})`}>
                  <circle r="9" className={`fill-card ${STROKES[j]}`} strokeWidth="3" />
                  <circle r="3" className={COLORS[j]} />
                </g>
              ))}
            </svg>
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={state.moved ? "warning" : "success"}>{state.moved ? "Still moving" : "Converged"}</Badge>
              <div className="ml-auto flex gap-2">
                <Button size="sm" onClick={advance} disabled={!state.moved || running}>
                  <StepForward />
                  Step
                </Button>
                <Button variant="primary" size="sm" onClick={() => setPlaying(!running)} disabled={!state.moved}>
                  {running ? <Pause /> : <Play />}
                  {running ? "Pause" : "Run"}
                </Button>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Stat label="Iterations" value={state.iteration} />
              <Stat label="Inertia (sum of squared distances)" value={inertia(points, state.centroids).toFixed(1)} />
            </div>
          </Card>

          <div className="space-y-4">
            <Card className="space-y-4 p-5">
              <Slider label="Clusters (k)" value={k} min={1} max={6} step={1} onChange={setK} />
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={plusPlus} onChange={(e) => setPlusPlus(e.target.checked)} className="size-4 accent-primary" />
                Spread out the starting centroids (k-means++)
              </label>
              <Button variant="ghost" size="sm" onClick={() => setInitSeed((s) => s + 1)}>
                <Shuffle />
                New starting centroids
              </Button>
            </Card>
            <Card className="space-y-4 p-5">
              <h2 className="text-sm font-semibold">Data</h2>
              <Slider label="True groups" value={blobs} min={1} max={6} step={1} onChange={setBlobs} />
              <Slider label="Spread" value={spread} min={0.2} max={2} step={0.1} onChange={setSpread} format={(v) => v.toFixed(1)} />
              <Button variant="ghost" size="sm" onClick={() => setSeed((s) => s + 1)}>
                <Shuffle />
                New data
              </Button>
            </Card>
            <Card className="space-y-2 p-5">
              <h2 className="text-sm font-semibold">Elbow chart: inertia for each k</h2>
              <ElbowChart values={elbow} k={k} />
              <p className="text-xs text-muted-foreground">
                Inertia always falls as k grows. Look for the bend where adding a cluster stops helping much — usually the
                number of real groups.
              </p>
            </Card>
            <Card className="space-y-2 p-5 text-sm text-muted-foreground">
              <p>
                <span className="font-medium text-foreground">Try this.</span> Turn off k-means++ and click “New starting
                centroids” a few times: plain random starts sometimes put two centroids in one group and merge two others —
                a worse local minimum. That&apos;s why libraries run k-means several times (<code className="font-mono text-xs">n_init</code>) and keep the best.
              </p>
              <p>
                Practise the maths behind it:{" "}
                <Link href="/arena/topics/broadcasting" className="text-primary underline underline-offset-2">
                  pairwise distances with broadcasting
                </Link>
              </p>
            </Card>
          </div>
        </div>
      </Container>
    </ArenaShell>
  );
}
