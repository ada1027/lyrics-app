const express = require('express');
const axios = require('axios');
const path = require('path');
require('dotenv').config();

const { autoRomanize } = require('./romanization');

const app = express();
const PORT = process.env.PORT || 3000;

// Configuration 
const SPOTIFY_API = {
  auth: 'https://accounts.spotify.com/authorize',
  token: 'https://accounts.spotify.com/api/token',
  player: 'https://api.spotify.com/v1/me/player/currently-playing',
};

const CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
const CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;
const REDIRECT_URI = 'http://127.0.0.1:3000/callback';

let accessToken = '';

/**
 Converts raw LRC text into a synced array of romanized lines
 */
async function parseLRC(lrcText) {
  const lines = lrcText.split('\n');
  const parsed = [];

  for (const line of lines) {
    const match = line.match(/\[(\d{2}):(\d{2})\.(\d{2,3})\](.*)/);
    if (match) {
      const msPart = match[3];
      const ms = msPart.length === 2 ? parseInt(msPart) * 10 : parseInt(msPart);
      const timeInMs = (parseInt(match[1]) * 60 + parseInt(match[2])) * 1000 + ms;
      const originalText = match[4].trim();

      if (originalText) {
        // Await used here because Japanese romanization requires dictionary lookups
        const romanized = await autoRomanize(originalText);
        parsed.push({ time: timeInMs, text: romanized });
      }
    }
  }
  return parsed.sort((a, b) => a.time - b.time);
}

// API ROUTES

app.get('/login', (req, res) => {
  const scopes = 'user-read-currently-playing user-read-playback-state';
  const query = new URLSearchParams({
    response_type: 'code',
    client_id: CLIENT_ID,
    scope: scopes,
    redirect_uri: REDIRECT_URI,
  });
  res.redirect(`${SPOTIFY_API.auth}?${query.toString()}`);
});

app.get('/callback', async (req, res) => {
  try {
    const authHeader = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');
    const response = await axios.post(SPOTIFY_API.token, new URLSearchParams({
      grant_type: 'authorization_code',
      code: req.query.code,
      redirect_uri: REDIRECT_URI,
    }), { 
      headers: { 'Authorization': `Basic ${authHeader}` } 
    });

    accessToken = response.data.access_token;
    res.redirect('/?authenticated=true');
  } catch (err) {
    console.error('Auth Error:', err.message);
    res.status(500).send("Authentication Failed");
  }
});

app.get('/current-track', async (req, res) => {
  if (!accessToken) return res.json({});
  try {
    const { data } = await axios.get(SPOTIFY_API.player, {
      headers: { 'Authorization': `Bearer ${accessToken}` }
    });
    if (!data || !data.item) return res.json({});
    
    res.json({
      id: data.item.id,
      name: data.item.name,
      artist: data.item.artists[0].name,
      albumArt: data.item.album.images[0].url,
      progress_ms: data.progress_ms,
      is_playing: data.is_playing
    });
  } catch (err) {
    res.json({});
  }
});

app.get('/lyrics', async (req, res) => {
  const { song, artist } = req.query;
  try {
    // Attempt to fetch from LRCLIB
    const resLrc = await axios.get('https://lrclib.net/api/search', { 
      params: { track_name: song, artist_name: artist } 
    }).catch(() => null);

    let rawLrc = resLrc?.data?.[0]?.syncedLyrics;

    // Fallback to NetEase
    if (!rawLrc) {
      const sRes = await axios.get('https://music.163.com/api/search/get/web', { 
        params: { s: `${song} ${artist}`, type: 1, limit: 1 } 
      }).catch(() => null);
      
      const id = sRes?.data?.result?.songs?.[0]?.id;
      if (id) {
        const lRes = await axios.get('https://music.163.com/api/song/lyric', { params: { id } }).catch(() => null);
        rawLrc = lRes?.data?.lrc?.lyric;
      }
    }

    if (rawLrc) {
      const parsedData = await parseLRC(rawLrc);
      return res.json({ parsed: parsedData });
    }
    res.status(404).json({ error: 'Lyrics not found' });
  } catch (err) {
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// FRONTEND ROUTE
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <title>Lyrics Sync</title>
      <style>
        :root { --spotify-green: #1DB954; --bg-black: #000000; --sidebar-gray: #121212; }
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: var(--bg-black); color: #fff; display: flex; height: 100vh; margin: 0; overflow: hidden; }
        
        .sidebar { width: 300px; background: var(--sidebar-gray); padding: 30px; border-right: 1px solid #282828; display: flex; flex-direction: column; align-items: center; }
        .lyrics-container { flex: 1; overflow-y: auto; padding: 40vh 60px; scroll-behavior: smooth; text-align: center; mask-image: linear-gradient(to bottom, transparent, black 20%, black 80%, transparent); }
        
        .lyric-line { font-size: 2.2rem; font-weight: 700; padding: 20px 0; color: #ffffff; opacity: 0.35; transition: all 0.5s cubic-bezier(0.4, 0, 0.2, 1); cursor: default; }
        .lyric-line.active { opacity: 1; transform: scale(1.08); filter: blur(0); }

        .album-art { width: 100%; aspect-ratio: 1/1; border-radius: 8px; box-shadow: 0 10px 30px rgba(0,0,0,0.5); margin-bottom: 25px; }
        .btn-connect { background: var(--spotify-green); color: white; border: none; padding: 14px 28px; border-radius: 500px; font-size: 14px; font-weight: bold; cursor: pointer; text-transform: uppercase; letter-spacing: 1px; width: 100%; transition: transform 0.2s; }
        .btn-connect:hover { transform: scale(1.05); background: #1ed760; }
        
        h3 { margin: 0 0 5px 0; font-size: 1.2rem; width: 100%; text-align: center; }
        p { margin: 0; color: #b3b3b3; font-size: 0.9rem; }
      </style>
    </head>
    <body>
      <div class="sidebar">
        <button class="btn-connect" onclick="location.href='/login'">Connect Your Spotify</button>
        <div id="track-info" style="margin-top:40px; width: 100%;"></div>
      </div>
      <div class="lyrics-container" id="lyrics-container"></div>

      <script>
        let lyrics = []; 
        let isPlaying = false; 
        let localProgress = 0; 
        let lastTick = Date.now();
        let currentTrackId = null; 
        let currentActiveIdx = -1;

        function runSync() {
          if (isPlaying) {
            const now = Date.now();
            localProgress += (now - lastTick);
            lastTick = now;
            
            let activeIdx = -1;
            for (let i = 0; i < lyrics.length; i++) {
              if (localProgress >= lyrics[i].time) activeIdx = i;
            }

            if (activeIdx !== currentActiveIdx && activeIdx !== -1) {
              currentActiveIdx = activeIdx;
              const lines = document.querySelectorAll('.lyric-line');
              lines.forEach((el, i) => {
                if (i === activeIdx) {
                  el.classList.add('active');
                  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                } else {
                  el.classList.remove('active');
                }
              });
            }
          }
          requestAnimationFrame(runSync);
        }
        runSync();

        async function poll() {
          try {
            const res = await fetch('/current-track');
            const data = await res.json();
            if (data.id) {
              isPlaying = data.is_playing;
              if (Math.abs(localProgress - data.progress_ms) > 1000) localProgress = data.progress_ms;
              lastTick = Date.now();
              if (currentTrackId !== data.id) {
                currentTrackId = data.id;
                document.getElementById('track-info').innerHTML = \`
                  <img class="album-art" src="\${data.albumArt}">
                  <h3>\${data.name}</h3>
                  <p>\${data.artist}</p>\`;
                fetchLyrics(data);
              }
            }
          } catch(e) {}
        }

        async function fetchLyrics(track) {
          const res = await fetch(\`/lyrics?song=\${encodeURIComponent(track.name)}&artist=\${encodeURIComponent(track.artist)}\`);
          const data = await res.json();
          lyrics = data.parsed || [];
          currentActiveIdx = -1;
          document.getElementById('lyrics-container').innerHTML = 
            lyrics.map(l => \`<div class="lyric-line">\${l.text}</div>\`).join('');
        }

        if (window.location.search.includes('authenticated')) {
           document.querySelector('.btn-connect').style.display = 'none';
           setInterval(poll, 2000);
        }
      </script>
    </body>
    </html>
  `);
});

app.listen(PORT, () => console.log(`Open at http://localhost:${PORT}`));