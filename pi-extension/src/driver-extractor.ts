import * as fs from "node:fs";
import * as path from "node:path";
import { getArchitectStateDir } from "./constants.js";

export const DRIVERS_FILE = "architectural-drivers.json";

export interface DriverItem {
  id: string;
  description: string;
  source?: string;
}

export interface QualityAttributeItem extends DriverItem {
  category: string;
  target?: string;
}

export interface ConstraintItem extends DriverItem {
  category: string;
}

export interface ArchitecturalDrivers {
  functionalRequirements: DriverItem[];
  qualityAttributes: QualityAttributeItem[];
  constraints: ConstraintItem[];
  technicalConcerns: DriverItem[];
  uncertainties: string[];
}

export type DriverGap = {
  category: "functional" | "quality" | "constraints" | "technical" | "scale" | "deployment" | "project-type";
  message: string;
};

export function getDriversPath(cwd: string): string {
  return path.join(getArchitectStateDir(cwd), DRIVERS_FILE);
}

export function loadDrivers(cwd: string): ArchitecturalDrivers | null {
  const driversPath = getDriversPath(cwd);
  try {
    const raw = fs.readFileSync(driversPath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    const normalized = normalizeDrivers(parsed);
    if (normalized) {
      validateDrivers(normalized);
      return normalized;
    }
    return null;
  } catch (err: any) {
    if (err.code === "ENOENT") return null;
    throw new Error(`Invalid architectural drivers at ${driversPath}: ${err.message}`);
  }
}

export function normalizeDrivers(value: unknown): ArchitecturalDrivers | null {
  if (!value || typeof value !== "object") return null;

  const obj = value as Record<string, unknown>;

  // Standard schema already in place.
  if (
    Array.isArray(obj.functionalRequirements) &&
    Array.isArray(obj.qualityAttributes) &&
    Array.isArray(obj.constraints) &&
    Array.isArray(obj.technicalConcerns) &&
    Array.isArray(obj.uncertainties)
  ) {
    return obj as unknown as ArchitecturalDrivers;
  }

  // Legacy flat schema used by some early runs: top-level "drivers" array.
  if (Array.isArray(obj.drivers)) {
    const result: ArchitecturalDrivers = {
      functionalRequirements: [],
      qualityAttributes: [],
      constraints: [],
      technicalConcerns: [],
      uncertainties: [],
    };

    for (const item of obj.drivers) {
      if (!item || typeof item !== "object") continue;
      const raw = item as Record<string, unknown>;
      const id = String(raw.id ?? "unknown");
      const description = String(raw.description ?? raw.name ?? "");
      const source = String(raw.source ?? "");
      const category = String(raw.category ?? "").toLowerCase();
      if (!description) continue;

      const base: DriverItem = { id, description };
      if (source) base.source = source;

      if (category === "functional") {
        result.functionalRequirements.push(base);
      } else if (
        ["quality", "performance", "security", "reliability", "maintainability", "observability", "testability"].includes(category)
      ) {
        result.qualityAttributes.push({ ...base, category });
      } else if (category === "technical") {
        result.technicalConcerns.push(base);
      } else {
        result.constraints.push({ ...base, category: category || "general" });
      }
    }

    if (Array.isArray(obj.uncertainties)) {
      result.uncertainties = obj.uncertainties.filter((u): u is string => typeof u === "string");
    }

    return result;
  }

  return null;
}

export function saveDrivers(cwd: string, drivers: ArchitecturalDrivers): void {
  const driversPath = getDriversPath(cwd);
  fs.mkdirSync(path.dirname(driversPath), { recursive: true });
  fs.writeFileSync(driversPath, JSON.stringify(drivers, null, 2), "utf8");
}

export function validateDrivers(drivers: ArchitecturalDrivers): void {
  if (!drivers || typeof drivers !== "object") {
    throw new Error("Drivers must be an object");
  }
  const arrays = ["functionalRequirements", "qualityAttributes", "constraints", "technicalConcerns", "uncertainties"] as const;
  for (const key of arrays) {
    if (!Array.isArray(drivers[key])) {
      throw new Error(`Missing or invalid '${key}' field`);
    }
    for (const item of drivers[key]) {
      if (typeof item !== "string" && (!item || typeof item !== "object")) {
        throw new Error(`'${key}' must contain only strings or objects`);
      }
      if (typeof item === "object") {
        if (typeof item.id !== "string" || typeof item.description !== "string") {
          throw new Error(`Each driver item must have 'id' and 'description' strings`);
        }
      }
    }
  }
}

export function createEmptyDrivers(): ArchitecturalDrivers {
  return {
    functionalRequirements: [],
    qualityAttributes: [],
    constraints: [],
    technicalConcerns: [],
    uncertainties: [],
  };
}

export function findDriverGaps(drivers: ArchitecturalDrivers): DriverGap[] {
  const gaps: DriverGap[] = [];

  if (drivers.functionalRequirements.length === 0) {
    gaps.push({
      category: "functional",
      message: "No functional requirements found. What should the system do?",
    });
  }

  const hasScale = drivers.qualityAttributes.some(
    (qa) => qa.category.toLowerCase().includes("scale") || qa.category.toLowerCase().includes("performance"),
  );
  if (!hasScale) {
    gaps.push({
      category: "scale",
      message: "No scale or performance target found. How many users or requests should the system handle?",
    });
  }

  const hasDeployment = drivers.constraints.some(
    (c) =>
      c.category.toLowerCase().includes("deploy") ||
      c.category.toLowerCase().includes("environment") ||
      c.category.toLowerCase().includes("platform"),
  ) || drivers.technicalConcerns.some(
    (tc) =>
      tc.description.toLowerCase().includes("cloud") ||
      tc.description.toLowerCase().includes("on-premise") ||
      tc.description.toLowerCase().includes("offline"),
  );
  if (!hasDeployment) {
    gaps.push({
      category: "deployment",
      message: "No deployment target found. Will this run in the cloud, on-premise, offline, or on edge devices?",
    });
  }

  const hasProjectType = drivers.technicalConcerns.some(
    (tc) =>
      tc.description.toLowerCase().includes("web") ||
      tc.description.toLowerCase().includes("mobile") ||
      tc.description.toLowerCase().includes("desktop") ||
      tc.description.toLowerCase().includes("plc") ||
      tc.description.toLowerCase().includes("embedded") ||
      tc.description.toLowerCase().includes("iot"),
  ) || drivers.functionalRequirements.some(
    (fr) =>
      fr.description.toLowerCase().includes("web") ||
      fr.description.toLowerCase().includes("mobile") ||
      fr.description.toLowerCase().includes("desktop"),
  );
  if (!hasProjectType) {
    gaps.push({
      category: "project-type",
      message: "No clear project type found. Is this a web app, mobile app, desktop app, PLC system, IoT device, or something else?",
    });
  }

  return gaps;
}

export function isCriticalDriverPresent(
  drivers: ArchitecturalDrivers,
  category: DriverGap["category"],
): boolean {
  return findDriverGaps(drivers).every((gap) => gap.category !== category);
}

export function mergeDrivers(a: ArchitecturalDrivers, b: ArchitecturalDrivers): ArchitecturalDrivers {
  return {
    functionalRequirements: deduplicateById([...a.functionalRequirements, ...b.functionalRequirements]),
    qualityAttributes: deduplicateById([...a.qualityAttributes, ...b.qualityAttributes]),
    constraints: deduplicateById([...a.constraints, ...b.constraints]),
    technicalConcerns: deduplicateById([...a.technicalConcerns, ...b.technicalConcerns]),
    uncertainties: Array.from(new Set([...a.uncertainties, ...b.uncertainties])),
  };
}

function deduplicateById<T extends { id: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const item of items) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    result.push(item);
  }
  return result;
}
