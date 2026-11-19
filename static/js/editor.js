// CodeMirror 5 factory. No autocompletion (the exam has none); brackets, comment toggle, soft tabs.

export function makeEditor(parent, { value = '', onRun, onSubmit, onChange, minimal = false, lineNumbers = true,
  readOnly = false, label = 'Python code', extraKeys = {} } = {}) {
  const keys = {
    Tab: (cm) => (cm.somethingSelected() ? cm.indentSelection('add') : cm.execCommand('insertSoftTab')),
    'Shift-Tab': (cm) => cm.indentSelection('subtract'),
    'Cmd-/': 'toggleComment',
    'Ctrl-/': 'toggleComment',
    Esc: (cm) => cm.getInputField().blur(),
    ...extraKeys,
  };
  if (onRun) { keys['Cmd-Enter'] = () => onRun(); keys['Ctrl-Enter'] = () => onRun(); }
  if (onSubmit) { keys['Shift-Cmd-Enter'] = () => onSubmit(); keys['Shift-Ctrl-Enter'] = () => onSubmit(); }
  const cm = CodeMirror(parent, {
    value,
    mode: 'python',
    theme: 'study',
    indentUnit: 4,
    tabSize: 4,
    indentWithTabs: false,
    lineNumbers: lineNumbers && !minimal,
    matchBrackets: true,
    autoCloseBrackets: !readOnly,
    readOnly: readOnly ? 'nocursor' : false,
    viewportMargin: Infinity,
    lineWrapping: false,
    extraKeys: keys,
    screenReaderLabel: label,
  });
  cm.getInputField().setAttribute('aria-label', label);
  if (onChange) cm.on('change', () => onChange(cm.getValue()));
  // CodeMirror measures on attach; refresh once laid out.
  requestAnimationFrame(() => cm.refresh());
  return cm;
}
