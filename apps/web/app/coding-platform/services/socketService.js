import { io } from "socket.io-client";
import { setRunOutput } from "@/app/coding-platform/store/runOutputSlice";
import { SOCKET_URL } from "@/app/coding-platform/lib/config";
import { getClientUserId } from "@/app/coding-platform/lib/clientUserId";

// Must match SOCKET_EVENTS in packages/contracts/src/socket.ts.
// (Kept as plain strings so the browser bundle does not pull in zod.)
const SOCKET_EVENTS = {
  SET_USER_ID: "setUserId",
  SUBMISSION_RESULT: "submissionPayloadResponse",
};

let socket = null;

export const initializeSocket = (dispatch) => {
  if (!socket) {
    socket = io(SOCKET_URL);

    socket.on("connect", () => {
      console.log("Connected to socket server");
      socket.emit(SOCKET_EVENTS.SET_USER_ID, getClientUserId());
    });

    socket.on(SOCKET_EVENTS.SUBMISSION_RESULT, (data) => {
      console.log("Received run output:", data);
      dispatch(setRunOutput(data));
    });

    socket.on("disconnect", () => {
      console.log("Disconnected from socket server");
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
