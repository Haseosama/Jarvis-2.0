// Media Service: Radio Browser directory + Preset French stations + Sleep sounds + Podcasts (iTunes + RSS) + YouTube/Video search

import { hostBridge } from '../core/hostBridge.js';

export const PRESET_RADIOS = [
  {
    name: 'France Inter',
    stream: 'https://icecast.radiofrance.fr/franceinter-midfi.mp3',
    tags: ' généraliste, actualités, talk',
    country: 'FR',
  },
  {
    name: 'France Info',
    stream: 'https://icecast.radiofrance.fr/franceinfo-midfi.mp3',
    tags: 'info, continu, actualités',
    country: 'FR',
  },
  {
    name: 'FIP',
    stream: 'https://icecast.radiofrance.fr/fip-midfi.mp3',
    tags: 'éclectique, jazz, groove, découverte',
    country: 'FR',
  },
  {
    name: 'France Culture',
    stream: 'https://icecast.radiofrance.fr/franceculture-midfi.mp3',
    tags: 'culture, idées, documentaires',
    country: 'FR',
  },
  {
    name: 'France Musique',
    stream: 'https://icecast.radiofrance.fr/francemusique-midfi.mp3',
    tags: 'classique, concerts, jazz',
    country: 'FR',
  },
  {
    name: "Mouv'",
    stream: 'https://icecast.radiofrance.fr/mouv-midfi.mp3',
    tags: 'hip-hop, rap, rnb, urbain',
    country: 'FR',
  },
  {
    name: 'SomaFM Groove Salad',
    stream: 'https://ice6.somafm.com/groovesalad-128-mp3',
    tags: 'ambient, chillout, downtempo',
    country: 'US',
  },
  {
    name: 'SomaFM Drone Zone (Calme / Sommeil)',
    stream: 'https://ice6.somafm.com/dronezone-128-mp3',
    tags: 'calme, sommeil, ambient, zen',
    country: 'US',
  },
  {
    name: 'Sons de la Pluie (Sleep)',
    stream: 'https://maggie.torontocast.com:2020/stream/natureradiorain',
    tags: 'pluie, rain, orage, dormir',
    country: 'CA',
  },
  {
    name: 'Sons de la Nature (Sleep)',
    stream: 'https://az1.mediacp.eu/listen/natureradiosleep/radio.mp3',
    tags: 'nature, vagues, océan, forêt',
    country: 'EU',
  },
];

const RADIO_SERVERS = [
  'de1.api.radio-browser.info',
  'nl1.api.radio-browser.info',
  'at1.api.radio-browser.info',
];

export async function searchRadioStations(query = '', country = 'FR') {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return PRESET_RADIOS;

  const presetMatches = PRESET_RADIOS.filter(
    (r) =>
      r.name.toLowerCase().includes(q) ||
      r.tags.toLowerCase().includes(q)
  );

  for (const host of RADIO_SERVERS) {
    try {
      const params = new URLSearchParams({
        name: query.trim(),
        limit: '15',
        hidebroken: 'true',
        order: 'clickcount',
        reverse: 'true',
      });
      if (country && country !== 'ALL' && country.length === 2) {
        params.set('countrycode', country.toUpperCase());
      }
      const res = await hostBridge.httpFetch(`https://${host}/json/stations/search?${params.toString()}`, {
        timeoutMs: 6000,
      });
      if (res.ok && Array.isArray(res.json) && res.json.length > 0) {
        const remote = res.json
          .map((o) => {
            const stream = String(o.url_resolved || o.url || '').trim();
            if (!stream.startsWith('https://')) return null;
            return {
              name: String(o.name || '').trim().slice(0, 80),
              stream,
              tags: String(o.tags || '').slice(0, 100),
              country: String(o.countrycode || country || 'FR'),
            };
          })
          .filter((s) => s && s.name);
        return [...presetMatches, ...remote].filter(
          (v, idx, arr) => arr.findIndex((x) => x.stream === v.stream) === idx
        );
      }
    } catch {
      // try next server
    }
  }

  return presetMatches.length > 0 ? presetMatches : PRESET_RADIOS;
}

export async function searchPodcasts(query = 'Affaires sensibles') {
  const q = String(query || '').trim() || 'France Inter';
  try {
    const url = `https://itunes.apple.com/search?media=podcast&entity=podcast&limit=8&country=FR&term=${encodeURIComponent(q)}`;
    const res = await hostBridge.httpFetch(url, { timeoutMs: 8000 });
    if (res.ok && res.json?.results?.length) {
      const pods = res.json.results.map((r) => ({
        id: r.collectionId,
        title: r.collectionName,
        author: r.artistName,
        feedUrl: r.feedUrl,
        artwork: r.artworkUrl600 || r.artworkUrl100,
      }));
      // Fetch episodes of the first podcast RSS feed
      const firstFeed = pods[0]?.feedUrl;
      let episodes = [];
      if (firstFeed) {
        episodes = await fetchPodcastEpisodes(firstFeed, pods[0].title);
      }
      return { podcasts: pods, episodes };
    }
  } catch {
    // ignore
  }
  return {
    podcasts: [
      {
        id: 'fallback-1',
        title: 'Affaires Sensibles — France Inter',
        author: 'Fabrice Drouelle',
        feedUrl: 'https://radiofrance-podcast.net/podcast09/rss_13939.xml',
      },
    ],
    episodes: [],
  };
}

export async function fetchPodcastEpisodes(feedUrl, podcastTitle = '') {
  try {
    const res = await hostBridge.httpFetch(feedUrl, { timeoutMs: 8000 });
    const xml = res.text || '';
    const items = [];
    const itemBlocks = xml.split(/<item[\s>]/i).slice(1, 12);
    for (const block of itemBlocks) {
      const titleMatch = /<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i.exec(block);
      const encMatch = /<enclosure[^>]+url=["']([^"']+)["']/i.exec(block);
      const pubMatch = /<pubDate>([\s\S]*?)<\/pubDate>/i.exec(block);
      if (titleMatch && encMatch) {
        items.push({
          title: titleMatch[1].replace(/<[^>]+>/g, '').trim(),
          url: encMatch[1].trim(),
          podcastTitle,
          pubDate: pubMatch ? pubMatch[1].trim() : '',
          podcast: true,
        });
      }
    }
    return items;
  } catch {
    return [];
  }
}

export async function searchYouTubeVideos(query = '') {
  const q = String(query || '').trim();
  if (!q) return [];
  // Try Piped public API instances for direct YouTube video IDs & titles
  const instances = [
    'https://pipedapi.kavin.rocks',
    'https://pipedapi.tokhmi.xyz',
    'https://pipedapi.moomoo.me',
  ];
  for (const inst of instances) {
    try {
      const res = await hostBridge.httpFetch(
        `${inst}/search?q=${encodeURIComponent(q)}&filter=videos`,
        { timeoutMs: 5000 }
      );
      if (res.ok && Array.isArray(res.json?.items) && res.json.items.length > 0) {
        return res.json.items
          .filter((it) => it.url && it.url.includes('v='))
          .slice(0, 8)
          .map((it) => {
            const vid = new URLSearchParams(it.url.split('?')[1] || '').get('v') || '';
            return {
              id: vid,
              title: it.title || q,
              uploader: it.uploaderName || 'YouTube',
              duration: it.duration || 0,
              thumbnail: it.thumbnail || `https://i.ytimg.com/vi/${vid}/hqdefault.jpg`,
              embedUrl: `https://www.youtube-nocookie.com/embed/${vid}?autoplay=1`,
              watchUrl: `https://www.youtube.com/watch?v=${vid}`,
            };
          });
      }
    } catch {
      // try next
    }
  }
  // Fallback: scrape YouTube HTML search results via hostBridge.httpFetch
  try {
    const res = await hostBridge.httpFetch(
      `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`,
      { timeoutMs: 7000 }
    );
    const html = res.text || '';
    const matches = [...html.matchAll(/"videoId":"([a-zA-Z0-9_-]{11})".*?"title":\{"runs":\[\{"text":"([^"]+)"/g)];
    const seen = new Set();
    const out = [];
    for (const m of matches) {
      const vid = m[1];
      if (seen.has(vid)) continue;
      seen.add(vid);
      out.push({
        id: vid,
        title: m[2].replace(/\\u0026/g, '&'),
        uploader: 'YouTube',
        thumbnail: `https://i.ytimg.com/vi/${vid}/hqdefault.jpg`,
        embedUrl: `https://www.youtube-nocookie.com/embed/${vid}?autoplay=1`,
        watchUrl: `https://www.youtube.com/watch?v=${vid}`,
      });
      if (out.length >= 6) break;
    }
    if (out.length > 0) return out;
  } catch {
    // ignore
  }
  return [
    {
      id: 'jfKfPfyJRdk',
      title: `Lofi Hip Hop Radio — Recherche : ${q}`,
      uploader: 'Lofi Girl',
      thumbnail: 'https://i.ytimg.com/vi/jfKfPfyJRdk/hqdefault.jpg',
      embedUrl: 'https://www.youtube-nocookie.com/embed/jfKfPfyJRdk?autoplay=1',
      watchUrl: `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`,
    },
  ];
}
