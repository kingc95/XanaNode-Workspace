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

export function removeImport(rootDir, importId) {
  const file = loadImports(rootDir);
  const key = String(importId || "").trim();
  file.imports = file.imports.filter((item) => (item.id || item.url) !== key);
  saveImports(rootDir, file);
  return { id: key };
}

export function toggleImportNodeVisibility(rootDir, importId, nodeId, enabled = true) {
  const file = loadImports(rootDir);
  const key = String(importId || "").trim();
  const target = file.imports.find((item) => (item.id || item.url) === key);
  if (!target) throw new Error(`Unknown import: ${key}`);
  const disabled = new Set(Array.isArray(target.disabled_node_ids) ? target.disabled_node_ids : []);
  if (enabled) disabled.delete(nodeId);
  else disabled.add(nodeId);
  target.disabled_node_ids = [...disabled];
  target.updated_at = new Date().toISOString();
  saveImports(rootDir, file);
  return target;
}
