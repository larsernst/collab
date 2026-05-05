import {
  ChevronDown,
  Diamond,
  FileText,
  Flag,
  Globe,
  Maximize2,
  Minus,
  MousePointer2,
  PencilLine,
  Plus as PlusIcon,
  Plus,
  RotateCcw,
  Route,
  Users,
} from 'lucide-react';

import {
  DocumentTopBarButton,
  DocumentTopBarIconButton,
  documentTopBarGroupClass,
} from '../layout/DocumentTopBar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu';
import type { PlanningCanvasNode } from '../../types/canvas';
import type { CanvasPlanningPreset } from './canvasPlanning';

interface CanvasToolbarProps {
  zoomLabel: string;
  onAddNote: () => void;
  onAddFile: () => void;
  onAddText: () => void;
  onAddWeb: () => void;
  onAddPlanningNode: (type: PlanningCanvasNode['type']) => void;
  onApplyPreset: (preset: CanvasPlanningPreset) => void;
  onZoomOut: () => void;
  onResetZoom: () => void;
  onZoomIn: () => void;
  onFitView: () => void;
}

export function CanvasToolbar({
  zoomLabel,
  onAddNote,
  onAddFile,
  onAddText,
  onAddWeb,
  onAddPlanningNode,
  onApplyPreset,
  onZoomOut,
  onResetZoom,
  onZoomIn,
  onFitView,
}: CanvasToolbarProps) {
  return (
    <>
      <div className={documentTopBarGroupClass}>
        <DocumentTopBarButton onClick={onAddNote}>
          <Plus size={14} />
          Add note
        </DocumentTopBarButton>
        <DocumentTopBarButton onClick={onAddFile}>
          <FileText size={14} />
          Add file
        </DocumentTopBarButton>
        <DocumentTopBarButton onClick={onAddText}>
          <PencilLine size={14} />
          Add text
        </DocumentTopBarButton>
        <DocumentTopBarButton onClick={onAddWeb}>
          <Globe size={14} />
          Add web
        </DocumentTopBarButton>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <DocumentTopBarButton>
              <Route size={14} />
              Planning
              <ChevronDown size={13} />
            </DocumentTopBarButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-60">
            <DropdownMenuLabel>Flow</DropdownMenuLabel>
            <DropdownMenuItem onSelect={() => onAddPlanningNode('process')}>
              <Route size={14} />
              Process
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onAddPlanningNode('decision')}>
              <Diamond size={14} />
              Decision
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onAddPlanningNode('terminator')}>
              <Flag size={14} />
              Start / End
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onAddPlanningNode('junction')}>
              <Plus size={14} />
              Junction
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onAddPlanningNode('crossing')}>
              <Route size={14} />
              Crossing
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Planning</DropdownMenuLabel>
            <DropdownMenuItem onSelect={() => onAddPlanningNode('milestone')}>
              <Flag size={14} />
              Milestone
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onAddPlanningNode('actor')}>
              <Users size={14} />
              Actor
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onAddPlanningNode('document')}>
              <FileText size={14} />
              Document
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Structure</DropdownMenuLabel>
            <DropdownMenuItem onSelect={() => onAddPlanningNode('swimlane')}>
              <Route size={14} />
              Swimlane
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onAddPlanningNode('group')}>
              <Route size={14} />
              Group
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <DocumentTopBarButton>
              <Plus size={14} />
              Presets
              <ChevronDown size={13} />
            </DocumentTopBarButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56">
            <DropdownMenuItem onSelect={() => onApplyPreset('flowchart')}>Flowchart</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onApplyPreset('project_workflow')}>Project workflow</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onApplyPreset('responsibility_lanes')}>Responsibility lanes</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onApplyPreset('decision_tree')}>Decision tree</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onApplyPreset('system_process_sketch')}>System/process sketch</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className={documentTopBarGroupClass}>
        <DocumentTopBarIconButton onClick={onZoomOut} title="Zoom out">
          <Minus size={15} />
        </DocumentTopBarIconButton>
        <button
          type="button"
          onClick={onResetZoom}
          className="min-w-[78px] rounded-md px-2 text-center text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
          title="Reset zoom to 100%"
        >
          {zoomLabel}
        </button>
        <DocumentTopBarIconButton onClick={onZoomIn} title="Zoom in">
          <PlusIcon size={15} />
        </DocumentTopBarIconButton>
      </div>

      <div className={documentTopBarGroupClass}>
        <DocumentTopBarButton onClick={onFitView}>
          <Maximize2 size={14} />
          Fit view
        </DocumentTopBarButton>
        <DocumentTopBarButton onClick={onResetZoom}>
          <RotateCcw size={14} />
          Reset zoom
        </DocumentTopBarButton>
      </div>

      <div className="hidden items-center gap-2 rounded-xl border border-border/60 bg-card/45 px-2.5 py-1 text-xs text-muted-foreground lg:flex">
        <MousePointer2 size={13} />
        Drag the board to pan. Drag files from the sidebar to add them.
      </div>
    </>
  );
}
