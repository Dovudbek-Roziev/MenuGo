import type { GuestMenuData, MenuDish } from "./types";

export interface CartItem { id: string; quantity: number }
export interface CartLine { dish: MenuDish; quantity: number; total: bigint }

export function cartStorageKey(cafeSlug: string, tableCode: string): string {
  return `menugo:cart:${encodeURIComponent(cafeSlug)}:${encodeURIComponent(tableCode)}`;
}

export function readCart(key: string): CartItem[] {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return [];
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    const items = new Map<string, number>();
    for (const item of value) {
      if (!item || typeof item !== "object") continue;
      const candidate = item as Partial<CartItem>;
      if (typeof candidate.id !== "string" || !candidate.id ||
          !Number.isSafeInteger(candidate.quantity) || candidate.quantity! < 1 || candidate.quantity! > 99) continue;
      items.set(candidate.id, Math.min(99, (items.get(candidate.id) ?? 0) + candidate.quantity!));
    }
    return Array.from(items, ([id, quantity]) => ({ id, quantity }));
  } catch {
    return [];
  }
}

export function writeCart(key: string, items: CartItem[]): void {
  try {
    if (items.length) sessionStorage.setItem(key, JSON.stringify(items));
    else sessionStorage.removeItem(key);
  } catch {
    // Private browsing or disabled storage must not prevent using the cart in memory.
  }
}

export function reconcileCart(items: CartItem[], menu: GuestMenuData): { items: CartItem[]; removed: boolean } {
  const available = new Set(menu.categories.flatMap((category) => category.dishes.map((dish) => dish.id)));
  const valid = items.filter((item) => available.has(item.id));
  return { items: valid, removed: valid.length !== items.length };
}

export function cartLines(items: CartItem[], menu: GuestMenuData): CartLine[] {
  const dishes = new Map(menu.categories.flatMap((category) => category.dishes.map((dish) => [dish.id, dish] as const)));
  return items.flatMap(({ id, quantity }) => {
    const dish = dishes.get(id);
    return dish ? [{ dish, quantity, total: BigInt(dish.priceSom) * BigInt(quantity) }] : [];
  });
}

export function changeQuantity(items: CartItem[], id: string, change: number): CartItem[] {
  const current = items.find((item) => item.id === id);
  if (!current) return change > 0 ? [...items, { id, quantity: 1 }] : items;
  const quantity = Math.max(0, Math.min(99, current.quantity + change));
  return quantity === 0 ? items.filter((item) => item.id !== id) : items.map((item) => item.id === id ? { id, quantity } : item);
}
