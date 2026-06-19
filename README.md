# @xananode/workspace

A renderer-independent workspace engine for the XanaNode protocol. It exists to keep workspace, project, and collaboration concerns out of any one presentation layer. CLIs, desktop applications, web editors, and future integrations should be able to use the same workspace initialization, asset management, import tracking, and knowledge health computation.

This project is a XanaNode-compatible workspace implementation. Canonical specification: `https://github.com/kingc95/XanaNode`. Workspace/reference implementation code is licensed under `Apache-2.0`; protocol documentation is licensed separately under `CC-BY-4.0`.

This package sits between:

```text
@xananode/core       protocol objects, schemas, validation, builds
@xananode/workspace  project folder, authors, Git, media, imports, health
Future UIs           human interfaces: catalog, graph/preview, editor panels
```

## What it does

- **Initializes XanaNode substrates** in a folder with required metadata and structure.
- **Maintains workspace state** through `.xananode/workspace.json`, `.xananode/authors.json`, and `.xananode/imports.json`.
- **Manages assets** and creates media nodes or source document references.
- **Wraps Git** as human-friendly snapshots for collaboration and version history.
- **Records imports** for federated substrate dependencies.
- **Validates and builds** via `@xananode/core`.
- **Computes knowledge health** to identify gaps and quality issues.

## Install

```bash
npm install @xananode/workspace @xananode/core
```

## Quick start

### Programmatic use

```js
import { initWorkspace, workspaceApi } from "@xananode/workspace";

// Initialize a new substrate
await initWorkspace("./my-substrate", {
  name: "My Substrate",
  author: "Ada Lovelace",
  git: true
});

// Open and work with an existing substrate
const workspace = workspaceApi("./my-substrate");

// Create a node
await workspace.createNode({
  title: "Evidence-Aware Knowledge",
  type: "concept",
  summary: "Knowledge represented with provenance and relationships."
});

// Check knowledge health
const health = await workspace.health();
console.log(health.score);

// Save a snapshot
await workspace.git.saveSnapshot({
  message: "Added evidence-aware knowledge concept"
});
```

### CLI usage

```bash
# Initialize a substrate
xananode-workspace init ./my-substrate --name "My Substrate" --author "Ada Lovelace"

# Open an existing substrate
xananode-workspace open ./my-substrate

# Create a node
xananode-workspace node ./my-substrate --title "First Claim" --type claim --summary "A claim to investigate."

# Add an asset (PDF, document, etc.)
xananode-workspace asset ./my-substrate ./source.pdf --title "Source PDF"

# Import a federated substrate
xananode-workspace import ./my-substrate --id full-house-s01 --url https://example.org/full-house-s01.git

# Check workspace status
xananode-workspace status ./my-substrate

# Build the substrate for preview or export
xananode-workspace build ./my-substrate --out ./my-substrate/public

# Save progress as a Git snapshot
xananode-workspace save ./my-substrate --message "Added first claim and source"
```

## Workspace structure

```text
substrate-root/
  substrate.json          # XanaNode protocol root file
  content/nodes/*.md      # Node content in Markdown
  assets/                 # Media and external sources
  .xananode/
    workspace.json        # Workspace configuration (local-first)
    authors.json          # Author registry and credentials
    imports.json          # Federated substrate dependencies
    cache/                # Local build cache and computed data
```

`.xananode` is intentionally local-first. Some files may be committed to Git, but UI layers can later decide which settings are personal and which are shared.

## Local development

This repository includes `@xananode/core` as a Git submodule at `vendor/xananode-core`. This allows workspace development to track protocol changes in real-time.

### Setup

Clone with submodules:

```bash
git clone --recurse-submodules https://github.com/kingc95/XanaNode-Workspace.git
cd XanaNode-Workspace
npm install
npm test
```

If already cloned, initialize the submodule:

```bash
npm run sdk:init
npm test
```

### Updating the SDK

Move the SDK submodule to the latest upstream `main` commit:

```bash
npm run sdk:update
npm test
```

Check submodule status:

```bash
npm run sdk:status
```

## Design principles

### Git as a backend, not the UX

The workspace engine uses Git internally, but user-facing applications should expose friendlier concepts:

| Git term | UI term |
|---|---|
| commit | Save snapshot |
| branch | Draft path |
| merge | Bring changes together |
| pull request | Propose change |
| diff | What changed? |
| log | History |

### Rendering adapters, not dependencies

This package does not depend on rendering engines like Hugo or web frameworks. Future renderers can consume `@xananode/core` and `@xananode/workspace` independently. The core protocol remains the reference implementation.

### Packs as knowledge dependencies

Substrates can record dependencies on other substrates—like season-level collections, schema packs, domain knowledge, or institutional repositories—in `.xananode/imports.json`. This enables:

- Modular substrate composition
- Shared schemas and types
- Institutional knowledge bases
- Cross-workspace collaboration

Workspace imports should remain protocol-shaped. Packs can be mounted or absorbed:

- Mounted packs are enabled at analysis or build time while remaining governed by their source repository.
- Absorbed packs are reviewed, merged, and made part of the receiving substrate's own authorship.

Workspace is the right layer for pack management UX: enable or disable packs, preview what they add, compare versions, show Core merge candidates, and perform an explicit absorption step when the substrate owner accepts incoming records permanently.

A renderer such as XanaNode Hugo can ingest exported node and relationship JSON directly from an `imports/` folder or a configured mounted pack instead of forcing authors to recreate every imported object as Markdown front matter.

The intended flow is:

```text
Workspace/Core generates or validates protocol JSON
Hugo site drops that JSON under imports/
Hugo prepare merges imports with Markdown-authored local nodes
Hugo publishes protocol artifacts plus a read-only viewer
```

Markdown is an authoring convenience, not the substrate source of truth.

To export a portable pack for Hugo or another projection layer:

```bash
xananode-workspace pack ./my-substrate --out ./packs/my-substrate
```

That writes `substrate.json`, `nodes.json`, `relationships.json`, per-node JSON files, and `pack-report.json`. In Studio, the same workflow is the **Export Pack** button. By default it writes to `packs/local` in mounted mode, so the pack remains governed by its source substrate until the author explicitly absorbs or merges it.

Core should evaluate incoming packs before a renderer or UI applies them. Use Core pack loading and intake analysis to identify possible same-entity merges, new nodes, incoming relationships touching existing nodes, possible transclusions, and possible title/alias links. Workspace records the import dependency and can later expose those Core suggestions in a human review workflow.

## Current scope

This is a first-pass engine focused on workspace management and protocol integration. It does not yet implement:

- Live file watching
- OAuth/GitHub authentication
- Conflict-resolution UI
- Remote sync and publishing
- Schema pack marketplaces
- Full import resolution
- Desktop application shells (Tauri, Electron)
- Editor integrations (VS Code, Monaco)

These features belong in higher-level UI layers that consume this workspace engine.

## License

MIT
