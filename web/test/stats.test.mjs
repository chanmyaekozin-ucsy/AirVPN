import test from "node:test";
import assert from "node:assert/strict";
import { computeAdminStats } from "../src/lib/stats.ts";

test("computeAdminStats calculates sales tracker periods, payment methods, and outcomes", () => {
  const now = new Date().toISOString();
  const mockStore = {
    settings: { subPublicBaseUrl: "", deletedPlanIds: [] },
    users: [
      { id: "u1", name: "User 1", role: "user", balanceKs: 0 },
      { id: "admin", name: "Admin", role: "admin", balanceKs: 0 },
    ],
    servers: [
      {
        id: "us1",
        slug: "us1",
        name: "US Node",
        nameMy: "US",
        region: "US",
        isActive: true,
        sortOrder: 1,
        panelUrl: "http://example.com",
        panelUsername: "admin",
        panelPassword: "pass",
        panelSecret: "",
        panelInboundId: 1,
        panelVerifySsl: true,
        host: "1.1.1.1",
        port: 443,
        vlessSecurity: "reality",
        vlessFlow: "",
        vlessSni: "",
        vlessFp: "",
        vlessPbk: "",
        vlessSid: "",
        vlessSpx: "",
      },
    ],
    plans: [],
    orders: [
      {
        id: "o1",
        userId: "u1",
        serverId: "us1",
        serverName: "US Node",
        planId: "p1",
        planTitle: "50 GB",
        dataGb: 50,
        durationDays: 30,
        amountKs: 3000,
        status: "success",
        paymentMethod: "KBZPay",
        depositId: null,
        payeeName: "Admin",
        payeePhone: "09123456",
        txid: "tx1",
        failReason: null,
        subscriptionId: "sub1",
        createdAt: now,
        completedAt: now,
      },
      {
        id: "o2",
        userId: "u1",
        serverId: "us1",
        serverName: "US Node",
        planId: "p1",
        planTitle: "50 GB",
        dataGb: 50,
        durationDays: 30,
        amountKs: 4000,
        status: "success",
        paymentMethod: "WavePay",
        depositId: null,
        payeeName: "Admin",
        payeePhone: "09123456",
        txid: "tx2",
        failReason: null,
        subscriptionId: "sub2",
        createdAt: now,
        completedAt: now,
      },
      {
        id: "o3",
        userId: "u1",
        serverId: "us1",
        serverName: "US Node",
        planId: "p1",
        planTitle: "50 GB",
        dataGb: 50,
        durationDays: 30,
        amountKs: 5000,
        status: "success",
        paymentMethod: "WathanPay",
        depositId: null,
        payeeName: "Admin",
        payeePhone: "09123456",
        txid: "tx3",
        failReason: null,
        subscriptionId: "sub3",
        createdAt: now,
        completedAt: now,
      },
      {
        id: "o4",
        userId: "u1",
        serverId: "us1",
        serverName: "US Node",
        planId: "p1",
        planTitle: "50 GB",
        dataGb: 50,
        durationDays: 30,
        amountKs: 3000,
        status: "failed",
        paymentMethod: "KBZPay",
        depositId: null,
        payeeName: null,
        payeePhone: null,
        txid: null,
        failReason: "Declined",
        subscriptionId: null,
        createdAt: now,
        completedAt: now,
      },
    ],
    subscriptions: [
      {
        id: "sub1",
        orderId: "o1",
        userId: "u1",
        serverId: "us1",
        planTitle: "50 GB",
        dataGb: 50,
        durationDays: 30,
        subToken: "tok1",
        subUrl: "https://example.com/sub/tok1",
        vlessKey: "vless://...",
        panelEmail: "user1",
        clientUuid: "uuid1",
        status: "active",
        createdAt: now,
        expiresAt: null,
      },
    ],
    transactions: [],
  };

  const res = computeAdminStats(mockStore);

  assert.equal(res.revenueKs, 12000);
  assert.equal(res.keysSold, 3);
  assert.equal(res.activeKeys, 1);
  assert.equal(res.periods.daily.revenueKs, 12000);
  assert.equal(res.periods.weekly.revenueKs, 12000);
  assert.equal(res.periods.monthly.revenueKs, 12000);

  // Check payment method breakdown
  const kbz = res.paymentMethods.find((p) => p.method === "KBZPay");
  const wave = res.paymentMethods.find((p) => p.method === "WavePay");
  const wp = res.paymentMethods.find((p) => p.method === "WathanPay");

  assert.equal(kbz.revenueKs, 3000);
  assert.equal(wave.revenueKs, 4000);
  assert.equal(wp.revenueKs, 5000);

  // Check outcomes
  assert.equal(res.outcomes.total, 4);
  assert.equal(res.outcomes.successCount, 3);
  assert.equal(res.outcomes.failedCount, 1);
  assert.equal(res.outcomes.successPercentage, 75);
});
