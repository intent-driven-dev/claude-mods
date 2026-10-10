import type {
  OpenSpecActiveChange,
  OpenSpecActivity,
  OpenSpecArtifact,
  OpenSpecChangeSummary,
  OpenSpecSchema,
  OpenSpecTask,
} from '../types'

export const PHASES = ['explore', 'plan', 'apply', 'verify', 'archive'] as const
export type Phase = (typeof PHASES)[number]

/**
 * A change starts with `/opsx:new` or `/opsx:explore` (exploring is optional),
 * and ends with `/opsx:sync` (optional) and `/opsx:archive`.
 */
export const PHASE_LABELS: Record<Phase, string> = {
  explore: 'New / Explore',
  plan: 'Propose',
  apply: 'Apply',
  verify: 'Verify',
  archive: 'Sync & Archive',
}

const FINISHING_VERBS = new Set(['sync', 'archive', 'bulk-archive'])

type Json = Record<string, unknown>

const asArray = (value: unknown): Json[] =>
  Array.isArray(value) ? (value.filter(v => v && typeof v === 'object') as Json[]) : []

/** The CLI prints JSON on stdout, sometimes after a line of noise. */
export function parseJson(text: string): Json | undefined {
  const starts = [text.indexOf('{'), text.indexOf('[')].filter(i => i >= 0)
  if (starts.length === 0) return undefined
  try {
    const value: unknown = JSON.parse(text.slice(Math.min(...starts)))
    return Array.isArray(value) ? { items: value } : (value as Json)
  } catch {
    return undefined
  }
}

/** `openspec schemas --json`: the one `config.yaml` names, else the first. */
export function parseSchemas(json: Json | undefined, preferred: string | undefined): OpenSpecSchema | undefined {
  const all = asArray(json?.items).map(s => ({
    name: String(s.name ?? ''),
    artifacts: Array.isArray(s.artifacts) ? s.artifacts.map(String) : [],
  }))
  return all.find(s => s.name === preferred) ?? all[0]
}

/** The `schema:` line of `openspec/config.yaml`, or of a change's `.openspec.yaml`. */
export function schemaFromConfig(yaml: string): string | undefined {
  return /^schema:\s*["']?([\w.-]+)/m.exec(yaml)?.[1]
}

/** The artifact ids in order, as one line: `proposal → specs → design → tasks`. */
export function schemaFlow(artifacts: readonly string[]): string {
  return artifacts.join(' → ')
}

/** `openspec list --json` */
export function parseList(json: Json | undefined): {
  hasRoot: boolean
  rootPath?: string
  changes: OpenSpecChangeSummary[]
} {
  if (!json || json.root === null || typeof json.root !== 'object') {
    return { hasRoot: false, changes: [] }
  }
  const rootPath = (json.root as Json).path
  const changes = asArray(json.changes).map(c => ({
    name: String(c.name ?? ''),
    completedTasks: Number(c.completedTasks ?? 0),
    totalTasks: Number(c.totalTasks ?? 0),
    status: String(c.status ?? ''),
  }))
  return {
    hasRoot: true,
    rootPath: typeof rootPath === 'string' ? rootPath : undefined,
    // Active changes only: never the archive folder or an archived entry, whatever the CLI version.
    changes: changes.filter(c => c.name !== '' && c.name !== 'archive' && c.status !== 'archived'),
  }
}

/** `openspec status --change <c> --json` plus `openspec instructions apply --change <c> --json` */
export function parseActive(
  name: string,
  status: Json | undefined,
  apply: Json | undefined,
): OpenSpecActiveChange {
  const artifacts: OpenSpecArtifact[] = asArray(status?.artifacts).map(a => ({
    id: String(a.id ?? ''),
    outputPath: String(a.outputPath ?? ''),
    status: String(a.status ?? ''),
    requires: Array.isArray(a.requires) ? a.requires.map(String) : [],
  }))
  const tasks: OpenSpecTask[] = asArray(apply?.tasks).map(t => ({
    id: String(t.id ?? ''),
    description: String(t.description ?? ''),
    done: t.done === true,
  }))
  const progress = (apply?.progress ?? {}) as Json
  return {
    name,
    schemaName: String(status?.schemaName ?? ''),
    changeRoot: String(status?.changeRoot ?? ''),
    artifacts,
    isPlanningComplete: status?.isPlanningComplete === true,
    isComplete: status?.isComplete === true,
    applyRequires: Array.isArray(status?.applyRequires)
      ? status.applyRequires.map(String)
      : artifacts.slice(-1).map(a => a.id),
    tasks,
    progress: {
      total: Number(progress.total ?? tasks.length),
      complete: Number(progress.complete ?? tasks.filter(t => t.done).length),
    },
    applyState: typeof apply?.state === 'string' ? apply.state : undefined,
    nextSteps: Array.isArray(status?.nextSteps) ? status.nextSteps.map(String) : [],
  }
}

/** Which change the pane follows: pinned, else the one last named, else the most recent. */
export function chooseActive(
  changes: OpenSpecChangeSummary[],
  pinned: string | null,
  hinted: string | undefined,
): string | undefined {
  const names = new Set(changes.map(c => c.name))
  if (pinned && names.has(pinned)) return pinned
  if (hinted && names.has(hinted)) return hinted
  return changes[0]?.name
}

/** The skill families: `opsx:apply` and `openspec-apply-change` are both `apply`. */
export function skillVerb(skill: string | undefined): string | undefined {
  if (!skill) return undefined
  const m = /^(?:opsx:|openspec-)([a-z-]+?)(?:-change|-specs)?$/.exec(skill)
  return m?.[1]
}

export function isOpenSpecSkill(name: string): boolean {
  return /^(opsx:|openspec-)/.test(name)
}

export function derivePhase(
  active: OpenSpecActiveChange | undefined,
  activity: OpenSpecActivity,
): Phase {
  const verb = skillVerb(activity.skill)
  const isFinishing = verb !== undefined && FINISHING_VERBS.has(verb)
  if (!active) return isFinishing ? 'archive' : 'explore'
  // A verify, sync or archive run speaks for the change it named, not for whichever comes next.
  const isAboutThis = activity.hintedChange === undefined || activity.hintedChange === active.name
  if (isAboutThis && isFinishing) return 'archive'
  if (isAboutThis && verb === 'verify') return 'verify'
  // Planning lasts until the artifacts the schema gates apply on are written.
  const isGateOpen = active.applyRequires.every(
    id => active.artifacts.find(a => a.id === id)?.status === 'done',
  )
  const { total, complete } = active.progress
  if (!isGateOpen) return 'plan'
  if (total === 0) return active.isPlanningComplete ? 'apply' : 'plan'
  if (complete < total) return 'apply'
  return 'verify'
}

export type ChangeStage = {
  label: string
  /** 0 Propose, 1 Apply, 2 ready to sync and archive: for a small meter. */
  rank: 0 | 1 | 2
}

/**
 * Where a change stands, from `openspec list` alone (no extra CLI call per
 * change): no tasks yet is Propose, tasks open is Apply, all done is ready to
 * sync and archive.
 */
export function changeStage(c: OpenSpecChangeSummary): ChangeStage {
  if (c.totalTasks === 0) return { label: PHASE_LABELS.plan, rank: 0 }
  if (c.completedTasks < c.totalTasks) {
    return { label: `${PHASE_LABELS.apply} ${c.completedTasks}/${c.totalTasks}`, rank: 1 }
  }
  return { label: `${PHASE_LABELS.archive} (ready)`, rank: 2 }
}

/** The task Claude works on now: the first one not done. */
export function currentTaskIndex(tasks: OpenSpecTask[]): number {
  return tasks.findIndex(t => !t.done)
}

/** Which change a path under `openspec/changes/<name>/` belongs to (archived ones excluded). */
export function changeFromPath(path: string): string | undefined {
  const m = /\/openspec\/changes\/([^/]+)\//.exec(path)
  if (!m || m[1] === 'archive') return undefined
  return m[1]
}

/** Which artifact a written file is, by the schema's `outputPath` (`proposal.md`, `specs/**\/*.md`). */
export function artifactForPath(
  path: string,
  active: OpenSpecActiveChange | undefined,
): string | undefined {
  if (!active || !active.changeRoot) return undefined
  const root = active.changeRoot.endsWith('/') ? active.changeRoot : active.changeRoot + '/'
  if (!path.startsWith(root)) return undefined
  const rel = path.slice(root.length)
  for (const a of active.artifacts) {
    const star = a.outputPath.indexOf('*')
    if (star < 0 ? rel === a.outputPath : rel.startsWith(a.outputPath.slice(0, star))) {
      return a.id
    }
  }
  return undefined
}

/** A window of the task list that keeps the current task in view. */
export function taskWindow(
  tasks: OpenSpecTask[],
  room: number,
): { start: number; end: number } {
  const size = Math.max(1, room)
  if (tasks.length <= size) return { start: 0, end: tasks.length }
  const cur = currentTaskIndex(tasks)
  const anchor = cur < 0 ? tasks.length - 1 : cur
  const start = Math.max(0, Math.min(anchor - 2, tasks.length - size))
  return { start, end: start + size }
}

export function progressBar(complete: number, total: number, width: number): string {
  const w = Math.max(4, width)
  const filled = total === 0 ? 0 : Math.round((complete / total) * w)
  return '█'.repeat(filled) + '░'.repeat(w - filled)
}

export type StepState = 'done' | 'current' | 'writing' | 'ready' | 'blocked' | 'pending'

export type Step = {
  id: string
  label: string
  kind: 'phase' | 'artifact'
  state: StepState
  note?: string
  /** An artifact is a sub-step of Propose; the last one closes the branch. */
  isLastChild?: boolean
}

const titleCase = (id: string) => id.charAt(0).toUpperCase() + id.slice(1)

/**
 * The journey as one list: Explore, then every artifact the schema defines
 * in its own order, then Apply, Verify and Archive.
 */
export function buildSteps(
  active: OpenSpecActiveChange | undefined,
  activity: OpenSpecActivity,
  schema: OpenSpecSchema | undefined,
): Step[] {
  const phase = derivePhase(active, activity)
  const at = PHASES.indexOf(phase)
  const phaseStep = (p: Phase, note?: string): Step => {
    const i = PHASES.indexOf(p)
    return {
      id: p,
      label: PHASE_LABELS[p],
      kind: 'phase',
      state: i < at ? 'done' : i === at ? 'current' : 'pending',
      note,
    }
  }

  const artifacts: Step[] = active
    ? active.artifacts.map(a => {
        const missing = a.requires.filter(
          r => active.artifacts.find(o => o.id === r)?.status !== 'done',
        )
        const state: StepState =
          activity.writingArtifact === a.id
            ? 'writing'
            : a.status === 'done'
              ? 'done'
              : a.status === 'ready'
                ? 'ready'
                : 'blocked'
        const note =
          state === 'writing'
            ? 'writing…'
            : state === 'blocked' && missing.length > 0
              ? `needs ${missing.join(', ')}`
              : undefined
        return { id: a.id, label: titleCase(a.id), kind: 'artifact', state, note }
      })
    : (schema?.artifacts ?? []).map(id => ({
        id,
        label: titleCase(id),
        kind: 'artifact' as const,
        state: 'pending' as const,
      }))

  // While planning, the artifact being written is the current step; failing
  // that, the first one ready to write is next.
  if (phase === 'plan' && !artifacts.some(a => a.state === 'writing')) {
    const next = artifacts.find(a => a.state === 'ready')
    if (next) {
      next.state = 'current'
      next.note = 'next'
    }
  }

  const progress =
    active && active.progress.total > 0
      ? `${active.progress.complete}/${active.progress.total}`
      : undefined
  const last = artifacts[artifacts.length - 1]
  if (last) last.isLastChild = true
  const written = artifacts.filter(a => a.state === 'done').length
  const propose = phaseStep('plan', artifacts.length > 0 ? `${written}/${artifacts.length}` : undefined)
  return [
    phaseStep('explore'),
    propose,
    ...artifacts,
    phaseStep('apply', progress),
    phaseStep('verify'),
    phaseStep('archive'),
  ]
}

/** The step happening now: the artifact being written (or next) says more than "Propose" does. */
export function liveStep(steps: Step[]): Step | undefined {
  return (
    steps.find(s => s.state === 'writing') ??
    steps.find(s => s.kind === 'artifact' && s.state === 'current') ??
    steps.find(s => s.state === 'current')
  )
}

export function statusLine(
  active: OpenSpecActiveChange | undefined,
  steps: Step[],
): string | undefined {
  if (!active) return undefined
  const now = liveStep(steps)
  if (!now) return `OpenSpec: ${active.name}`
  const where = now.kind === 'artifact' ? 'Propose › ' : ''
  const verb = now.state === 'writing' ? 'writing ' : ''
  const count = now.kind === 'phase' && now.note ? ' ' + now.note : ''
  return `OpenSpec: ${active.name} · ${where}${verb}${now.label}${count}`
}
