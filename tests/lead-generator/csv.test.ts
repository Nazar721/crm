import { describe, it, expect } from 'vitest';
import { leadsToCsv, leadsToJson } from '../../lib/lead-generator/csv';
import { Lead } from '../../lib/lead-generator/types';

function makeLead(overrides: Partial<Lead> = {}): Lead {
  return {
    id: 1,
    runId: 3,
    domain: 'clinic.ua',
    companyName: 'Клініка "Посмішка", ТОВ',
    website: 'https://clinic.ua',
    location: 'Kyiv, Ukraine',
    category: 'dental',
    emails: ['info@clinic.ua'],
    phones: ['+380441234567'],
    addresses: ['вул. Хрещатик, 12, Київ'],
    socialLinks: ['https://facebook.com/clinic'],
    technologies: ['WordPress', 'Calendly'],
    metaDescription: 'Dental clinic',
    hasContactForm: true,
    hasBooking: false,
    hasCTA: true,
    businessSummary: 'Клініка з "лапками" та, комами',
    matchScore: 90,
    locationScore: 70,
    contactScore: 80,
    qualityScore: 60,
    problemsScore: 10,
    aiScore: 75,
    leadScore: 78,
    aiAnalysis: '{"match":true,"confidence":80}',
    status: 'new',
    notes: 'note with "quotes", commas',
    verifiedEmails: ['info@clinic.ua'],
    screenshotPath: null,
    searchQueries: ['dental kyiv'],
    createdAt: '2026-09-09T00:00:00.000Z',
    ...overrides,
  };
}

function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      cells.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  cells.push(current);
  return cells;
}

describe('leadsToCsv', () => {
  it('escapes quotes in ALL fields (company name, summary, notes, addresses)', () => {
    const csv = leadsToCsv([makeLead()]);
    const lines = csv.replace(/^\uFEFF/, '').split('\r\n');
    expect(lines).toHaveLength(2);

    const headerCells = parseCsvLine(lines[0]);
    const rowCells = parseCsvLine(lines[1]);
    expect(headerCells).toHaveLength(28);
    expect(rowCells).toHaveLength(28);

    expect(rowCells[0]).toBe('Клініка "Посмішка", ТОВ');
    expect(rowCells[21]).toBe('Клініка з "лапками" та, комами');
    expect(rowCells[23]).toBe('new');
    expect(rowCells[24]).toBe('note with "quotes", commas');
    expect(rowCells[7]).toBe('вул. Хрещатик, 12, Київ');
  });

  it('starts with BOM for Excel', () => {
    const csv = leadsToCsv([makeLead()]);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
  });

  it('includes extended columns (social links, technologies, aiAnalysis, notes, runId)', () => {
    const csv = leadsToCsv([makeLead()]);
    expect(csv).toContain('https://facebook.com/clinic');
    expect(csv).toContain('WordPress');
    expect(csv).toContain('{""match"":true,""confidence"":80}');
    expect(csv).toContain('note with');
  });
});

describe('leadsToJson', () => {
  it('produces valid JSON payload with leads', () => {
    const json = leadsToJson([makeLead()]);
    const parsed = JSON.parse(json);
    expect(parsed.app).toBe('Lead Generator');
    expect(parsed.leads).toHaveLength(1);
    expect(parsed.leads[0].domain).toBe('clinic.ua');
  });
});
