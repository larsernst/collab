import { EditorSelection, type Extension } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';

import { insertSnippetTemplate } from './snippetEngine';

export type MathBlockRange = {
  from: number;
  to: number;
  innerFrom: number;
  innerTo: number;
  text: string;
};

type MathSnippetCommand = {
  key: string;
  run: (view: EditorView) => boolean;
};

function isMathDelimiterLine(text: string) {
  return text.trim() === '$$';
}

export function getMathBlockAtPosition(view: EditorView, position: number): MathBlockRange | null {
  const lineAtPosition = view.state.doc.lineAt(position);
  const delimiterLines: number[] = [];

  for (let lineNumber = 1; lineNumber <= view.state.doc.lines; lineNumber += 1) {
    if (isMathDelimiterLine(view.state.doc.line(lineNumber).text)) {
      delimiterLines.push(lineNumber);
    }
  }

  for (let index = 0; index < delimiterLines.length - 1; index += 2) {
    const startLineNumber = delimiterLines[index];
    const endLineNumber = delimiterLines[index + 1];
    if (lineAtPosition.number < startLineNumber || lineAtPosition.number > endLineNumber) continue;

    const startLine = view.state.doc.line(startLineNumber);
    const endLine = view.state.doc.line(endLineNumber);
    const innerFrom = startLineNumber < endLineNumber ? view.state.doc.line(startLineNumber + 1).from : startLine.to;
    const innerTo = endLineNumber > startLineNumber ? view.state.doc.line(endLineNumber - 1).to : startLine.to;

    return {
      from: startLine.from,
      to: endLine.to,
      innerFrom,
      innerTo,
      text: innerFrom <= innerTo ? view.state.sliceDoc(innerFrom, innerTo) : '',
    };
  }

  return null;
}

export function getActiveMathBlock(view: EditorView): MathBlockRange | null {
  const selection = view.state.selection.main;
  const block = getMathBlockAtPosition(view, selection.from);
  if (!block) return null;
  if (selection.to > block.to) return null;
  return block;
}

function clampRangeToMathInner(view: EditorView, block: MathBlockRange) {
  const selection = view.state.selection.main;
  const from = Math.min(Math.max(selection.from, block.innerFrom), block.innerTo);
  const to = Math.min(Math.max(selection.to, block.innerFrom), block.innerTo);
  return {
    from,
    to,
  };
}

function getMathTokenBeforeCursor(view: EditorView, block: MathBlockRange) {
  const selection = view.state.selection.main;
  if (!selection.empty || selection.from <= block.innerFrom) return null;

  const line = view.state.doc.lineAt(selection.from);
  const fromLimit = Math.max(line.from, block.innerFrom);
  const beforeCursor = view.state.sliceDoc(fromLimit, selection.from);
  const match = beforeCursor.match(/\S+$/);
  if (!match || match.index === undefined) return null;

  return {
    from: fromLimit + match.index,
    to: selection.from,
  };
}

function getMathCommandRange(view: EditorView, block: MathBlockRange) {
  const range = clampRangeToMathInner(view, block);
  if (range.from < range.to) return range;
  return getMathTokenBeforeCursor(view, block) ?? range;
}

function selectedMathText(view: EditorView, range: { from: number; to: number }) {
  return range.from < range.to ? view.state.sliceDoc(range.from, range.to) : '';
}

function insertMathTemplate(
  view: EditorView,
  buildTemplate: (selected: string) => string,
) {
  const block = getActiveMathBlock(view);
  if (!block) return false;

  const range = getMathCommandRange(view, block);
  const selected = selectedMathText(view, range);
  insertSnippetTemplate(view, buildTemplate(selected), range);
  return true;
}

export function insertMathFraction(view: EditorView) {
  return insertMathTemplate(view, (selected) => (
    selected
      ? `\\frac{${selected}}{<placeholder:denominator>}<cursor>`
      : '\\frac{<placeholder:numerator>}{<placeholder:denominator>}<cursor>'
  ));
}

export function insertMathRoot(view: EditorView) {
  return insertMathTemplate(view, (selected) => (
    selected
      ? `\\sqrt{${selected}}<cursor>`
      : '\\sqrt{<placeholder:radicand>}<cursor>'
  ));
}

export function insertMathSuperscript(view: EditorView) {
  return insertMathTemplate(view, (selected) => (
    selected
      ? `{${selected}}^{<placeholder:power>}<cursor>`
      : '<placeholder:base>^{<placeholder:power>}<cursor>'
  ));
}

export function insertMathSubscript(view: EditorView) {
  return insertMathTemplate(view, (selected) => (
    selected
      ? `{${selected}}_{<placeholder:index>}<cursor>`
      : '<placeholder:base>_{<placeholder:index>}<cursor>'
  ));
}

export function insertMathSum(view: EditorView) {
  return insertMathTemplate(view, (selected) => (
    selected
      ? `\\sum_{<placeholder:i=1>}^{<placeholder:n>} ${selected}<cursor>`
      : '\\sum_{<placeholder:i=1>}^{<placeholder:n>} <placeholder:expression><cursor>'
  ));
}

export function insertMathIntegral(view: EditorView) {
  return insertMathTemplate(view, (selected) => (
    selected
      ? `\\int_{<placeholder:a>}^{<placeholder:b>} ${selected}\\, d<placeholder:x><cursor>`
      : '\\int_{<placeholder:a>}^{<placeholder:b>} <placeholder:integrand>\\, d<placeholder:x><cursor>'
  ));
}

export function insertMathMatrix(view: EditorView) {
  return insertMathTemplate(view, () => (
    '\\begin{bmatrix}\n'
    + '<placeholder:a_{11}> & <placeholder:a_{12}> \\\\\n'
    + '<placeholder:a_{21}> & <placeholder:a_{22}>\n'
    + '\\end{bmatrix}<cursor>'
  ));
}

export function selectMathBlockContents(view: EditorView) {
  const block = getActiveMathBlock(view);
  if (!block) return false;
  view.dispatch({
    selection: EditorSelection.single(block.innerFrom, block.innerTo),
    scrollIntoView: true,
  });
  view.focus();
  return true;
}

export function createMathBlockShortcutExtension(): Extension {
  const commands: MathSnippetCommand[] = [
    { key: 'Mod-Alt-f', run: insertMathFraction },
    { key: 'Mod-Alt-r', run: insertMathRoot },
    { key: 'Mod-Alt-p', run: insertMathSuperscript },
    { key: 'Mod-Alt-u', run: insertMathSubscript },
    { key: 'Mod-Alt-g', run: insertMathSum },
    { key: 'Mod-Alt-e', run: insertMathIntegral },
    { key: 'Mod-Alt-x', run: insertMathMatrix },
    { key: 'Mod-Alt-a', run: selectMathBlockContents },
  ];

  return keymap.of(commands);
}
