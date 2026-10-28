'use strict';

/* ==========================================================
   Task 4 – Weather Dashboard
   Uses the free Open-Meteo REST API (no API key):
     1. Geocoding API  : city name  -> latitude / longitude
     2. Forecast API   : coordinates -> current + daily weather
   ========================================================== */

const GEOCODE_URL = 'https://geocoding-api.open-meteo.com/v1/search';
const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
const REQUEST_TIMEOUT_MS = 10000;
const AUTO_REFRESH_MS = 10 * 60 * 1000;
const MAX_RECENT = 5;

const STORAGE = { unit: 'task4.unit', place: 'task4.place', recent: 'task4.recent' };

// WMO weather codes -> [description, day icon, night icon]
const WEATHER_CODES = {
  0: ['Clear sky', '☀️', '🌙'],
  1: ['Mostly clear', '🌤️', '🌙'],
  2: ['Partly cloudy', '⛅', '☁️'],
  3: ['Overcast', '☁️', '☁️'],
  45: ['Fog', '🌫️', '🌫️'],
  48: ['Freezing fog', '🌫️', '🌫️'],
  51: ['Light drizzle', '🌦️', '🌧️'],
  53: ['Drizzle', '🌦️', '🌧️'],
  55: ['Heavy drizzle', '🌧️', '🌧️'],
  56: ['Freezing drizzle', '🌧️', '🌧️'],
  57: ['Heavy freezing drizzle', '🌧️', '🌧️'],
  61: ['Light rain', '🌦️', '🌧️'],
  63: ['Rain', '🌧️', '🌧️'],
  65: ['Heavy rain', '🌧️', '🌧️'],
  66: ['Freezing rain', '🌧️', '🌧️'],
  67: ['Heavy freezing rain', '🌧️', '🌧️'],
  71: ['Light snow', '🌨️', '🌨️'],
  73: ['Snow', '❄️', '❄️'],
  75: ['Heavy snow', '❄️', '❄️'],
  77: ['Snow grains', '❄️', '❄️'],
  80: ['Light showers', '🌦️', '🌧️'],
  81: ['Showers', '🌧️', '🌧️'],
  82: ['Violent showers', '⛈️', '⛈️'],
  85: ['Snow showers', '🌨️', '🌨️'],
  86: ['Heavy snow showers', '🌨️', '🌨️'],
  95: ['Thunderstorm', '⛈️', '⛈️'],
  96: ['Thunderstorm with hail', '⛈️', '⛈️'],
  99: ['Severe thunderstorm with hail', '⛈️', '⛈️'],
};

const state = {
  unit: 'celsius',
  place: null,       // { name, region, country, latitude, longitude }
  requestId: 0,      // used to ignore out-of-date responses
};

/* ---------- DOM ---------- */
const $ = (id) => document.getElementById(id);
const form = $('search-form');
const cityInput = $('city');
const searchBtn = form.querySelector('button[type="submit"]');
const locateBtn = $('locate');
const statusEl = $('status');
const dashboard = $('dashboard');
const forecastEl = $('forecast');
const recentBox = $('recent');
const recentList = $('recent-list');
const matchesBox = $('matches');
const matchesList = $('matches-list');
const unitsEl = $('units');

/* ---------- Errors ---------- */
class AppError extends Error {}

/* ---------- API layer (fetch + async/await) ---------- */
async function fetchJSON(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      // fetch() only rejects on network failure, so HTTP errors are checked by hand.
      throw new AppError(
        response.status === 429
          ? 'Too many requests. Wait a moment and try again.'
          : `The weather service returned an error (HTTP ${response.status}).`
      );
    }
    return await response.json();
  } catch (err) {
    if (err instanceof AppError) throw err;
    if (err.name === 'AbortError') throw new AppError('The request took too long. Check your connection and try again.');
    if (err instanceof TypeError) throw new AppError('Network error. Check your internet connection and try again.');
    throw new AppError('The weather service sent a response that could not be read.');
  } finally {
    clearTimeout(timer);
  }
}

async function searchCity(query) {
  const params = new URLSearchParams({ name: query, count: '5', language: 'en', format: 'json' });
  const data = await fetchJSON(`${GEOCODE_URL}?${params}`);
  if (!Array.isArray(data.results) || data.results.length === 0) {
    throw new AppError(`No city found for “${query}”. Check the spelling or try a nearby city.`);
  }
  return data.results.map((r) => ({
    name: r.name,
    region: r.admin1 || '',
    country: r.country || '',
    latitude: r.latitude,
    longitude: r.longitude,
  }));
}

async function fetchWeather(place, unit) {
  const params = new URLSearchParams({
    latitude: place.latitude,
    longitude: place.longitude,
    current: 'temperature_2m,relative_humidity_2m,apparent_temperature,is_day,weather_code,surface_pressure,wind_speed_10m,wind_direction_10m',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max',
    temperature_unit: unit,
    wind_speed_unit: 'kmh',
    timezone: 'auto',
    forecast_days: '5',
  });
  return parseWeather(await fetchJSON(`${FORECAST_URL}?${params}`));
}

/* Turn the nested API response into a flat model the UI can use. */
function parseWeather(data) {
  const c = data && data.current;
  const u = data && data.current_units;
  const d = data && data.daily;
  if (!c || !u || !d || !Array.isArray(d.time)) {
    throw new AppError('The weather service sent incomplete data. Try again shortly.');
  }
  return {
    current: {
      temp: c.temperature_2m,
      feelsLike: c.apparent_temperature,
      humidity: c.relative_humidity_2m,
      windSpeed: c.wind_speed_10m,
      windDirection: c.wind_direction_10m,
      pressure: c.surface_pressure,
      code: c.weather_code,
      isDay: c.is_day === 1,
    },
    units: {
      temp: u.temperature_2m,
      humidity: u.relative_humidity_2m,
      wind: u.wind_speed_10m,
      pressure: u.surface_pressure,
    },
    daily: d.time.map((date, i) => ({
      date,
      code: d.weather_code[i],
      max: d.temperature_2m_max[i],
      min: d.temperature_2m_min[i],
      rainChance: d.precipitation_probability_max ? d.precipitation_probability_max[i] : null,
    })),
  };
}

/* ---------- Formatting helpers ---------- */
const round = (n) => (typeof n === 'number' ? Math.round(n) : '–');

function describe(code, isDay = true) {
  const entry = WEATHER_CODES[code] || ['Unknown conditions', '🌡️', '🌡️'];
  return { label: entry[0], icon: isDay ? entry[1] : entry[2] };
}

function compass(degrees) {
  if (typeof degrees !== 'number') return '';
  return ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(degrees / 45) % 8];
}

function dayName(isoDate, index) {
  if (index === 0) return 'Today';
  return new Date(`${isoDate}T00:00:00`).toLocaleDateString(undefined, { weekday: 'short' });
}

function placeLabel(place) {
  return [place.region, place.country].filter(Boolean).join(', ');
}

/* ---------- Rendering ---------- */
function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle('error', isError);
  statusEl.setAttribute('role', isError ? 'alert' : 'status');
}

function setLoading(isLoading) {
  searchBtn.disabled = isLoading;
  dashboard.classList.toggle('loading', isLoading);
  if (isLoading) setStatus('Loading weather…');
}

function renderWeather(place, weather) {
  const { current, units, daily } = weather;
  const { label, icon } = describe(current.code, current.isDay);

  $('place').textContent = place.name;
  $('place-sub').textContent = placeLabel(place);
  $('icon').textContent = icon;
  $('condition').textContent = label;
  $('temp').textContent = round(current.temp);
  $('temp-unit').textContent = units.temp;
  $('humidity').textContent = `${round(current.humidity)}${units.humidity}`;
  $('wind').textContent = `${round(current.windSpeed)} ${units.wind} ${compass(current.windDirection)}`.trim();
  $('feels').textContent = `${round(current.feelsLike)}${units.temp}`;
  $('pressure').textContent = `${round(current.pressure)} ${units.pressure}`;
  $('updated').textContent = `Updated ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;

  const items = daily.map((day, i) => {
    const info = describe(day.code);
    const li = document.createElement('li');
    const make = (cls, text) => {
      const div = document.createElement('div');
      div.className = cls;
      div.textContent = text;
      return div;
    };
    const temps = make('f-temps', `${round(day.max)}° `);
    const low = document.createElement('span');
    low.className = 'f-low';
    low.textContent = `${round(day.min)}°`;
    temps.append(low);

    li.append(make('f-day', dayName(day.date, i)), make('f-icon', info.icon), temps);
    if (typeof day.rainChance === 'number') li.append(make('f-rain', `${day.rainChance}% rain`));
    li.title = info.label;
    return li;
  });
  forecastEl.replaceChildren(...items);

  dashboard.hidden = false;
  setStatus('');
}

function renderChips(container, places, onPick) {
  container.replaceChildren(
    ...places.map((place) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'chip';
      btn.textContent = place.region ? `${place.name}, ${place.region}` : place.name;
      btn.addEventListener('click', () => onPick(place));
      return btn;
    })
  );
}

/* ---------- Persistence ---------- */
function readStorage(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch (err) {
    return fallback;
  }
}

function writeStorage(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch (err) { /* storage unavailable: ignore */ }
}

function rememberPlace(place) {
  writeStorage(STORAGE.place, place);
  if (place.name === 'Your location') return;
  const recent = readStorage(STORAGE.recent, []).filter(
    (p) => !(p.name === place.name && p.region === place.region)
  );
  recent.unshift(place);
  writeStorage(STORAGE.recent, recent.slice(0, MAX_RECENT));
  renderRecent();
}

function renderRecent() {
  const recent = readStorage(STORAGE.recent, []);
  recentBox.hidden = recent.length === 0;
  renderChips(recentList, recent, (place) => loadPlace(place));
}

/* ---------- Controllers ---------- */
async function loadPlace(place, { silent = false } = {}) {
  const id = ++state.requestId;
  state.place = place;
  if (!silent) setLoading(true);
  try {
    const weather = await fetchWeather(place, state.unit);
    if (id !== state.requestId) return;       // a newer request has replaced this one
    renderWeather(place, weather);
    rememberPlace(place);
  } catch (err) {
    if (id !== state.requestId) return;
    setStatus(err instanceof AppError ? err.message : 'Something went wrong. Please try again.', true);
    if (!silent) dashboard.hidden = true;
  } finally {
    if (id === state.requestId) setLoading(false);
    if (id === state.requestId && statusEl.classList.contains('error') === false && !silent) setStatus('');
  }
}

async function handleSearch(query) {
  matchesBox.hidden = true;
  const id = ++state.requestId;
  setLoading(true);
  try {
    const places = await searchCity(query);
    if (id !== state.requestId) return;
    if (places.length > 1) {
      renderChips(matchesList, places.slice(1), (place) => { matchesBox.hidden = true; loadPlace(place); });
      matchesBox.hidden = false;
    }
    await loadPlace(places[0]);
  } catch (err) {
    if (id !== state.requestId) return;
    dashboard.hidden = true;
    setStatus(err instanceof AppError ? err.message : 'Something went wrong. Please try again.', true);
    setLoading(false);
  }
}

function useMyLocation() {
  if (!('geolocation' in navigator)) {
    setStatus('Your browser does not support location. Search by city instead.', true);
    return;
  }
  setStatus('Finding your location…');
  navigator.geolocation.getCurrentPosition(
    ({ coords }) => {
      matchesBox.hidden = true;
      loadPlace({ name: 'Your location', region: '', country: '', latitude: coords.latitude, longitude: coords.longitude });
    },
    (err) => {
      setStatus(
        err.code === err.PERMISSION_DENIED
          ? 'Location access was blocked. Allow it in your browser settings or search by city.'
          : 'Could not get your location. Search by city instead.',
        true
      );
    },
    { timeout: 10000 }
  );
}

/* ---------- Events ---------- */
form.addEventListener('submit', (event) => {
  event.preventDefault();
  const query = cityInput.value.trim();
  if (!query) {
    setStatus('Enter a city name to search.', true);
    return;
  }
  handleSearch(query);
});

locateBtn.addEventListener('click', useMyLocation);

$('refresh').addEventListener('click', () => state.place && loadPlace(state.place));

unitsEl.addEventListener('click', (event) => {
  const btn = event.target.closest('[data-unit]');
  if (!btn || btn.dataset.unit === state.unit) return;
  state.unit = btn.dataset.unit;
  writeStorage(STORAGE.unit, state.unit);
  syncUnitButtons();
  if (state.place) loadPlace(state.place);
});

function syncUnitButtons() {
  unitsEl.querySelectorAll('[data-unit]').forEach((b) => {
    b.setAttribute('aria-pressed', String(b.dataset.unit === state.unit));
  });
}

// Keep the numbers fresh while the tab is open.
setInterval(() => {
  if (state.place && !document.hidden) loadPlace(state.place, { silent: true });
}, AUTO_REFRESH_MS);

/* ---------- Init ---------- */
(function init() {
  const unit = readStorage(STORAGE.unit, 'celsius');
  state.unit = unit === 'fahrenheit' ? 'fahrenheit' : 'celsius';
  syncUnitButtons();
  renderRecent();

  const saved = readStorage(STORAGE.place, null);
  if (saved && typeof saved.latitude === 'number' && typeof saved.longitude === 'number') {
    loadPlace(saved);
  } else {
    setStatus('Search for a city to see its current weather.');
  }
})();
