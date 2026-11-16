import { expect, test } from 'claude-code/testing'

import { parseArgs } from './register'

const ran = (exitCode: number, stdout: string, stderr = '') => ({
  value: { exitCode, stdout, stderr, isStdoutTruncated: false, isStderrTruncated: false },
})
const run = (args: string) => ({
  command: 'export-html',
  args,
  origin: { kind: 'composer' as const },
  presentation: { isFullscreen: false, columns: 120 },
})

test('arguments: path and flags in any order', () => {
  expect(parseArgs('')).toEqual({ context: false, open: true })
  expect(parseArgs('out.html --no-open')).toEqual({ out: 'out.html', context: false, open: false })
  expect(parseArgs('--context ~/x/')).toEqual({ out: '~/x/', context: true, open: true })
})

test('/export-html runs the exporter for this session and reports where it wrote', async ($, on) => {
  const runs: string[][] = []
  on('command.register', () => ({ value: { command: 'export-html' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 'abc-123' }))
  on('process.run', (_, e) => {
    runs.push([...e.argv])
    return ran(0, '{"path":"/w/claude-session-abc-123.html","entries":12,"subagents":1,"bytes":204800}\n')
  })

  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
  const result = await $.command.run(run('--no-open'))

  expect(runs.length).toBe(1)
  expect(runs[0]?.[0]).toBe('node')
  expect(runs[0]?.slice(2)).toEqual(['--session', 'abc-123'])
  expect(result.text).toBe('Exported 12 entries, 1 subagent (200 KB) to /w/claude-session-abc-123.html')
})

test('a failed export says why', async ($, on) => {
  on('command.register', () => ({ value: { command: 'export-html' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 'abc-123' }))
  on('process.run', () => ran(1, '', 'No transcript found for abc-123\n'))

  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
  const result = await $.command.run(run(''))

  expect(result.text).toBe('Export failed: No transcript found for abc-123')
})
