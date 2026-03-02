const TYPE_PROMPTS = {
  multiple_choice: `Vytvoř jednu otázku s výběrem ze čtyř možností.
Správnou odpověď NÁHODNĚ umísti na různé pozice — ne vždy na pozici 0 (A). Střídej pozice A, B, C, D rovnoměrně.
Formát JSON:
{
  "type": "multiple_choice",
  "question": "Text otázky?",
  "options": ["Možnost A", "Možnost B", "Možnost C", "Možnost D"],
  "correct": 2,
  "explanation": "Krátké vysvětlení správné odpovědi."
}`,
  true_false: `Vytvoř jedno tvrzení, které je buď pravdivé nebo nepravdivé.
Formát JSON:
{
  "type": "true_false",
  "question": "Tvrzení k posouzení.",
  "correct": true,
  "explanation": "Krátké vysvětlení proč je tvrzení pravdivé/nepravdivé."
}`,
  open: `Vytvoř jednu otevřenou otázku na VELMI KRÁTKOU odpověď (maximálně 5 slov).
Ptej se na konkrétní fakta: jméno, rok, místo, název, počet apod.
Vhodné formáty: "Jak se jmenuje...?", "Ve kterém roce...?", "Kdo byl...?", "Kde se nachází...?", "Kolik...?"
VYHNI SE otázkám vyžadujícím vysvětlení nebo popis.
Do textu otázky vlož pokyn v závorce: "(Odpověz maximálně 5 slovy.)"
Formát JSON:
{
  "type": "open",
  "question": "Jak se jmenuje...? (Odpověz maximálně 5 slovy.)",
  "answer": "Vzorová odpověď v 1–5 slovech.",
  "keywords": ["klíčové slovo"]
}`,
  explain: `Vytvoř jednu otázku vyžadující delší vysvětlení nebo popis (3-5 vět).
Formát JSON:
{
  "type": "explain",
  "question": "Vysvětli / Popiš / Jak funguje... ?",
  "answer": "Vzorová odpověď v rozsahu 3-5 vět."
}`
};

const DIFF_DESC = {
  easy: 'Lehká – přímá fakta z textu, zřejmé odpovědi.',
  medium: 'Střední – porozumění a propojení informací.',
  hard: 'Těžká – analýza, závěry, kritické hodnocení.'
};

function buildPrompt(text, topic, questionType, askedQuestions, difficulty) {
  const diff = DIFF_DESC[difficulty] || DIFF_DESC.medium;
  const typeInstr = TYPE_PROMPTS[questionType] || TYPE_PROMPTS.multiple_choice;
  const skipPart = askedQuestions.length > 0
    ? `\nUž byly položeny tyto otázky (NEVYTVÁŘEJ podobné ani stejné): ${askedQuestions.slice(-15).map(q => `"${q}"`).join('; ')}`
    : '';

  return `Jsi zkušený pedagog. Z textu o tématu "${topic}" vytvoř JEDNU výukovou otázku v ČEŠTINĚ.
Obtížnost: ${diff}${skipPart}

${typeInstr}

DŮLEŽITÉ: Odpověz POUZE platným JSON objektem, žádný text před ani po.

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

  const { text, topic, questionType, askedQuestions = [], difficulty = 'medium' } = req.body || {};

  if (!text || typeof text !== 'string' || text.trim().length < 50) {
    return res.status(400).json({ error: 'Text chybí nebo je příliš krátký.' });
  }

  const validTypes = ['multiple_choice', 'true_false', 'open', 'explain'];
  const qType = validTypes.includes(questionType) ? questionType : 'multiple_choice';

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
        messages: [{ role: 'user', content: buildPrompt(text, topic || 'celý text', qType, askedQuestions, difficulty) }]
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
