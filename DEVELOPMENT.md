# Development Guide

This guide will help you get started if you want to contribute to the project or make personal modifications.

## Requirements

- .NET 10 SDK (for ServerMod)
- .NET Framework 4.7.2 targeting pack (for Client)
- Visual Studio 2022 or VSCode with C# extensions
- Node.js v18+ (for frontend)
- Escape From Tarkov + SPT 4.1.X installation

## Project Structure

```
Client/       C# BepInEx plugin (.NET 4.7.2) — patches game methods, sends data via WebSocket
ServerMod/    C# SPT 4.1 server mod (.NET 10) — Kestrel HTTP/WS server, SQLite, REST API
Private/      React 18 + TypeScript + Vite — web UI for raid review and replay
```

## Client Mod `/Client`

The BepInEx plugin patches EFT game methods to capture raid data and stream it via WebSocket to the server mod.

### Setup

1. Open the solution in Visual Studio 2022 (or use `dotnet build` from CLI).
2. Review `RAID-REVIEW.csproj` for required dependencies — they are referenced from `dependencies/4.1.X/`.
3. Copy the required DLLs from your SPT installation's `BepInEx/core/`, `BepInEx/plugins/spt/` and `EscapeFromTarkov_Data/Managed/` folders into `Client/dependencies/4.1.X/`.
4. Update `<OutputPath>` in `RAID-REVIEW.csproj` to point to your SPT installation's `BepInEx/plugins/` folder.

### Build

```bash
cd Client
dotnet build
```

Output: `RAID_REVIEW__0.4.0.dll` deployed to the configured `<OutputPath>`.

## Server Mod `/ServerMod`

The C# server mod runs inside the SPT 4.1 server process. It starts a standalone Kestrel server on two ports:
- **Port 7828**: WebSocket — receives real-time data from the client mod
- **Port 7829**: HTTP — serves the React frontend + REST API

### Setup

1. Install the SPTarkov NuGet packages (on nuget.org): `SPTarkov.Common`, `SPTarkov.DI`, `SPTarkov.Server.Core` (v4.1.2).
2. The `.csproj` auto-deploys to `C:\Games\SPT-4.1\SPT_Runtime\user\mods\RaidReview\` after build — update this path if your SPT installation is elsewhere. Note: in SPT 4.1 the server tree moved from `SPT/` to `SPT_Runtime/`.

### Build

```bash
cd ServerMod
dotnet build
```

Output: `RaidReview.dll` + dependencies deployed to `user/mods/RaidReview/`.

## Frontend `/Private`

The React frontend is built with Vite and outputs to `ServerMod/public/`, where it gets embedded into the server mod DLL as resources.

### Development (hot-reload)

```bash
cd Private
npm install
npm run dev
```

The dev server runs on `http://localhost:5173` and proxies API calls to `http://127.0.0.1:7829` (requires the SPT server to be running with the mod deployed).

### Production Build

```bash
cd Private
npm run build
```

Output goes to `ServerMod/public/`. Then rebuild the server mod to embed the fresh frontend:

```bash
cd ServerMod
dotnet build
```

## Full Build (all components)

```bash
cd Private && npm run build
cd ../ServerMod && dotnet build
cd ../Client && dotnet build
```

## Workflow

- **Client mod changes**: edit in VS2022 or VSCode, `dotnet build`, launch game.
- **Server mod changes**: edit in VSCode, `dotnet build`, restart SPT server.
- **Frontend changes**: `npm run dev` in `/Private` for hot-reload; `npm run build` + `dotnet build` in `/ServerMod` before deploying.

## Data Capture Overview

The client mod patches various C# methods using the BepInEx Framework. The targeted methods handle shooting, applying damage, kills, looting, and starting/ending raids.

Data is structured in custom C# classes, serialized to JSON, and sent via WebSocket from the client to the server in real-time. The server writes the data to a SQLite database (`<mod_folder>/data/spt_raid_review.db`), and positional data is written to CSV files (`<mod_folder>/data/positions/<raid_id>_positions`).

Once a raid is completed, a post-processing workflow compiles the positional CSV data into a JSON file that the HTTP API serves to the frontend for replay.
