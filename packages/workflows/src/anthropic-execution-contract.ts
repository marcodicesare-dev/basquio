import Anthropic from "@anthropic-ai/sdk";

export const FILES_BETA = "files-api-2025-04-14";
export const SKILLS_BETA = "skills-2025-10-02";
export const CODE_EXEC_BETA = "code-execution-2025-08-25";
export const BETAS = [FILES_BETA, SKILLS_BETA, CODE_EXEC_BETA] as const;
export type ClaudeAuthorModel = "claude-sonnet-4-6" | "claude-haiku-4-5" | "claude-opus-4-6";

export const AUTHORING_TOOL_CALL_SUMMARY = {
  tools: ["web_fetch"] as const,
  autoInjectedTools: ["code_execution"] as const,
  skills: ["pptx", "pdf"] as const,
};

export function buildClaudeBetas(model: ClaudeAuthorModel): Anthropic.Beta.AnthropicBeta[] {
  return model === "claude-haiku-4-5"
    ? [FILES_BETA, CODE_EXEC_BETA]
    : [FILES_BETA, SKILLS_BETA, CODE_EXEC_BETA];
}

export function buildAuthoringToolCallSummary(model: ClaudeAuthorModel) {
  return {
    tools: [...AUTHORING_TOOL_CALL_SUMMARY.tools],
    autoInjectedTools: [...AUTHORING_TOOL_CALL_SUMMARY.autoInjectedTools],
    skills: model === "claude-haiku-4-5" ? [] : [...AUTHORING_TOOL_CALL_SUMMARY.skills],
  } as const;
}

export function buildClaudeTools(
  model: ClaudeAuthorModel = "claude-sonnet-4-6",
): Anthropic.Beta.BetaToolUnion[] {
  return [
    model === "claude-haiku-4-5"
      ? { type: "web_fetch_20260209", name: "web_fetch", allowed_callers: ["direct"] }
      : { type: "web_fetch_20260209", name: "web_fetch" },
  ];
}

export const CLAUDE_TOOLS = buildClaudeTools();

const AUTHORING_SKILLS = [
  { type: "anthropic", skill_id: "pptx", version: "latest" },
  { type: "anthropic", skill_id: "pdf", version: "latest" },
] as const;

export function buildAuthoringOutputConfig(
  model: ClaudeAuthorModel,
): Anthropic.Beta.BetaOutputConfig | undefined {
  if (model === "claude-haiku-4-5") {
    return undefined;
  }

  return {
    effort: "medium",
  } as const satisfies Anthropic.Beta.BetaOutputConfig;
}

export function buildAuthoringContainer(
  containerId?: string | null,
  model: ClaudeAuthorModel = "claude-sonnet-4-6",
): Anthropic.Beta.BetaContainerParams {
  if (model === "claude-haiku-4-5") {
    return containerId ? { id: containerId } : {};
  }
  const skills = AUTHORING_SKILLS.map((skill) => ({ ...skill }));
  return containerId
    ? { id: containerId, skills }
    : { skills };
}
