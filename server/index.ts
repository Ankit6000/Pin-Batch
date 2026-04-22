import 'dotenv/config';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import session from 'express-session';
import multer from 'multer';

const app = express();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024, files: 50 }
});

const PORT = Number(process.env.PORT || 8787);
const APP_ORIGIN = process.env.APP_ORIGIN || `http://localhost:${PORT}`;
const PINTEREST_CLIENT_ID = process.env.PINTEREST_CLIENT_ID || '';
const PINTEREST_CLIENT_SECRET = process.env.PINTEREST_CLIENT_SECRET || '';
const PINTEREST_REDIRECT_URI =
  process.env.PINTEREST_REDIRECT_URI || `http://localhost:${PORT}/api/pinterest/callback`;
const PINTEREST_API_BASE = 'https://api.pinterest.com/v5';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientDistPath = path.resolve(__dirname, '../dist');
const shouldServeClient = process.env.SERVE_CLIENT === 'true' || process.env.NODE_ENV === 'production';
const useSecureCookies = process.env.COOKIE_SECURE ? process.env.COOKIE_SECURE === 'true' : process.env.NODE_ENV === 'production';

declare module 'express-session' {
  interface SessionData {
    pinterestAccessToken?: string;
    pinterestRefreshToken?: string;
    pinterestTokenExpiresAt?: number;
    pinterestState?: string;
  }
}

type PinterestBoard = {
  id: string;
  name: string;
  privacy?: string;
  pin_count?: number;
};

type PinterestError = {
  code?: number | string;
  message?: string;
  details?: unknown;
};

app.use(express.json({ limit: '2mb' }));
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'dev-only-change-me',
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: useSecureCookies,
      maxAge: 1000 * 60 * 60 * 24 * 14
    }
  })
);

if (shouldServeClient) {
  app.set('trust proxy', 1);
}

function ensureConfigured() {
  return Boolean(
    PINTEREST_CLIENT_ID &&
      PINTEREST_CLIENT_SECRET &&
      !PINTEREST_CLIENT_ID.includes('paste_your') &&
      !PINTEREST_CLIENT_SECRET.includes('paste_your')
  );
}

function requirePinterestToken(req: express.Request, res: express.Response) {
  const token = req.session.pinterestAccessToken;
  if (!token) {
    res.status(401).json({ error: 'Pinterest account is not connected.' });
    return null;
  }
  return token;
}

async function pinterestFetch<T>(path: string, token: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${PINTEREST_API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init?.headers || {})
    }
  });

  if (!response.ok) {
    let body: PinterestError | string = await response.text();
    try {
      body = JSON.parse(body);
    } catch {
      // Keep text when Pinterest returns a non-JSON error page.
    }
    const message = typeof body === 'string' ? body : body.message || 'Pinterest API request failed.';
    throw Object.assign(new Error(message), { status: response.status, body });
  }

  return (await response.json()) as T;
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, configured: ensureConfigured() });
});

app.get('/api/pinterest/status', (req, res) => {
  res.json({
    configured: ensureConfigured(),
    connected: Boolean(req.session.pinterestAccessToken),
    expiresAt: req.session.pinterestTokenExpiresAt || null
  });
});

app.get('/api/pinterest/auth-url', (req, res) => {
  if (!ensureConfigured()) {
    res.status(500).json({
      error: 'Pinterest OAuth is not configured. Add PINTEREST_CLIENT_ID and PINTEREST_CLIENT_SECRET to .env.'
    });
    return;
  }

  const state = crypto.randomBytes(24).toString('hex');
  req.session.pinterestState = state;
  const url = new URL('https://www.pinterest.com/oauth/');
  url.searchParams.set('client_id', PINTEREST_CLIENT_ID);
  url.searchParams.set('redirect_uri', PINTEREST_REDIRECT_URI);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'boards:read pins:read pins:write user_accounts:read');
  url.searchParams.set('state', state);

  res.json({ url: url.toString() });
});

app.get('/api/pinterest/callback', async (req, res) => {
  const { code, state, error, error_description } = req.query;

  if (error) {
    res.redirect(`${APP_ORIGIN}/?pinterest_error=${encodeURIComponent(String(error_description || error))}`);
    return;
  }

  if (!code || state !== req.session.pinterestState) {
    res.redirect(`${APP_ORIGIN}/?pinterest_error=${encodeURIComponent('OAuth state check failed.')}`);
    return;
  }

  try {
    const basic = Buffer.from(`${PINTEREST_CLIENT_ID}:${PINTEREST_CLIENT_SECRET}`).toString('base64');
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code: String(code),
      redirect_uri: PINTEREST_REDIRECT_URI
    });

    const tokenResponse = await fetch(`${PINTEREST_API_BASE}/oauth/token`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basic}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body
    });

    if (!tokenResponse.ok) {
      const message = await tokenResponse.text();
      throw new Error(message);
    }

    const tokenData = (await tokenResponse.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
    };

    req.session.pinterestAccessToken = tokenData.access_token;
    req.session.pinterestRefreshToken = tokenData.refresh_token;
    req.session.pinterestTokenExpiresAt = tokenData.expires_in
      ? Date.now() + tokenData.expires_in * 1000
      : undefined;
    req.session.pinterestState = undefined;

    res.redirect(`${APP_ORIGIN}/?connected=pinterest`);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Pinterest OAuth failed.';
    res.redirect(`${APP_ORIGIN}/?pinterest_error=${encodeURIComponent(message)}`);
  }
});

app.post('/api/pinterest/disconnect', (req, res) => {
  req.session.pinterestAccessToken = undefined;
  req.session.pinterestRefreshToken = undefined;
  req.session.pinterestTokenExpiresAt = undefined;
  res.json({ connected: false });
});

app.get('/api/pinterest/boards', async (req, res) => {
  const token = requirePinterestToken(req, res);
  if (!token) return;

  try {
    const boards: PinterestBoard[] = [];
    let bookmark: string | undefined;

    do {
      const qs = new URLSearchParams({ page_size: '100' });
      if (bookmark) qs.set('bookmark', bookmark);
      const page = await pinterestFetch<{ items?: PinterestBoard[]; bookmark?: string }>(
        `/boards?${qs.toString()}`,
        token
      );
      boards.push(...(page.items || []));
      bookmark = page.bookmark;
    } while (bookmark);

    res.json({ boards });
  } catch (err) {
    const status = typeof (err as { status?: unknown }).status === 'number' ? (err as { status: number }).status : 500;
    res.status(status).json({ error: err instanceof Error ? err.message : 'Unable to load Pinterest boards.' });
  }
});

app.post('/api/pinterest/pins/batch', upload.array('photos', 50), async (req, res) => {
  const token = requirePinterestToken(req, res);
  if (!token) return;

  const files = (req.files || []) as Express.Multer.File[];
  const { boardId, title, description, link, altText } = req.body as Record<string, string>;

  if (!boardId) {
    res.status(400).json({ error: 'Choose a Pinterest board before publishing.' });
    return;
  }

  if (!files.length) {
    res.status(400).json({ error: 'Select at least one photo.' });
    return;
  }

  const results = [];

  for (const file of files) {
    try {
      const created = await pinterestFetch<{ id: string; link?: string }>(`/pins`, token, {
        method: 'POST',
        body: JSON.stringify({
          board_id: boardId,
          title: title || file.originalname.replace(/\.[^.]+$/, ''),
          description: description || undefined,
          link: link || undefined,
          alt_text: altText || title || file.originalname,
          media_source: {
            source_type: 'image_base64',
            content_type: file.mimetype,
            data: file.buffer.toString('base64')
          }
        })
      });

      results.push({ fileName: file.originalname, ok: true, pinId: created.id, link: created.link || null });
    } catch (err) {
      results.push({
        fileName: file.originalname,
        ok: false,
        error: err instanceof Error ? err.message : 'Pin creation failed.'
      });
    }
  }

  res.json({
    total: files.length,
    created: results.filter((result) => result.ok).length,
    failed: results.filter((result) => !result.ok).length,
    results
  });
});

if (shouldServeClient) {
  app.use(express.static(clientDistPath));
  app.get(/^(?!\/api).*/, (_req, res) => {
    res.sendFile(path.join(clientDistPath, 'index.html'));
  });
}

app.listen(PORT, () => {
  console.log(`Pinterest batch API listening on http://localhost:${PORT}`);
});
