// @ts-check
const vscode = require('vscode');

let statusItem;
const log = vscode.window.createOutputChannel('Prompt Coder');

function ensureStatus() {
  if (!statusItem) {
    statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    statusItem.text = "$(rocket) Prompt Coder";
    statusItem.tooltip = "Prompt Coder status";
    statusItem.show();
  }
}
function showRunning(){ ensureStatus(); statusItem.text = "$(sync~spin) Prompt running…"; }
function showIdle(){ ensureStatus(); statusItem.text = "$(rocket) Prompt Coder"; }

module.exports = { log, ensureStatus, showRunning, showIdle };
