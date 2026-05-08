import { describe, expect, it } from 'vitest';

import { buildTaskCheckboxToggleChange, renderInlineTableCellHtml } from './livePreview';

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
});
