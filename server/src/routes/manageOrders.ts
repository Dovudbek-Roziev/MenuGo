import { Router } from "express";
import { Types } from "mongoose";
import type { ServerConfig } from "../config.js";
import { requireAuth, requireRole } from "../auth/permissions.js";
import { requireCsrf, requireOrigin } from "../auth/security.js";
import { getDatabaseStatus } from "../database.js";
import { Order, orderStatuses, type OrderStatus } from "../models/Order.js";

const objectIdPattern = /^[0-9a-f]{24}$/i;
const statusSet = new Set<string>(orderStatuses);
const allowedTransitions: Record<OrderStatus, readonly OrderStatus[]> = {
  new: ["preparing", "cancelled"],
  preparing: ["ready", "cancelled"],
  ready: ["completed", "cancelled"],
  completed: [],
  cancelled: [],
};

interface OrderView {
  _id: Types.ObjectId;
  tableName: string;
  items: Array<{ dishId: Types.ObjectId; name: string; priceSom: number; quantity: number; lineTotalSom: number }>;
  totalSom: number;
  currency: string;
  status: OrderStatus;
  createdAt: Date;
  updatedAt: Date;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parsePositiveInteger(value: unknown, fallback: number, maximum: number): number | undefined {
  if (value === undefined) return fallback;
  if (typeof value !== "string" || !/^\d+$/.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 1 && parsed <= maximum ? parsed : undefined;
}

function isDatabaseUnavailable(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return ["MongooseServerSelectionError", "MongoNetworkError", "MongoTopologyClosedError", "MongoNotConnectedError"]
    .includes(error.name);
}

function unavailable(response: import("express").Response): void {
  response.status(503).json({ message: "Заказы временно недоступны. Проверьте соединение с базой данных и повторите попытку." });
}

function sendReadError(response: import("express").Response, error: unknown, config: ServerConfig): void {
  if (isDatabaseUnavailable(error) || getDatabaseStatus(config.mongoUri) !== "connected") {
    unavailable(response);
    return;
  }
  console.error("Не удалось обработать запрос списка заказов.");
  response.status(500).json({ message: "Не удалось обработать запрос заказов." });
}

function orderJson(order: OrderView) {
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
    updatedAt: order.updatedAt,
  };
}

export function createManageOrdersRouter(config: ServerConfig) {
  const router = Router();
  router.use(requireAuth, requireRole("owner", "staff"));

  router.get("/orders", async (request, response) => {
    response.set("Cache-Control", "no-store");
    const queryKeys = Object.keys(request.query);
    if (queryKeys.some((key) => !["status", "page", "limit"].includes(key))) {
      response.status(400).json({ message: "Допускаются только фильтр status и параметры page и limit." });
      return;
    }
    const statusValue = request.query.status;
    if (statusValue !== undefined && (typeof statusValue !== "string" || !statusSet.has(statusValue))) {
      response.status(400).json({ message: "Укажите допустимый статус заказа." });
      return;
    }
    const page = parsePositiveInteger(request.query.page, 1, 10_000);
    const limit = parsePositiveInteger(request.query.limit, 20, 100);
    if (page === undefined || limit === undefined) {
      response.status(400).json({ message: "Параметр page должен быть от 1 до 10000, а limit — от 1 до 100." });
      return;
    }
    if (getDatabaseStatus(config.mongoUri) !== "connected") { unavailable(response); return; }

    try {
      const filter = {
        cafeId: new Types.ObjectId(request.auth!.cafe.id),
        ...(typeof statusValue === "string" ? { status: statusValue as OrderStatus } : {}),
      };
      const [ordersResult, total] = await Promise.all([
        Order.find(filter).sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit)
          .select("_id tableName items totalSom currency status createdAt updatedAt").lean().exec(),
        Order.countDocuments(filter),
      ]);
      const orders = ordersResult as unknown as OrderView[];
      response.json({ orders: orders.map(orderJson), pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
    } catch (error) { sendReadError(response, error, config); }
  });

  router.patch("/orders/:orderId/status", requireOrigin(config), requireCsrf, async (request, response) => {
    response.set("Cache-Control", "no-store");
    const orderId = request.params.orderId;
    const body = request.body;
    if (typeof orderId !== "string" || !objectIdPattern.test(orderId) || !isRecord(body) ||
        Object.keys(body).sort().join() !== "expectedStatus,status" ||
        typeof body.expectedStatus !== "string" || !statusSet.has(body.expectedStatus) ||
        typeof body.status !== "string" || !statusSet.has(body.status)) {
      response.status(400).json({ message: "Укажите корректный идентификатор, expectedStatus и новый статус заказа." });
      return;
    }
    const expectedStatus = body.expectedStatus as OrderStatus;
    const nextStatus = body.status as OrderStatus;
    if (!allowedTransitions[expectedStatus].includes(nextStatus)) {
      response.status(409).json({ message: "Такой переход статуса заказа запрещён." });
      return;
    }
    if (getDatabaseStatus(config.mongoUri) !== "connected") { unavailable(response); return; }

    const cafeId = new Types.ObjectId(request.auth!.cafe.id);
    try {
      const updatedResult = await Order.findOneAndUpdate(
        { _id: orderId, cafeId, status: expectedStatus },
        { $set: { status: nextStatus } },
        { returnDocument: "after", runValidators: true },
      ).select("_id tableName items totalSom currency status createdAt updatedAt").lean().exec();
      const updated = updatedResult as unknown as OrderView | null;
      if (!updated) {
        const inCafe = await Order.exists({ _id: orderId, cafeId });
        if (!inCafe) {
          response.status(404).json({ message: "Заказ в этом кафе не найден." });
          return;
        }
        response.status(409).json({ message: "Статус заказа уже изменился. Обновите список и повторите действие." });
        return;
      }
      response.json({ order: orderJson(updated) });
    } catch (error) { sendReadError(response, error, config); }
  });

  return router;
}
