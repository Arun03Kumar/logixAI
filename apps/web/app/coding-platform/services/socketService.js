import { io } from "socket.io-client";
import toast from "react-hot-toast";
import { setRunOutput } from "@/app/coding-platform/store/runOutputSlice";
import { SOCKET_URL } from "@/app/coding-platform/lib/config";
import { getClientUserId } from "@/app/coding-platform/lib/clientUserId";

// Must match SOCKET_EVENTS in packages/contracts/src/socket.ts.
// (Kept as plain strings so the browser bundle does not pull in zod.)
const SOCKET_EVENTS = {
  SET_USER_ID: "setUserId",
  SUBMISSION_RESULT: "submissionPayloadResponse",
};

const VERDICT_TOASTS = {
  Success: (n) => toast.success(`Accepted. All ${n} tests passed.`),
  WA: () => toast.error("Wrong answer on at least one test."),
  TLE: () => toast.error("Time limit exceeded."),
  MLE: () => toast.error("Memory limit exceeded."),
  RE: () => toast.error("Your code hit an error. Check the output."),
};

let socket = null;

export const initializeSocket = (dispatch) => {
  if (!socket) {
    socket = io(SOCKET_URL);

    socket.on("connect", () => {
      socket.emit(SOCKET_EVENTS.SET_USER_ID, getClientUserId());
    });

    socket.on(SOCKET_EVENTS.SUBMISSION_RESULT, (data) => {
      dispatch(setRunOutput(data));
      VERDICT_TOASTS[data?.status]?.(data?.response?.length ?? 0);
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
