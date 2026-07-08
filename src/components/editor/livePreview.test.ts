import { describe, expect, it } from 'vitest';

import {
  buildTaskCheckboxToggleChange,
  collectInlinePreviewDebugItems,
  renderInlineTableCellHtml,
} from './livePreview';

describe('livePreview task checkbox toggles', () => {
  it('toggles unchecked tasks without forcing a new selection', () => {
    expect(buildTaskCheckboxToggleChange(10, 13, false)).toEqual({
      changes: {
        from: 10,
        to: 13,
        insert: '[x]',
      },
    });
  });

  it('toggles checked tasks back to unchecked without forcing a new selection', () => {
    expect(buildTaskCheckboxToggleChange(10, 13, true)).toEqual({
      changes: {
        from: 10,
        to: 13,
        insert: '[ ]',
      },
    });
  });

  it('renders inline markdown inside table cells', () => {
    expect(renderInlineTableCellHtml('**bold** and `code`')).toContain('<strong>bold</strong>');
    expect(renderInlineTableCellHtml('**bold** and `code`')).toContain('<code>code</code>');
  });

  it('decorates italic nested inside bold', () => {
    const marks = collectInlinePreviewDebugItems('**bold *italic* bold**')
      .filter((item) => item.kind === 'mark')
      .map((item) => ({ from: item.from, to: item.to, className: item.className }));

    expect(marks).toContainEqual({ from: 2, to: 20, className: 'cm-lp-strong' });
    expect(marks).toContainEqual({ from: 8, to: 14, className: 'cm-lp-em' });
  });

  it('decorates bold nested inside italic', () => {
    const marks = collectInlinePreviewDebugItems('*italic **bold** italic*')
      .filter((item) => item.kind === 'mark')
      .map((item) => ({ from: item.from, to: item.to, className: item.className }));

    expect(marks).toContainEqual({ from: 1, to: 23, className: 'cm-lp-em' });
    expect(marks).toContainEqual({ from: 10, to: 14, className: 'cm-lp-strong' });
  });

  it('keeps inline math active inside bold text', () => {
    const items = collectInlinePreviewDebugItems('**value $x+1$ now**');

    expect(items).toContainEqual(expect.objectContaining({
      from: 2,
      to: 17,
      kind: 'mark',
      className: 'cm-lp-strong',
    }));
    expect(items).toContainEqual(expect.objectContaining({
      from: 8,
      to: 13,
      kind: 'widget',
      widget: 'MathWidget',
    }));
  });

  it('keeps emphasis markers inside inline code raw', () => {
    const marks = collectInlinePreviewDebugItems('`*not italic*` and *italic*')
      .filter((item) => item.kind === 'mark')
      .map((item) => item.className);

    expect(marks.filter((className) => className === 'cm-lp-em')).toHaveLength(1);
    expect(marks).toContain('cm-lp-icode');
  });
});
