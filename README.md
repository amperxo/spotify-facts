# Spotify Facts

A real-time now-playing app that shows what you're listening to on Spotify and surfaces interesting facts about the track using AI.

## Features

- **Spotify Now Playing** — Displays your currently playing track with album art, progress bar, and playback status
- **AI-Powered Facts** — Generates fun, surprising facts about each song using Wikipedia, MusicBrainz, and Google Gemini
- **Audio Visualizer** — A Three.js-powered background visualizer that reacts to the track's tempo and energy, colored by the album art's dominant colors
- **Secure Auth** — Spotify OAuth with PKCE flow (no client secret exposed to the browser)

## Tech Stack

- **Framework:** Next.js 16 (App Router)
- **Language:** TypeScript
- **Styling:** Tailwind CSS v4
- **AI:** Google Gemini (gemini-2.5-flash-lite)
- **Data Sources:** Spotify Web API, Wikipedia, MusicBrainz
- **3D:** Three.js (audio visualizer)

## Getting Started

### Prerequisites

- Node.js 18+
- A [Spotify Developer](https://developer.spotify.com/dashboard) app
- A [Google AI Studio](https://aistudio.google.com/) API key

### Environment Variables

Create a `.env.local` file in the project root:

```env
SPOTIFY_CLIENT_ID=your_spotify_client_id
SPOTIFY_REDIRECT_URI=http://localhost:3000/callback
GEMINI_API_KEY=your_gemini_api_key
```

### Install & Run

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000), sign in with Spotify, and play a song.

## How It Works

1. User signs in via Spotify OAuth (PKCE)
2. The app polls the Spotify API every 5 seconds for the currently playing track
3. When a new track is detected, it fetches context from Wikipedia and MusicBrainz
4. Gemini synthesizes a concise, interesting fact from the gathered sources
5. The Three.js visualizer adapts to the track's audio features (tempo, energy) and album art colors
