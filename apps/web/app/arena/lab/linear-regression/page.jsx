"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Pause, Play, Shuffle, Target } from "lucide-react";
import { Button, Card, Container, PageHeader } from "@logixai/ui";
import ArenaShell from "../../_components/ArenaShell";
import { Stat } from "../../_components/bits";
import { LabNav, LossChart, Slider, mulberry32, normal } from "../LabBits";

const N = 30;
const TRUE_W = 1.2;
const TRUE_B = 2;

function makeData(seed, noise) {
  const rand = mulberry32(seed);
  return Array.from({ length: N }, () => {
    const x = rand() * 10;
    return { x, y: TRUE_W * x + TRUE_B + normal(rand) * noise };
  });
}

const mse = (data, w, b) => data.reduce((s, p) => s + (w * p.x + b - p.y) ** 2, 0) / data.length;

function bestFit(data) {
  const n = data.length;
  const mx = data.reduce((s, p) => s + p.x, 0) / n;
  const my = data.reduce((s, p) => s + p.y, 0) / n;
  const sxy = data.reduce((s, p) => s + (p.x - mx) * (p.y - my), 0);
  const sxx = data.reduce((s, p) => s + (p.x - mx) ** 2, 0);
  const w = sxy / sxx;
  return { w, b: my - w * mx };
}

function gdStep(data, w, b, lr) {
  const n = data.length;
  let gw = 0;
  let gb = 0;
  for (const p of data) {
    const r = w * p.x + b - p.y;
    gw += (2 / n) * r * p.x;
    gb += (2 / n) * r;
  }
  return { w: w - lr * gw, b: b - lr * gb };
}

const W = 420;
const H = 300;
const X_MAX = 10;
const Y_MIN = -4;
const Y_MAX = 20;
const px = (x) => 30 + (x / X_MAX) * (W - 40);
const py = (y) => H - 24 - ((y - Y_MIN) / (Y_MAX - Y_MIN)) * (H - 34);
const clampY = (v) => Math.max(-200, Math.min(H + 200, v));
const round = (v, d = 2) => (Number.isFinite(v) ? v.toFixed(d) : "∞");

export default function LinearRegressionLab() {
  const [seed, setSeed] = useState(7);
  const [noise, setNoise] = useState(2);
  const [w, setW] = useState(0);
  const [b, setB] = useState(5);
  const [lr, setLr] = useState(0.01);
  const [running, setRunning] = useState(false);
  const [history, setHistory] = useState([]);
  const state = useRef({ w: 0, b: 5 });

  const data = useMemo(() => makeData(seed, noise), [seed, noise]);
  const best = useMemo(() => bestFit(data), [data]);
  const loss = mse(data, w, b);
  const bestLoss = mse(data, best.w, best.b);

  useEffect(() => {
    state.current = { w, b };
  }, [w, b]);

  useEffect(() => {
    if (!running) return undefined;
    const timer = setInterval(() => {
      const next = gdStep(data, state.current.w, state.current.b, lr);
      const l = mse(data, next.w, next.b);
      if (!Number.isFinite(l) || l > 1e8) setRunning(false);
      state.current = next;
      setW(next.w);
      setB(next.b);
      setHistory((h) => [...h.slice(-199), l]);
    }, 60);
    return () => clearInterval(timer);
  }, [running, data, lr]);

  const manual = (set) => (v) => {
    setRunning(false);
    setHistory([]);
    set(v);
  };

  return (
    <ArenaShell>
      <Container size="xl" className="space-y-6">
        <PageHeader
          title="Linear regression lab"
          description="Fit ŷ = w·x + b to noisy data. Move the line yourself, then let gradient descent do it."
          actions={<LabNav />}
        />
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
          <Card className="space-y-4 p-4">
            <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Scatter plot with the current line and its residuals">
              <rect width={W} height={H} rx="8" className="fill-muted" />
              <line x1={px(0)} x2={px(X_MAX)} y1={py(0)} y2={py(0)} className="stroke-border" />
              {data.map((p, i) => (
                <line
                  key={`r${i}`}
                  x1={px(p.x)}
                  x2={px(p.x)}
                  y1={py(p.y)}
                  y2={clampY(py(w * p.x + b))}
                  className="stroke-danger/40"
                />
              ))}
              <line
                x1={px(0)}
                x2={px(X_MAX)}
                y1={py(best.b)}
                y2={py(best.w * X_MAX + best.b)}
                strokeDasharray="5 4"
                className="stroke-success"
              />
              <line
                x1={px(0)}
                x2={px(X_MAX)}
                y1={clampY(py(b))}
                y2={clampY(py(w * X_MAX + b))}
                strokeWidth="2.5"
                className="stroke-primary"
              />
              {data.map((p, i) => (
                <circle key={i} cx={px(p.x)} cy={py(p.y)} r="3.5" className="fill-foreground" />
              ))}
            </svg>
            <p className="text-xs text-muted-foreground">
              Solid: your line. Dashed: the least-squares best fit. Red lines: residuals (errors) — the MSE is the mean of their squares.
            </p>
            <div className="grid gap-3 sm:grid-cols-3">
              <Stat label="Your MSE" value={round(loss)} />
              <Stat label="Best possible MSE" value={round(bestLoss)} />
              <Stat label="Best fit" value={`w ${round(best.w)}, b ${round(best.b)}`} />
            </div>
          </Card>

          <div className="space-y-4">
            <Card className="space-y-4 p-5">
              <h2 className="text-sm font-semibold">Your line</h2>
              <Slider label="Slope w" value={w} min={-2} max={4} step={0.01} onChange={manual(setW)} format={(v) => round(v)} />
              <Slider label="Intercept b" value={b} min={-5} max={12} step={0.01} onChange={manual(setB)} format={(v) => round(v)} />
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  manual(setW)(best.w);
                  setB(best.b);
                }}
              >
                <Target />
                Snap to best fit
              </Button>
            </Card>
            <Card className="space-y-4 p-5">
              <h2 className="text-sm font-semibold">Gradient descent</h2>
              <Slider label="Learning rate" value={lr} min={0.001} max={0.05} step={0.001} onChange={setLr} format={(v) => v.toFixed(3)} />
              <Button variant="primary" size="sm" onClick={() => setRunning((r) => !r)}>
                {running ? <Pause /> : <Play />}
                {running ? "Pause" : "Train from here"}
              </Button>
              <LossChart values={history} />
            </Card>
            <Card className="space-y-4 p-5">
              <h2 className="text-sm font-semibold">Data</h2>
              <Slider label="Noise" value={noise} min={0} max={5} step={0.1} onChange={(v) => { setNoise(v); setHistory([]); }} format={(v) => round(v, 1)} />
              <Button variant="ghost" size="sm" onClick={() => { setSeed((s) => s + 1); setHistory([]); }}>
                <Shuffle />
                New data
              </Button>
            </Card>
            <Card className="space-y-2 p-5 text-sm text-muted-foreground">
              <p>
                <span className="font-medium text-foreground">Try this.</span> Set the learning rate above about 0.03:
                x runs up to 10, so the slope&apos;s gradient is large and each step overshoots. Scaling features (standardising)
                is what lets one learning rate work for every weight.
              </p>
              <p>
                With zero noise the best MSE is 0. With noise it can&apos;t be — that leftover error is noise the model
                can&apos;t explain, not a bad fit.
              </p>
              <p>
                Practise it:{" "}
                <Link href="/arena/topics/linear-regression" className="text-primary underline underline-offset-2">
                  Linear regression from scratch
                </Link>
              </p>
            </Card>
          </div>
        </div>
      </Container>
    </ArenaShell>
  );
}
