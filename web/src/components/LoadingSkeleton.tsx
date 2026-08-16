export function ServerCardSkeleton() {
  return (
    <div className="skeleton-server-card">
      <div className="skeleton skeleton-circle" />
      <div className="skeleton-lines">
        <div className="skeleton skeleton-line w-60" />
        <div className="skeleton skeleton-line w-40" />
      </div>
      <div className="skeleton skeleton-price" />
    </div>
  );
}

export function ServerListSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className="server-list" aria-busy="true" aria-label="Loading servers">
      {Array.from({ length: count }).map((_, i) => (
        <ServerCardSkeleton key={i} />
      ))}
    </div>
  );
}

export function PlanCardSkeleton() {
  return (
    <div className="plan-card skeleton-plan-card" style={{ opacity: 0.85 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div className="skeleton skeleton-line w-40" style={{ height: 18 }} />
        <div className="skeleton skeleton-price" />
      </div>
      <div className="skeleton skeleton-line w-80" style={{ height: 12, marginBottom: 8 }} />
      <div className="skeleton skeleton-line w-30" style={{ height: 12 }} />
    </div>
  );
}

export function PlanListSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className="pkg-list" aria-busy="true" aria-label="Loading plans">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="pkg" style={{ opacity: 0.85, cursor: "default" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%" }}>
            <div style={{ flex: 1 }}>
              <div className="skeleton skeleton-line w-60" style={{ height: 16, marginBottom: 6 }} />
              <div className="skeleton skeleton-line w-30" style={{ height: 12 }} />
            </div>
            <div className="skeleton skeleton-price" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function PaymentMethodSkeleton() {
  return (
    <div className="pay-method skeleton-pay-card" style={{ opacity: 0.85, cursor: "default" }}>
      <div className="skeleton skeleton-circle" style={{ width: 36, height: 36 }} />
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
        <div className="skeleton skeleton-line w-40" style={{ height: 15 }} />
        <div className="skeleton skeleton-line w-60" style={{ height: 12 }} />
      </div>
    </div>
  );
}

export function PaymentMethodsSkeleton({ count = 2 }: { count?: number }) {
  return (
    <div className="pay-list" aria-busy="true" aria-label="Loading payment methods">
      {Array.from({ length: count }).map((_, i) => (
        <PaymentMethodSkeleton key={i} />
      ))}
    </div>
  );
}

export function TableSkeleton({ rows = 4, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <div className="table-wrap" aria-busy="true">
      <table className="admin-table">
        <tbody>
          {Array.from({ length: rows }).map((_, r) => (
            <tr key={r}>
              {Array.from({ length: cols }).map((_, c) => (
                <td key={c} style={{ padding: "16px 12px" }}>
                  <div
                    className="skeleton skeleton-line"
                    style={{
                      width: c === 0 ? "80%" : c === cols - 1 ? "40%" : "60%",
                      height: 14,
                    }}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function KpiGridSkeleton() {
  return (
    <div className="kpi-grid" aria-busy="true">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="kpi">
          <div className="skeleton skeleton-line w-40" style={{ height: 12, marginBottom: 10 }} />
          <div className="skeleton skeleton-line w-60" style={{ height: 28, marginBottom: 8 }} />
          <div className="skeleton skeleton-line w-80" style={{ height: 11 }} />
        </div>
      ))}
    </div>
  );
}

export function OrderListSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div aria-busy="true">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="list-row" style={{ opacity: 0.85 }}>
          <div className="list-main">
            <div style={{ flex: 1 }}>
              <div className="skeleton skeleton-line w-60" style={{ height: 16, marginBottom: 6 }} />
              <div className="skeleton skeleton-line w-30" style={{ height: 12 }} />
            </div>
            <div style={{ width: 80, display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
              <div className="skeleton skeleton-line" style={{ width: 60, height: 16, marginBottom: 6 }} />
              <div className="skeleton skeleton-line" style={{ width: 40, height: 12 }} />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="loading-spinner-wrap" role="status">
      <div className="spinner" />
      {label ? <span>{label}</span> : null}
    </div>
  );
}
