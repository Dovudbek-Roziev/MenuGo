import { Router } from "express";
import multer from "multer";
import { fileTypeFromBuffer } from "file-type";
import { Types } from "mongoose";
import type { ServerConfig } from "../config.js";
import { requireAuth, requireRole } from "../auth/permissions.js";
import { requireCsrf, requireOrigin } from "../auth/security.js";
import { getDatabaseStatus } from "../database.js";
import { Category } from "../models/Category.js";
import { Dish } from "../models/Dish.js";
import { createDishImageStorage, ImageStorageProviderError, ImageStorageUnavailableError, type DishImageStorage } from "../services/dishImages.js";

type RecordValue = Record<string, unknown>;
const objectIdPattern = /^[0-9a-f]{24}$/i;

function isRecord(value: unknown): value is RecordValue {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: RecordValue, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function parseName(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const name = value.trim();
  return name.length >= 1 && Array.from(name).length <= maxLength ? name : undefined;
}

function parseSortOrder(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function parseDescription(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const description = value.trim();
  return Array.from(description).length <= 500 ? description : undefined;
}

function isDuplicateKey(error: unknown): boolean {
  return isRecord(error) && error.code === 11000;
}

function isValidationError(error: unknown): boolean {
  return error instanceof Error && (error.name === "ValidationError" || error.name === "CastError");
}

function isDatabaseUnavailable(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return ["MongooseServerSelectionError", "MongoNetworkError", "MongoTopologyClosedError", "MongoNotConnectedError"]
    .includes(error.name);
}

function databaseReady(response: import("express").Response, config: ServerConfig): boolean {
  if (getDatabaseStatus(config.mongoUri) === "connected") return true;
  response.status(503).json({ message: "Управление меню временно недоступно: база данных не подключена." });
  return false;
}

function sendWriteError(response: import("express").Response, error: unknown, action: string): void {
  if (isDuplicateKey(error)) {
    response.status(409).json({ message: "Категория или блюдо с таким названием уже существует." });
  } else if (isValidationError(error)) {
    response.status(400).json({ message: "Проверьте название, описание, цену и порядок сортировки." });
  } else if (isDatabaseUnavailable(error)) {
    response.status(503).json({ message: "Управление меню временно недоступно: ошибка базы данных." });
  } else {
    console.error(action);
    response.status(500).json({ message: "Не удалось выполнить операцию с меню." });
  }
}

function categoryJson(category: { _id: Types.ObjectId; name: string; sortOrder: number; isActive: boolean }) {
  return { id: category._id.toString(), name: category.name, sortOrder: category.sortOrder, isActive: category.isActive };
}

function dishJson(dish: { _id: Types.ObjectId; categoryId: Types.ObjectId; name: string; description: string; priceSom: number; sortOrder: number; isAvailable: boolean; imageUrl?: string | null }) {
  return { id: dish._id.toString(), categoryId: dish.categoryId.toString(), name: dish.name,
    description: dish.description, priceSom: dish.priceSom, sortOrder: dish.sortOrder, isAvailable: dish.isAvailable,
    ...(dish.imageUrl ? { imageUrl: dish.imageUrl } : {}) };
}

const imageUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 0 } });

function parseImageFormat(mime: string): "jpg" | "png" | "webp" | undefined {
  if (mime === "image/jpeg") return "jpg";
  if (mime === "image/png") return "png";
  if (mime === "image/webp") return "webp";
  return undefined;
}

function imageUploadMiddleware(request: import("express").Request, response: import("express").Response, next: import("express").NextFunction) {
  imageUpload.single("image")(request, response, (error: unknown) => {
    if (!error) { next(); return; }
    if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
      response.status(413).json({ message: "Размер изображения не должен превышать 5 МБ." });
      return;
    }
    response.status(400).json({ message: "Загрузите один файл изображения в формате JPEG, PNG или WebP." });
  });
}

export function createManageMenuRouter(config: ServerConfig, imageStorage: DishImageStorage = createDishImageStorage(config)) {
  const router = Router();
  router.use(requireAuth, requireRole("owner"));

  router.get("/menu", async (request, response) => {
    response.set("Cache-Control", "no-store");
    if (!databaseReady(response, config)) return;
    try {
      const cafeId = new Types.ObjectId(request.auth!.cafe.id);
      const [categories, dishes] = await Promise.all([
        Category.find({ cafeId }).sort({ sortOrder: 1, _id: 1 }).select("_id name sortOrder isActive").lean(),
        Dish.find({ cafeId }).sort({ sortOrder: 1, _id: 1 })
          .select("_id categoryId name description priceSom sortOrder isAvailable imageUrl").lean(),
      ]);
      const byCategory = new Map<string, ReturnType<typeof dishJson>[]>();
      for (const dish of dishes) {
        const key = dish.categoryId.toString();
        const items = byCategory.get(key) ?? [];
        items.push(dishJson(dish));
        byCategory.set(key, items);
      }
      response.json({ categories: categories.map((category) => ({
        ...categoryJson(category), dishes: byCategory.get(category._id.toString()) ?? [],
      })) });
    } catch (error) {
      sendWriteError(response, error, "Не удалось прочитать меню кафе.");
    }
  });

  router.post("/menu/categories", requireOrigin(config), requireCsrf, async (request, response) => {
    response.set("Cache-Control", "no-store");
    if (!databaseReady(response, config)) return;
    const body = request.body;
    if (!isRecord(body) || !hasOnlyKeys(body, ["name", "sortOrder"]) ||
        !parseName(body.name, 80) || ("sortOrder" in body && parseSortOrder(body.sortOrder) === undefined)) {
      response.status(400).json({ message: "Укажите корректное название и целый порядок сортировки." });
      return;
    }
    try {
      const category = await Category.create({ cafeId: request.auth!.cafe.id,
        name: parseName(body.name, 80)!, sortOrder: body.sortOrder === undefined ? 0 : body.sortOrder as number, isActive: true });
      response.status(201).json({ category: categoryJson(category) });
    } catch (error) { sendWriteError(response, error, "Не удалось создать категорию меню."); }
  });

  router.patch("/menu/categories/:categoryId", requireOrigin(config), requireCsrf, async (request, response) => {
    response.set("Cache-Control", "no-store");
    if (!databaseReady(response, config)) return;
    const categoryId = request.params.categoryId;
    const body = request.body;
    const allowed = ["name", "sortOrder", "isActive"] as const;
    if (typeof categoryId !== "string" || !objectIdPattern.test(categoryId) || !isRecord(body) || Object.keys(body).length === 0 || !hasOnlyKeys(body, allowed) ||
        ("name" in body && !parseName(body.name, 80)) || ("sortOrder" in body && parseSortOrder(body.sortOrder) === undefined) ||
        ("isActive" in body && typeof body.isActive !== "boolean")) {
      response.status(400).json({ message: "Некорректные данные категории." });
      return;
    }
    try {
      const category = await Category.findOne({ _id: categoryId, cafeId: request.auth!.cafe.id });
      if (!category) { response.status(404).json({ message: "Категория в этом кафе не найдена." }); return; }
      if ("name" in body) category.name = parseName(body.name, 80)!;
      if ("sortOrder" in body) category.sortOrder = parseSortOrder(body.sortOrder)!;
      if ("isActive" in body) category.isActive = body.isActive as boolean;
      await category.save();
      response.json({ category: categoryJson(category) });
    } catch (error) { sendWriteError(response, error, "Не удалось изменить категорию меню."); }
  });

  router.post("/menu/dishes", requireOrigin(config), requireCsrf, async (request, response) => {
    response.set("Cache-Control", "no-store");
    if (!databaseReady(response, config)) return;
    const body = request.body;
    if (!isRecord(body) || !hasOnlyKeys(body, ["categoryId", "name", "description", "priceSom", "sortOrder", "isAvailable"]) ||
        typeof body.categoryId !== "string" || !objectIdPattern.test(body.categoryId) || !parseName(body.name, 120) ||
        typeof body.priceSom !== "number" || !Number.isSafeInteger(body.priceSom) || body.priceSom < 0 ||
        ("description" in body && parseDescription(body.description) === undefined) ||
        ("sortOrder" in body && parseSortOrder(body.sortOrder) === undefined) ||
        ("isAvailable" in body && typeof body.isAvailable !== "boolean")) {
      response.status(400).json({ message: "Укажите корректную категорию, название и цену блюда." });
      return;
    }
    try {
      const cafeId = request.auth!.cafe.id;
      const category = await Category.findOne({ _id: body.categoryId, cafeId }).select("_id").lean();
      if (!category) { response.status(404).json({ message: "Категория в этом кафе не найдена." }); return; }
      const dish = await Dish.create({ cafeId, categoryId: body.categoryId, name: parseName(body.name, 120),
        description: body.description === undefined ? "" : parseDescription(body.description)!, priceSom: body.priceSom as number,
        sortOrder: body.sortOrder === undefined ? 0 : body.sortOrder as number,
        isAvailable: body.isAvailable === undefined ? true : body.isAvailable as boolean });
      response.status(201).json({ dish: dishJson(dish) });
    } catch (error) { sendWriteError(response, error, "Не удалось создать блюдо меню."); }
  });

  router.patch("/menu/dishes/:dishId", requireOrigin(config), requireCsrf, async (request, response) => {
    response.set("Cache-Control", "no-store");
    if (!databaseReady(response, config)) return;
    const dishId = request.params.dishId;
    const body = request.body;
    const allowed = ["categoryId", "name", "description", "priceSom", "sortOrder", "isAvailable"] as const;
    if (typeof dishId !== "string" || !objectIdPattern.test(dishId) || !isRecord(body) || Object.keys(body).length === 0 || !hasOnlyKeys(body, allowed) ||
        ("categoryId" in body && (typeof body.categoryId !== "string" || !objectIdPattern.test(body.categoryId))) ||
        ("name" in body && !parseName(body.name, 120)) || ("description" in body && parseDescription(body.description) === undefined) ||
        ("priceSom" in body && (typeof body.priceSom !== "number" || !Number.isSafeInteger(body.priceSom) || body.priceSom < 0)) ||
        ("sortOrder" in body && parseSortOrder(body.sortOrder) === undefined) ||
        ("isAvailable" in body && typeof body.isAvailable !== "boolean")) {
      response.status(400).json({ message: "Некорректные данные блюда." });
      return;
    }
    try {
      const cafeId = request.auth!.cafe.id;
      const dish = await Dish.findOne({ _id: dishId, cafeId });
      if (!dish) { response.status(404).json({ message: "Блюдо в этом кафе не найдено." }); return; }
      if ("categoryId" in body) {
        const category = await Category.findOne({ _id: body.categoryId, cafeId }).select("_id").lean();
        if (!category) { response.status(404).json({ message: "Категория в этом кафе не найдена." }); return; }
        dish.categoryId = new Types.ObjectId(body.categoryId as string);
      }
      if ("name" in body) dish.name = parseName(body.name, 120)!;
      if ("description" in body) dish.description = parseDescription(body.description)!;
      if ("priceSom" in body) dish.priceSom = body.priceSom as number;
      if ("sortOrder" in body) dish.sortOrder = parseSortOrder(body.sortOrder)!;
      if ("isAvailable" in body) dish.isAvailable = body.isAvailable as boolean;
      await dish.save();
      response.json({ dish: dishJson(dish) });
    } catch (error) { sendWriteError(response, error, "Не удалось изменить блюдо меню."); }
  });

  router.post("/menu/dishes/:dishId/image", requireOrigin(config), requireCsrf, imageUploadMiddleware, async (request, response) => {
    response.set("Cache-Control", "no-store");
    if (!databaseReady(response, config)) return;
    const dishId = request.params.dishId;
    if (typeof dishId !== "string" || !objectIdPattern.test(dishId) || !request.file) {
      response.status(400).json({ message: "Выберите изображение JPEG, PNG или WebP размером до 5 МБ." });
      return;
    }
    const claimedFormat = parseImageFormat(request.file.mimetype);
    const detected = await fileTypeFromBuffer(request.file.buffer).catch(() => undefined);
    const actualFormat = detected?.mime === "image/jpeg" ? "jpg" : detected?.mime === "image/png" ? "png" : detected?.mime === "image/webp" ? "webp" : undefined;
    if (!claimedFormat || !actualFormat || claimedFormat !== actualFormat) {
      response.status(400).json({ message: "Файл не является допустимым изображением JPEG, PNG или WebP." });
      return;
    }

    let uploaded: Awaited<ReturnType<DishImageStorage["upload"]>> | undefined;
    let oldPublicId: string | undefined;
    try {
      const dish = await Dish.findOne({ _id: dishId, cafeId: request.auth!.cafe.id }).select("+imagePublicId");
      if (!dish) { response.status(404).json({ message: "Блюдо в этом кафе не найдено." }); return; }
      oldPublicId = dish.imagePublicId ?? undefined;
      uploaded = await imageStorage.upload(request.file.buffer, actualFormat);
      dish.imagePublicId = uploaded.publicId;
      dish.imageUrl = uploaded.imageUrl;
      await dish.save();
    } catch (error) {
      if (uploaded) {
        try { await imageStorage.remove(uploaded.publicId); }
        catch { console.error("Не удалось очистить временно загруженное изображение."); }
      }
      if (error instanceof ImageStorageUnavailableError) {
        response.status(503).json({ message: "Загрузка изображений не настроена на сервере." });
      } else if (error instanceof ImageStorageProviderError) {
        response.status(502).json({ message: "Не удалось загрузить изображение в хранилище. Попробуйте позже." });
      } else {
        sendWriteError(response, error, "Не удалось сохранить изображение блюда.");
      }
      return;
    }

    let cleanupPending = false;
    if (oldPublicId && oldPublicId !== uploaded!.publicId) {
      try { await imageStorage.remove(oldPublicId); }
      catch { cleanupPending = true; console.error("Не удалось удалить предыдущую копию изображения."); }
    }
    response.json({ imageUrl: uploaded!.imageUrl, cleanupPending,
      ...(cleanupPending ? { message: "Новое изображение сохранено. Предыдущая копия пока не удалена." } : {}) });
  });

  router.delete("/menu/dishes/:dishId/image", requireOrigin(config), requireCsrf, async (request, response) => {
    response.set("Cache-Control", "no-store");
    if (!databaseReady(response, config)) return;
    const dishId = request.params.dishId;
    if (typeof dishId !== "string" || !objectIdPattern.test(dishId)) {
      response.status(400).json({ message: "Некорректный идентификатор блюда." });
      return;
    }
    try {
      const dish = await Dish.findOne({ _id: dishId, cafeId: request.auth!.cafe.id }).select("+imagePublicId");
      if (!dish) { response.status(404).json({ message: "Блюдо в этом кафе не найдено." }); return; }
      const oldPublicId = dish.imagePublicId;
      dish.imagePublicId = undefined;
      dish.imageUrl = undefined;
      await dish.save();
      let cleanupPending = false;
      if (oldPublicId) {
        try { await imageStorage.remove(oldPublicId); }
        catch { cleanupPending = true; console.error("Не удалось удалить изображение из хранилища после снятия с меню."); }
      }
      response.json({ imageUrl: null, cleanupPending,
        message: cleanupPending ? "Изображение удалено из меню. Удаление файла из хранилища ожидает повтора." : "Изображение удалено." });
    } catch (error) {
      if (error instanceof ImageStorageUnavailableError || error instanceof ImageStorageProviderError) {
        response.status(502).json({ message: "Не удалось удалить изображение из хранилища." });
      } else sendWriteError(response, error, "Не удалось удалить изображение блюда.");
    }
  });

  return router;
}
