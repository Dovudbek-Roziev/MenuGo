import session from "express-session";
import MongoStore from "connect-mongo";
import mongoose from "mongoose";
import type { RequestHandler } from "express";
import type { ServerConfig } from "../config.js";
import { getDatabaseStatus } from "../database.js";

export const SESSION_COOKIE = "menugo.sid";
export const SESSION_MS = 8 * 60 * 60 * 1000;

declare module "express-session" {
  interface SessionData {
    userId?: string;
    csrfToken?: string;
  }
}

export interface SessionManager {
  middleware: RequestHandler;
  close: () => Promise<void>;
}

export function createSessionManager(config: ServerConfig): SessionManager {
  let store: MongoStore | undefined;
  let sessionMiddleware: RequestHandler | undefined;

  const middleware: RequestHandler = (request, response, next) => {
    response.set("Cache-Control", "no-store");
    if (!config.sessionSecret || config.sessionSecret.length < 32 || getDatabaseStatus(config.mongoUri) !== "connected") {
      response.status(503).json({ message: "Вход временно недоступен: база данных или настройка сессий отсутствует." });
      return;
    }
    try {
      if (!sessionMiddleware) {
        const client = mongoose.connection.getClient();
        store = MongoStore.create({
          client, dbName: mongoose.connection.db?.databaseName,
          ttl: SESSION_MS / 1000, autoRemove: "native",
        });
        store.on("error", () => console.error("Ошибка хранилища сессий."));
        sessionMiddleware = session({
          name: SESSION_COOKIE,
          secret: config.sessionSecret,
          store,
          resave: false,
          saveUninitialized: false,
          rolling: false,
          proxy: config.secureCookies === true,
          cookie: { httpOnly: true, sameSite: "lax", secure: config.secureCookies === true, maxAge: SESSION_MS, path: "/" },
        });
      }
      sessionMiddleware(request, response, next);
    } catch {
      response.status(503).json({ message: "Вход временно недоступен." });
    }
  };

  return { middleware, close: async () => { if (store) await store.close(); } };
}
