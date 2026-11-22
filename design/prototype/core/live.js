// Talks to the gateway the panel is served from. Everything here is plain fetch calls
// to /api; the session is the cookie the gateway sets when signing in.

export class SignedOut extends Error {}

async function call(method, path, body) {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: "same-origin",
  });
  const answer = res.status === 204 ? null : await res.json().catch(() => null);
  if (res.status === 401 && answer?.error?.code === "signed_out") throw new SignedOut();
  if (!res.ok) throw Object.assign(new Error(answer?.error?.message ?? `HTTP ${res.status}`), { code: answer?.error?.code ?? null });
  return answer;
}

// Is the page served by a gateway? Its answer, or null when it is not (the design preview).
export async function gatewayStatus() {
  try {
    const res = await fetch("/api/status", { credentials: "same-origin" });
    const answer = res.ok ? await res.json() : null;
    return typeof answer?.passwordSet === "boolean" ? answer : null;
  } catch {
    return null;
  }
}

export const api = {
  setup: (password) => call("POST", "/setup", { password }),
  login: (password) => call("POST", "/login", { password }),
  state: () => call("GET", "/state"),
  models: () => call("GET", "/models").then((answer) => answer.models),
  toggle: (id, enabled) => call("PATCH", `/routes/${encodeURIComponent(id)}`, { enabled }),
  budget: (id, budget) => call("PATCH", `/routes/${encodeURIComponent(id)}`, { budget }),
  addProvider: (kind, key) => call("POST", "/providers", { kind, key }),
  testProvider: (id) => call("POST", `/providers/${encodeURIComponent(id)}/test`),
  removeProvider: (id) => call("DELETE", `/providers/${encodeURIComponent(id)}`),
  makeRoute: (route) => call("POST", "/routes", route),
  newKey: (id) => call("POST", `/routes/${encodeURIComponent(id)}/key`),
  setModels: (id, models) => call("PATCH", `/routes/${encodeURIComponent(id)}`, { models }),
  deleteRoute: (id) => call("DELETE", `/routes/${encodeURIComponent(id)}`),
  password: (current, password) => call("POST", "/password", { current, password }),
  logout: () => call("POST", "/logout"),
};

// The gateway's state, in the shape of core/data.js, so skins and screens draw it
// exactly as they draw the made-up data. Requests of a removed route are left out.
export function toData(state) {
  const routes = state.routes.map((r) => ({
    id: r.id, name: { en: r.name, tr: r.name }, icon: r.icon, color: r.color, enabled: r.enabled, busy: r.busy,
    today: r.today, used: r.used, budget: r.budget, keyHint: r.keyHint, models: r.models,
  }));
  const known = new Set(routes.map((r) => r.id));
  const request = (q) => ({
    route: q.route, model: q.model ?? q.requestedModel ?? "", seconds: q.totalMs / 1000, cost: q.cost ?? 0,
    ago: Math.max(0, Math.round((state.now - q.at) / 1000)), ok: q.ok,
  });
  return {
    address: `${location.origin}/v1`,
    spend: state.spend,
    providers: state.providers.map((p) => ({
      id: p.id, kind: p.kind, name: p.name, status: p.status, keyHint: p.keyHint, models: p.models ?? 0, ...(p.error ? { error: p.error } : {}),
    })),
    routes,
    requests: state.requests.filter((q) => known.has(q.route)).map(request),
    last: state.last && known.has(state.last.route) ? request(state.last) : null,
  };
}
