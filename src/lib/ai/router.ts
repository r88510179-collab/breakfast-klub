import { chatCompletion, type ChatMessage, type OpenAICompatConfig } from "./openaiCompat";

export type Strategy = "fast" | "balanced" | "consensus";

function cfg(baseUrl: string, apiKey: string | undefined, model: string | undefined): OpenAICompatConfig | undefined {
  if (!apiKey || !model) return undefined;
  return { baseUrl, apiKey, model };
}

function getProviderConfigs() {
  const openrouterKey = process.env.OPENROUTER_API_KEY;
  const groqKey = process.env.GROQ_API_KEY;
  const mistralKey = process.env.MISTRAL_API_KEY;
  const hfKey = process.env.HF_TOKEN; // you said you renamed secret to HF_TOKEN
  const cerebrasKey = process.env.CEREBRAS_API_KEY;

  return {
    // OpenRouter (text) — defaults based on your list
    orFast: cfg(
      "https://openrouter.ai/api/v1",
      openrouterKey,
      process.env.OPENROUTER_TEXT_MODEL_FAST || "google/gemma-3-4b-it:free"
    ),
    orBalanced: cfg(
      "https://openrouter.ai/api/v1",
      openrouterKey,
      process.env.OPENROUTER_TEXT_MODEL_BALANCED || "meta-llama/llama-3.3-70b-instruct:free"
    ),
    orVerify: cfg(
      "https://openrouter.ai/api/v1",
      openrouterKey,
      process.env.OPENROUTER_TEXT_MODEL_VERIFY || "mistralai/mistral-small-3.1-24b-instruct:free"
    ),
    orConsensusB: cfg(
      "https://openrouter.ai/api/v1",
      openrouterKey,
      process.env.OPENROUTER_TEXT_MODEL_CONSENSUS_B || "arcee-ai/trinity-large-preview:free"
    ),

    // Existing direct providers (optional fallbacks)
    groq: cfg(
      "https://api.groq.com/openai/v1",
      groqKey,
      process.env.GROQ_MODEL || "llama-3.3-70b-versatile"
    ),
    mistral: cfg(
      "https://api.mistral.ai/v1",
      mistralKey,
      process.env.MISTRAL_MODEL || "mistral-small-latest"
    ),
    hf: cfg(
      "https://router.huggingface.co/v1",
      hfKey,
      process.env.HF_MODEL || "mistralai/Mistral-7B-Instruct-v0.3"
    ),
    cerebras: cfg(
      "https://api.cerebras.ai/v1",
      cerebrasKey,
      process.env.CEREBRAS_MODEL || "llama3.1-8b"
    ),
  };
}

async function tryInOrder(
  order: Array<OpenAICompatConfig | undefined>,
  messages: ChatMessage[],
  opts?: { temperature?: number; max_tokens?: number }
) {
  let lastErr: any = null;
  for (const provider of order) {
    if (!provider) continue;
    try {
      return await chatCompletion(provider, messages, opts);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr ?? new Error("No text providers configured");
}

export async function runPrimary(strategy: Strategy, messages: ChatMessage[]) {
  const p = getProviderConfigs();

  if (strategy === "fast") {
    return tryInOrder(
      [p.orFast, p.groq, p.orBalanced, p.mistral, p.cerebras, p.hf],
      messages,
      { temperature: 0.2, max_tokens: 900 }
    );
  }

  return tryInOrder(
    [p.orBalanced, p.groq, p.mistral, p.cerebras, p.orFast, p.hf],
    messages,
    { temperature: 0.2, max_tokens: 1000 }
  );
}

export async function runVerifier(messages: ChatMessage[]) {
  const p = getProviderConfigs();
  return tryInOrder(
    [p.orVerify, p.mistral, p.groq, p.cerebras, p.orBalanced, p.hf],
    messages,
    { temperature: 0, max_tokens: 700 }
  );
}

export async function runConsensus(messages: ChatMessage[]) {
  const p = getProviderConfigs();

  // Prefer two distinct OpenRouter models first, then direct providers as fallbacks
  const [a, b] = await Promise.allSettled([
    p.orBalanced
      ? chatCompletion(p.orBalanced, messages, { temperature: 0.2, max_tokens: 900 })
      : Promise.reject(new Error("no openrouter balanced")),
    p.orConsensusB
      ? chatCompletion(p.orConsensusB, messages, { temperature: 0.2, max_tokens: 900 })
      : (p.groq
          ? chatCompletion(p.groq, messages, { temperature: 0.2, max_tokens: 900 })
          : Promise.reject(new Error("no second consensus provider"))),
  ]);

  const results = [a, b].filter(
    (x): x is PromiseFulfilledResult<string> => x.status === "fulfilled"
  );

  if (results.length >= 2) {
    return { a: results[0].value, b: results[1].value };
  }

  if (results.length === 1) {
    return { a: results[0].value, b: null };
  }

  // last fallback
  const single = await tryInOrder(
    [p.groq, p.mistral, p.cerebras, p.orFast, p.hf],
    messages,
    { temperature: 0.2, max_tokens: 900 }
  );
  return { a: single, b: null };
}
