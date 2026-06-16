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
        "contextos_learning_log",
        "contextos_session_search",
        "contextos_memory_read",
        "contextos_memory_upsert",
        "contextos_distill_skill"
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
    expect(result.systemPrompt).toContain("contextOS Curated Memory");
    expect(result.message.content).toContain("Qual planilha voce quer atualizar?");

    await handlers.get("session_shutdown")?.({}, ctx);
  });

  it("records user input and assistant messages in the session ledger", async () => {
    const handlers = new Map<string, Function>();
    const tools = new Map<string, any>();
    const pi = {
      on: vi.fn((event: string, handler: Function) => handlers.set(event, handler)),
      registerCommand: vi.fn(),
      registerTool: vi.fn((definition: { name: string }) => tools.set(definition.name, definition))
    };
    const ctx = { ui: { notify: vi.fn(), setStatus: vi.fn() } };

    contextOS(pi as never);

    await handlers.get("session_start")?.({}, ctx);
    await handlers.get("input")?.({ text: "quero atualizar a planilha de forecast", source: "interactive" }, ctx);
    await handlers.get("message_end")?.(
      { message: { role: "assistant", content: [{ type: "text", text: "Use a aba Forecast e valide o total." }] } },
      ctx
    );

    const result = await tools.get("contextos_session_search").execute(
      "tool",
      { query: "forecast total", limit: 5 },
      undefined,
      undefined,
      ctx
    );

    expect(result.content[0].text).toContain("forecast");
    expect(result.content[0].text).toContain("assistant");

    await handlers.get("session_shutdown")?.({}, ctx);
  });
});
