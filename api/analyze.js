module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Metoda není povolena.' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'Chybí ANTHROPIC_API_KEY.' });

  const { text } = req.body || {};
  if (!text || typeof text !== 'string' || text.trim().length < 50) {
    return res.status(400).json({ error: 'Text je příliš krátký nebo chybí.' });
  }

  const prompt = `Z níže uvedeného textu identifikuj hlavní témata nebo kapitoly (maximálně 8).
Pro každé téma uveď krátký název (max 40 znaků) a jednovětuý popis obsahu.
Odpověz POUZE platným JSON objektem v tomto formátu (bez jakéhokoli dalšího textu):
{
  "topics": [
    { "id": "t1", "name": "Název tématu", "description": "Jednovětuý popis obsahu tématu." }
  ]
}

TEXT:
---
${text.slice(0, 10000)}
---`;

  let resp;
  try {
    resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1024,
        messages: [{ role: 'user', content: prompt }]
      })
    });
  } catch {
    return res.status(503).json({ error: 'Nepodařilo se připojit ke Claude API.' });
  }

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    if (resp.status === 429) return res.status(429).json({ error: 'Překročen limit požadavků.' });
    return res.status(resp.status).json({ error: err.error?.message || `HTTP ${resp.status}` });
  }

  const data = await resp.json();
  const raw = data.content?.[0]?.text;
  if (!raw) return res.status(500).json({ error: 'Prázdná odpověď od AI.' });

  try {
    let s = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
    const start = s.indexOf('{');
    const end = s.lastIndexOf('}');
    const parsed = JSON.parse(s.slice(start, end + 1));
    if (!Array.isArray(parsed.topics) || parsed.topics.length === 0) throw new Error('no topics');
    return res.json({ topics: parsed.topics });
  } catch {
    return res.json({ topics: [{ id: 't1', name: 'Celý text', description: 'Procvičování ze všech částí textu.' }] });
  }
};
