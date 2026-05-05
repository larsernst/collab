import { Box, Trash2 } from 'lucide-react';

import type {
  CanvasNodePriority,
  CanvasPlanningMetadata,
  CanvasPlanningStatus,
  CanvasSwimlaneOrientation,
  PlanningCanvasNode,
} from '../../types/canvas';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Textarea } from '../ui/textarea';
import { getPlanningNodeLabel } from './canvasPlanning';
import { supportsLinkedPath, supportsPlanningMetadata } from './canvasDiagramUtils';

interface CanvasNodeInspectorProps {
  selectedNode: {
    id: string;
    type: string;
    title?: string;
    subtitle?: string;
    content?: string;
    linkedRelativePath?: string;
    planning?: CanvasPlanningMetadata;
    orientation?: CanvasSwimlaneOrientation;
  } | null;
  onTitleChange: (title: string) => void;
  onBodyChange: (body: string) => void;
  onLinkedPathChange: (relativePath: string) => void;
  onPlanningChange: (planning: CanvasPlanningMetadata) => void;
  onOrientationChange: (orientation: CanvasSwimlaneOrientation) => void;
  onDeleteSelected: () => void;
}

const statusOptions: CanvasPlanningStatus[] = ['not_started', 'in_progress', 'blocked', 'done'];
const priorityOptions: CanvasNodePriority[] = ['low', 'medium', 'high', 'critical'];

export function CanvasNodeInspector({
  selectedNode,
  onTitleChange,
  onBodyChange,
  onLinkedPathChange,
  onPlanningChange,
  onOrientationChange,
  onDeleteSelected,
}: CanvasNodeInspectorProps) {
  const kind = selectedNode?.type;
  const isPlanningNode = !!kind && !['noteCard', 'fileCard', 'textCard', 'webCard'].includes(kind);
  const planningKind = kind?.replace(/Card$/, '') as PlanningCanvasNode['type'] | undefined;
  const planning = selectedNode?.planning ?? {};

  return (
    <div className="pointer-events-auto flex max-w-[min(420px,calc(100vw-220px))] flex-col gap-2 rounded-2xl border border-border/60 bg-popover/90 p-2.5 shadow-xl backdrop-blur-xs-webkit app-fade-scale-in">
      <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <Box size={13} />
        Selected node
      </div>
      {selectedNode ? (
        <>
          <Input
            value={selectedNode.title ?? ''}
            onChange={(event) => onTitleChange(event.target.value)}
            placeholder="Node title"
            className="h-8"
          />
          <Textarea
            value={selectedNode.content ?? ''}
            onChange={(event) => onBodyChange(event.target.value)}
            placeholder="Description, branch notes, or supporting context"
            className="min-h-24 resize-y text-sm"
          />
          {isPlanningNode ? (
            <>
              <div className="rounded-xl border border-border/60 bg-card/45 px-3 py-2 text-xs">
                <div className="font-medium text-foreground">{planningKind ? getPlanningNodeLabel(planningKind) : 'Planning node'}</div>
                <div className="text-muted-foreground">Planning metadata stays local to this canvas for v1.</div>
              </div>
              {planningKind && supportsLinkedPath(planningKind) ? (
                <Input
                  value={selectedNode.linkedRelativePath ?? ''}
                  onChange={(event) => onLinkedPathChange(event.target.value)}
                  placeholder="Optional linked vault path"
                  className="h-8"
                />
              ) : null}
              {planningKind && supportsPlanningMetadata(planningKind) ? (
                <>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="rounded-xl border border-border/60 bg-card/45 p-2">
                      <div className="mb-1 text-[11px] font-medium text-muted-foreground">Status</div>
                      <Select
                        value={planning.status ?? 'not_started'}
                        onValueChange={(value) => onPlanningChange({ ...planning, status: value as CanvasPlanningStatus })}
                      >
                        <SelectTrigger size="sm" className="h-8 w-full bg-background/70 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent align="end">
                          {statusOptions.map((status) => (
                            <SelectItem key={status} value={status}>
                              {status.replace(/_/g, ' ')}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="rounded-xl border border-border/60 bg-card/45 p-2">
                      <div className="mb-1 text-[11px] font-medium text-muted-foreground">Priority</div>
                      <Select
                        value={planning.priority ?? 'medium'}
                        onValueChange={(value) => onPlanningChange({ ...planning, priority: value as CanvasNodePriority })}
                      >
                        <SelectTrigger size="sm" className="h-8 w-full bg-background/70 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent align="end">
                          {priorityOptions.map((priority) => (
                            <SelectItem key={priority} value={priority}>
                              {priority}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <Input
                      value={planning.ownerLabel ?? ''}
                      onChange={(event) => onPlanningChange({ ...planning, ownerLabel: event.target.value })}
                      placeholder="Owner"
                      className="h-8"
                    />
                    <Input
                      value={planning.dueDate ?? ''}
                      onChange={(event) => onPlanningChange({ ...planning, dueDate: event.target.value })}
                      placeholder="Due date"
                      className="h-8"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <Input
                      value={planning.milestoneLabel ?? ''}
                      onChange={(event) => onPlanningChange({ ...planning, milestoneLabel: event.target.value })}
                      placeholder="Milestone label"
                      className="h-8"
                    />
                    <Input
                      value={(planning.tags ?? []).join(', ')}
                      onChange={(event) => onPlanningChange({
                        ...planning,
                        tags: event.target.value
                          .split(',')
                          .map((tag) => tag.trim())
                          .filter(Boolean),
                      })}
                      placeholder="tag-one, tag-two"
                      className="h-8"
                    />
                  </div>
                </>
              ) : null}
              {kind === 'swimlaneCard' ? (
                <div className="rounded-xl border border-border/60 bg-card/45 p-2">
                  <div className="mb-1 text-[11px] font-medium text-muted-foreground">Orientation</div>
                  <Select value={selectedNode.orientation ?? 'horizontal'} onValueChange={(value) => onOrientationChange(value as CanvasSwimlaneOrientation)}>
                    <SelectTrigger size="sm" className="h-8 w-full bg-background/70 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent align="end">
                      <SelectItem value="horizontal">Horizontal</SelectItem>
                      <SelectItem value="vertical">Vertical</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              ) : null}
            </>
          ) : null}
          <Button size="sm" variant="outline" className="gap-2 self-start" onClick={onDeleteSelected}>
            <Trash2 size={14} />
            Delete selected
          </Button>
        </>
      ) : (
        <div className="text-xs text-muted-foreground/75">
          Select a canvas node to edit its label, notes, or planning metadata.
        </div>
      )}
    </div>
  );
}
