const express = require("express");
const cors = require("cors");
const { PORT } = require("./config/server.config");
const logger = require("./config/logger.config");
const connect_db = require("./config/db.config");
const apiRouter = require("./routes");
const errorHandler = require("./utils/errorHandler");

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.text());

app.use(cors({ origin: "*" }));

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
    app.listen(PORT, () => {
      logger.info(`problem-service listening on port ${PORT}`);
    });
  } catch (err) {
    logger.error(`Failed to start problem-service: ${err?.message || err}`);
    process.exit(1);
  }
}

start();
