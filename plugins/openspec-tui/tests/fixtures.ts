const ROOT = '/repo'
const CHANGE_ROOT = `${ROOT}/openspec/changes/add-dark-mode`

export const LIST = {
  changes: [
    { name: 'add-dark-mode', completedTasks: 1, totalTasks: 3, lastModified: '2026-10-08T16:12:40.616Z', status: 'in-progress' },
    { name: 'fix-login', completedTasks: 0, totalTasks: 0, lastModified: '2026-10-07T10:00:00.000Z', status: 'no-tasks' },
  ],
  root: { path: ROOT, source: 'nearest' },
}

export const NO_ROOT = { changes: [], root: null }

export const statusWith = (tasks: 'done' | 'ready') => ({
  changeName: 'add-dark-mode',
  schemaName: 'spec-driven',
  changeRoot: CHANGE_ROOT,
  isPlanningComplete: tasks === 'done',
  isComplete: false,
  nextSteps: ['Run openspec instructions tasks --change "add-dark-mode" --json before writing that artifact.'],
  artifacts: [
    { id: 'proposal', outputPath: 'proposal.md', status: 'done', requires: [] },
    { id: 'specs', outputPath: 'specs/**/*.md', status: 'done', requires: ['proposal'] },
    { id: 'design', outputPath: 'design.md', status: 'done', requires: ['proposal'] },
    { id: 'tasks', outputPath: 'tasks.md', status: tasks, requires: ['specs', 'design'] },
  ],
})

export const applyWith = (done: boolean[]) => ({
  changeName: 'add-dark-mode',
  progress: { total: done.length, complete: done.filter(Boolean).length, remaining: done.filter(d => !d).length },
  tasks: done.map((d, i) => ({ id: String(i + 1), description: `1.${i + 1} task ${i + 1}`, done: d, sourcePath: `${CHANGE_ROOT}/tasks.md`, line: i + 2 })),
  state: done.every(Boolean) ? 'all_done' : 'ready',
})

export { CHANGE_ROOT }
