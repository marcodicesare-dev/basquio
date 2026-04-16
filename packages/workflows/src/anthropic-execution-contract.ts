import Anthropic from "@anthropic-ai/sdk";

export const FILES_BETA = "files-api-2025-04-14";
export const SKILLS_BETA = "skills-2025-10-02";
export const CODE_EXEC_BETA = "code-execution-2025-08-25";
export const BETAS = [FILES_BETA, SKILLS_BETA, CODE_EXEC_BETA] as const;
export const OPUS_AUTHOR_MODEL = "claude-opus-4-7" as const;
export type ClaudeAuthorModel = "claude-sonnet-4-6" | "claude-haiku-4-5" | typeof OPUS_AUTHOR_MODEL;

export function normalizeClaudeAuthorModel(model: string | null | undefined): ClaudeAuthorModel {
  if (model === "claude-opus-4-6" || model === OPUS_AUTHOR_MODEL) {
    return OPUS_AUTHOR_MODEL;
  }
  if (model === "claude-haiku-4-5") {
    return "claude-haiku-4-5";
  }
  return "claude-sonnet-4-6";
}

export const AUTHORING_TOOL_CALL_SUMMARY = {
  tools: ["web_fetch"] as const,
  autoInjectedTools: ["code_execution"] as const,
  skills: ["pptx", "pdf"] as const,
};

export function buildClaudeBetas(model: ClaudeAuthorModel): Anthropic.Beta.AnthropicBeta[] {
  return model === "claude-haiku-4-5"
    ? [FILES_BETA]
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
  const tools: Anthropic.Beta.BetaToolUnion[] = [];

  // Haiku: no skills → code_execution must be EXPLICITLY in the tools array.
  // Sonnet/Opus: skills implicitly enable code_execution via the container.
  // Docs: https://platform.claude.com/docs/en/agents-and-tools/tool-use/code-execution-tool
  if (model === "claude-haiku-4-5") {
    tools.push({ type: "code_execution_20250825", name: "code_execution" });
  }

  tools.push(
    model === "claude-haiku-4-5"
      ? { type: "web_fetch_20260209", name: "web_fetch", allowed_callers: ["direct"] }
      : { type: "web_fetch_20260209", name: "web_fetch" },
  );

  return tools;
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
    effort: model === OPUS_AUTHOR_MODEL ? "high" : "medium",
  } as const satisfies Anthropic.Beta.BetaOutputConfig;
}

export type AuthoringContainer = Anthropic.Beta.BetaContainerParams | string | undefined;

export function buildAuthoringContainer(
  containerId?: string | null,
  model: ClaudeAuthorModel = "claude-sonnet-4-6",
): AuthoringContainer {
  if (model === "claude-haiku-4-5") {
    // Haiku: no skills. Pass container ID only if we have one from a previous call;
    // otherwise return undefined so the API auto-creates a bare container from
    // any container_upload blocks in the user message. Passing {} causes the API
    // to reject with "container: skills can only be used when a code execution
    // tool is enabled" even though no skills are present.
    return containerId ?? undefined;
  }
  const skills = AUTHORING_SKILLS.map((skill) => ({ ...skill }));
  return containerId
    ? { id: containerId, skills }
    : { skills };
}
