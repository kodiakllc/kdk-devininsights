import * as vscode from "vscode";
import * as os from "os";
import {
  TelemetryEvent,
  TelemetryEventType,
  EventContext,
  DevInsightsConfig,
} from "../types";
import { generateId, hashValue, anonymizeFilePath } from "../utils/anonymize";
import { GHPushService } from "../services/ghPushService";

/**
 * Collects, batches, and dispatches telemetry events.
 *
 * Primary backend:  GHPushService  (pushes to GHE via `gh` CLI)
 * Fallback:         Local JSON files in extension storage
 *
 * Events are buffered in memory and flushed periodically or when the
 * buffer reaches maxBatchSize.
 */
export class TelemetryCollector implements vscode.Disposable {
  private disposables: vscode.Disposable[] = [];
  private eventBuffer: TelemetryEvent[] = [];
  private flushTimer: NodeJS.Timeout | undefined;
  private config: DevInsightsConfig;
  private sessionId: string;
  private isPaused: boolean = false;
  private localStorageUri: vscode.Uri;
  private ghPushService: GHPushService | null = null;

  // Stats
  private totalEventsSent: number = 0;
  private totalEventsDropped: number = 0;
  private lastFlushTime: number = 0;

  // Emitters
  private flushEmitter = new vscode.EventEmitter<{ count: number; success: boolean }>();
  public readonly onFlush = this.flushEmitter.event;

  constructor(
    config: DevInsightsConfig,
    sessionId: string,
    storageUri: vscode.Uri,
    ghPushService?: GHPushService
  ) {
    this.config = config;
    this.sessionId = sessionId;
    this.localStorageUri = config.localStoragePath
      ? vscode.Uri.file(config.localStoragePath)
      : vscode.Uri.joinPath(storageUri, "telemetry-buffer");

    if (ghPushService) {
      this.ghPushService = ghPushService;
    }

    this.startFlushTimer();
  }

  /**
   * Record a telemetry event. Buffered until flush.
   */
  record(
    type: TelemetryEventType,
    metadata: Record<string, unknown>,
    contextOverrides?: Partial<EventContext>
  ): void {
    if (this.isPaused || !this.config.enabled) {
      return;
    }

    const event: TelemetryEvent = {
      id: generateId(),
      type,
      timestamp: new Date().toISOString(),
      sessionId: this.sessionId,
      userId: this.config.anonymizeUserData
        ? hashValue(os.userInfo().username)
        : os.userInfo().username,
      enterpriseId: this.config.enterpriseId,
      teamId: this.config.teamId,
      workspaceId: vscode.workspace.name || "",
      metadata: this.sanitizeMetadata(metadata),
      context: this.buildContext(contextOverrides),
    };

    this.eventBuffer.push(event);

    // Force flush if buffer is full
    if (this.eventBuffer.length >= this.config.maxBatchSize) {
      this.flush();
    }
  }

  /**
   * Flush buffered events.
   *
   * Priority:
   *   1. gh push to GHE (if available)
   *   2. Local file storage (always works)
   */
  async flush(): Promise<void> {
    if (this.eventBuffer.length === 0) {
      return;
    }

    const batch = [...this.eventBuffer];
    this.eventBuffer = [];

    let success = false;

    // Try GH push first
    if (this.ghPushService?.isAvailable()) {
      try {
        success = await this.ghPushService.pushEvents(batch);
      } catch (err) {
        console.warn("[KDK DevInsights] GH push failed, falling back to local storage:", err);
      }
    }

    // Try HTTP endpoint if configured and GH push didn't work
    if (!success && this.config.telemetryEndpoint) {
      try {
        await this.sendToEndpoint(batch);
        success = true;
      } catch (err) {
        console.warn("[KDK DevInsights] HTTP endpoint failed:", err);
      }
    }

    // Always write to local storage as a backup
    try {
      await this.writeToLocalStorage(batch);
      if (!success) {
        success = true; // At least local storage worked
      }
    } catch (err) {
      console.error("[KDK DevInsights] Local storage write failed:", err);
    }

    if (success) {
      this.totalEventsSent += batch.length;
      this.lastFlushTime = Date.now();
      this.flushEmitter.fire({ count: batch.length, success: true });
    } else {
      // Re-buffer the events for retry
      this.eventBuffer = [...batch, ...this.eventBuffer];

      // Drop oldest if buffer is too large
      const maxBuffer = this.config.maxBatchSize * 10;
      if (this.eventBuffer.length > maxBuffer) {
        const dropped = this.eventBuffer.length - maxBuffer;
        this.eventBuffer = this.eventBuffer.slice(dropped);
        this.totalEventsDropped += dropped;
        console.warn(`[KDK DevInsights] Dropped ${dropped} old events (buffer overflow)`);
      }

      this.flushEmitter.fire({ count: batch.length, success: false });
    }
  }

  /**
   * Send events to an HTTP endpoint (optional secondary backend).
   */
  private async sendToEndpoint(events: TelemetryEvent[]): Promise<void> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);

    try {
      const response = await fetch(this.config.telemetryEndpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(this.config.telemetryApiKey && {
            Authorization: `Bearer ${this.config.telemetryApiKey}`,
          }),
          "X-Extension-Version": "1.0.0",
          "X-Enterprise-Id": this.config.enterpriseId,
          "X-Team-Id": this.config.teamId,
          "X-Session-Id": this.sessionId,
        },
        body: JSON.stringify({
          events,
          batchSize: events.length,
          sentAt: new Date().toISOString(),
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Write events to local file storage.
   */
  private async writeToLocalStorage(events: TelemetryEvent[]): Promise<void> {
    try {
      await vscode.workspace.fs.createDirectory(this.localStorageUri);

      const fileName = `events-${Date.now()}.json`;
      const fileUri = vscode.Uri.joinPath(this.localStorageUri, fileName);

      const content = JSON.stringify(events, null, 2);
      await vscode.workspace.fs.writeFile(fileUri, Buffer.from(content, "utf-8"));
    } catch (err) {
      console.error("[KDK DevInsights] Failed to write to local storage:", err);
      throw err;
    }
  }

  /**
   * Build the event context.
   */
  private buildContext(overrides?: Partial<EventContext>): EventContext {
    const editor = vscode.window.activeTextEditor;
    const activeFile = editor
      ? (this.config.anonymizeUserData
          ? anonymizeFilePath(vscode.workspace.asRelativePath(editor.document.uri, false))
          : vscode.workspace.asRelativePath(editor.document.uri, false))
      : undefined;

    return {
      activeFile,
      activeLanguage: editor?.document.languageId,
      activeLineCount: editor?.document.lineCount,
      vscodeVersion: vscode.version,
      extensionVersion: "1.0.0",
      os: `${os.platform()}-${os.arch()}`,
      machineId: this.config.anonymizeUserData
        ? hashValue(vscode.env.machineId)
        : vscode.env.machineId,
      ...overrides,
    };
  }

  /**
   * Sanitize metadata (anonymize paths/snippets if configured).
   */
  private sanitizeMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
    if (!this.config.anonymizeUserData) {
      return metadata;
    }

    const sanitized = { ...metadata };

    if (typeof sanitized.fileRelativePath === "string") {
      sanitized.fileRelativePath = anonymizeFilePath(sanitized.fileRelativePath as string);
    }
    if (typeof sanitized.fileName === "string") {
      sanitized.fileName = anonymizeFilePath(sanitized.fileName as string);
    }
    if (!this.config.includeCodeSnippets) {
      delete sanitized.snippet;
      delete sanitized.commitMessage;
    }

    return sanitized;
  }

  private startFlushTimer(): void {
    this.stopFlushTimer();
    this.flushTimer = setInterval(
      () => this.flush(),
      this.config.flushIntervalSeconds * 1000
    );
  }

  private stopFlushTimer(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = undefined;
    }
  }

  pause(): void {
    this.isPaused = true;
  }

  resume(): void {
    this.isPaused = false;
  }

  getStats() {
    return {
      bufferSize: this.eventBuffer.length,
      totalEventsSent: this.totalEventsSent,
      totalEventsDropped: this.totalEventsDropped,
      lastFlushTime: this.lastFlushTime,
      isPaused: this.isPaused,
      ghPushAvailable: this.ghPushService?.isAvailable() ?? false,
    };
  }

  updateConfig(config: DevInsightsConfig): void {
    this.config = config;
    this.startFlushTimer();
  }

  dispose(): void {
    this.stopFlushTimer();
    this.flush().catch(() => {});
    this.flushEmitter.dispose();
    this.disposables.forEach((d) => d.dispose());
  }
}
