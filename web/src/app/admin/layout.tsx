"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { useAuth } from "@/components/Auth";

const NAV = [
  { href: "/admin/dashboard", label: "Dashboard" },
  { href: "/admin/keys", label: "Keys & Customers" },
  { href: "/admin", label: "Servers" },
  { href: "/admin/plans", label: "Plans" },
  { href: "/admin/purchases", label: "Purchases" },
  { href: "/admin/transactions", label: "Transactions" },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const { me, ready, logout } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const isLogin = pathname === "/admin/login";

  useEffect(() => {
    if (!ready || isLogin) return;
    if (!me) router.replace("/admin/login");
    else if (me.role !== "admin") router.replace("/");
  }, [ready, me, isLogin, router]);

  if (isLogin) return children;
  if (!ready || me?.role !== "admin") return null;

  return (
    <div className="shell">
      <aside className="nav">
        <div className="nav-brand">
          <div className="mark">AV</div>
          AirVPN
        </div>
        {NAV.map((item) => {
          const on =
            item.href === "/admin"
              ? pathname === "/admin"
              : pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <Link key={item.href} href={item.href} className={on ? "on" : ""}>
              {item.label}
            </Link>
          );
        })}
        <div className="nav-foot">
          <span>{me.email || me.name}</span>
          <button type="button" onClick={() => void logout().then(() => router.push("/admin/login"))}>
            Sign out
          </button>
        </div>
      </aside>
      <main className="main">{children}</main>
    </div>
  );
}
