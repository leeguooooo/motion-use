#!/usr/bin/env node
import { main } from "../src/cli.mjs";

main(process.argv.slice(2)).then(
  (code) => process.exit(code ?? 0),
  (e) => {
    console.error(`motion-use: ${e?.stack ?? e}`);
    process.exit(1);
  },
);
