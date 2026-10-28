export function buildTableMenuUrl(cafeSlug: string, tableCode: string, origin = window.location.origin): string {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(cafeSlug) || !/^[A-Za-z0-9_-]{32,128}$/.test(tableCode)) {
    throw new Error("Некорректные данные кафе или QR-кода стола.");
  }
  const base = new URL(origin);
  if (base.protocol !== "http:" && base.protocol !== "https:") throw new Error("Недопустимый адрес сайта.");
  return new URL(`/menu/${encodeURIComponent(cafeSlug)}/${encodeURIComponent(tableCode)}`, base.origin).toString();
}

export function isExpectedTableMenuUrl(value: string, cafeSlug: string, tableCode: string, origin = window.location.origin): boolean {
  try {
    const expected = new URL(buildTableMenuUrl(cafeSlug, tableCode, origin));
    const actual = new URL(value);
    return actual.origin === expected.origin && actual.pathname === expected.pathname && !actual.search && !actual.hash;
  } catch { return false; }
}
