const { SOCKET_EVENTS, SendPayloadSchema } = require("@logixai/contracts");

/** Redis key holding the socket id for a user. */
const userKey = (userId) => `socket:user:${userId}`;

/**
 * Wires the socket.io connection events.
 * @param io socket.io server
 * @param redis ioredis-like client (get/set/del)
 */
function registerSocketHandlers(io, redis, logger = console) {
  io.on("connection", (socket) => {
    logger.log("A user connected:", socket.id);
    let registeredUserId = null;

    socket.on(SOCKET_EVENTS.SET_USER_ID, async (userId) => {
      if (typeof userId !== "string" || userId.length === 0) return;
      registeredUserId = userId;
      await redis.set(userKey(userId), socket.id);
    });

    socket.on(SOCKET_EVENTS.GET_CONNECTION_ID, async (userId) => {
      const connId = await redis.get(userKey(userId));
      socket.emit(SOCKET_EVENTS.CONNECTION_ID, connId);
    });

    socket.on("disconnect", async () => {
      if (!registeredUserId) return;
      // Only clear the mapping if a newer tab has not replaced it.
      const current = await redis.get(userKey(registeredUserId));
      if (current === socket.id) {
        await redis.del(userKey(registeredUserId));
      }
    });
  });
}

/** Express handler for POST /sendPayload (called by submission-service). */
function createSendPayloadHandler(io, redis, logger = console) {
  return async (req, res) => {
    const parsed = SendPayloadSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        message: "Invalid payload",
        error: parsed.error.issues,
        data: {},
      });
    }

    const { userId, payload } = parsed.data;
    const socketId = await redis.get(userKey(userId));
    if (!socketId) {
      return res.status(404).json({
        success: false,
        message: "User not connected",
        error: {},
        data: {},
      });
    }

    io.to(socketId).emit(SOCKET_EVENTS.SUBMISSION_RESULT, payload);
    logger.log(`Result for submission ${payload.submissionId} sent to ${userId}`);
    return res.status(200).json({
      success: true,
      message: "Payload sent successfully",
      error: {},
      data: {},
    });
  };
}

module.exports = { registerSocketHandlers, createSendPayloadHandler, userKey };
