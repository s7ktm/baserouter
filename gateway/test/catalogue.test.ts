// The panel's list of models, made from OpenRouter's own lists.
import { expect, test } from "bun:test";
import { catalogue, perSecond } from "../src/catalogue.ts";
import { fixture } from "./fake-openrouter.ts";

const model = (id: string, makes: string[], extra: Record<string, unknown> = {}) => ({
  id, name: `Name of ${id}`, context_length: 1000, pricing: { prompt: "0.000001", completion: "0.000002" },
  architecture: { input_modalities: ["text"], output_modalities: makes }, ...extra,
});

test("each model says what it makes, in the panel's kinds, and the kinds the gateway cannot use are left out", () => {
  const list = catalogue([
    model("a/text", ["text"]),
    model("a/both", ["image", "text"]),
    model("a/chat-sound", ["audio", "text"]),
    model("a/voice", ["speech"]),
    model("a/ears", ["transcription"]),
    model("a/film", ["video"]),
    model("a/vectors", ["embeddings"]),
    model("a/rank", ["rerank"]),
    model("a/guard", ["decisions"]),
  ]);
  expect(list.map((m) => [m.id, m.makes])).toEqual([
    ["a/text", ["text"]], ["a/both", ["image", "text"]], ["a/chat-sound", ["speech", "text"]], ["a/voice", ["speech"]], ["a/ears", ["transcription"]], ["a/film", ["video"]],
  ]);
});

test("prices per token are given only for models that write text; free models say so", () => {
  const [text, image, free] = catalogue([
    model("a/text", ["text"]),
    model("a/image", ["image"], { pricing: { prompt: "0", completion: "0", image_output: "0.00003" } }),
    model("a/text:free", ["text"], { pricing: { prompt: "0", completion: "0" } }),
  ]);
  expect(text).toMatchObject({ in: 0.000001, out: 0.000002, free: false, context: 1000 });
  expect(image).toMatchObject({ in: null, out: null });
  expect(free).toMatchObject({ in: 0, out: 0, free: true });
});

test("a video model's lowest price per second comes from the video list, in dollars or cents", () => {
  expect(perSecond({ duration_seconds_480p: "0.05", duration_seconds_720p: "0.1", reference_duration_seconds_480p: "0.01" })).toBe(0.05);
  expect(perSecond({ cents_per_video_output_second_480p: "2", cents_per_image_input: "1" })).toBe(0.02);
  expect(perSecond({ cents_per_second_output: "12", minimum_cents_per_generation: "56" })).toBe(0.12);
  expect(perSecond({ video_tokens: "0.000007" })).toBeNull();
  const [film] = catalogue([model("a/film", ["video"])], [{ id: "a/film", pricing_skus: { duration_seconds_without_audio_720p: "0.03", duration_seconds_with_audio: "0.08" } }]);
  expect(film!.perSecond).toBe(0.03);
});

test("the fixture video list gives the stand-in's video models their prices", async () => {
  const videos = ((await fixture("videos-models.json").json()) as { data: unknown[] }).data;
  const list = catalogue([model("x-ai/grok-imagine-video-1.5-lite", ["video"]), model("google/veo-3.1-lite", ["video"])], videos);
  expect(list.map((m) => m.perSecond)).toEqual([0.02, 0.03]);
});

test("OpenRouter's :batch entries, served only by its Batch API, are left out", () => {
  expect(catalogue([model("a/text", ["text"]), model("a/text:batch", ["text"]), model("a/text:free", ["text"])]).map((m) => m.id)).toEqual(["a/text", "a/text:free"]);
});

test("odd entries are skipped, not trusted", () => {
  expect(catalogue([null, 3, { id: 4 }, { id: "a/x" }, model("a/ok", ["text"], { name: "", context_length: -1, pricing: { prompt: "lots" } })], "nope")).toEqual([
    { id: "a/ok", name: "a/ok", makes: ["text"], takes: ["text"], context: null, in: null, out: null, perSecond: null, free: false },
  ]);
});
