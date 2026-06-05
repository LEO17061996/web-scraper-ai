/**
 * Structured logger (Pino).
 *
 * - Production (`NODE_ENV=production`): single-line JSON, ready for log shippers.
 * - Dev: human-readable, colorized via pino-pretty.
 *
 * Use `logger.child({ ... })` to attach context (platform, query, requestId)
 * that then appears on every line — the pattern used throughout the scraper
 * and analyzer.
 */

import pino from "pino";

const level = process.env.LOG_LEVEL ?? "info";
const isProduction = process.env.NODE_ENV === "production";

export const logger = pino({
  level,
  ...(isProduction
    ? {}
    : {
        transport: {
          target: "pino-pretty",
          options: {
            colorize: true,
            translateTime: "SYS:HH:MM:ss",
            ignore: "pid,hostname",
          },
        },
      }),
});

export type Logger = typeof logger;
