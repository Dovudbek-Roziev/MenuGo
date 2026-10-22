import { Router } from "express";
import { Types } from "mongoose";
import type { ServerConfig } from "../config.js";
import { getDatabaseStatus } from "../database.js";
import { orderRateLimit } from "../middleware/orderRateLimit.js";
import { Cafe } from "../models/Cafe.js";
import { CafeTable } from "../models/Table.js";
import { Category } from "../models/Category.js";
import { Dish } from "../models/Dish.js";
import { Order } from "../models/Order.js";

interface RequestedItem { dishId: string; quantity: number }
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const objectIdPattern = /^[0-9a-f]{24}$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseBody(value: unknown): { requestId: string; items: RequestedItem[] } | null {
  if (!isRecord(value) || Object.keys(value).sort().join() !== "items,requestId" ||
      typeof value.requestId !== "string" || !uuidPattern.test(value.requestId) ||
      !Array.isArray(value.items) || value.items.length < 1 || value.items.length > 50) return null;
  const seen = new Set<string>();
  const items: RequestedItem[] = [];
  for (const valueItem of value.items) {
    if (!isRecord(valueItem) || Object.keys(valueItem).sort().join() !== "dishId,quantity" ||
        typeof valueItem.dishId !== "string" || !objectIdPattern.test(valueItem.dishId) ||
        typeof valueItem.quantity !== "number" || !Number.isInteger(valueItem.quantity) ||
        valueItem.quantity < 1 || valueItem.quantity > 99) return null;
    const dishId = valueItem.dishId.toLowerCase();
    if (seen.has(dishId)) return null;
    seen.add(dishId);
    items.push({ dishId, quantity: valueItem.quantity });
  }
  items.sort((a, b) => a.dishId.localeCompare(b.dishId));
  return { requestId: value.requestId.toLowerCase(), items };
}

function sameItems(order: InstanceType<typeof Order>, requested: RequestedItem[]): boolean {
  return order.items.length === requested.length && order.items.every((item, index) =>
    item.dishId.toString() === requested[index]?.dishId && item.quantity === requested[index]?.quantity,
  );
}

function publicOrder(order: InstanceType<typeof Order>) {
  return {
    id: order._id.toString(),
    table: { name: order.tableName },
    items: order.items.map((item) => ({
      dishId: item.dishId.toString(), name: item.name, priceSom: item.priceSom,
      quantity: item.quantity, lineTotalSom: item.lineTotalSom,
    })),
    totalSom: order.totalSom,
    currency: order.currency,
    status: order.status,
    createdAt: order.createdAt,
  };
}

function isDuplicateKey(error: unknown): boolean {
  return isRecord(error) && error.code === 11000;
}

export function createPublicOrdersRouter(config: ServerConfig) {
  const router = Router();
  router.post("/cafes/:cafeSlug/tables/:tableCode/orders", orderRateLimit, async (request, response) => {
    response.set("Cache-Control", "no-store");
    const parsed = parseBody(request.body);
    if (!parsed) {
      response.status(400).json({ message: "Некорректное тело заказа: проверьте requestId, блюда и количество." });
      return;
    }
    if (getDatabaseStatus(config.mongoUri) !== "connected") {
      response.status(503).json({ message: "Заказы временно недоступны: нет соединения с базой данных." });
      return;
    }
    const { cafeSlug, tableCode } = request.params;
    if (typeof cafeSlug !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(cafeSlug) ||
        typeof tableCode !== "string" || !/^[A-Za-z0-9_-]{8,128}$/.test(tableCode)) {
      response.status(404).json({ message: "Кафе или стол не найдены." });
      return;
    }

    try {
      const cafe = await Cafe.findOne({ slug: cafeSlug, isActive: true }).select("_id").lean();
      if (!cafe) { response.status(404).json({ message: "Кафе или стол не найдены." }); return; }
      const table = await CafeTable.findOne({ cafeId: cafe._id, qrCode: tableCode, isActive: true }).select("_id name").lean();
      if (!table) { response.status(404).json({ message: "Кафе или стол не найдены." }); return; }

      const orderKey = { cafeId: cafe._id, tableId: table._id, requestId: parsed.requestId };
      const existing = await Order.findOne(orderKey);
      if (existing) {
        if (!sameItems(existing, parsed.items)) { response.status(409).json({ message: "Этот requestId уже использован для другого состава заказа." }); return; }
        response.status(200).json(publicOrder(existing));
        return;
      }

      const dishIds = parsed.items.map((item) => new Types.ObjectId(item.dishId));
      const dishes = await Dish.find({ _id: { $in: dishIds }, cafeId: cafe._id, isAvailable: true })
        .select("_id categoryId name priceSom").lean();
      const categoryIds = [...new Set(dishes.map((dish) => dish.categoryId.toString()))].map((id) => new Types.ObjectId(id));
      const categories = await Category.find({ _id: { $in: categoryIds }, cafeId: cafe._id, isActive: true }).select("_id").lean();
      const activeCategoryIds = new Set(categories.map((category) => category._id.toString()));
      const dishById = new Map(dishes.filter((dish) => activeCategoryIds.has(dish.categoryId.toString()))
        .map((dish) => [dish._id.toString(), dish]));
      if (dishById.size !== parsed.items.length) {
        response.status(409).json({ message: "Одно или несколько блюд больше не доступны." });
        return;
      }

      let totalSom = 0;
      const items = [];
      for (const requested of parsed.items) {
        const dish = dishById.get(requested.dishId)!;
        if (!Number.isSafeInteger(dish.priceSom) || dish.priceSom < 0) {
          response.status(409).json({ message: "Цена одного из блюд сейчас недоступна." });
          return;
        }
        const lineTotalSom = dish.priceSom * requested.quantity;
        if (!Number.isSafeInteger(lineTotalSom) || !Number.isSafeInteger(totalSom + lineTotalSom)) {
          response.status(409).json({ message: "Сумма заказа слишком велика." });
          return;
        }
        totalSom += lineTotalSom;
        items.push({ dishId: dish._id, name: dish.name, priceSom: dish.priceSom,
          quantity: requested.quantity, lineTotalSom });
      }

      await Order.init();
      try {
        const created = await Order.create({ ...orderKey, tableName: table.name, items, totalSom, currency: "KGS", status: "new" });
        response.status(201).json(publicOrder(created));
      } catch (error) {
        if (!isDuplicateKey(error)) throw error;
        const winner = await Order.findOne(orderKey);
        if (!winner) throw error;
        if (!sameItems(winner, parsed.items)) { response.status(409).json({ message: "Этот requestId уже использован для другого состава заказа." }); return; }
        response.status(200).json(publicOrder(winner));
      }
    } catch {
      // Do not expose MongoDB driver errors or connection strings.
      console.error("Не удалось обработать запрос на создание заказа.");
      if (getDatabaseStatus(config.mongoUri) !== "connected") {
        response.status(503).json({ message: "Заказы временно недоступны: нет соединения с базой данных." });
      } else {
        response.status(500).json({ message: "Внутренняя ошибка сервера." });
      }
    }
  });
  return router;
}
