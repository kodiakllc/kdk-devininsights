import * as vscode from "vscode";
import { CopilotChatTracker } from "../../services/chatTracker";
import { ChatEventMetadata } from "../../types";

jest.mock("../../utils/anonymize", () => {
  let counter = 0;
  return {
    generateId: jest.fn(() => `mock-session-id-${++counter}`),
  };
});

describe("CopilotChatTracker", () => {
  let tracker: CopilotChatTracker;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
    const { generateId } = require("../../utils/anonymize");
    let counter = 0;
    (generateId as jest.Mock).mockImplementation(() => `mock-session-id-${++counter}`);
    tracker = new CopilotChatTracker();
  });

  afterEach(() => {
    tracker.dispose();
  });

  function findCommandHandler(commandId: string): ((...args: unknown[]) => Promise<void>) | undefined {
    const calls = (vscode.commands.registerCommand as jest.Mock).mock.calls;
    const match = calls.find((c: unknown[]) => c[0] === commandId);
    return match ? match[1] : undefined;
  }

  describe("initialize", () => {
    it("registers command wrappers for chat open commands", async () => {
      await tracker.initialize();

      const calls = (vscode.commands.registerCommand as jest.Mock).mock.calls;
      const registeredIds = calls.map((c: unknown[]) => c[0]);

      expect(registeredIds).toContain("kdkDevInsights.wrap.workbench_action_chat_open");
      expect(registeredIds).toContain("kdkDevInsights.wrap.workbench_action_chat_newChat");
      expect(registeredIds).toContain("kdkDevInsights.wrap.workbench_panel_chat_view_copilot_focus");
    });

    it("registers command wrappers for inline chat commands", async () => {
      await tracker.initialize();

      const calls = (vscode.commands.registerCommand as jest.Mock).mock.calls;
      const registeredIds = calls.map((c: unknown[]) => c[0]);

      expect(registeredIds).toContain("kdkDevInsights.wrap.editor_action_inlineChat_start");
      expect(registeredIds).toContain("kdkDevInsights.wrap.inlineChat_start");
      expect(registeredIds).toContain("kdkDevInsights.wrap.editor_action_inlineChat_accept");
      expect(registeredIds).toContain("kdkDevInsights.wrap.inlineChat_accept");
    });

    it("registers command wrapper for chat submit", async () => {
      await tracker.initialize();

      const calls = (vscode.commands.registerCommand as jest.Mock).mock.calls;
      const registeredIds = calls.map((c: unknown[]) => c[0]);

      expect(registeredIds).toContain("kdkDevInsights.wrap.workbench_action_chat_submit");
    });

    it("registers onDidChangeTextDocument listener", async () => {
      await tracker.initialize();
      expect(vscode.workspace.onDidChangeTextDocument).toHaveBeenCalledTimes(1);
    });

    it("registers onDidOpenTextDocument listener", async () => {
      await tracker.initialize();
      expect(vscode.workspace.onDidOpenTextDocument).toHaveBeenCalledTimes(1);
    });
  });

  describe("chat open command", () => {
    it("resets session ID and turn counter", async () => {
      await tracker.initialize();

      const promptEvents: ChatEventMetadata[] = [];
      tracker.onPromptSent((e) => promptEvents.push(e));

      const submitHandler = findCommandHandler("kdkDevInsights.wrap.workbench_action_chat_submit")!;
      await submitHandler();

      const firstSessionId = promptEvents[0].chatSessionId;
      expect(promptEvents[0].turnIndex).toBe(1);

      const openHandler = findCommandHandler("kdkDevInsights.wrap.workbench_action_chat_open")!;
      await openHandler();

      await submitHandler();

      expect(promptEvents[1].chatSessionId).not.toBe(firstSessionId);
      expect(promptEvents[1].turnIndex).toBe(1);
    });
  });

  describe("chat submit", () => {
    it("fires onPromptSent with incrementing turnIndex", async () => {
      await tracker.initialize();

      const promptEvents: ChatEventMetadata[] = [];
      tracker.onPromptSent((e) => promptEvents.push(e));

      const submitHandler = findCommandHandler("kdkDevInsights.wrap.workbench_action_chat_submit")!;

      await submitHandler();
      await submitHandler();
      await submitHandler();

      expect(promptEvents).toHaveLength(3);
      expect(promptEvents[0].turnIndex).toBe(1);
      expect(promptEvents[1].turnIndex).toBe(2);
      expect(promptEvents[2].turnIndex).toBe(3);
      expect(promptEvents[0].promptLength).toBe(0);
    });

    it("forwards to the original command", async () => {
      await tracker.initialize();

      const submitHandler = findCommandHandler("kdkDevInsights.wrap.workbench_action_chat_submit")!;
      await submitHandler();

      expect(vscode.commands.executeCommand).toHaveBeenCalledWith("workbench.action.chat.submit");
    });
  });

  describe("inline chat start", () => {
    it("fires onPromptSent with participant inline-chat", async () => {
      await tracker.initialize();

      const promptEvents: ChatEventMetadata[] = [];
      tracker.onPromptSent((e) => promptEvents.push(e));

      const startHandler = findCommandHandler("kdkDevInsights.wrap.editor_action_inlineChat_start")!;
      await startHandler();

      expect(promptEvents).toHaveLength(1);
      expect(promptEvents[0].participant).toBe("inline-chat");
      expect(promptEvents[0].turnIndex).toBe(1);
    });
  });

  describe("inline chat accept", () => {
    it("fires onCodeInserted with participant inline-chat", async () => {
      await tracker.initialize();

      const codeInsertedEvents: ChatEventMetadata[] = [];
      tracker.onCodeInserted((e) => codeInsertedEvents.push(e));

      const acceptHandler = findCommandHandler("kdkDevInsights.wrap.editor_action_inlineChat_accept")!;
      await acceptHandler();

      expect(codeInsertedEvents).toHaveLength(1);
      expect(codeInsertedEvents[0].participant).toBe("inline-chat");
    });
  });

  describe("large document change insertions", () => {
    it("fires onCodeInserted for large structured insertions", async () => {
      await tracker.initialize();

      const codeInsertedEvents: ChatEventMetadata[] = [];
      tracker.onCodeInserted((e) => codeInsertedEvents.push(e));

      const docChangeCallback = (vscode.workspace.onDidChangeTextDocument as jest.Mock)
        .mock.calls[0][0];

      const largeText = "function example() {\n  const x = 1;\n  const y = 2;\n  return x + y;\n}";

      docChangeCallback({
        document: {
          uri: vscode.Uri.file("/workspace/src/test.ts"),
          languageId: "typescript",
        },
        contentChanges: [
          {
            text: largeText,
            rangeLength: 0,
            range: {
              start: new vscode.Position(0, 0),
              end: new vscode.Position(0, 0),
            },
          },
        ],
      });

      expect(codeInsertedEvents).toHaveLength(1);
      expect(codeInsertedEvents[0].responseLength).toBe(largeText.length);
      expect(codeInsertedEvents[0].codeBlockCount).toBe(1);
      expect(codeInsertedEvents[0].codeBlockLanguages).toEqual(["typescript"]);
    });

    it("ignores insertions shorter than 50 characters", async () => {
      await tracker.initialize();

      const codeInsertedEvents: ChatEventMetadata[] = [];
      tracker.onCodeInserted((e) => codeInsertedEvents.push(e));

      const docChangeCallback = (vscode.workspace.onDidChangeTextDocument as jest.Mock)
        .mock.calls[0][0];

      docChangeCallback({
        document: {
          uri: vscode.Uri.file("/workspace/src/test.ts"),
          languageId: "typescript",
        },
        contentChanges: [
          {
            text: "short\ntext\nhere",
            rangeLength: 0,
            range: {
              start: new vscode.Position(0, 0),
              end: new vscode.Position(0, 0),
            },
          },
        ],
      });

      expect(codeInsertedEvents).toHaveLength(0);
    });

    it("ignores insertions without enough newlines", async () => {
      await tracker.initialize();

      const codeInsertedEvents: ChatEventMetadata[] = [];
      tracker.onCodeInserted((e) => codeInsertedEvents.push(e));

      const docChangeCallback = (vscode.workspace.onDidChangeTextDocument as jest.Mock)
        .mock.calls[0][0];

      docChangeCallback({
        document: {
          uri: vscode.Uri.file("/workspace/src/test.ts"),
          languageId: "typescript",
        },
        contentChanges: [
          {
            text: "a".repeat(60),
            rangeLength: 0,
            range: {
              start: new vscode.Position(0, 0),
              end: new vscode.Position(0, 0),
            },
          },
        ],
      });

      expect(codeInsertedEvents).toHaveLength(0);
    });

    it("ignores non-file scheme documents", async () => {
      await tracker.initialize();

      const codeInsertedEvents: ChatEventMetadata[] = [];
      tracker.onCodeInserted((e) => codeInsertedEvents.push(e));

      const docChangeCallback = (vscode.workspace.onDidChangeTextDocument as jest.Mock)
        .mock.calls[0][0];

      const largeText = "function example() {\n  const x = 1;\n  const y = 2;\n  return x + y;\n}";

      docChangeCallback({
        document: {
          uri: vscode.Uri.parse("output://log"),
          languageId: "plaintext",
        },
        contentChanges: [
          {
            text: largeText,
            rangeLength: 0,
            range: {
              start: new vscode.Position(0, 0),
              end: new vscode.Position(0, 0),
            },
          },
        ],
      });

      expect(codeInsertedEvents).toHaveLength(0);
    });
  });

  describe("duplicate fingerprint filtering", () => {
    it("filters duplicate insertions with same fingerprint", async () => {
      await tracker.initialize();

      const codeInsertedEvents: ChatEventMetadata[] = [];
      tracker.onCodeInserted((e) => codeInsertedEvents.push(e));

      const docChangeCallback = (vscode.workspace.onDidChangeTextDocument as jest.Mock)
        .mock.calls[0][0];

      const largeText = "function example() {\n  const x = 1;\n  const y = 2;\n  return x + y;\n}";

      const event = {
        document: {
          uri: vscode.Uri.file("/workspace/src/test.ts"),
          languageId: "typescript",
        },
        contentChanges: [
          {
            text: largeText,
            rangeLength: 0,
            range: {
              start: new vscode.Position(0, 0),
              end: new vscode.Position(0, 0),
            },
          },
        ],
      };

      docChangeCallback(event);
      docChangeCallback(event);

      expect(codeInsertedEvents).toHaveLength(1);
    });
  });

  describe("untitled document detection", () => {
    it("fires onCodeInserted for untitled documents with >30 chars", async () => {
      await tracker.initialize();

      const codeInsertedEvents: ChatEventMetadata[] = [];
      tracker.onCodeInserted((e) => codeInsertedEvents.push(e));

      const openDocCallback = (vscode.workspace.onDidOpenTextDocument as jest.Mock)
        .mock.calls[0][0];

      const content = "function generatedCode() { return 'hello world from copilot chat'; }";

      openDocCallback({
        uri: vscode.Uri.parse("untitled:Untitled-1"),
        languageId: "javascript",
        getText: () => content,
      });

      expect(codeInsertedEvents).toHaveLength(1);
      expect(codeInsertedEvents[0].responseLength).toBe(content.length);
      expect(codeInsertedEvents[0].codeBlockLanguages).toEqual(["javascript"]);
    });

    it("ignores untitled documents with <=30 chars", async () => {
      await tracker.initialize();

      const codeInsertedEvents: ChatEventMetadata[] = [];
      tracker.onCodeInserted((e) => codeInsertedEvents.push(e));

      const openDocCallback = (vscode.workspace.onDidOpenTextDocument as jest.Mock)
        .mock.calls[0][0];

      openDocCallback({
        uri: vscode.Uri.parse("untitled:Untitled-1"),
        languageId: "javascript",
        getText: () => "short",
      });

      expect(codeInsertedEvents).toHaveLength(0);
    });

    it("ignores non-untitled documents", async () => {
      await tracker.initialize();

      const codeInsertedEvents: ChatEventMetadata[] = [];
      tracker.onCodeInserted((e) => codeInsertedEvents.push(e));

      const openDocCallback = (vscode.workspace.onDidOpenTextDocument as jest.Mock)
        .mock.calls[0][0];

      openDocCallback({
        uri: vscode.Uri.file("/workspace/src/test.ts"),
        languageId: "typescript",
        getText: () => "a".repeat(50),
      });

      expect(codeInsertedEvents).toHaveLength(0);
    });
  });

  describe("trackPromptSent", () => {
    it("fires onPromptSent with given prompt length", async () => {
      await tracker.initialize();

      const promptEvents: ChatEventMetadata[] = [];
      tracker.onPromptSent((e) => promptEvents.push(e));

      tracker.trackPromptSent(42);

      expect(promptEvents).toHaveLength(1);
      expect(promptEvents[0].promptLength).toBe(42);
      expect(promptEvents[0].turnIndex).toBe(1);
    });

    it("increments turn counter", async () => {
      await tracker.initialize();

      const promptEvents: ChatEventMetadata[] = [];
      tracker.onPromptSent((e) => promptEvents.push(e));

      tracker.trackPromptSent(10);
      tracker.trackPromptSent(20);

      expect(promptEvents[0].turnIndex).toBe(1);
      expect(promptEvents[1].turnIndex).toBe(2);
    });
  });

  describe("resetSession", () => {
    it("generates a new session ID", async () => {
      await tracker.initialize();

      const promptEvents: ChatEventMetadata[] = [];
      tracker.onPromptSent((e) => promptEvents.push(e));

      tracker.trackPromptSent(10);
      const firstSessionId = promptEvents[0].chatSessionId;

      tracker.resetSession();
      tracker.trackPromptSent(10);

      expect(promptEvents[1].chatSessionId).not.toBe(firstSessionId);
    });

    it("resets turn counter to zero", async () => {
      await tracker.initialize();

      const promptEvents: ChatEventMetadata[] = [];
      tracker.onPromptSent((e) => promptEvents.push(e));

      tracker.trackPromptSent(10);
      tracker.trackPromptSent(10);
      expect(promptEvents[1].turnIndex).toBe(2);

      tracker.resetSession();
      tracker.trackPromptSent(10);
      expect(promptEvents[2].turnIndex).toBe(1);
    });
  });

  describe("dispose", () => {
    it("cleans up without throwing", async () => {
      await tracker.initialize();
      expect(() => tracker.dispose()).not.toThrow();
    });
  });
});
