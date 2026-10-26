import assert from "node:assert/strict";
import argon2 from "argon2";
import { randomBytes, randomUUID } from "node:crypto";
import mongoose from "mongoose";
import { closeAppSessionStore, createApp } from "../app.js";
import { readConfig } from "../config.js";
import { Cafe } from "../models/Cafe.js";
import { Order, type OrderStatus } from "../models/Order.js";
import { CafeTable } from "../models/Table.js";
import { User } from "../models/User.js";

type Reply = { status: number; body: Record<string, any>; cookie: string; headers: Headers };
let stage = "подготовка";

async function main() {
  const baseConfig = readConfig();
  if (!baseConfig.mongoUri) throw new Error("Для проверки нужен локальный MONGO_URI.");
  const config = { ...baseConfig, frontendUrl: "http://127.0.0.1:5173", sessionSecret: randomBytes(48).toString("base64url"), secureCookies: false };
  await mongoose.connect(baseConfig.mongoUri, { dbName: "menugo_stage101_verification", serverSelectionTimeoutMS: 5000 });
  await Promise.all([Cafe.init(), User.init(), CafeTable.init(), Order.init()]);

  const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
  const cafeA = await Cafe.create({ name: `Orders test ${suffix}`, slug: `orders-${suffix}-a`, isActive: true });
  const cafeB = await Cafe.create({ name: `Foreign orders ${suffix}`, slug: `orders-${suffix}-b`, isActive: true });
  const password = randomBytes(24).toString("base64url");
  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
  const ownerEmail = `owner-${suffix}@example.invalid`;
  const staffEmail = `staff-${suffix}@example.invalid`;
  await User.create({ name: "Owner test", email: ownerEmail, passwordHash, cafeId: cafeA._id, role: "owner", isActive: true });
  await User.create({ name: "Staff test", email: staffEmail, passwordHash, cafeId: cafeA._id, role: "staff", isActive: true });
  const table = await CafeTable.create({ cafeId: cafeA._id, name: "Стол 8", qrCode: `orders-table-${suffix}`, isActive: true });
  const foreignTable = await CafeTable.create({ cafeId: cafeB._id, name: "Foreign table", qrCode: `foreign-table-${suffix}`, isActive: true });

  async function makeOrder(index: number, status: OrderStatus = "new", cafeId = cafeA._id, tableId = table._id, tableName = table.name) {
    const createdAt = new Date(Date.now() + index * 1000);
    return Order.create({ cafeId, tableId, tableName, items: [{ dishId: new mongoose.Types.ObjectId(), name: `Snapshot dish ${index}`,
      priceSom: 120, quantity: 2, lineTotalSom: 240 }], totalSom: 240, currency: "KGS", status, requestId: randomUUID(), createdAt });
  }

  const mainOrder = await makeOrder(1);
  const cancelNew = await makeOrder(2);
  const cancelPreparing = await makeOrder(3, "preparing");
  const cancelReady = await makeOrder(4, "ready");
  const raceOrder = await makeOrder(5);
  const foreignOrder = await makeOrder(6, "new", cafeB._id, foreignTable._id, foreignTable.name);

  const app = createApp(config);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;

  async function call(path: string, options: { method?: string; cookie?: string; csrf?: string; origin?: string; body?: unknown } = {}): Promise<Reply> {
    const headers: Record<string, string> = { Origin: options.origin ?? config.frontendUrl };
    if (options.cookie) headers.Cookie = options.cookie;
    if (options.csrf) headers["X-CSRF-Token"] = options.csrf;
    if (options.body !== undefined) headers["Content-Type"] = "application/json";
    const response = await fetch(`${base}${path}`, { method: options.method ?? "GET", headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body) });
    return { status: response.status, body: await response.json() as Record<string, any>,
      cookie: response.headers.get("Set-Cookie")?.split(";")[0] ?? options.cookie ?? "", headers: response.headers };
  }

  async function login(email: string) {
    const csrf = await call("/api/auth/csrf");
    assert.equal(csrf.status, 200);
    const result = await call("/api/auth/login", { method: "POST", cookie: csrf.cookie, csrf: csrf.body.csrfToken,
      body: { email, password } });
    assert.equal(result.status, 200);
    return { cookie: result.cookie, csrf: result.body.csrfToken as string };
  }

  const owner = await login(ownerEmail);
  const staff = await login(staffEmail);
  const listPath = "/api/manage/orders";
  const statusPath = (id: string) => `${listPath}/${id}/status`;
  const patchStatus = (id: string, expectedStatus: string, status: string, session = owner) =>
    call(statusPath(id), { method: "PATCH", ...session, body: { expectedStatus, status } });

  try {
    stage = "доступ, изоляция и список заказов";
    console.info(`Этап: ${stage}.`);
    assert.equal((await call(listPath)).status, 401);
    const ownerList = await call(`${listPath}?limit=2&page=1`, { cookie: owner.cookie });
    const staffList = await call(listPath, { cookie: staff.cookie });
    assert.equal(ownerList.status, 200);
    assert.equal(staffList.status, 200);
    assert.equal(ownerList.body.pagination.total, 5);
    assert.equal(ownerList.body.pagination.totalPages, 3);
    assert.equal(ownerList.body.orders.length, 2);
    assert.equal(new Date(ownerList.body.orders[0].createdAt).getTime() > new Date(ownerList.body.orders[1].createdAt).getTime(), true);
    assert.equal(ownerList.body.orders.some((item: any) => item.id === foreignOrder.id), false);
    assert.equal("cafeId" in ownerList.body.orders[0], false);
    assert.equal("requestId" in ownerList.body.orders[0], false);
    const snapshot = ownerList.body.orders.find((item: any) => item.id === mainOrder.id) ??
      (await call(listPath, { cookie: owner.cookie })).body.orders.find((item: any) => item.id === mainOrder.id);
    assert.equal(snapshot.table.name, "Стол 8");
    assert.equal(snapshot.items[0].name, "Snapshot dish 1");
    assert.equal(snapshot.items[0].priceSom, 120);
    assert.equal(snapshot.items[0].quantity, 2);
    assert.equal(snapshot.totalSom, 240);
    assert.equal((await call(`${listPath}?status=ready`, { cookie: owner.cookie })).body.orders.some((item: any) => item.id === cancelReady.id), true);
    assert.equal((await call(`${listPath}?status=bad`, { cookie: owner.cookie })).status, 400);
    assert.equal((await call(`${listPath}?limit=1000`, { cookie: owner.cookie })).status, 400);
    assert.equal((await call(`${listPath}?unknown=x`, { cookie: owner.cookie })).status, 400);
    assert.equal(ownerList.headers.get("Cache-Control"), "no-store");

    stage = "валидация, CSRF, Origin и межкафейная изоляция";
    console.info(`Этап: ${stage}.`);
    assert.equal((await patchStatus("bad-id", "new", "preparing")).status, 400);
    assert.equal((await call(statusPath(mainOrder.id), { method: "PATCH", ...owner,
      body: { expectedStatus: "new", status: "preparing", cafeId: cafeB.id } })).status, 400);
    assert.equal((await call(statusPath(mainOrder.id), { method: "PATCH", cookie: owner.cookie,
      body: { expectedStatus: "new", status: "preparing" } })).status, 403);
    assert.equal((await call(statusPath(mainOrder.id), { method: "PATCH", cookie: owner.cookie, csrf: owner.csrf,
      origin: "https://invalid.example", body: { expectedStatus: "new", status: "preparing" } })).status, 403);
    assert.equal((await patchStatus(foreignOrder.id, "new", "preparing")).status, 404);
    assert.equal((await patchStatus(new mongoose.Types.ObjectId().toString(), "new", "preparing")).status, 404);

    stage = "переходы статусов и снимок заказа";
    console.info(`Этап: ${stage}.`);
    let updated = await patchStatus(mainOrder.id, "new", "preparing", staff);
    assert.equal(updated.status, 200);
    assert.equal(updated.body.order.status, "preparing");
    updated = await patchStatus(mainOrder.id, "preparing", "ready");
    assert.equal(updated.status, 200);
    updated = await patchStatus(mainOrder.id, "ready", "completed");
    assert.equal(updated.status, 200);
    assert.equal((await patchStatus(mainOrder.id, "completed", "cancelled")).status, 409);
    assert.equal((await patchStatus(mainOrder.id, "preparing", "ready")).status, 409);
    assert.equal((await patchStatus(cancelNew.id, "new", "cancelled")).status, 200);
    assert.equal((await patchStatus(cancelPreparing.id, "preparing", "cancelled")).status, 200);
    assert.equal((await patchStatus(cancelReady.id, "ready", "cancelled")).status, 200);
    assert.equal((await patchStatus(cancelNew.id, "cancelled", "new")).status, 409);
    const storedMain = await Order.findById(mainOrder.id).lean();
    assert.equal(storedMain?.status, "completed");
    assert.equal(storedMain?.totalSom, 240);
    assert.equal(storedMain?.items[0]?.name, "Snapshot dish 1");
    assert.equal(storedMain?.items[0]?.priceSom, 120);
    assert.equal(storedMain?.items[0]?.quantity, 2);
    assert.equal(storedMain?.items[0]?.lineTotalSom, 240);

    stage = "параллельные изменения статуса";
    console.info(`Этап: ${stage}.`);
    const concurrent = await Promise.all([
      patchStatus(raceOrder.id, "new", "preparing", owner),
      patchStatus(raceOrder.id, "new", "preparing", staff),
    ]);
    assert.deepEqual(concurrent.map((reply) => reply.status).sort(), [200, 409]);
    assert.equal((await Order.findById(raceOrder.id).lean())?.status, "preparing");

    stage = "база недоступна";
    const noDatabaseApp = createApp({ ...config, mongoUri: undefined });
    const noDatabaseServer = noDatabaseApp.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => noDatabaseServer.once("listening", resolve));
    const noDatabaseAddress = noDatabaseServer.address();
    assert.ok(noDatabaseAddress && typeof noDatabaseAddress !== "string");
    const unavailable = await fetch(`http://127.0.0.1:${noDatabaseAddress.port}${listPath}`, { headers: { Cookie: owner.cookie } });
    assert.equal(unavailable.status, 503);
    await new Promise<void>((resolve) => noDatabaseServer.close(() => resolve()));
    await closeAppSessionStore(noDatabaseApp);

    console.info("Проверены: owner/staff, изоляция кафе, сортировка и пагинация, фильтр статуса, разрешённые/запрещённые переходы, CSRF/Origin, атомарный параллельный PATCH и неизменность снимка заказа.");
    console.info("Тестовые записи находятся только в menugo_stage101_verification; существующие заказы не изменялись.");
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await closeAppSessionStore(app);
    await mongoose.disconnect();
  }
}

try { await main(); }
catch (error) {
  console.error(`Проверка заказов кабинета не прошла (${stage}). Подробности подключения скрыты.`);
  if (error instanceof assert.AssertionError) console.error(error.message);
  process.exitCode = 1;
} finally { await mongoose.disconnect(); }
