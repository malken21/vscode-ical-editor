import * as vscode from 'vscode';
import * as path from 'path';

export class ICalEditorProvider implements vscode.CustomTextEditorProvider {

	public static register(context: vscode.ExtensionContext): vscode.Disposable {
		const provider = new ICalEditorProvider(context);
		const providerRegistration = vscode.window.registerCustomEditorProvider(ICalEditorProvider.viewType, provider);
		return providerRegistration;
	}

	private static readonly viewType = 'marumasa.icalEditor';

	constructor(
		private readonly context: vscode.ExtensionContext
	) { }

	/**
	 * Called when our custom editor is opened.
	 */
	public async resolveCustomTextEditor(
		document: vscode.TextDocument,
		webviewPanel: vscode.WebviewPanel,
		_token: vscode.CancellationToken
	): Promise<void> {
		// Setup initial content for the webview
		webviewPanel.webview.options = {
			enableScripts: true,
            localResourceRoots: [
                vscode.Uri.file(path.join(this.context.extensionPath, 'media'))
            ]
		};
		webviewPanel.webview.html = this.getHtmlForWebview(webviewPanel.webview);

		function updateWebview() {
            console.log('Sending update message to webview, text length:', document.getText().length);
			webviewPanel.webview.postMessage({
				type: 'update',
				text: document.getText(),
			});
		}

		// Hook up event handlers so that we can synchronize the webview with the text document.
		//
		// The text document acts as our model. The webview is the view.
		//
		// 1. Update the webview when the document changes (e.g. if edited in text editor)
		const changeDocumentSubscription = vscode.workspace.onDidChangeTextDocument(e => {
			if (e.document.uri.toString() === document.uri.toString()) {
				updateWebview();
			}
		});

		// 2. Updates from the webview (e.g. user edits in calendar)
		webviewPanel.webview.onDidReceiveMessage(e => {
			switch (e.type) {
				case 'ready':
					updateWebview();
					return;
				case 'update':
                    // Replace the entire document with the new content from the calendar
					this.updateTextDocument(document, e.text);
					return;
			}
		});

		// Make sure we get rid of the listener when our editor is closed.
		webviewPanel.onDidDispose(() => {
			changeDocumentSubscription.dispose();
		});
	}

	/**
	 * Get the static html used for the editor webviews.
	 */
	private getHtmlForWebview(webview: vscode.Webview): string {
		// Local path to script and css for the webview
		const scriptUri = webview.asWebviewUri(vscode.Uri.file(
			path.join(this.context.extensionPath, 'media', 'ical-editor.js')
		));

		const styleUri = webview.asWebviewUri(vscode.Uri.file(
			path.join(this.context.extensionPath, 'media', 'ical-editor.css')
		));

        // Use CDN for libraries for now (ensure CSP allows it)
        // In a real production extension, these should be bundled.
        const fullCalendarJs = 'https://cdn.jsdelivr.net/npm/fullcalendar@6.1.10/index.global.min.js';
        const iCalJs = 'https://cdnjs.cloudflare.com/ajax/libs/ical.js/1.5.0/ical.min.js';
        const fontAwesomeCss = 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css';

		return `
			<!DOCTYPE html>
			<html lang="ja">
			<head>
				<meta charset="UTF-8">
				<meta name="viewport" content="width=device-width, initial-scale=1.0">
                <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} https: data:; script-src ${webview.cspSource} https: 'unsafe-inline' 'unsafe-eval'; style-src ${webview.cspSource} https: 'unsafe-inline'; font-src https: data:;">
                
				<link href="${styleUri}" rel="stylesheet" />
                <link href="${fontAwesomeCss}" rel="stylesheet" />
                
                <script src="${fullCalendarJs}"></script>
                <script src="${iCalJs}"></script>

				<title>iCalendar Editor</title>
			</head>
			<body>
				<div class="app-container">
                    <header class="app-header">
                        <h1><i class="fa-solid fa-calendar-days"></i> iCalendar Editor</h1>
                        <!-- Actions like import/export are less relevant here as it's a document editor, 
                             but we might want 'Refresh' or specific Calendar view toggles -->
                    </header>
                    
                    <main class="calendar-container">
                        <div id="calendar"></div>
                    </main>
                </div>

                <!-- Event Modal (Same structure) -->
                <div id="eventModal" class="modal">
                    <div class="modal-content">
                        <div class="modal-header">
                            <h2 id="modalTitle">イベント編集</h2>
                            <span class="close">&times;</span>
                        </div>
                        <div class="modal-body">
                            <form id="eventForm">
                                <div class="form-group">
                                    <label for="eventTitle">タイトル</label>
                                    <input type="text" id="eventTitle" required>
                                </div>
                                <div class="form-group row">
                                    <div class="col">
                                        <label for="startDate">開始日時</label>
                                        <input type="datetime-local" id="startDate" required>
                                    </div>
                                    <div class="col">
                                        <label for="endDate">終了日時</label>
                                        <input type="datetime-local" id="endDate" required>
                                    </div>
                                </div>
                                <div class="form-group">
                                    <label for="eventLocation">場所</label>
                                    <input type="text" id="eventLocation">
                                </div>
                                <div class="form-group">
                                    <label for="eventDescription">説明</label>
                                    <textarea id="eventDescription" rows="3"></textarea>
                                </div>
                                <div class="form-actions">
                                    <button type="button" id="deleteEventBtn" class="btn btn-danger" style="display: none;">削除</button>
                                    <div class="right-actions">
                                        <button type="button" class="btn btn-secondary cancel-btn">キャンセル</button>
                                        <button type="submit" class="btn btn-primary submit-btn">保存</button>
                                    </div>
                                </div>
                            </form>
                        </div>
                    </div>
                </div>

				<script src="${scriptUri}"></script>
			</body>
			</html>`;
	}

	/**
	 * Write out the json to a document.
	 */
	private updateTextDocument(document: vscode.TextDocument, text: string) {
		const edit = new vscode.WorkspaceEdit();

		// Just replace the entire document every time for this simple example.
		// A more complete extension should compute minimal edits.
		edit.replace(
			document.uri,
			new vscode.Range(0, 0, document.lineCount, 0),
			text
		);

		return vscode.workspace.applyEdit(edit);
	}
}
