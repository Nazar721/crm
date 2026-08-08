'use client';
import { useState, useMemo, useEffect, useCallback } from 'react';
import { useApp } from '@/context/AppContext';
import { getLeads, saveLeads, getLeadFilters, saveLeadFilters } from '@/lib/storage';
import { generateId, formatDateTime } from '@/lib/utils';
import type { Lead, LeadFilters } from '@/types';
import EmptyState from '@/components/ui/EmptyState';

const STATUSES = ['Новий', 'Зацікавлений', 'Передзвонити', 'Не відповідає', 'Не цікаво'];

const FALLBACK_BOUNDS: Record<string, string[]> = {
  'львів': ['49.7681748', '49.9037122', '23.8980549', '24.1334136'],
  'київ': ['50.2132730', '50.5907980', '30.2394401', '30.8259410'],
  'одеса': ['46.3507020', '46.6162750', '30.5982200', '30.8907680'],
  'харків': ['49.8882560', '50.1119510', '36.1056920', '36.4544070'],
  'дніпро': ['48.3572540', '48.5903880', '34.8193070', '35.2086330'],
  'варшава': ['52.0978500', '52.3681530', '20.8516880', '21.2711510'],
};

function getNicheRules(niche: string) {
  const text = niche.toLowerCase().trim();
  const includesAny = (words: string[]) => words.some(w => text.includes(w));
  const rules: { key: string; value: string }[] = [];
  const add = (key: string, values: string[]) => values.forEach(v => rules.push({ key, value: v }));
  if (includesAny(['стомат', 'зуб', 'dent'])) add('amenity', ['dentist']);
  if (includesAny(['кафе', 'кав', 'coffee', 'cafe'])) add('amenity', ['cafe']);
  if (includesAny(['ресторан', 'їж', 'еда', 'food'])) add('amenity', ['restaurant', 'fast_food']);
  if (includesAny(['салон', 'краси', 'красот', 'beauty', 'манік', 'нігт', 'nail'])) add('shop', ['beauty', 'hairdresser']);
  if (includesAny(['перук', 'барбер', 'волос', 'hair'])) add('shop', ['hairdresser']);
  if (includesAny(['фітнес', 'спортзал', 'зал', 'gym'])) add('leisure', ['fitness_centre']);
  if (includesAny(['готел', 'хостел', 'hotel'])) add('tourism', ['hotel', 'guest_house', 'hostel']);
  if (includesAny(['аптек', 'pharmacy'])) add('amenity', ['pharmacy']);
  if (includesAny(['клінік', 'мед', 'лікар', 'doctor'])) add('amenity', ['clinic', 'doctors']);
  if (includesAny(['вет', 'тварин'])) add('amenity', ['veterinary']);
  if (includesAny(['авто', 'шиномонтаж', 'мийк'])) { add('shop', ['car_repair', 'car_parts']); add('amenity', ['car_wash']); }
  if (includesAny(['школ', 'освіт', 'курс'])) add('amenity', ['school', 'language_school']);
  if (includesAny(['садок', 'дитяч'])) add('amenity', ['kindergarten']);
  if (includesAny(['юрист', 'адвокат', 'law'])) add('office', ['lawyer']);
  if (includesAny(['бухгалтер', 'account'])) add('office', ['accountant']);
  if (includesAny(['нерухом', 'ріелт', 'real estate'])) add('office', ['estate_agent']);
  if (includesAny(['реклам', 'маркет', 'agency', 'агенц'])) { add('office', ['advertising', 'company', 'it']); add('shop', ['copyshop', 'computer']); add('craft', ['printer', 'photographer']); }
  if (includesAny(['банк', 'bank'])) add('amenity', ['bank']);
  return rules;
}

export default function LeadGenPage() {
  const { refreshKey, triggerRefresh } = useApp();
  const [niche, setNiche] = useState('');
  const [city, setCity] = useState('');
  const [statusText, setStatusText] = useState('');
  const [filters, setFilters] = useState<LeadFilters>({ onlyNoWebsite: false, hideNotInteresting: true, showHidden: false });
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); setFilters(getLeadFilters()); }, []);

  const filtered = useMemo(() => {
    if (!mounted) return [];
    return getLeads().filter(l => {
      if (filters.onlyNoWebsite && l.website) return false;
      if (!filters.showHidden && filters.hideNotInteresting && l.status === 'Не цікаво') return false;
      return true;
    });
  }, [mounted, refreshKey, filters]);

  const updateFilter = (patch: Partial<LeadFilters>) => {
    const next = { ...filters, ...patch };
    setFilters(next); saveLeadFilters(next); triggerRefresh();
  };

  const search = async () => {
    if (!niche.trim() || !city.trim()) { setStatusText('Введіть нішу та місто'); return; }
    setStatusText('Шукаю в OpenStreetMap...');
    try {
      const cityLower = city.toLowerCase().trim();
      let bounds = FALLBACK_BOUNDS[cityLower] || null;
      try {
        const geoRes = await fetch(`/api/geocode?city=${encodeURIComponent(city)}`);
        if (geoRes.ok) {
          const places = await geoRes.json();
          const box = places?.[0]?.boundingbox;
          if (Array.isArray(box) && box.length === 4) bounds = box;
        }
      } catch {}

      const rules = getNicheRules(niche);
      const safeCity = city.replace(/"/g, '\\"');
      const safeNiche = niche.replace(/"/g, '\\"');
      let query = '';
      if (bounds) {
        const [south, north, west, east] = bounds;
        const bbox = `${south},${west},${north},${east}`;
        const tagSearch = rules.map(r => `  nwr["${r.key}"="${r.value}"](${bbox});`).join('\n');
        query = `[out:json][timeout:25];\n(\n${tagSearch}\n  nwr["name"~"${safeNiche}",i](${bbox});\n  nwr["amenity"~"${safeNiche}",i](${bbox});\n  nwr["shop"~"${safeNiche}",i](${bbox});\n  nwr["office"~"${safeNiche}",i](${bbox});\n  nwr["craft"~"${safeNiche}",i](${bbox});\n);\nout center tags 120;`;
      } else {
        const tagArea = rules.map(r => `  nwr["${r.key}"="${r.value}"](area.searchArea);`).join('\n');
        const tagAddr = rules.map(r => `  nwr["${r.key}"="${r.value}"]["addr:city"~"^${safeCity}$",i];`).join('\n');
        const tagCity = rules.map(r => `  nwr(around.cityCenter:25000)["${r.key}"="${r.value}"];`).join('\n');
        query = `[out:json][timeout:35];\n(\n  area["name"~"^${safeCity}$",i]["boundary"="administrative"];\n  area["name:uk"~"^${safeCity}$",i]["boundary"="administrative"];\n  area["name:en"~"^${safeCity}$",i]["boundary"="administrative"];\n)->.searchArea;\n(\n  node["place"~"city|town|village"]["name"~"^${safeCity}$",i];\n)->.cityCenter;\n(\n${tagArea}\n${tagAddr}\n${tagCity}\n  nwr["name"~"${safeNiche}",i](area.searchArea);\n  nwr["amenity"~"${safeNiche}",i](area.searchArea);\n  nwr["shop"~"${safeNiche}",i](area.searchArea);\n);\nout center tags 120;`;
      }

      const overpassRes = await fetch('/api/overpass', { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=UTF-8' }, body: query });
      if (!overpassRes.ok) throw new Error('Overpass тимчасово не відповідає');
      const json = await overpassRes.json();
      const elements = json.elements || [];
      const found: Lead[] = elements.map((el: any) => {
        const tags = el.tags || {};
        const center = el.center || {};
        const phone = tags['contact:phone'] || tags['phone'] || tags['mobile'] || '';
        const website = tags['contact:website'] || tags['website'] || '';
        const telegram = tags['contact:telegram'] || tags['telegram'] || '';
        const addr = [tags['addr:street'], tags['addr:housenumber'], tags['addr:city']].filter(Boolean).join(', ');
        return { id: `${el.type}-${el.id}`, osmType: el.type, osmId: el.id, name: tags.name || 'Без назви', address: addr || tags['addr:full'] || '', phone, telegram, website, lat: el.lat || center.lat || '', lon: el.lon || center.lon || '', status: 'Новий', note: '', lastContactAt: '', createdAt: new Date().toISOString() };
      });

      const existing = getLeads();
      const byId = new Map(existing.map(l => [l.id, l]));
      found.forEach(l => byId.set(l.id, { ...l, ...(byId.get(l.id) || {}) }));
      saveLeads([...byId.values()]);
      triggerRefresh();
      setStatusText(`Знайдено: ${found.length}`);
      if (!found.length) setStatusText('Нічого не знайдено. Спробуйте іншу назву.');
    } catch (err: any) {
      setStatusText('');
      alert(err.message || 'Помилка пошуку');
    }
  };

  const updateLead = (id: string, patch: Partial<Lead>) => {
    const leads = getLeads();
    const idx = leads.findIndex(l => l.id === id);
    if (idx >= 0) { leads[idx] = { ...leads[idx], ...patch, lastContactAt: new Date().toISOString() }; saveLeads(leads); triggerRefresh(); }
  };

  const deleteLead = (id: string) => {
    saveLeads(getLeads().filter(l => l.id !== id)); triggerRefresh();
  };

  const exportCsv = () => {
    const rows = [['назва', 'адреса', 'телефон', 'сайт', 'статус', 'нотатка', 'дата останнього контакту'], ...getLeads().map(l => [l.name, l.address, l.phone, l.website, l.status, l.note, l.lastContactAt])];
    const csv = rows.map(r => r.map(v => `"${String(v || '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `leads-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  };

  const importCsv = (file: File | undefined) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = reader.result as string;
      const rows: string[][] = []; let row: string[] = []; let cell = ''; let inQ = false;
      for (let i = 0; i < text.length; i++) {
        const ch = text[i], next = text[i + 1];
        if (ch === '"' && inQ && next === '"') { cell += '"'; i++; }
        else if (ch === '"') inQ = !inQ;
        else if (ch === ',' && !inQ) { row.push(cell); cell = ''; }
        else if ((ch === '\n' || ch === '\r') && !inQ) { if (cell || row.length) rows.push([...row, cell]); row = []; cell = ''; if (ch === '\r' && next === '\n') i++; }
        else cell += ch;
      }
      if (cell || row.length) rows.push([...row, cell]);
      const [, ...dataRows] = rows;
      const imported = dataRows.filter(r => r.length).map(r => ({
        id: `csv-${generateId()}`, name: r[0] || 'Без назви', address: r[1] || '', phone: r[2] || '', website: r[3] || '',
        status: r[4] || 'Новий', note: r[5] || '', lastContactAt: r[6] || '', telegram: '', lat: '', lon: '', createdAt: new Date().toISOString(),
      }));
      const existing = getLeads();
      const byId = new Map(existing.map(l => [l.id, l]));
      imported.forEach(l => byId.set(l.id, l));
      saveLeads([...byId.values()]); triggerRefresh();
    };
    reader.readAsText(file);
  };

  const normalizePhone = (phone?: string) => String(phone || '').replace(/[^\d+]/g, '').replace(/^00/, '+');
  const phoneForUrl = (phone?: string) => { const c = normalizePhone(phone); return c.startsWith('+') ? c.slice(1) : c; };
  const getMapsLink = (l: Lead) => l.lat && l.lon ? `https://www.google.com/maps/search/?api=1&query=${l.lat},${l.lon}` : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${l.name} ${l.address}`.trim())}`;

  return (
    <section className="page active">
      <div className="page-header">
        <div><h1 className="page-title">Лідогенерація</h1><p className="page-subtitle">Пошук потенційних клієнтів через OpenStreetMap</p></div>
        <div className="header-actions">
          <button className="btn btn-ghost" onClick={() => { const i = document.createElement('input'); i.type = 'file'; i.accept = '.csv,text/csv'; i.onchange = (e) => importCsv((e.target as HTMLInputElement).files?.[0]); i.click(); }}>Імпорт CSV</button>
          <button className="btn btn-primary" onClick={exportCsv}>Експорт CSV</button>
        </div>
      </div>

      <div className="lead-search-panel">
        <div className="form-group"><label className="form-label">Ніша</label><input type="text" className="form-input" value={niche} onChange={e => setNiche(e.target.value)} placeholder="кафе, стоматологія, салон краси..." /></div>
        <div className="form-group"><label className="form-label">Місто</label><input type="text" className="form-input" value={city} onChange={e => setCity(e.target.value)} placeholder="Львів, Київ, Варшава..." /></div>
        <button className="btn btn-primary" onClick={search}>Знайти</button>
      </div>

      <div className="lead-filters">
        <label className="check-option"><input type="checkbox" checked={filters.onlyNoWebsite} onChange={e => updateFilter({ onlyNoWebsite: e.target.checked })} /> <span>Тільки без сайту</span></label>
        <label className="check-option"><input type="checkbox" checked={filters.hideNotInteresting} onChange={e => updateFilter({ hideNotInteresting: e.target.checked })} /> <span>Приховати &quot;Не цікаво&quot;</span></label>
        {filters.showHidden && <button className="btn btn-ghost" onClick={() => updateFilter({ showHidden: false, hideNotInteresting: true })}>Приховати приховані</button>}
        {!filters.showHidden && <button className="btn btn-ghost" onClick={() => updateFilter({ showHidden: true, hideNotInteresting: false })}>Показати приховані</button>}
        <span className="lead-status-text">{statusText}</span>
      </div>

      <div className="table-wrap">
        <table className="data-table leads-table">
          <thead><tr><th>Назва бізнесу</th><th>Адреса</th><th>Телефон</th><th>WhatsApp</th><th>Telegram</th><th>Viber</th><th>Сайт</th><th>Google Maps</th><th>Статус</th><th>Нотатка</th><th>Останній контакт</th><th>Дії</th></tr></thead>
          <tbody>
            {!filtered.length ? <tr className="empty-row"><td colSpan={12}><EmptyState message="Немає лідів" hint="Введіть нішу та місто, щоб знайти бізнеси" /></td></tr> :
            filtered.map(l => {
              const phone = normalizePhone(l.phone);
              const phoneUrl = phoneForUrl(l.phone);
              const tg = String(l.telegram || '').replace(/^@/, '');
              return (
                <tr key={l.id}>
                  <td><strong>{l.name}</strong></td>
                  <td>{l.address || '—'}</td>
                  <td>{phone ? <button className="btn btn-ghost" style={{ padding: '6px 10px', fontSize: '0.78rem' }} onClick={() => { navigator.clipboard?.writeText(phone); }}>Копіювати</button> : '—'}</td>
                  <td>{phone ? <a className="btn btn-ghost" href={`https://wa.me/${phoneUrl}`} target="_blank" rel="noopener noreferrer" style={{ padding: '6px 10px', fontSize: '0.78rem' }}>WhatsApp</a> : '❌'}</td>
                  <td>{tg ? <a className="btn btn-ghost" href={`https://t.me/${tg}`} target="_blank" rel="noopener noreferrer" style={{ padding: '6px 10px', fontSize: '0.78rem' }}>Telegram</a> : '❌'}</td>
                  <td>{phone ? <a className="btn btn-ghost" href={`viber://chat?number=%2B${phoneUrl}`} style={{ padding: '6px 10px', fontSize: '0.78rem' }}>Viber</a> : '❌'}</td>
                  <td>{l.website ? <a className="link" href={l.website} target="_blank" rel="noopener noreferrer">Є сайт</a> : '❌ Немає'}</td>
                  <td><a className="link" href={getMapsLink(l)} target="_blank" rel="noopener noreferrer">Карти</a></td>
                  <td><select className="form-input lead-status" value={l.status} onChange={e => updateLead(l.id, { status: e.target.value })} style={{ minWidth: 130 }}>{STATUSES.map(s => <option key={s} value={s}>{s}</option>)}</select></td>
                  <td><textarea className="form-input lead-note" rows={2} value={l.note || ''} onChange={e => updateLead(l.id, { note: e.target.value })} placeholder="Нотатка..." style={{ minWidth: 180 }} /></td>
                  <td>{l.lastContactAt ? formatDateTime(l.lastContactAt) : '—'}</td>
                  <td><button className="btn-icon btn-icon--danger" title="Видалити" onClick={() => deleteLead(l.id)}>×</button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
