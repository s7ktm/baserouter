import { expect, test } from "bun:test";
import { dayStart, gate, isOver, localDate, monthStart, nextMonthStart } from "../src/budget.ts";
import { openDb, Store, type NewRequest } from "../src/store.ts";

const route = { name: "Home assistant", enabled: 1, budget_usd: 10 };
const now = new Date(2026, 10, 22, 14, 30); // 22 November 2026, local time

test("the month starts at local midnight on the first", () => {
  expect(monthStart(now)).toEqual(new Date(2026, 10, 1, 0, 0, 0, 0));
  expect(monthStart(new Date(2026, 10, 1, 0, 0, 0, 0))).toEqual(new Date(2026, 10, 1));
  expect(monthStart(new Date(2026, 10, 30, 23, 59, 59, 999))).toEqual(new Date(2026, 10, 1));
});

test("the next month follows December into January", () => {
  expect(nextMonthStart(now)).toEqual(new Date(2026, 11, 1));
  expect(nextMonthStart(new Date(2026, 11, 31, 23, 59))).toEqual(new Date(2027, 0, 1));
});

test("the day starts at local midnight", () => {
  expect(dayStart(now)).toEqual(new Date(2026, 10, 22));
});

test("a date is written as year, month, day", () => {
  expect(localDate(new Date(2027, 0, 1))).toBe("2027-01-01");
});

test("a route is over when it has spent its budget or more", () => {
  expect(isOver(10, 9.9999)).toBe(false);
  expect(isOver(10, 10)).toBe(true);
  expect(isOver(10, 10.01)).toBe(true);
  expect(isOver(10, 0)).toBe(false);
});

test("a route that is on and under its budget may send", () => {
  expect(gate(route, 6.2, now)).toEqual({ ok: true });
});

test("a route that is switched off is refused", () => {
  const result = gate({ ...route, enabled: 0 }, 0, now);
  expect(result).toMatchObject({ ok: false, status: 403, code: "route_off" });
  expect(!result.ok && result.message).toContain("Home assistant");
});

test("a route that has used up its budget is refused, and told when it starts again", () => {
  const result = gate(route, 10, now);
  expect(result).toMatchObject({
    ok: false,
    status: 402,
    code: "budget_used_up",
    metadata: { spent_usd: 10, budget_usd: 10, resets_on: "2026-12-01" },
  });
  expect(!result.ok && result.message).toBe(
    'Route "Home assistant" has used up its monthly budget: $10.00 of $10. It starts again on 2026-12-01. Raise the budget in BaseRouter to continue sooner.',
  );
});

test("a budget with cents keeps them in the message", () => {
  const result = gate({ ...route, budget_usd: 2.5 }, 2.514, now);
  expect(!result.ok && result.message).toContain("$2.51 of $2.50");
});

test("an amount under one cent is written with three decimals", () => {
  const result = gate({ ...route, budget_usd: 0.004 }, 0.0042, now);
  expect(!result.ok && result.message).toContain("$0.004 of $0.004");
});

test("switched off is said before over budget", () => {
  expect(gate({ ...route, enabled: 0 }, 99, now)).toMatchObject({ code: "route_off" });
});

// Spend as the database counts it

function request(over: Partial<NewRequest>): NewRequest {
  return {
    route_id: "home", provider_id: null, started_at: now.getTime(), kind: "chat", model_requested: "m", model_served: "m", streamed: false, prompt_tokens: 1,
    completion_tokens: 1, cost_usd: 1, cost_source: "provider", first_token_ms: null, total_ms: 1, status: 200, failure: null, upstream_id: null, ...over,
  };
}

function storeWithRoutes(): Store {
  const store = new Store(openDb(":memory:"));
  for (const id of ["home", "arm"]) store.addRoute({ id, name: id, key_hash: id, key_hint: "0000", budget_usd: 10, enabled: 1, models: "[]", icon: "code", color: "#2B62D9", keep_media: 1, created_at: 0 });
  return store;
}

test("only this month's requests of this route count towards its budget", () => {
  const store = storeWithRoutes();
  const start = monthStart(now).getTime();
  store.addRequest(request({ cost_usd: 1.5 }));
  store.addRequest(request({ cost_usd: 0.25, started_at: start })); // the first moment of the month counts
  store.addRequest(request({ cost_usd: 7, started_at: start - 1 })); // last month does not
  store.addRequest(request({ cost_usd: 3, route_id: "arm" })); // another route does not
  expect(store.spentSince("home", start)).toBe(1.75);
  expect(store.spentSince("arm", start)).toBe(3);
});

test("a failed request that cost something counts; a request of unknown cost counts as nothing", () => {
  const store = storeWithRoutes();
  store.addRequest(request({ cost_usd: 0.5, failure: "stream_error" }));
  store.addRequest(request({ cost_usd: null, cost_source: "unknown" }));
  expect(store.spentSince("home", 0)).toBe(0.5);
});

test("a route with no requests has spent nothing", () => {
  expect(storeWithRoutes().spentSince("home", 0)).toBe(0);
});

test("spend is reported per route for the month and for today", () => {
  const store = storeWithRoutes();
  const day = dayStart(now).getTime();
  store.addRequest(request({ cost_usd: 1 }));
  store.addRequest(request({ cost_usd: 2, started_at: day - 1 }));
  store.addRequest(request({ cost_usd: 4, started_at: monthStart(now).getTime() - 1 }));
  expect(store.spendByRoute(monthStart(now).getTime(), day).get("home")).toEqual({ used: 3, today: 1 });
});
