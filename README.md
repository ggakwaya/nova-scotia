# 🧭 Cap sur la Nouvelle-Écosse

Compagnon de voyage pour un road trip **Québec ⇄ Nouvelle-Écosse**, du **27 juillet au 9 août 2026** (14 jours, ~3 800 km). Une application web autonome, en français, installable et **fonctionnelle hors-ligne** — pensée pour la route, sans réseau.

Identité visuelle **« carte marine »** : rose des vents, laiton sur navy, rouge bouée — l'univers nautique de la province la plus atlantique du Canada.

## L'itinéraire

Québec → Moncton → **île du Cap-Breton** (Mira, Louisbourg, Ingonish, Meat Cove, Chéticamp) → **Halifax** et la côte sud (Lunenburg, Peggy's Cove, Clam Harbour) → **baie de Fundy** (Hopewell Rocks, parc Fundy) → retour.

Deux parcs nationaux (Hautes-Terres-du-Cap-Breton, Fundy) et deux lieux historiques nationaux (Louisbourg, Alexander-Graham-Bell).

## Fonctionnalités

- **Itinéraire complet** — calendrier 14 jours, détail par jour, hébergements (tous réservés), attraits, distances et durées.
- **Carte interactive** (Leaflet) — étapes et trajets, chaque marqueur porte une note historique et géographique ; liens « Carte 📍 » depuis l'itinéraire pour zoomer sur une étape.
- **Notes de fond** — histoire, géographie et géologie au fil des escales, plus un lexique (culture gaélique/acadienne et vocabulaire Parcs Canada).
- **Thème clair / sombre** — « carte sur lin » et « carte au crépuscule », respecte la préférence du système.
- **PWA hors-ligne** — installable sur l'écran d'accueil, mise en cache via un service worker (*stale-while-revalidate*) ; fonctionne sans réseau une fois chargée.
- **Sans dépendances de build** — un seul fichier HTML, CSS et JS en vanilla.

## Lancer en local

Un service worker exige `http://` (pas `file://`) :

```bash
python3 -m http.server 8000
# puis ouvrir http://localhost:8000
```

## Structure

| Fichier | Rôle |
|---|---|
| `index.html` | L'application entière — contenu, styles et JS en ligne |
| `map-data.geojson` | Étapes (points) et trajets (lignes), avec notes par jour |
| `manifest.json` | Manifeste PWA (installation) |
| `sw.js` | Service worker — cache hors-ligne |
| `icon.png` / `icon.svg` | Icône rose des vents (source vectorielle incluse) |
| `doc/` | Données source de l'itinéraire (CSV) |

## Régénérer l'icône

L'icône est générée à partir de `icon.svg` :

```bash
magick icon.svg -resize 1024x1024 icon.png
```

## Stack

HTML / CSS / JavaScript vanilla · [Leaflet](https://leafletjs.com/) · tuiles OpenStreetMap / CARTO · polices Bricolage Grotesque + Spline Sans (Google Fonts). Aucun framework, aucun bundler.
