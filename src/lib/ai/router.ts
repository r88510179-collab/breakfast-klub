import { chatCompletion, ChatMessage, OpenAICompatConfig } from "./openaiCompat";

export type Strategy = "fast" | "balanced" | "consensus";

function getProviderConfigs(): { groq?: OpenAICompatConfig; mistral?: OpenAICompatConfig; hf?: OpenAICompatConfig } {
  const groqKey = process.env.GROQ_API_KEY;
  const mistralKey = process.env.MISTRAL_API_KEY;
  const hfKey = process.env.HF_TOKEN;

  return {
    groq: groqKey
      ? {
          baseUrl: "https://api.groq.com/openai/v1",
          apiKey: groqKey,
          model: process.env.GROQ_MODEL || "llama-3.3-70b-versatile",
        }
      : undefined,
    mistral: mistralKey
      ? {
          baseUrl: "https://api.mistral.ai/v1",
          apiKey: mistralKey,
          model: process.env.MISTRAL_MODEL || "mistral-small-latest",
        }
      : undefined,
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
  const { groq, mistral, hf } = getProviderConfigs();

  // Load-sharing defaults:
  // - fast: Groq -> Mistral -> HF
  // - balanced/consensus: Groq+Mistral preferred, HF as fallback
  if (strategy === "fast") {
    return await tryInOrder([groq, mistral, hf], messages, { temperature: 0.2, max_tokens: 900 });
  }

  return await tryInOrder([groq, mistral, hf], messages, { temperature: 0.2, max_tokens: 1000 });
}

export async function runVerifier(messages: ChatMessage[]) {
  const { mistral, groq, hf } = getProviderConfigs();

  // Verifier prefers different provider order for diversity
  return await tryInOrder([mistral, groq, hf], messages, { temperature: 0, max_tokens: 700 });
}

export async function runConsensus(messages: ChatMessage[]) {
  const { groq, mistral, hf } = getProviderConfigs();

  const [a, b] = await Promise.allSettled([
    groq ? chatCompletion(groq, messages, { temperature: 0.2, max_tokens: 900 }) : Promise.reject("no groq"),
    mistral ? chatCompletion(mistral, messages, { temperature: 0.2, max_tokens: 900 }) : Promise.reject("no mistral"),
  ]);

  const results = [a, b].filter((x): x is PromiseFulfilledResult<string> => x.status === "fulfilled");
  if (results.length >= 2) {
    // return both; caller decides if they match or needs verification
    return { a: results[0].value, b: results[1].value };
  }

  // fallback single response
  const one = results[0]?.value;
  if (one) return { a: one, b: null };
  // fallback to HF if both missing
  if (!hf) throw new Error("No providers configured for consensus");
  return { a: await chatCompletion(hf, messages), b: null };
}
