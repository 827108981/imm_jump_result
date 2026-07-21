# Mobile Offline Layout Regression - 2026-07-21

## Scope

- Prevent horizontal page overflow on narrow mobile browser viewports.
- Keep the `More` actions fully visible when opened.
- Preserve the existing offline data, ZIP, desktop restore, and RTS import contracts.

## Layout Verification

The static `templates/mobile_offline.html` file was loaded directly with Edge
headless using a 393 x 852 mobile viewport.

| Check | Result |
| --- | --- |
| `window.innerWidth` | 393 px |
| document `scrollWidth` | 393 px |
| body `scrollWidth` | 393 px |
| report shell width | 377 px |
| More panel bounds | left 93, right 301, top 254, bottom 432 px |
| More panel fully inside viewport | yes |

Desktop regression was also checked at 1280 x 900. The page `scrollWidth` was
1265 px, below the 1280 px viewport, and the More panel was fully visible.

## Compatibility Verification

- Inline JavaScript compiled successfully with Node.js.
- The file contains no Jinja syntax and retains the mobile viewport metadata.
- Flask 3.1.3 and Jinja2 3.1.6 are installed and available.
- `/mobile-offline.html` and `/mobile-offline/download` both returned HTTP 200.

## ZIP Regression

Verified with the supplied simulated frontline formal ZIP:

- ZIP entries: 47
- Images: 44
- `/api/rts/import`: HTTP 200, 39 tasks restored
- `/api/report/import`: HTTP 200, 39 tasks restored for desktop editing
