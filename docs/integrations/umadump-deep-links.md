# umadump Veteran import deep links

Torena Sim accepts packed umadump trained-character imports at:

```text
https://torena-sim.pages.dev/runners?from=<payload>
```

The JSON export remains the canonical Cygames-shaped schema. The link payload is a versioned BitVector projection containing only fields Torena imports; decoding reconstructs that JSON projection and passes it through the normal umadump parser.

## Binary contract — version 1

Bits are written most-significant first. The completed stream is zero-padded to a 6-bit boundary and encoded with the URL-safe Base64 alphabet `A-Z`, `a-z`, `0-9`, `-`, `_`; `=` padding is never used.

### Header

| Field | Bits | Value |
| --- | ---: | --- |
| `magic` | 16 | `0x5544` (ASCII `UD`) |
| `version` | 8 | `1` |
| `veteran_count` | 16 | Number of Veteran records |

### Veteran record

| Cygames/umadump field | Bits | Encoding |
| --- | ---: | --- |
| `card_id` | 20 | `1..1048575` |
| `speed`, `stamina`, `power`, `guts`, `wiz` | 11 each | `0..2047` |
| Ten `proper_*` aptitude fields | 3 each | API value minus one; decoded range `1..8` |
| `running_style` | 3 | API value `1..5`; `0` means absent |
| `rank_score_present` | 1 | Whether `rank_score` follows |
| `rank_score` | 20 | Conditional; `0..1048575` |
| `talent_level` | 3 | API value `1..5`; `0` means absent |
| `skill_count` | 8 | Number of `skill_array` entries |
| `skill_id` | 20 each | `1..1048575` |
| `level` | 3 each | API skill level `1..7` |
| `memo_byte_length` | 16 | UTF-8 byte count |
| `memo` | 8 each | Raw UTF-8 bytes |

Encoders must reject out-of-range values instead of clamping or truncating them. Decoders must reject invalid Base64, unknown magic/version values, truncated records, reserved values, invalid UTF-8, non-zero trailing bits, and payloads with trailing data.

## Projection boundary

The packed record deliberately excludes fields Torena does not import, including `viewer_id`, ownership IDs, support cards, parents, factors, and race history. This avoids carrying account identifiers in shared URLs and keeps the binary contract focused.

If Torena begins importing another umadump field or changes a field's representation, the binary version must increment. Normal `trained_chara_data.json` browse/drop remains forward-compatible and is the fallback for unsupported link versions.

## Consumption and limits

Torena Sim removes the `from` parameter after capturing it, preserving other query parameters and the URL fragment. This prevents refreshes or later navigation from reopening the preview.

The complete `from` value is limited to 15,000 characters for reliable browser, proxy, and CDN transport. The example Veteran encodes to 55 characters; list size then scales mainly with skill count and UTF-8 memo length. When a list exceeds the ceiling, select fewer Veterans or import `trained_chara_data.json` through the Veterans import menu.
