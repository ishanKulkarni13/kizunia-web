# Notification and app icons

These files are referenced by `public/manifest.json` and by the push service
worker, and are **not** in the repository — they are design assets, not code.

| File | Used by | Size |
| --- | --- | --- |
| `notification-192.png` | Manifest icon, push notification icon | 192×192 |
| `notification-512.png` | Manifest icon (install prompt, splash) | 512×512 |
| `notification-badge.png` | Android status-bar badge | 96×96, monochrome with transparency |

Until they are added, a push notification falls back to the browser's default
icon and an install prompt shows no artwork. Nothing breaks, and no code needs
changing when they appear.

The badge is the one with a real constraint: Android renders it as a
silhouette, so a full-colour logo comes out as a filled blob. It needs to be
monochrome with a transparent background.
