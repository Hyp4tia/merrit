import { config } from "./config.ts";

export interface ChatMessage {
  role: "system" | "user";
  content: string;
}

export interface LlmResult {
  text: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
}

interface CompletionResponse {
  choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: { message?: string };
}

export async function chat(
  messages: ChatMessage[],
  maxTokens = config.llm.maxTokens,
): Promise<LlmResult> {
  const result = await chatOnce(messages, maxTokens);
  return result;
}

async function chatOnce(messages: ChatMessage[], maxTokens: number): Promise<LlmResult> {
  const response = await fetch(`${config.llm.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${config.llm.apiKey}`,
    },
    body: JSON.stringify({
      model: config.llm.model,
      messages,
      max_tokens: maxTokens,
      temperature: config.llm.temperature,
    }),
  });

  const payload = (await response.json().catch(() => ({}))) as CompletionResponse;
  if (!response.ok) {
    throw new Error(`LLM ${response.status}: ${payload.error?.message ?? "no error body"}`);
  }
  const choice = payload.choices?.[0];
  // This model spends completion budget on reasoning_content first, and Arabic drafts reason
  // longer than English ones. A "length" stop means the JSON body was cut off, so retry with a
  // larger budget once instead of failing the draft.
  if (choice?.finish_reason === "length") {
    if (maxTokens < 8000) return chatOnce(messages, Math.min(maxTokens * 2, 8000));
    throw new Error(
      `LLM hit max_tokens (${maxTokens}) before finishing the reply. Raise MERRIT_LLM_MAX_TOKENS.`,
    );
  }
  const text = choice?.message?.content?.trim();
  if (!text) throw new Error("LLM returned an empty completion");

  return {
    text,
    model: config.llm.model,
    promptTokens: payload.usage?.prompt_tokens ?? 0,
    completionTokens: payload.usage?.completion_tokens ?? 0,
  };
}

/**
 * The first balanced JSON object in a reply. Models wrap JSON in fences, follow it with a second
 * object, or add a sentence after it, and slicing from the first brace to the last one then spans
 * both. The scan tracks strings so a brace inside the post body cannot close the object early.
 */
function firstJsonObject(text: string): string | null {
  const start = text.indexOf("{");
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(start, index + 1);
    }
  }
  return null;
}

// Models still wrap JSON in markdown fences often enough that parsing needs to be tolerant,
// but it must fail loudly rather than fall back to prose as the post body.
export function parseJsonReply<T>(text: string): T {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const object = firstJsonObject(fenced?.[1] ?? text) ?? firstJsonObject(text);
  if (!object) throw new Error(`No JSON object in model reply: ${text.slice(0, 200)}`);
  return JSON.parse(object) as T;
}

export async function chatJson<T>(
  messages: ChatMessage[],
  maxTokens = config.llm.maxTokens,
): Promise<{ value: T; result: LlmResult }> {
  const result = await chat(messages, maxTokens);
  return { value: parseJsonReply<T>(result.text), result };
}
