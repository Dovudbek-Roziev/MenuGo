import { emitKeypressEvents } from "node:readline";
import mongoose from "mongoose";
import argon2 from "argon2";
import { readConfig } from "../config.js";
import { Cafe } from "../models/Cafe.js";
import { User, normalizeEmail, type UserRole } from "../models/User.js";

class CliError extends Error {}

function options(): { cafeSlug: string; role: UserRole; name: string; email: string } {
  const args = process.argv.slice(2);
  if (args.length !== 8) throw new CliError("Укажите --cafe, --role, --name и --email. Пароль вводится отдельно.");
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    if (!key || !["--cafe", "--role", "--name", "--email"].includes(key) || values.has(key) || !args[index + 1]) {
      throw new CliError("Неверные параметры. Используйте --cafe, --role, --name и --email.");
    }
    values.set(key, args[index + 1]!);
  }
  const cafeSlug = values.get("--cafe")!;
  const role = values.get("--role")!;
  const name = values.get("--name")!.trim();
  const email = normalizeEmail(values.get("--email")!);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(cafeSlug) ||
      (role !== "owner" && role !== "staff") || name.length < 1 || name.length > 120 ||
      email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new CliError("Проверьте кафе, роль, имя и email.");
  }
  return { cafeSlug, role, name, email };
}

function hiddenInput(prompt: string): Promise<string> {
  if (!process.stdin.isTTY || !process.stdin.setRawMode) throw new CliError("Пароль можно ввести только в интерактивном терминале.");
  emitKeypressEvents(process.stdin);
  const wasRaw = process.stdin.isRaw;
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdout.write(prompt);
  return new Promise((resolve, reject) => {
    let value = "";
    const done = () => {
      process.stdin.off("keypress", onKey);
      process.stdin.setRawMode(wasRaw);
      process.stdin.pause();
      process.stdout.write("\n");
    };
    const onKey = (character: string, key: { name?: string; ctrl?: boolean; meta?: boolean }) => {
      if (key.ctrl && key.name === "c") { done(); reject(new CliError("Ввод отменён.")); return; }
      if (key.name === "return" || key.name === "enter") { done(); resolve(value); return; }
      if (key.name === "backspace") { value = Array.from(value).slice(0, -1).join(""); return; }
      if (character && !key.ctrl && !key.meta && character >= " ") value += character;
    };
    process.stdin.on("keypress", onKey);
  });
}

async function main(): Promise<void> {
  const { cafeSlug, role, name, email } = options();
  const config = readConfig();
  if (!config.mongoUri) throw new CliError("Для создания аккаунта настройте MONGO_URI в локальном .env.");
  await mongoose.connect(config.mongoUri, { serverSelectionTimeoutMS: 5000 });
  const cafe = await Cafe.findOne({ slug: cafeSlug, isActive: true }).select("_id").lean();
  if (!cafe) throw new CliError("Активное кафе с таким slug не найдено.");
  await User.init();
  if (await User.exists({ email })) throw new CliError("Аккаунт с этим email уже существует. Пароль не изменён.");
  const password = await hiddenInput("Пароль (12–128 символов): ");
  const confirm = await hiddenInput("Повторите пароль: ");
  if (password !== confirm) throw new CliError("Пароли не совпадают.");
  if (Array.from(password).length < 12 || Array.from(password).length > 128) throw new CliError("Пароль должен содержать от 12 до 128 символов.");
  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
  await User.create({ name, email, passwordHash, cafeId: cafe._id, role, isActive: true });
  console.info("Аккаунт создан.");
}

try { await main(); }
catch (error) {
  // Never print driver errors, passwords, hashes, or connection strings.
  console.error(error instanceof CliError ? error.message : "Не удалось создать аккаунт. Проверьте параметры и подключение к базе.");
  process.exitCode = 1;
} finally { await mongoose.disconnect(); }
