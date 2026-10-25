import { useState } from "react";
import { AuthApiError } from "./api";
import { signOut, type AuthState } from "./state";
import MenuManager from "./MenuManager";

interface DashboardPageProps { state: Extract<AuthState, { status: "authenticated" }>; navigate: (path: string, replace?: boolean) => void }

export default function DashboardPage({ state, navigate }: DashboardPageProps) {
  const [loggingOut, setLoggingOut] = useState(false);
  const [error, setError] = useState("");
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
        <p className="dashboard-lead">Здесь будет рабочее пространство вашей команды.</p>
        <div className="dashboard-profile">
          <div className="profile-mark" aria-hidden="true">{identity.cafe.name.slice(0, 1).toLocaleUpperCase("ru-RU")}</div>
          <div className="profile-copy">
            <span>Ваше кафе</span>
            <h2>{identity.cafe.name}</h2>
          </div>
          <span className="role-badge">{identity.user.role === "owner" ? "Владелец" : "Сотрудник"}</span>
        </div>
        {identity.user.role === "owner" ? <MenuManager /> : (
          <div className="dashboard-placeholder">
            <span className="placeholder-icon" aria-hidden="true">✳</span>
            <div>
              <h2>Рабочее пространство готовится</h2>
              <p>Панель заказов появится в следующих версиях MenuGo.</p>
            </div>
          </div>
        )}
        {error && <p className="dashboard-error" role="alert">{error}</p>}
      </section>
      <footer className="dashboard-footer"><span>MenuGo</span><span>Цифровое меню для гостеприимного сервиса</span></footer>
    </main>
  );
}
