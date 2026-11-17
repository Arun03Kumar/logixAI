import winston from "winston";

export type Logger = winston.Logger;

/**
 * Creates a console logger tagged with the service name.
 * Log level comes from LOG_LEVEL (default "info").
 */
export function createLogger(serviceName: string): Logger {
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
