"use client";
import Link from "next/link";
import { cn } from "@logixai/ui";
import { LABS } from "../_components/labels";

/** Small seeded random generator so "new data" is repeatable per seed. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Standard normal from a uniform generator (Box–Muller). */
export function normal(rand) {
  const u = Math.max(rand(), 1e-12);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
}

export function Slider({ label, value, min, max, step, onChange, format = (v) => v }) {
  const id = `slider-${label.replace(/\W+/g, "-").toLowerCase()}`;
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-sm">
        <label htmlFor={id} className="font-medium">
          {label}
        </label>
        <span className="font-mono tabular-nums text-muted-foreground">{format(value)}</span>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-primary"
      />
    </div>
  );
}

/** Loss per step as a line, log scale when values span orders of magnitude. */
export function LossChart({ values, current, height = 140 }) {
  const W = 320;
  const H = height;
  const finite = values.filter((v) => Number.isFinite(v) && v > 0);
  if (finite.length < 2) {
    return <p className="text-sm text-muted-foreground">The loss curve appears once there are a few steps.</p>;
  }
  const logs = finite.map(Math.log10);
  const lo = Math.min(...logs);
  const hi = Math.max(...logs);
  const span = hi - lo || 1;
  const pts = values
    .map((v, i) => {
      if (!(Number.isFinite(v) && v > 0)) return null;
      const x = (i / (values.length - 1)) * (W - 8) + 4;
      const y = H - 6 - ((Math.log10(v) - lo) / span) * (H - 12);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .filter(Boolean)
    .join(" ");
  const cx = current != null ? (current / (values.length - 1)) * (W - 8) + 4 : null;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Loss over training steps (log scale)">
      <rect x="0" y="0" width={W} height={H} rx="6" className="fill-muted" />
      <polyline points={pts} fill="none" strokeWidth="2" className="stroke-primary" strokeLinejoin="round" />
      {cx != null ? <line x1={cx} x2={cx} y1="4" y2={H - 4} strokeDasharray="3 3" className="stroke-muted-foreground" /> : null}
    </svg>
  );
}

export function LabNav() {
  return (
    <div className="flex flex-wrap gap-2">
      {LABS.map((lab) => (
        <Link
          key={lab.href}
          href={lab.href}
          className={cn("rounded-md border border-border px-3 py-1 text-sm hover:bg-accent")}
        >
          {lab.title}
        </Link>
      ))}
    </div>
  );
}
