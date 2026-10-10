import { build } from "esbuild";
await build({ entryPoints: ["src/scene.js"], bundle: true, format: "iife", outfile: "vendor/scene.js", minify: true, target: "chrome120" });
