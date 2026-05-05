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

import { documentTopBarGroupClass } from '../layout/DocumentTopBar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu';
import { Button } from '../ui/button';
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
        <Button size="sm" variant="ghost" className="h-8 gap-1.5 px-2.5 text-xs" onClick={onAddNote}>
          <Plus size={14} />
          Add note
        </Button>
        <Button size="sm" variant="ghost" className="h-8 gap-1.5 px-2.5 text-xs" onClick={onAddFile}>
          <FileText size={14} />
          Add file
        </Button>
        <Button size="sm" variant="ghost" className="h-8 gap-1.5 px-2.5 text-xs" onClick={onAddText}>
          <PencilLine size={14} />
          Add text
        </Button>
        <Button size="sm" variant="ghost" className="h-8 gap-1.5 px-2.5 text-xs" onClick={onAddWeb}>
          <Globe size={14} />
          Add web
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="ghost" className="h-8 gap-1.5 px-2.5 text-xs">
              <Route size={14} />
              Planning
              <ChevronDown size={13} />
            </Button>
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
            <Button size="sm" variant="ghost" className="h-8 gap-1.5 px-2.5 text-xs">
              <Plus size={14} />
              Presets
              <ChevronDown size={13} />
            </Button>
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
        <Button size="icon" variant="ghost" className="size-8" onClick={onZoomOut} title="Zoom out">
          <Minus size={15} />
        </Button>
        <button
          type="button"
          onClick={onResetZoom}
          className="min-w-[78px] rounded-md px-2 text-center text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
          title="Reset zoom to 100%"
        >
          {zoomLabel}
        </button>
        <Button size="icon" variant="ghost" className="size-8" onClick={onZoomIn} title="Zoom in">
          <PlusIcon size={15} />
        </Button>
      </div>

      <div className={documentTopBarGroupClass}>
        <Button size="sm" variant="ghost" className="h-8 gap-1.5 px-2.5 text-xs" onClick={onFitView}>
          <Maximize2 size={14} />
          Fit view
        </Button>
        <Button size="sm" variant="ghost" className="h-8 gap-1.5 px-2.5 text-xs" onClick={onResetZoom}>
          <RotateCcw size={14} />
          Reset zoom
        </Button>
      </div>

      <div className="hidden items-center gap-2 rounded-xl border border-border/60 bg-card/45 px-2.5 py-1 text-xs text-muted-foreground lg:flex">
        <MousePointer2 size={13} />
        Drag the board to pan. Drag files from the sidebar to add them.
      </div>
    </>
  );
}
