import { jsonError, requireAdmin } from "@/lib/auth";
import { computeAdminStats } from "@/lib/stats";
import { readStore } from "@/lib/store";

export async function GET() {
  try {
    await requireAdmin();
    const store = await readStore();
    return Response.json({ stats: computeAdminStats(store) });
  } catch (err) {
    return jsonError(err);
  }
}
