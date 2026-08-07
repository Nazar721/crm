const express = require('express');
const path = require('path');

const app = express();
const port = process.env.PORT || 3000;
const overpassEndpoints = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.osm.ch/api/interpreter',
];

app.use(express.text({ type: '*/*', limit: '1mb' }));
app.use(express.static(__dirname, {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.js') || filePath.endsWith('.css')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    }
  }
}));

app.get('/api/geocode', async (req, res) => {
  const city = String(req.query.city || '').trim();
  if (!city) {
    res.status(400).json({ error: 'City is required' });
    return;
  }

  try {
    const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&accept-language=uk&q=${encodeURIComponent(city)}`;
    const response = await fetch(url, {
      headers: { 'User-Agent': 'Local CRM lead generation' },
    });
    const text = await response.text();
    res.status(response.status).type(response.headers.get('content-type') || 'application/json').send(text);
  } catch (err) {
    res.status(502).json({ error: err.message || 'Geocode request failed' });
  }
});

app.post('/api/overpass', async (req, res) => {
  const errors = [];
  try {
    for (const endpoint of overpassEndpoints) {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
        body: req.body,
      }).catch(err => {
        errors.push(`${endpoint}: ${err.message}`);
        return null;
      });

      if (!response) continue;
      const text = await response.text();
      if (response.ok) {
        res.status(response.status).type(response.headers.get('content-type') || 'application/json').send(text);
        return;
      }
      errors.push(`${endpoint}: ${response.status}`);
    }

    res.status(502).json({ error: 'All Overpass endpoints failed', details: errors });
  } catch (err) {
    res.status(502).json({ error: err.message || 'Overpass request failed' });
  }
});

app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(port, () => {
  console.log(`WebCRM running at http://localhost:${port}`);
});
