export type Role = "customer" | "admin";
export interface User { id: number; username: string; fullName: string; role: Role }
export interface Account {
  id: number; number: string; kind: "Savings" | "Checking"; balance: number;
  status: "active" | "frozen"; dailyLimit: number; createdAt: string; owner: string;
}
export interface Tx {
  id: number; kind: "Deposit" | "Withdrawal" | "Transfer In" | "Transfer Out";
  amount: number; balanceAfter: number; counterparty: string; note: string; createdAt: string;
}
export interface SearchHit extends Tx { accountNumber: string; accountId: number }
export interface HistoryPage { items: Tx[]; total: number; page: number; pageSize: number }
export interface Statement {
  account: Account; month: string; openingBalance: number; closingBalance: number;
  credits: number; debits: number; entries: number; items: Tx[];
}
export interface Overview {
  customers: number; accounts: number; totalDeposits: number; frozenAccounts: number; transactionsToday: number;
}
export interface AdminUser { id: number; username: string; fullName: string; role: Role; createdAt: string; accounts: number }
export interface AuditEntry { id: number; user: string; action: string; detail: string; createdAt: string }

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

export async function api<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers: body === undefined ? {} : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, "NETWORK", "Can't reach the bank server. Check your connection and try again.");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.code ?? "ERROR", data.error ?? "Something went wrong.");
  return data as T;
}
