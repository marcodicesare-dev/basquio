import { anthropic } from "@ai-sdk/anthropic";
import { openai } from "@ai-sdk/openai";
import { generateObject } from "ai";
import type { z } from "zod";

import { stageTraceSchema, type StageTrace } from "@basquio/types";

type ProviderPreference = "anthropic" | "openai";

type GenerateStructuredStageInput<TSchema extends z.ZodTypeAny> = {
  stage: string;
  schema: TSchema;
  prompt: string;
  modelId: string;
  providerPreference: ProviderPreference;
  promptVersion?: string;
};

export async function generateStructuredStage<TSchema extends z.ZodTypeAny>({
  stage,
  schema,
  prompt,
  modelId,
  providerPreference,
  promptVersion = "v1",
}: GenerateStructuredStageInput<TSchema>) {
  const resolved = resolveModel(modelId, providerPreference);

  if (!resolved.model) {
    return {
      object: null,
      trace: createTrace({
        stage,
        promptVersion,
        requestedModelId: modelId,
        resolvedModelId: resolved.resolvedModelId,
        provider: resolved.provider,
        status: "skipped",
        fallbackReason: resolved.fallbackReason,
        errorMessage: "",
      }),
    };
  }

  try {
    const { object } = await generateObject({
      model: resolved.model,
      schema,
      prompt,
      mode: "json",
      temperature: 0.2,
    });

    return {
      object,
      trace: createTrace({
        stage,
        promptVersion,
        requestedModelId: modelId,
        resolvedModelId: resolved.resolvedModelId,
        provider: resolved.provider,
        status:
          resolved.provider === providerPreference && resolved.resolvedModelId === normalizeModelId(modelId, providerPreference)
            ? "succeeded"
            : "fallback",
        fallbackReason: resolved.fallbackReason,
        errorMessage: "",
      }),
    };
  } catch (error) {
    return {
      object: null,
      trace: createTrace({
        stage,
        promptVersion,
        requestedModelId: modelId,
        resolvedModelId: resolved.resolvedModelId,
        provider: resolved.provider,
        status: "failed",
        fallbackReason: resolved.fallbackReason,
        errorMessage: error instanceof Error ? error.message : "Unknown model generation error.",
      }),
    };
  }
}

function resolveModel(modelId: string, providerPreference: ProviderPreference) {
  const normalizedModelId = normalizeModelId(modelId, providerPreference);
  const hasAnthropicKey = Boolean(process.env.ANTHROPIC_API_KEY);
  const hasOpenAiKey = Boolean(process.env.OPENAI_API_KEY);

  if (providerPreference === "anthropic" && hasAnthropicKey) {
    return {
      model: anthropic(normalizedModelId),
      provider: "anthropic" as const,
      resolvedModelId: normalizedModelId,
      fallbackReason: "",
    };
  }

  if (providerPreference === "openai" && hasOpenAiKey) {
    return {
      model: openai(normalizedModelId),
      provider: "openai" as const,
      resolvedModelId: normalizedModelId,
      fallbackReason: "",
    };
  }

  if (hasAnthropicKey && normalizedModelId.startsWith("claude")) {
    return {
      model: anthropic(normalizedModelId),
      provider: "anthropic" as const,
      resolvedModelId: normalizedModelId,
      fallbackReason: `Preferred ${providerPreference} was unavailable; used configured Anthropic access instead.`,
    };
  }

  if (hasOpenAiKey && normalizedModelId.startsWith("gpt")) {
    return {
      model: openai(normalizedModelId),
      provider: "openai" as const,
      resolvedModelId: normalizedModelId,
      fallbackReason: `Preferred ${providerPreference} was unavailable; used configured OpenAI access instead.`,
    };
  }

  if (hasAnthropicKey) {
    const fallbackModel = process.env.BASQUIO_FALLBACK_ANTHROPIC_MODEL || "claude-sonnet-4-6";
    return {
      model: anthropic(fallbackModel),
      provider: "anthropic" as const,
      resolvedModelId: fallbackModel,
      fallbackReason: `Requested model ${normalizedModelId} was unavailable; used Anthropic fallback.`,
    };
  }

  if (hasOpenAiKey) {
    const fallbackModel = process.env.BASQUIO_FALLBACK_OPENAI_MODEL || "gpt-5-mini";
    return {
      model: openai(fallbackModel),
      provider: "openai" as const,
      resolvedModelId: fallbackModel,
      fallbackReason: `Requested model ${normalizedModelId} was unavailable; used OpenAI fallback.`,
    };
  }

  return {
    model: null,
    provider: "none" as const,
    resolvedModelId: "",
    fallbackReason: "No supported model API key is configured.",
  };
}

function normalizeModelId(modelId: string, providerPreference: ProviderPreference) {
  if (providerPreference === "openai") {
    if (modelId === "nano") return "gpt-5-nano";
    if (modelId === "mini") return "gpt-5-mini";
    if (modelId === "full") return "gpt-5";
  }

  return modelId;
}

function createTrace(input: Omit<StageTrace, "generatedAt">) {
  return stageTraceSchema.parse({
    ...input,
    generatedAt: new Date().toISOString(),
  });
}
