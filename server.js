const express = require('express');
const axios = require('axios');
const path = require('path');
const cookieParser = require('cookie-parser');

const app = express();
const PORT = process.env.PORT || 3000;

const TMDB_API_KEY = '2d09e0079a61e4b836ed9bd471ee73ed';
const TMDB_BASE_URL = 'https://api.themoviedb.org/3';

app.use(express.json());
app.use(cookieParser());

// Auth Middleware
const requireAuth = (req, res, next) => {
  if (req.cookies.archive_auth === 'true') {
    next();
  } else {
    res.redirect('/login.html');
  }
};

// Serve static files, but don't auto-serve index.html
app.use(express.static(path.join(__dirname, 'public'), { index: false }));

// Protect the main page
app.get('/', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});
app.get('/index.html', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Login Endpoint
app.post('/api/auth', (req, res) => {
  const { username, password } = req.body;
  if (username === 'prashil' && password === 'admin0056') {
    res.cookie('archive_auth', 'true', { maxAge: 86400000, httpOnly: true });
    res.json({ success: true });
  } else {
    res.status(401).json({ error: 'Invalid credentials' });
  }
});

// --- API ROUTES ---
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

app.get('/api/home', async (req, res) => {
  try {
    const results = await Promise.allSettled([
      axios.get(`${TMDB_BASE_URL}/trending/all/week?api_key=${TMDB_API_KEY}`),
      axios.get(`${TMDB_BASE_URL}/discover/movie?api_key=${TMDB_API_KEY}&with_genres=28&sort_by=popularity.desc`),
      axios.get(`${TMDB_BASE_URL}/discover/tv?api_key=${TMDB_API_KEY}&sort_by=popularity.desc`),
      axios.get(`${TMDB_BASE_URL}/discover/movie?api_key=${TMDB_API_KEY}&with_original_language=hi&sort_by=popularity.desc`)
    ]);

    const trending = results[0].status === 'fulfilled' ? results[0].value.data.results : [];
    const action = results[1].status === 'fulfilled' ? results[1].value.data.results : [];
    const series = results[2].status === 'fulfilled' ? results[2].value.data.results : [];
    const bollywood = results[3].status === 'fulfilled' ? results[3].value.data.results : [];

    const heroPool = trending.filter(m => m.backdrop_path);
    const hero = heroPool.length > 0 ? heroPool[Math.floor(Math.random() * Math.min(10, heroPool.length))] : trending[0];

    res.json({
      hero: hero ? formatMedia([hero])[0] : null,
      rows: [
        { title: 'Trending Now', items: formatMedia(trending) },
        { title: 'Blockbusters (Hollywood)', items: formatMedia(action) },
        { title: 'Popular Series', items: formatMedia(series) },
        { title: 'Bollywood Hits', items: formatMedia(bollywood) }
      ]
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch home data' });
  }
});

app.get('/api/movies', async (req, res) => {
  try {
    const response = await axios.get(`${TMDB_BASE_URL}/discover/movie?api_key=${TMDB_API_KEY}&sort_by=popularity.desc`);
    res.json(formatMedia(response.data.results));
  } catch (error) { res.status(500).json({ error: 'Failed' }); }
});

app.get('/api/series', async (req, res) => {
  try {
    const response = await axios.get(`${TMDB_BASE_URL}/discover/tv?api_key=${TMDB_API_KEY}&sort_by=popularity.desc`);
    res.json(formatMedia(response.data.results));
  } catch (error) { res.status(500).json({ error: 'Failed' }); }
});

app.get('/api/search', async (req, res) => {
  const query = req.query.q;
  if (!query) return res.json([]);
  try {
    const response = await axios.get(`${TMDB_BASE_URL}/search/multi`, {
      params: { api_key: TMDB_API_KEY, query: query, include_adult: false }
    });
    const results = response.data.results.filter(m => m.media_type !== 'person');
    res.json(formatMedia(results));
  } catch (error) { res.status(500).json({ error: 'Failed' }); }
});

app.get('/api/tv/:id', async (req, res) => {
  try {
    const response = await axios.get(`${TMDB_BASE_URL}/tv/${req.params.id}?api_key=${TMDB_API_KEY}`);
    res.json({ seasons: response.data.seasons.filter(s => s.season_number > 0) });
  } catch (error) { res.status(500).json({ error: 'Failed' }); }
});

app.get('/api/tv/:id/season/:seasonNum', async (req, res) => {
  try {
    const response = await axios.get(`${TMDB_BASE_URL}/tv/${req.params.id}/season/${req.params.seasonNum}?api_key=${TMDB_API_KEY}`);
    res.json({ episodes: response.data.episodes });
  } catch (error) { res.status(500).json({ error: 'Failed' }); }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
