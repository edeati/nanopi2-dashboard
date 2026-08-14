'use strict';

const crypto = require('crypto');
const fs = require('fs');
const https = require('https');
const http = require('http');
const { URL, URLSearchParams } = require('url');

const AUTHORIZE_URL = 'https://oauth.beatbot.com/oauth2/authorize';
const TOKEN_URL = 'https://oauth.beatbot.com/oauth2/token';
const CLIENT_ID = 'home-assistant';
const SCOPE = 'device:info';

// In-memory PKCE state store keyed by `state` param. Cleared after use.
const pendingPkce = new Map();

function base64url(buf) {
  return buf.toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function generatePkce() {
  const verifier = base64url(crypto.randomBytes(32));
  const challenge = base64url(
    crypto.createHash('sha256').update(verifier).digest()
  );
  return { verifier, challenge };
}

function generateState() {
  return base64url(crypto.randomBytes(16));
}

/**
 * Build the redirect URL the user must visit to begin OAuth.
 * Stores the PKCE verifier against the generated state string.
 * @param {string} redirectUri  Dashboard callback URL
 * @returns {{ url: string, state: string }}
 */
function buildAuthUrl(redirectUri) {
  const { verifier, challenge } = generatePkce();
  const state = generateState();
  pendingPkce.set(state, { verifier, ts: Date.now() });

  // Evict any pending states older than 30 minutes
  const cutoff = Date.now() - 30 * 60 * 1000;
  for (const [k, v] of pendingPkce.entries()) {
    if (v.ts < cutoff) {
      pendingPkce.delete(k);
    }
  }

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: CLIENT_ID,
    redirect_uri: redirectUri,
    scope: SCOPE,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state
  });
  return { url: AUTHORIZE_URL + '?' + params.toString(), state };
}

/**
 * Decode a JWT access token payload (no signature verification).
 * @param {string} token
 * @returns {object|null}
 */
function decodeAccessToken(token) {
  try {
    const parts = String(token || '').split('.');
    if (parts.length < 2) {
      return null;
    }
    const padded = parts[1] + '='.repeat((4 - parts[1].length % 4) % 4);
    const json = Buffer.from(padded, 'base64').toString('utf8');
    const claims = JSON.parse(json);
    return typeof claims === 'object' && claims !== null ? claims : null;
  } catch (_err) {
    return null;
  }
}

function postForm(urlString, params) {
  return new Promise((resolve, reject) => {
    const body = new URLSearchParams(params).toString();
    const parsed = new URL(urlString);
    const isHttps = parsed.protocol === 'https:';
    const mod = isHttps ? https : http;
    const port = parsed.port ? Number(parsed.port) : (isHttps ? 443 : 80);
    const options = {
      hostname: parsed.hostname,
      port,
      path: parsed.pathname + (parsed.search || ''),
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body)
      }
    };
    const req = mod.request(options, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode >= 400) {
          return reject(new Error('Token request failed: HTTP ' + res.statusCode + ' ' + data));
        }
        try {
          resolve(JSON.parse(data));
        } catch (err) {
          reject(new Error('Token response is not JSON: ' + data));
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(30000, () => {
      req.destroy(new Error('Token request timed out'));
    });
    req.write(body);
    req.end();
  });
}

/**
 * Exchange an authorization code for tokens.
 * Consumes and removes the pending PKCE state.
 * @param {string} code
 * @param {string} state
 * @param {string} redirectUri
 * @returns {Promise<{accessToken, refreshToken, expiresAt, region}>}
 */
async function exchangeCode(code, state, redirectUri) {
  const pending = pendingPkce.get(state);
  if (!pending) {
    throw new Error('Unknown or expired OAuth state');
  }
  pendingPkce.delete(state);

  const json = await postForm(TOKEN_URL, {
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    client_id: CLIENT_ID,
    code_verifier: pending.verifier
  });

  return parseTokenResponse(json);
}

/**
 * Refresh an access token using a refresh token.
 * @param {string} refreshToken
 * @returns {Promise<{accessToken, refreshToken, expiresAt, region}>}
 */
async function refreshAccessToken(refreshToken) {
  const json = await postForm(TOKEN_URL, {
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: CLIENT_ID
  });
  return parseTokenResponse(json);
}

function parseTokenResponse(json) {
  const accessToken = String(json.access_token || '');
  const refreshToken = String(json.refresh_token || '');
  if (!accessToken) {
    throw new Error('Token response missing access_token');
  }
  const expiresIn = Number(json.expires_in || 3600);
  const expiresAt = Date.now() + (expiresIn - 60) * 1000; // 1 min safety margin

  const claims = decodeAccessToken(accessToken);
  // Region claim confirmed from Beatbot HA config_flow: claims.get("region")
  const region = String((claims && claims.region) || '').trim().toLowerCase();
  if (!region) {
    throw new Error('Beatbot access token does not contain a region claim — check your Beatbot account region');
  }
  if (!['cn', 'na', 'eu'].includes(region)) {
    throw new Error('Unknown Beatbot region in token: ' + region);
  }

  return { accessToken, refreshToken, expiresAt, region };
}

/**
 * Load stored tokens from disk. Returns null if file absent or corrupt.
 * @param {string} tokensPath
 * @returns {{accessToken, refreshToken, expiresAt, region}|null}
 */
function loadTokens(tokensPath) {
  try {
    const raw = fs.readFileSync(tokensPath, 'utf8');
    const data = JSON.parse(raw);
    if (!data.accessToken || !data.refreshToken) {
      return null;
    }
    return {
      accessToken: String(data.accessToken),
      refreshToken: String(data.refreshToken),
      expiresAt: Number(data.expiresAt || 0),
      region: String(data.region || 'na')
    };
  } catch (_err) {
    return null;
  }
}

/**
 * Persist tokens to disk atomically. Never logs token values.
 * @param {string} tokensPath
 * @param {{accessToken, refreshToken, expiresAt, region}} tokens
 */
function saveTokens(tokensPath, tokens) {
  const payload = JSON.stringify({
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    expiresAt: tokens.expiresAt,
    region: tokens.region
  }, null, 2);
  const tmp = tokensPath + '.tmp.' + process.pid;
  fs.writeFileSync(tmp, payload, 'utf8');
  fs.renameSync(tmp, tokensPath);
}

/**
 * Return a valid access token, refreshing from disk if expired.
 * Mutates and re-saves tokens if a refresh occurs.
 * @param {string} tokensPath
 * @returns {Promise<{accessToken: string, region: string}>}
 */
async function getValidAccessToken(tokensPath) {
  let tokens = loadTokens(tokensPath);
  if (!tokens) {
    throw new Error('beatbot_not_authenticated');
  }
  if (Date.now() < tokens.expiresAt) {
    return { accessToken: tokens.accessToken, region: tokens.region };
  }
  // Token expired — refresh
  const refreshed = await refreshAccessToken(tokens.refreshToken);
  const merged = {
    accessToken: refreshed.accessToken,
    refreshToken: refreshed.refreshToken || tokens.refreshToken,
    expiresAt: refreshed.expiresAt,
    region: refreshed.region || tokens.region
  };
  saveTokens(tokensPath, merged);
  return { accessToken: merged.accessToken, region: merged.region };
}

module.exports = {
  buildAuthUrl,
  exchangeCode,
  refreshAccessToken,
  decodeAccessToken,
  loadTokens,
  saveTokens,
  getValidAccessToken
};
