export type OpenSpecArtifact = {
  id: string
  outputPath: string
  /** `done`, `ready` (its inputs are done) or `blocked`. */
  status: string
  requires: string[]
}

export type OpenSpecSchema = { name: string; artifacts: string[] }

export type OpenSpecTask = { id: string; description: string; done: boolean }

export type OpenSpecChangeSummary = {
  name: string
  completedTasks: number
  totalTasks: number
  status: string
}

export type OpenSpecActiveChange = {
  name: string
  schemaName: string
  changeRoot: string
  artifacts: OpenSpecArtifact[]
  isPlanningComplete: boolean
  isComplete: boolean
  tasks: OpenSpecTask[]
  progress: { total: number; complete: number }
  applyState?: string
  nextSteps: string[]
}

export type OpenSpecSnapshot = {
  hasRoot: boolean
  changes: OpenSpecChangeSummary[]
  active?: OpenSpecActiveChange
  /** The project's schema, for drawing the steps before any change exists. */
  schema?: OpenSpecSchema
  error?: string
  refreshedAt: number
}

export type OpenSpecActivity = {
  /** The last OpenSpec skill or command run, e.g. `opsx:apply`. */
  skill?: string
  /** The change that skill, or the last file Claude wrote, named. */
  hintedChange?: string
  /** The artifact id Claude is writing in this turn. */
  writingArtifact?: string
}

declare module 'claude-code' {
  interface PluginState {
    'openspec-tui': {
      snapshot: OpenSpecSnapshot | null
      pinned: string | null
      activity: OpenSpecActivity
    }
  }
}
