import { Router } from "express";
import argon2 from "argon2";
import { Cafe } from "../models/Cafe.js";
import { User, normalizeEmail } from "../models/User.js";
import type { ServerConfig } from "../config.js";
import { requireAuth } from "./permissions.js";
import { createLoginRateLimit } from "./loginRateLimit.js";
import { newCsrfToken, rejectForeignOrigin, requireCsrf, requireOrigin } from "./security.js";
import { SESSION_COOKIE } from "./sessions.js";

function saveSession(request: Express.Request): Promise<void> {
  return new Promise((resolve, reject) => request.session.save((error) => error ? reject(error) : resolve()));
}

function regenerateSession(request: Express.Request): Promise<void> {
  return new Promise((resolve, reject) => request.session.regenerate((error) => error ? reject(error) : resolve()));
}

function destroySession(request: Express.Request): Promise<void> {
  return new Promise((resolve, reject) => request.session.destroy((error) => error ? reject(error) : resolve()));
}

export function createAuthRouter(config: ServerConfig) {
  const router = Router();
  router.use(rejectForeignOrigin(config));

  router.get("/csrf", async (request, response) => {
    if (!request.session.csrfToken) {
      request.session.csrfToken = newCsrfToken();
      try { await saveSession(request); }
      catch { response.status(503).json({ message: "Не удалось сохранить сессию." }); return; }
    }
    response.json({ csrfToken: request.session.csrfToken });
  });

  router.post("/login", requireOrigin(config), requireCsrf, createLoginRateLimit(), async (request, response) => {
    const body: unknown = request.body;
    if (!body || typeof body !== "object" || Array.isArray(body) ||
        !("email" in body) || typeof body.email !== "string" ||
        !("password" in body) || typeof body.password !== "string") {
      response.status(400).json({ message: "Укажите email и пароль." });
      return;
    }
    const email = normalizeEmail(body.email);
    const password = body.password;
    const denied = () => response.status(401).json({ message: "Неверный email или пароль." });
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
        Array.from(password).length < 12 || Array.from(password).length > 128) { denied(); return; }

    try {
      const user = await User.findOne({ email }).select("+passwordHash name email cafeId role isActive");
      if (!user || !user.isActive || typeof user.passwordHash !== "string" || !await argon2.verify(user.passwordHash, password)) { denied(); return; }
      const cafe = await Cafe.findById(user.cafeId).select("_id name slug isActive").lean();
      if (!cafe || !cafe.isActive) { denied(); return; }

      await regenerateSession(request);
      request.session.userId = user._id.toString();
      request.session.csrfToken = newCsrfToken();
      await saveSession(request);
      response.json({
        user: { id: user._id.toString(), name: user.name, email: user.email, role: user.role },
        cafe: { id: cafe._id.toString(), name: cafe.name, slug: cafe.slug },
        csrfToken: request.session.csrfToken,
      });
    } catch {
      response.status(503).json({ message: "Вход временно недоступен." });
    }
  });

  router.get("/me", requireAuth, (request, response) => {
    response.json(request.auth);
  });

  router.post("/logout", requireOrigin(config), requireCsrf, async (request, response) => {
    try {
      await destroySession(request);
      response.clearCookie(SESSION_COOKIE, { path: "/", httpOnly: true, sameSite: "lax", secure: config.secureCookies === true });
      response.json({ message: "Вы вышли из аккаунта." });
    } catch {
      response.status(503).json({ message: "Не удалось завершить сессию." });
    }
  });

  return router;
}
