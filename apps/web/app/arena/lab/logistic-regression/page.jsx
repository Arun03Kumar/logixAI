"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Pause, Play, RotateCcw, Shuffle } from "lucide-react";
import { Button, Card, Container, PageHeader, cn } from "@logixai/ui";
import ArenaShell from "../../_components/ArenaShell";
import { Stat } from "../../_components/bits";
import { LabNav, LossChart, Slider, mulberry32, normal, r2 } from "../LabBits";

const SHAPES = {
  blobs: "Two groups",
  circle: "Ring around a centre",
  xor: "Opposite corners (XOR)",
};

/** Points in [-1, 1]², label 0 or 1. */
function makeData(shape, seed, noise) {
  const rand = mulberry32(seed);
  return Array.from({ length: 140 }, (_, i) => {
    if (shape === "blobs") {
      const y = i % 2;
      const c = y ? [0.4, 0.35] : [-0.4, -0.3];
      return { x: [c[0] + normal(rand) * 0.25 * noise, c[1] + normal(rand) * 0.25 * noise], y };
    }
    const x = [rand() * 2 - 1, rand() * 2 - 1];
    const jitter = () => normal(rand) * 0.08 * noise;
    if (shape === "circle") return { x, y: Math.hypot(x[0] + jitter(), x[1] + jitter()) < 0.55 ? 1 : 0 };
    return { x, y: (x[0] + jitter()) * (x[1] + jitter()) > 0 ? 1 : 0 };
  });
}

/** Optional squared and product terms let a linear model draw curved boundaries. */
const features = (x, extra) => (extra ? [x[0], x[1], x[0] * x[0], x[1] * x[1], x[0] * x[1]] : [x[0], x[1]]);
const sigmoid = (z) => 1 / (1 + Math.exp(-z));
const predict = (m, x, extra) => sigmoid(features(x, extra).reduce((s, f, i) => s + f * m.w[i], m.b));

function trainStep(data, m, lr, extra, lambda) {
  const d = m.w.length;
  const gw = new Array(d).fill(0);
  let gb = 0;
  for (const p of data) {
    const f = features(p.x, extra);
    const err = predict(m, p.x, extra) - p.y;
    for (let j = 0; j < d; j++) gw[j] += (err * f[j]) / data.length;
    gb += err / data.length;
  }
  return { w: m.w.map((w, j) => w - lr * (gw[j] + lambda * w)), b: m.b - lr * gb };
}

function metrics(data, m, extra) {
  let loss = 0;
  let right = 0;
  for (const p of data) {
    const q = Math.min(Math.max(predict(m, p.x, extra), 1e-9), 1 - 1e-9);
    loss -= p.y * Math.log(q) + (1 - p.y) * Math.log(1 - q);
    if ((q >= 0.5 ? 1 : 0) === p.y) right++;
  }
  return { loss: loss / data.length, accuracy: right / data.length };
}

const SIZE = 340;
const GRID = 34;
const toPx = (v) => r2(((v + 1) / 2) * SIZE);
const toPy = (v) => r2(SIZE - ((v + 1) / 2) * SIZE);
const zero = (extra) => ({ w: new Array(extra ? 5 : 2).fill(0), b: 0 });

export default function LogisticLab() {
  const [shape, setShape] = useState("blobs");
  const [seed, setSeed] = useState(3);
  const [noise, setNoise] = useState(1);
  const [extra, setExtra] = useState(false);
  const [lr, setLr] = useState(1);
  const [lambda, setLambda] = useState(0);
  const [model, setModel] = useState(() => zero(false));
  const [history, setHistory] = useState([]);
  const [running, setRunning] = useState(false);
  const modelRef = useRef(model);
  const data = useMemo(() => makeData(shape, seed, noise), [shape, seed, noise]);

  const reset = (nextExtra = extra) => {
    setRunning(false);
    const m = zero(nextExtra);
    modelRef.current = m;
    setModel(m);
    setHistory([]);
  };

  useEffect(() => {
    if (!running) return undefined;
    const timer = setInterval(() => {
      let m = modelRef.current;
      for (let i = 0; i < 5; i++) m = trainStep(data, m, lr, extra, lambda);
      modelRef.current = m;
      setModel(m);
      setHistory((h) => [...h.slice(-299), metrics(data, m, extra).loss]);
    }, 50);
    return () => clearInterval(timer);
  }, [running, data, lr, extra, lambda]);

  const { loss, accuracy } = metrics(data, model, extra);
  const cell = SIZE / GRID;
  const grid = [];
  for (let i = 0; i < GRID; i++) {
    for (let j = 0; j < GRID; j++) {
      const x = [((i + 0.5) / GRID) * 2 - 1, 1 - ((j + 0.5) / GRID) * 2];
      grid.push({ i, j, p: predict(model, x, extra) });
    }
  }

  return (
    <ArenaShell>
      <Container size="xl" className="space-y-6">
        <PageHeader
          title="Decision boundary lab"
          description="Logistic regression draws one boundary where the probability crosses 50%. Train it and watch where it can — and can't — separate the classes."
          actions={<LabNav />}
        />
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
          <Card className="space-y-4 p-4">
            <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="mx-auto w-full max-w-[520px]" role="img" aria-label="Predicted probability shaded over the plane, with the data points">
              <rect width={SIZE} height={SIZE} rx="8" className="fill-muted" />
              {grid.map(({ i, j, p }) => (
                <rect
                  key={`${i}-${j}`}
                  x={i * cell}
                  y={j * cell}
                  width={cell + 0.5}
                  height={cell + 0.5}
                  className={p >= 0.5 ? "fill-primary" : "fill-info"}
                  opacity={r2(Math.min(0.45, Math.abs(p - 0.5) * 0.9))}
                />
              ))}
              {data.map((p, k) => (
                <circle
                  key={k}
                  cx={toPx(p.x[0])}
                  cy={toPy(p.x[1])}
                  r="4"
                  strokeWidth="1.5"
                  className={cn("stroke-card", p.y ? "fill-primary" : "fill-info")}
                />
              ))}
            </svg>
            <p className="text-xs text-muted-foreground">
              Orange: class 1, blue: class 0. Shading shows the predicted probability; the boundary is where the colours meet.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Stat label="Accuracy" value={`${Math.round(accuracy * 100)}%`} />
              <Stat label="Log loss" value={loss.toFixed(3)} />
            </div>
          </Card>

          <div className="space-y-4">
            <Card className="space-y-4 p-5">
              <h2 className="text-sm font-semibold">Data</h2>
              <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Data shape">
                {Object.entries(SHAPES).map(([key, label]) => (
                  <Button
                    key={key}
                    size="sm"
                    variant={shape === key ? "secondary" : "ghost"}
                    aria-pressed={shape === key}
                    onClick={() => {
                      setShape(key);
                      reset();
                    }}
                  >
                    {label}
                  </Button>
                ))}
              </div>
              <Slider label="Noise" value={noise} min={0.2} max={2.5} step={0.1} onChange={(v) => { setNoise(v); reset(); }} format={(v) => v.toFixed(1)} />
              <Button variant="ghost" size="sm" onClick={() => { setSeed((s) => s + 1); reset(); }}>
                <Shuffle />
                New data
              </Button>
            </Card>
            <Card className="space-y-4 p-5">
              <h2 className="text-sm font-semibold">Model</h2>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={extra}
                  onChange={(e) => {
                    setExtra(e.target.checked);
                    reset(e.target.checked);
                  }}
                  className="size-4 accent-primary"
                />
                Add x₁², x₂² and x₁·x₂ features
              </label>
              <Slider label="Learning rate" value={lr} min={0.1} max={5} step={0.1} onChange={setLr} format={(v) => v.toFixed(1)} />
              <Slider label="L2 penalty (λ)" value={lambda} min={0} max={0.2} step={0.005} onChange={setLambda} format={(v) => v.toFixed(3)} />
              <div className="flex gap-2">
                <Button variant="primary" size="sm" onClick={() => setRunning((r) => !r)}>
                  {running ? <Pause /> : <Play />}
                  {running ? "Pause" : "Train"}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => reset()} aria-label="Reset the model">
                  <RotateCcw />
                </Button>
              </div>
              <LossChart values={history} />
            </Card>
            <Card className="space-y-2 p-5 text-sm text-muted-foreground">
              <p>
                <span className="font-medium text-foreground">Try this.</span> Train on the ring or XOR data: accuracy
                stalls near 50–60%, because a single straight line can&apos;t separate them. Tick the extra features and train
                again — the same linear model, given squared and product terms, draws a curved boundary.
              </p>
              <p>That&apos;s feature engineering, and it&apos;s what a neural network&apos;s hidden layers learn to do on their own.</p>
              <p>
                Practise it:{" "}
                <Link href="/arena/topics/logistic-regression" className="text-primary underline underline-offset-2">
                  Logistic regression from scratch
                </Link>
              </p>
            </Card>
          </div>
        </div>
      </Container>
    </ArenaShell>
  );
}
