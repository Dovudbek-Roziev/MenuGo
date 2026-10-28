import { randomBytes } from "node:crypto";
import { Router } from "express";
import { Types } from "mongoose";
import type { ServerConfig } from "../config.js";
import { requireAuth, requireRole } from "../auth/permissions.js";
import { requireCsrf, requireOrigin } from "../auth/security.js";
import { getDatabaseStatus } from "../database.js";
import { CafeTable } from "../models/Table.js";

const objectIdPattern = /^[0-9a-f]{24}$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function tableJson(table: { _id: Types.ObjectId; name: string; qrCode: string; isActive: boolean }) {
  return { id: table._id.toString(), name: table.name, tableCode: table.qrCode, isActive: table.isActive };
}

function isDuplicateKey(error: unknown): boolean {
  return isRecord(error) && error.code === 11000;
}

function isDatabaseUnavailable(error: unknown): boolean {
  return error instanceof Error && ["MongooseServerSelectionError", "MongoNetworkError", "MongoTopologyClosedError", "MongoNotConnectedError"]
    .includes(error.name);
}

function unavailable(response: import("express").Response): void {
  response.status(503).json({ message: "Столы временно недоступны: база данных не подключена." });
}

function sendError(response: import("express").Response, error: unknown, config: ServerConfig, operation: string): void {
  if (isDuplicateKey(error)) {
    response.status(409).json({ message: "Стол с таким названием уже существует." });
  } else if (isDatabaseUnavailable(error) || getDatabaseStatus(config.mongoUri) !== "connected") {
    unavailable(response);
  } else if (error instanceof Error && (error.name === "ValidationError" || error.name === "CastError")) {
    response.status(400).json({ message: "Проверьте название и статус стола." });
  } else {
    console.error(operation);
    response.status(500).json({ message: "Не удалось выполнить операцию со столами." });
  }
}

export function createManageTablesRouter(config: ServerConfig) {
  const router = Router();
  router.use(requireAuth, requireRole("owner"));

  router.get("/tables", async (request, response) => {
    response.set("Cache-Control", "no-store");
    if (getDatabaseStatus(config.mongoUri) !== "connected") { unavailable(response); return; }
    try {
      await CafeTable.init();
      const tables = await CafeTable.find({ cafeId: request.auth!.cafe.id })
        .sort({ name: 1, _id: 1 }).select("_id name qrCode isActive").lean();
      response.json({ cafe: { name: request.auth!.cafe.name, slug: request.auth!.cafe.slug }, tables: tables.map(tableJson) });
    } catch (error) {
      sendError(response, error, config, "Не удалось получить столы кафе.");
    }
  });

  router.post("/tables", requireOrigin(config), requireCsrf, async (request, response) => {
    response.set("Cache-Control", "no-store");
    if (getDatabaseStatus(config.mongoUri) !== "connected") { unavailable(response); return; }
    const body = request.body;
    if (!isRecord(body) || Object.keys(body).length !== 1 || !Object.hasOwn(body, "name") ||
        typeof body.name !== "string" || body.name.trim().length < 1 || Array.from(body.name.trim()).length > 60) {
      response.status(400).json({ message: "Укажите название стола длиной от 1 до 60 символов." });
      return;
    }
    try {
      await CafeTable.init();
      const table = await CafeTable.create({
        cafeId: request.auth!.cafe.id,
        name: body.name.trim(),
        qrCode: randomBytes(32).toString("base64url"),
        isActive: true,
      });
      response.status(201).json({ table: tableJson(table) });
    } catch (error) {
      sendError(response, error, config, "Не удалось создать стол.");
    }
  });

  router.patch("/tables/:tableId", requireOrigin(config), requireCsrf, async (request, response) => {
    response.set("Cache-Control", "no-store");
    if (getDatabaseStatus(config.mongoUri) !== "connected") { unavailable(response); return; }
    const tableId = request.params.tableId;
    if (typeof tableId !== "string" || !objectIdPattern.test(tableId)) {
      response.status(400).json({ message: "Некорректный идентификатор стола." });
      return;
    }
    const body = request.body;
    if (!isRecord(body) || Object.keys(body).length === 0 || !Object.keys(body).every((key) => key === "name" || key === "isActive") ||
        (Object.hasOwn(body, "name") && (typeof body.name !== "string" || body.name.trim().length < 1 || Array.from(body.name.trim()).length > 60)) ||
        (Object.hasOwn(body, "isActive") && typeof body.isActive !== "boolean")) {
      response.status(400).json({ message: "Укажите название стола и/или логический статус isActive." });
      return;
    }
    const update: Record<string, unknown> = {};
    if (Object.hasOwn(body, "name")) update.name = (body.name as string).trim();
    if (Object.hasOwn(body, "isActive")) update.isActive = body.isActive;
    try {
      await CafeTable.init();
      const table = await CafeTable.findOneAndUpdate(
        { _id: tableId, cafeId: request.auth!.cafe.id }, { $set: update },
        { returnDocument: "after", runValidators: true },
      ).select("_id name qrCode isActive");
      if (!table) { response.status(404).json({ message: "Стол в этом кафе не найден." }); return; }
      response.json({ table: tableJson(table) });
    } catch (error) {
      sendError(response, error, config, "Не удалось изменить стол.");
    }
  });

  return router;
}
