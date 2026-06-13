import * as fs from "node:fs";
import * as path from "node:path";
import {
  getArtifactPaths,
  getOrchestraDir,
  getRunDir,
  getStatePath,
  makeRunId,
  STAGE_TRANSITIONS,
  type Stage,
} from "./constants.js";

export interface OrchestraState {
  version: number;
  mission: string;
  runId: string;
  currentStage: Stage;
  startedAt: string;
  updatedAt: string;
  stageResults: Record<string, string | null>;
}

const CURRENT_VERSION = 1;

export function defaultState(): OrchestraState {
  return {
    version: CURRENT_VERSION,
    mission: "",
    runId: "",
    currentStage: "none",
    startedAt: "",
    updatedAt: "",
    stageResults: {},
  };
}

export function loadState(cwd: string): OrchestraState {
  const statePath = getStatePath(cwd);
  try {
    const raw = fs.readFileSync(statePath, "utf8");
    const parsed = JSON.parse(raw) as OrchestraState;
    if (parsed.version !== CURRENT_VERSION) {
      return migrateState(parsed);
    }
    return parsed;
  } catch (err: any) {
    if (err.code === "ENOENT") {
      return defaultState();
    }
    throw err;
  }
}

export function saveState(cwd: string, state: OrchestraState): void {
  const statePath = getStatePath(cwd);
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2), "utf8");
}

export function startRun(cwd: string, mission: string): OrchestraState {
  const runId = makeRunId(mission);
  const now = new Date().toISOString();
  const state: OrchestraState = {
    version: CURRENT_VERSION,
    mission,
    runId,
    currentStage: "none",
    startedAt: now,
    updatedAt: now,
    stageResults: {},
  };
  const artifacts = getArtifactPaths(cwd, runId);
  fs.mkdirSync(artifacts.planScoutsDir, { recursive: true });
  fs.mkdirSync(artifacts.planReviewsDir, { recursive: true });
  fs.mkdirSync(artifacts.implementDir, { recursive: true });
  fs.mkdirSync(artifacts.documentDir, { recursive: true });
  fs.mkdirSync(artifacts.deliverDir, { recursive: true });
  saveState(cwd, state);
  return state;
}

export function advanceStage(
  cwd: string,
  state: OrchestraState,
  nextStage: Stage,
): { ok: true; state: OrchestraState } | { ok: false; reason: string } {
  const allowed = STAGE_TRANSITIONS[state.currentStage];
  if (!allowed.includes(nextStage)) {
    return {
      ok: false,
      reason: `Cannot move from '${state.currentStage}' to '${nextStage}'. Valid next stages: ${allowed.join(", ") || "(none)"}.`,
    };
  }
  state.currentStage = nextStage;
  state.updatedAt = new Date().toISOString();
  saveState(cwd, state);
  return { ok: true, state };
}

export function resetState(cwd: string): void {
  const statePath = getStatePath(cwd);
  try {
    fs.unlinkSync(statePath);
  } catch (err: any) {
    if (err.code !== "ENOENT") throw err;
  }
}

function migrateState(old: any): OrchestraState {
  const fresh = defaultState();
  if (old && typeof old === "object") {
    if (typeof old.mission === "string") fresh.mission = old.mission;
    if (typeof old.runId === "string") fresh.runId = old.runId;
    if (typeof old.currentStage === "string") fresh.currentStage = old.currentStage as Stage;
    if (typeof old.startedAt === "string") fresh.startedAt = old.startedAt;
    if (typeof old.updatedAt === "string") fresh.updatedAt = old.updatedAt;
    if (old.stageResults && typeof old.stageResults === "object") {
      fresh.stageResults = old.stageResults;
    }
  }
  return fresh;
}
