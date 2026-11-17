import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import {
  createSendPayloadHandler,
  createSocketAuth,
  registerSocketHandlers,
  userKey,
} from "../src/handlers";
import { requireInternalToken } from "../src/internalAuth";

const quiet = { log: () => {} };

function fakeRedis() {
  const store = new Map();
  return {
    store,
    get: vi.fn(async (k) => store.get(k) ?? null),
    set: vi.fn(async (k, v) => store.set(k, v)),
    del: vi.fn(async (k) => store.delete(k)),
  };
}

function fakeIo() {
  const io = new EventEmitter();
  const emit = vi.fn();
  io.to = vi.fn(() => ({ emit }));
  io.emitToRoom = emit;
  return io;
}

function fakeSocket(id, userId, token) {
  const socket = new EventEmitter();
  socket.id = id;
  socket.data = userId ? { userId } : {};
  socket.handshake = { auth: token === undefined ? {} : { token } };
  return socket;
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("socket auth", () => {
  const verifier = {
    verify: vi.fn(async (token) => {
      if (token !== "good") throw new Error("bad token");
      return { sub: "u1", role: "user" };
    }),
  };

  it("takes the user id from a verified token", async () => {
    const socket = fakeSocket("s1", undefined, "good");
    const next = vi.fn();
    await createSocketAuth(verifier)(socket, next);
    expect(next).toHaveBeenCalledWith();
    expect(socket.data.userId).toBe("u1");
  });

  it("refuses connections without a valid token", async () => {
    for (const token of [undefined, "forged"]) {
      const socket = fakeSocket("s1", undefined, token);
      const next = vi.fn();
      await createSocketAuth(verifier)(socket, next);
      expect(next.mock.calls[0][0]).toBeInstanceOf(Error);
      expect(socket.data.userId).toBeUndefined();
    }
  });
});

describe("socket handlers", () => {
  it("maps the user to the latest socket and cleans up on disconnect", async () => {
    const io = fakeIo();
    const redis = fakeRedis();
    registerSocketHandlers(io, redis, quiet);

    const oldTab = fakeSocket("old", "u1");
    const newTab = fakeSocket("new", "u1");
    io.emit("connection", oldTab);
    await flush();
    io.emit("connection", newTab);
    await flush();
    expect(redis.store.get(userKey("u1"))).toBe("new");

    await oldTab.listeners("disconnect")[0]();
    expect(redis.store.get(userKey("u1"))).toBe("new");
    await newTab.listeners("disconnect")[0]();
    expect(redis.store.has(userKey("u1"))).toBe(false);
  });
});

describe("POST /sendPayload", () => {
  function res() {
    return {
      status: vi.fn(function (c) {
        this.code = c;
        return this;
      }),
      json: vi.fn(function (b) {
        this.body = b;
        return this;
      }),
    };
  }
  const payload = { response: [], userId: "u1", submissionId: "s1", status: "Success" };

  it("rejects invalid bodies with 400", async () => {
    const handler = createSendPayloadHandler(fakeIo(), fakeRedis(), quiet);
    const r = res();
    await handler({ body: { userId: "u1" } }, r);
    expect(r.code).toBe(400);
  });

  it("returns 404 when the user has no socket", async () => {
    const handler = createSendPayloadHandler(fakeIo(), fakeRedis(), quiet);
    const r = res();
    await handler({ body: { userId: "u1", payload } }, r);
    expect(r.code).toBe(404);
  });

  it("emits the result to the user's socket", async () => {
    const io = fakeIo();
    const redis = fakeRedis();
    redis.store.set(userKey("u1"), "sock-9");
    const r = res();
    await createSendPayloadHandler(io, redis, quiet)({ body: { userId: "u1", payload } }, r);
    expect(io.to).toHaveBeenCalledWith("sock-9");
    expect(io.emitToRoom).toHaveBeenCalledWith("submissionPayloadResponse", payload);
    expect(r.code).toBe(200);
  });
});

describe("requireInternalToken", () => {
  const call = (expected, header) => {
    const r = { status: vi.fn(() => r), json: vi.fn(() => r) };
    const next = vi.fn();
    requireInternalToken(expected)({ headers: header ? { "x-internal-token": header } : {} }, r, next);
    return { next, r };
  };

  it("allows everything when no token is configured", () => {
    expect(call(undefined).next).toHaveBeenCalled();
  });

  it("checks the shared secret when configured", () => {
    expect(call("s3cret", "s3cret").next).toHaveBeenCalled();
    const denied = call("s3cret", "nope");
    expect(denied.next).not.toHaveBeenCalled();
    expect(denied.r.status).toHaveBeenCalledWith(401);
  });
});
