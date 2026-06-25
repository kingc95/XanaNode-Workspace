import fs from "node:fs";
import path from "node:path";
import { gzipSync, gunzipSync } from "node:zlib";

const ARCHIVE_KIND = "xananode.substrate";
const ARCHIVE_MEDIA_TYPE = "application/vnd.xananode.substrate+json+gzip";
const ARCHIVE_VERSION = "0.1.0";
const SKIP_DIRS = new Set([".git", "node_modules", "public", "resources", ".hugo_cache"]);

export function isSubstrateArchive(filePath) {
  return String(filePath || "").toLowerCase().endsWith(".substrate");
}

export function createSubstrateArchive(sourceDir, archivePath, options = {}) {
  const rootDir = path.resolve(sourceDir);
  const files = collectArchiveFiles(rootDir);
  const archive = {
    kind: ARCHIVE_KIND,
    media_type: ARCHIVE_MEDIA_TYPE,
    archive_version: ARCHIVE_VERSION,
    created_at: options.createdAt || new Date().toISOString(),
    source: options.source || {},
    manifest: options.manifest || readJsonIfExists(path.join(rootDir, "substrate.json")),
    files: files.map((relativePath) => {
      const absolutePath = path.join(rootDir, relativePath);
      return {
        path: relativePath.replace(/\\/g, "/"),
        encoding: "base64",
        content: fs.readFileSync(absolutePath).toString("base64")
      };
    })
  };

  fs.mkdirSync(path.dirname(archivePath), { recursive: true });
  fs.writeFileSync(archivePath, gzipSync(Buffer.from(JSON.stringify(archive), "utf8"), { level: 9 }));
  return {
    archivePath,
    file_count: archive.files.length,
    manifest: archive.manifest,
    source: archive.source
  };
}

export function readSubstrateArchive(filePath) {
  const archive = parseSubstrateArchiveBuffer(fs.readFileSync(filePath), filePath);
  if (archive.kind !== ARCHIVE_KIND) {
    throw new Error(`Not a XanaNode substrate archive: ${filePath}`);
  }
  if (!Array.isArray(archive.files) && !isDirectSubstrateEnvelope(archive)) {
    throw new Error(`XanaNode substrate archive has neither a files array nor direct substrate records: ${filePath}`);
  }
  return archive;
}

export function readSubstrateArchiveManifest(filePath) {
  return readSubstrateArchive(filePath).manifest || {};
}

export function extractSubstrateArchive(filePath, targetDir, options = {}) {
  const archive = readSubstrateArchive(filePath);
  const resolvedTarget = path.resolve(targetDir);
  if (fs.existsSync(resolvedTarget) && fs.readdirSync(resolvedTarget).length && options.overwrite !== true) {
    throw new Error(`Target directory is not empty: ${resolvedTarget}`);
  }
  fs.mkdirSync(resolvedTarget, { recursive: true });
  if (Array.isArray(archive.files)) {
    for (const file of archive.files) {
      const safePath = safeArchivePath(resolvedTarget, file.path);
      fs.mkdirSync(path.dirname(safePath), { recursive: true });
      fs.writeFileSync(safePath, Buffer.from(file.content || "", file.encoding === "base64" ? "base64" : "utf8"));
    }
  } else {
    materializeDirectEnvelopeArchive(archive, resolvedTarget);
  }
  return {
    targetDir: resolvedTarget,
    manifest: archive.manifest || readJsonIfExists(path.join(resolvedTarget, "substrate.json")),
    source: archive.source || {},
    file_count: Array.isArray(archive.files) ? archive.files.length : countMaterializedEnvelopeFiles(archive)
  };
}

export function substrateArchiveFileName(manifest = {}, source = {}) {
  const namespace = slugPart(manifest.namespace || manifest.id || manifest.name || "substrate");
  const branch = slugPart(source.git_branch || manifest.repository?.default_branch || "branch");
  const commit = slugPart(String(source.git_commit || manifest.repository?.commit || "uncommitted").slice(0, 12));
  return `${namespace}-${branch}-${commit}.substrate`;
}

function collectArchiveFiles(rootDir) {
  const files = [];
  walk(rootDir, rootDir, files);
  return files.sort((a, b) => a.localeCompare(b));
}

function walk(rootDir, currentDir, files) {
  for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
    if (entry.name === ".xananode") {
      walkXananode(rootDir, path.join(currentDir, entry.name), files);
      continue;
    }
    if (entry.isDirectory() && SKIP_DIRS.has(entry.name)) continue;
    const fullPath = path.join(currentDir, entry.name);
    if (entry.isDirectory()) {
      walk(rootDir, fullPath, files);
    } else if (entry.isFile()) {
      files.push(path.relative(rootDir, fullPath));
    }
  }
}

function walkXananode(rootDir, currentDir, files) {
  for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
    if (entry.name === "preview-hugo" || entry.name.startsWith("preview-hugo-")) continue;
    const fullPath = path.join(currentDir, entry.name);
    if (entry.isDirectory()) walkXananode(rootDir, fullPath, files);
    else if (entry.isFile()) files.push(path.relative(rootDir, fullPath));
  }
}

function safeArchivePath(rootDir, relativePath) {
  const resolved = path.resolve(rootDir, String(relativePath || ""));
  if (resolved !== rootDir && !resolved.startsWith(`${rootDir}${path.sep}`)) {
    throw new Error(`Unsafe archive path: ${relativePath}`);
  }
  return resolved;
}

function readJsonIfExists(filePath) {
  try {
    if (fs.existsSync(filePath)) return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
  return null;
}

function slugPart(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64) || "unknown";
}

function parseSubstrateArchiveBuffer(buffer, filePath) {
  const source = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || "");
  if (!source.length) {
    throw new Error(`XanaNode substrate archive is empty: ${filePath}`);
  }

  if (looksLikeZip(source)) {
    throw new Error(
      `Unsupported substrate container: ${filePath}. Studio/Workspace expects a gzip-wrapped .substrate archive or a plain JSON substrate envelope, not a .zip file.`
    );
  }

  const utf8 = source.toString("utf8").trimStart();
  if (utf8.startsWith("{")) {
    try {
      return JSON.parse(utf8);
    } catch (error) {
      throw new Error(`Could not parse plain JSON substrate archive ${filePath}: ${error.message}`);
    }
  }

  try {
    return JSON.parse(gunzipSync(source).toString("utf8"));
  } catch (error) {
    throw new Error(`Could not read substrate archive ${filePath}: expected gzip-wrapped JSON or plain JSON envelope. ${error.message}`);
  }
}

function looksLikeZip(buffer) {
  return buffer.length >= 4
    && buffer[0] === 0x50
    && buffer[1] === 0x4b
    && (buffer[2] === 0x03 || buffer[2] === 0x05 || buffer[2] === 0x07)
    && (buffer[3] === 0x04 || buffer[3] === 0x06 || buffer[3] === 0x08);
}

function isDirectSubstrateEnvelope(value) {
  return Boolean(
    value
    && typeof value === "object"
    && Array.isArray(value.nodes)
    && Array.isArray(value.relationships)
  );
}

function materializeDirectEnvelopeArchive(archive, targetDir) {
  const manifest = archive.manifest && typeof archive.manifest === "object" ? archive.manifest : {};
  fs.writeFileSync(path.join(targetDir, "substrate.json"), JSON.stringify(manifest, null, 2));
  fs.writeFileSync(path.join(targetDir, "nodes.json"), JSON.stringify({ nodes: archive.nodes || [] }, null, 2));
  fs.writeFileSync(path.join(targetDir, "relationships.json"), JSON.stringify({ relationships: archive.relationships || [] }, null, 2));
}

function countMaterializedEnvelopeFiles() {
  return 3;
}
