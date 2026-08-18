# SPT Raid Review
![Stars](https://img.shields.io/github/stars/Chazut/ORBIT?style=flat-square&label=STARS&color=007ec6)
![Issues](https://img.shields.io/github/issues/Chazut/ORBIT?style=flat-square&label=ISSUES&color=44cc11)
![Downloads](https://img.shields.io/github/downloads/Chazut/ORBIT/total?style=flat-square&label=DOWNLOADS&color=44cc11)

A tool for the SPT community to review raid data (kills, looting, and positional movement) with the ability to replay events after escaping.

[Watch Preview](https://spt-raid-review.pages.dev/m2-res_1080p.mp4)

---

### Installation

Download a compatible version from the **[releases](https://github.com/Chazut/SPT-RaidReview/releases)** tab. Instructions for each version are included in the corresponding release description.

- **SPT 4.1.X**: version 1.5.0 and newer.
- **SPT 4.0.X**: versions up to 1.4.x.

---

### Project Structure

| Component | Path | Tech | Purpose |
|-----------|------|------|---------|
| **Client** | `/Client` | C# .NET 4.7.2 / BepInEx | Game plugin: patches EFT methods, streams data via WebSocket |
| **Server** | `/ServerMod` | C# .NET 10 / Kestrel | SPT 4.1 server mod: WebSocket + HTTP server, SQLite storage |
| **Frontend** | `/Private` | React 18 + TypeScript + Vite | Web UI for raid review and replay |

---

### Features

- View raid data: kills, looting, players, bots, and positional info.
- Replay raid events on the map with positional tracking, at up to 16x speed.
- Click to follow specific players or events in the timeline.
- Hover a bot for live health, behavior and loot; click through kill feeds.
- Loose loot markers with prices, container contents, and bot inventory inspection.
- Grenade trajectories, ballistics, and hit flashes during replay.
- Toggle filters, visual markers, and map layers to refine the review.
- SAIN integration: displays bot personality (Timmy, Chad, Rat...) and difficulty.
- ORBIT integration: squad objectives on the map, extract reasons, and live bot decisions.
- QuestingBots and LootingBots integrations for bot objective and looting overlays.

---

### Contributions & Development

- [CONTRIBUTING.md](CONTRIBUTING.md): how to contribute.
- [DEVELOPMENT.md](DEVELOPMENT.md): getting started with development.
- [REMOTE_HOST_AND_FIKA.md](REMOTE_HOST_AND_FIKA.md): using the mod on a remote host or with Fika.
- [TELEMETRY.md](TELEMETRY.md): information on statistics collection.

---

### Credits / Thanks

- **Ekky**: original author.
- **Chazu**: SPT 4.0.X and 4.1.X migrations, current maintainer.
- The SPT team for the framework and docs.
- The SPT Discord, especially the `#mod-development` and `#dev-community` folks.
- The team behind [tarkov.dev](https://tarkov.dev) for open-sourcing the interactive map.
- Olli, Stk2008, and others who helped squash bugs.
- You, for downloading and trying the mod.

---

### Support

[![ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/chazut)
