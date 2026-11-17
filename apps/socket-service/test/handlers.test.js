import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import {
  createSendPayloadHandler,
  registerSocketHandlers,
  userKey,
} from "../src/handlers";

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

function fakeSocket(id) {
  const socket = new EventEmitter();
  socket.id = id;
  socket.emit = vi.fn(socket.emit.bind(socket));
  return socket;
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("socket handlers", () => {
  it("answers getConnectionId with the stored id, not a Promise", async () => {
    const io = fakeIo();
    const redis = fakeRedis();
    registerSocketHandlers(io, redis, quiet);
    const socket = fakeSocket("sock-1");
    io.emit("connection", socket);

    socket.listeners("setUserId")[0]("u1");
    await flush();
    await socket.listeners("getConnectionId")[0]("u1");

    expect(socket.emit).toHaveBeenCalledWith("connectionId", "sock-1");
  });

  it("clears the mapping on disconnect only if no newer tab replaced it", async () => {
    const io = fakeIo();
    const redis = fakeRedis();
    registerSocketHandlers(io, redis, quiet);
    const oldTab = fakeSocket("old");
    const newTab = fakeSocket("new");
    io.emit("connection", oldTab);
    io.emit("connection", newTab);

    await oldTab.listeners("setUserId")[0]("u1");
    await newTab.listeners("setUserId")[0]("u1");
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
