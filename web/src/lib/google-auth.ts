import { loadShopEnv } from "./shop-env";

export interface VerifiedGoogleUser {
  sub: string;
  email: string;
  name: string;
  picture?: string;
  emailVerified: boolean;
}

/**
 * Verifies a Google ID token server-side via Google's OAuth2 tokeninfo endpoint.
 */
export async function verifyGoogleIdToken(idToken: string): Promise<VerifiedGoogleUser | null> {
  if (!idToken || typeof idToken !== "string") return null;

  loadShopEnv();
  const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID;

  try {
    const res = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`, {
      method: "GET",
      headers: { Accept: "application/json" },
    });

    if (!res.ok) {
      return null;
    }

    const data = (await res.json().catch(() => ({}))) as {
      sub?: string;
      email?: string;
      name?: string;
      picture?: string;
      email_verified?: string | boolean;
      aud?: string;
      exp?: string | number;
    };

    if (!data.sub || !data.email) {
      return null;
    }

    // Verify audience matches configured Google Client ID if present
    if (clientId && data.aud && data.aud !== clientId) {
      console.warn("[Google Auth] Token audience mismatch:", data.aud, "expected:", clientId);
      return null;
    }

    // Verify token expiration
    if (data.exp && Number(data.exp) * 1000 < Date.now()) {
      return null;
    }

    const emailVerified = data.email_verified === true || data.email_verified === "true";

    return {
      sub: String(data.sub).trim(),
      email: String(data.email).trim().toLowerCase(),
      name: String(data.name || "Google User").trim(),
      picture: data.picture,
      emailVerified,
    };
  } catch (err) {
    console.error("[Google Auth] Error verifying token:", err);
    return null;
  }
}
