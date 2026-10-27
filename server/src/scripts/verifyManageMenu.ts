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
import { ImageStorageProviderError, type DishImageStorage } from "../services/dishImages.js";

type Reply = { status: number; body: Record<string, any>; cookie: string; headers: Headers };
let stage = "подготовка";

async function main() {
  const baseConfig = readConfig();
  if (!baseConfig.mongoUri) throw new Error("Для проверки нужен локальный MONGO_URI.");
  const config = { ...baseConfig, frontendUrl: "http://127.0.0.1:5173",
    sessionSecret: randomBytes(48).toString("base64url"), secureCookies: false };
  await mongoose.connect(baseConfig.mongoUri, { dbName: "menugo_stage91_verification", serverSelectionTimeoutMS: 5000 });
  await Promise.all([Cafe.init(), Category.init(), Dish.init(), Order.init(), CafeTable.init(), User.init()]);

  const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
  const password = randomBytes(24).toString("base64url");
  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
  const cafeA = await Cafe.create({ name: `Menu test ${suffix}`, slug: `manage-${suffix}-a`, isActive: true });
  const cafeB = await Cafe.create({ name: `Foreign test ${suffix}`, slug: `manage-${suffix}-b`, isActive: true });
  await User.create({ name: "Owner test", email: `owner-${suffix}@example.invalid`, passwordHash, cafeId: cafeA._id, role: "owner", isActive: true });
  await User.create({ name: "Staff test", email: `staff-${suffix}@example.invalid`, passwordHash, cafeId: cafeA._id, role: "staff", isActive: true });
  const foreignCategory = await Category.create({ cafeId: cafeB._id, name: "Foreign category", isActive: true });
  const foreignDish = await Dish.create({ cafeId: cafeB._id, categoryId: foreignCategory._id, name: "Foreign dish", priceSom: 900, isAvailable: true });
  const category = await Category.create({ cafeId: cafeA._id, name: "Drinks", sortOrder: 2, isActive: true });
  const dish = await Dish.create({ cafeId: cafeA._id, categoryId: category._id, name: "Tea", description: "Hot tea", priceSom: 100, isAvailable: true });
  const table = await CafeTable.create({ cafeId: cafeA._id, name: "Table test", qrCode: `manage-table-${suffix}`, isActive: true });

  let imageCounter = 0;
  let failImageUpload = false;
  let failImageRemove = false;
  const removedImages: string[] = [];
  let uploadBarrier: { expected: number; started: number; ready: Promise<void>; signalReady: () => void; gate: Promise<void>; release: () => void } | undefined;
  const imageStorage: DishImageStorage = {
    async upload(_buffer, format) {
      if (failImageUpload) throw new ImageStorageProviderError();
      const currentImage = ++imageCounter;
      const activeBarrier = uploadBarrier;
      if (activeBarrier) {
        activeBarrier.started += 1;
        if (activeBarrier.started === activeBarrier.expected) activeBarrier.signalReady();
        await activeBarrier.gate;
      }
      return { publicId: `verification/${suffix}/${currentImage}`, imageUrl: `https://res.cloudinary.com/mock/image/upload/${currentImage}.${format}` };
    },
    async remove(publicId) {
      removedImages.push(publicId);
      if (failImageRemove) throw new ImageStorageProviderError();
    },
  };

  function blockUploads(expected: number) {
    let signalReady!: () => void;
    let release!: () => void;
    const ready = new Promise<void>((resolve) => { signalReady = resolve; });
    const gate = new Promise<void>((resolve) => { release = resolve; });
    uploadBarrier = { expected, started: 0, ready, signalReady, gate, release };
    return uploadBarrier;
  }

  const app = createApp(config, imageStorage);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;

  async function call(path: string, options: { method?: string; cookie?: string; csrf?: string; origin?: string; body?: unknown; form?: FormData } = {}): Promise<Reply> {
    const headers: Record<string, string> = { Origin: options.origin ?? config.frontendUrl };
    if (options.cookie) headers.Cookie = options.cookie;
    if (options.csrf) headers["X-CSRF-Token"] = options.csrf;
    if (options.body !== undefined) headers["Content-Type"] = "application/json";
    const result = await fetch(`${base}${path}`, { method: options.method ?? "GET", headers,
      body: options.form ?? (options.body === undefined ? undefined : JSON.stringify(options.body)) });
    return { status: result.status, body: await result.json() as Record<string, any>,
      cookie: result.headers.get("Set-Cookie")?.split(";")[0] ?? options.cookie ?? "", headers: result.headers };
  }

  async function login(email: string): Promise<{ cookie: string; csrf: string }> {
    const initial = await call("/api/auth/csrf");
    console.info(`Проверка входа: CSRF ${initial.status}.`);
    assert.equal(initial.status, 200);
    const result = await call("/api/auth/login", { method: "POST", cookie: initial.cookie,
      csrf: initial.body.csrfToken, body: { email, password } });
    assert.equal(result.status, 200);
    console.info(`Проверка входа: login ${result.status}.`);
    return { cookie: result.cookie, csrf: result.body.csrfToken };
  }

  const ownerSession = await login(`owner-${suffix}@example.invalid`);
  const staffSession = await login(`staff-${suffix}@example.invalid`);
  const managePath = "/api/manage/menu";
  const publicMenuPath = `/api/public/cafes/${cafeA.slug}/tables/${table.qrCode}/menu`;
  const orderPath = `/api/public/cafes/${cafeA.slug}/tables/${table.qrCode}/orders`;

  try {
    stage = "владелец и список меню";
    console.info(`Этап: ${stage}.`);
    assert.equal((await call(managePath)).status, 401);
    const listing = await call(managePath, { cookie: ownerSession.cookie });
    assert.equal(listing.status, 200);
    assert.equal(listing.body.categories.some((item: any) => item.id === category.id), true);
    assert.equal(listing.body.categories.find((item: any) => item.id === category.id).dishes[0].id, dish.id);
    assert.equal("cafeId" in listing.body.categories[0], false);
    assert.equal((await call(managePath, { cookie: staffSession.cookie })).status, 403);
    assert.equal((await call(`${managePath}/dishes/${foreignDish.id}`, { method: "PATCH", ...ownerSession,
      body: { name: "Attempted foreign edit" } })).status, 404);

    stage = "CSRF и Origin";
    console.info(`Этап: ${stage}.`);
    assert.equal((await call(`${managePath}/categories`, { method: "POST", cookie: ownerSession.cookie,
      csrf: "wrong-token", body: { name: "No write" } })).status, 403);
    const csrfDenied = await call(`${managePath}/categories`, { method: "POST", cookie: ownerSession.cookie,
      body: { name: "No write" }, origin: "https://invalid.example" });
    assert.equal(csrfDenied.status, 403);
    assert.equal(csrfDenied.body.code, "ORIGIN_FORBIDDEN");

    stage = "категории";
    console.info(`Этап: ${stage}.`);
    const newCategory = await call(`${managePath}/categories`, { method: "POST", ...ownerSession,
      body: { name: "  Desserts  ", sortOrder: 4 } });
    assert.equal(newCategory.status, 201);
    const createdCategoryId = newCategory.body.category.id as string;
    assert.equal(newCategory.body.category.name, "Desserts");
    assert.equal((await call(`${managePath}/categories`, { method: "POST", ...ownerSession,
      body: { name: "Desserts" } })).status, 409);
    assert.equal((await call(`${managePath}/categories`, { method: "POST", ...ownerSession,
      body: { name: "   " } })).status, 400);
    assert.equal((await call(`${managePath}/categories`, { method: "POST", ...ownerSession,
      body: { name: "Bad field", cafeId: cafeB.id } })).status, 400);
    assert.equal((await call(`${managePath}/categories/${createdCategoryId}`, { method: "PATCH", ...ownerSession, body: {} })).status, 400);
    assert.equal((await call(`${managePath}/categories/not-an-id`, { method: "PATCH", ...ownerSession, body: { name: "X" } })).status, 400);
    const categoryEdit = await call(`${managePath}/categories/${createdCategoryId}`, { method: "PATCH", ...ownerSession,
      body: { name: "Sweets", sortOrder: 3 } });
    assert.equal(categoryEdit.status, 200);
    assert.equal(categoryEdit.body.category.name, "Sweets");
    assert.equal((await call(`${managePath}/categories/${createdCategoryId}`, { method: "PATCH", ...ownerSession,
      body: { isActive: false } })).body.category.isActive, false);
    const inactiveListing = await call(managePath, { cookie: ownerSession.cookie });
    assert.equal(inactiveListing.body.categories.find((item: any) => item.id === createdCategoryId).isActive, false);
    assert.equal((await call(`${managePath}/categories/${createdCategoryId}`, { method: "PATCH", ...ownerSession,
      body: { isActive: true } })).body.category.isActive, true);
    assert.equal((await call(`${managePath}/categories/${createdCategoryId}`, { method: "PATCH", ...ownerSession,
      body: { name: "Drinks" } })).status, 409);

    stage = "блюда и разделение кафе";
    console.info("Этап: блюда и изоляция кафе.");
    const newDish = await call(`${managePath}/dishes`, { method: "POST", ...ownerSession,
      body: { categoryId: createdCategoryId, name: "Cake", description: "Sweet", priceSom: 250, sortOrder: 1 } });
    assert.equal(newDish.status, 201);
    const createdDishId = newDish.body.dish.id as string;
    const secondDish = await call(`${managePath}/dishes`, { method: "POST", ...ownerSession,
      body: { categoryId: createdCategoryId, name: "Pie", priceSom: 150 } });
    assert.equal(secondDish.status, 201);
    assert.equal((await call(`${managePath}/dishes`, { method: "POST", ...ownerSession,
      body: { categoryId: createdCategoryId, name: "Cake", priceSom: 200 } })).status, 409);
    assert.equal((await call(`${managePath}/dishes`, { method: "POST", ...ownerSession,
      body: { categoryId: foreignCategory.id, name: "Foreign category item", priceSom: 5 } })).status, 404);
    assert.equal((await call(`${managePath}/dishes`, { method: "POST", ...ownerSession,
      body: { categoryId: createdCategoryId, name: "Negative", priceSom: -1 } })).status, 400);
    assert.equal((await call(`${managePath}/dishes`, { method: "POST", ...ownerSession,
      body: { categoryId: createdCategoryId, name: "Fraction", priceSom: 1.5 } })).status, 400);
    assert.equal((await call(`${managePath}/dishes/${createdDishId}`, { method: "PATCH", ...ownerSession,
      body: { categoryId: foreignCategory.id } })).status, 404);
    const afterForeignPatch = await Dish.findById(createdDishId);
    assert.equal(afterForeignPatch?.categoryId.toString(), createdCategoryId);
    assert.equal((await call(`${managePath}/dishes/${dish.id}`, { method: "PATCH", ...ownerSession,
      body: { name: "Foreign rename", cafeId: cafeB.id } })).status, 400);
    const dishEdit = await call(`${managePath}/dishes/${createdDishId}`, { method: "PATCH", ...ownerSession,
      body: { name: "Cake slice", description: "Updated", priceSom: 275, sortOrder: 7 } });
    assert.equal(dishEdit.status, 200);
    assert.equal(dishEdit.body.dish.priceSom, 275);
    assert.equal((await call(`${managePath}/dishes/${createdDishId}`, { method: "PATCH", ...ownerSession,
      body: { isAvailable: false } })).body.dish.isAvailable, false);
    const unavailableListing = await call(managePath, { cookie: ownerSession.cookie });
    const listedCake = unavailableListing.body.categories.flatMap((item: any) => item.dishes).find((item: any) => item.id === createdDishId);
    assert.equal(listedCake.isAvailable, false);
    assert.equal((await call(`${managePath}/dishes/${createdDishId}`, { method: "PATCH", ...ownerSession,
      body: { isAvailable: true } })).body.dish.isAvailable, true);
    assert.equal((await call(`${managePath}/dishes/${createdDishId}`, { method: "PATCH", ...ownerSession,
      body: { name: "Pie" } })).status, 409);
    assert.equal((await call(`${managePath}/dishes/${foreignCategory.id}`, { method: "PATCH", ...ownerSession,
      body: { name: "Hidden" } })).status, 404);

    stage = "загрузка и управление фотографиями блюд";
    console.info(`Этап: ${stage}.`);
    const imagePath = (id: string) => `${managePath}/dishes/${id}/image`;
    const makeImageForm = (type = "image/png", bytes?: Uint8Array) => {
      const form = new FormData();
      form.append("image", new Blob([bytes ?? new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82])], { type }), "dish.png");
      return form;
    };
    assert.equal((await call(imagePath(dish.id), { method: "POST", ...staffSession, form: makeImageForm() })).status, 403);
    assert.equal((await call(imagePath(foreignDish.id), { method: "POST", ...ownerSession, form: makeImageForm() })).status, 404);
    assert.equal((await call(imagePath(dish.id), { method: "POST", cookie: ownerSession.cookie,
      origin: "https://invalid.example", csrf: ownerSession.csrf, form: makeImageForm() })).status, 403);
    assert.equal((await call(imagePath(dish.id), { method: "POST", cookie: ownerSession.cookie,
      form: makeImageForm() })).status, 403);
    const invalidImage = await call(imagePath(dish.id), { method: "POST", ...ownerSession,
      form: makeImageForm("image/jpeg", new TextEncoder().encode("not an image")) });
    assert.equal(invalidImage.status, 400);
    const tooLarge = await call(imagePath(dish.id), { method: "POST", ...ownerSession,
      form: makeImageForm("image/jpeg", new Uint8Array(5 * 1024 * 1024 + 1)) });
    assert.equal(tooLarge.status, 413);
    const directUrl = await call(imagePath(dish.id), { method: "POST", ...ownerSession,
      body: { url: "https://images.example.invalid/dish.jpg" } });
    assert.equal(directUrl.status, 400);

    const firstImage = await call(imagePath(dish.id), { method: "POST", ...ownerSession, form: makeImageForm() });
    assert.equal(firstImage.status, 200);
    assert.match(firstImage.body.imageUrl, /^https:\/\/res\.cloudinary\.com\//);
    let savedDish = await Dish.findById(dish.id).select("+imagePublicId");
    assert.equal(savedDish?.imagePublicId, `verification/${suffix}/1`);
    const imageListing = await call(managePath, { cookie: ownerSession.cookie });
    const managedImageDish = imageListing.body.categories.flatMap((item: any) => item.dishes).find((item: any) => item.id === dish.id);
    assert.equal(managedImageDish.imageUrl, firstImage.body.imageUrl);
    assert.equal("imagePublicId" in managedImageDish, false);
    const publicImageMenu = await call(publicMenuPath);
    const publicImageDish = publicImageMenu.body.categories.flatMap((item: any) => item.dishes).find((item: any) => item.id === dish.id);
    assert.equal(publicImageDish.imageUrl, firstImage.body.imageUrl);

    const replacement = await call(imagePath(dish.id), { method: "POST", ...ownerSession, form: makeImageForm() });
    assert.equal(replacement.status, 200);
    assert.equal(replacement.body.imageUrl.endsWith("/2.png"), true);
    assert.equal(removedImages.includes(`verification/${suffix}/1`), true);

    failImageRemove = true;
    const replacementCleanupFailure = await call(imagePath(dish.id), { method: "POST", ...ownerSession, form: makeImageForm() });
    failImageRemove = false;
    assert.equal(replacementCleanupFailure.status, 200);
    assert.equal(replacementCleanupFailure.body.cleanupPending, true);
    savedDish = await Dish.findById(dish.id).select("+imagePublicId +pendingImagePublicIds");
    assert.equal(savedDish?.imagePublicId, `verification/${suffix}/3`);
    assert.deepEqual(savedDish?.pendingImagePublicIds, [`verification/${suffix}/2`]);
    const pendingListing = await call(managePath, { cookie: ownerSession.cookie });
    const pendingListedDish = pendingListing.body.categories.flatMap((item: any) => item.dishes).find((item: any) => item.id === dish.id);
    assert.equal(pendingListedDish.cleanupPending, true);
    assert.equal("pendingImagePublicIds" in pendingListedDish || "imagePublicId" in pendingListedDish, false);
    const cleanupPath = `${imagePath(dish.id)}/cleanup`;
    assert.equal((await call(cleanupPath, { method: "POST", ...staffSession })).status, 403);
    assert.equal((await call(`${imagePath(foreignDish.id)}/cleanup`, { method: "POST", ...ownerSession })).status, 404);
    assert.equal((await call(cleanupPath, { method: "POST", cookie: ownerSession.cookie, origin: "https://invalid.example", csrf: ownerSession.csrf })).status, 403);
    assert.equal((await call(cleanupPath, { method: "POST", cookie: ownerSession.cookie })).status, 403);
    failImageRemove = true;
    const stillPending = await call(cleanupPath, { method: "POST", ...ownerSession });
    failImageRemove = false;
    assert.equal(stillPending.status, 200);
    assert.equal(stillPending.body.cleanupPending, true);
    assert.deepEqual((await Dish.findById(dish.id).select("+pendingImagePublicIds"))?.pendingImagePublicIds,
      [`verification/${suffix}/2`]);
    const cleanupOnly = await call(cleanupPath, { method: "POST", ...ownerSession });
    assert.equal(cleanupOnly.status, 200);
    assert.equal(cleanupOnly.body.cleanupPending, false);
    assert.equal(cleanupOnly.body.imageUrl, replacementCleanupFailure.body.imageUrl);
    assert.equal(removedImages.includes(`verification/${suffix}/2`), true);
    assert.equal(removedImages.includes(`verification/${suffix}/3`), false);
    assert.equal((await call(managePath, { cookie: ownerSession.cookie })).body.categories
      .flatMap((item: any) => item.dishes).find((item: any) => item.id === dish.id).cleanupPending, false);
    const removalRetriesReplacement = await call(imagePath(dish.id), { method: "DELETE", ...ownerSession });
    assert.equal(removalRetriesReplacement.status, 200);
    assert.equal(removalRetriesReplacement.body.cleanupPending, false);
    assert.equal(removedImages.includes(`verification/${suffix}/2`), true);
    assert.equal(removedImages.includes(`verification/${suffix}/3`), true);

    failImageUpload = true;
    const providerFailure = await call(imagePath(dish.id), { method: "POST", ...ownerSession, form: makeImageForm() });
    failImageUpload = false;
    assert.equal(providerFailure.status, 502);
    savedDish = await Dish.findById(dish.id).select("+imagePublicId");
    assert.equal(savedDish?.imagePublicId, undefined);

    const originalFindOneAndUpdate = Dish.findOneAndUpdate;
    (Dish as any).findOneAndUpdate = function (...args: any[]) {
      if (args[1]?.$set?.imagePublicId === `verification/${suffix}/4`) {
        return { select: () => Promise.reject(new Error("mock database write failure")) };
      }
      return (originalFindOneAndUpdate as any).apply(this, args);
    };
    const dbFailure = await call(imagePath(dish.id), { method: "POST", ...ownerSession, form: makeImageForm() });
    (Dish as any).findOneAndUpdate = originalFindOneAndUpdate;
    assert.equal(dbFailure.status, 500);
    assert.equal(removedImages.includes(`verification/${suffix}/4`), true);
    savedDish = await Dish.findById(dish.id).select("+imagePublicId");
    assert.equal(savedDish?.imagePublicId, undefined);

    const imageBeforeDeleteFailure = await call(imagePath(dish.id), { method: "POST", ...ownerSession, form: makeImageForm() });
    assert.equal(imageBeforeDeleteFailure.status, 200);
    failImageRemove = true;
    const removeWithCleanupPending = await call(imagePath(dish.id), { method: "DELETE", ...ownerSession });
    failImageRemove = false;
    assert.equal(removeWithCleanupPending.status, 200);
    assert.equal(removeWithCleanupPending.body.cleanupPending, true);
    savedDish = await Dish.findById(dish.id).select("+imagePublicId +pendingImagePublicIds");
    assert.equal(savedDish?.imagePublicId, undefined);
    assert.equal(savedDish?.imageUrl, undefined);
    assert.deepEqual(savedDish?.pendingImagePublicIds, [`verification/${suffix}/5`]);
    const removalsBeforeRetry = removedImages.length;
    const removeAgain = await call(imagePath(dish.id), { method: "DELETE", ...ownerSession });
    assert.equal(removeAgain.status, 200);
    assert.equal(removeAgain.body.cleanupPending, false);
    assert.equal(removedImages.slice(removalsBeforeRetry).includes(`verification/${suffix}/5`), true);
    savedDish = await Dish.findById(dish.id).select("+pendingImagePublicIds");
    assert.deepEqual(savedDish?.pendingImagePublicIds ?? [], []);

    const parallelUploads = blockUploads(2);
    failImageRemove = true;
    const uploadA = call(imagePath(dish.id), { method: "POST", ...ownerSession, form: makeImageForm() });
    const uploadB = call(imagePath(dish.id), { method: "POST", ...ownerSession, form: makeImageForm() });
    await parallelUploads.ready;
    parallelUploads.release();
    uploadBarrier = undefined;
    const [uploadReplyA, uploadReplyB] = await Promise.all([uploadA, uploadB]);
    failImageRemove = false;
    assert.deepEqual([uploadReplyA.status, uploadReplyB.status].sort(), [200, 409]);
    savedDish = await Dish.findById(dish.id).select("+imagePublicId +pendingImagePublicIds");
    assert.ok(savedDish?.imagePublicId);
    const committedParallelId = savedDish!.imagePublicId!;
    const losingParallelId = committedParallelId.endsWith("/6") ? `verification/${suffix}/7` : `verification/${suffix}/6`;
    const losingReply = uploadReplyA.status === 409 ? uploadReplyA : uploadReplyB;
    assert.equal(losingReply.body.cleanupPending, true);
    assert.deepEqual(savedDish?.pendingImagePublicIds, [losingParallelId]);

    const uploadDeleteBarrier = blockUploads(1);
    const uploadWithDelete = call(imagePath(dish.id), { method: "POST", ...ownerSession, form: makeImageForm() });
    await uploadDeleteBarrier.ready;
    const concurrentDelete = await call(imagePath(dish.id), { method: "DELETE", ...ownerSession });
    uploadDeleteBarrier.release();
    uploadBarrier = undefined;
    const uploadAfterDelete = await uploadWithDelete;
    assert.equal(concurrentDelete.status, 200);
    assert.equal(uploadAfterDelete.status, 409);
    savedDish = await Dish.findById(dish.id).select("+imagePublicId +pendingImagePublicIds");
    assert.equal(savedDish?.imagePublicId, undefined);
    assert.deepEqual(savedDish?.pendingImagePublicIds ?? [], []);
    assert.equal(removedImages.includes(committedParallelId), true);
    assert.equal(removedImages.includes(losingParallelId), true);
    assert.equal(removedImages.includes(`verification/${suffix}/8`), true);

    const noCloudinaryApp = createApp({ ...config, cloudinaryCloudName: undefined, cloudinaryApiKey: undefined, cloudinaryApiSecret: undefined });
    const noCloudinaryServer = noCloudinaryApp.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => noCloudinaryServer.once("listening", resolve));
    const noCloudinaryAddress = noCloudinaryServer.address();
    assert.ok(noCloudinaryAddress && typeof noCloudinaryAddress !== "string");
    const unconfiguredForm = makeImageForm();
    const unconfiguredUpload = await fetch(`http://127.0.0.1:${noCloudinaryAddress.port}${imagePath(dish.id)}`, {
      method: "POST", headers: { Origin: config.frontendUrl, Cookie: ownerSession.cookie, "X-CSRF-Token": ownerSession.csrf }, body: unconfiguredForm,
    });
    assert.equal(unconfiguredUpload.status, 503);
    await new Promise<void>((resolve) => noCloudinaryServer.close(() => resolve()));
    await closeAppSessionStore(noCloudinaryApp);

    stage = "снимок заказа и публичное меню";
    console.info(`Этап: ${stage}.`);
    const orderReply = await call(orderPath, { method: "POST", body: {
      requestId: randomUUID(), items: [{ dishId: dish.id, quantity: 2 }], expectedTotalSom: 200,
    } });
    assert.equal(orderReply.status, 201);
    const orderId = orderReply.body.id as string;
    const savedTotal = orderReply.body.totalSom as number;
    const priceEdit = await call(`${managePath}/dishes/${dish.id}`, { method: "PATCH", ...ownerSession,
      body: { priceSom: 180 } });
    assert.equal(priceEdit.status, 200);
    const storedOrder = await Order.findById(orderId).lean();
    assert.equal(storedOrder?.totalSom, savedTotal);
    assert.equal(storedOrder?.items[0]?.priceSom, 100);
    assert.equal(storedOrder?.items[0]?.lineTotalSom, 200);

    let menu = await call(publicMenuPath);
    assert.equal(menu.status, 200);
    const publicTea = menu.body.categories.flatMap((item: any) => item.dishes).find((item: any) => item.id === dish.id);
    assert.equal(publicTea.priceSom, 180);
    const publicCake = menu.body.categories.find((item: any) => item.id === createdCategoryId)?.dishes
      .find((item: any) => item.id === createdDishId);
    assert.equal(publicCake.name, "Cake slice");
    assert.equal(publicCake.priceSom, 275);

    const hiddenDish = await call(`${managePath}/dishes/${dish.id}`, { method: "PATCH", ...ownerSession,
      body: { isAvailable: false } });
    assert.equal(hiddenDish.status, 200);
    menu = await call(publicMenuPath);
    assert.equal(menu.status, 200);
    assert.equal(menu.body.categories.flatMap((item: any) => item.dishes).some((item: any) => item.id === dish.id), false);
    const unavailableOrder = await call(orderPath, { method: "POST", body: {
      requestId: randomUUID(), items: [{ dishId: dish.id, quantity: 1 }], expectedTotalSom: 180,
    } });
    assert.equal(unavailableOrder.status, 409);
    await call(`${managePath}/categories/${category.id}`, { method: "PATCH", ...ownerSession,
      body: { isActive: false } });
    menu = await call(publicMenuPath);
    assert.equal(menu.body.categories.some((item: any) => item.id === category.id), false);
    assert.equal((await call(`${managePath}/categories/${category.id}`, { method: "PATCH", ...ownerSession,
      body: { isActive: true } })).status, 200);

    stage = "база не подключена";
    console.info(`Этап: ${stage}.`);
    const noDbApp = createApp({ ...config, mongoUri: undefined });
    const noDbServer = noDbApp.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => noDbServer.once("listening", resolve));
    const noDbAddress = noDbServer.address();
    assert.ok(noDbAddress && typeof noDbAddress !== "string");
    const unavailable = await fetch(`http://127.0.0.1:${noDbAddress.port}/api/manage/menu`);
    assert.equal(unavailable.status, 503);
    await new Promise<void>((resolve) => noDbServer.close(() => resolve()));
    await closeAppSessionStore(noDbApp);

    console.info("Проверены: управление категориями и блюдами, CSRF/Origin, изоляция кафе, публичное меню и неизменность снимка заказа; загрузка/замена/удаление изображений, права owner/staff, формат/размер файла, ошибки хранилища/БД и очистка.");
    console.info("Тестовые записи добавлены только в menugo_stage91_verification; существующие данные не изменялись и не удалялись.");
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await closeAppSessionStore(app);
    await mongoose.disconnect();
  }
}

try { await main(); }
catch (error) {
  console.error(`Проверка управления меню не прошла (${stage}). Подробности подключения скрыты.`);
  if (error instanceof assert.AssertionError) console.error(error.message);
  process.exitCode = 1;
} finally { await mongoose.disconnect(); }

