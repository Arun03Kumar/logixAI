const express = require("express");
const { createServer } = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const {
  closeRedis,
  createAccessTokenVerifier,
  createLogger,
  createRedisConnection,
  instrumentHttp,
  onShutdown,
  registerMetricsRoute,
  redisReady,
  registerHealthRoutes,
} = require("@logixai/service-kit");
const {
  PORT,
  REDIS_HOST,
  REDIS_PORT,
  REDIS_PASSWORD,
  REDIS_TLS,
  CORS_ORIGINS,
  IDENTITY_JWKS_URL,
  JWT_ISSUER,
  INTERNAL_API_TOKEN,
} = require("./config");
const {
  createSocketAuth,
  registerSocketHandlers,
  createSendPayloadHandler,
} = require("./handlers");
const { requireInternalToken } = require("./internalAuth");

const app = express();
const httpServer = createServer(app);

instrumentHttp(app, "socket-service");
app.use(express.json());
app.use(
  cors({
    origin: CORS_ORIGINS,
    methods: ["GET", "POST"],
  }),
);

const redisCache = createRedisConnection({
  host: REDIS_HOST,
  port: REDIS_PORT,
  password: REDIS_PASSWORD,
  tls: REDIS_TLS,
});
const verifier = createAccessTokenVerifier({
  jwksUrl: IDENTITY_JWKS_URL,
  issuer: JWT_ISSUER,
});

const io = new Server(httpServer, {
  cors: {
    origin: CORS_ORIGINS,
    methods: ["GET", "POST"],
  },
});

io.use(createSocketAuth(verifier));
registerSocketHandlers(io, redisCache);

// Called by submission-service only.
app.post(
  "/sendPayload",
  requireInternalToken(INTERNAL_API_TOKEN),
  createSendPayloadHandler(io, redisCache),
);

app.get("/ping", (req, res) => res.json({ message: "socket service is alive" }));
registerHealthRoutes(app, { redis: redisReady(redisCache) });
registerMetricsRoute(app);

const logger = createLogger("socket-service");
httpServer.listen(PORT, () => {
  logger.info(`socket-service listening on port ${PORT}`);
});
onShutdown(
  [
    // io.close() disconnects sockets (clients reconnect to another instance) and closes the HTTP server.
    ["socket.io", () => new Promise((resolve) => io.close(() => resolve()))],
    closeRedis(redisCache),
  ],
  { logger },
);
