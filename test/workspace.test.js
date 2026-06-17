import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildWorkspace, computeKnowledgeHealth, createNode, initWorkspace, openWorkspace } from "../src/index.js";

test("workspace init, node creation, health, and build", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xananode-workspace-"));
  const workspace = await initWorkspace(dir, { name: "Workspace Test", author: "Test Author", git: false });
  assert.equal(workspace.manifest.name, "Workspace Test");
  assert.ok(fs.existsSync(path.join(dir, ".xananode", "workspace.json")));
  assert.ok(fs.existsSync(path.join(dir, ".xananode", "authors.json")));

  await createNode(dir, { title: "A Test Claim", type: "claim", summary: "A claim created by the workspace." }, "# A Test Claim\n\nThis claim needs evidence.\n");
  const reopened = await openWorkspace(dir);
  assert.ok(reopened.nodes.length >= 3);

  const health = await computeKnowledgeHealth(dir);
  assert.ok(health.counts.nodes >= 3);
  assert.ok(typeof health.score === "number");

  const built = await buildWorkspace(dir, { out: path.join(dir, "public") });
  assert.ok(fs.existsSync(path.join(built.outputDir, "substrate.json")));
  assert.ok(fs.existsSync(path.join(built.outputDir, "relationships.json")));
});
