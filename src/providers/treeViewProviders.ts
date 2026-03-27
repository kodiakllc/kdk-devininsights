import * as vscode from "vscode";
import { SessionInfo, TicketInfo } from "../types";

/**
 * Tree view for the "Active Session" panel in the sidebar.
 */
export class ActiveSessionTreeProvider implements vscode.TreeDataProvider<SessionTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<SessionTreeItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private session: SessionInfo | null = null;

  update(session: SessionInfo): void {
    this.session = session;
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: SessionTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: SessionTreeItem): SessionTreeItem[] {
    if (!this.session) {
      return [new SessionTreeItem("No active session", "", "info")];
    }

    if (element) {
      return [];
    }

    const s = this.session;
    const rate = s.completionsShown > 0
      ? Math.round((s.completionsAccepted / s.completionsShown) * 100)
      : 0;
    const activeMinutes = Math.round(s.totalActiveTimeMs / 60000);
    const idleMinutes = Math.round(s.totalIdleTimeMs / 60000);

    return [
      new SessionTreeItem("Session ID", s.sessionId.substring(0, 8), "key"),
      new SessionTreeItem("Active Time", `${activeMinutes}m`, "watch"),
      new SessionTreeItem("Idle Time", `${idleMinutes}m`, "debug-pause"),
      new SessionTreeItem("Acceptance Rate", `${rate}%`, "graph"),
      new SessionTreeItem("Completions", `${s.completionsAccepted}/${s.completionsShown}`, "code"),
      new SessionTreeItem("Chat Prompts", `${s.chatPromptsSent}`, "comment-discussion"),
      new SessionTreeItem("Chat Code Inserted", `${s.chatCodeInserted}`, "insert"),
      new SessionTreeItem("Dev Lines Written", `${s.linesWrittenByDev}`, "edit"),
      new SessionTreeItem("Copilot Lines", `${s.linesAcceptedFromCopilot}`, "sparkle"),
      new SessionTreeItem("Files Edited", `${s.filesEdited.size}`, "file"),
      new SessionTreeItem("Languages", Array.from(s.languagesUsed).join(", ") || "none", "symbol-misc"),
      new SessionTreeItem("Commits", `${s.commits}`, "git-commit"),
    ];
  }

  dispose(): void {
    this._onDidChangeTreeData.dispose();
  }
}

/**
 * Tree view for the "Ticket Association" panel.
 */
export class TicketTreeProvider implements vscode.TreeDataProvider<SessionTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<SessionTreeItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private ticket: TicketInfo | null = null;
  private ticketsWorkedOn: Set<string> = new Set();

  updateTicket(ticket: TicketInfo | null): void {
    this.ticket = ticket;
    this._onDidChangeTreeData.fire(undefined);
  }

  updateTicketsWorkedOn(tickets: Set<string>): void {
    this.ticketsWorkedOn = tickets;
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: SessionTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: SessionTreeItem): SessionTreeItem[] {
    if (element) {
      return [];
    }

    const items: SessionTreeItem[] = [];

    if (this.ticket) {
      items.push(new SessionTreeItem("Active Ticket", this.ticket.id, "bookmark"));
      if (this.ticket.title) {
        items.push(new SessionTreeItem("Title", this.ticket.title, "info"));
      }
      items.push(new SessionTreeItem("Provider", this.ticket.provider, "server"));
      items.push(new SessionTreeItem("Detected From", this.ticket.detectedFrom, "search"));
      if (this.ticket.url) {
        const urlItem = new SessionTreeItem("Open in Browser", this.ticket.url, "link-external");
        urlItem.command = {
          command: "vscode.open",
          title: "Open Ticket",
          arguments: [vscode.Uri.parse(this.ticket.url)],
        };
        items.push(urlItem);
      }
    } else {
      items.push(new SessionTreeItem("No active ticket", "Click to set one", "bookmark"));
      items[0].command = {
        command: "kdkDevInsights.associateTicket",
        title: "Associate Ticket",
      };
    }

    if (this.ticketsWorkedOn.size > 0) {
      items.push(new SessionTreeItem(
        "All Tickets This Session",
        Array.from(this.ticketsWorkedOn).join(", "),
        "list-tree"
      ));
    }

    return items;
  }

  dispose(): void {
    this._onDidChangeTreeData.dispose();
  }
}

/**
 * A single item in the session tree view.
 */
class SessionTreeItem extends vscode.TreeItem {
  constructor(
    label: string,
    value: string,
    iconId: string
  ) {
    super(`${label}: ${value}`, vscode.TreeItemCollapsibleState.None);
    this.iconPath = new vscode.ThemeIcon(iconId);
    this.description = "";
  }
}
