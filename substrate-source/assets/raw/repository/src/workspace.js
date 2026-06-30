import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { analyzeSubstrateIntake, buildSubstrate, createRelationshipNodeRecord, initSubstrate, loadManifest, loadMarkdownNodes, loadSubstratePack, parseFrontMatter, prepareNodeRemoval, protocolIdFor, relationshipNodeToRelationshipRecord, writeCanonicalPack, writeMarkdownNode, writeSubstrateArtifacts, slugify } from "@xananode/core";
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
  scrubWorkspaceManifest(resolved);
  scrubWorkspaceMarkdownFiles(resolved);
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
  scrubWorkspaceMarkdownFiles(rootDir);
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
    repository: normalizeProtocolRepository(manifest.repository, {
      url: "local",
      default_branch: "main"
    }),
    imports: manifest.imports || [],
    extensions: manifest.extensions || [],
    maintainers: manifest.maintainers || []
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
    const data = coerceRelationshipLikeNodeData({
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
    });
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
    repository: normalizeProtocolRepository(manifest.repository, null)
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
    const localBaseline = buildIntakeBaselineFromNodes(workspace.localNodes || []);
    intake_reviews.push({
      import: {
        ...mounted.entry,
        all_nodes: (mounted.pack.nodes || []).map((node) => ({ id: node.id, title: node.title, type: node.type })),
        visible_node_ids: (mounted.visible_nodes || []).map((node) => node.id),
        disabled_node_ids: mounted.disabled_node_ids || []
      },
      warnings: mounted.warnings || [],
      errors: mounted.errors || [],
      intake: analyzeSubstrateIntake(localBaseline, {
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
  const provisionalPath = options.path || path.join("content", "nodes", `${desiredSlug}.md`);
  const filePath = uniqueMarkdownNodePath(rootDir, provisionalPath);
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
  const workspaceNodes = await loadMarkdownNodes(rootDir, { includeDrafts: true });
  const isLocalOwned = !merged.imported_from && !merged.source_node_id && !merged.pack_id && merged.pack_mode !== "mounted" && merged.pack_mode !== "imported" && merged.pack_mode !== "merged";
  const currentRefs = new Set([
    existing.protocol_id,
    existing.id,
    merged.protocol_id,
    merged.id
  ].filter(Boolean));
  const outgoingRelationships = Array.isArray(merged.relationships)
    ? merged.relationships.filter((relationship) => relationship?.target)
    : [];
  const hasTrailStructure = (Array.isArray(merged.nodes) && merged.nodes.length > 0)
    || (Array.isArray(merged.branches) && merged.branches.length > 0);
  const hasIncomingRelationships = workspaceNodes.some((candidate) => {
    if (!candidate?.fullPath || path.resolve(candidate.fullPath) === path.resolve(filePath)) return false;
    const relationships = Array.isArray(candidate?.data?.relationships) ? candidate.data.relationships : [];
    return relationships.some((relationship) => currentRefs.has(relationship?.target));
  });
  const isUntethered = outgoingRelationships.length === 0 && !hasIncomingRelationships && !hasTrailStructure;
  const shouldRetitle = isLocalOwned && isUntethered;
  const nextId = shouldRetitle ? slugify(merged.title || merged.id || existing.title || "node", "node") : slugify(merged.id || existing.id || merged.title || "node", "node");
  const protocolSeed = shouldRetitle
    ? {
        ...merged,
        protocol_id: undefined,
        protocolId: undefined,
        type: merged.type || existing.type || "concept",
        title: merged.title || existing.title || nextId
      }
    : {
        ...merged,
        type: merged.type || existing.type || "concept",
        title: merged.title || existing.title || nextId
      };
  const nextProtocolId = merged.protocol_id && !shouldRetitle ? merged.protocol_id : protocolIdFor(nextId, protocolSeed, namespace);
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
  await pruneDuplicateProtocolFiles(rootDir, nextProtocolId, nextFilePath);
  return { filePath: nextFilePath, data: nextData };
}

export async function createRelationshipNode(rootDir, relationship, options = {}) {
  const resolved = path.resolve(rootDir);
  const author = options.author || getDefaultAuthor(resolved);
  const manifest = loadManifest(resolved);
  const sourceNode = options.sourceNode || null;
  const targetNode = options.targetNode || null;
  const nodes = await loadMarkdownNodes(resolved, { includeDrafts: true });
  const relationshipSourceRef = relationship.source || sourceNode?.protocolId || sourceNode?.protocol_id || sourceNode?.id;
  const relationshipTargetRef = relationship.target || targetNode?.protocolId || targetNode?.protocol_id || targetNode?.id;
  const sourceRecord = sourceNode || nodes.find((node) => [node.protocolId, node.protocol_id, node.id, node.relativeFile].filter(Boolean).map(String).includes(String(relationshipSourceRef))) || null;
  const targetRecord = targetNode || nodes.find((node) => [node.protocolId, node.protocol_id, node.id, node.relativeFile].filter(Boolean).map(String).includes(String(relationshipTargetRef))) || null;
  const created = createRelationshipNodeRecord({
    relationship,
    sourceNode: sourceRecord || {},
    targetNode: targetRecord || {},
    namespace: manifest.namespace || "local",
    title: options.title,
    summary: options.summary,
    body: options.body || "",
    relativeFile: options.path || "",
    evidence: options.evidence,
    confidence: options.confidence,
    status: options.status,
    reviewStatus: options.review_status,
    evidenceStrength: options.evidence_strength,
    assertedBy: options.asserted_by || author?.id || author?.name || "unknown",
    assertedAt: options.asserted_at,
    reviewedBy: options.reviewed_by,
    importance: options.importance,
    subtype: options.subtype,
    relationships: options.relationships || []
  });
  const filePath = uniqueMarkdownNodePath(resolved, options.path || path.join("content", "nodes", `${created.id}.md`));
  const body = options.body || `# ${created.data.title}\n\n`;
  writeMarkdownNode(filePath, created.data, body);
  const relationshipNodeRef = created.data.protocol_id || created.data.id;
  const relationshipNodeSummary = options.summary || `Connect this node to the promoted relationship node: ${created.data.title}.`;
  const replacementRelationship = () => omitUndefined({
    type: "related_to",
    target: relationshipNodeRef,
    summary: relationshipNodeSummary,
    ...(relationship.id ? { source_relationship_id: relationship.id } : {}),
    direction: "outgoing"
  });
  for (const endpoint of [sourceRecord, targetRecord]) {
    if (!endpoint) continue;
    const endpointRef = endpoint.protocolId || endpoint.protocol_id || endpoint.id;
    const otherRef = normalizeNodeRef(endpointRef === relationshipSourceRef ? relationshipTargetRef : relationshipSourceRef);
    const endpointPath = endpoint.fullPath ? path.resolve(endpoint.fullPath) : safeRelativePath(resolved, endpoint.relativeFile || path.join("content", "nodes", `${endpoint.id}.md`));
    if (!fs.existsSync(endpointPath)) continue;
    const parsed = parseFrontMatter(fs.readFileSync(endpointPath, "utf8"), endpointPath);
    const currentData = parsed.data || {};
    const currentRelationships = Array.isArray(currentData.relationships) ? currentData.relationships : [];
    const nextRelationships = currentRelationships.filter((candidate) => {
      if (!candidate || typeof candidate !== "object") return false;
      const candidateType = candidate.type || "related_to";
      const candidateTarget = candidate.target || candidate.to || candidate.node || candidate.id;
      if (relationship.id && candidate.source_relationship_id === relationship.id) return false;
      if (relationship.id && candidate.id === relationship.id) return false;
      if (otherRef && normalizeNodeRef(candidateTarget) === otherRef && (
        normalizeNodeRef(candidateType) === normalizeNodeRef(relationship.type || "related_to")
        || normalizeNodeRef(candidateType) === normalizeNodeRef("related_to")
      )) return false;
      return true;
    });
    nextRelationships.push(replacementRelationship());
    writeMarkdownNode(endpointPath, {
      ...currentData,
      relationships: nextRelationships
    }, parsed.body || endpoint.body || `# ${currentData.title || endpoint.title || endpoint.id}\n\n`);
  }
  return { filePath, data: created.data };
}

export async function collapseRelationshipNode(rootDir, nodeRef, options = {}) {
  const resolved = path.resolve(rootDir);
  const nodes = await loadMarkdownNodes(resolved, { includeDrafts: true, ...(options.core || {}) });
  const targetRef = typeof nodeRef === "string" ? nodeRef : nodeRef?.protocolId || nodeRef?.protocol_id || nodeRef?.id || nodeRef?.relativeFile;
  const targetNode = nodes.find((node) => {
    const candidates = [
      node.id,
      node.protocolId,
      node.protocol_id,
      node.relativeFile,
      node.fullPath,
      node.title
    ].filter(Boolean).map((value) => String(value));
    return candidates.includes(String(targetRef));
  });
  if (!targetNode) throw new Error(`Relationship node not found: ${String(targetRef || nodeRef || "unknown")}`);
  const filePath = targetNode.fullPath ? path.resolve(targetNode.fullPath) : safeRelativePath(resolved, targetNode.relativeFile || path.join("content", "nodes", `${targetNode.id}.md`));
  if (!fs.existsSync(filePath)) {
    throw new Error(`Unable to remove relationship node file for ${targetNode.title || targetNode.id}.`);
  }
  const relationship = relationshipNodeToRelationshipRecord(targetNode, options.relationship || {});
  fs.rmSync(filePath, { force: true });
  pruneEmptyNodeDirectories(path.dirname(filePath), resolved);
  return { relationship, workspace: await openWorkspace(resolved, options) };
}

async function pruneDuplicateProtocolFiles(rootDir, protocolId, keepFilePath) {
  if (!protocolId) return;
  const nodes = await loadMarkdownNodes(rootDir, { includeDrafts: true });
  const keepResolved = path.resolve(keepFilePath);
  const duplicates = nodes.filter((node) => (
    (node.protocolId || node.protocol_id || node.id) === protocolId
    && node.fullPath
    && path.resolve(node.fullPath) !== keepResolved
  ));
  for (const duplicate of duplicates) {
    if (fs.existsSync(duplicate.fullPath)) {
      fs.rmSync(duplicate.fullPath, { force: true });
    }
  }
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
    createRelationshipNode: (relationship, options) => createRelationshipNode(resolved, relationship, options),
    collapseRelationshipNode: (nodeRef, options) => collapseRelationshipNode(resolved, nodeRef, options),
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
  const normalized = coerceRelationshipLikeNodeData(node);
  const nodeType = normalized.type || "concept";
  const title = node.title || node.id || "Untitled";
  const protocolId = normalized.id || normalized.protocol_id || title;
  const content = normalized.content || node.content || `# ${title}\n\n${normalized.summary || node.summary || ""}\n`;
  return {
    id: protocolId,
    protocolId,
    protocol_id: protocolId,
    title,
    type: nodeType,
    subtype: normalized.subtype || "",
    subtypes: Array.isArray(normalized.subtypes) ? normalized.subtypes : [],
    facets: Array.isArray(normalized.facets) ? normalized.facets : [],
    summary: normalized.summary || "",
    body: content,
    content,
    relationships,
    readOnly: true,
    mounted: true,
    importId: entry.id || "",
    sourceImportId: entry.id || "",
    pack_mode: entry.mode || "mounted",
    data: {
      ...normalized,
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
  const selected = new Map();
  for (const node of nodes) {
    const key = String(node?.protocolId || node?.protocol_id || node?.data?.protocol_id || node?.id || node?.title || "").trim().toLowerCase();
    if (!key) continue;
    const candidateMtime = node?.fullPath && fs.existsSync(node.fullPath)
      ? fs.statSync(node.fullPath).mtimeMs
      : Number.NEGATIVE_INFINITY;
    const current = selected.get(key);
    const currentMtime = current?.fullPath && fs.existsSync(current.fullPath)
      ? fs.statSync(current.fullPath).mtimeMs
      : Number.NEGATIVE_INFINITY;
    if (!current || candidateMtime > currentMtime) {
      selected.set(key, node);
    }
  }
  return [...selected.values()];
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

function scrubWorkspaceManifest(rootDir) {
  const manifestPath = path.join(rootDir, "substrate.json");
  if (!fs.existsSync(manifestPath)) return;
  const manifest = readJsonFile(manifestPath, null);
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) return;
  let changed = false;
  const next = { ...manifest };
  if ("source_pack" in next) {
    delete next.source_pack;
    changed = true;
  }
  const normalizedRepository = normalizeProtocolRepository(next.repository, {
    url: "local",
    default_branch: "main"
  });
  if (JSON.stringify(next.repository || null) !== JSON.stringify(normalizedRepository)) {
    next.repository = normalizedRepository;
    changed = true;
  }
  if (changed) writeJsonFile(manifestPath, next);
}

function scrubWorkspaceMarkdownFiles(rootDir) {
  const roots = [path.join(rootDir, "content"), path.join(rootDir, "nodes")].filter((r) => fs.existsSync(r));
  const allFiles = roots.flatMap((r) => walkMarkdownFiles(r));

  // Pass 1: group all files by protocol ID, tracking newest mtime and collecting ALL relationships
  const grouped = new Map();
  for (const filePath of allFiles) {
    try {
      const raw = fs.readFileSync(filePath, "utf8");
      const parsed = parseFrontMatter(raw, filePath);
      const data = parsed?.data && typeof parsed.data === "object" ? parsed.data : {};
      const protocolId = String(data.protocol_id || data.protocolId || data.id || "").trim();
      if (!protocolId) continue;
      const mtimeMs = fs.statSync(filePath).mtimeMs;
      const existing = grouped.get(protocolId);
      const fileRels = Array.isArray(data.relationships) ? data.relationships : [];
      if (!existing) {
        grouped.set(protocolId, { filePath, mtimeMs, parsed, data, allRels: [...fileRels] });
      } else {
        // Merge relationships from this file into the accumulated set
        for (const rel of fileRels) {
          const key = `${rel.type}||${rel.target}`;
          if (!existing.allRels.some((r) => `${r.type}||${r.target}` === key)) {
            existing.allRels.push(rel);
          }
        }
        // Keep the newest file as canonical
        if (mtimeMs > existing.mtimeMs) {
          grouped.set(protocolId, { filePath, mtimeMs, parsed, data, allRels: existing.allRels });
        }
      }
    } catch { /* leave unreadable files; build validation reports them */ }
  }

  const keepFiles = new Set(Array.from(grouped.values()).map((entry) => path.resolve(entry.filePath)));

  // Pass 2: write merged relationships into canonical file, delete stale duplicates
  for (const filePath of allFiles) {
    try {
      const raw = fs.readFileSync(filePath, "utf8");
      const parsed = parseFrontMatter(raw, filePath);
      const data = parsed?.data && typeof parsed.data === "object" ? parsed.data : {};
      const protocolId = String(data.protocol_id || data.protocolId || data.id || "").trim();
      if (!protocolId) continue;
      if (!keepFiles.has(path.resolve(filePath))) {
        fs.rmSync(filePath, { force: true });
        continue;
      }
      // Write the merged relationship set back into the canonical file
      const entry = grouped.get(protocolId);
      const mergedData = { ...data, relationships: entry?.allRels ?? data.relationships ?? [] };
      const normalized = coerceRelationshipLikeNodeData(mergedData);
      if (JSON.stringify(normalized) !== JSON.stringify(data)) {
        writeMarkdownNode(filePath, normalized, parsed?.body || "");
      }
    } catch { /* ignore; normal build validation surfaces errors */ }
  }
}

function scrubWorkspaceNodeFiles(rootDir) {
  scrubWorkspaceMarkdownFiles(rootDir);
}

function walkMarkdownFiles(rootDir) {
  const files = [];
  const stack = [rootDir];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (entry.isFile() && fullPath.toLowerCase().endsWith(".md")) {
        files.push(fullPath);
      }
    }
  }
  return files;
}

function buildIntakeBaselineFromNodes(nodes = []) {
  const normalizedNodes = nodes.map((node) => normalizeIntakeNode(node));
  return {
    nodes: normalizedNodes,
    protocolNodes: normalizedNodes,
    fragments: normalizedNodes.filter((node) => node.type === "fragment"),
    relationships: relationshipRecordsFromNodes(normalizedNodes)
  };
}

function normalizeIntakeNode(node = {}) {
  const data = coerceRelationshipLikeNodeData(node.data || node);
  const protocolId = data.protocol_id || node.protocolId || node.protocol_id || data.id || node.id || "";
  return {
    ...data,
    id: protocolId,
    protocol_id: protocolId,
    protocolId,
    title: data.title || node.title || protocolId,
    type: data.type || node.type || "concept",
    body: node.body || node.content || data.content || ""
  };
}

function relationshipRecordsFromNodes(nodes = []) {
  const relationships = [];
  for (const node of nodes) {
    const source = node.protocolId || node.protocol_id || node.id;
    const nodeRelationships = Array.isArray(node.relationships) ? node.relationships : [];
    for (const relationship of nodeRelationships) {
      if (!relationship?.target) continue;
      relationships.push({
        id: relationship.id || `${source}--${relationship.type || "related_to"}--${relationship.target}`,
        source,
        target: relationship.target,
        type: relationship.type || "related_to",
        summary: relationship.summary || ""
      });
    }
  }
  return relationships;
}

function normalizeProtocolRepository(repository, fallback = { type: "git", url: "local", default_branch: "main" }) {
  const next = repository && typeof repository === "object" ? { ...repository } : {};
  const type = next.type === "git" ? "git" : (fallback?.type || "git");
  const url = next.url || fallback?.url || "local";
  const default_branch = next.default_branch || next.branch || fallback?.default_branch || "main";
  const normalized = {
    type,
    url,
    default_branch
  };
  if (next.path) normalized.path = next.path;
  if (next.commit) normalized.commit = next.commit;
  return normalized;
}

function coerceRelationshipLikeNodeData(data = {}) {
  const next = { ...data };
  const identity = [next.protocol_id, next.id, next.source_node_id, next.target_node_id].filter(Boolean).join(" ");
  const looksLikeRelationshipNode = next.type !== "relationship" && (
    identity.includes(":relationship/")
    || identity.includes("/relationship/")
    || Boolean(next.source_node && next.target_node)
    || Boolean(next.relationship_type)
  );
  if (!looksLikeRelationshipNode) return next;
  return {
    ...next,
    relationship_type: next.relationship_type || next.type || "related_to",
    type: "relationship"
  };
}
