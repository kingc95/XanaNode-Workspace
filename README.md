# @xananode/workspace

Local-first workspace engine for **XanaNode Studio** and other editor integrations.

This package intentionally sits between:

```text
@xananode/core       protocol objects, schemas, validation, builds
@xananode/workspace  project folder, authors, Git, media, imports, health
XanaNode Studio      human UI: catalog, graph/preview, editor panels
```

The user-facing product can still be one app: **XanaNode Studio**. This package is the reusable engine inside that app.

## What it does

- Opens a XanaNode substrate folder as a workspace.
- Creates new substrates using `@xananode/core`.
- Maintains `.xananode/workspace.json`.
- Maintains `.xananode/authors.json`.
- Maintains `.xananode/imports.json` for federated substrate dependencies.
- Wraps Git as human-facing snapshots.
- Imports assets and creates `media` or `source` nodes.
- Builds and validates via `@xananode/core`.
- Computes a first-pass Knowledge Health report.

## Install

```bash
npm install @xananode/workspace @xananode/core
```

## Local development

This repository keeps the current Core SDK at `vendor/xananode-core` as a Git submodule and installs `@xananode/core` from that local checkout.

Clone with submodules:

```bash
git clone --recurse-submodules https://github.com/kingc95/XanaNode-Workspace.git
cd XanaNode-Workspace
npm install
npm test
```

If the repository is already cloned, initialize the SDK submodule:

```bash
npm run sdk:init
npm test
```

To move the SDK submodule to the latest upstream `main` commit and refresh the local package link:

```bash
npm run sdk:update
npm test
```

Useful checks:

```bash
npm run sdk:status
npm test
```

## CLI

```bash
xananode-workspace init ./my-substrate --name "My Substrate" --author "Ada Lovelace"
xananode-workspace open ./my-substrate
xananode-workspace status ./my-substrate
xananode-workspace node ./my-substrate --title "First Claim" --type claim --summary "A claim to investigate."
xananode-workspace asset ./my-substrate ./source.pdf --title "Source PDF"
xananode-workspace import ./my-substrate --id full-house-s01 --url https://example.org/full-house-s01.git
xananode-workspace build ./my-substrate --out ./my-substrate/public
xananode-workspace save ./my-substrate --message "Added first claim and source"
```

## Programmatic use

```js
import { initWorkspace, workspaceApi } from "@xananode/workspace";

await initWorkspace("./my-substrate", {
  name: "My Substrate",
  author: "Ada Lovelace",
  git: true
});

const workspace = workspaceApi("./my-substrate");
await workspace.createNode({
  title: "Evidence-Aware Knowledge",
  type: "concept",
  summary: "Knowledge represented with provenance and relationships."
});

const health = await workspace.health();
console.log(health.score);

await workspace.git.saveSnapshot({
  message: "Added evidence-aware knowledge concept"
});
```

## Workspace files

```text
substrate-root/
  substrate.json
  content/nodes/*.md
  assets/
  .xananode/
    workspace.json
    authors.json
    imports.json
    cache/
```

`.xananode` is intentionally local-first. Some files may be committed, but Studio can later decide which settings are personal and which are shared.

## Design notes

### Git is a backend, not the UX

The workspace engine uses Git, but Studio should expose friendlier concepts:

| Git term | Studio term |
|---|---|
| commit | Save snapshot |
| branch | Draft path |
| merge | Bring changes together |
| pull request | Propose change |
| diff | What changed? |
| log | History |

### Hugo is a preview/rendering adapter

Studio can run Hugo and embed the preview, but this workspace package does not depend on Hugo. Hugo remains one renderer. Core remains the protocol reference implementation.

### Imports are knowledge dependencies

Season-level substrates, schema packs, domain packs, or institutional substrates can be recorded in `.xananode/imports.json`. Later versions can resolve them through Git, package registries, static manifests, Hub, or IPFS-like storage adapters.

## Current limits

This is a first-pass engine. It does not yet implement:

- live file watching,
- OAuth/GitHub auth,
- conflict-resolution UI,
- remote sync/publish,
- schema pack marketplace,
- actual import resolution,
- Tauri/Electron desktop shell,
- Monaco/VS Code editor integration.

Those belong in the next Studio layer.
