import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildWorkspace, computeKnowledgeHealth, createNode, exportWorkspacePack, initWorkspace, openPackAsWorkspace, openWorkspace } from "../src/index.js";

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

  const exported = await exportWorkspacePack(dir, { out: path.join(dir, "packs", "workspace-test") });
  assert.ok(fs.existsSync(path.join(exported.outputDir, "substrate.json")));
  assert.ok(fs.existsSync(path.join(exported.outputDir, "nodes.json")));
  assert.ok(fs.existsSync(path.join(exported.outputDir, "relationships.json")));
  assert.equal(exported.pack.manifest.pack.mode, "mounted");
});

test("opens a substrate pack as an editable working copy", async () => {
  const source = fs.mkdtempSync(path.join(os.tmpdir(), "xananode-pack-source-"));
  await initWorkspace(source, { name: "Source Pack", namespace: "source.pack", author: "Source Author", git: false });
  await createNode(source, {
    id: "source-claim",
    title: "A portable claim",
    type: "claim",
    summary: "This claim travels in a pack."
  }, "# A portable claim\n\nPack content should become editable workspace content.\n");
  const exported = await exportWorkspacePack(source, { out: path.join(source, "packs", "source-pack") });

  const target = fs.mkdtempSync(path.join(os.tmpdir(), "xananode-pack-working-copy-"));
  fs.rmSync(target, { recursive: true, force: true });
  const opened = await openPackAsWorkspace(exported.outputDir, target, {
    author: "Review Author",
    authorId: "review-author",
    git: false
  });

  assert.equal(opened.settings.mode, "working_copy");
  assert.equal(opened.settings.authorship.status, "proposal");
  assert.ok(opened.nodes.some((node) => node.protocolId === "source.pack:claim/source-claim"));
  assert.equal(new Set(opened.nodes.map((node) => node.protocolId)).size, opened.nodes.length);
  assert.ok(fs.existsSync(path.join(target, ".xananode", "source-pack", "substrate.json")));
});
