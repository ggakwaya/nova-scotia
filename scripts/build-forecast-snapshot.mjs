#!/usr/bin/env node
// Génère forecast-snapshot.json : prévisions ECMWF + normales ERA5 pour chaque
// lieu du voyage. Commité dans le repo et précaché par le service worker, ce
// fichier est ce qui rend la section Vélo consultable sans réseau (campings du
// Cap-Breton, Fundy) et évite au navigateur les appels ERA5 lents qui se font
// rate-limiter (429).
//
// Lieux et dates sont lus depuis index.html : une seule source de vérité.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DAY_START_HOUR = 6;
const DAY_END_HOUR = 21;
const NORMAL_START_YEAR = 2016;
const NORMAL_END_YEAR = 2025;
const NORMAL_WINDOW_DAYS = 3;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function readTripRows() {
  const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
  const re = /data-date="([^"]+)"\s+data-lat="([^"]+)"\s+data-lon="([^"]+)"/g;
  const rows = [];
  let m;
  while ((m = re.exec(html)) !== null) {
    rows.push({ date: m[1], lat: m[2], lon: m[3] });
  }
  if (!rows.length) throw new Error('Aucune ligne data-date/lat/lon trouvée dans index.html');
  return rows;
}

async function fetchJson(url, label) {
  const ATTEMPTS = 5;
  let lastErr;
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    try {
      const res = await fetch(url);
      if (res.ok) return await res.json();
      // 429 = rate limit de l'API gratuite ; 5xx = incident passager. Le reste
      // (400, 404...) ne s'arrangera pas en réessayant.
      if (res.status !== 429 && res.status < 500) {
        const fatal = new Error(`${label} a répondu ${res.status}`);
        fatal.fatal = true;
        throw fatal;
      }
      lastErr = new Error(`${label} a répondu ${res.status}`);
    } catch (err) {
      // fetch() lève sur coupure réseau/DNS, sans code HTTP : ces erreurs-là sont
      // justement celles qu'il faut réessayer, pas laisser filer.
      if (err.fatal) throw err;
      lastErr = err;
    }
    if (attempt < ATTEMPTS - 1) await sleep(4000 * (attempt + 1));
  }
  throw new Error(`${label} : échec après ${ATTEMPTS} tentatives (${lastErr?.message})`);
}

// Ne garde que les dates du voyage et les heures 6-21 : c'est tout ce que l'UI
// affiche, et ça divise la taille du fichier précaché.
function trimHourly(hourly, tripDates) {
  if (!hourly?.time) return null;
  const keep = [];
  hourly.time.forEach((t, i) => {
    const h = Number(t.slice(11, 13));
    if (tripDates.has(t.slice(0, 10)) && h >= DAY_START_HOUR && h <= DAY_END_HOUR) keep.push(i);
  });
  const out = {};
  for (const [key, arr] of Object.entries(hourly)) {
    out[key] = keep.map((i) => arr[i]);
  }
  return out;
}

function trimDaily(daily, tripDates) {
  const keep = daily.time.map((t, i) => (tripDates.has(t) ? i : -1)).filter((i) => i !== -1);
  const out = {};
  for (const [key, arr] of Object.entries(daily)) {
    out[key] = keep.map((i) => arr[i]);
  }
  return out;
}

async function fetchForecast(lat, lon, tripDates) {
  const url =
    `https://api.open-meteo.com/v1/ecmwf?latitude=${lat}&longitude=${lon}` +
    '&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,wind_speed_10m_max,wind_gusts_10m_max,weather_code' +
    '&hourly=temperature_2m,precipitation_probability,precipitation,wind_speed_10m,wind_gusts_10m,weather_code' +
    '&timezone=auto&forecast_days=16';
  const json = await fetchJson(url, `prévision ${lat},${lon}`);
  return { daily: trimDaily(json.daily, tripDates), hourly: trimHourly(json.hourly, tripDates) };
}

function dayWindowKeys(dateStr, pad) {
  const keys = new Set();
  const base = new Date(`${dateStr}T00:00:00Z`);
  for (let o = -pad; o <= pad; o++) {
    const d = new Date(base);
    d.setUTCDate(d.getUTCDate() + o);
    keys.add(`${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`);
  }
  return keys;
}

function computeNormal(daily, allowedKeys) {
  const tmax = [], tmin = [], wind = [], gust = [], precip = [];
  for (let i = 0; i < daily.time.length; i++) {
    if (!allowedKeys.has(daily.time[i].slice(5, 10))) continue;
    const a = daily.temperature_2m_max[i], b = daily.temperature_2m_min[i];
    const c = daily.wind_speed_10m_max[i], d = daily.wind_gusts_10m_max[i], e = daily.precipitation_sum[i];
    if ([a, b, c, d, e].some((v) => v === null)) continue;
    tmax.push(a); tmin.push(b); wind.push(c); gust.push(d); precip.push(e);
  }
  if (!tmax.length) return null;
  const mean = (arr) => arr.reduce((s, v) => s + v, 0) / arr.length;
  const rainyDays = precip.filter((v) => v >= 1).length;
  return {
    n: tmax.length,
    tempMaxMean: mean(tmax), tempMaxMin: Math.min(...tmax), tempMaxMax: Math.max(...tmax),
    tempMinMean: mean(tmin), tempMinMin: Math.min(...tmin), tempMinMax: Math.max(...tmin),
    windMean: mean(wind), gustMean: mean(gust), gustRecord: Math.max(...gust),
    precipMean: mean(precip), rainyPct: Math.round((rainyDays / precip.length) * 100),
  };
}

async function fetchNormal(lat, lon, allowedKeys) {
  const url =
    `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lon}` +
    `&start_date=${NORMAL_START_YEAR}-01-01&end_date=${NORMAL_END_YEAR}-12-31` +
    '&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max,wind_gusts_10m_max' +
    '&timezone=auto';
  const json = await fetchJson(url, `normale ${lat},${lon}`);
  return computeNormal(json.daily, allowedKeys);
}

// -- Meteoblue (modèle mLM) : deuxième avis, optionnel --
// La clé ne transite que par l'env (secret Actions ou .env local). Elle ne doit
// jamais finir dans le dépôt : GitHub Pages sert ce repo publiquement. Seules
// les valeurs météo sont écrites dans l'instantané, jamais la clé ni l'URL.
async function fetchMeteoblueDays(rows) {
  const apiKey = process.env.METEOBLUE_API_KEY;
  if (!apiKey) {
    console.log('METEOBLUE_API_KEY absente -- consensus Meteoblue ignoré (optionnel)');
    return null;
  }
  const locKeys = [...new Set(rows.map((r) => `${r.lat},${r.lon}`))];
  const days = {};
  for (const key of locKeys) {
    const [lat, lon] = key.split(',');
    const url =
      `https://my.meteoblue.com/packages/basic-day?apikey=${apiKey}` +
      `&lat=${lat}&lon=${lon}&format=json`;
    // Le label ne contient pas l'URL : une erreur ne doit pas divulguer la clé.
    const json = await fetchJson(url, `Meteoblue ${key}`);
    const d = json.data_day;
    if (!d?.time) {
      throw new Error(
        `Meteoblue ${key} : pas de data_day. Clés reçues : ${Object.keys(json).join(', ')}`
      );
    }
    // Noms de champs d'après la doc du package basic-day. S'ils diffèrent, on
    // échoue en listant ce qui a réellement été reçu plutôt que d'écrire des
    // valeurs vides silencieusement.
    const need = ['temperature_max', 'temperature_min', 'precipitation', 'windspeed_max'];
    const absent = need.filter((f) => !d[f]);
    if (absent.length) {
      throw new Error(
        `Meteoblue ${key} : champs manquants ${absent.join(', ')}. Champs data_day reçus : ${Object.keys(d).join(', ')}`
      );
    }
    rows
      .filter((r) => `${r.lat},${r.lon}` === key)
      .forEach((r) => {
        const i = d.time.indexOf(r.date);
        if (i === -1) return; // hors de la fenêtre de prévision Meteoblue
        days[r.date] = {
          temp_max: d.temperature_max[i],
          temp_min: d.temperature_min[i],
          wind_max: d.windspeed_max[i],
          precip_mm: d.precipitation[i],
          precip_prob: d.precipitation_probability ? d.precipitation_probability[i] : null,
        };
      });
    console.log(`  meteoblue ok  ${key}`);
    await sleep(1200);
  }
  return Object.keys(days).length ? { days } : null;
}

async function main() {
  const rows = readTripRows();
  const tripDates = new Set(rows.map((r) => r.date));
  const locKeys = [...new Set(rows.map((r) => `${r.lat},${r.lon}`))];
  console.log(`${rows.length} journées, ${locKeys.length} lieux uniques`);

  const byLocation = {};
  const normals = {};

  // Séquentiel avec pause : l'API gratuite renvoie 429 sur des requêtes en rafale.
  for (const key of locKeys) {
    const [lat, lon] = key.split(',');
    byLocation[key] = await fetchForecast(lat, lon, tripDates);
    console.log(`  prévision ok  ${key}`);
    await sleep(1200);

    const allowed = new Set();
    rows
      .filter((r) => `${r.lat},${r.lon}` === key)
      .forEach((r) => dayWindowKeys(r.date, NORMAL_WINDOW_DAYS).forEach((k) => allowed.add(k)));
    normals[key] = await fetchNormal(lat, lon, allowed);
    console.log(`  normale ok    ${key} (n=${normals[key]?.n ?? 0})`);
    await sleep(1200);
  }

  // Un instantané partiel serait pire que pas d'instantané : on échoue au lieu
  // d'écraser un bon fichier par un fichier troué.
  const missing = locKeys.filter((k) => !byLocation[k]?.daily || !normals[k]);
  if (missing.length) throw new Error(`Données manquantes pour : ${missing.join(', ')}`);

  // Optionnel : n'échoue pas le build si Meteoblue tombe, le reste vaut d'être publié.
  let meteoblue = null;
  try {
    meteoblue = await fetchMeteoblueDays(rows);
  } catch (err) {
    console.error(`avertissement Meteoblue : ${err.message}`);
  }

  const snapshot = {
    updatedAt: new Date().toISOString(),
    source: { forecast: 'ECMWF/IFS via open-meteo.com', normals: `ERA5 ${NORMAL_START_YEAR}-${NORMAL_END_YEAR} via archive-api.open-meteo.com` },
    byLocation,
    normals,
    meteoblue,
  };
  const out = join(ROOT, 'forecast-snapshot.json');
  writeFileSync(out, `${JSON.stringify(snapshot, null, 1)}\n`);
  console.log(`écrit ${out} (${(JSON.stringify(snapshot).length / 1024).toFixed(0)} Ko)`);
}

main().catch((err) => {
  console.error(`échec : ${err.message}`);
  process.exit(1);
});
