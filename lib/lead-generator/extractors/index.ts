import { findPhoneNumbersInText, parsePhoneNumberFromString, CountryCode } from 'libphonenumber-js/max';
import { countryFromLocation } from '../phoneCountry';

const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
// NOTE: all quantifiers are tightly bounded — unbounded ones caused catastrophic
// backtracking (RegExpStringIteratorPrototypeNext) that blocked the Node event loop
// for minutes on large/minified pages.
const OBFUSCATED_EMAIL_REGEX =
  /([a-zA-Z0-9._%+-]{1,64})\s*[(\[{]?\s*(?:at|@)\s*[)\]}]?\s*([a-zA-Z0-9-]{1,63}(?:\.[a-zA-Z0-9-]{1,63}){0,4})\s*[(\[{]?\s*(?:dot|\.)\s*[)\]}]?\s*([a-zA-Z]{2,12})/gi;

// Hard caps: never run backtracking regexes over huge page payloads.
const MAX_OBFUSCATED_SCAN_CHARS = 150_000;
const MAX_PHONE_SCAN_CHARS = 60_000;
const MAX_ADDRESS_SCAN_CHARS = 150_000;

const EMAIL_BLACKLIST = [
  'example.com',
  'sentry.io',
  'wixpress.com',
  'schema.org',
  'domain.com',
  'yourdomain.com',
  'email.com',
  'test.com',
  'user@',
  '@2x',
  'sentry-next.wixpress.com',
];

function isLikelyFileArtifact(email: string): boolean {
  return /\.(png|jpg|jpeg|gif|webp|svg|css|js)$/i.test(email);
}

export function extractEmails(text: string): string[] {
  if (!text) return [];
  const found = new Set<string>();

  for (const m of text.match(EMAIL_REGEX) || []) {
    found.add(m.toLowerCase());
  }

  const obfuscatedText = text.length > MAX_OBFUSCATED_SCAN_CHARS ? text.slice(0, MAX_OBFUSCATED_SCAN_CHARS) : text;
  try {
    for (const m of obfuscatedText.matchAll(OBFUSCATED_EMAIL_REGEX)) {
      const [, user, host, tld] = m;
      if (!user || !host || !tld) continue;
      const rebuilt = `${user}@${host}.${tld}`.toLowerCase();
      found.add(rebuilt);
    }
  } catch {
    // regex safety net
  }

  const mailtoMatches = text.match(/mailto:([^"'?>\s]+)/gi) || [];
  for (const m of mailtoMatches) {
    const addr = m.replace(/^mailto:/i, '').trim().toLowerCase();
    if (addr.includes('@')) found.add(addr);
  }

  const filtered = Array.from(found).filter(
    (e) =>
      !isLikelyFileArtifact(e) &&
      !EMAIL_BLACKLIST.some((b) => e.includes(b)) &&
      e.split('@').length === 2 &&
      e.split('@')[1].includes('.')
  );

  return Array.from(new Set(filtered));
}

export function extractPhones(html: string, location = ''): string[] {
  if (!html) return [];
  const defaultCountry = (countryFromLocation(location) as CountryCode) || undefined;

  // libphonenumber's regex engine can spin nearly forever on huge/minified HTML
  // (observed: full event-loop block). Cap the analyzed text hard.
  const text = html.length > MAX_PHONE_SCAN_CHARS ? html.slice(0, MAX_PHONE_SCAN_CHARS) : html;

  const phones = new Set<string>();
  try {
    for (const found of findPhoneNumbersInText(text, defaultCountry ? { defaultCountry } : {})) {
      if (found.number.isValid()) {
        phones.add(found.number.format('E.164'));
      }
    }
  } catch {
    // malformed input — fall through to tel: links below
  }

  // fallback: tel: protocol links that the finder may have missed
  const telMatches = text.match(/tel:\+?[\d\s\-()]{7,}/gi) || [];
  for (const m of telMatches) {
    const raw = m.replace(/^tel:/i, '').replace(/(?!^\+)[^\d+]/g, '');
    const parsed = parsePhoneNumberFromString(raw, defaultCountry);
    if (parsed?.isValid()) phones.add(parsed.format('E.164'));
  }

  return Array.from(phones).slice(0, 10);
}

export function extractAddresses(text: string): string[] {
  if (!text) return [];
  const scan = text.length > MAX_ADDRESS_SCAN_CHARS ? text.slice(0, MAX_ADDRESS_SCAN_CHARS) : text;
  const addressPatterns = [
    /\d+\s+[A-Za-z\s]+(?:Street|St\.?|Avenue|Ave\.?|Boulevard|Blvd\.?|Road|Rd\.?|Drive|Dr\.?|Lane|Ln\.?|Way|Court|Ct\.?|Place|Pl\.?)[^,\n]*(?:,\s*[A-Za-z\s]+){0,2}/gi,
    /(?:street|st\.?|avenue|ave\.?|boulevard|blvd\.?|road|rd\.?|drive|dr\.?|lane|ln\.?|way|court|ct\.?|place|pl\.?)[\s,]+[^,.\n]+(?:,\s*[^,.\n]+){0,3}/gi,
    /(?:вул\.?|вулиця|просп\.?|проспект|пров\.?|бульвар)[^,\n]+(?:,\s*[^,\n]+){0,2}/gi,
  ];

  const addresses: string[] = [];
  for (const pattern of addressPatterns) {
    const matches = scan.match(pattern) || [];
    addresses.push(...matches.map((a) => a.replace(/\s+/g, ' ').trim()));
  }
  return Array.from(new Set(addresses))
    .filter((a) => a.length > 8 && a.length < 160)
    .slice(0, 3);
}

export function extractSocialLinks(html: string): string[] {
  const socialPatterns = [
    /https?:\/\/(?:www\.)?facebook\.com\/[^\s"'<>)]+/gi,
    /https?:\/\/(?:www\.)?instagram\.com\/[^\s"'<>)]+/gi,
    /https?:\/\/(?:www\.)?twitter\.com\/[^\s"'<>)]+/gi,
    /https?:\/\/(?:www\.)?x\.com\/[^\s"'<>)]+/gi,
    /https?:\/\/(?:www\.)?linkedin\.com\/[^\s"'<>)]+/gi,
    /https?:\/\/(?:www\.)?youtube\.com\/[^\s"'<>)]+/gi,
    /https?:\/\/t\.me\/[^\s"'<>)]+/gi,
    /https?:\/\/(?:www\.)?tiktok\.com\/@[^\s"'<>)]+/gi,
  ];

  const links: string[] = [];
  for (const pattern of socialPatterns) {
    const matches = html.match(pattern) || [];
    links.push(...matches.map((l) => l.replace(/["'<>)]+$/, '')));
  }
  return Array.from(new Set(links)).slice(0, 12);
}

export function extractTechnologies(html: string): string[] {
  const techs: string[] = [];

  const techIndicators: [RegExp, string][] = [
    [/wordpress|wp-content/gi, 'WordPress'],
    [/shopify/gi, 'Shopify'],
    [/squarespace/gi, 'Squarespace'],
    [/wix\.com|wixpress/gi, 'Wix'],
    [/react/gi, 'React'],
    [/next\.?js|__next|_next\//gi, 'Next.js'],
    [/vue\.?js/gi, 'Vue.js'],
    [/angular/gi, 'Angular'],
    [/bootstrap/gi, 'Bootstrap'],
    [/tailwind/gi, 'Tailwind CSS'],
    [/jquery/gi, 'jQuery'],
    [/google-analytics|googletagmanager\.com\/gtag|gtag\(/gi, 'Google Analytics'],
    [/googletagmanager/gi, 'Google Tag Manager'],
    [/facebook.*pixel|fbq\(/gi, 'Facebook Pixel'],
    [/hubspot/gi, 'HubSpot'],
    [/calendly/gi, 'Calendly'],
    [/tawk/gi, 'Tawk.to'],
    [/intercom/gi, 'Intercom'],
    [/drift/gi, 'Drift'],
    [/freshdesk/gi, 'Freshdesk'],
    [/zoho/gi, 'Zoho'],
    [/bitrix/gi, 'Bitrix'],
    [/1c-bitrix/gi, '1C-Bitrix'],
    [/joomla/gi, 'Joomla'],
    [/drupal/gi, 'Drupal'],
    [/modx/gi, 'MODX'],
    [/webflow/gi, 'Webflow'],
    [/tilda/gi, 'Tilda'],
  ];

  for (const [regex, name] of techIndicators) {
    if (regex.test(html)) {
      techs.push(name);
    }
  }

  return Array.from(new Set(techs));
}

export function detectContactForm(html: string): boolean {
  const patterns = [
    /<form[^>]*>/gi,
    /contact[_\-]?form/gi,
    /form[_\-]?contact/gi,
    /wpforms/gi,
    /contact[_\-]?7/gi,
    /ninja[_\-]?form/gi,
  ];

  for (const pattern of patterns) {
    if (pattern.test(html)) return true;
  }
  return false;
}

export function detectBooking(text: string): boolean {
  const patterns = [
    /calendly/gi,
    /booking/gi,
    /reservation/gi,
    /appointment/gi,
    /запис(атися)?/gi,
    /онлайн-запис/gi,
    /book[\s_\-]?now/gi,
    /schedule[\s_\-]?now/gi,
  ];

  for (const pattern of patterns) {
    if (pattern.test(text)) return true;
  }
  return false;
}

export function detectCTA(html: string): boolean {
  const patterns = [
    /call[_\-]?to[_\-]?action/gi,
    /<button[^>]*>([^<]*(?:call|contact|book|sign|register|buy|order|get|start|try|learn|discover|join|subscribe)[^<]*)<\/button>/gi,
    /<a[^>]*class="[^"]*(?:btn|button|cta)[^"]*"[^>]*>/gi,
    /(?:зателефонувати|замовити|записатися|купити|подати заявку|отримати консультацію)/gi,
  ];

  for (const pattern of patterns) {
    if (pattern.test(html)) return true;
  }
  return false;
}

export function detectMobile(html: string): boolean {
  return /viewport[^>]*width\s*=\s*device-width/gi.test(html);
}
