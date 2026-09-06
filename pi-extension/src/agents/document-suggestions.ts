import * as fs from "node:fs";
import * as path from "node:path";
import { loadArchitectInputsConfig } from "../architect/inputs-config.js";
import { loadFilesConfig } from "./files-config.js";
import type { SenaiRole } from "./suggestions.js";

export interface DocumentSuggestion {
  role: SenaiRole;
  path: string;
  reason: string;
}

interface Candidate {
  path: string;
  /** Architect-inputs document type, when the user classified the document. */
  type?: string;
}

/** Role groups and the documents that fit them, in match-priority order. */
const ROLE_TYPE_RULES: Array<{ roles: SenaiRole[]; types: string[]; keywords: string[]; reason: string; needs: string }> = [
  { roles: ["scout-4", "discussion", "planner"], types: ["prd", "mrd", "brd"], keywords: ["prd", "requirement"], reason: "requirements document", needs: "PRD / requirements document" },
  { roles: ["reviewer-correctness", "code-review"], types: ["rtm"], keywords: ["rtm", "traceability"], reason: "traceability document", needs: "RTM / traceability document" },
  { roles: ["reviewer-tests"], types: ["test-plan"], keywords: ["test-plan", "test"], reason: "test plan document", needs: "test plan document" },
  { roles: ["reviewer-security", "security-gate"], types: ["nfr"], keywords: ["security"], reason: "security/NFR document", needs: "NFR / security requirements" },
  { roles: ["scout-1"], types: ["adr", "feasibility"], keywords: ["architecture", "design"], reason: "architecture/design document", needs: "architecture / design document" },
];

/** Pool of candidate documents: architect-inputs entries (typed by the user)
 *  plus existing files from files.json inputDocuments. Invalid configs are
 *  skipped silently — doctor reports them in its own sections. */
function collectCandidates(cwd: string): Candidate[] {
  const seen = new Set<string>();
  const candidates: Candidate[] = [];

  try {
    const inputs = loadArchitectInputsConfig(cwd);
    if (inputs) {
      for (const doc of inputs.documents) {
        if (seen.has(doc.path)) continue;
        seen.add(doc.path);
        candidates.push({ path: doc.path, type: doc.type });
      }
    }
  } catch {
    // Invalid architect inputs config — no typed candidates.
  }

  try {
    const filesConfig = loadFilesConfig(cwd);
    if (filesConfig) {
      for (const p of filesConfig.inputDocuments) {
        const fullPath = path.resolve(cwd, p);
        if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) continue;
        if (seen.has(p)) continue;
        seen.add(p);
        candidates.push({ path: p });
      }
    }
  } catch {
    // Invalid files config — no extra candidates.
  }

  return candidates.filter((c) => fs.existsSync(path.resolve(cwd, c.path)));
}

/** Suggest a truth document per recommended role.
 *  Priority: (1) architect-inputs document types (user-classified),
 *  (2) filename keywords, (3) no confident match → no suggestion.
 *  scout-2 and scout-3 are code-reading roles and never get suggestions. */
export function suggestTruthDocuments(cwd: string): DocumentSuggestion[] {
  const candidates = collectCandidates(cwd);
  if (candidates.length === 0) return [];

  const suggestions: DocumentSuggestion[] = [];
  for (const rule of ROLE_TYPE_RULES) {
    const match =
      candidates.find((c) => c.type && rule.types.includes(c.type)) ??
      candidates.find((c) => rule.keywords.some((k) => path.basename(c.path).toLowerCase().includes(k)));
    if (!match) continue;
    for (const role of rule.roles) {
      suggestions.push({ role, path: match.path, reason: rule.reason });
    }
  }
  return suggestions;
}

/** Plain-words name of the document type a role needs (user decision:
 *  beginners must see "RTM", not guess). undefined for roles without a
 *  document-type rule (e.g., the code scouts). */
export function roleDocumentNeed(role: SenaiRole): string | undefined {
  const rule = ROLE_TYPE_RULES.find((r) => r.roles.includes(role));
  return rule?.needs;
}
