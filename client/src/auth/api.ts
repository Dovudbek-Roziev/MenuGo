import { apiBase } from "../menu/api";

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: "owner" | "staff";
}

export interface AuthCafe {
  id: string;
  name: string;
  slug: string;
}

export interface AuthIdentity {
  user: AuthUser;
  cafe: AuthCafe;
}

export type AuthErrorCode = "CSRF_INVALID" | "ORIGIN_FORBIDDEN" | "UNAUTHORIZED" | "RATE_LIMITED" | "UNAVAILABLE" | "NETWORK" | "OTHER";

export class AuthApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: AuthErrorCode,
    message: string,
    public readonly retryAfterSeconds?: number,
  ) {
    super(message);
  }
}

interface ApiFailure { message?: unknown; code?: unknown }

async function readFailure(response: Response): Promise<ApiFailure> {
  try {
    const body: unknown = await response.json();
    return body && typeof body === "object" ? body as ApiFailure : {};
  } catch {
    return {};
  }
}

function errorFor(response: Response, body: ApiFailure): AuthApiError {
  const retryHeader = response.headers.get("Retry-After");
  const retryAfter = retryHeader && /^\d+$/.test(retryHeader) ? Math.max(1, Number(retryHeader)) : undefined;
  const code = body.code === "CSRF_INVALID" || body.code === "ORIGIN_FORBIDDEN"
    ? body.code
    : response.status === 401 ? "UNAUTHORIZED"
      : response.status === 429 ? "RATE_LIMITED"
        : response.status === 503 ? "UNAVAILABLE" : "OTHER";
  const serverMessage = typeof body.message === "string" ? body.message : undefined;
  const fallback = response.status === 401 ? "Неверный email или пароль."
    : response.status === 403 ? "Запрос запрещён. Обновите страницу и попробуйте снова."
      : response.status === 429 ? "Слишком много попыток. Повторите позже."
        : response.status === 503 ? "Сервис временно недоступен. Попробуйте позже."
          : "Не удалось выполнить запрос.";
  return new AuthApiError(response.status, code, serverMessage || fallback, retryAfter);
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${apiBase}/api/auth${path}`, {
      ...init,
      credentials: "include",
      headers: { Accept: "application/json", ...init.headers },
    });
  } catch {
    throw new AuthApiError(0, "NETWORK", "Не удалось связаться с сервером. Проверьте подключение и повторите попытку.");
  }

  if (!response.ok) throw errorFor(response, await readFailure(response));
  try {
    return await response.json() as T;
  } catch {
    throw new AuthApiError(response.status, "OTHER", "Сервер вернул некорректный ответ.");
  }
}

export async function fetchCsrfToken(): Promise<string> {
  const data = await request<{ csrfToken?: unknown }>("/csrf");
  if (typeof data.csrfToken !== "string" || data.csrfToken.length < 20) {
    throw new AuthApiError(503, "UNAVAILABLE", "Не удалось подготовить защищённый запрос. Попробуйте позже.");
  }
  return data.csrfToken;
}

export async function fetchMe(): Promise<AuthIdentity> {
  const data = await request<AuthIdentity>("/me");
  if (!isIdentity(data)) throw new AuthApiError(503, "UNAVAILABLE", "Сервер вернул некорректные данные профиля.");
  return data;
}

export async function loginRequest(email: string, password: string, csrfToken: string): Promise<{ identity: AuthIdentity; csrfToken: string }> {
  const data = await request<{ user?: unknown; cafe?: unknown; csrfToken?: unknown }>("/login", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken },
    body: JSON.stringify({ email, password }),
  });
  const identity = { user: data.user, cafe: data.cafe };
  if (!isIdentity(identity) || typeof data.csrfToken !== "string" || data.csrfToken.length < 20) {
    throw new AuthApiError(503, "UNAVAILABLE", "Сервер вернул некорректный ответ входа.");
  }
  return { identity, csrfToken: data.csrfToken };
}

export async function logoutRequest(csrfToken: string): Promise<void> {
  await request<{ message?: string }>("/logout", {
    method: "POST",
    headers: { "X-CSRF-Token": csrfToken },
  });
}

function isIdentity(value: unknown): value is AuthIdentity {
  if (!value || typeof value !== "object") return false;
  const identity = value as Partial<AuthIdentity>;
  return !!identity.user && typeof identity.user.id === "string" && typeof identity.user.name === "string" &&
    typeof identity.user.email === "string" && (identity.user.role === "owner" || identity.user.role === "staff") &&
    !!identity.cafe && typeof identity.cafe.id === "string" && typeof identity.cafe.name === "string" && typeof identity.cafe.slug === "string";
}
