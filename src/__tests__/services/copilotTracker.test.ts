import * as vscode from "vscode";
import { CopilotCompletionTracker } from "../../services/copilotTracker";
import { CompletionEventMetadata } from "../../types";

jest.mock("../../utils/anonymize", () => ({
  generateId: jest.fn(() => "mock-completion-id"),
}));

function createMockDocument(overrides: Partial<{
  uri: vscode.Uri;
  languageId: string;
  lineCount: number;
}> = {}) {
  return {
    uri: overrides.uri ?? vscode.Uri.file("/workspace/src/index.ts"),
    languageId: overrides.languageId ?? "typescript",
    lineCount: overrides.lineCount ?? 100,
    fileName: "/workspace/src/index.ts",
  };
}

function createMockContext(triggerKind: number = vscode.InlineCompletionTriggerKind.Automatic) {
  return { triggerKind };
}

function createMockToken() {
  return { isCancellationRequested: false, onCancellationRequested: jest.fn() };
}

function createMockChangeEvent(
  documentUri: vscode.Uri,
  changes: Array<{ text: string; rangeLength: number }>
) {
  return {
    document: {
      uri: documentUri,
      lineCount: 110,
    },
    contentChanges: changes.map((c) => ({
      text: c.text,
      rangeLength: c.rangeLength,
      range: {
        start: new vscode.Position(10, 0),
        end: new vscode.Position(10, c.rangeLength),
      },
    })),
    reason: undefined,
  };
}

describe("CopilotCompletionTracker", () => {
  let tracker: CopilotCompletionTracker;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
    tracker = new CopilotCompletionTracker(false);
  });

  afterEach(() => {
    tracker.dispose();
  });

  describe("initialize", () => {
    it("registers an InlineCompletionItemProvider", async () => {
      await tracker.initialize();
      expect(vscode.languages.registerInlineCompletionItemProvider).toHaveBeenCalledTimes(1);
      expect(vscode.languages.registerInlineCompletionItemProvider).toHaveBeenCalledWith(
        { pattern: "**" },
        expect.objectContaining({
          provideInlineCompletionItems: expect.any(Function),
        })
      );
    });

    it("registers onDidChangeTextDocument listener", async () => {
      await tracker.initialize();
      expect(vscode.workspace.onDidChangeTextDocument).toHaveBeenCalledTimes(1);
    });

    it("registers onDidChangeActiveTextEditor listener", async () => {
      await tracker.initialize();
      expect(vscode.window.onDidChangeActiveTextEditor).toHaveBeenCalledTimes(1);
    });

    it("registers onDidChangeTextEditorSelection listener", async () => {
      await tracker.initialize();
      expect(vscode.window.onDidChangeTextEditorSelection).toHaveBeenCalledTimes(1);
    });
  });

  describe("completion shown", () => {
    it("fires onCompletionShown when the provider is triggered", async () => {
      await tracker.initialize();

      const shownEvents: CompletionEventMetadata[] = [];
      tracker.onCompletionShown((e) => shownEvents.push(e));

      const provider = (vscode.languages.registerInlineCompletionItemProvider as jest.Mock)
        .mock.calls[0][1];

      const doc = createMockDocument();
      const pos = new vscode.Position(5, 10);
      const ctx = createMockContext(vscode.InlineCompletionTriggerKind.Automatic);
      const token = createMockToken();

      const result = provider.provideInlineCompletionItems(doc, pos, ctx, token);

      expect(result).toBeUndefined();
      expect(shownEvents).toHaveLength(1);
      expect(shownEvents[0].completionId).toBe("mock-completion-id");
      expect(shownEvents[0].language).toBe("typescript");
      expect(shownEvents[0].lineNumber).toBe(5);
      expect(shownEvents[0].triggerKind).toBe("automatic");
      expect(shownEvents[0].characterCount).toBe(0);
      expect(shownEvents[0].lineCount).toBe(0);
      expect(shownEvents[0].wasMultiLine).toBe(false);
    });

    it("reports manual trigger kind", async () => {
      await tracker.initialize();

      const shownEvents: CompletionEventMetadata[] = [];
      tracker.onCompletionShown((e) => shownEvents.push(e));

      const provider = (vscode.languages.registerInlineCompletionItemProvider as jest.Mock)
        .mock.calls[0][1];

      provider.provideInlineCompletionItems(
        createMockDocument(),
        new vscode.Position(0, 0),
        createMockContext(vscode.InlineCompletionTriggerKind.Invoke),
        createMockToken()
      );

      expect(shownEvents[0].triggerKind).toBe("manual");
    });

    it("dismisses previous pending completion when a new trigger arrives", async () => {
      await tracker.initialize();

      const dismissedEvents: CompletionEventMetadata[] = [];
      tracker.onCompletionDismissed((e) => dismissedEvents.push(e));

      const provider = (vscode.languages.registerInlineCompletionItemProvider as jest.Mock)
        .mock.calls[0][1];

      const doc = createMockDocument();
      const ctx = createMockContext();
      const token = createMockToken();

      provider.provideInlineCompletionItems(doc, new vscode.Position(1, 0), ctx, token);
      provider.provideInlineCompletionItems(doc, new vscode.Position(2, 0), ctx, token);

      expect(dismissedEvents).toHaveLength(1);
    });
  });

  describe("completion accepted", () => {
    it("fires onCompletionAccepted on qualifying document change", async () => {
      await tracker.initialize();

      const acceptedEvents: CompletionEventMetadata[] = [];
      tracker.onCompletionAccepted((e) => acceptedEvents.push(e));

      const provider = (vscode.languages.registerInlineCompletionItemProvider as jest.Mock)
        .mock.calls[0][1];
      const docChangeCallback = (vscode.workspace.onDidChangeTextDocument as jest.Mock)
        .mock.calls[0][0];

      const docUri = vscode.Uri.file("/workspace/src/index.ts");
      const doc = createMockDocument({ uri: docUri });

      provider.provideInlineCompletionItems(
        doc,
        new vscode.Position(5, 0),
        createMockContext(),
        createMockToken()
      );

      const insertedText = "const result = calculateTotal(items);";
      docChangeCallback(createMockChangeEvent(docUri, [{ text: insertedText, rangeLength: 0 }]));

      expect(acceptedEvents).toHaveLength(1);
      expect(acceptedEvents[0].completionId).toBe("mock-completion-id");
      expect(acceptedEvents[0].characterCount).toBe(insertedText.length);
      expect(acceptedEvents[0].lineCount).toBe(1);
      expect(acceptedEvents[0].wasMultiLine).toBe(false);
      expect(acceptedEvents[0].language).toBe("typescript");
    });

    it("fires onCompletionAccepted for multi-line insertion", async () => {
      await tracker.initialize();

      const acceptedEvents: CompletionEventMetadata[] = [];
      tracker.onCompletionAccepted((e) => acceptedEvents.push(e));

      const provider = (vscode.languages.registerInlineCompletionItemProvider as jest.Mock)
        .mock.calls[0][1];
      const docChangeCallback = (vscode.workspace.onDidChangeTextDocument as jest.Mock)
        .mock.calls[0][0];

      const docUri = vscode.Uri.file("/workspace/src/index.ts");
      const doc = createMockDocument({ uri: docUri });

      provider.provideInlineCompletionItems(
        doc,
        new vscode.Position(5, 0),
        createMockContext(),
        createMockToken()
      );

      const insertedText = "function hello() {\n  return 'world';\n}";
      docChangeCallback(createMockChangeEvent(docUri, [{ text: insertedText, rangeLength: 0 }]));

      expect(acceptedEvents).toHaveLength(1);
      expect(acceptedEvents[0].wasMultiLine).toBe(true);
      expect(acceptedEvents[0].lineCount).toBe(3);
    });

    it("ignores changes with rangeLength > 0", async () => {
      await tracker.initialize();

      const acceptedEvents: CompletionEventMetadata[] = [];
      tracker.onCompletionAccepted((e) => acceptedEvents.push(e));

      const provider = (vscode.languages.registerInlineCompletionItemProvider as jest.Mock)
        .mock.calls[0][1];
      const docChangeCallback = (vscode.workspace.onDidChangeTextDocument as jest.Mock)
        .mock.calls[0][0];

      const docUri = vscode.Uri.file("/workspace/src/index.ts");
      const doc = createMockDocument({ uri: docUri });

      provider.provideInlineCompletionItems(
        doc,
        new vscode.Position(5, 0),
        createMockContext(),
        createMockToken()
      );

      docChangeCallback(createMockChangeEvent(docUri, [{ text: "replaced text here", rangeLength: 5 }]));

      expect(acceptedEvents).toHaveLength(0);
    });

    it("ignores changes with text shorter than MIN_ACCEPTED_CHARS", async () => {
      await tracker.initialize();

      const acceptedEvents: CompletionEventMetadata[] = [];
      tracker.onCompletionAccepted((e) => acceptedEvents.push(e));

      const provider = (vscode.languages.registerInlineCompletionItemProvider as jest.Mock)
        .mock.calls[0][1];
      const docChangeCallback = (vscode.workspace.onDidChangeTextDocument as jest.Mock)
        .mock.calls[0][0];

      const docUri = vscode.Uri.file("/workspace/src/index.ts");
      const doc = createMockDocument({ uri: docUri });

      provider.provideInlineCompletionItems(
        doc,
        new vscode.Position(5, 0),
        createMockContext(),
        createMockToken()
      );

      docChangeCallback(createMockChangeEvent(docUri, [{ text: "ab", rangeLength: 0 }]));

      expect(acceptedEvents).toHaveLength(0);
    });

    it("ignores changes for a different document", async () => {
      await tracker.initialize();

      const acceptedEvents: CompletionEventMetadata[] = [];
      tracker.onCompletionAccepted((e) => acceptedEvents.push(e));

      const provider = (vscode.languages.registerInlineCompletionItemProvider as jest.Mock)
        .mock.calls[0][1];
      const docChangeCallback = (vscode.workspace.onDidChangeTextDocument as jest.Mock)
        .mock.calls[0][0];

      const docUri = vscode.Uri.file("/workspace/src/index.ts");
      const otherUri = vscode.Uri.file("/workspace/src/other.ts");
      const doc = createMockDocument({ uri: docUri });

      provider.provideInlineCompletionItems(
        doc,
        new vscode.Position(5, 0),
        createMockContext(),
        createMockToken()
      );

      docChangeCallback(createMockChangeEvent(otherUri, [{ text: "some long inserted text", rangeLength: 0 }]));

      expect(acceptedEvents).toHaveLength(0);
    });

    it("does not fire when no pending trigger exists", async () => {
      await tracker.initialize();

      const acceptedEvents: CompletionEventMetadata[] = [];
      tracker.onCompletionAccepted((e) => acceptedEvents.push(e));

      const docChangeCallback = (vscode.workspace.onDidChangeTextDocument as jest.Mock)
        .mock.calls[0][0];

      const docUri = vscode.Uri.file("/workspace/src/index.ts");
      docChangeCallback(createMockChangeEvent(docUri, [{ text: "some long inserted text", rangeLength: 0 }]));

      expect(acceptedEvents).toHaveLength(0);
    });
  });

  describe("stale trigger", () => {
    it("discards pending trigger older than MAX_TRIGGER_AGE_MS", async () => {
      await tracker.initialize();

      const acceptedEvents: CompletionEventMetadata[] = [];
      tracker.onCompletionAccepted((e) => acceptedEvents.push(e));

      const provider = (vscode.languages.registerInlineCompletionItemProvider as jest.Mock)
        .mock.calls[0][1];
      const docChangeCallback = (vscode.workspace.onDidChangeTextDocument as jest.Mock)
        .mock.calls[0][0];

      const docUri = vscode.Uri.file("/workspace/src/index.ts");
      const doc = createMockDocument({ uri: docUri });

      const realDateNow = Date.now;
      let now = realDateNow.call(Date);
      jest.spyOn(Date, "now").mockImplementation(() => now);

      provider.provideInlineCompletionItems(
        doc,
        new vscode.Position(5, 0),
        createMockContext(),
        createMockToken()
      );

      now += 31_000;

      docChangeCallback(createMockChangeEvent(docUri, [{ text: "const foo = bar()", rangeLength: 0 }]));

      expect(acceptedEvents).toHaveLength(0);

      jest.spyOn(Date, "now").mockRestore();
    });
  });

  describe("completion dismissed", () => {
    it("fires onCompletionDismissed when editor switches with pending completion", async () => {
      await tracker.initialize();

      const dismissedEvents: CompletionEventMetadata[] = [];
      tracker.onCompletionDismissed((e) => dismissedEvents.push(e));

      const provider = (vscode.languages.registerInlineCompletionItemProvider as jest.Mock)
        .mock.calls[0][1];
      const editorChangeCallback = (vscode.window.onDidChangeActiveTextEditor as jest.Mock)
        .mock.calls[0][0];

      provider.provideInlineCompletionItems(
        createMockDocument(),
        new vscode.Position(5, 0),
        createMockContext(),
        createMockToken()
      );

      editorChangeCallback(undefined);

      expect(dismissedEvents).toHaveLength(1);
      expect(dismissedEvents[0].completionId).toBe("mock-completion-id");
      expect(dismissedEvents[0].characterCount).toBe(0);
    });

    it("does not fire onCompletionDismissed when no pending completion", async () => {
      await tracker.initialize();

      const dismissedEvents: CompletionEventMetadata[] = [];
      tracker.onCompletionDismissed((e) => dismissedEvents.push(e));

      const editorChangeCallback = (vscode.window.onDidChangeActiveTextEditor as jest.Mock)
        .mock.calls[0][0];

      editorChangeCallback(undefined);

      expect(dismissedEvents).toHaveLength(0);
    });
  });

  describe("snippet inclusion", () => {
    it("includes snippet when includeSnippets is true", async () => {
      tracker = new CopilotCompletionTracker(true);
      await tracker.initialize();

      const acceptedEvents: CompletionEventMetadata[] = [];
      tracker.onCompletionAccepted((e) => acceptedEvents.push(e));

      const provider = (vscode.languages.registerInlineCompletionItemProvider as jest.Mock)
        .mock.calls[0][1];
      const docChangeCallback = (vscode.workspace.onDidChangeTextDocument as jest.Mock)
        .mock.calls[0][0];

      const docUri = vscode.Uri.file("/workspace/src/index.ts");
      const doc = createMockDocument({ uri: docUri });

      provider.provideInlineCompletionItems(
        doc,
        new vscode.Position(5, 0),
        createMockContext(),
        createMockToken()
      );

      const insertedText = "const result = calculateTotal(items);";
      docChangeCallback(createMockChangeEvent(docUri, [{ text: insertedText, rangeLength: 0 }]));

      expect(acceptedEvents).toHaveLength(1);
      expect(acceptedEvents[0].snippet).toBe(insertedText);
    });

    it("does not include snippet when includeSnippets is false", async () => {
      await tracker.initialize();

      const acceptedEvents: CompletionEventMetadata[] = [];
      tracker.onCompletionAccepted((e) => acceptedEvents.push(e));

      const provider = (vscode.languages.registerInlineCompletionItemProvider as jest.Mock)
        .mock.calls[0][1];
      const docChangeCallback = (vscode.workspace.onDidChangeTextDocument as jest.Mock)
        .mock.calls[0][0];

      const docUri = vscode.Uri.file("/workspace/src/index.ts");
      const doc = createMockDocument({ uri: docUri });

      provider.provideInlineCompletionItems(
        doc,
        new vscode.Position(5, 0),
        createMockContext(),
        createMockToken()
      );

      const insertedText = "const result = calculateTotal(items);";
      docChangeCallback(createMockChangeEvent(docUri, [{ text: insertedText, rangeLength: 0 }]));

      expect(acceptedEvents).toHaveLength(1);
      expect(acceptedEvents[0].snippet).toBeUndefined();
    });
  });

  describe("updateConfig", () => {
    it("changes includeSnippets flag", async () => {
      await tracker.initialize();

      const acceptedEvents: CompletionEventMetadata[] = [];
      tracker.onCompletionAccepted((e) => acceptedEvents.push(e));

      tracker.updateConfig(true);

      const provider = (vscode.languages.registerInlineCompletionItemProvider as jest.Mock)
        .mock.calls[0][1];
      const docChangeCallback = (vscode.workspace.onDidChangeTextDocument as jest.Mock)
        .mock.calls[0][0];

      const docUri = vscode.Uri.file("/workspace/src/index.ts");
      const doc = createMockDocument({ uri: docUri });

      provider.provideInlineCompletionItems(
        doc,
        new vscode.Position(5, 0),
        createMockContext(),
        createMockToken()
      );

      const insertedText = "const result = calculateTotal(items);";
      docChangeCallback(createMockChangeEvent(docUri, [{ text: insertedText, rangeLength: 0 }]));

      expect(acceptedEvents).toHaveLength(1);
      expect(acceptedEvents[0].snippet).toBe(insertedText);
    });
  });

  describe("dispose", () => {
    it("cleans up without throwing", async () => {
      await tracker.initialize();
      expect(() => tracker.dispose()).not.toThrow();
    });
  });
});
