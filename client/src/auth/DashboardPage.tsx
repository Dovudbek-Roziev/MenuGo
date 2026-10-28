import { useState } from "react";
import { AuthApiError } from "./api";
import { checkSession, signOut, type AuthState } from "./state";
import MenuManager from "./MenuManager";
import OrdersPanel from "./OrdersPanel";

interface DashboardPageProps { state: Extract<AuthState, { status: "authenticated" }>; navigate: (path: string, replace?: boolean) => void }

export default function DashboardPage({ state, navigate }: DashboardPageProps) {
  const [loggingOut, setLoggingOut] = useState(false);
  const [error, setError] = useState("");
  const [section, setSection] = useState<"orders" | "menu">("orders");
  const [menuVisited, setMenuVisited] = useState(false);
  const { identity } = state;

  async function handleLogout() {
    if (loggingOut) return;
    setLoggingOut(true);
    setError("");
    try {
      await signOut();
      navigate("/login", true);
    } catch (cause) {
      if (cause instanceof AuthApiError && cause.status === 401) setError("Сессия завершилась. Обновите страницу и войдите снова.");
      else if (cause instanceof AuthApiError && cause.status === 503) setError("Не удалось завершить сеанс: сервис временно недоступен.");
      else if (cause instanceof AuthApiError && cause.status === 0) setError("Нет связи с сервером. Вы остались в кабинете; попробуйте выйти ещё раз.");
      else setError("Не удалось завершить сеанс. Вы остались в кабинете; попробуйте ещё раз.");
    } finally {
      setLoggingOut(false);
    }
  }

  return (
    <main className="auth-page dashboard-page">
      <header className="dashboard-nav">
        <a className="auth-logo" href="/" onClick={(event) => { event.preventDefault(); navigate("/"); }} aria-label="MenuGo — на главную">
          <img src="/brand/menugo.jpg" alt="" width="44" height="44" />
          <span>MenuGo<span aria-hidden="true">.</span></span>
        </a>
        <button className="dashboard-logout" type="button" onClick={() => void handleLogout()} disabled={loggingOut}>
          {loggingOut ? "Выходим…" : "Выйти"}
        </button>
      </header>
      <section className="dashboard-welcome" aria-labelledby="dashboard-title">
        <p className="auth-eyebrow">КАБИНЕТ КАФЕ</p>
        <h1 id="dashboard-title">Здравствуйте, {identity.user.name}</h1>
        <p className="dashboard-lead">{identity.user.role === "owner"
          ? "Здесь вы видите заказы и управляете меню кафе."
          : "Здесь вы видите заказы и меняете их статусы."}</p>
        <div className="dashboard-profile">
          <div className="profile-mark" aria-hidden="true">{identity.cafe.name.slice(0, 1).toLocaleUpperCase("ru-RU")}</div>
          <div className="profile-copy">
            <span>Ваше кафе</span>
            <h2>{identity.cafe.name}</h2>
          </div>
          <span className="role-badge">{identity.user.role === "owner" ? "Владелец" : "Сотрудник"}</span>
        </div>
        {identity.user.role === "owner" && <nav className="dashboard-sections" aria-label="Разделы кабинета">
          <button type="button" aria-pressed={section === "orders"} className={section === "orders" ? "is-current" : ""}
            onClick={() => setSection("orders")}>Заказы</button>
          <button type="button" aria-pressed={section === "menu"} className={section === "menu" ? "is-current" : ""}
            onClick={() => { setMenuVisited(true); setSection("menu"); }}>Меню</button>
        </nav>}
        <div hidden={identity.user.role === "owner" && section !== "orders"}>
          <OrdersPanel active={identity.user.role === "staff" || section === "orders"} />
        </div>
        {identity.user.role === "owner" && <div hidden={section !== "menu"}>
          {menuVisited && <MenuManager />}
        </div>}
        {state.recheckError && (
          <div className="dashboard-error" role="status">
            <p>{state.recheckError}</p>
            <button className="auth-text-button" type="button" onClick={() => void checkSession(true)}>Повторить проверку</button>
          </div>
        )}
        {error && <p className="dashboard-error" role="alert">{error}</p>}
      </section>
      <footer className="dashboard-footer"><span>MenuGo</span><span>Цифровое меню для гостеприимного сервиса</span></footer>
    </main>
  );
}
