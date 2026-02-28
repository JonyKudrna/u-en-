module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Metoda není povolena.' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'Chybí ANTHROPIC_API_KEY.' });

  const { question, userAnswer, expectedAnswer } = req.body || {};

  if (!question || !userAnswer) {
    return res.status(400).json({ error: 'Chybí otázka nebo odpověď.' });
  }

  const prompt = `Jsi hodnotitel odpovědí. Zhodnoť, zda je odpověď studenta správná.

Otázka: ${question}
Vzorová odpověď: ${expectedAnswer || '(není k dispozici)'}
Odpověď studenta: ${userAnswer}

Buď velkorysý – pokud student zachytil podstatu, přiznej mu správnost i při jiné formulaci.
Odpověz POUZE platným JSON objektem (žádný text před ani po):
{
  "correct": true,
  "feedback": "Krátká zpětná vazba v češtině (1-2 věty). Pokud je špatně, uveď co chybělo."
}`;

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
        max_tokens: 256,
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
    const result = JSON.parse(s.slice(start, end + 1));
    return res.json({ correct: !!result.correct, feedback: result.feedback || '' });
  } catch {
    return res.json({ correct: false, feedback: 'Nepodařilo se vyhodnotit odpověď automaticky.' });
  }
};
