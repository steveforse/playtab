# Third-party components

Dependencies remain under their respective licenses; this repository does not relicense them.

| Component | License / location |
| --- | --- |
| Rails | MIT; https://github.com/rails/rails |
| React | MIT; https://github.com/facebook/react |
| Vite / Vite Ruby | MIT; https://vite.dev / https://vite-ruby.netlify.app |
| alphaTab and its Vite plugin | MPL-2.0; https://github.com/CoderLine/alphaTab |
| @xmldom/xmldom (test-only XML DOM) | MIT; https://github.com/xmldom/xmldom |
| pdf-reader 2.16.0 (native vector PDF recognition) | MIT; https://github.com/yob/pdf-reader |
| Bravura notation font | SIL Open Font License; bundled `Bravura-OFL.txt` |
| MuseScore General Lite SoundFont | Bundled attribution and MIT/public-domain/CC0 notices are in `soundfont/MuseScore_General_Lite.copyright`; source package: https://packages.debian.org/bookworm/all/musescore-general-soundfont-small |
| DM Sans / Libre Baskerville | Served through Google Fonts; see https://fonts.google.com/specimen/DM+Sans/license and https://fonts.google.com/specimen/Libre+Baskerville/license |

The Vite build copies the alphaTab font and the selected SoundFont plus its attribution files into `public/notation/` during development and builds. Keep those notices with redistributed assets. The alphaTab ESM renderer has a small MPL-2.0 upward-slur patch in `patches/`; retain it with distributions.

The included four-measure practice roll is an original demo constructed for this project.
