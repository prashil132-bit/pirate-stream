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

// ── hide cards that aren't on vidora
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
      const { results } = await res.json();
      for (const c of cards) {
        if (c.dataset.type !== type) continue;
        const ok = results[c.dataset.tmdb];
        if (ok === false) {
          c.style.display = 'none';
        }
      }
    } catch (err) {
      console.warn('Availability check failed:', err.message);
    }
  }
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
          ${row.items.map(m => `
            <div class="card" data-tmdb="${m.id}" data-type="${m.media_type}" onclick="playMedia(${m.id}, '${m.title.replace(/'/g, "\\'")}', '${m.media_type}')">
              <img src="${m.poster}" class="card-img" loading="lazy">
              <div class="card-info">
                <div class="card-title">${m.title}</div>
                <div class="card-year">${m.year} • ${m.media_type === 'tv' ? 'Series' : 'Film'}</div>
              </div>
            </div>
          `).join('')}
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
    main.innerHTML = `<div class="search-grid" style="padding-top: 8rem;">${movies.map(m => `
      <div class="card" data-tmdb="${m.id}" data-type="${m.media_type}" onclick="playMedia(${m.id}, '${m.title.replace(/'/g, "\\'")}', '${m.media_type}')">
        <img src="${m.poster}" class="card-img" loading="lazy">
        <div class="card-info"><div class="card-title">${m.title}</div><div class="card-year">${m.year}</div></div>
      </div>`).join('')}</div>`;
    filterAvailableCards(main);
  } catch (err) { main.innerHTML = `<div style="padding: 8rem 4rem; text-align: center; color: red;">Connection lost.</div>`; }
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
    main.innerHTML = `<div class="search-grid" style="padding-top: 8rem;">${series.map(m => `
      <div class="card" data-tmdb="${m.id}" data-type="${m.media_type}" onclick="playMedia(${m.id}, '${m.title.replace(/'/g, "\\'")}', '${m.media_type}')">
        <img src="${m.poster}" class="card-img" loading="lazy">
        <div class="card-info"><div class="card-title">${m.title}</div><div class="card-year">${m.year}</div></div>
      </div>`).join('')}</div>`;
    filterAvailableCards(main);
  } catch (err) { main.innerHTML = `<div style="padding: 8rem 4rem; text-align: center; color: red;">Connection lost.</div>`; }
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
    const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
    const movies = await res.json();
    if (!movies.length) {
      main.innerHTML = `<div style="padding: 8rem 4rem; text-align: center;">No results found.</div>`;
      return;
    }
    main.innerHTML = `<div class="search-grid" style="padding-top: 8rem;">${movies.map(m => `
      <div class="card" data-tmdb="${m.id}" data-type="${m.media_type}" onclick="playMedia(${m.id}, '${m.title.replace(/'/g, "\\'")}', '${m.media_type}')">
        <img src="${m.poster}" class="card-img" loading="lazy">
        <div class="card-info"><div class="card-title">${m.title}</div><div class="card-year">${m.year}</div></div>
      </div>`).join('')}</div>`;
    filterAvailableCards(main);
  } catch (err) { main.innerHTML = `<div style="padding: 8rem 4rem; text-align: center; color: red;">Connection lost.</div>`; }
}

function playMedia(tmdbId, title, type) {
  if (type === 'tv') {
    openEpisodeSelector(tmdbId, title);
  } else {
    startPlayback(tmdbId, title, 'movie', null, null);
  }
}

async function openEpisodeSelector(tmdbId, title) {
  document.getElementById('episode-selector').style.display = 'flex';
  document.getElementById('modal-title').innerText = title;
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
    grid.innerHTML = data.episodes.map(ep => `
      <button class="episode-btn" onclick="startPlayback(${tmdbId}, '${currentModalMedia.title.replace(/'/g, "\\'")}', 'tv', ${seasonNum}, ${ep.episode_number})">
        <span style="font-size: 0.75rem; color: var(--accent); display: block; margin-bottom: 0.2rem;">EP ${ep.episode_number}</span>
        ${ep.name || 'Episode ' + ep.episode_number}
      </button>
    `).join('');
  } catch (err) {
    grid.innerHTML = '<p>Error loading episodes.</p>';
  }
}

function closeEpisodeSelector() {
  document.getElementById('episode-selector').style.display = 'none';
}

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
