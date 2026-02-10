import * as vscode from 'vscode';
import { ICalEditorProvider } from './iCalEditorProvider';

export function activate(context: vscode.ExtensionContext) {
    // Register our custom editor provider
    context.subscriptions.push(ICalEditorProvider.register(context));

    // Register command to toggle text view (open as text)
    context.subscriptions.push(vscode.commands.registerCommand('marumasa.icalEditor.toggleText', (uri?: vscode.Uri) => {
        let resource = uri;
        if (!resource && vscode.window.tabGroups.activeTabGroup.activeTab?.input instanceof vscode.TabInputCustom) {
            resource = vscode.window.tabGroups.activeTabGroup.activeTab.input.uri;
        }

        if (resource && resource.toString().endsWith('.ics')) {
            // Open the same resource with the default text editor
            vscode.commands.executeCommand('vscode.openWith', resource, 'default', vscode.ViewColumn.Active);
        } else {
            vscode.window.showInformationMessage(vscode.l10n.t('openIcalFileMessage'));
        }
    }));
}
