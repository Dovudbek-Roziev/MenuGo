import { apiBase } from "../menu/api";
import { expireSession, getSessionCsrfToken } from "./state";

export const orderStatuses = ["new", "preparing", "ready", "completed", "cancelled"] as const;
export type OrderStatus = typeof orderStatuses[number];
export type OrderFilter = OrderStatus | "all";

export const statusNames: Record<OrderStatus, string> = {
  new: "Новый", preparing: "Готовится", ready: "Готов", completed: "Завершён", cancelled: "Отменён",
};
export const nextStatus: Record<OrderStatus, "preparing" | "ready" | "completed" | null> = {
  new: "preparing", preparing: "ready", ready: "completed", completed: null, cancelled: null,
};

export interface ManagedOrder {
  id: string;
  table: { name: string };
  items: Array<{ dishId: string; name: string; priceSom: number; quantity: number; lineTotalSom: number }>;
  totalSom: number;
  currency: "KGS";
  status: OrderStatus;
  createdAt: string;
  updatedAt: string;
}

export interface OrdersPage {
  orders: ManagedOrder[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

export type OrdersErrorCode = "UNAUTHORIZED" | "CSRF_INVALID" | "ORIGIN_FORBIDDEN" | "CONFLICT" | "UNAVAILABLE" | "NETWORK" | "OTHER";
export class OrdersApiError extends Error {
  constructor(public readonly status: number, public readonly code: OrdersErrorCode, message: string) {
    super(message);
  }
}

const objectId = /^[0-9a-f]{24}$/i;
const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const isSom = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
const isStatus = (value: unknown): value is OrderStatus => typeof value === "string" && orderStatuses.some((status) => status === value);

function isOrder(value: unknown): value is ManagedOrder {
  if (!isRecord(value) || typeof value.id !== "string" || !objectId.test(value.id) || !isRecord(value.table) ||
      typeof value.table.name !== "string" || !Array.isArray(value.items) || !isSom(value.totalSom) ||
      value.currency !== "KGS" || !isStatus(value.status) || typeof value.createdAt !== "string" ||
      !Number.isFinite(Date.parse(value.createdAt)) || typeof value.updatedAt !== "string" ||
      !Number.isFinite(Date.parse(value.updatedAt))) return false;
  let sum = 0;
  for (const item of value.items) {
    if (!isRecord(item) || typeof item.dishId !== "string" || !objectId.test(item.dishId) ||
        typeof item.name !== "string" || !isSom(item.priceSom) || !Number.isInteger(item.quantity) ||
        (item.quantity as number) < 1 || (item.quantity as number) > 99 || !isSom(item.lineTotalSom) ||
        item.priceSom * (item.quantity as number) !== item.lineTotalSom) return false;
    sum += item.lineTotalSom;
  }
  return Number.isSafeInteger(sum) && sum === value.totalSom;
}

function isPage(value: unknown): value is OrdersPage {
  if (!isRecord(value) || !Array.isArray(value.orders) || !value.orders.every(isOrder) || !isRecord(value.pagination)) return false;
  const { page, limit, total, totalPages } = value.pagination;
  return Number.isSafeInteger(page) && (page as number) >= 1 && Number.isSafeInteger(limit) &&
    (limit as number) >= 1 && (limit as number) <= 100 && isSom(total) && isSom(totalPages) &&
    totalPages === Math.ceil((total as number) / (limit as number));
}

function apiError(response: Response, body: unknown): OrdersApiError {
  const data = isRecord(body) ? body : {};
  const code: OrdersErrorCode = data.code === "CSRF_INVALID" ? "CSRF_INVALID"
    : data.code === "ORIGIN_FORBIDDEN" ? "ORIGIN_FORBIDDEN"
      : response.status === 401 ? "UNAUTHORIZED"
        : response.status === 409 ? "CONFLICT"
          : response.status === 503 ? "UNAVAILABLE" : "OTHER";
  const fallback = code === "CSRF_INVALID" ? "Защитный токен устарел. Обновите защиту и повторите действие."
    : code === "ORIGIN_FORBIDDEN" ? "Источник запроса не разрешён. Проверьте адрес сайта."
      : response.status === 401 ? "Сессия завершилась. Войдите снова."
        : response.status === 403 ? "Недостаточно прав для этого действия."
          : response.status === 409 ? "Заказ уже изменён другим сотрудником."
            : response.status === 503 ? "Заказы временно недоступны. Повторите попытку позже."
              : "Не удалось выполнить запрос заказов.";
  const message = code === "CSRF_INVALID" || code === "ORIGIN_FORBIDDEN" ? fallback
    : typeof data.message === "string" ? data.message : fallback;
  return new OrdersApiError(response.status, code, message);
}

async function request(path: string, init: RequestInit): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(`${apiBase}/api/manage${path}`, {
      ...init, credentials: "include", cache: "no-store", headers: { Accept: "application/json", ...init.headers },
    });
  } catch (error) {
    if (init.signal?.aborted) throw error;
    throw new OrdersApiError(0, "NETWORK", "Нет связи с сервером. Проверьте подключение и повторите попытку.");
  }
  let body: unknown;
  try { body = await response.json(); }
  catch { throw new OrdersApiError(503, "UNAVAILABLE", "Сервер вернул некорректный ответ. Повторите попытку."); }
  if (!response.ok) {
    const error = apiError(response, body);
    if (error.status === 401) expireSession();
    throw error;
  }
  return body;
}

export async function fetchOrders(filter: OrderFilter, page: number, signal: AbortSignal): Promise<OrdersPage> {
  const params = new URLSearchParams({ page: String(page), limit: "10" });
  if (filter !== "all") params.set("status", filter);
  const data = await request(`/orders?${params}`, { method: "GET", signal });
  if (!isPage(data) || data.pagination.page !== page) {
    throw new OrdersApiError(503, "UNAVAILABLE", "Сервер вернул некорректный список заказов. Повторите загрузку.");
  }
  return data;
}

export async function changeOrderStatus(order: ManagedOrder, status: OrderStatus): Promise<ManagedOrder> {
  const token = await getSessionCsrfToken();
  const data = await request(`/orders/${encodeURIComponent(order.id)}/status`, {
    method: "PATCH", headers: { "Content-Type": "application/json", "X-CSRF-Token": token },
    body: JSON.stringify({ expectedStatus: order.status, status }),
  });
  if (!isRecord(data) || !isOrder(data.order) || data.order.id !== order.id || data.order.status !== status) {
    throw new OrdersApiError(503, "UNAVAILABLE", "Ответ об изменении заказа не подтверждён. Проверьте статус заказа.");
  }
  return data.order;
}
