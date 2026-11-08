# Security policy

## Reporting a vulnerability

Please **don't open a public issue** for security problems.

Report them privately through GitHub: **Security → Report a vulnerability** on this repository
(private vulnerability reporting). Include what you found, how to reproduce it, and its impact.
You'll get a reply within a few days.

## Scope

In scope: the Aperture server (`server/`), the web app (`web/`), and the deployment config
(`Dockerfile`, `render.yaml`). Examples: ways to make the server fetch arbitrary URLs (SSRF),
command injection into the extractors, bypassing rate or size limits, leaking cookies or tokens,
or XSS in the web app.

Out of scope: issues in upstream tools (report those to
[yt-dlp](https://github.com/yt-dlp/yt-dlp/security) or [gallery-dl](https://github.com/mikf/gallery-dl)),
and platforms refusing to serve a post.

## How Aperture protects itself

- Extractors only run on an allowlist of platform hosts; local addresses, `file:` and credentialed URLs are rejected.
- Extractors are spawned with argument arrays (no shell); the client can only choose a pre-validated option id.
- The server never fetches a URL a visitor supplies directly: downloads and thumbnails use server-side ids,
  and backup media is restricted to Instagram's CDN hosts.
- Helmet security headers with a strict CSP, rate limits, per-visitor job caps, size, duration and time limits.
- Secrets (API tokens, cookies) live only in environment variables or secret files, never in the repository.
