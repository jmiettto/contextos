import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import contextOS from "../extensions/contextos.ts";

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "contextos-extension-"));
  process.env.CONTEXTOS_HOME = home;
});

afterEach(() => {
  delete process.env.CONTEXTOS_HOME;
  rmSync(home, { recursive: true, force: true });
});

describe("contextOS Pi extension", () => {
  it("registers contextOS interfaces and appends per-turn prompt context", async () => {
    const handlers = new Map<string, Function>();
    const commands: string[] = [];
    const tools: string[] = [];
    const pi = {
      on: vi.fn((event: string, handler: Function) => handlers.set(event, handler)),
      registerCommand: vi.fn((name: string) => commands.push(name)),
      registerTool: vi.fn((definition: { name: string }) => tools.push(definition.name))
    };
    const ctx = { ui: { notify: vi.fn(), setStatus: vi.fn() } };

    contextOS(pi as never);

    expect(commands).toContain("context");
    expect(tools).toEqual(
      expect.arrayContaining([
        "contextos_search",
        "contextos_upsert",
        "contextos_questionnaire",
        "contextos_invalidate",
        "contextos_learning_log"
      ])
    );

    const beforeAgentStart = handlers.get("before_agent_start");
    expect(beforeAgentStart).toBeDefined();

    const result = await beforeAgentStart?.(
      { prompt: "quero atualizar uma planilha", systemPrompt: "BASE SYSTEM" },
      ctx
    );

    expect(result.systemPrompt).toContain("BASE SYSTEM");
    expect(result.systemPrompt).toContain("No sufficient durable context found");
    expect(result.message.content).toContain("Qual planilha voce quer atualizar?");

    await handlers.get("session_shutdown")?.({}, ctx);
  });
});
