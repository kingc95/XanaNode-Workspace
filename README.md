# @xananode/workspace

A renderer-independent workspace engine for the XanaNode protocol. It exists to keep workspace, project, and collaboration concerns out of any one presentation layer. CLIs, desktop applications, web editors, and future integrations should be able to use the same workspace initialization, asset management, import tracking, and knowledge health computation.

Canonical protocol statement:

XanaNode is a protocol for independently authored knowledge substrates that preserve relationships, provenance, lineage, disagreement, and addressable fragments, so knowledge can move across tools and media without losing its structure.

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
- **Imports and exports multiple substrate transport shapes** through the same Core/Workspace path:
  - split protocol artifact folders
  - `substrate-bundle.json`
  - `substrate-bundle.jsonl`
  - portable `.substrate` archives

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
xananode-workspace build ./my-substrate --out ./my-substrate/public --bundle-jsonl
xananode-workspace build ./my-substrate --out ./my-substrate/public --suggestions-mode apply

# Save progress as a Git snapshot
xananode-workspace save ./my-substrate --message "Added first claim and source"
```

`build` and `pack` can write different compatible delivery shapes from the same substrate:

- split protocol artifacts
- `substrate-bundle.json`
- `substrate-bundle.jsonl`
- `.substrate` archive

Use `--no-split-artifacts`, `--no-bundle-json`, and `--bundle-jsonl` to choose what gets written.

Use `--suggestions-mode review` to leave possible autolinks and transclusions as review items, or `--suggestions-mode apply` to let Core rewrite safe suggestions directly into the built substrate artifacts while still reporting what it changed.

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

When this repo is developed inside `XanaNode-Master`, the live sibling repositories are the source of truth. The root development bridge links `vendor/xananode-core` back to `../XanaNode-Core-SDK`, so Workspace follows Core changes immediately without hand-copying nested files.

### Setup

From `XanaNode-Master/`, the preferred stack-level setup is:

```bash
npm run dev:bootstrap
```

For a standalone clone of this repo, use the fallback submodule flow:

```bash
git clone --recurse-submodules https://github.com/kingc95/XanaNode-Workspace.git
cd XanaNode-Workspace
npm install
npm test
```

If this repo was already cloned by itself, initialize the fallback submodule:

```bash
npm run sdk:init
npm test
```

### Updating the SDK

In a standalone clone, move the fallback SDK submodule to the latest upstream `main` commit:

```bash
npm run sdk:update
npm test
```

Check fallback submodule status:

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

### Substrates as knowledge dependencies

In current XanaNode language, the thing being exchanged is always another substrate. A `.substrate` file is simply a portable bundled substrate. Some Core and Workspace helper names still use `pack` for backward compatibility, but user-facing tools should teach substrate, `.substrate`, mount, import, merge, and Intertwingle rather than inventing a second conceptual object above the substrate itself.

Substrates can record dependencies on other substrates like season-level collections, schema substrates, domain knowledge, or institutional repositories in `.xananode/imports.json`. This enables:

- Modular substrate composition
- Shared schemas and types
- Institutional knowledge bases
- Cross-workspace collaboration

Workspace imports should remain protocol-shaped. Substrates can be mounted, imported, or merged:

- Mounted substrates are enabled at analysis or build time while remaining governed by their source repository.
- Imported substrates are copied into local generated artifacts with provenance while still preserving source identity.
- Merged substrates are explicitly reconciled into the receiving substrate's own authorship.

Workspace is the right layer for substrate management UX: enable or disable mounts, preview what they add, compare versions, show Core merge candidates, and perform an explicit import or merge step when the substrate owner accepts incoming records permanently.

A renderer such as XanaNode Hugo can ingest exported node and relationship JSON directly from an `imports/` folder or a configured mounted substrate instead of forcing authors to recreate every imported object as Markdown front matter.

The intended flow is:

```text
Workspace/Core generates or validates protocol JSON
Hugo site drops that JSON under imports/
Hugo prepare merges imports with Markdown-authored local nodes
Hugo publishes protocol artifacts plus a read-only viewer
```

Markdown is an authoring convenience, not the substrate source of truth.

To export a portable `.substrate` for Hugo or another projection layer:

```bash
xananode-workspace pack ./my-substrate --out ./packs/my-substrate
```

That writes `substrate.json`, `nodes.json`, `relationships.json`, per-node JSON files, and `pack-report.json`. In Studio, the same workflow is the **Export .substrate** action. By default it writes to `packs/local` in mounted mode, so the exported substrate remains governed by its source substrate until the author explicitly imports or merges it elsewhere.

To open a `.substrate` someone sent you as editable local work:

```bash
xananode-workspace open-pack ./packs/xananode-canonical ./canonical-working-copy --author "Your Name"
```

Workspace calls this a **working copy**. The source substrate's node IDs and relationships are preserved for comparison, but your edits are local **proposals** until the source substrate owner accepts them. This is not a silent edit to the original substrate and it does not mean you own that substrate's main line of authorship.

Core should evaluate incoming substrates before a renderer or UI applies them. Use Core substrate loading and intake analysis to identify possible same-entity merges, new nodes, incoming relationships touching existing nodes, possible transclusions, possible title or alias links, and health signals such as summaries that merely repeat body content. Workspace records the import dependency and can later expose those Core suggestions in either a human review workflow or an apply-on-build workflow.

## Current scope

This is a first-pass engine focused on workspace management and protocol integration. It does not yet implement:

- Live file watching
- Partial node-by-node permanent intake from a mounted or intertwingled substrate
- Safe unmount with selective retained merges
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

