import * as fs from "node:fs";
import * as path from "node:path";
import { getArchitectStateDir } from "../core/paths.js";
import { atomicWriteJson } from "../io/atomic-write.js";

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

export function normalizeDriverItem(item: unknown): DriverItem | null {
  if (typeof item !== "object" || item === null) return null;
  const obj = item as Record<string, unknown>;

  const description = typeof obj.description === "string" ? obj.description.trim() : "";
  if (!description) return null;

  let id = typeof obj.id === "string" ? obj.id.trim() : "";
  if (!id && typeof obj.driver === "string") {
    id = obj.driver.trim();
  }
  if (!id && typeof obj.name === "string") {
    id = obj.name.trim();
  }
  if (!id) return null;

  const normalized: DriverItem = { id, description };
  const source = typeof obj.source === "string" ? obj.source.trim() : "";
  if (source) normalized.source = source;
  return normalized;
}

export function normalizeQualityAttributeItem(item: unknown): QualityAttributeItem | null {
  const base = normalizeDriverItem(item);
  if (!base) return null;
  const obj = item as Record<string, unknown>;
  const category = typeof obj.category === "string" ? obj.category.trim() : "";
  if (!category) return null;
  const normalized: QualityAttributeItem = { ...base, category };
  const target = typeof obj.target === "string" ? obj.target.trim() : "";
  if (target) normalized.target = target;
  return normalized;
}

export function normalizeConstraintItem(item: unknown): ConstraintItem | null {
  const base = normalizeDriverItem(item);
  if (!base) return null;
  const obj = item as Record<string, unknown>;
  const category = typeof obj.category === "string" ? obj.category.trim() : "";
  if (!category) return null;
  return { ...base, category };
}

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
    return {
      functionalRequirements: obj.functionalRequirements
        .map(normalizeDriverItem)
        .filter((i): i is DriverItem => i !== null),
      qualityAttributes: obj.qualityAttributes
        .map(normalizeQualityAttributeItem)
        .filter((i): i is QualityAttributeItem => i !== null),
      constraints: obj.constraints
        .map(normalizeConstraintItem)
        .filter((i): i is ConstraintItem => i !== null),
      technicalConcerns: obj.technicalConcerns
        .map(normalizeDriverItem)
        .filter((i): i is DriverItem => i !== null),
      uncertainties: obj.uncertainties.filter((u): u is string => typeof u === "string" && u.trim() !== ""),
    };
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
  atomicWriteJson(getDriversPath(cwd), drivers);
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
    for (let i = 0; i < drivers[key].length; i++) {
      const item = drivers[key][i];
      if (typeof item !== "string" && (!item || typeof item !== "object")) {
        throw new Error(`'${key}[${i}]' must be a string or a valid driver object`);
      }
      if (typeof item === "object") {
        if (typeof item.id !== "string" || item.id.trim() === "") {
          throw new Error(`'${key}[${i}]' is missing a valid 'id' string`);
        }
        if (typeof item.description !== "string" || item.description.trim() === "") {
          throw new Error(`'${key}[${i}]' is missing a valid 'description' string`);
        }
        if (
          (key === "qualityAttributes" || key === "constraints") &&
          (typeof (item as any).category !== "string" || (item as any).category.trim() === "")
        ) {
          throw new Error(`'${key}[${i}]' is missing a valid 'category' string`);
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

  const hasScale = drivers.qualityAttributes.some((qa) => {
    const category = qa.category.toLowerCase();
    return category.includes("scale") || category.includes("scalability") || category.includes("performance");
  });
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
