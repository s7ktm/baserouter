// Keeping the images routes make: files on disk, a row each, and the panel's view of them.
import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ImageKeeper, imagesIn, promptOf, sniff } from "../src/images.ts";
import { openDb, Store } from "../src/store.ts";
import { startGateway, until, type Gateway } from "./harness.ts";

// The 1×1 PNG every image fixture carries.
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const pngBytes = new Uint8Array(Buffer.from(PNG, "base64"));
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"><script>alert(1)</script><rect width="4" height="4"/></svg>';

let dir: string;
let gw: Gateway;
let auth: Record<string, string>;
beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "baserouter-images-"));
  gw = startGateway({ imagesDir: dir });
  const res = await fetch(`${gw.url}/api/setup`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: "a test password" }) });
  auth = { Authorization: `Bearer ${((await res.json()) as { token: string }).token}` };
});
afterEach(async () => {
  await gw.stop();
  rmSync(dir, { recursive: true, force: true });
});

const images = (extra: object = {}, headers: Record<string, string> = {}) => async (key: string) =>
  fetch(`${gw.url}/v1/images/generations`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", ...headers },
    body: JSON.stringify({ model: "recraft/recraft-v4.1-flash", prompt: "A small blue circle on white.", ...extra }),
  });

async function listed(query = ""): Promise<{ images: Record<string, any>[]; space: Record<string, unknown> }> {
  return (await (await fetch(`${gw.url}/api/images${query}`, { headers: auth })).json()) as never;
}

const files = () => readdirSync(dir);

test("an image from /images/generations is kept as a file, with a row that says where it came from", async () => {
  const route = gw.addRoute();
  expect((await (await images()(route.key)).arrayBuffer()).byteLength).toBeGreaterThan(0);
  await gw.settled();

  const sha = new Bun.CryptoHasher("sha256").update(pngBytes).digest("hex");
  expect(files()).toEqual([`${sha}.png`]);
  const { images: list, space } = await listed();
  expect(list).toEqual([
    {
      id: expect.any(String), route: route.id, at: expect.any(Number), model: "recraft/recraft-v4.1-flash", prompt: "A small blue circle on white.",
      mediaType: "image/png", bytes: pngBytes.length, cost: 0.007, src: `/api/images/${list[0]!.id}`,
    },
  ]);
  expect(space).toEqual({ count: 1, bytes: pngBytes.length, keeping: true, max: 1024 * 1024 * 1024 });

  // The image is served to a signed-in panel only, and so that nothing in it can run.
  const file = await fetch(`${gw.url}${list[0]!.src}`, { headers: auth });
  expect(file.status).toBe(200);
  expect(new Uint8Array(await file.arrayBuffer())).toEqual(pngBytes);
  expect(file.headers.get("content-type")).toBe("image/png");
  expect(file.headers.get("content-security-policy")).toContain("sandbox");
  expect(file.headers.get("x-content-type-options")).toBe("nosniff");
  expect((await fetch(`${gw.url}${list[0]!.src}`)).status).toBe(401);
  expect((await fetch(`${gw.url}${list[0]!.src}?download=1`, { headers: auth })).headers.get("content-disposition")).toStartWith("attachment;");

  // It is in the state the panel reads, too.
  const state = (await (await fetch(`${gw.url}/api/state`, { headers: auth })).json()) as Record<string, any>;
  expect(state.images).toEqual(list);
});

test("images in a chat answer are kept, plain and streamed, with the last thing the user said", async () => {
  const route = gw.addRoute();
  const messages = [
    { role: "user", content: "Hello" },
    { role: "assistant", content: "Hi" },
    { role: "user", content: [{ type: "text", text: "Draw a blue circle." }, { type: "image_url", image_url: { url: `data:image/png;base64,${PNG}` } }] },
  ];
  await (await gw.chat(route.key, { model: "recraft/recraft-v4.1-flash", modalities: ["image"], messages })).arrayBuffer();
  await (await gw.chat(route.key, { model: "google/gemini-3.1-flash-lite-image", modalities: ["image", "text"], stream: true, messages })).arrayBuffer();
  await until(() => gw.store.requests({ limit: 5 }).length === 2);
  await gw.settled();

  const { images: list } = await listed();
  expect(list.map((i) => [i.model, i.prompt, i.cost])).toEqual([
    ["google/gemini-3.1-flash-lite-image", "Draw a blue circle.", 0.03360325],
    ["recraft/recraft-v4.1-flash", "Draw a blue circle.", 0.007],
  ]);
  expect(files()).toHaveLength(1); // the same bytes twice are one file
});

test("from a streamed /images answer only the finished image is kept, not the partial one", async () => {
  const route = gw.addRoute();
  await (await images({ stream: true })(route.key)).arrayBuffer();
  await until(() => gw.lastRequest() !== null);
  await gw.settled();
  expect((await listed()).images).toHaveLength(1);
});

test("images are not kept when the request says no, when the route says no, or when nothing is kept at all", async () => {
  const route = gw.addRoute();
  for (const no of ["no", "false", "0", "OFF"]) await (await images({}, { "X-BaseRouter-Save": no })(route.key)).arrayBuffer();
  await gw.settled();
  expect((await listed()).images).toEqual([]);

  const patched = await fetch(`${gw.url}/api/routes/${route.id}`, { method: "PATCH", headers: { ...auth, "Content-Type": "application/json" }, body: JSON.stringify({ keepImages: false }) });
  expect(((await patched.json()) as { route: { keepImages: boolean } }).route.keepImages).toBe(false);
  await (await images()(route.key)).arrayBuffer();
  await gw.settled();
  expect((await listed()).images).toEqual([]);

  // The header is BaseRouter's; it is not sent on.
  expect(gw.fake.posts.length).toBe(5);

  const none = startGateway({ imagesDir: null });
  try {
    const other = none.addRoute();
    await (await fetch(`${none.url}/v1/images/generations`, { method: "POST", headers: { Authorization: `Bearer ${other.key}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: "m", prompt: "p" }) })).arrayBuffer();
    await none.settled();
    expect(none.store.imageSpace().count).toBe(0);
  } finally {
    await none.stop();
  }
});

test("a request that failed keeps nothing, and a route made with keepImages false keeps nothing", async () => {
  const route = gw.addRoute();
  await (await images({ model: "fixture/429" })(route.key)).arrayBuffer();
  const made = await fetch(`${gw.url}/api/routes`, { method: "POST", headers: { ...auth, "Content-Type": "application/json" }, body: JSON.stringify({ name: "Quiet", budget: 5, keepImages: false }) });
  const { key } = (await made.json()) as { key: string };
  await (await images()(key)).arrayBuffer();
  await gw.settled();
  expect((await listed()).images).toEqual([]);
});

test("deleting an image removes its file only when no other image has the same bytes", async () => {
  const route = gw.addRoute();
  await (await images()(route.key)).arrayBuffer();
  await (await images()(route.key)).arrayBuffer();
  await gw.settled();
  const [a, b] = (await listed()).images;
  expect(files()).toHaveLength(1);
  expect((await listed()).space.bytes).toBe(pngBytes.length);

  expect((await fetch(`${gw.url}/api/images/${a!.id}`, { method: "DELETE", headers: auth })).status).toBe(204);
  expect(files()).toHaveLength(1);
  expect((await fetch(`${gw.url}/api/images/${b!.id}`, { method: "DELETE", headers: auth })).status).toBe(204);
  expect(files()).toEqual([]);
  expect((await fetch(`${gw.url}/api/images/${b!.id}`, { method: "DELETE", headers: auth })).status).toBe(404);
  expect((await fetch(`${gw.url}/api/images/${b!.id}`, { headers: auth })).status).toBe(404);
});

test("images stay when their route is removed, and can be filtered by route", async () => {
  const one = gw.addRoute();
  const two = gw.addRoute();
  await (await images()(one.key)).arrayBuffer();
  await (await images()(two.key)).arrayBuffer();
  await gw.settled();
  expect((await listed(`?route=${one.id}`)).images.map((i) => i.route)).toEqual([one.id]);
  gw.store.removeRoute(one.id);
  expect((await listed()).images.map((i) => i.route)).toEqual([two.id, null]);
});

test("pages of images follow each other without gaps", async () => {
  const route = gw.addRoute();
  for (let i = 0; i < 5; i++) await (await images()(route.key)).arrayBuffer();
  await gw.settled();
  const all = (await listed()).images.map((i) => i.id);
  const first = (await listed("?limit=2")).images.map((i) => i.id);
  const rest = (await listed(`?limit=10&before=${first.at(-1)}`)).images.map((i) => i.id);
  expect([...first, ...rest]).toEqual(all);
});

// The keeper on its own

function keeperIn(maxBytes: number, fetcher: typeof fetch = fetch) {
  const store = new Store(openDb(":memory:"));
  store.addRoute({ id: "r", name: "r", key_hash: "h", key_hint: "0000", budget_usd: 1, enabled: 1, models: "[]", icon: "code", color: "#2B62D9", keep_images: 1, created_at: 0 });
  let clock = 0;
  const keeper = new ImageKeeper({ store, now: () => ++clock, imagesDir: dir, imagesMaxBytes: maxBytes, upstream: { baseUrl: "", fetch: fetcher } });
  return { store, keeper, made: { requestId: null as unknown as number, routeId: "r", model: "m", prompt: "p" } };
}

// A PNG of a given size: the signature, then filler, so each one is different.
const pngOf = (size: number, fill: number) => {
  const bytes = new Uint8Array(size).fill(fill);
  bytes.set(pngBytes.subarray(0, 8));
  return Buffer.from(bytes).toString("base64");
};

test("when images take more room than allowed, the oldest go first", async () => {
  const { store, keeper, made } = keeperIn(2500);
  for (let i = 1; i <= 4; i++) await keeper.keep(made, [{ base64: pngOf(1000, i) }]);
  expect(store.imageSpace()).toEqual({ count: 2, bytes: 2000 });
  expect(files()).toHaveLength(2);
  expect(store.images({ limit: 10 }).map((i) => i.created_at)).toEqual([4, 3]);
});

test("only real images are kept: the type comes from the bytes, not from what the answer says", async () => {
  const { store, keeper, made } = keeperIn(1 << 20);
  await keeper.keep(made, [{ base64: Buffer.from("not an image at all").toString("base64") }, { base64: "" }, { base64: Buffer.from(SVG).toString("base64") }]);
  expect(store.images({ limit: 10 }).map((i) => i.media_type)).toEqual(["image/svg+xml"]);
  expect(sniff(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))?.mediaType).toBe("image/jpeg");
  expect(sniff(new TextEncoder().encode("RIFF\0\0\0\0WEBPVP8 "))?.mediaType).toBe("image/webp");
  expect(sniff(new TextEncoder().encode("GIF89a"))?.mediaType).toBe("image/gif");
  expect(sniff(new TextEncoder().encode('<?xml version="1.0"?>\n<svg>'))?.mediaType).toBe("image/svg+xml");
  expect(sniff(new TextEncoder().encode("<html><svg>"))).toBeNull();
});

test("an image given as a link is fetched once and kept; a link that fails keeps nothing", async () => {
  const server = Bun.serve({ port: 0, fetch: (req) => (new URL(req.url).pathname === "/a.png" ? new Response(pngBytes) : new Response("gone", { status: 404 })) });
  try {
    const { store, keeper, made } = keeperIn(1 << 20);
    await keeper.keep(made, [{ url: `http://127.0.0.1:${server.port}/a.png` }, { url: `http://127.0.0.1:${server.port}/missing.png` }]);
    expect(store.images({ limit: 10 })).toHaveLength(1);
  } finally {
    await server.stop(true);
  }
});

test("images are found where OpenRouter puts them, and only https links are followed", () => {
  expect(imagesIn({ choices: [{ message: { images: [{ image_url: { url: `data:image/png;base64,${PNG}` } }] } }] })).toEqual([{ base64: PNG }]);
  expect(imagesIn({ choices: [{ delta: { images: [{ image_url: { url: "https://x/y.png" } }, { image_url: { url: "http://x/y.png" } }] } }] })).toEqual([{ url: "https://x/y.png" }]);
  expect(imagesIn({ data: [{ b64_json: PNG }, { url: "https://x/z.png" }] })).toEqual([{ base64: PNG }, { url: "https://x/z.png" }]);
  expect(imagesIn({ type: "image_generation.partial_image", b64_json: PNG })).toEqual([]);
  expect(imagesIn({ type: "image_generation.completed", b64_json: PNG })).toEqual([{ base64: PNG }]);
  expect(promptOf("images", { prompt: "x".repeat(3000) })).toHaveLength(2000);
  expect(promptOf("chat", { messages: [{ role: "user", content: [{ type: "image_url" }] }] })).toBeNull();
  expect(existsSync(dir)).toBe(true);
});
