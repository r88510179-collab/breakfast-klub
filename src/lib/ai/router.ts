import { chatCompletion, type ChatMessage, type OpenAICompatConfig } from "./openaiCompat";

export type Strategy = "fast" | "balanced" | "consensus";

function getTextProviderConfigs(): {
  groq?: OpenAICompatConfig;
  mistral?: OpenAICompatConfig;
  hf?: OpenAICompatConfig;
  cerebras?: OpenAICompatConfig;
} {
  const groqKey = process.env.GROQ_API_KEY;
  const mistralKey = process.env.MISTRAL_API_KEY;
  const hfKey = process.env.HF_TOKEN;
  const cerebrasKey = process.env.CEREBRAS_API_KEY;

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

    cerebras: cerebrasKey
      ? {
          baseUrl: "https://api.cerebras.ai/v1",
          apiKey: cerebrasKey,
          model: process.env.CEREBRAS_MODEL || "llama-3.3-70b",
        }
      : undefined,
  };
}

/**
 * Vision-capable provider configs for slip scanning.
 * IMPORTANT: set *_VISION_MODEL env vars to models that actually support image input.
 */
function getVisionProviderConfigs(): {
  groq?: OpenAICompatConfig;
  mistral?: OpenAICompatConfig;
  hf?: OpenAICompatConfig;
  cerebras?: OpenAICompatConfig;
} {
  const groqKey = process.env.GROQ_API_KEY;
  const mistralKey = process.env.MISTRAL_API_KEY;
  const hfKey = process.env.HF_TOKEN;
  const cerebrasKey = process.env.CEREBRAS_API_KEY;

  return {
    groq: groqKey
      ? {
          baseUrl: "https://api.groq.com/openai/v1",
          apiKey: groqKey,
          model: process.env.GROQ_VISION_MODEL || process.env.GROQ_MODEL || "",
        }
      : undefined,

    mistral: mistralKey
      ? {
          baseUrl: "https://api.mistral.ai/v1",
          apiKey: mistralKey,
          model: process.env.MISTRAL_VISION_MODEL || process.env.MISTRAL_MODEL || "",
        }
      : undefined,

    hf: hfKey
      ? {
          baseUrl: "https://router.huggingface.co/v1",
          apiKey: hfKey,
          model: process.env.HF_VISION_MODEL || process.env.HF_MODEL || "",
        }
      : undefined,

    // Cerebras may or may not have a vision model enabled for your account.
    // If not, leave CEREBRAS_VISION_MODEL unset and this provider will be skipped for scanning.
    cerebras:
      cerebrasKey && process.env.CEREBRAS_VISION_MODEL
        ? {
            baseUrl: "https://api.cerebras.ai/v1",
            apiKey: cerebrasKey,
            model: process.env.CEREBRAS_VISION_MODEL,
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
    if (!cfg || !cfg.model) continue;
    try {
      return await chatCompletion(cfg, messages, opts);
    } catch (e) {
      lastErr = e;
    }
  }

  throw lastErr ?? new Error("No providers configured");
}

export async function runPrimary(strategy: Strategy, messages: ChatMessage[]) {
  const { groq, mistral, hf, cerebras } = getTextProviderConfigs();

  if (strategy === "fast") {
    return await tryInOrder([groq, cerebras, mistral, hf], messages, {
      temperature: 0.2,
      max_tokens: 900,
    });
  }

  return await tryInOrder([groq, mistral, cerebras, hf], messages, {
    temperature: 0.2,
    max_tokens: 1000,
  });
}

export async function runVerifier(messages: ChatMessage[]) {
  const { mistral, groq, cerebras, hf } = getTextProviderConfigs();
  return await tryInOrder([mistral, groq, cerebras, hf], messages, {
    temperature: 0,
    max_tokens: 700,
  });
}

export async function runConsensus(messages: ChatMessage[]) {
  const { groq, mistral, cerebras, hf } = getTextProviderConfigs();

  const candidates = [groq, mistral, cerebras].filter(Boolean) as OpenAICompatConfig[];

  const [a, b] = await Promise.allSettled([
    candidates[0]
      ? chatCompletion(candidates[0], messages, { temperature: 0.2, max_tokens: 900 })
      : Promise.reject("no provider A"),
    candidates[1]
      ? chatCompletion(candidates[1], messages, { temperature: 0.2, max_tokens: 900 })
      : Promise.reject("no provider B"),
  ]);

  const results = [a, b].filter((x): x is PromiseFulfilledResult<string> => x.status === "fulfilled");
  if (results.length >= 2) return { a: results[0].value, b: results[1].value };

  const one = results[0]?.value;
  if (one) return { a: one, b: null };

  if (!hf) throw new Error("No providers configured for consensus");
  return { a: await chatCompletion(hf, messages), b: null };
}

/* --------------------------
   Scanner-specific helpers
   -------------------------- */

export async function runSlipScanPrimary(messages: ChatMessage[]) {
  const { groq, mistral, hf, cerebras } = getVisionProviderConfigs();

  // Try likely vision providers first, Cerebras only if you explicitly set CEREBRAS_VISION_MODEL
  return await tryInOrder([groq, mistral, hf, cerebras], messages, {
    temperature: 0,
    max_tokens: 1400,
  });
}

export async function runSlipScanConsensus(messages: ChatMessage[]) {
  const { groq, mistral, hf, cerebras } = getVisionProviderConfigs();

  const candidates = [groq, mistral, hf, cerebras].filter(
    (x): x is OpenAICompatConfig => !!x && !!x.model
  );

  const [a, b] = await Promise.allSettled([
    candidates[0]
      ? chatCompletion(candidates[0], messages, { temperature: 0, max_tokens: 1400 })
      : Promise.reject("no provider A"),
    candidates[1]
      ? chatCompletion(candidates[1], messages, { temperature: 0, max_tokens: 1400 })
      : Promise.reject("no provider B"),
  ]);

  const results = [a, b].filter((x): x is PromiseFulfilledResult<string> => x.status === "fulfilled");
  if (results.length >= 2) return { a: results[0].value, b: results[1].value };

  const one = results[0]?.value;
  if (one) return { a: one, b: null };

  throw new Error("No vision-capable providers configured for slip scanning");
}
