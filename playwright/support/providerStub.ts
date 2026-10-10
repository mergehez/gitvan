import express from 'express';

/**
 * Stands in for a Git provider's HTTP API in browser dev mode, so a spec can drive token
 * verification and the OAuth device flow without reaching GitHub or GitLab. `oauth.ts` points its
 * provider requests here when `GITVAN_PROVIDER_BASE` is set, which only the browser run sets.
 *
 * `POST /__control` arms a failure the next provider request has to answer with, so the specs can
 * cover the paths that only a provider error produces.
 */
const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

let failure: { status: number; body: Record<string, unknown> } | undefined;
/** How long the app waits between device-flow polls; see `mode` below. */
let pollIntervalSeconds = 3;
/** A real provider takes a moment to answer, so the waiting state stays observable in a spec. */
let pendingDelayMs = 1000;

function currentMode() {
    if (failure) {
        return 'fail';
    }

    return pollIntervalSeconds <= 1 ? 'quick' : 'slow';
}

app.post('/__control', (req, res) => {
    const mode = typeof req.body?.mode === 'string' ? req.body.mode : '';

    failure = mode === 'fail' ? { status: 401, body: { message: 'Bad credentials' } } : undefined;
    // `slow` keeps the waiting state on screen; `quick` lets the polling finish inside a test.
    pollIntervalSeconds = mode === 'quick' ? 1 : 3;
    pendingDelayMs = mode === 'quick' ? 0 : 1000;

    res.json({ ok: true, mode: currentMode() });
});

// The readiness probe the browser run makes is a GET, so the control route answers it too.
app.get('/__control', (_req, res) => {
    res.json({ ok: true, mode: currentMode() });
});

app.use((_req, res, next) => {
    if (failure) {
        res.status(failure.status).json(failure.body);
        return;
    }

    next();
});

app.get('/user', (_req, res) => {
    res.json({ login: 'stub-user', name: 'Stub User' });
});

// A real provider answers the first poll with `authorization_pending`, so the app shows the code
// before a later poll hands the token over.
let githubPolls = 0;
let gitlabPolls = 0;

app.post('/login/device/code', (_req, res) => {
    githubPolls = 0;

    res.json({
        device_code: 'stub-device-code',
        user_code: 'STUB-CODE',
        verification_uri: 'https://stub.example.com/device',
        expires_in: 900,
        interval: pollIntervalSeconds,
    });
});

app.post('/login/oauth/access_token', async (_req, res) => {
    githubPolls += 1;

    if (githubPolls === 1) {
        await new Promise((resolve) => setTimeout(resolve, pendingDelayMs));
        res.json({ error: 'authorization_pending' });
        return;
    }

    res.json({ access_token: 'stub-access-token', token_type: 'bearer' });
});

app.get('/api/v4/user', (_req, res) => {
    res.json({ username: 'stub-user', name: 'Stub User' });
});

app.post('/oauth/authorize_device', (_req, res) => {
    gitlabPolls = 0;

    res.json({
        device_code: 'stub-device-code',
        user_code: 'STUB-CODE',
        verification_uri: 'https://stub.example.com/device',
        expires_in: 300,
        interval: pollIntervalSeconds,
    });
});

app.post('/oauth/token', async (_req, res) => {
    gitlabPolls += 1;

    if (gitlabPolls === 1) {
        await new Promise((resolve) => setTimeout(resolve, pendingDelayMs));
        res.json({ error: 'authorization_pending' });
        return;
    }

    res.json({ access_token: 'stub-access-token', token_type: 'bearer', created_at: Math.floor(Date.now() / 1000), expires_in: 7200 });
});

const port = Number.parseInt(process.env.GITVAN_PROVIDER_STUB_PORT ?? '', 10) || 5278;

app.listen(port, () => {
    console.log(`[providerStub] Provider API stub running at http://127.0.0.1:${port}`);
});
