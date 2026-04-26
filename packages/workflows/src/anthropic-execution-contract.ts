import Anthropic from "@anthropic-ai/sdk";

export const FILES_BETA = "files-api-2025-04-14";
export const SKILLS_BETA = "skills-2025-10-02";
export const CODE_EXEC_BETA = "code-execution-2025-08-25";
export const BETAS = [FILES_BETA, SKILLS_BETA, CODE_EXEC_BETA] as const;
export const OPUS_AUTHOR_MODEL = "claude-opus-4-7" as const;
export type ClaudeAuthorModel = "claude-sonnet-4-6" | "claude-haiku-4-5" | typeof OPUS_AUTHOR_MODEL;
export type WebFetchMode = "off" | "enrich";
export type AuthoringPhase = "author" | "revise" | "smoke";

const CODE_EXECUTION_TOOL = {
  type: "code_execution_20250825",
  name: "code_execution",
} as const satisfies Anthropic.Beta.BetaToolUnion;

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

export function buildAuthoringToolCallSummary(
  model: ClaudeAuthorModel,
  options: { webFetchMode?: WebFetchMode } = {},
) {
  const webFetchMode = options.webFetchMode ?? "enrich";
  const isHaiku = model === "claude-haiku-4-5";
  return {
    tools: [
      ...(isHaiku || webFetchMode === "off" ? ["code_execution" as const] : []),
      ...(webFetchMode === "enrich" ? ["web_fetch" as const] : []),
    ],
    autoInjectedTools: !isHaiku && webFetchMode === "enrich" ? (["code_execution"] as const) : ([] as const),
    skills: model === "claude-haiku-4-5" ? [] : [...AUTHORING_TOOL_CALL_SUMMARY.skills],
  } as const;
}

export function buildClaudeTools(
  model: ClaudeAuthorModel = "claude-sonnet-4-6",
  options: { webFetchMode?: WebFetchMode } = {},
): Anthropic.Beta.BetaToolUnion[] {
  const webFetchMode = options.webFetchMode ?? "enrich";
  const tools: Anthropic.Beta.BetaToolUnion[] = [];

  if (model === "claude-haiku-4-5" || webFetchMode === "off") {
    tools.push({ ...CODE_EXECUTION_TOOL });
  }

  if (webFetchMode === "enrich") {
    tools.push(
      model === "claude-haiku-4-5"
        ? { type: "web_fetch_20260209", name: "web_fetch", allowed_callers: ["direct"] }
        : { type: "web_fetch_20260209", name: "web_fetch" },
    );
  }

  return tools;
}

export const CLAUDE_TOOLS = buildClaudeTools();

function hasToolNamed(tools: readonly Anthropic.Beta.BetaToolUnion[], toolName: string) {
  return tools.some((tool) => "name" in tool && typeof tool.name === "string" && tool.name === toolName);
}

export function assertAuthoringExecutionContract(input: {
  model: ClaudeAuthorModel;
  phase: AuthoringPhase;
  tools: readonly Anthropic.Beta.BetaToolUnion[];
  skills: readonly string[];
  webFetchMode?: WebFetchMode;
}) {
  const webFetchMode = input.webFetchMode ?? "enrich";
  const hasCodeExecution = hasToolNamed(input.tools, "code_execution");
  const hasWebFetch = hasToolNamed(input.tools, "web_fetch");
  const skillList = input.skills.length > 0 ? input.skills.join(", ") : "none";

  if (input.model === "claude-haiku-4-5") {
    if (!hasCodeExecution) {
      throw new Error(
        [
          `Anthropic execution contract invalid for ${input.phase}.`,
          `model=${input.model}`,
          `webFetchMode=${webFetchMode}`,
          `skills=${skillList}`,
          "Haiku requests must include the explicit code_execution tool.",
        ].join(" "),
      );
    }
    return;
  }

  if (webFetchMode === "off") {
    if (!hasCodeExecution) {
      throw new Error(
        [
          `Anthropic execution contract invalid for ${input.phase}.`,
          `model=${input.model}`,
          `webFetchMode=${webFetchMode}`,
          `skills=${skillList}`,
          "Sonnet and Opus requests without web_fetch must include the explicit code_execution tool.",
        ].join(" "),
      );
    }
    return;
  }

  if (!hasWebFetch) {
    throw new Error(
      [
        `Anthropic execution contract invalid for ${input.phase}.`,
        `model=${input.model}`,
        `webFetchMode=${webFetchMode}`,
        `skills=${skillList}`,
        "Sonnet and Opus enrich requests must include web_fetch.",
      ].join(" "),
    );
  }

  if (hasCodeExecution) {
    throw new Error(
      [
        `Anthropic execution contract invalid for ${input.phase}.`,
        `model=${input.model}`,
        `webFetchMode=${webFetchMode}`,
        `skills=${skillList}`,
        "Sonnet and Opus enrich requests must not explicitly include code_execution because the live API auto-injects it and rejects duplicate tool names.",
      ].join(" "),
    );
  }
}

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

export function buildAuthoringThinkingConfig(
  model: ClaudeAuthorModel,
): Anthropic.Beta.BetaThinkingConfigParam | undefined {
  if (model !== OPUS_AUTHOR_MODEL) {
    return undefined;
  }

  return {
    type: "adaptive",
  } as const satisfies Anthropic.Beta.BetaThinkingConfigParam;
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
