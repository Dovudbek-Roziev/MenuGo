import assert from "node:assert/strict";
import argon2 from "argon2";
import { randomBytes, randomUUID } from "node:crypto";
import mongoose from "mongoose";
import { closeAppSessionStore, createApp } from "../app.js";
import { readConfig } from "../config.js";
import { Cafe } from "../models/Cafe.js";
import { Category } from "../models/Category.js";
import { Dish } from "../models/Dish.js";
import { Order } from "../models/Order.js";
import { CafeTable } from "../models/Table.js";
import { User } from "../models/User.js";

type Reply = { status: number; body: Record<string, any>; cookie: string; headers: Headers };
let stage = "подготовка";

async function main() {
  const baseConfig = readConfig();
  if (!baseConfig.mongoUri) throw new Error("Для проверки нужен локальный MONGO_URI.");
  const config = { ...baseConfig, frontendUrl: "http://127.0.0.1:5173",
    sessionSecret: randomBytes(48).toString("base64url"), secureCookies: false };
  await mongoose.connect(baseConfig.mongoUri, { dbName: "menugo_stage11_verification", serverSelectionTimeoutMS: 5000 });
  await Promise.all([Cafe.init(), CafeTable.init(), Category.init(), Dish.init(), Order.init(), User.init()]);

  const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
  const password = randomBytes(24).toString("base64url");
  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
  const ownerEmail = `tables-owner-${suffix}@example.invalid`;
  const staffEmail = `tables-staff-${suffix}@example.invalid`;
  const cafe = await Cafe.create({ name: `Tables verification ${suffix}`, slug: `tables-${suffix}`, isActive: true });
  const foreignCafe = await Cafe.create({ name: `Foreign tables ${suffix}`, slug: `foreign-tables-${suffix}`, isActive: true });
  const inactiveCafe = await Cafe.create({ name: `Inactive tables ${suffix}`, slug: `inactive-tables-${suffix}`, isActive: false });
  await User.create({ name: "Tables owner", email: ownerEmail, passwordHash, cafeId: cafe._id, role: "owner", isActive: true });
  await User.create({ name: "Tables staff", email: staffEmail, passwordHash, cafeId: cafe._id, role: "staff", isActive: true });
  await User.create({ name: "Foreign owner", email: `foreign-owner-${suffix}@example.invalid`, passwordHash, cafeId: foreignCafe._id, role: "owner", isActive: true });
  const category = await Category.create({ cafeId: cafe._id, name: `Category ${suffix}`, isActive: true });
  const dish = await Dish.create({ cafeId: cafe._id, categoryId: category._id, name: `Dish ${suffix}`, priceSom: 125, isAvailable: true });
  const foreignTable = await CafeTable.create({ cafeId: foreignCafe._id, name: "Foreign table", qrCode: randomBytes(32).toString("base64url"), isActive: true });
  const inactiveCafeTable = await CafeTable.create({ cafeId: inactiveCafe._id, name: "Inactive cafe table", qrCode: randomBytes(32).toString("base64url"), isActive: true });

  const app = createApp(config);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  const tablesPath = "/api/manage/tables";

  async function call(path: string, options: { method?: string; cookie?: string; csrf?: string; origin?: string; body?: unknown } = {}): Promise<Reply> {
    const headers: Record<string, string> = { Origin: options.origin ?? config.frontendUrl };
    if (options.cookie) headers.Cookie = options.cookie;
    if (options.csrf) headers["X-CSRF-Token"] = options.csrf;
    if (options.body !== undefined) headers["Content-Type"] = "application/json";
    const result = await fetch(`${base}${path}`, { method: options.method ?? "GET", headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body) });
    return { status: result.status, body: await result.json() as Record<string, any>,
      cookie: result.headers.get("Set-Cookie")?.split(";")[0] ?? options.cookie ?? "", headers: result.headers };
  }

  async function login(email: string): Promise<{ cookie: string; csrf: string }> {
    const initial = await call("/api/auth/csrf");
    assert.equal(initial.status, 200);
    const result = await call("/api/auth/login", { method: "POST", cookie: initial.cookie,
      csrf: initial.body.csrfToken, body: { email, password } });
    assert.equal(result.status, 200);
    return { cookie: result.cookie, csrf: result.body.csrfToken };
  }

  const ownerSession = await login(ownerEmail);
  const staffSession = await login(staffEmail);
  const orderPath = `/api/public/cafes/${cafe.slug}/tables`;
  try {
    stage = "доступ owner/staff и границы кафе";
    console.info(`Этап: ${stage}.`);
    assert.equal((await call(tablesPath)).status, 401);
    assert.equal((await call(tablesPath, { cookie: staffSession.cookie })).status, 403);
    assert.equal((await call(tablesPath, { cookie: ownerSession.cookie })).status, 200);
    assert.equal((await call(`${tablesPath}/${foreignTable.id}`, { method: "PATCH", ...ownerSession,
      body: { name: "Foreign rename" } })).status, 404);

    stage = "Origin, CSRF и валидация";
    console.info(`Этап: ${stage}.`);
    assert.equal((await call(tablesPath, { method: "POST", cookie: ownerSession.cookie, body: { name: "Missing token" } })).status, 403);
    const foreignOrigin = await call(tablesPath, { method: "POST", ...ownerSession, origin: "https://invalid.example", body: { name: "Foreign origin" } });
    assert.equal(foreignOrigin.status, 403);
    assert.equal(foreignOrigin.body.code, "ORIGIN_FORBIDDEN");
    for (const body of [{}, { name: " " }, { name: "x".repeat(61) }, { name: "One", isActive: true }, null]) {
      assert.equal((await call(tablesPath, { method: "POST", ...ownerSession, body })).status, 400);
    }
    assert.equal((await call(`${tablesPath}/invalid`, { method: "PATCH", ...ownerSession, body: { name: "No" } })).status, 400);
    assert.equal((await call(`${tablesPath}/${foreignTable.id}`, { method: "PATCH", ...ownerSession, body: { name: "" } })).status, 400);
    assert.equal((await call(`${tablesPath}/${foreignTable.id}`, { method: "PATCH", ...ownerSession, body: { isActive: "false" } })).status, 400);
    assert.equal((await call(`${tablesPath}/${foreignTable.id}`, { method: "PATCH", ...ownerSession, body: {} })).status, 400);

    stage = "создание, уникальный QR и дубли";
    console.info(`Этап: ${stage}.`);
    const create = await call(tablesPath, { method: "POST", ...ownerSession, body: { name: "Терраса 1" } });
    assert.equal(create.status, 201);
    const table = create.body.table;
    assert.equal(typeof table.id, "string");
    assert.match(table.tableCode, /^[A-Za-z0-9_-]{43}$/);
    assert.notEqual(table.tableCode, table.id);
    assert.equal((await call(tablesPath, { method: "POST", ...ownerSession, body: { name: "Терраса 1" } })).status, 409);
    const order = await call(`${orderPath}/${table.tableCode}/orders`, { method: "POST", body: {
      requestId: randomUUID(), items: [{ dishId: dish.id.toString(), quantity: 2 }], expectedTotalSom: 250,
    } });
    assert.equal(order.status, 201);
    assert.equal(order.body.table.name, "Терраса 1");

    const parallelName = `Параллельный ${suffix}`;
    const parallelCreates = await Promise.all([
      call(tablesPath, { method: "POST", ...ownerSession, body: { name: parallelName } }),
      call(tablesPath, { method: "POST", ...ownerSession, body: { name: parallelName } }),
    ]);
    assert.deepEqual(parallelCreates.map((reply) => reply.status).sort(), [201, 409]);

    stage = "список, изменение и параллельное имя";
    console.info(`Этап: ${stage}.`);
    const foreignTableCode = foreignTable.qrCode;
    const tableA = (await call(tablesPath, { method: "POST", ...ownerSession, body: { name: `Переименование A ${suffix}` } })).body.table;
    const tableB = (await call(tablesPath, { method: "POST", ...ownerSession, body: { name: `Переименование B ${suffix}` } })).body.table;
    const parallelRename = await Promise.all([
      call(`${tablesPath}/${tableA.id}`, { method: "PATCH", ...ownerSession, body: { name: `Общее имя ${suffix}` } }),
      call(`${tablesPath}/${tableB.id}`, { method: "PATCH", ...ownerSession, body: { name: `Общее имя ${suffix}` } }),
    ]);
    assert.deepEqual(parallelRename.map((reply) => reply.status).sort(), [200, 409]);
    const list = await call(tablesPath, { cookie: ownerSession.cookie });
    assert.equal(list.body.tables.some((item: any) => item.id === foreignTable.id), false);
    assert.equal(list.body.tables.some((item: any) => item.tableCode === foreignTableCode), false);
    assert.equal(list.body.tables.find((item: any) => item.id === table.id).name, "Терраса 1");
    const edited = await call(`${tablesPath}/${table.id}`, { method: "PATCH", ...ownerSession, body: { name: "Терраса ВИП" } });
    assert.equal(edited.status, 200);
    assert.equal(edited.body.table.name, "Терраса ВИП");

    stage = "публичное меню и снимок старого заказа";
    console.info(`Этап: ${stage}.`);
    const storedOrder = await Order.findById(order.body.id).lean();
    assert.equal(storedOrder?.tableName, "Терраса 1");
    assert.equal((await call(`/api/public/cafes/${cafe.slug}/tables/${table.tableCode}/menu`)).status, 200);

    assert.equal((await call(`${tablesPath}/${table.id}`, { method: "PATCH", ...ownerSession, body: { isActive: false } })).status, 200);
    assert.equal((await call(tablesPath, { cookie: ownerSession.cookie })).body.tables.find((item: any) => item.id === table.id).isActive, false);
    assert.equal((await call(`/api/public/cafes/${cafe.slug}/tables/${table.tableCode}/menu`)).status, 404);
    assert.equal((await call(`${orderPath}/${table.tableCode}/orders`, { method: "POST", body: {
      requestId: randomUUID(), items: [{ dishId: dish.id.toString(), quantity: 1 }], expectedTotalSom: 125,
    } })).status, 404);
    assert.equal((await Order.findById(order.body.id).lean())?.tableName, "Терраса 1");
    assert.equal((await call(`${tablesPath}/${table.id}`, { method: "PATCH", ...ownerSession, body: { isActive: true } })).status, 200);
    await Cafe.updateOne({ _id: inactiveCafe._id }, { isActive: true });
    assert.equal((await call(`/api/public/cafes/${inactiveCafe.slug}/tables/${inactiveCafeTable.qrCode}/menu`)).status, 200);
    await Cafe.updateOne({ _id: inactiveCafe._id }, { isActive: false });
    assert.equal((await call(`/api/public/cafes/${inactiveCafe.slug}/tables/${inactiveCafeTable.qrCode}/menu`)).status, 404);

    stage = "база недоступна";
    console.info(`Этап: ${stage}.`);
    await mongoose.disconnect();
    const noDbApp = createApp(config);
    const noDbServer = noDbApp.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => noDbServer.once("listening", resolve));
    const noDbAddress = noDbServer.address();
    assert.ok(noDbAddress && typeof noDbAddress !== "string");
    const noDbBase = `http://127.0.0.1:${noDbAddress.port}`;
    const health = await fetch(`${noDbBase}/api/health`);
    assert.equal(health.status, 200);
    assert.equal((await health.json() as { database: string }).database, "disconnected");
    const noDb = await fetch(`${noDbBase}${tablesPath}`);
    assert.equal(noDb.status, 503);
    await new Promise<void>((resolve) => noDbServer.close(() => resolve()));
    await closeAppSessionStore(noDbApp);

    console.info("Проверены owner/staff, изоляция кафе, CSRF/Origin, ввод и дубли, параллельные create/rename, случайный QR, гостевое меню, неактивные стол/кафе, разрыв соединения с MongoDB и неизменность снимка заказа.");
    console.info("Тестовые записи созданы только в menugo_stage11_verification. Данные других баз не изменялись.");
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await closeAppSessionStore(app);
    await mongoose.disconnect();
  }
}

try { await main(); }
catch (error) {
  console.error(`Проверка столов не прошла (${stage}). Подробности подключения скрыты.`);
  if (error instanceof assert.AssertionError) console.error(error.message);
  process.exitCode = 1;
} finally { await mongoose.disconnect(); }
