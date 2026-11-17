const express = require("express");
const { createServer } = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const {
  createAccessTokenVerifier,
  createRedisConnection,
} = require("@logixai/service-kit");
const {
  PORT,
  REDIS_HOST,
  REDIS_PORT,
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

app.use(express.json());
app.use(
  cors({
    origin: CORS_ORIGINS,
    methods: ["GET", "POST"],
  }),
);

const redisCache = createRedisConnection({ host: REDIS_HOST, port: REDIS_PORT });
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

httpServer.listen(PORT, () => {
  console.log(`Socket server is running on port ${PORT}`);
});
