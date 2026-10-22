import { Router } from "express";
import type { ServerConfig } from "../config.js";
import { getDatabaseStatus } from "../database.js";
import { Cafe } from "../models/Cafe.js";
import { CafeTable } from "../models/Table.js";
import { Category } from "../models/Category.js";
import { Dish } from "../models/Dish.js";

export function createPublicMenuRouter(config: ServerConfig) {
  const router = Router();

  router.get("/cafes/:cafeSlug/tables/:tableCode/menu", async (request, response) => {
    response.set("Cache-Control", "no-store");

    if (getDatabaseStatus(config.mongoUri) !== "connected") {
      response.status(503).json({ message: "Меню временно недоступно: нет соединения с базой данных." });
      return;
    }

    const { cafeSlug, tableCode } = request.params;
    if (
      !cafeSlug || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(cafeSlug) ||
      !tableCode || !/^[A-Za-z0-9_-]{8,128}$/.test(tableCode)
    ) {
      response.status(404).json({ message: "Кафе или стол не найдены." });
      return;
    }

    try {
      const cafe = await Cafe.findOne({ slug: cafeSlug, isActive: true })
        .select("_id name slug")
        .lean();
      if (!cafe) {
        response.status(404).json({ message: "Кафе или стол не найдены." });
        return;
      }

      const table = await CafeTable.findOne({ cafeId: cafe._id, qrCode: tableCode, isActive: true })
        .select("name")
        .lean();
      if (!table) {
        response.status(404).json({ message: "Кафе или стол не найдены." });
        return;
      }

      const categories = await Category.find({ cafeId: cafe._id, isActive: true })
        .sort({ sortOrder: 1, _id: 1 })
        .select("_id name")
        .lean();

      const dishes = await Dish.find({
        cafeId: cafe._id,
        categoryId: { $in: categories.map((category) => category._id) },
        isAvailable: true,
      })
        .sort({ sortOrder: 1, _id: 1 })
        .select("categoryId name description priceSom")
        .lean();

      const dishesByCategory = new Map<string, Array<{ name: string; description: string; priceSom: number }>>();
      for (const dish of dishes) {
        const key = dish.categoryId.toString();
        const categoryDishes = dishesByCategory.get(key) ?? [];
        categoryDishes.push({
          name: dish.name,
          description: dish.description,
          priceSom: dish.priceSom,
        });
        dishesByCategory.set(key, categoryDishes);
      }

      response.json({
        cafe: { name: cafe.name, slug: cafe.slug },
        table: { name: table.name },
        categories: categories.map((category) => ({
          name: category.name,
          dishes: dishesByCategory.get(category._id.toString()) ?? [],
        })),
      });
    } catch {
      // Driver errors can include connection details; never print or return them.
      console.error("Не удалось получить публичное меню из MongoDB.");
      response.status(503).json({ message: "Меню временно недоступно: ошибка соединения с базой данных." });
    }
  });

  return router;
}
