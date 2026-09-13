# alphaTab rendering patch

`@coderline+alphatab+1.8.4.patch` changes the ESM renderer consumed by this app so hammer-on and pull-off tablature slurs both arch upward, regardless of string. Slides retain the upstream placement. No pitches, timing, or audio events are changed by this patch.

`npm ci` applies it through `patch-package`; failed application fails installation. The frontend Docker build copies patches before installing. Revalidate H/PO curves, label placement, resizing, and printing when upgrading alphaTab. The unconsumed CommonJS and pre-minified bundles are not patched.

The modified alphaTab code remains MPL-2.0. Preserve its original notices and this patch when distributing the application. Upstream source: https://github.com/CoderLine/alphaTab (version 1.8.4).
