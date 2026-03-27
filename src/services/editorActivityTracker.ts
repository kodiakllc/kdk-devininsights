import * as vscode from "vscode";
import { EditorActivityMetadata, TelemetryEventType } from "../types";

/**
 * Tracks editor activity: file opens, saves, edit velocity,
 * active vs. idle time, and lines changed.
 */
export class EditorActivityTracker implements vscode.Disposable {
  private disposables: vscode.Disposable[] = [];
  private idleTimeoutMinutes: number;
  private idleTimer: NodeJS.Timeout | undefined;
  private lastActivityAt: number = Date.now();
  private isIdle: boolean = false;

  // Per-file tracking
  private fileMetrics: Map<string, {
    language: string;
    linesAdded: number;
    linesRemoved: number;
    charactersDelta: number;
    activeStartMs: number;
    totalActiveMs: number;
    lastLineCount: number;
  }> = new Map();

  // Event emitters
  private fileOpenedEmitter = new vscode.EventEmitter<EditorActivityMetadata>();
  public readonly onFileOpened = this.fileOpenedEmitter.event;

  private fileSavedEmitter = new vscode.EventEmitter<EditorActivityMetadata>();
  public readonly onFileSaved = this.fileSavedEmitter.event;

  private fileClosedEmitter = new vscode.EventEmitter<EditorActivityMetadata>();
  public readonly onFileClosed = this.fileClosedEmitter.event;

  private linesChangedEmitter = new vscode.EventEmitter<{
    language: string;
    linesAdded: number;
    linesRemoved: number;
    fileRelativePath: string;
  }>();
  public readonly onLinesChanged = this.linesChangedEmitter.event;

  private idleStartEmitter = new vscode.EventEmitter<void>();
  public readonly onIdleStart = this.idleStartEmitter.event;

  private idleEndEmitter = new vscode.EventEmitter<{ idleDurationMs: number }>();
  public readonly onIdleEnd = this.idleEndEmitter.event;

  constructor(idleTimeoutMinutes: number = 5) {
    this.idleTimeoutMinutes = idleTimeoutMinutes;
  }

  initialize(): void {
    // Track document opens
    this.disposables.push(
      vscode.workspace.onDidOpenTextDocument((doc) => {
        if (doc.uri.scheme !== "file") {
          return;
        }
        this.trackActivity();

        const relativePath = vscode.workspace.asRelativePath(doc.uri, false);
        this.fileMetrics.set(relativePath, {
          language: doc.languageId,
          linesAdded: 0,
          linesRemoved: 0,
          charactersDelta: 0,
          activeStartMs: Date.now(),
          totalActiveMs: 0,
          lastLineCount: doc.lineCount,
        });

        this.fileOpenedEmitter.fire({
          fileName: doc.fileName.split("/").pop() || doc.fileName,
          fileRelativePath: relativePath,
          language: doc.languageId,
          linesAdded: 0,
          linesRemoved: 0,
          activeTimeMs: 0,
          charactersDelta: 0,
        });
      })
    );

    // Track document changes (line-level tracking)
    this.disposables.push(
      vscode.workspace.onDidChangeTextDocument((event) => {
        if (event.document.uri.scheme !== "file") {
          return;
        }
        this.trackActivity();

        const relativePath = vscode.workspace.asRelativePath(event.document.uri, false);
        const metrics = this.fileMetrics.get(relativePath);
        if (!metrics) {
          return;
        }

        let addedLines = 0;
        let removedLines = 0;
        let charDelta = 0;

        for (const change of event.contentChanges) {
          const newLines = change.text.split("\n").length - 1;
          const oldLines = change.range.end.line - change.range.start.line;

          if (newLines > oldLines) {
            addedLines += (newLines - oldLines);
          } else if (oldLines > newLines) {
            removedLines += (oldLines - newLines);
          }

          charDelta += change.text.length - change.rangeLength;
        }

        metrics.linesAdded += addedLines;
        metrics.linesRemoved += removedLines;
        metrics.charactersDelta += charDelta;
        metrics.lastLineCount = event.document.lineCount;

        if (addedLines > 0 || removedLines > 0) {
          this.linesChangedEmitter.fire({
            language: metrics.language,
            linesAdded: addedLines,
            linesRemoved: removedLines,
            fileRelativePath: relativePath,
          });
        }
      })
    );

    // Track document saves
    this.disposables.push(
      vscode.workspace.onDidSaveTextDocument((doc) => {
        if (doc.uri.scheme !== "file") {
          return;
        }
        this.trackActivity();

        const relativePath = vscode.workspace.asRelativePath(doc.uri, false);
        const metrics = this.fileMetrics.get(relativePath);

        this.fileSavedEmitter.fire({
          fileName: doc.fileName.split("/").pop() || doc.fileName,
          fileRelativePath: relativePath,
          language: doc.languageId,
          linesAdded: metrics?.linesAdded || 0,
          linesRemoved: metrics?.linesRemoved || 0,
          activeTimeMs: metrics?.totalActiveMs || 0,
          charactersDelta: metrics?.charactersDelta || 0,
        });
      })
    );

    // Track document closes
    this.disposables.push(
      vscode.workspace.onDidCloseTextDocument((doc) => {
        if (doc.uri.scheme !== "file") {
          return;
        }
        const relativePath = vscode.workspace.asRelativePath(doc.uri, false);
        const metrics = this.fileMetrics.get(relativePath);
        if (metrics) {
          metrics.totalActiveMs += (Date.now() - metrics.activeStartMs);

          this.fileClosedEmitter.fire({
            fileName: doc.fileName.split("/").pop() || doc.fileName,
            fileRelativePath: relativePath,
            language: metrics.language,
            linesAdded: metrics.linesAdded,
            linesRemoved: metrics.linesRemoved,
            activeTimeMs: metrics.totalActiveMs,
            charactersDelta: metrics.charactersDelta,
          });

          this.fileMetrics.delete(relativePath);
        }
      })
    );

    // Track active editor changes (for active time calculation)
    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        this.trackActivity();
        // Update active time for previous file
        // (handled by tracking the switch)
      })
    );

    // Track typing activity for idle detection
    this.disposables.push(
      vscode.window.onDidChangeTextEditorSelection(() => {
        this.trackActivity();
      })
    );

    // Start idle detection timer
    this.resetIdleTimer();

    console.log("[KDK DevInsights] Editor activity tracker initialized");
  }

  /**
   * Record that the user is active (resets idle timer).
   */
  private trackActivity(): void {
    const now = Date.now();

    if (this.isIdle) {
      const idleDuration = now - this.lastActivityAt;
      this.isIdle = false;
      this.idleEndEmitter.fire({ idleDurationMs: idleDuration });
    }

    this.lastActivityAt = now;
    this.resetIdleTimer();
  }

  /**
   * Reset the idle detection timer.
   */
  private resetIdleTimer(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
    }

    this.idleTimer = setTimeout(() => {
      this.isIdle = true;
      this.idleStartEmitter.fire();
    }, this.idleTimeoutMinutes * 60 * 1000);
  }

  /**
   * Get current metrics for a specific file.
   */
  getFileMetrics(relativePath: string) {
    return this.fileMetrics.get(relativePath);
  }

  /**
   * Get aggregate metrics across all tracked files.
   */
  getAggregateMetrics() {
    let totalLinesAdded = 0;
    let totalLinesRemoved = 0;
    let totalCharsDelta = 0;
    const languageCounts: Record<string, number> = {};

    for (const [_, metrics] of this.fileMetrics) {
      totalLinesAdded += metrics.linesAdded;
      totalLinesRemoved += metrics.linesRemoved;
      totalCharsDelta += metrics.charactersDelta;
      languageCounts[metrics.language] = (languageCounts[metrics.language] || 0) + 1;
    }

    return {
      totalLinesAdded,
      totalLinesRemoved,
      totalCharsDelta,
      filesTracked: this.fileMetrics.size,
      languageCounts,
    };
  }

  updateConfig(idleTimeoutMinutes: number): void {
    this.idleTimeoutMinutes = idleTimeoutMinutes;
    this.resetIdleTimer();
  }

  dispose(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
    }
    this.fileOpenedEmitter.dispose();
    this.fileSavedEmitter.dispose();
    this.fileClosedEmitter.dispose();
    this.linesChangedEmitter.dispose();
    this.idleStartEmitter.dispose();
    this.idleEndEmitter.dispose();
    this.disposables.forEach((d) => d.dispose());
  }
}
