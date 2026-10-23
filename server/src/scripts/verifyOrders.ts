import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import mongoose, { Types } from "mongoose";
import { createApp } from "../app.js";
import { readConfig } from "../config.js";
import { Cafe } from "../models/Cafe.js";
import { CafeTable } from "../models/Table.js";
import { Category } from "../models/Category.js";
import { Dish } from "../models/Dish.js";
import { Order } from "../models/Order.js";

interface OrderResponse {
  id: string;
  totalSom: number;
  currency: string;
  status: string;
  code?: string;
  items: Array<{ priceSom: number; lineTotalSom: number }>;
}

async function verify() {
  const config = readConfig();
  if (!config.mongoUri) throw new Error("Для проверки заказов нужен MONGO_URI в локальном .env.");
  // Isolated database: no existing cafe or order documents are modified or removed.
  await mongoose.connect(config.mongoUri, { dbName: "menugo_stage6_verification", serverSelectionTimeoutMS: 5000 });
  await Promise.all([Cafe.init(), CafeTable.init(), Category.init(), Dish.init(), Order.init()]);

  const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
  const cafeA = await Cafe.create({ name: "Тестовое кафе А", slug: `verify-${suffix}-a`, isActive: true });
  const cafeB = await Cafe.create({ name: "Тестовое кафе Б", slug: `verify-${suffix}-b`, isActive: true });
  const table = await CafeTable.create({ cafeId: cafeA._id, name: "Стол 1", qrCode: `verify-table-${suffix}`, isActive: true });
  const categoryA = await Category.create({ cafeId: cafeA._id, name: "Блюда", isActive: true });
  const categoryB = await Category.create({ cafeId: cafeB._id, name: "Блюда", isActive: true });
  const dishA = await Dish.create({ cafeId: cafeA._id, categoryId: categoryA._id, name: "Суп", priceSom: 125, isAvailable: true });
  const dishA2 = await Dish.create({ cafeId: cafeA._id, categoryId: categoryA._id, name: "Чай", priceSom: 80, isAvailable: true });
  const dishB = await Dish.create({ cafeId: cafeB._id, categoryId: categoryB._id, name: "Блюдо другого кафе", priceSom: 900, isAvailable: true });

  const server = createApp(config).listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const base = `http://127.0.0.1:${address.port}/api/public/cafes/${cafeA.slug}/tables/${table.qrCode}/orders`;
    const post = async (url: string, body: unknown) => {
      const result = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      return { status: result.status, body: await result.json() as OrderResponse,
        retryAfter: result.headers.get("Retry-After"), exposedHeaders: result.headers.get("Access-Control-Expose-Headers") };
    };
    const items = [{ dishId: dishA.id, quantity: 2 }, { dishId: dishA2.id, quantity: 1 }];
    const requestId = randomUUID();
    const first = await post(base, { requestId, items, expectedTotalSom: 330 });
    assert.equal(first.status, 201);
    assert.equal(first.body.totalSom, 330);
    assert.equal(first.body.currency, "KGS");
    assert.equal(first.body.status, "new");
    assert.equal(first.body.items.length, 2);
    assert.equal(first.body.items.reduce((sum: number, item: { lineTotalSom: number }) => sum + item.lineTotalSom, 0), 330);
    assert.equal("requestId" in first.body || "cafeId" in first.body || "tableId" in first.body, false);
    const stored = await Order.findById(first.body.id);
    assert.equal(stored?.totalSom, 330);
    assert.equal(stored?.items[0]?.priceSom, 125);

    await Dish.updateOne({ _id: dishA._id }, { $set: { priceSom: 200 } });
    const repeat = await post(base, { requestId, items: items.toReversed(), expectedTotalSom: 330 });
    assert.equal(repeat.status, 200);
    assert.equal(repeat.body.id, first.body.id);
    assert.equal(repeat.body.totalSom, 330);
    assert.equal((await post(base, { requestId, items: [{ dishId: dishA.id, quantity: 1 }], expectedTotalSom: 200 })).status, 409);

    const staleRequestId = randomUUID();
    const stale = await post(base, { requestId: staleRequestId, items, expectedTotalSom: 330 });
    assert.equal(stale.status, 409);
    assert.equal(stale.body.code, "PRICE_CHANGED");
    assert.equal(await Order.countDocuments({ requestId: staleRequestId }), 0);
    const fresh = await post(base, { requestId: randomUUID(), items, expectedTotalSom: 480 });
    assert.equal(fresh.status, 201);
    assert.equal(fresh.body.totalSom, 480);

    assert.equal((await post(base, { requestId: randomUUID(), items: [{ dishId: dishA.id, quantity: 0 }], expectedTotalSom: 0 })).status, 400);
    assert.equal((await post(base, { requestId: randomUUID(), items: [{ dishId: "bad", quantity: 1 }], expectedTotalSom: 0 })).status, 400);
    assert.equal((await post(base, { requestId: "bad", items, expectedTotalSom: 480 })).status, 400);
    assert.equal((await post(base, { requestId: randomUUID(), items: [items[0], items[0]], expectedTotalSom: 480 })).status, 400);
    assert.equal((await post(base, { requestId: randomUUID(), items, totalSom: 1 })).status, 400);
    const foreignRequestId = randomUUID();
    assert.equal((await post(base, { requestId: foreignRequestId, items: [{ dishId: dishB.id, quantity: 1 }], expectedTotalSom: 900 })).status, 409);
    assert.equal(await Order.countDocuments({ requestId: foreignRequestId }), 0);
    const missingRequestId = randomUUID();
    assert.equal((await post(base, { requestId: missingRequestId, items: [{ dishId: dishA2.id, quantity: 1 }, { dishId: new Types.ObjectId().toString(), quantity: 1 }], expectedTotalSom: 80 })).status, 409);
    assert.equal(await Order.countDocuments({ requestId: missingRequestId }), 0);
    assert.equal((await post(base.replace(cafeA.slug, "unknown-cafe"), { requestId: randomUUID(), items, expectedTotalSom: 480 })).status, 404);
    assert.equal((await post(base.replace(table.qrCode, "unknown-table-000"), { requestId: randomUUID(), items, expectedTotalSom: 480 })).status, 404);

    const parallelId = randomUUID();
    const parallel = await Promise.all(Array.from({ length: 5 }, () => post(base, { requestId: parallelId, items: [{ dishId: dishA2.id, quantity: 1 }], expectedTotalSom: 80 })));
    assert.deepEqual(parallel.map((result) => result.status).sort(), [200, 200, 200, 200, 201]);
    assert.equal(new Set(parallel.map((result) => result.body.id)).size, 1);
    assert.equal(await Order.countDocuments({ cafeId: cafeA._id, tableId: table._id, requestId: parallelId }), 1);

    const noDb = createApp({ ...config, mongoUri: undefined }).listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => noDb.once("listening", resolve));
    try {
      const noDbAddress = noDb.address();
      assert.ok(noDbAddress && typeof noDbAddress !== "string");
      assert.equal((await post(base.replace(`:${address.port}`, `:${noDbAddress.port}`), { requestId: randomUUID(), items, expectedTotalSom: 480 })).status, 503);
    } finally {
      await new Promise<void>((resolve) => noDb.close(() => resolve()));
    }

    let limited = false;
    for (let i = 0; i < 40; i++) {
      const result = await post(base, { requestId: randomUUID(), items: [] });
      if (result.status === 429) {
        assert.ok(Number(result.retryAfter) > 0);
        assert.ok(result.exposedHeaders?.toLowerCase().includes("retry-after"));
        limited = true; break;
      }
    }
    assert.equal(limited, true);
    console.info("Проверено: 201, сохранённая сумма и снимок цены, PRICE_CHANGED без записи, 400, 404, 409, 503, 429, повтор 200 после изменения цены и параллельные запросы без дублей.");
    console.info("Тестовые записи сохранены только в отдельной базе menugo_stage6_verification; существующие заказы не удалялись.");
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

try {
  await verify();
} catch {
  // Database errors may contain credentials; never print raw exceptions.
  console.error("Проверка заказов не прошла. Подробности скрыты, чтобы не раскрыть данные подключения.");
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}
