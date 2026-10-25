import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import express from "express";
import argon2 from "argon2";
import mongoose from "mongoose";
import { closeAppSessionStore, createApp } from "../app.js";
import { createSessionManager } from "../auth/sessions.js";
import { requireCsrf, requireOrigin } from "../auth/security.js";
import { requireAuth, requireCafeAccess, requireRole } from "../auth/permissions.js";
import { readConfig } from "../config.js";
import { Cafe } from "../models/Cafe.js";
import { CafeTable } from "../models/Table.js";
import { Category } from "../models/Category.js";
import { Dish } from "../models/Dish.js";
import { User } from "../models/User.js";

type Reply = { status: number; body: Record<string, unknown>; headers: Headers; cookie: string };
let verificationStage = "подготовка";

async function listen(app: ReturnType<typeof express>): Promise<{ base: string; close: () => Promise<void> }> {
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return { base: `http://127.0.0.1:${address.port}`, close: () => new Promise((resolve) => server.close(() => resolve())) };
}

async function call(base: string, path: string, options: { method?: string; cookie?: string; csrf?: string; origin?: string | null; body?: unknown; extraHeaders?: Record<string, string> } = {}): Promise<Reply> {
  const headers: Record<string, string> = {};
  if (options.origin !== null) headers.Origin = options.origin ?? "http://127.0.0.1:5173";
  if (options.cookie) headers.Cookie = options.cookie;
  if (options.csrf) headers["X-CSRF-Token"] = options.csrf;
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  Object.assign(headers, options.extraHeaders);
  const result = await fetch(`${base}${path}`, { method: options.method ?? "GET", headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body) });
  return { status: result.status, body: await result.json() as Record<string, unknown>, headers: result.headers,
    cookie: result.headers.get("Set-Cookie")?.split(";")[0] ?? "" };
}

async function main(): Promise<void> {
  const baseConfig = readConfig();
  const mongoUri = baseConfig.mongoUri;
  if (!mongoUri) throw new Error("Нужен MONGO_URI в локальном .env.");
  const config = { ...baseConfig, frontendUrl: "http://127.0.0.1:5173",
    sessionSecret: randomBytes(48).toString("base64url"), secureCookies: false };
  await mongoose.connect(mongoUri, { dbName: "menugo_stage81_verification", serverSelectionTimeoutMS: 5000 });
  await Promise.all([Cafe.init(), CafeTable.init(), Category.init(), Dish.init(), User.init()]);

  const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
  const password = randomBytes(24).toString("base64url");
  const hash = await argon2.hash(password, { type: argon2.argon2id });
  assert.ok(hash.startsWith("$argon2id$"));
  assert.equal(await argon2.verify(hash, password), true);
  const cafeA = await Cafe.create({ name: "Тестовое кафе А", slug: `auth-${suffix}-a`, isActive: true });
  const cafeB = await Cafe.create({ name: "Тестовое кафе Б", slug: `auth-${suffix}-b`, isActive: true });
  const inactiveCafe = await Cafe.create({ name: "Тестовое кафе В", slug: `auth-${suffix}-c`, isActive: false });
  const ownerEmail = `owner-${suffix}@example.invalid`;
  const owner = await User.create({ name: "Владелец", email: `  ${ownerEmail.toUpperCase()}  `, passwordHash: hash, cafeId: cafeA._id, role: "owner", isActive: true });
  const staff = await User.create({ name: "Сотрудник", email: `staff-${suffix}@example.invalid`, passwordHash: hash, cafeId: cafeA._id, role: "staff", isActive: true });
  await User.create({ name: "Неактивный", email: `inactive-${suffix}@example.invalid`, passwordHash: hash, cafeId: cafeA._id, role: "staff", isActive: false });
  await User.create({ name: "Чужое кафе", email: `foreign-${suffix}@example.invalid`, passwordHash: hash, cafeId: cafeB._id, role: "owner", isActive: true });
  await User.create({ name: "Неактивное кафе", email: `cafe-${suffix}@example.invalid`, passwordHash: hash, cafeId: inactiveCafe._id, role: "owner", isActive: true });
  assert.equal((await User.findById(owner._id).lean())?.email, ownerEmail);
  assert.equal("passwordHash" in (await User.findById(owner._id).lean() ?? {}), false);
  await assert.rejects(User.create({ name: "Дубль", email: ownerEmail.toUpperCase(), passwordHash: hash, cafeId: cafeA._id, role: "staff" }));

  const table = await CafeTable.create({ cafeId: cafeA._id, name: "Стол 1", qrCode: `auth-table-${suffix}`, isActive: true });
  const category = await Category.create({ cafeId: cafeA._id, name: "Еда", isActive: true });
  const dish = await Dish.create({ cafeId: cafeA._id, categoryId: category._id, name: "Суп", priceSom: 75, isAvailable: true });
  const app = createApp(config);
  const http = await listen(app);
  const testSessions = createSessionManager(config);
  const harness = express();
  harness.use(testSessions.middleware);
  harness.get("/owner/:cafeId", requireAuth, requireRole("owner"), requireCafeAccess(), (_request, response) => response.json({ ok: true }));
  harness.get("/staff/:cafeId", requireAuth, requireRole("owner", "staff"), requireCafeAccess(), (_request, response) => response.json({ ok: true }));
  harness.post("/write/:cafeId", requireOrigin(config), requireCsrf, requireAuth, requireRole("owner"), requireCafeAccess(), (_request, response) => response.json({ ok: true }));
  const probe = await listen(harness);
  const extraApps: ReturnType<typeof createApp>[] = [];

  try {
    verificationStage = "cookie и CSRF";
    const sessionsCollection = mongoose.connection.db!.collection("sessions");
    await sessionsCollection.drop().catch(() => undefined);
    // A conflicting non-TTL index deterministically rejects TTL index setup.
    await sessionsCollection.createIndex({ expires: 1 }, { name: "expires_1" });
    const unhandledRejections: unknown[] = [];
    const recordUnhandledRejection = (reason: unknown) => unhandledRejections.push(reason);
    process.on("unhandledRejection", recordUnhandledRejection);
    try {
      const failedInit = await Promise.all([
        call(http.base, "/api/auth/me"),
        call(http.base, "/api/auth/csrf"),
      ]);
      assert.deepEqual(failedInit.map((reply) => reply.status), [503, 503]);
      assert.equal((await call(http.base, "/api/health")).status, 200);
      assert.equal((await call(http.base, `/api/public/cafes/${cafeA.slug}/tables/${table.qrCode}/menu`)).status, 200);
      await new Promise<void>((resolve) => setImmediate(resolve));
      assert.equal(unhandledRejections.length, 0);

      await sessionsCollection.dropIndex("expires_1");
      const recovered = await call(http.base, "/api/auth/csrf");
      assert.equal(recovered.status, 200);
      assert.ok(recovered.cookie.startsWith("menugo.sid="));
      await new Promise<void>((resolve) => setImmediate(resolve));
      assert.equal(unhandledRejections.length, 0);
    } finally {
      process.removeListener("unhandledRejection", recordUnhandledRejection);
    }

    const csrf = await call(http.base, "/api/auth/csrf");
    assert.equal(csrf.status, 200);
    assert.ok(csrf.cookie.startsWith("menugo.sid="));
    assert.match(csrf.headers.get("Set-Cookie") ?? "", /HttpOnly/i);
    assert.match(csrf.headers.get("Set-Cookie") ?? "", /SameSite=Lax/i);
    assert.doesNotMatch(csrf.headers.get("Set-Cookie") ?? "", /; Secure/i);
    const expires = /Expires=([^;]+)/i.exec(csrf.headers.get("Set-Cookie") ?? "")?.[1];
    assert.ok(expires && Math.abs(Date.parse(expires) - Date.now() - 8 * 60 * 60 * 1000) < 60_000);
    assert.equal(csrf.headers.get("Cache-Control"), "no-store");
    assert.equal(csrf.headers.get("Access-Control-Allow-Origin"), config.frontendUrl);
    assert.equal(csrf.headers.get("Access-Control-Allow-Credentials"), "true");
    const firstToken = csrf.body.csrfToken as string;
    assert.ok(firstToken.length > 30);

    verificationStage = "вход и смена сессии";
    const loginBody = { email: ownerEmail.toUpperCase(), password, role: "staff", cafeId: cafeB.id };
    const invalidCsrf = await call(http.base, "/api/auth/login", { method: "POST", cookie: csrf.cookie, csrf: "wrong", body: loginBody });
    assert.equal(invalidCsrf.status, 403);
    assert.equal(invalidCsrf.body.code, "CSRF_INVALID");
    const forbiddenOrigin = await call(http.base, "/api/auth/login", { method: "POST", cookie: csrf.cookie, csrf: firstToken, origin: "http://evil.invalid", body: loginBody });
    assert.equal(forbiddenOrigin.status, 403);
    assert.equal(forbiddenOrigin.body.code, "ORIGIN_FORBIDDEN");
    assert.equal((await call(http.base, "/api/auth/login", { method: "POST", cookie: csrf.cookie, csrf: firstToken, origin: null, body: loginBody })).status, 403);
    const wrongPassword = await call(http.base, "/api/auth/login", { method: "POST", cookie: csrf.cookie, csrf: firstToken, body: { email: ownerEmail, password: `${password}x` } });
    const wrongEmail = await call(http.base, "/api/auth/login", { method: "POST", cookie: csrf.cookie, csrf: firstToken, body: { email: `missing-${suffix}@example.invalid`, password } });
    assert.equal(wrongPassword.status, 401);
    assert.equal(wrongEmail.status, 401);
    assert.deepEqual(wrongPassword.body, wrongEmail.body);

    const login = await call(http.base, "/api/auth/login", { method: "POST", cookie: csrf.cookie, csrf: firstToken, body: loginBody });
    assert.equal(login.status, 200);
    assert.notEqual(login.cookie, csrf.cookie);
    assert.notEqual(login.body.csrfToken, firstToken);
    assert.equal((login.body.user as { role: string }).role, "owner");
    assert.equal((login.body.cafe as { id: string }).id, cafeA.id);
    assert.equal("passwordHash" in login.body, false);
    assert.equal((await call(http.base, "/api/auth/me", { cookie: csrf.cookie })).status, 401);
    const me = await call(http.base, "/api/auth/me", { cookie: login.cookie });
    assert.equal(me.status, 200);
    assert.equal((me.body.user as { id: string }).id, owner.id);
    assert.equal(JSON.stringify(me.body).includes("passwordHash"), false);
    assert.equal(me.headers.get("Cache-Control"), "no-store");
    assert.equal((await call(http.base, "/api/auth/me", { cookie: login.cookie, origin: "http://evil.invalid" })).status, 403);

    verificationStage = "роли, кафе и изменения аккаунта";
    assert.equal((await call(probe.base, `/owner/${cafeA.id}`, { cookie: login.cookie })).status, 200);
    assert.equal((await call(probe.base, `/owner/${cafeB.id}`, { cookie: login.cookie })).status, 403);
    assert.equal((await call(probe.base, `/write/${cafeA.id}`, { method: "POST", cookie: login.cookie, csrf: firstToken })).status, 403);
    assert.equal((await call(probe.base, `/write/${cafeA.id}`, { method: "POST", cookie: login.cookie, csrf: login.body.csrfToken as string, origin: "http://evil.invalid" })).status, 403);
    assert.equal((await call(probe.base, `/write/${cafeA.id}`, { method: "POST", cookie: login.cookie, csrf: login.body.csrfToken as string })).status, 200);

    const staffCsrf = await call(http.base, "/api/auth/csrf");
    const staffLogin = await call(http.base, "/api/auth/login", { method: "POST", cookie: staffCsrf.cookie, csrf: staffCsrf.body.csrfToken as string,
      body: { email: staff.email, password } });
    assert.equal(staffLogin.status, 200);
    assert.equal((await call(probe.base, `/owner/${cafeA.id}`, { cookie: staffLogin.cookie })).status, 403);
    assert.equal((await call(probe.base, `/staff/${cafeA.id}`, { cookie: staffLogin.cookie })).status, 200);
    assert.equal((await call(probe.base, `/staff/${cafeB.id}`, { cookie: staffLogin.cookie })).status, 403);

    await User.updateOne({ _id: owner._id }, { $set: { role: "staff" } });
    assert.equal((await call(probe.base, `/owner/${cafeA.id}`, { cookie: login.cookie })).status, 403);
    assert.equal((await call(probe.base, `/staff/${cafeA.id}`, { cookie: login.cookie })).status, 200);
    await User.updateOne({ _id: owner._id }, { $set: { isActive: false } });
    assert.equal((await call(http.base, "/api/auth/me", { cookie: login.cookie })).status, 401);
    await User.deleteOne({ _id: staff._id });
    assert.equal((await call(http.base, "/api/auth/me", { cookie: staffLogin.cookie })).status, 401);

    const foreignCsrf = await call(http.base, "/api/auth/csrf");
    const foreignLogin = await call(http.base, "/api/auth/login", { method: "POST", cookie: foreignCsrf.cookie,
      csrf: foreignCsrf.body.csrfToken as string, body: { email: `foreign-${suffix}@example.invalid`, password } });
    assert.equal(foreignLogin.status, 200);
    await Cafe.updateOne({ _id: cafeB._id }, { $set: { isActive: false } });
    assert.equal((await call(http.base, "/api/auth/me", { cookie: foreignLogin.cookie })).status, 401);

    verificationStage = "выход";
    const logoutWrong = await call(http.base, "/api/auth/logout", { method: "POST", cookie: login.cookie, csrf: firstToken });
    assert.equal(logoutWrong.status, 403);
    const logout = await call(http.base, "/api/auth/logout", { method: "POST", cookie: login.cookie, csrf: login.body.csrfToken as string });
    assert.equal(logout.status, 200);
    assert.match(logout.headers.get("Set-Cookie") ?? "", /menugo\.sid=;/);
    assert.equal((await call(http.base, "/api/auth/me", { cookie: login.cookie })).status, 401);

    for (const email of [`inactive-${suffix}@example.invalid`, `cafe-${suffix}@example.invalid`]) {
      const token = await call(http.base, "/api/auth/csrf");
      const denied = await call(http.base, "/api/auth/login", { method: "POST", cookie: token.cookie, csrf: token.body.csrfToken as string, body: { email, password } });
      assert.equal(denied.status, 401);
      assert.deepEqual(denied.body, wrongPassword.body);
    }

    verificationStage = "публичные маршруты";
    const publicMenu = `/api/public/cafes/${cafeA.slug}/tables/${table.qrCode}/menu`;
    assert.equal((await call(http.base, "/api/health")).status, 200);
    assert.equal((await call(http.base, publicMenu)).status, 200);
    const publicOrder = await call(http.base, `/api/public/cafes/${cafeA.slug}/tables/${table.qrCode}/orders`, { method: "POST",
      body: { requestId: randomUUID(), items: [{ dishId: dish.id, quantity: 1 }], expectedTotalSom: 75 } });
    assert.equal(publicOrder.status, 201);

    verificationStage = "отсутствующие настройки";
    const noDbApp = createApp({ ...config, mongoUri: undefined });
    extraApps.push(noDbApp);
    const noDb = await listen(noDbApp);
    try {
      assert.equal((await call(noDb.base, "/api/auth/csrf")).status, 503);
      assert.equal((await call(noDb.base, "/api/health")).body.database, "not_configured");
      assert.equal((await call(noDb.base, publicMenu)).status, 503);
    } finally { await noDb.close(); }
    const noSecretApp = createApp({ ...config, sessionSecret: undefined });
    extraApps.push(noSecretApp);
    const noSecret = await listen(noSecretApp);
    try {
      assert.equal((await call(noSecret.base, "/api/auth/csrf")).status, 503);
      assert.equal((await call(noSecret.base, publicMenu)).status, 200);
    } finally { await noSecret.close(); }

    verificationStage = "лимит входа";
    const limitedApp = createApp(config);
    extraApps.push(limitedApp);
    const limited = await listen(limitedApp);
    try {
      const token = await call(limited.base, "/api/auth/csrf");
      for (let index = 0; index < 10; index++) {
        assert.equal((await call(limited.base, "/api/auth/login", { method: "POST", cookie: token.cookie,
          csrf: token.body.csrfToken as string, body: { email: ownerEmail, password: `${password}bad` } })).status, 401);
      }
      const blocked = await call(limited.base, "/api/auth/login", { method: "POST", cookie: token.cookie,
        csrf: token.body.csrfToken as string, body: { email: ownerEmail, password } });
      assert.equal(blocked.status, 429);
      assert.ok(Number(blocked.headers.get("Retry-After")) > 0);
      assert.equal(blocked.headers.get("Cache-Control"), "no-store");
    } finally { await limited.close(); }

    verificationStage = "Secure cookie";
    const secureApp = createApp({ ...config, frontendUrl: "https://example.test", secureCookies: true });
    extraApps.push(secureApp);
    const secure = await listen(secureApp);
    try {
      const token = await call(secure.base, "/api/auth/csrf", { origin: "https://example.test",
        extraHeaders: { "X-Forwarded-Proto": "https" } });
      assert.equal(token.status, 200);
      assert.match(token.headers.get("Set-Cookie") ?? "", /; Secure/i);
    } finally { await secure.close(); }

    console.info("Проверены: Argon2id, email и уникальность, CSRF/Origin, 401, cookie и смена SID, /me, logout, роли и кафе, изменения аккаунта, 429, 503, health и публичные меню/заказ.");
    console.info("Тестовые записи сохранены только в базе menugo_stage81_verification; существующие данные не удалялись.");
  } finally {
    await probe.close();
    await http.close();
    for (const extraApp of extraApps) await closeAppSessionStore(extraApp);
    await testSessions.close();
    await closeAppSessionStore(app);
  }
}

try { await main(); }
catch {
  // Driver errors can include credentials; do not print them.
  console.error(`Проверка аутентификации не прошла (${verificationStage}). Подробности скрыты, чтобы не раскрыть данные подключения.`);
  process.exitCode = 1;
} finally { await mongoose.disconnect(); }
