// Layer 0 — pure types and a regex used by core/agents-config/.
// The I/O parts of file discovery live in agents/files-discovery.ts (Layer 2).

export interface FileDiscoveryResult {
	codeFolders: SuggestedFolder[];
	codeFiles: string[];
	documentFolders: SuggestedFolder[];
	documentFiles: string[];
	testFolders: SuggestedFolder[];
	testFiles: string[];
}

export interface SuggestedFolder {
	path: string;
	reason: string;
}

const TEST_PATTERNS = /(^|[._\-/])(test|tests|testing|spec|specs|__tests__)(?=[._\-/]|$)/i;

/** True when a path looks test-related (segment/delimiter aware). */
export function looksLikeTestPath(p: string): boolean {
	return TEST_PATTERNS.test(p.toLowerCase());
}
