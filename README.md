# claude-mods

Open-source mods for [Claude Code](https://claude.com/claude-code): live panes, status lines and hooks, written as plugins of function hooks.

## Mods

| Mod | What it does |
| --- | --- |
| [openspec-tui](plugins/openspec-tui) | A live side pane for OpenSpec: the change's journey (New / Explore → Propose, split into the schema's artifacts → Apply → Verify → Sync & Archive), the task being worked on, and the stage of every active change |

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install openspec-tui --marketplace harikrishnan83/claude-mods
```

Answer `y` to add the marketplace, then choose a scope.

## Layout

```
.claude-plugin/marketplace.json   the marketplace: lists every mod
plugins/<mod>/                    one folder per mod (plugin.json, hooks, types, tests)
```

## Contributing

Issues and pull requests are welcome. Before opening a PR, run these on the mod you changed:

```sh
claude plugin validate ./plugins/<mod>
claude plugin test ./plugins/<mod>
```

## License

[MIT](LICENSE)
