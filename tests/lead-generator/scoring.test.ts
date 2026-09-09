import { describe, it, expect } from 'vitest';
import { calculateRuleBasedScore, calculateFinalScore, parseAIAnalysis, buildAnalysisPrompt } from '../../lib/lead-generator/scoring/leadScore';
import { ScrapedWebsite, PipelineConfig } from '../../lib/lead-generator/types';

function makeScraped(overrides: Partial<ScrapedWebsite> = {}): ScrapedWebsite {
  return {
    url: 'https://clinic.ua',
    domain: 'clinic.ua',
    title: 'Dental Clinic Kyiv',
    metaDescription: 'Best dental clinic in Kyiv, Ukraine',
    textContent: 'We are a dental clinic in Kyiv offering implants and braces. Контакти: вул. Хрещатик 1',
    emails: ['info@clinic.ua'],
    phones: ['+380441234567'],
    addresses: ['12 Khreshchatyk Street, Kyiv'],
    socialLinks: ['https://facebook.com/clinic'],
    technologies: ['WordPress'],
    hasContactForm: true,
    hasBooking: true,
    hasCTA: true,
    isMobile: true,
    websiteStatus: 'available',
    pages: [],
    screenshotPath: null,
    ...overrides,
  };
}

function makeConfig(overrides: Partial<PipelineConfig> = {}): PipelineConfig {
  return {
    niche: 'dental clinic',
    location: 'Kyiv, Ukraine',
    keywords: '',
    maxResults: 50,
    additionalCriteria: '',
    concurrency: 4,
    useAI: true,
    provider: 'openrouter',
    model: '',
    ...overrides,
  };
}

describe('calculateRuleBasedScore', () => {
  it('scores a matching lead high', () => {
    const scraped = makeScraped({
      textContent:
        'We are a dental clinic in Kyiv offering implants and braces. Контакти: вул. Хрещатик 1. Our modern dental clinic provides comprehensive dental care including implants, braces, whitening and preventive treatments for the whole family. Book your appointment online today and visit our comfortable clinic in the heart of Kyiv.',
    });
    const scores = calculateRuleBasedScore(scraped, makeConfig());
    expect(scores.matchScore).toBeGreaterThanOrEqual(80);
    expect(scores.locationScore).toBeGreaterThanOrEqual(65);
    expect(scores.contactScore).toBe(100);
    expect(scores.qualityScore).toBe(100);
    expect(scores.problemsScore).toBe(0);
  });

  it('scores a non-matching lead lower', () => {
    const scraped = makeScraped({
      title: 'Random Shop',
      metaDescription: '',
      textContent:
        'Selling random shoes and clothes in a random city far away from anywhere. We have many brands and seasonal discounts for everyone who loves fashion and style. Visit our store today for great offers and friendly service every day of the week.',
      emails: [],
      phones: [],
      addresses: [],
      socialLinks: [],
      technologies: [],
      hasContactForm: false,
      hasBooking: false,
      hasCTA: false,
      isMobile: false,
      websiteStatus: 'timeout',
    });
    const scores = calculateRuleBasedScore(scraped, makeConfig());
    expect(scores.contactScore).toBe(0);
    expect(scores.problemsScore).toBeGreaterThanOrEqual(40);
    expect(scores.matchScore).toBe(50);
    expect(scores.qualityScore).toBeLessThan(50);
  });
});

describe('calculateFinalScore', () => {
  it('applies the weighted formula', () => {
    const final = calculateFinalScore({
      matchScore: 100,
      locationScore: 100,
      contactScore: 100,
      qualityScore: 100,
      problemsScore: 0,
      aiScore: 100,
    });
    expect(final).toBe(100);
  });

  it('handles zero scores', () => {
    const final = calculateFinalScore({
      matchScore: 0,
      locationScore: 0,
      contactScore: 0,
      qualityScore: 0,
      problemsScore: 100,
      aiScore: 0,
    });
    expect(final).toBe(0);
  });

  it('matches the documented weights', () => {
    const final = calculateFinalScore({
      matchScore: 80,
      locationScore: 60,
      contactScore: 40,
      qualityScore: 50,
      problemsScore: 20,
      aiScore: 70,
    });
    const expected = Math.round(
      80 * 0.25 + 60 * 0.15 + 40 * 0.25 + 50 * 0.15 + 80 * 0.1 + 70 * 0.1
    );
    expect(final).toBe(expected);
  });
});

describe('parseAIAnalysis', () => {
  it('parses a valid response', () => {
    const parsed = parseAIAnalysis(
      JSON.stringify({
        match: true,
        confidence: 85,
        reason: 'Dental clinic',
        summary: 'A clinic in Kyiv',
        category: 'Healthcare',
        problems: ['Old website'],
        potentialValue: 'Needs redesign',
        recommendation: 'Reach out',
      })
    );
    expect(parsed).not.toBeNull();
    expect(parsed?.match).toBe(true);
    expect(parsed?.problems).toHaveLength(1);
  });

  it('returns null for garbage', () => {
    expect(parseAIAnalysis('not json at all')).toBeNull();
    expect(parseAIAnalysis('{"incomplete": true}')).not.toBeNull();
  });
});

describe('buildAnalysisPrompt', () => {
  it('includes niche and site data in a single prompt', () => {
    const prompt = buildAnalysisPrompt(makeScraped(), makeConfig({ additionalCriteria: 'must have booking' }));
    expect(prompt).toContain('dental clinic');
    expect(prompt).toContain('Kyiv');
    expect(prompt).toContain('clinic.ua');
    expect(prompt).toContain('must have booking');
    expect(prompt).toContain('"match"');
  });

  it('instructs the model to answer in Ukrainian', () => {
    const prompt = buildAnalysisPrompt(makeScraped(), makeConfig());
    expect(prompt).toMatch(/Ukrainian/i);
    expect(prompt).toContain('Return ONLY the JSON object');
  });
});
