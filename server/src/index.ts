import { createApp } from "./app.js";
import { readConfig } from "./config.js";
import { connectDatabase, disconnectDatabase } from "./database.js";

function startServer(): void {
  const config = readConfig();
  const server = createApp(config).listen(config.port, "127.0.0.1", () => {
    console.info(`Сервер MenuGo запущен: http://127.0.0.1:${config.port}`);
    void connectDatabase(config.mongoUri);
  });

  server.on("error", () => {
    console.error("Не удалось запустить HTTP-сервер. Проверьте порт и повторите запуск.");
    process.exitCode = 1;
  });

  let shuttingDown = false;
  const shutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.info("Сервер завершает работу.");
    const timeout = setTimeout(() => process.exit(1), 10000);
    timeout.unref();

    server.close(() => {
      void disconnectDatabase().then(
        () => { clearTimeout(timeout); },
        () => {
          console.error("Не удалось корректно закрыть соединение с MongoDB.");
          process.exitCode = 1;
          clearTimeout(timeout);
        },
      );
    });
  };

  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

try {
  startServer();
} catch {
  console.error("Не удалось запустить сервер. Проверьте PORT и FRONTEND_URL в локальных настройках.");
  process.exitCode = 1;
}
