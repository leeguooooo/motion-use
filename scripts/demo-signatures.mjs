// Regenerate assets/demo-signatures.json from rendered demo MP4s (the starter and bundled examples):
//   node scripts/demo-signatures.mjs starter=out/my-film-en-landscape.mp4 ocs-film=examples/ocs-film/out/….mp4 …
import fs from "node:fs";
import { frameSignatures } from "../src/motion-check.mjs";

const demos = process.argv.slice(2).map((arg) => {
  const [name, file] = arg.split("=");
  return { name, ...frameSignatures(file) };
});
fs.writeFileSync(new URL("../assets/demo-signatures.json", import.meta.url), JSON.stringify(demos) + "\n");
console.log(demos.map((d) => `${d.name} ${d.orientation} ${d.frames.length}`).join("\n"));
