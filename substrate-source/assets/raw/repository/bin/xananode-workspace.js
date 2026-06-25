#!/usr/bin/env node
import { runWorkspaceCli } from "../src/cli.js";

const wantsJson = process.argv.includes("--json");

runWorkspaceCli().catch((error) => {
  if (wantsJson) {
    console.error(JSON.stringify({
      ok: false,
      tool: "xananode-workspace",
      error: {
        message: error?.message || String(error),
        stack: error?.stack || null
      }
    }, null, 2));
    process.exit(1);
  }
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
