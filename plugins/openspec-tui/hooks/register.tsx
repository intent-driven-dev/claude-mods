import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { OpenSpecActivity, OpenSpecSchema, OpenSpecSnapshot } from '../types'
import {
  type Step,
  NO_CHANGE,
  artifactForPath,
  buildSteps,
  changeFromPath,
  changeStage,
  chooseActive,
  currentTaskIndex,
  derivePhase,
  groupSkillUses,
  isOpenSpecSkill,
  liveStep,
  parseActive,
  parseJson,
  parseList,
  parseSchemas,
  progressBar,
  recordSkillUse,
  schemaFlow,
  schemaFromConfig,
  skillVerb,
  statusLine,
  stepForSkill,
  taskWindow,
} from './model'
import { type Tone, kit } from './ui'

const PANE = 'openspec-tui'
const COMMAND = 'openspec-tui'
const TICK_MS = 400
const POLL_MS = 10000

const snapshot = atom({ plugin: 'openspec-tui', key: 'snapshot' } as const, null)
const pinned = atom({ plugin: 'openspec-tui', key: 'pinned' } as const, null)
const activity = atom({ plugin: 'openspec-tui', key: 'activity' } as const, {})
const skillUses = atom({ plugin: 'openspec-tui', key: 'skillUses' } as const, [])
const view = atom({ plugin: 'openspec-tui', key: 'view' } as const, 'journey')

const NEXT_HINT: Record<string, string> = {
  explore: '/opsx:new to start (or /opsx:explore first, or /opsx:propose for everything at once)',
  plan: '/opsx:continue for the next artifact',
  apply: '/opsx:apply to work the tasks',
  verify: '/opsx:verify, then /opsx:sync or /opsx:archive',
  archive: '/opsx:sync (optional), then /opsx:archive',
}

// Refreshing runs on session.start's own `$`, from its timers: a hook only asks
// for one (requestRefresh), so no work outlives the dispatch that asked.
let isRefreshing = false
let isDirty = true
/** The default schema's artifacts, fetched again only when `config.yaml` names another. */
let schemaCache: OpenSpecSchema | undefined

function requestRefresh() {
  isDirty = true
}

async function openspec($: EngineInterface, args: string[]) {
  const { stdout } = await $.process.run(['openspec', ...args, '--json'], { timeoutMs: 20000 })
  return parseJson(stdout)
}

async function refreshOnce($: EngineInterface) {
  const now = await $.clock.now()
  let next: OpenSpecSnapshot
  try {
    const list = parseList(await openspec($, ['list']))
    const { hasRoot, rootPath } = list
    const readText = (path: string) => $.fs.read(path).catch(() => '')

    // The project default (cheap to re-read, so edits to config.yaml show up)
    // and each change's own schema from its .openspec.yaml.
    const defaultSchema = rootPath
      ? schemaFromConfig(await readText(`${rootPath}/openspec/config.yaml`))
      : undefined
    const changes = rootPath
      ? await Promise.all(
          list.changes.map(async c => ({
            ...c,
            schemaName:
              schemaFromConfig(await readText(`${rootPath}/openspec/changes/${c.name}/.openspec.yaml`)) ??
              defaultSchema,
          })),
        )
      : list.changes

    const name = hasRoot
      ? chooseActive(changes, await read($, pinned), (await read($, activity)).hintedChange)
      : undefined
    let active
    if (name) {
      const [status, apply] = await Promise.all([
        openspec($, ['status', '--change', name]),
        openspec($, ['instructions', 'apply', '--change', name]),
      ])
      active = parseActive(name, status, apply)
    }
    if (hasRoot && (schemaCache === undefined || schemaCache.name !== defaultSchema)) {
      schemaCache = parseSchemas(await openspec($, ['schemas']), defaultSchema)
    }
    next = {
      hasRoot,
      changes,
      active,
      schema: schemaCache,
      defaultSchema: defaultSchema ?? schemaCache?.name,
      refreshedAt: now,
    }
  } catch (err) {
    // Keep what the last good refresh saw, never more: the followed change
    // only while that list still has it.
    const prev = await read($, snapshot)
    const changes = prev?.changes ?? []
    next = {
      hasRoot: prev?.hasRoot ?? false,
      changes,
      active: changes.some(c => c.name === prev?.active?.name) ? prev?.active : undefined,
      schema: prev?.schema,
      defaultSchema: prev?.defaultSchema,
      error: err instanceof Error ? err.message : String(err),
      refreshedAt: now,
    }
  }
  await update($, snapshot, () => next)
  const act = await read($, activity)
  $.ui.status(statusLine(next.active, buildSteps(next.active, act, next.schema)))
}

/** Runs the refreshes asked for since the last one; never two at once. */
async function tick($: EngineInterface) {
  if (!isDirty || isRefreshing) return
  isRefreshing = true
  try {
    while (isDirty) {
      isDirty = false
      await refreshOnce($)
    }
  } finally {
    isRefreshing = false
  }
}

function setActivity($: EngineInterface, patch: Partial<OpenSpecActivity>) {
  return update($, activity, prev => ({ ...prev, ...patch }))
}

/** `/opsx:apply add-auth` → `add-auth`, when the first word looks like a change name. */
function changeFromArgs(args: string | undefined): string | undefined {
  const first = (args ?? '').trim().split(/\s+/)[0]
  return first && /^[a-z0-9][a-z0-9-]*$/.test(first) ? first : undefined
}

/** Files one skill use under the change followed and the step it is at now. */
async function noteSkill($: EngineInterface, skill: string) {
  const snap = await read($, snapshot)
  const act = await read($, activity)
  const verb = skillVerb(skill)
  const hinted = act.hintedChange
  const isStarting = verb === 'new' || verb === 'propose' || verb === 'explore'
  // Starting a change that `openspec list` has not shown yet belongs to that
  // change's first step, not to whichever change the pane followed before.
  const isNewChange = isStarting && hinted !== undefined && !snap?.changes.some(c => c.name === hinted)
  const where = isNewChange
    ? { change: hinted, stepId: 'explore', stepLabel: 'New / Explore' }
    : snap?.active
      ? { change: snap.active.name, ...stepForSkill(buildSteps(snap.active, act, snap.schema)) }
      : { change: undefined, stepId: 'explore', stepLabel: 'New / Explore' }
  const at = await $.clock.now()
  const list = await read($, skillUses)
  if (recordSkillUse(list, { skill, at, ...where }) === undefined) return
  await update($, skillUses, prev => recordSkillUse(prev, { skill, at, ...where }) ?? prev)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: COMMAND,
      description:
        'Show the OpenSpec pane. Args: <change> to pin one, auto to follow the latest, skills for the Skills tab',
    })
    void $.ui.open({ id: PANE, title: 'OpenSpec' })
    isDirty = true
    $.clock.every(TICK_MS, () => void tick($))
    $.clock.every(POLL_MS, requestRefresh)

    return next(e)
  })

  on('command.run', { command: COMMAND }, async ($, e) => {
    const arg = e.args.trim()
    if (arg === 'skills') {
      await update($, view, () => 'skills')
      await $.ui.open({ id: PANE, title: 'OpenSpec' })
      return { text: 'Skills tab opened.' }
    }
    await update($, view, () => 'journey')
    if (arg === 'auto') {
      await update($, pinned, () => null)
    } else if (arg !== '') {
      await update($, pinned, () => arg)
    }
    await $.ui.open({ id: PANE, title: 'OpenSpec' })
    isDirty = true
    await tick($)
    const snap = await read($, snapshot)
    if (arg !== '' && arg !== 'auto' && !snap?.changes.some(c => c.name === arg)) {
      return { text: `No active change named "${arg}"; following the latest instead.` }
    }
    return {
      text: snap?.active ? `OpenSpec pane following ${snap.active.name}.` : 'OpenSpec pane opened.',
    }
  })

  // The person typing /opsx:apply <change> (or /openspec-apply-change ...).
  on('command.run', async ($, e, next) => {
    if (isOpenSpecSkill(e.command)) {
      await setActivity($, {
        skill: e.command,
        hintedChange: changeFromArgs(e.args) ?? (await read($, activity)).hintedChange,
      })
      requestRefresh()
    }
    return next(e)
  })

  // Every skill expansion: a typed /name, the Skill tool, a preload.
  on('skill.prompt', async ($, e, next) => {
    await noteSkill($, e.skill)
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    if (e.tool === 'Skill') {
      // The model invoking a skill itself.
      if (isOpenSpecSkill(e.skill)) {
        await setActivity($, {
          skill: e.skill,
          hintedChange: changeFromArgs(e.args) ?? (await read($, activity)).hintedChange,
        })
        requestRefresh()
      }
      await noteSkill($, e.skill)
      return next(e)
    }

    if (e.tool === 'Write' || e.tool === 'Edit') {
      const path = e.file_path
      const change = changeFromPath(path)
      if (change === undefined) return next(e)

      const snap = await read($, snapshot)
      const active = snap?.active?.name === change ? snap.active : undefined
      await setActivity($, {
        hintedChange: change,
        writingArtifact: artifactForPath(path, active),
      })
      const ran = await next(e)
      requestRefresh()
      return ran
    }

    if (e.tool === 'Bash' && /(^|[\s;&|(])openspec\s/.test(e.command)) {
      const ran = await next(e)
      requestRefresh()
      return ran
    }

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    await setActivity($, { writingArtifact: undefined })
    requestRefresh()
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const els = $.ui.resolve(e)
    const { Box } = els
    const width = Math.max(20, e.props.bodyColumns)
    const ui = kit(els, width)
    const shown = await read($, view)
    const body =
      shown === 'skills' ? await renderSkills($, ui) : await renderJourney($, ui, width, e.props.scroll.bodyRows)
    return (
      <Box flexDirection="column">
        {ui.tabs(shown, next => update($, view, () => next))}
        {body}
      </Box>
    )
  })
}

type Kit = ReturnType<typeof kit>

/** The OpenSpec tab: where the followed change is in its journey. */
async function renderJourney($: EngineInterface, ui: Kit, width: number, bodyRows: number | undefined) {
  const { tone, rule, Box } = ui
  const snap = await read($, snapshot)
  const act = await read($, activity)

  if (snap === null) {
    return tone('meta', 'Reading OpenSpec…')
  }
  if (!snap.hasRoot) {
    return (
      <Box flexDirection="column">
        {tone('title', 'OpenSpec')}
        {tone('meta', 'No openspec/ folder here.')}
        {snap.error !== undefined && tone('error', snap.error)}
      </Box>
    )
  }

  const active = snap.active
  const phase = derivePhase(active, act)
  const steps = buildSteps(active, act, snap.schema)
  const pin = await read($, pinned)
  const tasks = active?.tasks ?? []
  const current = currentTaskIndex(tasks)
  // The tab row, then the rows drawn around the task list.
  const used = 1 + 5 + steps.length + 4 + 5 + 2 + snap.changes.length
  const room = Math.max(5, (bodyRows ?? 24) - used)
  const win = taskWindow(tasks, room)
  const schemaName = active?.schemaName || snap.schema?.name
  const flow = schemaFlow(active ? active.artifacts.map(a => a.id) : (snap.schema?.artifacts ?? []))
  const isOffDefault =
    schemaName !== undefined && snap.defaultSchema !== undefined && schemaName !== snap.defaultSchema
  const why = !active
    ? undefined
    : pin === active.name
      ? `pinned · /${COMMAND} auto to unpin`
      : act.hintedChange === active.name
        ? 'from your last OpenSpec command or edit'
        : 'most recently changed'
  const nameWidth = Math.min(
    Math.max(...snap.changes.map(c => c.name.length), 4),
    Math.max(8, width - 26),
  )
  const live = liveStep(steps)

  const mark = (s: Step) =>
    ({ done: '✓', current: '●', writing: '✎', ready: '○', blocked: '·', pending: '○' })[s.state]
  const stepTone = (s: Step): Tone =>
    ({ done: 'done', current: 'current', writing: 'writing', ready: 'body', blocked: 'muted', pending: 'muted' })[
      s.state
    ] as Tone

  return (
    <Box flexDirection="column">
      {tone('title', `OpenSpec${active ? ` · ${active.name}` : ''}`)}
      {schemaName && (
        <Box flexDirection="row">
          {tone('body', 'Schema: ')}
          {tone('accent', schemaName)}
          {isOffDefault && tone('meta', `  (project default: ${snap.defaultSchema})`)}
        </Box>
      )}
      {flow !== '' && tone('meta', `  ${flow}`, 'wrap')}
      {rule()}

      {steps.map(s => {
        const line = tone(stepTone(s), `${mark(s)} ${s.label}${s.note ? `  ${s.note}` : ''}`)
        if (s.kind === 'artifact') {
          // A sub-step of Propose, drawn as a branch of its tree.
          return (
            <Box flexDirection="row">
              {tone('rule', s.isLastChild ? '  └─ ' : '  ├─ ')}
              {line}
            </Box>
          )
        }
        return (
          <Box flexDirection="column">
            {line}

            {s.id === 'apply' && s.kind === 'phase' && tasks.length > 0 && (
              <Box flexDirection="column">
                {tone(
                  'meta',
                  `    ${progressBar(active?.progress.complete ?? 0, active?.progress.total ?? 0, Math.min(24, width - 6))}`,
                )}
                {win.start > 0 && tone('meta', `    … ${win.start} done above`)}
                {tasks.slice(win.start, win.end).map((t, j) => {
                  const isCurrent = win.start + j === current && phase === 'apply'
                  return tone(
                    isCurrent ? 'current' : t.done ? 'done' : 'body',
                    `    ${isCurrent ? '▶' : t.done ? '✓' : '○'} ${t.description}`,
                  )
                })}
                {win.end < tasks.length && tone('meta', `    … ${tasks.length - win.end} more`)}
              </Box>
            )}
          </Box>
        )
      })}

      {rule()}
      {active?.applyState === 'blocked' && phase === 'apply' && tone('warn', 'Apply is blocked: missing artifacts')}
      {tone('meta', `Next: ${NEXT_HINT[phase]}`, 'wrap')}

      {rule()}
      {tone('heading', 'Working on')}
      {active ? (
        <Box flexDirection="column">
          {tone(
            'current',
            `  ▸ ${active.name}${live ? `  ·  ${live.state === 'writing' ? 'writing ' : ''}${live.label}` : ''}`,
          )}
          {why && tone('meta', `    ${why}`)}
          {act.skill !== undefined && tone('meta', `    last command: /${act.skill}`)}
        </Box>
      ) : (
        tone('meta', '  No active change yet')
      )}

      {rule()}
      {tone('heading', `Active changes (${snap.changes.length})`)}
      {snap.changes.length === 0 && tone('meta', '  none')}
      {snap.changes.map(c => {
        const isFollowed = c.name === active?.name
        const stage = changeStage(c)
        const label = isFollowed ? (live?.label ?? stage.label) : stage.label
        const meter = ['◔', '◑', '●'][stage.rank]
        const tag = c.schemaName && c.schemaName !== snap.defaultSchema ? `  [${c.schemaName}]` : ''
        const name = c.name.length > nameWidth ? c.name.slice(0, nameWidth - 1) + '…' : c.name.padEnd(nameWidth)
        return (
          <Box flexDirection="row">
            {tone(isFollowed ? 'current' : 'body', `${isFollowed ? '  ▸ ' : '    '}${name}  `)}
            {tone(stage.rank === 2 ? 'done' : isFollowed ? 'current' : 'meta', `${meter} ${label}${tag}`)}
          </Box>
        )
      })}
      {snap.changes.length > 1 && tone('meta', `  /${COMMAND} <name> to follow another`)}
      {snap.error !== undefined && tone('error', snap.error)}
    </Box>
  )
}

/** The Skills tab: every skill used, filed under the change and step it ran in. */
async function renderSkills($: EngineInterface, ui: Kit) {
  const { tone, rule, Box } = ui
  const snap = await read($, snapshot)
  const uses = await read($, skillUses)
  const followed = snap?.active?.name
  const groups = groupSkillUses(uses, followed)
  const kind = (isOpenSpec: boolean) => (isOpenSpec ? '◆' : '◇')

  return (
    <Box flexDirection="column">
      {tone('title', `Skills · ${followed ?? NO_CHANGE}`)}
      {groups.last
        ? tone('meta', `Last: ${groups.last.skill} · ${groups.last.change ?? NO_CHANGE} · ${groups.last.stepLabel}`)
        : tone('meta', 'No skills used yet this session.')}
      {rule()}

      {groups.steps.length === 0 && groups.last !== undefined && tone('meta', 'No skills used for this change yet.')}
      {groups.steps.map(g => (
        <Box flexDirection="column">
          {tone('heading', g.stepLabel)}
          {g.uses.map(u =>
            tone(
              'body',
              `  ${kind(u.isOpenSpec)} ${u.skill}${u.count > 1 ? ` ×${u.count}` : ''}`,
            ),
          )}
        </Box>
      ))}

      {groups.others.length > 0 && (
        <Box flexDirection="column">
          {rule()}
          {tone('heading', 'Other changes')}
          {groups.others.map(o =>
            tone('body', `  ${o.change} · ${o.count} skill ${o.count === 1 ? 'use' : 'uses'}`),
          )}
        </Box>
      )}
      {rule()}
      {tone('meta', '◆ OpenSpec skill   ◇ other skill')}
    </Box>
  )
}
