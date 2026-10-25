import express, { type Express } from "express";
import cors from "cors";
import type { ServerConfig } from "./config.js";
import { getDatabaseStatus } from "./database.js";
import { errorHandler, notFound } from "./middleware/errors.js";
import { createPublicMenuRouter } from "./routes/publicMenu.js";
import { createPublicOrdersRouter } from "./routes/publicOrders.js";
import { createAuthRouter } from "./auth/routes.js";
import { createManageMenuRouter } from "./routes/manageMenu.js";
import { createSessionManager, type SessionManager } from "./auth/sessions.js";

const sessionManagers = new WeakMap<Express, SessionManager>();

export async function closeAppSessionStore(app: Express): Promise<void> {
  await sessionManagers.get(app)?.close();
  sessionManagers.delete(app);
}

export function createApp(config: ServerConfig) {
  const app = express();
  app.disable("x-powered-by");
  if (config.secureCookies) app.set("trust proxy", 1);
  app.use(cors({ origin: config.frontendUrl, credentials: true, exposedHeaders: ["Retry-After"] }));
  app.use(express.json({ limit: "16kb" }));
  const sessionManager = createSessionManager(config);
  sessionManagers.set(app, sessionManager);

  app.get("/api/health", (_request, response) => {
    response.set("Cache-Control", "no-store");
    response.json({
      status: "ok",
      database: getDatabaseStatus(config.mongoUri),
      message: "Сервер работает.",
    });
  });

  app.use("/api/public", createPublicMenuRouter(config));
  app.use("/api/public", createPublicOrdersRouter(config));
  app.use("/api/auth", sessionManager.middleware, createAuthRouter(config));
  app.use("/api/manage", sessionManager.middleware, createManageMenuRouter(config));

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
