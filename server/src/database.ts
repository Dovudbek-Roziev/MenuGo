import mongoose from "mongoose";

export type DatabaseStatus = "connected" | "disconnected" | "not_configured";

export function getDatabaseStatus(mongoUri: string | undefined): DatabaseStatus {
  if (!mongoUri) return "not_configured";
  return mongoose.connection.readyState === 1 ? "connected" : "disconnected";
}

// Do not log error objects: driver messages may contain connection credentials.
mongoose.connection.on("error", () => {
  console.error("Ошибка соединения с MongoDB. Проверьте локальные настройки подключения.");
});

mongoose.connection.on("connected", () => {
  console.info("Соединение с MongoDB установлено.");
});

mongoose.connection.on("disconnected", () => {
  console.info("Соединение с MongoDB закрыто или недоступно.");
});

export async function connectDatabase(mongoUri: string | undefined): Promise<void> {
  if (!mongoUri) {
    console.info("MongoDB не настроена. HTTP-сервер работает без базы данных.");
    return;
  }

  try {
    await mongoose.connect(mongoUri, {
      serverSelectionTimeoutMS: 5000,
      connectTimeoutMS: 5000,
    });
  } catch {
    console.warn("Не удалось подключиться к MongoDB. HTTP-сервер продолжает работать. После исправления настроек перезапустите сервер.");
  }
}

export async function disconnectDatabase(): Promise<void> {
  await mongoose.disconnect();
}
