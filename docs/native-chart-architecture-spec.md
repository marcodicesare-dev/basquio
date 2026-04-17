# This spec was REMOVED — see `chart-architecture-canonical.md`

This document previously proposed migrating PPT charts from matplotlib PNG to PptxGenJS native chart objects.

It was based on incomplete SOTA research that overlooked Basquio's deployment reality (cross-viewer compat) and the team's documented production failures with native charts (commits `a77e318`, `51efcb6`, `88150b6`, `c7c4ee7`, `feca8df`, `75be587`).

**The canonical chart architecture is in `docs/chart-architecture-canonical.md`.**

If you're reading this looking for the native-charts approach, do not implement it without satisfying all four conditions documented in `chart-architecture-canonical.md` Section 7 — those conditions exist because the team already tried this multiple times and retreated.
