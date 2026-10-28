import assert from "node:assert/strict";
import test from "node:test";
import { OrderReadGate } from "../src/auth/orderReadGate.ts";

test("delayed GET from before a lost PATCH reply cannot unlock stale actions", async () => {
  const gate = new OrderReadGate();
  gate.beginRead(); // Initial confirmed list.
  gate.invalidate(); // PATCH starts.
  const refreshBeforeOutcome = gate.beginRead();
  let deliverOldGet;
  const oldGet = new Promise((resolve) => { deliverOldGet = resolve; });

  gate.requireVerification(); // Server may have changed status; PATCH reply was lost.
  deliverOldGet({ status: "new" });
  assert.deepEqual(await oldGet, { status: "new" });
  assert.equal(gate.mayApply(refreshBeforeOutcome), false);
  assert.equal(gate.confirm(refreshBeforeOutcome), false);
  assert.equal(gate.verificationRequired, true);
});

test("failed fresh check keeps actions blocked; a later manual or poll success unlocks", async () => {
  for (const mode of ["manual", "poll"]) {
    const gate = new OrderReadGate();
    gate.beginRead();
    gate.requireVerification();

    const failedCheck = gate.beginRead();
    await assert.rejects(Promise.reject(new Error("GET unavailable")));
    assert.equal(gate.isCurrent(failedCheck), true);
    assert.equal(gate.verificationRequired, true);

    const freshCheck = gate.beginRead();
    assert.equal(gate.confirm(freshCheck), true, mode);
    assert.equal(gate.verificationRequired, false, mode);
  }
});

test("deferred response from before uncertainty cannot be applied later", () => {
  const gate = new OrderReadGate();
  const deferredRead = gate.beginRead();
  gate.requireVerification();
  assert.equal(gate.mayApply(deferredRead), false);
  assert.equal(gate.confirm(deferredRead), false);
  assert.equal(gate.verificationRequired, true);
});
