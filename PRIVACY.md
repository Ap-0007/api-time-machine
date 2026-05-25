# Privacy & Security Notice

## What this tool captures

API Time Machine records **all** XHR and fetch traffic from any web page while a recording session is active. Captured data may include:

- Authentication tokens (Bearer, JWT, session cookies sent in headers)
- API keys and secrets in request headers or bodies
- Personal identifiable information (PII) in request/response bodies
- Passwords submitted via forms that use fetch/XHR
- Internal API structure, endpoints, and business logic
- Any other data transmitted over the network

## Data storage

All recordings are stored **locally** in an SQLite database at `~/.api-time-machine/vault.db` on your machine. No data is ever transmitted to Anthropic or any third party.

## Security boundaries

| Boundary | Detail |
|----------|--------|
| Vault binding | Listens on `127.0.0.1:7842` only — never `0.0.0.0` |
| CORS | Allows only `chrome-extension://*` and `http://localhost*` origins |
| No telemetry | Zero analytics, no external network calls from the vault process |
| No auto-save | `.atm` export files are only created on explicit user action |

## Handling .atm export files

`.atm` files are JSON and may contain sensitive credentials in plain text.

**Treat `.atm` files with the same care as credential files (`.env`, SSH keys, etc.)**:

- Do not commit them to version control
- Do not upload them to file-sharing services or pastebins
- Do not share them via unencrypted channels (email, Slack)
- Delete them when no longer needed
- If sharing with colleagues, redact secrets first (see README)

## Redacting secrets before sharing

Before exporting a session that will be shared, use the built-in redaction flow to replace sensitive values across all recorded responses:

```js
// From the DevTools console of an extension page:
chrome.runtime.sendMessage({
  type: 'REDACT_SESSION',
  sessionId: '<your-session-id>',
  paths: ['$.token', '$.access_token', '$.user.email', '$.password']
});
```

All JSON values at the specified paths are replaced with `[REDACTED]` before the file is exported.

## Responsible use

This tool is intended for:
- Debugging and reproducing bugs in development and staging environments
- Offline testing by replaying production traffic locally
- Performance analysis of API call patterns

Do not use this tool to:
- Record traffic on systems you do not own or have explicit authorization to test
- Capture credentials belonging to other users
- Bypass access controls or rate limiting in production systems

## Vulnerability reporting

If you discover a security issue in this tool, please report it via the project's issue tracker rather than disclosing it publicly.
