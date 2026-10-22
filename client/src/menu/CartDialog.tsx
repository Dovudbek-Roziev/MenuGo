import { useEffect, useRef, type RefObject } from "react";
import type { CartLine } from "./cart";

interface Props {
  lines: CartLine[];
  total: bigint;
  onClose: () => void;
  onChange: (id: string, change: number) => void;
  onClear: () => void;
  returnFocus: RefObject<HTMLButtonElement | null>;
}

const format = new Intl.NumberFormat("ru-RU");

export default function CartDialog({ lines, total, onClose, onChange, onClear, returnFocus }: Props) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

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
        <div className="cart-top"><div><span className="guest-kicker">ВАШ ВЫБОР</span><h2 id="cart-title">Корзина</h2></div><button ref={closeRef} type="button" className="cart-close" onClick={onClose} aria-label="Закрыть корзину">×</button></div>
        <div className="cart-content">
          {lines.length ? (
            <ul className="cart-lines">
              {lines.map(({ dish, quantity, total: lineTotal }) => (
                <li key={dish.id} className="cart-line">
                  <div className="cart-line-heading"><h3>{dish.name}</h3><strong>{format.format(lineTotal)} сом</strong></div>
                  <div className="cart-line-bottom"><span>{format.format(dish.priceSom)} сом / шт.</span><div className="cart-stepper"><button type="button" onClick={() => onChange(dish.id, -1)} aria-label={`Уменьшить количество: ${dish.name}`}>−</button><span aria-live="polite">{quantity}</span><button type="button" onClick={() => onChange(dish.id, 1)} disabled={quantity >= 99} aria-label={`Увеличить количество: ${dish.name}`}>+</button></div></div>
                </li>
              ))}
            </ul>
          ) : <div className="cart-empty"><h3>Корзина пока пуста</h3><p>Выберите блюда из меню, чтобы увидеть их здесь.</p></div>}
        </div>
        <div className="cart-bottom">
          {lines.length > 0 && <><div className="cart-total"><span>Итого</span><strong>{format.format(total)} сом</strong></div><button type="button" className="cart-clear" onClick={onClear}>Очистить корзину</button></>}
          <p>Заказ пока недоступен. Корзина помогает посчитать выбранные блюда.</p>
        </div>
      </div>
    </div>
  );
}
