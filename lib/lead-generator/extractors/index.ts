import { findPhoneNumbersInText, parsePhoneNumberFromString, CountryCode } from 'libphonenumber-js/max';
import { countryFromLocation } from '../phoneCountry';

const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const OBFUSCATED_EMAIL_REGEX =
  /([a-zA-Z0-9._%+-]+)\s*(?:\(|\[|\{)?\s*(?:at|@(?:собака)?)\s*(?:\)|\]|\})?\s*([a-zA-Z0-9.-]+)\s*(?:\(|\[|\{)?\s*(?:dot|\.|\(крапка\))\s*(?:\)|\]|\})?\s*([a-zA-Z]{2,})/gi;

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

  const obfuscatedText = text.replace(EMAIL_REGEX, ' ');
  for (const m of obfuscatedText.matchAll(OBFUSCATED_EMAIL_REGEX)) {
    const [, user, host, tld] = m;
    if (!user || !host || !tld) continue;
    const rebuilt = `${user}@${host}.${tld}`.toLowerCase();
    found.add(rebuilt);
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

  const phones = new Set<string>();
  for (const found of findPhoneNumbersInText(html, defaultCountry ? { defaultCountry } : {})) {
    if (found.number.isValid()) {
      phones.add(found.number.format('E.164'));
    }
  }

  // fallback: tel: protocol links that the finder may have missed
  const telMatches = html.match(/tel:\+?[\d\s\-()]{7,}/gi) || [];
  for (const m of telMatches) {
    const raw = m.replace(/^tel:/i, '').replace(/(?!^\+)[^\d+]/g, '');
    const parsed = parsePhoneNumberFromString(raw, defaultCountry);
    if (parsed?.isValid()) phones.add(parsed.format('E.164'));
  }

  return Array.from(phones).slice(0, 10);
}

export function extractAddresses(text: string): string[] {
  if (!text) return [];
  const addressPatterns = [
    /\d+\s+[A-Za-z\s]+(?:Street|St\.?|Avenue|Ave\.?|Boulevard|Blvd\.?|Road|Rd\.?|Drive|Dr\.?|Lane|Ln\.?|Way|Court|Ct\.?|Place|Pl\.?)[^,\n]*(?:,\s*[A-Za-z\s]+){0,2}/gi,
    /(?:street|st\.?|avenue|ave\.?|boulevard|blvd\.?|road|rd\.?|drive|dr\.?|lane|ln\.?|way|court|ct\.?|place|pl\.?)[\s,]+[^,.\n]+(?:,\s*[^,.\n]+){0,3}/gi,
    /(?:вул\.?|вулиця|просп\.?|проспект|пров\.?|бульвар)[^,\n]+(?:,\s*[^,\n]+){0,2}/gi,
  ];

  const addresses: string[] = [];
  for (const pattern of addressPatterns) {
    const matches = text.match(pattern) || [];
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
