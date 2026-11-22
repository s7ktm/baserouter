// The gateway and its panel, in front of the fake OpenRouter, with a fresh database
// each time. For trying the panel without a real key:
//   bun test/demo.ts        then open http://localhost:4141/
// Set any password of 8 characters or more (for example "try-baserouter"), then add
// OpenRouter with the key "fixture-openrouter-key".
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FAKE_KEY, startFake } from "./fake-openrouter.ts";

const fake = startFake(Number(process.env.FAKE_OPENROUTER_PORT ?? 4142));
process.env.BASEROUTER_OPENROUTER_URL = fake.url;
process.env.BASEROUTER_DATA_DIR ??= mkdtempSync(join(tmpdir(), "baserouter-demo-"));
console.log(`Fake OpenRouter at ${fake.url}. Its key: ${FAKE_KEY}`);
console.log(`Data in ${process.env.BASEROUTER_DATA_DIR}`);
await import("../src/index.ts");
