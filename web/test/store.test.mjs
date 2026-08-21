import test from "node:test";
import assert from "node:assert/strict";

const AWAITING_PAYMENT_MS = 3 * 60 * 60 * 1000;

function expireStaleOrders(store) {
  const cutoff = Date.now() - AWAITING_PAYMENT_MS;
  let changed = false;
  for (const order of store.orders) {
    if (order.status !== "awaiting_payment") continue;
    const created = Date.parse(order.createdAt);
    if (!Number.isFinite(created) || created > cutoff) continue;
    order.status = "failed";
    order.failReason = "Payment timed out after 3 hours.";
    order.completedAt = new Date().toISOString();
    changed = true;
  }
  return changed;
}

test("expireStaleOrders expires awaiting_payment orders older than 3 hours", () => {
  const fourHoursAgo = new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString();
  const thirtyMinsAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();

  const mockStore = {
    orders: [
      {
        id: "ord_stale",
        status: "awaiting_payment",
        createdAt: fourHoursAgo,
      },
      {
        id: "ord_fresh",
        status: "awaiting_payment",
        createdAt: thirtyMinsAgo,
      },
      {
        id: "ord_success",
        status: "success",
        createdAt: fourHoursAgo,
      },
    ],
  };

  const changed = expireStaleOrders(mockStore);
  assert.equal(changed, true);
  assert.equal(mockStore.orders[0].status, "failed");
  assert.equal(mockStore.orders[0].failReason, "Payment timed out after 3 hours.");
  assert.equal(mockStore.orders[1].status, "awaiting_payment");
  assert.equal(mockStore.orders[2].status, "success");
});

test("expireStaleOrders returns false when no orders are stale", () => {
  const fresh = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const mockStore = {
    orders: [
      {
        id: "ord_1",
        status: "awaiting_payment",
        createdAt: fresh,
      },
    ],
  };

  const changed = expireStaleOrders(mockStore);
  assert.equal(changed, false);
  assert.equal(mockStore.orders[0].status, "awaiting_payment");
});
