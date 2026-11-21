/**
 * Fork server for heavy Python images (PYTHON_ML).
 *
 * Importing PyTorch takes ~4.4 s, pandas ~1.2 s and NumPy ~0.5 s, and the
 * judge runs every test as a new process: a PyTorch Submit with five tests
 * spent most of its time importing. Instead, per submission:
 *
 *  1. ZYGOTE starts once in the sandbox, imports the libraries this program
 *     uses (found in the program and in the learner code embedded in it),
 *     compiles the program, and listens on a Unix socket.
 *  2. Each test still runs as its own judge command, under the same
 *     `timeout`, reading the same input.txt, but the command is CLIENT: it
 *     hands its stdin/stdout/stderr to the zygote, which forks a fresh child
 *     that runs the program with those streams and reports its exit status.
 *
 * What doesn't change: one process per test (a forked child, with its own
 * copy of memory), the per-test time limit and verdicts (the client exits
 * with the child's code; on `timeout`'s SIGTERM it kills the child), output
 * streamed straight back to the judge, and each test's input existing only
 * while that test runs. If the zygote isn't running (it failed to start, or
 * a test killed it), the client runs the program directly, as before.
 */

/**
 * Libraries slow enough to import (about 0.6–4.4 s each) that importing them
 * once beats the fork server's own ~0.6 s start-up. Lighter programs (plain
 * Python, NumPy, pandas, DuckDB) run directly: measured, they'd be slower.
 */
const HEAVY_LIBS = "(?:torch|torchvision|sklearn|scipy|langgraph|langchain\\w*|transformers)\\b";
/** An import of a heavy library at any indentation (learner code imports inside functions too). */
const HEAVY_IMPORT_ANYWHERE = new RegExp(`^[ \\t]*(?:import|from)[ \\t]+${HEAVY_LIBS}`, "m");
/** A top-level import: the harness's own helpers mention torch/pandas indented, inside functions. */
const HEAVY_IMPORT_TOP_LEVEL = new RegExp(`^(?:import|from)[ \\t]+${HEAVY_LIBS}`, "m");

/**
 * Whether a judge program imports a heavy library: at the top level of the
 * program, anywhere in the learner code / test driver embedded in it as base64
 * (the ML Arena harness), or by taking tensors (the harness then imports PyTorch).
 */
export function usesHeavyImports(program: string): boolean {
  if (HEAVY_IMPORT_TOP_LEVEL.test(program)) return true;
  if (/kinds = __lx_json\.loads\([^\n]*tensor/.test(program)) return true;
  for (const m of program.matchAll(/"([A-Za-z0-9+/]{16,}={0,2})"/g)) {
    const text = Buffer.from(m[1] ?? "", "base64").toString("utf8");
    if (HEAVY_IMPORT_ANYWHERE.test(text)) return true;
  }
  return false;
}

/** Files inside the sandbox's working directory. */
export const FORK_DIR = ".lx";
export const ZYGOTE_FILE = `${FORK_DIR}/zygote.py`;
export const CLIENT_FILE = `${FORK_DIR}/client.py`;
export const SOCKET_FILE = `${FORK_DIR}/sock`;

/** The per-test command (replaces `python3 -B main.py`). */
export const clientCommand = (sourceFile: string) => `python3 -S -B ${CLIENT_FILE} ${sourceFile}`;

/** Starts the zygote in the background; the exec returns at once. */
export const startZygoteCommand = (sourceFile: string) =>
  `nohup python3 -B ${ZYGOTE_FILE} ${sourceFile} ${SOCKET_FILE} > ${FORK_DIR}/zygote.log 2>&1 < /dev/null &`;

/** Waits (up to ~waitSeconds) until the zygote listens; exit 1 if it never does. */
export const waitForZygoteCommand = (waitSeconds: number) =>
  `i=0; while [ ! -S ${SOCKET_FILE} ] && [ $i -lt ${Math.ceil(waitSeconds * 20)} ]; do sleep 0.05; i=$((i+1)); done; [ -S ${SOCKET_FILE} ]`;

export const ZYGOTE_PY = String.raw`
import os, sys
# One thread per numeric library: the sandbox has one CPU, and forking is
# only safe while no worker threads exist.
for _v in ("OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "MKL_NUM_THREADS", "NUMEXPR_NUM_THREADS"):
    os.environ.setdefault(_v, "1")

import ast, base64, binascii, re, signal, socket, struct, traceback, array

SOURCE_FILE, SOCKET_PATH = sys.argv[1], sys.argv[2]
with open(SOURCE_FILE, encoding="utf-8") as f:
    SOURCE = f.read()


def imports_in(tree, skip_helpers):
    """Top-level module names imported anywhere in the tree, except inside the
    harness's own helper functions (they mention numpy/pandas/torch whether or
    not this item uses them)."""
    found = set()
    def visit(node):
        if skip_helpers and isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name.startswith("__lx"):
            return
        if isinstance(node, ast.Import):
            found.update(a.name.split(".")[0] for a in node.names)
        elif isinstance(node, ast.ImportFrom) and node.module and node.level == 0:
            found.add(node.module.split(".")[0])
        for child in ast.iter_child_nodes(node):
            visit(child)
    visit(tree)
    return found


def modules_to_preload(source):
    try:
        tree = ast.parse(source)
    except SyntaxError:
        return []
    mods = imports_in(tree, skip_helpers=True)
    # Learner code and test drivers are embedded as base64 strings.
    for node in ast.walk(tree):
        if isinstance(node, ast.Constant) and isinstance(node.value, str) and len(node.value) >= 8:
            try:
                text = base64.b64decode(node.value, validate=True).decode("utf-8")
                mods |= imports_in(ast.parse(text), skip_helpers=False)
            except (binascii.Error, UnicodeDecodeError, SyntaxError, ValueError):
                pass
    # Argument types the harness converts (ndarray -> numpy, dataframe -> pandas, tensor -> torch).
    m = re.search(r'kinds = __lx_json\.loads\((.*)\)', source)
    kinds = m.group(1) if m else ""
    if "ndarray" in kinds:
        mods.add("numpy")
    if "dataframe" in kinds:
        mods.add("pandas")
    if "tensor" in kinds:
        mods.add("torch")
    return sorted(x for x in mods if not x.startswith("__"))


for name in modules_to_preload(SOURCE):
    try:
        __import__(name)
    except BaseException:
        pass  # the child will raise the same error itself, with the learner's traceback
if "torch" in sys.modules:
    sys.modules["torch"].set_num_threads(1)

CODE = compile(SOURCE, SOURCE_FILE, "exec")
sys.stdout.flush()
sys.stderr.flush()


def run_child(fds):
    """In the forked child: become the test's process, run the program, exit."""
    for sig in (signal.SIGTERM, signal.SIGINT, signal.SIGCHLD):
        signal.signal(sig, signal.SIG_DFL)
    for target, fd in enumerate(fds):
        os.dup2(fd, target)
    for fd in fds:
        if fd > 2:
            os.close(fd)
    sys.argv = [SOURCE_FILE]
    code = 0
    try:
        exec(CODE, {"__name__": "__main__", "__file__": SOURCE_FILE, "__builtins__": __builtins__})
    except SystemExit as e:
        if e.code is None:
            code = 0
        elif isinstance(e.code, int):
            code = e.code
        else:
            print(e.code, file=sys.stderr)
            code = 1
    except BaseException:
        traceback.print_exc()
        code = 1
    for stream in (sys.stdout, sys.stderr, sys.__stdout__, sys.__stderr__):
        try:
            stream.flush()
        except BaseException:
            pass
    os._exit(code & 0xFF)


server = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
tmp_path = SOCKET_PATH + ".tmp"
server.bind(tmp_path)
server.listen(8)
os.rename(tmp_path, SOCKET_PATH)  # appears only once ready

while True:
    conn, _ = server.accept()
    try:
        fds = array.array("i")
        msg, ancdata, _flags, _addr = conn.recvmsg(1, socket.CMSG_LEN(3 * fds.itemsize))
        for level, kind, data in ancdata:
            if level == socket.SOL_SOCKET and kind == socket.SCM_RIGHTS:
                fds.frombytes(data[: len(data) - (len(data) % fds.itemsize)])
        if len(fds) != 3:
            conn.close()
            continue
        pid = os.fork()
        if pid == 0:
            server.close()
            conn.close()
            run_child(list(fds))
        for fd in fds:
            os.close(fd)
        conn.sendall(struct.pack("!i", pid))
        _, status = os.waitpid(pid, 0)
        code = os.waitstatus_to_exitcode(status)
        code = 128 - code if code < 0 else code  # killed by signal N -> 128 + N, like a shell
        conn.sendall(struct.pack("!i", code))
    except BaseException:
        pass
    finally:
        conn.close()
`;

export const CLIENT_PY = String.raw`
import os, signal, socket, struct, sys, array

SOURCE_FILE = sys.argv[1]
SOCKET_PATH = ".lx/sock"


def run_directly():
    # No zygote: run the program the old way, in this process.
    os.execvp("python3", ["python3", "-B", SOURCE_FILE])


try:
    conn = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    conn.connect(SOCKET_PATH)
    conn.sendmsg([b"r"], [(socket.SOL_SOCKET, socket.SCM_RIGHTS, array.array("i", [0, 1, 2]).tobytes())])
    pid = struct.unpack("!i", conn.recv(4))[0]
except (OSError, struct.error):
    run_directly()


def stop(signum, _frame):
    # timeout(1) sends TERM at the limit: stop the test's process too.
    try:
        os.kill(pid, signal.SIGKILL)
    except OSError:
        pass
    os._exit(128 + signum)


signal.signal(signal.SIGTERM, stop)
signal.signal(signal.SIGINT, stop)

data = b""
while len(data) < 4:
    chunk = conn.recv(4 - len(data))
    if not chunk:
        # The zygote died while the test ran (e.g. the program killed it).
        os._exit(1)
    data += chunk
os._exit(struct.unpack("!i", data)[0] & 0xFF)
`;
