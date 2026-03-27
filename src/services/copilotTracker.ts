import * as vscode from "vscode";
import { CompletionEventMetadata } from "../types";
import { generateId } from "../utils/anonymize";

/**
 * Tracks GitHub Copilot inline completion acceptance/dismissal by monitoring
 * real VS Code events that fire during the inline suggest lifecycle.
 *
 * How it works:
 *
 * 1. We register a no-op InlineCompletionItemProvider. When VS Code asks
 *    *all* registered providers for suggestions (including ours), we record
 *    that a completion was triggered. We return `undefined` so Copilot's
 *    actual suggestions are unaffected.
 *
 * 2. After a trigger, we watch `onDidChangeTextDocument`. When the user
 *    presses Tab to accept a Copilot ghost-text suggestion, VS Code inserts
 *    the text in a single atomic document change. We detect this by looking
 *    for an insertion that:
 *      - Replaces zero characters (rangeLength === 0)
 *      - Is multi-character (not single-keystroke typing)
 *      - Happens within a short window after a trigger
 *
 * 3. If the user moves the cursor, switches editors, or types over the
 *    ghost text, we count it as a dismissal.
 *
 * This is fully non-destructive -- it doesn't modify Copilot's behavior.
 */

interface PendingCompletion {
  completionId: string;
  triggeredAt: number;
  documentUri: string;
  position: vscode.Position;
  language: string;
  fileRelativePath: string;
  preAcceptLineCount: number;
}

export class CopilotCompletionTracker implements vscode.Disposable {
  private disposables: vscode.Disposable[] = [];
  private pending: PendingCompletion | null = null;
  private includeSnippets: boolean;
  private debounceTimer: ReturnType<typeof setTimeout> | undefined;

  // Cooldown to avoid double-counting: after accepting a completion,
  // ignore new triggers for this many ms.
  private static readonly ACCEPT_COOLDOWN_MS = 300;
  // Maximum age (ms) of a pending trigger for it to count as an acceptance.
  private static readonly MAX_TRIGGER_AGE_MS = 30_000;
  // Minimum inserted characters to classify as an accepted completion
  // (filters out single-character typing).
  private static readonly MIN_ACCEPTED_CHARS = 4;

  private lastAcceptTime = 0;

  // Event emitters
  private completionShownEmitter = new vscode.EventEmitter<CompletionEventMetadata>();
  public readonly onCompletionShown = this.completionShownEmitter.event;

  private completionAcceptedEmitter = new vscode.EventEmitter<CompletionEventMetadata>();
  public readonly onCompletionAccepted = this.completionAcceptedEmitter.event;

  private completionDismissedEmitter = new vscode.EventEmitter<CompletionEventMetadata>();
  public readonly onCompletionDismissed = this.completionDismissedEmitter.event;

  constructor(includeSnippets: boolean = false) {
    this.includeSnippets = includeSnippets;
  }

  async initialize(): Promise<void> {
    // -------------------------------------------------------------------
    // 1. Passive inline-completion provider: records triggers
    // -------------------------------------------------------------------
    this.disposables.push(
      vscode.languages.registerInlineCompletionItemProvider(
        { pattern: "**" },
        {
          provideInlineCompletionItems: (
            document: vscode.TextDocument,
            position: vscode.Position,
            context: vscode.InlineCompletionContext,
            _token: vscode.CancellationToken
          ) => {
            // Ignore triggers that fire right after an acceptance
            if (Date.now() - this.lastAcceptTime < CopilotCompletionTracker.ACCEPT_COOLDOWN_MS) {
              return undefined;
            }

            const relativePath = vscode.workspace.asRelativePath(document.uri, false);

            // Replace any existing pending trigger
            if (this.pending) {
              this.fireDismissal();
            }

            this.pending = {
              completionId: generateId(),
              triggeredAt: Date.now(),
              documentUri: document.uri.toString(),
              position,
              language: document.languageId,
              fileRelativePath: relativePath,
              preAcceptLineCount: document.lineCount,
            };

            this.completionShownEmitter.fire({
              completionId: this.pending.completionId,
              language: this.pending.language,
              lineNumber: position.line,
              characterCount: 0,
              lineCount: 0,
              triggerKind:
                context.triggerKind === vscode.InlineCompletionTriggerKind.Automatic
                  ? "automatic"
                  : "manual",
              wasMultiLine: false,
              fileRelativePath: relativePath,
            });

            return undefined; // Don't provide any items; let Copilot handle it
          },
        }
      )
    );

    // -------------------------------------------------------------------
    // 2. Document-change listener: detects accepted completions
    // -------------------------------------------------------------------
    this.disposables.push(
      vscode.workspace.onDidChangeTextDocument((event) => {
        if (!this.pending) {
          return;
        }
        if (event.document.uri.toString() !== this.pending.documentUri) {
          return;
        }

        // Evaluate the content changes to decide if this looks like an
        // inline-suggest acceptance.
        let totalInserted = "";
        let totalLinesAdded = 0;
        let looksLikeAcceptance = false;

        for (const change of event.contentChanges) {
          totalInserted += change.text;
          totalLinesAdded += change.text.split("\n").length - 1;

          // An accepted ghost-text insertion is a single change with
          // rangeLength 0 (pure insertion) and multi-character text.
          if (
            change.rangeLength === 0 &&
            change.text.length >= CopilotCompletionTracker.MIN_ACCEPTED_CHARS
          ) {
            looksLikeAcceptance = true;
          }
        }

        if (!looksLikeAcceptance || totalInserted.length === 0) {
          return;
        }

        const pending = this.pending;
        const age = Date.now() - pending.triggeredAt;
        if (age > CopilotCompletionTracker.MAX_TRIGGER_AGE_MS) {
          // Trigger is stale; discard it
          this.pending = null;
          return;
        }

        // It's an acceptance!
        this.pending = null;
        this.lastAcceptTime = Date.now();

        const metadata: CompletionEventMetadata = {
          completionId: pending.completionId,
          language: pending.language,
          lineNumber: pending.position.line,
          characterCount: totalInserted.length,
          lineCount: totalLinesAdded + 1,
          triggerKind: "automatic",
          responseTimeMs: age,
          wasMultiLine: totalLinesAdded > 0,
          fileRelativePath: pending.fileRelativePath,
        };

        if (this.includeSnippets) {
          metadata.snippet = totalInserted.substring(0, 500);
        }

        this.completionAcceptedEmitter.fire(metadata);
      })
    );

    // -------------------------------------------------------------------
    // 3. Editor-change / cursor-move listener: detects dismissals
    //
    //    If the user switches editors or moves the cursor away from
    //    the line where the completion was shown, the ghost text is gone.
    // -------------------------------------------------------------------
    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor(() => {
        if (this.pending) {
          this.fireDismissal();
        }
      })
    );

    this.disposables.push(
      vscode.window.onDidChangeTextEditorSelection((event) => {
        if (!this.pending) {
          return;
        }
        // Debounce: cursor moves happen rapidly; wait 200 ms to see if
        // the next event is actually an acceptance.
        if (this.debounceTimer) {
          clearTimeout(this.debounceTimer);
        }
        this.debounceTimer = setTimeout(() => {
          if (this.pending) {
            const age = Date.now() - this.pending.triggeredAt;
            // Give at least 500 ms for the user to accept before treating
            // a cursor move as a dismissal.
            if (age > 500) {
              this.fireDismissal();
            }
          }
        }, 200);
      })
    );

    console.log("[KDK DevInsights] Copilot completion tracker initialized");
  }

  private fireDismissal(): void {
    if (!this.pending) {
      return;
    }
    const pending = this.pending;
    this.pending = null;

    this.completionDismissedEmitter.fire({
      completionId: pending.completionId,
      language: pending.language,
      lineNumber: pending.position.line,
      characterCount: 0,
      lineCount: 0,
      triggerKind: "automatic",
      responseTimeMs: Date.now() - pending.triggeredAt,
      wasMultiLine: false,
      fileRelativePath: pending.fileRelativePath,
    });
  }

  updateConfig(includeSnippets: boolean): void {
    this.includeSnippets = includeSnippets;
  }

  dispose(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.completionShownEmitter.dispose();
    this.completionAcceptedEmitter.dispose();
    this.completionDismissedEmitter.dispose();
    this.disposables.forEach((d) => d.dispose());
  }
}
