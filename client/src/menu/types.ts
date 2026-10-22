export interface MenuDish {
  id: string;
  name: string;
  description: string;
  priceSom: number;
}

export interface MenuCategory {
  id: string;
  name: string;
  dishes: MenuDish[];
}

export interface GuestMenuData {
  cafe: { name: string; slug: string };
  table: { name: string };
  categories: MenuCategory[];
}

export type MenuErrorKind = "not_found" | "unavailable" | "connection";

export class MenuRequestError extends Error {
  constructor(public readonly kind: MenuErrorKind) {
    super(kind);
  }
}
