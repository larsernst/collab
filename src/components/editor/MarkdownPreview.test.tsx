import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { useUiStore } from '../../store/uiStore';
import { MarkdownPreview } from './MarkdownPreview';

describe('MarkdownPreview', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders display math plot directives as preview widgets', async () => {
    useUiStore.setState({
      webPreviewsEnabled: false,
      hoverWebLinkPreviewsEnabled: false,
      backgroundWebPreviewPrefetchEnabled: false,
    });

    render(
      <MarkdownPreview
        content={'$$\n%plot2d x=-10..10, samples=60\ny=\\sin(x)\n$$'}
      />,
    );

    expect(await screen.findByText('2D plot')).toBeTruthy();
    expect(screen.getByText('y = \\sin(x)')).toBeTruthy();
  });
});
