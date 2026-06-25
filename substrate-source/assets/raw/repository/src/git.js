import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export function hasGit(rootDir) {
  return fs.existsSync(path.join(rootDir, ".git"));
}

export function runGit(rootDir, args, options = {}) {
  const result = spawnSync("git", args, {
    cwd: rootDir,
    encoding: "utf8",
    shell: false,
    ...options
  });
  return {
    ok: result.status === 0,
    status: result.status,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
    args
  };
}

export function ensureGitRepo(rootDir, options = {}) {
  if (hasGit(rootDir)) return { initialized: false, alreadyExisted: true };
  const init = runGit(rootDir, ["init", "-b", options.defaultBranch || "main"]);
  if (!init.ok) {
    const fallback = runGit(rootDir, ["init"]);
    if (!fallback.ok) throw new Error(fallback.stderr || fallback.stdout || "Failed to initialize Git repository");
  }
  return { initialized: true, alreadyExisted: false };
}

export function gitStatus(rootDir) {
  if (!hasGit(rootDir)) return { available: false, changed: [], raw: "" };
  const result = runGit(rootDir, ["status", "--porcelain=v1"]);
  if (!result.ok) return { available: false, error: result.stderr || result.stdout, changed: [], raw: "" };
  const changed = result.stdout.split(/\r?\n/).filter(Boolean).map((line) => ({
    code: line.slice(0, 2),
    path: line.slice(3)
  }));
  return { available: true, changed, raw: result.stdout };
}

export function gitLog(rootDir, limit = 25) {
  if (!hasGit(rootDir)) return [];
  const result = runGit(rootDir, ["log", `-${limit}`, "--pretty=format:%H%x1f%an%x1f%ae%x1f%ad%x1f%s", "--date=iso"]);
  if (!result.ok) return [];
  return result.stdout.split(/\r?\n/).filter(Boolean).map((line) => {
    const [hash, authorName, authorEmail, date, subject] = line.split("\x1f");
    return { hash, authorName, authorEmail, date, subject };
  });
}

export function gitRevision(rootDir) {
  if (!hasGit(rootDir)) {
    return {
      available: false,
      branch: "",
      commit: "",
      dirty: false
    };
  }
  const branch = runGit(rootDir, ["rev-parse", "--abbrev-ref", "HEAD"]);
  const commit = runGit(rootDir, ["rev-parse", "HEAD"]);
  const status = gitStatus(rootDir);
  return {
    available: branch.ok && commit.ok,
    branch: branch.ok ? branch.stdout.trim() : "",
    commit: commit.ok ? commit.stdout.trim() : "",
    dirty: Boolean(status.changed?.length),
    changed: status.changed || []
  };
}

export function saveSnapshot(rootDir, options = {}) {
  if (!hasGit(rootDir)) ensureGitRepo(rootDir, options);
  const add = runGit(rootDir, [
    "add",
    "-A",
    "--",
    ".",
    ":(exclude).xananode/preview-hugo*"
  ]);
  if (!add.ok) throw new Error(add.stderr || add.stdout || "Failed to stage workspace changes");
  const status = gitStatus(rootDir);
  if (!status.changed.length) return { committed: false, message: "No changes to save", status };
  const message = options.message || "Save XanaNode workspace snapshot";
  const env = { ...process.env };
  if (options.authorName) env.GIT_AUTHOR_NAME = options.authorName;
  if (options.authorEmail) env.GIT_AUTHOR_EMAIL = options.authorEmail;
  if (options.authorName) env.GIT_COMMITTER_NAME = options.authorName;
  if (options.authorEmail) env.GIT_COMMITTER_EMAIL = options.authorEmail;
  const commit = runGit(rootDir, ["commit", "-m", message], { env });
  if (!commit.ok) throw new Error(commit.stderr || commit.stdout || "Failed to commit workspace snapshot");
  return { committed: true, message, output: commit.stdout, status: gitStatus(rootDir) };
}
