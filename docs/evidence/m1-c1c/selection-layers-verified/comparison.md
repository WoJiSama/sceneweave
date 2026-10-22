# Native v3 selection comparison

Completed 2026-10-21T16:41:53.162Z. Normal production #layers; same method and original B5 packages as the v2 final comparison. Each kind/case has 90 samples, nearest-rank p95. Double rAF is a scheduling proxy.

| Case | v2 marquee DOM | v3 marquee DOM | v2 marquee double-rAF | v3 marquee double-rAF | v2 replacement double-rAF | v3 replacement double-rAF |
|---|---:|---:|---:|---:|---:|---:|
| study-500 | 5.5 | 7.6 | 32.1 | 32.2 | 29.2 | 29.1 |
| study-2000 | 12.1 | 16.9 | 32.3 | 32.1 | 28.4 | 27.9 |
| island-500 | 5.8 | 6.7 | 32.5 | 31.7 | 29.2 | 29.3 |
| island-2000 | 13.3 | 14.6 | 32.5 | 32.8 | 28.5 | 27.3 |

| Case | Run | Marquee double-rAF p95 | Replacement double-rAF p95 |
|---|---:|---:|---:|
| study-500 | 1 | 32.8 | 29.1 |
| study-500 | 2 | 32.0 | 27.8 |
| study-500 | 3 | 32.6 | 29.9 |
| study-2000 | 1 | 31.8 | 28.1 |
| study-2000 | 2 | 32.0 | 27.1 |
| study-2000 | 3 | 32.4 | 27.9 |
| island-500 | 1 | 31.0 | 27.1 |
| island-500 | 2 | 31.4 | 28.6 |
| island-500 | 3 | 32.9 | 30.7 |
| island-2000 | 1 | 32.8 | 27.2 |
| island-2000 | 2 | 32.6 | 27.5 |
| island-2000 | 3 | 32.8 | 27.7 |

All 720 samples: zero selection-window LongTasks; exact prop calibration and over-budget controls retained. Full native-v3 package entries/resources and raw IndexedDB, revision/save/base raster and refinement counts unchanged. Export ZIP metadata is not a byte equality claim. No memory peak, layer-hide/reorder cost, complete QA-PERF-01/04 or cross-browser conclusion.
