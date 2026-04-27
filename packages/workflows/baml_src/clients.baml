// BAML LLM clients for Basquio workspace pipelines.
//
// Models per CLAUDE.md / canonical-rules.md:
//   Sonnet 4.6: claude-sonnet-4-6
//   Haiku 4.5:  claude-haiku-4-5-20251001
//
// BAML drives Anthropic directly (not via the AI SDK). The Brief 2 AI SDK
// quirk (structuredOutputMode 'jsonTool' to bypass output_config.format)
// does not apply here because BAML uses its own Schema-Aligned Parser that
// does not depend on Anthropic structured-output beta features.

client<llm> ClaudeSonnet46 {
  provider anthropic
  options {
    model "claude-sonnet-4-6"
    api_key env.ANTHROPIC_API_KEY
    max_tokens 16000
  }
}

client<llm> ClaudeHaiku45 {
  provider anthropic
  retry_policy Constant
  options {
    model "claude-haiku-4-5-20251001"
    api_key env.ANTHROPIC_API_KEY
    max_tokens 4000
  }
}

retry_policy Constant {
  max_retries 3
  strategy {
    type constant_delay
    delay_ms 200
  }
}
