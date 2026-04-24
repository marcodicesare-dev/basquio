export function compactSuggestionPrompt(prompt: string): string {
  const cleaned = prompt.trim().replace(/\s+/g, " ").replace(/\.$/, "");
  const scopedBrief = cleaned.match(/^Use (.+?) for the next .+? brief$/i);
  if (scopedBrief?.[1]) return compact(scopedBrief[1], "Use");
  const nextWork = cleaned.match(/^Use (.+?) in the next piece of work$/i);
  if (nextWork?.[1]) return compact(nextWork[1], "Use");
  const weeklyScope = cleaned.match(/^Ask what changed in .+? this week$/i);
  if (weeklyScope) return "What changed this week?";
  return cleaned.length > 46 ? `${cleaned.slice(0, 43).trim()}...` : cleaned;
}

function compact(value: string, verb: string): string {
  const label = `${verb} ${value.trim()}`;
  return label.length > 46 ? `${label.slice(0, 43).trim()}...` : label;
}
