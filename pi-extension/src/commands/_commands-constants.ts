// Constants used across multiple per-command files in commands/.
// Extracted during Phase 3l.4.

export const NEXT_COMMAND: Record<string, string> = {
	planning: "/senai-approve",
	planned: "/senai-implement",
	implementing: "/senai-approve",
	implemented: "/senai-document",
	documenting: "/senai-approve",
	documented: "/senai-deliver",
	delivering: "/senai-approve",
	delivered: "/senai-status",
};
