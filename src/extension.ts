import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { DiagnosticsProvider } from './providers/diagnosticsProvider';
import { HoverProvider } from './providers/hoverProvider';
import { CompletionProvider } from './providers/completionProvider';
import { CodeActionProvider } from './providers/codeActionProvider';
import { OpenClawRuntime, RuntimeInfo } from './openclawRuntime';
import { SchemaManager, ResolvedSchema } from './schemaManager';

const OPENCLAW_JSON_SELECTOR: vscode.DocumentSelector = {
  language: 'jsonc',
  pattern: '**/openclaw.json',
};

// Status bar shows current openclaw version + schema source
let statusBar: vscode.StatusBarItem;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  // ── Core services ─────────────────────────────────────────────────────────
  const runtime = new OpenClawRuntime();
  const schemaManager = new SchemaManager(context);

  const diagnosticsCollection = vscode.languages.createDiagnosticCollection('openclaw');
  context.subscriptions.push(diagnosticsCollection);

  const diagnosticsProvider = new DiagnosticsProvider(diagnosticsCollection);
  const hoverProvider = new HoverProvider();
  const completionProvider = new CompletionProvider();
  const codeActionProvider = new CodeActionProvider(diagnosticsCollection);

  // ── Status bar ────────────────────────────────────────────────────────────
  statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBar.command = 'openclaw.showStatus';
  context.subscriptions.push(statusBar);

  // ── Language feature providers ────────────────────────────────────────────
  context.subscriptions.push(
    vscode.languages.registerHoverProvider(OPENCLAW_JSON_SELECTOR, hoverProvider),
    vscode.languages.registerCompletionItemProvider(
      OPENCLAW_JSON_SELECTOR,
      completionProvider,
      '"', ':', ' ',
    ),
    vscode.languages.registerCodeActionsProvider(
      OPENCLAW_JSON_SELECTOR,
      codeActionProvider,
      { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] },
    ),
  );

  // ── Document events ───────────────────────────────────────────────────────
  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument((doc) => {
      if (isOpenclawConfig(doc)) {
        diagnosticsProvider.validate(doc);
        showStatusBar(doc);
      }
    }),
    vscode.workspace.onDidChangeTextDocument((e) => {
      if (isOpenclawConfig(e.document)) {
        diagnosticsProvider.validate(e.document);
      }
    }),
    vscode.workspace.onDidCloseTextDocument((doc) => {
      diagnosticsCollection.delete(doc.uri);
    }),
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor && isOpenclawConfig(editor.document)) {
        showStatusBar(editor.document);
      } else {
        statusBar.hide();
      }
    }),
  );

  // ── Commands ──────────────────────────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand('openclaw.validateConfig', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || !isOpenclawConfig(editor.document)) {
        vscode.window.showWarningMessage('OpenClaw: No openclaw.json file is active.');
        return;
      }
      const count = await diagnosticsProvider.validate(editor.document);
      if (count === 0) {
        vscode.window.showInformationMessage('OpenClaw: Config is valid ✓');
      } else {
        vscode.window.showWarningMessage(
          `OpenClaw: Found ${count} issue${count === 1 ? '' : 's'}. Check the Problems panel.`,
        );
      }
    }),

    vscode.commands.registerCommand('openclaw.openConfig', async () => {
      const configPath = runtime.resolveConfigPath();
      if (fs.existsSync(configPath)) {
        const doc = await vscode.workspace.openTextDocument(configPath);
        await vscode.window.showTextDocument(doc);
      } else {
        const choice = await vscode.window.showInformationMessage(
          'OpenClaw: No config found at ~/.openclaw/openclaw.json. Create one?',
          'Create',
          'Cancel',
        );
        if (choice === 'Create') {
          vscode.commands.executeCommand('openclaw.generateSkeleton');
        }
      }
    }),

    vscode.commands.registerCommand('openclaw.generateSkeleton', async () => {
      const defaultUri = vscode.Uri.file(runtime.resolveConfigPath());
      const uri = await vscode.window.showSaveDialog({
        defaultUri,
        filters: { 'JSON5 Config': ['json'] },
        saveLabel: 'Create Config',
      });
      if (!uri) {
        return;
      }
      fs.mkdirSync(path.dirname(uri.fsPath), { recursive: true });
      fs.writeFileSync(uri.fsPath, generateSkeleton(), 'utf8');
      const doc = await vscode.workspace.openTextDocument(uri);
      await vscode.window.showTextDocument(doc);
      vscode.window.showInformationMessage('OpenClaw: Config skeleton created.');
    }),

    vscode.commands.registerCommand('openclaw.refreshSchema', async () => {
      schemaManager.clearCache();
      await refreshSchemaRegistration(runtime, schemaManager, context);
      vscode.window.showInformationMessage('OpenClaw: Schema refreshed.');
    }),

    vscode.commands.registerCommand('openclaw.showStatus', async () => {
      const info = await runtime.detect();
      if (!info) {
        vscode.window.showInformationMessage(
          'OpenClaw: No local openclaw installation detected. ' +
          'Install with: npm install -g openclaw@latest',
        );
        return;
      }
      const pluginList = info.plugins.length > 0
        ? info.plugins.map((p) => `  • ${p.id}@${p.version}`).join('\n')
        : '  (none)';
      vscode.window.showInformationMessage(
        `OpenClaw v${info.version}\n` +
        `Package: ${info.packageDir || 'unknown'}\n` +
        `Config:  ${info.configPath}\n` +
        `Plugins:\n${pluginList}`,
      );
    }),
  );

  // ── Initial schema bootstrap ──────────────────────────────────────────────
  // Run async so activation is fast; schema loads in the background
  refreshSchemaRegistration(runtime, schemaManager, context).catch(() => {
    // If schema refresh fails, VS Code still uses the bundled schema from
    // the jsonValidation contribution in package.json — no action needed.
  });

  // Re-detect and re-register schema when settings change (e.g. binaryPath updated)
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('openclaw')) {
        schemaManager.clearCache();
        refreshSchemaRegistration(runtime, schemaManager, context).catch(() => {});
      }
    }),
  );

  // Validate currently open openclaw.json files
  vscode.workspace.textDocuments.forEach((doc) => {
    if (isOpenclawConfig(doc)) {
      diagnosticsProvider.validate(doc);
      showStatusBar(doc);
    }
  });
}

export function deactivate(): void {
  // nothing beyond disposables
}

// ── Schema registration ───────────────────────────────────────────────────────

/**
 * Detect the runtime, resolve the correct schema (local install → cache → bundled),
 * write it to global storage, and register it with VS Code's JSON language service
 * so that validation/completion/hover all use the version-exact schema.
 */
async function refreshSchemaRegistration(
  runtime: OpenClawRuntime,
  schemaManager: SchemaManager,
  context: vscode.ExtensionContext,
): Promise<void> {
  const info = await runtime.detect();
  const resolved = await schemaManager.resolve(info);

  // Write merged schema (base + plugin contributions) to global storage
  const activeSchemaPath = schemaManager.writeActiveSchema(resolved.schema);

  // Register it with VS Code's JSON language service.
  // We update the workspace-level json.schemas setting so it takes effect
  // for openclaw.json files opened in any workspace.
  const jsonCfg = vscode.workspace.getConfiguration('json');
  const existing: JsonSchemaEntry[] = jsonCfg.get<JsonSchemaEntry[]>('schemas') ?? [];

  const fileMatch = ['**/openclaw.json', '*.openclaw.json'];
  const newEntry: JsonSchemaEntry = {
    fileMatch,
    url: vscode.Uri.file(activeSchemaPath).toString(),
  };

  // Replace any previous openclaw entry; keep everything else
  const filtered = existing.filter(
    (s) => !s.fileMatch?.some((m: string) => m.includes('openclaw.json')),
  );
  filtered.push(newEntry);

  try {
    await jsonCfg.update('schemas', filtered, vscode.ConfigurationTarget.Global);
  } catch {
    // In some environments (e.g. tests) this may be read-only; fall through gracefully
  }

  updateStatusBar(info, resolved);
}

// ── Status bar helpers ────────────────────────────────────────────────────────

function updateStatusBar(info: RuntimeInfo | null, resolved: ResolvedSchema): void {
  const sourceIcon =
    resolved.source === 'local-install' ? '$(check)' :
    resolved.source === 'cache'         ? '$(database)' :
    /* bundled */                         '$(package)';

  const versionLabel = info ? `v${info.version}` : 'bundled';
  const pluginCount = info?.plugins.length ?? 0;
  const pluginSuffix = pluginCount > 0 ? ` +${pluginCount}` : '';

  statusBar.text = `$(shield) OpenClaw ${versionLabel}${pluginSuffix} ${sourceIcon}`;
  statusBar.tooltip =
    `OpenClaw IDE Extension\n` +
    `Version: ${versionLabel}\n` +
    `Schema source: ${resolved.source}\n` +
    (pluginCount > 0 ? `Plugins merged: ${pluginCount}\n` : '') +
    `Click for details`;
}

function showStatusBar(doc: vscode.TextDocument): void {
  if (isOpenclawConfig(doc)) {
    statusBar.show();
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function isOpenclawConfig(doc: vscode.TextDocument): boolean {
  return path.basename(doc.fileName) === 'openclaw.json' && doc.languageId === 'jsonc';
}

function generateSkeleton(): string {
  return `{
  // OpenClaw configuration — https://docs.openclaw.ai/gateway/configuration
  // All fields are optional; OpenClaw uses safe defaults when omitted.

  agents: {
    defaults: {
      workspace: "~/.openclaw/workspace",
      model: {
        primary: "anthropic/claude-sonnet-4-6",
        fallbacks: ["openai/gpt-5-mini"],
      },
      timeoutSeconds: 600,
      maxConcurrent: 3,
    },
  },

  gateway: {
    port: 18789,
  },

  session: {
    dmScope: "per-channel-peer",
    reset: {
      mode: "daily",
      atHour: 4,
    },
  },

  channels: {
    // Add your channel integrations here.
    // Example — Telegram:
    // telegram: {
    //   botToken: "\${TELEGRAM_BOT_TOKEN}",
    //   dmPolicy: "pairing",
    // },
  },
}
`;
}

interface JsonSchemaEntry {
  fileMatch?: string[];
  url?: string;
  schema?: unknown;
}
