import type { RequestHandler } from "express";

const WINDOW_MS = 60_000;
const MAX_REQUESTS = 30;
const MAX_CLIENTS = 10_000;
const attempts = new Map<string, { count: number; expiresAt: number }>();

export const orderRateLimit: RequestHandler = (request, response, next) => {
  const now = Date.now();
  const ip = request.ip ?? request.socket.remoteAddress ?? "unknown";
  const current = attempts.get(ip);
  if (!current || current.expiresAt <= now) {
    if (attempts.size >= MAX_CLIENTS) {
      for (const [key, value] of attempts) {
        if (value.expiresAt <= now) attempts.delete(key);
      }
      if (attempts.size >= MAX_CLIENTS) attempts.delete(attempts.keys().next().value!);
    }
    attempts.set(ip, { count: 1, expiresAt: now + WINDOW_MS });
    next();
    return;
  }
  if (current.count >= MAX_REQUESTS) {
    response.set("Retry-After", String(Math.ceil((current.expiresAt - now) / 1000)));
    response.status(429).json({ message: "Слишком много запросов. Повторите попытку позже." });
    return;
  }
  current.count += 1;
  next();
};
