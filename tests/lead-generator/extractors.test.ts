import { describe, it, expect } from 'vitest';
import {
  extractEmails,
  extractPhones,
  extractAddresses,
  extractSocialLinks,
  extractTechnologies,
  detectContactForm,
  detectBooking,
  detectCTA,
  detectMobile,
} from '../../lib/lead-generator/extractors';

describe('extractEmails', () => {
  it('extracts plain emails', () => {
    const result = extractEmails('Contact us at info@dental.kyiv.ua or sales@example-clinic.com');
    expect(result).toContain('info@dental.kyiv.ua');
    expect(result).toContain('sales@example-clinic.com');
  });

  it('parses mailto: links', () => {
    const result = extractEmails('<a href="mailto:Hello@Clinic.UA?subject=hi">mail</a>');
    expect(result).toContain('hello@clinic.ua');
  });

  it('parses obfuscated emails', () => {
    const result = extractEmails('write to info [at] clinic [dot] com please');
    expect(result).toContain('info@clinic.com');
  });

  it('dedupes case-insensitively', () => {
    const result = extractEmails('INFO@clinic.com info@clinic.com');
    expect(result).toHaveLength(1);
  });

  it('filters file artifacts and blacklisted domains', () => {
    const result = extractEmails('logo.png@example.com test@example.com valid@real.com');
    expect(result).toEqual(['valid@real.com']);
  });
});

describe('extractPhones', () => {
  it('extracts valid Ukrainian phones in E.164', () => {
    const result = extractPhones('Call us: +380 44 123 4567 or +380671234567', 'Kyiv, Ukraine');
    expect(result).toContain('+380441234567');
    expect(result).toContain('+380671234567');
  });

  it('ignores random numbers and dates', () => {
    const result = extractPhones('In 2021 we served 12345 clients. Order #123456. 2021-12-30', 'Kyiv, Ukraine');
    expect(result).toHaveLength(0);
  });

  it('extracts US phones for US location (555 numbers correctly rejected as fictional)', () => {
    const result = extractPhones('Phone: (650) 253-0000', 'New York, USA');
    expect(result).toContain('+16502530000');
    expect(extractPhones('Phone: (555) 123-4567', 'New York, USA')).toHaveLength(0);
  });
});

describe('extractAddresses', () => {
  it('extracts English addresses', () => {
    const result = extractAddresses('Our office: 12 Khreshchatyk Street, Kyiv, 01001');
    expect(result.length).toBeGreaterThan(0);
    expect(result[0]).toMatch(/Khreshchatyk/i);
  });

  it('extracts Ukrainian addresses', () => {
    const result = extractAddresses('Ми знаходимось: вул. Хрещатик 12, Київ');
    expect(result.length).toBeGreaterThan(0);
  });
});

describe('extractSocialLinks', () => {
  it('extracts social links', () => {
    const html = `
      <a href="https://facebook.com/clinic">fb</a>
      <a href="https://instagram.com/clinic.ua">ig</a>
      <a href="https://t.me/clinic">tg</a>
      <a href="https://clinic.ua/about">internal</a>
    `;
    const result = extractSocialLinks(html);
    expect(result).toContain('https://facebook.com/clinic');
    expect(result).toContain('https://instagram.com/clinic.ua');
    expect(result).toContain('https://t.me/clinic');
    expect(result).toHaveLength(3);
  });
});

describe('extractTechnologies', () => {
  it('detects WordPress and analytics', () => {
    const html = '<script src="/wp-content/themes/main.js"></script><script>gtag("init")</script>';
    const result = extractTechnologies(html);
    expect(result).toContain('WordPress');
    expect(result).toContain('Google Analytics');
  });

  it('detects Tilda', () => {
    expect(extractTechnologies('<div data-tilda-project="123">')).toContain('Tilda');
  });

  it('dedupes WordPress indicators', () => {
    const result = extractTechnologies('wordpress wp-content');
    expect(result.filter((t) => t === 'WordPress')).toHaveLength(1);
  });
});

describe('feature detection', () => {
  it('detectContactForm', () => {
    expect(detectContactForm('<form action="/contact"><input name="email"></form>')).toBe(true);
    expect(detectContactForm('<div>No forms here</div>')).toBe(false);
  });

  it('detectBooking (ukrainian patterns)', () => {
    expect(detectBooking('Записатися на прийом онлайн')).toBe(true);
    expect(detectBooking('Book now button')).toBe(true);
    expect(detectBooking('Просто текст')).toBe(false);
  });

  it('detectCTA', () => {
    expect(detectCTA('<button>Зателефонувати</button>')).toBe(true);
    expect(detectCTA('<a class="btn-primary" href="/order">Order</a>')).toBe(true);
  });

  it('detectMobile requires viewport meta', () => {
    expect(detectMobile('<meta name="viewport" content="width=device-width, initial-scale=1">')).toBe(true);
    expect(detectMobile('<meta name="viewport" content="width=1024">')).toBe(false);
  });
});
