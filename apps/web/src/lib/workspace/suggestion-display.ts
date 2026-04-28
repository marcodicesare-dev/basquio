/**
 * Compactor for suggestion-chip labels. The chip is a one-line button
 * on the workspace home, so the label has to fit in roughly 56
 * characters before it starts to look like the truncation is the
 * content. The compactor uses pattern-aware shrinking first ("Use X
 * for the next Y brief" -> "Use X"), and falls back to a
 * length-bounded ellipsis on whatever remains.
 *
 * Per Vercel ai-chatbot SuggestedActions and Claude.ai /new, the chip
 * is a one-shot send: the FULL prompt fires when the user clicks. So
 * the label is purely a teaser; the prompt itself is the action.
 */

const MAX_LABEL_CHARS = 56;

export function compactSuggestionPrompt(prompt: string): string {
  const cleaned = prompt.trim().replace(/\s+/g, " ").replace(/\.$/, "");
  const scopedBrief = cleaned.match(/^Use (.+?) for the next .+? brief$/i);
  if (scopedBrief?.[1]) return compact(scopedBrief[1], "Use");
  const nextWork = cleaned.match(/^Use (.+?) in the next piece of work$/i);
  if (nextWork?.[1]) return compact(nextWork[1], "Use");
  const weeklyScope = cleaned.match(/^Ask what changed in .+? this week$/i);
  if (weeklyScope) return "What changed this week?";
  // "Generate the X memo for tomorrow's pre-read." -> "Generate the X
  // memo". Keeps the verb + object, drops any deadline phrase
  // ("for tomorrow's pre-read", "by Friday", "before the meeting")
  // that would otherwise blow past the chip width. The regex is
  // intentionally permissive: anything starting with " for ", " by ",
  // " before ", or " in time for " is treated as a deadline.
  const generateForDeadline = cleaned.match(
    /^(Generate|Draft|Prepare|Build|Write|Send) (.+?)\s+(?:for|by|before|in time for)\s+.+$/i,
  );
  if (generateForDeadline?.[1] && generateForDeadline?.[2]) {
    return compact(generateForDeadline[2], generateForDeadline[1]);
  }
  // "Summarize X for Y" -> "Summarize X". Same shape as Generate.
  const summarizeFor = cleaned.match(
    /^(Summarize|Recap|Pull together) (.+?)\s+(?:for|by|before|in time for)\s+.+$/i,
  );
  if (summarizeFor?.[1] && summarizeFor?.[2]) {
    return compact(summarizeFor[2], summarizeFor[1]);
  }
  return cleaned.length > MAX_LABEL_CHARS
    ? `${cleaned.slice(0, MAX_LABEL_CHARS - 3).trim()}...`
    : cleaned;
}

function compact(value: string, verb: string): string {
  const label = `${verb} ${value.trim()}`;
  return label.length > MAX_LABEL_CHARS
    ? `${label.slice(0, MAX_LABEL_CHARS - 3).trim()}...`
    : label;
}
