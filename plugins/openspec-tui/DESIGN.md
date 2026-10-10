# openspec-tui design system

The pane must stay readable on every theme: light, dark, colour-blind (daltonized) and ANSI. These rules are fixed. Change a token's theme key in `hooks/ui.tsx` if you need to, but don't style text outside them.

## Rules

1. **Every `Text` has an explicit theme color, set by a tone.** Text with no color takes the terminal's default foreground, which can come out faint on light themes. Draw text only through `tone(...)` from `hooks/ui.tsx`.
2. **Never use `dimColor`.** The terminal's faint style has no contrast guarantee and can fall below WCAG AA (4.5:1) on a light background. Show lower emphasis with the `meta` or `muted` tones, which use the theme's `subtle` and `inactive` colors.
3. **Never carry meaning by color alone.** Every state also has a glyph or a word: ✓ done, ● current, ✎ writing, ○ ready, · blocked, ▶ current task, ▸ followed change, ◆/◇ OpenSpec or other skill, "next", "needs …". The active tab is marked three ways: brackets, bold and color.
4. **The pane draws its own tabs.** It is a single pane, so Claude Code draws no tab row of its own (that row can't be styled). The first row is `1: [OpenSpec]  2: Skills`, made of `plain` Buttons with hotkeys `1` and `2`. An inactive tab uses `body`, not `muted`, so it stays readable.
5. **Theme keys only, never hex.** Then the person's own theme, including a custom one, decides the actual colors.

## Tones

| Tone | Theme key | Bold | Used for |
|---|---|---|---|
| `title` | `claude` | yes | Pane header, active tab |
| `heading` | `text` | yes | Section headings: Working on, Active changes, step groups, Other changes |
| `body` | `text` | | Normal rows: ready steps, open tasks, skills, `Schema:`, inactive tab |
| `meta` | `subtle` | | Secondary info: schema flow, Next:, why, counts, legend, progress bar |
| `muted` | `inactive` | | Steps not reachable yet (pending, blocked) |
| `current` | `claude` | yes | What is happening now: current step or task, the followed change |
| `done` | `success` | | Completed steps and tasks |
| `writing` | `warning` | yes | The artifact Claude is writing |
| `warn` | `warning` | | Apply is blocked |
| `error` | `error` | | CLI errors |
| `accent` | `suggestion` | yes | The schema name |
| `rule` | `subtle` | | `─` dividers and the `├─`/`└─` tree |

## Enforced

The test `every element follows the design system` in `tests/pane.test.tsx` draws both tabs. It fails if any `Text` has a color outside the tone table, or if any element sets `dimColor`.
