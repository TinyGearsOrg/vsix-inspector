import * as vscode from 'vscode';
import { buildReport } from './analyzer/report';
import { renderReport } from './webview/report.html';

export function activate(context: vscode.ExtensionContext): void {
  const disposable = vscode.commands.registerCommand('vsixInspector.inspect', async (uri?: vscode.Uri) => {
    const targetUri = uri ?? (await pickVsixFile());
    if (!targetUri) {
      return;
    }

    let report;
    try {
      report = await buildReport(targetUri.fsPath);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      vscode.window.showErrorMessage(`Could not inspect VSIX: ${message}`);
      return;
    }

    const fileName = targetUri.fsPath.split(/[/\\]/).pop() ?? targetUri.fsPath;
    const panel = vscode.window.createWebviewPanel(
      'vsixInspector',
      `Inspect: ${fileName}`,
      vscode.ViewColumn.Active,
      {},
    );
    panel.webview.html = renderReport(report);
  });

  context.subscriptions.push(disposable);
}

export function deactivate(): void {}

async function pickVsixFile(): Promise<vscode.Uri | undefined> {
  const result = await vscode.window.showOpenDialog({
    canSelectMany: false,
    filters: { 'VSIX files': ['vsix'] },
  });
  return result?.[0];
}
