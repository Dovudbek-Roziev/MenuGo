import { useEffect, useState, type FormEvent } from "react";
import { AuthApiError } from "./api";
import { checkSession, refreshCsrf, signIn, type AuthState } from "./state";

interface LoginPageProps { state: AuthState; navigate: (path: string, replace?: boolean) => void }

export default function LoginPage({ state, navigate }: LoginPageProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [errorCode, setErrorCode] = useState<AuthApiError["code"] | undefined>();
  const [retryAt, setRetryAt] = useState(0);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [csrfRefreshed, setCsrfRefreshed] = useState(false);

  useEffect(() => {
    if (!retryAt) return;
    const update = () => setSecondsLeft(Math.max(0, Math.ceil((retryAt - Date.now()) / 1000)));
    update();
    const timer = window.setInterval(update, 500);
    return () => window.clearInterval(timer);
  }, [retryAt]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting || secondsLeft > 0) return;
    setSubmitting(true);
    setError("");
    setErrorCode(undefined);
    setCsrfRefreshed(false);
    setRetryAt(0);
    try {
      await signIn(email, password);
      setPassword("");
      navigate("/dashboard", true);
    } catch (cause) {
      const apiError = cause instanceof AuthApiError ? cause : undefined;
      setErrorCode(apiError?.code);
      if (apiError?.status === 401) setError("Неверный email или пароль.");
      else if (apiError?.code === "CSRF_INVALID") setError("Защитный токен устарел. Обновите его и повторите вход.");
      else if (apiError?.code === "ORIGIN_FORBIDDEN") setError("Запрос отклонён: источник не разрешён. Обратитесь к администратору сервиса.");
      else if (apiError?.status === 429) {
        setError("Слишком много попыток входа. Подождите перед новой попыткой.");
        if (apiError.retryAfterSeconds) setRetryAt(Date.now() + apiError.retryAfterSeconds * 1000);
      } else if (apiError?.status === 503) setError("Сервис временно недоступен. Попробуйте ещё раз позже.");
      else if (apiError?.status === 0) setError("Не удалось связаться с сервером. Проверьте подключение и повторите попытку.");
      else setError("Не удалось выполнить вход. Проверьте данные и попробуйте снова.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCsrfRefresh() {
    setSubmitting(true);
    setError("");
    try {
      await refreshCsrf();
      setCsrfRefreshed(true);
    } catch {
      setError("Не удалось обновить защиту запроса. Проверьте подключение и попробуйте ещё раз.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="auth-page">
      <a className="auth-back" href="/" onClick={(event) => { event.preventDefault(); navigate("/"); }}>← На главную</a>
      <section className="auth-card" aria-labelledby="login-title">
        <a className="auth-logo" href="/" onClick={(event) => { event.preventDefault(); navigate("/"); }} aria-label="MenuGo — на главную">
          <img src="/brand/menugo.jpg" alt="" width="58" height="58" />
          <span>MenuGo<span aria-hidden="true">.</span></span>
        </a>
        <p className="auth-eyebrow">КАБИНЕТ КАФЕ</p>
        <h1 id="login-title">Вход в кабинет</h1>
        <p className="auth-intro">Управление MenuGo начинается с безопасного входа.</p>

        {state.status === "unavailable" && (
          <div className="auth-notice" role="status">
            <p>{state.message}</p>
            <button type="button" className="auth-text-button" onClick={() => void checkSession(true)}>Проверить соединение</button>
          </div>
        )}
        {error && (
          <div className="auth-error" role="alert">
            <p>{error}{secondsLeft > 0 ? ` Повторите через ${secondsLeft} сек.` : ""}</p>
            {errorCode === "CSRF_INVALID" && (
              <button type="button" className="auth-text-button" onClick={() => void handleCsrfRefresh()} disabled={submitting}>
                Обновить защиту
              </button>
            )}
          </div>
        )}
        {csrfRefreshed && <p className="auth-success" role="status">Защита обновлена. Теперь можно повторить вход.</p>}

        <form className="auth-form" onSubmit={(event) => void handleSubmit(event)}>
          <label htmlFor="login-email">Email</label>
          <input
            id="login-email"
            name="email"
            type="email"
            autoComplete="username"
            inputMode="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            maxLength={254}
            required
            disabled={submitting}
          />

          <label htmlFor="login-password">Пароль</label>
          <div className="password-field">
            <input
              id="login-password"
              name="password"
              type={showPassword ? "text" : "password"}
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              minLength={12}
              maxLength={128}
              required
              disabled={submitting}
            />
            <button type="button" onClick={() => setShowPassword((visible) => !visible)} aria-pressed={showPassword} disabled={submitting}>
              {showPassword ? "Скрыть" : "Показать"}
            </button>
          </div>

          <button className="auth-submit" type="submit" disabled={submitting || secondsLeft > 0}>
            {submitting ? "Выполняется вход…" : secondsLeft > 0 ? `Подождите ${secondsLeft} сек.` : "Войти"}
          </button>
        </form>
        <p className="auth-footnote">Доступ выдаётся владельцем сервиса. Открытой регистрации нет.</p>
      </section>
    </main>
  );
}
