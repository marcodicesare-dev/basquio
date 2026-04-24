# C1 supplemental: workspace chat streaming smoothness + IA + reasoning surface

Session date: 2026-04-24 (evening iteration)
Owner on hand-off: continuation of the same codex CLI session that shipped `codex/chat-ux-p0` today
Same worktree, same branch, new chat context
Supplements (does NOT replace) `docs/2026-04-24-c0-workspace-chat-analyst-mode-codex-handoff.md`

## 1. Mission

The chat UX shipped today is materially improved on layout but still feels like a weak wrapper on three dimensions:

1. **Flash-in streaming**: assistant responses appear all at once instead of typing naturally token-by-token like Claude Code, Codex CLI, Conductor, Notion AI
2. **Missing thinking state**: no animated "Thinking..." with elapsed timer during the model's reasoning and tool-use phases
3. **Wrong IA**: chat is still not the primary surface; cognitive load too high vs a minimalist Codex-style three-pane shell
4. **No Cmd+V paste**: screenshots and files cannot be pasted into the composer the way Codex, Claude Code, and v0 do

Fix all four. Single PR. Use the AI SDK v6 APIs documented below verbatim. Stop guessing.

## 2. Forensic: current streaming is broken, here is the proof

### 2.1 Server (`apps/web/src/app/api/workspace/chat/route.ts:80-86`)

```ts
const result = streamText({
  model: anthropic(BASQUIO_MODEL_ID),
  system: SYSTEM_PROMPT,
  tools,
  messages: await convertToModelMessages(uiMessages),
  stopWhen: stepCountIs(10),
});

return result.toUIMessageStreamResponse({
  originalMessages: uiMessages,
  async onFinish({ messages: finalMessages }) { ... },
});
```

**What is missing (verified against ai-sdk.dev):**
- No `experimental_transform: smoothStream(...)` → tokens arrive in whatever buffer size the model flushes, not smoothed per word or per line
- No `sendReasoning: true` on `toUIMessageStreamResponse` → Opus 4.7 extended thinking parts never reach the client, so there is nothing for the UI to render as "Thinking..."
- No `messageMetadata` → elapsed time, token counts, model ID never attach to the message for the UI to render

### 2.2 Client (`apps/web/src/components/workspace-chat/Chat.tsx:249`)

```ts
const { messages, sendMessage, status, stop, regenerate } = useChat({
  transport: new DefaultChatTransport({ ... }),
});
```

**What is missing:**
- No `experimental_throttle` → React re-renders on every single token chunk (or batches them if a React scheduler suspends), producing jittery or flash-in output depending on CPU state

### 2.3 Result
Under load, Anthropic provider can emit tokens in 100-500ms chunks. Without `smoothStream`, the UI receives one large chunk, renders it, receives another, renders that. Experience: text appears in bursts. Marco's description matches exactly: "the answer appears altogether, like it flashes in."

## 3. AI SDK v6 state-of-the-art, verbatim from ai-sdk.dev

### 3.1 smoothStream (source: https://ai-sdk.dev/docs/reference/ai-sdk-core/smooth-stream)

> `smoothStream` is a utility function that creates a TransformStream for the `streamText` `transform` option to smooth out text and reasoning streaming by buffering and releasing complete chunks with configurable delays. This creates a more natural reading experience when streaming text and reasoning responses.

```ts
import { smoothStream, streamText } from 'ai';

const result = streamText({
  model,
  prompt,
  experimental_transform: smoothStream({
    delayInMs: 20,           // defaults to 10ms; 20ms feels more natural for Italian/English prose
    chunking: 'word',        // 'word' | 'line' | RegExp | Intl.Segmenter | custom fn
  }),
});
```

Returns a TransformStream that:
- Buffers incoming text and reasoning chunks
- Releases content when the chunking pattern is encountered
- Adds configurable delays between chunks for smooth output
- Passes through non-text/reasoning chunks (tool calls, step-finish events) immediately

For Italian prose use `chunking: 'word'` (default, correct for Latin languages). For CJK languages (future) switch to `Intl.Segmenter`.

### 3.2 toUIMessageStreamResponse options (source: https://ai-sdk.dev/docs/reference/ai-sdk-core/stream-text)

```
### originalMessages?:  UIMessage[]
### onFinish?:          (options: { messages, isContinuation, responseMessage, isAborted }) => void
### messageMetadata?:   (options: { part }) => unknown
### sendReasoning?:     boolean
### sendSources?:       boolean
### sendFinish?:        boolean
### sendStart?:         boolean
### onError?:           (error: unknown) => string
```

Set `sendReasoning: true` to surface Claude's extended thinking to the client. The client UIMessage gains `parts: [{ type: "reasoning", text: "..." }]` that can be rendered as a collapsible "Thinking..." block.

### 3.3 useChat experimental_throttle (source: https://ai-sdk.dev/docs/reference/ai-sdk-ui/use-chat)

```
### experimental_throttle?:  number
```

Throttles React state updates during streaming. Recommended value: `60` (ms). At 60ms throttle, UI paints roughly 16 times per second, matching display refresh rate, no jank.

### 3.4 UIMessage shape and status

```
UIMessage
### id:       string
### role:     'system' | 'user' | 'assistant'
### parts:    UIMessagePart[]   // text | reasoning | tool-call | tool-result | source | file
### metadata?: unknown
### status:   'submitted' | 'streaming' | 'ready' | 'error'
```

`status === 'submitted'`: user turn sent, awaiting first assistant chunk. Show "Thinking..." with animated dots + elapsed timer.
`status === 'streaming'`: assistant is generating. Render each part as it updates. Show cursor after last text.
`status === 'ready'`: stream complete. Render suggestions, allow regeneration.
`status === 'error'`: surface graceful error.

### 3.5 File attachments on sendMessage (source: https://ai-sdk.dev/docs/reference/ai-sdk-ui/use-chat)

```
sendMessage: (message?: { text: string; files?: FileList | FileUIPart[]; metadata?; messageId?: string } | ...) => Promise<void>
```

**Native support for FileList.** When user Cmd+V pastes an image or drags files in, call `sendMessage({ text: draft, files: pastedFiles })`. The AI SDK handles the upload-as-part protocol. No custom code needed.

## 4. S1: streaming smoothness fix

### 4.1 Server change

File: `apps/web/src/app/api/workspace/chat/route.ts`

```ts
import { anthropic } from "@ai-sdk/anthropic";
import { NextResponse } from "next/server";
import {
  convertToModelMessages,
  smoothStream,
  streamText,
  stepCountIs,
  type UIMessage,
} from "ai";

// ... existing imports unchanged ...

const result = streamText({
  model: anthropic(resolveChatModel(body.mode)),
  system: SYSTEM_PROMPT,
  tools,
  messages: await convertToModelMessages(uiMessages),
  stopWhen: stepCountIs(10),
  experimental_transform: smoothStream({
    delayInMs: 20,
    chunking: "word",
  }),
});

return result.toUIMessageStreamResponse({
  originalMessages: uiMessages,
  sendReasoning: true,                    // surface Opus 4.7 extended thinking
  sendSources: true,                      // surface URLs cited by webSearch tool
  messageMetadata: ({ part }) => {
    if (part.type === "finish") {
      return {
        finishReason: part.finishReason,
        totalUsage: part.totalUsage,
        completedAt: new Date().toISOString(),
      };
    }
    if (part.type === "start-step") {
      return { startedAt: new Date().toISOString() };
    }
    return undefined;
  },
  async onFinish({ messages: finalMessages }) {
    // existing persistence unchanged
  },
});
```

### 4.2 Client change

File: `apps/web/src/components/workspace-chat/Chat.tsx`

```ts
const { messages, sendMessage, status, stop, regenerate } = useChat({
  transport: new DefaultChatTransport({ ... }),
  experimental_throttle: 60,              // 60ms = 16fps re-render cap, matches display
});
```

### 4.3 Acceptance

- Manual test: send a 200-word response request. Watch it type word-by-word over 3-5 seconds at human reading pace. No visible flash, no burst
- Manual test: with deep mode on (Opus 4.7), confirm a `<reasoning>` block appears above the final answer with animated "..." and elapsed timer, then collapses when the final text streams in
- Unit test: chat route with a stub model emitting "one two three four five" over 5 chunks, verify smoothStream transforms to 5 separate word emissions with ~20ms spacing

## 5. S2: information architecture (Codex-style three-pane)

### 5.1 Reference layout (Marco's explicit ask)

Left pane (240px-280px, sticky):
- Workspace switcher at the top (current workspace name, dropdown)
- Recent chats list (scrollable, most-recent first, inline relative-time)
- "New chat" button at the bottom of the chat list
- Below: Scopes (clients, categories, functions) as collapsible sections
- Below: Other surfaces: Memory, People, Deliverables

Main pane (fluid center):
- Chat fills the viewport height, composer fixed at the bottom
- No cards, no chips row, no template paragraph, no "Review suggested" status, no greeting panels
- Only rendered content: message stream + composer

Right pane (hidden by default, 320px when open):
- Opens when user clicks a citation, a file attachment, a deliverable link, a memory entry
- Content: full file preview (PDF, XLSX spreadsheet preview, MD render), or entity detail panel, or source article reader
- Close button in the top right of the pane, Esc key closes
- Never open by default, never auto-open on load

Mobile (<1080px):
- Single column
- Left pane becomes a drawer opened by a hamburger in the top-left
- Right pane becomes a modal sheet when triggered

### 5.2 Current state to fix

The existing `apps/web/src/app/(workspace)/workspace/**` shell has some of this but mixed with cards and suggestions. Read the current state of:

```bash
apps/web/src/app/(workspace)/workspace/page.tsx
apps/web/src/app/(workspace)/workspace/scope/[kind]/[slug]/page.tsx
apps/web/src/app/(workspace)/workspace/chat/[id]/page.tsx
apps/web/src/components/workspace-shell.tsx (if present)
apps/web/src/components/scope-landing.tsx
```

Trim anything that is not: left rail, chat stream, composer, right drawer. No "Suggested for today" card row, no section headers on empty chats, no billing stats, no template paragraphs, no status pills.

### 5.3 Reference products to inspect (not copy)

Before touching any CSS, open and play with each of these for 5 minutes:

- Claude.ai at https://claude.ai, left rail, center chat, right canvas-on-demand pattern
- Codex Cloud at https://chat.openai.com/codex (if logged in), same three-pane
- Conductor desktop app at https://conductor.build, three-pane with top toolbar
- Notion AI at https://notion.so, inline floating chat triggered by Ctrl+J, sidebar history

All four converge on the same pattern. Do not invent a fifth.

### 5.4 Acceptance

- Viewport at 1440x900: left rail 280px, chat pane fills center, right pane closed by default. Chat composer is visible without scrolling
- Click a citation marker in a streamed response → right pane slides in with the file preview, source article, or entity detail
- Esc closes the right pane
- Cmd+K opens command palette (already present, keep it)
- Sidebar state persists per user via localStorage (collapsed workspace list, expanded scope group, etc)

## 6. S3: "Thinking..." reasoning state

### 6.1 Pattern (match Codex CLI / Claude Code behavior)

On `status === 'submitted'`:
- Immediately render an inline assistant placeholder below the user message
- Placeholder shows: three animated dots `• • •` + caption "Thinking..." + elapsed counter starting at "0s"
- Counter ticks every 100ms: `0.1s → 0.2s → ... → 1.3s` etc
- If model emits a `type: "reasoning"` part (Opus 4.7 extended thinking), replace the caption with a collapsible "Thinking..." block showing the reasoning text streaming inside
- If model emits a `type: "tool-call"` part, replace the caption with "Using <toolName>" + animated dots
- If tool completes, show "Used <toolName>" briefly (500ms fade) then continue
- On first `type: "text"` token, collapse the reasoning and tool-use blocks into a single clickable "Show thinking" affordance above the final answer, and start streaming the text

### 6.2 Where to implement

File: `apps/web/src/components/workspace-chat/ChatMessage.tsx` (owned by this session, permissible to edit)

Add sub-components:
- `<ReasoningStream parts={reasoningParts} isStreaming />`, renders the collapsible thinking block
- `<ToolCallChip toolName toolStatus durationMs />`, renders the "Using retrieveContext..." chip inline with the message
- `<ElapsedTimer startedAt />`, uses `setInterval` + `Date.now() - startedAt` to tick 0.1s increments

Measure `startedAt` from the `message.metadata?.startedAt` set by `messageMetadata` in S1, or fall back to `Date.now()` at the moment `status === 'submitted'` appears.

### 6.3 Acceptance

- Manual test, standard Sonnet 4.6: submit a question. "Thinking..." + elapsed timer appears within 50ms. Timer counts up until first text token (typically 1-3 seconds for Sonnet). Then text streams word by word.
- Manual test, deep mode Opus 4.7: submit a complex question. "Thinking..." appears, then a collapsible block renders the streaming reasoning. After reasoning completes, text starts streaming. Click "Show thinking" on the finished message → reasoning expands inline.
- Manual test, a question that triggers `webSearch`: "Using webSearch" chip appears within 200ms, shows a spinner, shows "Used webSearch, 5 results" on complete, text streams.

## 7. S4: Cmd+V paste + file attachment upgrade

### 7.1 Current state

The existing composer has a Paperclip attach button + drag-to-upload (per codex/chat-ux-p0 commits today). Missing:
- Cmd+V / Ctrl+V paste of images or files
- Clickable attachment chips to preview/expand
- Support for txt, md, xlsx, pdf, pptx, docx, gsp, images

### 7.2 Implementation

File: `apps/web/src/components/workspace-chat/Chat.tsx`

Add a paste handler on the composer `<textarea>`:

```ts
onPaste={(event) => {
  const items = event.clipboardData?.items;
  if (!items) return;
  const files: File[] = [];
  for (let i = 0; i < items.length; i += 1) {
    const item = items[i];
    if (item.kind === "file") {
      const file = item.getAsFile();
      if (file) files.push(file);
    }
  }
  if (files.length > 0) {
    event.preventDefault();
    handlePastedFiles(files);
  }
}}
```

`handlePastedFiles(files)` routes through the existing upload path (same as drag-to-upload) so the attachment chip appears immediately in the composer area. Attached files get `status: "uploading"` → `"indexing"` → `"indexed"` per the existing flow.

**Two async lanes per the upload spec:**
1. Attach lane: file uploaded to Supabase Storage, conversation attachment row written. Chip says "attached" in < 2s
2. Memory lane: embed + extract runs in background. Chip says "indexing for memory" until complete

On send, pass attached files to `sendMessage({ text, files: attachedFiles })`. The AI SDK native file upload handles the rest.

### 7.3 Full-screen preview

Click an attachment chip → opens the right pane (from S2) with a preview:
- Images: `<img>` rendered at natural size, zoom on click
- PDF: embed via `<iframe>` or react-pdf if already installed
- XLSX: show a small data preview (first 20 rows of the first sheet) rendered via sheetjs or similar
- PPTX: render first slide as a thumbnail, or fall back to filename + metadata
- TXT/MD: render with react-markdown
- DOCX: extract + render text

If a renderer is not available, show "Preview not supported, click to download."

### 7.4 Acceptance

- Take a screenshot with Cmd+Shift+4, Cmd+V into the composer → chip appears instantly, file uploads in background
- Paste a PDF copied from Finder → same behavior
- Click an attached image chip → right pane opens with full-screen image preview
- Click an attached XLSX chip → right pane opens with spreadsheet preview

## 8. Test plan

Run in order before PR:

1. `pnpm typecheck`
2. `pnpm qa:basquio`
3. `pnpm vitest run apps/web/src/components/workspace-chat/` (all chat tests)
4. `pnpm --filter @basquio/web build`
5. Manual: S1 streaming with Sonnet 4.6 at 200-word response, word-by-word visible
6. Manual: S1 streaming with Opus 4.7 deep mode, reasoning block renders
7. Manual: S3 timer visible from 0.1s tick for standard mode and deep mode
8. Manual: S4 paste screenshot, chip appears, right pane previews
9. Manual: S2 three-pane layout verified at 1440x900 and mobile drawer at 640x812

## 9. What stays unchanged from the C0 spec

Everything in `docs/2026-04-24-c0-workspace-chat-analyst-mode-codex-handoff.md` not explicitly overridden here still applies. Specifically:

- C1 model upgrade Sonnet 4.6 + Opus 4.7 deep mode toggle
- C2 webSearch tool via Firecrawl (200/conv hard cap)
- C3 analystCommentary tool for multi-file synthesis
- C4 graceful tool error handling
- C5 system prompt rewrite for analyst behavior
- C6 first-turn suggestions API
- C7 next-turn suggestion pills via xml block
- C8 chat_tool_telemetry table + wrapper

S1 through S4 here are additive polish on top of C1-C8. Same PR if you can fit it, else two sequential PRs (C1-C8 first, then S1-S4).

## 10. PR shape

One PR titled: `Chat streaming smoothness, reasoning surface, three-pane IA, paste to attach`

Body:
```
Fixes the flash-in streaming bug, surfaces Claude's extended thinking
as an animated "Thinking..." block, tightens the workspace IA to a
three-pane Codex-style shell, and enables Cmd+V paste of screenshots
and files into the composer.

Root causes identified in apps/web/src/app/api/workspace/chat/route.ts:
- No experimental_transform: smoothStream(...) → tokens flash in
- No sendReasoning: true → extended thinking parts never reach UI
- No experimental_throttle on useChat → React re-renders unbatched

Spec at docs/2026-04-24-c1-workspace-chat-streaming-and-ia-supplemental.md
Also see C0 parent spec at
docs/2026-04-24-c0-workspace-chat-analyst-mode-codex-handoff.md

S1 streaming smoothness (smoothStream + experimental_throttle + sendReasoning)
S2 three-pane IA (left rail, chat, right drawer-on-demand)
S3 Thinking reasoning block with elapsed timer and tool-call chips
S4 Cmd+V paste of images/files with right-pane previews
```

## 11. What NOT to touch

Same restrictions as C0:
- `packages/workflows/**` (P0 codex territory)
- `packages/intelligence/**`
- `packages/research/**` except additive export to `clients.ts`
- `supabase/migrations/**` except new ones specified in C2 and C8
- `docs/domain-knowledge/**`
- `memory/**`, `rules/**`

## 12. References

Verified empirically against ai-sdk.dev on 2026-04-24:

- https://ai-sdk.dev/docs/reference/ai-sdk-core/smooth-stream (smoothStream API)
- https://ai-sdk.dev/docs/reference/ai-sdk-core/stream-text (streamText full signature including experimental_transform, toUIMessageStreamResponse options)
- https://ai-sdk.dev/docs/reference/ai-sdk-ui/use-chat (useChat API including experimental_throttle, sendMessage with files)

Before writing any streaming code, re-scrape these three pages via Firecrawl MCP (not Google) to confirm the API surface did not change since 2026-04-24. The AI SDK v6 reference pages are the single source of truth.

End of spec.
