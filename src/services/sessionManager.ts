import * as vscode from "vscode";
import * as os from "os";
import { SessionInfo, TicketInfo } from "../types";
import { generateId } from "../utils/anonymize";

/**
 * Manages the lifecycle of a developer's coding session.
 * A "session" starts when the extension activates and ends when VS Code closes.
 * Idle periods are tracked separately to distinguish active vs. total time.
 */
export class SessionManager implements vscode.Disposable {
  private disposables: vscode.Disposable[] = [];
  private session: SessionInfo;
  private activeTicket: TicketInfo | null = null;
  private activeTimeStart: number;
  private accumulatedIdleMs: number = 0;

  // Event emitters
  private sessionUpdateEmitter = new vscode.EventEmitter<SessionInfo>();
  public readonly onSessionUpdate = this.sessionUpdateEmitter.event;

  private ticketChangeEmitter = new vscode.EventEmitter<TicketInfo | null>();
  public readonly onTicketChange = this.ticketChangeEmitter.event;

  constructor(
    private extensionVersion: string
  ) {
    const now = new Date().toISOString();
    this.activeTimeStart = Date.now();

    this.session = {
      sessionId: generateId(),
      startTime: now,
      userId: os.userInfo().username || "unknown",
      machineId: vscode.env.machineId,
      workspacePath: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || "",
      workspaceName: vscode.workspace.name || "untitled",
      vscodeVersion: vscode.version,
      extensionVersion: this.extensionVersion,
      os: `${os.platform()}-${os.arch()}`,
      totalActiveTimeMs: 0,
      totalIdleTimeMs: 0,
      completionsShown: 0,
      completionsAccepted: 0,
      completionsDismissed: 0,
      completionsPartiallyAccepted: 0,
      chatPromptsSent: 0,
      chatCodeInserted: 0,
      chatCodeCopied: 0,
      linesWrittenByDev: 0,
      linesAcceptedFromCopilot: 0,
      filesEdited: new Set<string>(),
      languagesUsed: new Set<string>(),
      branchesWorkedOn: new Set<string>(),
      ticketsWorkedOn: new Set<string>(),
      commits: 0,
    };
  }

  getSession(): SessionInfo {
    // Update active time before returning
    this.session.totalActiveTimeMs = Date.now() - this.activeTimeStart - this.accumulatedIdleMs;
    return { ...this.session };
  }

  getSessionId(): string {
    return this.session.sessionId;
  }

  getActiveTicket(): TicketInfo | null {
    return this.activeTicket;
  }

  // -----------------------------------------------------------------------
  // Metric Incrementers
  // -----------------------------------------------------------------------

  recordCompletionShown(): void {
    this.session.completionsShown++;
    this.emitUpdate();
  }

  recordCompletionAccepted(linesCount: number, language: string, filePath: string): void {
    this.session.completionsAccepted++;
    this.session.linesAcceptedFromCopilot += linesCount;
    this.session.languagesUsed.add(language);
    this.session.filesEdited.add(filePath);
    this.emitUpdate();
  }

  recordCompletionDismissed(): void {
    this.session.completionsDismissed++;
    this.emitUpdate();
  }

  recordChatPrompt(): void {
    this.session.chatPromptsSent++;
    this.emitUpdate();
  }

  recordChatCodeInserted(): void {
    this.session.chatCodeInserted++;
    this.emitUpdate();
  }

  recordChatCodeCopied(): void {
    this.session.chatCodeCopied++;
    this.emitUpdate();
  }

  recordLinesWrittenByDev(count: number): void {
    this.session.linesWrittenByDev += count;
    this.emitUpdate();
  }

  recordFileEdited(filePath: string, language: string): void {
    this.session.filesEdited.add(filePath);
    this.session.languagesUsed.add(language);
  }

  recordBranch(branchName: string): void {
    this.session.branchesWorkedOn.add(branchName);
  }

  recordCommit(): void {
    this.session.commits++;
    this.emitUpdate();
  }

  recordIdleStart(): void {
    // Nothing to do here; idle end will calculate the duration
  }

  recordIdleEnd(idleDurationMs: number): void {
    this.accumulatedIdleMs += idleDurationMs;
    this.session.totalIdleTimeMs += idleDurationMs;
    this.emitUpdate();
  }

  // -----------------------------------------------------------------------
  // Ticket Association
  // -----------------------------------------------------------------------

  associateTicket(ticket: TicketInfo): void {
    this.activeTicket = ticket;
    this.session.ticketsWorkedOn.add(ticket.id);
    this.ticketChangeEmitter.fire(ticket);
    this.emitUpdate();
  }

  clearTicket(): void {
    this.activeTicket = null;
    this.ticketChangeEmitter.fire(null);
    this.emitUpdate();
  }

  autoDetectTicket(tickets: TicketInfo[]): void {
    if (tickets.length > 0 && !this.activeTicket) {
      this.associateTicket(tickets[0]);
    }
  }

  // -----------------------------------------------------------------------
  // Session Lifecycle
  // -----------------------------------------------------------------------

  endSession(): SessionInfo {
    this.session.endTime = new Date().toISOString();
    this.session.totalActiveTimeMs = Date.now() - this.activeTimeStart - this.accumulatedIdleMs;
    return this.getSession();
  }

  /**
   * Get a JSON-serializable snapshot of the session
   * (converts Sets to arrays).
   */
  toJSON(): Record<string, unknown> {
    const session = this.getSession();
    return {
      ...session,
      filesEdited: Array.from(session.filesEdited),
      languagesUsed: Array.from(session.languagesUsed),
      branchesWorkedOn: Array.from(session.branchesWorkedOn),
      ticketsWorkedOn: Array.from(session.ticketsWorkedOn),
    };
  }

  /**
   * Calculate the acceptance rate for this session.
   */
  getAcceptanceRate(): number {
    const total = this.session.completionsShown;
    if (total === 0) {
      return 0;
    }
    return this.session.completionsAccepted / total;
  }

  /**
   * Estimate time saved based on accepted completions.
   * Uses a configurable multiplier (default: 55 seconds per accepted completion,
   * based on GitHub's published productivity research).
   */
  getEstimatedTimeSavedMs(secondsPerCompletion: number = 55): number {
    return this.session.completionsAccepted * secondsPerCompletion * 1000;
  }

  private emitUpdate(): void {
    this.sessionUpdateEmitter.fire(this.getSession());
  }

  dispose(): void {
    this.sessionUpdateEmitter.dispose();
    this.ticketChangeEmitter.dispose();
    this.disposables.forEach((d) => d.dispose());
  }
}
