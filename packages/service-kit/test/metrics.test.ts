import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { Registry, instrumentHttp, metrics, requestIdFrom } from "../src";

describe("metrics registry", () => {
  it("renders counters, gauges and cumulative histogram buckets in Prometheus text format", async () => {
    const r = new Registry();
    r.counter("jobs_total", "Jobs.").inc({ queue: "dsa" }, 2);
    r.gauge("backlog", "Waiting.", (g) => g.set({ queue: "python-ml" }, 7));
    const h = r.histogram("judge_seconds", "Time.", [0.5, 1]);
    h.observe({ lang: "PY" }, 0.2);
    h.observe({ lang: "PY" }, 0.7);
    h.observe({ lang: "PY" }, 3);
    const text = await r.render();
    expect(text).toContain('# TYPE jobs_total counter\njobs_total{queue="dsa"} 2');
    expect(text).toContain('backlog{queue="python-ml"} 7');
    expect(text).toContain('judge_seconds_bucket{lang="PY",le="0.5"} 1');
    expect(text).toContain('judge_seconds_bucket{lang="PY",le="1"} 2');
    expect(text).toContain('judge_seconds_bucket{lang="PY",le="+Inf"} 3');
    expect(text).toContain('judge_seconds_count{lang="PY"} 3');
    expect(text.endsWith("\n")).toBe(true);
  });

  it("escapes label values and returns the same metric for the same name", async () => {
    const r = new Registry();
    const a = r.counter("x_total", "X.");
    expect(r.counter("x_total", "X.")).toBe(a);
    a.inc({ route: 'say "hi"\\now' });
    expect(await r.render()).toContain('x_total{route="say \\"hi\\"\\\\now"} 1');
  });

  it("includes process metrics", async () => {
    const text = await metrics.render();
    expect(text).toMatch(/process_resident_memory_bytes \d+/);
    expect(text).toContain("nodejs_eventloop_delay_p99_seconds");
  });
});

describe("request ids", () => {
  it("keeps a valid id from the router and replaces anything else", () => {
    expect(requestIdFrom("abc-123-def-456")).toBe("abc-123-def-456");
    expect(requestIdFrom("bad id\nwith newline")).toMatch(/^[0-9a-f-]{36}$/);
    expect(requestIdFrom(undefined)).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe("instrumentHttp (Express)", () => {
  it("times requests by route, echoes the request id and logs server errors", async () => {
    let middleware: (req: any, res: any, next: () => void) => void = () => {};
    instrumentHttp({ use: (fn: typeof middleware) => (middleware = fn) }, "test-svc", {
      error: (msg: string) => errors.push(msg),
    });
    const errors: string[] = [];
    const respond = (status: number) => {
      const res = Object.assign(new EventEmitter(), { statusCode: status, headers: {} as Record<string, string>, setHeader(k: string, v: string) { this.headers[k] = v; } });
      const req = { method: "GET", headers: { "x-request-id": "req-12345678" }, baseUrl: "/api/v1/problems", route: { path: "/:id" } };
      middleware(req, res, () => {});
      res.emit("finish");
      return res;
    };
    expect(respond(200).headers["x-request-id"]).toBe("req-12345678");
    respond(503);
    const text = await metrics.render();
    expect(text).toContain('http_request_duration_seconds_count{service="test-svc",method="GET",route="/api/v1/problems/:id",status="200"} 1');
    expect(errors).toEqual(["GET /api/v1/problems/:id -> 503 (request req-12345678)"]);
  });
});
