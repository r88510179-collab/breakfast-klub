// src/lib/ai/router.ts
import { chatCompletion, type ChatMessage, type OpenAICompatConfig } from "./openaiCompat";

export type Strategy = "fast" | "balanced" | "consensus";

type ProviderName = "groq" | "cerebras" | "mistral" | "hf";

type ProviderConfigMap = {
  groq?: OpenAICompatConfig;
  cerebras?: OpenAICompatConfig;
  mistral?: OpenAICompatConfig;
  hf?: OpenAICompatConfig;
};

function env(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : undefined;
}

function isVisionModelName(model?: string) {
  if (!model) return false;
  return /vision|pixtral|vl/i.test(model);
}

/**
 * TEXT router configs (used by /api/ai chat route)
 *
 * Notes:
 * - HF is skipped unless HF_MODEL is explicitly set (you said you don't have HF text models).
 * - Mistral is included, but if your MISTRAL_MODEL looks like a vision model, it is skipped for text.
 * - Cerebras is added as another OpenAI-compatible provider.
 */
function getProviderConfigs(): ProviderConfigMap {
  const groqKey = env("GROQ_API_KEY");
  const cerebrasKey = env("CEREBRAS_API_KEY");
  const mistralKey = env("MISTRAL_API_KEY");
  const hfKey = env("HF_TOKEN"); // you renamed to this

  const groqModel = env("GROQ_MODEL") || "llama-3.3-70b-versatile";

  // If this default model errors on your Cerebras account, set CEREBRAS_MODEL in Vercel env vars.
  const cerebrasModel = env("CEREBRAS_MODEL") || "llama3.1-8b";

  const mistralModel = env("MISTRAL_MODEL") || "mistral-small-latest";

  // IMPORTANT: no default HF text model (so it won't fail if you only have HF creds but no usable model)
  const hfModel = env("HF_MODEL");

  const cfgs: ProviderConfigMap = {
    groq: groqKey
      ? {
          baseUrl: "https://api.groq.com/openai/v1",
          apiKey: groqKey,
          model: groqModel,
        }
      : undefined,

    cerebras: cerebrasKey
      ? {
          // Cerebras OpenAI-compatible endpoint
          baseUrl: "https://api.cerebras.ai/v1",
          apiKey: cerebrasKey,
          model: cerebrasModel,
        }
      : undefined,

    mistral:
      mistralKey && !isVisionModelName(mistralModel)
        ? {
            baseUrl: "https://api.mistral.ai/v1",
            apiKey: mistralKey,
            model: mistralModel,
          }
        : undefined,

    // Skip HF text unless HF_MODEL is explicitly set
    hf:
      hfKey && hfModel
        ? {
            baseUrl: "https://router.huggingface.co/v1",
            apiKey: hfKey,
            model: hfModel,
          }
        : undefined,
  };

  return cfgs;
}

async function tryInOrder(
  order: Array<{ name: ProviderName; cfg?: OpenAICompatConfig }>,
  messages: ChatMessage[],
  opts?: { temperature?: number; max_tokens?: number }
) {
  let lastErr: any = null;
  const tried: string[] = [];

  for (const item of order) {
    if (!item.cfg) continue;

    try {
      return await chatCompletion(item.cfg, messages, opts);
    } catch (e: any) {
      lastErr = e;
      tried.push(`${item.name}: ${e?.message ?? String(e)}`);
      // continue to next provider
    }
  }

  if (!tried.length) {
    throw new Error(
      "No text AI providers configured. Add one or more of: GROQ_API_KEY, CEREBRAS_API_KEY, MISTRAL_API_KEY (+ non-vision MISTRAL_MODEL), HF_TOKEN + HF_MODEL"
    );
  }

  throw new Error(`All providers failed. ${tried.join(" | ")}`);
}

export async function runPrimary(strategy: Strategy, messages: ChatMessage[]) {
  const { groq, cerebras, mistral, hf } = getProviderConfigs();

  // Fast: prefer cheapest/fastest likely path first (Groq/Cerebras), then Mistral, then HF
  if (strategy === "fast") {
    return await tryInOrder(
      [
        { name: "groq", cfg: groq },
        { name: "cerebras", cfg: cerebras },
        { name: "mistral", cfg: mistral },
        { name: "hf", cfg: hf },
      ],
      messages,
      { temperature: 0.2, max_tokens: 900 }
    );
  }

  // Balanced/default
  return await tryInOrder(
    [
      { name: "groq", cfg: groq },
      { name: "cerebras", cfg: cerebras },
      { name: "mistral", cfg: mistral },
      { name: "hf", cfg: hf },
    ],
    messages,
    { temperature: 0.2, max_tokens: 1000 }
  );
}

export async function runVerifier(messages: ChatMessage[]) {
  const { mistral, groq, cerebras, hf } = getProviderConfigs();

  // Verifier order favors deterministic/stable response; skip unavailable automatically
  return await tryInOrder(
    [
      { name: "mistral", cfg: mistral },
      { name: "groq", cfg: groq },
      { name: "cerebras", cfg: cerebras },
      { name: "hf", cfg: hf },
    ],
    messages,
    { temperature: 0, max_tokens: 700 }
  );
}

export async function runConsensus(messages: ChatMessage[]) {
  const { groq, cerebras, mistral, hf } = getProviderConfigs();

  // Try to get two independent responses from the best available providers.
  // We prefer Groq + Cerebras first, then Mistral, then HF (if explicitly configured).
  const candidates: Array<{ name: ProviderName; cfg?: OpenAICompatConfig }> = [
    { name: "groq", cfg: groq },
    { name: "cerebras", cfg: cerebras },
    { name: "mistral", cfg: mistral },
    { name: "hf", cfg: hf },
  ].filter((x) => !!x.cfg) as Array<{ name: ProviderName; cfg: OpenAICompatConfig }>;

  if (!candidates.length) {
    throw new Error(
      "No providers configured for consensus. Add GROQ_API_KEY and/or CEREBRAS_API_KEY (recommended)."
    );
  }

  const firstTwo = candidates.slice(0, 2);

  const settled = await Promise.allSettled(
    firstTwo.map((p) =>
      chatCompletion(p.cfg, messages, { temperature: 0.2, max_tokens: 900 })
    )
  );

  const ok = settled.filter(
    (x): x is PromiseFulfilledResult<string> => x.status === "fulfilled"
  );

  if (ok.length >= 2) {
    return { a: ok[0].value, b: ok[1].value };
  }

  if (ok.length === 1) {
    // Get a second answer from any remaining provider
    const remaining = candidates.slice(2);
    for (const p of remaining) {
      try {
        const second = await chatCompletion(p.cfg, messages, {
          temperature: 0.2,
          max_tokens: 900,
        });
        return { a: ok[0].value, b: second };
      } catch {
        // keep trying
      }
    }
    return { a: ok[0].value, b: null };
  }

  // If both initial attempts failed, try all providers one by one until one works
  const fallback = await tryInOrder(
    candidates.map((c) => ({ name: c.name, cfg: c.cfg })),
    messages,
    { temperature: 0.2, max_tokens: 900 }
  );

  return { a: fallback, b: null };
}
