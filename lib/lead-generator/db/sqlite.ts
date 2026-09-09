import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import type { Lead, LeadStatus, Run, RunStats, LGSettings, ProviderId, CustomProvider } from '../types';
import { PROVIDER_IDS, isCustomProviderId, customProviderSettingId } from '../types';
import { resolveProviderDef, envKeyFor } from '../ai/AIRouter';

const DATA_DIR = path.join(process.cwd(), 'data', 'lead-generator');
const DB_PATH = path.join(DATA_DIR, 'leads.db');

let db: Database.Database | null = null;

function getDb(): Database.Database {
  if (!db) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.exec(`
      CREATE TABLE IF NOT EXISTS lg_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        niche TEXT NOT NULL,
        location TEXT NOT NULL,
        keywords TEXT DEFAULT '',
        criteria TEXT DEFAULT '',
        provider TEXT DEFAULT '',
        model TEXT DEFAULT '',
        status TEXT DEFAULT 'running',
        partial INTEGER DEFAULT 0,
        foundCount INTEGER DEFAULT 0,
        scannedCount INTEGER DEFAULT 0,
        analyzedCount INTEGER DEFAULT 0,
        leadsCount INTEGER DEFAULT 0,
        startedAt TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        finishedAt TEXT
      );

      CREATE TABLE IF NOT EXISTS lg_leads (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        runId INTEGER,
        domain TEXT UNIQUE NOT NULL,
        companyName TEXT,
        website TEXT,
        location TEXT,
        category TEXT,
        emails TEXT DEFAULT '[]',
        phones TEXT DEFAULT '[]',
        addresses TEXT DEFAULT '[]',
        socialLinks TEXT DEFAULT '[]',
        technologies TEXT DEFAULT '[]',
        metaDescription TEXT,
        hasContactForm INTEGER DEFAULT 0,
        hasBooking INTEGER DEFAULT 0,
        hasCTA INTEGER DEFAULT 0,
        businessSummary TEXT,
        matchScore REAL DEFAULT 0,
        locationScore REAL DEFAULT 0,
        contactScore REAL DEFAULT 0,
        qualityScore REAL DEFAULT 0,
        problemsScore REAL DEFAULT 0,
        aiScore REAL DEFAULT 0,
        leadScore REAL DEFAULT 0,
        aiAnalysis TEXT,
        status TEXT DEFAULT 'new',
        notes TEXT DEFAULT '',
        verifiedEmails TEXT DEFAULT '[]',
        screenshotPath TEXT,
        searchQueries TEXT DEFAULT '[]',
        createdAt TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        FOREIGN KEY (runId) REFERENCES lg_runs(id)
      );

      CREATE TABLE IF NOT EXISTS lg_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
    try {
      db.exec(`ALTER TABLE lg_runs ADD COLUMN provider TEXT DEFAULT ''`);
    } catch {
      // column already exists (fresh table or migrated)
    }
  }
  return db;
}

export function getDataDir(): string {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  return DATA_DIR;
}

interface LeadUpsertInput {
  runId: number;
  domain: string;
  companyName: string;
  website: string;
  location: string;
  category: string;
  emails: string[];
  phones: string[];
  addresses: string[];
  socialLinks: string[];
  technologies: string[];
  metaDescription: string;
  hasContactForm: boolean;
  hasBooking: boolean;
  hasCTA: boolean;
  businessSummary: string;
  matchScore: number;
  locationScore: number;
  contactScore: number;
  qualityScore: number;
  problemsScore: number;
  aiScore: number;
  leadScore: number;
  aiAnalysis: string;
  searchQueries: string[];
  screenshotPath: string | null;
}

export function upsertLead(lead: LeadUpsertInput): Lead {
  const database = getDb();
  const existing = database
    .prepare('SELECT id, status, notes, verifiedEmails, createdAt FROM lg_leads WHERE domain = ?')
    .get(lead.domain) as
    | { id: number; status: string; notes: string; verifiedEmails: string; createdAt: string }
    | undefined;

  const status: LeadStatus =
    existing && (existing.status === 'contacted' || existing.status === 'won')
      ? (existing.status as LeadStatus)
      : 'new';
  const notes = existing?.notes ?? '';
  const verifiedEmails = existing?.verifiedEmails ?? '[]';
  const createdAt = existing?.createdAt ?? new Date().toISOString();

  const stmt = database.prepare(`
    INSERT INTO lg_leads (
      runId, domain, companyName, website, location, category,
      emails, phones, addresses, socialLinks, technologies,
      metaDescription, hasContactForm, hasBooking, hasCTA,
      businessSummary, matchScore, locationScore, contactScore,
      qualityScore, problemsScore, aiScore, leadScore,
      aiAnalysis, status, notes, verifiedEmails, screenshotPath, searchQueries, createdAt
    ) VALUES (
      @runId, @domain, @companyName, @website, @location, @category,
      @emails, @phones, @addresses, @socialLinks, @technologies,
      @metaDescription, @hasContactForm, @hasBooking, @hasCTA,
      @businessSummary, @matchScore, @locationScore, @contactScore,
      @qualityScore, @problemsScore, @aiScore, @leadScore,
      @aiAnalysis, @status, @notes, @verifiedEmails, @screenshotPath, @searchQueries, @createdAt
    )
    ON CONFLICT(domain) DO UPDATE SET
      runId = excluded.runId,
      companyName = excluded.companyName,
      website = excluded.website,
      location = excluded.location,
      category = excluded.category,
      emails = excluded.emails,
      phones = excluded.phones,
      addresses = excluded.addresses,
      socialLinks = excluded.socialLinks,
      technologies = excluded.technologies,
      metaDescription = excluded.metaDescription,
      hasContactForm = excluded.hasContactForm,
      hasBooking = excluded.hasBooking,
      hasCTA = excluded.hasCTA,
      businessSummary = excluded.businessSummary,
      matchScore = excluded.matchScore,
      locationScore = excluded.locationScore,
      contactScore = excluded.contactScore,
      qualityScore = excluded.qualityScore,
      problemsScore = excluded.problemsScore,
      aiScore = excluded.aiScore,
      leadScore = excluded.leadScore,
      aiAnalysis = excluded.aiAnalysis,
      status = excluded.status,
      verifiedEmails = excluded.verifiedEmails,
      screenshotPath = COALESCE(excluded.screenshotPath, lg_leads.screenshotPath),
      createdAt = COALESCE(lg_leads.createdAt, excluded.createdAt),
      searchQueries = excluded.searchQueries
  `);

  const result = stmt.run({
    ...lead,
    emails: JSON.stringify(lead.emails),
    phones: JSON.stringify(lead.phones),
    addresses: JSON.stringify(lead.addresses),
    socialLinks: JSON.stringify(lead.socialLinks),
    technologies: JSON.stringify(lead.technologies),
    hasContactForm: lead.hasContactForm ? 1 : 0,
    hasBooking: lead.hasBooking ? 1 : 0,
    hasCTA: lead.hasCTA ? 1 : 0,
    aiAnalysis: lead.aiAnalysis || '',
    status,
    notes,
    verifiedEmails,
    searchQueries: JSON.stringify(lead.searchQueries),
    createdAt,
  });

  const id = (existing?.id ?? result.lastInsertRowid) as number;
  const saved = getLeadById(id);
  if (!saved) throw new Error('Failed to persist lead');
  return saved;
}

function rowToLead(row: Record<string, unknown>): Lead {
  return {
    id: row.id as number,
    runId: (row.runId as number | null) ?? null,
    domain: row.domain as string,
    companyName: row.companyName as string,
    website: row.website as string,
    location: row.location as string,
    category: row.category as string,
    emails: JSON.parse((row.emails as string) || '[]'),
    phones: JSON.parse((row.phones as string) || '[]'),
    addresses: JSON.parse((row.addresses as string) || '[]'),
    socialLinks: JSON.parse((row.socialLinks as string) || '[]'),
    technologies: JSON.parse((row.technologies as string) || '[]'),
    metaDescription: row.metaDescription as string,
    hasContactForm: Boolean(row.hasContactForm),
    hasBooking: Boolean(row.hasBooking),
    hasCTA: Boolean(row.hasCTA),
    businessSummary: row.businessSummary as string,
    matchScore: row.matchScore as number,
    locationScore: row.locationScore as number,
    contactScore: row.contactScore as number,
    qualityScore: row.qualityScore as number,
    problemsScore: row.problemsScore as number,
    aiScore: row.aiScore as number,
    leadScore: row.leadScore as number,
    aiAnalysis: row.aiAnalysis as string,
    status: row.status as LeadStatus,
    notes: row.notes as string,
    verifiedEmails: JSON.parse((row.verifiedEmails as string) || '[]'),
    screenshotPath: (row.screenshotPath as string | null) ?? null,
    searchQueries: JSON.parse((row.searchQueries as string) || '[]'),
    createdAt: row.createdAt as string,
  };
}

export function getLeadById(id: number): Lead | null {
  const database = getDb();
  const row = database.prepare('SELECT * FROM lg_leads WHERE id = ?').get(id) as
    | Record<string, unknown>
    | undefined;
  if (!row) return null;
  return rowToLead(row);
}

export function getLeads(options: { runId?: number; status?: string } = {}): Lead[] {
  const database = getDb();
  const clauses: string[] = [];
  const params: Record<string, unknown> = {};
  if (options.runId !== undefined) {
    clauses.push('runId = @runId');
    params.runId = options.runId;
  }
  if (options.status) {
    clauses.push('status = @status');
    params.status = options.status;
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = database
    .prepare(`SELECT * FROM lg_leads ${where} ORDER BY leadScore DESC`)
    .all(params) as Record<string, unknown>[];
  return rows.map(rowToLead);
}

export function updateLeadMeta(
  id: number,
  data: { status?: LeadStatus; notes?: string }
): Lead | null {
  const database = getDb();
  const sets: string[] = [];
  const params: Record<string, unknown> = { id };
  if (data.status !== undefined) {
    sets.push('status = @status');
    params.status = data.status;
  }
  if (data.notes !== undefined) {
    sets.push('notes = @notes');
    params.notes = data.notes;
  }
  if (!sets.length) return getLeadById(id);
  database.prepare(`UPDATE lg_leads SET ${sets.join(', ')} WHERE id = @id`).run(params);
  return getLeadById(id);
}

export function saveVerifiedEmails(id: number, verified: string[]): void {
  getDb()
    .prepare('UPDATE lg_leads SET verifiedEmails = ? WHERE id = ?')
    .run(JSON.stringify(verified), id);
}

export function createRun(input: {
  niche: string;
  location: string;
  keywords: string;
  criteria: string;
  provider: string;
  model: string;
}): Run {
  const database = getDb();
  database
    .prepare(
      `UPDATE lg_runs SET status = 'failed', finishedAt = strftime('%Y-%m-%dT%H:%M:%fZ','now')
       WHERE status = 'running'`
    )
    .run();
  const result = database
    .prepare(
      `INSERT INTO lg_runs (niche, location, keywords, criteria, provider, model, status)
       VALUES (@niche, @location, @keywords, @criteria, @provider, @model, 'running')`
    )
    .run(input);
  const run = getRunById(result.lastInsertRowid as number);
  if (!run) throw new Error('Failed to create run');
  return run;
}

function rowToRun(row: Record<string, unknown>): Run {
  return {
    id: row.id as number,
    niche: row.niche as string,
    location: row.location as string,
    keywords: row.keywords as string,
    criteria: row.criteria as string,
    provider: (row.provider as string) || '',
    model: row.model as string,
    status: row.status as Run['status'],
    partial: Boolean(row.partial),
    stats: {
      found: row.foundCount as number,
      scanned: row.scannedCount as number,
      analyzed: row.analyzedCount as number,
      leads: row.leadsCount as number,
    },
    startedAt: row.startedAt as string,
    finishedAt: (row.finishedAt as string | null) ?? null,
  };
}

export function getRunById(id: number): Run | null {
  const row = getDb().prepare('SELECT * FROM lg_runs WHERE id = ?').get(id) as
    | Record<string, unknown>
    | undefined;
  if (!row) return null;
  return rowToRun(row);
}

export function getRuns(limit = 50): Run[] {
  const rows = getDb()
    .prepare('SELECT * FROM lg_runs ORDER BY id DESC LIMIT ?')
    .all(limit) as Record<string, unknown>[];
  return rows.map(rowToRun);
}

export function updateRunProgress(id: number, stats: Partial<RunStats>): void {
  const database = getDb();
  database
    .prepare(
      `UPDATE lg_runs SET
        foundCount = MAX(foundCount, @found),
        scannedCount = MAX(scannedCount, @scanned),
        analyzedCount = MAX(analyzedCount, @analyzed),
        leadsCount = MAX(leadsCount, @leads)
       WHERE id = @id`
    )
    .run({ found: 0, scanned: 0, analyzed: 0, leads: 0, ...stats, id });
}

export function finishRun(
  id: number,
  status: Run['status'],
  options: { partial?: boolean; stats?: RunStats } = {}
): Run | null {
  const database = getDb();
  if (options.stats) {
    database
      .prepare(
        `UPDATE lg_runs SET foundCount = @found, scannedCount = @scanned,
         analyzedCount = @analyzed, leadsCount = @leads WHERE id = @id`
      )
      .run({ ...options.stats, id });
  }
  database
    .prepare(
      `UPDATE lg_runs SET status = @status,
       finishedAt = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
       partial = CASE WHEN @partial THEN 1 ELSE partial END
       WHERE id = @id`
    )
    .run({ status, partial: options.partial ? 1 : 0, id });
  return getRunById(id);
}

export function getSetting(key: string): string | null {
  const row = getDb()
    .prepare('SELECT value FROM lg_settings WHERE key = ?')
    .get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function setSetting(key: string, value: string): void {
  getDb()
    .prepare(
      `INSERT INTO lg_settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    )
    .run(key, value);
}

function migrateLegacyOpenRouterKey(): void {
  const legacy = getSetting('openrouter_api_key');
  if (legacy && !getSetting('api_key_openrouter')) {
    setSetting('api_key_openrouter', legacy);
  }
}

export function getCustomProviders(): CustomProvider[] {
  try {
    const raw = getSetting('custom_providers');
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((c) => c && typeof c.id === 'string' && typeof c.baseUrl === 'string')
      .map((c) => ({
        id: String(c.id),
        label: String(c.label || 'Custom'),
        baseUrl: String(c.baseUrl),
        apiKey: String(c.apiKey || ''),
        defaultModel: String(c.defaultModel || ''),
      }));
  } catch {
    return [];
  }
}

function saveCustomProviders(list: CustomProvider[]): void {
  setSetting('custom_providers', JSON.stringify(list));
}

export function upsertCustomProvider(cp: CustomProvider): CustomProvider[] {
  const list = getCustomProviders();
  const idx = list.findIndex((c) => c.id === cp.id);
  if (idx >= 0) {
    // keep existing key if new one empty
    list[idx] = { ...cp, apiKey: cp.apiKey || list[idx].apiKey };
  } else {
    list.push(cp);
  }
  saveCustomProviders(list);
  return getCustomProviders();
}

export function deleteCustomProvider(id: string): CustomProvider[] {
  saveCustomProviders(getCustomProviders().filter((c) => c.id !== id));
  return getCustomProviders();
}

export function getLGSettings(): LGSettings {
  migrateLegacyOpenRouterKey();
  const providerRaw = getSetting('provider');
  const provider =
    providerRaw && (PROVIDER_IDS.includes(providerRaw as ProviderId) || isCustomProviderId(providerRaw))
      ? providerRaw
      : 'openrouter';

  const keys = {} as Record<ProviderId, string>;
  for (const id of PROVIDER_IDS) {
    const stored = getSetting(`api_key_${id}`);
    keys[id] = stored || envKeyFor(resolveProviderDef(id)) || '';
  }

  const customProviders = getCustomProviders();
  const activeCustom = isCustomProviderId(provider)
    ? customProviders.find((c) => customProviderSettingId(c.id) === provider)
    : undefined;

  return {
    provider,
    model: getSetting('model') || activeCustom?.defaultModel || 'meta-llama/llama-4-maverick:free',
    keys,
    customProviders,
  };
}

export function maskKey(key: string): string {
  if (!key) return '';
  if (key.length <= 12) return '••••••••';
  return `${key.slice(0, 6)}••••••••${key.slice(-4)}`;
}
