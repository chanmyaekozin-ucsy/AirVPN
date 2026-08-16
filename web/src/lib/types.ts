export type Role = "user" | "admin";
export type OrderStatus =
  | "awaiting_payment"
  | "paid"
  | "processing"
  | "success"
  | "failed"
  | "cancelled";
export type TxnStatus = "pending" | "succeeded" | "failed";

export type LoginMethod = "email" | "google" | "wathanpay" | "phone";

export type User = {
  id: string;
  name: string;
  phone: string;
  email: string;
  role: Role;
  pinHash: string;
  balanceKs: number;
  loginMethod?: LoginMethod;
  googleSub?: string;
  wathanpaySub?: string;
  telegramId?: string;
  notes?: string;
  createdAt?: string;
};

/** Panel / Reality settings live on the server row (admin-configured, not env). */
export type Server = {
  id: string;
  slug: string;
  name: string;
  nameMy: string;
  region: string;
  isActive: boolean;
  sortOrder: number;
  panelUrl: string;
  panelUsername: string;
  panelPassword: string;
  /** Optional 3x-ui API token / panel secret (Bearer). */
  panelSecret: string;
  panelInboundId: number;
  panelVerifySsl: boolean;
  host: string;
  port: number;
  vlessSecurity: string;
  vlessFlow: string;
  vlessSni: string;
  vlessFp: string;
  vlessPbk: string;
  vlessSid: string;
  vlessSpx: string;
};

export type Plan = {
  id: string;
  serverId: string;
  title: string;
  dataGb: number;
  /** Amount charged (sale price). */
  priceKs: number;
  /**
   * List / compare-at price before discount. 0 = no discount UI.
   * Shown struck-through when greater than priceKs.
   */
  compareAtKs: number;
  durationDays: number;
  unlimitedDate: boolean;
  isActive: boolean;
  sortOrder: number;
};

export type Order = {
  id: string;
  userId: string;
  serverId: string;
  serverName: string;
  planId: string;
  planTitle: string;
  dataGb: number;
  durationDays: number;
  amountKs: number;
  status: OrderStatus;
  paymentMethod: string;
  depositId: string | null;
  payeeName: string | null;
  payeePhone: string | null;
  txid: string | null;
  failReason: string | null;
  subscriptionId: string | null;
  userLoginMethod?: LoginMethod;
  userEmail?: string;
  userPhone?: string;
  userName?: string;
  replacementRequested?: boolean;
  replacementReason?: string;
  replacementRequestedAt?: string;
  notes?: string;
  createdAt: string;
  completedAt: string | null;
};

export type Subscription = {
  id: string;
  orderId: string;
  userId: string;
  serverId: string;
  planTitle: string;
  dataGb: number;
  durationDays: number;
  subToken: string;
  subUrl: string;
  vlessKey: string;
  panelEmail: string;
  clientUuid: string;
  status: "active" | "expired" | "pending" | "cancelled";
  userLoginMethod?: LoginMethod;
  userName?: string;
  userEmail?: string;
  userPhone?: string;
  replacementCount?: number;
  lastReplacedAt?: string;
  replacementRequested?: boolean;
  replacementReason?: string;
  replacementRequestedAt?: string;
  notes?: string;
  createdAt: string;
  expiresAt: string | null;
};

export type Transaction = {
  id: string;
  orderId: string;
  userId: string;
  amountKs: number;
  method: string;
  txid: string | null;
  status: TxnStatus;
  note: string;
  createdAt: string;
};

export type ShopSettings = {
  /** Public base used in subscription links, e.g. https://shop.example.com */
  subPublicBaseUrl: string;
  /** Seeded plan ids removed by admin — do not re-merge from catalog. */
  deletedPlanIds: string[];
};

export type Store = {
  settings: ShopSettings;
  users: User[];
  servers: Server[];
  plans: Plan[];
  orders: Order[];
  subscriptions: Subscription[];
  transactions: Transaction[];
};

export type Session = {
  sub: string;
  role: Role;
  name: string;
};

/** Safe fields for shop clients (no panel credentials). */
export type PublicServer = Pick<
  Server,
  "id" | "slug" | "name" | "nameMy" | "region" | "isActive" | "sortOrder"
>;
