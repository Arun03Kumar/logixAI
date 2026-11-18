import Docker from "dockerode";
import type { LanguageDefinition } from "@logixai/contracts";
import type { ExecOptions, ExecResult, Sandbox, SandboxFactory } from "./types.js";

/** Working directory inside the sandbox (a size-limited tmpfs). */
export const SANDBOX_DIR = "/sandbox";
/** Unprivileged uid:gid ("nobody") the code runs as. */
const SANDBOX_USER = "65534:65534";
/** A sandbox lives at most this long, even if the evaluator crashes. */
const MAX_LIFETIME_SEC = 300;

/** Docker's multiplexed stream frame header: [stream, 0, 0, 0, size (uint32 BE)]. */
const FRAME_HEADER = 8;

/**
 * Splits Docker's multiplexed output into stdout / stderr, keeping at most
 * `limit` bytes of each. Decoding the raw bytes directly (instead of piping
 * through PassThrough streams) means no output is lost when the stream ends.
 */
function demux(raw: Buffer, limit: number) {
  const parts: Record<1 | 2, Buffer[]> = { 1: [], 2: [] };
  const sizes = { 1: 0, 2: 0 };
  let truncated = false;
  let offset = 0;
  while (offset + FRAME_HEADER <= raw.length) {
    const type = raw[offset] as 1 | 2;
    const length = raw.readUInt32BE(offset + 4);
    const start = offset + FRAME_HEADER;
    const end = Math.min(start + length, raw.length);
    if (end < start + length) truncated = true; // cut mid-frame by the raw cap
    if (type === 1 || type === 2) {
      const room = limit - sizes[type];
      const chunk = raw.subarray(start, end);
      if (chunk.length > room) truncated = true;
      if (room > 0) {
        const kept = chunk.subarray(0, Math.max(0, room));
        parts[type].push(kept);
        sizes[type] += kept.length;
      }
    }
    offset = start + length;
  }
  return {
    stdout: Buffer.concat(parts[1]).toString("utf8"),
    stderr: Buffer.concat(parts[2]).toString("utf8"),
    truncated,
  };
}

class DockerSandbox implements Sandbox {
  constructor(private readonly container: Docker.Container) {}

  /**
   * Runs a command. With `stdin`, the text is written and stdin closed: use
   * this only for short-lived writers like `cat > file`, because some Docker
   * hosts (Docker Desktop on Windows) drop the whole connection on that
   * half-close. Programs under test read their input from a file instead.
   */
  async exec(command: string[], options: ExecOptions): Promise<ExecResult> {
    const started = Date.now();
    const deadline = started + options.timeoutMs;
    const withStdin = options.stdin !== undefined;
    const exec = await this.container.exec({
      Cmd: command,
      WorkingDir: SANDBOX_DIR,
      AttachStdin: withStdin,
      AttachStdout: true,
      AttachStderr: true,
      Tty: false,
    });
    const stream = await exec.start({ hijack: true, stdin: withStdin });

    // Raw frames, capped (two outputs plus headers) so a flood can't exhaust memory.
    const rawCap = options.maxOutputBytes * 2 + 64 * FRAME_HEADER;
    const raw: Buffer[] = [];
    let rawSize = 0;
    let rawTruncated = false;
    stream.on("data", (chunk: Buffer) => {
      if (rawSize >= rawCap) {
        rawTruncated = true;
        return;
      }
      raw.push(chunk);
      rawSize += chunk.length;
    });

    const ended = new Promise<void>((resolve) => {
      stream.on("end", resolve);
      stream.on("close", resolve);
      stream.on("error", () => resolve());
    });

    if (withStdin) {
      stream.write(options.stdin);
      stream.end();
    }

    // Wait for the output to finish (or the watchdog), then for Docker to
    // report the process as exited: the stream can end earlier than that.
    const remaining = () => Math.max(0, deadline - Date.now());
    await Promise.race([ended, new Promise((r) => setTimeout(r, remaining()).unref())]);

    let exitCode: number | null = null;
    let timedOut = true;
    while (Date.now() < deadline) {
      const info = await exec.inspect();
      if (!info.Running) {
        exitCode = info.ExitCode ?? null;
        timedOut = false;
        break;
      }
      await new Promise((r) => setTimeout(r, 20));
    }
    if (timedOut) stream.destroy();
    // Let any final frames already received be processed.
    await Promise.race([ended, new Promise((r) => setTimeout(r, 50))]);

    const decoded = demux(Buffer.concat(raw), options.maxOutputBytes);
    return {
      exitCode,
      stdout: decoded.stdout,
      stderr: decoded.stderr,
      timedOut,
      outputLimited: decoded.truncated || rawTruncated,
      durationMs: Date.now() - started,
    };
  }

  async destroy() {
    await this.container.remove({ force: true });
  }
}

/**
 * Creates locked-down containers:
 * no network, no capabilities, read-only image, unprivileged user,
 * memory / CPU / process limits, and small tmpfs mounts for the code.
 */
export function createDockerSandboxFactory(docker = new Docker()): SandboxFactory {
  return {
    async create(language: LanguageDefinition) {
      const memoryBytes = language.memoryMb * 1024 * 1024;
      const container = await docker.createContainer({
        Image: language.dockerImage,
        Cmd: ["sleep", String(MAX_LIFETIME_SEC)],
        WorkingDir: SANDBOX_DIR,
        User: SANDBOX_USER,
        Env: ["HOME=/tmp", "LANG=C.UTF-8"],
        NetworkDisabled: true,
        Tty: false,
        HostConfig: {
          NetworkMode: "none",
          Memory: memoryBytes,
          MemorySwap: memoryBytes, // no swap
          NanoCpus: 1_000_000_000, // one CPU
          PidsLimit: 128,
          ReadonlyRootfs: true,
          CapDrop: ["ALL"],
          SecurityOpt: ["no-new-privileges"],
          Tmpfs: {
            [SANDBOX_DIR]: "rw,exec,nosuid,size=64m,mode=1777",
            "/tmp": "rw,exec,nosuid,size=64m,mode=1777",
          },
          Ulimits: [{ Name: "nofile", Soft: 256, Hard: 256 }],
        },
      });
      try {
        await container.start();
      } catch (err) {
        await container.remove({ force: true }).catch(() => {});
        throw err;
      }
      return new DockerSandbox(container);
    },
  };
}

/** Pulls any missing judge images up front, so the first submission isn't slow. */
export async function ensureImages(images: string[], log: (msg: string) => void, docker = new Docker()) {
  for (const image of images) {
    try {
      await docker.getImage(image).inspect();
    } catch {
      log(`Pulling ${image}…`);
      await new Promise<void>((resolve, reject) => {
        docker.pull(image, (err: Error | null, stream: NodeJS.ReadableStream) => {
          if (err) return reject(err);
          docker.modem.followProgress(stream, (e: Error | null) => (e ? reject(e) : resolve()));
        });
      });
      log(`Pulled ${image}`);
    }
  }
}
