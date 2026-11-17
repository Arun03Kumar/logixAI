const express = require("express");
const { createServer } = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const { createRedisConnection } = require("@logixai/service-kit");
const { PORT, REDIS_HOST, REDIS_PORT, CORS_ORIGINS } = require("./config");
const {
  registerSocketHandlers,
  createSendPayloadHandler,
} = require("./handlers");

const app = express();
const httpServer = createServer(app);

app.use(express.json());
app.use(
  cors({
    origin: CORS_ORIGINS,
    methods: ["GET", "POST"],
  }),
);

const redisCache = createRedisConnection({ host: REDIS_HOST, port: REDIS_PORT });

const io = new Server(httpServer, {
  cors: {
    origin: CORS_ORIGINS,
    methods: ["GET", "POST"],
  },
});

registerSocketHandlers(io, redisCache);

app.post("/sendPayload", createSendPayloadHandler(io, redisCache));

app.get("/ping", (req, res) => res.json({ message: "socket service is alive" }));

httpServer.listen(PORT, () => {
  console.log(`Socket server is running on port ${PORT}`);
});
