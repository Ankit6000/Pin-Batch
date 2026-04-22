# Pin Batch PWA

A local PWA for connecting a Pinterest account, selecting many photos, and publishing them as individual image Pins in one batch.

## What it does

- Connects users through Pinterest OAuth.
- Loads the connected account's boards.
- Lets users multi-select PNG, JPG, or WebP images.
- Creates one standard Pinterest image Pin per selected photo.
- Reports success or failure for each file.

Pinterest does not allow third-party apps to bypass API rules. You still need a Pinterest developer app with the right scopes approved for your use case.

## Setup

1. Create a Pinterest developer app from [Pinterest Developers](https://developers.pinterest.com/).
2. Add this redirect URL to that app:

   ```text
   http://localhost:8787/api/pinterest/callback
   ```

3. Copy `.env.example` to `.env` and fill in your credentials.
4. Install dependencies:

   ```bash
   npm install
   ```

5. Start the app locally:

   ```bash
   npm run dev
   ```

The PWA runs at `http://localhost:5173`. The API runs at `http://localhost:8787`.

## Deploy as one app

### Render

This repo includes `render.yaml`, so Render can detect the build and start commands.

1. Push this repo to GitHub.
2. In Render, choose **New +** -> **Blueprint**.
3. Select the GitHub repo.
4. After the first deploy, set:

```text
APP_ORIGIN=https://your-render-domain.onrender.com
PINTEREST_REDIRECT_URI=https://your-render-domain.onrender.com/api/pinterest/callback
```

After Pinterest creates your developer app, add the real `PINTEREST_CLIENT_ID` and `PINTEREST_CLIENT_SECRET`.

### Manual Production Run

Build and run the production server:

```bash
npm run build
npm start
```

In production, Express serves both the API and the built PWA from one domain. Use these URLs in the Pinterest developer form:

- App link: `https://your-deployed-domain.com`
- Privacy policy: `https://your-deployed-domain.com/privacy`
- Redirect URI: `https://your-deployed-domain.com/api/pinterest/callback`

Set these environment variables on your host:

```text
NODE_ENV=production
SERVE_CLIENT=true
PINTEREST_CLIENT_ID=...
PINTEREST_CLIENT_SECRET=...
PINTEREST_REDIRECT_URI=https://your-deployed-domain.com/api/pinterest/callback
APP_ORIGIN=https://your-deployed-domain.com
SESSION_SECRET=use-a-long-random-secret
COOKIE_SECURE=true
```

## Pinterest notes

The backend uses:

- `GET /v5/boards` to list boards.
- `POST /v5/pins` with `media_source.source_type = image_base64` to create image Pins.
- OAuth scopes: `boards:read pins:read pins:write user_accounts:read`.

For production, replace the in-memory session store, set secure cookies behind HTTPS, and keep the Pinterest client secret only on the server.
