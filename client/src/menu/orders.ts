import { apiBase } from "./api";

export interface PendingOrder {
  requestId: string;
  items: { dishId: string; quantity: number }[];
  expectedTotalSom: number;
}

export interface OrderReceipt {
  id: string;
  table: { name: string };
  items: { dishId: string; name: string; priceSom: number; quantity: number; lineTotalSom: number }[];
  totalSom: number;
  currency: "KGS";
  status: "new";
  createdAt: string;
}

export type OrderErrorKind = "bad_request" | "not_found" | "price_changed" | "conflict" | "rate_limited" | "unavailable" | "network" | "server";
export class OrderRequestError extends Error {
  constructor(public readonly kind: OrderErrorKind, public readonly retryAt?: number) { super(kind); }
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const objectId = /^[0-9a-f]{24}$/i;
const safeSom = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);

export function pendingStorageKey(cafeSlug: string, tableCode: string): string {
  return `menugo:pending:${encodeURIComponent(cafeSlug)}:${encodeURIComponent(tableCode)}`;
}

export function readPending(key: string): PendingOrder | null {
  try {
    const value: unknown = JSON.parse(sessionStorage.getItem(key) || "null");
    if (!record(value) || typeof value.requestId !== "string" || !uuid.test(value.requestId) ||
        !safeSom(value.expectedTotalSom) || !Array.isArray(value.items) || value.items.length < 1 || value.items.length > 50) return null;
    const seen = new Set<string>();
    const items: PendingOrder["items"] = [];
    for (const item of value.items) {
      if (!record(item) || typeof item.dishId !== "string" || !objectId.test(item.dishId) ||
          !Number.isInteger(item.quantity) || (item.quantity as number) < 1 || (item.quantity as number) > 99 ||
          seen.has(item.dishId.toLowerCase())) return null;
      seen.add(item.dishId.toLowerCase());
      items.push({ dishId: item.dishId.toLowerCase(), quantity: item.quantity as number });
    }
    return { requestId: value.requestId.toLowerCase(), items, expectedTotalSom: value.expectedTotalSom };
  } catch { return null; }
}

export function savePending(key: string, pending: PendingOrder): boolean {
  try { sessionStorage.setItem(key, JSON.stringify(pending)); return true; } catch { return false; }
}

export function clearPending(key: string): boolean {
  try { sessionStorage.removeItem(key); return true; } catch { return false; }
}

function retryAt(header: string | null): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  const time = Number.isFinite(seconds) && seconds >= 0 ? Date.now() + seconds * 1000 : Date.parse(header);
  return Number.isFinite(time) ? time : undefined;
}

function isReceipt(value: unknown): value is OrderReceipt {
  if (!record(value) || typeof value.id !== "string" || !objectId.test(value.id) ||
      !record(value.table) || typeof value.table.name !== "string" || !safeSom(value.totalSom) ||
      value.currency !== "KGS" || value.status !== "new" || typeof value.createdAt !== "string" ||
      !Array.isArray(value.items) || value.items.length === 0) return false;
  let sum = 0;
  for (const item of value.items) {
    if (!record(item) || typeof item.dishId !== "string" || !objectId.test(item.dishId) ||
        typeof item.name !== "string" || !safeSom(item.priceSom) ||
        !Number.isInteger(item.quantity) || (item.quantity as number) < 1 || (item.quantity as number) > 99 ||
        !safeSom(item.lineTotalSom) || item.priceSom * (item.quantity as number) !== item.lineTotalSom) return false;
    sum += item.lineTotalSom;
  }
  return Number.isSafeInteger(sum) && sum === value.totalSom;
}

export async function submitOrder(cafeSlug: string, tableCode: string, pending: PendingOrder): Promise<OrderReceipt> {
  let response: Response;
  try {
    response = await fetch(`${apiBase}/api/public/cafes/${encodeURIComponent(cafeSlug)}/tables/${encodeURIComponent(tableCode)}/orders`, {
      method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(pending),
    });
  } catch { throw new OrderRequestError("network"); }
  let payload: unknown;
  try { payload = await response.json(); } catch { throw new OrderRequestError("network"); }
  if (response.status === 200 || response.status === 201) {
    if (!isReceipt(payload)) throw new OrderRequestError("network");
    return payload;
  }
  if (response.status === 400) throw new OrderRequestError("bad_request");
  if (response.status === 404) throw new OrderRequestError("not_found");
  if (response.status === 409) throw new OrderRequestError(record(payload) && payload.code === "PRICE_CHANGED" ? "price_changed" : "conflict");
  if (response.status === 429) throw new OrderRequestError("rate_limited", retryAt(response.headers.get("Retry-After")));
  if (response.status === 503) throw new OrderRequestError("unavailable");
  throw new OrderRequestError("server");
}
