---
name: export-html
description: Export the current Claude Code session as one self-contained HTML page with a session tree, filters, tool cards, search and stats. Use when the user asks to export, save, share or archive this session or conversation as HTML.
argument-hint: "[path] [--context] [--no-open]"
---

# Export this session as HTML

Run the bundled exporter with Node.js. It needs nothing beyond Node; the viewer's scripts are inlined into the output.

```bash
node "${CLAUDE_SKILL_DIR}/scripts/export.mjs" --session "${CLAUDE_SESSION_ID}" [--out <path>] [--context]
```

If `${CLAUDE_SKILL_DIR}` was not filled in above, use the folder this SKILL.md is in. If `${CLAUDE_SESSION_ID}` was not filled in, pass `--latest` instead of `--session ...`: it picks the newest transcript for the current folder.

Arguments the user gave: `$ARGUMENTS`

- A bare word is the output path (a file, or a folder ending in `/`) → `--out <path>`. The default is `./claude-session-<id>.html`.
- `--context` → pass `--context`. It keeps hidden context such as system reminders and attachments. Tell the user to review the file before sharing it.
- `--no-open` → don't open the result afterwards.

The exporter prints one JSON line: `{"path": ..., "entries": N, "subagents": N, "bytes": N}`. On failure it prints the reason to stderr and exits 1.

Unless `--no-open` was given, open the file: `open <path>` on macOS, `xdg-open <path>` on Linux. If opening is blocked, give the user the command instead.

Reply in one line: how many entries (and subagents) were exported, the size, and the path.
