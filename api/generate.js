const DIFF_DESCRIPTIONS = {
  easy:   'Lehká – otázky na konkrétní fakta přímo zmíněná v textu. Odpovědi jsou zřejmé ze čtení.',
  medium: 'Střední – otázky vyžadující porozumění, schopnost shrnout a propojit informace z textu.',
  hard:   'Těžká – analytické otázky. Vyžadují hlubší porozumění, schopnost vyvodit závěry a kriticky zhodnotit.'
};

function buildPrompt(text, difficulty) {
  const desc = DIFF_DESCRIPTIONS[difficulty] || DIFF_DESCRIPTIONS.medium;
  return `Jsi zkušený pedagog. Z níže uvedeného textu vytvoř výukový kvíz v ČEŠTINĚ.

Obtížnost: ${desc}

Vytvoř přesně 10 otázek:
- Otázky 1–6: výběr ze čtyř možností (typ "multiple_choice")
- Otázky 7–10: otevřená otázka na krátkou odpověď (typ "open")

DŮLEŽITÉ PRAVIDLA:
- Všechny otázky a odpovědi MUSÍ být v češtině
- Otázky musí vycházet výhradně z obsahu textu
- U multiple_choice: pole "correct" je INDEX (0=A, 1=B, 2=C, 3=D) správné odpovědi
- Odpověz POUZE platným JSON objektem, bez jakéhokoliv dalšího textu nebo markdown formátování

Formát:
{
  "questions": [
    {
      "id": 1,
      "type": "multiple_choice",
      "question": "Text otázky?",
      "options": ["Možnost A", "Možnost B", "Možnost C", "Možnost D"],
      "correct": 0,
      "explanation": "Stručné vysvětlení proč je tato odpověď správná."
    },
    {
      "id": 7,
      "type": "open",
      "question": "Text otevřené otázky?",
      "answer": "Vzorová správná odpověď.",
      "keywords": ["klíčové slovo 1", "klíčové slovo 2", "klíčové slovo 3"]
    }
  ]
}

TEXT K ANALÝZE:
---
${text.slice(0, 8000)}
---`;
}

function parseQuestions(raw) {
  let s = raw.trim();
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('Nepodařilo se zpracovat odpověď AI. Zkuste to znovu.');
  const parsed = JSON.parse(s.slice(start, end + 1));
  if (!Array.isArray(parsed.questions) || parsed.questions.length === 0)
    throw new Error('AI nevygenerovala žádné otázky. Zkuste jiný text.');
  return parsed.questions;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Metoda není povolena.' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'Služba není nakonfigurována – chybí ANTHROPIC_API_KEY.' });
  }

  const { text, difficulty } = req.body || {};

  if (!text || typeof text !== 'string' || text.trim().length < 50) {
    return res.status(400).json({ error: 'Text je příliš krátký nebo chybí.' });
  }
  if (!difficulty || !['easy', 'medium', 'hard'].includes(difficulty)) {
    return res.status(400).json({ error: 'Neplatná hodnota obtížnosti.' });
  }

  let claudeResp;
  try {
    claudeResp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-opus-4-6',
        max_tokens: 4096,
        messages: [{ role: 'user', content: buildPrompt(text, difficulty) }]
      })
    });
  } catch {
    return res.status(503).json({ error: 'Nepodařilo se připojit ke Claude API. Zkontrolujte připojení.' });
  }

  if (!claudeResp.ok) {
    const err = await claudeResp.json().catch(() => ({}));
    const msg = err.error?.message || `HTTP ${claudeResp.status}`;
    if (claudeResp.status === 429) return res.status(429).json({ error: 'Překročen limit požadavků. Zkuste to za chvíli.' });
    if (claudeResp.status === 529) return res.status(503).json({ error: 'Claude API je přetíženo. Zkuste to za chvíli.' });
    return res.status(claudeResp.status).json({ error: `Chyba Claude API: ${msg}` });
  }

  const data = await claudeResp.json();
  const rawText = data.content?.[0]?.text;
  if (!rawText) return res.status(500).json({ error: 'Prázdná odpověď od AI.' });

  let questions;
  try {
    questions = parseQuestions(rawText);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }

  return res.json({ questions });
};
