import { useEffect, useMemo, useState } from "react";
import { useProcessingStore } from "../../process-audio/model/use-processing-store";
import { TrackMatch } from "../../../entities/track-match/model/types";
import { Badge } from "../../../shared/ui/badge";
import { Button } from "../../../shared/ui/button";
import { Card } from "../../../shared/ui/card";

type SpotifyAuth = {
  accessToken: string;
  refreshToken?: string;
  expiresIn: number;
  issuedAt: number;
  scope?: string;
};

type SpotifyPlaylist = {
  id: string;
  name: string;
  owner: string;
  tracksTotal: number;
};

type SpotifyCandidate = {
  id: string;
  uri: string;
  name: string;
  artists: string[];
  album: string;
  durationMs: number;
  popularity: number;
  score: number;
  titleScore: number;
  artistScore: number;
  durationScore: number;
};

type CandidateResponse = {
  confident: boolean;
  margin: number;
  top: SpotifyCandidate | null;
  candidates: SpotifyCandidate[];
};

type SafeAddItem = {
  uri: string;
  name?: string;
  artists?: string[];
};

const STORAGE_KEY = "spotify_sync_auth_v1";

function trackDurationMs(track: TrackMatch) {
  const end = track.endedAtSec ?? track.startedAtSec;
  return Math.max(1, Math.round((end - track.startedAtSec) * 1000));
}

function isUnknownTrack(track: TrackMatch) {
  return track.provider === "unknown" || track.title.trim().toLowerCase() === "unknown track";
}

function isConfidentTrack(track: TrackMatch) {
  return !isUnknownTrack(track) && !track.needsReview && track.confidence >= 0.82 && track.detectionCount >= 2;
}

function isReviewTrack(track: TrackMatch) {
  if (isUnknownTrack(track)) {
    return false;
  }

  return !isConfidentTrack(track);
}

function canonicalKey(track: TrackMatch) {
  const normalize = (value: string) =>
    value
      .toLowerCase()
      .replace(/\([^)]*\)/g, " ")
      .replace(/\[[^\]]*]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  const title = normalize(track.title);
  const artist = normalize(track.artist).split(/,|&|\/|;|\|/)[0]?.trim() || normalize(track.artist);
  return `${title}::${artist}`;
}

export function SpotifySync() {
  const results = useProcessingStore((state) => state.results);
  const job = useProcessingStore((state) => state.job);
  const [auth, setAuth] = useState<SpotifyAuth | null>(null);
  const [spotifyConfigured, setSpotifyConfigured] = useState<boolean>(false);
  const [playlists, setPlaylists] = useState<SpotifyPlaylist[]>([]);
  const [selectedPlaylistId, setSelectedPlaylistId] = useState<string>("");
  const [candidatesByTrackId, setCandidatesByTrackId] = useState<Record<string, CandidateResponse>>({});
  const [selectedCandidateByTrackId, setSelectedCandidateByTrackId] = useState<Record<string, string>>({});
  const [dismissedTrackIds, setDismissedTrackIds] = useState<Record<string, true>>({});
  const [forcedReviewTrackIds, setForcedReviewTrackIds] = useState<Record<string, true>>({});
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const confidentTracks = useMemo(
    () => results.filter(isConfidentTrack),
    [results],
  );
  const reviewTracks = useMemo(
    () =>
      results
        .filter((track) => isReviewTrack(track) || Boolean(forcedReviewTrackIds[track.id]))
        .filter((track) => !dismissedTrackIds[track.id]),
    [dismissedTrackIds, forcedReviewTrackIds, results],
  );

  useEffect(() => {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return;
    }

    try {
      const parsed = JSON.parse(raw) as SpotifyAuth;
      if (parsed?.accessToken) {
        setAuth(parsed);
      }
    } catch {
      localStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  useEffect(() => {
    const handler = (event: MessageEvent) => {
      if (!event.data || event.data.type !== "spotify-auth-success") {
        return;
      }

      const payload = event.data.payload as SpotifyAuth;
      if (!payload?.accessToken) {
        return;
      }

      setAuth(payload);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
      setStatusMessage("Spotify connected successfully.");
    };

    window.addEventListener("message", handler);
    return () => {
      window.removeEventListener("message", handler);
    };
  }, []);

  useEffect(() => {
    const fetchConfig = async () => {
      try {
        const response = await fetch("/api/spotify/config");
        const payload = await response.json();
        setSpotifyConfigured(Boolean(payload.enabled));
      } catch {
        setSpotifyConfigured(false);
      }
    };

    void fetchConfig();
  }, []);

  const ensureValidAuth = async () => {
    if (!auth) {
      throw new Error("Spotify is not connected.");
    }

    const expiresAt = auth.issuedAt + auth.expiresIn * 1000 - 20_000;
    if (Date.now() < expiresAt) {
      return auth;
    }

    if (!auth.refreshToken) {
      throw new Error("Spotify session expired. Please reconnect.");
    }

    const response = await fetch("/api/spotify/refresh", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        refreshToken: auth.refreshToken,
      }),
    });

    if (!response.ok) {
      throw new Error("Spotify token refresh failed. Please reconnect.");
    }

    const refreshed = (await response.json()) as SpotifyAuth;
    setAuth(refreshed);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(refreshed));
    return refreshed;
  };

  const spotifyFetch = async (url: string, options?: RequestInit) => {
    const current = await ensureValidAuth();
    const response = await fetch(url, {
      ...options,
      headers: {
        ...(options?.headers ?? {}),
        Authorization: `Bearer ${current.accessToken}`,
      },
    });

    if (response.status === 401 && current.refreshToken) {
      const refreshed = await ensureValidAuth();
      return fetch(url, {
        ...options,
        headers: {
          ...(options?.headers ?? {}),
          Authorization: `Bearer ${refreshed.accessToken}`,
        },
      });
    }

    return response;
  };

  const connectSpotify = async () => {
    setBusyAction("connect");
    setStatusMessage(null);

    try {
      const response = await fetch("/api/spotify/auth-url");
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error || "Failed to start Spotify auth.");
      }

      window.open(payload.url, "spotify-auth", "width=520,height=760");
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Spotify connect failed.");
    } finally {
      setBusyAction(null);
    }
  };

  const disconnectSpotify = () => {
    setAuth(null);
    setPlaylists([]);
    setSelectedPlaylistId("");
    setForcedReviewTrackIds({});
    localStorage.removeItem(STORAGE_KEY);
    setStatusMessage("Spotify disconnected.");
  };

  const loadPlaylists = async () => {
    setBusyAction("playlists");
    setStatusMessage(null);

    try {
      const response = await spotifyFetch("/api/spotify/playlists");
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || "Failed to load playlists.");
      }

      const items = payload.items as SpotifyPlaylist[];
      setPlaylists(items);
      if (items.length > 0 && !selectedPlaylistId) {
        setSelectedPlaylistId(items[0].id);
      }
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Failed to load playlists.");
    } finally {
      setBusyAction(null);
    }
  };

  const fetchCandidates = async (track: TrackMatch) => {
    setBusyAction(`candidate:${track.id}`);
    setStatusMessage(null);

    try {
      const response = await spotifyFetch("/api/spotify/search-candidates", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          mode: "manual",
          title: track.title,
          artist: track.artist,
          album: track.album,
          durationMs: trackDurationMs(track),
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || "Failed to search Spotify candidates.");
      }

      const typed = payload as CandidateResponse;
      setCandidatesByTrackId((state) => ({
        ...state,
        [track.id]: typed,
      }));
      if (typed.top?.uri) {
        const topUri = typed.top.uri;
        setSelectedCandidateByTrackId((state) => ({
          ...state,
          [track.id]: topUri,
        }));
      }
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Spotify search failed.");
    } finally {
      setBusyAction(null);
    }
  };

  const safeAddUris = async (items: SafeAddItem[]) => {
    if (!selectedPlaylistId) {
      throw new Error("Select a Spotify playlist first.");
    }

    const response = await spotifyFetch(`/api/spotify/playlists/${selectedPlaylistId}/safe-add`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ items }),
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || "Failed to add tracks.");
    }

    return payload as { added: number; skippedExisting: number };
  };

  const autoAddConfident = async () => {
    if (!selectedPlaylistId) {
      setStatusMessage("Select a Spotify playlist first.");
      return;
    }

    setBusyAction("auto-add");
    setStatusMessage(null);

    try {
      const dedupedTracks = new Map<string, TrackMatch>();
      for (const track of confidentTracks) {
        const key = canonicalKey(track);
        const current = dedupedTracks.get(key);
        if (!current || track.confidence > current.confidence) {
          dedupedTracks.set(key, track);
        }
      }

      const tracksToResolve = [...dedupedTracks.values()];
      const resolvedItems: SafeAddItem[] = [];
      let unresolvedCount = 0;
      const manualReviewIds: string[] = [];

      for (const track of tracksToResolve) {
        const response = await spotifyFetch("/api/spotify/search-candidates", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            mode: "strict",
            title: track.title,
            artist: track.artist,
            album: track.album,
            durationMs: trackDurationMs(track),
          }),
        });
        const payload = await response.json();
        if (!response.ok) {
          unresolvedCount += 1;
          continue;
        }

        const result = payload as CandidateResponse;
        if (result.confident && result.top?.uri) {
          resolvedItems.push({
            uri: result.top.uri,
            name: result.top.name,
            artists: result.top.artists,
          });
        } else {
          unresolvedCount += 1;
          manualReviewIds.push(track.id);
          setCandidatesByTrackId((state) => ({
            ...state,
            [track.id]: result,
          }));
          if (result.top?.uri) {
            const topUri = result.top.uri;
            setSelectedCandidateByTrackId((state) => ({
              ...state,
              [track.id]: topUri,
            }));
          }
        }
      }

      if (manualReviewIds.length > 0) {
        setForcedReviewTrackIds((state) => {
          const next = { ...state };
          for (const id of manualReviewIds) {
            next[id] = true;
          }
          return next;
        });
      }

      if (resolvedItems.length === 0) {
        setStatusMessage(
          `No safe Spotify matches found. Skipped unresolved: ${unresolvedCount} of ${tracksToResolve.length}.`,
        );
        return;
      }

      const addResult = await safeAddUris(resolvedItems);
      setStatusMessage(
        `Auto-add complete: ${addResult.added} added, ${addResult.skippedExisting} skipped as duplicates, ${unresolvedCount} moved to manual review. Processed ${tracksToResolve.length} unique tracks (${confidentTracks.length} before dedupe).`,
      );
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Auto-add failed.");
    } finally {
      setBusyAction(null);
    }
  };

  const addSelectedReviewTrack = async (track: TrackMatch) => {
    const uri = selectedCandidateByTrackId[track.id];
    if (!uri) {
      setStatusMessage("Choose a Spotify candidate first.");
      return;
    }

    setBusyAction(`add:${track.id}`);
    setStatusMessage(null);

    try {
      const selected = candidatesByTrackId[track.id]?.candidates.find((candidate) => candidate.uri === uri);
      const addResult = await safeAddUris([
        {
          uri,
          name: selected?.name,
          artists: selected?.artists,
        },
      ]);
      setDismissedTrackIds((state) => ({
        ...state,
        [track.id]: true,
      }));
      setStatusMessage(
        `Added: ${addResult.added}, duplicates skipped: ${addResult.skippedExisting}.`,
      );
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Failed to add selected track.");
    } finally {
      setBusyAction(null);
    }
  };

  return (
    <Card className="space-y-5">
      <div className="space-y-2">
        <p className="text-xs uppercase tracking-[0.24em] text-ink/45">Spotify Sync</p>
        <h3 className="text-xl font-semibold text-ink">
          Safe Auto-Add + Manual Review
        </h3>
        <p className="text-sm leading-6 text-ink/65">
          Confident tracks are added automatically. Ambiguous tracks require your confirmation.
        </p>
      </div>

      {!spotifyConfigured ? (
        <p className="rounded-3xl bg-apricot/20 px-4 py-3 text-sm text-ink/70">
          Spotify backend is not configured. Set `SPOTIFY_CLIENT_ID` and `SPOTIFY_CLIENT_SECRET` in proxy environment.
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        {auth ? (
          <>
            <Badge className="bg-moss/15 text-moss">Connected</Badge>
            <Button onClick={disconnectSpotify} variant="secondary">
              Disconnect
            </Button>
          </>
        ) : (
          <Button disabled={!spotifyConfigured || busyAction === "connect"} onClick={() => void connectSpotify()}>
            Connect Spotify
          </Button>
        )}
      </div>

      {auth ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex min-w-72 flex-col gap-2 text-sm text-ink/70">
              Target playlist
              <select
                className="rounded-2xl border border-ink/15 bg-white px-3 py-2 text-ink"
                onChange={(event) => setSelectedPlaylistId(event.target.value)}
                value={selectedPlaylistId}
              >
                <option value="">Select playlist...</option>
                {playlists.map((playlist) => (
                  <option key={playlist.id} value={playlist.id}>
                    {playlist.name} ({playlist.tracksTotal})
                  </option>
                ))}
              </select>
            </label>
            <Button
              disabled={busyAction === "playlists"}
              onClick={() => void loadPlaylists()}
              variant="secondary"
            >
              Refresh playlists
            </Button>
          </div>

          <div className="flex flex-wrap gap-3">
            <Button
              disabled={busyAction === "auto-add" || confidentTracks.length === 0 || !selectedPlaylistId}
              onClick={() => void autoAddConfident()}
            >
              Auto-add confident ({confidentTracks.length})
            </Button>
            <Badge className="bg-teal/10 text-teal">Review queue: {reviewTracks.length}</Badge>
          </div>
        </div>
      ) : null}

      {statusMessage ? (
        <p className="rounded-3xl bg-sand/70 px-4 py-3 text-sm text-ink/70">{statusMessage}</p>
      ) : null}

      {auth && reviewTracks.length > 0 ? (
        <div className="space-y-3">
          {reviewTracks.map((track) => {
            const candidateData = candidatesByTrackId[track.id];
            const isFinding = busyAction === `candidate:${track.id}`;
            const isAdding = busyAction === `add:${track.id}`;

            return (
              <div key={track.id} className="rounded-3xl border border-ink/10 bg-sand/60 p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="font-semibold text-ink">{track.title}</p>
                    <p className="text-sm text-ink/65">{track.artist}</p>
                    <p className="text-xs text-ink/50">
                      Confidence {Math.round(track.confidence * 100)}% - detections {track.detectionCount}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button disabled={isFinding} onClick={() => void fetchCandidates(track)} variant="secondary">
                      {candidateData ? "Refresh candidates" : "Find candidates"}
                    </Button>
                    <Button
                      onClick={() =>
                        setDismissedTrackIds((state) => ({
                          ...state,
                          [track.id]: true,
                        }))
                      }
                      variant="ghost"
                    >
                      Skip
                    </Button>
                  </div>
                </div>

                {candidateData ? (
                  <div className="space-y-2">
                    <p className="text-xs text-ink/55">
                      Candidate confidence: {candidateData.confident ? "safe to auto-add" : "manual review required"} - margin {candidateData.margin.toFixed(3)}
                    </p>
                    <div className="space-y-2">
                      {candidateData.candidates.map((candidate) => (
                        <label
                          key={candidate.uri}
                          className="flex cursor-pointer items-start gap-3 rounded-2xl border border-ink/10 bg-white/80 p-3"
                        >
                          <input
                            checked={selectedCandidateByTrackId[track.id] === candidate.uri}
                            name={`candidate-${track.id}`}
                            onChange={() =>
                              setSelectedCandidateByTrackId((state) => ({
                                ...state,
                                [track.id]: candidate.uri,
                              }))
                            }
                            type="radio"
                          />
                          <div>
                            <p className="text-sm font-semibold text-ink">{candidate.name}</p>
                            <p className="text-xs text-ink/60">{candidate.artists.join(", ")} - {candidate.album}</p>
                            <p className="text-xs text-ink/55">
                              score {candidate.score.toFixed(3)} - title {candidate.titleScore.toFixed(3)} - artist {candidate.artistScore.toFixed(3)}
                            </p>
                          </div>
                        </label>
                      ))}
                    </div>
                    <Button
                      disabled={!selectedCandidateByTrackId[track.id] || isAdding || !selectedPlaylistId}
                      onClick={() => void addSelectedReviewTrack(track)}
                    >
                      Add selected
                    </Button>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}

      {auth && job && results.length === 0 ? (
        <p className="text-sm text-ink/55">Run recognition first to sync tracks to Spotify.</p>
      ) : null}
    </Card>
  );
}
