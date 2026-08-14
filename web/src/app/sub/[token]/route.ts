import { readStore } from "@/lib/store";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const store = await readStore();
  const sub = store.subscriptions.find(
    (s) => s.subToken === token && s.status === "active",
  );
  if (!sub?.vlessKey) {
    return new Response("Not found", { status: 404 });
  }
  if (sub.expiresAt && Date.parse(sub.expiresAt) < Date.now()) {
    return new Response("Expired", { status: 410 });
  }
  const body = Buffer.from(`${sub.vlessKey}\n`, "utf8").toString("base64");
  return new Response(body, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
      "profile-title": "AirVPN",
    },
  });
}
