import * as vscode from "vscode";
import { DashboardPayload, WebviewMessage, ExtensionMessage } from "../types";

/**
 * Manages the webview panel that hosts the DevInsights dashboard.
 * Communicates with the React frontend via postMessage.
 */
export class DashboardPanel implements vscode.Disposable {
  private static currentPanel: DashboardPanel | undefined;
  private panel: vscode.WebviewPanel | undefined;
  private disposables: vscode.Disposable[] = [];
  private extensionUri: vscode.Uri;

  // Message handler callback
  private messageHandler: ((message: WebviewMessage) => void) | undefined;

  constructor(extensionUri: vscode.Uri) {
    this.extensionUri = extensionUri;
  }

  /**
   * Create or reveal the dashboard panel.
   */
  reveal(): void {
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.Beside);
      return;
    }

    this.panel = vscode.window.createWebviewPanel(
      "kdkDevInsights.dashboard",
      "KDK DevInsights",
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(this.extensionUri, "dist"),
          vscode.Uri.joinPath(this.extensionUri, "media"),
        ],
      }
    );

    this.panel.iconPath = vscode.Uri.joinPath(this.extensionUri, "media", "kdk-icon.svg");
    this.panel.webview.html = this.getWebviewContent();

    // Listen for messages from the webview
    this.panel.webview.onDidReceiveMessage(
      (message: WebviewMessage) => {
        if (this.messageHandler) {
          this.messageHandler(message);
        }
      },
      undefined,
      this.disposables
    );

    // Clean up on panel close
    this.panel.onDidDispose(
      () => {
        this.panel = undefined;
      },
      undefined,
      this.disposables
    );
  }

  /**
   * Send a message to the webview.
   */
  postMessage(message: ExtensionMessage): void {
    if (this.panel) {
      this.panel.webview.postMessage(message);
    }
  }

  /**
   * Set the handler for messages received from the webview.
   */
  onMessage(handler: (message: WebviewMessage) => void): void {
    this.messageHandler = handler;
  }

  /**
   * Update the dashboard with new data.
   */
  updateDashboard(data: DashboardPayload): void {
    this.postMessage({ type: "dashboardData", data });
  }

  isVisible(): boolean {
    return this.panel?.visible ?? false;
  }

  /**
   * Generate the HTML content for the webview.
   * This embeds the React dashboard with Material Design styling.
   */
  private getWebviewContent(): string {
    const webview = this.panel!.webview;
    const nonce = getNonce();

    // CSP for security
    const cspSource = webview.cspSource;

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="
    default-src 'none';
    style-src ${cspSource} 'unsafe-inline' https://fonts.googleapis.com;
    font-src https://fonts.gstatic.com;
    script-src 'nonce-${nonce}';
    img-src ${cspSource} data:;
  ">
  <link href="https://fonts.googleapis.com/css2?family=Roboto:wght@300;400;500;700&family=Roboto+Mono:wght@400;500&display=swap" rel="stylesheet">
  <title>KDK DevInsights</title>
  <style>
    :root {
      --md-primary: #1565C0;
      --md-primary-light: #1E88E5;
      --md-primary-dark: #0D47A1;
      --md-secondary: #00897B;
      --md-error: #D32F2F;
      --md-warning: #F57C00;
      --md-success: #388E3C;
      --md-surface: var(--vscode-editor-background, #1e1e1e);
      --md-on-surface: var(--vscode-editor-foreground, #cccccc);
      --md-surface-variant: var(--vscode-sideBar-background, #252526);
      --md-outline: var(--vscode-widget-border, #454545);
      --md-elevation-1: 0 1px 3px rgba(0,0,0,0.12), 0 1px 2px rgba(0,0,0,0.24);
      --md-elevation-2: 0 3px 6px rgba(0,0,0,0.16), 0 3px 6px rgba(0,0,0,0.23);
      --md-radius: 8px;
      --md-radius-sm: 4px;
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: 'Roboto', sans-serif;
      background: var(--md-surface);
      color: var(--md-on-surface);
      padding: 16px;
      line-height: 1.5;
    }

    .dashboard-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 20px;
      padding-bottom: 12px;
      border-bottom: 1px solid var(--md-outline);
    }

    .dashboard-header h1 {
      font-size: 20px;
      font-weight: 500;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .period-selector {
      display: flex;
      gap: 4px;
      background: var(--md-surface-variant);
      border-radius: var(--md-radius);
      padding: 2px;
    }

    .period-btn {
      padding: 6px 14px;
      border: none;
      background: transparent;
      color: var(--md-on-surface);
      border-radius: var(--md-radius-sm);
      cursor: pointer;
      font-family: 'Roboto', sans-serif;
      font-size: 13px;
      transition: background 0.2s;
    }

    .period-btn.active {
      background: var(--md-primary);
      color: white;
    }

    .period-btn:hover:not(.active) {
      background: rgba(255,255,255,0.06);
    }

    .metrics-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 12px;
      margin-bottom: 20px;
    }

    .metric-card {
      background: var(--md-surface-variant);
      border-radius: var(--md-radius);
      padding: 16px;
      box-shadow: var(--md-elevation-1);
      transition: box-shadow 0.2s;
    }

    .metric-card:hover {
      box-shadow: var(--md-elevation-2);
    }

    .metric-label {
      font-size: 11px;
      font-weight: 500;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: rgba(255,255,255,0.5);
      margin-bottom: 4px;
    }

    .metric-value {
      font-size: 28px;
      font-weight: 300;
      font-family: 'Roboto Mono', monospace;
    }

    .metric-value.positive { color: var(--md-success); }
    .metric-value.warning { color: var(--md-warning); }
    .metric-value.negative { color: var(--md-error); }

    .metric-subtitle {
      font-size: 12px;
      color: rgba(255,255,255,0.4);
      margin-top: 2px;
    }

    .section {
      margin-bottom: 20px;
    }

    .section-title {
      font-size: 14px;
      font-weight: 500;
      margin-bottom: 12px;
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .bar-chart {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .bar-row {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .bar-label {
      width: 80px;
      font-size: 12px;
      font-family: 'Roboto Mono', monospace;
      text-align: right;
      color: rgba(255,255,255,0.7);
      flex-shrink: 0;
    }

    .bar-track {
      flex: 1;
      height: 20px;
      background: rgba(255,255,255,0.04);
      border-radius: var(--md-radius-sm);
      overflow: hidden;
      position: relative;
    }

    .bar-fill {
      height: 100%;
      border-radius: var(--md-radius-sm);
      transition: width 0.6s cubic-bezier(0.4, 0, 0.2, 1);
      min-width: 2px;
    }

    .bar-fill.primary { background: var(--md-primary); }
    .bar-fill.secondary { background: var(--md-secondary); }

    .bar-value {
      width: 50px;
      font-size: 12px;
      font-family: 'Roboto Mono', monospace;
      color: rgba(255,255,255,0.6);
      flex-shrink: 0;
    }

    .ticket-table {
      width: 100%;
      border-collapse: collapse;
    }

    .ticket-table th {
      font-size: 11px;
      font-weight: 500;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: rgba(255,255,255,0.4);
      text-align: left;
      padding: 8px;
      border-bottom: 1px solid var(--md-outline);
    }

    .ticket-table td {
      font-size: 13px;
      padding: 8px;
      border-bottom: 1px solid rgba(255,255,255,0.04);
    }

    .ticket-table td.mono {
      font-family: 'Roboto Mono', monospace;
    }

    .ticket-link {
      color: var(--md-primary-light);
      text-decoration: none;
    }

    .ticket-link:hover {
      text-decoration: underline;
    }

    .event-log {
      max-height: 300px;
      overflow-y: auto;
      font-family: 'Roboto Mono', monospace;
      font-size: 11px;
      background: rgba(0,0,0,0.2);
      border-radius: var(--md-radius);
      padding: 8px;
    }

    .event-entry {
      padding: 3px 0;
      border-bottom: 1px solid rgba(255,255,255,0.03);
      display: flex;
      gap: 8px;
    }

    .event-time {
      color: rgba(255,255,255,0.3);
      flex-shrink: 0;
    }

    .event-type {
      color: var(--md-primary-light);
      flex-shrink: 0;
    }

    .event-detail {
      color: rgba(255,255,255,0.6);
    }

    .loading {
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 40px;
      color: rgba(255,255,255,0.4);
    }

    .loading-spinner {
      width: 24px;
      height: 24px;
      border: 2px solid rgba(255,255,255,0.1);
      border-top-color: var(--md-primary);
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
      margin-right: 12px;
    }

    @keyframes spin {
      to { transform: rotate(360deg); }
    }

    .roi-banner {
      background: linear-gradient(135deg, var(--md-primary-dark), var(--md-primary));
      border-radius: var(--md-radius);
      padding: 20px;
      margin-bottom: 20px;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    .roi-banner h2 {
      font-size: 14px;
      font-weight: 500;
      opacity: 0.8;
    }

    .roi-banner .big-number {
      font-size: 36px;
      font-weight: 300;
      font-family: 'Roboto Mono', monospace;
    }

    .roi-banner .unit {
      font-size: 14px;
      opacity: 0.7;
    }
  </style>
</head>
<body>
  <div id="root">
    <div class="loading">
      <div class="loading-spinner"></div>
      Loading DevInsights Dashboard...
    </div>
  </div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();

    // State management
    let dashboardData = null;
    let selectedPeriod = 'today';

    // Request initial data
    vscode.postMessage({ type: 'requestDashboardData', period: selectedPeriod });

    // Listen for messages from the extension
    window.addEventListener('message', (event) => {
      const message = event.data;

      switch (message.type) {
        case 'dashboardData':
          dashboardData = message.data;
          renderDashboard();
          break;
        case 'sessionUpdate':
          if (dashboardData) {
            dashboardData.currentSession = message.data;
            renderDashboard();
          }
          break;
        case 'error':
          document.getElementById('root').innerHTML =
            '<div class="loading" style="color: var(--md-error);">Error: ' + message.message + '</div>';
          break;
      }
    });

    function selectPeriod(period) {
      selectedPeriod = period;
      vscode.postMessage({ type: 'requestDashboardData', period });
    }

    function formatTime(ms) {
      if (ms < 60000) return Math.round(ms / 1000) + 's';
      if (ms < 3600000) return Math.round(ms / 60000) + 'm';
      return (ms / 3600000).toFixed(1) + 'h';
    }

    function formatHours(ms) {
      return (ms / 3600000).toFixed(1);
    }

    function renderDashboard() {
      if (!dashboardData) return;

      const d = dashboardData;
      const s = d.currentSession;
      const a = d.acceptance;
      const p = d.productivity;
      const r = d.roi;

      const acceptRate = Math.round(a.acceptanceRate * 100);
      const copilotRate = Math.round(p.copilotContributionRate * 100);
      const hoursSaved = formatHours(p.estimatedTimeSavedMs);

      // Determine color classes
      const acceptClass = acceptRate >= 40 ? 'positive' : acceptRate >= 20 ? 'warning' : 'negative';
      const copilotClass = copilotRate >= 30 ? 'positive' : copilotRate >= 15 ? 'warning' : 'negative';

      // Language breakdown bars
      const langBars = Object.entries(a.byLanguage || {})
        .sort((x, y) => y[1].accepted - x[1].accepted)
        .slice(0, 8)
        .map(([lang, stats]) => {
          const maxShown = Math.max(...Object.values(a.byLanguage || {}).map(s => s.shown));
          const width = maxShown > 0 ? (stats.shown / maxShown) * 100 : 0;
          const rate = Math.round(stats.rate * 100);
          return '<div class="bar-row">' +
            '<span class="bar-label">' + lang + '</span>' +
            '<div class="bar-track">' +
              '<div class="bar-fill primary" style="width:' + width + '%"></div>' +
            '</div>' +
            '<span class="bar-value">' + rate + '%</span>' +
          '</div>';
        }).join('');

      // Ticket table rows
      const ticketRows = (d.ticketBreakdown || []).slice(0, 10).map(t => {
        return '<tr>' +
          '<td class="mono"><a class="ticket-link" href="#">' + t.ticketId + '</a></td>' +
          '<td class="mono">' + formatTime(t.totalTimeMs) + '</td>' +
          '<td class="mono">' + t.completionsAccepted + '</td>' +
          '<td class="mono">' + t.chatInteractions + '</td>' +
          '<td class="mono">' + t.linesFromCopilot + '</td>' +
          '<td class="mono">' + t.commits + '</td>' +
          '<td class="mono">' + formatTime(t.estimatedTimeSavedMs) + '</td>' +
        '</tr>';
      }).join('');

      // Recent events
      const eventRows = (d.recentEvents || []).slice(0, 50).map(e => {
        const time = new Date(e.timestamp).toLocaleTimeString();
        const shortType = e.type.split('.').slice(-2).join('.');
        const detail = JSON.stringify(e.metadata).substring(0, 80);
        return '<div class="event-entry">' +
          '<span class="event-time">' + time + '</span>' +
          '<span class="event-type">' + shortType + '</span>' +
          '<span class="event-detail">' + detail + '</span>' +
        '</div>';
      }).join('');

      document.getElementById('root').innerHTML = '' +
        '<div class="dashboard-header">' +
          '<h1>KDK DevInsights</h1>' +
          '<div class="period-selector">' +
            ['today', 'week', 'month'].map(p =>
              '<button class="period-btn ' + (selectedPeriod === p ? 'active' : '') + '" ' +
              'onclick="selectPeriod(\\''+p+'\\')">'+p.charAt(0).toUpperCase()+p.slice(1)+'</button>'
            ).join('') +
          '</div>' +
        '</div>' +

        // ROI Banner
        '<div class="roi-banner">' +
          '<div>' +
            '<h2>Estimated Time Saved</h2>' +
            '<div class="big-number">' + hoursSaved + ' <span class="unit">hours</span></div>' +
          '</div>' +
          '<div style="text-align:right">' +
            '<h2>Copilot Contribution</h2>' +
            '<div class="big-number">' + copilotRate + '<span class="unit">%</span></div>' +
          '</div>' +
        '</div>' +

        // Metric Cards
        '<div class="metrics-grid">' +
          '<div class="metric-card">' +
            '<div class="metric-label">Acceptance Rate</div>' +
            '<div class="metric-value ' + acceptClass + '">' + acceptRate + '%</div>' +
            '<div class="metric-subtitle">' + a.totalAccepted + ' of ' + a.totalShown + ' suggestions</div>' +
          '</div>' +
          '<div class="metric-card">' +
            '<div class="metric-label">Completions Accepted</div>' +
            '<div class="metric-value">' + a.totalAccepted + '</div>' +
            '<div class="metric-subtitle">' + a.totalDismissed + ' dismissed</div>' +
          '</div>' +
          '<div class="metric-card">' +
            '<div class="metric-label">Chat Interactions</div>' +
            '<div class="metric-value">' + p.chatInteractions + '</div>' +
            '<div class="metric-subtitle">' + p.chatCodeAdopted + ' code blocks adopted</div>' +
          '</div>' +
          '<div class="metric-card">' +
            '<div class="metric-label">Lines from Copilot</div>' +
            '<div class="metric-value ' + copilotClass + '">' + p.linesFromCopilot + '</div>' +
            '<div class="metric-subtitle">of ' + (p.linesFromCopilot + p.linesWrittenByDev) + ' total</div>' +
          '</div>' +
          '<div class="metric-card">' +
            '<div class="metric-label">Active Coding Time</div>' +
            '<div class="metric-value">' + formatTime(p.totalActiveTimeMs) + '</div>' +
            '<div class="metric-subtitle">' + formatTime(p.totalCodingTimeMs) + ' coding</div>' +
          '</div>' +
          '<div class="metric-card">' +
            '<div class="metric-label">Avg Response Time</div>' +
            '<div class="metric-value">' + Math.round(a.avgResponseTimeMs) + '<span style="font-size:14px">ms</span></div>' +
            '<div class="metric-subtitle">completion latency</div>' +
          '</div>' +
        '</div>' +

        // Language Breakdown
        '<div class="section">' +
          '<div class="section-title">Acceptance Rate by Language</div>' +
          '<div class="bar-chart">' + (langBars || '<div style="color:rgba(255,255,255,0.3);font-size:13px;">No language data yet</div>') + '</div>' +
        '</div>' +

        // Ticket Breakdown
        '<div class="section">' +
          '<div class="section-title">Ticket / User Story Breakdown</div>' +
          (ticketRows ? (
            '<table class="ticket-table">' +
              '<thead><tr>' +
                '<th>Ticket</th><th>Time</th><th>Completions</th><th>Chat</th><th>AI Lines</th><th>Commits</th><th>Time Saved</th>' +
              '</tr></thead>' +
              '<tbody>' + ticketRows + '</tbody>' +
            '</table>'
          ) : '<div style="color:rgba(255,255,255,0.3);font-size:13px;">No ticket data yet. Associate a ticket via the command palette.</div>') +
        '</div>' +

        // Event Log
        '<div class="section">' +
          '<div class="section-title">Recent Events</div>' +
          '<div class="event-log">' +
            (eventRows || '<div style="color:rgba(255,255,255,0.3);">No events recorded yet</div>') +
          '</div>' +
        '</div>';
    }
  </script>
</body>
</html>`;
  }

  dispose(): void {
    this.panel?.dispose();
    this.disposables.forEach((d) => d.dispose());
  }
}

function getNonce(): string {
  let text = "";
  const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
