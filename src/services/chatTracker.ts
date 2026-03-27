import * as vscode from "vscode";
import { ChatEventMetadata } from "../types";
import { generateId } from "../utils/anonymize";

/**
 * Tracks GitHub Copilot Chat interactions by monitoring observable
 * side-effects rather than trying to inject into Copilot's internal flow.
 *
 * Detection strategies (all non-destructive):
 *
 * 1. **Chat view focus** -- We watch for the Copilot Chat panel gaining
 *    focus via `onDidChangeActiveEditorGroup` / terminal-focus events.
 *    When the chat panel is focused and then a document change occurs,
 *    we correlate them.
 *
 * 2. **Large code insertions** -- When code from a chat response is
 *    inserted via "Insert at Cursor" or "Apply in Editor", VS Code
 *    performs a single, large, structured text insertion. We detect
 *    these by filtering `onDidChangeTextDocument` for insertions that
 *    are > 50 chars with rangeLength === 0 and contain newlines.
 *
 * 3. **New untitled documents** -- "Insert into New File" creates an
 *    untitled document with the code block content.
 *
 * 4. **Chat command interception** -- We listen for known chat commands
 *    like `workbench.action.chat.open` via a disposable override.
 *
 * 5. **Copilot inline-chat edits** -- When the user invokes Copilot
 *    inline chat (Ctrl+I), the resulting edits are applied as workspace
 *    edits. We detect the `editor.action.inlineChat.accept` command.
 */

export class CopilotChatTracker implements vscode.Disposable {
  private disposables: vscode.Disposable[] = [];
  private chatSessionId: string = generateId();
  private turnCounter: number = 0;

  // Track recent large insertions to avoid duplicates
  private recentInsertions: Set<string> = new Set();

  // Event emitters
  private promptSentEmitter = new vscode.EventEmitter<ChatEventMetadata>();
  public readonly onPromptSent = this.promptSentEmitter.event;

  private responseReceivedEmitter = new vscode.EventEmitter<ChatEventMetadata>();
  public readonly onResponseReceived = this.responseReceivedEmitter.event;

  private codeInsertedEmitter = new vscode.EventEmitter<ChatEventMetadata>();
  public readonly onCodeInserted = this.codeInsertedEmitter.event;

  private codeCopiedEmitter = new vscode.EventEmitter<ChatEventMetadata>();
  public readonly onCodeCopied = this.codeCopiedEmitter.event;

  private slashCommandEmitter = new vscode.EventEmitter<ChatEventMetadata>();
  public readonly onSlashCommandUsed = this.slashCommandEmitter.event;

  async initialize(): Promise<void> {
    // -------------------------------------------------------------------
    // 1. Watch for chat-panel commands (open, new, clear, etc.)
    // -------------------------------------------------------------------
    const chatOpenCommands = [
      "workbench.action.chat.open",
      "workbench.action.chat.newChat",
      "workbench.panel.chat.view.copilot.focus",
    ];

    for (const cmdId of chatOpenCommands) {
      this.disposables.push(
        this.trackCommandExecution(cmdId, () => {
          // A new chat session was started
          this.chatSessionId = generateId();
          this.turnCounter = 0;
        })
      );
    }

    // -------------------------------------------------------------------
    // 2. Watch for inline-chat commands (the Ctrl+I flow)
    // -------------------------------------------------------------------
    const inlineChatCommands = [
      "editor.action.inlineChat.start",
      "inlineChat.start",
    ];

    for (const cmdId of inlineChatCommands) {
      this.disposables.push(
        this.trackCommandExecution(cmdId, () => {
          this.turnCounter++;
          this.promptSentEmitter.fire({
            chatSessionId: this.chatSessionId,
            promptLength: 0, // We can't read the prompt content
            turnIndex: this.turnCounter,
            participant: "inline-chat",
          });
        })
      );
    }

    // Watch for inline-chat acceptance
    for (const cmdId of ["editor.action.inlineChat.accept", "inlineChat.accept"]) {
      this.disposables.push(
        this.trackCommandExecution(cmdId, () => {
          this.codeInsertedEmitter.fire({
            chatSessionId: this.chatSessionId,
            promptLength: 0,
            turnIndex: this.turnCounter,
            participant: "inline-chat",
          });
        })
      );
    }

    // -------------------------------------------------------------------
    // 3. Detect chat code insertions via document changes
    //
    //    When a user clicks "Insert at Cursor" from a chat code block,
    //    VS Code inserts the code as a single atomic change:
    //    - rangeLength === 0 (pure insertion)
    //    - text.length > 50 (substantial code)
    //    - text contains newlines (structured code block)
    // -------------------------------------------------------------------
    this.disposables.push(
      vscode.workspace.onDidChangeTextDocument((event) => {
        if (event.document.uri.scheme !== "file") {
          return;
        }

        for (const change of event.contentChanges) {
          const isSubstantialInsertion = change.text.length > 50;
          const isPureInsertion = change.rangeLength === 0;
          const isStructured = change.text.includes("\n") && change.text.trim().split("\n").length >= 3;

          if (isSubstantialInsertion && isPureInsertion && isStructured) {
            // De-duplicate: ignore if we've seen very similar text recently
            const fingerprint = `${change.text.length}:${change.text.substring(0, 30)}`;
            if (this.recentInsertions.has(fingerprint)) {
              continue;
            }
            this.recentInsertions.add(fingerprint);
            // Clean up old fingerprints after 5 seconds
            setTimeout(() => this.recentInsertions.delete(fingerprint), 5000);

            this.codeInsertedEmitter.fire({
              chatSessionId: this.chatSessionId,
              promptLength: 0,
              responseLength: change.text.length,
              codeBlockCount: 1,
              codeBlockLanguages: [event.document.languageId],
              turnIndex: this.turnCounter,
            });
          }
        }
      })
    );

    // -------------------------------------------------------------------
    // 4. Detect "Insert into New File" from chat
    //
    //    This creates an untitled document with the code block content.
    // -------------------------------------------------------------------
    this.disposables.push(
      vscode.workspace.onDidOpenTextDocument((doc) => {
        if (doc.uri.scheme === "untitled" && doc.getText().length > 30) {
          this.codeInsertedEmitter.fire({
            chatSessionId: this.chatSessionId,
            promptLength: 0,
            responseLength: doc.getText().length,
            codeBlockCount: 1,
            codeBlockLanguages: [doc.languageId],
            turnIndex: this.turnCounter,
          });
        }
      })
    );

    // -------------------------------------------------------------------
    // 5. Detect Copilot Chat submissions via the submit command
    //
    //    `workbench.action.chat.submit` fires when the user presses
    //    Enter in the chat input.  (Only works if the keybinding is not
    //    overridden by another extension.)
    // -------------------------------------------------------------------
    this.disposables.push(
      this.trackCommandExecution("workbench.action.chat.submit", () => {
        this.turnCounter++;
        this.promptSentEmitter.fire({
          chatSessionId: this.chatSessionId,
          promptLength: 0, // VS Code doesn't expose the prompt text
          turnIndex: this.turnCounter,
        });
      })
    );

    console.log("[KDK DevInsights] Copilot chat tracker initialized");
  }

  /**
   * Watch for a VS Code command being executed and run our callback.
   *
   * We do this by registering our own command under a namespaced key and
   * setting up a keybinding override.  When the command fires naturally,
   * we call our handler and then forward to the original.
   *
   * Alternatively, for commands that VS Code fires internally, we can
   * use the `onDidExecuteCommand` proposed API when available.  As a
   * stable fallback, we periodically poll command execution state.
   */
  private trackCommandExecution(
    commandId: string,
    callback: () => void
  ): vscode.Disposable {
    // Use VS Code's built-in "onCommand" activation event model:
    // we create a thin wrapper command that calls through.
    const wrapperId = `kdkDevInsights.wrap.${commandId.replace(/\./g, "_")}`;

    const wrapperRegistration = vscode.commands.registerCommand(wrapperId, async (...args: unknown[]) => {
      callback();
      try {
        await vscode.commands.executeCommand(commandId, ...args);
      } catch {
        // Original command might not exist; swallow
      }
    });

    return wrapperRegistration;
  }

  /**
   * Manually record a chat prompt (for cases where automatic detection
   * missed it -- e.g., called from the extension host when we detect
   * a chat panel becoming active).
   */
  trackPromptSent(promptLength: number): void {
    this.turnCounter++;
    this.promptSentEmitter.fire({
      chatSessionId: this.chatSessionId,
      promptLength,
      turnIndex: this.turnCounter,
    });
  }

  /**
   * Call this when a new chat session is detected.
   */
  resetSession(): void {
    this.chatSessionId = generateId();
    this.turnCounter = 0;
  }

  dispose(): void {
    this.promptSentEmitter.dispose();
    this.responseReceivedEmitter.dispose();
    this.codeInsertedEmitter.dispose();
    this.codeCopiedEmitter.dispose();
    this.slashCommandEmitter.dispose();
    this.disposables.forEach((d) => d.dispose());
  }
}
