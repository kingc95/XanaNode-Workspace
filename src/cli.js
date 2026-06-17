import path from "node:path";
import { Command } from "commander";
import {
  addImport,
  buildWorkspace,
  computeKnowledgeHealth,
  createNode,
  gitLog,
  gitStatus,
  importAssetAsNode,
  initWorkspace,
  openWorkspace,
  saveSnapshot,
  upsertAuthor,
  validateWorkspace
} from "./index.js";

function printJson(value) {
  console.log(JSON.stringify(value, null, 2));
}

function printHealth(health) {
  console.log(`Knowledge Health: ${health.score}%`);
  console.log(`Nodes: ${health.counts.nodes}`);
  console.log(`Relationships: ${health.counts.relationships}`);
  console.log(`Fragments: ${health.counts.fragments}`);
  console.log(`Suggestions: ${health.counts.suggestions}`);
  console.log(`Issues: ${health.counts.issues}`);
  if (health.issues.length) {
    console.log("\nTop issues:");
    for (const issue of health.issues.slice(0, 15)) {
      console.log(`- ${issue.severity || "info"}: ${issue.kind || issue.label || "issue"} ${issue.node || issue.relationship || ""}`.trim());
    }
  }
}

export async function runWorkspaceCli(argv = process.argv) {
  const program = new Command();
  program
    .name("xananode-workspace")
    .description("Local-first workspace engine CLI for XanaNode Studio")
    .version("0.1.0");

  program.command("init")
    .argument("[dir]", "workspace directory", ".")
    .option("--name <name>", "substrate name", "New XanaNode Substrate")
    .option("--namespace <namespace>", "substrate namespace")
    .option("--author <name>", "default author name")
    .option("--author-id <id>", "default author id")
    .option("--author-email <email>", "default author email")
    .option("--no-git", "do not initialize a Git repository")
    .description("create a XanaNode substrate and workspace metadata")
    .action(async (dir, options) => {
      const workspace = await initWorkspace(path.resolve(dir), options);
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
      if (options.json) return printJson(workspace);
      console.log(`${workspace.manifest.name} (${workspace.manifest.namespace})`);
      console.log(`Nodes: ${workspace.nodes.length}`);
      console.log(`Authors: ${workspace.authors.authors.length}`);
      console.log(`Imports: ${workspace.imports.imports.length}`);
      console.log(`Git: ${workspace.git.enabled ? "enabled" : "not initialized"}`);
    });

  program.command("status")
    .argument("[dir]", "workspace directory", ".")
    .option("--json", "print raw JSON")
    .description("show knowledge health and Git state")
    .action(async (dir, options) => {
      const rootDir = path.resolve(dir);
      const health = await computeKnowledgeHealth(rootDir);
      if (options.json) return printJson({ health, git: gitStatus(rootDir) });
      printHealth(health);
      const status = gitStatus(rootDir);
      console.log(`\nGit changes: ${status.changed.length}`);
      for (const change of status.changed.slice(0, 15)) console.log(`- ${change.code} ${change.path}`);
    });

  program.command("validate")
    .argument("[dir]", "workspace directory", ".")
    .description("validate the substrate through @xananode/core")
    .action(async (dir) => {
      const validation = await validateWorkspace(path.resolve(dir));
      printJson(validation);
      process.exitCode = validation.valid ? 0 : 1;
    });

  program.command("build")
    .argument("[dir]", "workspace directory", ".")
    .option("--out <dir>", "artifact output directory")
    .description("build protocol artifacts through @xananode/core")
    .action(async (dir, options) => {
      const result = await buildWorkspace(path.resolve(dir), options);
      console.log(`Built substrate artifacts to ${result.outputDir}`);
      console.log(`Nodes: ${result.substrate.protocolNodes.length}`);
      console.log(`Relationships: ${result.substrate.relationships.length}`);
      console.log(`Valid: ${result.substrate.validation.valid}`);
    });

  program.command("author")
    .argument("[dir]", "workspace directory")
    .requiredOption("--id <id>", "author id")
    .requiredOption("--name <name>", "author name")
    .option("--email <email>", "author email")
    .option("--github <handle>", "GitHub handle")
    .option("--default", "make default author")
    .description("add or update an author profile")
    .action((dir, options) => {
      const author = upsertAuthor(path.resolve(dir), options);
      printJson(author);
    });

  program.command("node")
    .argument("[dir]", "workspace directory")
    .requiredOption("--title <title>", "node title")
    .option("--type <type>", "node type", "concept")
    .option("--summary <summary>", "node summary", "")
    .description("create a new node file")
    .action(async (dir, options) => {
      const result = await createNode(path.resolve(dir), options, `# ${options.title}\n\n`);
      console.log(`Created node: ${result.filePath}`);
    });

  program.command("asset")
    .argument("[dir]", "workspace directory")
    .argument("<file>", "file to import")
    .option("--title <title>", "asset node title")
    .option("--type <type>", "media or source")
    .description("copy an asset into the workspace and create a source/media node")
    .action((dir, file, options) => {
      const result = importAssetAsNode(path.resolve(dir), path.resolve(file), options);
      printJson(result);
    });

  program.command("import")
    .argument("[dir]", "workspace directory")
    .requiredOption("--id <id>", "substrate id")
    .option("--url <url>", "substrate repository or manifest URL")
    .option("--version <version>", "version constraint", "latest")
    .option("--mode <mode>", "reference, clone, submodule, package", "reference")
    .description("record an imported/federated substrate dependency")
    .action((dir, options) => {
      printJson(addImport(path.resolve(dir), options));
    });

  program.command("save")
    .argument("[dir]", "workspace directory", ".")
    .option("--message <message>", "snapshot message")
    .option("--author-name <name>", "Git author name")
    .option("--author-email <email>", "Git author email")
    .description("save a Git-backed workspace snapshot")
    .action((dir, options) => {
      printJson(saveSnapshot(path.resolve(dir), options));
    });

  program.command("history")
    .argument("[dir]", "workspace directory", ".")
    .option("--limit <n>", "number of snapshots", "25")
    .description("show saved workspace snapshots")
    .action((dir, options) => {
      printJson(gitLog(path.resolve(dir), Number(options.limit)));
    });

  await program.parseAsync(argv);
}
