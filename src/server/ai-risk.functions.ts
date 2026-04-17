import { createServerFn } from "@tanstack/react-start";

export interface AIRiskResult {
  risks: { category: string; title: string; description: string; severity: "High" | "Medium" | "Low" }[];
  bull_case: string;
  bear_case: string;
  thesis_summary: string;
  suggested_action: "Buy" | "Hold" | "Watch" | "Avoid";
}

/**
 * Calls Anthropic Claude with a user-provided API key.
 * The key is sent from the browser (localStorage) to this server function,
 * which then proxies the call to Anthropic. The key never reaches the browser
 * → Anthropic boundary directly (which would be blocked by CORS anyway).
 *
 * SECURITY NOTE: A user's key is in their localStorage. Anyone with access
 * to their browser can read it. Acceptable for personal/internal use only.
 */
export const generateAIRisk = createServerFn({ method: "POST" })
  .inputValidator((d: { apiKey: string; ticker: string; payload: any }) => {
    if (!d?.apiKey || typeof d.apiKey !== "string" || d.apiKey.length < 20) {
      throw new Error("Anthropic API key is required (set it in Settings).");
    }
    if (!d?.ticker || typeof d.ticker !== "string") throw new Error("Missing ticker.");
    if (!d?.payload || typeof d.payload !== "object") throw new Error("Missing payload.");
    return d;
  })
  .handler(async ({ data }) => {
    const { apiKey, ticker, payload } = data;
    const company = payload.company || {};
    const macro = payload.macro || {};

    const userPrompt = `You are a senior equity analyst. Based on the following data for ${ticker} (${company.name || ticker}, sector: ${company.sector || "Unknown"}, industry: ${company.industry || "Unknown"}), identify the top risks and provide an investment thesis.

Data: ${JSON.stringify(payload).slice(0, 18000)}

Macro context: Fed Funds=${macro.fedFunds ?? "n/a"}%, 10Y Yield=${macro.treas10y ?? "n/a"}%, VIX=${macro.vix ?? "n/a"}, CPI Index=${macro.cpi ?? "n/a"}, DXY=${macro.dxy ?? "n/a"}

Respond ONLY with valid minified JSON in exactly this structure (no markdown, no commentary):
{"risks":[{"category":"string","title":"string","description":"string","severity":"High|Medium|Low"}],"bull_case":"string","bear_case":"string","thesis_summary":"string","suggested_action":"Buy|Hold|Watch|Avoid"}

Identify the top 5 specific risks. Each description must be 2 sentences.`;

    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 2000,
        messages: [{ role: "user", content: userPrompt }],
      }),
    });

    if (!r.ok) {
      const errText = await r.text().catch(() => "");
      if (r.status === 401) throw new Error("Invalid Anthropic API key.");
      if (r.status === 429) throw new Error("Anthropic rate limit reached. Try again in a minute.");
      if (r.status === 529) throw new Error("Anthropic service overloaded. Try again shortly.");
      throw new Error(`Anthropic API error (${r.status}): ${errText.slice(0, 200)}`);
    }

    const json: any = await r.json();
    const content = json?.content?.[0]?.text || "";
    const cleaned = content.replace(/^```(?:json)?\s*|\s*```$/g, "").trim();
    let parsed: AIRiskResult;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      // Try to extract a JSON object substring
      const m = cleaned.match(/\{[\s\S]*\}/);
      if (!m) throw new Error("Claude returned non-JSON response.");
      parsed = JSON.parse(m[0]);
    }
    return parsed;
  });
