const DIFF_DESC = {
  easy: 'Lehká – přímá fakta z textu, zřejmé odpovědi.',
  medium: 'Střední – porozumění a propojení informací.',
  hard: 'Těžká – analýza, závěry, kritické hodnocení.'
};

function buildBatchPrompt(text, topics, count, masteredQuestions, askedQuestions, difficulty) {
  const diff = DIFF_DESC[difficulty] || DIFF_DESC.medium;
  const topicsList = topics.map(t => `• ${t.id}: ${t.name}`).join('\n');

  let masteredPart = '';
  if (masteredQuestions.length > 0) {
    masteredPart = `\n\nTyto otázky student JIŽ ZVLÁDL — nikdy je nevytvářej znovu (ani v jiném znění):\n${masteredQuestions.slice(-40).map(q => `• "${q}"`).join('\n')}`;
  }

  let recentPart = '';
  if (askedQuestions.length > 0) {
    recentPart = `\n\nNedávno položené otázky (nevytvářej podobné):\n${askedQuestions.slice(-20).map(q => `• "${q}"`).join('\n')}`;
  }

  return `Jsi zkušený pedagog. Vygeneruj přesně ${count} různorodých výukových otázek s výběrem A/B/C/D v ČEŠTINĚ z níže uvedeného textu.
Obtížnost: ${diff}

Témata (rovnoměrně pokrývej všechna):
${topicsList}${masteredPart}${recentPart}

Pokyny:
- Každá otázka musí testovat JINÝ fakt nebo koncept
- Pokrývej RŮZNÉ části a aspekty textu, nejen nejznámější pojmy
- Správnou odpověď umísti NÁHODNĚ na různé pozice (0=A, 1=B, 2=C, 3=D)
- Všechny čtyři možnosti musí být věrohodné a přibližně stejně dlouhé
- Pole "topicId" musí odpovídat jednomu z ID témat uvedených výše

Odpověz POUZE tímto JSON polem (přesně ${count} objektů), bez jakéhokoli dalšího textu:
[
  {
    "topicId": "id_tématu",
    "topicName": "Název tématu",
    "question": "Text otázky?",
    "options": ["Možnost A", "Možnost B", "Možnost C", "Možnost D"],
    "correct": 2,
    "explanation": "Krátké vysvětlení správné odpovědi."
  }
]

TEXT:
---
${text.slice(0, 12000)}
---`;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'Chybí ANTHROPIC_API_KEY.' });

  const {
    text,
    topics = [],
    count = 20,
    masteredQuestions = [],
    askedQuestions = [],
    difficulty = 'medium'
  } = req.body || {};

  if (!text || typeof text !== 'string' || text.trim().length < 50) {
    return res.status(400).json({ error: 'Text chybí nebo je příliš krátký.' });
  }
  if (!Array.isArray(topics) || topics.length === 0) {
    return res.status(400).json({ error: 'Témata chybí.' });
  }

  const safeCount = Math.min(Math.max(parseInt(count) || 20, 5), 40);

  let resp;
  try {
    resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 8000,
        messages: [{
          role: 'user',
          content: buildBatchPrompt(text, topics, safeCount, masteredQuestions, askedQuestions, difficulty)
        }]
      })
    });
  } catch {
    return res.status(502).json({ error: 'Nepodařilo se spojit s AI.' });
  }

  const aiData = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    if (resp.status === 429) return res.status(429).json({ error: 'Překročen limit požadavků.' });
    return res.status(502).json({ error: aiData.error?.message || 'Chyba AI.' });
  }

  const raw = aiData.content?.[0]?.text || '';

  // Extract JSON array from response
  const match = raw.match(/\[[\s\S]*\]/);
  if (!match) return res.status(502).json({ error: 'AI nevrátila platné pole otázek.' });

  let questions;
  try {
    questions = JSON.parse(match[0]);
  } catch {
    return res.status(502).json({ error: 'Chyba při parsování odpovědi AI.' });
  }

  if (!Array.isArray(questions)) return res.status(502).json({ error: 'AI nevrátila pole.' });

  // Normalize and validate questions
  const normalized = questions
    .filter(q => q && typeof q.question === 'string' && q.question.length > 5 &&
                 Array.isArray(q.options) && q.options.length === 4)
    .map(q => ({
      type: 'multiple_choice',
      _topicId: q.topicId || topics[0]?.id || '',
      _topicName: q.topicName || topics[0]?.name || '',
      question: q.question,
      options: q.options.map(String),
      correct: typeof q.correct === 'number' ? q.correct : (parseInt(q.correct) || 0),
      explanation: q.explanation || ''
    }));

  res.json({ questions: normalized });
};
