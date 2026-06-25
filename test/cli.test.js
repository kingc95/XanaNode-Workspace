import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const cliPath = path.resolve("bin", "xananode-workspace.js");

function runCli(args, cwd = process.cwd()) {
  const stdout = execFileSync(process.execPath, [cliPath, ...args], {
    cwd,
    encoding: "utf8"
  });
  return JSON.parse(stdout);
}

test("workspace cli emits machine-readable JSON envelopes", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xananode-workspace-cli-"));
  const created = runCli(["init", dir, "--name", "Workspace CLI", "--namespace", "workspace.cli", "--author", "CLI Author", "--no-git", "--json"]);
  assert.equal(created.ok, true);
  assert.equal(created.tool, "xananode-workspace");
  assert.equal(created.command, "init");
  assert.equal(created.data.manifest.namespace, "workspace.cli");

  const opened = runCli(["open", dir, "--json"]);
  assert.equal(opened.ok, true);
  assert.equal(opened.command, "open");
  assert.equal(opened.data.manifest.namespace, "workspace.cli");

  const health = runCli(["health", dir, "--json"]);
  assert.equal(health.ok, true);
  assert.equal(health.command, "health");
  assert.equal(typeof health.data.health.score, "number");
});

test("workspace cli export and snapshot aliases emit stable envelopes", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xananode-workspace-export-"));
  runCli(["init", dir, "--name", "Workspace Export", "--namespace", "workspace.export", "--author", "CLI Author", "--no-git", "--json"]);
  const exportDir = path.join(dir, "dist");
  const exported = runCli(["export", dir, "--out", exportDir, "--json"]);
  assert.equal(exported.ok, true);
  assert.equal(exported.command, "export");
  assert.equal(exported.data.output_dir, exportDir);
  assert.ok(fs.existsSync(path.join(exportDir, "substrate.json")));
});
