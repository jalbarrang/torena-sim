# umadump Veteran import deep links

Torena Sim accepts versioned umadump trained-character imports at:

```text
https://torena-sim.pages.dev/runners?from=<payload>
```

## Version 1 contract

- The route is `/runners` (Veterans).
- The query parameter is `from`.
- The value is an RFC 4648 base64url encoding of a UTF-8 JSON envelope: `{"v":1,"data":[...]}`.
- `data` contains the same trained-character array as `trained_chara_data.json` and is validated by the normal umadump parser.
- Base64 padding (`=`) is omitted. The payload therefore uses only `A-Z`, `a-z`, `0-9`, `-`, and `_`.
- Unknown envelope versions are rejected rather than guessed. A future incompatible format must increment `v`.
- Consumers must keep the complete `from` parameter value at or below 15,000 characters.

Torena Sim removes the `from` parameter after capturing it. This prevents refreshes or later navigation from reopening the preview. Other query parameters and the URL fragment are preserved.

## URL-size limit

The 15,000-character ceiling keeps the canonical URL below common browser, proxy, and CDN request-line limits. Base64url expands UTF-8 JSON by roughly one third, so a full Veteran library may not fit.

When a link exceeds the ceiling, select fewer Veterans or import `trained_chara_data.json` through the Veterans import menu. JSON browse/drop remains the reliable bulk-import path.

## Encoding example

Given a trained-character array `trained_charas`:

```text
envelope = compact_json({"v": 1, "data": trained_charas})
payload  = base64url(utf8(envelope)).rstrip("=")
url      = "https://torena-sim.pages.dev/runners?from=" + payload
```
