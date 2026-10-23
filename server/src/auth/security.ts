import { randomBytes, timingSafeEqual } from "node:crypto";
import type { RequestHandler } from "express";
import type { ServerConfig } from "../config.js";

export function newCsrfToken(): string {
  return randomBytes(32).toString("base64url");
}

export function requireOrigin(config: ServerConfig): RequestHandler {
  return (request, response, next) => {
    if (request.get("Origin") !== config.frontendUrl) {
      response.status(403).json({ message: "Источник запроса не разрешён." });
      return;
    }
    next();
  };
}

export function rejectForeignOrigin(config: ServerConfig): RequestHandler {
  return (request, response, next) => {
    const origin = request.get("Origin");
    if (origin && origin !== config.frontendUrl) {
      response.status(403).json({ message: "Источник запроса не разрешён." });
      return;
    }
    next();
  };
}

export const requireCsrf: RequestHandler = (request, response, next) => {
  const sent = request.get("X-CSRF-Token");
  const stored = request.session.csrfToken;
  const sentBytes = Buffer.from(sent ?? "");
  const storedBytes = Buffer.from(stored ?? "");
  if (!sent || !stored || sentBytes.length !== storedBytes.length ||
      !timingSafeEqual(sentBytes, storedBytes)) {
    response.status(403).json({ message: "Недействительный CSRF-токен." });
    return;
  }
  next();
};
