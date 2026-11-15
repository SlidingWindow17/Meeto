import React, { useEffect, useRef, useState } from "react";
import Editor from "@monaco-editor/react";
import {
  Code2,
  Play,
  RotateCcw,
  X,
  Copy,
  Check,
  Terminal,
  FileCode,
  Clock,
  Cpu,
  ChevronRight,
  FileText,
} from "lucide-react";
import { registerMonacoLanguageProviders } from "./monacoSuggestions";

const LANGUAGES = [
  { id: "cpp", name: "C++ (GCC 9.2.0)", monacoLang: "cpp", fileName: "main.cpp" },
  { id: "java", name: "Java (JDK 17.0.6)", monacoLang: "java", fileName: "Main.java" },
];

const CodeEditorPanel = ({
  isOpen,
  onClose,
  language,
  onLanguageChange,
  code,
  onCodeChange,
  stdin,
  onStdinChange,
  output,
  isRunning,
  onRun,
  remoteCursors,
  myColor,
  onCursorChange,
}) => {
  const editorRef = useRef(null);
  const monacoRef = useRef(null);
  const decorationsCollectionRef = useRef(null);

  const [activeBottomTab, setActiveBottomTab] = useState("output"); // 'input' | 'output'
  const [copied, setCopied] = useState(false);
  const [currentLine, setCurrentLine] = useState(1);
  const [currentCol, setCurrentCol] = useState(1);

  // Switch to output tab automatically when code starts running
  useEffect(() => {
    if (isRunning) {
      setActiveBottomTab("output");
    }
  }, [isRunning]);

  // Handle Monaco editor mount
  const handleEditorDidMount = (editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;

    // Register comprehensive C++ and Java auto-suggestions & snippets
    registerMonacoLanguageProviders(monaco);

    // Track local cursor position changes and report to peers
    editor.onDidChangeCursorPosition((e) => {
      const line = e.position.lineNumber;
      const col = e.position.column;
      setCurrentLine(line);
      setCurrentCol(col);
      if (onCursorChange) {
        onCursorChange(line, col);
      }
    });
  };

  // Synchronize remote peer cursors into Monaco editor decorations
  useEffect(() => {
    if (!editorRef.current || !monacoRef.current) return;
    const monaco = monacoRef.current;
    const editor = editorRef.current;

    const decorations = Object.entries(remoteCursors || {}).map(([id, cursor]) => ({
      range: new monaco.Range(
        cursor.line,
        cursor.column || 1,
        cursor.line,
        cursor.column || 1
      ),
      options: {
        isWholeLine: true,
        className: "remote-peer-line",
        hoverMessage: {
          value: `👤 **${cursor.name || "Peer"}** is editing this line`,
        },
        overviewRuler: {
          color: cursor.color || "#3b82f6",
          position: monaco.editor.OverviewRulerLane.Full,
        },
      },
    }));

    if (editor.createDecorationsCollection) {
      if (!decorationsCollectionRef.current) {
        decorationsCollectionRef.current = editor.createDecorationsCollection(decorations);
      } else {
        decorationsCollectionRef.current.set(decorations);
      }
    }
  }, [remoteCursors]);

  const copyOutput = () => {
    if (!output?.text) return;
    navigator.clipboard.writeText(output.text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (!isOpen) return null;

  const currentLangConfig = LANGUAGES.find((l) => l.id === language) || LANGUAGES[0];
  const currentMonacoLang = currentLangConfig.monacoLang;

  return (
    <aside className="w-full sm:w-[580px] md:w-[680px] h-full bg-white text-slate-800 border-l border-slate-200 flex flex-col z-30 shadow-2xl animate-in slide-in-from-right duration-200 select-none">
      {/* ── Top Bar / Header ── */}
      <div className="px-4 py-2.5 bg-white border-b border-slate-200 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="p-1.5 rounded-xl bg-primary/10 text-primary border border-primary/20">
            <Code2 className="w-4 h-4" />
          </div>
          <div>
            <h3 className="font-semibold text-slate-900 text-sm tracking-tight flex items-center gap-2">
              Collaborative IDE
            </h3>
            <span className="text-[11px] text-slate-500 font-medium">
              Monaco Editor · Auto-Suggest Ready
            </span>
          </div>
        </div>

        {/* Center/Right: Language selector + Run + Close */}
        <div className="flex items-center gap-2">
          {/* Language selector */}
          <div className="relative">
            <select
              value={language}
              onChange={(e) => onLanguageChange(e.target.value)}
              className="appearance-none bg-slate-100 hover:bg-slate-200/70 text-slate-800 text-xs font-semibold py-1.5 pl-3 pr-7 rounded-xl border border-slate-300 focus:outline-none focus:border-primary transition cursor-pointer shadow-2xs"
            >
              {LANGUAGES.map((lang) => (
                <option key={lang.id} value={lang.id} className="bg-white text-slate-800">
                  {lang.name}
                </option>
              ))}
            </select>
            <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-slate-500">
              <svg className="w-3.5 h-3.5 fill-current" viewBox="0 0 20 20">
                <path d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" />
              </svg>
            </div>
          </div>

          {/* Run Button */}
          <button
            onClick={onRun}
            disabled={isRunning}
            className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-semibold text-white shadow-xs transition cursor-pointer disabled:opacity-50 ${
              isRunning
                ? "bg-amber-600 hover:bg-amber-700"
                : "bg-emerald-600 hover:bg-emerald-700 active:scale-98"
            }`}
            title="Compile & Run Code (Ctrl/Cmd + Enter)"
          >
            {isRunning ? (
              <>
                <RotateCcw className="w-3.5 h-3.5 animate-spin" />
                <span>Running...</span>
              </>
            ) : (
              <>
                <Play className="w-3.5 h-3.5 fill-current" />
                <span>Run</span>
              </>
            )}
          </button>

          {/* Close Panel Button */}
          <button
            onClick={onClose}
            className="p-1.5 rounded-xl hover:bg-slate-100 text-slate-500 hover:text-slate-900 transition cursor-pointer"
            title="Close Editor"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* ── Active Peers Presence Bar ── */}
      {Object.keys(remoteCursors || {}).length > 0 && (
        <div className="px-3.5 py-1.5 bg-slate-50 border-b border-slate-200/80 flex items-center gap-2 overflow-x-auto text-[11px]">
          <span className="text-slate-500 font-medium text-[11px]">Active:</span>
          {Object.entries(remoteCursors).map(([id, cursor]) => (
            <span
              key={id}
              className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold border shadow-2xs"
              style={{
                backgroundColor: `${cursor.color}15`,
                borderColor: `${cursor.color}40`,
                color: cursor.color,
              }}
            >
              <span
                className="w-1.5 h-1.5 rounded-full animate-pulse"
                style={{ backgroundColor: cursor.color }}
              />
              {cursor.name} (L{cursor.line})
            </span>
          ))}
        </div>
      )}

      {/* ── VS Code File Tab & Breadcrumbs Header ── */}
      <div className="bg-slate-100/80 border-b border-slate-200 flex flex-col shrink-0">
        {/* File Tabs */}
        <div className="flex items-center px-2 pt-1.5 gap-1 overflow-x-auto">
          <div className="flex items-center gap-2 px-3 py-1.5 bg-white border-t-2 border-primary rounded-t-lg border-x border-slate-200 text-xs font-semibold text-slate-800 shadow-2xs">
            <FileText className="w-3.5 h-3.5 text-primary" />
            <span>{currentLangConfig.fileName}</span>
            <span className="w-2 h-2 rounded-full bg-slate-300 ml-1" />
          </div>
        </div>

        {/* Breadcrumb Path */}
        <div className="px-3 py-1 bg-white border-t border-slate-200 flex items-center gap-1.5 text-[11px] text-slate-500 font-mono">
          <span>src</span>
          <ChevronRight className="w-3 h-3 text-slate-400" />
          <span className="text-slate-800 font-medium">{currentLangConfig.fileName}</span>
        </div>
      </div>

      {/* ── Main Monaco Editor Area ── */}
      <div className="flex-1 flex flex-col min-h-0 bg-white">
        <div className="flex-1 relative overflow-hidden bg-white">
          <Editor
            height="100%"
            language={currentMonacoLang}
            value={code}
            onChange={(val) => onCodeChange(val || "")}
            onMount={handleEditorDidMount}
            theme="vs" // VS Code signature light theme
            options={{
              // Autocomplete & Auto-suggestion configurations
              fixedOverflowWidgets: true, // Enables autocomplete widget to float outside container bounds
              quickSuggestions: {
                other: true,
                comments: false,
                strings: true,
              },
              suggestOnTriggerCharacters: true,
              acceptSuggestionOnEnter: "on",
              tabCompletion: "on",
              snippetSuggestions: "top",
              wordBasedSuggestions: "allDocuments",
              suggest: {
                showWords: true,
                showSnippets: true,
                showKeywords: true,
                showFunctions: true,
                showClasses: true,
                showMethods: true,
                showVariables: true,
                showConstants: true,
                preview: true,
                shareSuggestSelections: true,
              },

              // Code editor visuals & behavior
              minimap: { enabled: true, maxColumn: 45, scale: 1 },
              fontSize: 13,
              lineNumbers: "on",
              lineNumbersMinChars: 3,
              glyphMargin: false,
              folding: true,
              scrollBeyondLastLine: false,
              automaticLayout: true,
              tabSize: 4,
              wordWrap: "on",
              padding: { top: 12, bottom: 12 },
              fontFamily:
                "'Geist Mono', 'Fira Code', Menlo, Monaco, Consolas, monospace",
              fontLigatures: true,
              cursorBlinking: "smooth",
              cursorSmoothCaretAnimation: "on",
              smoothScrolling: true,
              renderLineHighlight: "all",
              bracketPairColorization: { enabled: true },
              guides: {
                bracketPairs: true,
                indentation: true,
              },
              scrollbar: {
                verticalScrollbarSize: 9,
                horizontalScrollbarSize: 9,
              },
            }}
          />
        </div>

        {/* ── Input & Output Section (Tabbed Footer) ── */}
        <div className="h-56 md:h-64 border-t border-slate-200 bg-slate-50 flex flex-col shrink-0">
          {/* IO Header Tabs */}
          <div className="px-3 py-2 bg-slate-100/70 border-b border-slate-200 flex items-center justify-between text-xs">
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setActiveBottomTab("output")}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-medium transition cursor-pointer text-xs ${
                  activeBottomTab === "output"
                    ? "bg-white text-slate-900 shadow-xs border border-slate-300 font-semibold"
                    : "text-slate-600 hover:text-slate-900 hover:bg-slate-200/60"
                }`}
              >
                <Terminal className="w-3.5 h-3.5 text-primary" />
                <span>Output</span>
                {output?.status && (
                  <span
                    className={`ml-1 px-1.5 py-0.5 rounded text-[10px] font-bold ${
                      output.isError
                        ? "bg-rose-50 text-rose-600 border border-rose-200"
                        : "bg-emerald-50 text-emerald-700 border border-emerald-200"
                    }`}
                  >
                    {output.status}
                  </span>
                )}
              </button>

              <button
                onClick={() => setActiveBottomTab("input")}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-medium transition cursor-pointer text-xs ${
                  activeBottomTab === "input"
                    ? "bg-white text-slate-900 shadow-xs border border-slate-300 font-semibold"
                    : "text-slate-600 hover:text-slate-900 hover:bg-slate-200/60"
                }`}
              >
                <FileCode className="w-3.5 h-3.5 text-amber-500" />
                <span>Input (stdin)</span>
                {stdin.trim() && (
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                )}
              </button>
            </div>

            {/* Execution stats & Copy action */}
            {activeBottomTab === "output" && output?.text && (
              <div className="flex items-center gap-3 text-[11px] text-slate-600 font-medium">
                {output.time && (
                  <span className="flex items-center gap-1 bg-white px-2 py-0.5 rounded-md border border-slate-200 shadow-2xs">
                    <Clock className="w-3 h-3 text-slate-400" />
                    {output.time}
                  </span>
                )}
                {output.memory && (
                  <span className="flex items-center gap-1 bg-white px-2 py-0.5 rounded-md border border-slate-200 shadow-2xs">
                    <Cpu className="w-3 h-3 text-slate-400" />
                    {output.memory}
                  </span>
                )}
                <button
                  onClick={copyOutput}
                  className="p-1.5 hover:bg-slate-200/80 rounded-lg text-slate-600 hover:text-slate-900 transition cursor-pointer"
                  title="Copy output"
                >
                  {copied ? (
                    <Check className="w-3.5 h-3.5 text-emerald-600" />
                  ) : (
                    <Copy className="w-3.5 h-3.5" />
                  )}
                </button>
              </div>
            )}
          </div>

          {/* IO Content Body */}
          <div className="flex-1 p-3 overflow-auto font-mono text-xs">
            {activeBottomTab === "input" ? (
              <div className="h-full flex flex-col">
                <textarea
                  value={stdin}
                  onChange={(e) => onStdinChange(e.target.value)}
                  placeholder="Enter inputs here (passed to standard input)..."
                  className="w-full h-full bg-white text-slate-900 p-3 rounded-xl border border-slate-300 outline-none resize-none focus:border-primary shadow-xs font-mono text-xs leading-5 placeholder:text-slate-400"
                />
              </div>
            ) : (
              <div className="h-full">
                {isRunning ? (
                  <div className="h-full flex flex-col items-center justify-center text-slate-500 gap-2">
                    <RotateCcw className="w-5 h-5 text-primary animate-spin" />
                    <p className="text-xs font-medium">Compiling & executing code...</p>
                  </div>
                ) : output?.text ? (
                  <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-xs min-h-full">
                    <pre
                      className={`whitespace-pre-wrap leading-relaxed font-mono ${
                        output.isError ? "text-rose-600" : "text-emerald-700"
                      }`}
                    >
                      {output.text}
                    </pre>
                  </div>
                ) : (
                  <div className="h-full flex flex-col items-center justify-center text-slate-400 text-xs text-center">
                    <p className="font-medium text-slate-500">No output yet.</p>
                    <p className="text-[11px] text-slate-400 mt-1">
                      Click "Run" above to compile & execute your code.
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Status Bar ── */}
      <div className="px-4 py-2 bg-slate-50 border-t border-slate-200 flex items-center justify-between text-[11px] text-slate-500 shrink-0 font-medium">
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1.5">
            <span
              className="w-2 h-2 rounded-full shadow-xs"
              style={{ backgroundColor: myColor }}
            />
            Ln {currentLine}, Col {currentCol}
          </span>
          <span>·</span>
          <span>Spaces: 4</span>
          <span>·</span>
          <span>{currentLangConfig.name}</span>
        </div>
        <div className="flex items-center gap-2">
          <span>UTF-8</span>
          <span>·</span>
          <span className="text-emerald-600 font-semibold flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block" />
            Ready
          </span>
        </div>
      </div>
    </aside>
  );
};

export default CodeEditorPanel;
