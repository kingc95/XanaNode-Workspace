import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { addImport } from "./imports.js";
import { gitRevision } from "./git.js";

const workspacePackageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bundledProtocolRoot = path.join(workspacePackageRoot, "vendor", "xananode-core", "vendor", "xananode-protocol");

export function loadFederationTargets(options = {}) {
  const registryPath = options.registryPath || path.join(bundledProtocolRoot, "registry", "federation-targets.json");
  if (!fs.existsSync(registryPath)) return { federation_targets: [] };
  return JSON.parse(fs.readFileSync(registryPath, "utf8"));
}

export function listFederationTargets(options = {}) {
  return loadFederationTargets(options).federation_targets || [];
}

export function cloneFederationTarget(target, destinationDir, options = {}) {
  const record = typeof target === "string"
    ? listFederationTargets(options).find((candidate) => candidate.id === target || candidate.namespace === target)
    : target;
  if (!record?.repository?.url) throw new Error(`Unknown federation target: ${target}`);

  const branch = options.branch || record.repository.branch || record.repository.default_branch || "main";
  const targetDir = path.resolve(destinationDir);
  const clone = spawnSync("git", ["clone", "--branch", branch, record.repository.url, targetDir], {
    encoding: "utf8",
    shell: false
  });
  if (clone.status !== 0) throw new Error(clone.stderr || clone.stdout || `Failed to clone federation target ${record.id}`);

  const revision = gitRevision(targetDir);
  return {
    target: record,
    path: targetDir,
    branch: revision.branch || branch,
    commit: revision.commit || "",
    name: federatedSubstrateName(record, revision.branch || branch, revision.commit || "")
  };
}

export function mountFederationTarget(rootDir, clonedTarget, options = {}) {
  const target = clonedTarget.target || clonedTarget;
  const branch = clonedTarget.branch || target.repository?.branch || target.repository?.default_branch || "main";
  const commit = clonedTarget.commit || target.repository?.commit || "";
  return addImport(rootDir, {
    id: target.id || target.namespace,
    source: options.source || clonedTarget.path || target.repository?.url,
    mode: options.mode || "mounted",
    version: commit ? `${branch}@${commit}` : branch,
    description: target.description || "",
    required: options.required === true,
    repository: {
      type: "git",
      url: target.repository?.url,
      branch,
      commit
    }
  });
}

export function federatedSubstrateName(target, branch, commit) {
  const shortCommit = String(commit || "unresolved").slice(0, 12);
  return `${target.name || target.id || target.namespace} (${branch}@${shortCommit})`;
}
