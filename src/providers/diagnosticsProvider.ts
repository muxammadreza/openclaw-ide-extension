import * as vscode from 'vscode';
import { parseConfig } from '../parser';

/**
 * Semantic diagnostics for openclaw.json beyond what JSON schema covers.
 * Checks things like: secret tokens stored in plain text, invalid cron
 * expressions, port conflicts, referential integrity between sections, etc.
 */
export class DiagnosticsProvider {
  constructor(private readonly collection: vscode.DiagnosticCollection) {}

  /** Validate a document and return the number of issues found. */
  async validate(doc: vscode.TextDocument): Promise<number> {
    const cfg = vscode.workspace.getConfiguration('openclaw');
    if (!cfg.get<boolean>('validate', true)) {
      this.collection.delete(doc.uri);
      return 0;
    }

    const parsed = parseConfig(doc.getText());
    if (!parsed.ok) {
      // Syntax errors are already shown by VS Code's built-in JSONC support
      this.collection.delete(doc.uri);
      return 0;
    }

    const diags: vscode.Diagnostic[] = [];
    const text = doc.getText();
    const lines = text.split('\n');

    const find = (key: string): vscode.Range | undefined =>
      findKeyRange(lines, key);

    const addWarn = (range: vscode.Range | undefined, msg: string, code: string) => {
      if (!range) {
        return;
      }
      const d = new vscode.Diagnostic(range, msg, vscode.DiagnosticSeverity.Warning);
      d.source = 'openclaw';
      d.code = code;
      diags.push(d);
    };

    const addHint = (range: vscode.Range | undefined, msg: string, code: string) => {
      if (!range) {
        return;
      }
      const d = new vscode.Diagnostic(range, msg, vscode.DiagnosticSeverity.Hint);
      d.source = 'openclaw';
      d.code = code;
      diags.push(d);
    };

    const config = parsed.value;

    // ── Plain-text secrets ──────────────────────────────────────────────────
    const secretFields = [
      { path: ['channels', 'telegram', 'botToken'], key: 'botToken' },
      { path: ['channels', 'discord', 'token'], key: 'token' },
      { path: ['channels', 'slack', 'botToken'], key: 'botToken' },
      { path: ['channels', 'slack', 'appToken'], key: 'appToken' },
      { path: ['channels', 'slack', 'signingSecret'], key: 'signingSecret' },
      { path: ['channels', 'mattermost', 'botToken'], key: 'botToken' },
      { path: ['models', 'openai', 'apiKey'], key: 'apiKey' },
      { path: ['models', 'anthropic', 'apiKey'], key: 'apiKey' },
      { path: ['models', 'google', 'apiKey'], key: 'apiKey' },
      { path: ['models', 'openrouter', 'apiKey'], key: 'apiKey' },
    ];

    for (const sf of secretFields) {
      const val = getNestedValue(config, sf.path);
      if (typeof val === 'string' && val && !val.startsWith('${')) {
        const range = find(sf.key);
        addWarn(
          range,
          `Secret "${sf.key}" is stored as plain text. ` +
          'Use an environment variable reference like "${ENV_VAR_NAME}" instead.',
          'secret-plaintext',
        );
      }
    }

    // ── Gateway port range ──────────────────────────────────────────────────
    const gatewayPort = getNestedValue(config, ['gateway', 'port']);
    if (typeof gatewayPort === 'number') {
      if (gatewayPort < 1024 && gatewayPort !== 0) {
        addWarn(
          find('port'),
          `Gateway port ${gatewayPort} is a privileged port (< 1024). ` +
          'Running without root privileges will fail.',
          'privileged-port',
        );
      }
    }

    // ── Cron expressions ───────────────────────────────────────────────────
    const cronJobs = getNestedValue(config, ['cron']);
    if (Array.isArray(cronJobs)) {
      for (const job of cronJobs) {
        if (job && typeof job.schedule === 'string') {
          const err = validateCronExpression(job.schedule);
          if (err) {
            const range = findStringValueRange(lines, job.schedule);
            addWarn(range, `Invalid cron expression "${job.schedule}": ${err}`, 'invalid-cron');
          }
        }
      }
    }

    // ── Telegram: webhookUrl requires botToken ──────────────────────────────
    const tg = getNestedValue(config, ['channels', 'telegram']);
    if (tg && typeof tg === 'object') {
      if (tg.webhookUrl && !tg.botToken && !tg.tokenFile) {
        addWarn(
          find('webhookUrl'),
          'Telegram webhookUrl is set but no botToken or tokenFile is configured.',
          'telegram-missing-token',
        );
      }
    }

    // ── Discord: guilds without requireMention in open groups ──────────────
    const discord = getNestedValue(config, ['channels', 'discord']);
    if (discord && typeof discord === 'object' && discord.guilds) {
      for (const [guildId, guild] of Object.entries(discord.guilds as Record<string, any>)) {
        if (guild && guild.requireMention === false) {
          const range = findStringValueRange(lines, guildId);
          addHint(
            range,
            `Guild "${guildId}": requireMention is false — the bot will reply to every message in this server.`,
            'discord-open-guild',
          );
        }
      }
    }

    // ── Slack: Socket Mode requires both botToken and appToken ──────────────
    const slack = getNestedValue(config, ['channels', 'slack']);
    if (slack && typeof slack === 'object') {
      const hasBot = slack.botToken && !slack.botToken.startsWith('${');
      const hasApp = slack.appToken && !slack.appToken.startsWith('${');
      const hasSigning = slack.signingSecret;
      if (hasBot && !hasApp && !hasSigning) {
        addWarn(
          find('slack'),
          'Slack Socket Mode requires both botToken and appToken. ' +
          'Add appToken (xapp-...) or signingSecret for HTTP mode.',
          'slack-missing-apptoken',
        );
      }
    }

    // ── WhatsApp: open DM policy without allowFrom ─────────────────────────
    const wa = getNestedValue(config, ['channels', 'whatsapp']);
    if (wa && typeof wa === 'object') {
      if (wa.dmPolicy === 'open' && (!wa.allowFrom || (wa.allowFrom as string[]).length === 0)) {
        addWarn(
          find('dmPolicy'),
          'WhatsApp dmPolicy is "open" but allowFrom is empty. ' +
          'Set allowFrom: ["*"] explicitly or use "pairing" for controlled access.',
          'whatsapp-open-no-allowlist',
        );
      }
    }

    // ── agents.defaults.model: warn if deprecated bare model ID ───────────
    const model = getNestedValue(config, ['agents', 'defaults', 'model']);
    if (typeof model === 'string' && !model.includes('/')) {
      addWarn(
        findStringValueRange(lines, model),
        `Model "${model}" is missing the provider prefix (e.g. "anthropic/${model}"). ` +
        'Bare model IDs without a provider are deprecated.',
        'model-missing-provider',
      );
    }

    // ── heartbeat.every: 0m disables; very short intervals waste tokens ────
    const heartbeatEvery = getNestedValue(config, ['agents', 'defaults', 'heartbeat', 'every']);
    if (typeof heartbeatEvery === 'string' && heartbeatEvery !== '0m') {
      const minutes = parseDurationToMinutes(heartbeatEvery);
      if (minutes !== null && minutes > 0 && minutes < 5) {
        addWarn(
          findStringValueRange(lines, heartbeatEvery),
          `Heartbeat interval "${heartbeatEvery}" is very short and will consume significant tokens. ` +
          'Consider 30m or longer.',
          'heartbeat-too-frequent',
        );
      }
    }

    // ── maxConcurrent: unreasonably high ───────────────────────────────────
    const maxConcurrent = getNestedValue(config, ['agents', 'defaults', 'maxConcurrent']);
    if (typeof maxConcurrent === 'number' && maxConcurrent > 20) {
      addWarn(
        find('maxConcurrent'),
        `maxConcurrent is ${maxConcurrent}, which is unusually high and may exhaust API rate limits.`,
        'high-maxconcurrent',
      );
    }

    // ── contextTokens: exceeds typical limits ─────────────────────────────
    const contextTokens = getNestedValue(config, ['agents', 'defaults', 'contextTokens']);
    if (typeof contextTokens === 'number' && contextTokens > 2_000_000) {
      addWarn(
        find('contextTokens'),
        `contextTokens is ${contextTokens.toLocaleString()}, which exceeds most providers' limits.`,
        'context-tokens-too-high',
      );
    }

    // ── iMessage: macOS only ───────────────────────────────────────────────
    const imessage = getNestedValue(config, ['channels', 'imessage']);
    if (imessage && typeof imessage === 'object' && process.platform !== 'darwin') {
      addHint(
        find('imessage'),
        'iMessage channel requires macOS. This config key will be ignored on non-macOS systems.',
        'imessage-non-macos',
      );
    }

    // ── BlueBubbles without server URL ────────────────────────────────────
    const bb = getNestedValue(config, ['channels', 'bluebubbles']);
    if (bb && typeof bb === 'object' && !bb.serverUrl) {
      addHint(
        find('bluebubbles'),
        'BlueBubbles channel is configured but no serverUrl is set. ' +
        'See https://docs.openclaw.ai/channels/bluebubbles for setup.',
        'bluebubbles-no-serverurl',
      );
    }

    this.collection.set(doc.uri, diags);
    return diags.length;
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function getNestedValue(obj: any, keys: string[]): any {
  let cur = obj;
  for (const k of keys) {
    if (cur == null || typeof cur !== 'object') {
      return undefined;
    }
    cur = cur[k];
  }
  return cur;
}

/** Find the line range of a JSON key in the document. */
function findKeyRange(lines: string[], key: string): vscode.Range | undefined {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`["']?${escaped}["']?\\s*:`);
  for (let i = 0; i < lines.length; i++) {
    const m = re.exec(lines[i]);
    if (m) {
      return new vscode.Range(i, m.index, i, m.index + m[0].length);
    }
  }
  return undefined;
}

/** Find the range of a string value in the document. */
function findStringValueRange(lines: string[], value: string): vscode.Range | undefined {
  const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`["']${escaped}["']`);
  for (let i = 0; i < lines.length; i++) {
    const m = re.exec(lines[i]);
    if (m) {
      return new vscode.Range(i, m.index, i, m.index + m[0].length);
    }
  }
  return undefined;
}

/** Basic cron expression validation (5 or 6 fields). */
function validateCronExpression(expr: string): string | null {
  const parts = expr.trim().split(/\s+/);
  if (parts.length < 5 || parts.length > 6) {
    return `expected 5 or 6 fields, got ${parts.length}`;
  }
  const ranges = [
    { name: 'minute', min: 0, max: 59 },
    { name: 'hour', min: 0, max: 23 },
    { name: 'day-of-month', min: 1, max: 31 },
    { name: 'month', min: 1, max: 12 },
    { name: 'day-of-week', min: 0, max: 7 },
  ];
  // Only validate the first 5 fields
  for (let i = 0; i < 5; i++) {
    const field = parts[i];
    if (field === '*' || field === '?') {
      continue;
    }
    // Allow step values like */5 or 1-5
    const stepMatch = /^(\*|\d+)\/(\d+)$/.exec(field);
    if (stepMatch) {
      const step = parseInt(stepMatch[2], 10);
      if (step < 1) {
        return `${ranges[i].name} step must be >= 1`;
      }
      continue;
    }
    const rangeMatch = /^(\d+)-(\d+)$/.exec(field);
    if (rangeMatch) {
      const lo = parseInt(rangeMatch[1], 10);
      const hi = parseInt(rangeMatch[2], 10);
      if (lo < ranges[i].min || hi > ranges[i].max || lo > hi) {
        return `${ranges[i].name} range ${lo}-${hi} is invalid (valid: ${ranges[i].min}-${ranges[i].max})`;
      }
      continue;
    }
    // Comma-separated list
    const nums = field.split(',');
    for (const n of nums) {
      const v = parseInt(n, 10);
      if (isNaN(v) || v < ranges[i].min || v > ranges[i].max) {
        return `${ranges[i].name} value "${n}" out of range (${ranges[i].min}-${ranges[i].max})`;
      }
    }
  }
  return null;
}

/** Parse a duration string like '30m', '1h', '90s' to minutes. Returns null if unparseable. */
function parseDurationToMinutes(s: string): number | null {
  const m = /^(\d+(?:\.\d+)?)(ms|s|m|h)$/.exec(s.trim());
  if (!m) {
    return null;
  }
  const val = parseFloat(m[1]);
  switch (m[2]) {
    case 'ms': return val / 60000;
    case 's': return val / 60;
    case 'm': return val;
    case 'h': return val * 60;
    default: return null;
  }
}
