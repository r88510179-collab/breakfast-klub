export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

export type OpenAICompatConfig = {
  baseUrl: string; // e.g. https://api.groq.com/openai/v1
  apiKey: string;
  model: string;
};

export async function chatCompletion(
  cfg: OpenAICompatConfig,
  messages: ChatMessage[],
  opts?: { temperature?: number; max_tokens?: number }
): Promise<string> {
  const url = `${cfg.baseUrl.replace(/\/$/, "")}/chat/completions`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${cfg.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: cfg.model,
      messages,
      temperature: opts?.temperature ?? 0.2,
      max_tokens: opts?.max_tokens ?? 900,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`AI provider error (${res.status}): ${text.slice(0, 300)}`);
  }

  const data: any = await res.json();
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    throw new Error("AI provider returned empty content");
  }
  return content;
}
