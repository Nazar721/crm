import { ScrapedWebsite, Lead, PipelineConfig, AISingleAnalysis, AIAnalysisResult } from '../types';
import { aiRouter } from '../ai/AIRouter';

export interface RuleBasedScores {
  matchScore: number;
  locationScore: number;
  contactScore: number;
  qualityScore: number;
  problemsScore: number;
}

export function calculateRuleBasedScore(
  scraped: ScrapedWebsite,
  config: PipelineConfig
): RuleBasedScores {
  let matchScore = 50;
  const nicheWords = config.niche.toLowerCase().split(/\s+/);
  const titleWords = scraped.title.toLowerCase();
  const textWords = scraped.textContent.toLowerCase();
  const metaWords = scraped.metaDescription.toLowerCase();

  for (const word of nicheWords) {
    if (word.length < 3) continue;
    if (titleWords.includes(word)) matchScore += 15;
    if (metaWords.includes(word)) matchScore += 10;
    if (textWords.includes(word)) matchScore += 5;
  }

  if (config.keywords) {
    const keywords = config.keywords.toLowerCase().split(/[,\s]+/);
    for (const kw of keywords) {
      if (kw.length < 3) continue;
      if (textWords.includes(kw)) matchScore += 3;
    }
  }

  matchScore = Math.min(100, Math.max(0, matchScore));

  let locationScore = 30;
  const locationParts = config.location.toLowerCase().split(/[,\s]+/);
  for (const part of locationParts) {
    if (part.length < 2) continue;
    if (textWords.includes(part)) locationScore += 20;
    if (scraped.addresses.some((a) => a.toLowerCase().includes(part))) locationScore += 15;
  }
  locationScore = Math.min(100, locationScore);

  let contactScore = 0;
  if (scraped.emails.length > 0) contactScore += 30;
  if (scraped.phones.length > 0) contactScore += 30;
  if (scraped.hasContactForm) contactScore += 20;
  if (scraped.addresses.length > 0) contactScore += 10;
  if (scraped.socialLinks.length > 0) contactScore += 10;
  contactScore = Math.min(100, contactScore);

  let qualityScore = 40;
  if (scraped.hasCTA) qualityScore += 15;
  if (scraped.hasBooking) qualityScore += 15;
  if (scraped.isMobile) qualityScore += 10;
  if (scraped.technologies.length > 0) qualityScore += 10;
  if (scraped.metaDescription.length > 20) qualityScore += 10;
  qualityScore = Math.min(100, qualityScore);

  let problemsScore = 0;
  if (!scraped.emails.length && !scraped.phones.length) problemsScore += 20;
  if (!scraped.hasContactForm) problemsScore += 10;
  if (scraped.textContent.length < 200) problemsScore += 15;
  if (scraped.websiteStatus === 'timeout') problemsScore += 10;
  problemsScore = Math.min(100, problemsScore);

  return { matchScore, locationScore, contactScore, qualityScore, problemsScore };
}

export function calculateFinalScore(scores: RuleBasedScores & { aiScore: number }): number {
  const weighted =
    scores.matchScore * 0.25 +
    scores.locationScore * 0.15 +
    scores.contactScore * 0.25 +
    scores.qualityScore * 0.15 +
    (100 - scores.problemsScore) * 0.1 +
    scores.aiScore * 0.1;

  return Math.round(Math.min(100, Math.max(0, weighted)));
}

const FALLBACK_AI_SCORE = 50;

export function buildAnalysisPrompt(scraped: ScrapedWebsite, config: PipelineConfig): string {
  return `You analyze business websites as sales-qualified leads for a web-agency targeting "${config.niche}" businesses in "${config.location}".
Additional criteria from the user: ${config.additionalCriteria || 'none'}.

Website data:
- Title: ${scraped.title || '(none)'}
- Domain: ${scraped.domain}
- Meta description: ${scraped.metaDescription || '(none)'}
- Page text (first 800 chars): ${scraped.textContent.substring(0, 800)}
- Technologies detected: ${scraped.technologies.join(', ') || 'none'}
- Has contact form: ${scraped.hasContactForm}
- Has online booking: ${scraped.hasBooking}
- Has strong CTA: ${scraped.hasCTA}
- Emails found: ${scraped.emails.slice(0, 3).join(', ') || 'none'}
- Phones found: ${scraped.phones.slice(0, 3).join(', ') || 'none'}

Respond with a single JSON object exactly in this shape:
{
  "match": boolean (does this site match the niche "${config.niche}"),
  "confidence": number 0-100,
  "reason": string,
  "summary": string,
  "category": string,
  "problems": string[] (website/business problems the agency could fix, max 5),
  "potentialValue": string,
  "recommendation": string
}

IMPORTANT LANGUAGE RULE: write the values of ALL text fields (reason, summary, category, problems, potentialValue, recommendation) in Ukrainian language. Keep JSON keys in English.
Return ONLY the JSON object, no markdown fences, no explanation.`;
}

export function parseAIAnalysis(raw: string): AISingleAnalysis | null {
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    return {
      match: Boolean(parsed.match),
      confidence: Number(parsed.confidence) || 0,
      reason: String(parsed.reason || ''),
      summary: String(parsed.summary || ''),
      category: String(parsed.category || ''),
      problems: Array.isArray(parsed.problems) ? parsed.problems.map(String).slice(0, 5) : [],
      potentialValue: String(parsed.potentialValue || ''),
      recommendation: String(parsed.recommendation || ''),
    };
  } catch {
    return null;
  }
}

export async function analyzeWithAI(
  scraped: ScrapedWebsite,
  config: PipelineConfig,
  apiKey: string,
  signal?: AbortSignal
): Promise<AIAnalysisResult> {
  const unavailable: AIAnalysisResult = {
    aiScore: FALLBACK_AI_SCORE,
    businessSummary: 'AI-аналіз недоступний',
    aiAnalysis: 'AI-провайдер не налаштований або недоступний',
    match: true,
    modelUsed: null,
  };

  try {
    if (!config.useAI) return unavailable;
    const available = await aiRouter.isAvailable(config.provider, apiKey);
    if (!available) return unavailable;

    const { text, modelUsed } = await aiRouter.generateWithFallbacks(
      buildAnalysisPrompt(scraped, config),
      { provider: config.provider, model: config.model, apiKey, signal }
    );

    const analysis = parseAIAnalysis(text);
    if (!analysis) return { ...unavailable, aiAnalysis: `AI повернув відповідь, яку не вдалося розпарсити: ${text.slice(0, 200)}` };

    const aiScore = analysis.match
      ? Math.min(100, 50 + analysis.confidence * 0.5)
      : Math.max(0, 30 - analysis.confidence * 0.3);

    return {
      aiScore: Math.round(aiScore),
      businessSummary: analysis.summary.slice(0, 300),
      aiAnalysis: JSON.stringify(analysis),
      match: analysis.match,
      modelUsed,
    };
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    console.error(`[lead-generator] AI analysis failed for ${scraped.domain}:`, err);
    return {
      aiScore: FALLBACK_AI_SCORE,
      businessSummary: 'AI-аналіз не вдався',
      aiAnalysis: JSON.stringify({ error: String(err) }),
      match: true,
      modelUsed: null,
    };
  }
}

export function scrapedToLead(
  scraped: ScrapedWebsite,
  config: PipelineConfig,
  scores: RuleBasedScores & { aiScore: number },
  aiData: { businessSummary: string; aiAnalysis: string },
  searchQueries: string[]
): Omit<Lead, 'id' | 'createdAt' | 'runId' | 'status' | 'notes' | 'verifiedEmails' | 'screenshotPath'> & { screenshotPath: string | null } {
  return {
    domain: scraped.domain,
    companyName: scraped.title || scraped.domain,
    website: scraped.url,
    location: config.location,
    category: config.niche,
    emails: scraped.emails,
    phones: scraped.phones,
    addresses: scraped.addresses,
    socialLinks: scraped.socialLinks,
    technologies: scraped.technologies,
    metaDescription: scraped.metaDescription,
    hasContactForm: scraped.hasContactForm,
    hasBooking: scraped.hasBooking,
    hasCTA: scraped.hasCTA,
    businessSummary: aiData.businessSummary,
    matchScore: scores.matchScore,
    locationScore: scores.locationScore,
    contactScore: scores.contactScore,
    qualityScore: scores.qualityScore,
    problemsScore: scores.problemsScore,
    aiScore: scores.aiScore,
    leadScore: calculateFinalScore(scores),
    aiAnalysis: aiData.aiAnalysis,
    searchQueries,
    screenshotPath: scraped.screenshotPath,
  };
}
