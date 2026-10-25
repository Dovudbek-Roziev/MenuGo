import { apiBase } from "../menu/api";
import { expireSession, getSessionCsrfToken } from "./state";

export interface ManagedDish {
  id: string;
  categoryId: string;
  name: string;
  description: string;
  priceSom: number;
  sortOrder: number;
  isAvailable: boolean;
}

export interface ManagedCategory {
  id: string;
  name: string;
  sortOrder: number;
  isActive: boolean;
  dishes: ManagedDish[];
}

export type ManageErrorCode = "UNAUTHORIZED" | "CSRF_INVALID" | "ORIGIN_FORBIDDEN" | "CONFLICT" | "UNAVAILABLE" | "NETWORK" | "OTHER";

export class ManageApiError extends Error {
  constructor(public readonly status: number, public readonly code: ManageErrorCode, message: string) {
    super(message);
    this.name = "ManageApiError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validDish(value: unknown): value is ManagedDish {
  if (!isRecord(value)) return false;
  return typeof value.id === "string" && typeof value.categoryId === "string" &&
    typeof value.name === "string" && typeof value.description === "string" &&
    Number.isSafeInteger(value.priceSom) && (value.priceSom as number) >= 0 &&
    Number.isSafeInteger(value.sortOrder) && (value.sortOrder as number) >= 0 &&
    typeof value.isAvailable === "boolean";
}

function validCategory(value: unknown): value is ManagedCategory {
  if (!isRecord(value)) return false;
  return typeof value.id === "string" && typeof value.name === "string" &&
    Number.isSafeInteger(value.sortOrder) && (value.sortOrder as number) >= 0 &&
    typeof value.isActive === "boolean" && Array.isArray(value.dishes) && value.dishes.every(validDish);
}

function classify(response: Response, body: unknown): ManageApiError {
  const record = isRecord(body) ? body : {};
  const code = record.code === "CSRF_INVALID" ? "CSRF_INVALID"
    : record.code === "ORIGIN_FORBIDDEN" ? "ORIGIN_FORBIDDEN"
      : response.status === 401 ? "UNAUTHORIZED"
        : response.status === 409 ? "CONFLICT"
          : response.status === 503 ? "UNAVAILABLE" : "OTHER";
  const message = code === "CSRF_INVALID" ? "Защитный токен устарел. Обновите его и повторите действие."
    : code === "ORIGIN_FORBIDDEN" ? "Источник запроса не разрешён. Обратитесь к администратору."
      : typeof record.message === "string" ? record.message
        : response.status === 401 ? "Сессия завершилась. Войдите в аккаунт снова."
          : response.status === 400 ? "Проверьте введённые данные."
            : response.status === 404 ? "Категория или блюдо не найдены в этом кафе."
              : response.status === 409 ? "Категория или блюдо с таким названием уже существует."
                : response.status === 503 ? "Сервис временно недоступен. Попробуйте позже."
                  : "Не удалось выполнить запрос.";
  return new ManageApiError(response.status, code, message);
}

async function request<T>(path: string, method: "GET" | "POST" | "PATCH", body?: unknown): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (method !== "GET") headers["X-CSRF-Token"] = await getSessionCsrfToken();

  let response: Response;
  try {
    response = await fetch(`${apiBase}/api/manage${path}`, {
      method,
      credentials: "include",
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch {
    throw new ManageApiError(0, "NETWORK", "Не удалось связаться с сервером. Проверьте подключение и попробуйте ещё раз.");
  }

  if (!response.ok) {
    let data: unknown;
    try { data = await response.json(); } catch { data = undefined; }
    const error = classify(response, data);
    if (error.status === 401) expireSession();
    throw error;
  }

  try { return await response.json() as T; }
  catch { throw new ManageApiError(503, "UNAVAILABLE", "Сервер вернул некорректный ответ. Повторите загрузку."); }
}

export async function fetchManagedMenu(): Promise<ManagedCategory[]> {
  const data = await request<{ categories?: unknown }>("/menu", "GET");
  if (!Array.isArray(data.categories) || !data.categories.every(validCategory)) {
    throw new ManageApiError(503, "UNAVAILABLE", "Сервер вернул некорректные данные меню.");
  }
  return data.categories;
}

export async function createCategory(input: { name: string; sortOrder: number }): Promise<ManagedCategory> {
  const data = await request<{ category?: unknown }>("/menu/categories", "POST", input);
  if (!validCategory({ ...data.category as object, dishes: [] })) {
    throw new ManageApiError(503, "UNAVAILABLE", "Сервер вернул некорректную категорию.");
  }
  return { ...data.category as ManagedCategory, dishes: [] };
}

export async function updateCategory(id: string, input: Partial<Pick<ManagedCategory, "name" | "sortOrder" | "isActive">>): Promise<ManagedCategory> {
  const data = await request<{ category?: unknown }>(`/menu/categories/${encodeURIComponent(id)}`, "PATCH", input);
  if (!validCategory({ ...data.category as object, dishes: [] })) {
    throw new ManageApiError(503, "UNAVAILABLE", "Сервер вернул некорректную категорию.");
  }
  return { ...data.category as ManagedCategory, dishes: [] };
}

export async function createDish(input: Omit<ManagedDish, "id">): Promise<ManagedDish> {
  const data = await request<{ dish?: unknown }>("/menu/dishes", "POST", input);
  if (!validDish(data.dish)) throw new ManageApiError(503, "UNAVAILABLE", "Сервер вернул некорректное блюдо.");
  return data.dish;
}

export async function updateDish(id: string, input: Partial<Omit<ManagedDish, "id">>): Promise<ManagedDish> {
  const data = await request<{ dish?: unknown }>(`/menu/dishes/${encodeURIComponent(id)}`, "PATCH", input);
  if (!validDish(data.dish)) throw new ManageApiError(503, "UNAVAILABLE", "Сервер вернул некорректное блюдо.");
  return data.dish;
}
