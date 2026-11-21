import winston from "winston";

export type Logger = winston.Logger;

/**
 * Creates a console logger tagged with the service name.
 * Log level comes from LOG_LEVEL (default "info"). LOG_FORMAT=json (the
 * default in production) writes one JSON object per line for log tools;
 * "pretty" is the coloured development format.
 */
export function createLogger(serviceName: string): Logger {
  const json = (process.env.LOG_FORMAT ?? (process.env.NODE_ENV === "production" ? "json" : "pretty")) === "json";
  if (json) {
    return winston.createLogger({
      level: process.env.LOG_LEVEL ?? "info",
      defaultMeta: { service: serviceName },
      format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
      transports: [new winston.transports.Console()],
    });
  }
  return winston.createLogger({
    level: process.env.LOG_LEVEL ?? "info",
    defaultMeta: { service: serviceName },
    transports: [
      new winston.transports.Console({
        format: winston.format.combine(
          winston.format.colorize(),
          winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
          winston.format.printf(
            (log) =>
              `${log.timestamp} [${serviceName}] ${log.level}: ${log.message}`,
          ),
        ),
      }),
    ],
  });
}
