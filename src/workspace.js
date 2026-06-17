import fs from "node:fs";
import path from "node:path";
import { buildSubstrate, initSubstrate, loadManifest, loadMarkdownNodes, writeMarkdownNode, writeSubstrateArtifacts, slugify } from "@xananode/core";
import { ensureDir, readJsonFile, safeRelativePath, writeJsonFile } from "./fs-utils.js";
import { addImport, loadImports } from "./imports.js";
import { getDefaultAuthor, loadAuthors, upsertAuthor } from "./authors.js";
import { computeKnowledgeHealth } from "./health.js";
import { ensureGitRepo, gitLog, gitStatus, hasGit, saveSnapshot } from "./git.js";
import { importAssetAsNode } from "./media.js";

export function workspaceDir(rootDir) {
  return path.join(rootDir, ".xananode");
}

export function workspaceSettingsPath(rootDir) {
  return path.join(workspaceDir(rootDir), "workspace.json");
}

export function loadWorkspaceSettings(rootDir) {
  return readJsonFile(workspaceSettingsPath(rootDir), {
    version: "0.1.0",
    created_at: null,
    updated_at: null,
    preview: {
      renderer: "hugo",
      command: "hugo server --disableFastRender",
      url: "http://localhost:1313"
    },
    build: {
      output_dir: "public"
    },
    studio: {
      default_left_view: "catalog",
      default_center_view: "preview",
      default_right_view: "node-editor"
    }
  });
}

export function saveWorkspaceSettings(rootDir, settings) {
  return writeJsonFile(workspaceSettingsPath(rootDir), {
    ...settings,
    updated_at: new Date().toISOString()
  });
}

export async function initWorkspace(targetDir, options = {}) {
  const rootDir = path.resolve(targetDir);
  initSubstrate(rootDir, options);
  ensureDir(workspaceDir(rootDir));
  const now = new Date().toISOString();
  saveWorkspaceSettings(rootDir, {
    version: "0.1.0",
    created_at: now,
    updated_at: now,
    preview: {
      renderer: options.previewRenderer || "hugo",
      command: options.previewCommand || "hugo server --disableFastRender",
      url: options.previewUrl || "http://localhost:1313"
    },
    build: {
      output_dir: options.outputDir || "public"
    },
    studio: {
      default_left_view: "catalog",
      default_center_view: "preview",
      default_right_view: "node-editor"
    }
  });
  if (options.author || options.authorEmail || options.authorId) {
    upsertAuthor(rootDir, {
      id: options.authorId || slugify(options.author || options.authorEmail || "default-author", "author"),
      name: options.author || options.authorId || "Default Author",
      email: options.authorEmail,
      default: true,
      roles: ["maintainer", "author"]
    });
  }
  if (options.git !== false) {
    ensureGitRepo(rootDir, { defaultBranch: options.defaultBranch || "main" });
  }
  return openWorkspace(rootDir);
}

export async function openWorkspace(rootDir, options = {}) {
  const resolved = path.resolve(rootDir);
  if (!fs.existsSync(resolved)) throw new Error(`Workspace directory does not exist: ${resolved}`);
  ensureDir(workspaceDir(resolved));
  const manifest = loadManifest(resolved, options.manifest || {});
  const settings = loadWorkspaceSettings(resolved);
  const authors = loadAuthors(resolved);
  const imports = loadImports(resolved);
  const nodes = await loadMarkdownNodes(resolved, options.core || {});
  return {
    rootDir: resolved,
    manifest,
    settings,
    authors,
    imports,
    nodes,
    git: {
      enabled: hasGit(resolved),
      status: gitStatus(resolved)
    }
  };
}

export async function buildWorkspace(rootDir, options = {}) {
  const settings = loadWorkspaceSettings(rootDir);
  const outputDir = path.resolve(rootDir, options.out || settings.build?.output_dir || "public");
  const substrate = await writeSubstrateArtifacts(path.resolve(rootDir), outputDir, options.core || {});
  return { outputDir, substrate };
}

export async function validateWorkspace(rootDir, options = {}) {
  const substrate = await buildSubstrate(path.resolve(rootDir), options.core || {});
  return substrate.validation;
}

export async function createNode(rootDir, node, body = "", options = {}) {
  const author = options.author || getDefaultAuthor(rootDir);
  const type = node.type || "concept";
  const title = node.title || "Untitled Node";
  const slug = node.slug || node.id || slugify(title, "node");
  const filePath = safeRelativePath(rootDir, options.path || path.join("content", "nodes", `${slug}.md`));
  const data = {
    title,
    type,
    summary: node.summary || "",
    created_by: node.created_by || author?.id || author?.name || "unknown",
    relationships: node.relationships || [],
    ...node
  };
  writeMarkdownNode(filePath, data, body || `# ${title}\n\n`);
  return { filePath, data };
}

export async function updateNode(rootDir, relativeFile, nodeData, body, options = {}) {
  const filePath = safeRelativePath(rootDir, relativeFile);
  writeMarkdownNode(filePath, nodeData, body);
  return { filePath, data: nodeData };
}

export function workspaceApi(rootDir) {
  const resolved = path.resolve(rootDir);
  return {
    rootDir: resolved,
    open: (options) => openWorkspace(resolved, options),
    build: (options) => buildWorkspace(resolved, options),
    validate: (options) => validateWorkspace(resolved, options),
    health: (options) => computeKnowledgeHealth(resolved, options),
    createNode: (node, body, options) => createNode(resolved, node, body, options),
    updateNode: (relativeFile, nodeData, body, options) => updateNode(resolved, relativeFile, nodeData, body, options),
    importAsset: (sourceFile, options) => importAssetAsNode(resolved, sourceFile, options),
    addImport: (substrateImport) => addImport(resolved, substrateImport),
    authors: {
      list: () => loadAuthors(resolved),
      upsert: (author) => upsertAuthor(resolved, author),
      default: () => getDefaultAuthor(resolved)
    },
    git: {
      init: (options) => ensureGitRepo(resolved, options),
      status: () => gitStatus(resolved),
      log: (limit) => gitLog(resolved, limit),
      saveSnapshot: (options) => saveSnapshot(resolved, options)
    },
    settings: {
      load: () => loadWorkspaceSettings(resolved),
      save: (settings) => saveWorkspaceSettings(resolved, settings)
    }
  };
}
