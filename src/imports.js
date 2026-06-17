import path from "node:path";
import { readJsonFile, writeJsonFile } from "./fs-utils.js";

export function importsPath(rootDir) {
  return path.join(rootDir, ".xananode", "imports.json");
}

export function loadImports(rootDir) {
  return readJsonFile(importsPath(rootDir), { imports: [] });
}

export function saveImports(rootDir, importsFile) {
  return writeJsonFile(importsPath(rootDir), importsFile);
}

export function addImport(rootDir, substrateImport) {
  if (!substrateImport?.id && !substrateImport?.url) throw new Error("Import requires an id or url");
  const file = loadImports(rootDir);
  const key = substrateImport.id || substrateImport.url;
  const entry = {
    id: substrateImport.id || key,
    url: substrateImport.url,
    version: substrateImport.version || "latest",
    mode: substrateImport.mode || "reference",
    path: substrateImport.path,
    added_at: substrateImport.added_at || new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
  const index = file.imports.findIndex((item) => (item.id || item.url) === key);
  if (index >= 0) file.imports[index] = { ...file.imports[index], ...entry };
  else file.imports.push(entry);
  saveImports(rootDir, file);
  return entry;
}
