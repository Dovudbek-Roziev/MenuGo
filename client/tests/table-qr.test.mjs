import assert from "node:assert/strict";
import test from "node:test";
import { createPrintableTableQr } from "../src/auth/printableTableQr.ts";
import { buildTableMenuUrl, isExpectedTableMenuUrl } from "../src/auth/tableQr.ts";
import { createManagedTable, fetchManagedTables, TablesApiError } from "../src/auth/manageTablesApi.ts";

const code = "Abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG";
const origin = "http://127.0.0.1:5173";

test("QR URL is the exact guest menu for this cafe and table", () => {
  const url = buildTableMenuUrl("cafe-demo", code, origin);
  assert.equal(url, `${origin}/menu/cafe-demo/${code}`);
  assert.equal(isExpectedTableMenuUrl(url, "cafe-demo", code, origin), true);
  assert.equal(isExpectedTableMenuUrl(`${origin}/menu/other-cafe/${code}`, "cafe-demo", code, origin), false);
  assert.equal(isExpectedTableMenuUrl(`${origin}/menu/cafe-demo/OtherCode012345678901234567890123456789`, "cafe-demo", code, origin), false);
  assert.equal(isExpectedTableMenuUrl(`${url}?redirect=https://evil.example`, "cafe-demo", code, origin), false);
  assert.throws(() => buildTableMenuUrl("Cafe/demo", code, origin));
  assert.throws(() => buildTableMenuUrl("cafe-demo", "mongo-id", origin));
  assert.throws(() => buildTableMenuUrl("cafe-demo", code, "javascript:alert(1)"));
});

test("print download is a labeled vector QR with only the guest URL payload", async () => {
  const result = await createPrintableTableQr("cafe-demo", code, "Кафе MenuGo", "Стол 12", origin);
  assert.equal(result.url, `${origin}/menu/cafe-demo/${code}`);
  assert.match(result.svg, /width="400" height="480"/);
  assert.match(result.svg, /Кафе MenuGo/);
  assert.match(result.svg, /Стол 12/);
  assert.match(result.svg, /Отсканируйте, чтобы открыть меню/);
  assert.doesNotMatch(result.svg, /MongoDB|cafeId|password|session/i);
  assert.match(result.dataUrl, /^data:image\/svg\+xml;charset=utf-8,/);
});

test("tables API validates replies and sends writes with credentials and CSRF", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  const table = { id: "507f1f77bcf86cd799439011", name: "Стол 12", tableCode: code, isActive: true };
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.endsWith("/api/auth/csrf")) return new Response(JSON.stringify({ csrfToken: "a-csrf-token-long-enough-for-tests" }), { status: 200 });
    if (init.method === "POST") return new Response(JSON.stringify({ table }), { status: 201 });
    return new Response(JSON.stringify({ cafe: { name: "Кафе MenuGo", slug: "cafe-demo" }, tables: [table] }), { status: 200 });
  };
  try {
    const listing = await fetchManagedTables();
    assert.equal(listing.tables[0].tableCode, code);
    assert.equal((await createManagedTable("Стол 12")).name, "Стол 12");
    const write = calls.find((call) => call.init.method === "POST");
    assert.equal(write?.init.credentials, "include");
    assert.equal(new Headers(write?.init.headers).get("X-CSRF-Token"), "a-csrf-token-long-enough-for-tests");
    assert.equal(JSON.parse(String(write?.init.body)).name, "Стол 12");

    globalThis.fetch = async () => new Response(JSON.stringify({ cafe: { name: "Cafe", slug: "cafe-demo" }, tables: [{ ...table, tableCode: "invalid" }] }), { status: 200 });
    await assert.rejects(fetchManagedTables(), (error) => error instanceof TablesApiError && error.status === 503);
  } finally { globalThis.fetch = originalFetch; }
});
test("table API distinguishes unauthorized, forbidden, conflict, unavailable and network errors", async () => {
  const originalFetch = globalThis.fetch;
  try {
    for (const [status, code] of [[401, "UNAUTHORIZED"], [403, "FORBIDDEN"], [409, "CONFLICT"], [503, "UNAVAILABLE"]]) {
      globalThis.fetch = async () => new Response(JSON.stringify({ message: "API error" }), { status });
      await assert.rejects(fetchManagedTables(), (error) => error instanceof TablesApiError && error.status === status && error.code === code);
    }
    globalThis.fetch = async () => { throw new TypeError("offline"); };
    await assert.rejects(fetchManagedTables(), (error) => error instanceof TablesApiError && error.code === "NETWORK");
  } finally { globalThis.fetch = originalFetch; }
});
