import { describe, expect, it } from "vitest";
import { resolveImage } from "../src/sandbox/dockerSandbox.js";

describe("resolveImage", () => {
  it("keeps every image as it is without a registry", () => {
    expect(resolveImage("logixai/python-ml:4")).toBe("logixai/python-ml:4");
    expect(resolveImage("gcc:14")).toBe("gcc:14");
  });

  it("moves only LogixAI judge images to the registry", () => {
    expect(resolveImage("logixai/python-ml:4", "ghcr.io/acme")).toBe("ghcr.io/acme/python-ml:4");
    expect(resolveImage("logixai/node-web:1", "registry.example.com:5000/judge")).toBe(
      "registry.example.com:5000/judge/node-web:1",
    );
    expect(resolveImage("eclipse-temurin:21", "ghcr.io/acme")).toBe("eclipse-temurin:21");
  });
});
