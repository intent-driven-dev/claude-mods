import { expect, mock, test } from 'claude-code/testing'

import { TONES } from '../hooks/ui'
import { LIST, applyWith, statusWith } from './fixtures'

const out = (json: unknown) => ({
  value: {
    exitCode: 0,
    stdout: JSON.stringify(json),
    stderr: '',
    isStdoutTruncated: false,
    isStderrTruncated: false,
  },
})

const RUN = {
  command: 'openspec-tui',
  args: '',
  origin: { kind: 'composer' },
  presentation: { isFullscreen: true, columns: 160 },
} as const

const paneProps = {
  title: 'OpenSpec',
  isFocused: false,
  bodyColumns: 56,
  placement: 'dock',
  scroll: { offset: 0, bodyRows: 40 },
  view: {},
} as const

type Body = Extract<Parameters<typeof test>[1], (...args: never[]) => unknown>

const mountOn = (
  $: Parameters<Body>[0],
  surface: 'terminal' | 'desktop',
  requestId: string,
) =>
  $.ui.mount({
    plugin: 'openspec-tui',
    surface,
    component: 'Pane',
    requestId,
    viewport: { columns: 60, rows: 44 },
    props: paneProps,
  })

/** The world beneath the plugin: the CLI, the files and the host, answered from memory. */
function world(on: Parameters<Body>[1]) {
  const clock = mock.clock(on)
  const state = { list: LIST as unknown, fail: false }
  const statuses: (string | undefined)[] = []
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.status', ($, e) => {
    statuses.push(e.text)
    return { value: undefined }
  })
  on('process.run', ($, e) => {
    if (state.fail) return { deny: 'openspec is not on PATH' }
    const sub = e.argv[1]
    if (sub === 'list') return out(state.list)
    if (sub === 'status') return out(statusWith('done'))
    if (sub === 'schemas') return out([{ name: 'spec-driven', artifacts: ['proposal', 'specs', 'design', 'tasks'] }])
    return out(applyWith([true, false, false]))
  })
  on('fs.read', ($, e) => {
    const path = String(e.path)
    if (path.endsWith('/openspec/config.yaml')) return { value: 'schema: spec-driven\n' }
    if (path.endsWith('/fix-login/.openspec.yaml')) return { value: 'schema: tdd\n' }
    if (path.endsWith('/.openspec.yaml')) return { value: 'schema: spec-driven\n' }
    return { deny: 'no such file' }
  })
  on('tool.call', () => ({ result: 'ok', text: 'ok' }))
  return { clock, state, statuses }
}

test('the pane marks the task being worked on', async ($, on) => {
  const { statuses } = world(on)
  await $.command.run(RUN)
  expect(statuses.at(-1)).toBe('OpenSpec: add-dark-mode · Apply 1/3')

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await mountOn($, surface, 'openspec-tui')
    expect(await ui.find({ type: 'Text', text: /add-dark-mode/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /▶ 1\.2 task 2/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /● Apply\s+1\/3/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /✓ Propose\s+4\/4/ })).toBeDefined()
    for (const artifact of ['Proposal', 'Specs', 'Design', 'Tasks']) {
      expect(await ui.find({ type: 'Text', text: new RegExp(`✓ ${artifact}`) })).toBeDefined()
    }
    expect(await ui.find({ type: 'Text', text: /├─/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /└─/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /✓ New \/ Explore/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /○ Sync & Archive/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^Working on$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /▸ add-dark-mode\s+·\s+Apply/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Active changes \(2\)/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /◔ Propose\s+\[tdd\]/ })).toBeDefined()
    // The schema is a row of plain Texts: the label, then the name on its own.
    expect(await ui.find({ type: 'Text', text: /^Schema: $/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^spec-driven$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /proposal → specs → design → tasks/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /project default/ })).toBeUndefined()
    await ui.unmount()
  }
})

test('an archived change leaves the pane, and stays gone when the CLI then fails', async ($, on) => {
  const { state } = world(on)
  await $.command.run(RUN)
  state.list = { ...LIST, changes: LIST.changes.filter(c => c.name !== 'add-dark-mode') }
  await $.command.run(RUN)
  state.fail = true
  await $.command.run(RUN)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await mountOn($, surface, 'openspec-tui')
    expect(await ui.find({ type: 'Text', text: /add-dark-mode/ })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /Active changes \(1\)/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /fix-login/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /not on PATH/ })).toBeDefined()
    await ui.unmount()
  }
})

// DESIGN.md: every Text names a tone's theme color, and nothing is drawn dim.
test('every element follows the design system', async ($, on) => {
  world(on)
  await $.command.run(RUN)
  const colors = new Set(Object.values(TONES).map(t => t.color))

  const ui = await mountOn($, 'terminal', 'openspec-tui')
  const texts = await ui.findAll({ type: 'Text' })
  expect(texts.length).toBeGreaterThan(5)
  for (const t of texts) {
    expect({ text: t.text, color: colors.has(String(t.props.color)) }).toEqual({ text: t.text, color: true })
  }
  for (const el of [...texts, ...(await ui.findAll({ type: 'Box' }))]) {
    expect(el.props.dimColor).toBeUndefined()
  }
  await ui.unmount()
})
