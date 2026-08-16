import { NextRequest } from "next/server";
import { jsonError, requireAdmin } from "@/lib/auth";
import { readStore } from "@/lib/store";

export async function GET(req: NextRequest) {
  try {
    await requireAdmin();
    const q = (req.nextUrl.searchParams.get("q") || "").trim().toLowerCase();
    const status = req.nextUrl.searchParams.get("status") || "";
    const paidBy = (req.nextUrl.searchParams.get("paidBy") || "").trim().toLowerCase();
    const store = await readStore();
    let rows = store.orders.map((o) => {
      const user = store.users.find((u) => u.id === o.userId);
      return {
        ...o,
        userLoginMethod: o.userLoginMethod || user?.loginMethod || "unknown",
        userName: o.userName || user?.name || o.payeeName || "Customer",
        userEmail: o.userEmail || user?.email || "",
        userPhone: o.userPhone || user?.phone || "",
      };
    }).sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    if (status) rows = rows.filter((o) => o.status === status);
    if (paidBy) rows = rows.filter((o) => (o.paymentMethod || "").toLowerCase().includes(paidBy));
    if (q) {
      rows = rows.filter((o) =>
        [
          o.id,
          o.serverName,
          o.planTitle,
          o.txid,
          o.paymentMethod,
          o.userId,
          o.userName,
          o.userEmail,
          o.userPhone,
          o.payeeName,
          o.userLoginMethod,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(q),
      );
    }
    return Response.json({ orders: rows });
  } catch (err) {
    return jsonError(err);
  }
}
