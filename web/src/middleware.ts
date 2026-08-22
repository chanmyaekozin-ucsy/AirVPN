import { NextResponse, type NextRequest } from "next/server";
import { assertSameOrigin } from "@/lib/rate-limit";

export function middleware(req: NextRequest) {
  try {
    assertSameOrigin(req);
    return NextResponse.next();
  } catch (err) {
    const status = (err as { status?: number }).status ?? 403;
    const message = err instanceof Error ? err.message : "Forbidden";
    return NextResponse.json({ error: message }, { status });
  }
}

export const config = {
  matcher: ["/api/:path*"],
};
