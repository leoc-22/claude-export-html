(() => {
  'use strict'
  const raw = document.getElementById('session-data').textContent.trim()
  const D = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(raw), c => c.charCodeAt(0))))
  const $ = sel => document.querySelector(sel)
  const h = (tag, cls, html) => {
    const el = document.createElement(tag)
    if (cls) el.className = cls
    if (html !== undefined) el.innerHTML = html
    return el
  }
  const esc = s =>
    String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

  // ---------------------------------------------------------------- markdown
  const SAFE = /^(https?:|mailto:|#|\/|\.)/i
  marked.use({
    gfm: true,
    breaks: true,
    renderer: {
      html(token) {
        return esc(token.text ?? token.raw ?? '')
      },
      link(token) {
        const href = String(token.href || '').replace(/[\0-\x1f]/g, '')
        const inner = this.parser.parseInline(token.tokens)
        if (!SAFE.test(href)) return inner
        return `<a href="${esc(href)}" target="_blank" rel="noopener">${inner}</a>`
      },
      image(token) {
        const href = String(token.href || '')
        if (!/^(https?:|data:image\/)/i.test(href)) return esc(token.text || '')
        return `<img src="${esc(href)}" alt="${esc(token.text || '')}">`
      },
      code(token) {
        return `<pre><code class="hljs">${highlight(token.text, token.lang)}</code></pre>`
      },
      codespan(token) {
        return `<code>${esc(token.text)}</code>`
      },
    },
  })
  function highlight(code, lang) {
    try {
      if (lang && hljs.getLanguage(lang)) return hljs.highlight(code, { language: lang }).value
      if (code.length < 20000) return hljs.highlightAuto(code).value
    } catch {}
    return esc(code)
  }
  const md = text => {
    try {
      return marked.parse(String(text ?? ''))
    } catch {
      return `<pre>${esc(text)}</pre>`
    }
  }
  const EXT = { js: 'javascript', mjs: 'javascript', cjs: 'javascript', ts: 'typescript', tsx: 'typescript', jsx: 'javascript',
    py: 'python', rb: 'ruby', rs: 'rust', go: 'go', java: 'java', kt: 'kotlin', swift: 'swift', c: 'c', h: 'c', cpp: 'cpp',
    cs: 'csharp', php: 'php', sh: 'bash', zsh: 'bash', bash: 'bash', json: 'json', yml: 'yaml', yaml: 'yaml', toml: 'ini',
    md: 'markdown', html: 'xml', xml: 'xml', css: 'css', scss: 'scss', sql: 'sql', lua: 'lua', vim: 'vim' }
  const langOf = path => EXT[String(path || '').split('.').pop().toLowerCase()]

  // ---------------------------------------------------------------- model
  const E = D.entries
  const byId = new Map(E.map(e => [e.id, e]))
  const kids = new Map()
  const roots = []
  for (const e of E) {
    if (e.att) continue // drawn under its call, not as a tree node
    if (e.p && byId.has(e.p)) {
      if (!kids.has(e.p)) kids.set(e.p, [])
      kids.get(e.p).push(e)
    } else roots.push(e)
  }
  const results = new Map()
  const calls = new Map() // tool_use id -> { entry, block }
  for (const e of E) {
    if (e.k === 'result') results.set(e.tid, e)
    if (e.k === 'assistant') for (const b of e.blocks) if (b.type === 'tool') calls.set(b.id, { entry: e, block: b })
  }
  for (const sa of Object.values(D.subagents || {})) {
    for (const e of sa.entries) {
      if (e.k === 'result') results.set(e.tid, e)
      if (e.k === 'assistant') for (const b of e.blocks) if (b.type === 'tool') calls.set(b.id, { entry: e, block: b })
    }
  }

  const textOf = content => (content || []).filter(b => b.type === 'text').map(b => b.text).join('\n')
  const firstLine = (s, n = 140) => {
    const line = String(s || '').trim().split('\n').find(l => l.trim()) || ''
    return line.length > n ? `${line.slice(0, n)}…` : line
  }
  const short = p => {
    const s = String(p || '')
    const cwd = D.cwd ? `${D.cwd}/` : null
    return cwd && s.startsWith(cwd) ? s.slice(cwd.length) : s.replace(/^\/Users\/[^/]+/, '~')
  }

  /** `mcp__server__tool` reads as `server·tool`, the server dimmed. */
  const toolName = (name, html = true) => {
    const m = /^mcp__(.+?)__(.+)$/.exec(name || '')
    if (!m) return html ? esc(name) : name
    return html ? `<span class="mcp">${esc(m[1])}·</span>${esc(m[2])}` : `${m[1]}·${m[2]}`
  }

  function kind(e) {
    if (e.k !== 'assistant') return e.k
    if (e.blocks.some(b => b.type === 'text')) return 'text'
    if (e.blocks.some(b => b.type === 'tool')) return 'tool'
    return 'thinking'
  }
  const toolBlock = e => e.blocks?.find(b => b.type === 'tool')

  function toolSummary(b) {
    const i = b.input || {}
    switch (b.name) {
      case 'Bash': return i.command
      case 'Read': return short(i.file_path) + (i.offset ? `:${i.offset}${i.limit ? `-${i.offset + i.limit}` : ''}` : '')
      case 'Edit': case 'MultiEdit': case 'Write': case 'NotebookEdit': return short(i.file_path || i.notebook_path)
      case 'Grep': return `${i.pattern}${i.path ? `  in ${short(i.path)}` : ''}${i.glob ? `  (${i.glob})` : ''}`
      case 'Glob': return `${i.pattern}${i.path ? `  in ${short(i.path)}` : ''}`
      case 'Agent': case 'Task': return `${i.subagent_type ? `[${i.subagent_type}] ` : ''}${i.description || firstLine(i.prompt, 80)}`
      case 'WebFetch': return i.url
      case 'WebSearch': return i.query
      case 'Skill': return i.skill
      case 'TodoWrite': return `${(i.todos || []).length} todos`
      default: {
        const v = Object.values(i).find(x => typeof x === 'string')
        return v ? firstLine(v, 100) : ''
      }
    }
  }

  function treeLabel(e) {
    switch (kind(e)) {
      case 'user': return `<span class="r-user">${esc(firstLine(textOf(e.content)) || '[image]')}</span>`
      case 'text': return esc(firstLine(textOf(e.blocks)))
      case 'tool': {
        const b = toolBlock(e)
        const r = results.get(b.id)
        return `<span class="${r?.err ? 'r-err' : 'r-tool'}">${r?.err ? "✗" : "→"} ${esc(toolName(b.name, false))}</span> ${esc(firstLine(toolSummary(b), 100))}`
      }
      case 'thinking': return `<span class="r-tool">∴ thinking</span>`
      case 'result': {
        const c = calls.get(e.tid)
        return `<span class="${e.err ? 'r-err' : 'r-tool'}">${e.err ? '✗' : '←'} ${esc(c ? toolName(c.block.name, false) : "result")}</span> ${esc(firstLine(textOf(e.content), 100))}`
      }
      case 'system': return `<span class="r-sys">⚠ ${esc(firstLine(e.text))}</span>`
      case 'command': return `<span class="r-user">/${esc(e.name.replace(/^\//, ''))}</span> ${esc(e.args)}`
      case 'cmdout': return `<span class="r-tool">${esc(firstLine(e.text))}</span>`
      case 'compact': return `<span class="r-sys">⟳ conversation compacted</span>`
      case 'meta': return `<span class="r-tool">· ${esc(firstLine(textOf(e.content)))}</span>`
      case 'context': return `<span class="r-tool">· context: ${esc(e.name || '')}</span>`
    }
    return ''
  }

  const searchCache = new Map()
  function searchText(e) {
    if (searchCache.has(e.id)) return searchCache.get(e.id)
    let s = ''
    if (e.content) s += textOf(e.content)
    if (e.text) s += e.text
    if (e.name) s += ` ${e.name} ${e.args || ''}`
    if (e.blocks) for (const b of e.blocks) s += ` ${b.text || ''} ${b.name || ''} ${b.input ? JSON.stringify(b.input) : ''}`
    s = s.toLowerCase()
    searchCache.set(e.id, s)
    return s
  }

  // ---------------------------------------------------------------- state
  const state = {
    filter: 'default',
    tools: new Set(),
    query: '',
    leaf: D.leaf && byId.has(D.leaf) ? D.leaf : E.at(-1)?.id,
    target: null,
  }
  const store = {
    get(k) { try { return localStorage.getItem(`cc-export:${k}`) } catch { return null } },
    set(k, v) { try { localStorage.setItem(`cc-export:${k}`, v) } catch {} },
  }

  function pathTo(id) {
    const out = []
    const seen = new Set()
    let cur = byId.get(id)
    while (cur && !seen.has(cur.id)) {
      seen.add(cur.id)
      out.push(cur)
      cur = cur.p ? byId.get(cur.p) : undefined
    }
    return out.reverse()
  }
  function leafUnder(id) {
    let cur = id
    for (;;) {
      const ch = kids.get(cur)
      if (!ch?.length) return cur
      cur = ch.at(-1).id
    }
  }

  // ---------------------------------------------------------------- tree
  function flatten() {
    const out = []
    const stack = roots
      .map((e, i) => ({ e, gut: '', branch: roots.length > 1, last: i === roots.length - 1 }))
      .reverse()
    while (stack.length) {
      const { e, gut, branch, last } = stack.pop()
      out.push({ e, pre: gut + (branch ? (last ? '└ ' : '├ ') : '') })
      const ch = kids.get(e.id) || []
      const childGut = branch ? gut + (last ? '  ' : '│ ') : gut
      // Attached tool results sit right under their call.
      if (e.k === 'assistant') {
        for (const b of e.blocks) {
          const r = b.type === 'tool' && results.get(b.id)
          if (r?.att) out.push({ e: r, pre: `${childGut}  ` })
        }
      }
      for (let i = ch.length - 1; i >= 0; i--) {
        stack.push({ e: ch[i], gut: childGut, branch: ch.length > 1, last: i === ch.length - 1 })
      }
    }
    return out
  }
  const FLAT = flatten()

  const FILTERS = {
    default: k => ['user', 'text', 'tool', 'system', 'command', 'compact'].includes(k),
    'no-tools': k => ['user', 'text', 'system', 'command', 'compact'].includes(k),
    user: k => k === 'user' || k === 'command',
    errors: (k, e) =>
      (k === 'result' && e.err) || (k === 'tool' && results.get(toolBlock(e).id)?.err) ||
      (k === 'system' && (e.level === 'warning' || e.level === 'error')),
    all: () => true,
  }

  function visible(e) {
    if (e.id === state.leaf) return true
    const k = kind(e)
    if (state.tools.size) {
      if (k === 'user') return matches(e)
      if (k === 'tool') return state.tools.has(toolBlock(e).name) && matches(e)
      return false
    }
    return FILTERS[state.filter](k, e) && matches(e)
  }
  function matches(e) {
    const tokens = state.query.toLowerCase().split(/\s+/).filter(Boolean)
    if (!tokens.length) return true
    const s = searchText(e)
    return tokens.every(t => s.includes(t))
  }

  function renderTree() {
    const onPath = new Set(pathTo(state.leaf).map(e => e.id))
    for (const e of E) if (e.att && onPath.has(e.p)) onPath.add(e.id)
    const tree = $('#tree')
    const rows = FLAT.filter(r => visible(r.e))
    const frag = document.createDocumentFragment()
    for (const { e, pre } of rows) {
      const row = h('div', `node${onPath.has(e.id) ? ' path' : ''}${e.id === state.target ? ' cur' : ''}`)
      row.dataset.id = e.id
      row.innerHTML = `<span class="pre">${esc(pre)}</span><span class="lbl">${treeLabel(e)}</span>`
      frag.append(row)
    }
    tree.replaceChildren(frag)
    if (!rows.length) tree.append(h('div', 'empty', '&nbsp; No matching entries'))
    $('#tree-status').textContent = `${rows.length} / ${FLAT.length} entries`
  }

  // ---------------------------------------------------------------- header
  const fmtN = n => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(n))
  const fmtDur = ms => {
    const m = Math.round(ms / 60000)
    return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`
  }
  const fmtTime = ts => (ts ? new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '')

  function renderHeader() {
    const s = D.stats
    const t = s.tokens
    const items = [
      s.start && `<span><b>${esc(new Date(s.start).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }))}</b>${s.end ? ` · ${fmtDur(s.end - s.start)}` : ''}</span>`,
      D.cwd && `<span title="${esc(D.cwd)}">${esc(short(D.cwd) || D.cwd)}${D.branch ? ` · ${esc(D.branch)}` : ''}</span>`,
      s.models.length && `<span>${esc(s.models.join(', '))}</span>`,
      `<span><b>${s.users}</b> prompts · <b>${s.assistants}</b> replies · <b>${s.toolCalls}</b> tool calls</span>`,
      `<span title="input · output · cache read · cache write">↑${fmtN(t.input)} ↓${fmtN(t.output)} R${fmtN(t.cacheRead)} W${fmtN(t.cacheWrite)}</span>`,
      typeof s.cost === 'number' && `<span><b>$${s.cost.toFixed(2)}</b></span>`,
      Object.keys(D.subagents || {}).length && `<span><b>${Object.keys(D.subagents).length}</b> subagents</span>`,
    ].filter(Boolean)
    $('#header').innerHTML = `
      <h1>${esc(s.title || 'Claude Code session')}</h1>
      <div class="meta">${items.join('')}<span class="mono" title="Session id">${esc(D.sessionId)}</span></div>
      <div class="tb">
        <button data-act="thinking" aria-pressed="false" title="Toggle thinking (T)">Thinking</button>
        <button data-act="tools" aria-pressed="false" title="Expand all tool calls (O)">Tool output</button>
        <button data-act="hidden" aria-pressed="false" title="Show hidden context and meta messages (H)">Hidden</button>
        <button data-act="theme" title="Switch light / dark">Theme</button>
        <span class="hint">/ search · T thinking · O tools · H hidden · Esc reset</span>
      </div>`
  }

  // ---------------------------------------------------------------- tool chips
  function renderChips() {
    const counts = D.stats.tools || {}
    const names = Object.keys(counts).sort((a, b) => counts[b] - counts[a])
    $('#chips').innerHTML = names
      .map(n => `<button data-tool="${esc(n)}" class="${state.tools.has(n) ? "on" : ""}">${esc(toolName(n, false))}<span>${counts[n]}</span></button>`)
      .join('')
  }

  // ---------------------------------------------------------------- messages
  const LIMIT = 40
  function clip(text, lang) {
    const lines = String(text ?? '').split('\n')
    const body = s => (lang ? highlight(s, lang) : esc(s))
    if (lines.length <= LIMIT) return `<pre>${body(text)}</pre>`
    const head = lines.slice(0, LIMIT).join('\n')
    const id = `c${Math.random().toString(36).slice(2)}`
    clipStore.set(id, { text, lang })
    return `<pre data-clip="${id}">${body(head)}</pre><button class="more" data-more="${id}">show all ${lines.length} lines</button>`
  }
  const clipStore = new Map()

  function lineDiff(a, b) {
    const A = String(a ?? '').split('\n')
    const B = String(b ?? '').split('\n')
    let s = 0
    while (s < A.length && s < B.length && A[s] === B[s]) s++
    let e = 0
    while (e < A.length - s && e < B.length - s && A[A.length - 1 - e] === B[B.length - 1 - e]) e++
    const out = []
    for (const l of A.slice(Math.max(0, s - 2), s)) out.push(`<span class="ln ctx">  ${esc(l)}</span>`)
    for (const l of A.slice(s, A.length - e)) out.push(`<span class="ln del">- ${esc(l)}</span>`)
    for (const l of B.slice(s, B.length - e)) out.push(`<span class="ln add">+ ${esc(l)}</span>`)
    for (const l of A.slice(A.length - e, A.length - e + 2)) out.push(`<span class="ln ctx">  ${esc(l)}</span>`)
    return out.join('')
  }

  function resultHtml(r) {
    if (!r) return '<div class="desc">No result recorded.</div>'
    const text = textOf(r.content)
    const imgs = r.content.filter(b => b.type === 'image')
      .map(b => `<img class="img" src="data:${esc(b.media)};base64,${b.data}" alt="">`).join(' ')
    return (text ? clip(text) : '') + (imgs ? `<div style="padding:6px 8px">${imgs}</div>` : '') ||
      '<div class="desc">(empty)</div>'
  }

  function toolBody(b) {
    const i = b.input || {}
    const r = results.get(b.id)
    switch (b.name) {
      case 'Bash':
        return (i.description ? `<div class="desc">${esc(i.description)}</div>` : '') +
          `<pre>$ ${highlight(i.command || '', 'bash')}</pre>` + (r ? `<div style="border-top:1px solid var(--line)">${resultHtml(r)}</div>` : '')
      case 'Edit':
        return `<div class="diff">${lineDiff(i.old_string, i.new_string)}</div>` +
          (i.replace_all ? '<div class="desc">replace all</div>' : '') + (r?.err ? resultHtml(r) : '')
      case 'MultiEdit':
        return (i.edits || []).map(ed => `<div class="diff">${lineDiff(ed.old_string, ed.new_string)}</div>`)
          .join('<span class="ln sep"></span>') + (r?.err ? resultHtml(r) : '')
      case 'Write':
        return clip(i.content, langOf(i.file_path)) + (r?.err ? resultHtml(r) : '')
      case 'Read':
      case 'Grep':
      case 'Glob':
      case 'WebSearch':
      case 'WebFetch':
        // The header already names the arguments.
        return resultHtml(r)
      case 'TodoWrite':
        return `<pre>${(i.todos || []).map(t => `${t.status === 'completed' ? '☑' : t.status === 'in_progress' ? '◐' : '☐'} ${esc(t.content)}`).join('\n')}</pre>`
      case 'Agent':
      case 'Task': {
        const sa = b.agent && D.subagents?.[b.agent]
        return `<details style="padding:4px 8px"><summary class="desc" style="padding:0;cursor:pointer">Prompt</summary><div class="md">${md(i.prompt)}</div></details>` +
          (sa ? subagentHtml(sa) : '') +
          (r ? `<div class="md" style="padding:6px 8px;font-family:var(--sans);border-top:1px solid var(--line)">${md(textOf(r.content))}</div>` : '')
      }
      default:
        return `<pre>${highlight(JSON.stringify(i, null, 2), 'json')}</pre>` +
          (r ? `<div style="border-top:1px solid var(--line)">${resultHtml(r)}</div>` : '')
    }
  }

  function subagentHtml(sa) {
    const s = sa.stats || {}
    const leaf = sa.entries.at(-1)
    const local = new Map(sa.entries.map(e => [e.id, e]))
    const path = []
    for (let cur = leaf; cur; cur = cur.p ? local.get(cur.p) : undefined) path.push(cur)
    path.reverse()
    const inner = h('div')
    for (const e of path.slice(1)) {
      const el = renderEntry(e, true)
      if (el) inner.append(el)
    }
    return `<div class="sub"><div class="sub-h">Subagent ${esc(sa.type || '')} · ${esc(sa.agentId)} · ${s.toolCalls ?? 0} tool calls · ↓${fmtN(s.tokens?.output || 0)}</div>${inner.innerHTML}</div>`
  }

  function toolCard(b) {
    const r = results.get(b.id)
    const lines = r ? textOf(r.content).split('\n').length : 0
    const status = !r ? '…' : r.err ? 'error' : b.name === 'Edit' || b.name === 'MultiEdit' ? 'edited' : `${lines} line${lines === 1 ? '' : 's'}`
    const card = h('div', `tool${r?.err ? ' err' : ''}`)
    card.dataset.tool = b.id
    card.innerHTML = `<div class="th"><span class="n">${toolName(b.name)}</span><span class="a">${esc(toolSummary(b))}</span><span class="s${r?.err ? ' bad' : ''}">${esc(status)}</span></div><div class="tb2"></div>`
    if (toolsOpen) openTool(card)
    return card
  }
  function openTool(card, force) {
    const body = card.querySelector('.tb2')
    if (!body.dataset.built) {
      const c = calls.get(card.dataset.tool)
      body.innerHTML = c ? toolBody(c.block) : ''
      body.dataset.built = '1'
    }
    card.classList.toggle('open', force ?? true)
  }

  function msgShell(e, cls) {
    const el = h('div', `msg ${cls || ''}`)
    el.id = `e-${e.id}`
    el.dataset.id = e.id
    return el
  }
  const tsHtml = e => `<span class="ts">${fmtTime(e.ts)}<a href="#${esc(e.id)}" data-link="${esc(e.id)}" title="Copy link to this entry">¶</a></span>`

  function renderEntry(e, nested) {
    switch (e.k) {
      case 'user': {
        const el = msgShell(e, 'user')
        const imgs = e.content.filter(b => b.type === 'image')
          .map(b => `<img class="img" src="data:${esc(b.media)};base64,${b.data}" alt="">`).join(' ')
        el.innerHTML = `<div class="md">${md(textOf(e.content))}</div>${imgs}${nested ? '' : tsHtml(e)}`
        return el
      }
      case 'assistant': {
        const el = msgShell(e)
        for (const b of e.blocks) {
          if (b.type === 'text') el.append(h('div', 'md', md(b.text)))
          else if (b.type === 'thinking') {
            el.append(h('div', 'thinking-c', '∴ Thinking…'))
            el.append(h('div', 'thinking', esc(b.text)))
          } else if (b.type === 'tool') el.append(toolCard(b))
        }
        if (!nested) el.insertAdjacentHTML('beforeend', tsHtml(e))
        return el
      }
      case 'result':
        return calls.has(e.tid) ? null : Object.assign(msgShell(e), { innerHTML: resultHtml(e) })
      case 'system': {
        const el = msgShell(e)
        el.innerHTML = `<div class="note ${esc(e.level || '')}">${esc(e.text)}</div>`
        return el
      }
      case 'command': {
        const el = msgShell(e, 'user')
        el.innerHTML = `<span class="cmd">/${esc(e.name.replace(/^\//, ''))} ${esc(e.args)}</span>${nested ? '' : tsHtml(e)}`
        return el
      }
      case 'cmdout': {
        if (!e.text) return null
        const el = msgShell(e)
        el.innerHTML = `<pre class="cmdout">${esc(e.text)}</pre>`
        return el
      }
      case 'compact': {
        const el = msgShell(e)
        el.innerHTML = `<details class="compact-sum"><summary>⟳ Conversation compacted — summary</summary><div class="md">${md(textOf(e.content))}</div></details>`
        return el
      }
      case 'meta':
      case 'context': {
        const el = msgShell(e, 'hidden-msg')
        el.innerHTML = `<div class="lbl2">${e.k === 'meta' ? 'meta message' : `context · ${esc(e.name || '')}`}</div><pre class="cmdout">${esc(e.content ? textOf(e.content) : e.text)}</pre>`
        return el
      }
    }
    return null
  }

  let renderedLeaf = null
  function renderMessages() {
    if (renderedLeaf === state.leaf) return
    renderedLeaf = state.leaf
    const box = $('#messages')
    const frag = document.createDocumentFragment()
    for (const e of pathTo(state.leaf)) {
      const el = renderEntry(e)
      if (el) frag.append(el)
    }
    const others = (D.unlinked || []).map(id => D.subagents[id]).filter(Boolean)
    if (others.length) {
      const sec = h('div', 'msg')
      sec.innerHTML = `<div class="note">Subagents not tied to a tool call</div>${others.map(subagentHtml).join('')}`
      frag.append(sec)
    }
    box.replaceChildren(frag)
    if (!box.children.length) box.append(h('div', 'empty', 'Nothing to show.'))
  }

  // ---------------------------------------------------------------- navigation
  function scrollTargetFor(id) {
    const e = byId.get(id)
    if (e?.k === 'result' && calls.has(e.tid)) return calls.get(e.tid).entry.id
    return id
  }
  function navigate(id, { scroll = true } = {}) {
    if (!byId.has(id)) return
    const anchor = byId.get(id).att ? byId.get(id).p : id
    const onPath = pathTo(state.leaf).some(e => e.id === anchor)
    if (!onPath) state.leaf = leafUnder(anchor)
    state.target = id
    renderMessages()
    renderTree()
    if (!scroll) return
    const el = document.getElementById(`e-${scrollTargetFor(id)}`)
    if (el) {
      el.scrollIntoView({ block: 'start' })
      el.classList.remove('flash')
      void el.offsetWidth
      el.classList.add('flash')
      const e = byId.get(id)
      if (e?.k === 'result') {
        const card = el.querySelector(`[data-tool="${CSS.escape(e.tid)}"]`)
        if (card) openTool(card)
      }
    }
    document.body.classList.remove('side-open')
  }

  // ---------------------------------------------------------------- toggles
  let toolsOpen = false
  function setThinking(on) {
    document.body.classList.toggle('show-thinking', on)
    $('[data-act="thinking"]').setAttribute('aria-pressed', String(on))
  }
  function setTools(on) {
    toolsOpen = on
    $('[data-act="tools"]').setAttribute('aria-pressed', String(on))
    document.querySelectorAll('#messages .tool').forEach(c => (on ? openTool(c) : c.classList.remove('open')))
  }
  function setHidden(on) {
    document.body.classList.toggle('show-hidden', on)
    $('[data-act="hidden"]').setAttribute('aria-pressed', String(on))
  }
  function toggleTheme() {
    const root = document.documentElement
    const dark = root.dataset.theme ? root.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches
    root.dataset.theme = dark ? 'light' : 'dark'
    store.set('theme', root.dataset.theme)
  }

  // ---------------------------------------------------------------- events
  document.addEventListener('click', ev => {
    const t = ev.target
    const node = t.closest('.node')
    if (node) return navigate(node.dataset.id)
    const fb = t.closest('#filters button')
    if (fb) {
      state.filter = fb.dataset.filter
      state.tools.clear()
      document.querySelectorAll('#filters button').forEach(b => b.classList.toggle('on', b === fb))
      if (state.filter === 'all') setHidden(true)
      renderChips()
      return renderTree()
    }
    const chip = t.closest('#chips button')
    if (chip) {
      const n = chip.dataset.tool
      state.tools.has(n) ? state.tools.delete(n) : state.tools.add(n)
      renderChips()
      return renderTree()
    }
    const act = t.closest('[data-act]')
    if (act) {
      const a = act.dataset.act
      if (a === 'thinking') setThinking(!document.body.classList.contains('show-thinking'))
      if (a === 'tools') setTools(!toolsOpen)
      if (a === 'hidden') setHidden(!document.body.classList.contains('show-hidden'))
      if (a === 'theme') toggleTheme()
      return
    }
    const more = t.closest('[data-more]')
    if (more) {
      const c = clipStore.get(more.dataset.more)
      const pre = more.previousElementSibling
      pre.innerHTML = c.lang ? highlight(c.text, c.lang) : esc(c.text)
      return more.remove()
    }
    const link = t.closest('[data-link]')
    if (link) {
      ev.preventDefault()
      history.replaceState(null, '', `#${link.dataset.link}`)
      navigator.clipboard?.writeText(location.href).catch(() => {})
      link.textContent = '✓'
      return setTimeout(() => (link.textContent = '¶'), 1200)
    }
    const th = t.closest('.tool > .th')
    if (th) {
      const card = th.parentElement
      return openTool(card, !card.classList.contains('open'))
    }
    if (t.closest('.thinking-c')) return setThinking(true)
    const img = t.closest('img.img, .md img')
    if (img) {
      $('#modal img').src = img.src
      return $('#modal').classList.add('on')
    }
    if (t.closest('#modal')) return $('#modal').classList.remove('on')
    if (t.closest('#menu')) return document.body.classList.add('side-open')
    if (t.closest('#overlay')) return document.body.classList.remove('side-open')
  })

  let searchTimer
  $('#search').addEventListener('input', ev => {
    clearTimeout(searchTimer)
    searchTimer = setTimeout(() => {
      state.query = ev.target.value
      renderTree()
    }, 120)
  })

  const editable = el => el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)
  document.addEventListener('keydown', ev => {
    if (ev.key === 'Escape') {
      $('#modal').classList.remove('on')
      $('#search').value = ''
      state.query = ''
      $('#search').blur()
      return renderTree()
    }
    if (ev.ctrlKey || ev.metaKey || ev.altKey || editable(document.activeElement)) return
    const k = ev.key.toLowerCase()
    if (k === '/') { ev.preventDefault(); return $('#search').focus() }
    if (k === 't') setThinking(!document.body.classList.contains('show-thinking'))
    if (k === 'o') setTools(!toolsOpen)
    if (k === 'h') setHidden(!document.body.classList.contains('show-hidden'))
  })

  // sidebar resize
  ;(() => {
    const r = $('#resizer')
    const saved = Number(store.get('sidebar'))
    if (saved) document.documentElement.style.setProperty('--side-w', `${saved}px`)
    r.addEventListener('pointerdown', ev => {
      r.setPointerCapture(ev.pointerId)
      r.classList.add('drag')
      const move = e2 => {
        const w = Math.max(220, Math.min(window.innerWidth * 0.6, e2.clientX))
        document.documentElement.style.setProperty('--side-w', `${w}px`)
        store.set('sidebar', String(Math.round(w)))
      }
      const up = () => {
        r.classList.remove('drag')
        r.removeEventListener('pointermove', move)
        r.removeEventListener('pointerup', up)
      }
      r.addEventListener('pointermove', move)
      r.addEventListener('pointerup', up)
    })
  })()

  // ---------------------------------------------------------------- init
  const savedTheme = store.get('theme')
  if (savedTheme === 'light' || savedTheme === 'dark') document.documentElement.dataset.theme = savedTheme
  renderHeader()
  renderChips()
  const hash = decodeURIComponent(location.hash.slice(1))
  if (hash && byId.has(hash)) navigate(hash)
  else {
    renderMessages()
    renderTree()
  }
  window.addEventListener('hashchange', () => {
    const id = decodeURIComponent(location.hash.slice(1))
    if (byId.has(id)) navigate(id)
  })
})()
