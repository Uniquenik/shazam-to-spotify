import { createServer } from "node:http";
import { randomUUID } from "node:crypto";

const port = Number(process.env.SHAZAM_PROXY_PORT || 8787);
const defaultLang = process.env.SHAZAM_LANG || "en-US";
const defaultCountry = process.env.SHAZAM_COUNTRY || "GB";
const defaultTimezone = process.env.SHAZAM_TIMEZONE || "Europe/Moscow";
const MAX_SOURCE_BYTES = 200 * 1024 * 1024;
const spotifyClientId = process.env.SPOTIFY_CLIENT_ID || "";
const spotifyClientSecret = process.env.SPOTIFY_CLIENT_SECRET || "";
const spotifyRedirectUriEnv = process.env.SPOTIFY_REDIRECT_URI || "";
const spotifyAuthStateTtlMs = 10 * 60 * 1000;
const spotifyScopes = [
  "playlist-read-private",
  "playlist-read-collaborative",
  "playlist-modify-private",
  "playlist-modify-public",
];
const spotifyAuthStates = new Map();

const SEARCH_QUERY = {
  sync: "true",
  webv3: "true",
  sampling: "true",
  connected: "",
  shazamapiversion: "v3",
  sharehub: "true",
  hubv5minorversion: "v5.1",
  hidelb: "true",
  video: "v3",
};

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.end(JSON.stringify(payload));
}

function sendHtml(res, statusCode, html) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.end(html);
}

function withCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";

    req.on("data", (chunk) => {
      raw += chunk;
    });
    req.on("end", () => {
      if (!raw) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function canonicalTrackName(value) {
  return normalizeText(value)
    .replace(/\b(remaster(?:ed)?|radio edit|extended mix|instrumental|live|mono|stereo)\b/g, " ")
    .replace(/\([^)]*\)/g, " ")
    .replace(/\[[^\]]*]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function canonicalArtistName(value) {
  const normalized = normalizeText(value);
  const stripped = normalized.split(/\bfeat\b|\bft\b|\bwith\b/)[0] || normalized;
  const primary = stripped.split(/,|&|\/|;|\|/)[0] || stripped;
  return primary.trim();
}

function canonicalArtistList(values) {
  if (!Array.isArray(values)) {
    return [];
  }

  return values
    .map((value) => canonicalArtistName(value))
    .filter(Boolean);
}

function buildNameArtistKeys(name, artists) {
  const title = canonicalTrackName(name);
  const normalizedArtists = canonicalArtistList(artists);

  if (!title || normalizedArtists.length === 0) {
    return [];
  }

  return normalizedArtists.map((artist) => `${title}::${artist}`);
}

function strictField(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function buildStrictKeys(name, artists) {
  const strictName = strictField(name);
  const artistList = Array.isArray(artists) ? artists.map((value) => strictField(value)).filter(Boolean) : [];
  const keys = [];

  for (const artist of artistList) {
    keys.push(`${strictName}::${artist}`);
  }

  return {
    strictName,
    artistList,
    keys,
  };
}

function titleMatchScore(inputTitle, candidateTitle) {
  const left = canonicalTrackName(inputTitle);
  const right = canonicalTrackName(candidateTitle);

  if (!left || !right) {
    return 0;
  }
  if (left === right) {
    return 1;
  }
  if (right.includes(left) || left.includes(right)) {
    return 0.88;
  }

  return tokenSimilarity(left, right);
}

function tokenize(value) {
  return normalizeText(value)
    .split(" ")
    .filter(Boolean);
}

function tokenSimilarity(left, right) {
  const leftTokens = tokenize(left);
  const rightTokens = tokenize(right);

  if (leftTokens.length === 0 || rightTokens.length === 0) {
    return 0;
  }

  const rightSet = new Set(rightTokens);
  const leftSet = new Set(leftTokens);
  let overlap = 0;

  for (const token of leftSet) {
    if (rightSet.has(token)) {
      overlap += 1;
    }
  }

  const union = new Set([...leftSet, ...rightSet]).size;
  return union > 0 ? overlap / union : 0;
}

function spotifyEnabled() {
  return Boolean(spotifyClientId && spotifyClientSecret);
}

function cleanupSpotifyStates() {
  const now = Date.now();

  for (const [state, createdAt] of spotifyAuthStates.entries()) {
    if (now - createdAt > spotifyAuthStateTtlMs) {
      spotifyAuthStates.delete(state);
    }
  }
}

function getSpotifyRedirectUri(req) {
  if (spotifyRedirectUriEnv) {
    return spotifyRedirectUriEnv;
  }

  const hostHeader = String(req.headers.host || "");
  let detectedPort = String(port);

  if (hostHeader) {
    try {
      const parsed = new URL(`http://${hostHeader}`);
      if (parsed.port) {
        detectedPort = parsed.port;
      }
    } catch {
      // Fallback to configured proxy port when host header is not parseable.
    }
  }

  return `http://127.0.0.1:${detectedPort}/api/spotify/callback`;
}

async function spotifyTokenExchange(code, redirectUri) {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
  });

  const authHeader = Buffer.from(`${spotifyClientId}:${spotifyClientSecret}`).toString("base64");
  const response = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${authHeader}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  const text = await response.text();

  if (!response.ok) {
    throw new Error(`Spotify token exchange failed (${response.status}): ${text}`);
  }

  return JSON.parse(text);
}

async function spotifyRefreshExchange(refreshToken) {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });

  const authHeader = Buffer.from(`${spotifyClientId}:${spotifyClientSecret}`).toString("base64");
  const response = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${authHeader}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  const text = await response.text();

  if (!response.ok) {
    throw new Error(`Spotify token refresh failed (${response.status}): ${text}`);
  }

  return JSON.parse(text);
}

function getBearerToken(req) {
  const authHeader = req.headers.authorization || "";
  if (!authHeader.toLowerCase().startsWith("bearer ")) {
    return null;
  }

  return authHeader.slice(7).trim();
}

async function spotifyApi(pathname, accessToken, options = {}) {
  const query = options.query ? `?${new URLSearchParams(options.query).toString()}` : "";
  const response = await fetch(`https://api.spotify.com/v1${pathname}${query}`, {
    method: options.method || "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const text = await response.text();

  if (!response.ok) {
    let parsedError = text;
    try {
      parsedError = JSON.parse(text);
    } catch {
      // noop
    }

    const error = new Error(`Spotify API ${pathname} failed: ${response.status}`);
    error.status = response.status;
    error.body = parsedError;
    throw error;
  }

  if (!text) {
    return null;
  }

  return JSON.parse(text);
}

async function spotifyCollectPlaylistTrackIds(playlistId, accessToken) {
  const trackIds = new Set();
  let offset = 0;
  const limit = 100;

  while (true) {
    const page = await spotifyApi(`/playlists/${playlistId}/items`, accessToken, {
      query: {
        limit: String(limit),
        offset: String(offset),
        fields: "items(track(id)),next,total",
      },
    });

    for (const item of page.items || []) {
      const id = item?.track?.id;
      if (id) {
        trackIds.add(id);
      }
    }

    if (!page.next) {
      break;
    }

    offset += limit;
  }

  return trackIds;
}

function normalizeArtistForQuery(artist) {
  const raw = String(artist || "").trim();
  if (!raw) {
    return "";
  }

  const stripped = raw.split(/\bfeat\.?\b|\bft\.?\b|\bwith\b/gi)[0] || raw;
  const primary = stripped.split(/,|&|\/|;|\|/)[0] || stripped;
  return primary.trim();
}

function dedupeSpotifyItems(items) {
  const byId = new Map();

  for (const item of items) {
    if (!item?.id || byId.has(item.id)) {
      continue;
    }
    byId.set(item.id, item);
  }

  return [...byId.values()];
}

async function spotifySearchTracks(accessToken, market, query) {
  const response = await spotifyApi("/search", accessToken, {
    query: {
      q: query,
      type: "track",
      limit: "8",
      market,
    },
  });

  return response?.tracks?.items || [];
}

function buildTagUrl(pathname, lang, country, device) {
  const query = new URLSearchParams(SEARCH_QUERY);
  return `https://amp.shazam.com/discovery/v5/${lang}/${country}/${device}/-/${pathname}?${query.toString()}`;
}

function buildTrackUrl(trackId, lang, country) {
  const query = new URLSearchParams({
    shazamapiversion: "v3",
    video: "v3",
  });
  return `https://www.shazam.com/discovery/v5/${lang}/${country}/web/-/track/${trackId}?${query.toString()}`;
}

function shazamHeaders() {
  return {
    "X-Shazam-Platform": "IPHONE",
    "X-Shazam-AppVersion": "14.1.0",
    "user-agent":
      "Dalvik/2.1.0 (Linux; U; Android 12; Pixel 6 Build/SP2A.220505.002)",
    Accept: "*/*",
    "Accept-Language": defaultLang,
    "Accept-Encoding": "gzip, deflate",
  };
}

async function postRecognizeWithFallback(upstreamBody, lang, country, device) {
  const body = JSON.stringify(upstreamBody);
  const attempts = [
    {
      upstreamUrl: buildTagUrl(
        `tag/${randomUUID()}/${randomUUID()}`,
        lang,
        country,
        device || "android",
      ),
      headers: {
        ...shazamHeaders(),
        "content-type": "application/json",
        "Accept-Language": lang,
      },
      label: `${device || "android"} | application/json`,
    },
  ];

  const debug = [];
  let lastResult = null;

  for (const attempt of attempts) {
    try {
      const response = await fetch(attempt.upstreamUrl, {
        method: "POST",
        headers: attempt.headers,
        body,
      });
      const text = await response.text();

      lastResult = {
        response,
        text,
        attempt: attempt.label,
      };

      debug.push({
        attempt: attempt.label,
        status: response.status,
        bodyLength: text.length,
      });

      if (response.ok) {
        return { ...lastResult, debug };
      }
    } catch (error) {
      debug.push({
        attempt: attempt.label,
        error: error instanceof Error ? error.message : "fetch error",
      });
    }
  }

  return { ...lastResult, debug };
}

async function getTrackWithFallback(trackId, lang, country) {
  const upstreamUrl = buildTrackUrl(trackId, lang, country);
  const response = await fetch(upstreamUrl, {
    headers: {
      ...shazamHeaders(),
      "Accept-Language": lang,
    },
  });
  const text = await response.text();
  return {
    response,
    text,
    attempt: "www.shazam.com/web-track",
    debug: [
      {
        attempt: "www.shazam.com/web-track",
        status: response.status,
        bodyLength: text.length,
      },
    ],
  };
}

async function handleRecognize(req, res) {
  const payload = await readBody(req);
  const signatureUri = payload.signatureUri;

  if (!signatureUri || typeof signatureUri !== "string") {
    sendJson(res, 400, {
      error: "signatureUri is required",
    });
    return;
  }

  const lang = String(payload.lang || defaultLang);
  const country = String(payload.country || defaultCountry);
  const device = String(payload.device || "android");
  const timezone = String(payload.timezone || defaultTimezone);
  const timestamp = Number(payload.timestamp || Date.now());
  const sampleMs = Number(payload.sampleMs || 10000);

  const upstreamBody = {
    timezone,
    signature: {
      samplems: sampleMs,
      uri: signatureUri,
    },
    timestamp,
    context: {},
    geolocation: {},
  };

  const upstream = await postRecognizeWithFallback(upstreamBody, lang, country, device);
  if (!upstream) {
    sendJson(res, 502, {
      error: "Shazam upstream request failed",
      status: 502,
      response: "No upstream attempts were completed",
    });
    return;
  }
  const upstreamRes = upstream.response;
  const text = upstream.text;

  if (!upstreamRes.ok) {
    sendJson(res, upstreamRes.status, {
      error: "Shazam upstream request failed",
      status: upstreamRes.status,
      attempt: upstream.attempt,
      response: text,
      debug: upstream.debug,
    });
    return;
  }

  try {
    sendJson(res, 200, JSON.parse(text));
  } catch {
    sendJson(res, 200, { raw: text });
  }
}

async function handleTrack(req, res, trackId) {
  const url = new URL(req.url || "", `http://${req.headers.host}`);
  const lang = url.searchParams.get("lang") || defaultLang;
  const country = url.searchParams.get("country") || defaultCountry;
  const upstream = await getTrackWithFallback(trackId, lang, country);
  if (!upstream) {
    sendJson(res, 502, {
      error: "Shazam track request failed",
      status: 502,
      response: "No upstream attempts were completed",
    });
    return;
  }
  const upstreamRes = upstream.response;
  const text = upstream.text;

  if (!upstreamRes.ok) {
    sendJson(res, upstreamRes.status, {
      error: "Shazam track request failed",
      status: upstreamRes.status,
      response: text,
      attempt: upstream.attempt,
      debug: upstream.debug,
    });
    return;
  }

  try {
    sendJson(res, 200, JSON.parse(text));
  } catch {
    sendJson(res, 200, { raw: text });
  }
}

async function handleFetchAudio(req, res) {
  const payload = await readBody(req);
  const rawUrl = payload.url;

  if (!rawUrl || typeof rawUrl !== "string") {
    sendJson(res, 400, { error: "url is required" });
    return;
  }

  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    sendJson(res, 400, { error: "invalid url" });
    return;
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    sendJson(res, 400, { error: "only http/https urls are allowed" });
    return;
  }

  const upstream = await fetch(url, {
    method: "GET",
    redirect: "follow",
  });

  if (!upstream.ok) {
    sendJson(res, upstream.status, {
      error: "audio source is unavailable",
      status: upstream.status,
    });
    return;
  }

  const contentType = upstream.headers.get("content-type") || "application/octet-stream";
  const contentLengthRaw = upstream.headers.get("content-length");
  const contentLength = contentLengthRaw ? Number(contentLengthRaw) : NaN;

  if (Number.isFinite(contentLength) && contentLength > MAX_SOURCE_BYTES) {
    sendJson(res, 413, { error: "audio source is too large" });
    return;
  }

  res.statusCode = 200;
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Content-Type", contentType);
  if (Number.isFinite(contentLength)) {
    res.setHeader("Content-Length", String(contentLength));
  }

  const reader = upstream.body?.getReader();

  if (!reader) {
    const bytes = new Uint8Array(await upstream.arrayBuffer());
    if (bytes.byteLength > MAX_SOURCE_BYTES) {
      sendJson(res, 413, { error: "audio source is too large" });
      return;
    }
    res.end(Buffer.from(bytes));
    return;
  }

  let transferred = 0;

  while (true) {
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    if (!value) {
      continue;
    }

    transferred += value.byteLength;

    if (transferred > MAX_SOURCE_BYTES) {
      res.destroy(new Error("audio source is too large"));
      return;
    }

    res.write(Buffer.from(value));
  }

  res.end();
}

function stripFeaturing(value) {
  return String(value || "")
    .replace(/\(.*?\bfeat\.?.*?\)/gi, " ")
    .replace(/\bfeat\.?.*$/gi, " ")
    .replace(/\bft\.?.*$/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeSpotifyCandidate(raw, input, mode = "strict") {
  const titleScore = titleMatchScore(input.title, raw.name);
  const artistNames = (raw.artists || []).map((artist) => artist.name).join(" ");
  const artistScore = tokenSimilarity(input.artist, artistNames);
  const artistRelaxedScore = tokenSimilarity(stripFeaturing(input.artist), artistNames);
  const effectiveArtistScore = mode === "manual" ? Math.max(artistScore, artistRelaxedScore) : artistScore;
  const albumScore = input.album ? tokenSimilarity(input.album, raw.album?.name || "") : 0.5;
  const durationDiffMs =
    typeof input.durationMs === "number" && typeof raw.duration_ms === "number"
      ? Math.abs(input.durationMs - raw.duration_ms)
      : 0;
  const durationScore =
    typeof input.durationMs === "number" && input.durationMs > 0
      ? Math.max(0, 1 - durationDiffMs / Math.max(input.durationMs * 0.25, 12_000))
      : 0.7;
  const popularityScore = Math.min(1, (raw.popularity ?? 0) / 100);

  const exactTitleBoost = titleScore >= 0.99 ? 0.12 : 0;
  const score =
    mode === "manual"
      ? titleScore * 0.66 + effectiveArtistScore * 0.12 + albumScore * 0.04 + durationScore * 0.12 + popularityScore * 0.06 + exactTitleBoost
      : titleScore * 0.42 + effectiveArtistScore * 0.34 + albumScore * 0.09 + durationScore * 0.1 + popularityScore * 0.05;

  return {
    id: raw.id,
    uri: raw.uri,
    name: raw.name,
    artists: (raw.artists || []).map((artist) => artist.name),
    album: raw.album?.name || "Unknown album",
    durationMs: raw.duration_ms,
    popularity: raw.popularity ?? 0,
    score: Number(score.toFixed(4)),
    titleScore: Number(titleScore.toFixed(4)),
    artistScore: Number(effectiveArtistScore.toFixed(4)),
    durationScore: Number(durationScore.toFixed(4)),
    durationDiffMs,
  };
}

function isCandidateConfident(topCandidate, secondCandidate) {
  if (!topCandidate) {
    return false;
  }

  const margin = secondCandidate ? topCandidate.score - secondCandidate.score : topCandidate.score;
  return (
    topCandidate.score >= 0.86 &&
    topCandidate.titleScore >= 0.9 &&
    topCandidate.artistScore >= 0.9 &&
    margin >= 0.08
  );
}

async function handleSpotifyConfig(req, res) {
  sendJson(res, 200, {
    enabled: spotifyEnabled(),
    clientIdConfigured: Boolean(spotifyClientId),
    redirectUri: getSpotifyRedirectUri(req),
  });
}

async function handleSpotifyAuthUrl(req, res) {
  if (!spotifyEnabled()) {
    sendJson(res, 503, {
      error: "Spotify is not configured on backend. Set SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET.",
    });
    return;
  }

  cleanupSpotifyStates();
  const state = randomUUID();
  spotifyAuthStates.set(state, Date.now());
  const redirectUri = getSpotifyRedirectUri(req);
  const authUrl = new URL("https://accounts.spotify.com/authorize");

  authUrl.searchParams.set("client_id", spotifyClientId);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("scope", spotifyScopes.join(" "));
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("show_dialog", "true");

  sendJson(res, 200, {
    state,
    url: authUrl.toString(),
  });
}

async function handleSpotifyCallback(req, res) {
  const url = new URL(req.url || "", `http://${req.headers.host}`);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const callbackError = url.searchParams.get("error");

  if (callbackError) {
    sendHtml(
      res,
      400,
      `<html><body><h3>Spotify auth failed</h3><p>${escapeHtml(callbackError)}</p></body></html>`,
    );
    return;
  }

  cleanupSpotifyStates();

  if (!code || !state || !spotifyAuthStates.has(state)) {
    sendHtml(
      res,
      400,
      "<html><body><h3>Spotify auth failed</h3><p>Invalid or expired state.</p></body></html>",
    );
    return;
  }

  spotifyAuthStates.delete(state);

  try {
    const tokenPayload = await spotifyTokenExchange(code, getSpotifyRedirectUri(req));
    const safePayload = {
      accessToken: tokenPayload.access_token,
      refreshToken: tokenPayload.refresh_token,
      expiresIn: tokenPayload.expires_in,
      tokenType: tokenPayload.token_type,
      scope: tokenPayload.scope,
      issuedAt: Date.now(),
    };

    const serialized = JSON.stringify(safePayload);
    sendHtml(
      res,
      200,
      `<html><body><script>
      (function(){
        const payload = ${serialized};
        if (window.opener) {
          window.opener.postMessage({ type: "spotify-auth-success", payload }, "*");
        }
        window.close();
      })();
      </script><p>Spotify connected. You can close this window.</p></body></html>`,
    );
  } catch (error) {
    sendHtml(
      res,
      500,
      `<html><body><h3>Spotify auth failed</h3><p>${escapeHtml(
        error instanceof Error ? error.message : "Unknown error",
      )}</p></body></html>`,
    );
  }
}

async function handleSpotifyRefresh(req, res) {
  if (!spotifyEnabled()) {
    sendJson(res, 503, { error: "Spotify is not configured on backend." });
    return;
  }

  const body = await readBody(req);
  const refreshToken = body.refreshToken;

  if (!refreshToken || typeof refreshToken !== "string") {
    sendJson(res, 400, { error: "refreshToken is required" });
    return;
  }

  try {
    const tokenPayload = await spotifyRefreshExchange(refreshToken);
    sendJson(res, 200, {
      accessToken: tokenPayload.access_token,
      refreshToken: tokenPayload.refresh_token || refreshToken,
      expiresIn: tokenPayload.expires_in,
      tokenType: tokenPayload.token_type,
      scope: tokenPayload.scope,
      issuedAt: Date.now(),
    });
  } catch (error) {
    sendJson(res, 500, {
      error: error instanceof Error ? error.message : "Spotify refresh failed",
    });
  }
}

async function handleSpotifyPlaylists(req, res) {
  const accessToken = getBearerToken(req);

  if (!accessToken) {
    sendJson(res, 401, { error: "Authorization Bearer token is required." });
    return;
  }

  try {
    const page = await spotifyApi("/me/playlists", accessToken, {
      query: {
        limit: "50",
        offset: "0",
      },
    });

    const playlists = (page.items || []).map((item) => ({
      id: item.id,
      name: item.name,
      owner: item.owner?.display_name || item.owner?.id || "Unknown",
      public: item.public,
      tracksTotal: item.tracks?.total ?? 0,
    }));

    sendJson(res, 200, {
      items: playlists,
      total: page.total ?? playlists.length,
    });
  } catch (error) {
    sendJson(res, error.status || 500, {
      error: error instanceof Error ? error.message : "Spotify playlists request failed",
      details: error.body,
    });
  }
}

async function handleSpotifyPlaylistTrackIds(req, res, playlistId) {
  const accessToken = getBearerToken(req);

  if (!accessToken) {
    sendJson(res, 401, { error: "Authorization Bearer token is required." });
    return;
  }

  try {
    const ids = await spotifyCollectPlaylistTrackIds(playlistId, accessToken);
    sendJson(res, 200, {
      trackIds: [...ids],
      total: ids.size,
    });
  } catch (error) {
    sendJson(res, error.status || 500, {
      error: error instanceof Error ? error.message : "Spotify playlist items request failed",
      details: error.body,
    });
  }
}

async function handleSpotifySearchCandidates(req, res) {
  const accessToken = getBearerToken(req);

  if (!accessToken) {
    sendJson(res, 401, { error: "Authorization Bearer token is required." });
    return;
  }

  const body = await readBody(req);
  const title = body.title;
  const artist = body.artist;
  const album = body.album;
  const durationMs = body.durationMs;
  const market = body.market || "US";
  const mode = body.mode === "manual" ? "manual" : "strict";

  if (!title || !artist) {
    sendJson(res, 400, { error: "title and artist are required" });
    return;
  }

  try {
    const artistPrimary = normalizeArtistForQuery(artist);
    const titleWithoutFeat = stripFeaturing(title);
    const titleTokens = tokenize(title);
    const shortTitle = titleTokens.slice(0, Math.min(4, titleTokens.length)).join(" ");
    const searchQueries =
      mode === "manual"
        ? [
            `"${title}"`,
            `track:${title} artist:${artistPrimary || artist}`,
            `${title} ${artistPrimary || artist}`,
            `track:${titleWithoutFeat}`,
            `${titleWithoutFeat} ${artistPrimary || ""}`.trim(),
            `${title}`,
            artistPrimary ? `${artistPrimary} ${title}` : "",
            shortTitle,
            artistPrimary || "",
          ].filter(Boolean)
        : [
            `track:${title} artist:${artistPrimary || artist}`,
            `${title} ${artistPrimary || artist}`,
            `${title}`,
          ];
    const queryResults = [];

    for (const query of searchQueries) {
      const items = await spotifySearchTracks(accessToken, market, query);
      queryResults.push(...items);
    }

    const rawItems = dedupeSpotifyItems(queryResults);
    const scored = rawItems
      .map((item) =>
        normalizeSpotifyCandidate(item, {
          title,
          artist,
          album,
          durationMs: typeof durationMs === "number" ? durationMs : undefined,
        }, mode),
      )
      .sort((left, right) => right.score - left.score);

    const topCandidates = scored.slice(0, mode === "manual" ? 5 : 8);
    const relaxedTop = topCandidates[0] || null;
    const relaxedSecond = topCandidates[1] || null;
    const relaxedMargin =
      relaxedTop && relaxedSecond
        ? Number((relaxedTop.score - relaxedSecond.score).toFixed(4))
        : relaxedTop
          ? relaxedTop.score
          : 0;

    const top = scored[0] || null;
    const second = scored[1] || null;

    sendJson(res, 200, {
      confident: isCandidateConfident(top, second),
      margin: relaxedMargin,
      top: relaxedTop,
      candidates: topCandidates,
      mode,
    });
  } catch (error) {
    sendJson(res, error.status || 500, {
      error: error instanceof Error ? error.message : "Spotify search failed",
      details: error.body,
    });
  }
}

async function handleSpotifySafeAdd(req, res, playlistId) {
  const accessToken = getBearerToken(req);

  if (!accessToken) {
    sendJson(res, 401, { error: "Authorization Bearer token is required." });
    return;
  }

  const body = await readBody(req);
  const items = Array.isArray(body.items)
    ? body.items
        .filter((item) => item && typeof item === "object" && typeof item.uri === "string")
        .map((item) => ({
          uri: item.uri,
          name: typeof item.name === "string" ? item.name : "",
          artists: Array.isArray(item.artists) ? item.artists.filter((artist) => typeof artist === "string") : [],
        }))
    : [];
  const uris = items.map((item) => item.uri);

  if (uris.length === 0) {
    sendJson(res, 400, { error: "items must contain at least one Spotify track URI" });
    return;
  }

  try {
    const existingIds = await spotifyCollectPlaylistTrackIds(playlistId, accessToken);
    const uniqueUris = [...new Set(uris)];
    const filteredUris = uniqueUris.filter((uri) => {
      const id = uri.split(":").pop() || "";
      return id && !existingIds.has(id);
    });

    const existingKeys = new Set();
    const existingPreview = [];
    let offset = 0;
    const limit = 100;

    let pageIndex = 0;
    while (true) {
      const page = await spotifyApi(`/playlists/${playlistId}/items`, accessToken, {
        query: {
          limit: String(limit),
          offset: String(offset),
          market: "from_token",
          additional_types: "track",
          fields: "items(is_local,track(id,name,artists(name),type),item(id,name,artists(name),type)),next",
        },
      });
      const pageItems = Array.isArray(page.items) ? page.items : [];
      let nullTrackCount = 0;
      for (const entry of pageItems) {
        const rawTrack = entry?.track ?? entry?.item ?? null;
        if (!rawTrack) {
          nullTrackCount += 1;
        }
      }

      // eslint-disable-next-line no-console
      console.log("[spotify-safe-add] playlist-page", {
        playlistId,
        pageIndex,
        offset,
        limit,
        itemsCount: pageItems.length,
        nullTrackCount,
        hasNext: Boolean(page.next),
        firstItem: pageItems[0]
          ? {
              hasTrack: Boolean(pageItems[0].track),
              trackName: (pageItems[0]?.track ?? pageItems[0]?.item)?.name || null,
              trackArtists: ((pageItems[0]?.track ?? pageItems[0]?.item)?.artists || []).map((artist) => artist?.name || ""),
            }
          : null,
      });
      // eslint-disable-next-line no-console
      console.log("[spotify-safe-add] playlist-page-raw", {
        playlistId,
        pageIndex,
        rawSample: pageItems.slice(0, 3).map((entry, index) => ({
          index,
          trackType: entry?.track?.type || null,
          trackId: (entry?.track ?? entry?.item)?.id || null,
          trackName: (entry?.track ?? entry?.item)?.name || null,
          trackArtists: Array.isArray((entry?.track ?? entry?.item)?.artists)
            ? (entry.track ?? entry.item).artists.map((artist) => ({
                id: artist?.id || null,
                name: artist?.name || null,
              }))
            : null,
          isLocal: Boolean(entry?.is_local),
        })),
      });

      for (const item of page.items || []) {
        const trackObject = item?.track ?? item?.item ?? null;
        const trackName = trackObject?.name || "";
        const trackArtists = (trackObject?.artists || []).map((artist) => artist?.name || "");
        const { strictName, artistList, keys } = buildStrictKeys(trackName, trackArtists);
        for (const key of keys) {
          existingKeys.add(key);
        }
        if (strictName && artistList.length > 0 && existingPreview.length < 20) {
          existingPreview.push({
            name: strictName,
            artists: artistList,
            keys,
          });
        }
      }

      if (!page.next) {
        break;
      }
      offset += limit;
      pageIndex += 1;
    }

    if (filteredUris.length === 0) {
      sendJson(res, 200, {
        added: 0,
        skippedExisting: uniqueUris.length,
        snapshotId: null,
      });
      return;
    }

    const dedupedByNameArtist = [];
    const batchKeys = new Set();

    for (const item of items) {
      if (!filteredUris.includes(item.uri)) {
        continue;
      }

      const strictCandidate = buildStrictKeys(item.name, item.artists || []);
      const candidateKeys = strictCandidate.keys;
      const hasAnyKeys = candidateKeys.length > 0;
      const duplicateByNameArtist =
        hasAnyKeys &&
        candidateKeys.some((key) => existingKeys.has(key) || batchKeys.has(key));

      // eslint-disable-next-line no-console
      console.log("[spotify-safe-add] candidate-check", {
        playlistId,
        uri: item.uri,
        inputName: item.name || "",
        inputArtists: item.artists || [],
        strictName: strictCandidate.strictName,
        strictArtists: strictCandidate.artistList,
        strictKeys: candidateKeys,
        duplicateByNameArtist,
      });

      if (duplicateByNameArtist) {
        // eslint-disable-next-line no-console
        console.log("[spotify-safe-add] skipped-duplicate", {
          uri: item.uri,
          strictKeys: candidateKeys,
          reason: "name+artist key already exists in playlist or batch",
        });
        continue;
      }

      for (const key of candidateKeys) {
        batchKeys.add(key);
      }
      dedupedByNameArtist.push(item.uri);
    }

    // eslint-disable-next-line no-console
    console.log("[spotify-safe-add] summary", {
      playlistId,
      requestedCount: items.length,
      uniqueUriCount: uniqueUris.length,
      filteredByIdCount: filteredUris.length,
      addAfterNameArtistCheck: dedupedByNameArtist.length,
      existingKeyCount: existingKeys.size,
      existingPreview,
    });

    if (dedupedByNameArtist.length === 0) {
      sendJson(res, 200, {
        added: 0,
        skippedExisting: uniqueUris.length,
        snapshotId: null,
      });
      return;
    }

    const result = await spotifyApi(`/playlists/${playlistId}/items`, accessToken, {
      method: "POST",
      body: {
        uris: dedupedByNameArtist,
      },
    });

    sendJson(res, 200, {
      added: dedupedByNameArtist.length,
      skippedExisting: uniqueUris.length - dedupedByNameArtist.length,
      snapshotId: result?.snapshot_id ?? null,
    });
  } catch (error) {
    sendJson(res, error.status || 500, {
      error: error instanceof Error ? error.message : "Spotify add failed",
      details: error.body,
    });
  }
}

const server = createServer(async (req, res) => {
  withCors(res);

  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return;
  }

  const url = new URL(req.url || "/", `http://${req.headers.host}`);

  try {
    if (req.method === "POST" && url.pathname === "/api/recognize") {
      await handleRecognize(req, res);
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/spotify/config") {
      await handleSpotifyConfig(req, res);
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/spotify/auth-url") {
      await handleSpotifyAuthUrl(req, res);
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/spotify/callback") {
      await handleSpotifyCallback(req, res);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/spotify/refresh") {
      await handleSpotifyRefresh(req, res);
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/spotify/playlists") {
      await handleSpotifyPlaylists(req, res);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/spotify/search-candidates") {
      await handleSpotifySearchCandidates(req, res);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/fetch-audio") {
      await handleFetchAudio(req, res);
      return;
    }

    if (req.method === "GET" && url.pathname.startsWith("/api/spotify/playlists/") && url.pathname.endsWith("/track-ids")) {
      const playlistId = decodeURIComponent(
        url.pathname.replace("/api/spotify/playlists/", "").replace("/track-ids", ""),
      );

      if (!playlistId) {
        sendJson(res, 400, { error: "playlist id is required" });
        return;
      }

      await handleSpotifyPlaylistTrackIds(req, res, playlistId);
      return;
    }

    if (req.method === "POST" && url.pathname.startsWith("/api/spotify/playlists/") && url.pathname.endsWith("/safe-add")) {
      const playlistId = decodeURIComponent(
        url.pathname.replace("/api/spotify/playlists/", "").replace("/safe-add", ""),
      );

      if (!playlistId) {
        sendJson(res, 400, { error: "playlist id is required" });
        return;
      }

      await handleSpotifySafeAdd(req, res, playlistId);
      return;
    }

    if (req.method === "GET" && url.pathname.startsWith("/api/track/")) {
      const trackId = decodeURIComponent(url.pathname.replace("/api/track/", ""));
      if (!trackId) {
        sendJson(res, 400, { error: "track id is required" });
        return;
      }

      await handleTrack(req, res, trackId);
      return;
    }

    sendJson(res, 404, { error: "Not found" });
  } catch (error) {
    sendJson(res, 500, {
      error: error instanceof Error ? error.message : "Proxy internal error",
    });
  }
});

server.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`[shazam-proxy] listening on http://localhost:${port}`);
});
