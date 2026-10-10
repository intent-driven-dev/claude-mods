# openspec-tui

A live side pane for [OpenSpec](https://github.com/Fission-AI/OpenSpec) inside Claude Code. It shows where your change is in its journey, which artifact Claude is writing, the task being implemented right now, and where every other active change stands.

```
1: [OpenSpec]  2: Skills
OpenSpec · add-dark-mode
Schema: spec-driven
  proposal → specs → design → tasks
────────────────────────────────────────
✓ New / Explore
✓ Propose  4/4
  ├─ ✓ Proposal
  ├─ ✓ Specs
  ├─ ✓ Design
  └─ ✓ Tasks
● Apply  4/9
    ███████████░░░░░░░░░░░░░
    … 2 done above
    ✓ 1.3 Add theme token
    ▶ 2.1 Wire toggle into settings
    ○ 2.2 Persist preference
○ Verify
○ Sync & Archive
────────────────────────────────────────
Next: /opsx:apply to work the tasks
────────────────────────────────────────
Working on
  ▸ add-dark-mode  ·  Apply
    from your last OpenSpec command or edit
    last command: /opsx:apply
────────────────────────────────────────
Active changes (3)
  ▸ add-dark-mode  ◑ Apply
    fix-login      ◔ Propose
    tidy-docs      ● Sync & Archive (ready)  [tdd]
  /openspec-tui <name> to follow another
```

## What it shows

- **The journey.** It starts with **New / Explore**, because exploring is optional and `/opsx:new` alone counts. Then comes **Propose**, then **Apply**, then **Verify**, and it ends with **Sync & Archive**, because `/opsx:sync` is optional before `/opsx:archive`.
- **The active schema.** The header names the followed change's schema and its artifact flow. A change can use a schema other than the project default (its `.openspec.yaml` says which); then the header adds `(project default: …)`, and in Active changes that change gets a `[schema]` tag. Nothing is hardcoded: the steps, the order, and which artifacts must be done before Apply (the schema's `applyRequires`) all come from the CLI.
- **Propose, split by your schema.** Each artifact the change's schema defines is a sub-step under Propose, in the schema's own order. The default `spec-driven` schema gives proposal, specs, design and tasks. Each artifact shows one of these marks:
  - `✓`: written.
  - `✎ writing…`: Claude is writing it now.
  - `● next`: the first one ready to write.
  - `○`: ready to write.
  - `· needs …`: blocked on other artifacts.
- **The task in progress.** During Apply, `▶` marks the first unchecked task in `tasks.md`. It moves as Claude ticks the boxes.
- **Working on.** Shows the change the pane follows and why it picked that one: you pinned it, your last OpenSpec command or edit named it, or it's the most recently changed.
- **Active changes.** Lists active changes only (never anything archived). It shows every change under `openspec/changes/` with its stage: `◔ Propose`, `◑ Apply n/m` or `● Sync & Archive (ready)`.
- **Status line.** Shows something like `OpenSpec: add-dark-mode · Propose › writing Design`. This helps on narrow terminals, where the pane does not dock.

## The Skills tab

The pane has two tabs, **OpenSpec** and **Skills**, drawn by the plugin itself. Press `1` or `2` while the pane is focused, or click a tab, to switch. In the **Skills** tab, every skill used in the session is filed under the change being followed and the step it was at when the skill ran. That covers OpenSpec skills and any others, whether you typed them as slash commands or Claude invoked them.

```
Skills · add-dark-mode
Last: tdd-intent-driven · add-dark-mode · Apply
────────────────────────────────────────
New / Explore
  ◆ opsx:new
Propose › Design
  ◆ opsx:continue ×2
Apply
  ◆ opsx:apply
  ◇ tdd-intent-driven ×3
────────────────────────────────────────
Other changes
  fix-login · 4 skill uses
────────────────────────────────────────
◆ OpenSpec skill   ◇ other skill
```

- **Steps:** they appear in the order you first reached them. While an artifact is being written or is next, the step is `Propose › <artifact>`.
- **Other changes:** each one collapses to a single line with its skill count.
- **Lifetime:** uses are kept for the session and survive the mod reloading. They are not kept across sessions.

## Requirements

- A Claude Code build with plugin function hooks (mods). It was built and tested on 2.1.294 and 2.1.295.
- The [OpenSpec CLI](https://github.com/Fission-AI/OpenSpec) on your `PATH` (`npm i -g @fission-ai/openspec`). It was tested with 1.14.0.
- A project initialised with `openspec init`.

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install openspec-tui --marketplace intent-driven-dev/claude-mods
```

> While the repository is private, installing needs GitHub access to it: your `gh` or git credentials must be able to read `intent-driven-dev/claude-mods`.

Answer `y` to add the marketplace, then pick a scope. The user scope is the default. The pane opens by itself in fullscreen mode when the terminal is at least 144 columns wide.

## Usage

| Command | What it does |
| --- | --- |
| `/openspec-tui` | Open (or focus) the pane at any width |
| `/openspec-tui <change>` | Pin the pane to one change |
| `/openspec-tui auto` | Follow the latest change again |
| `/openspec-tui skills` | Open the pane on the Skills tab |

The pane updates as you work:
- when an `/opsx:*` or `openspec-*` skill runs (typed by you or invoked by Claude);
- when Claude writes a file under `openspec/changes/<name>/`;
- when an `openspec` shell command runs;
- at the end of every turn;
- every 10 seconds, to catch edits made outside Claude.

## Design

Every color, weight and glyph follows [DESIGN.md](DESIGN.md), which is built for contrast on light and dark themes. A test enforces it.

## How it works

The pane never parses OpenSpec files itself. Its data comes from the CLI's JSON output:

| Command | What the pane uses |
| --- | --- |
| `openspec list --json` | every active change and its task counts |
| `openspec status --change <c> --json` | the schema's artifacts, their state and dependencies |
| `openspec instructions apply --change <c> --json` | the task list and progress |
| `openspec schemas --json` | the schema's artifacts before any change exists |

Because the data comes from the CLI, custom schemas work without any changes.

| File | Contents |
| --- | --- |
| `hooks/register.tsx` | hooks, refreshing, the pane |
| `hooks/model.ts` | pure functions: parsing, phase and step derivation |
| `types/index.d.ts` | the state contract |
| `tests/` | `claude plugin test` suites (model and pane, on the terminal and desktop surfaces) |

## Development

```sh
claude --plugin-dir ./plugins/openspec-tui   # run it from this folder; saves hot-reload
claude plugin validate ./plugins/openspec-tui
claude plugin test ./plugins/openspec-tui
tsc -p ./plugins/openspec-tui                 # after one load has laid .claude-plugin/types
```

## License

MIT
