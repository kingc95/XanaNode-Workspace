import path from "node:path";
import { Command } from "commander";
import {
  addImport,
  buildWorkspace,
  computeKnowledgeHealth,
  createNode,
  exportWorkspacePack,
  cloneFederationTarget,
  gitLog,
  gitStatus,
  importAssetAsNode,
  initWorkspace,
  listFederationTargets,
  mountFederationTarget,
  openPackAsWorkspace,
  openWorkspace,
  saveSnapshot,
  upsertAuthor,
  validateWorkspace
} from "./index.js";

const WORKSPACE_CLI_VERSION = "0.1.0";

function printJson(value) {
  console.log(JSON.stringify(value, null, 2));
}

function commandEnvelope(command, data, extras = {}) {
  return {
    ok: true,
    tool: "xananode-workspace",
    version: WORKSPACE_CLI_VERSION,
    command,
    ...extras,
    data
  };
}

function printHealth(health) {
  console.log(`Knowledge Health: ${health.score}%`);
  console.log(`Nodes: ${health.counts.nodes}`);
  console.log(`Relationships: ${health.counts.relationships}`);
  console.log(`Fragments: ${health.counts.fragments}`);
  console.log(`Suggestions: ${health.counts.suggestions}`);
  console.log(`Applied suggestions: ${health.counts.applied_suggestions || 0}`);
  console.log(`Issues: ${health.counts.issues}`);
  if (health.issues.length) {
    console.log("\nTop issues:");
    for (const issue of health.issues.slice(0, 15)) {
      console.log(`- ${issue.severity || "info"}: ${issue.kind || issue.label || "issue"} ${issue.node || issue.relationship || ""}`.trim());
    }
  }
}

function workspaceSummary(workspace) {
  return {
    root_dir: workspace.rootDir,
    manifest: workspace.manifest,
    counts: {
      nodes: workspace.nodes.length,
      authors: workspace.authors.authors.length,
      imports: workspace.imports.imports.length
    },
    git: {
      enabled: workspace.git.enabled
    }
  };
}

export async function runWorkspaceCli(argv = process.argv) {
  const program = new Command();
  program
    .name("xananode-workspace")
    .description("Local-first workspace engine CLI for XanaNode Studio")
    .version(WORKSPACE_CLI_VERSION);

  program.command("init")
    .argument("[dir]", "workspace directory", ".")
    .option("--name <name>", "substrate name", "New XanaNode Substrate")
    .option("--namespace <namespace>", "substrate namespace")
    .option("--author <name>", "default author name")
    .option("--author-id <id>", "default author id")
    .option("--author-email <email>", "default author email")
    .option("--no-git", "do not initialize a Git repository")
    .option("--with-hugo", "enable the Hugo projection layer for this workspace")
    .option("--json", "print machine-readable JSON")
    .description("create a XanaNode substrate and workspace metadata")
    .action(async (dir, options) => {
      options.includeHugo = options.withHugo === true;
      const workspace = await initWorkspace(path.resolve(dir), options);
      if (options.json) return printJson(commandEnvelope("init", workspaceSummary(workspace)));
      console.log(`Created XanaNode workspace: ${workspace.manifest.name}`);
      console.log(`Namespace: ${workspace.manifest.namespace}`);
      console.log(`Path: ${workspace.rootDir}`);
    });

  program.command("open")
    .argument("[dir]", "workspace directory", ".")
    .option("--json", "print raw JSON")
    .description("read a workspace summary")
    .action(async (dir, options) => {
      const workspace = await openWorkspace(path.resolve(dir));
      if (options.json) return printJson(commandEnvelope("open", workspaceSummary(workspace)));
      console.log(`${workspace.manifest.name} (${workspace.manifest.namespace})`);
      console.log(`Nodes: ${workspace.nodes.length}`);
      console.log(`Authors: ${workspace.authors.authors.length}`);
      console.log(`Imports: ${workspace.imports.imports.length}`);
      console.log(`Git: ${workspace.git.enabled ? "enabled" : "not initialized"}`);
    });

  program.command("open-pack")
    .argument("<pack>", "pack folder or pack JSON file")
    .argument("[dir]", "workspace directory to create")
    .option("--name <name>", "working copy name")
    .option("--namespace <namespace>", "working copy namespace")
    .option("--author <name>", "active author name")
    .option("--author-id <id>", "active author id")
    .option("--author-email <email>", "active author email")
    .option("--no-git", "do not initialize a Git repository")
    .option("--json", "print machine-readable JSON")
    .description("open an existing substrate bundle as an editable local working copy")
    .action(async (pack, dir, options) => {
      const target = path.resolve(dir || `${path.basename(path.resolve(pack))}-working-copy`);
      const workspace = await openPackAsWorkspace(path.resolve(pack), target, options);
      if (options.json) {
        return printJson(commandEnvelope("open-pack", {
          ...workspaceSummary(workspace),
          source_pack: workspace.settings.source_pack?.id || workspace.manifest.source_pack?.id || null
        }));
      }
      console.log(`Opened pack as working copy: ${workspace.manifest.name}`);
      console.log(`Source pack: ${workspace.settings.source_pack?.id || workspace.manifest.source_pack?.id || "unknown"}`);
      console.log(`Nodes: ${workspace.nodes.length}`);
      console.log(`Path: ${workspace.rootDir}`);
    });

  program.command("status")
    .alias("health")
    .argument("[dir]", "workspace directory", ".")
    .option("--json", "print raw JSON")
    .description("show knowledge health and Git state")
    .action(async (dir, options) => {
      const rootDir = path.resolve(dir);
      const health = await computeKnowledgeHealth(rootDir);
      const status = gitStatus(rootDir);
      if (options.json) {
        return printJson(commandEnvelope("health", {
          root_dir: rootDir,
          health,
          git: status
        }));
      }
      printHealth(health);
      console.log(`\nGit changes: ${status.changed.length}`);
      for (const change of status.changed.slice(0, 15)) console.log(`- ${change.code} ${change.path}`);
    });

  program.command("validate")
    .argument("[dir]", "workspace directory", ".")
    .option("--json", "print machine-readable JSON")
    .description("validate the substrate through @xananode/core")
    .action(async (dir, options) => {
      const validation = await validateWorkspace(path.resolve(dir));
      if (options.json) {
        printJson(commandEnvelope("validate", {
          root_dir: path.resolve(dir),
          validation
        }));
      } else {
        printJson(validation);
      }
      process.exitCode = validation.valid ? 0 : 1;
    });

  program.command("build")
    .argument("[dir]", "workspace directory", ".")
    .option("--out <dir>", "artifact output directory")
    .option("--suggestions-mode <mode>", "review or apply", "review")
    .option("--no-split-artifacts", "skip substrate.json, relationships.json, and nodes/*.json")
    .option("--no-bundle-json", "skip substrate-bundle.json")
    .option("--bundle-jsonl", "also write substrate-bundle.jsonl", false)
    .option("--json", "print machine-readable JSON")
    .description("build protocol artifacts through @xananode/core")
    .action(async (dir, options) => {
      const result = await buildWorkspace(path.resolve(dir), {
        ...options,
        core: {
          suggestionMode: options.suggestionsMode
        }
      });
      if (options.json) {
        return printJson(commandEnvelope("build", {
          root_dir: path.resolve(dir),
          output_dir: result.outputDir,
          manifest: result.substrate.manifest,
          counts: {
            nodes: result.substrate.protocolNodes.length,
            relationships: result.substrate.relationships.length,
            applied_suggestions: result.substrate.applied_suggestions?.length || 0
          },
          validation: result.substrate.validation
        }));
      }
      console.log(`Built substrate artifacts to ${result.outputDir}`);
      console.log(`Nodes: ${result.substrate.protocolNodes.length}`);
      console.log(`Relationships: ${result.substrate.relationships.length}`);
      console.log(`Applied suggestions: ${result.substrate.applied_suggestions?.length || 0}`);
      console.log(`Valid: ${result.substrate.validation.valid}`);
    });

  program.command("pack")
    .alias("export")
    .argument("[dir]", "workspace directory", ".")
    .option("--out <dir>", "pack output directory")
    .option("--id <id>", "pack id")
    .option("--name <name>", "pack name")
    .option("--namespace <namespace>", "pack namespace")
    .option("--version <version>", "pack version")
    .option("--mode <mode>", "pack composition mode", "mounted")
    .option("--suggestions-mode <mode>", "review or apply", "review")
    .option("--no-archive", "write only the unpacked pack folder")
    .option("--no-split-artifacts", "skip substrate.json, nodes.json, relationships.json, and nodes/*.json")
    .option("--no-bundle-json", "skip substrate-bundle.json")
    .option("--bundle-jsonl", "also write substrate-bundle.jsonl", false)
    .option("--json", "print machine-readable JSON")
    .description("export a portable substrate bundle for renderers and other tools")
    .action(async (dir, options) => {
      options.archive = options.archive !== false;
      const result = await exportWorkspacePack(path.resolve(dir), {
        ...options,
        suggestionMode: options.suggestionsMode
      });
      if (options.json) {
        return printJson(commandEnvelope("export", {
          root_dir: path.resolve(dir),
          output_dir: result.outputDir,
          archive_path: result.archivePath,
          manifest: result.pack.manifest,
          counts: {
            nodes: result.pack.node_count,
            relationships: result.pack.relationship_count
          }
        }));
      }
      console.log(`Exported substrate pack to ${result.outputDir}`);
      if (result.archivePath) console.log(`Archive: ${result.archivePath}`);
      console.log(`Pack: ${result.pack.manifest.id}`);
      console.log(`Nodes: ${result.pack.node_count}`);
      console.log(`Relationships: ${result.pack.relationship_count}`);
    });

  program.command("federation-targets")
    .option("--json", "print raw JSON")
    .description("list known online substrate federation targets from the protocol registry")
    .action((options) => {
      const targets = listFederationTargets();
      if (options.json) return printJson(commandEnvelope("federation-targets", { federation_targets: targets }));
      for (const target of targets) {
        console.log(`${target.id} - ${target.name}`);
        console.log(`  ${target.repository?.url || ""}`);
      }
    });

  program.command("federate")
    .argument("[dir]", "workspace directory", ".")
    .requiredOption("--target <id>", "federation target id or namespace")
    .option("--into <dir>", "clone destination directory")
    .option("--branch <branch>", "branch to clone")
    .option("--mode <mode>", "mount mode", "mounted")
    .option("--json", "print machine-readable JSON")
    .description("clone a known online substrate target and mount it into this workspace")
    .action((dir, options) => {
      const rootDir = path.resolve(dir);
      const cloneDir = path.resolve(options.into || path.join(rootDir, ".xananode", "federation", options.target));
      const cloned = cloneFederationTarget(options.target, cloneDir, options);
      const mounted = mountFederationTarget(rootDir, cloned, { mode: options.mode });
      const payload = { cloned, mounted };
      if (options.json) return printJson(commandEnvelope("federate", payload));
      printJson(payload);
    });

  program.command("author")
    .argument("[dir]", "workspace directory")
    .requiredOption("--id <id>", "author id")
    .requiredOption("--name <name>", "author name")
    .option("--email <email>", "author email")
    .option("--github <handle>", "GitHub handle")
    .option("--default", "make default author")
    .option("--json", "print machine-readable JSON")
    .description("add or update an author profile")
    .action((dir, options) => {
      const author = upsertAuthor(path.resolve(dir), options);
      if (options.json) return printJson(commandEnvelope("author", author));
      printJson(author);
    });

  program.command("node")
    .argument("[dir]", "workspace directory")
    .requiredOption("--title <title>", "node title")
    .option("--type <type>", "node type", "concept")
    .option("--summary <summary>", "node summary", "")
    .option("--json", "print machine-readable JSON")
    .description("create a new node file")
    .action(async (dir, options) => {
      const result = await createNode(path.resolve(dir), options, `# ${options.title}\n\n`);
      if (options.json) return printJson(commandEnvelope("node", result));
      console.log(`Created node: ${result.filePath}`);
    });

  program.command("asset")
    .argument("[dir]", "workspace directory")
    .argument("<file>", "file to import")
    .option("--title <title>", "asset node title")
    .option("--type <type>", "media or source")
    .option("--json", "print machine-readable JSON")
    .description("copy an asset into the workspace and create a source/media node")
    .action(async (dir, file, options) => {
      const result = await importAssetAsNode(path.resolve(dir), path.resolve(file), options);
      if (options.json) return printJson(commandEnvelope("asset", result));
      printJson(result);
    });

  program.command("import")
    .argument("[dir]", "workspace directory")
    .requiredOption("--id <id>", "substrate id")
    .option("--url <url>", "substrate repository or manifest URL")
    .option("--version <version>", "version constraint", "latest")
    .option("--mode <mode>", "reference, clone, submodule, package", "reference")
    .option("--json", "print machine-readable JSON")
    .description("record an imported/federated substrate dependency")
    .action((dir, options) => {
      const result = addImport(path.resolve(dir), options);
      if (options.json) return printJson(commandEnvelope("import", result));
      printJson(result);
    });

  program.command("save")
    .alias("snapshot")
    .argument("[dir]", "workspace directory", ".")
    .option("--message <message>", "snapshot message")
    .option("--author-name <name>", "Git author name")
    .option("--author-email <email>", "Git author email")
    .option("--json", "print machine-readable JSON")
    .description("save a Git-backed workspace snapshot")
    .action((dir, options) => {
      const result = saveSnapshot(path.resolve(dir), options);
      if (options.json) return printJson(commandEnvelope("snapshot", result));
      printJson(result);
    });

  program.command("history")
    .argument("[dir]", "workspace directory", ".")
    .option("--limit <n>", "number of snapshots", "25")
    .option("--json", "print machine-readable JSON")
    .description("show saved workspace snapshots")
    .action((dir, options) => {
      const result = gitLog(path.resolve(dir), Number(options.limit));
      if (options.json) return printJson(commandEnvelope("history", result));
      printJson(result);
    });

  await program.parseAsync(argv);
}
