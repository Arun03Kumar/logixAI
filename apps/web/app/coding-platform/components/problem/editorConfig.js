// Shared Monaco settings so every editor (IDE, code-stub authoring) matches.
// The editor is always dark, whatever the page theme.

/** The mono font family next/font registered as --font-jetbrains. */
function monoFontFamily() {
  if (typeof window === "undefined") return "monospace";
  const family = getComputedStyle(document.documentElement)
    .getPropertyValue("--font-jetbrains")
    .trim();
  return family ? `${family}, monospace` : "monospace";
}

export function editorOptions(overrides = {}) {
  return {
    fontFamily: monoFontFamily(),
    fontSize: 13.5,
    lineHeight: 21,
    fontLigatures: false,
    minimap: { enabled: false },
    wordWrap: "on",
    automaticLayout: true,
    scrollBeyondLastLine: false,
    padding: { top: 12, bottom: 12 },
    renderLineHighlight: "line",
    smoothScrolling: true,
    tabSize: 4,
    ...overrides,
  };
}

/** Re-measure glyphs once the web font has loaded, or columns drift. */
export function handleEditorMount(editor, monaco) {
  if (typeof document !== "undefined" && document.fonts?.ready) {
    document.fonts.ready.then(() => monaco?.editor?.remeasureFonts?.());
  }
}

/**
 * JavaScript / JSX editing (ML Arena frontend problems, the playground):
 * understand JSX, and keep syntax errors but drop "cannot find module 'react'"
 * style type errors, since the editor has no type definitions.
 */
export function configureJsx(monaco) {
  const js = monaco?.languages?.typescript?.javascriptDefaults;
  if (!js) return;
  js.setCompilerOptions({
    ...js.getCompilerOptions(),
    jsx: monaco.languages.typescript.JsxEmit.ReactJSX,
    allowJs: true,
    allowNonTsExtensions: true,
    target: monaco.languages.typescript.ScriptTarget.ES2022,
    module: monaco.languages.typescript.ModuleKind.ESNext,
  });
  js.setDiagnosticsOptions({ noSemanticValidation: true, noSyntaxValidation: false });
}
