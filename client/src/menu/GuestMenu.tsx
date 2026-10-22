import { useEffect, useState } from "react";
import { fetchGuestMenu } from "./api";
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

  useEffect(() => {
    const controller = new AbortController();
    setView({ status: "loading" });
    setSelectedCategory(null);
    fetchGuestMenu(cafeSlug, tableCode, controller.signal).then(
      (data) => { if (!controller.signal.aborted) setView({ status: "ready", data }); },
      (error: unknown) => {
        if (controller.signal.aborted) return;
        setView({ status: "error", kind: error instanceof MenuRequestError ? error.kind : "connection" });
      },
    );
    return () => controller.abort();
  }, [cafeSlug, tableCode, attempt]);

  const data = view.status === "ready" ? view.data : null;
  const categories = data?.categories ?? [];
  const visibleCategories = selectedCategory === null
    ? categories
    : categories.filter((category) => category.id === selectedCategory);
  const hasDishes = categories.some((category) => category.dishes.length > 0);
  const price = new Intl.NumberFormat("ru-RU");

  return (
    <div className="guest-page">
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
        {data && !hasDishes && (
          <div className="guest-state" role="status">
            <span className="guest-state-line" aria-hidden="true" />
            <h2>Меню пока пусто</h2>
            <p>Блюда ещё не добавлены. Загляните позже.</p>
          </div>
        )}
        {data && hasDishes && (
          <>
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
                          <strong>{price.format(dish.priceSom)} сом</strong>
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
      <footer className="guest-footer guest-container"><span>MenuGo</span><p>Просмотр меню · Оформление заказа пока недоступно</p></footer>
    </div>
  );
}
