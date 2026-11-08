# Contributing

Thanks for helping make Aperture better.

1. Fork and clone, then `npm run setup` and `npm run dev` (see the README for prerequisites).
2. Make your change. Keep it focused, and match the existing style.
3. Run `npm test` and `npm run build`. CI runs both on every pull request.
4. Open a pull request explaining **what** changed and **why**.

**Platform broke?** Most breakages are fixed upstream in yt-dlp / gallery-dl within days.
Try `pip install -U --pre "yt-dlp[default]" gallery-dl` before opening an issue.

Never commit cookies, tokens or `.env` files. Push protection and secret scanning are enabled on this repo.
