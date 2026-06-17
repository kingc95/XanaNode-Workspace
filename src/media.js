import path from "node:path";
import fs from "node:fs";
import { slugify, writeMarkdownNode } from "@xananode/core";
import { copyFileIntoDirectory, ensureDir } from "./fs-utils.js";
import { getDefaultAuthor } from "./authors.js";

const mediaExtensions = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".mp4", ".mov", ".mp3", ".wav", ".pdf"]);
const sourceExtensions = new Set([".pdf", ".doc", ".docx", ".txt", ".rtf", ".csv", ".xlsx"]);

export function inferNodeTypeForFile(filePath, preferredType) {
  if (preferredType) return preferredType;
  const ext = path.extname(filePath).toLowerCase();
  if (sourceExtensions.has(ext)) return "source";
  if (mediaExtensions.has(ext)) return "media";
  return "source";
}

export function importAssetAsNode(rootDir, sourceFile, options = {}) {
  if (!fs.existsSync(sourceFile)) throw new Error(`Asset does not exist: ${sourceFile}`);
  const author = options.author || getDefaultAuthor(rootDir);
  const type = inferNodeTypeForFile(sourceFile, options.type);
  const title = options.title || path.basename(sourceFile, path.extname(sourceFile));
  const slug = options.slug || slugify(title, "asset");
  const assetDir = path.join(rootDir, "assets", type === "media" ? "media" : "sources");
  const destination = copyFileIntoDirectory(sourceFile, assetDir);
  const relativeAsset = path.relative(rootDir, destination).replaceAll(path.sep, "/");
  const nodePath = path.join(rootDir, "content", "nodes", `${slug}.md`);
  const nodeData = {
    title,
    type,
    summary: options.summary || `${type === "media" ? "Media" : "Source"} asset imported into this substrate.`,
    created_by: options.created_by || author?.id || author?.name || "unknown",
    source_url: options.source_url,
    asset: relativeAsset,
    media_type: options.media_type,
    rights_status: options.rights_status || author?.default_license,
    relationships: options.relationships || []
  };
  ensureDir(path.dirname(nodePath));
  writeMarkdownNode(nodePath, nodeData, `# ${title}\n\nImported asset: \`${relativeAsset}\`\n`);
  return { nodePath, assetPath: destination, nodeData };
}
