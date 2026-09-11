import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'WebAgency CRM',
    short_name: 'WebCRM',
    description: 'CRM система для веб-агентства — управління проєктами, клієнтами, фінансами',
    lang: 'uk',
    start_url: '/dashboard',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#000000',
    theme_color: '#000000',
    categories: ['business', 'finance', 'productivity'],
    icons: [
      { src: '/icon-72x72.png', sizes: '72x72', type: 'image/png' },
      { src: '/icon-96x96.png', sizes: '96x96', type: 'image/png' },
      { src: '/icon-128x128.png', sizes: '128x128', type: 'image/png' },
      { src: '/icon-144x144.png', sizes: '144x144', type: 'image/png' },
      { src: '/icon-152x152.png', sizes: '152x152', type: 'image/png' },
      { src: '/icon-192x192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-384x384.png', sizes: '384x384', type: 'image/png' },
      { src: '/icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icon-maskable-192x192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
      { src: '/icon-maskable-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    screenshots: [],
    shortcuts: [
      {
        name: 'Дашборд',
        short_name: 'Дашборд',
        url: '/dashboard',
        description: 'Головна панель управління',
      },
      {
        name: 'Проєкти',
        short_name: 'Проєкти',
        url: '/projects',
        description: 'Управління проєктами',
      },
      {
        name: 'Фінанси',
        short_name: 'Фінанси',
        url: '/finance',
        description: 'Фінансовий облік',
      },
    ],
  };
}
