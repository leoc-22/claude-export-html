# export-html

A Claude Code mod that adds `/export-html`. The command exports the current session as one self-contained HTML file with:

- a session tree in the sidebar
- filters: default, no tools, user only, errors, all
- tool chips
- search
- a stats header (tokens, cost, models)
- compact tool cards with diffs
- subagent transcripts
- dark mode and a mobile layout

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install export-html --marketplace leoc-22/claude-export-html
```

Answer `y` to add the marketplace, then pick a scope.

From a shell:

```
claude plugin install export-html --marketplace leoc-22/claude-export-html
```

In the desktop app, click **+** next to the prompt box, then **Plugins**. Choose **Add marketplace**, enter `leoc-22/claude-export-html`, then choose **Add plugin**.

Node.js must be on your `PATH`.

### As a skill (no marketplace)

If your organization blocks third-party plugin marketplaces, install the skill instead:

```
npx skills add leoc-22/claude-export-html
```

Then ask Claude to export the session, or run `/export-html`. The skill runs the same exporter, so the output is identical.

## Use

```
/export-html [path] [--context] [--no-open]
```

- `path`: the file or folder to write to. The default is `./claude-session-<id>.html`.
- `--context`: also include hidden context, such as system reminders and attachments. Review the file before you share it.
- `--no-open`: don't open the file in your browser after the export.

### Viewer shortcuts

| Key | Action |
| --- | --- |
| `/` | Search |
| `T` | Show or hide thinking |
| `O` | Open or close all tool cards |
| `H` | Show or hide hidden entries |
| `Esc` | Clear the search |

## Credits

The viewer's design follows the session export of the pi coding agent. It bundles [marked](https://github.com/markedjs/marked) (MIT) and [highlight.js](https://github.com/highlightjs/highlight.js) (BSD-3-Clause), each under its own license.

## License

MIT
