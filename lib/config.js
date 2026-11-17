// Crate server URL. After deploying the server (see server/README.md), paste its URL here,
// e.g. 'https://crate-api.yourname.workers.dev'. Users then need no API keys at all.
export const SERVER_URL = '';

export const hasServer = () => /^https:\/\/[^\s]+$/.test(SERVER_URL);
