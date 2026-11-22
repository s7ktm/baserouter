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
  // what the providers offer, each with its provider's id, to find models in
  offers: () => call("GET", "/offers").then((answer) => (answer.offers ?? []).map((o) => ({ ...o, provider: o.provider ?? answer.provider }))),
  // where one provider's model can come from: that provider's own providers for it
  offerEndpoints: (model, provider) => call("GET", `/offers/endpoints?model=${encodeURIComponent(model)}${provider ? `&provider=${encodeURIComponent(provider)}` : ""}`).then((answer) => answer.providers),
  // models in BaseRouter
  createModel: (model) => call("POST", "/models", model),
  updateModel: (id, change) => call("PATCH", `/models/${encodeURIComponent(id)}`, change),
  deleteModel: (id) => call("DELETE", `/models/${encodeURIComponent(id)}`),
  toggle: (id, enabled) => call("PATCH", `/routes/${encodeURIComponent(id)}`, { enabled }),
  budget: (id, budget) => call("PATCH", `/routes/${encodeURIComponent(id)}`, { budget }),
  addProvider: (kind, key) => call("POST", "/providers", { kind, key }),
  testProvider: (id) => call("POST", `/providers/${encodeURIComponent(id)}/test`),
  removeProvider: (id) => call("DELETE", `/providers/${encodeURIComponent(id)}`),
  makeRoute: (route) => call("POST", "/routes", route),
  newKey: (id) => call("POST", `/routes/${encodeURIComponent(id)}/key`),
  setModels: (id, models) => call("PATCH", `/routes/${encodeURIComponent(id)}`, { models }),
  keepMedia: (id, keepMedia) => call("PATCH", `/routes/${encodeURIComponent(id)}`, { keepMedia }),
  deleteMedia: (id) => call("DELETE", `/media/${encodeURIComponent(id)}`),
  deleteRoute: (id) => call("DELETE", `/routes/${encodeURIComponent(id)}`),
  password: (current, password) => call("POST", "/password", { current, password }),
  logout: () => call("POST", "/logout"),
};

// The playground: a chat sent as a route (POST /api/routes/:id/try). The answer is read as it
// streams: "onText" gets each piece of it. Resolves with the request's row, which the gateway
// adds to the end of the stream (what answered, tokens, cost, timings), and what went wrong
// inside the stream, if something did. Nothing of the conversation is kept anywhere.
export async function tryChat(routeId, body, { signal, onText }) {
  const res = await fetch(`/api/routes/${encodeURIComponent(routeId)}/try`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...body, stream: true }),
    credentials: "same-origin",
    signal,
  });
  if (!res.ok || !(res.headers.get("content-type") ?? "").includes("text/event-stream")) {
    const answer = await res.json().catch(() => null);
    if (res.status === 401 && answer?.error?.code === "signed_out") throw new SignedOut();
    if (!res.ok) throw Object.assign(new Error(messageOf(answer?.error) ?? `HTTP ${res.status}`), { code: answer?.error?.code ?? null });
    // an answer that came whole, from a provider that did not stream it
    const text = answer?.choices?.[0]?.message?.content;
    if (typeof text === "string" && text) onText(text);
    return { row: null, error: messageOf(answer?.error) };
  }
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let rest = "", event = "", row = null, error = null;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    const lines = (rest + value).split("\n");
    rest = lines.pop();
    for (const raw of lines) {
      const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
      if (line === "") event = "";
      else if (line.startsWith("event:")) event = line.slice(6).trim();
      if (!line.startsWith("data:")) continue;
      let doc;
      try { doc = JSON.parse(line.slice(5)); } catch { continue; } // "[DONE]", or a line cut short
      if (event === "baserouter.request") row = doc;
      else {
        if (doc?.error) error = messageOf(doc.error) ?? "error";
        const piece = doc?.choices?.[0]?.delta?.content;
        if (typeof piece === "string" && piece) onText(piece);
      }
    }
  }
  return { row, error };
}
// The playground: an image asked for as a route (POST /api/routes/:id/try/images). The answer
// is what /v1/images/generations gives: each image as base64 or as a link. Resolves with the
// images, as sources a page can show, and the request's row, which the gateway names in a header.
// The panel shows only its own files and data URLs, so an image that came as a link (some
// models answer that way) is shown from the copy the gateway keeps, once it has kept it; when
// the route keeps nothing, it stays a link, to open.
export async function tryImage(routeId, body, { signal, keeps }) {
  const res = await fetch(`/api/routes/${encodeURIComponent(routeId)}/try/images`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    credentials: "same-origin",
    signal,
  });
  const answer = await res.json().catch(() => null);
  if (res.status === 401 && answer?.error?.code === "signed_out") throw new SignedOut();
  if (!res.ok || answer?.error) throw Object.assign(new Error(messageOf(answer?.error) ?? `HTTP ${res.status}`), { code: answer?.error?.code ?? null });
  const images = (Array.isArray(answer?.data) ? answer.data : []).map((item) =>
    typeof item?.b64_json === "string" ? `data:${item.media_type ?? typeOf(item.b64_json)};base64,${item.b64_json}` : typeof item?.url === "string" ? item.url : null).filter(Boolean);
  const id = res.headers.get("x-baserouter-request");
  const ask = () => (id ? call("GET", `/requests/${encodeURIComponent(id)}`).then((found) => found.request).catch(() => null) : Promise.resolve(null));
  let row = await ask();
  const links = images.filter((src) => !src.startsWith("data:")).length;
  // A link is fetched and kept a moment after the answer: ask again for a while, then give up.
  for (let tries = 0; links && row && (row.media ?? []).length < images.length && keeps && tries < 20 && !signal?.aborted; tries++) {
    await new Promise((done) => setTimeout(done, 750));
    row = (await ask()) ?? row;
  }
  // The kept copies are in the order of the answer's images.
  const kept = (row?.media ?? []).map((m) => m.src);
  return { images: images.map((src, i) => (src.startsWith("data:") ? src : kept[i] ?? src)), row };
}
// What a base64 image is, from how it starts, when the answer does not say.
const typeOf = (b64) => (b64.startsWith("/9j/") ? "image/jpeg" : b64.startsWith("UklGR") ? "image/webp" : b64.startsWith("R0lG") ? "image/gif" : b64.startsWith("PHN2Zy") || b64.startsWith("PD94bWw") ? "image/svg+xml" : "image/png");

const messageOf = (error) => (error == null ? null : typeof error === "string" ? error : typeof error.message === "string" ? error.message : null);

// The gateway's state, in the shape of core/data.js, so skins and screens draw it
// exactly as they draw the made-up data. Requests of a removed route are left out.
export function toData(state) {
  const routes = state.routes.map((r) => ({
    id: r.id, name: { en: r.name, tr: r.name }, icon: r.icon, color: r.color, enabled: r.enabled, busy: r.busy,
    today: r.today, used: r.used, budget: r.budget, keyHint: r.keyHint, keepMedia: r.keepMedia,
    // the names of the models a route may use
    models: (r.models ?? []).map((l) => (typeof l === "string" ? l : l.model)),
  }));
  const known = new Set(routes.map((r) => r.id));
  const media = (i) => ({
    id: i.id, kind: i.kind, route: known.has(i.route) ? i.route : null, model: i.model, prompt: i.prompt, cost: i.cost, bytes: i.bytes, src: i.src,
    ago: Math.max(0, Math.round((state.now - i.at) / 1000)),
  });
  const request = (q) => ({
    id: q.id, route: q.route, kind: q.kind ?? "chat", model: q.model ?? q.requestedModel ?? "", seconds: q.totalMs / 1000, cost: q.cost ?? 0,
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
    // Images, sounds and videos stay when their route is removed; they are then shown without one.
    images: (state.images ?? []).map(media),
    sounds: (state.sounds ?? []).map(media),
    videos: (state.videos ?? []).map(media),
    mediaSpace: state.mediaSpace ?? { images: 0, sounds: 0, videos: 0, bytes: 0, keeping: false, max: 0 },
    // models in BaseRouter: the name apps send, what it makes, the places it comes from in order
    models: (state.models ?? []).map((m) => ({ id: m.id, name: m.name, makes: m.makes ?? [], from: m.from ?? [] })),
  };
}
