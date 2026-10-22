import mongoose, { Types } from "mongoose";
import { readConfig } from "../config.js";
import { Cafe } from "../models/Cafe.js";
import { CafeTable } from "../models/Table.js";
import { Category } from "../models/Category.js";
import { Dish } from "../models/Dish.js";

const id = (suffix: string) => new Types.ObjectId(`6d656e75676f64656d6f${suffix}`);
const cafeId = id("0001");
const tableId = id("0002");
const drinksId = id("0003");
const foodId = id("0004");

async function seed(): Promise<void> {
  const { mongoUri } = readConfig();
  if (!mongoUri) {
    throw new Error("Для создания демо-меню укажите MONGO_URI в локальном файле .env.");
  }

  await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 5000, connectTimeoutMS: 5000 });
  await Promise.all([Cafe.init(), CafeTable.init(), Category.init(), Dish.init()]);

  const existingCafe = await Cafe.findById(cafeId);
  if (existingCafe && (existingCafe.slug !== "menugo-demo-seed" || existingCafe.name !== "Кафе MenuGo")) {
    throw new Error("Зарезервированный идентификатор демо-кафе занят. Данные не изменены.");
  }
  if (!existingCafe) {
    await Cafe.create({ _id: cafeId, name: "Кафе MenuGo", slug: "menugo-demo-seed", isActive: true });
  }

  const existingTable = await CafeTable.findById(tableId);
  if (existingTable && (
    !existingTable.cafeId.equals(cafeId) ||
    existingTable.name !== "Стол 4" ||
    existingTable.qrCode !== "menugo-demo-table-04"
  )) {
    throw new Error("Зарезервированный идентификатор демо-стола занят. Данные не изменены.");
  }
  if (!existingTable) {
    await CafeTable.create({
      _id: tableId, cafeId, name: "Стол 4", qrCode: "menugo-demo-table-04", isActive: true,
    });
  }

  const categories = [
    { _id: drinksId, name: "Напитки", sortOrder: 10 },
    { _id: foodId, name: "Основные блюда", sortOrder: 20 },
  ];
  for (const category of categories) {
    const existing = await Category.findById(category._id);
    if (existing && (!existing.cafeId.equals(cafeId) || existing.name !== category.name)) {
      throw new Error("Зарезервированный идентификатор демо-категории занят. Данные не изменены.");
    }
    if (!existing) {
      await Category.create({ ...category, cafeId, isActive: true });
    }
  }

  const dishes = [
    { _id: id("0005"), categoryId: drinksId, name: "Американо", description: "Классический чёрный кофе", priceSom: 180, sortOrder: 10 },
    { _id: id("0006"), categoryId: drinksId, name: "Капучино", description: "Кофе с молочной пеной", priceSom: 220, sortOrder: 20 },
    { _id: id("0007"), categoryId: foodId, name: "Курица с рисом", description: "Горячее блюдо с овощами", priceSom: 420, sortOrder: 10 },
    { _id: id("0008"), categoryId: foodId, name: "Овощной салат", description: "Свежие овощи и зелень", priceSom: 290, sortOrder: 20 },
  ];
  for (const dish of dishes) {
    const existing = await Dish.findById(dish._id);
    if (existing && (
      !existing.cafeId.equals(cafeId) ||
      !existing.categoryId.equals(dish.categoryId) ||
      existing.name !== dish.name
    )) {
      throw new Error("Зарезервированный идентификатор демо-блюда занят. Данные не изменены.");
    }
    if (!existing) {
      await Dish.create({ ...dish, cafeId, isAvailable: true });
    }
  }

  console.info("Демо-меню готово: одно кафе, один стол, две категории и четыре блюда.");
}

try {
  await seed();
} catch (error) {
  // Never print driver errors: they can contain a MongoDB URI and password.
  if (error instanceof Error && error.message.startsWith("Для создания демо-меню")) {
    console.error(error.message);
  } else if (error instanceof Error && error.message.startsWith("Зарезервированный идентификатор")) {
    console.error(error.message);
  } else {
    console.error("Не удалось создать демо-меню. Проверьте подключение к MongoDB и доступность коллекций.");
  }
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}
