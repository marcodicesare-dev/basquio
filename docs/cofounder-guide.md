# Basquio Collaboration Stack — Cofounder Guide

## TL;DR

We have an AI-powered Discord bot that **records everything we discuss**, **turns it into action**, and **makes it all searchable**. It runs 24/7 — you don't need to configure anything. Just talk, type, and drop files.

---

## 1. How It Works

### Voice Sessions (The Office)

When you join the **#The Office** voice channel:

1. **Bot joins automatically** and starts recording
2. You talk normally — Italian, English, mixed, whatever
3. When everyone leaves, the bot **disconnects after 30 seconds**
4. Within ~1 minute, it posts to **#basquio-ai**:
   - **Summary** of what was discussed
   - **Decisions** that were made
   - **Linear issues** created (bugs, features, action items)
   - **Key quotes** from the conversation
   - **CRM updates** if any leads/companies were mentioned
   - Link to the **full transcript**

**Voice memos** work too — join alone, say what's on your mind, leave. The bot processes it the same way.

### Text Sessions (#general)

When you write in **#general**:

1. Messages are buffered for **5 minutes**
2. After 5 min of silence (or 30 min of conversation), the bot processes the batch
3. Same output: summary, issues, decisions → posted to **#basquio-ai**

**Skip rules**: Messages under 5 chars, trivial replies (ok, lol, grazie), and @mentions to the bot are NOT treated as conversation — they won't generate issues.

### Knowledge Base (#docs)

Drop files in **#docs** and they become searchable:

- **Supported formats**: PDF, DOCX, PPTX, XLSX, images (PNG/JPG/WEBP), Markdown, plain text
- **Max file size**: 25 MB
- **What happens**: Bot reacts 📥 (received) → parses → chunks → embeds → reacts ✅ (indexed)
- **Screenshots**: The bot uses Claude Vision to OCR any image — drop WhatsApp screenshots, Figma exports, whiteboard photos, anything with text
- **XLSX**: Each sheet is parsed and indexed separately
- **Dedup**: If you upload the same file twice, it skips it (checks content hash)

### Search (@Basquio Bot)

Mention the bot in **any channel** to search across everything:

```
@Basquio Bot quanto costa il progetto al mese?
@Basquio Bot what did we decide about pricing?
@Basquio Bot francesco lama
```

The bot searches:
- All uploaded documents in #docs
- All past voice session transcripts
- All past text session transcripts

It uses **hybrid search** (semantic understanding + keyword matching) and synthesizes an answer with source citations.

**Confidence indicator**:
- 🟢 High — strong match, answer is well-supported
- 🟡 Medium — decent match, might be incomplete
- 🔴 Low — weak match, take with a grain of salt

---

## 2. Emoji Shortcuts

React to any message with these emojis for quick actions:

| Emoji | Action | Where |
|-------|--------|-------|
| 🐛 | Create a **bug** issue in Linear | #general, #basquio-ai |
| 💡 | Create a **feature** request in Linear | #general, #basquio-ai |
| ⚡ | **Force flush** the text buffer now | #general, #basquio-ai |
| 🏢 | Create/update a **CRM lead** | #general, #basquio-ai |
| 📚 | **Index** this message as a knowledge snippet | Any channel |
| 🔍 | **Search** for this message's content | Any channel |

---

## 3. Linear — What It Is and Why

### What is Linear?

Linear is our **issue tracker** — think of it as the single source of truth for "what needs to be done." Every bug, feature request, decision, and action item lives here.

**URL**: [linear.app/loamly](https://linear.app/loamly)

### Why Linear?

- **The bot creates issues automatically** from voice and text conversations. If you say "we need to add PDF export" in a meeting, a Linear issue appears within a minute, assigned to the right person, with the right labels.
- **Nothing gets lost**. Every decision, every "we should do X", every bug report — it's all tracked.
- **Prioritization is clear**. Issues have priority (Urgent/High/Medium/Low) and status (Backlog → Todo → In Progress → In Review → Done).
- **Assignment is automatic**. The AI assigns based on content:
  - Bugs, features, improvements → **Marco**
  - Finance → **Fra**
  - Marketing → **Giulia**
  - Feedback → **Marco + Rossella**

### How to Use Linear

1. **Check your issues**: Filter by "Assigned to me" to see what's on your plate
2. **Update status**: Drag issues through the kanban: Backlog → Todo → In Progress → Done
3. **Comment**: Add context, links, or decisions directly on the issue
4. **Close junk**: If the bot created something wrong, mark it as **Canceled** or **Duplicate**

### Issue Labels

| Label | Meaning |
|-------|---------|
| `from-voice` | Created from a voice session |
| `from-text` | Created from a text conversation |
| `bug` | Something broken |
| `feature` | New capability |
| `improvement` | Enhancement to existing feature |
| `finance` | Money/cost related |
| `marketing` | Marketing/GTM related |
| `sales` | Sales/lead related |
| `feedback` | Product feedback |

---

## 4. What Gets Recorded vs. What Doesn't

### Recorded and processed:
- Everything said in **#The Office** voice channel
- Everything written in **#general** text channel
- Files dropped in **#docs**

### NOT recorded:
- DMs
- Other channels (unless you use 📚/🔍 emoji shortcuts)
- Voice channels other than The Office

### Privacy:
- Non-team members get a warning when they join The Office
- All data is stored in our own Supabase instance (EU)
- Transcripts are accessible only to team members

---

## 5. Tips

1. **Be explicit in voice sessions**. "Let's create an issue for X" or "The decision is Y" helps the AI extract better action items.
2. **Use #docs liberally**. Drop meeting notes, competitive analysis, screenshots of conversations with prospects — everything becomes searchable.
3. **React with 📚 on important messages** in any channel to add them to the knowledge base.
4. **Don't worry about duplicates**. The bot checks for similar recent issues before creating new ones.
5. **If the bot misfires**, just mark the Linear issue as Canceled. It learns nothing from corrections (yet) but at least the backlog stays clean.

---

## 6. Architecture (for the curious)

```
Discord Voice/Text
       ↓
  Basquio Bot (Railway, ~$10/mo)
       ↓
  ┌─────────────┬──────────────┬───────────────┐
  │ Deepgram    │ Claude       │ OpenAI        │
  │ (transcribe)│ (extract +   │ (embeddings)  │
  │             │  synthesize) │               │
  └─────────────┴──────────────┴───────────────┘
       ↓              ↓              ↓
  ┌─────────────────────────────────────────────┐
  │          Supabase (Postgres + Storage)      │
  │  transcripts, decisions, knowledge_chunks,  │
  │  transcript_chunks, CRM leads, audio files  │
  └─────────────────────────────────────────────┘
       ↓
  Linear (issues, labels, assignees)
```

---

*Last updated: 16 March 2026*
