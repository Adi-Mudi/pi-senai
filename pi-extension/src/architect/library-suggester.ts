import type { ArchitectureLibraryEntry } from "./index.js";

export type ProjectPurpose = "extension" | "coding-agent" | "web-app" | "api" | "library";
export type ProjectScale = "single-user" | "small-team" | "medium-team" | "large-org";
export type ProjectDeployment = "cloud" | "on-premise" | "local" | "edge";
export type ProjectRealtime = "yes" | "no";

export interface ProjectAnswers {
	purpose: ProjectPurpose;
	scale: ProjectScale;
	deployment: ProjectDeployment;
	realtime: ProjectRealtime;
}

export interface LibrarySuggestion {
	entry: ArchitectureLibraryEntry;
	score: number;
	matchedKeywords: string[];
	rationale: string;
}

const PURPOSE_KEYWORDS: Record<ProjectPurpose, string[]> = {
	"extension": ["extension", "extensionapi", "registertool", "skill", "pi-coding-agent"],
	"coding-agent": ["ai agent", "agent toolkit", "cli", "coding agent", "subagent"],
	"web-app": ["web", "crud", "presentation", "browser", "spa"],
	"api": ["api", "backend", "service", "microservice", "rest"],
	"library": ["library", "sdk", "module", "package"],
};

const SCALE_KEYWORDS: Record<ProjectScale, string[]> = {
	"single-user": ["single user", "prototype", "small to medium", "beginner"],
	"small-team": ["small team", "small-to-medium", "fast development"],
	"medium-team": ["medium team", "small to medium", "intermediate"],
	"large-org": ["large", "enterprise", "distributed", "microservices"],
};

const DEPLOYMENT_KEYWORDS: Record<ProjectDeployment, string[]> = {
	"cloud": ["cloud", "aws", "gcp", "azure", "kubernetes", "serverless"],
	"on-premise": ["on-premise", "on-prem", "datacenter", "self-hosted"],
	"local": ["local", "desktop", "cli", "standalone"],
	"edge": ["edge", "iot", "embedded", "plc"],
};

const REALTIME_KEYWORDS: Record<ProjectRealtime, string[]> = {
	"yes": ["realtime", "real-time", "websocket", "live update", "event-driven", "cqrs", "event sourcing"],
	"no": ["request", "response", "crud", "batch"],
};

const PURPOSE_DOMAIN_BONUS: Record<ProjectPurpose, string[]> = {
	"extension": ["pi-extension", "pi-extension-spec", "pi-extension-project"],
	"coding-agent": ["agent-toolkit", "pi-extension-project", "agent"],
	"web-app": ["web", "desktop", "enterprise", "spa"],
	"api": ["api", "backend", "service", "microservices"],
	"library": ["library", "sdk", "module"],
};

export function suggestArchitectures(
	answers: ProjectAnswers,
	library: ArchitectureLibraryEntry[],
	topN = 3,
): LibrarySuggestion[] {
	if (library.length === 0) return [];

	const candidateKeywords = collectCandidateKeywords(answers);
	const purposeDomains = PURPOSE_DOMAIN_BONUS[answers.purpose];

	const scored: LibrarySuggestion[] = library.map((entry) => {
		const matched: string[] = [];
		let score = 0;

		for (const keyword of entry.bestForDrivers) {
			if (candidateKeywords.has(keyword.toLowerCase())) {
				score += 1;
				matched.push(keyword);
			}
		}
		for (const keyword of entry.notForDrivers) {
			if (candidateKeywords.has(keyword.toLowerCase())) {
				score -= 2;
			}
		}
		for (const domain of entry.domain) {
			if (purposeDomains.includes(domain.toLowerCase())) {
				score += 3;
				matched.push(`domain:${domain}`);
			}
		}

		return {
			entry,
			score,
			matchedKeywords: matched,
			rationale: buildRationale(entry, matched, answers),
		};
	});

	scored.sort((a, b) => {
		if (b.score !== a.score) return b.score - a.score;
		return a.entry.name.localeCompare(b.entry.name);
	});

	return scored.slice(0, Math.max(0, topN));
}

function collectCandidateKeywords(answers: ProjectAnswers): Set<string> {
	const all = [
		...PURPOSE_KEYWORDS[answers.purpose],
		...SCALE_KEYWORDS[answers.scale],
		...DEPLOYMENT_KEYWORDS[answers.deployment],
		...REALTIME_KEYWORDS[answers.realtime],
	];
	return new Set(all.map((k) => k.toLowerCase()));
}

function buildRationale(
	entry: ArchitectureLibraryEntry,
	matched: string[],
	answers: ProjectAnswers,
): string {
	const parts: string[] = [];
	parts.push(`purpose=${answers.purpose}`);
	if (answers.scale) parts.push(`scale=${answers.scale}`);
	if (answers.deployment) parts.push(`deployment=${answers.deployment}`);
	if (answers.realtime === "yes") parts.push("realtime");

	const matchedDomains = matched.filter((m) => m.startsWith("domain:"));
	if (matchedDomains.length > 0) {
		parts.push(`domain match (${matchedDomains.length})`);
	}
	const matchedDrivers = matched.filter((m) => !m.startsWith("domain:"));
	if (matchedDrivers.length > 0) {
		parts.push(`${matchedDrivers.length} driver keyword${matchedDrivers.length === 1 ? "" : "s"} matched`);
	}
	return `${entry.name}: ${parts.join(", ")}`;
}

export const ALL_PROJECT_ANSWERS_KEYS: ReadonlyArray<keyof ProjectAnswers> = [
	"purpose",
	"scale",
	"deployment",
	"realtime",
];