/**
 * Comprehensive mock for the `vscode` module.
 *
 * Each VS Code API surface used by the extension is stubbed here so tests
 * can run outside of the VS Code host process.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

export class EventEmitter<T> {
  private listeners: Array<(e: T) => void> = [];

  event = (listener: (e: T) => void) => {
    this.listeners.push(listener);
    return { dispose: () => { this.listeners = this.listeners.filter((l) => l !== listener); } };
  };

  fire(data: T): void {
    for (const listener of this.listeners) {
      listener(data);
    }
  }

  dispose(): void {
    this.listeners = [];
  }
}

export class Uri {
  readonly scheme: string;
  readonly fsPath: string;

  private constructor(scheme: string, fsPath: string) {
    this.scheme = scheme;
    this.fsPath = fsPath;
  }

  toString(): string {
    return `${this.scheme}://${this.fsPath}`;
  }

  static file(path: string): Uri {
    return new Uri("file", path);
  }

  static parse(value: string): Uri {
    const doubleSlash = value.indexOf("://");
    if (doubleSlash !== -1) {
      return new Uri(value.substring(0, doubleSlash), value.substring(doubleSlash + 3));
    }
    const colon = value.indexOf(":");
    if (colon !== -1) {
      return new Uri(value.substring(0, colon), value.substring(colon + 1));
    }
    return new Uri("file", value);
  }

  static joinPath(base: Uri, ...pathSegments: string[]): Uri {
    return new Uri(base.scheme, [base.fsPath, ...pathSegments].join("/"));
  }
}

export class ThemeColor {
  constructor(public id: string) {}
}

export class ThemeIcon {
  constructor(public id: string) {}
}

export enum StatusBarAlignment {
  Left = 1,
  Right = 2,
}

export enum TreeItemCollapsibleState {
  None = 0,
  Collapsed = 1,
  Expanded = 2,
}

export class TreeItem {
  label?: string;
  description?: string;
  iconPath?: any;
  collapsibleState?: TreeItemCollapsibleState;
  command?: any;

  constructor(label: string, collapsibleState?: TreeItemCollapsibleState) {
    this.label = label;
    this.collapsibleState = collapsibleState;
  }
}

export enum InlineCompletionTriggerKind {
  Invoke = 0,
  Automatic = 1,
}

export class Position {
  constructor(public line: number, public character: number) {}
}

export class Range {
  constructor(public start: Position, public end: Position) {}
}

function createStatusBarItem() {
  return {
    text: "",
    tooltip: "",
    command: "",
    color: undefined as any,
    backgroundColor: undefined as any,
    show: jest.fn(),
    hide: jest.fn(),
    dispose: jest.fn(),
  };
}

export const window = {
  createStatusBarItem: jest.fn(() => createStatusBarItem()),
  createWebviewPanel: jest.fn(() => ({
    webview: {
      html: "",
      onDidReceiveMessage: jest.fn(),
      postMessage: jest.fn(),
      asWebviewUri: jest.fn((uri: Uri) => uri),
      cspSource: "mock-csp",
    },
    onDidDispose: jest.fn(),
    reveal: jest.fn(),
    dispose: jest.fn(),
    visible: true,
  })),
  showInputBox: jest.fn(),
  showInformationMessage: jest.fn(),
  showWarningMessage: jest.fn(),
  showQuickPick: jest.fn(),
  registerTreeDataProvider: jest.fn(),
  onDidChangeActiveTextEditor: jest.fn(() => ({ dispose: jest.fn() })),
  onDidChangeTextEditorSelection: jest.fn(() => ({ dispose: jest.fn() })),
  activeTextEditor: undefined as any,
};

export const workspace = {
  getConfiguration: jest.fn(() => ({
    get: jest.fn((key: string, defaultValue?: any) => defaultValue),
  })),
  onDidChangeConfiguration: jest.fn(() => ({ dispose: jest.fn() })),
  onDidOpenTextDocument: jest.fn(() => ({ dispose: jest.fn() })),
  onDidChangeTextDocument: jest.fn(() => ({ dispose: jest.fn() })),
  onDidSaveTextDocument: jest.fn(() => ({ dispose: jest.fn() })),
  onDidCloseTextDocument: jest.fn(() => ({ dispose: jest.fn() })),
  asRelativePath: jest.fn((pathOrUri: any) => {
    const p = typeof pathOrUri === "string" ? pathOrUri : pathOrUri?.fsPath || String(pathOrUri);
    return p.split("/").pop() || p;
  }),
  workspaceFolders: [{ uri: Uri.file("/mock/workspace") }],
  name: "mock-workspace",
  fs: {
    createDirectory: jest.fn(() => Promise.resolve()),
    writeFile: jest.fn(() => Promise.resolve()),
    readFile: jest.fn(() => Promise.resolve(Buffer.from("{}"))),
    stat: jest.fn(() => Promise.resolve({ type: 1 })),
  },
};

export const commands = {
  registerCommand: jest.fn((_id: string, _cb: (...args: any[]) => any) => ({
    dispose: jest.fn(),
  })),
  executeCommand: jest.fn(() => Promise.resolve()),
};

export const languages = {
  registerInlineCompletionItemProvider: jest.fn(() => ({ dispose: jest.fn() })),
};

export const extensions = {
  getExtension: jest.fn(() => undefined),
};

export const env = {
  machineId: "mock-machine-id-12345678",
};

export const version = "1.85.0";

export enum ViewColumn {
  Beside = -2,
}

export class Disposable {
  static from(...disposables: { dispose: () => void }[]): Disposable {
    return new Disposable(() => disposables.forEach((d) => d.dispose()));
  }
  constructor(private callOnDispose: () => void) {}
  dispose(): void {
    this.callOnDispose();
  }
}
