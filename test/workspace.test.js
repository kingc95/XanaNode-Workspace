import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildWorkspace, computeKnowledgeHealth, createNode, deleteNode, exportWorkspacePack, initWorkspace, openPackAsWorkspace, openWorkspace, planNodeDeletion } from "../src/index.js";

test("workspace init, node creation, health, and build", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xananode-workspace-"));
  const workspace = await initWorkspace(dir, { name: "Workspace Test", author: "Test Author", git: false });
  assert.equal(workspace.manifest.name, "Workspace Test");
  assert.ok(fs.existsSync(path.join(dir, ".xananode", "workspace.json")));
  assert.ok(fs.existsSync(path.join(dir, ".xananode", "authors.json")));

  await createNode(dir, { title: "A Test Claim", type: "claim", summary: "A claim created by the workspace." }, "# A Test Claim\n\nThis claim needs evidence.\n");
  fs.mkdirSync(path.join(dir, "assets", "media"), { recursive: true });
  fs.writeFileSync(path.join(dir, "assets", "media", "sample.txt"), "portable media asset");
  await createNode(dir, {
    id: "sample-media",
    title: "Sample Media",
    type: "media",
    summary: "A local file carried by the substrate.",
    asset_path: "assets/media/sample.txt",
    media_type: "text"
  }, "# Sample Media\n\nA local file carried by the substrate.\n");
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
  assert.ok(fs.existsSync(path.join(exported.outputDir, "assets", "media", "sample.txt")));
  assert.ok(exported.archivePath.endsWith(".substrate"));
  assert.ok(fs.existsSync(exported.archivePath));
  assert.equal(exported.pack.manifest.pack.mode, "mounted");
});

test("node creation keeps existing nodes when titles collide", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xananode-workspace-collision-"));
  await initWorkspace(dir, { name: "Collision Test", author: "Test Author", git: false });

  const first = await createNode(dir, { title: "Shared Title", type: "concept", summary: "First node." }, "# Shared Title\n");
  const second = await createNode(dir, { title: "Shared Title", type: "concept", summary: "Second node." }, "# Shared Title\n");

  assert.notEqual(first.filePath, second.filePath);
  assert.ok(fs.existsSync(first.filePath));
  assert.ok(fs.existsSync(second.filePath));

  const reopened = await openWorkspace(dir);
  assert.equal(reopened.nodes.filter((node) => node.title === "Shared Title").length, 2);
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

  const archiveTarget = fs.mkdtempSync(path.join(os.tmpdir(), "xananode-archive-working-copy-"));
  fs.rmSync(archiveTarget, { recursive: true, force: true });
  const archiveOpened = await openPackAsWorkspace(exported.archivePath, archiveTarget, {
    author: "Archive Author",
    git: false
  });

  assert.equal(archiveOpened.settings.mode, "working_copy");
  assert.ok(archiveOpened.nodes.some((node) => node.protocolId === "source.pack:claim/source-claim"));
  assert.ok(fs.existsSync(path.join(archiveTarget, ".xananode", "source-pack", "substrate.json")));
});

test("deleting a node removes local relationships and trail references", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xananode-workspace-delete-"));
  await initWorkspace(dir, { name: "Delete Test", namespace: "delete.test", author: "Test Author", git: false });

  await createNode(dir, {
    id: "how-to-make-a-campfire",
    title: "How do you make a campfire?",
    type: "question",
    summary: "A starting question."
  }, "# How do you make a campfire?\n");

  await createNode(dir, {
    id: "campfire-basic-answer",
    title: "A small fire starts with tinder",
    type: "response",
    subtype: "answer",
    summary: "An answer.",
    relationships: [
      { type: "answers", target: "delete.test:question/how-to-make-a-campfire" }
    ]
  }, "# A small fire starts with tinder\n");

  await createNode(dir, {
    id: "campfire-path",
    title: "Campfire Path",
    type: "trail",
    summary: "A simple path.",
    nodes: [
      "delete.test:question/how-to-make-a-campfire",
      "delete.test:response/campfire-basic-answer"
    ]
  }, "# Start Here\n");

  const plan = await planNodeDeletion(dir, "delete.test:question/how-to-make-a-campfire");
  assert.equal(plan.target.protocol_id, "delete.test:question/how-to-make-a-campfire");
  assert.equal(plan.removed_relationships.length, 1);
  assert.equal(plan.touched_trails.length, 1);

  const removed = await deleteNode(dir, "delete.test:question/how-to-make-a-campfire");
  assert.equal(removed.plan.target.protocol_id, "delete.test:question/how-to-make-a-campfire");

  const reopened = await openWorkspace(dir);
  assert.ok(!reopened.nodes.some((node) => node.protocolId === "delete.test:question/how-to-make-a-campfire"));

  const answer = reopened.nodes.find((node) => node.protocolId === "delete.test:response/campfire-basic-answer");
  assert.ok(answer);
  assert.equal(answer.data.relationships.length, 0);

  const trail = reopened.nodes.find((node) => node.protocolId === "delete.test:trail/campfire-path");
  assert.ok(trail);
  assert.deepEqual(trail.data.nodes, ["delete.test:response/campfire-basic-answer"]);
});
