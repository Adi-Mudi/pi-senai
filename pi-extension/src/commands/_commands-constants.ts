// Constants used across multiple per-command files in commands/.

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

export const STAGE_COMMANDS: Record<string, string> = {
	planned: "implementing",
	implemented: "documenting",
	documented: "delivering",
};

export const STAGE_SKILL: Record<string, string> = {
	implementing: "implement",
	documenting: "document",
	delivering: "deliver",
};
