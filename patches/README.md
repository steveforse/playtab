# alphaTab rendering patch

`@coderline+alphatab+1.8.4.patch` changes the ESM renderer consumed by this app so hammer-on and pull-off tablature slurs both arch upward, regardless of string. It also gives H/PO pairs a dedicated MIDI path: the origin sample is held on an isolated channel and receives an immediate per-note pitch step at the destination onset, without a second picked attack or a slide glyph. Ordinary slides retain the upstream placement and interpolated playback.

`npm ci` applies it through `patch-package`; failed application fails installation. The frontend Docker build copies patches before installing. Revalidate H/PO curves, label placement, resizing, and printing when upgrading alphaTab. The unconsumed CommonJS and pre-minified bundles are not patched.

The modified alphaTab code remains MPL-2.0. Preserve its original notices and this patch when distributing the application. Upstream source: https://github.com/CoderLine/alphaTab (version 1.8.4).
