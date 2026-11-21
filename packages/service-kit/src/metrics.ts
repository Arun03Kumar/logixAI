import { randomUUID } from "node:crypto";
import { monitorEventLoopDelay } from "node:perf_hooks";

/**
 * Prometheus metrics without dependencies (text exposition format 0.0.4).
 *
 * Every service exposes GET /metrics (internal: the router never forwards it).
 * Shared series:
 *   http_request_duration_seconds{service,method,route,status}  histogram
 *   process_resident_memory_bytes, nodejs_heap_used_bytes,
 *   nodejs_eventloop_delay_p99_seconds, process_uptime_seconds  gauges
 *   mongodb_pool_checked_out{service}                          gauge (services with MongoDB)
 * plus what each service adds (judge queue backlog, judge time, ...).
 */

type Labels = Record<string, string>;

const escapeLabel = (v: string) => v.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/"/g, '\\"');
const labelText = (labels: Labels) => {
  const parts = Object.entries(labels).map(([k, v]) => `${k}="${escapeLabel(v)}"`);
  return parts.length ? `{${parts.join(",")}}` : "";
};
const keyOf = (labels: Labels) => JSON.stringify(Object.entries(labels).sort(([a], [b]) => a.localeCompare(b)));

interface Metric {
  name: string;
  render(): Promise<string> | string;
}

export class Counter implements Metric {
  private values = new Map<string, { labels: Labels; value: number }>();
  constructor(
    readonly name: string,
    readonly help: string,
  ) {}
  inc(labels: Labels = {}, by = 1) {
    const k = keyOf(labels);
    const entry = this.values.get(k) ?? { labels, value: 0 };
    entry.value += by;
    this.values.set(k, entry);
  }
  render() {
    const lines = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} counter`];
    for (const { labels, value } of this.values.values()) lines.push(`${this.name}${labelText(labels)} ${value}`);
    return lines.join("\n");
  }
}

export class Gauge implements Metric {
  private values = new Map<string, { labels: Labels; value: number }>();
  constructor(
    readonly name: string,
    readonly help: string,
    /** Called on every scrape to refresh the values (e.g. read a queue length). */
    private readonly collect?: (gauge: Gauge) => void | Promise<void>,
  ) {}
  set(labels: Labels, value: number) {
    this.values.set(keyOf(labels), { labels, value });
  }
  inc(labels: Labels = {}, by = 1) {
    const k = keyOf(labels);
    const entry = this.values.get(k) ?? { labels, value: 0 };
    entry.value += by;
    this.values.set(k, entry);
  }
  async render() {
    if (this.collect) await this.collect(this);
    const lines = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} gauge`];
    for (const { labels, value } of this.values.values()) lines.push(`${this.name}${labelText(labels)} ${value}`);
    return lines.join("\n");
  }
}

/** Default buckets (seconds): API latency from 5 ms to 10 s. */
export const LATENCY_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

export class Histogram implements Metric {
  private series = new Map<string, { labels: Labels; counts: number[]; sum: number; count: number }>();
  constructor(
    readonly name: string,
    readonly help: string,
    readonly buckets: number[] = LATENCY_BUCKETS,
  ) {}
  observe(labels: Labels, value: number) {
    const k = keyOf(labels);
    let s = this.series.get(k);
    if (!s) {
      s = { labels, counts: this.buckets.map(() => 0), sum: 0, count: 0 };
      this.series.set(k, s);
    }
    for (let i = 0; i < this.buckets.length; i++) if (value <= this.buckets[i]!) s.counts[i]!++;
    s.sum += value;
    s.count++;
  }
  render() {
    const lines = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} histogram`];
    for (const { labels, counts, sum, count } of this.series.values()) {
      this.buckets.forEach((b, i) => lines.push(`${this.name}_bucket${labelText({ ...labels, le: String(b) })} ${counts[i]}`));
      lines.push(`${this.name}_bucket${labelText({ ...labels, le: "+Inf" })} ${count}`);
      lines.push(`${this.name}_sum${labelText(labels)} ${sum}`);
      lines.push(`${this.name}_count${labelText(labels)} ${count}`);
    }
    return lines.join("\n");
  }
}

export class Registry {
  private metrics = new Map<string, Metric>();
  private add<M extends Metric>(metric: M): M {
    const existing = this.metrics.get(metric.name);
    if (existing) return existing as M;
    this.metrics.set(metric.name, metric);
    return metric;
  }
  counter(name: string, help: string) {
    return this.add(new Counter(name, help));
  }
  gauge(name: string, help: string, collect?: (gauge: Gauge) => void | Promise<void>) {
    return this.add(new Gauge(name, help, collect));
  }
  histogram(name: string, help: string, buckets?: number[]) {
    return this.add(new Histogram(name, help, buckets));
  }
  async render() {
    const parts = await Promise.all([...this.metrics.values()].map((m) => m.render()));
    return `${parts.join("\n")}\n`;
  }
}

/** The process-wide registry every service uses. */
export const metrics = new Registry();

/* ── Process metrics ── */

const loopDelay = monitorEventLoopDelay({ resolution: 20 });
loopDelay.enable();
metrics.gauge("process_resident_memory_bytes", "Resident memory size in bytes.", (g) => g.set({}, process.memoryUsage().rss));
metrics.gauge("nodejs_heap_used_bytes", "V8 heap in use, in bytes.", (g) => g.set({}, process.memoryUsage().heapUsed));
metrics.gauge("process_uptime_seconds", "Seconds since the process started.", (g) => g.set({}, process.uptime()));
metrics.gauge("nodejs_eventloop_delay_p99_seconds", "99th percentile event-loop delay since the last scrape.", (g) => {
  g.set({}, loopDelay.percentile(99) / 1e9);
  loopDelay.reset();
});

/* ── HTTP ── */

const httpDuration = metrics.histogram(
  "http_request_duration_seconds",
  "HTTP request duration by route and status.",
);
/** Probes and scrapes aren't traffic. */
const SKIP = new Set(["/metrics", "/healthz", "/readyz", "/ping"]);
const REQUEST_ID = /^[A-Za-z0-9._:-]{8,128}$/;

/** The id of a request: the router's X-Request-Id when it looks valid, else a new one. */
export function requestIdFrom(header: unknown): string {
  return typeof header === "string" && REQUEST_ID.test(header) ? header : randomUUID();
}

interface MinimalLogger {
  error: (msg: string) => unknown;
}

/**
 * Times every request by route and echoes X-Request-Id; logs 5xx responses
 * with their request id. Call before registering routes (Express) or at any
 * point before listen (Fastify). Works with Fastify and Express apps.
 */
export function instrumentHttp(app: any, service: string, logger?: MinimalLogger) {
  if (typeof app.addHook === "function") {
    // Fastify
    app.addHook("onRequest", async (request: any, reply: any) => {
      reply.header("x-request-id", request.id);
    });
    app.addHook("onResponse", async (request: any, reply: any) => {
      const route: string = request.routeOptions?.url ?? "unmatched";
      if (SKIP.has(route)) return;
      httpDuration.observe(
        { service, method: request.method, route, status: String(reply.statusCode) },
        reply.elapsedTime / 1000,
      );
      if (reply.statusCode >= 500) {
        logger?.error(`${request.method} ${route} -> ${reply.statusCode} (request ${request.id})`);
      }
    });
    return;
  }
  // Express
  app.use((req: any, res: any, next: () => void) => {
    const started = process.hrtime.bigint();
    req.id = requestIdFrom(req.headers["x-request-id"]);
    res.setHeader("x-request-id", req.id);
    res.on("finish", () => {
      const route = req.route?.path ? `${req.baseUrl ?? ""}${req.route.path}` : "unmatched";
      if (SKIP.has(route)) return;
      const seconds = Number(process.hrtime.bigint() - started) / 1e9;
      httpDuration.observe({ service, method: req.method, route, status: String(res.statusCode) }, seconds);
      if (res.statusCode >= 500) logger?.error(`${req.method} ${route} -> ${res.statusCode} (request ${req.id})`);
    });
    next();
  });
}

/**
 * Fastify options: the request id comes from X-Request-Id (set by the router)
 * when it looks valid, else a new one. requestIdHeader is off so Fastify
 * never takes the header unchecked.
 */
export const fastifyRequestIdOptions = {
  requestIdHeader: false as const,
  genReqId: (req: { headers: Record<string, unknown> }) => requestIdFrom(req.headers["x-request-id"]),
};

/** GET /metrics in Prometheus text format (Fastify or Express). */
export function registerMetricsRoute(app: { get: (path: string, handler: (req: unknown, res: any) => unknown) => unknown }) {
  app.get("/metrics", async (_req, res) => {
    const body = await metrics.render();
    const type = "text/plain; version=0.0.4; charset=utf-8";
    if (typeof res.code === "function") return res.code(200).header("content-type", type).send(body);
    res.setHeader("content-type", type);
    res.end(body);
    return undefined;
  });
}
