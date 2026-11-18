"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Pause, Play, RotateCcw } from "lucide-react";
import { Badge, Button, Card, Container, PageHeader } from "@logixai/ui";
import ArenaShell from "../../_components/ArenaShell";
import { LabNav, LossChart, Slider } from "../LabBits";

/** f(x, y) = (x² + k·y²) / 2: a bowl stretched k times along y. */
const loss = (k, [x, y]) => (x * x + k * y * y) / 2;
const grad = (k, [x, y]) => [x, k * y];

function descend({ k, lr, momentum, steps, start }) {
  const path = [start];
  let p = start;
  let v = [0, 0];
  for (let i = 0; i < steps; i++) {
    const g = grad(k, p);
    v = [momentum * v[0] - lr * g[0], momentum * v[1] - lr * g[1]];
    p = [p[0] + v[0], p[1] + v[1]];
    path.push(p);
    if (!Number.isFinite(p[0]) || Math.abs(p[0]) > 1e6 || Math.abs(p[1]) > 1e6) break;
  }
  return path;
}

const SIZE = 360;
const RANGE = 5;
const toPx = (v) => ((v + RANGE) / (2 * RANGE)) * SIZE;
const toPy = (v) => SIZE - ((v + RANGE) / (2 * RANGE)) * SIZE;
const clampPx = (v) => Math.max(-40, Math.min(SIZE + 40, v));

function verdict(path, k) {
  const last = path[path.length - 1];
  const f = loss(k, last);
  if (!Number.isFinite(f) || f > 1e4) return { label: "Diverged", tone: "danger" };
  if (f < 1e-4) return { label: "Converged", tone: "success" };
  if (f > loss(k, path[0])) return { label: "Getting worse", tone: "danger" };
  return { label: "Still descending", tone: "warning" };
}

export default function GradientDescentLab() {
  const [lr, setLr] = useState(0.1);
  const [k, setK] = useState(5);
  const [momentum, setMomentum] = useState(0);
  const [steps, setSteps] = useState(40);
  const [start, setStart] = useState([-4, 3]);
  const [shown, setShown] = useState(40);
  const [playing, setPlaying] = useState(false);

  const path = useMemo(() => descend({ k, lr, momentum, steps, start }), [k, lr, momentum, steps, start]);
  const visible = path.slice(0, Math.min(shown, path.length - 1) + 1);
  const losses = path.map((p) => loss(k, p));
  const status = verdict(path, k);
  const limit = 2 / k;

  useEffect(() => {
    if (!playing) return undefined;
    const timer = setInterval(() => {
      setShown((s) => {
        if (s >= path.length - 1) {
          setPlaying(false);
          return s;
        }
        return s + 1;
      });
    }, 120);
    return () => clearInterval(timer);
  }, [playing, path.length]);

  // Any change shows the full new path.
  const update = (fn) => (v) => {
    fn(v);
    setPlaying(false);
    setShown(Infinity);
  };

  const pickStart = (e) => {
    const box = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - box.left) / box.width) * 2 * RANGE - RANGE;
    const y = RANGE - ((e.clientY - box.top) / box.height) * 2 * RANGE;
    update(setStart)([Math.round(x * 10) / 10, Math.round(y * 10) / 10]);
  };

  const levels = [0.5, 2, 5, 10, 20, 40];

  return (
    <ArenaShell>
      <Container size="xl" className="space-y-6">
        <PageHeader
          title="Gradient descent lab"
          description="Minimise a stretched bowl, f(x, y) = (x² + k·y²) / 2. Click the plot to choose a starting point."
          actions={<LabNav />}
        />
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
          <Card className="space-y-3 p-4">
            <svg
              viewBox={`0 0 ${SIZE} ${SIZE}`}
              className="mx-auto w-full max-w-[560px] cursor-crosshair touch-manipulation"
              onClick={pickStart}
              role="img"
              aria-label="Contour plot of the loss with the gradient descent path"
            >
              <rect width={SIZE} height={SIZE} rx="8" className="fill-muted" />
              <line x1={toPx(-RANGE)} x2={toPx(RANGE)} y1={toPy(0)} y2={toPy(0)} className="stroke-border" />
              <line y1={toPy(-RANGE)} y2={toPy(RANGE)} x1={toPx(0)} x2={toPx(0)} className="stroke-border" />
              {levels.map((c) => (
                <ellipse
                  key={c}
                  cx={toPx(0)}
                  cy={toPy(0)}
                  rx={(Math.sqrt(2 * c) / (2 * RANGE)) * SIZE}
                  ry={(Math.sqrt((2 * c) / k) / (2 * RANGE)) * SIZE}
                  fill="none"
                  className="stroke-muted-foreground/40"
                />
              ))}
              <polyline
                points={visible.map((p) => `${clampPx(toPx(p[0]))},${clampPx(toPy(p[1]))}`).join(" ")}
                fill="none"
                strokeWidth="2"
                className="stroke-primary"
              />
              {visible.map((p, i) => (
                <circle key={i} cx={clampPx(toPx(p[0]))} cy={clampPx(toPy(p[1]))} r={i === 0 ? 5 : 2.5} className="fill-primary" />
              ))}
              <circle cx={toPx(0)} cy={toPy(0)} r="4" className="fill-success" />
            </svg>
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={status.tone}>{status.label}</Badge>
              <span className="text-sm text-muted-foreground">
                After {path.length - 1} steps: loss {losses[losses.length - 1]?.toExponential(2)}
              </span>
              <div className="ml-auto flex gap-2">
                <Button
                  size="sm"
                  onClick={() => {
                    if (shown >= path.length - 1) setShown(0);
                    setPlaying((p) => !p);
                  }}
                >
                  {playing ? <Pause /> : <Play />}
                  {playing ? "Pause" : "Play"}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => update(setStart)([-4, 3])} aria-label="Reset start point">
                  <RotateCcw />
                </Button>
              </div>
            </div>
          </Card>

          <div className="space-y-4">
            <Card className="space-y-4 p-5">
              <Slider label="Learning rate" value={lr} min={0.01} max={1.2} step={0.01} onChange={update(setLr)} />
              <Slider label="Stretch (k)" value={k} min={1} max={20} step={1} onChange={update(setK)} />
              <Slider label="Momentum" value={momentum} min={0} max={0.95} step={0.05} onChange={update(setMomentum)} />
              <Slider label="Steps" value={steps} min={1} max={100} step={1} onChange={update(setSteps)} />
            </Card>
            <Card className="space-y-2 p-5">
              <h2 className="text-sm font-semibold">Loss per step</h2>
              <LossChart values={losses} current={Math.min(shown, losses.length - 1)} />
            </Card>
            <Card className="space-y-2 p-5 text-sm text-muted-foreground">
              <p>
                <span className="font-medium text-foreground">Try this.</span> Without momentum, plain gradient descent is
                stable only while the learning rate is below 2 / k ={" "}
                <span className="font-mono text-foreground">{limit.toFixed(2)}</span>. Push past it and watch the path
                zig-zag across the steep direction and blow up.
              </p>
              <p>
                With a large k the bowl is a narrow valley: a rate small enough for the steep y direction crawls along x.
                Add momentum to speed up the slow direction — this is why optimisers like Adam exist.
              </p>
              <p>
                Practise it:{" "}
                <Link href="/arena/topics/gradients" className="text-primary underline underline-offset-2">
                  Gradients and gradient descent
                </Link>
              </p>
            </Card>
          </div>
        </div>
      </Container>
    </ArenaShell>
  );
}
