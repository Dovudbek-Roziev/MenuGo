import { useCallback, useEffect, useRef, useState } from "react";
import { fetchGuestMenu } from "./api";
import { cartLines, cartStorageKey, changeQuantity, readCart, reconcileCart, writeCart, type CartItem } from "./cart";
import CartDialog from "./CartDialog";
import { clearPending, pendingStorageKey, readPending, savePending, submitOrder, OrderRequestError, type OrderErrorKind, type OrderReceipt, type PendingOrder } from "./orders";
import { MenuRequestError, type GuestMenuData, type MenuErrorKind } from "./types";
import "./guest-menu.css";

type ViewState =
  | { status: "loading" }
  | { status: "error"; kind: MenuErrorKind }
  | { status: "ready"; data: GuestMenuData };

const errorCopy: Record<MenuErrorKind, { title: string; detail: string }> = {
  not_found: { title: "Кафе или стол не найдены", detail: "Проверьте адрес меню или попросите сотрудника кафе показать QR-код ещё раз." },
  unavailable: { title: "Меню временно недоступно", detail: "Попробуйте открыть меню немного позже." },
  connection: { title: "Не удалось подключиться к серверу", detail: "Проверьте соединение и попробуйте ещё раз." },
};

function dishCountLabel(count: number): string {
  const lastTwo = count % 100;
  const last = count % 10;
  const word = lastTwo >= 11 && lastTwo <= 14 ? "блюд" : last === 1 ? "блюдо" : last >= 2 && last <= 4 ? "блюда" : "блюд";
  return `${count} ${word}`;
}

export default function GuestMenu({ cafeSlug, tableCode }: { cafeSlug: string; tableCode: string }) {
  const [view, setView] = useState<ViewState>({ status: "loading" });
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [cartOpen, setCartOpen] = useState(false);
  const [removedNotice, setRemovedNotice] = useState(false);
  const [orderError, setOrderError] = useState<OrderErrorKind | "storage" | null>(null);
  const [pending, setPending] = useState<PendingOrder | null>(() => readPending(pendingStorageKey(cafeSlug, tableCode)));
  const [sending, setSending] = useState(false);
  const [retryAt, setRetryAt] = useState<number | undefined>();
  const [now, setNow] = useState(Date.now());
  const [receipt, setReceipt] = useState<OrderReceipt | null>(null);
  const [priceNotice, setPriceNotice] = useState(false);
  const sendingRef = useRef(false);
  const lastTriggerRef = useRef<HTMLButtonElement>(null);
  const storageKey = cartStorageKey(cafeSlug, tableCode);
  const pendingKey = pendingStorageKey(cafeSlug, tableCode);
  const closeCart = useCallback(() => setCartOpen(false), []);

  useEffect(() => {
    setPending(readPending(pendingKey));
    setOrderError(null);
    setReceipt(null);
    setRetryAt(undefined);
    setPriceNotice(false);
    sendingRef.current = false;
    setSending(false);
  }, [pendingKey]);

  useEffect(() => {
    if (!retryAt || retryAt <= Date.now()) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [retryAt]);

  useEffect(() => {
    const controller = new AbortController();
    setView({ status: "loading" });
    setSelectedCategory(null);
    if (attempt === 0) setCartOpen(false);
    setCart([]);
    setRemovedNotice(false);
    fetchGuestMenu(cafeSlug, tableCode, controller.signal).then(
      (data) => {
        if (controller.signal.aborted) return;
        const existingPending = readPending(pendingKey);
        if (existingPending) {
          setPending(existingPending);
          setCart(existingPending.items.map((item) => ({ id: item.dishId, quantity: item.quantity })));
        } else {
          const reconciled = reconcileCart(readCart(storageKey), data);
          writeCart(storageKey, reconciled.items);
          setCart(reconciled.items);
          setRemovedNotice(reconciled.removed);
        }
        setView({ status: "ready", data });
      },
      (error: unknown) => {
        if (controller.signal.aborted) return;
        setView({ status: "error", kind: error instanceof MenuRequestError ? error.kind : "connection" });
      },
    );
    return () => controller.abort();
  }, [cafeSlug, tableCode, storageKey, pendingKey, attempt]);

  const data = view.status === "ready" ? view.data : null;
  const categories = data?.categories ?? [];
  const visibleCategories = selectedCategory === null
    ? categories
    : categories.filter((category) => category.id === selectedCategory);
  const hasDishes = categories.some((category) => category.dishes.length > 0);
  const price = new Intl.NumberFormat("ru-RU");
  const lines = data ? cartLines(cart, data) : [];
  const totalCount = lines.reduce((sum, line) => sum + line.quantity, 0);
  const totalPrice = lines.reduce((sum, line) => sum + line.total, 0n);
  const locked = pending !== null || sending;
  const retrySeconds = retryAt ? Math.max(0, Math.ceil((retryAt - now) / 1000)) : 0;

  async function sendOrder() {
    if (sendingRef.current || view.status !== "ready") return;
    let current = readPending(pendingKey) ?? pending;
    if (!current) {
      if (!lines.length || lines.length > 50 || totalPrice > BigInt(Number.MAX_SAFE_INTEGER)) {
        setOrderError("bad_request"); return;
      }
      current = { requestId: crypto.randomUUID(), items: lines.map((line) => ({ dishId: line.dish.id, quantity: line.quantity })), expectedTotalSom: Number(totalPrice) };
      if (!savePending(pendingKey, current)) { setOrderError("storage"); return; }
      setPending(current);
    }
    if (retryAt && retryAt > Date.now()) return;
    sendingRef.current = true;
    setSending(true);
    setOrderError(null);
    try {
      const result = await submitOrder(cafeSlug, tableCode, current);
      // A confirmed response is the only point at which the cart can be cleared.
      if (clearPending(pendingKey)) {
        writeCart(storageKey, []);
        setPending(null);
        setCart([]);
      }
      setReceipt(result);
      setRetryAt(undefined);
    } catch (error) {
      const kind = error instanceof OrderRequestError ? error.kind : "network";
      if (kind === "price_changed" || kind === "conflict" || kind === "bad_request" || kind === "not_found") {
        if (clearPending(pendingKey)) setPending(null);
        if (kind === "price_changed" || kind === "conflict") {
          setPriceNotice(kind === "price_changed");
          setAttempt((value) => value + 1);
        }
      }
      setOrderError(kind);
      setRetryAt(error instanceof OrderRequestError ? error.retryAt : undefined);
      setNow(Date.now());
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  }

  function updateCart(id: string, change: number) {
    if (locked) return;
    const next = changeQuantity(cart, id, change);
    if (next !== cart) setReceipt(null);
    setCart(next);
    writeCart(storageKey, next);
  }

  function clearCart() {
    if (locked || receipt) return;
    setCart([]);
    writeCart(storageKey, []);
  }

  function openCart(event: React.MouseEvent<HTMLButtonElement>) {
    lastTriggerRef.current = event.currentTarget;
    setCartOpen(true);
  }

  return (
    <div className={`guest-page${data ? " guest-page--cart" : ""}`}>
      <a className="skip-link" href="#guest-main">Перейти к меню</a>
      <header className="guest-header">
        <div className="guest-container guest-header-inner">
          <a className="guest-brand" href="/" aria-label="MenuGo — на главную">
            <img src="/brand/menugo-symbol.svg" alt="" aria-hidden="true" />
            <span>MenuGo</span>
          </a>
          <span className="guest-header-note">МЕНЮ КАФЕ</span>
        </div>
      </header>

      <main className="guest-container guest-main" id="guest-main">
        {data ? (
          <div className="guest-intro">
            <p className="guest-kicker">МЕНЮ ДЛЯ ВАШЕГО СТОЛА</p>
            <div className="guest-intro-row">
              <h1>{data.cafe.name}</h1>
              <span className="guest-table">{data.table.name}</span>
            </div>
            <p>Выбирайте блюда и знакомьтесь с меню в удобном темпе.</p>
          </div>
        ) : (
          <div className="guest-intro">
            <p className="guest-kicker">MENUGO</p>
            <h1>Меню кафе</h1>
          </div>
        )}

        {view.status === "loading" && (
          <div className="guest-state" role="status" aria-live="polite">
            <span className="guest-loader" aria-hidden="true" />
            <h2>Загружаем меню</h2>
            <p>Подождите немного.</p>
          </div>
        )}
        {view.status === "error" && (
          <div className="guest-state" role="alert">
            <span className="guest-state-line" aria-hidden="true" />
            <h2>{errorCopy[view.kind].title}</h2>
            <p>{errorCopy[view.kind].detail}</p>
            {view.kind !== "not_found" && (
              <button className="guest-retry" type="button" onClick={() => setAttempt((value) => value + 1)}>
                Повторить <span aria-hidden="true">↗</span>
              </button>
            )}
          </div>
        )}
        {data && removedNotice && <p className="cart-notice" role="status">Некоторые блюда больше не доступны и удалены из корзины.</p>}
        {data && priceNotice && <p className="cart-notice" role="status">Цены в меню изменились. Проверьте новую сумму и отправьте заказ ещё раз.</p>}
        {data && !hasDishes && (
          <div className="guest-state" role="status">
            <span className="guest-state-line" aria-hidden="true" />
            <h2>Меню пока пусто</h2>
            <p>Блюда ещё не добавлены. Загляните позже.</p>
          </div>
        )}
        {data && hasDishes && (
          <>
            <div className="guest-cart-desktop"><button type="button" onClick={openCart}>Корзина <span>{totalCount} · {price.format(totalPrice)} сом</span></button></div>
            <nav className="guest-filters" aria-label="Категории меню">
              <button type="button" className={selectedCategory === null ? "active" : ""} aria-pressed={selectedCategory === null} onClick={() => setSelectedCategory(null)}>Всё меню</button>
              {categories.map((category) => (
                <button key={category.id} type="button" className={selectedCategory === category.id ? "active" : ""} aria-pressed={selectedCategory === category.id} onClick={() => setSelectedCategory(category.id)}>{category.name}</button>
              ))}
            </nav>
            <div className="guest-sections">
              {visibleCategories.map((category, index) => (
                <section className="guest-section" key={category.id} aria-labelledby={`category-${category.id}`}>
                  <div className="guest-section-heading"><span>{String(index + 1).padStart(2, "0")}</span><h2 id={`category-${category.id}`}>{category.name}</h2><span>{dishCountLabel(category.dishes.length)}</span></div>
                  {category.dishes.length ? (
                    <div className="guest-dishes">
                      {category.dishes.map((dish) => (
                        <article className="guest-dish" key={dish.id}>
                          <div><h3>{dish.name}</h3>{dish.description && <p>{dish.description}</p>}</div>
                          <div className="guest-dish-actions"><strong>{price.format(dish.priceSom)} сом</strong>{cart.find((item) => item.id === dish.id) ? (
                            <div className="cart-stepper"><button type="button" onClick={() => updateCart(dish.id, -1)} disabled={locked} aria-label={`Уменьшить количество: ${dish.name}`}>−</button><span>{cart.find((item) => item.id === dish.id)?.quantity}</span><button type="button" onClick={() => updateCart(dish.id, 1)} disabled={locked || cart.find((item) => item.id === dish.id)?.quantity === 99} aria-label={`Увеличить количество: ${dish.name}`}>+</button></div>
                          ) : <button className="guest-add" type="button" disabled={locked} onClick={() => updateCart(dish.id, 1)}>Добавить</button>}</div>
                        </article>
                      ))}
                    </div>
                  ) : <p className="guest-category-empty">В этой категории пока нет блюд.</p>}
                </section>
              ))}
            </div>
          </>
        )}
      </main>
      {data && <button type="button" className="guest-cart-bar" onClick={openCart}><span>Корзина · {totalCount} шт.</span><strong>{price.format(totalPrice)} сом</strong></button>}
      {data && cartOpen && <CartDialog lines={lines} total={totalPrice} onClose={closeCart} onChange={updateCart} onClear={clearCart} onSubmit={sendOrder} pending={pending !== null} sending={sending} retrySeconds={retrySeconds} orderError={orderError} receipt={receipt} returnFocus={lastTriggerRef} />}
      <footer className="guest-footer guest-container"><span>MenuGo</span><p>Меню и отправка заказа · Оплата пока недоступна</p></footer>
    </div>
  );
}
