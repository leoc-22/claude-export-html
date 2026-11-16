import type { Register } from 'claude-code'

const COMMAND = 'export-html'

type Parsed = { out?: string; context: boolean; open: boolean }

export function parseArgs(args: string): Parsed {
  const parsed: Parsed = { context: false, open: true }
  for (const word of args.trim().split(/\s+/).filter(Boolean)) {
    if (word === '--context') parsed.context = true
    else if (word === '--no-open') parsed.open = false
    else if (!word.startsWith('--') && parsed.out === undefined) parsed.out = word
  }
  return parsed
}

const size = (bytes: number) =>
  bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: COMMAND,
      description: 'Export this session as one HTML page with a tree, filters and search',
      argumentHint: '[path] [--context] [--no-open]',
    })
    return next(e)
  })

  on('command.run', { command: COMMAND }, async ($, e) => {
    const args = parseArgs(e.args)
    const sessionId = await $.session.id()
    const argv = ['node', `${$.plugin.root}/exporter/export.mjs`, '--session', sessionId]
    if (args.out) argv.push('--out', args.out)
    if (args.context) argv.push('--context')

    const ran = await $.process
      .run(argv, { timeoutMs: 120_000 })
      .catch((err: unknown) => ({ exitCode: -1, stdout: '', stderr: String(err), isStdoutTruncated: false, isStderrTruncated: false }))
    if (ran.exitCode !== 0) {
      const why = ran.stderr.trim() || `exit code ${ran.exitCode}`
      return { text: `Export failed: ${why}${/ENOENT|not found/i.test(why) ? ' (is Node.js on your PATH?)' : ''}` }
    }

    const info = JSON.parse(ran.stdout.trim().split('\n').at(-1) ?? '{}') as {
      path: string
      entries: number
      subagents: number
      bytes: number
    }
    if (args.open) {
      const opened = await $.process.run(['open', info.path]).catch(() => undefined)
      if (opened?.exitCode !== 0) await $.process.run(['xdg-open', info.path]).catch(() => undefined)
    }
    const subs = info.subagents ? `, ${info.subagents} subagent${info.subagents === 1 ? '' : 's'}` : ''
    return {
      text: `Exported ${info.entries} entries${subs} (${size(info.bytes)}) to ${info.path}${args.context ? '\nIncludes hidden context: review before sharing.' : ''}`,
    }
  })
}
