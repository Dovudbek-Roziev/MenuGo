import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { AuthApiError } from "./api";
import { refreshCsrf } from "./state";
import { OrderReadGate } from "./orderReadGate";
import {
  changeOrderStatus, fetchOrders, nextStatus, orderStatuses, OrdersApiError, statusNames,
  type ManagedOrder, type OrderFilter, type OrderStatus, type OrdersPage,
} from "./manageOrdersApi";

const som = new Intl.NumberFormat("ru-RU");
const dateTime = new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium", timeStyle: "short" });
const actionNames: Record<"preparing" | "ready" | "completed", string> = {
  preparing: "Начать готовить", ready: "Отметить готовым", completed: "Завершить заказ",
};

function errorCopy(error: unknown): string {
  if (error instanceof OrdersApiError || error instanceof AuthApiError) {
    if (error.code === "CSRF_INVALID") return "Защитный токен устарел. Обновите защиту и повторите действие.";
    if (error.code === "ORIGIN_FORBIDDEN") return "Источник запроса не разрешён. Проверьте адрес сайта.";
    if (error.status === 403) return "Недостаточно прав для этого действия.";
    return error.message;
  }
  return "Не удалось получить ответ сервера. Повторите попытку.";
}

function CancelDialog({ order, onClose, onConfirm, returnFocus }: {
  order: ManagedOrder;
  onClose: () => void;
  onConfirm: () => void;
  returnFocus: RefObject<HTMLButtonElement | null>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    cancel.current?.focus();
    return () => { if (element?.open) element.close(); returnFocus.current?.focus(); };
  }, [returnFocus]);
  return (
    <dialog ref={dialog} className="orders-confirm" aria-modal="true" aria-labelledby="orders-confirm-title"
      onCancel={(event) => { event.preventDefault(); onClose(); }}>
      <h3 id="orders-confirm-title">Отменить заказ?</h3>
      <p>{order.table.name} · заказ от {dateTime.format(new Date(order.createdAt))}</p>
      <p>Это действие нельзя отменить. Статус изменится на «Отменён».</p>
      <div className="orders-confirm-actions">
        <button ref={cancel} type="button" className="orders-button orders-button--light" onClick={onClose}>Оставить заказ</button>
        <button type="button" className="orders-button orders-button--danger" onClick={onConfirm}>Да, отменить заказ</button>
      </div>
    </dialog>
  );
}

export default function OrdersPanel({ active }: { active: boolean }) {
  const [filter, setFilter] = useState<OrderFilter>("all");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<OrdersPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [readError, setReadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<{ text: string; csrf?: boolean; uncertain?: boolean } | null>(null);
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const [needsCheck, setNeedsCheck] = useState(false);
  const [busyOrder, setBusyOrder] = useState<string | null>(null);
  const [confirmOrder, setConfirmOrder] = useState<ManagedOrder | null>(null);
  const activeRef = useRef(active);
  const busyRef = useRef(false);
  const confirmRef = useRef(false);
  const readGate = useRef(new OrderReadGate());
  const requestRef = useRef<AbortController | null>(null);
  const deferred = useRef<{ serial: number; page: OrdersPage } | null>(null);
  const refreshRef = useRef<HTMLButtonElement>(null);
  const cancelTrigger = useRef<HTMLButtonElement>(null);
  const queryKey = useRef(`${filter}:${page}`);
  queryKey.current = `${filter}:${page}`;
  activeRef.current = active;
  confirmRef.current = confirmOrder !== null;

  const applyPage = useCallback((result: OrdersPage, read: number) => {
    if (!readGate.current.confirm(read)) return;
    setData(result);
    setReadError(null);
    setNeedsCheck(false);
    setActionError((current) => current?.uncertain ? null : current);
    if (result.pagination.totalPages > 0 && result.pagination.page > result.pagination.totalPages) {
      setPage(result.pagination.totalPages);
    }
  }, []);

  const load = useCallback(async (mode: "initial" | "manual" | "poll" = "manual") => {
    if (!activeRef.current || (mode === "poll" && document.visibilityState !== "visible")) return;
    const current = readGate.current.beginRead();
    requestRef.current?.abort();
    deferred.current = null;
    const controller = new AbortController();
    requestRef.current = controller;
    if (mode === "initial") setLoading(true);
    if (mode === "manual") setRefreshing(true);
    try {
      const result = await fetchOrders(filter, page, controller.signal);
      if (controller.signal.aborted || !readGate.current.mayApply(current) || !activeRef.current) return;
      const focusedCard = (document.activeElement as Element | null)?.closest?.(".orders-card");
      if (mode === "poll" && (confirmRef.current || busyRef.current || focusedCard)) {
        deferred.current = { serial: current, page: result };
      } else {
        applyPage(result, current);
      }
    } catch (error) {
      if (controller.signal.aborted || !readGate.current.mayApply(current) || !activeRef.current) return;
      setReadError(errorCopy(error));
      setNeedsCheck(true);
    } finally {
      if (readGate.current.isCurrent(current)) {
        requestRef.current = null;
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [filter, page, applyPage]);
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    if (!active) {
      activeRef.current = false;
      readGate.current.invalidate();
      requestRef.current?.abort();
      deferred.current = null;
      return;
    }
    activeRef.current = true;
    void load("initial");
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") void load("poll"); }, 15_000);
    const visibility = () => {
      if (document.visibilityState === "hidden") { readGate.current.invalidate(); requestRef.current?.abort(); deferred.current = null; }
      else void load("poll");
    };
    document.addEventListener("visibilitychange", visibility);
    return () => {
      activeRef.current = false;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", visibility);
      readGate.current.invalidate();
      requestRef.current?.abort();
      deferred.current = null;
    };
  }, [active, load]);

  function changeQuery(nextFilter: OrderFilter, nextPage: number) {
    queryKey.current = `${nextFilter}:${nextPage}`;
    readGate.current.invalidate();
    requestRef.current?.abort();
    deferred.current = null;
    setData(null);
    setReadError(null);
    setActionError(null);
    setActionNotice(null);
    if (!readGate.current.verificationRequired) setNeedsCheck(false);
    setFilter(nextFilter);
    setPage(nextPage);
  }

  function flushDeferred() {
    window.setTimeout(() => {
      if (!activeRef.current || confirmRef.current || busyRef.current ||
          (document.activeElement as Element | null)?.closest?.(".orders-card")) return;
      const pending = deferred.current;
      if (pending && readGate.current.mayApply(pending.serial)) {
        deferred.current = null;
        applyPage(pending.page, pending.serial);
      }
    }, 0);
  }

  async function update(order: ManagedOrder, next: OrderStatus) {
    if (busyRef.current || needsCheck || readGate.current.verificationRequired) return;
    const actionQuery = queryKey.current;
    busyRef.current = true;
    readGate.current.invalidate();
    requestRef.current?.abort();
    deferred.current = null;
    setBusyOrder(order.id);
    setActionError(null);
    setActionNotice(null);
    try {
      const updated = await changeOrderStatus(order, next);
      if (!activeRef.current) return;
      refreshRef.current?.focus();
      if (queryKey.current === actionQuery) {
        setData((current) => current && ({ ...current,
          orders: current.orders.map((item) => item.id === updated.id ? updated : item),
        }));
      }
      setActionNotice(`Статус заказа изменён: «${statusNames[updated.status]}».`);
      void loadRef.current("manual");
    } catch (error) {
      if (!activeRef.current) return;
      if (error instanceof OrdersApiError && error.status === 409) {
        readGate.current.requireVerification();
        requestRef.current?.abort();
        deferred.current = null;
        setRefreshing(false);
        setNeedsCheck(true);
        setActionError({ text: "Заказ уже изменён другим сотрудником. Список обновляется." });
        refreshRef.current?.focus();
        void loadRef.current("manual");
      } else if (error instanceof OrdersApiError && (error.code === "NETWORK" || error.code === "UNAVAILABLE")) {
        readGate.current.requireVerification();
        requestRef.current?.abort();
        deferred.current = null;
        setRefreshing(false);
        setNeedsCheck(true);
        setActionError({ uncertain: true, text: error.code === "UNAVAILABLE"
          ? "Сервис заказов временно недоступен. Результат изменения не подтверждён. Проверьте статус перед следующим действием."
          : "Результат изменения неизвестен. Проверьте статус заказа перед следующим действием." });
      } else {
        setActionError({ text: errorCopy(error), csrf: error instanceof OrdersApiError && error.code === "CSRF_INVALID" ||
          error instanceof AuthApiError && error.code === "CSRF_INVALID" });
      }
    } finally {
      busyRef.current = false;
      setBusyOrder(null);
    }
  }

  async function renewCsrf() {
    try {
      await refreshCsrf();
      setActionError(null);
      setActionNotice("Защита обновлена. Повторите действие.");
    } catch (error) { setActionError({ text: errorCopy(error), csrf: true }); }
  }

  return (
    <section className="orders-panel" aria-labelledby="orders-title" onBlurCapture={flushDeferred}>
      <div className="orders-heading">
        <div><p className="auth-eyebrow">РАБОЧЕЕ ПРОСТРАНСТВО</p><h2 id="orders-title">Заказы</h2>
          <p>Новые заказы и их статусы обновляются каждые 15 секунд, пока открыта эта вкладка.</p></div>
        <button ref={refreshRef} className="orders-button orders-button--light" type="button"
          onClick={() => void load("manual")} disabled={refreshing}>{refreshing ? "Обновляем…" : "Обновить"}</button>
      </div>

      <div className="orders-toolbar">
        <label htmlFor="orders-filter">Статус заказа</label>
        <select id="orders-filter" value={filter} disabled={busyOrder !== null}
          onChange={(event) => changeQuery(event.target.value as OrderFilter, 1)}>
          <option value="all">Все статусы</option>
          {orderStatuses.map((status) => <option key={status} value={status}>{statusNames[status]}</option>)}
        </select>
        {data && <span className="orders-count">Всего: {data.pagination.total}</span>}
      </div>

      {actionError && <div className="orders-message orders-message--error" role="alert"><p>{actionError.text}</p>
        {actionError.csrf && <button type="button" className="orders-text-button" onClick={() => void renewCsrf()}>Обновить защиту</button>}
        {needsCheck && <button type="button" className="orders-text-button" onClick={() => void load("manual")}>Проверить статус</button>}
      </div>}
      {actionNotice && <p className="orders-message orders-message--success" role="status">{actionNotice}</p>}
      {readError && <div className="orders-message orders-message--error" role="alert"><p>{readError}</p>
        <button type="button" className="orders-text-button" onClick={() => void load("manual")}>Повторить загрузку</button>
      </div>}

      {loading && !data && !readError && <div className="orders-state" role="status">Загружаем заказы…</div>}
      {data && data.orders.length === 0 && !readError && <div className="orders-state" role="status">Заказов с выбранным статусом пока нет.</div>}
      {data && data.orders.length > 0 && <div className="orders-list">
        {data.orders.map((order) => {
          const next = nextStatus[order.status];
          const canCancel = order.status === "new" || order.status === "preparing" || order.status === "ready";
          const disabled = needsCheck || busyOrder !== null;
          return <article key={order.id} className="orders-card">
            <div className="orders-card-head">
              <div><h3>{order.table.name}</h3><p><time dateTime={order.createdAt}>{dateTime.format(new Date(order.createdAt))}</time></p></div>
              <span className={`orders-status orders-status--${order.status}`}>{statusNames[order.status]}</span>
            </div>
            <ul className="orders-items">{order.items.map((item) => <li key={item.dishId}>
              <span>{item.name} <small>× {item.quantity}</small></span>
              <span>{som.format(item.priceSom)} сом / шт. · <strong>{som.format(item.lineTotalSom)} сом</strong></span>
            </li>)}</ul>
            <div className="orders-card-footer"><p>Итого <strong>{som.format(order.totalSom)} сом</strong></p>
              {(next || canCancel) && <div className="orders-actions">
                {next && <button type="button" className="orders-button orders-button--primary" disabled={disabled}
                  onClick={() => void update(order, next)}>{busyOrder === order.id ? "Сохраняем…" : actionNames[next]}</button>}
                {canCancel && <button type="button" className="orders-button orders-button--light" disabled={disabled}
                  onClick={(event) => { cancelTrigger.current = event.currentTarget; setConfirmOrder(order); }}>Отменить заказ</button>}
              </div>}
            </div>
          </article>;
        })}
      </div>}

      {data && data.pagination.totalPages > 1 && <nav className="orders-pagination" aria-label="Страницы заказов">
        <button type="button" className="orders-button orders-button--light" disabled={page <= 1 || busyOrder !== null}
          onClick={() => changeQuery(filter, page - 1)}>Назад</button>
        <span>Страница {page} из {data.pagination.totalPages}</span>
        <button type="button" className="orders-button orders-button--light" disabled={page >= data.pagination.totalPages || page >= 10_000 || busyOrder !== null}
          onClick={() => changeQuery(filter, page + 1)}>Далее</button>
      </nav>}
      {confirmOrder && <CancelDialog order={confirmOrder} returnFocus={cancelTrigger}
        onClose={() => setConfirmOrder(null)}
        onConfirm={() => { const order = confirmOrder; setConfirmOrder(null); void update(order, "cancelled"); }} />}
    </section>
  );
}
