import { buildSubstrate } from "@xananode/core";
import { gitStatus } from "./git.js";

function percentage(score, max) {
  if (max <= 0) return 100;
  return Math.max(0, Math.min(100, Math.round((score / max) * 100)));
}

export async function computeKnowledgeHealth(rootDir, options = {}) {
  const substrate = await buildSubstrate(rootDir, options.core || {});
  const nodes = substrate.protocolNodes || [];
  const relationships = substrate.relationships || [];
  const nodeIds = new Set(nodes.map((node) => node.id));
  const incoming = new Map(nodes.map((node) => [node.id, 0]));
  const outgoing = new Map(nodes.map((node) => [node.id, 0]));
  const issues = [];

  for (const relationship of relationships) {
    if (incoming.has(relationship.target)) incoming.set(relationship.target, incoming.get(relationship.target) + 1);
    if (outgoing.has(relationship.source)) outgoing.set(relationship.source, outgoing.get(relationship.source) + 1);
    if (!relationship.external && relationship.source && !nodeIds.has(relationship.source)) {
      issues.push({ severity: "warning", kind: "missing_source_node", relationship: relationship.id, source: relationship.source });
    }
    if (!relationship.external && relationship.target && !nodeIds.has(relationship.target)) {
      issues.push({ severity: "warning", kind: "missing_target_node", relationship: relationship.id, target: relationship.target });
    }
    if (!relationship.summary) {
      issues.push({ severity: "info", kind: "relationship_missing_summary", relationship: relationship.id });
    }
  }

  for (const node of nodes) {
    const degree = (incoming.get(node.id) || 0) + (outgoing.get(node.id) || 0);
    if (degree === 0 && node.type !== "fragment") issues.push({ severity: "info", kind: "unlinked_node", node: node.id });
    if (!node.summary) issues.push({ severity: "info", kind: "node_missing_summary", node: node.id });
    if (!node.created_by) issues.push({ severity: "warning", kind: "node_missing_author", node: node.id });
    if (node.type === "claim" && !relationships.some((rel) => rel.target === node.id && ["supports", "evidence_for", "derived_from", "cites"].includes(rel.type))) {
      issues.push({ severity: "warning", kind: "claim_without_visible_support", node: node.id });
    }
  }

  for (const warning of substrate.validation?.warnings || []) {
    issues.push({ severity: "warning", ...warning });
  }
  for (const error of substrate.validation?.errors || []) {
    issues.push({ severity: "error", ...error });
  }

  const penalty = issues.reduce((sum, issue) => {
    if (issue.severity === "error") return sum + 10;
    if (issue.severity === "warning") return sum + 4;
    return sum + 1;
  }, 0);
  const maxPenalty = Math.max(20, nodes.length * 6 + relationships.length * 2);
  const score = percentage(maxPenalty - penalty, maxPenalty);

  return {
    score,
    counts: {
      nodes: nodes.length,
      relationships: relationships.length,
      fragments: substrate.fragments?.length || 0,
      suggestions: substrate.suggestions?.length || 0,
      issues: issues.length,
      git_changes: gitStatus(rootDir).changed.length
    },
    valid: substrate.validation?.valid === true,
    issues,
    suggestions: substrate.suggestions || []
  };
}
