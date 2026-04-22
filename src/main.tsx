import React from 'react';
import { createRoot } from 'react-dom/client';
import {
  BadgeCheck,
  Cable,
  CheckCircle2,
  CircleAlert,
  CloudUpload,
  ImagePlus,
  Loader2,
  LogOut,
  RefreshCw,
  Send,
  Trash2,
  WifiOff
} from 'lucide-react';
import './styles.css';

type Status = {
  configured: boolean;
  connected: boolean;
  expiresAt: number | null;
};

type Board = {
  id: string;
  name: string;
  privacy?: string;
  pin_count?: number;
};

type SelectedPhoto = {
  id: string;
  file: File;
  previewUrl: string;
};

type UploadResult = {
  fileName: string;
  ok: boolean;
  pinId?: string;
  link?: string | null;
  error?: string;
};

const MAX_FILES = 50;

function App() {
  const [status, setStatus] = React.useState<Status | null>(null);
  const [boards, setBoards] = React.useState<Board[]>([]);
  const [selectedBoard, setSelectedBoard] = React.useState('');
  const [photos, setPhotos] = React.useState<SelectedPhoto[]>([]);
  const [title, setTitle] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [link, setLink] = React.useState('');
  const [altText, setAltText] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [uploading, setUploading] = React.useState(false);
  const [message, setMessage] = React.useState('');
  const [results, setResults] = React.useState<UploadResult[]>([]);

  const refreshStatus = React.useCallback(async () => {
    const response = await fetch('/api/pinterest/status');
    const nextStatus = (await response.json()) as Status;
    setStatus(nextStatus);
    return nextStatus;
  }, []);

  const loadBoards = React.useCallback(async () => {
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch('/api/pinterest/boards');
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Unable to load boards.');
      setBoards(data.boards || []);
      if (data.boards?.[0]?.id) setSelectedBoard((current) => current || data.boards[0].id);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Unable to load boards.');
    } finally {
      setBusy(false);
    }
  }, []);

  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const oauthError = params.get('pinterest_error');
    if (oauthError) setMessage(oauthError);
    if (params.get('connected')) setMessage('Pinterest connected. Choose a board and start a batch.');
    if (oauthError || params.get('connected')) window.history.replaceState({}, '', '/');

    refreshStatus().then((nextStatus) => {
      if (nextStatus.connected) loadBoards();
    });
  }, [loadBoards, refreshStatus]);

  React.useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => undefined);
    }
  }, []);

  React.useEffect(() => {
    return () => photos.forEach((photo) => URL.revokeObjectURL(photo.previewUrl));
  }, [photos]);

  async function connectPinterest() {
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch('/api/pinterest/auth-url');
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Unable to start Pinterest OAuth.');
      window.location.href = data.url;
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Unable to start Pinterest OAuth.');
      setBusy(false);
    }
  }

  async function disconnectPinterest() {
    setBusy(true);
    await fetch('/api/pinterest/disconnect', { method: 'POST' });
    setBoards([]);
    setSelectedBoard('');
    await refreshStatus();
    setBusy(false);
  }

  function addPhotos(fileList: FileList | null) {
    if (!fileList) return;
    const imageFiles = Array.from(fileList).filter((file) => file.type.startsWith('image/'));
    const next = imageFiles.slice(0, Math.max(0, MAX_FILES - photos.length)).map((file) => ({
      id: `${file.name}-${file.lastModified}-${crypto.randomUUID()}`,
      file,
      previewUrl: URL.createObjectURL(file)
    }));
    setPhotos((current) => [...current, ...next]);
    setResults([]);
  }

  function removePhoto(id: string) {
    setPhotos((current) => {
      const photo = current.find((item) => item.id === id);
      if (photo) URL.revokeObjectURL(photo.previewUrl);
      return current.filter((item) => item.id !== id);
    });
  }

  async function publishBatch(event: React.FormEvent) {
    event.preventDefault();
    setUploading(true);
    setMessage('');
    setResults([]);

    try {
      const body = new FormData();
      body.set('boardId', selectedBoard);
      body.set('title', title);
      body.set('description', description);
      body.set('link', link);
      body.set('altText', altText);
      photos.forEach((photo) => body.append('photos', photo.file));

      const response = await fetch('/api/pinterest/pins/batch', {
        method: 'POST',
        body
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Batch upload failed.');
      setResults(data.results || []);
      setMessage(`${data.created} of ${data.total} photos published.`);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Batch upload failed.');
    } finally {
      setUploading(false);
    }
  }

  const connected = Boolean(status?.connected);
  const canPublish = connected && selectedBoard && photos.length > 0 && !uploading;
  const isPrivacyPage = window.location.pathname === '/privacy';

  if (isPrivacyPage) {
    return <PrivacyPage />;
  }

  return (
    <main className="app-shell">
      <section className="command-band">
        <div className="brand-mark" aria-hidden="true">
          <span />
        </div>
        <div>
          <p className="eyebrow">Pinterest batch publisher</p>
          <h1>Turn a folder of photos into a clean run of individual Pins.</h1>
        </div>
        <div className="connection-card" aria-live="polite">
          {status?.configured ? (
            connected ? (
              <>
                <BadgeCheck aria-hidden="true" />
                <span>Connected</span>
              </>
            ) : (
              <>
                <Cable aria-hidden="true" />
                <span>Ready to connect</span>
              </>
            )
          ) : (
            <>
              <WifiOff aria-hidden="true" />
              <span>Needs API keys</span>
            </>
          )}
        </div>
      </section>

      {message && (
        <div className="notice">
          <CircleAlert size={18} aria-hidden="true" />
          <span>{message}</span>
        </div>
      )}

      <section className="workbench">
        <aside className="rail">
          <div className="panel">
            <p className="panel-label">Account</p>
            <h2>Pinterest access</h2>
            <p className="muted">
              Connect with OAuth, then this app publishes each selected photo as its own standard image Pin.
            </p>
            <div className="button-row">
              {connected ? (
                <button className="ghost-button" type="button" onClick={disconnectPinterest} disabled={busy}>
                  <LogOut size={18} aria-hidden="true" />
                  Disconnect
                </button>
              ) : (
                <button className="primary-button" type="button" onClick={connectPinterest} disabled={busy}>
                  {busy ? <Loader2 className="spin" size={18} aria-hidden="true" /> : <Cable size={18} aria-hidden="true" />}
                  Connect Pinterest
                </button>
              )}
              <button className="icon-button" type="button" onClick={loadBoards} disabled={!connected || busy} title="Refresh boards">
                <RefreshCw size={18} aria-hidden="true" />
              </button>
            </div>
          </div>

          <div className="panel compact">
            <p className="panel-label">Board</p>
            <label className="field">
              <span>Destination</span>
              <select value={selectedBoard} onChange={(event) => setSelectedBoard(event.target.value)} disabled={!connected || busy}>
                {!boards.length && <option value="">No boards loaded</option>}
                {boards.map((board) => (
                  <option key={board.id} value={board.id}>
                    {board.name}
                    {board.privacy ? ` · ${board.privacy}` : ''}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </aside>

        <form className="publisher" onSubmit={publishBatch}>
          <div className="drop-zone">
            <input
              id="photos"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              multiple
              onChange={(event) => addPhotos(event.target.files)}
            />
            <label htmlFor="photos">
              <ImagePlus size={28} aria-hidden="true" />
              <strong>Select photos</strong>
              <span>PNG, JPG, or WebP. Up to {MAX_FILES} in one batch.</span>
            </label>
          </div>

          <div className="meta-grid">
            <label className="field">
              <span>Shared title</span>
              <input value={title} maxLength={100} onChange={(event) => setTitle(event.target.value)} placeholder="Falls collection" />
            </label>
            <label className="field">
              <span>Destination link</span>
              <input value={link} type="url" onChange={(event) => setLink(event.target.value)} placeholder="https://example.com" />
            </label>
            <label className="field span-2">
              <span>Description</span>
              <textarea
                value={description}
                maxLength={800}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="A short caption used for every Pin in this batch."
              />
            </label>
            <label className="field span-2">
              <span>Alt text</span>
              <input value={altText} onChange={(event) => setAltText(event.target.value)} placeholder="Optional accessibility text" />
            </label>
          </div>

          <div className="batch-bar">
            <div>
              <strong>{photos.length} selected</strong>
              <span>{photos.length ? 'Ready for board publishing' : 'Choose a few photos to begin'}</span>
            </div>
            <button className="primary-button publish-button" type="submit" disabled={!canPublish}>
              {uploading ? <Loader2 className="spin" size={18} aria-hidden="true" /> : <Send size={18} aria-hidden="true" />}
              Publish batch
            </button>
          </div>

          <div className="photo-grid" aria-label="Selected photos">
            {photos.map((photo) => (
              <article className="photo-tile" key={photo.id}>
                <img src={photo.previewUrl} alt="" />
                <button type="button" onClick={() => removePhoto(photo.id)} title={`Remove ${photo.file.name}`}>
                  <Trash2 size={16} aria-hidden="true" />
                </button>
                <footer>
                  <span>{photo.file.name}</span>
                  <small>{(photo.file.size / 1024 / 1024).toFixed(1)} MB</small>
                </footer>
              </article>
            ))}
          </div>

          {results.length > 0 && (
            <section className="results" aria-label="Upload results">
              {results.map((result) => (
                <div className={result.ok ? 'result ok' : 'result fail'} key={result.fileName}>
                  {result.ok ? <CheckCircle2 size={18} aria-hidden="true" /> : <CircleAlert size={18} aria-hidden="true" />}
                  <span>{result.fileName}</span>
                  <small>{result.ok ? `Pin ${result.pinId}` : result.error}</small>
                </div>
              ))}
            </section>
          )}
        </form>
      </section>

      <footer className="truth-line">
        <CloudUpload size={17} aria-hidden="true" />
        Pinterest API access requires your own approved developer app and the pins:write / boards:read scopes.
      </footer>
    </main>
  );
}

function PrivacyPage() {
  return (
    <main className="app-shell policy-shell">
      <section className="policy-header">
        <div className="brand-mark" aria-hidden="true">
          <span />
        </div>
        <div>
          <p className="eyebrow">Privacy policy</p>
          <h1>Pin Batch</h1>
        </div>
      </section>

      <article className="policy-panel">
        <p>Effective date: April 23, 2026</p>
        <h2>What Pin Batch does</h2>
        <p>
          Pin Batch lets a user connect their Pinterest account, choose a board, select image files, and publish those
          images as Pins through Pinterest's API.
        </p>
        <h2>Information we process</h2>
        <p>
          The app processes Pinterest OAuth tokens, board information returned by Pinterest, and the images and Pin text
          the user chooses to upload. In this local version, that data is used only to complete the user's requested
          Pinterest publishing action.
        </p>
        <h2>Storage</h2>
        <p>
          OAuth session data is stored in a server-side session for the active login. Uploaded image files are held in
          memory only while the batch request is being sent to Pinterest.
        </p>
        <h2>Sharing</h2>
        <p>
          Pin Batch sends selected images, titles, descriptions, links, alt text, and board IDs to Pinterest so Pins can
          be created. We do not sell user data.
        </p>
        <h2>User control</h2>
        <p>
          Users can disconnect Pinterest access from inside the app. They may also revoke app access from their
          Pinterest account settings.
        </p>
        <h2>Contact</h2>
        <p>For privacy questions, contact the app owner at the email address listed in the deployed app profile.</p>
      </article>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
