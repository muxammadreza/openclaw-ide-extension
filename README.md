# openclaw-ide-extension

Full IDE support for [OpenClaw](https://openclaw.ai) config files (`openclaw.json`).

## Features

| Feature | Details |
|---|---|
| **Validation** | JSON Schema + semantic checks (plain-text secrets, bad cron, wrong port range, missing tokens, etc.) |
| **Autocomplete** | All enum fields, model IDs, channel options — driven by the exact schema of your installed openclaw version |
| **Hover docs** | Rich per-key documentation with links to the official docs |
| **Code actions** | Quick-fix: wrap plain-text secrets in `${ENV_VAR}`, fix ports, add missing provider prefix |
| **Snippets** | Channel configs, agent defaults, cron jobs, model entries |
| **Version-aware schema** | Detects your local `openclaw` installation and uses its exact schema |
| **Plugin-aware** | Discovers installed plugins and merges their schema contributions |
| **Status bar** | Shows current openclaw version, schema source, and plugin count |

## Schema discovery (priority order)

1. **Local install** — reads the schema bundled with your installed `openclaw` npm package (version-exact)
2. **Per-version cache** — schema cached in VS Code global storage after first discovery (offline support)
3. **Bundled fallback** — comprehensive schema shipped with this extension (used when openclaw is not installed)

## Plugin support

Third-party channels and plugins are handled automatically:

- If the plugin exposes a schema via `package.json` → `openclaw.schemaContributions`, it is merged at activation
- If the plugin ships an `openclaw-schema.json` or `schema.json`, it is merged
- Well-known plugins have hardcoded schemas: Matrix, Feishu, LINE, Nostr, Twitch, Zalo, Nextcloud Talk, Synology Chat, Tlon, WebChat, Mattermost, IRC, Microsoft Teams

## Commands

| Command | Description |
|---|---|
| `OpenClaw: Validate Config` | Run semantic validation on the active file |
| `OpenClaw: Refresh Schema` | Re-detect openclaw version and plugins, rebuild schema |
| `OpenClaw: Open Config File` | Open `~/.openclaw/openclaw.json` |
| `OpenClaw: Generate Config Skeleton` | Create a new config file with sensible defaults |
| `OpenClaw: Show Status` | Show version, package dir, config path, and loaded plugins |

## Settings

| Setting | Default | Description |
|---|---|---|
| `openclaw.validate` | `true` | Enable semantic validation |
| `openclaw.hoverDocs` | `true` | Enable hover documentation |
| `openclaw.binaryPath` | `""` | Override path to the `openclaw` binary |
| `openclaw.configPath` | `""` | Override path to `openclaw.json` |

## Installing

```sh
code --install-extension openclaw-ide-extension-1.0.0.vsix
```

Or search for **OpenClaw Config** in the VS Code Extensions panel.
