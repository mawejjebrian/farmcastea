// Vercel serverless endpoint for FARMCAST EA's Gemini-powered farming assistant.
// Configure GEMINI_API_KEY in Vercel Project Settings > Environment Variables.
// Never expose the key in client-side JavaScript or commit it to the repository.
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed." });
  const key = process.env.GEMINI_API_KEY;
  if (!key) return res.status(503).json({ error: "AI assistant is not configured yet." });
  const question = typeof req.body?.question === "string" ? req.body.question.trim() : "";
  const location = typeof req.body?.location === "string" ? req.body.location.slice(0, 120) : "East Africa";
  const crop = typeof req.body?.crop === "string" ? req.body.crop.slice(0, 80) : "unspecified";
  const language = ({ en: "English", lg: "Luganda", sw: "Kiswahili" })[req.body?.language] || "English";
  if (!question || question.length > 1500) return res.status(400).json({ error: "Please submit a question of up to 1,500 characters." });
  const prompt = `You are FARMCAST EA, a cautious agricultural information assistant for smallholder farmers in East Africa. Context: location ${location}; crop ${crop}. Respond in ${language}. Answer in clear, practical language. Ask clarifying questions when symptoms are ambiguous. Explain what the farmer can safely observe or do next. Never claim certainty from text alone, never prescribe pesticide brands/doses or unsafe chemical mixtures, and advise contacting a qualified local agricultural extension officer for serious disease, pest, poisoning, livestock or food-safety issues. Make clear that weather context is not a field diagnosis. Question: ${question}`;
  try {
    const upstream = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=" + encodeURIComponent(key), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.35, maxOutputTokens: 700 } })
    });
    const data = await upstream.json();
    if (!upstream.ok) return res.status(502).json({ error: "The AI service could not answer right now. Please try again later." });
    const answer = data.candidates?.[0]?.content?.parts?.map(p => p.text || "").join("\n").trim();
    if (!answer) return res.status(502).json({ error: "No answer was returned. Please try again." });
    return res.status(200).json({ answer });
  } catch {
    return res.status(502).json({ error: "Unable to reach the AI service. Check the connection and try again." });
  }
}
