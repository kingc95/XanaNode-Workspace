#!/usr/bin/env node
import { runWorkspaceCli } from "../src/cli.js";

runWorkspaceCli().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
