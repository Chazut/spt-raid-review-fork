# SPT Raid Review

**v0.4.0** — Compatible with **SPT 4.0.X**

An experimental tool for the SPT community to review raid data—kills, looting, and positional movement—with the ability to replay events after escaping.

[Watch Preview](https://spt-raid-review.pages.dev/m2-res_1080p.mp4)

---

### Installation

Download a compatible version from the **[releases](https://github.com/ekky-llc/spt-raid-review/releases)** tab. Instructions for each version are included in the corresponding release description.

---

### Project Structure

| Component | Path | Tech | Purpose |
|-----------|------|------|---------|
| **Client** | `/Client` | C# .NET 4.7.2 / BepInEx | Game plugin — patches EFT methods, streams data via WebSocket |
| **Server** | `/ServerMod` | C# .NET 9 / Kestrel | SPT 4.0 server mod — WebSocket + HTTP server, SQLite storage |
| **Frontend** | `/Private` | React 18 + TypeScript + Vite | Web UI for raid review and replay |

---

### Features

- View raid data: kills, looting, players, bots, and positional info.
- Toggle filters and grouping options to refine the review.
- Replay raid events with positional tracking.
- Click to follow specific players or events in the timeline.
- Highlight players by hovering over names in the legend.
- Toggle visual markers and map layers for better clarity.
- SAIN integration: displays bot personality (Timmy, Chad, Rat...) and difficulty.

---

### Contributions & Development

- [CONTRIBUTING.md](CONTRIBUTING.md) — how to contribute.
- [DEVELOPMENT.md](DEVELOPMENT.md) — getting started with development.
- [REMOTE_HOST_AND_FIKA.md](REMOTE_HOST_AND_FIKA.md) — using the mod on a remote host or with Fika.
- [TELEMETRY.md](TELEMETRY.md) — information on statistics collection.

---

### Credits / Thanks

- **Ekky** — original author.
- **Chazu** — co-author of the SPT 4.0.X migration.
- The SPT team for the framework and docs.
- The SPT Discord—especially the `#mod-development` and `#dev-community` folks.
- The team behind [tarkov.dev](https://tarkov.dev) for open-sourcing the interactive map.
- Olli, Stk2008, and others who helped squash bugs.
- You, for downloading and trying the mod.

---

### Support

[![ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/I2I8Z8R08)
