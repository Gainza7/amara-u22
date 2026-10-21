// Lee la foto o el texto de un horario o entreno con Claude y devuelve el JSON que pide la app.
// Variables en Vercel: ANTHROPIC_API_KEY (clave de la API de Claude) y APP_TOKEN (la misma clave que TOKEN en Apps Script).
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();

function dataUrlToImage(u) {
  const m = /^data:(image\/(?:jpeg|png|webp|gif));base64,(.+)$/.exec(String(u || ""));
  if (!m) return null;
  return { type: "image", source: { type: "base64", media_type: m[1], data: m[2] } };
}

function parseJson(text) {
  const t = String(text || "").replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  try { return JSON.parse(t); } catch (e) {}
  const a = t.indexOf("["), b = t.lastIndexOf("]");
  if (a >= 0 && b > a) return JSON.parse(t.slice(a, b + 1));
  throw new Error("invalid_json");
}

export default async function handler(req, res) {
  if (req.method === "GET") return res.status(200).json({ ok: !!process.env.ANTHROPIC_API_KEY });
  if (req.method !== "POST") return res.status(405).json({ error: "method" });
  const { token, prompt, images } = req.body || {};
  if (!process.env.APP_TOKEN || token !== process.env.APP_TOKEN) return res.status(401).json({ error: "bad_token" });
  if (!process.env.ANTHROPIC_API_KEY) return res.status(503).json({ error: "no_key" });
  if (!prompt) return res.status(400).json({ error: "bad_request" });

  const content = [];
  for (const u of (images || []).slice(0, 2)) {
    const img = dataUrlToImage(u);
    if (!img) return res.status(400).json({ error: "image_rejected" });
    content.push(img);
  }
  content.push({ type: "text", text: prompt });

  try {
    const msg = await client.beta.messages.create({
      model: "claude-opus-5-5",
      max_tokens: 16000,
      output_config: { effort: "low" },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: "Respondes solo con JSON válido, sin texto antes ni después.",
      messages: [{ role: "user", content }],
    });
    if (msg.stop_reason === "refusal") return res.status(422).json({ error: "refused" });
    const text = msg.content.filter((b) => b.type === "text").map((b) => b.text).join("");
    return res.status(200).json({ data: parseJson(text) });
  } catch (e) {
    if (e && e.message === "invalid_json") return res.status(422).json({ error: "invalid_json" });
    if (e instanceof Anthropic.RateLimitError) return res.status(429).json({ error: "rate_limited" });
    if (e instanceof Anthropic.APIError) return res.status(502).json({ error: "api_error", message: String(e.message).slice(0, 200) });
    return res.status(500).json({ error: "server_error" });
  }
}
