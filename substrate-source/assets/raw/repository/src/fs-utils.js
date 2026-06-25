import fs from "node:fs";
import path from "node:path";

export function pathExists(filePath) {
  return fs.existsSync(filePath);
}

export function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
  return dirPath;
}

export function readJsonFile(filePath, fallback = undefined) {
  if (!fs.existsSync(filePath)) return fallback;
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

export function writeJsonFile(filePath, value) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
  return filePath;
}

export function readTextFile(filePath, fallback = "") {
  if (!fs.existsSync(filePath)) return fallback;
  return fs.readFileSync(filePath, "utf8");
}

export function writeTextFile(filePath, value) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, String(value));
  return filePath;
}

export function copyFileIntoDirectory(sourceFile, destinationDir, destinationName = path.basename(sourceFile)) {
  ensureDir(destinationDir);
  const destination = path.join(destinationDir, destinationName);
  fs.copyFileSync(sourceFile, destination);
  return destination;
}

export function safeRelativePath(rootDir, candidatePath) {
  const resolvedRoot = path.resolve(rootDir);
  const resolvedCandidate = path.resolve(rootDir, candidatePath);
  const relative = path.relative(resolvedRoot, resolvedCandidate);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Path escapes workspace root: ${candidatePath}`);
  }
  return resolvedCandidate;
}

export function listFilesRecursive(rootDir, predicate = () => true) {
  const results = [];
  if (!fs.existsSync(rootDir)) return results;
  for (const entry of fs.readdirSync(rootDir, { withFileTypes: true })) {
    const fullPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) results.push(...listFilesRecursive(fullPath, predicate));
    else if (predicate(fullPath)) results.push(fullPath);
  }
  return results;
}
