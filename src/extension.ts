import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { DiagnosticsProvider } from './providers/diagnosticsProvider';
import { HoverProvider } from './providers/hoverProvider';
import { CompletionProvider } from './providers/completionProvider';
import { CodeActionProvider } from './providers/codeActionProvider';

const OPENCLAW_JSON_SELECTOR: vscode.DocumentSelector = {
  language: 'jsonc',
  pattern: '**/openclaw.json',
};

export function activate(context: vscode.ExtensionContext): void {
  const diagnosticsCollection = vscode.languages.createDiagnosticCollection('openclaw');
  context.subscriptions.push(diagnosticsCollection);

  const diagnosticsProvider = new DiagnosticsProvider(diagnosticsCollection);
  const hoverProvider = new HoverProvider();
  const completionProvider = new CompletionProvider();
  const codeActionProvider = new CodeActionProvider(diagnosticsCollection);

  // Register hover provider
  context.subscriptions.push(
    vscode.languages.registerHoverProvider(OPENCLAW_JSON_SELECTOR, hoverProvider),
  );

  // Register completion provider
  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(
      OPENCLAW_JSON_SELECTOR,
      completionProvider,
      '"', ':', ' ',
    ),
  );

  // Register code action provider
  context.subscriptions.push(
    vscode.languages.registerCodeActionsProvider(
      OPENCLAW_JSON_SELECTOR,
      codeActionProvider,
      { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] },
    ),
  );

  // Validate on open and change
  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument((doc) => {
      if (isOpenclawConfig(doc)) {
        diagnosticsProvider.validate(doc);
      }
    }),
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((event) => {
      if (isOpenclawConfig(event.document)) {
        diagnosticsProvider.validate(event.document);
      }
    }),
  );

  context.subscriptions.push(
    vscode.workspace.onDidCloseTextDocument((doc) => {
      diagnosticsCollection.delete(doc.uri);
    }),
  );

  // Validate all currently open openclaw.json files
  vscode.workspace.textDocuments.forEach((doc) => {
    if (isOpenclawConfig(doc)) {
      diagnosticsProvider.validate(doc);
    }
  });

  // Commands
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
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('openclaw.openConfig', async () => {
      const configPath = getDefaultConfigPath();
      if (configPath && fs.existsSync(configPath)) {
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
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('openclaw.generateSkeleton', async () => {
      const options: vscode.SaveDialogOptions = {
        defaultUri: vscode.Uri.file(getDefaultConfigPath() ?? 'openclaw.json'),
        filters: { 'JSON5 Config': ['json'] },
        saveLabel: 'Create Config',
      };
      const uri = await vscode.window.showSaveDialog(options);
      if (!uri) {
        return;
      }
      const skeleton = generateSkeleton();
      fs.mkdirSync(path.dirname(uri.fsPath), { recursive: true });
      fs.writeFileSync(uri.fsPath, skeleton, 'utf8');
      const doc = await vscode.workspace.openTextDocument(uri);
      await vscode.window.showTextDocument(doc);
      vscode.window.showInformationMessage('OpenClaw: Config skeleton created.');
    }),
  );
}

export function deactivate(): void {
  // nothing to clean up beyond disposables
}

function isOpenclawConfig(doc: vscode.TextDocument): boolean {
  return path.basename(doc.fileName) === 'openclaw.json' && doc.languageId === 'jsonc';
}

function getDefaultConfigPath(): string {
  const home = process.env['HOME'] ?? process.env['USERPROFILE'] ?? '';
  return path.join(home, '.openclaw', 'openclaw.json');
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
    //   botToken: "${TELEGRAM_BOT_TOKEN}",
    //   dmPolicy: "pairing",
    // },
  },
}
`;
}
