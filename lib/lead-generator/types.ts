export interface SearchQuery {
  title: string;
  url: string;
  snippet: string;
  search_query: string;
  position: number;
}

export interface ScrapedWebsite {
  url: string;
  domain: string;
  title: string;
  metaDescription: string;
  textContent: string;
  emails: string[];
  phones: string[];
  addresses: string[];
  socialLinks: string[];
  technologies: string[];
  hasContactForm: boolean;
  hasBooking: boolean;
  hasCTA: boolean;
  isMobile: boolean;
  websiteStatus: 'available' | 'unavailable' | 'timeout';
  pages: string[];
  screenshotPath: string | null;
}

export type LeadStatus = 'new' | 'in-progress' | 'contacted' | 'won' | 'excluded';

export interface Lead {
  id: number;
  runId: number | null;
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
  status: LeadStatus;
  notes: string;
  verifiedEmails: string[];
  screenshotPath: string | null;
  searchQueries: string[];
  createdAt: string;
}

export interface PipelineConfig {
  niche: string;
  location: string;
  keywords: string;
  maxResults: number;
  additionalCriteria: string;
  concurrency: number;
  useAI: boolean;
  provider: string;
  model: string;
}

export type PipelineStage =
  | 'generating_queries'
  | 'searching'
  | 'deduplicating'
  | 'scanning'
  | 'ai_analysis'
  | 'scoring'
  | 'completed'
  | 'error';

export interface PipelineProgressEvent {
  type: 'progress';
  runId: number;
  stage: PipelineStage;
  current: number;
  total: number;
  message: string;
  startTime: number;
  elapsedMs: number;
}

export interface PipelineSearchBlockedEvent {
  type: 'search_blocked';
  runId: number;
  message: string;
}

export interface PipelineCompletedEvent {
  type: 'completed';
  runId: number;
  partial: boolean;
  leads: Lead[];
  totalFound: number;
  totalScanned: number;
  totalAnalyzed: number;
  totalLeads: number;
}

export interface PipelineErrorEvent {
  type: 'error';
  runId: number;
  partial: boolean;
  message: string;
}

export type PipelineEvent =
  | PipelineProgressEvent
  | PipelineSearchBlockedEvent
  | PipelineCompletedEvent
  | PipelineErrorEvent;

export interface RunStats {
  found: number;
  scanned: number;
  analyzed: number;
  leads: number;
}

export type ProviderId = 'openrouter' | 'openai' | 'anthropic' | 'gemini' | 'groq' | 'mistral';

export const PROVIDER_IDS: ProviderId[] = ['openrouter', 'openai', 'anthropic', 'gemini', 'groq', 'mistral'];

export const CUSTOM_PROVIDER_PREFIX = 'custom-';

export function customProviderSettingId(id: string): string {
  return `${CUSTOM_PROVIDER_PREFIX}${id}`;
}

export function isCustomProviderId(provider: string | undefined): boolean {
  return Boolean(provider && provider.startsWith(CUSTOM_PROVIDER_PREFIX));
}

export interface CustomProvider {
  id: string;
  label: string;
  baseUrl: string;
  apiKey: string;
  defaultModel: string;
}

export interface ProviderInfo {
  id: ProviderId;
  label: string;
  keyHint: string;
}

export interface LGSettings {
  provider: string;
  model: string;
  keys: Record<ProviderId, string>;
  customProviders: CustomProvider[];
}

export interface Run {
  id: number;
  niche: string;
  location: string;
  keywords: string;
  criteria: string;
  provider: string;
  model: string;
  status: 'running' | 'completed' | 'stopped' | 'failed';
  partial: boolean;
  stats: RunStats;
  startedAt: string;
  finishedAt: string | null;
}

export interface AISingleAnalysis {
  match: boolean;
  confidence: number;
  reason: string;
  summary: string;
  category: string;
  problems: string[];
  potentialValue: string;
  recommendation: string;
}

export interface AIAnalysisResult {
  aiScore: number;
  businessSummary: string;
  aiAnalysis: string;
  match: boolean;
  modelUsed: string | null;
}
