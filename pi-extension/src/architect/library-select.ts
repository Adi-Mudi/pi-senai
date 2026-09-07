// Selects the best architecture from the library given a set of architectural drivers.
// Scores each entry by how many of its best-for drivers appear in the driver text,
// penalises for not-for drivers, and gives a +10 boost to the Pi extension entry
// when the project is detected as a Pi extension.

import type { ArchitecturalDrivers } from "./drivers.js";
import type { ArchitectureLibraryEntry } from "./library-scan.js";
import { buildDriverText } from "./helpers.js";

export function selectArchitecture(
	drivers: ArchitecturalDrivers,
	library: ArchitectureLibraryEntry[],
): ArchitectureLibraryEntry | null {
	return selectArchitectureWithContext(drivers, library, null);
}

export function selectArchitectureWithContext(
	drivers: ArchitecturalDrivers,
	library: ArchitectureLibraryEntry[],
	piExtensionDetection: { isPiExtension: boolean; confidence: number } | null,
): ArchitectureLibraryEntry | null {
	if (library.length === 0) return null;

	const driverText = buildDriverText(drivers).toLowerCase();

	const scored = library.map((entry) => {
		let score = 0;
		for (const driver of entry.bestForDrivers) {
			if (driverText.includes(driver.toLowerCase())) score += 1;
		}
		for (const driver of entry.notForDrivers) {
			if (driverText.includes(driver.toLowerCase())) score -= 2;
		}
		if (piExtensionDetection?.isPiExtension && entry.id === "pi-architecture") {
			score += 10 * Math.max(0.5, piExtensionDetection.confidence);
		}
		return { entry, score };
	});

	scored.sort((a, b) => b.score - a.score);
	return scored[0].entry;
}
