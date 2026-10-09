import { expect, mock, test } from 'claude-code/testing'

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

test('the pane marks the task being worked on', async ($, on) => {
  mock.clock(on)
  const statuses: (string | undefined)[] = []
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.status', ($, e) => {
    statuses.push(e.text)
    return { value: undefined }
  })
  on('process.run', ($, e) => {
    const sub = e.argv[1]
    if (sub === 'list') return out(LIST)
    if (sub === 'status') return out(statusWith('done'))
    return out(applyWith([true, false, false]))
  })
  await $.command.run({
    command: 'openspec-tui',
    args: '',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: true, columns: 160 },
  })
  expect(statuses.at(-1)).toBe('OpenSpec: add-dark-mode · Apply 1/3')

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({
      plugin: 'openspec-tui',
      surface,
      component: 'Pane',
      requestId: 'openspec-tui',
      viewport: { columns: 60, rows: 40 },
      props: {
        title: 'OpenSpec',
        isFocused: false,
        bodyColumns: 56,
        placement: 'dock',
        scroll: { offset: 0, bodyRows: 36 },
        view: {},
      },
    })
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
    expect(await ui.find({ type: 'Text', text: /fix-login/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /◔ Propose/ })).toBeDefined()
    await ui.unmount()
  }
})
