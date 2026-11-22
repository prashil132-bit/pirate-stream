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
        if (ok === false) c.style.display = 'none';
      }
    } catch (err) {
      console.warn('Availability check failed:', err.message);
    }
  }
}

function cardHTML(m) {
  const yearLabel = m.media_type === 'tv' ? 'Series' : m.media_type === 'anime' ? 'Anime' : 'Film';
  return `
    <div class="card" data-tmdb="${m.id}" data-type="${m.media_type}" onclick="playMedia(${m.id}, '${m.title.replace(/'/g, "\\'")}', '${m.media_type}')">
      <img src="${m.poster}" class="card-img" loading="lazy">
      <div class="card-info">
        <div class="card-title">${m.title}</div>
        <div class="card-year">${m.year} • ${yearLabel}</div>
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
    main.innerHTML = `<div class="search-grid" style="padding-top: 8rem;">${series.map(cardHTML).join('')}</div>`;
    filterAvailableCards(main);
  } catch (err) { main.innerHTML = `<div style="padding: 8rem 4rem; text-align: center; color: red;">Connection lost.</div>`; }
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
    const anime = await res.json();
    main.innerHTML = `<div class="search-grid" style="padding-top: 8rem;">${anime.map(cardHTML).join('')}</div>`;
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
    const [movieRes, animeRes] = await Promise.allSettled([
      fetch(`/api/search?q=${encodeURIComponent(query)}`).then(r => r.json()),
      fetch(`/api/anime/search?q=${encodeURIComponent(query)}`).then(r => r.json()),
    ]);

    const movies = movieRes.status === 'fulfilled' ? movieRes.value : [];
    const anime = animeRes.status === 'fulfilled' ? animeRes.value : [];
    const all = [...movies, ...anime];

    if (!all.length) {
      main.innerHTML = `<div style="padding: 8rem 4rem; text-align: center;">No results found.</div>`;
      return;
    }
    main.innerHTML = `<div class="search-grid" style="padding-top: 8rem;">${all.map(cardHTML).join('')}</div>`;
    filterAvailableCards(main);
  } catch (err) { main.innerHTML = `<div style="padding: 8rem 4rem; text-align: center; color: red;">Connection lost.</div>`; }
}

function playMedia(id, title, type) {
  if (type === 'tv') openEpisodeSelector(id, title);
  else if (type === '
