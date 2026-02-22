import { chatCompletion, type ChatMessage, type OpenAICompatConfig } from "./openaiCompat";

export type Strategy = "fast" | "balanced" | "consensus";

type ProviderMap = {
  openrouter?: OpenAICompatConfig;
  groq?: OpenAICompatConfig;
  cerebras?: OpenAICompatConfig;
  mistral?: OpenAICompatConfig;
  hf?: OpenAICompatConfig;
};

function getProviderConfigs(): ProviderMap {
  const openrouterKey = process.env.OPENROUTER_API_KEY;
  const groqKey = process.env.GROQ_API_KEY;
  const cerebrasKey = process.env.CEREBRAS_API_KEY;
  const mistralKey = process.env.MISTRAL_API_KEY;
  const hfKey = process.env.HF_TOKEN;

  return {
    // OpenRouter (recommended primary now)
    openrouter: openrouterKey
      ? {
          baseUrl: "https://openrouter.ai/api/v1",
          apiKey: openrouterKey,
          // Set this in Vercel to one of your preferred FREE text models on OpenRouter
          // e.g. "meta-llama/llama-3.1-8b-instruct:free"
          model: process.env.OPENROUTER_MODEL || "meta-llama/llama-3.1-8b-instruct:free",
        }
      : undefined,

    // Groq
    groq: groqKey
      ? {
          baseUrl: "https://api.groq.com/openai/v1",
          apiKey: groqKey,
          model: process.env.GROQ_MODEL || "llama-3.3-70b-versatile",
        }
      : undefined,

    // Cerebras (OpenAI-compatible)
    cerebras: cerebrasKey
      ? {
          baseUrl: "https://api.cerebras.ai/v1",
          apiKey: cerebrasKey,
          // Set exact model in env if needed for your account
          model: process.env.CEREBRAS_MODEL || "llama-3.3-70b",
        }
      : undefined,

    // Mistral (text)
    mistral: mistralKey
      ? {
          baseUrl: "https://api.mistral.ai/v1",
          apiKey: mistralKey,
          model: process.env.MISTRAL_MODEL || "mistral-small-latest",
        }
      : undefined,

    // Hugging Face Router (text)
    hf: hfKey
      ? {
          baseUrl: "https://router.huggingface.co/v1",
          apiKey: hfKey,
          model: process.env.HF_MODEL || "mistralai/Mistral-7B-Instruct-v0.3",
        }
      : undefined,
  };
}

async function tryInOrder(
  order: Array<OpenAICompatConfig | undefined>,
  messages: ChatMessage[],
  opts?: { temperature?: number; max_tokens?: number }
) {
  let lastErr: any = null;

  for (const cfg of order) {
    if (!cfg) continue;
    try {
      return await chatCompletion(cfg, messages, opts);
    } catch (e) {
      lastErr = e;
    }
  }

  throw lastErr ?? new Error("No providers configured");
}

export async function runPrimary(strategy: Strategy, messages: ChatMessage[]) {
  const { openrouter, groq, cerebras, mistral, hf } = getProviderConfigs();

  if (strategy === "fast") {
    // Lowest latency first (usually Groq/Cerebras/OpenRouter free small model)
    return await tryInOrder([groq, cerebras, openrouter, mistral, hf], messages, {
      temperature: 0.2,
      max_tokens: 900,
    });
  }

  // balanced default
  return await tryInOrder([openrouter, groq, cerebras, mistral, hf], messages, {
    temperature: 0.2,
    max_tokens: 1000,
  });
}

export async function runVerifier(messages: ChatMessage[]) {
  const { openrouter, mistral, groq, cerebras, hf } = getProviderConfigs();

  // Prefer deterministic / reliable verifier order
  return await tryInOrder([openrouter, mistral, groq, cerebras, hf], messages, {
    temperature: 0,
    max_tokens: 700,
  });
}

export async function runConsensus(messages: ChatMessage[]) {
  const { openrouter, groq, cerebras, mistral, hf } = getProviderConfigs();

  // Try to get 2 independent drafts (ideally different providers)
  const pairs: Array<OpenAICompatConfig | undefined> = [openrouter, groq, cerebras, mistral, hf].filter(
    Boolean
  );

  if (pairs.length === 0) throw new Error("No providers configured for consensus");

  // First two providers
  if (pairs.length >= 2) {
    const [cfgA, cfgB] = pairs;

    const [a, b] = await Promise.allSettled([
      chatCompletion(cfgA!, messages, { temperature: 0.2, max_tokens: 900 }),
      chatCompletion(cfgB!, messages, { temperature: 0.2, max_tokens: 900 }),
    ]);

    const results = [a, b].filter(
      (x): x is PromiseFulfilledResult<string> => x.status === "fulfilled"
    );

    if (results.length >= 2) return { a: results[0].value, b: results[1].value };
    if (results.length === 1) return { a: results[0].value, b: null };
  }

  // Fallback single response from any configured provider
  const one = await tryInOrder([openrouter, groq, cerebras, mistral, hf], messages, {
    temperature: 0.2,
    max_tokens: 900,
  });

  return { a: one, b: null };
}
