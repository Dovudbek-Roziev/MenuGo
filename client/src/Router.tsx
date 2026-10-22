import { useEffect, useState } from "react";
import App from "./App";
import GuestMenu from "./menu/GuestMenu";

function currentPath() { return window.location.pathname; }

export default function Router() {
  const [path, setPath] = useState(currentPath);
  useEffect(() => {
    const onPopState = () => setPath(currentPath());
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const match = /^\/menu\/([^/]+)\/([^/]+)\/?$/.exec(path);
  if (match) {
    try {
      const cafeSlug = decodeURIComponent(match[1]!);
      const tableCode = decodeURIComponent(match[2]!);
      return <GuestMenu key={`${cafeSlug}/${tableCode}`} cafeSlug={cafeSlug} tableCode={tableCode} />;
    } catch { /* Invalid URL encoding is treated as an unknown page. */ }
  }
  if (path === "/" || path === "") return <App />;
  return <main className="guest-page" style={{ minHeight: "100vh", padding: "12vh 8vw" }}><h1>Страница не найдена</h1><p><a href="/">На главную</a></p></main>;
}
