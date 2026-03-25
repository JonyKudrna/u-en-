const DIFF_DESC = {
  easy: 'Lehká – přímá fakta z textu, zřejmé odpovědi.',
  medium: 'Střední – porozumění a propojení informací.',
  hard: 'Těžká – analýza, závěry, kritické hodnocení.'
};

function buildPrompt(text, topic, askedQuestions, masteredQuestions, difficulty) {
  const diff = DIFF_DESC[difficulty] || DIFF_DESC.medium;

  let masteredPart = '';
  if (masteredQuestions.length > 0) {
    masteredPart = `\n\nStudent toto JIŽ ZVLÁDL — nikdy nevytvářej otázku na tato ani obsahově podobná témata:\n${masteredQuestions.slice(-30).map(q => `• "${q}"`).join('\n')}`;
  }

  let recentPart = '';
  if (askedQuestions.length > 0) {
    recentPart = `\n\nNedávno položené otázky (nevytvářej duplicitní ani tematicky podobné):\n${askedQuestions.slice(-10).map(q => `• "${q}"`).join('\n')}`;
  }

  return `Jsi zkušený pedagog. Z textu o tématu "${topic}" vytvoř JEDNU novou výukovou otázku s výběrem odpovědí A/B/C/D v ČEŠTINĚ.
Obtížnost: ${diff}${masteredPart}${recentPart}

Pokyny:
- Pokrývej RŮZNÉ části a aspekty textu — nejen nejznámější pojmy nebo osobnosti.
- Každá otázka musí testovat JINÝ fakt nebo koncept než otázky výše.
- Správnou odpověď NÁHODNĚ umísti na různé pozice (0=A, 1=B, 2=C, 3=D) — nestrkej ji vždy na pozici 0.
- Všechny čtyři možnosti musí být věrohodné a přibližně stejně dlouhé.

Odpověz POUZE tímto JSON objektem, bez jakéhokoli dalšího textu:
{
  "type": "multiple_choice",
  "question": "Text otázky?",
  "options": ["Možnost A", "Možnost B", "Možnost C", "Možnost D"],
  "correct": 2,
  "explanation": "Krátké vysvětlení správné odpovědi."
}

TEXT:
---
${text.slice(0, 8000)}
---`;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Metoda není povolena.' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'Chybí ANTHROPIC_API_KEY.' });

  const {
    text,
    topic,
    askedQuestions = [],
    masteredQuestions = [],
    difficulty = 'medium'
  } = req.body || {};

  if (!text || typeof text !== 'string' || text.trim().length < 50) {
    return res.status(400).json({ error: 'Text chybí nebo je příliš krátký.' });
  }

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
        messages: [{ role: 'user', content: buildPrompt(text, topic || 'celý text', askedQuestions, masteredQuestions, difficulty) }]
      })
    });
  } catch {
    return res.status(503).json({ error: 'Nepodařilo se připojit ke Claude API.' });
  }

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    if (resp.status === 429) return res.status(429).json({ error: 'Překročen limit požadavků. Zkuste to za chvíli.' });
    if (resp.status === 529) return res.status(503).json({ error: 'Claude API je přetíženo. Zkuste to za chvíli.' });
    return res.status(resp.status).json({ error: err.error?.message || `HTTP ${resp.status}` });
  }

  const data = await resp.json();
  const raw = data.content?.[0]?.text;
  if (!raw) return res.status(500).json({ error: 'Prázdná odpověď od AI.' });

  try {
    let s = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
    const start = s.indexOf('{');
    const end = s.lastIndexOf('}');
    const question = JSON.parse(s.slice(start, end + 1));
    if (!question.type || !question.question) throw new Error('Neplatný formát.');
    return res.json({ question });
  } catch {
    return res.status(500).json({ error: 'Nepodařilo se zpracovat otázku od AI. Zkuste znovu.' });
  }
};
