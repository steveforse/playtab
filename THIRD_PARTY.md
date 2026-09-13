# Third-party components

Dependencies remain under their respective licenses; this repository does not relicense them.

| Component | License / location |
| --- | --- |
| Rails | MIT; https://github.com/rails/rails |
| React | MIT; https://github.com/facebook/react |
| Vite / Vite Ruby | MIT; https://vite.dev / https://vite-ruby.netlify.app |
| alphaTab and its Vite plugin | MPL-2.0; https://github.com/CoderLine/alphaTab |
| @xmldom/xmldom (test-only XML DOM) | MIT; https://github.com/xmldom/xmldom |
| TuxGuitar 2.1.0 (separate converter image) | LGPL-2.1; unmodified release archive, license and attribution retained in `/opt/converter/tux/doc/`; https://github.com/helge17/tuxguitar/releases/tag/2.1.0 |
| Bravura notation font | SIL Open Font License; bundled `Bravura-OFL.txt` |
| SONiVOX starter SoundFont | Bundled license states Apache-2.0, Copyright Sonic Network Inc.; see bundled `soundfont/LICENSE` and `soundfont/README.md` for provenance |
| DM Sans / Libre Baskerville | Served through Google Fonts; see https://fonts.google.com/specimen/DM+Sans/license and https://fonts.google.com/specimen/Libre+Baskerville/license |

The alphaTab plugin copies the font and SoundFont license files, together with the assets, into `public/notation/` during development and builds. Keep those notices with redistributed assets. The alphaTab ESM renderer has a small MPL-2.0 upward-slur patch in `patches/`; retain it with distributions. No MuseScore or TuxGuitar code has been copied into this application.

The included four-measure practice roll is an original demo constructed for this project.
