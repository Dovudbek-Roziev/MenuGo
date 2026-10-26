import { MenuRequestError, type GuestMenuData } from "./types";

export const apiBase = (import.meta.env.VITE_API_URL || "http://127.0.0.1:4000").replace(/\/+$/, "");

export async function fetchGuestMenu(cafeSlug: string, tableCode: string, signal: AbortSignal): Promise<GuestMenuData> {
  let response: Response;
  try {
    response = await fetch(
      `${apiBase}/api/public/cafes/${encodeURIComponent(cafeSlug)}/tables/${encodeURIComponent(tableCode)}/menu`,
      { signal, headers: { Accept: "application/json" } },
    );
  } catch (error) {
    if (signal.aborted) throw error;
    throw new MenuRequestError("connection");
  }

  if (response.status === 404) throw new MenuRequestError("not_found");
  if (!response.ok) throw new MenuRequestError("unavailable");

  try {
    const data: unknown = await response.json();
    if (!isGuestMenuData(data)) throw new Error("Invalid menu response");
    return data;
  } catch {
    throw new MenuRequestError("unavailable");
  }
}

function isGuestMenuData(value: unknown): value is GuestMenuData {
  if (!value || typeof value !== "object") return false;
  const menu = value as Partial<GuestMenuData>;
  return typeof menu.cafe?.name === "string" && typeof menu.table?.name === "string" &&
    Array.isArray(menu.categories) && menu.categories.every((category) =>
      typeof category.id === "string" && category.id.length > 0 && typeof category.name === "string" &&
      Array.isArray(category.dishes) && category.dishes.every((dish) =>
        typeof dish.id === "string" && dish.id.length > 0 && typeof dish.name === "string" &&
        typeof dish.description === "string" && Number.isSafeInteger(dish.priceSom) && dish.priceSom >= 0 &&
        (dish.imageUrl === undefined || typeof dish.imageUrl === "string"),
      ),
    );
}
