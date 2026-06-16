import Database from "better-sqlite3";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { redactDeep, containsPromptInjection } from "./redaction.ts";
import type { AuditEvent, ContextCard, ContextCardInput, SearchResult, UpsertResult } from "./types.ts";

type Row = {
  id: string;
  kind: string;
  title: string;
  aliases_json: string;
  scope: string;
  summary: string;
  facts_json: string;
  workflow_steps_json: string;
  formatting_rules_json: string;
  validation_steps_json: string;
  artifact_refs_json: string;
  open_questions_json: string;
  confidence: number;
  sources_json: string;
  version: number;
  updated_at: string;
  invalidated_at?: string | null;
};

type AuditRow = {
  id: string;
  action: AuditEvent["action"];
  card_id?: string | null;
  before_json?: string | null;
  after_json?: string | null;
  reason?: string | null;
  source?: string | null;
  created_at: string;
};

export class ContextStore {
  readonly home: string;
  readonly dbPath: string;
  readonly contextDir: string;
  readonly auditPath: string;
  private readonly db: Database.Database;

  constructor(home = defaultContextOSHome()) {
    this.home = home;
    this.dbPath = join(home, "state.db");
    this.contextDir = join(home, "context");
    this.auditPath = join(home, "audit.jsonl");
    mkdirSync(this.contextDir, { recursive: true });
    this.db = new Database(this.dbPath);
    this.db.pragma("journal_mode = WAL");
    this.migrate();
  }

  close(): void {
    this.db.close();
  }

  stats(): { cards: number; activeCards: number; auditEvents: number; home: string } {
    const cards = this.db.prepare("SELECT COUNT(*) AS count FROM context_cards").get() as { count: number };
    const activeCards = this.db
      .prepare("SELECT COUNT(*) AS count FROM context_cards WHERE invalidated_at IS NULL")
      .get() as { count: number };
    const auditEvents = this.db.prepare("SELECT COUNT(*) AS count FROM audit_events").get() as { count: number };
    return { cards: cards.count, activeCards: activeCards.count, auditEvents: auditEvents.count, home: this.home };
  }

  get(id: string): ContextCard | undefined {
    const row = this.db.prepare("SELECT * FROM context_cards WHERE id = ?").get(id) as Row | undefined;
    return row ? rowToCard(row) : undefined;
  }

  search(query: string, limit = 5): SearchResult[] {
    const terms = toFtsQuery(query);
    if (!terms) return this.recent(limit).map((card, index) => ({ card, score: 1 - index * 0.05 }));

    const rows = this.db
      .prepare(
        `SELECT c.*, bm25(context_cards_fts) AS rank
         FROM context_cards_fts f
         JOIN context_cards c ON c.id = f.id
         WHERE context_cards_fts MATCH ?
           AND c.invalidated_at IS NULL
         ORDER BY rank
         LIMIT ?`
      )
      .all(terms, limit) as Array<Row & { rank: number }>;

    if (rows.length > 0) {
      return rows.map((row) => ({ card: rowToCard(row), score: Math.max(0.2, 1 / (1 + Math.abs(row.rank))) }));
    }

    const like = `%${query.replace(/[%_]/g, " ").trim()}%`;
    const fallbackRows = this.db
      .prepare(
        `SELECT * FROM context_cards
         WHERE invalidated_at IS NULL
           AND (title LIKE ? OR summary LIKE ? OR scope LIKE ?)
         ORDER BY updated_at DESC
         LIMIT ?`
      )
      .all(like, like, like, limit) as Row[];
    return fallbackRows.map((row) => ({ card: rowToCard(row), score: 0.3 }));
  }

  recent(limit = 10): ContextCard[] {
    const rows = this.db
      .prepare("SELECT * FROM context_cards WHERE invalidated_at IS NULL ORDER BY updated_at DESC LIMIT ?")
      .all(limit) as Row[];
    return rows.map(rowToCard);
  }

  upsert(input: ContextCardInput, source = "contextos_upsert"): UpsertResult {
    const safeInput = redactDeep(input);
    if (containsPromptInjection(safeInput)) {
      throw new Error("Context contains prompt-injection instructions and was not saved.");
    }

    const now = new Date().toISOString();
    const id = safeInput.id ?? stableId(safeInput.scope ?? "global", safeInput.kind ?? "workflow", safeInput.title);
    const before = this.get(id);
    const candidate = normalizeCard(safeInput, before, id, now);
    const contradictions = before ? findContradictions(before, candidate) : [];

    if (before && contradictions.length > 0) {
      const audit = this.writeAudit({
        id: randomId("audit"),
        action: "contradiction",
        cardId: id,
        before,
        after: candidate,
        reason: contradictions.join(" | "),
        source,
        createdAt: now
      });
      return {
        status: "needs_confirmation",
        card: before,
        audit,
        questions: contradictions.map((item) => `Confirmar contexto: ${item}`)
      };
    }

    this.saveCard(candidate);
    const audit = this.writeAudit({
      id: randomId("audit"),
      action: "upsert",
      cardId: id,
      before,
      after: candidate,
      source,
      createdAt: now
    });
    this.writeMarkdown(candidate);
    return { status: "saved", card: candidate, audit };
  }

  invalidate(id: string, reason = "invalidated by user", source = "contextos_invalidate"): AuditEvent {
    const before = this.get(id);
    if (!before) throw new Error(`Context card not found: ${id}`);
    const now = new Date().toISOString();
    const after = { ...before, invalidatedAt: now, updatedAt: now, version: before.version + 1 };
    this.saveCard(after);
    return this.writeAudit({
      id: randomId("audit"),
      action: "invalidate",
      cardId: id,
      before,
      after,
      reason,
      source,
      createdAt: now
    });
  }

  undo(auditId: string): AuditEvent {
    const row = this.db.prepare("SELECT * FROM audit_events WHERE id = ?").get(auditId) as AuditRow | undefined;
    if (!row) throw new Error(`Audit event not found: ${auditId}`);
    const event = rowToAudit(row);
    const now = new Date().toISOString();

    if (event.action === "upsert") {
      if (event.before) this.saveCard(event.before);
      else if (event.cardId) this.deleteCard(event.cardId);
    } else if (event.action === "invalidate" && event.before) {
      this.saveCard(event.before);
    } else {
      throw new Error(`Audit event cannot be undone: ${auditId}`);
    }

    return this.writeAudit({
      id: randomId("audit"),
      action: "undo",
      cardId: event.cardId,
      before: event.after,
      after: event.before,
      reason: `undo ${auditId}`,
      source: "context_undo",
      createdAt: now
    });
  }

  auditLog(limit = 20): AuditEvent[] {
    const rows = this.db
      .prepare("SELECT * FROM audit_events ORDER BY created_at DESC LIMIT ?")
      .all(limit) as AuditRow[];
    return rows.map(rowToAudit);
  }

  exportAll(): string {
    const cards = this.recent(1000);
    const path = join(this.home, "context-export.md");
    const body = [
      "# contextOS Export",
      "",
      `Generated: ${new Date().toISOString()}`,
      "",
      ...cards.map(cardToMarkdown)
    ].join("\n");
    writeFileSync(path, body, "utf8");
    return path;
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS context_cards (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        title TEXT NOT NULL,
        aliases_json TEXT NOT NULL,
        scope TEXT NOT NULL,
        summary TEXT NOT NULL,
        facts_json TEXT NOT NULL,
        workflow_steps_json TEXT NOT NULL,
        formatting_rules_json TEXT NOT NULL,
        validation_steps_json TEXT NOT NULL,
        artifact_refs_json TEXT NOT NULL,
        open_questions_json TEXT NOT NULL,
        confidence REAL NOT NULL,
        sources_json TEXT NOT NULL,
        version INTEGER NOT NULL,
        updated_at TEXT NOT NULL,
        invalidated_at TEXT
      );

      CREATE VIRTUAL TABLE IF NOT EXISTS context_cards_fts USING fts5(
        id UNINDEXED,
        title,
        aliases,
        scope,
        summary,
        facts,
        workflow_steps,
        formatting_rules,
        validation_steps,
        artifact_refs,
        open_questions
      );

      CREATE TABLE IF NOT EXISTS audit_events (
        id TEXT PRIMARY KEY,
        action TEXT NOT NULL,
        card_id TEXT,
        before_json TEXT,
        after_json TEXT,
        reason TEXT,
        source TEXT,
        created_at TEXT NOT NULL
      );
    `);
  }

  private saveCard(card: ContextCard): void {
    const row = cardToRow(card);
    const transaction = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO context_cards (
            id, kind, title, aliases_json, scope, summary, facts_json,
            workflow_steps_json, formatting_rules_json, validation_steps_json,
            artifact_refs_json, open_questions_json, confidence, sources_json,
            version, updated_at, invalidated_at
          ) VALUES (
            @id, @kind, @title, @aliases_json, @scope, @summary, @facts_json,
            @workflow_steps_json, @formatting_rules_json, @validation_steps_json,
            @artifact_refs_json, @open_questions_json, @confidence, @sources_json,
            @version, @updated_at, @invalidated_at
          )
          ON CONFLICT(id) DO UPDATE SET
            kind = excluded.kind,
            title = excluded.title,
            aliases_json = excluded.aliases_json,
            scope = excluded.scope,
            summary = excluded.summary,
            facts_json = excluded.facts_json,
            workflow_steps_json = excluded.workflow_steps_json,
            formatting_rules_json = excluded.formatting_rules_json,
            validation_steps_json = excluded.validation_steps_json,
            artifact_refs_json = excluded.artifact_refs_json,
            open_questions_json = excluded.open_questions_json,
            confidence = excluded.confidence,
            sources_json = excluded.sources_json,
            version = excluded.version,
            updated_at = excluded.updated_at,
            invalidated_at = excluded.invalidated_at`
        )
        .run(row);
      this.db.prepare("DELETE FROM context_cards_fts WHERE id = ?").run(card.id);
      if (!card.invalidatedAt) {
        this.db
          .prepare(
            `INSERT INTO context_cards_fts (
              id, title, aliases, scope, summary, facts, workflow_steps,
              formatting_rules, validation_steps, artifact_refs, open_questions
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            card.id,
            card.title,
            card.aliases.join(" "),
            card.scope,
            card.summary,
            card.facts.join("\n"),
            card.workflowSteps.join("\n"),
            card.formattingRules.join("\n"),
            card.validationSteps.join("\n"),
            card.artifactRefs.join("\n"),
            card.openQuestions.join("\n")
          );
      }
    });
    transaction();
  }

  private deleteCard(id: string): void {
    const transaction = this.db.transaction(() => {
      this.db.prepare("DELETE FROM context_cards_fts WHERE id = ?").run(id);
      this.db.prepare("DELETE FROM context_cards WHERE id = ?").run(id);
    });
    transaction();
  }

  private writeAudit(event: AuditEvent): AuditEvent {
    this.db
      .prepare(
        `INSERT INTO audit_events (
          id, action, card_id, before_json, after_json, reason, source, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        event.id,
        event.action,
        event.cardId,
        event.before ? JSON.stringify(event.before) : undefined,
        event.after ? JSON.stringify(event.after) : undefined,
        event.reason,
        event.source,
        event.createdAt
      );
    mkdirSync(dirname(this.auditPath), { recursive: true });
    writeFileSync(this.auditPath, `${JSON.stringify(event)}\n`, { encoding: "utf8", flag: "a" });
    return event;
  }

  private writeMarkdown(card: ContextCard): void {
    const path = join(this.contextDir, `${card.id}.md`);
    writeFileSync(path, cardToMarkdown(card), "utf8");
  }
}

export function defaultContextOSHome(): string {
  return process.env.CONTEXTOS_HOME ?? process.env.JOAO_HARNESS_HOME ?? join(homedir(), ".contextos");
}

export function stableId(scope: string, kind: string, title: string): string {
  return [scope, kind, title]
    .join("-")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96);
}

function normalizeCard(input: ContextCardInput, before: ContextCard | undefined, id: string, now: string): ContextCard {
  const merge = <T>(field: T[] | undefined, fallback: T[]) => field ?? fallback;
  return {
    id,
    kind: input.kind ?? before?.kind ?? "workflow",
    title: input.title,
    aliases: merge(input.aliases, before?.aliases ?? []),
    scope: input.scope ?? before?.scope ?? "global",
    summary: input.summary ?? before?.summary ?? "",
    facts: merge(input.facts, before?.facts ?? []),
    workflowSteps: merge(input.workflowSteps, before?.workflowSteps ?? []),
    formattingRules: merge(input.formattingRules, before?.formattingRules ?? []),
    validationSteps: merge(input.validationSteps, before?.validationSteps ?? []),
    artifactRefs: merge(input.artifactRefs, before?.artifactRefs ?? []),
    openQuestions: merge(input.openQuestions, before?.openQuestions ?? []),
    confidence: clampConfidence(input.confidence ?? before?.confidence ?? 0.5),
    sources: merge(input.sources, before?.sources ?? [{ label: "conversation", capturedAt: now }]),
    version: before ? before.version + 1 : 1,
    updatedAt: now,
    invalidatedAt: input.invalidatedAt ?? before?.invalidatedAt
  };
}

function findContradictions(before: ContextCard, next: ContextCard): string[] {
  const previous = keyValueFacts(before.facts);
  const incoming = keyValueFacts(next.facts);
  const contradictions: string[] = [];
  for (const [key, value] of incoming) {
    const prior = previous.get(key);
    if (prior && prior !== value) {
      contradictions.push(`${key}: "${prior}" vs "${value}"`);
    }
  }
  return contradictions;
}

function keyValueFacts(facts: string[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const fact of facts) {
    const match = fact.match(/^\s*([^:=]+)\s*[:=]\s*(.+?)\s*$/);
    if (!match) continue;
    map.set(match[1].trim().toLowerCase(), match[2].trim());
  }
  return map;
}

function toFtsQuery(query: string): string {
  return query
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .split(/[^a-z0-9]+/)
    .filter((term) => term.length >= 3)
    .slice(0, 8)
    .map((term) => `${term}*`)
    .join(" OR ");
}

function rowToCard(row: Row): ContextCard {
  return {
    id: row.id,
    kind: row.kind as ContextCard["kind"],
    title: row.title,
    aliases: parseJson(row.aliases_json, []),
    scope: row.scope,
    summary: row.summary,
    facts: parseJson(row.facts_json, []),
    workflowSteps: parseJson(row.workflow_steps_json, []),
    formattingRules: parseJson(row.formatting_rules_json, []),
    validationSteps: parseJson(row.validation_steps_json, []),
    artifactRefs: parseJson(row.artifact_refs_json, []),
    openQuestions: parseJson(row.open_questions_json, []),
    confidence: row.confidence,
    sources: parseJson(row.sources_json, []),
    version: row.version,
    updatedAt: row.updated_at,
    invalidatedAt: row.invalidated_at ?? undefined
  };
}

function cardToRow(card: ContextCard): Row {
  return {
    id: card.id,
    kind: card.kind,
    title: card.title,
    aliases_json: JSON.stringify(card.aliases),
    scope: card.scope,
    summary: card.summary,
    facts_json: JSON.stringify(card.facts),
    workflow_steps_json: JSON.stringify(card.workflowSteps),
    formatting_rules_json: JSON.stringify(card.formattingRules),
    validation_steps_json: JSON.stringify(card.validationSteps),
    artifact_refs_json: JSON.stringify(card.artifactRefs),
    open_questions_json: JSON.stringify(card.openQuestions),
    confidence: card.confidence,
    sources_json: JSON.stringify(card.sources),
    version: card.version,
    updated_at: card.updatedAt,
    invalidated_at: card.invalidatedAt ?? null
  };
}

function rowToAudit(row: AuditRow): AuditEvent {
  return {
    id: row.id,
    action: row.action,
    cardId: row.card_id ?? undefined,
    before: row.before_json ? JSON.parse(row.before_json) : undefined,
    after: row.after_json ? JSON.parse(row.after_json) : undefined,
    reason: row.reason ?? undefined,
    source: row.source ?? undefined,
    createdAt: row.created_at
  };
}

function cardToMarkdown(card: ContextCard): string {
  return [
    `# ${card.title}`,
    "",
    `- id: ${card.id}`,
    `- kind: ${card.kind}`,
    `- scope: ${card.scope}`,
    `- confidence: ${card.confidence}`,
    `- version: ${card.version}`,
    `- updatedAt: ${card.updatedAt}`,
    card.invalidatedAt ? `- invalidatedAt: ${card.invalidatedAt}` : undefined,
    "",
    "## Summary",
    "",
    card.summary || "_No summary yet._",
    "",
    listSection("Aliases", card.aliases),
    listSection("Facts", card.facts),
    listSection("Workflow Steps", card.workflowSteps),
    listSection("Formatting Rules", card.formattingRules),
    listSection("Validation Steps", card.validationSteps),
    listSection("Artifact References", card.artifactRefs),
    listSection("Open Questions", card.openQuestions)
  ]
    .filter((part): part is string => Boolean(part))
    .join("\n");
}

function listSection(title: string, values: string[]): string {
  return [`## ${title}`, "", ...(values.length > 0 ? values.map((value) => `- ${value}`) : ["_None._"]), ""].join("\n");
}

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function clampConfidence(value: number): number {
  if (Number.isNaN(value)) return 0.5;
  return Math.max(0, Math.min(1, value));
}

function randomId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function readAuditJsonl(path: string): AuditEvent[] {
  try {
    return readFileSync(path, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as AuditEvent);
  } catch {
    return [];
  }
}
