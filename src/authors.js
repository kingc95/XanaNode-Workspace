import path from "node:path";
import { ensureDir, readJsonFile, writeJsonFile } from "./fs-utils.js";

export function authorsPath(rootDir) {
  return path.join(rootDir, ".xananode", "authors.json");
}

export function loadAuthors(rootDir) {
  return readJsonFile(authorsPath(rootDir), { authors: [], default_author_id: null });
}

export function saveAuthors(rootDir, authorsFile) {
  ensureDir(path.join(rootDir, ".xananode"));
  return writeJsonFile(authorsPath(rootDir), authorsFile);
}

export function upsertAuthor(rootDir, author) {
  if (!author?.id) throw new Error("Author id is required");
  const file = loadAuthors(rootDir);
  const index = file.authors.findIndex((existing) => existing.id === author.id);
  const normalized = {
    id: author.id,
    name: author.name || author.id,
    email: author.email,
    website: author.website,
    github: author.github,
    orcid: author.orcid,
    public_key: author.public_key,
    default_license: author.default_license,
    roles: author.roles || ["author"],
    created_at: author.created_at || new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
  if (index >= 0) file.authors[index] = { ...file.authors[index], ...normalized };
  else file.authors.push(normalized);
  if (author.default === true || !file.default_author_id) file.default_author_id = author.id;
  saveAuthors(rootDir, file);
  return normalized;
}

export function getDefaultAuthor(rootDir) {
  const file = loadAuthors(rootDir);
  return file.authors.find((author) => author.id === file.default_author_id) || file.authors[0] || null;
}
