# SPT Raid Review
![Stars](https://img.shields.io/github/stars/Chazut/SPT-RaidReview?style=flat-square&label=STARS&color=007ec6)
![Issues](https://img.shields.io/github/issues/Chazut/SPT-RaidReview?style=flat-square&label=ISSUES&color=44cc11)
![Downloads](https://img.shields.io/github/downloads/Chazut/SPT-RaidReview/total?style=flat-square&label=DOWNLOADS&color=44cc11)

Every raid you play gets recorded: positions, kills, loot, bot decisions.
After extract, replay the whole thing on an interactive map, scrub the
timeline, and find out what actually happened - who hunted you across the
map, what that scav was thinking, where the good loot you missed was
sitting.

[Watch Preview](https://spt-raid-review.pages.dev/m2-res_1080p.mp4)

Once installed, play a few raids, then hit **F5** in game (or browse to
`http://127.0.0.1:7829`).

---

### Installation

Download a compatible version from the **[releases](https://github.com/Chazut/SPT-RaidReview/releases)** tab. Instructions for each version are included in the corresponding release description.

- **SPT 4.1.X**: version 1.5.0 and newer.
- **SPT 4.0.X**: versions up to 1.4.x.

---

### Features

- Full raid replay on an interactive map (timeline scrubber, follow mode, floors)
- Kill lines, death markers, killfeed details
- Post-raid leaderboard
- Charts: kills, looting, bots over time, factions...
- Bot behavior rings and per-bot timeline
- Loose loot and bot inventories on the map
- Grenade trajectories, ballistics, hit flashes
- Mod integrations: SAIN, ORBIT (ghosts included), QuestingBots, LootingBots
- Faction badges for modded bots: UNTAR, RUAF, Black Division, ISB, Combine Soldiers
- Fika support, see [REMOTE_HOST_AND_FIKA.md](REMOTE_HOST_AND_FIKA.md)

---

### Project Structure

| Component | Path | Tech | Purpose |
|-----------|------|------|---------|
| **Client** | `/Client` | C# .NET 4.7.2 / BepInEx | Game plugin: patches EFT methods, streams data via WebSocket |
| **Server** | `/ServerMod` | C# .NET 10 / Kestrel | SPT 4.1 server mod: WebSocket + HTTP server, SQLite storage |
| **Frontend** | `/Private` | React 18 + TypeScript + Vite | Web UI for raid review and replay |

---

### Contributions & Development

- [CONTRIBUTING.md](CONTRIBUTING.md): how to contribute.
- [DEVELOPMENT.md](DEVELOPMENT.md): getting started with development.
- [REMOTE_HOST_AND_FIKA.md](REMOTE_HOST_AND_FIKA.md): using the mod on a remote host or with Fika.
- [TELEMETRY.md](TELEMETRY.md): information on statistics collection.

---

### Credits / Thanks

- **Ekky**: original author.
- **Chazut**: SPT 4.0.X and 4.1.X migrations, current maintainer.
- The SPT team for the framework and docs.
- The SPT Discord, especially the `#mod-development` and `#dev-community` folks.
- The team behind [tarkov.dev](https://tarkov.dev) for open-sourcing the interactive map.
- Olli, Stk2008, and others who helped squash bugs.
- You, for downloading and trying the mod.

---

### Support

[![ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/chazut)
