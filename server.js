const express = require('express');
const axios = require('axios');
const path = require('path');
const cookieParser = require('cookie-parser');

const app = express();
const PORT = process.env.PORT || 3000;

const TMDB_API_KEY = '2d09e0079a61e4b836ed9bd471ee73ed';
const TMDB_BASE_URL = 'https://api.themoviedb.org/3';
const JIKAN_BASE_URL = 'https://api.jikan.moe/v4';

app.use(express.json());
app.use(cookieParser());

const requireAuth = (req, res, next) => {
  if (req.cookies.archive_auth === 'true') next();
  else res.redirect('/login.html');
};

app.use(express.static(path.join(__dirname, 'public'), { index: false }));

app.get('/', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});
app.get('/index.html', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.post('/api/auth', (req, res) => {
  const { username, password } = req.body;
  if (username === 'prashil' && password === 'admin0056') {
    res.cookie('archive_auth', 'true', { maxAge: 86400000, httpOnly: true });
    res.json({ success: true });
  } else {
    res.status(401).json({ error: 'Invalid credentials' });
  }
});

// ── Vidora availability check (cached)
const vidoraCache = new Map();
const VIDORA_CACHE_TTL = 3600 * 1000;
const VIDORA_TIMEOUT = 8000;

const NOT_FOUND_SIGNALS = [
  'not found', 'not available', 'no sources', 'no source',
  'media not found', 'content not found', 'video not found',
  'title not found', 'does not exist', 'unavailable',
  'no video', 'no results', 'media does not exist',
];
const SUCCESS_SIGNALS = [
  '<video', 'jwplayer', 'videojs', '.m3u8', '"sources"',
  'hls', '<iframe', 'player-container', 'player-wrapper',
];

async function checkVidora(type, id) {
  const key = `${type}:${id}`;
  const cached = vidoraCache.get(key);
  if (cached && Date.now() - cached.ts < VIDORA_CACHE_TTL) return cached.ok;

  let url;
  if (type === 'tv') url = `https://vidora.ac/tv/${id}/1/1`;
  else if (type === 'anime') url = `https://vidora.ac/anime/${id}/1/sub`;
  else url = `https://vidora.ac/movie/${id}`;

  try {
    const res = await axios.get(url, {
      timeout: VIDORA_TIMEOUT,
      validateStatus: () => true,
      maxContentLength: 500000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
      },
    });

    let ok;
    if (res.status === 404 || res.status >= 500) ok = false;
    else if (res.status === 200) {
      const body = String(res.data || '').toLowerCase();
      const hasSuccess = SUCCESS_SIGNALS.some(s => body.includes(s));
      const hasNotFound = NOT_FOUND_SIGNALS.some(s => body.includes(s));
      if (hasSuccess) ok = true;
      else if (hasNotFound) ok = false;
      else ok = true;
    } else ok = true;

    vidoraCache.set(key, { ok, ts: Date.now() });
    return ok;
  } catch {
    return true;
  }
}

app.get('/api/check-vidora', async (req, res) => {
  const { type, id } = req.query;
  if (!type || !id) return res.status(400).json({ error: 'type and id required' });
  if (!['movie', 'tv', 'anime'].includes(type)) return res.status(400).json({ error: 'bad type' });
  const ok = await checkVidora(type, id);
  res.json({ ok });
});

app.get('/api/check-vidora/batch', async (req, res) => {
  const { type, ids } = req.query;
  if (!type || !ids) return res.status(400).json({ error: 'type and ids required' });
  if (!['movie', 'tv', 'anime'].includes(type)) return res.status(400).json({ error: 'bad type' });

  const idList = String(ids).split(',').filter(Boolean).slice(0, 100);
  const results = {};
  const queue = [...idList];
  async function worker() {
    while (queue.length) {
      const id = queue.shift();
      results[id] = await checkVidora(type, id);
    }
  }
  await Promise.all(Array.from({ length: 10 }, worker));
  res.json({ results });
});

// ── TMDB formatting
const formatMedia = (items) => items.map(m => {
  const isTV = m.media_type === 'tv' || m.first_air_date !== undefined || m.name !== undefined;
  return {
    id: m.id,
    title: m.title || m.name,
    year: (m.release_date || m.first_air_date || '').split('-')[0] || 'N/A',
    poster: m.poster_path ? `https://image.tmdb.org/t/p/w500${m.poster_path}` : 'https://via.placeholder.com/500x750?text=No+Poster',
    backdrop: m.backdrop_path ? `https://image.tmdb.org/t/p/original${m.backdrop_path}` : null,
    media_type: isTV ? 'tv' : 'movie'
  };
});

// ── Jikan formatting (MAL anime)
const formatAnime = (items) => (items || []).map(a => ({
  id: a.mal_id,
  title: a.title_english || a.title || a.title_japanese || 'Untitled',
  year: (a.year || (a.aired && a.aired.prop && a.aired.prop.from && a.aired.prop.from.year)) || 'N/A',
  poster: (a.images && a.images.jpg && (a.images.jpg.large_image_url || a.images.jpg.image_url)) || 'https://via.placeholder.com/500x750?text=No+Poster',
  backdrop: null,
  episodes: a.episodes || null,
  score: a.score || null,
  media_type: 'anime'
}));

// ── Jikan cache (avoid hammering their API)
const jikanCache = new Map();
const JIKAN_CACHE_TTL = 30 * 60 * 1000;

function cacheGet(key) {
  const c = jikanCache.get(key);
  if (c && Date.now() - c.ts < JIKAN_CACHE_TTL) return c.data;
  return null;
}
function cacheSet(key, data) {
  jikanCache.set(key, { data, ts: Date.now() });
}

async function jikanGet(path, params = {}) {
  const res = await axios.get(`${JIKAN_BASE_URL}${path}`, {
    params,
    timeout: 12000,
    headers: {
      'User-Agent': 'PirateStream/1.0 (+https://pirate-stream.onrender.com)',
      'Accept': 'application/json',
    },
  });
  return res.data;
}

// ── Home
app.get('/api/home', async (req, res) => {
  try {
    const [trendingRes, actionRes, seriesRes, bollywoodRes, animeRes] = await Promise.allSettled([
      axios.get(`${TMDB_BASE_URL}/trending/all/week?api_key=${TMDB_API_KEY}`),
      axios.get(`${TMDB_BASE_URL}/discover/movie?api_key=${TMDB_API_KEY}&with_genres=28&sort_by=popularity.desc`),
      axios.get(`${TMDB_BASE_URL}/discover/tv?api_key=${TMDB_API_KEY}&sort_by=popularity.desc`),
      axios.get(`${TMDB_BASE_URL}/discover/movie?api_key=${TMDB_API_KEY}&with_original_language=hi&sort_by=popularity.desc`),
      jikanGet('/top/anime', { limit: 24 }).catch(() => ({ data: [] })),
    ]);

    const trending = trendingRes.status === 'fulfilled' ? trendingRes.value.data.results : [];
    const action = actionRes.status === 'fulfilled' ? actionRes.value.data.results : [];
    const series = seriesRes.status === 'fulfilled' ? seriesRes.value.data.results : [];
    const bollywood = bollywoodRes.status === 'fulfilled' ? bollywoodRes.value.data.results : [];
    const anime = animeRes.status === 'fulfilled' ? (animeRes.value.data || []) : [];

    const heroPool = trending.filter(m => m.backdrop_path);
    const hero = heroPool.length > 0 ? heroPool[Math.floor(Math.random() * Math.min(10, heroPool.length))] : trending[0];

    res.json({
      hero: hero ? formatMedia([hero])[0] : null,
      rows: [
        { title: 'Trending Now', items: formatMedia(trending) },
        { title: 'Top Anime', items: formatAnime(anime) },
        { title: 'Blockbusters (Hollywood)', items: formatMedia(action) },
        { title: 'Popular Series', items: formatMedia(series) },
        { title: 'Bollywood Hits', items: formatMedia(bollywood) }
      ]
    });
  } catch {
    res.status(500).json({ error: 'Failed to fetch home data' });
  }
});

app.get('/api/movies', async (req, res) => {
  try {
    const response = await axios.get(`${TMDB_BASE_URL}/discover/movie?api_key=${TMDB_API_KEY}&sort_by=popularity.desc`);
    res.json(formatMedia(response.data.results));
  } catch { res.status(500).json({ error: 'Failed' }); }
});

app.get('/api/series', async (req, res) => {
  try {
    const response = await axios.get(`${TMDB_BASE_URL}/discover/tv?api_key=${TMDB_API_KEY}&sort_by=popularity.desc`);
    res.json(formatMedia(response.data.results));
  } catch { res.status(500).json({ error: 'Failed' }); }
});

app.get('/api/search', async (req, res) => {
  const query = req.query.q;
  if (!query) return res.json([]);
  try {
    const response = await axios.get(`${TMDB_BASE_URL}/search/multi`, {
      params: { api_key: TMDB_API_KEY, query, include_adult: false }
    });
    const results = response.data.results.filter(m => m.media_type !== 'person');
    res.json(formatMedia(results));
  } catch { res.status(500).json({ error: 'Failed' }); }
});

// ── Anime routes (Jikan, fail-safe)
app.get('/api/anime', async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const key = `top:${page}`;
  const cached = cacheGet(key);
  if (cached) return res.json(cached);

  try {
    const data = await jikanGet('/top/anime', { limit: 24, page });
    const formatted = formatAnime(data.data || []);
    cacheSet(key, formatted);
    res.json(formatted);
  } catch (err) {
    console.error('Jikan /top/anime failed:', err.message);
    res.json([]);
  }
});

app.get('/api/anime/search', async (req, res) => {
  const query = req.query.q;
  if (!query) return res.json([]);
  const key = `search:${query}`;
  const cached = cacheGet(key);
  if (cached) return res.json(cached);

  try {
    const data = await jikanGet('/anime', { q: query, limit: 24, order_by: 'score', sort: 'desc' });
    const formatted = formatAnime(data.data || []);
    cacheSet(key, formatted);
    res.json(formatted);
  } catch (err) {
    console.error('Jikan /anime search failed:', err.message);
    res.json([]);
  }
});

app.get('/api/anime/:id', async (req, res) => {
  const key = `id:${req.params.id}`;
  const cached = cacheGet(key);
  if (cached) return res.json(cached);

  try {
    const data = await jikanGet(`/anime/${req.params.id}`);
    const a = data.data;
    const out = {
      id: a.mal_id,
      title: a.title_english || a.title,
      episodes: a.episodes || null,
      year: (a.year || (a.aired && a.aired.prop && a.aired.prop.from && a.aired.prop.from.year)) || 'N/A',
      poster: a.images && a.images.jpg && a.images.jpg.large_image_url,
      status: a.status || '',
    };
    cacheSet(key, out);
    res.json(out);
  } catch (err) {
    console.error(`Jikan /anime/${req.params.id} failed:`, err.message);
    res.json({ id: req.params.id, title: 'Unknown', episodes: null });
  }
});

// ── TMDB tv routes
app.get('/api/tv/:id', async (req, res) => {
  try {
    const response = await axios.get(`${TMDB_BASE_URL}/tv/${req.params.id}?api_key=${TMDB_API_KEY}`);
    res.json({ seasons: response.data.seasons.filter(s => s.season_number > 0) });
  } catch { res.status(500).json({ error: 'Failed' }); }
});

app.get('/api/tv/:id/season/:seasonNum', async (req, res) => {
  try {
    const response = await axios.get(`${TMDB_BASE_URL}/tv/${req.params.id}/season/${req.params.seasonNum}?api_key=${TMDB_API_KEY}`);
    res.json({ episodes: response.data.episodes });
  } catch { res.status(500).json({ error: 'Failed' }); }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
