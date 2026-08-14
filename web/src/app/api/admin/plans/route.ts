import { NextRequest } from "next/server";
import { jsonError, requireAdmin } from "@/lib/auth";
import { readStore, updateStore } from "@/lib/store";

export async function GET(req: NextRequest) {
  try {
    await requireAdmin();
    const serverId = req.nextUrl.searchParams.get("serverId") || "";
    const store = await readStore();
    let plans = [...store.plans];
    if (serverId) plans = plans.filter((p) => p.serverId === serverId);
    plans.sort((a, b) => a.sortOrder - b.sortOrder);
    return Response.json({ plans });
  } catch (err) {
    return jsonError(err);
  }
}

const UNLIMITED_DAYS = 36500;

export async function POST(req: NextRequest) {
  try {
    await requireAdmin();
    const body = (await req.json()) as {
      serverId?: string;
      title?: string;
      priceKs?: number;
      compareAtKs?: number;
      dataGb?: number;
      durationDays?: number;
      unlimitedDate?: boolean;
      isActive?: boolean;
      sortOrder?: number;
    };
    const serverId = String(body.serverId ?? "").trim();
    const title = String(body.title ?? "").trim();
    if (!serverId || !title) {
      throw Object.assign(new Error("Server and title are required."), { status: 400 });
    }
    const unlimitedDate = Boolean(body.unlimitedDate);
    const priceKs = Math.max(0, Math.round(Number(body.priceKs) || 0));
    let compareAtKs = Math.max(0, Math.round(Number(body.compareAtKs) || 0));
    if (compareAtKs > 0 && compareAtKs < priceKs) compareAtKs = priceKs;
    const plan = await updateStore((store) => {
      const server = store.servers.find((s) => s.id === serverId);
      if (!server) throw Object.assign(new Error("Server not found."), { status: 404 });
      const siblingSort = store.plans
        .filter((p) => p.serverId === serverId)
        .map((p) => p.sortOrder);
      const nextSort =
        typeof body.sortOrder === "number"
          ? body.sortOrder
          : (siblingSort.length ? Math.max(...siblingSort) + 1 : 1);
      const created = {
        id: `plan_${serverId}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
        serverId,
        title,
        dataGb: Math.max(1, Math.round(Number(body.dataGb) || 1)),
        priceKs,
        compareAtKs,
        durationDays: unlimitedDate
          ? UNLIMITED_DAYS
          : Math.max(1, Math.round(Number(body.durationDays) || 30)),
        unlimitedDate,
        isActive: typeof body.isActive === "boolean" ? body.isActive : true,
        sortOrder: nextSort,
      };
      store.plans.push(created);
      return created;
    });
    return Response.json({ plan }, { status: 201 });
  } catch (err) {
    return jsonError(err);
  }
}

export async function PATCH(req: NextRequest) {
  try {
    await requireAdmin();
    const body = (await req.json()) as {
      id?: string;
      orderedIds?: string[];
      title?: string;
      priceKs?: number;
      compareAtKs?: number;
      dataGb?: number;
      durationDays?: number;
      unlimitedDate?: boolean;
      isActive?: boolean;
      sortOrder?: number;
    };

    if (Array.isArray(body.orderedIds)) {
      const orderedIds = body.orderedIds.map((id) => String(id)).filter(Boolean);
      if (!orderedIds.length) {
        throw Object.assign(new Error("orderedIds is required."), { status: 400 });
      }
      const plans = await updateStore((store) => {
        const matched = orderedIds.map((id) => store.plans.find((p) => p.id === id));
        if (matched.some((p) => !p)) {
          throw Object.assign(new Error("Plan not found."), { status: 404 });
        }
        const serverId = matched[0]!.serverId;
        if (matched.some((p) => p!.serverId !== serverId)) {
          throw Object.assign(new Error("Plans must belong to one server."), { status: 400 });
        }
        orderedIds.forEach((id, index) => {
          const plan = store.plans.find((p) => p.id === id);
          if (plan) plan.sortOrder = index + 1;
        });
        return store.plans
          .filter((p) => p.serverId === serverId)
          .sort((a, b) => a.sortOrder - b.sortOrder);
      });
      return Response.json({ plans });
    }

    const id = String(body.id ?? "");
    const plan = await updateStore((store) => {
      const found = store.plans.find((p) => p.id === id);
      if (!found) throw Object.assign(new Error("Plan not found."), { status: 404 });
      if (typeof body.title === "string" && body.title.trim()) found.title = body.title.trim();
      if (typeof body.priceKs === "number") found.priceKs = Math.max(0, Math.round(body.priceKs));
      if (typeof body.compareAtKs === "number") {
        found.compareAtKs = Math.max(0, Math.round(body.compareAtKs));
      }
      if (typeof found.compareAtKs !== "number") found.compareAtKs = 0;
      if (found.compareAtKs > 0 && found.compareAtKs < found.priceKs) {
        found.compareAtKs = found.priceKs;
      }
      if (typeof body.dataGb === "number") found.dataGb = Math.max(1, Math.round(body.dataGb));
      if (typeof body.unlimitedDate === "boolean") {
        found.unlimitedDate = body.unlimitedDate;
        if (body.unlimitedDate) found.durationDays = UNLIMITED_DAYS;
      }
      if (typeof body.durationDays === "number" && !found.unlimitedDate) {
        found.durationDays = Math.max(1, Math.round(body.durationDays));
      }
      if (typeof body.isActive === "boolean") found.isActive = body.isActive;
      if (typeof body.sortOrder === "number") found.sortOrder = body.sortOrder;
      return found;
    });
    return Response.json({ plan });
  } catch (err) {
    return jsonError(err);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    await requireAdmin();
    const id = String(req.nextUrl.searchParams.get("id") ?? "").trim();
    if (!id) throw Object.assign(new Error("Plan id is required."), { status: 400 });
    await updateStore((store) => {
      const index = store.plans.findIndex((p) => p.id === id);
      if (index < 0) throw Object.assign(new Error("Plan not found."), { status: 404 });
      store.plans.splice(index, 1);
      if (!store.settings) store.settings = { subPublicBaseUrl: "", deletedPlanIds: [] };
      if (!Array.isArray(store.settings.deletedPlanIds)) store.settings.deletedPlanIds = [];
      if (!store.settings.deletedPlanIds.includes(id)) {
        store.settings.deletedPlanIds.push(id);
      }
      return null;
    });
    return Response.json({ ok: true });
  } catch (err) {
    return jsonError(err);
  }
}
