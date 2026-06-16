declare module "@earendil-works/pi-coding-agent" {
  export type NotifyLevel = "info" | "warning" | "error";

  export type ExtensionContext = {
    ui: {
      notify(message: string, level?: NotifyLevel): void | Promise<void>;
      setStatus(name: string, value: string): void;
    };
  };

  export type ToolResult = {
    content: Array<{ type: "text"; text: string }>;
    details?: unknown;
    terminate?: boolean;
  };

  export type ToolDefinition = {
    name: string;
    label?: string;
    description: string;
    promptSnippet?: string;
    promptGuidelines?: string[];
    parameters: unknown;
    execute(
      toolCallId: string,
      params: Record<string, any>,
      signal?: AbortSignal,
      onUpdate?: (result: Partial<ToolResult>) => void,
      ctx?: ExtensionContext
    ): ToolResult | Promise<ToolResult>;
  };

  export type CommandDefinition = {
    description?: string;
    handler(args: string, ctx: ExtensionContext): void | Promise<void>;
  };

  export type InputEvent = {
    text: string;
    images?: unknown[];
    source: "interactive" | "rpc" | "extension";
    streamingBehavior?: "steer" | "followUp";
  };

  export type BeforeAgentStartEvent = {
    prompt: string;
    images?: unknown[];
    systemPrompt: string;
    systemPromptOptions?: unknown;
  };

  export type SessionEvent = {
    reason?: string;
  };

  export type ExtensionAPI = {
    on(event: "input", handler: (event: InputEvent, ctx: ExtensionContext) => unknown): void;
    on(
      event: "before_agent_start",
      handler: (event: BeforeAgentStartEvent, ctx: ExtensionContext) => unknown
    ): void;
    on(event: "session_start" | "session_shutdown", handler: (event: SessionEvent, ctx: ExtensionContext) => unknown): void;
    on(event: string, handler: (event: unknown, ctx: ExtensionContext) => unknown): void;
    registerCommand(name: string, options: CommandDefinition): void;
    registerTool(definition: ToolDefinition): void;
  };
}
