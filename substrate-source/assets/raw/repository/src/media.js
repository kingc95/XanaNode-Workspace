import path from "node:path";
import fs from "node:fs";
import { analyzeTextIntake, buildSubstrate, slugify, writeMarkdownNode } from "@xananode/core";
import { copyFileIntoDirectory, ensureDir } from "./fs-utils.js";
import { getDefaultAuthor } from "./authors.js";

const mediaExtensions = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".mp4", ".mov", ".mp3", ".wav", ".pdf"]);
const sourceExtensions = new Set([".pdf", ".doc", ".docx", ".txt", ".rtf", ".csv", ".xlsx"]);
const textIntakeExtensions = new Set([".txt", ".md", ".markdown", ".csv", ".json", ".jsonl", ".yaml", ".yml", ".xml", ".html", ".htm"]);

function isTextIntakeFile(filePath) {
  return textIntakeExtensions.has(path.extname(filePath).toLowerCase());
}

function readTextExcerpt(sourceFile, maxChars = 20000) {
  const raw = fs.readFileSync(sourceFile, "utf8");
  return raw.slice(0, maxChars);
}

export async function createIntakeAnalysisContext(rootDir) {
  try {
    const substrate = await buildSubstrate(rootDir, { suggestions: false });
    return {
      nodes: substrate.nodes || [],
      fragments: substrate.fragments || []
    };
  } catch {
    return { nodes: [], fragments: [] };
  }
}

export function inferNodeTypeForFile(filePath, preferredType) {
  if (preferredType) return preferredType;
  const ext = path.extname(filePath).toLowerCase();
  if (sourceExtensions.has(ext)) return "source";
  if (mediaExtensions.has(ext)) return "media";
  return "source";
}

export async function importAssetAsNode(rootDir, sourceFile, options = {}) {
  if (!fs.existsSync(sourceFile)) throw new Error(`Asset does not exist: ${sourceFile}`);
  const author = options.author || getDefaultAuthor(rootDir);
  const type = inferNodeTypeForFile(sourceFile, options.type);
  const title = options.title || path.basename(sourceFile, path.extname(sourceFile));
  const slug = options.slug || slugify(title, "asset");
  const assetDir = path.join(rootDir, "assets", type === "media" ? "media" : "sources");
  const destination = copyFileIntoDirectory(sourceFile, assetDir);
  const relativeAsset = path.relative(rootDir, destination).replaceAll(path.sep, "/");
  const nodePath = path.join(rootDir, "content", "nodes", `${slug}.md`);
  const textExcerpt = isTextIntakeFile(sourceFile) ? readTextExcerpt(sourceFile) : "";
  const analysis = textExcerpt
    ? analyzeTextIntake(textExcerpt, {
      title,
      type,
      sourceKind: "text_file",
      nodes: options.analysisContext?.nodes || [],
      fragments: options.analysisContext?.fragments || []
    })
    : null;
  const suggestedRelationships = (analysis?.mention_relationships || []).map((relationship) => ({
    type: relationship.type,
    target: relationship.target,
    summary: relationship.summary
  }));
  const relationships = [...(options.relationships || []), ...suggestedRelationships]
    .filter((relationship, index, list) => {
      const key = `${relationship.type}:${relationship.target}`;
      return list.findIndex((item) => `${item.type}:${item.target}` === key) === index;
    });
  const body = textExcerpt
    ? `# ${title}\n\nImported asset: \`${relativeAsset}\`\n\n## Extracted text excerpt\n\n${textExcerpt.trim()}\n`
    : `# ${title}\n\nImported asset: \`${relativeAsset}\`\n`;
  const nodeData = {
    title,
    type,
    subtype: options.subtype,
    facets: Array.isArray(options.facets) ? options.facets : undefined,
    summary: options.summary || analysis?.suggested_summary || `${type === "media" ? "Media" : "Source"} asset imported into this substrate.`,
    created_by: options.created_by || author?.id || author?.name || "unknown",
    creator: options.creator,
    source_name: options.source_name,
    source_url: options.source_url,
    asset: relativeAsset,
    asset_path: relativeAsset,
    media_type: options.media_type,
    rights_status: options.rights_status || author?.default_license,
    license_url: options.license_url,
    relationships,
    intake_analysis: analysis || undefined
  };
  ensureDir(path.dirname(nodePath));
  writeMarkdownNode(nodePath, nodeData, body);
  return { nodePath, assetPath: destination, nodeData, intakeAnalysis: analysis };
}
