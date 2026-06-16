const SECRET_PATTERNS: RegExp[] = [
  /\b(?:api[_-]?key|token|secret|password|passwd|pwd)\s*[:=]\s*["']?[^"'\s,;]+/gi,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/g,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\b[A-Za-z0-9_]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/g,
  /\b(?:sk|pk|ghp|github_pat|xox[baprs])_[A-Za-z0-9_/-]{16,}\b/g
];

const PII_PATTERNS: Array<[RegExp, string]> = [
  [/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[email]"],
  [/\b(?:\+?\d[\d\s().-]{7,}\d)\b/g, "[phone_number]"]
];

const PROMPT_INJECTION_PATTERNS: RegExp[] = [
  /\bignore (?:all )?(?:previous|prior|system|developer) instructions\b/i,
  /\bdisregard (?:all )?(?:previous|prior|system|developer) instructions\b/i,
  /\breveal (?:your )?(?:system prompt|developer instructions|hidden instructions)\b/i,
  /\boverride (?:the )?(?:system|developer) (?:prompt|instructions)\b/i,
  /\byou are now (?:in )?(?:developer|system|root) mode\b/i
];

export function redactText(value: string): string {
  let next = value;
  for (const pattern of SECRET_PATTERNS) {
    next = next.replace(pattern, "[redacted_secret]");
  }
  for (const [pattern, replacement] of PII_PATTERNS) {
    next = next.replace(pattern, replacement);
  }
  return next;
}

export function redactDeep<T>(value: T): T {
  if (typeof value === "string") return redactText(value) as T;
  if (Array.isArray(value)) return value.map((item) => redactDeep(item)) as T;
  if (!value || typeof value !== "object") return value;

  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    result[key] = redactDeep(item);
  }
  return result as T;
}

export function containsSecret(value: unknown): boolean {
  const text = flattenText(value);
  return SECRET_PATTERNS.some((pattern) => {
    pattern.lastIndex = 0;
    return pattern.test(text);
  });
}

export function containsPromptInjection(value: unknown): boolean {
  const text = flattenText(value);
  return PROMPT_INJECTION_PATTERNS.some((pattern) => pattern.test(text));
}

function flattenText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(flattenText).join("\n");
  if (!value || typeof value !== "object") return "";
  return Object.values(value).map(flattenText).join("\n");
}
