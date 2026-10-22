import express from "express";
import cors from "cors";
import type { ServerConfig } from "./config.js";
import { getDatabaseStatus } from "./database.js";
import { errorHandler, notFound } from "./middleware/errors.js";
import { createPublicMenuRouter } from "./routes/publicMenu.js";

export function createApp(config: ServerConfig) {
  const app = express();
  app.disable("x-powered-by");
  app.use(cors({ origin: config.frontendUrl }));
  app.use(express.json({ limit: "16kb" }));

  app.get("/api/health", (_request, response) => {
    response.set("Cache-Control", "no-store");
    response.json({
      status: "ok",
      database: getDatabaseStatus(config.mongoUri),
      message: "Сервер работает.",
    });
  });

  app.use("/api/public", createPublicMenuRouter(config));

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
