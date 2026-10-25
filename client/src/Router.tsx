import { useEffect, useState, useSyncExternalStore } from "react";
import App from "./App";
import GuestMenu from "./menu/GuestMenu";
import LoginPage from "./auth/LoginPage";
import DashboardPage from "./auth/DashboardPage";
import { checkSession, getAuthState, subscribeAuth } from "./auth/state";

function currentPath() { return window.location.pathname; }

export function navigate(path: string, replace = false): void {
  if (!path.startsWith("/") || path.startsWith("//")) return;
  if (replace) window.history.replaceState(null, "", path);
  else window.history.pushState(null, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

function LoadingPage() {
  return <main className="auth-loading" role="status" aria-live="polite"><span className="auth-loading-dot" />Проверяем доступ к кабинету…</main>;
}

export default function Router() {
  const [path, setPath] = useState(currentPath);
  const auth = useSyncExternalStore(subscribeAuth, getAuthState, getAuthState);

  useEffect(() => {
    const onPopState = () => setPath(currentPath());
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    if (path === "/login" || path === "/dashboard") void checkSession();
  }, [path]);

  useEffect(() => {
    if (path === "/dashboard" && auth.status === "unauthenticated") navigate("/login", true);
    if (path === "/login" && auth.status === "authenticated") navigate("/dashboard", true);
  }, [path, auth.status]);

  useEffect(() => {
    if (path !== "/dashboard" || auth.status !== "authenticated") return;
    const recheck = () => {
      if (document.visibilityState === "visible") void checkSession(true);
    };
    const interval = window.setInterval(recheck, 5 * 60 * 1000);
    window.addEventListener("focus", recheck);
    document.addEventListener("visibilitychange", recheck);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", recheck);
      document.removeEventListener("visibilitychange", recheck);
    };
  }, [path, auth.status]);

  const menuMatch = /^\/menu\/([^/]+)\/([^/]+)\/?$/.exec(path);
  if (menuMatch) {
    try {
      const cafeSlug = decodeURIComponent(menuMatch[1]!);
      const tableCode = decodeURIComponent(menuMatch[2]!);
      return <GuestMenu key={`${cafeSlug}/${tableCode}`} cafeSlug={cafeSlug} tableCode={tableCode} />;
    } catch { /* Invalid URL encoding is treated as an unknown page. */ }
  }
  if (path === "/" || path === "") return <App />;
  if (path === "/login") {
    if (auth.status === "checking" || auth.status === "authenticated") return <LoadingPage />;
    return <LoginPage state={auth} navigate={navigate} />;
  }
  if (path === "/dashboard") {
    if (auth.status === "checking") return <LoadingPage />;
    if (auth.status === "authenticated") return <DashboardPage state={auth} navigate={navigate} />;
    if (auth.status === "unavailable") {
      return (
        <main className="auth-loading auth-loading-error" role="alert">
          <p>{auth.message}</p>
          <button type="button" onClick={() => void checkSession(true)}>Повторить проверку</button>
          <a href="/login" onClick={(event) => { event.preventDefault(); navigate("/login", true); }}>На страницу входа</a>
        </main>
      );
    }
    return <LoadingPage />;
  }
  return <main className="auth-loading auth-loading-error"><h1>Страница не найдена</h1><a href="/" onClick={(event) => { event.preventDefault(); navigate("/"); }}>На главную</a></main>;
}
