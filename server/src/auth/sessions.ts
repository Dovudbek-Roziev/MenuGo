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
  let sessionMiddleware: RequestHandler | undefined;
  let initialization: Promise<RequestHandler> | undefined;

  const initialize = async (): Promise<RequestHandler> => {
    const client = mongoose.connection.getClient();
    const databaseName = mongoose.connection.db?.databaseName;
    if (!databaseName) throw new Error("Session database is unavailable");

    // Disable connect-mongo's fire-and-forget index creation. Create and await
    // the TTL index ourselves before this store can serve any request.
    const store = MongoStore.create({
      client,
      dbName: databaseName,
      ttl: SESSION_MS / 1000,
      autoRemove: "disabled",
    });
    await client.db(databaseName).collection("sessions").createIndex(
      { expires: 1 },
      { name: "expires_1", background: true, expireAfterSeconds: 0 },
    );

    sessionMiddleware = session({
      name: SESSION_COOKIE,
      secret: config.sessionSecret!,
      store,
      resave: false,
      saveUninitialized: false,
      rolling: false,
      proxy: config.secureCookies === true,
      cookie: {
        httpOnly: true,
        sameSite: "lax",
        secure: config.secureCookies === true,
        maxAge: SESSION_MS,
        path: "/",
      },
    });
    return sessionMiddleware;
  };

  const getSessionMiddleware = (): Promise<RequestHandler> => {
    if (sessionMiddleware) return Promise.resolve(sessionMiddleware);
    if (!initialization) {
      initialization = initialize().catch((error: unknown) => {
        // Release the rejected attempt so a later request can retry. Do not
        // close the Mongoose-owned MongoClient: it serves the rest of the app.
        initialization = undefined;
        sessionMiddleware = undefined;
        throw error;
      });
    }
    return initialization;
  };

  const middleware: RequestHandler = (request, response, next) => {
    response.set("Cache-Control", "no-store");
    if (
      !config.sessionSecret || config.sessionSecret.length < 32 ||
      getDatabaseStatus(config.mongoUri) !== "connected"
    ) {
      response.status(503).json({ message: "Вход временно недоступен." });
      return;
    }

    void getSessionMiddleware()
      .then((handler) => handler(request, response, next))
      .catch(() => {
        response.status(503).json({ message: "Вход временно недоступен." });
      });
  };

  // connect-mongo's close() closes its MongoClient, which is owned by
  // Mongoose and shared with public API/model operations. It has no timers
  // when autoRemove is disabled, so there is no store-owned resource to close.
  return { middleware, close: async () => undefined };
}
