// Keeping the images and sound routes make: files on disk, a row each, and the panel's view of them.
import { afterEach, beforeEach, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { imagesIn, MediaKeeper, promptOf, sniff } from "../src/media.ts";
import { migrate, MIGRATIONS, openDb, Store } from "../src/store.ts";
import { fixtureBytes } from "./fake-openrouter.ts";
import { startGateway, until, type Gateway } from "./harness.ts";

// The 1×1 PNG every image fixture carries.
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const pngBytes = new Uint8Array(Buffer.from(PNG, "base64"));
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"><script>alert(1)</script><rect width="4" height="4"/></svg>';

let dir: string;
let gw: Gateway;
let auth: Record<string, string>;
beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "baserouter-media-"));
  gw = startGateway({ mediaDir: dir });
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

// The kept images (or with kind=audio, sounds), as the panel asks for them.
async function listed(query = "", kind = "image"): Promise<{ images: Record<string, any>[]; space: Record<string, unknown> }> {
  const answer = (await (await fetch(`${gw.url}/api/media?kind=${kind}${query.replace("?", "&")}`, { headers: auth })).json()) as { media: Record<string, any>[]; space: Record<string, unknown> };
  return { images: answer.media, space: answer.space };
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
      id: expect.any(String), kind: "image", route: route.id, at: expect.any(Number), model: "recraft/recraft-v4.1-flash", prompt: "A small blue circle on white.",
      mediaType: "image/png", bytes: pngBytes.length, cost: 0.007, src: `/api/media/${list[0]!.id}`,
    },
  ]);
  expect(space).toEqual({ images: 1, sounds: 0, bytes: pngBytes.length, keeping: true, max: 1024 * 1024 * 1024 });

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

  const patched = await fetch(`${gw.url}/api/routes/${route.id}`, { method: "PATCH", headers: { ...auth, "Content-Type": "application/json" }, body: JSON.stringify({ keepMedia: false }) });
  expect(((await patched.json()) as { route: { keepMedia: boolean } }).route.keepMedia).toBe(false);
  await (await images()(route.key)).arrayBuffer();
  await gw.settled();
  expect((await listed()).images).toEqual([]);

  // The header is BaseRouter's; it is not sent on.
  expect(gw.fake.posts.length).toBe(5);

  const none = startGateway({ mediaDir: null });
  try {
    const other = none.addRoute();
    await (await fetch(`${none.url}/v1/images/generations`, { method: "POST", headers: { Authorization: `Bearer ${other.key}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: "m", prompt: "p" }) })).arrayBuffer();
    await none.settled();
    expect(none.store.mediaSpace().images).toBe(0);
  } finally {
    await none.stop();
  }
});

test("a request that failed keeps nothing, and a route made with keepMedia false keeps nothing", async () => {
  const route = gw.addRoute();
  await (await images({ model: "fixture/429" })(route.key)).arrayBuffer();
  const made = await fetch(`${gw.url}/api/routes`, { method: "POST", headers: { ...auth, "Content-Type": "application/json" }, body: JSON.stringify({ name: "Quiet", budget: 5, keepMedia: false }) });
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

  expect((await fetch(`${gw.url}/api/media/${a!.id}`, { method: "DELETE", headers: auth })).status).toBe(204);
  expect(files()).toHaveLength(1);
  expect((await fetch(`${gw.url}/api/media/${b!.id}`, { method: "DELETE", headers: auth })).status).toBe(204);
  expect(files()).toEqual([]);
  expect((await fetch(`${gw.url}/api/media/${b!.id}`, { method: "DELETE", headers: auth })).status).toBe(404);
  expect((await fetch(`${gw.url}/api/media/${b!.id}`, { headers: auth })).status).toBe(404);
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
  store.addRoute({ id: "r", name: "r", key_hash: "h", key_hint: "0000", budget_usd: 1, enabled: 1, models: "[]", icon: "code", color: "#2B62D9", keep_media: 1, created_at: 0 });
  let clock = 0;
  const keeper = new MediaKeeper({ store, now: () => ++clock, mediaDir: dir, mediaMaxBytes: maxBytes, upstream: { baseUrl: "", fetch: fetcher } });
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
  for (let i = 1; i <= 4; i++) await keeper.keepImages(made, [{ base64: pngOf(1000, i) }]);
  expect(store.mediaSpace()).toEqual({ images: 2, sounds: 0, bytes: 2000 });
  expect(files()).toHaveLength(2);
  expect(store.media({ limit: 10 }).map((i) => i.created_at)).toEqual([4, 3]);
});

test("only real images are kept: the type comes from the bytes, not from what the answer says", async () => {
  const { store, keeper, made } = keeperIn(1 << 20);
  await keeper.keepImages(made, [{ base64: Buffer.from("not an image at all").toString("base64") }, { base64: "" }, { base64: Buffer.from(SVG).toString("base64") }]);
  expect(store.media({ limit: 10 }).map((i) => i.media_type)).toEqual(["image/svg+xml"]);
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
    await keeper.keepImages(made, [{ url: `http://127.0.0.1:${server.port}/a.png` }, { url: `http://127.0.0.1:${server.port}/missing.png` }]);
    expect(store.media({ limit: 10 })).toHaveLength(1);
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

// Sound

const speak = (extra: object = {}, headers: Record<string, string> = {}) => async (key: string) =>
  fetch(`${gw.url}/v1/audio/speech`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", ...headers },
    body: JSON.stringify({ model: "hexgrad/kokoro-82m", input: "Hello from BaseRouter.", voice: "af_heart", response_format: "mp3", ...extra }),
  });
const temps = () => files().filter((f) => f.startsWith(".part-"));

test("the sound of /audio/speech is written as it streams to the client, and kept with its words and cost", async () => {
  const route = gw.addRoute();
  const res = await speak()(route.key);
  const heard = new Uint8Array(await res.arrayBuffer());
  expect(heard).toEqual(await fixtureBytes("speech.mp3"));
  await until(() => gw.lastRequest() !== null);
  await gw.settled();

  const sha = new Bun.CryptoHasher("sha256").update(heard).digest("hex");
  expect(files()).toEqual([`${sha}.mp3`]);
  const { images: sounds, space } = await listed("", "audio");
  expect(sounds).toEqual([
    {
      id: expect.any(String), kind: "audio", route: route.id, at: expect.any(Number), model: "hexgrad/kokoro-82m", prompt: "Hello from BaseRouter.",
      mediaType: "audio/mpeg", bytes: heard.length, cost: 0.00002178, src: `/api/media/${sounds[0]!.id}`,
    },
  ]);
  expect(space).toMatchObject({ images: 0, sounds: 1, bytes: heard.length });
  expect((await listed()).images).toEqual([]); // not among the images
  const state = (await (await fetch(`${gw.url}/api/state`, { headers: auth })).json()) as Record<string, any>;
  expect(state.sounds).toEqual(sounds);

  // Browsers ask for pieces of a sound to play it and to jump in it.
  const src = `${gw.url}${sounds[0]!.src}`;
  const whole = await fetch(src, { headers: auth });
  expect(whole.status).toBe(200);
  expect(whole.headers.get("accept-ranges")).toBe("bytes");
  expect(whole.headers.get("content-type")).toBe("audio/mpeg");
  const piece = await fetch(src, { headers: { ...auth, Range: "bytes=0-1" } });
  expect(piece.status).toBe(206);
  expect(piece.headers.get("content-range")).toBe(`bytes 0-1/${heard.length}`);
  expect(new Uint8Array(await piece.arrayBuffer())).toEqual(heard.subarray(0, 2));
  const tail = await fetch(src, { headers: { ...auth, Range: "bytes=-10" } });
  expect(new Uint8Array(await tail.arrayBuffer())).toEqual(heard.subarray(heard.length - 10));
  const open = await fetch(src, { headers: { ...auth, Range: "bytes=2000-" } });
  expect(open.headers.get("content-range")).toBe(`bytes 2000-${heard.length - 1}/${heard.length}`);
  expect((await fetch(src, { headers: { ...auth, Range: `bytes=${heard.length}-` } })).status).toBe(416);
});

test("sound is not kept when the request or the route says no, or when it is raw PCM", async () => {
  const route = gw.addRoute();
  await (await speak({}, { "X-BaseRouter-Save": "no" })(route.key)).arrayBuffer();
  const pcm = await speak({ response_format: "pcm" })(route.key);
  expect(pcm.headers.get("content-type")).toBe("audio/pcm");
  expect((await pcm.arrayBuffer()).byteLength).toBe(4000); // the client still gets all of it
  await fetch(`${gw.url}/api/routes/${route.id}`, { method: "PATCH", headers: { ...auth, "Content-Type": "application/json" }, body: JSON.stringify({ keepMedia: false }) });
  await (await speak()(route.key)).arrayBuffer();
  await until(() => gw.store.requests({ limit: 10 }).length === 3);
  await gw.settled();
  expect((await listed("", "audio")).images).toEqual([]);
  expect(files()).toEqual([]);
});

test("a sound the client stopped listening to is not kept, and leaves no part behind", async () => {
  const route = gw.addRoute();
  const res = await speak()(route.key);
  const reader = res.body!.getReader();
  await reader.read();
  await reader.cancel();
  await until(() => gw.lastRequest()?.failure === "client_cancelled");
  await gw.settled();
  await until(() => temps().length === 0);
  expect(files()).toEqual([]);
});

test("the sound of a chat answer is passed on but not kept", async () => {
  const route = gw.addRoute();
  await (await gw.chat(route.key, { model: "openai/gpt-audio", modalities: ["text", "audio"], audio: { voice: "alloy", format: "pcm16" }, stream: true, messages: [] })).arrayBuffer();
  await until(() => gw.lastRequest() !== null);
  await gw.settled();
  expect(files()).toEqual([]);
});

test("a file larger than the room allowed is dropped while it is written", async () => {
  const { store, keeper, made } = keeperIn(1000);
  const file = keeper.start("audio")!;
  expect(file.write(new TextEncoder().encode("ID3" + "x".repeat(600)))).toBe(true);
  expect(file.write(new Uint8Array(600))).toBe(false);
  expect(file.dropped).toBe(true);
  expect(await file.finish(made)).toBeNull();
  await until(() => temps().length === 0);
  expect(store.media({ limit: 10 })).toEqual([]);
});

test("a file of the wrong kind is not kept: a sound is not an image", async () => {
  const { store, keeper, made } = keeperIn(1 << 20);
  const file = keeper.start("image")!;
  file.write(new TextEncoder().encode("ID3\u0004rest of an mp3"));
  expect(await file.finish(made)).toBeNull();
  expect(store.media({ limit: 10 })).toEqual([]);
  expect(files()).toEqual([]);
});

test("parts left by a gateway that stopped while writing are removed when it starts", () => {
  writeFileSync(join(dir, ".part-0123456789abcdef"), "half a sound");
  keeperIn(1 << 20);
  expect(temps()).toEqual([]);
});

test("sound is told apart by its first bytes", () => {
  const of = (...b: number[]) => new Uint8Array([...b, ...new Array(16).fill(0)]);
  const ascii = (s: string) => new TextEncoder().encode(s.padEnd(16, "\0"));
  expect(sniff(ascii("ID3\u0004"))?.mediaType).toBe("audio/mpeg");
  expect(sniff(of(0xff, 0xfb, 0x90))?.mediaType).toBe("audio/mpeg");
  expect(sniff(of(0xff, 0xf3, 0x84, 0xc4))?.mediaType).toBe("audio/mpeg"); // how kokoro-82m's MP3 started, live
  expect(sniff(of(0xff, 0xf1, 0x50))?.mediaType).toBe("audio/aac");
  expect(sniff(ascii("RIFF\0\0\0\0WAVEfmt "))?.mediaType).toBe("audio/wav");
  expect(sniff(ascii("OggS"))?.mediaType).toBe("audio/ogg");
  expect(sniff(ascii("fLaC"))?.mediaType).toBe("audio/flac");
  expect(sniff(ascii("\0\0\0 ftypM4A "))?.mediaType).toBe("audio/mp4");
  expect(sniff(of(0x1a, 0x45, 0xdf, 0xa3))?.mediaType).toBe("audio/webm");
  expect(sniff(new Uint8Array(32))).toBeNull(); // silence as raw PCM
  expect(promptOf("speech", { input: [{ text: "Hi." }, { text: "Hello." }] })).toBe("Hi.\nHello.");
});

test("a database with kept images becomes one with kept media", () => {
  const db = new Database(":memory:");
  for (const step of MIGRATIONS.slice(0, 4)) db.exec(step);
  db.exec("PRAGMA user_version = 4");
  db.exec(`INSERT INTO routes (id, name, key_hash, key_hint, budget_usd, models, keep_images, created_at) VALUES ('r', 'r', 'h', '0000', 1, '[]', 0, 0);
    INSERT INTO images (id, route_id, created_at, media_type, bytes, file) VALUES ('i', 'r', 1, 'image/png', 70, 'a.png');`);
  const store = new Store(migrate(db));
  expect(store.mediaItem("i")).toMatchObject({ kind: "image", file: "a.png" });
  expect(store.route("r")!.keep_media).toBe(0);
});
