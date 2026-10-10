# CLAUDE.md

Guidance for Claude Code when working in this repository.

## What this repo is

`claude-mods` is a Claude Code **plugin marketplace** of open-source *mods*: plugins built from **function hooks** that change Claude Code's own interface or behaviour (live panes, status lines, slash commands, hooks on tool calls). It is published as `intent-driven-dev/claude-mods` and registers under the marketplace name `claude-mods`.

Today it ships one mod:

- **`openspec-tui`**: a live side pane for [OpenSpec](https://github.com/Fission-AI/OpenSpec) spec-driven development. It shows where the followed change is in its journey (New / Explore → Propose, split into the schema's artifacts → Apply → Verify → Sync & Archive), which artifact Claude is writing, the task being implemented, and the stage of every active change. It also sets a status line.

For user-facing install, upgrade and usage instructions, see `README.md` and `plugins/openspec-tui/README.md`. Keep those as the source of truth for users. This file is for working on the code.

## Layout

```
.claude-plugin/marketplace.json        the marketplace: lists every mod and its version
plugins/<mod>/                         one folder per mod
  .claude-plugin/plugin.json           plugin manifest (name, version, "types")
  .claude-plugin/types/                laid down by Claude Code at load; gitignored, never edit
  hooks/hooks.json                     { "modules": ["./register.tsx"] }: the hook entry point
  hooks/register.tsx                   registers hooks, owns state atoms, renders the pane
  hooks/model.ts                       pure functions: CLI parsing, phase/step derivation
  hooks/ui.tsx                         the design-system kit: tones and `tone()`/`rule()`
  types/index.d.ts                     the state contract (PluginState augmentation)
  tests/                               `claude plugin test` suites + fixtures
  DESIGN.md                            the pane's colour/contrast rules (openspec-tui)
  README.md                            user docs for the mod
```

`openspec/` and `.claude/` at the root are local dev scaffolding and are gitignored. They are not part of any mod.

## Commands

Run these from the repo root, pointing at the mod you changed:

```sh
claude plugin validate ./plugins/openspec-tui   # manifest + static hook analysis
claude plugin test ./plugins/openspec-tui       # model and pane tests (terminal + desktop surfaces)
tsc -p ./plugins/openspec-tui                    # type-check; needs one load to lay .claude-plugin/types
claude --plugin-dir ./plugins/openspec-tui       # run it live; saving hot-reloads the mod
```

Run validate and test before every commit. Both must pass.

## How openspec-tui works

- **The data comes from the OpenSpec CLI only.** The pane never parses OpenSpec files itself, except to read the `schema:` line from `openspec/config.yaml` and each change's `.openspec.yaml`. It runs `openspec list|status|instructions apply|schemas --json` through `$.process.run`. Steps, artifact order and `applyRequires` all come from the schema, so custom schemas work without code changes. Never hardcode artifact names.
- **State** lives in typed atoms (`snapshot`, `pinned`, `activity`) declared in `types/index.d.ts` under `PluginState['openspec-tui']`. Add a key there before using a new atom.
- **Refreshing.** Hooks never refresh directly. They call `requestRefresh()`, which sets a dirty flag. The timers started in `session.start` (`TICK_MS` 400 ms tick, `POLL_MS` 10 s poll) run `tick($)` on session.start's own `$`, so no work outlives the hook dispatch that asked for it, and two refreshes never run at once. Keep it that way: an earlier version that refreshed inside hooks left archived changes on stale snapshots.
- **On a CLI error** the last good snapshot is kept, but the followed change stays only while the last good list still has it.
- **Hooks used:** `session.start` (register `/openspec-tui`, open the pane, start timers), `command.run` (the `/openspec-tui [<change>|auto]` command; typed `/opsx:*`/`openspec-*` commands), `tool.call` (the model invoking OpenSpec skills; `Write`/`Edit` under `openspec/changes/<name>/`; `openspec` in Bash), `turn.complete`, and `ui.render` for the `Pane` component.
- **Following a change:** pinned (via `/openspec-tui <name>`), else the change hinted by the last OpenSpec command or edit, else the most recently changed one (`chooseActive` in `model.ts`).

## Conventions

- **Keep logic pure and in `model.ts`.** `register.tsx` should only wire hooks, read and write state, and render. New derivation logic goes in `model.ts` with a unit test in `tests/model.test.ts`.
- **The design system is enforced by a test.** Draw every `Text` through `tone(...)` from `hooks/ui.tsx`. Use theme keys only (no hex), never `dimColor`, and never carry meaning by colour alone: pair each state with a glyph or a word. See `plugins/openspec-tui/DESIGN.md`. The test `every element follows the design system` fails on any violation.
- **Tests** use `claude-code/testing`. `tests/pane.test.tsx` builds a fake world (CLI output, files, host) with `on(...)` handlers and mounts the pane on both the `terminal` and `desktop` surfaces. Use the shared JSON in `tests/fixtures.ts`.
- **Code style:** match the existing code. Use short doc comments that say *why*, `const` arrow helpers, no semicolons, single quotes, 2-space indent.
- **Docs:** user-visible behaviour changes go in the mod's `README.md` (including the ASCII sample of the pane), and design changes go in `DESIGN.md`.

## Releasing a mod version

1. Bump `version` in `plugins/<mod>/.claude-plugin/plugin.json`.
2. Bump that mod's `version` **and** `metadata.version` in `.claude-plugin/marketplace.json` to match.
3. Commit as `<mod> <version>: <summary>`, with a bullet list of the changes in the body (see `git log` for examples).

Users pick up a release with `claude plugin marketplace update claude-mods` and then `claude plugin update <mod>@claude-mods`.

## Adding a new mod

Create `plugins/<mod>/` with the same shape as `openspec-tui` (manifest with `"types"`, `hooks/hooks.json` → `register.tsx`, `types/index.d.ts`, `tests/`, `README.md`, `tsconfig.json` extending `./.claude-plugin/types/tsconfig.json`). Then add an entry to `.claude-plugin/marketplace.json` and a row to the Mods table in the root `README.md`.

## Deferred work

- **Skills tab (openspec-tui):** a second pane tab that filed every skill used under the change and step it ran at. It was added in 0.3.0 and the pane's own tab row in 0.4.0. Both were removed in 0.5.0 because the tab didn't work reliably. Planned to return later. The old implementation is in git history (`36916ae`, `20dec68`).
