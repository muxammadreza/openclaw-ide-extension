import * as vscode from 'vscode';
import { getWordAtPosition, getJsonPath, parseConfig } from '../parser';

/** Documentation for top-level and nested OpenClaw config keys. */
const DOCS: Record<string, string> = {
  // Root sections
  agents:
    '**agents** — Agent configuration.\n\n' +
    'Controls the AI agent runtime: default workspace, model selection, timeout, concurrency, heartbeat, compaction, and context pruning.\n\n' +
    '[Docs ↗](https://docs.openclaw.ai/gateway/configuration)',

  'agents.defaults':
    '**agents.defaults** — Default settings applied to every agent.\n\n' +
    'All fields here become the baseline for named agents in `agents.list[]`.',

  'agents.defaults.workspace':
    '**agents.defaults.workspace** `string`\n\n' +
    'Default workspace directory. The agent uses this as its working directory.\n\n' +
    '**Default:** `~/.openclaw/workspace`',

  'agents.defaults.model':
    '**agents.defaults.model** `string | { primary, fallbacks }`\n\n' +
    'Primary AI model and optional ordered failover list.\n\n' +
    '```json5\n' +
    'model: {\n' +
    '  primary: "anthropic/claude-sonnet-4-6",\n' +
    '  fallbacks: ["openai/gpt-5-mini"],\n' +
    '}\n' +
    '```\n\n' +
    '**Built-in aliases:** `opus`, `sonnet`, `gpt`, `gpt-mini`, `gemini`, `gemini-flash`',

  'agents.defaults.timeoutSeconds':
    '**agents.defaults.timeoutSeconds** `number`\n\n' +
    'Maximum seconds an agent run may take before being cancelled.\n\n' +
    '**Default:** `600`',

  'agents.defaults.maxConcurrent':
    '**agents.defaults.maxConcurrent** `number`\n\n' +
    'Maximum parallel agent runs across all sessions (each session is still serialized).\n\n' +
    '**Default:** `1`',

  'agents.defaults.thinkingDefault':
    '**agents.defaults.thinkingDefault** `"off" | "low" | "medium" | "high" | "adaptive"`\n\n' +
    'Default thinking depth for models that support extended reasoning (e.g. Anthropic Claude).\n\n' +
    '**Default:** `"low"`',

  'agents.defaults.heartbeat':
    '**agents.defaults.heartbeat** — Periodic autonomous agent runs.\n\n' +
    'The agent wakes up on the configured interval and runs a turn (optionally delivering output to a channel).\n\n' +
    '**Tip:** Set `every: "0m"` to disable.',

  'agents.defaults.compaction':
    '**agents.defaults.compaction** — Session history compaction.\n\n' +
    'Summarizes long session histories to stay within context windows. ' +
    '`safeguard` mode uses chunked summarization for very long histories.',

  'agents.defaults.contextPruning':
    '**agents.defaults.contextPruning** — In-memory tool result pruning.\n\n' +
    'Removes old tool results from the context sent to the LLM without modifying session history on disk. ' +
    'Use `cache-ttl` mode to enable time-based pruning.',

  // Channels
  channels:
    '**channels** — Messaging channel integrations.\n\n' +
    'Each sub-key (`whatsapp`, `telegram`, `discord`, `slack`, …) enables a channel. ' +
    'A channel starts automatically when its config section is present, unless `enabled: false` is set.\n\n' +
    '[Supported channels ↗](https://docs.openclaw.ai/channels)',

  'channels.defaults':
    '**channels.defaults** — Defaults applied to all channels.\n\n' +
    'Set `groupPolicy` and `heartbeat` display options that apply across all providers.',

  'channels.whatsapp':
    '**channels.whatsapp** — WhatsApp integration (Baileys Web).\n\n' +
    'Links via QR code scan. Run `openclaw channels add whatsapp` to pair.\n\n' +
    '[Setup ↗](https://docs.openclaw.ai/channels/whatsapp)',

  'channels.telegram':
    '**channels.telegram** — Telegram bot integration.\n\n' +
    'Create a bot with [@BotFather](https://t.me/BotFather) and paste the token here ' +
    '(or set `TELEGRAM_BOT_TOKEN` env var).\n\n' +
    '[Setup ↗](https://docs.openclaw.ai/channels/telegram)',

  'channels.discord':
    '**channels.discord** — Discord bot integration.\n\n' +
    'Create a bot at [discord.com/developers](https://discord.com/developers/applications) ' +
    'and set `DISCORD_BOT_TOKEN` (or paste the token here).\n\n' +
    '[Setup ↗](https://docs.openclaw.ai/channels/discord)',

  'channels.slack':
    '**channels.slack** — Slack app integration.\n\n' +
    'Requires a Slack app with Socket Mode enabled. Set `SLACK_BOT_TOKEN` + `SLACK_APP_TOKEN` ' +
    '(or use `signingSecret` for HTTP mode).\n\n' +
    '[Setup ↗](https://docs.openclaw.ai/channels/slack)',

  'channels.signal':
    '**channels.signal** — Signal integration.\n\n' +
    'Requires the signal-cli daemon to be running. ' +
    'Run `openclaw channels add signal` to link your Signal account.\n\n' +
    '[Setup ↗](https://docs.openclaw.ai/channels/signal)',

  'channels.googlechat':
    '**channels.googlechat** — Google Chat app integration.\n\n' +
    'Requires a Google Cloud service account with Chat API access.\n\n' +
    '[Setup ↗](https://docs.openclaw.ai/channels/googlechat)',

  'channels.mattermost':
    '**channels.mattermost** — Mattermost integration.\n\n' +
    'Requires the `@openclaw/mattermost` plugin: `openclaw plugins install @openclaw/mattermost`.\n\n' +
    '[Setup ↗](https://docs.openclaw.ai/channels/mattermost)',

  'channels.imessage':
    '**channels.imessage** — iMessage integration (macOS only).\n\n' +
    'Requires `imsg` CLI and Full Disk Access to the Messages database.\n\n' +
    '[Setup ↗](https://docs.openclaw.ai/channels/imessage)',

  'channels.bluebubbles':
    '**channels.bluebubbles** — BlueBubbles iMessage proxy.\n\n' +
    'Recommended iMessage path for macOS. Requires a running BlueBubbles server.\n\n' +
    '[Setup ↗](https://docs.openclaw.ai/channels/bluebubbles)',

  'channels.msteams':
    '**channels.msteams** — Microsoft Teams integration (extension-backed).\n\n' +
    '[Setup ↗](https://docs.openclaw.ai/channels/msteams)',

  'channels.irc':
    '**channels.irc** — IRC integration (extension-backed).\n\n' +
    '[Setup ↗](https://docs.openclaw.ai/channels/irc)',

  // Common channel fields
  dmPolicy:
    '**dmPolicy** `"pairing" | "allowlist" | "open" | "disabled"`\n\n' +
    '| Value | Behavior |\n|---|---|\n' +
    '| `"pairing"` | Unknown senders get a one-time code; owner must approve |\n' +
    '| `"allowlist"` | Only senders in `allowFrom` |\n' +
    '| `"open"` | Accept all inbound DMs (use `allowFrom: ["*"]`) |\n' +
    '| `"disabled"` | Ignore all inbound DMs |\n\n' +
    '**Default:** `"pairing"`',

  groupPolicy:
    '**groupPolicy** `"allowlist" | "open" | "disabled"`\n\n' +
    '| Value | Behavior |\n|---|---|\n' +
    '| `"allowlist"` | Only groups in the configured allowlist |\n' +
    '| `"open"` | Bypass group allowlists (mention-gating still applies) |\n' +
    '| `"disabled"` | Block all group/room messages |\n\n' +
    '**Default:** `"allowlist"`',

  allowFrom:
    '**allowFrom** `string[]`\n\n' +
    'Allowed sender identifiers. Format depends on channel:\n' +
    '- WhatsApp/Signal: phone numbers (`"+15555550123"`)\n' +
    '- Telegram: `"tg:123456789"` or `"@username"`\n' +
    '- Discord: user IDs (`"123456789012345678"`)\n' +
    '- Slack: user IDs (`"U123456"`)\n' +
    '- Use `"*"` to allow all senders',

  streaming:
    '**streaming** `"off" | "partial" | "block" | "progress"`\n\n' +
    '| Mode | Behavior |\n|---|---|\n' +
    '| `"off"` | Send complete reply when finished |\n' +
    '| `"partial"` | Live-edit the message as it streams |\n' +
    '| `"block"` | Send chunks as they arrive |\n' +
    '| `"progress"` | Send progress updates |\n\n' +
    '**Default:** `"off"`',

  historyLimit:
    '**historyLimit** `number`\n\nMax messages to include from chat history in context. Set `0` to disable history.\n\n**Default:** `50`',

  botToken:
    '**botToken** `string`\n\nBot authentication token. ' +
    '**Recommended:** Use an environment variable reference like `"${TELEGRAM_BOT_TOKEN}"` ' +
    'instead of pasting the token directly.',

  // Gateway
  gateway:
    '**gateway** — HTTP/WebSocket gateway server settings.\n\n' +
    'The gateway is the control plane that connects channels to the agent runtime.\n\n' +
    '[Docs ↗](https://docs.openclaw.ai/concepts/gateway)',

  'gateway.port':
    '**gateway.port** `number`\n\nHTTP/WebSocket listen port.\n\n**Default:** `18789`',

  'gateway.host':
    '**gateway.host** `string`\n\nBind address for the gateway server.\n\n**Default:** `"127.0.0.1"` (localhost only)',

  'gateway.tls':
    '**gateway.tls** — TLS/HTTPS configuration.\n\nProvide `cert` and `key` file paths to enable HTTPS.',

  'gateway.tailscale':
    '**gateway.tailscale** — Expose the gateway over Tailscale VPN.\n\n' +
    'Enables secure remote access without opening ports in your firewall.',

  // Session
  session:
    '**session** — Session lifecycle and maintenance settings.\n\n' +
    'Controls how sessions are scoped, reset, and cleaned up.',

  'session.dmScope':
    '**session.dmScope** `"main" | "per-peer" | "per-channel-peer" | "per-account-channel-peer"`\n\n' +
    'Session isolation granularity for DMs:\n' +
    '- `"main"`: single global session\n' +
    '- `"per-peer"`: one session per sender identity\n' +
    '- `"per-channel-peer"` *(default)*: one session per sender per channel\n' +
    '- `"per-account-channel-peer"`: one session per sender per channel per bot account',

  'session.reset':
    '**session.reset** — When to automatically reset session history.\n\n' +
    '`mode: "daily"` resets at `atHour` each day. `mode: "idle"` resets after `idleMinutes` of inactivity.',

  'session.maintenance':
    '**session.maintenance** — Disk-level session history management.\n\n' +
    'Prune old sessions and cap total disk usage.',

  // Models
  models:
    '**models** — AI model provider credentials.\n\n' +
    '**Recommended:** Use environment variables (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, etc.) ' +
    'instead of storing API keys here.\n\n' +
    '[Supported providers ↗](https://docs.openclaw.ai/concepts/models)',

  // Tools
  tools:
    '**tools** — Tool access control.\n\n' +
    'Controls which tools (exec, browser, read, write, media, canvas) are available to the agent.',

  'tools.elevated':
    '**tools.elevated** — Elevated/privileged tool access.\n\n' +
    'Use `allowFrom` to restrict which users can trigger elevated tools (shell exec, etc.).',

  // Skills
  skills:
    '**skills** — Skills configuration.\n\n' +
    'Skills are agent capabilities (search, git, docs, etc.). ' +
    'Add custom skill directories or configure bundled skills.',

  // Cron
  cron:
    '**cron** `array`\n\nScheduled agent runs.\n\n' +
    'Each entry runs a prompt on a cron schedule and optionally delivers output to a channel.\n\n' +
    '```json5\ncron: [\n  {\n    schedule: "0 9 * * 1-5",\n    prompt: "Daily briefing",\n    to: "+15555550123",\n  },\n]\n```',

  // Commands
  commands:
    '**commands** — Chat command handling.\n\n' +
    'Configure `/config`, `/restart`, `/debug`, and other chat commands. ' +
    'Enable `bash: true` to allow `!` shell commands (requires elevated access).',

  // Browser
  browser:
    '**browser** — Browser automation settings.\n\n' +
    'Configures Playwright-based browser automation for web browsing, screenshots, and form interaction.',

  // Logging
  logging:
    '**logging** — Log output configuration.\n\n' +
    'Set log level, file path, and console format.',

  // Identity
  identity:
    '**identity** — Bot identity (name, emoji, theme).\n\n' +
    'Controls how the bot presents itself in status messages.',

  // Hooks
  hooks:
    '**hooks** — Webhook and external integration hooks.\n\n' +
    'Configure incoming webhooks and Gmail polling.',

  // Auth
  auth:
    '**auth** — OAuth profile and API key management.\n\n' +
    'Named auth profiles for multi-provider setups.',

  // Operator
  operator:
    '**operator** — Operator/admin access.\n\n' +
    'List of users or channels with admin-level access to gateway commands.',

  // Bindings
  bindings:
    '**bindings** `array`\n\nPersistent routing and ACP bindings.\n\n' +
    'Route specific channels or peers to named agents or skill sets.',

  // Web (baileys)
  web:
    '**web** — WebSocket/web channel settings (used by WhatsApp/Baileys).\n\n' +
    'Controls heartbeat, reconnection backoff, and max reconnect attempts.',
};

export class HoverProvider implements vscode.HoverProvider {
  provideHover(
    doc: vscode.TextDocument,
    position: vscode.Position,
  ): vscode.ProviderResult<vscode.Hover> {
    const cfg = vscode.workspace.getConfiguration('openclaw');
    if (!cfg.get<boolean>('hoverDocs', true)) {
      return null;
    }

    const parsed = parseConfig(doc.getText());
    if (!parsed.ok) {
      return null;
    }

    // Try the full path first (e.g. "agents.defaults.model"), then progressively
    // shorter suffixes, then the bare key word.
    const jsonPath = getJsonPath(doc, position);
    const word = getWordAtPosition(doc, position);

    const candidates: string[] = [];
    if (jsonPath) {
      candidates.push(jsonPath);
      // Build suffix variants: "a.b.c" → also try "b.c", "c"
      const parts = jsonPath.split('.');
      for (let i = 1; i < parts.length; i++) {
        candidates.push(parts.slice(i).join('.'));
      }
    }
    if (word) {
      candidates.push(word);
    }

    for (const key of candidates) {
      if (DOCS[key]) {
        const md = new vscode.MarkdownString(DOCS[key]);
        md.isTrusted = true;
        return new vscode.Hover(md);
      }
    }

    return null;
  }
}
