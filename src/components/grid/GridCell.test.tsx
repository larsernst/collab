import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import GridCell from './GridCell';
import { useGridStore, type GridCell as GridCellType } from '../../store/gridStore';
import { useVaultStore } from '../../store/vaultStore';

const canvasPageMock = vi.fn();
const kanbanPageMock = vi.fn();

vi.mock('../../views/CanvasPage', () => ({
  default: (props: { relativePath: string }) => {
    canvasPageMock(props);
    return <div data-testid="canvas-page">{props.relativePath}</div>;
  },
}));

vi.mock('../../views/KanbanPage', () => ({
  default: (props: { relativePath: string }) => {
    kanbanPageMock(props);
    return <div data-testid="kanban-page">{props.relativePath}</div>;
  },
}));

vi.mock('../../views/NoteView', () => ({
  default: () => <div data-testid="note-view" />,
}));

vi.mock('../../views/GraphPage', () => ({
  default: () => <div data-testid="graph-page" />,
}));

vi.mock('../../views/SettingsPage', () => ({
  default: () => <div data-testid="settings-page" />,
}));

describe('GridCell', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useGridStore.setState({
      workspaces: [],
      activeWorkspaceId: 'default',
      createWorkspace: vi.fn(),
      deleteWorkspace: vi.fn(),
      renameWorkspace: vi.fn(),
      setActiveWorkspace: vi.fn(),
      setLayout: vi.fn(),
      setCellContent: vi.fn(),
      swapCells: vi.fn(),
      reorderCells: vi.fn(),
      clearCell: vi.fn(),
      activateSplit: vi.fn(),
    });
    useVaultStore.setState({
      vault: null,
      isVaultLocked: false,
      fileTree: [
        {
          relativePath: 'Boards',
          name: 'Boards',
          extension: '',
          modifiedAt: 0,
          size: 0,
          isFolder: true,
          children: [
            {
              relativePath: 'Boards/network.canvas',
              name: 'network.canvas',
              extension: 'canvas',
              modifiedAt: 0,
              size: 1,
              isFolder: false,
            },
            {
              relativePath: 'Boards/tasks.kanban',
              name: 'tasks.kanban',
              extension: 'kanban',
              modifiedAt: 0,
              size: 1,
              isFolder: false,
            },
          ],
        },
      ],
      recentVaults: [],
      lastOpenedVaultPath: null,
      isLoading: false,
    });
  });

  it('renders canvas cells with their board path', () => {
    const cell: GridCellType = {
      id: 'cell-1',
      content: {
        type: 'canvas',
        relativePath: 'Boards/network.canvas',
        title: 'Network',
      },
    };

    render(<GridCell cell={cell} />);

    expect(canvasPageMock).toHaveBeenCalledWith(
      expect.objectContaining({ relativePath: 'Boards/network.canvas' }),
    );
    expect(screen.getByTestId('canvas-page').textContent).toContain('Boards/network.canvas');
  });

  it('renders kanban cells with their board path', () => {
    const cell: GridCellType = {
      id: 'cell-2',
      content: {
        type: 'kanban',
        relativePath: 'Boards/tasks.kanban',
        title: 'Tasks',
      },
    };

    render(<GridCell cell={cell} />);

    expect(kanbanPageMock).toHaveBeenCalledWith(
      expect.objectContaining({ relativePath: 'Boards/tasks.kanban' }),
    );
    expect(screen.getByTestId('kanban-page').textContent).toContain('Boards/tasks.kanban');
  });

  it('accepts dragged vault board files into a cell', () => {
    const setCellContent = vi.fn();
    useGridStore.setState((state) => ({
      ...state,
      setCellContent,
    }));

    const cell: GridCellType = {
      id: 'cell-3',
      content: {
        type: 'empty',
        relativePath: null,
        title: '',
      },
    };

    const { container } = render(<GridCell cell={cell} />);
    const dropZone = container.querySelector('.h-full');
    expect(dropZone).not.toBeNull();

    fireEvent.drop(dropZone as Element, {
      dataTransfer: {
        getData: (type: string) => (type === 'application/x-collab-vault-file' ? 'Boards/network.canvas' : ''),
      },
    });

    expect(setCellContent).toHaveBeenCalledWith('cell-3', {
      type: 'canvas',
      relativePath: 'Boards/network.canvas',
      title: 'network',
    });
  });
});
