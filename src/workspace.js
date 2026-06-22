import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { analyzeSubstrateIntake, buildSubstrate, initSubstrate, loadManifest, loadMarkdownNodes, loadSubstratePack, parseFrontMatter, prepareNodeRemoval, protocolIdFor, writeCanonicalPack, writeMarkdownNode, writeSubstrateArtifacts, slugify } from "@xananode/core";
import { createSubstrateArchive, extractSubstrateArchive, isSubstrateArchive, readSubstrateArchiveManifest, substrateArchiveFileName } from "./archive.js";
import { ensureDir, readJsonFile, safeRelativePath, writeJsonFile } from "./fs-utils.js";
import { addImport, loadImports, removeImport, toggleImportNodeVisibility } from "./imports.js";
import { getDefaultAuthor, loadAuthors, upsertAuthor } from "./authors.js";
import { computeKnowledgeHealth } from "./health.js";
import { ensureGitRepo, gitLog, gitRevision, gitStatus, hasGit, saveSnapshot } from "./git.js";
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
      enabled: false,
      renderer: "none",
      command: "",
      url: ""
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
      enabled: options.includeHugo === true || options.previewRenderer === "hugo",
      renderer: options.includeHugo === true || options.previewRenderer === "hugo" ? "hugo" : "none",
      command: options.includeHugo === true || options.previewRenderer === "hugo" ? (options.previewCommand || "hugo server --disableFastRender") : "",
      url: options.includeHugo === true || options.previewRenderer === "hugo" ? (options.previewUrl || "http://localhost:1313") : ""
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
  const localNodes = await loadMarkdownNodes(resolved, options.core || {});
  const mountedImports = loadMountedImportData(resolved, imports);
  const nodes = dedupeWorkspaceNodes([...localNodes, ...mountedImports.nodes]);
  return {
    rootDir: resolved,
    manifest,
    settings,
    authors,
    imports,
    localNodes,
    mountedImports,
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
  const substrate = await writeSubstrateArtifacts(path.resolve(rootDir), outputDir, {
    includePrivate: options.core?.includePrivate ?? true,
    splitArtifacts: options.splitArtifacts,
    bundleJson: options.bundleJson,
    bundleJsonl: options.bundleJsonl,
    ...options.core
  });
  return { outputDir, substrate };
}

export async function exportWorkspacePack(rootDir, options = {}) {
  const resolved = path.resolve(rootDir);
  const settings = loadWorkspaceSettings(resolved);
  const manifest = loadManifest(resolved, options.manifest || {});
  const revision = gitRevision(resolved);
  const outputDir = path.resolve(resolved, options.out || settings.build?.pack_dir || "packs/local");
  const pack = await writeCanonicalPack([resolved], outputDir, {
    id: options.id || manifest.id || manifest.namespace || "local",
    name: options.name || manifest.name || "Local XanaNode Substrate",
    namespace: options.namespace || manifest.namespace || "local",
    version: options.version || manifest.version || "0.1.0",
    description: options.description || manifest.description,
    schemaVersion: options.schemaVersion || manifest.schema_version,
    mode: options.mode || "mounted",
    repositoryUrl: options.repositoryUrl || manifest.repository?.url || "local",
    defaultBranch: revision.branch || manifest.repository?.default_branch || "main",
    buildMetadata: {
      git_branch: revision.branch || "",
      git_commit: revision.commit || "",
      dirty: revision.dirty
    },
    includePrivate: options.includePrivate === true,
    suggestionMode: options.suggestionMode || options.core?.suggestionMode || "review",
    splitArtifacts: options.splitArtifacts,
    bundleJson: options.bundleJson,
    bundleJsonl: options.bundleJsonl
  });
  const archiveSource = {
    git_branch: revision.branch || manifest.repository?.default_branch || "main",
    git_commit: revision.commit || manifest.repository?.commit || "uncommitted",
    dirty: revision.dirty,
    repository: manifest.repository?.url || "local"
  };
  const archiveDir = path.resolve(resolved, options.archiveDir || path.dirname(outputDir));
  const archivePath = path.join(archiveDir, options.archiveName || substrateArchiveFileName(pack.manifest, archiveSource));
  const portableManifest = {
    ...pack.manifest,
    repository: {
      ...(pack.manifest.repository || { type: "git", url: "local", default_branch: archiveSource.git_branch }),
      default_branch: archiveSource.git_branch,
      commit: archiveSource.git_commit
    },
    pack: {
      ...(pack.manifest.pack || {}),
      archive_name: path.basename(archivePath),
      archive_media_type: "application/vnd.xananode.substrate+json+gzip"
    }
  };
  writeJsonFile(path.join(outputDir, "substrate.json"), portableManifest);
  pack.manifest = portableManifest;
  const archive = options.archive === false
    ? null
    : createSubstrateArchive(outputDir, archivePath, {
      manifest: portableManifest,
      source: archiveSource
    });
  return { outputDir, pack, archivePath: archive?.archivePath || null, archive };
}

export async function openPackAsWorkspace(packSource, targetDir, options = {}) {
  const sourcePath = path.resolve(packSource);
  const archiveExtractionRoot = isSubstrateArchive(sourcePath)
    ? fs.mkdtempSync(path.join(os.tmpdir(), "xananode-substrate-open-"))
    : null;
  if (archiveExtractionRoot) {
    extractSubstrateArchive(sourcePath, archiveExtractionRoot, { overwrite: true });
  }
  const sourceRoot = archiveExtractionRoot || (fs.existsSync(sourcePath) && fs.statSync(sourcePath).isFile()
    ? path.dirname(sourcePath)
    : sourcePath);
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
      source: isSubstrateArchive(sourcePath) ? sourcePath : sourceRoot,
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
      source: isSubstrateArchive(sourcePath) ? sourcePath : sourceRoot
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

export async function mountSubstrateImport(rootDir, substrateSource, options = {}) {
  const resolvedRoot = path.resolve(rootDir);
  const inspected = inspectSubstratePackage(substrateSource);
  const sourcePath = path.resolve(substrateSource);
  const sourceRoot = inspected.kind === "substrate_archive"
    ? sourcePath
    : (fs.existsSync(sourcePath) && fs.statSync(sourcePath).isFile() ? path.dirname(sourcePath) : sourcePath);
  const manifest = inspected.manifest || {};
  const packId = options.id || manifest.id || manifest.namespace || slugify(manifest.name || path.basename(sourceRoot), "substrate");
  const entry = addImport(resolvedRoot, {
    id: packId,
    name: manifest.name || options.name || packId,
    namespace: manifest.namespace || "",
    version: options.version || manifest.version || "0.1.0",
    description: manifest.description || "",
    mode: options.mode || "mounted",
    path: sourceRoot,
    source: sourceRoot,
    required: options.required === true,
    repository: manifest.repository || null
  });
  return {
    entry,
    workspace: await openWorkspace(resolvedRoot)
  };
}

export function inspectSubstratePackage(source) {
  const sourcePath = path.resolve(source);
  if (isSubstrateArchive(sourcePath)) {
    return {
      source: sourcePath,
      kind: "substrate_archive",
      manifest: readSubstrateArchiveManifest(sourcePath)
    };
  }
  if (fs.existsSync(sourcePath) && fs.statSync(sourcePath).isFile()) {
    const ext = path.extname(sourcePath).toLowerCase();
    if (ext === ".json") {
      const value = readJsonFile(sourcePath, {});
      if (value?.format === "xananode.substrate-bundle@0.1.0") {
        return {
          source: sourcePath,
          kind: "substrate_bundle_json",
          manifest: value.manifest || {}
        };
      }
    }
    if (ext === ".jsonl") {
      const manifest = readManifestFromBundleJsonl(sourcePath);
      return {
        source: sourcePath,
        kind: "substrate_bundle_jsonl",
        manifest
      };
    }
  }
  const sourceRoot = fs.existsSync(sourcePath) && fs.statSync(sourcePath).isFile()
    ? path.dirname(sourcePath)
    : sourcePath;
  return {
    source: sourceRoot,
    kind: "substrate_folder",
    manifest: readJsonFile(path.join(sourceRoot, "substrate.json"), readJsonFile(path.join(sourceRoot, "pack.json"), {}))
  };
}

function readManifestFromBundleJsonl(filePath) {
  try {
    const lines = fs.readFileSync(filePath, "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    for (const line of lines) {
      const value = JSON.parse(line);
      if (value?.record_type === "bundle_manifest" && value.manifest && typeof value.manifest === "object") {
        return value.manifest;
      }
    }
  } catch {
    return {};
  }
  return {};
}

export async function validateWorkspace(rootDir, options = {}) {
  const substrate = await buildSubstrate(path.resolve(rootDir), options.core || {});
  return substrate.validation;
}

export async function computeWorkspaceStatus(rootDir, options = {}) {
  const resolved = path.resolve(rootDir);
  const workspace = await openWorkspace(resolved, options);
  const substrate = await buildSubstrate(resolved, options.core || {});
  const health = computeKnowledgeHealth(resolved, options.health || {});
  const validation = substrate.validation;
  const intake_reviews = [];

  for (const mounted of workspace.mountedImports?.packs || []) {
    intake_reviews.push({
      import: {
        ...mounted.entry,
        all_nodes: (mounted.pack.nodes || []).map((node) => ({ id: node.id, title: node.title, type: node.type })),
        visible_node_ids: (mounted.visible_nodes || []).map((node) => node.id),
        disabled_node_ids: mounted.disabled_node_ids || []
      },
      warnings: mounted.warnings || [],
      errors: mounted.errors || [],
      intake: analyzeSubstrateIntake(substrate, {
        nodes: mounted.pack.nodes || [],
        relationships: mounted.pack.relationships || []
      }, options.intake || {})
    });
  }

  return {
    workspace,
    health,
    validation,
    intake_reviews
  };
}

export async function createNode(rootDir, node, body = "", options = {}) {
  const author = options.author || getDefaultAuthor(rootDir);
  const type = node.type || "concept";
  const title = node.title || "Untitled Node";
  const namespace = loadManifest(rootDir).namespace || "local";
  const desiredSlug = node.slug || node.id || slugify(title, "node");
  const filePath = uniqueMarkdownNodePath(rootDir, options.path || path.join("content", "nodes", `${desiredSlug}.md`));
  const slug = path.basename(filePath, path.extname(filePath));
  const data = {
    title,
    type,
    summary: node.summary || "",
    created_by: node.created_by || author?.id || author?.name || "unknown",
    relationships: node.relationships || [],
    ...node,
    id: slug,
    protocol_id: protocolIdFor(slug, { ...node, type, title }, namespace)
  };
  writeMarkdownNode(filePath, data, body || `# ${title}\n\n`);
  return { filePath, data };
}

export async function updateNode(rootDir, relativeFile, nodeData, body, options = {}) {
  const filePath = safeRelativePath(rootDir, relativeFile);
  const namespace = loadManifest(rootDir).namespace || "local";
  const existing = fs.existsSync(filePath) ? parseFrontMatter(fs.readFileSync(filePath, "utf8"), filePath).data || {} : {};
  const merged = { ...existing, ...nodeData };
  const shouldRetitle = !merged.imported_from && !merged.source_node_id && !merged.pack_id && merged.pack_mode !== "mounted" && merged.pack_mode !== "imported" && merged.pack_mode !== "merged";
  const nextId = shouldRetitle ? slugify(merged.title || merged.id || existing.title || "node", "node") : slugify(merged.id || existing.id || merged.title || "node", "node");
  const nextProtocolId = merged.protocol_id && !shouldRetitle ? merged.protocol_id : protocolIdFor(nextId, { ...merged, type: merged.type || existing.type || "concept", title: merged.title || existing.title || nextId }, namespace);
  const nextData = {
    ...merged,
    id: nextId,
    protocol_id: nextProtocolId
  };
  const nextFilePath = shouldRetitle
    ? safeRelativePath(rootDir, path.join(path.dirname(filePath), `${nextId}.md`))
    : filePath;
  if (nextFilePath !== filePath && fs.existsSync(filePath)) {
    fs.mkdirSync(path.dirname(nextFilePath), { recursive: true });
    fs.renameSync(filePath, nextFilePath);
  }
  writeMarkdownNode(nextFilePath, nextData, body);
  return { filePath: nextFilePath, data: nextData };
}

export async function planNodeDeletion(rootDir, nodeRef, options = {}) {
  const resolved = path.resolve(rootDir);
  const nodes = await loadMarkdownNodes(resolved, { includeDrafts: true, ...(options.core || {}) });
  return prepareNodeRemoval(nodes, nodeRef);
}

export async function deleteNode(rootDir, nodeRef, options = {}) {
  const resolved = path.resolve(rootDir);
  const nodes = await loadMarkdownNodes(resolved, { includeDrafts: true, ...(options.core || {}) });
  const plan = prepareNodeRemoval(nodes, nodeRef);
  const byProtocolId = new Map(nodes.map((node) => [node.protocolId || node.protocol_id || node.id, node]));

  for (const affected of plan.affected_nodes) {
    const protocolId = affected.node.protocol_id || affected.node.id;
    const sourceNode = byProtocolId.get(protocolId);
    if (!sourceNode?.relativeFile) continue;
    const filePath = safeRelativePath(resolved, sourceNode.relativeFile);
    writeMarkdownNode(filePath, affected.nextData, sourceNode.body || "");
  }

  const targetNode = byProtocolId.get(plan.target.protocol_id || plan.target.id);
  if (targetNode?.fullPath && fs.existsSync(targetNode.fullPath)) {
    fs.rmSync(targetNode.fullPath, { force: true });
    pruneEmptyNodeDirectories(path.dirname(targetNode.fullPath), resolved);
  } else {
    throw new Error(`Unable to remove node file for ${plan.target.title || plan.target.id}.`);
  }

  return { plan, workspace: await openWorkspace(resolved, options) };
}

export function workspaceApi(rootDir) {
  const resolved = path.resolve(rootDir);
  return {
    rootDir: resolved,
    open: (options) => openWorkspace(resolved, options),
    build: (options) => buildWorkspace(resolved, options),
    exportPack: (options) => exportWorkspacePack(resolved, options),
    validate: (options) => validateWorkspace(resolved, options),
    status: (options) => computeWorkspaceStatus(resolved, options),
    mountImport: (substrateSource, options) => mountSubstrateImport(resolved, substrateSource, options),
    removeImport: (importId) => removeImport(resolved, importId),
    toggleImportNodeVisibility: (importId, nodeId, enabled) => toggleImportNodeVisibility(resolved, importId, nodeId, enabled),
    health: (options) => computeKnowledgeHealth(resolved, options),
    planNodeDeletion: (nodeRef, options) => planNodeDeletion(resolved, nodeRef, options),
    deleteNode: (nodeRef, options) => deleteNode(resolved, nodeRef, options),
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

function pruneEmptyNodeDirectories(startDir, rootDir) {
  let current = startDir;
  const stop = path.resolve(rootDir, "content");
  while (current.startsWith(stop) && current !== stop) {
    if (!fs.existsSync(current)) break;
    if (fs.readdirSync(current).length) break;
    fs.rmdirSync(current);
    current = path.dirname(current);
  }
}

function uniqueMarkdownNodePath(rootDir, relativePath) {
  const parsed = path.parse(String(relativePath || ""));
  const baseDir = parsed.dir || path.join("content", "nodes");
  const baseName = parsed.name || "node";
  const ext = parsed.ext || ".md";
  let candidate = safeRelativePath(rootDir, path.join(baseDir, `${baseName}${ext}`));
  let index = 2;
  while (fs.existsSync(candidate)) {
    candidate = safeRelativePath(rootDir, path.join(baseDir, `${baseName}-${index}${ext}`));
    index += 1;
  }
  return candidate;
}

function resolveImportSource(rootDir, substrateImport = {}) {
  const candidate = substrateImport.path || substrateImport.source || substrateImport.url || "";
  if (!candidate) return null;
  if (/^[a-z]+:\/\//i.test(candidate) && !candidate.startsWith("file://")) return candidate;
  if (path.isAbsolute(candidate)) return candidate;
  return path.resolve(rootDir, candidate);
}

function loadMountedImportData(rootDir, importsFile = { imports: [] }) {
  const entries = Array.isArray(importsFile?.imports) ? importsFile.imports : [];
  const nodes = [];
  const packs = [];

  for (const entry of entries) {
    const source = resolveImportSource(rootDir, entry);
    if (!source || (/^[a-z]+:\/\//i.test(source) && !source.startsWith("file://"))) {
      packs.push({
        entry,
        pack: { nodes: [], relationships: [] },
        warnings: source ? [`Remote import not loaded into Studio graph yet: ${source}`] : ["Import source could not be resolved."]
      });
      continue;
    }
    try {
      const pack = loadSubstratePack(source, {
        pack: {
          id: entry.id || entry.namespace || source,
          mode: entry.mode || "mounted"
        }
      });
      const disabledNodeIds = new Set(Array.isArray(entry.disabled_node_ids) ? entry.disabled_node_ids : []);
      const visibleNodes = (pack.nodes || []).filter((node) => !disabledNodeIds.has(node.id));
      const visibleNodeIds = new Set(visibleNodes.map((node) => node.id));
      const relationshipsBySource = new Map();
      for (const relationship of (pack.relationships || []).filter((relationship) => visibleNodeIds.has(relationship.source) && visibleNodeIds.has(relationship.target))) {
        const sourceId = relationship.source;
        if (!sourceId) continue;
        if (!relationshipsBySource.has(sourceId)) relationshipsBySource.set(sourceId, []);
        relationshipsBySource.get(sourceId).push({
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
      for (const node of visibleNodes) {
        nodes.push(normalizeMountedNodeRecord(node, entry, relationshipsBySource.get(node.id) || []));
      }
      packs.push({
        entry,
        pack,
        visible_nodes: visibleNodes,
        disabled_node_ids: [...disabledNodeIds],
        warnings: pack.warnings || [],
        errors: pack.errors || []
      });
    } catch (error) {
      packs.push({
        entry,
        pack: { nodes: [], relationships: [] },
        errors: [error.message || String(error)]
      });
    }
  }

  return { nodes, packs };
}

function normalizeMountedNodeRecord(node, entry, relationships = []) {
  const title = node.title || node.id || "Untitled";
  const protocolId = node.id || node.protocol_id || title;
  const content = node.content || `# ${title}\n\n${node.summary || ""}\n`;
  return {
    id: protocolId,
    protocolId,
    protocol_id: protocolId,
    title,
    type: node.type || "concept",
    subtype: node.subtype || "",
    subtypes: Array.isArray(node.subtypes) ? node.subtypes : [],
    facets: Array.isArray(node.facets) ? node.facets : [],
    summary: node.summary || "",
    body: content,
    content,
    relationships,
    readOnly: true,
    mounted: true,
    importId: entry.id || "",
    sourceImportId: entry.id || "",
    pack_mode: entry.mode || "mounted",
    data: {
      ...node,
      id: protocolId,
      protocol_id: protocolId,
      relationships,
      readOnly: true,
      mounted: true,
      importId: entry.id || "",
      sourceImportId: entry.id || "",
      pack_mode: entry.mode || "mounted"
    }
  };
}

function dedupeWorkspaceNodes(nodes = []) {
  const seen = new Set();
  const result = [];
  for (const node of nodes) {
    const key = String(node?.protocolId || node?.protocol_id || node?.data?.protocol_id || node?.id || node?.title || "").trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(node);
  }
  return result;
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
