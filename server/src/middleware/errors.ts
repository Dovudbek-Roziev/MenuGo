import type { ErrorRequestHandler, RequestHandler } from "express";

export const notFound: RequestHandler = (_request, response) => {
  response.status(404).json({ message: "API-маршрут не найден." });
};

export const errorHandler: ErrorRequestHandler = (error: unknown, _request, response, _next) => {
  if (response.headersSent) {
    // Do not pass a potentially sensitive error to Express's default logger.
    response.destroy();
    return;
  }

  if (typeof error === "object" && error !== null && "type" in error) {
    if (error.type === "entity.parse.failed") {
      response.status(400).json({ message: "Некорректный JSON в теле запроса." });
      return;
    }
    if (error.type === "entity.too.large") {
      response.status(413).json({ message: "Тело запроса слишком большое." });
      return;
    }
  }

  // Never return or print raw errors, stacks, request bodies or MongoDB URIs.
  console.error("Внутренняя ошибка при обработке запроса.");
  response.status(500).json({ message: "Внутренняя ошибка сервера." });
};
