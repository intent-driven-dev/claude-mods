// The pane's design system: every Text the plugin draws goes through `tone`,
// so each carries an explicit theme color and none is drawn dim. DESIGN.md
// gives the rules; tests/pane.test.tsx holds every drawn Text to them.

/** What a piece of text means, not how it looks. */
export type Tone =
  | 'title'
  | 'heading'
  | 'body'
  | 'meta'
  | 'muted'
  | 'current'
  | 'done'
  | 'writing'
  | 'warn'
  | 'error'
  | 'accent'
  | 'rule'

/** Theme keys only: they follow the person's theme (light, dark, daltonized, ANSI). */
export const TONES: Record<Tone, { color: string; bold?: true }> = {
  title: { color: 'claude', bold: true },
  heading: { color: 'text', bold: true },
  body: { color: 'text' },
  meta: { color: 'subtle' },
  muted: { color: 'inactive' },
  current: { color: 'claude', bold: true },
  done: { color: 'success' },
  writing: { color: 'warning', bold: true },
  warn: { color: 'warning' },
  error: { color: 'error' },
  accent: { color: 'suggestion', bold: true },
  rule: { color: 'subtle' },
}

export type View = 'journey' | 'skills'

export const TABS: { view: View; label: string; hotkey: string }[] = [
  { view: 'journey', label: 'OpenSpec', hotkey: '1' },
  { view: 'skills', label: 'Skills', hotkey: '2' },
]

type Elements = { Box: any; Text: any; Button: any }
type Wrap = 'wrap' | 'truncate-end'

/** The drawing kit for one render: the surface's elements, styled by tone only. */
export function kit({ Box, Text, Button }: Elements, width: number) {
  const tone = (t: Tone, children: unknown, wrap: Wrap = 'truncate-end') => (
    <Text color={TONES[t].color} bold={TONES[t].bold} wrap={wrap}>
      {children}
    </Text>
  )
  const rule = () => tone('rule', '─'.repeat(Math.min(width, 48)))

  /**
   * The pane's own tab row, drawn by the engine as `1: [OpenSpec]  2: Skills`.
   * The active tab differs three ways, never by color alone: brackets, bold
   * and the accent color.
   */
  const tabs = (active: View, onSelect: (view: View) => Promise<unknown>) => (
    <Box flexDirection="row">
      {TABS.flatMap(({ view, label, hotkey }, i) => {
        const isActive = view === active
        const tab = (
          <Button key={`tab-${view}`} plain hotkey={hotkey} onPress={() => void onSelect(view)}>
            {tone(isActive ? 'title' : 'body', isActive ? `[${label}]` : ` ${label} `)}
          </Button>
        )
        return i === 0 ? [tab] : [tone('body', '  '), tab]
      })}
    </Box>
  )

  return { Box, tone, rule, tabs }
}
