import * as vscode from "vscode";
import { EditorActivityTracker } from "../../services/editorActivityTracker";
import { EditorActivityMetadata } from "../../types";

describe("EditorActivityTracker", () => {
  let tracker: EditorActivityTracker;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
    jest.useFakeTimers();
    tracker = new EditorActivityTracker(5);
  });

  afterEach(() => {
    tracker.dispose();
    jest.useRealTimers();
  });

  function getOnOpenCallback(): (doc: any) => void {
    return (vscode.workspace.onDidOpenTextDocument as jest.Mock).mock.calls[0][0];
  }

  function getOnChangeCallback(): (event: any) => void {
    return (vscode.workspace.onDidChangeTextDocument as jest.Mock).mock.calls[0][0];
  }

  function getOnSaveCallback(): (doc: any) => void {
    return (vscode.workspace.onDidSaveTextDocument as jest.Mock).mock.calls[0][0];
  }

  function getOnCloseCallback(): (doc: any) => void {
    return (vscode.workspace.onDidCloseTextDocument as jest.Mock).mock.calls[0][0];
  }

  function makeFileDoc(overrides: Partial<{ scheme: string; fileName: string; languageId: string; lineCount: number }> = {}) {
    const scheme = overrides.scheme ?? "file";
    const fileName = overrides.fileName ?? "/workspace/src/index.ts";
    const uri = scheme === "file"
      ? vscode.Uri.file(fileName)
      : vscode.Uri.parse(`${scheme}://${fileName}`);
    return {
      uri,
      fileName,
      languageId: overrides.languageId ?? "typescript",
      lineCount: overrides.lineCount ?? 50,
    };
  }

  function makeChangeEvent(doc: any, changes: Array<{ text: string; rangeLength: number; startLine: number; endLine: number }>) {
    return {
      document: doc,
      contentChanges: changes.map((c) => ({
        text: c.text,
        rangeLength: c.rangeLength,
        range: {
          start: { line: c.startLine, character: 0 },
          end: { line: c.endLine, character: c.rangeLength },
        },
      })),
    };
  }

  describe("initialize", () => {
    it("registers all event listeners", () => {
      tracker.initialize();

      expect(vscode.workspace.onDidOpenTextDocument).toHaveBeenCalledTimes(1);
      expect(vscode.workspace.onDidChangeTextDocument).toHaveBeenCalledTimes(1);
      expect(vscode.workspace.onDidSaveTextDocument).toHaveBeenCalledTimes(1);
      expect(vscode.workspace.onDidCloseTextDocument).toHaveBeenCalledTimes(1);
      expect(vscode.window.onDidChangeActiveTextEditor).toHaveBeenCalledTimes(1);
      expect(vscode.window.onDidChangeTextEditorSelection).toHaveBeenCalledTimes(1);
    });
  });

  describe("file open", () => {
    it("fires onFileOpened and creates metrics entry", () => {
      tracker.initialize();

      const events: EditorActivityMetadata[] = [];
      tracker.onFileOpened((e) => events.push(e));

      const doc = makeFileDoc();
      getOnOpenCallback()(doc);

      expect(events).toHaveLength(1);
      expect(events[0].language).toBe("typescript");
      expect(events[0].linesAdded).toBe(0);
      expect(events[0].linesRemoved).toBe(0);
      expect(events[0].activeTimeMs).toBe(0);
    });

    it("ignores non-file scheme documents", () => {
      tracker.initialize();

      const events: EditorActivityMetadata[] = [];
      tracker.onFileOpened((e) => events.push(e));

      getOnOpenCallback()(makeFileDoc({ scheme: "output" }));

      expect(events).toHaveLength(0);
    });

    it("creates file metrics entry", () => {
      tracker.initialize();

      const doc = makeFileDoc();
      getOnOpenCallback()(doc);

      const relativePath = vscode.workspace.asRelativePath(doc.uri, false);
      const metrics = tracker.getFileMetrics(relativePath);

      expect(metrics).toBeDefined();
      expect(metrics!.language).toBe("typescript");
      expect(metrics!.linesAdded).toBe(0);
    });
  });

  describe("document change", () => {
    it("accumulates lines added", () => {
      tracker.initialize();

      const doc = makeFileDoc({ lineCount: 50 });
      getOnOpenCallback()(doc);

      const linesChanged: Array<{ linesAdded: number; linesRemoved: number }> = [];
      tracker.onLinesChanged((e) => linesChanged.push(e));

      getOnChangeCallback()(makeChangeEvent(doc, [
        { text: "line1\nline2\nline3", rangeLength: 0, startLine: 10, endLine: 10 },
      ]));

      expect(linesChanged).toHaveLength(1);
      expect(linesChanged[0].linesAdded).toBe(2);
      expect(linesChanged[0].linesRemoved).toBe(0);
    });

    it("accumulates lines removed", () => {
      tracker.initialize();

      const doc = makeFileDoc();
      getOnOpenCallback()(doc);

      const linesChanged: Array<{ linesAdded: number; linesRemoved: number }> = [];
      tracker.onLinesChanged((e) => linesChanged.push(e));

      getOnChangeCallback()(makeChangeEvent(doc, [
        { text: "", rangeLength: 0, startLine: 5, endLine: 8 },
      ]));

      expect(linesChanged).toHaveLength(1);
      expect(linesChanged[0].linesRemoved).toBe(3);
      expect(linesChanged[0].linesAdded).toBe(0);
    });

    it("tracks character delta", () => {
      tracker.initialize();

      const doc = makeFileDoc();
      getOnOpenCallback()(doc);

      getOnChangeCallback()(makeChangeEvent(doc, [
        { text: "hello world", rangeLength: 5, startLine: 1, endLine: 1 },
      ]));

      const relativePath = vscode.workspace.asRelativePath(doc.uri, false);
      const metrics = tracker.getFileMetrics(relativePath);
      expect(metrics!.charactersDelta).toBe(6);
    });

    it("ignores non-file scheme documents", () => {
      tracker.initialize();

      const linesChanged: Array<{ linesAdded: number }> = [];
      tracker.onLinesChanged((e) => linesChanged.push(e));

      const doc = makeFileDoc({ scheme: "output" });
      getOnChangeCallback()(makeChangeEvent(doc, [
        { text: "new\nlines", rangeLength: 0, startLine: 0, endLine: 0 },
      ]));

      expect(linesChanged).toHaveLength(0);
    });

    it("does not fire onLinesChanged when no lines are added or removed", () => {
      tracker.initialize();

      const doc = makeFileDoc();
      getOnOpenCallback()(doc);

      const linesChanged: Array<{ linesAdded: number }> = [];
      tracker.onLinesChanged((e) => linesChanged.push(e));

      getOnChangeCallback()(makeChangeEvent(doc, [
        { text: "x", rangeLength: 1, startLine: 1, endLine: 1 },
      ]));

      expect(linesChanged).toHaveLength(0);
    });
  });

  describe("file save", () => {
    it("fires onFileSaved with accumulated metrics", () => {
      tracker.initialize();

      const doc = makeFileDoc();
      getOnOpenCallback()(doc);

      getOnChangeCallback()(makeChangeEvent(doc, [
        { text: "a\nb\nc", rangeLength: 0, startLine: 1, endLine: 1 },
      ]));

      const savedEvents: EditorActivityMetadata[] = [];
      tracker.onFileSaved((e) => savedEvents.push(e));

      getOnSaveCallback()(doc);

      expect(savedEvents).toHaveLength(1);
      expect(savedEvents[0].linesAdded).toBe(2);
      expect(savedEvents[0].language).toBe("typescript");
    });

    it("ignores non-file scheme documents", () => {
      tracker.initialize();

      const savedEvents: EditorActivityMetadata[] = [];
      tracker.onFileSaved((e) => savedEvents.push(e));

      getOnSaveCallback()(makeFileDoc({ scheme: "output" }));

      expect(savedEvents).toHaveLength(0);
    });
  });

  describe("file close", () => {
    it("fires onFileClosed and removes from tracking", () => {
      tracker.initialize();

      const doc = makeFileDoc();
      getOnOpenCallback()(doc);

      const closedEvents: EditorActivityMetadata[] = [];
      tracker.onFileClosed((e) => closedEvents.push(e));

      getOnCloseCallback()(doc);

      expect(closedEvents).toHaveLength(1);
      expect(closedEvents[0].language).toBe("typescript");

      const relativePath = vscode.workspace.asRelativePath(doc.uri, false);
      expect(tracker.getFileMetrics(relativePath)).toBeUndefined();
    });

    it("ignores non-file scheme documents", () => {
      tracker.initialize();

      const closedEvents: EditorActivityMetadata[] = [];
      tracker.onFileClosed((e) => closedEvents.push(e));

      getOnCloseCallback()(makeFileDoc({ scheme: "output" }));

      expect(closedEvents).toHaveLength(0);
    });

    it("does nothing if file was not tracked", () => {
      tracker.initialize();

      const closedEvents: EditorActivityMetadata[] = [];
      tracker.onFileClosed((e) => closedEvents.push(e));

      getOnCloseCallback()(makeFileDoc({ fileName: "/workspace/src/unknown.ts" }));

      expect(closedEvents).toHaveLength(0);
    });
  });

  describe("idle detection", () => {
    it("fires onIdleStart after configured timeout", () => {
      tracker.initialize();

      let idleStartCount = 0;
      tracker.onIdleStart(() => { idleStartCount++; });

      jest.advanceTimersByTime(5 * 60 * 1000);

      expect(idleStartCount).toBe(1);
    });

    it("does not fire onIdleStart before timeout", () => {
      tracker.initialize();

      let idleStartCount = 0;
      tracker.onIdleStart(() => { idleStartCount++; });

      jest.advanceTimersByTime(4 * 60 * 1000);

      expect(idleStartCount).toBe(0);
    });

    it("fires onIdleEnd when activity resumes after idle", () => {
      tracker.initialize();

      const idleEndEvents: Array<{ idleDurationMs: number }> = [];
      tracker.onIdleEnd((e) => idleEndEvents.push(e));

      jest.advanceTimersByTime(5 * 60 * 1000);

      const doc = makeFileDoc();
      getOnOpenCallback()(doc);

      expect(idleEndEvents).toHaveLength(1);
      expect(idleEndEvents[0].idleDurationMs).toBeGreaterThan(0);
    });

    it("resets idle timer on activity", () => {
      tracker.initialize();

      let idleStartCount = 0;
      tracker.onIdleStart(() => { idleStartCount++; });

      jest.advanceTimersByTime(4 * 60 * 1000);

      const doc = makeFileDoc();
      getOnOpenCallback()(doc);

      jest.advanceTimersByTime(4 * 60 * 1000);

      expect(idleStartCount).toBe(0);
    });
  });

  describe("getAggregateMetrics", () => {
    it("sums metrics across all tracked files", () => {
      tracker.initialize();

      const doc1 = makeFileDoc({ fileName: "/workspace/src/a.ts" });
      const doc2 = makeFileDoc({ fileName: "/workspace/src/b.ts", languageId: "javascript" });

      getOnOpenCallback()(doc1);
      getOnOpenCallback()(doc2);

      getOnChangeCallback()(makeChangeEvent(doc1, [
        { text: "a\nb", rangeLength: 0, startLine: 0, endLine: 0 },
      ]));
      getOnChangeCallback()(makeChangeEvent(doc2, [
        { text: "x\ny\nz", rangeLength: 0, startLine: 0, endLine: 0 },
      ]));

      const agg = tracker.getAggregateMetrics();
      expect(agg.totalLinesAdded).toBe(3);
      expect(agg.filesTracked).toBe(2);
      expect(agg.languageCounts["typescript"]).toBe(1);
      expect(agg.languageCounts["javascript"]).toBe(1);
    });

    it("returns zeros when no files tracked", () => {
      tracker.initialize();

      const agg = tracker.getAggregateMetrics();
      expect(agg.totalLinesAdded).toBe(0);
      expect(agg.totalLinesRemoved).toBe(0);
      expect(agg.filesTracked).toBe(0);
    });
  });

  describe("updateConfig", () => {
    it("changes idle timeout", () => {
      tracker.initialize();

      let idleStartCount = 0;
      tracker.onIdleStart(() => { idleStartCount++; });

      tracker.updateConfig(1);

      jest.advanceTimersByTime(1 * 60 * 1000);

      expect(idleStartCount).toBe(1);
    });
  });

  describe("dispose", () => {
    it("cleans up timers and emitters without throwing", () => {
      tracker.initialize();
      expect(() => tracker.dispose()).not.toThrow();
    });
  });
});
