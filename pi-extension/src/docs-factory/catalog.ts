/** A document type in the factory catalog. All templates are
 *  language-agnostic Markdown. Single source of truth shared by
 *  doc-selection (what to write), the docs-structure command (stubs),
 *  agent-generator (writer contracts), and doctor (validation). */
export interface DocTypeSpec {
  id: DocTypeId;
  title: string;
  /** Default target path, relative to the project root. Ends with "/" for
   *  types that own a folder of pages (adr, api-reference, how-to, tutorial,
   *  explanation). */
  defaultPath: string;
  /** Hard length cap in lines. Doctor warns above it. */
  maxLines: number;
  /** Headings that MUST appear, in order (e.g. "## Context" for ADRs). */
  requiredSections: string[];
  /** Standard this template is based on (for doctor messages and docs). */
  basedOn: string;
  /** Markdown template stub body, starting with DOC_STUB_MARKER. */
  template: string;
}

export type DocTypeId =
  | "readme" // Standard Readme spec; ~150 lines
  | "changelog" // Keep a Changelog 1.1.0; ~15 lines per entry
  | "adr" // Nygard template; ~120 lines hard cap
  | "api-reference" // Google API style; ~60 lines per symbol page
  | "how-to" // goal → steps with branches → verification; ~150 lines
  | "tutorial" // numbered single-path steps with expected output; ~150 lines
  | "architecture" // arc42-lite; ~250 lines
  | "explanation" // design notes; ~150 lines
  | "contributing"; // GitHub convention; ~150 lines

export const DOC_STUB_MARKER = "<!-- pi-senai doc stub: safe to overwrite -->";

export const DOC_TYPES: Record<DocTypeId, DocTypeSpec> = {
  readme: {
    id: "readme",
    title: "README",
    defaultPath: "README.md",
    maxLines: 150,
    requiredSections: ["## Install", "## Usage"],
    basedOn: "Standard Readme spec",
    template: `${DOC_STUB_MARKER}
# <Project name>

<One-line description, max 120 characters.>

## Install

<How to install.>

## Usage

<How to use, with the smallest working example.>

## License

<License name and link.>
`,
  },
  changelog: {
    id: "changelog",
    title: "Changelog",
    defaultPath: "CHANGELOG.md",
    maxLines: 200,
    requiredSections: ["## [Unreleased]"],
    basedOn: "Keep a Changelog 1.1.0",
    template: `${DOC_STUB_MARKER}
# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

<!-- One short summary line plus compact bullets per change; ~15 lines per entry.
     Change types: Added, Changed, Deprecated, Removed, Fixed, Security. -->
`,
  },
  adr: {
    id: "adr",
    title: "Architecture Decision Record",
    defaultPath: "docs/adr/",
    maxLines: 120,
    requiredSections: ["## Status", "## Context", "## Decision", "## Consequences"],
    basedOn: "Nygard ADR template",
    template: `${DOC_STUB_MARKER}
# <Decision title>

## Status

proposed | accepted | deprecated | superseded

## Context

<What forces this decision?>

## Decision

<What we decided.>

## Consequences

<What becomes easier or harder?>
`,
  },
  "api-reference": {
    id: "api-reference",
    title: "API reference page",
    defaultPath: "docs/reference/",
    maxLines: 60,
    requiredSections: ["## Signature", "## Parameters", "## Returns", "## Example"],
    basedOn: "Google API reference style",
    template: `${DOC_STUB_MARKER}
# <symbol name>

<One-line summary.>

## Signature

\`\`\`
<signature>
\`\`\`

## Parameters

- \`name\` — <description>

## Returns

<What it returns.>

## Example

\`\`\`
<5–20 line example>
\`\`\`
`,
  },
  "how-to": {
    id: "how-to",
    title: "How-to guide",
    defaultPath: "docs/how-to/",
    maxLines: 150,
    requiredSections: ["## Goal", "## Steps", "## Verification"],
    basedOn: "Diátaxis how-to guides",
    template: `${DOC_STUB_MARKER}
# How to <goal>

## Goal

<What the user achieves.>

## Steps

1. <Step.>
   - If <branch>: <what to do instead.>
2. <Step.>

## Verification

<How the user confirms it worked.>
`,
  },
  tutorial: {
    id: "tutorial",
    title: "Tutorial / quickstart",
    defaultPath: "docs/tutorials/",
    maxLines: 150,
    requiredSections: ["## Prerequisites", "## Steps"],
    basedOn: "Diátaxis tutorials",
    template: `${DOC_STUB_MARKER}
# <Tutorial title>

<What the user builds, one line.>

## Prerequisites

- <What must be installed or done first.>

## Steps

1. <Step.> Expected output: <output>.
2. <Step.> Expected output: <output>.
`,
  },
  architecture: {
    id: "architecture",
    title: "Architecture overview",
    defaultPath: "docs/explanation/architecture.md",
    maxLines: 250,
    requiredSections: ["## Goals", "## Context", "## Strategy", "## Building Blocks", "## Decisions"],
    basedOn: "arc42 (lite)",
    template: `${DOC_STUB_MARKER}
# Architecture

## Goals

<Top quality goals.>

## Context

<What the system talks to.>

## Strategy

<The one-paragraph approach.>

## Building Blocks

<Main parts and their responsibilities.>

## Decisions

<Link to ADRs in docs/adr/.>
`,
  },
  explanation: {
    id: "explanation",
    title: "Explanation / design notes",
    defaultPath: "docs/explanation/",
    maxLines: 150,
    requiredSections: [],
    basedOn: "Diátaxis explanation",
    template: `${DOC_STUB_MARKER}
# <Topic>

<Why it works this way: background, alternatives considered, trade-offs.>
`,
  },
  contributing: {
    id: "contributing",
    title: "Contributing guide",
    defaultPath: "CONTRIBUTING.md",
    maxLines: 150,
    requiredSections: ["## How to Contribute"],
    basedOn: "GitHub contributing guide convention",
    template: `${DOC_STUB_MARKER}
# Contributing

<One line: whether and what contributions are welcome.>

## How to Contribute

1. <Fork / branch / pull-request flow.>

## Setup

<How to build and test locally.>
`,
  },
};

export function getDocType(id: DocTypeId): DocTypeSpec {
  const spec = DOC_TYPES[id];
  if (!spec) throw new Error(`Unknown doc type: ${id}`);
  return spec;
}

export function isDocStub(content: string): boolean {
  return content.trimStart().startsWith(DOC_STUB_MARKER);
}

export function renderTemplateStub(id: DocTypeId): string {
  return getDocType(id).template;
}
