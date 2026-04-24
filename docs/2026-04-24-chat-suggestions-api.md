# Workspace chat suggestions API

Date: 2026-04-24

The chat UI can fetch first-turn suggestions from:

```txt
GET /api/workspace/chat/suggestions?workspace_id=<workspace_id>&scope_id=<optional_scope_id>
```

Response:

```json
{
  "suggestions": [
    {
      "label": "summarize",
      "prompt": "Summarize findings in the latest uploaded file.",
      "reason": "Indexed recently."
    }
  ]
}
```

Notes for the chat surface:

- `workspace_id` is optional but, when provided, must match the current workspace.
- `scope_id` is optional. When present, suggestions are scoped to that client, category, or function.
- The endpoint returns at most three suggestions.
- The UI should render `prompt` as the sent message. `label` is only a compact display hint.
- Empty workspaces may return fewer than three suggestions.
