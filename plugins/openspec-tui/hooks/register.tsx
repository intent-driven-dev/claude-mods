import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { OpenSpecActivity, OpenSpecSchema, OpenSpecSnapshot } from '../types'
import {
  type Step,
  artifactForPath,
  buildSteps,
  changeFromPath,
  changeStage,
  chooseActive,
  currentTaskIndex,
  derivePhase,
  isOpenSpecSkill,
  parseActive,
  parseJson,
  parseList,
  parseSchemas,
  progressBar,
  schemaFlow,
  schemaFromConfig,
  statusLine,
  taskWindow,
} from './model'

const PANE = 'openspec-tui'
const COMMAND = 'openspec-tui'
const POLL_MS = 10000

const snapshot = atom({ plugin: 'openspec-tui', key: 'snapshot' } as const, null)
const pinned = atom({ plugin: 'openspec-tui', key: 'pinned' } as const, null)
const activity = atom({ plugin: 'openspec-tui', key: 'activity' } as const, {})

const NEXT_HINT: Record<string, string> = {
  explore: '/opsx:new to start (or /opsx:explore first, or /opsx:propose for everything at once)',
  plan: '/opsx:continue for the next artifact',
  apply: '/opsx:apply to work the tasks',
  verify: '/opsx:verify, then /opsx:sync or /opsx:archive',
  archive: '/opsx:sync (optional), then /opsx:archive',
}

let isRefreshing = false
/** The default schema's artifacts, fetched again only when `config.yaml` names another. */
let schemaCache: OpenSpecSchema | undefined
let isDirty = false

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
    const prev = await read($, snapshot)
    next = {
      hasRoot: prev?.hasRoot ?? false,
      changes: prev?.changes ?? [],
      active: prev?.active,
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

/** One refresh at a time; a request made meanwhile runs once more after it. */
async function refresh($: EngineInterface) {
  if (isRefreshing) {
    isDirty = true
    return
  }
  isRefreshing = true
  try {
    do {
      isDirty = false
      await refreshOnce($)
    } while (isDirty)
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

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: COMMAND,
      description: 'Show the OpenSpec pane. Args: <change> to pin one, auto to follow the latest',
    })
    void $.ui.open({ id: PANE, title: 'OpenSpec' })
    void refresh($)
    $.clock.every(POLL_MS, () => void refresh($))

    return next(e)
  })

  on('command.run', { command: COMMAND }, async ($, e) => {
    const arg = e.args.trim()
    if (arg === 'auto') {
      await update($, pinned, () => null)
    } else if (arg !== '') {
      await update($, pinned, () => arg)
    }
    await $.ui.open({ id: PANE, title: 'OpenSpec' })
    await refresh($)
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
      void refresh($)
    }
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    // The model invoking an OpenSpec skill itself.
    if (e.tool === 'Skill' && isOpenSpecSkill(e.skill)) {
      await setActivity($, {
        skill: e.skill,
        hintedChange: changeFromArgs(e.args) ?? (await read($, activity)).hintedChange,
      })
      void refresh($)
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
      void refresh($)
      return ran
    }

    if (e.tool === 'Bash' && /(^|[\s;&|(])openspec\s/.test(e.command)) {
      const ran = await next(e)
      void refresh($)
      return ran
    }

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    await setActivity($, { writingArtifact: undefined })
    void refresh($)
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const snap = await read($, snapshot)
    const act = await read($, activity)
    const width = Math.max(20, e.props.bodyColumns)

    if (snap === null) {
      return <Text dimColor>Reading OpenSpec…</Text>
    }
    if (!snap.hasRoot) {
      return (
        <Box flexDirection="column">
          <Text bold>OpenSpec</Text>
          <Text dimColor>No openspec/ folder here.</Text>
          {snap.error !== undefined && <Text color="error">{snap.error}</Text>}
        </Box>
      )
    }

    const active = snap.active
    const phase = derivePhase(active, act)
    const steps = buildSteps(active, act, snap.schema)
    const pin = await read($, pinned)
    const tasks = active?.tasks ?? []
    const current = currentTaskIndex(tasks)
    const used = 5 + steps.length + 4 + 5 + 2 + snap.changes.length
    const room = Math.max(5, (e.props.scroll.bodyRows ?? 24) - used)
    const win = taskWindow(tasks, room)
    const schemaName = active?.schemaName || snap.schema?.name
    const flow = schemaFlow(active ? active.artifacts.map(a => a.id) : (snap.schema?.artifacts ?? []))
    const isOffDefault =
      schemaName !== undefined && snap.defaultSchema !== undefined && schemaName !== snap.defaultSchema
    const rule = <Text dimColor>{'─'.repeat(Math.min(width, 48))}</Text>
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
    const liveStep =
      steps.find(s => s.state === 'writing') ??
      steps.find(s => s.kind === 'artifact' && s.state === 'current') ??
      steps.find(s => s.state === 'current')

    const mark = (s: Step) =>
      ({ done: '✓', current: '●', writing: '✎', ready: '○', blocked: '·', pending: '○' })[s.state]
    const color = (s: Step) =>
      s.state === 'done'
        ? 'success'
        : s.state === 'current'
          ? 'claude'
          : s.state === 'writing'
            ? 'warning'
            : undefined

    return (
      <Box flexDirection="column">
        <Text bold wrap="truncate-end">
          OpenSpec{active ? ` · ${active.name}` : ''}
        </Text>
        {schemaName && (
          <Text wrap="truncate-end">
            <Text bold>Schema: {schemaName}</Text>
            {isOffDefault && <Text dimColor>  (project default: {snap.defaultSchema})</Text>}
          </Text>
        )}
        {flow !== '' && (
          <Text dimColor wrap="wrap">
            {'  '}
            {flow}
          </Text>
        )}
        {rule}

        {steps.map(s => {
          const isLive = s.state === 'current' || s.state === 'writing'
          const line = (
            <Text
              wrap="truncate-end"
              bold={isLive}
              color={color(s)}
              dimColor={!isLive && s.state !== 'done' && s.state !== 'ready'}
            >
              {mark(s)} {s.label}
              {s.note ? `  ${s.note}` : ''}
            </Text>
          )
          if (s.kind === 'artifact') {
            // A sub-step of Propose, drawn as a branch of its tree.
            return (
              <Box flexDirection="row">
                <Text dimColor>{s.isLastChild ? '  └─ ' : '  ├─ '}</Text>
                {line}
              </Box>
            )
          }
          return (
            <Box flexDirection="column">
              {line}

              {s.id === 'apply' && s.kind === 'phase' && tasks.length > 0 && (
                <Box flexDirection="column">
                  <Text dimColor>
                    {'    '}
                    {progressBar(active?.progress.complete ?? 0, active?.progress.total ?? 0, Math.min(24, width - 6))}
                  </Text>
                  {win.start > 0 && <Text dimColor>{'    '}… {win.start} done above</Text>}
                  {tasks.slice(win.start, win.end).map((t, j) => {
                    const isCurrent = win.start + j === current && phase === 'apply'
                    return (
                      <Text
                        wrap="truncate-end"
                        bold={isCurrent}
                        color={isCurrent ? 'claude' : t.done ? 'success' : undefined}
                        dimColor={!isCurrent}
                      >
                        {'    '}
                        {isCurrent ? '▶' : t.done ? '✓' : '○'} {t.description}
                      </Text>
                    )
                  })}
                  {win.end < tasks.length && (
                    <Text dimColor>
                      {'    '}… {tasks.length - win.end} more
                    </Text>
                  )}
                </Box>
              )}
            </Box>
          )
        })}

        {rule}
        {active?.applyState === 'blocked' && phase === 'apply' && (
          <Text color="warning">Apply is blocked: missing artifacts</Text>
        )}
        <Text dimColor wrap="wrap">
          Next: {NEXT_HINT[phase]}
        </Text>

        {rule}
        <Text bold>Working on</Text>
        {active ? (
          <Box flexDirection="column">
            <Text color="claude" bold wrap="truncate-end">
              {'  ▸ '}
              {active.name}
              {liveStep ? `  ·  ${liveStep.state === 'writing' ? 'writing ' : ''}${liveStep.label}` : ''}
            </Text>
            {why && <Text dimColor>{'    '}{why}</Text>}
            {act.skill !== undefined && <Text dimColor>{'    '}last command: /{act.skill}</Text>}
          </Box>
        ) : (
          <Text dimColor>{'  '}No active change yet</Text>
        )}

        {rule}
        <Text bold>Active changes ({snap.changes.length})</Text>
        {snap.changes.length === 0 && <Text dimColor>{'  '}none</Text>}
        {snap.changes.map(c => {
          const isFollowed = c.name === active?.name
          const stage = changeStage(c)
          const label = isFollowed ? (liveStep?.label ?? stage.label) : stage.label
          const meter = ['◔', '◑', '●'][stage.rank]
          const tag =
            c.schemaName && c.schemaName !== snap.defaultSchema ? `  [${c.schemaName}]` : ''
          const name = c.name.length > nameWidth ? c.name.slice(0, nameWidth - 1) + '…' : c.name.padEnd(nameWidth)
          return (
            <Box flexDirection="row">
              <Text color={isFollowed ? 'claude' : undefined} bold={isFollowed} dimColor={!isFollowed}>
                {isFollowed ? '  ▸ ' : '    '}
                {name}
                {'  '}
              </Text>
              <Text
                wrap="truncate-end"
                color={stage.rank === 2 ? 'success' : isFollowed ? 'claude' : undefined}
                dimColor={!isFollowed && stage.rank !== 2}
              >
                {meter} {label}
                {tag}
              </Text>
            </Box>
          )
        })}
        {snap.changes.length > 1 && (
          <Text dimColor>
            {'  '}/{COMMAND} {'<name>'} to follow another
          </Text>
        )}
        {snap.error !== undefined && (
          <Text color="error" wrap="truncate-end">
            {snap.error}
          </Text>
        )}
      </Box>
    )
  })
}
