import { NextRequest } from "next/server";
import { jsonError, requireAdmin } from "@/lib/auth";
import { isServerProvisionReady, normalizeServer } from "@/lib/server-config";
import { readStore, updateStore } from "@/lib/store";
import type { Server } from "@/lib/types";

export async function GET() {
  try {
    await requireAdmin();
    const store = await readStore();
    return Response.json({
      settings: store.settings,
      servers: [...store.servers]
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((s) => ({
          ...s,
          configured: isServerProvisionReady(s),
        })),
    });
  } catch (err) {
    return jsonError(err);
  }
}

export async function PATCH(req: NextRequest) {
  try {
    await requireAdmin();
    const body = (await req.json()) as Partial<Server> & {
      id?: string;
      subPublicBaseUrl?: string;
      orderedIds?: string[];
    };

    if (Array.isArray(body.orderedIds)) {
      const orderedIds = body.orderedIds.map((id) => String(id)).filter(Boolean);
      if (!orderedIds.length) {
        throw Object.assign(new Error("orderedIds is required."), { status: 400 });
      }
      const servers = await updateStore((store) => {
        const matched = orderedIds.map((id) => store.servers.find((s) => s.id === id));
        if (matched.some((s) => !s) || matched.length !== store.servers.length) {
          throw Object.assign(new Error("Server list mismatch."), { status: 400 });
        }
        orderedIds.forEach((id, index) => {
          const server = store.servers.find((s) => s.id === id);
          if (server) server.sortOrder = index + 1;
        });
        return [...store.servers]
          .sort((a, b) => a.sortOrder - b.sortOrder)
          .map((s) => ({
            ...s,
            configured: isServerProvisionReady(s),
          }));
      });
      return Response.json({ servers });
    }

    if (typeof body.subPublicBaseUrl === "string" && !body.id) {
      const settings = await updateStore((store) => {
        store.settings.subPublicBaseUrl = body.subPublicBaseUrl!.replace(/\/$/, "").trim();
        return store.settings;
      });
      return Response.json({ settings });
    }

    const id = String(body.id ?? "");
    const server = await updateStore((store) => {
      const found = store.servers.find((s) => s.id === id);
      if (!found) throw Object.assign(new Error("Server not found."), { status: 404 });

      const next = normalizeServer({
        ...found,
        ...body,
        id: found.id,
        slug: typeof body.slug === "string" && body.slug.trim() ? body.slug.trim() : found.slug,
      });

      Object.assign(found, next);
      return found;
    });
    return Response.json({
      server: { ...server, configured: isServerProvisionReady(server) },
    });
  } catch (err) {
    return jsonError(err);
  }
}
