import { useEffect, useRef, type RefObject } from "react";
import type { CartLine } from "./cart";
import type { OrderErrorKind, OrderReceipt } from "./orders";

interface Props {
  lines: CartLine[];
  total: bigint;
  onClose: () => void;
  onChange: (id: string, change: number) => void;
  onClear: () => void;
  onSubmit: () => void;
  pending: boolean;
  sending: boolean;
  retrySeconds: number;
  orderError: OrderErrorKind | "storage" | null;
  receipt: OrderReceipt | null;
  returnFocus: RefObject<HTMLButtonElement | null>;
}

const format = new Intl.NumberFormat("ru-RU");

export const orderErrorCopy: Record<OrderErrorKind | "storage", string> = {
  bad_request: "Заказ не прошёл проверку. Проверьте состав корзины и попробуйте снова.",
  not_found: "Кафе или стол не найдены. Проверьте QR-код и адрес меню.",
  price_changed: "Цены изменились. Проверьте обновлённую сумму и отправьте заказ заново.",
  conflict: "Одно из блюд больше не доступно. Меню обновляется; проверьте корзину.",
  rate_limited: "Слишком много попыток. Повторите отправку позже.",
  unavailable: "Заказы временно недоступны. Ваш выбор сохранён; повторите отправку позже.",
  network: "Ответ сервера не получен. Заказ мог сохраниться. Повторите запрос: повторный заказ не создастся.",
  server: "Не удалось подтвердить результат заказа. Повторите запрос позже.",
  storage: "Не удалось сохранить запрос в этой вкладке. Разрешите хранение данных и попробуйте снова.",
};

export default function CartDialog({ lines, total, onClose, onChange, onClear, onSubmit, pending, sending, retrySeconds, orderError, receipt, returnFocus }: Props) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const receiptRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => { if (receipt) receiptRef.current?.focus(); }, [receipt]);

  useEffect(() => {
    closeRef.current?.focus();
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); onClose(); return; }
      if (event.key !== "Tab") return;
      const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>("button:not(:disabled), a[href], [tabindex]:not([tabindex='-1'])") ?? []);
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!first || !last) return;
      if (!dialogRef.current?.contains(document.activeElement) || !focusable.includes(document.activeElement as HTMLElement)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
        return;
      }
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = oldOverflow;
      document.removeEventListener("keydown", onKeyDown);
      returnFocus.current?.focus();
    };
  }, [onClose, returnFocus]);

  return (
    <div className="cart-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="cart-dialog" role="dialog" aria-modal="true" aria-labelledby="cart-title" ref={dialogRef}>
        <div className="cart-top"><div><span className="guest-kicker">{receipt ? "ПОДТВЕРЖДЕНИЕ" : "ВАШ ВЫБОР"}</span><h2 id="cart-title">{receipt ? "Заказ отправлен" : "Корзина"}</h2></div><button ref={closeRef} type="button" className="cart-close" onClick={onClose} aria-label="Закрыть окно">×</button></div>
        <div className="cart-content">
          {receipt ? (
            <div className="cart-receipt" role="status">
              <h3 ref={receiptRef} tabIndex={-1}>Заказ отправлен</h3>
              <p>Номер заказа: <strong>{receipt.id}</strong></p>
              <p>{receipt.table.name} · {new Date(receipt.createdAt).toLocaleString("ru-RU")}</p>
              <ul>{receipt.items.map((item) => <li key={item.dishId}><span>{item.name} · {item.quantity} × {format.format(item.priceSom)} сом</span><strong>{format.format(item.lineTotalSom)} сом</strong></li>)}</ul>
              <div className="cart-total"><span>Итого</span><strong>{format.format(receipt.totalSom)} сом</strong></div>
              <p>Заказ сохранён со статусом «Новый». Подтверждение сотрудника пока не получено.</p>
            </div>
          ) : lines.length ? (
            <ul className="cart-lines">
              {lines.map(({ dish, quantity, total: lineTotal }) => (
                <li key={dish.id} className="cart-line">
                  <div className="cart-line-heading"><h3>{dish.name}</h3><strong>{format.format(lineTotal)} сом</strong></div>
                  <div className="cart-line-bottom"><span>{format.format(dish.priceSom)} сом / шт.</span><div className="cart-stepper"><button type="button" onClick={() => { if (quantity === 1) closeRef.current?.focus(); onChange(dish.id, -1); }} disabled={pending || sending} aria-label={`Уменьшить количество: ${dish.name}`}>−</button><span aria-live="polite">{quantity}</span><button type="button" onClick={() => onChange(dish.id, 1)} disabled={pending || sending || quantity >= 99} aria-label={`Увеличить количество: ${dish.name}`}>+</button></div></div>
                </li>
              ))}
            </ul>
          ) : <div className="cart-empty"><h3>Корзина пока пуста</h3><p>Выберите блюда из меню, чтобы увидеть их здесь.</p></div>}
        </div>
        <div className="cart-bottom">
          {!receipt && <>
            {lines.length > 0 && <><div className="cart-total"><span>Итого</span><strong>{format.format(total)} сом</strong></div><button type="button" className="cart-clear" disabled={pending || sending} onClick={() => { closeRef.current?.focus(); onClear(); }}>Очистить корзину</button></>}
            {orderError && <p className="cart-order-message" role="alert">{orderErrorCopy[orderError]}{retrySeconds > 0 && ` Повтор через ${retrySeconds} с.`}</p>}
            {pending && !orderError && <p className="cart-order-message" role="status">{sending ? "Отправляем заказ. Не меняйте корзину." : "Результат предыдущей отправки неизвестен. Повторите тот же запрос, чтобы проверить заказ."}</p>}
            {lines.length > 0 && <button type="button" className="cart-submit" aria-disabled={sending || retrySeconds > 0} onClick={() => { if (!sending && retrySeconds === 0) onSubmit(); }}>{sending ? "Отправляем…" : pending ? "Повторить отправку" : "Отправить заказ"}</button>}
            {pending && lines.length === 0 && <button type="button" className="cart-submit" aria-disabled={sending || retrySeconds > 0} onClick={() => { if (!sending && retrySeconds === 0) onSubmit(); }}>Повторить отправку</button>}
            <p>Сумму и наличие блюд проверит сервер. Оплата пока недоступна.</p>
          </>}
        </div>
      </div>
    </div>
  );
}
