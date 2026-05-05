export interface CanvasData {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  viewport: { x: number; y: number; zoom: number };
}

export type CanvasNodeType =
  | 'note'
  | 'file'
  | 'text'
  | 'web'
  | 'process'
  | 'decision'
  | 'terminator'
  | 'document'
  | 'milestone'
  | 'actor'
  | 'group'
  | 'swimlane'
  | 'junction'
  | 'crossing';
export type CanvasWebDisplayMode = 'preview' | 'embed';
export type CanvasNodePriority = 'low' | 'medium' | 'high' | 'critical';
export type CanvasPlanningStatus = 'not_started' | 'in_progress' | 'blocked' | 'done';
export type CanvasSwimlaneOrientation = 'horizontal' | 'vertical';
export type CanvasEdgeRoutingStyle = 'curved' | 'orthogonal';

export interface CanvasNodeBase {
  id: string;
  type: CanvasNodeType;
  position: { x: number; y: number };
  width: number;
  height: number;
}

export interface CanvasPlanningMetadata {
  status?: CanvasPlanningStatus;
  priority?: CanvasNodePriority;
  ownerLabel?: string;
  dueDate?: string;
  milestoneLabel?: string;
  tags?: string[];
}

export interface NoteCanvasNode extends CanvasNodeBase {
  type: 'note';
  relativePath: string;
}

export interface FileCanvasNode extends CanvasNodeBase {
  type: 'file';
  relativePath: string;
}

export interface TextCanvasNode extends CanvasNodeBase {
  type: 'text';
  content: string;
}

export interface WebCanvasNode extends CanvasNodeBase {
  type: 'web';
  url: string;
  displayModeOverride?: CanvasWebDisplayMode | null;
}

export interface PlanningCanvasNodeBase extends CanvasNodeBase {
  type:
    | 'process'
    | 'decision'
    | 'terminator'
    | 'document'
    | 'milestone'
    | 'actor'
    | 'group'
    | 'swimlane'
    | 'junction'
    | 'crossing';
  title: string;
  body?: string;
  linkedRelativePath?: string;
  planning?: CanvasPlanningMetadata;
}

export interface ProcessCanvasNode extends PlanningCanvasNodeBase {
  type: 'process';
}

export interface DecisionCanvasNode extends PlanningCanvasNodeBase {
  type: 'decision';
}

export interface TerminatorCanvasNode extends PlanningCanvasNodeBase {
  type: 'terminator';
}

export interface DocumentPlanningCanvasNode extends PlanningCanvasNodeBase {
  type: 'document';
}

export interface MilestoneCanvasNode extends PlanningCanvasNodeBase {
  type: 'milestone';
}

export interface ActorCanvasNode extends PlanningCanvasNodeBase {
  type: 'actor';
}

export interface GroupCanvasNode extends PlanningCanvasNodeBase {
  type: 'group';
}

export interface SwimlaneCanvasNode extends PlanningCanvasNodeBase {
  type: 'swimlane';
  orientation?: CanvasSwimlaneOrientation;
}

export interface JunctionCanvasNode extends PlanningCanvasNodeBase {
  type: 'junction';
}

export interface CrossingCanvasNode extends PlanningCanvasNodeBase {
  type: 'crossing';
}

export type PlanningCanvasNode =
  | ProcessCanvasNode
  | DecisionCanvasNode
  | TerminatorCanvasNode
  | DocumentPlanningCanvasNode
  | MilestoneCanvasNode
  | ActorCanvasNode
  | GroupCanvasNode
  | SwimlaneCanvasNode
  | JunctionCanvasNode
  | CrossingCanvasNode;

export type CanvasNode =
  | NoteCanvasNode
  | FileCanvasNode
  | TextCanvasNode
  | WebCanvasNode
  | PlanningCanvasNode;

export type CanvasEdgeLineStyle = 'solid' | 'dashed' | 'dotted';

export interface CanvasEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
  targetHandle?: string;
  label?: string;
  lineStyle?: CanvasEdgeLineStyle;
  routingStyle?: CanvasEdgeRoutingStyle;
  animated?: boolean;
  animationReverse?: boolean;
  markerStart?: boolean;
  markerEnd?: boolean;
}
