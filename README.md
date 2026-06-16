# Spotify Facts

A real-time now-playing app that shows what you're listening to on Spotify and surfaces interesting facts about the track using AI.

## Features

- **Spotify Now Playing** — Displays your currently playing track with album art, progress bar, and playback status
- **AI-Powered Facts** — Generates fun, surprising facts about each song using Wikipedia, MusicBrainz, and Google Gemini
- **Album-Art Kaleidoscope** — A full-screen, seamless triangular kaleidoscope generated live from the current album's artwork (fetched in high resolution from Apple), slowly turning behind the player
- **Vinyl Listings** — Surfaces Discogs marketplace stats for the album — copies for sale, lowest price, and collector demand
- **Genre Lineage** — Traces the album's genre back through its stylistic origins (Discogs style → Wikipedia), showing a roots → origins → now family tree with decades
- **Secure Auth** — Spotify OAuth with PKCE flow (no client secret exposed to the browser)

## Tech Stack

- **Framework:** Next.js 16 (App Router)
- **Language:** TypeScript
- **Styling:** Tailwind CSS v4
- **AI:** Google Gemini (gemini-2.5-flash-lite)
- **Data Sources:** Spotify Web API, Wikipedia, MusicBrainz, Discogs, Apple iTunes

## Getting Started

### Prerequisites

- Node.js 18+
- A [Spotify Developer](https://developer.spotify.com/dashboard) app
- A [Google AI Studio](https://aistudio.google.com/) API key
- A [Discogs](https://www.discogs.com/settings/developers) token (free; optional — enables the vinyl listings card)

### Environment Variables

Create a `.env.local` file in the project root:

```env
SPOTIFY_CLIENT_ID=your_spotify_client_id
SPOTIFY_REDIRECT_URI=http://127.0.0.1:3000/callback
GEMINI_API_KEY=your_gemini_api_key
DISCOGS_TOKEN=your_discogs_token
```

### Install & Run

```bash
npm install
npm run dev
```

Open [http://127.0.0.1:3000](http://127.0.0.1:3000), sign in with Spotify, and play a song.

> **Note:** Use `127.0.0.1`, not `localhost` — Spotify no longer accepts `localhost` redirect URIs. The value here must match the Redirect URI registered in your Spotify app exactly.

## How It Works

1. User signs in via Spotify OAuth (PKCE)
2. The app polls the Spotify API every 5 seconds for the currently playing track
3. When a new track is detected, it fetches context from Wikipedia and MusicBrainz (and, per album, Discogs listings plus a Wikipedia-derived genre lineage)
4. Gemini synthesizes a concise, interesting fact from the gathered sources
5. The background renders a live, seamless kaleidoscope from the album artwork (fetched in high resolution from Apple)
