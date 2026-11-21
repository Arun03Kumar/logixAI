const express = require("express");
const cors = require("cors");
const { PORT } = require("./config/server.config");
const logger = require("./config/logger.config");
const connect_db = require("./config/db.config");
const apiRouter = require("./routes");
const errorHandler = require("./utils/errorHandler");
const {
  closeMongo,
  instrumentHttp,
  mongoReady,
  onShutdown,
  registerHealthRoutes,
  registerMetricsRoute,
} = require("@logixai/service-kit");

const app = express();
// Request timing per route (/metrics) and X-Request-Id on every response; before the routes.
instrumentHttp(app, "problem-service", logger);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.text());

app.use(cors({ origin: "*" }));

registerHealthRoutes(app, { mongo: mongoReady });
registerMetricsRoute(app);

app.use("/api", apiRouter);

app.get("/ping", (req, res) => {
  return res.json({
    message: "problem service is alive",
  });
});

app.use(errorHandler);

async function start() {
  try {
    await connect_db();
    const server = app.listen(PORT, () => {
      logger.info(`problem-service listening on port ${PORT}`);
    });
    onShutdown([["http", () => new Promise((resolve) => server.close(resolve))], closeMongo], { logger });
  } catch (err) {
    logger.error(`Failed to start problem-service: ${err?.message || err}`);
    process.exit(1);
  }
}

start();
