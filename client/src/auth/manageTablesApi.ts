import { apiBase } from "../menu/api";
import { expireSession, getSessionCsrfToken } from "./state";
export { buildTableMenuUrl, isExpectedTableMenuUrl } from "./tableQr";

export interface ManagedTable { id: string; name: string; tableCode: string; isActive: boolean }
export interface ManagedTables { cafe: { name: string; slug: string }; tables: ManagedTable[] }
export type TableErrorCode = "UNAUTHORIZED" | "CSRF" | "FORBIDDEN" | "CONFLICT" | "UNAVAILABLE" | "NETWORK" | "OTHER";

export class TablesApiError extends Error {
  readonly status: number;
  readonly code: TableErrorCode;

  constructor(status: number, code: TableErrorCode, message: string) {
    super(message);
    this.status = status;
    this.code = code;
    this.name = "TablesApiError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validTable(value: unknown): value is ManagedTable {
  return isRecord(value) && typeof value.id === "string" && /^[0-9a-f]{24}$/i.test(value.id) &&
    typeof value.name === "string" && typeof value.tableCode === "string" && /^[A-Za-z0-9_-]{32,128}$/.test(value.tableCode) &&
    typeof value.isActive === "boolean";
}

function serverMessage(body: unknown): string | undefined {
  return isRecord(body) && typeof body.message === "string" ? body.message : undefined;
}

async function request(path: string, method: "GET" | "POST" | "PATCH", input?: unknown): Promise<unknown> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (input !== undefined) headers["Content-Type"] = "application/json";
  if (method !== "GET") headers["X-CSRF-Token"] = await getSessionCsrfToken();
  let response: Response;
  try {
    response = await fetch(`${apiBase}/api/manage${path}`, {
      method, credentials: "include", headers,
      ...(input === undefined ? {} : { body: JSON.stringify(input) }),
    });
  } catch {
    throw new TablesApiError(0, "NETWORK", "Не удалось связаться с сервером. Проверьте подключение и повторите попытку.");
  }
  let body: unknown;
  try { body = await response.json(); } catch { body = undefined; }
  if (!response.ok) {
    if (response.status === 401) {
      expireSession();
      throw new TablesApiError(401, "UNAUTHORIZED", "Сессия завершилась. Войдите в аккаунт снова.");
    }
    if (response.status === 403) {
      const code = isRecord(body) && body.code === "CSRF_INVALID" ? "CSRF" : "FORBIDDEN";
      throw new TablesApiError(403, code, code === "CSRF"
        ? "Защитный токен устарел. Обновите страницу кабинета и повторите действие."
        : "Недостаточно прав для управления столами.");
    }
    if (response.status === 409) throw new TablesApiError(409, "CONFLICT", serverMessage(body) ?? "Стол с таким названием уже существует.");
    if (response.status === 503) throw new TablesApiError(503, "UNAVAILABLE", serverMessage(body) ?? "Сервис столов временно недоступен. Повторите попытку.");
    throw new TablesApiError(response.status, "OTHER", serverMessage(body) ?? "Не удалось выполнить запрос со столами.");
  }
  return body;
}

export async function fetchManagedTables(): Promise<ManagedTables> {
  const value = await request("/tables", "GET");
  if (!isRecord(value) || !isRecord(value.cafe) || typeof value.cafe.name !== "string" ||
      typeof value.cafe.slug !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value.cafe.slug) ||
      !Array.isArray(value.tables) || !value.tables.every(validTable)) {
    throw new TablesApiError(503, "UNAVAILABLE", "Сервер вернул некорректный список столов. Повторите загрузку.");
  }
  return value as unknown as ManagedTables;
}

export async function createManagedTable(name: string): Promise<ManagedTable> {
  const value = await request("/tables", "POST", { name });
  if (!isRecord(value) || !validTable(value.table)) throw new TablesApiError(503, "UNAVAILABLE", "Сервер вернул некорректный стол.");
  return value.table;
}

export async function updateManagedTable(id: string, input: { name?: string; isActive?: boolean }): Promise<ManagedTable> {
  const value = await request(`/tables/${encodeURIComponent(id)}`, "PATCH", input);
  if (!isRecord(value) || !validTable(value.table)) throw new TablesApiError(503, "UNAVAILABLE", "Сервер вернул некорректный стол.");
  return value.table;
}
