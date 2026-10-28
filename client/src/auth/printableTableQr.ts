import QRCode from "qrcode";
import { buildTableMenuUrl, isExpectedTableMenuUrl } from "./tableQr";

function escapeXml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}

export async function createPrintableTableQr(cafeSlug: string, tableCode: string, cafeName: string, tableName: string, origin: string) {
  const url = buildTableMenuUrl(cafeSlug, tableCode, origin);
  if (!isExpectedTableMenuUrl(url, cafeSlug, tableCode, origin)) throw new Error("Адрес QR-кода не совпадает с меню этого стола.");
  const qr = await QRCode.toString(url, {
    type: "svg", errorCorrectionLevel: "H", margin: 2,
    color: { dark: "#153e33", light: "#ffffff" },
  });
  const viewBox = /viewBox="([^"]+)"/.exec(qr)?.[1];
  const inner = qr.replace(/^<svg\b[^>]*>/, "").replace(/<\/svg>\s*$/, "");
  if (!viewBox || inner === qr) throw new Error("Не удалось подготовить QR-код для печати.");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="480" viewBox="0 0 400 480"><rect width="400" height="480" rx="18" fill="#fffdf6"/><text x="200" y="42" text-anchor="middle" font-family="Arial,sans-serif" font-size="19" font-weight="700" fill="#153e33">${escapeXml(cafeName)}</text><text x="200" y="72" text-anchor="middle" font-family="Arial,sans-serif" font-size="16" fill="#536a35">${escapeXml(tableName)}</text><svg x="40" y="88" width="320" height="320" viewBox="${viewBox}">${inner}</svg><text x="200" y="442" text-anchor="middle" font-family="Arial,sans-serif" font-size="13" fill="#536a35">Отсканируйте, чтобы открыть меню</text></svg>`;
  return { url, svg, dataUrl: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}` };
}
