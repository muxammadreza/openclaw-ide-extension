import * as vscode from 'vscode';

/** Quick-fix code actions for openclaw diagnostics. */
export class CodeActionProvider implements vscode.CodeActionProvider {
  constructor(private readonly collection: vscode.DiagnosticCollection) {}

  provideCodeActions(
    doc: vscode.TextDocument,
    range: vscode.Range | vscode.Selection,
    context: vscode.CodeActionContext,
  ): vscode.ProviderResult<vscode.CodeAction[]> {
    const actions: vscode.CodeAction[] = [];

    for (const diag of context.diagnostics) {
      if (diag.source !== 'openclaw') {
        continue;
      }
      const code = diag.code as string | undefined;

      if (code === 'secret-plaintext') {
        // Offer to wrap the value in an env-var reference
        const lineText = doc.lineAt(diag.range.start.line).text;
        const valueMatch = /:\s*["']([^"']+)["']/.exec(lineText);
        if (valueMatch) {
          const raw = valueMatch[1];
          const envName = raw
            .replace(/[^A-Z0-9]/gi, '_')
            .toUpperCase();
          const fix = new vscode.CodeAction(
            `Replace with env-var reference "\${${envName}}"`,
            vscode.CodeActionKind.QuickFix,
          );
          fix.diagnostics = [diag];
          fix.edit = new vscode.WorkspaceEdit();
          // Replace only the value portion
          const valueStart = lineText.indexOf(valueMatch[1]);
          if (valueStart !== -1) {
            const replaceRange = new vscode.Range(
              diag.range.start.line, valueStart,
              diag.range.start.line, valueStart + raw.length,
            );
            fix.edit.replace(doc.uri, replaceRange, `\${${envName}}`);
          }
          actions.push(fix);
        }

        // Also offer an "Open Docs" action
        const docsAction = new vscode.CodeAction(
          'View: Using secrets safely in OpenClaw',
          vscode.CodeActionKind.Empty,
        );
        docsAction.command = {
          command: 'vscode.open',
          title: 'Open docs',
          arguments: [vscode.Uri.parse('https://docs.openclaw.ai/gateway/configuration')],
        };
        actions.push(docsAction);
      }

      if (code === 'privileged-port') {
        // Suggest changing to default port
        const fix = new vscode.CodeAction(
          'Change gateway port to 18789 (default)',
          vscode.CodeActionKind.QuickFix,
        );
        fix.diagnostics = [diag];
        fix.edit = new vscode.WorkspaceEdit();
        const lineText = doc.lineAt(diag.range.start.line).text;
        const portMatch = /:\s*(\d+)/.exec(lineText);
        if (portMatch) {
          const start = lineText.indexOf(portMatch[1]);
          fix.edit.replace(
            doc.uri,
            new vscode.Range(
              diag.range.start.line, start,
              diag.range.start.line, start + portMatch[1].length,
            ),
            '18789',
          );
          actions.push(fix);
        }
      }

      if (code === 'slack-missing-apptoken') {
        const hint = new vscode.CodeAction(
          'View: Slack Socket Mode setup',
          vscode.CodeActionKind.Empty,
        );
        hint.command = {
          command: 'vscode.open',
          title: 'Open docs',
          arguments: [vscode.Uri.parse('https://docs.openclaw.ai/channels/slack')],
        };
        actions.push(hint);
      }

      if (code === 'model-missing-provider') {
        // Suggest adding anthropic/ prefix as the most common case
        const lineText = doc.lineAt(diag.range.start.line).text;
        const valueMatch = /["']([^"'/]+)["']/.exec(lineText);
        if (valueMatch) {
          const bare = valueMatch[1];
          const fix = new vscode.CodeAction(
            `Add provider prefix: "anthropic/${bare}"`,
            vscode.CodeActionKind.QuickFix,
          );
          fix.diagnostics = [diag];
          fix.edit = new vscode.WorkspaceEdit();
          fix.edit.replace(doc.uri, diag.range, `"anthropic/${bare}"`);
          actions.push(fix);
        }
      }
    }

    return actions;
  }
}
