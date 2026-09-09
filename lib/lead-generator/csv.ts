import type { Lead } from './types';

function escapeCell(value: unknown): string {
  const str = value === null || value === undefined ? '' : String(value);
  return `"${str.replace(/"/g, '""')}"`;
}

function toRow(lead: Lead): unknown[] {
  let analysisFormatted = lead.aiAnalysis || '';
  try {
    analysisFormatted = JSON.stringify(JSON.parse(lead.aiAnalysis));
  } catch {
    // keep raw
  }
  return [
    lead.companyName,
    lead.domain,
    lead.website,
    lead.location,
    lead.category,
    lead.emails.join('; '),
    lead.phones.join('; '),
    lead.addresses.join('; '),
    lead.socialLinks.join('; '),
    lead.technologies.join('; '),
    lead.metaDescription,
    lead.hasContactForm ? 'Yes' : 'No',
    lead.hasBooking ? 'Yes' : 'No',
    lead.hasCTA ? 'Yes' : 'No',
    lead.leadScore,
    lead.matchScore,
    lead.locationScore,
    lead.contactScore,
    lead.qualityScore,
    lead.problemsScore,
    lead.aiScore,
    lead.businessSummary,
    analysisFormatted,
    lead.status,
    lead.notes,
    lead.verifiedEmails.join('; '),
    lead.runId ?? '',
    lead.createdAt,
  ];
}

const CSV_HEADERS = [
  'Company',
  'Domain',
  'Website',
  'Location',
  'Category',
  'Emails',
  'Phones',
  'Addresses',
  'Social Links',
  'Technologies',
  'Meta Description',
  'Has Contact Form',
  'Has Booking',
  'Has CTA',
  'Lead Score',
  'Match Score',
  'Location Score',
  'Contact Score',
  'Quality Score',
  'Problems Score',
  'AI Score',
  'Business Summary',
  'AI Analysis',
  'Status',
  'Notes',
  'Verified Emails',
  'Run ID',
  'Created At',
];

export function leadsToCsv(leads: Lead[]): string {
  const rows = [CSV_HEADERS, ...leads.map(toRow)];
  const body = rows.map((row) => row.map(escapeCell).join(',')).join('\r\n');
  return '\uFEFF' + body;
}

export function leadsToJson(leads: Lead[]): string {
  return JSON.stringify({ app: 'Lead Generator', exportedAt: new Date().toISOString(), leads }, null, 2);
}
