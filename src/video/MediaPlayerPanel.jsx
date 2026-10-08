import React, { useEffect, useRef, useState } from 'react';
import {
  PRESET_RADIOS,
  searchRadioStations,
  searchPodcasts,
  fetchPodcastEpisodes,
  searchYouTubeVideos,
} from './mediaService.js';
import { hostBridge } from '../core/hostBridge.js';

export default function MediaPlayerPanel({
  mediaState,
  onMediaChange,
  onClose,
}) {
  const audioRef = useRef(null);
  const [tab, setTab] = useState(mediaState?.mode || 'radio'); // 'radio' | 'podcast' | 'video'
  const [query, setQuery] = useState('');
  const [radios, setRadios] = useState(PRESET_RADIOS);
  const [podcasts, setPodcasts] = useState([]);
  const [episodes, setEpisodes] = useState([]);
  const [videos, setVideos] = useState([]);
  const [loading, setLoading] = useState(false);
  const [playing, setPlaying] = useState(true);
  const [volume, setVolume] = useState(0.85);
  const [sleepRemainingMin, setSleepRemainingMin] = useState(mediaState?.sleepMinutes || 0);

  useEffect(() => {
    if (mediaState?.mode) setTab(mediaState.mode);
    if (mediaState?.sleepMinutes) setSleepRemainingMin(mediaState.sleepMinutes);
  }, [mediaState?.mode, mediaState?.sleepMinutes]);

  // Play current audio stream when mediaState.url changes
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (mediaState?.url && (mediaState.mode === 'radio' || mediaState.mode === 'podcast')) {
      if (audio.src !== mediaState.url) {
        audio.src = mediaState.url;
      }
      audio.volume = volume;
      if (mediaState.paused) {
        audio.pause();
        setPlaying(false);
      } else {
        audio.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
      }
    } else {
      audio.pause();
    }
  }, [mediaState?.url, mediaState?.mode, mediaState?.paused]);

  // Sleep timer countdown
  useEffect(() => {
    if (!sleepRemainingMin || sleepRemainingMin <= 0) return;
    const id = setInterval(() => {
      setSleepRemainingMin((m) => {
        if (m <= 1) {
          if (audioRef.current) audioRef.current.pause();
          setPlaying(false);
          return 0;
        }
        return m - 1;
      });
    }, 60000);
    return () => clearInterval(id);
  }, [sleepRemainingMin]);

  const handleSearch = async (e) => {
    if (e) e.preventDefault();
    setLoading(true);
    try {
      if (tab === 'radio') {
        const list = await searchRadioStations(query, 'FR');
        setRadios(list);
      } else if (tab === 'podcast') {
        const res = await searchPodcasts(query || 'France Inter');
        setPodcasts(res.podcasts);
        setEpisodes(res.episodes);
      } else if (tab === 'video') {
        const list = await searchYouTubeVideos(query || 'actualités science');
        setVideos(list);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (tab === 'podcast' && podcasts.length === 0) {
      searchPodcasts('Affaires sensibles').then((res) => {
        setPodcasts(res.podcasts);
        setEpisodes(res.episodes);
      });
    } else if (tab === 'video' && videos.length === 0) {
      searchYouTubeVideos('documentaire espace').then(setVideos);
    }
  }, [tab]);

  const playStation = (st) => {
    onMediaChange?.({
      mode: 'radio',
      title: st.name,
      subtitle: `${st.tags || 'Radio en direct'} • ${st.country || 'FR'}`,
      url: st.stream,
      paused: false,
    });
  };

  const playEpisode = (ep) => {
    onMediaChange?.({
      mode: 'podcast',
      title: ep.title,
      subtitle: ep.podcastTitle || 'Podcast',
      url: ep.url,
      paused: false,
    });
  };

  const playVideoItem = (v) => {
    onMediaChange?.({
      mode: 'video',
      title: v.title,
      subtitle: v.uploader || 'YouTube',
      embedUrl: v.embedUrl,
      watchUrl: v.watchUrl,
      paused: false,
    });
  };

  const togglePlay = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      audio.play().then(() => setPlaying(true)).catch(() => {});
    } else {
      audio.pause();
      setPlaying(false);
    }
  };

  return (
    <div className="media-panel">
      <audio ref={audioRef} preload="none" />

      <div className="media-header">
        <div className="media-tabs">
          <button
            className={`media-tab ${tab === 'radio' ? 'active' : ''}`}
            onClick={() => setTab('radio')}
          >
            📻 Radios Direct
          </button>
          <button
            className={`media-tab ${tab === 'podcast' ? 'active' : ''}`}
            onClick={() => setTab('podcast')}
          >
            🎙️ Podcasts
          </button>
          <button
            className={`media-tab ${tab === 'video' ? 'active' : ''}`}
            onClick={() => setTab('video')}
          >
            🎬 Vidéos & YouTube
          </button>
        </div>
        {onClose && (
          <button className="space-close-btn" onClick={onClose} title="Fermer">
            ✕
          </button>
        )}
      </div>

      {/* Now Playing Bar */}
      {mediaState?.title && (
        <div className="media-now-playing">
          <div className="media-np-info">
            <span className="media-np-badge">
              {mediaState.mode === 'radio'
                ? '🔴 EN DIRECT'
                : mediaState.mode === 'podcast'
                ? '🎙️ PODCAST'
                : '🎬 VIDÉO'}
            </span>
            <div>
              <div className="media-np-title">{mediaState.title}</div>
              {mediaState.subtitle && <div className="media-np-sub">{mediaState.subtitle}</div>}
            </div>
          </div>

          <div className="media-np-controls">
            {(mediaState.mode === 'radio' || mediaState.mode === 'podcast') && (
              <>
                <button className="media-ctrl-btn" onClick={togglePlay}>
                  {playing ? '⏸ Pause' : '▶ Lecture'}
                </button>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={volume}
                  onChange={(e) => {
                    const v = parseFloat(e.target.value);
                    setVolume(v);
                    if (audioRef.current) audioRef.current.volume = v;
                  }}
                  title="Volume"
                  className="media-vol-slider"
                />
              </>
            )}
            <button
              className="media-ctrl-btn"
              onClick={() => setSleepRemainingMin((m) => (m ? 0 : 30))}
              title="Minuteur sommeil (30 min)"
            >
              🌙 {sleepRemainingMin > 0 ? `${sleepRemainingMin}m` : 'Veille 30m'}
            </button>
            {mediaState.watchUrl && (
              <button
                className="media-ctrl-btn"
                onClick={() => hostBridge.openExternal(mediaState.watchUrl)}
              >
                ↗ Navigateur
              </button>
            )}
          </div>
        </div>
      )}

      {/* Active Video Embed */}
      {tab === 'video' && mediaState?.embedUrl && (
        <div className="media-video-stage">
          <iframe
            src={mediaState.embedUrl}
            title={mediaState.title || 'Lecteur vidéo'}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
          />
        </div>
      )}

      {/* Search Bar */}
      <form className="media-search-bar" onSubmit={handleSearch}>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={
            tab === 'radio'
              ? 'Chercher une station ou un genre (FIP, France Inter, Jazz, Lofi, Pluie)...'
              : tab === 'podcast'
              ? 'Chercher un podcast (Affaires sensibles, Science, Histoire, Tech)...'
              : 'Chercher une vidéo YouTube...'
          }
        />
        <button type="submit" disabled={loading}>
          {loading ? 'Recherche...' : 'Rechercher'}
        </button>
      </form>

      {/* Content Lists */}
      <div className="media-list">
        {tab === 'radio' &&
          radios.map((st, idx) => (
            <div key={`${st.stream}-${idx}`} className="media-item">
              <div>
                <strong>{st.name}</strong>
                <div className="media-item-sub">
                  {st.tags || 'Radio'} • {st.country || 'FR'}
                </div>
              </div>
              <button className="media-play-btn" onClick={() => playStation(st)}>
                ▶ Écouter
              </button>
            </div>
          ))}

        {tab === 'podcast' && (
          <>
            {podcasts.length > 0 && (
              <div className="media-podcast-pills">
                {podcasts.map((p) => (
                  <button
                    key={p.id}
                    className="space-pill"
                    onClick={async () => {
                      if (!p.feedUrl) return;
                      setLoading(true);
                      const eps = await fetchPodcastEpisodes(p.feedUrl, p.title);
                      setEpisodes(eps);
                      setLoading(false);
                    }}
                  >
                    🎙️ {p.title}
                  </button>
                ))}
              </div>
            )}
            {episodes.map((ep, idx) => (
              <div key={`${ep.url}-${idx}`} className="media-item">
                <div>
                  <strong>{ep.title}</strong>
                  <div className="media-item-sub">
                    {ep.podcastTitle} {ep.pubDate ? `• ${ep.pubDate.slice(0, 16)}` : ''}
                  </div>
                </div>
                <button className="media-play-btn" onClick={() => playEpisode(ep)}>
                  ▶ Épisode
                </button>
              </div>
            ))}
          </>
        )}

        {tab === 'video' &&
          videos.map((v) => (
            <div key={v.id} className="media-item">
              <div className="media-video-row">
                {v.thumbnail && (
                  <img src={v.thumbnail} alt={v.title} className="media-thumb" />
                )}
                <div>
                  <strong>{v.title}</strong>
                  <div className="media-item-sub">{v.uploader}</div>
                </div>
              </div>
              <div className="media-item-actions">
                <button className="media-play-btn" onClick={() => playVideoItem(v)}>
                  ▶ Lire ici
                </button>
                <button
                  className="space-mini-btn"
                  onClick={() => hostBridge.openExternal(v.watchUrl)}
                >
                  ↗ YouTube
                </button>
              </div>
            </div>
          ))}
      </div>
    </div>
  );
}
