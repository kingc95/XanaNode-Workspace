import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaultOutDir = path.join(workspaceRoot, "substrate-source");
const generatedAt = new Date().toISOString();

const includeRoots = new Set(["bin", "src", "templates", "test"]);
const includeRootFiles = new Set(["README.md", "LICENSE", "package.json", "package-lock.json", ".gitmodules", ".gitignore"]);
const includeExtensions = new Set([".js", ".json", ".md", ".txt", ".cjs", ".mjs", ".schema", ""]);

function gitValue(args) {
  const result = spawnSync("git", args, { cwd: workspaceRoot, encoding: "utf8", shell: false });
  return result.status === 0 ? result.stdout.trim() : "";
}

function readPackageVersion() {
  try {
    return JSON.parse(fs.readFileSync(path.join(workspaceRoot, "package.json"), "utf8")).version || "0.1.0";
  } catch {
    return "0.1.0";
  }
}

function slug(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function writeText(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, value);
}

function cleanDir(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    fs.rmSync(path.join(dir, entry.name), { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
}

function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(filePath));
  return `sha256:${hash.digest("hex")}`;
}

function safeAssetRelativePath(relativePath) {
  return String(relativePath || "").replace(/\\/g, "/").replace(/^\.\//, "").replace(/\.\./g, "_");
}

function sourceUrl(relativePath) {
  return `https://github.com/kingc95/XanaNode-Workspace/blob/main/${safeAssetRelativePath(relativePath)}`;
}

function nodeKindFor(relativePath) {
  const clean = safeAssetRelativePath(relativePath);
  const ext = path.extname(clean).toLowerCase();
  if (clean.startsWith("src/") || clean.startsWith("bin/")) {
    return {
      type: "source",
      subtype: "reference_code",
      media_type: "document",
      mime_type: "text/javascript"
    };
  }
  if (clean.startsWith("templates/")) {
    return {
      type: "source",
      subtype: "workspace_template",
      media_type: "document",
      mime_type: ext === ".json" ? "application/json" : "text/markdown"
    };
  }
  if (clean.startsWith("test/")) {
    return {
      type: "source",
      subtype: "test_artifact",
      media_type: "document",
      mime_type: "text/javascript"
    };
  }
  return {
    type: "source",
    subtype: "project_document",
    media_type: "document",
    mime_type: ext === ".json" ? "application/json" : "text/markdown"
  };
}

function titleFor(relativePath) {
  const clean = safeAssetRelativePath(relativePath);
  if (clean === "README.md") return "XanaNode Workspace README";
  if (clean === "LICENSE") return "XanaNode Workspace License";
  if (clean === "package.json") return "XanaNode Workspace Package Manifest";
  if (clean === "dist/win-x64/xananode-workspace.exe") return "XanaNode Workspace Windows Executable";
  if (clean === "dist/win-x64/build-info.json") return "XanaNode Workspace Windows Build Info";
  if (clean === "dist/win-x64/README.txt") return "XanaNode Workspace Windows Runtime README";
  return clean
    .replace(/\.[^.]+$/, "")
    .split("/")
    .filter(Boolean)
    .map((part) => part.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()))
    .join(" / ");
}

function summaryFor(relativePath, kind) {
  const clean = safeAssetRelativePath(relativePath);
  if (clean === "dist/win-x64/xananode-workspace.exe") {
    return "The packaged Windows executable surface for the XanaNode Workspace reference implementation.";
  }
  if (clean === "dist/win-x64/build-info.json") {
    return "Build metadata describing the packaged Windows executable surface for XanaNode Workspace.";
  }
  if (clean === "dist/win-x64/README.txt") {
    return "Runtime notes for the packaged Windows executable surface of XanaNode Workspace.";
  }
  return `${clean} is preserved as a raw Workspace source artifact in the XanaNode Workspace substrate.`;
}

function listRepositoryFiles() {
  const files = [];
  function visit(current) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name === "substrate-source" || entry.name.startsWith(".git")) continue;
      const fullPath = path.join(current, entry.name);
      const relativePath = path.relative(workspaceRoot, fullPath).replace(/\\/g, "/");
      const top = relativePath.split("/")[0];
      if (entry.isDirectory()) {
        if (includeRoots.has(top)) {
          visit(fullPath);
        }
        continue;
      }
      if (!entry.isFile()) continue;
      const ext = path.extname(entry.name).toLowerCase();
      if (!includeRootFiles.has(relativePath) && !includeRoots.has(top)) continue;
      if (!includeExtensions.has(ext) && !includeRootFiles.has(relativePath)) continue;
      files.push(relativePath);
    }
  }
  visit(workspaceRoot);

  for (const extraPath of ["dist/win-x64/xananode-workspace.exe", "dist/win-x64/build-info.json", "dist/win-x64/README.txt"]) {
    if (fs.existsSync(path.join(workspaceRoot, extraPath))) {
      files.push(extraPath);
    }
  }

  return [...new Set(files)].sort((a, b) => a.localeCompare(b));
}

function readTextIfPossible(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (![".js", ".json", ".md", ".txt", ".cjs", ".mjs", ""].includes(ext)) return "";
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return "";
  }
}

export function buildWorkspaceSubstrateSource(outDir = defaultOutDir) {
  cleanDir(outDir);
  const version = readPackageVersion();

  const manifest = {
    id: "xananode.workspace",
    name: "XanaNode Workspace Substrate",
    version,
    namespace: "xananode.workspace",
    description: "A substrate source built directly from the XanaNode Workspace repository, preserving the local-first workspace engine, CLI surface, templates, tests, raw project documents, and packaged executable artifacts as first-class XanaNode records.",
    schema_version: "xananode-core@0.5.0",
    repository: {
      type: "git",
      url: "https://github.com/kingc95/XanaNode-Workspace.git",
      default_branch: "main"
    },
    imports: ["xananode.core"],
    build_metadata: {
      built_at: generatedAt,
      git_commit: gitValue(["rev-parse", "HEAD"]),
      git_branch: gitValue(["rev-parse", "--abbrev-ref", "HEAD"]),
      built_by: "xananode-workspace/tools/build-substrate-source.mjs"
    },
    sharing: {
      default_shareable: true,
      rules: [
        {
          selector: { namespace: "xananode.workspace" },
          shareable: true,
          scope: "public",
          reason: "The Workspace substrate is intended to be federated as a public implementation source."
        }
      ]
    }
  };

  const nodes = [
    {
      id: "xananode.workspace:project/xananode-workspace",
      title: "XanaNode Workspace",
      type: "project",
      subtype: "workspace_engine",
      importance: 5,
      summary: "The local-first workspace engine that manages substrate folders, authoring state, imports, assets, builds, and health across XanaNode tools.",
      source_url: "https://github.com/kingc95/XanaNode-Workspace",
      repository: "kingc95/XanaNode-Workspace",
      software_version: version,
      relationships: []
    },
    {
      id: "xananode.workspace:source/repository-xananode-workspace",
      title: "XanaNode Workspace Repository",
      type: "source",
      subtype: "git_repository",
      importance: 5,
      summary: "Public Git repository for the XanaNode Workspace reference implementation.",
      source_url: "https://github.com/kingc95/XanaNode-Workspace",
      repository: "kingc95/XanaNode-Workspace",
      rights_status: "external",
      relationships: []
    },
    {
      id: "xananode.workspace:technology/xananode-workspace-cli",
      title: "XanaNode Workspace CLI",
      type: "technology",
      subtype: "cli",
      importance: 4,
      summary: "The machine-facing command surface for initializing, opening, validating, building, exporting, and federating XanaNode workspaces.",
      software_version: version,
      relationships: []
    }
  ];

  const relationships = [
    {
      id: "xananode.workspace:rel/repository-documents-workspace-project",
      source: "xananode.workspace:source/repository-xananode-workspace",
      target: "xananode.workspace:project/xananode-workspace",
      type: "documents",
      summary: "The repository documents and carries the Workspace project.",
      asserted_at: generatedAt
    },
    {
      id: "xananode.workspace:rel/workspace-project-implements-core",
      source: "xananode.workspace:project/xananode-workspace",
      target: "xananode.core:project/xananode-core-sdk",
      type: "implements",
      summary: "Workspace builds on the Core SDK to manage protocol-compliant substrates as local-first working directories and transport bundles.",
      asserted_at: generatedAt
    },
    {
      id: "xananode.workspace:rel/workspace-project-uses-core-cli-contracts",
      source: "xananode.workspace:project/xananode-workspace",
      target: "xananode.core:technology/xananode-core-cli",
      type: "uses",
      summary: "Workspace depends on the Core CLI and library contract for validation, build, bundle, and protocol artifact generation.",
      asserted_at: generatedAt
    },
    {
      id: "xananode.workspace:rel/workspace-cli-supports-workspace-project",
      source: "xananode.workspace:technology/xananode-workspace-cli",
      target: "xananode.workspace:project/xananode-workspace",
      type: "supports",
      summary: "The Workspace CLI is the machine-facing executable surface of the Workspace engine.",
      asserted_at: generatedAt
    }
  ];

  for (const relativePath of listRepositoryFiles()) {
    const sourcePath = path.join(workspaceRoot, relativePath);
    const kind = relativePath.endsWith(".exe")
      ? {
          type: "technology",
          subtype: "portable_executable",
          media_type: "binary",
          mime_type: "application/vnd.microsoft.portable-executable"
        }
      : nodeKindFor(relativePath);
    const localSlug = slug(relativePath.replace(/\.[^.]+$/, "")) || "artifact";
    const nodeId = `xananode.workspace:${kind.type}/artifact-${localSlug}`;
    const assetPath = `assets/raw/repository/${safeAssetRelativePath(relativePath)}`;
    const assetTarget = path.join(outDir, assetPath);
    fs.mkdirSync(path.dirname(assetTarget), { recursive: true });
    fs.copyFileSync(sourcePath, assetTarget);
    const content = readTextIfPossible(sourcePath);
    const contentId = sha256File(sourcePath);

    nodes.push({
      id: nodeId,
      title: titleFor(relativePath),
      type: kind.type,
      subtype: kind.subtype,
      importance:
        relativePath === "README.md" ||
        relativePath === "package.json" ||
        relativePath.startsWith("src/") ||
        relativePath.startsWith("bin/") ||
        relativePath === "dist/win-x64/xananode-workspace.exe"
          ? 4
          : 3,
      summary: summaryFor(relativePath, kind),
      source_url: sourceUrl(relativePath),
      artifact_path: relativePath,
      asset_path: assetPath,
      asset_role: "repository_source",
      media_type: kind.media_type,
      mime_type: kind.mime_type,
      rights_status: "Apache-2.0",
      content_id: contentId,
      ...(content ? { content } : {}),
      source_snapshot: {
        captured_at: generatedAt,
        source_url: sourceUrl(relativePath),
        method: "archive",
        content_id: contentId,
        rights_status: "Apache-2.0",
        tool: "xananode-workspace/tools/build-substrate-source.mjs"
      },
      relationships: []
    });

    relationships.push({
      id: `xananode.workspace:rel/repository-contains-${localSlug}`,
      source: "xananode.workspace:source/repository-xananode-workspace",
      target: nodeId,
      type: "contains",
      summary: `The Workspace repository contains ${relativePath}.`,
      asserted_at: generatedAt
    });

    if (relativePath.startsWith("src/") || relativePath.startsWith("bin/") || relativePath === "dist/win-x64/xananode-workspace.exe") {
      relationships.push({
        id: `xananode.workspace:rel/${localSlug}-supports-workspace-project`,
        source: nodeId,
        target: "xananode.workspace:project/xananode-workspace",
        type: "supports",
        summary: `${titleFor(relativePath)} supports the Workspace implementation.`,
        asserted_at: generatedAt
      });
    } else if (relativePath.startsWith("templates/")) {
      relationships.push({
        id: `xananode.workspace:rel/${localSlug}-documents-workspace-project`,
        source: nodeId,
        target: "xananode.workspace:project/xananode-workspace",
        type: "documents",
        summary: `${titleFor(relativePath)} documents or scaffolds Workspace behavior.`,
        asserted_at: generatedAt
      });
    }
  }

  writeJson(path.join(outDir, "substrate.json"), manifest);
  writeJson(path.join(outDir, "nodes.json"), { nodes });
  writeJson(path.join(outDir, "relationships.json"), { relationships });
  for (const node of nodes) {
    writeJson(path.join(outDir, "nodes", `${node.type}_${slug(node.title)}.json`), node);
  }
  writeText(path.join(outDir, "README.md"), `# XanaNode Workspace Substrate

This folder is the explicit substrate source generated from the XanaNode Workspace repository.

It exists so higher layers can federate with Workspace as a normal substrate instead of inferring Workspace facts ad hoc.

Regenerate it from the repository root with:

\`\`\`powershell
node tools/build-substrate-source.mjs
\`\`\`

Or from \`XanaNode-Master\`:

\`\`\`powershell
npm run workspace:build-substrate-source
\`\`\`
`);

  return {
    outDir,
    manifest,
    nodeCount: nodes.length,
    relationshipCount: relationships.length
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = buildWorkspaceSubstrateSource();
  console.log(`Workspace substrate source: ${result.outDir}`);
  console.log(`  Nodes: ${result.nodeCount}`);
  console.log(`  Relationships: ${result.relationshipCount}`);
}
