import fs from "node:fs";
import path from "node:path";
import { buildSubstrate, initSubstrate, loadManifest, loadMarkdownNodes, loadSubstratePack, writeCanonicalPack, writeMarkdownNode, writeSubstrateArtifacts, slugify } from "@xananode/core";
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
      output_dir: "public",
      pack_dir: "packs/local"
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
      output_dir: options.outputDir || "public",
      pack_dir: options.packDir || "packs/local"
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

export async function exportWorkspacePack(rootDir, options = {}) {
  const resolved = path.resolve(rootDir);
  const settings = loadWorkspaceSettings(resolved);
  const manifest = loadManifest(resolved, options.manifest || {});
  const outputDir = path.resolve(resolved, options.out || settings.build?.pack_dir || "packs/local");
  const pack = await writeCanonicalPack([resolved], outputDir, {
    id: options.id || `${manifest.namespace || "local"}.pack`,
    name: options.name || `${manifest.name || "Local XanaNode Substrate"} Pack`,
    namespace: options.namespace || manifest.namespace || "local",
    version: options.version || manifest.version || "0.1.0",
    description: options.description || manifest.description,
    schemaVersion: options.schemaVersion || manifest.schema_version,
    mode: options.mode || "mounted"
  });
  return { outputDir, pack };
}

export async function openPackAsWorkspace(packSource, targetDir, options = {}) {
  const sourcePath = path.resolve(packSource);
  const sourceRoot = fs.existsSync(sourcePath) && fs.statSync(sourcePath).isFile()
    ? path.dirname(sourcePath)
    : sourcePath;
  if (!fs.existsSync(sourceRoot)) throw new Error(`Pack source does not exist: ${sourceRoot}`);

  const loaded = loadSubstratePack(sourceRoot, {
    pack: {
      source: sourceRoot,
      mode: "working_copy"
    }
  });
  if (loaded.errors?.length) {
    throw new Error(`Pack could not be opened: ${loaded.errors.map((error) => error.message || error.kind).join("; ")}`);
  }
  if (!loaded.nodes.length) throw new Error("Pack did not contain any node records.");

  const manifest = loaded.manifest || {};
  const name = options.name || `${manifest.name || loaded.pack.id || "Imported Pack"} Working Copy`;
  const namespace = options.namespace || manifest.namespace || slugify(name, "substrate");
  const resolvedTarget = path.resolve(targetDir);
  if (fs.existsSync(resolvedTarget) && fs.readdirSync(resolvedTarget).length && options.overwrite !== true) {
    throw new Error(`Target workspace is not empty: ${resolvedTarget}`);
  }

  ensureDir(resolvedTarget);
  ensureDir(path.join(resolvedTarget, "content", "nodes"));
  ensureDir(path.join(resolvedTarget, "assets"));
  ensureDir(workspaceDir(resolvedTarget));

  writeJsonFile(path.join(resolvedTarget, "substrate.json"), {
    id: manifest.id || namespace,
    name,
    version: manifest.version || "0.1.0",
    namespace,
    schema_version: manifest.schema_version || "xananode-core@0.5.0",
    repository: manifest.repository || { type: "git", url: "local", default_branch: "main" },
    imports: manifest.imports || [],
    extensions: manifest.extensions || [],
    maintainers: manifest.maintainers || [],
    source_pack: {
      id: manifest.id || loaded.pack.id || null,
      name: manifest.name || null,
      namespace: manifest.namespace || null,
      version: manifest.version || null,
      source: sourceRoot,
      opened_as: "working_copy",
      opened_at: new Date().toISOString()
    }
  });

  saveWorkspaceSettings(resolvedTarget, {
    ...loadWorkspaceSettings(resolvedTarget),
    mode: "working_copy",
    source_pack: {
      id: manifest.id || loaded.pack.id || null,
      name: manifest.name || null,
      namespace: manifest.namespace || null,
      version: manifest.version || null,
      source: sourceRoot
    },
    authorship: {
      status: "proposal",
      active_author_id: options.authorId || null,
      note: "This workspace is an editable copy of an existing pack. Changes are proposals until accepted by the source substrate owner."
    }
  });

  if (options.author || options.authorId || options.authorEmail) {
    upsertAuthor(resolvedTarget, {
      id: options.authorId || slugify(options.author || options.authorEmail || "working-copy-author", "author"),
      name: options.author || options.authorId || "Working Copy Author",
      email: options.authorEmail,
      default: true,
      roles: ["author", "proposer"]
    });
  }

  const uniqueRelationships = uniqueRecordsById(loaded.relationships || []);
  const uniqueNodes = uniqueRecordsById(loaded.nodes || []);
  const relationshipsBySource = new Map();
  for (const relationship of uniqueRelationships) {
    const source = relationship.source;
    if (!source) continue;
    if (!relationshipsBySource.has(source)) relationshipsBySource.set(source, []);
    relationshipsBySource.get(source).push({
      type: relationship.type || "related_to",
      target: relationship.target,
      summary: relationship.summary || "",
      ...(relationship.weight ? { weight: relationship.weight } : {}),
      ...(relationship.visibility ? { visibility: relationship.visibility } : {}),
      ...(relationship.valid_from ? { valid_from: relationship.valid_from } : {}),
      ...(relationship.valid_to ? { valid_to: relationship.valid_to } : {}),
      ...(relationship.id ? { source_relationship_id: relationship.id } : {})
    });
  }

  const usedSlugs = new Set();
  for (const node of uniqueNodes) {
    const slug = uniqueSlug(localSlugFromNode(node), usedSlugs);
    const body = node.body || node.content || `# ${node.title || node.id}\n\n${node.summary || ""}\n`;
    const data = {
      ...node,
      id: slug,
      protocol_id: node.id,
      source_node_id: node.id,
      source_pack_id: manifest.id || loaded.pack.id || "",
      workspace_copy_status: "proposal",
      relationships: [
        ...(Array.isArray(node.relationships) ? node.relationships : []),
        ...(relationshipsBySource.get(node.id) || [])
      ]
    };
    delete data.imported_from;
    delete data.pack_id;
    delete data.pack_mode;
    writeMarkdownNode(path.join(resolvedTarget, "content", "nodes", `${slug}.md`), data, body);
  }

  if (options.copySource !== false) {
    const archiveDir = path.join(workspaceDir(resolvedTarget), "source-pack");
    fs.cpSync(sourceRoot, archiveDir, {
      recursive: true,
      force: true,
      filter: (src) => !path.relative(sourceRoot, src).split(path.sep).includes(".git")
    });
  }

  if (options.git !== false) {
    ensureGitRepo(resolvedTarget, { defaultBranch: options.defaultBranch || "main" });
  }

  return openWorkspace(resolvedTarget);
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
    exportPack: (options) => exportWorkspacePack(resolved, options),
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

function localSlugFromNode(node) {
  const idTail = String(node.id || "").split(":").pop()?.replace(/\//g, "-");
  return slugify(idTail || node.slug || node.title || "node", "node");
}

function uniqueSlug(base, used) {
  let slug = base || "node";
  let index = 2;
  while (used.has(slug)) {
    slug = `${base}-${index}`;
    index += 1;
  }
  used.add(slug);
  return slug;
}

function uniqueRecordsById(records) {
  const byId = new Map();
  for (const record of records) {
    const key = record?.id || JSON.stringify(record);
    if (!byId.has(key)) byId.set(key, record);
  }
  return [...byId.values()];
}
