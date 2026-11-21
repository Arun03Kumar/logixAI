import { io } from "socket.io-client";
import toast from "react-hot-toast";
import { setRunOutput } from "@/app/coding-platform/store/runOutputSlice";
import { SOCKET_URL } from "@/app/coding-platform/lib/config";
import { getAccessToken } from "@/app/lib/auth/session";

// Must match SOCKET_EVENTS in packages/contracts/src/socket.ts.
// (Kept as plain strings so the browser bundle does not pull in zod.)
const SOCKET_EVENTS = {
  SUBMISSION_RESULT: "submissionPayloadResponse",
};

const SUBMIT_TOASTS = {
  Success: (n) => toast.success(`Accepted. All ${n} tests passed.`),
  WA: () => toast.error("Wrong answer on at least one test."),
  TLE: () => toast.error("Time limit exceeded."),
  MLE: () => toast.error("Memory limit exceeded."),
  RE: () => toast.error("Your code hit a runtime error. Check the output."),
  CE: () => toast.error("Your code didn't compile. Check the output."),
};

function announce(result) {
  const total = result?.response?.length ?? 0;
  if (result?.mode === "run") {
    // Running examples is exploratory: a quiet summary, not a verdict.
    if (result.status === "CE") return SUBMIT_TOASTS.CE();
    const passed = result.response.filter((r) => r.status === "SUCCESS").length;
    const say = passed === total ? toast.success : toast;
    return say(`${passed} of ${total} examples passed.`);
  }
  return SUBMIT_TOASTS[result?.status]?.(total);
}

let socket = null;

/** Connects as the signed-in user. Call only when a session exists. */
export const initializeSocket = (dispatch) => {
  if (!socket) {
    // SOCKET_URL may carry a path behind the proxy (https://site/realtime):
    // socket.io reads a URL path as a namespace, so pass it as the transport path.
    const url = new URL(SOCKET_URL, window.location.href);
    const prefix = url.pathname.replace(/\/+$/, "");
    socket = io(url.origin, {
      ...(prefix ? { path: `${prefix}/socket.io` } : {}),
      // Called on every (re)connect, so an expired token is refreshed first.
      auth: (cb) => {
        getAccessToken().then((token) => cb({ token }));
      },
    });

    socket.on(SOCKET_EVENTS.SUBMISSION_RESULT, (data) => {
      dispatch(setRunOutput(data));
      announce(data);
    });
  }

  return socket;
};

export const disconnectSocket = () => {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
};

export const getSocket = () => socket;
