import assert from "node:assert/strict";
import test from "node:test";
import { isReceipt, orderStatuses, receiptCopy } from "../src/menu/receipt.ts";

const base = {
  id: "507f1f77bcf86cd799439011",
  table: { name: "Стол 1" },
  items: [{ dishId: "507f1f77bcf86cd799439012", name: "Суп", priceSom: 125, quantity: 2, lineTotalSom: 250 }],
  totalSom: 250,
  currency: "KGS",
  createdAt: "2026-10-27T00:00:00.000Z",
};

test("receipt accepts every server order status with matching Russian copy", () => {
  assert.deepEqual(orderStatuses, ["new", "preparing", "ready", "completed", "cancelled"]);
  for (const status of orderStatuses) {
    assert.equal(isReceipt({ ...base, status }), true);
    assert.ok(receiptCopy[status].title.length > 0);
    assert.ok(receiptCopy[status].detail.length > 0);
  }
});

test("receipt rejects unknown statuses and invalid totals", () => {
  assert.equal(isReceipt({ ...base, status: "unknown" }), false);
  assert.equal(isReceipt({ ...base, status: "ready", totalSom: 249 }), false);
});
