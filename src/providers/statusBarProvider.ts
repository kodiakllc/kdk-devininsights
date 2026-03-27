import * as vscode from "vscode";
import { SessionInfo, TicketInfo } from "../types";

/**
 * Manages the VS Code status bar items that display live session metrics.
 * Shows: acceptance rate, active ticket, and session duration.
 */
export class StatusBarProvider implements vscode.Disposable {
  private metricsItem: vscode.StatusBarItem;
  private ticketItem: vscode.StatusBarItem;
  private trackingItem: vscode.StatusBarItem;
  private isPaused: boolean = false;

  constructor() {
    // Metrics display (leftmost)
    this.metricsItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      100
    );
    this.metricsItem.command = "kdkDevInsights.openDashboard";
    this.metricsItem.tooltip = "Click to open KDK DevInsights Dashboard";
    this.metricsItem.show();

    // Active ticket display
    this.ticketItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      99
    );
    this.ticketItem.command = "kdkDevInsights.associateTicket";
    this.ticketItem.tooltip = "Click to change ticket association";
    this.ticketItem.show();

    // Tracking state indicator
    this.trackingItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      98
    );
    this.trackingItem.show();

    // Initialize with defaults
    this.updateMetrics(0, 0, 0);
    this.updateTicket(null);
    this.updateTrackingState(false);
  }

  /**
   * Update the metrics display in the status bar.
   */
  updateMetrics(
    acceptanceRate: number,
    completionsAccepted: number,
    chatInteractions: number
  ): void {
    const ratePercent = Math.round(acceptanceRate * 100);
    const rateIcon = ratePercent >= 50 ? "$(check)" : ratePercent >= 25 ? "$(dash)" : "$(x)";

    this.metricsItem.text = `$(graph) ${rateIcon} ${ratePercent}% | $(code) ${completionsAccepted} | $(comment-discussion) ${chatInteractions}`;
    this.metricsItem.tooltip = [
      "KDK DevInsights - Click to open dashboard",
      `Acceptance Rate: ${ratePercent}%`,
      `Completions Accepted: ${completionsAccepted}`,
      `Chat Interactions: ${chatInteractions}`,
    ].join("\n");
  }

  /**
   * Update the active ticket display.
   */
  updateTicket(ticket: TicketInfo | null): void {
    if (ticket) {
      this.ticketItem.text = `$(bookmark) ${ticket.id}`;
      this.ticketItem.tooltip = [
        `Active Ticket: ${ticket.id}`,
        ticket.title ? `Title: ${ticket.title}` : "",
        ticket.url ? `URL: ${ticket.url}` : "",
        `Detected from: ${ticket.detectedFrom}`,
        "Click to change",
      ].filter(Boolean).join("\n");
      this.ticketItem.color = undefined;
    } else {
      this.ticketItem.text = "$(bookmark) No ticket";
      this.ticketItem.tooltip = "No ticket associated. Click to set one.";
      this.ticketItem.color = new vscode.ThemeColor("statusBar.debuggingForeground");
    }
  }

  /**
   * Update the tracking state indicator.
   */
  updateTrackingState(isPaused: boolean): void {
    this.isPaused = isPaused;
    if (isPaused) {
      this.trackingItem.text = "$(debug-pause) Paused";
      this.trackingItem.tooltip = "KDK DevInsights tracking is paused";
      this.trackingItem.backgroundColor = new vscode.ThemeColor("statusBarItem.warningBackground");
      this.trackingItem.command = "kdkDevInsights.resumeTracking";
    } else {
      this.trackingItem.text = "$(pulse) Tracking";
      this.trackingItem.tooltip = "KDK DevInsights is actively tracking";
      this.trackingItem.backgroundColor = undefined;
      this.trackingItem.command = "kdkDevInsights.pauseTracking";
    }
  }

  /**
   * Update the full session display from a session snapshot.
   */
  updateFromSession(session: SessionInfo): void {
    const total = session.completionsShown;
    const rate = total > 0 ? session.completionsAccepted / total : 0;
    this.updateMetrics(rate, session.completionsAccepted, session.chatPromptsSent);
  }

  dispose(): void {
    this.metricsItem.dispose();
    this.ticketItem.dispose();
    this.trackingItem.dispose();
  }
}
