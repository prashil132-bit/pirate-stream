// Intercept and block popups triggered by the iframe
window.open = function() {
  console.warn("Popup blocked by Archive security.");
  return null; 
};

window.addEventListener('beforeunload', (event) => {
  if (document.getElementById('player-container').style.display === 'block') {
    event.preventDefault();
    event.returnValue = '';
  }
});

let currentHeroMovie = null;
let currentModalMedia = null;
let controlsTimeout;
let currentAnimeAudio = 'sub';

function confirmAdult() {
  if (sessionStorage.getItem('adult_confirmed') === '1') return true;
  const ok = window.confirm('This section contains explicit adult content (18+). Continue?');
  if (ok) sessionStorage.setItem('adult_confirmed', '1');
  return ok;
}

async function filterAvailableCards(containerEl) {
  const cards = Array.from(containerEl.querySelectorAll('.card[data-tmdb]'));
  if (!cards.length) return;

  const byType = {};
  for (const c of cards) {
    const t = c.dataset.type;
    if (!byType[t]) byType[t] = [];
    byType[t].push(c.dataset.tmdb);
  }

  for (const type of Object.keys(byType)) {
    const ids = byType[type];
    try {
      const res = await fetch(`/api/check-vidora/batch?type=${type}&ids=${ids.join(',')}`);
      if (!res.ok) continue;
      const { results } = await res.json();
      for (const c of cards) {
        if (c.dataset.type !== type) continue;
        const ok = results[c.dataset.tmdb];
        if (ok === false) c.style.display = 'none';
      }
    } catch (err) {
      console.warn('Availability check failed:', err.message);
    }
  }
}

function cardHTML(m) {
  const label = m.media_type === 'tv' ? 'Series' : m.media_type === 'anime' ? 'Anime' : 'Film';
  const safeTitle = String(m.title).replace(/'/g, "\\'");
  return `
    <div class="card" data-tmdb="${m.id}" data-type="${m.media_type}" onclick="playMedia(${m.id}, '${safeTitle}', '${m.media_type}')">
      <img src="${m.poster}" class="card-img" loading="lazy">
      <div class="card-info">
        <div class="card-title">${m.title}</div>
        <div class="card-year">${m.year} • ${label}</div>
      </div>
    </div>
  `;
}

async function loadHome(event) {
  if (event) event.preventDefault();
  document.getElementById('hero-section').style.display = 'flex';
  document.getElementById('searchInput').value = '';
  window.scrollTo({ top: 0, behavior: 'smooth' });
  const main = document.getElementById('main-content');
  
  try {
    const res = await fetch('/api/home');
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error || 'API failed');

    currentHeroMovie = data.hero;
    if (currentHeroMovie) {
      document.getElementById('hero-bg').style.backgroundImage = `url(${currentHeroMovie.backdrop})`;
      document.getElementById('hero-title').innerText = currentHeroMovie.title;
      document.getElementById('hero-year').innerText = currentHeroMovie.year;
      document.getElementById('hero-play').style.display = 'flex';
      document.getElementById('hero-play').onclick = () => playMedia(currentHeroMovie.id, currentHeroMovie.title, currentHeroMovie.media_type);
    }

    main.innerHTML = '';
    data.rows.forEach((row, index) => {
      if (!row.items || row.items.length === 0) return;
      const rowEl = document.createElement('section');
      rowEl.className = 'row';
      rowEl.style.opacity = '0';
      rowEl.style.transform = 'translateY(20px)';
      rowEl.style.transition = 'opacity 0.6s ease, transform 0.6s ease';
      rowEl.innerHTML = `
        <h2 class="row-title">${row.title}</h2>
        <div class="row-scroll">
          ${row.items.map(cardHTML).join('')}
        </div>
      `;
      main.appendChild(rowEl);
      setTimeout(() => { rowEl.style.opacity = '1'; rowEl.style.transform = 'translateY(0)'; }, index * 100);
      filterAvailableCards(rowEl);
    });
  } catch (err) {
    main.innerHTML = `<div style="padding: 8rem 4rem; text-align: center;">Failed to load. ${err.message}</div>`;
  }
}

async function loadMovies(event) {
  if (event) event.preventDefault();
  document.getElementById('hero-section').style.display = 'none';
  document.getElementById('searchInput').value = '';
  window.scrollTo({ top: 0, behavior: 'smooth' });
  const main = document.getElementById('main-content');
  main.innerHTML = `<div style="padding: 8rem 4rem; text-align: center;">Loading films...</div>`;

  try {
    const res = await fetch('/api/movies');
    const movies = await res.json();
    main.innerHTML = `<div class="search-grid" style="padding-top: 8rem;">${movies.map(cardHTML).join('')}</div>`;
    filterAvailableCards(main);
  } catch (err) {
    main.innerHTML = `<div style="padding: 8rem 4rem; text-align: center; color: #ff6666;">Connection lost: ${err.message}</div>`;
  }
}

async function loadSeries(event) {
  if (event) event.preventDefault();
  document.getElementById('hero-section').style.display = 'none';
  document.getElementById('searchInput').value = '';
  window.scrollTo({ top: 0, behavior: 'smooth' });
  const main = document.getElementById('main-content');
  main.innerHTML = `<div style="padding: 8rem 4rem; text-align: center;">Loading series...</div>`;

  try {
    const res = await fetch('/api/series');
    const series = await res.json();
    main.innerHTML = `<div class="search-grid" style="padding-top: 8rem;">${series.map(cardHTML).join('')}</div>`;
    filterAvailableCards(main);
  } catch (err) {
    main.innerHTML = `<div style="padding: 8rem 4rem; text-align: center; color: #ff6666;">Connection lost: ${err.message}</div>`;
  }
}

async function loadAnime(event) {
  if (event) event.preventDefault();
  document.getElementById('hero-section').style.display = 'none';
  document.getElementById('searchInput').value = '';
  window.scrollTo({ top: 0, behavior: 'smooth' });
  const main = document.getElementById('main-content');
  main.innerHTML = `<div style="padding: 8rem 4rem; text-align: center;">Loading anime...</div>`;

  try {
    const res = await fetch('/api/anime');
    if (!res.ok) throw new Error(`server returned ${res.status}`);
    const anime = await res.json();
    if (!Array.isArray(anime)) throw new Error('unexpected response shape');
    if (anime.length === 0) {
      main.innerHTML = `<div style="padding: 8rem 4rem; text-align: center;">
        Anime list is empty right now.
        <button onclick="loadAnime(event)" style="margin-left:1rem;background:var(--accent);color:#fff;border:none;padding:0.5rem 1rem;border-radius:8px;cursor:pointer;">Retry</button>
      </div>`;
      return;
    }
    main.innerHTML = `<div class="search-grid" style="padding-top: 8rem;">${anime.map(cardHTML).join('')}</div>`;
    filterAvailableCards(main);
  } catch (err) {
    main.innerHTML = `<div style="padding: 8rem 4rem; text-align: center; color: #ff6666;">Anime failed: ${err.message}</div>`;
  }
}

async function loadHentai(event) {
  if (event) event.preventDefault();
  if (!confirmAdult()) return;
  document.getElementById('hero-section').style.display = 'none';
  document.getElementById('searchInput').value = '';
  window.scrollTo({ top: 0, behavior: 'smooth' });
  const main = document.getElementById('main-content');
  main.innerHTML = `
    <div style="padding-top: 6rem;">
      <div class="inline-search">
        <input type="text" id="hentaiSearchInput" placeholder="Search hentai..." onkeyup="if(event.key==='Enter') searchHentai(event)">
        <button onclick="searchHentai(event)">↗</button>
      </div>
      <div style="text-align: center; color: var(--text-muted); font-size: 0.85rem; margin-bottom: 1.5rem;">18+ only</div>
      <div id="hentai-grid" class="search-grid" style="padding-top: 0;">Loading...</div>
    </div>
  `;

  try {
    const res = await fetch('/api/hentai');
    if (!res.ok) throw new Error(`server returned ${res.status}`);
    const anime = await res.json();
    const grid = document.getElementById('hentai-grid');
    if (!Array.isArray(anime) || anime.length === 0) {
      grid.innerHTML = `<div style="text-align:center;width:100%;grid-column:1/-1;">No hentai returned.</div>`;
      return;
    }
    grid.innerHTML = anime.map(cardHTML).join('');
    filterAvailableCards(grid);
  } catch (err) {
    document.getElementById('hentai-grid').innerHTML = `<div style="color:#ff6666;text-align:center;width:100%;grid-column:1/-1;">Failed: ${err.message}</div>`;
  }
}

async function searchHentai(event) {
  if (event) event.preventDefault();
  const input = document.getElementById('hentaiSearchInput');
  const q = (input?.value || '').trim();
  const grid = document.getElementById('hentai-grid');
  if (!q) {
    grid.innerHTML = 'Type something to search.';
    return;
  }
  grid.innerHTML = 'Searching...';
  try {
    const res = await fetch(`/api/hentai/search?q=${encodeURIComponent(q)}`);
    const anime = await res.json();
    if (!Array.isArray(anime) || anime.length === 0) {
      grid.innerHTML = `<div style="text-align:center;width:100%;grid-column:1/-1;">No results for "${q}".</div>`;
      return;
    }
    grid.innerHTML = anime.map(cardHTML).join('');
    filterAvailableCards(grid);
  } catch (err) {
    grid.innerHTML = `<div style="color:#ff6666;text-align:center;width:100%;grid-column:1/-1;">Search failed: ${err.message}</div>`;
  }
}

async function triggerSearch(event) {
  if (event) event.preventDefault();
  const query = document.getElementById('searchInput').value.trim();
  if (!query) return loadHome();
  document.getElementById('hero-section').style.display = 'none';
  window.scrollTo({ top: 0, behavior: 'smooth' });
  const main = document.getElementById('main-content');
  main.innerHTML = `<div style="padding: 8rem 4rem; text-align: center;">Searching...</div>`;

  try {
    const [movieRes, animeRes] = await Promise.allSettled([
      fetch(`/api/search?q=${encodeURIComponent(query)}`).then(r => r.json()),
      fetch(`/api/anime/search?q=${encodeURIComponent(query)}`).then(r => r.json()),
    ]);

    const movies = movieRes.status === 'fulfilled' && Array.isArray(movieRes.value) ? movieRes.value : [];
    const anime = animeRes.status === 'fulfilled' && Array.isArray(animeRes.value) ? animeRes.value : [];
    const all = [...movies, ...anime];

    if (!all.length) {
      main.innerHTML = `<div style="padding: 8rem 4rem; text-align: center;">No results found.</div>`;
      return;
    }
    main.innerHTML = `<div class="search-grid" style="padding-top: 8rem;">${all.map(cardHTML).join('')}</div>`;
    filterAvailableCards(main);
  } catch (err) {
    main.innerHTML = `<div style="padding: 8rem 4rem; text-align: center; color: #ff6666;">Search failed: ${err.message}</div>`;
  }
}

function playMedia(id, title, type) {
  if (type === 'tv') {
    openEpisodeSelector(id, title);
  } else if (type === 'anime') {
    openAnimeEpisodeSelector(id, title);
  } else {
    startPlayback(id, title, 'movie', null, null);
  }
}

async function openEpisodeSelector(tmdbId, title) {
  document.getElementById('episode-selector').style.display = 'flex';
  document.getElementById('modal-title').innerText = title;
  document.getElementById('seasonRow').style.display = 'flex';
  document.getElementById('audioToggleRow').style.display = 'none';
  document.getElementById('seasonDropdown').innerHTML = '<option>Loading...</option>';
  document.getElementById('episode-grid').innerHTML = '';
  currentModalMedia = { tmdbId, title };

  try {
    const res = await fetch(`/api/tv/${tmdbId}`);
    const data = await res.json();
    const dropdown = document.getElementById('seasonDropdown');
    dropdown.innerHTML = data.seasons.map(s => `<option value="${s.season_number}">Season ${s.season_number}</option>`).join('');
    loadEpisodes();
  } catch (err) {
    document.getElementById('episode-grid').innerHTML = '<p>Error loading seasons.</p>';
  }
}

async function loadEpisodes() {
  const { tmdbId } = currentModalMedia;
  const seasonNum = document.getElementById('seasonDropdown').value;
  const grid = document.getElementById('episode-grid');
  grid.innerHTML = '<p>Loading episodes...</p>';
  
  try {
    const res = await fetch(`/api/tv/${tmdbId}/season/${seasonNum}`);
    const data = await res.json();
    const safeTitle = String(currentModalMedia.title).replace(/'/g, "\\'");
    grid.innerHTML = data.episodes.map(ep => `
      <button class="episode-btn" onclick="startPlayback(${tmdbId}, '${safeTitle}', 'tv', ${seasonNum}, ${ep.episode_number})">
        <span style="font-size: 0.75rem; color: var(--accent); display: block; margin-bottom: 0.2rem;">EP ${ep.episode_number}</span>
        ${ep.name || 'Episode ' + ep.episode_number}
      </button>
    `).join('');
  } catch (err) {
    grid.innerHTML = '<p>Error loading episodes.</p>';
  }
}

async function openAnimeEpisodeSelector(malId, title) {
  document.getElementById('episode-selector').style.display = 'flex';
  document.getElementById('modal-title').innerText = title;
  document.getElementById('seasonRow').style.display = 'none';
  document.getElementById('audioToggleRow').style.display = 'flex';
  document.getElementById('episode-grid').innerHTML = '<p style="padding:2rem;">Loading episodes...</p>';
  currentModalMedia = { malId, title, type: 'anime' };
  currentAnimeAudio = 'sub';
  document.querySelectorAll('.audio-pill').forEach(p => {
    p.classList.toggle('active', p.dataset.audio === 'sub');
  });

  try {
    const res = await fetch(`/api/anime/${malId}`);
    const data = await res.json();
    const count = data.episodes || 100;
    renderAnimeEpisodes(malId, count);
  } catch (err) {
    renderAnimeEpisodes(malId, 100);
  }
}

function renderAnimeEpisodes(malId, count) {
  const grid = document.getElementById('episode-grid');
  let html = '';
  for (let i = 1; i <= count; i++) {
    html += `<button class="episode-btn" onclick="startAnimePlayback(${malId}, ${i})">
      <span style="font-size: 0.75rem; color: var(--accent); display: block; margin-bottom: 0.2rem;">EP ${i}</span>
      Episode ${i}
    </button>`;
  }
  grid.innerHTML = html;
}

function setAnimeAudio(audio) {
  currentAnimeAudio = audio;
  document.querySelectorAll('.audio-pill').forEach(p => {
    p.classList.toggle('active', p.dataset.audio === audio);
  });
}

// ── ANIME PLAYBACK → MEGAPLAY (MAL ids)
function startAnimePlayback(malId, episode) {
  closeEpisodeSelector();
  document.getElementById('player-container').style.display = 'block';
  document.getElementById('player-loader').style.display = 'block';
  showControls();
  const iframe = document.getElementById('videoPlayer');
  iframe.src = `https://megaplay.buzz/stream/mal/${malId}/${episode}/${currentAnimeAudio}`;
}

function closeEpisodeSelector() {
  document.getElementById('episode-selector').style.display = 'none';
}

// ── MOVIE / TV PLAYBACK → VIDORA (TMDB ids)
function startPlayback(tmdbId, title, type, season, episode) {
  closeEpisodeSelector();
  document.getElementById('player-container').style.display = 'block';
  document.getElementById('player-loader').style.display = 'block';
  showControls();

  const iframe = document.getElementById('videoPlayer');
  
  if (type === 'tv') {
    iframe.src = `https://vidora.ac/tv/${tmdbId}/${season}/${episode}`;
  } else {
    iframe.src = `https://vidora.ac/movie/${tmdbId}`;
  }
}

function closePlayer() {
  if (document.fullscreenElement) document.exitFullscreen().catch(err => console.log(err));
  document.getElementById('player-container').style.display = 'none';
  document.getElementById('videoPlayer').src = '';
  document.getElementById('player-loader').style.display = 'none';
}

function toggleFullscreen() {
  const container = document.getElementById('player-container');
  if (!document.fullscreenElement) {
    if (container.requestFullscreen) container.requestFullscreen();
    else if (container.webkitRequestFullscreen) container.webkitRequestFullscreen();
  } else {
    if (document.exitFullscreen) document.exitFullscreen();
  }
}

function showControls() {
  const closeBtn = document.querySelector('.close-btn');
  const fsBtn = document.querySelector('.fullscreen-btn');
  
  if (closeBtn) closeBtn.classList.remove('hidden');
  if (fsBtn) fsBtn.classList.remove('hidden');

  clearTimeout(controlsTimeout);
  controlsTimeout = setTimeout(() => {
    if (closeBtn) closeBtn.classList.add('hidden');
    if (fsBtn) fsBtn.classList.add('hidden');
  }, 3000);
}

document.addEventListener('mousemove', () => {
  if (document.getElementById('player-container').style.display === 'block') {
    showControls();
  }
});

document.addEventListener('touchstart', () => {
  if (document.getElementById('player-container').style.display === 'block') {
    showControls();
  }
});

loadHome();
