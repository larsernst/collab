import type { KanbanAutomationRule, KanbanBoard, KanbanFilterSpec } from './kanban';

export type TemplateSource = 'builtin' | 'vault' | 'app';

export interface KanbanTemplate {
  kind: 'kanban';
  name: string;
  source: TemplateSource;
  hash: string;
  updatedAt: number;
  board: KanbanBoard;
}

export interface KanbanFilterPreset {
  kind: 'kanban-filter';
  name: string;
  source: TemplateSource;
  updatedAt: number;
  spec: KanbanFilterSpec;
}

export interface KanbanAutomationPreset {
  kind: 'kanban-automation';
  name: string;
  source: TemplateSource;
  updatedAt: number;
  rule: KanbanAutomationRule;
}
