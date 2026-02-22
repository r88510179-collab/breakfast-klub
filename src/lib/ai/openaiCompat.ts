export type ChatRole = "system" | "user" | "assistant";

export type ChatContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export type ChatMessage = {
  role: ChatRole;
  content: string | ChatContentPart[];
};

export type OpenAICompatConfig = {
  baseUrl: string; // e.g. https://api.groq.com/openai/v1
  apiKey: string;
  model: string;
  extraHeaders?: Record<string, string>;
};

export async function chatCompletion(
  cfg: OpenAICompatConfig,
  messages: ChatMessage[],
  opts?: {
    temperature?: number;
    max_tokens?: number;
  }
): Promise<string> {
  const endpoint = `${cfg.baseUrl.replace(/\/+$/, "")}/chat/completions`;

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${cfg.apiKey}`,
      ...(cfg.extraHeaders ?? {}),
    },
    body: JSON.stringify({
      model: cfg.model,
      messages,
      temperature: opts?.temperature ?? 0.2,
      max_tokens: opts?.max_tokens ?? 1000,
    }),
  });

  const raw = await res.text();

  if (!res.ok) {
    throw new Error(`LLM API error (${res.status}): ${raw}`);
  }

  let json: any;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new Error(`LLM API returned non-JSON response: ${raw}`);
  }

  const content = json?.choices?.[0]?.message?.content;

  if (typeof content === "string") return content;

  // Some providers may return array content parts
  if (Array.isArray(content)) {
    return content
      .map((p: any) => {
        if (typeof p === "string") return p;
        if (p?.type === "text") return p?.text ?? "";
        return "";
      })
      .join("")
      .trim();
  }

  throw new Error(`Unexpected LLM response shape: ${JSON.stringify(json).slice(0, 500)}`);
}
