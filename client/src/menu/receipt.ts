export const orderStatuses = ["new", "preparing", "ready", "completed", "cancelled"] as const;
export type OrderStatus = typeof orderStatuses[number];

export const receiptCopy: Record<OrderStatus, { title: string; detail: string }> = {
  new: { title: "Заказ отправлен", detail: "Заказ сохранён со статусом «Новый». Подтверждение сотрудника пока не получено." },
  preparing: { title: "Заказ готовится", detail: "Сотрудник перевёл заказ в статус «Готовится»." },
  ready: { title: "Заказ готов", detail: "Заказ переведён в статус «Готов»." },
  completed: { title: "Заказ завершён", detail: "Заказ переведён в статус «Завершён»." },
  cancelled: { title: "Заказ отменён", detail: "Заказ переведён в статус «Отменён». Уточните подробности у сотрудника кафе." },
};

const objectId = /^[0-9a-f]{24}$/i;
const safeSom = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);

export interface OrderReceipt {
  id: string;
  table: { name: string };
  items: { dishId: string; name: string; priceSom: number; quantity: number; lineTotalSom: number }[];
  totalSom: number;
  currency: "KGS";
  status: OrderStatus;
  createdAt: string;
}

export function isReceipt(value: unknown): value is OrderReceipt {
  if (!record(value) || typeof value.id !== "string" || !objectId.test(value.id) ||
      !record(value.table) || typeof value.table.name !== "string" || !safeSom(value.totalSom) ||
      value.currency !== "KGS" || !orderStatuses.some((status) => status === value.status) ||
      typeof value.createdAt !== "string" || !Array.isArray(value.items) || value.items.length === 0) return false;
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
