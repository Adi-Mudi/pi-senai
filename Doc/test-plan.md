# Pi Senai — Test Plan

**Date:** 2026-07-20
**Scope:** All source modules under `pi-extension/src/`, every exported function and significant internal sub-function.
**Suite:** `npm test` (builds with `tsc`, then runs `node --test dist/pi-extension/test/**/*.test.js`).

---

## 1. Test strategy

1. **Pin, don't fix.** Tests assert current behavior. Where current behavior looks like a bug, the test pins it and carries a `// NOTE: possible bug — see Doc/test-plan.md known issues` comment. Fixes are decided separately.
2. **No fake tests.** Functions that cannot be tested as written are listed in section 4 — no invented or vacuous tests.
3. **Green suite.** Every added test must pass. A test that would hang or crash the runner is not written; the underlying issue is recorded instead.
4. **Existing conventions.** Tests use `node:test` (`describe`/`it`), `node:assert`, and temporary directories from `fs.mkdtempSync`. One test file per source module.

---

## 2. Edge-case inventory per module

Legend: **(+N)** = tests added in this round.

### Core modules

| Test file | Focus of added tests |
| --- | --- |
| `state.test.ts` (+9) | Malformed-but-version-1 state; JSON `null`/array bodies; state.json as directory; garbage `currentStage` crash; startRun twice; empty mission; unwritable dir; resetState on directory. |
| `constants.test.ts` (+4) | All-special-char mission slug; runId truncation boundaries; all 18 artifact path fields; status block with mission but no runId. |
| `prompt.test.ts` (+4) | All-empty config arrays; empty documents combination; primary-without-reads fragment; unknown stage fallback. |
| `index.test.ts` (+2) | Corrupted state.json in `before_agent_start`; empty system prompt concatenation. |
| `commands.test.ts` (+20) | Declined confirms (approve/reset); approve from delivered; empty-runId paths; wrong-stage rejection messages; missing-config info branches; interactive picker flows (choose-different, cancelled select, clear-truth, excluded-paths editor, browse up-nav); corrupted architect report fallback; stale-inputs changeNote branch; `dirHasFiles`/`isPathConflict`/`isFolderLike` helpers. |

### Agent modules

| Test file | Focus of added tests |
| --- | --- |
| `agent-config.test.ts` (+6) | JSON `null` content; unknown role in file; non-object `agents`; `agents: []` pin; non-string mapping pin; empty-string mapping fallback. |
| `agent-discovery.test.ts` (+9) | Builtin dedup by name; `foo.md` subdirectory; broken symlink; nearest-dir resolution (null, grandparent); no frontmatter; nonexistent path; whitespace name; missing description; string `maxSubagentDepth`. |
| `agent-registry.test.ts` (+1) | Empty-string mapping pin (known issue 1). |
| `agent-suggestions.test.ts` (+12) | Empty array; case-insensitivity; keyword variants (scout-2/3/4, implementer); AND-condition negatives; arch-agent preference guard; never-suggested roles pin; first-match wins; unmatched roles omitted. |
| `agent-generator.test.ts` (+11) | Resource id/name fallbacks; corrupted frontmatter; non-md files; comma-string keywords; empty hints; no-generic resources; corrupted package.json; scoped package name; empty-report context block pin (known issue 2); empty plans → no manifest. |
| `agents-files-config.test.ts` (+5) | Version 0 migration pin (known issue 4); JSON null; string version; null role entry pin; multi-role roundtrip. |

### Architecture factory modules

| Test file | Focus of added tests |
| --- | --- |
| `architect.test.ts` (+16) | ADR-000 fallback; ADR entry filtering; confidence boundaries 80/79/50/49; manifest shape validation; missing-file manifest skip; legacy migration empty cases; architecture selection tie/negative scores; slugify truncation/empty; empty-section doc fallbacks; `autoMapArchitectureAgents`: corrupted config throw (known issue 5), slug-prefix false positive (known issue 6), different-project mapping preserved, mixed stale/correct/default set. |
| `architect-inputs-config.test.ts` (+3) | Non-string path; non-string constraint entry; JSON array content. |
| `architect-tools.test.ts` (+8) | Empty merge; legacy root drivers deletion; unknown-shape legacy file; document-mismatch map file; finalize via report fallback and name match; finalize throw propagation for corrupted agents.json and malformed profile. |
| `doctor.test.ts` (+20) | Config version warnings; shadowed agents; capability warnings (no tools, empty tools, readonly-with-write, output); file-scope warnings; conflict edges; agents_files ok/warning/error branches; TMUX environment; confidence warnings; ADR partial/invalid; misnamed agents/skills; missing input document; generated-team none-found; technology resources ok/unparseable; integrity all-valid; secret-scan pattern coverage. |
| `document-ingest.test.ts` (+5) | Non-JSON/subdirectory ignoring; cross-category id dedup pin; non-string uncertainties; malformed manifest; sanitize edge cases. |
| `driver-extractor.test.ts` (+8) | `findDriverGaps` positive branches (scale, deployment, project type) and case-insensitivity; legacy category fallback; first-wins dedup; whitespace description. |
| `migrate.test.ts` (+2) | Target-only present; legacy path as file (pin). |

### Files and UI modules

| Test file | Focus of added tests |
| --- | --- |
| `files-config.test.ts` (+8) | Non-array testPaths; non-object JSON; config path as directory; case-insensitive docs migration; `latest/` quirk pin (known issue 11); default exclusions deep-equal; overwrite; unicode roundtrip. |
| `files-discovery.test.ts` (+15) | Standard and pattern-based test folders (first non-empty `testFolders` assertions); `.github` whitelist; 50% boundary; unrecognizable content; exclusion during recursion; nested-file heuristics; extensionless README; uppercase extension pin (known issue 8); ENOTDIR; empty exclusion list; prefix over-match pin (known issue 10); unicode names; symlinked directory pin; result sorting. |
| `list-editor.test.ts` (+15) | Fallback pagination, cancelled select, filter hide/clear, empty items, forceFallback; TUI escape, placeholder, focus transitions both directions, cursor clamp, duplicate add, filter label, unknown keys. |
| `role-picker.test.ts` (+10) | Wrap-around both directions; scroll window both bounds; empty items; unknown initialSelectedId; unknown keys; fallback empty items; label without agent; custom subtitle; tiny width. |

### Feature: doctor setup progress (added 2026-07-20)

| Test file | Focus of added tests |
| --- | --- |
| `doctor.test.ts` (+8 base) | Every step transition (empty → fully configured), first-position placement, progress count, no-error guarantee. |
| `doctor.test.ts` (+12 edge) | All 5 corrupted-config catch branches; mapped-but-missing agent file; custom-only mappings; out-of-order completion (first incomplete step wins); different-project slug; folder-name slug fallback; step 6/7 row states; formatted report output. |
| `doctor.test.ts` (+4 step-5 fix) | Empty-assignments file stays pending; reads-only counts as done; empty role object stays pending; empty reads array stays pending. |

### Feature: document-scope guidance (added 2026-07-28)

| Test file | Focus of added tests |
| --- | --- |
| `document-suggestions.test.ts` (+11 base) | Type matching per rule group, typed-beats-keyword priority, keyword fallback, code-scout silence, empty/corrupted config handling. |
| `document-suggestions.test.ts` (+6 edge) | Folder paths skipped, cross-source dedup, keyword-overlap multi-group suggestion, unmatched types, basename-only matching, case-insensitivity. |
| `doctor.test.ts` (+4 base) | Warning with suggestions, info when nothing confident, no warning when assigned, unassigned-only filtering. |
| `doctor.test.ts` (+2 edge) | Assigned-but-missing truth file errors and is not re-suggested; exact warning count. |
| `commands.test.ts` (+2) | Picker shows only the 11 document roles; hidden-role entries survive a configure run. |

---

## 3. Known issues — ALL FIXED (2026-07-20)

All 12 issues found during the edge-case round have been fixed in source and the tests now assert the fixed behavior.

| # | File | Was | Fix applied |
| --- | --- | --- | --- |
| 1 | `agent-registry.ts` | Empty-string mapping showed an empty agent name (`??` does not catch `""`). | **FIXED** — falsy fallback to the default agent, matching `resolveAgentName`. |
| 2 | `agent-generator.ts` | Report with all-empty arrays emitted a bare `## Project context` header. | **FIXED** — the block is omitted when all sections are empty. |
| 3 | `agent-config.ts` | `agents: []` (array) and non-string values passed validation. | **FIXED** — arrays rejected; each mapping must be a string. |
| 4 | `agents-files-config.ts` | `version: 0` was silently migrated to 2. | **FIXED** — versions below 1 are rejected; v1 still migrates. |
| 5 | `architect-tools.ts` | Corrupted `agents.json` crashed `senai_finalize_architecture` after artifacts were already written (partial-write hazard). | **FIXED** — config is validated before any artifact is written. |
| 6 | `architect.ts` | A custom agent whose name starts with the project slug was treated as stale-generated and remapped. | **FIXED** — stale detection requires the agent file to be missing from disk; live custom files are never clobbered. |
| 7 | `document-ingest.ts` | `buildIngestBatches(items, 0)` looped forever. | **FIXED** — throws on zero, negative, or non-integer batch sizes (tested). |
| 8 | `files-discovery.ts` | Uppercase extensions (`APP.TS`) fell through unclassified. | **FIXED** — extension is lowercased before matching. |
| 9 | `state.ts` | Garbage `currentStage` crashed `advanceStage` with a TypeError. | **FIXED** — invalid stages are reset to `"none"` on load (both migration and version-1 paths). |
| 10 | `files-discovery.ts` | `isExcluded("distfoo.ts", ["dist"])` over-matched on prefix. | **FIXED** — path-segment boundary required. |
| 11 | `files-discovery.ts` + `files-config.ts` | Substring test matching: `latest/`, `contest.md` matched "test"; same bug in `migrateFilesConfig`. | **FIXED** — delimiter-aware `TEST_PATTERNS` + shared `looksLikeTestPath` helper used by both files. |
| 12 | `driver-extractor.ts` | `findDriverGaps` did not treat category `"scalability"` as scale coverage. | **FIXED** — `"scalability"` is recognized alongside `"scale"` and `"performance"`. |
| 13 | `doctor.ts` | `checkArchitectureSetup` called `loadArchitectInputsConfig` unguarded — a corrupted `architect-inputs.json` crashed the entire doctor run. | **FIXED** (2026-07-20) — guarded like the neighboring `loadDrivers` block; corrupted config is now reported as an error item with a fix hint. |

---

## 4. Untestable as written (no tests invented)

| File | Item | Reason |
| --- | --- | --- |
| ~~`document-ingest.ts`~~ | ~~`buildIngestBatches(items, 0)`~~ | ~~Infinite loop~~ — **FIXED**: now guarded and tested. |
| `prompt.ts`, `commands.ts` | Skill-path fallback variants (`resolveSkillPath`, `defaultArchitectSkill`) | Skill resolution is hard-wired to the repo's real `skills/` dir; no fs injection seam. |
| `index.ts` | Migration side effects on load | Uses `process.cwd()`, not an injectable cwd; would touch the real repo under test. |
| `agent-config.ts` | `validateMappedAgents` user-dir resolution | Depends on real `getAgentDir()`; no injection point. |
| `agent-discovery.ts` | User-agent override/dedup by project agent | Same `getAgentDir()` limitation. Note: `discoverAgents` tests are not fully hermetic — they read the real user agents dir. |
| `doctor.ts` | Bundled `generic.md` missing/invalid branch | Bundled dir is cwd-independent; simulating absence would touch the real resources. |
| `agent-generator.ts` | `getBundledTechnologiesDir` dist-layout fallback | Requires relocating installed files. |
| `commands.ts` | `matched.length === 0` ("No technology resources found") | Requires deleting bundled resources. |
| `migrate.ts`, `architect.ts` | Cross-device `renameSync` failure (EXDEV) | Cannot reproduce in a tmp dir; no copy+delete fallback exists. |

---

## 5. How to run

```bash
npm run build   # compile pi-extension/src → dist/pi-extension
npm test        # build + full suite
node --test dist/pi-extension/test/<file>.test.js   # single file
```

## 6. Coverage summary

- Tests before the edge-case round: 485 (all passing).
- Edge-case round: +198 tests → 683 (all passing).
- Bugfix round (2026-07-20): all 12 known issues fixed in source; pinned tests updated to assert fixed behavior; guard tests added. Final: **686 tests, 686 passing, 0 failures**.
- Doctor guidance round (2026-07-20): setup-progress section added (8 base tests) + 12 edge tests; issue 13 (doctor crash on corrupted architect-inputs) found by an edge test and fixed. Final: **706 tests, 706 passing, 0 failures**.
- Document-scope guidance round (2026-07-28): suggestion module + curated picker added; step-5 detection strengthened (empty assignments stay pending). Base + edge coverage added. Final: **735 tests, 735 passing, 0 failures**.
- Picker needs + suggestions round (2026-08-02): +11 tests → **814 tests, 814 passing, 0 failures**.
- List editor Option A round (2026-08-02): +12 tests → **826 tests, 826 passing, 0 failures**.
- Deviations recorded during the edge-case round:
  - `loadState` with a JSON `null` body throws (pinned) rather than returning the default state.
  - `getArtifactPaths` returns 19 fields (the interface has 19, not 18 as first estimated).
  - `agents_files.json` version 1 is silently migrated on load (legitimate v1→v2 migration — kept).
  - Known issue 12 was found during test writing and added above.

## 7. Doctor assignment validation round (2026-08-02)

Scope: unit + edge coverage for the assignment-validation feature in `doctor.ts`
(artifact-role check, suggestion-rule mismatch, mandate check, unverifiable report).

### Unit tests per helper

| Function | Cases | Edge cases covered |
|---|---|---|
| `significantWords` | 8 | empty string, stopword-only, <4-char words, 4-char boundary, digits, punctuation split, uppercase |
| `wordsOverlap` | 7 | exact, prefix both directions, empty sets, <4-char no-prefix rule |
| `mandateTextForRole` | 4 | custom description, builtin (null frontmatter), non-generated role, word extraction end-to-end |
| `documentSignalWords` | 8 | filename, heading, classified type, directory-as-file, corrupted config, 3-char name, multi-extension |

### Integration edge cases (via `runSenaiDiagnostic`)

| # | Scenario | Asserts |
|---|---|---|
| 1 | two unverifiable assignments | single aggregated warning with count |
| 2 | missing assigned file | MISSING error only, no mandate double-report |
| 3 | artifact role with `reads: []` | not treated as an assignment |
| 4 | artifact role with `{}` | not treated as an assignment |
| 5 | missing + mismatched Layer-1 doc | no double error |
| 6 | two mismatched Layer-1 roles | one error per role |
| 7 | type-classified overlap (`code`) | mandate check passes via classification |

Method: helpers exported for direct unit tests (user decision); `ResolvedAgent`
exported because `declaration: true` forbids exporting functions over private types.

## 8. Picker role guidance round (2026-08-02)

Scope: unit + edge coverage for the role-guidance feature
(`ROLE_GUIDANCE` map, `GUIDANCE_COLORS`, guidance rendering in `runRolePicker`
and its sub-functions, `commands.ts` wiring).

Method: sub-functions (`renderRow`, `render`, `move`, `ensureVisible`) are
closures inside `runCustomRolePicker` and cannot be exported; all tests reach
them through `runRolePicker` with mock contexts (established file pattern).
No source changes.

### Unit/edge tests per function

| Function / sub-function | Cases | Edge cases covered |
|---|---|---|
| `makeFallbackOptions` | 3 | undefined guidance (no tag), assigned ✅ + tag, all tag kinds in fallback |
| `renderRow` (custom) | 4 | Finish row clean, focused path keeps tag, no-guidance row, assigned + tag |
| `ROLE_GUIDANCE` (data) | 2 | only valid tag values, no keys outside `DOCUMENT_ROLES` |
| `commands.ts` wiring | 1 | tags flow into live picker options (scout-1/scout-3/planner spot checks) |

### Already covered in the feature round (not duplicated)

- Selection/finish/back, scrolling, wrapping, tiny width, subtitle (18 tests)
- Guidance tag text in both pickers, all 3 theme colors, map completeness (5 tests)

## 9. Picker needs + suggestions round (2026-08-02)

Scope: unit + edge coverage for the needs-labels and dynamic-suggestions feature
(`roleDocumentNeed`, needs rendering in `makeFallbackOptions`/`renderRow`,
`commands.ts` suggested-file wiring). No source changes — tests pin current behavior.

### Unit/edge tests per function

| Function / sub-function | Cases | Edge cases covered |
|---|---|---|
| `roleDocumentNeed` | 3 | every remaining rule role; all artifact/other roles → undefined; full `SENAI_ROLES` sweep (rename/dropped-rule guard) |
| `makeFallbackOptions` | 2 | needs↔label↔agent ordering; needs + ✅ assigned marker together |
| `renderRow` (custom) | 2 | focused row keeps needs; needs + colored guidance tag on one row |
| `commands.ts` wiring | 4 | plain `not set` with no candidate; keyword-matched suggestion from `files.json`; reads-only assignment hides suggestion; needs on the 5 rule rows, absent on scout-2/scout-3 |

### Already covered in the feature round (not duplicated)

- Needs values for 3 roles, scout-1 need, undefined for code scouts (3 tests)
- Needs rendering in both pickers, unset-needs omission (2 tests)
- Typed-RTM suggestion row, assigned-row suggestion hiding (2 tests)

## 10. List editor Option A round (2026-08-02)

Scope: the custom list editor rebuilt as Option A — `✅ Selected (N)` pinned on top,
`💡 Suggestions (N)` below, uniform markers, Enter toggles — plus long-path handling
(`truncateMiddle`, focused-row detail line). `runCustomListEditor` moved from
`SelectList` to the role-picker manual-render pattern; the fallback editor is
unchanged, so `commands.test.ts` needed no changes.

### Unit/edge tests per function

| Function / sub-function | Cases | Edge cases covered |
|---|---|---|
| `truncateMiddle` | 7 | fits, long dirs (filename whole), oversized filename (tail kept), exact boundary, widths 0/1/2, trailing-slash folder, same-head pairs stay distinguishable |
| `render` (sections) | 2 | headers with counts, Selected pinned top; uniform ✅/⬜ markers, no `Suggest:`/`Remove:` prefix swap |
| `toggleFocused` | 1 | suggestion → selected → suggestion round trip with counts |
| `detailLines` | 1 | full untruncated path of the focused row at width 40, row itself truncated |
| `render` (narrow) | 1 | widths 20 and 1 — no crash, rows still identifiable |

### Adapted existing tests (14, custom TUI describe)

SelectList-internal assertions re-pointed at rendered lines: `(no items)` →
section placeholders (`Selected (0)` / `Suggestions (0)` / `(none)`), label
assertions updated for uniform markers. Fallback describe untouched.
