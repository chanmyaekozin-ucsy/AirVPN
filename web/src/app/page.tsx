"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { FlagIcon } from "@/components/FlagIcon";
import { ShopShell } from "@/components/ShopShell";
import { api } from "@/lib/api";
import { countryCodeFor, countryLabel } from "@/lib/flags";
import { formatKs, planDiscount } from "@/lib/format";
import type { Plan, Server } from "@/lib/types";

type ServerRow = Server & { plans: Plan[] };

export default function HomePage() {
  const router = useRouter();
  const [servers, setServers] = useState<ServerRow[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    api<{ servers: ServerRow[] }>("/api/servers")
      .then((data) => setServers(data.servers))
      .catch((err) => setError(err instanceof Error ? err.message : "Could not load servers"));
  }, []);

  return (
    <ShopShell>
      <div className="pad">
        {error ? <p className="err">{error}</p> : null}
        <div className="shop-intro">
          <h1>Choose a server</h1>
          <p>Pick a region, then select a data plan that fits you.</p>
        </div>
        <div className="server-list">
          {servers.map((server) => {
            const activePlans = server.plans.filter((p) => p.isActive);
            const cheapest = activePlans.reduce<Plan | null>((best, p) => {
              if (!best || p.priceKs < best.priceKs) return p;
              return best;
            }, null);
            const from = cheapest?.priceKs;
            const disc = cheapest ? planDiscount(cheapest) : null;
            const code = countryCodeFor({
              region: server.region,
              name: server.name,
              slug: server.slug,
              id: server.id,
            });
            const place = countryLabel(code) || server.region;
            return (
              <button
                key={server.id}
                className="server-card"
                type="button"
                onClick={() => router.push(`/buy/${server.slug}`)}
              >
                <FlagIcon
                  region={server.region}
                  name={server.name}
                  slug={server.slug}
                  id={server.id}
                  size={44}
                />
                <span className="server-card-main">
                  <span className="server-card-name">{server.name}</span>
                  <span className="server-card-meta">{place}</span>
                  {disc?.hasDiscount ? (
                    <span className="server-card-deals">
                      <span className="deal-pct">{disc.offPct}% OFF</span>
                      <span className="deal-amt">{disc.offKs.toLocaleString("en-US")} off</span>
                    </span>
                  ) : null}
                </span>
                <span className="server-card-price">
                  {from != null ? <span className="from">From</span> : null}
                  {disc?.hasDiscount ? <span className="was">{formatKs(disc.compareAtKs)}</span> : null}
                  <span className="now">
                    {from != null ? formatKs(from).replace(" Ks", "") : "—"}
                    <small>Ks</small>
                  </span>
                </span>
              </button>
            );
          })}
        </div>
        {servers.length === 0 && !error ? <p className="empty">No servers yet.</p> : null}
      </div>
    </ShopShell>
  );
}
