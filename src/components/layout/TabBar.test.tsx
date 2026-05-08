import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DragProvider, useDragContext } from '../../contexts/DragContext';
import { useEditorStore } from '../../store/editorStore';
import { useUiStore } from '../../store/uiStore';
import TabBar from './TabBar';

describe('TabBar middle click', () => {
  beforeEach(() => {
    useEditorStore.setState({
      sessionVaultPath: '/vault',
      openTabs: [
        { relativePath: 'Notes/a.md', title: 'a', isDirty: false, savedHash: null, type: 'note' },
        { relativePath: 'Notes/b.md', title: 'b', isDirty: false, savedHash: null, type: 'note' },
      ],
      activeTabPath: 'Notes/a.md',
      forceReloadPath: null,
    });

    useUiStore.setState({
      activeView: 'editor',
    });
  });

  it('closes a tab on middle click', () => {
    render(
      <DragProvider>
        <TabBar />
      </DragProvider>,
    );

    fireEvent.mouseDown(screen.getByText('a'), { button: 1 });

    expect(useEditorStore.getState().openTabs.map((tab) => tab.relativePath)).toEqual(['Notes/b.md']);
    expect(useEditorStore.getState().activeTabPath).toBe('Notes/b.md');
  });

  it('starts a native drag without requiring a custom drag image', () => {
    const dataTransfer = {
      setData: vi.fn(),
      effectAllowed: '',
    };

    function DragStateProbe() {
      const { draggingTab } = useDragContext();
      return <div data-testid="drag-state">{draggingTab?.relativePath ?? 'none'}</div>;
    }

    render(
      <DragProvider>
        <TabBar />
        <DragStateProbe />
      </DragProvider>,
    );

    fireEvent.dragStart(screen.getByText('a').closest('[draggable="true"]')!, { dataTransfer });

    expect(dataTransfer.setData).toHaveBeenCalledWith('text/plain', 'Notes/a.md');
    expect(dataTransfer.setData).toHaveBeenCalledWith(
      'application/x-collab-tab',
      JSON.stringify({
        relativePath: 'Notes/a.md',
        title: 'a',
        type: 'note',
      }),
    );
    expect(dataTransfer.effectAllowed).toBe('move');
    expect(screen.getByTestId('drag-state').textContent).toBe('Notes/a.md');
  });
});
