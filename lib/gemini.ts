import { GoogleGenAI, Type } from '@google/genai';
import type { WikiSources } from './wikipedia';
import { type MBCredits, formatCreditsForPrompt } from './musicbrainz';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

export interface FactResult {
  fact: string;
  source: 'Wikipedia' | 'none';
  confidence: 'high' | 'medium' | 'low';
}

// Structured output schema — Gemini enforces this, no JSON prompt needed
const FACT_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    fact: {
      type: Type.STRING,
      description: '2-3 sentence fact written in a curious, slightly dry voice. Empty string if confidence is low.',
    },
    source: {
      type: Type.STRING,
      enum: ['Wikipedia', 'none'],
    },
    confidence: {
      type: Type.STRING,
      enum: ['high', 'medium', 'low'],
    },
  },
  required: ['fact', 'source', 'confidence'],
};

function buildPrompt(trackName: string, artistName: string, sources: WikiSources, mb: MBCredits): string {
  const sections: string[] = [];

  if (sources.artist) {
    sections.push(`=== ${sources.artist.title} (Wikipedia) ===\n${sources.artist.extract}`);
  }
  if (sources.song) {
    sections.push(`=== ${sources.song.title} (Wikipedia) ===\n${sources.song.extract}`);
  }

  const sourceBlock = sections.length > 0 ? sections.join('\n\n') : '(no source material found)';

  const creditsBlock = formatCreditsForPrompt(mb);
  const creditsSection = creditsBlock
    ? `\n\nPERSONNEL & CREDITS (from MusicBrainz):\n${creditsBlock}`
    : '';

  return `You are a music journalist who knows where the real stories are buried.

Song: "${trackName}" by ${artistName}

SOURCE MATERIAL:
${sourceBlock}${creditsSection}

Your job: find the single most specific, human, and surprising detail across all the material above and turn it into a 2–3 sentence fact. Speak like a knowledgeable friend — curious, slightly dry, never stiff.

Priority order (pick the highest one you can find evidence for):
1. Who or what the song was actually written about — a specific person, relationship, moment, or event
2. A surprising personal connection between the artist and another famous person, band, or collaborator listed in the credits
3. An unusual origin story — where/when/why it was written, what was happening in the artist's life
4. A behind-the-scenes detail about a specific person in the credits — a producer's approach, a session musician's contribution, a co-writer's story
5. An unexpected chart, legal, or cultural controversy

Hard rules:
- Use ONLY details present in the source material and credits above. Do not invent or infer.
- Never open with the artist's name or song title — dive straight into the story.
- Avoid generic phrases like "stylistic shift", "chart success", "influential artist", or "known for".
- If the source contains nothing specific enough to satisfy priorities 1–5, set confidence to "low" and fact to "".`;
}

// Retry with exponential backoff for transient errors (429, 503, 500).
async function generateWithRetry(prompt: string, maxAttempts = 3): Promise<FactResult> {
  let lastError: unknown;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (attempt > 0) {
      const delay = 1000 * Math.pow(2, attempt - 1); // 1s, 2s
      await new Promise(r => setTimeout(r, delay));
    }

    try {
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash-lite',
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
          responseSchema: FACT_SCHEMA,
          temperature: 0.4,
        },
      });

      const parsed = JSON.parse(response.text ?? '{}') as FactResult;
      if (!parsed.fact || parsed.fact.trim() === '') {
        return { fact: '', source: 'none', confidence: 'low' };
      }
      return parsed;
    } catch (err) {
      lastError = err;
      const msg = String(err);
      // Only retry on transient server-side errors
      const isRetryable = msg.includes('503') || msg.includes('500') || msg.includes('429');
      if (!isRetryable) break;
    }
  }

  throw lastError;
}

export async function generateFact(
  trackName: string,
  artistName: string,
  sources: WikiSources,
  mb: MBCredits = { credits: [] },
): Promise<FactResult> {
  const prompt = buildPrompt(trackName, artistName, sources, mb);
  return generateWithRetry(prompt);
}
