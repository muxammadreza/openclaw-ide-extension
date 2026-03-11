import * as vscode from 'vscode';
import { getJsonPath, parseConfig } from '../parser';

/** Well-known model IDs for autocomplete suggestions.
 * Source: openclaw npm package model catalog (updated for v2026.3.x).
 */
const KNOWN_MODELS = [
  // Anthropic
  'anthropic/claude-opus-4-6',
  'anthropic/claude-sonnet-4-6',
  // OpenAI
  'openai/gpt-5.4',
  'openai/gpt-5.4-pro',
  'openai/gpt-5-mini',
  'openai/gpt-oss-120b',
  // Google
  'google/gemini-3.1-pro-preview',
  'google/gemini-3-flash-preview',
  'google/gemini-3.1-flash-lite-preview',
  // OpenRouter
  'openrouter/anthropic/claude-opus-4-6',
  'openrouter/openai/gpt-5.4',
  'openrouter/google/gemini-3.1-pro-preview',
  // Short aliases supported by openclaw
  'opus',
  'sonnet',
  'gpt',
  'gpt-mini',
  'gemini',
  'gemini-flash',
];

/** Completions for specific string-value fields. */
const VALUE_COMPLETIONS: Record<string, Array<{ label: string; detail?: string }>> = {
  dmPolicy: [
    { label: 'pairing', detail: 'Unknown senders get a one-time pairing code (default)' },
    { label: 'allowlist', detail: 'Only senders in allowFrom' },
    { label: 'open', detail: 'Accept all inbound DMs' },
    { label: 'disabled', detail: 'Ignore all inbound DMs' },
  ],
  groupPolicy: [
    { label: 'allowlist', detail: 'Only configured groups (default)' },
    { label: 'open', detail: 'Bypass group allowlists' },
    { label: 'disabled', detail: 'Block all group messages' },
  ],
  streaming: [
    { label: 'off', detail: 'Send complete reply when finished (default)' },
    { label: 'partial', detail: 'Live-edit the message as it streams' },
    { label: 'block', detail: 'Send chunks as they arrive' },
    { label: 'progress', detail: 'Send progress updates' },
  ],
  chunkMode: [
    { label: 'length', detail: 'Split by character length (default)' },
    { label: 'newline', detail: 'Split at newlines' },
  ],
  replyToMode: [
    { label: 'off', detail: 'Do not quote/reply-to inbound messages (default)' },
    { label: 'first', detail: 'Reply-to the first message in a run' },
    { label: 'all', detail: 'Reply-to every inbound message' },
  ],
  reactionNotifications: [
    { label: 'off', detail: 'No reaction notifications' },
    { label: 'own', detail: "Notify on reactions to the bot's messages (default)" },
    { label: 'all', detail: 'Notify on reactions to all messages' },
    { label: 'allowlist', detail: 'Notify only from users in reactionAllowlist' },
  ],
  'session.dmScope': [
    { label: 'per-channel-peer', detail: 'One session per sender per channel (default)' },
    { label: 'per-peer', detail: 'One session per sender identity' },
    { label: 'main', detail: 'Single global session' },
    { label: 'per-account-channel-peer', detail: 'One session per sender per channel per account' },
  ],
  'session.reset.mode': [
    { label: 'daily', detail: 'Reset sessions once per day at atHour (default)' },
    { label: 'idle', detail: 'Reset sessions after idleMinutes of inactivity' },
  ],
  'agents.defaults.thinkingDefault': [
    { label: 'off', detail: 'Disable extended reasoning' },
    { label: 'minimal', detail: 'Minimal reasoning (fastest)' },
    { label: 'low', detail: 'Low reasoning (fast, default)' },
    { label: 'medium', detail: 'Moderate reasoning' },
    { label: 'high', detail: 'Deep reasoning (slower, more tokens)' },
    { label: 'xhigh', detail: 'Extra-deep reasoning (slowest, most tokens)' },
    { label: 'adaptive', detail: 'Model chooses thinking depth' },
  ],
  'agents.defaults.bootstrapPromptTruncationWarning': [
    { label: 'once', detail: 'Warn once per unique truncation (default)' },
    { label: 'always', detail: 'Warn on every run when truncation exists' },
    { label: 'off', detail: 'Never inject truncation warnings' },
  ],
  'agents.defaults.timeFormat': [
    { label: 'auto', detail: 'Follow OS preference (default)' },
    { label: '12', detail: '12-hour clock' },
    { label: '24', detail: '24-hour clock' },
  ],
  'agents.defaults.verboseDefault': [
    { label: 'off', detail: 'Concise output (default)' },
    { label: 'on', detail: 'Verbose output' },
    { label: 'full', detail: 'Full verbose output including system prompt' },
  ],
  'agents.defaults.elevatedDefault': [
    { label: 'on', detail: 'Elevated tool access enabled by default' },
    { label: 'off', detail: 'Elevated tool access disabled by default' },
    { label: 'ask', detail: 'Prompt user for confirmation before elevated access' },
    { label: 'full', detail: 'Always elevated without confirmation' },
  ],
  'agents.defaults.compaction.mode': [
    { label: 'default', detail: 'Standard compaction (default)' },
    { label: 'safeguard', detail: 'Chunked summarization for very long histories' },
  ],
  'agents.defaults.compaction.identifierPolicy': [
    { label: 'strict', detail: 'Preserve opaque identifiers during summarization (default)' },
    { label: 'off', detail: 'No special identifier handling' },
    { label: 'custom', detail: 'Use identifierInstructions for custom guidance' },
  ],
  'agents.defaults.contextPruning.mode': [
    { label: 'off', detail: 'Disable context pruning (default)' },
    { label: 'cache-ttl', detail: 'Prune old tool results based on TTL' },
  ],
  'gateway.host': [
    { label: '127.0.0.1', detail: 'Localhost only (default, most secure)' },
    { label: '0.0.0.0', detail: 'All interfaces (needed for remote access)' },
  ],
  'logging.level': [
    { label: 'trace', detail: 'Most verbose tracing output' },
    { label: 'debug', detail: 'Verbose debug output' },
    { label: 'info', detail: 'Standard info logging (default)' },
    { label: 'warn', detail: 'Warnings and errors only' },
    { label: 'error', detail: 'Errors only' },
    { label: 'fatal', detail: 'Fatal errors only' },
    { label: 'silent', detail: 'No log output' },
  ],
  chatmode: [
    { label: 'oncall', detail: 'Respond on @mention (default)' },
    { label: 'onmessage', detail: 'Respond to every message' },
    { label: 'onchar', detail: 'Respond to messages starting with trigger prefix' },
  ],
  'channels.googlechat.typingIndicator': [
    { label: 'message', detail: 'Show typing via a temporary message' },
    { label: 'typing', detail: 'Show typing indicator' },
    { label: 'none', detail: 'No typing indicator' },
  ],
  'channels.discord.voice.tts.openai.voice': [
    { label: 'alloy', detail: 'Neutral, versatile (default)' },
    { label: 'echo', detail: 'Clear and direct' },
    { label: 'fable', detail: 'Warm and expressive' },
    { label: 'onyx', detail: 'Deep and authoritative' },
    { label: 'nova', detail: 'Bright and energetic' },
    { label: 'shimmer', detail: 'Soft and gentle' },
  ],
};

export class CompletionProvider implements vscode.CompletionItemProvider {
  provideCompletionItems(
    doc: vscode.TextDocument,
    position: vscode.Position,
  ): vscode.ProviderResult<vscode.CompletionItem[]> {
    const parsed = parseConfig(doc.getText());
    if (!parsed.ok) {
      return null;
    }

    const jsonPath = getJsonPath(doc, position);
    const lineText = doc.lineAt(position).text;
    const beforeCursor = lineText.slice(0, position.character);

    // Determine if we're inside a string value (after a colon)
    const inStringValue = /:\s*["']?$/.test(beforeCursor) || /:\s*["'][^"']*$/.test(beforeCursor);

    if (!inStringValue || !jsonPath) {
      return null;
    }

    // Get the leaf key name for simple lookups
    const leafKey = jsonPath.split('.').pop() ?? '';

    // Try full path, then just the leaf key
    const lookupKeys = [jsonPath, leafKey];

    // Model field completions
    if (leafKey === 'primary' || leafKey === 'model' || leafKey === 'fallbacks') {
      if (
        jsonPath.includes('model') ||
        jsonPath.includes('agent') ||
        jsonPath.includes('compaction') ||
        jsonPath.includes('imageModel') ||
        jsonPath.includes('pdfModel') ||
        jsonPath.includes('heartbeat')
      ) {
        return KNOWN_MODELS.map((m) => {
          const item = new vscode.CompletionItem(m, vscode.CompletionItemKind.Value);
          item.detail = 'OpenClaw model ID';
          return item;
        });
      }
    }

    for (const key of lookupKeys) {
      const opts = VALUE_COMPLETIONS[key];
      if (opts) {
        return opts.map(({ label, detail }) => {
          const item = new vscode.CompletionItem(`"${label}"`, vscode.CompletionItemKind.EnumMember);
          item.insertText = `"${label}"`;
          if (detail) {
            item.detail = detail;
          }
          return item;
        });
      }
    }

    return null;
  }
}
