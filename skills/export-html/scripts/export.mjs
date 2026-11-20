#!/usr/bin/env node
// Export a Claude Code session transcript to one self-contained HTML file.
//
//   node export.mjs --session <id> [--out <file>] [--context]
//   node export.mjs --jsonl <path/to/session.jsonl> [--out <file>] [--context]
//   node export.mjs --latest [--out <file>] [--context]   (newest session for the current folder)
//
// Prints one JSON line: { "path": "<written file>", "entries": N, "bytes": N }.
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync, statSync } from 'node:fs'
import { join, dirname, basename, resolve } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))

function parseArgs(argv) {
  const out = { context: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--session') out.session = argv[++i]
    else if (a === '--jsonl') out.jsonl = argv[++i]
    else if (a === '--out') out.out = argv[++i]
    else if (a === '--context') out.context = true
    else if (a === '--latest') out.latest = true
    else if (a === '--title') out.title = argv[++i]
  }
  return out
}

function findTranscript(sessionId) {
  const base = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude')
  const projects = join(base, 'projects')
  if (!existsSync(projects)) return undefined
  for (const dir of readdirSync(projects)) {
    const candidate = join(projects, dir, `${sessionId}.jsonl`)
    if (existsSync(candidate)) return candidate
  }
  return undefined
}

/** The most recently written transcript for the current folder, else for any folder. */
function findLatest() {
  const base = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude')
  const projects = join(base, 'projects')
  if (!existsSync(projects)) return undefined
  const newest = dirs => {
    let best
    for (const dir of dirs) {
      if (!existsSync(dir)) continue
      for (const name of readdirSync(dir)) {
        if (!name.endsWith('.jsonl')) continue
        const path = join(dir, name)
        const mtime = statSync(path).mtimeMs
        if (!best || mtime > best.mtime) best = { path, mtime }
      }
    }
    return best?.path
  }
  const here = join(projects, process.cwd().replace(/[^a-zA-Z0-9]/g, '-'))
  return newest([here]) ?? newest(readdirSync(projects).map(d => join(projects, d)))
}

function readJsonl(path) {
  const rows = []
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (!line.trim()) continue
    try {
      rows.push(JSON.parse(line))
    } catch {
      // A torn last line while the session is still writing: skip it.
    }
  }
  return rows
}

const REMINDER = /<system-reminder>[\s\S]*?<\/system-reminder>\s*/g

function clean(text, keepContext) {
  if (typeof text !== 'string') return ''
  return keepContext ? text : text.replace(REMINDER, '').trimEnd()
}

function tag(text, name) {
  const m = text.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`))
  return m ? m[1].trim() : undefined
}

function normalizeContent(content, keepContext) {
  // -> array of { type: 'text'|'image', text?, media?, data? }
  if (typeof content === 'string') return [{ type: 'text', text: clean(content, keepContext) }]
  if (!Array.isArray(content)) return []
  const out = []
  for (const block of content) {
    if (block.type === 'text') out.push({ type: 'text', text: clean(block.text, keepContext) })
    else if (block.type === 'image' && block.source?.type === 'base64') {
      out.push({ type: 'image', media: block.source.media_type, data: block.source.data })
    }
  }
  return out.filter(b => b.type !== 'text' || b.text)
}

/** Turn raw transcript rows into compact viewer entries. */
function normalize(rows, keepContext) {
  const entries = []
  for (const r of rows) {
    if (!r.uuid) continue
    const base = { id: r.uuid, p: r.parentUuid ?? null, ts: r.timestamp }
    if (r.type === 'assistant' && r.message) {
      const blocks = []
      for (const b of r.message.content ?? []) {
        if (b.type === 'text' && b.text) blocks.push({ type: 'text', text: b.text })
        else if (b.type === 'thinking' && b.thinking) blocks.push({ type: 'thinking', text: b.thinking })
        else if (b.type === 'redacted_thinking') blocks.push({ type: 'thinking', text: '(redacted)' })
        else if (b.type === 'tool_use' || b.type === 'server_tool_use') {
          blocks.push({ type: 'tool', id: b.id, name: b.name, input: b.input })
        }
      }
      entries.push({
        ...base,
        k: 'assistant',
        mid: r.message.id,
        model: r.message.model,
        stop: r.message.stop_reason,
        blocks,
      })
    } else if (r.type === 'user' && r.message) {
      const c = r.message.content
      if (Array.isArray(c) && c.some(b => b.type === 'tool_result')) {
        const results = c.filter(b => b.type === 'tool_result')
        // Several results in one row: chain them, the last keeping the row's id.
        let parent = base.p
        results.forEach((b, i) => {
          const id = i === results.length - 1 ? r.uuid : `${r.uuid}:${b.tool_use_id}`
          entries.push({
            ...base,
            id,
            p: parent,
            k: 'result',
            tid: b.tool_use_id,
            err: !!b.is_error,
            content: normalizeContent(b.content, keepContext),
          })
          parent = id
        })
        continue
      }
      const content = normalizeContent(c, keepContext)
      const text = content.filter(b => b.type === 'text').map(b => b.text).join('\n')
      const cmd = tag(text, 'command-name')
      const stdout = tag(text, 'local-command-stdout') ?? tag(text, 'local-command-stderr')
      if (r.isCompactSummary) entries.push({ ...base, k: 'compact', content })
      else if (cmd) {
        entries.push({ ...base, k: 'command', name: cmd, args: tag(text, 'command-args') ?? '' })
      } else if (stdout !== undefined) {
        entries.push({ ...base, k: 'cmdout', text: stdout.replace(/\x1b\[[0-9;]*m/g, '') })
      } else if (r.isMeta) {
        if (!keepContext && !content.length) continue
        entries.push({ ...base, k: 'meta', content })
      } else if (content.length) {
        entries.push({ ...base, k: 'user', content })
      } else {
        entries.push({ ...base, k: 'link', hidden: true })
      }
    } else if (r.type === 'system') {
      const text =
        typeof r.content === 'string'
          ? r.content.replace(/<\/?(local-command-stdout|local-command-stderr|command-[a-z]+)>/g, '').replace(/\x1b\[[0-9;]*m/g, '').trim()
          : ''
      if (text) entries.push({ ...base, k: 'system', sub: r.subtype, level: r.level, text })
      else entries.push({ ...base, k: 'link', hidden: true })
    } else if (r.type === 'attachment') {
      if (keepContext && r.rendered) {
        let text = ''
        try {
          const parsed = JSON.parse(r.rendered)
          text = Array.isArray(parsed) ? parsed.map(x => x.content ?? '').join('\n') : String(parsed)
        } catch {
          text = String(r.rendered)
        }
        entries.push({ ...base, k: 'context', name: r.attachment?.type, text })
      } else {
        entries.push({ ...base, k: 'link', hidden: true })
      }
    } else {
      // Bookkeeping rows that still sit in the uuid chain.
      entries.push({ ...base, k: 'link', hidden: true })
    }
  }
  return entries
}

/**
 * Shape the uuid chain into the conversation tree the viewer draws.
 *
 * - Hidden bookkeeping rows are dropped and their children re-parented.
 * - A tool result is attached to the entry holding its call (`att`), off the
 *   tree: Claude Code parents each result on its own tool_use row, which
 *   splits parallel calls into false branches.
 * - A child hung on an earlier block of a multi-block assistant message moves
 *   to that message's last block, so the message stays one straight line.
 * What is left branching is a real fork (a rewind or an edited prompt).
 */
function collapseLinks(entries) {
  const byId = new Map(entries.map(e => [e.id, e]))
  const callEntry = new Map()
  for (const e of entries) {
    if (e.k === 'assistant') for (const b of e.blocks) if (b.type === 'tool') callEntry.set(b.id, e.id)
  }
  for (const e of entries) {
    if (e.k === 'result' && callEntry.has(e.tid)) e.att = true
  }
  const skip = e => e && (e.hidden || e.att)
  const realParent = id => {
    let cur = id
    const seen = new Set()
    while (cur && skip(byId.get(cur)) && !seen.has(cur)) {
      seen.add(cur)
      cur = byId.get(cur).p
    }
    return cur && byId.has(cur) ? cur : null
  }
  const kept = entries
    .filter(e => !e.hidden)
    .map(e => ({ ...e, p: e.att ? callEntry.get(e.tid) : realParent(e.p) }))

  // Straighten multi-block assistant messages.
  const keptById = new Map(kept.map(e => [e.id, e]))
  const children = new Map()
  for (const e of kept) {
    if (e.att || !e.p) continue
    if (!children.has(e.p)) children.set(e.p, [])
    children.get(e.p).push(e)
  }
  const continuation = e =>
    e.k === 'assistant' ? children.get(e.id)?.find(c => c.k === 'assistant' && c.mid === e.mid) : undefined
  const lastBlock = e => {
    let cur = e
    const seen = new Set()
    for (let next = continuation(cur); next && !seen.has(next.id); next = continuation(cur)) {
      seen.add(next.id)
      cur = next
    }
    return cur
  }
  for (const e of kept) {
    if (e.att || !e.p) continue
    const parent = keptById.get(e.p)
    const cont = parent && continuation(parent)
    if (cont && cont !== e) e.p = lastBlock(parent).id
  }
  return kept
}

function stats(rows, entries) {
  const usage = new Map()
  const models = new Set()
  const tools = {}
  let users = 0
  let assistants = 0
  let cost
  let title
  for (const r of rows) {
    if (r.type === 'assistant' && r.message?.id) {
      usage.set(r.message.id, r.message.usage)
      if (r.message.model && r.message.model !== '<synthetic>') models.add(r.message.model)
    }
    if (r.type === 'cost-state' && typeof r.totalCostUSD === 'number') cost = r.totalCostUSD
    if (r.type === 'ai-title' && r.aiTitle) title = r.aiTitle
    if (r.type === 'summary' && r.summary && !title) title = r.summary
  }
  const tokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
  for (const u of usage.values()) {
    if (!u) continue
    tokens.input += u.input_tokens || 0
    tokens.output += u.output_tokens || 0
    tokens.cacheRead += u.cache_read_input_tokens || 0
    tokens.cacheWrite += u.cache_creation_input_tokens || 0
  }
  const mids = new Set()
  for (const e of entries) {
    if (e.k === 'user') users++
    if (e.k === 'assistant') {
      if (!mids.has(e.mid)) assistants++
      mids.add(e.mid)
      for (const b of e.blocks) if (b.type === 'tool') tools[b.name] = (tools[b.name] || 0) + 1
    }
  }
  const times = entries.map(e => Date.parse(e.ts)).filter(Number.isFinite)
  return {
    users,
    assistants,
    tools,
    toolCalls: Object.values(tools).reduce((a, b) => a + b, 0),
    tokens,
    cost,
    title,
    models: [...models],
    start: times.length ? Math.min(...times) : undefined,
    end: times.length ? Math.max(...times) : undefined,
  }
}

function loadSubagents(transcript, keepContext) {
  const dir = join(dirname(transcript), basename(transcript, '.jsonl'), 'subagents')
  if (!existsSync(dir)) return []
  const out = []
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.jsonl')) continue
    const agentId = name.replace(/^agent-/, '').replace(/\.jsonl$/, '')
    let meta = {}
    try {
      meta = JSON.parse(readFileSync(join(dir, name.replace(/\.jsonl$/, '.meta.json')), 'utf8'))
    } catch {}
    const rows = readJsonl(join(dir, name))
    const entries = collapseLinks(normalize(rows, keepContext))
    const first = rows.find(r => r.type === 'user')
    const prompt =
      typeof first?.message?.content === 'string'
        ? first.message.content
        : (first?.message?.content ?? []).filter(b => b.type === 'text').map(b => b.text).join('\n')
    out.push({
      agentId,
      type: meta.agentType,
      prompt,
      promptId: first?.promptId,
      ts: first?.timestamp,
      entries,
      stats: stats(rows, entries),
    })
  }
  return out
}

/** Attach each subagent to the Agent/Task tool call that started it. */
function linkSubagents(entries, subagents) {
  const calls = []
  for (const e of entries) {
    if (e.k !== 'assistant') continue
    for (const b of e.blocks) {
      if (b.type === 'tool' && (b.name === 'Agent' || b.name === 'Task')) calls.push({ e, b })
    }
  }
  const unlinked = []
  for (const sa of subagents) {
    const byPrompt = calls.find(c => !c.b.agent && c.b.input?.prompt && sa.prompt.includes(c.b.input.prompt.slice(0, 200)))
    if (byPrompt) byPrompt.b.agent = sa.agentId
    else unlinked.push(sa.agentId)
  }
  return unlinked
}

function readVendor(name) {
  return readFileSync(join(HERE, 'vendor', name), 'utf8')
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  const session = args.session && !args.session.includes('${') ? args.session : undefined
  const transcript = args.jsonl
    ? resolve(args.jsonl)
    : (session && findTranscript(session)) || (args.latest || !session ? findLatest() : undefined)
  if (!transcript || !existsSync(transcript)) {
    throw new Error(`No transcript found for ${args.jsonl ?? session ?? 'the current folder'}`)
  }
  const rows = readJsonl(transcript)
  const entries = collapseLinks(normalize(rows, args.context))
  const subagents = loadSubagents(transcript, args.context)
  const unlinked = linkSubagents(entries, subagents)
  const first = rows.find(r => r.cwd)
  const sessionId = basename(transcript, '.jsonl')
  const data = {
    sessionId,
    cwd: first?.cwd,
    branch: first?.gitBranch,
    version: first?.version,
    exportedAt: new Date().toISOString(),
    context: args.context,
    stats: stats(rows, entries),
    entries,
    leaf: [...entries].reverse().find(e => !e.att && e.k !== 'meta' && e.k !== 'context')?.id ?? null,
    subagents: Object.fromEntries(subagents.map(s => [s.agentId, s])),
    unlinked,
  }
  if (args.title) data.stats.title = args.title

  const payload = Buffer.from(JSON.stringify(data)).toString('base64')
  const html = readFileSync(join(HERE, 'template.html'), 'utf8')
    .replace('{{TITLE}}', () => escapeHtml(data.stats.title || `Session ${sessionId.slice(0, 8)}`))
    .replace('{{CSS}}', () => readFileSync(join(HERE, 'viewer.css'), 'utf8'))
    .replace('{{MARKED}}', () => readVendor('marked.min.js'))
    .replace('{{HLJS}}', () => readVendor('highlight.min.js'))
    .replace('{{VIEWER}}', () => readFileSync(join(HERE, 'viewer.js'), 'utf8'))
    .replace('{{DATA}}', () => payload)

  let out = args.out ?? `claude-session-${sessionId}.html`
  if (out === '~' || out.startsWith('~/')) out = join(homedir(), out.slice(1))
  if (out.endsWith('/') || (existsSync(out) && statSync(out).isDirectory())) {
    out = join(out, `claude-session-${sessionId}.html`)
  }
  const outPath = resolve(out)
  mkdirSync(dirname(outPath), { recursive: true })
  writeFileSync(outPath, html)
  process.stdout.write(
    `${JSON.stringify({ path: outPath, entries: entries.length, subagents: subagents.length, bytes: Buffer.byteLength(html) })}\n`,
  )
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
}

try {
  main()
} catch (err) {
  process.stderr.write(`${err?.message ?? err}\n`)
  process.exit(1)
}
