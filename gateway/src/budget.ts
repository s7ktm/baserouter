// Budgets are monthly and start again on the first day of the month, at midnight
// in the local time of the machine the gateway runs on.

export function monthStart(now: Date): Date {
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

export function nextMonthStart(now: Date): Date {
  return new Date(now.getFullYear(), now.getMonth() + 1, 1);
}

export function dayStart(now: Date): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

// A local calendar date, as YYYY-MM-DD.
export function localDate(d: Date): string {
  const two = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
}

export function isOver(budget: number, spent: number): boolean {
  return spent >= budget;
}

export type Gate =
  | { ok: true }
  | { ok: false; status: 402 | 403; code: "route_off" | "budget_used_up"; message: string; metadata?: Record<string, unknown> };

// Decides whether a route may send a request, before anything is sent to a provider.
export function gate(route: { name: string; enabled: number | boolean; budget_usd: number }, spent: number, now: Date): Gate {
  if (!route.enabled) {
    return { ok: false, status: 403, code: "route_off", message: `Route "${route.name}" is switched off. Switch it on in BaseRouter to continue.` };
  }
  if (isOver(route.budget_usd, spent)) {
    const resets = localDate(nextMonthStart(now));
    return {
      ok: false,
      status: 402,
      code: "budget_used_up",
      message: `Route "${route.name}" has used up its monthly budget: ${money(spent)} of ${money(route.budget_usd, true)}. It starts again on ${resets}. Raise the budget in BaseRouter to continue sooner.`,
      metadata: { spent_usd: spent, budget_usd: route.budget_usd, resets_on: resets },
    };
  }
  return { ok: true };
}

// Spend has two decimals, or three when it is under one cent; a budget drops them when it is whole.
function money(amount: number, budget = false): string {
  if (budget && Number.isInteger(amount)) return "$" + amount;
  return "$" + amount.toFixed(amount > 0 && amount < 0.01 ? 3 : 2);
}
