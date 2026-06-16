export type ContextCardKind =
  | "workflow"
  | "artifact"
  | "preference"
  | "project"
  | "person"
  | "decision"
  | "runbook"
  | "skill";

export type ContextSource = {
  label: string;
  url?: string;
  capturedAt: string;
};

export type ContextCard = {
  id: string;
  kind: ContextCardKind;
  title: string;
  aliases: string[];
  scope: string;
  summary: string;
  facts: string[];
  workflowSteps: string[];
  formattingRules: string[];
  validationSteps: string[];
  artifactRefs: string[];
  openQuestions: string[];
  confidence: number;
  sources: ContextSource[];
  version: number;
  updatedAt: string;
  invalidatedAt?: string;
};

export type ContextCardInput = Partial<Omit<ContextCard, "id" | "version" | "updatedAt">> & {
  id?: string;
  title: string;
};

export type AuditAction = "upsert" | "invalidate" | "undo" | "contradiction" | "memory_update" | "skill_distill";

export type AuditEvent = {
  id: string;
  action: AuditAction;
  cardId?: string;
  before?: ContextCard;
  after?: ContextCard;
  reason?: string;
  source?: string;
  createdAt: string;
};

export type SearchResult = {
  card: ContextCard;
  score: number;
};

export type SessionRole = "user" | "assistant" | "tool" | "system";

export type SessionMessage = {
  id: string;
  sessionId: string;
  role: SessionRole;
  content: string;
  createdAt: string;
};

export type SessionSearchResult = {
  message: SessionMessage;
  score: number;
};

export type CuratedMemoryKind = "memory" | "user";

export type CuratedMemory = {
  memory: string;
  user: string;
};

export type DistillSkillInput = {
  name: string;
  description: string;
  triggers: string[];
  steps: string[];
  evidence?: string[];
  notes?: string[];
  confidence?: number;
};

export type DistilledSkill = {
  id: string;
  path: string;
  content: string;
  card: ContextCard;
  audit: AuditEvent;
};

export type UpsertResult =
  | {
      status: "saved";
      card: ContextCard;
      audit: AuditEvent;
    }
  | {
      status: "needs_confirmation";
      card: ContextCard;
      audit: AuditEvent;
      questions: string[];
    };

export type ContextProbe = {
  query: string;
  results: SearchResult[];
  sufficient: boolean;
  missingFields: string[];
  questions: string[];
};
