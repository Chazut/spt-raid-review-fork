#!/usr/bin/env bash
set -e

# Configuration
default_name="raid_review"
default_version="1.1.0"
current_dir=$(pwd)

echo "Let's start the deployment process..."

read -p "Please enter the name of your Mod [$default_name]: " name
name=${name:-$default_name}

read -p "Please enter the version number of your Mod [$default_version]: " version
version=${version:-$default_version}

clear

dist_folder="dist/${name}__${version}"
rm -rf "$dist_folder"

# 1. Build frontend
echo ">> Building frontend..."
cd Private
npm install --silent
npm run build
cd "$current_dir"

# 2. Build server mod (embeds frontend into DLL)
echo ">> Building server mod..."
cd ServerMod
dotnet build -c Release --nologo -v q
cd "$current_dir"

# 3. Build client mod
echo ">> Building client mod..."
cd Client
dotnet build -c Release --nologo -v q
cd "$current_dir"

# 4. Package server mod
echo ">> Packaging server mod..."
server_dest="$dist_folder/SPT/user/mods/RaidReview"
mkdir -p "$server_dest"

# Copy managed DLLs flat (must be next to RaidReview.dll — .NET resolves them before any mod code runs)
for f in ServerMod/bin/Release/RaidReview/*.dll; do
    base=$(basename "$f")
    case "$base" in
        SPTarkov.*|SemanticVersioning.*|JetBrains.*) continue ;;   # Already in SPT server
        *) cp "$f" "$server_dest/" ;;
    esac
done

# Copy native SQLite runtimes (win-x64 + linux-x64) into runtimes subfolder
# Must NOT be in the mod root — SPT mod loader would try to load them as managed assemblies
build_runtimes="ServerMod/bin/Release/RaidReview/runtimes"
for rid in win-x64 linux-x64 linux-arm64; do
    native_src="$build_runtimes/$rid/native"
    if [ -d "$native_src" ]; then
        mkdir -p "$server_dest/runtimes/$rid/native"
        cp "$native_src"/* "$server_dest/runtimes/$rid/native/"
        echo "  Copied native runtime: $rid"
    fi
done

# Copy config
mkdir -p "$server_dest/config"
cp "ServerMod/config/config.json" "$server_dest/config/"

# 5. Package client mod
echo ">> Packaging client mod..."
client_dest="$dist_folder/BepInEx/plugins"
mkdir -p "$client_dest"

# Read OutputPath from the csproj (handles custom paths like C:\Games\SPT-4.0\BepInEx\plugins\)
output_path=$(sed -n 's/.*<OutputPath>\(.*\)<\/OutputPath>.*/\1/p' Client/RAID-REVIEW.csproj | head -1 | tr -d '\r' | sed 's/\s*$//')
if [ -z "$output_path" ]; then
    output_path="Client/bin/Release"
fi
for file in "$output_path"/RAID_REVIEW.dll; do
    if [ -f "$file" ]; then
        echo "  Copying $(basename "$file") from $output_path"
        cp "$file" "$client_dest/"
    fi
done

# 6. Create ZIP — use 7-Zip, NOT PowerShell Compress-Archive. Compress-Archive writes Windows backslash path
# separators (\) into the archive, which are out of the ZIP spec: Windows / 7-Zip tolerate them, but Linux
# `unzip` treats them as literal filenames, so the mod extracts broken on Linux. 7-Zip writes spec-compliant
# forward slashes.
echo ">> Creating distribution archive..."
sevenzip="$(command -v 7z || command -v 7za || true)"
for cand in "/c/Program Files/7-Zip/7z.exe" "/c/Program Files (x86)/7-Zip/7z.exe"; do
    [ -z "$sevenzip" ] && [ -x "$cand" ] && sevenzip="$cand"
done
if [ -z "$sevenzip" ]; then
    echo "ERROR: 7-Zip not found. Install it or add 7z to PATH (do NOT fall back to Compress-Archive)."
    exit 1
fi
cd "$dist_folder"
rm -f "../${name}__${version}.zip"
"$sevenzip" a -tzip "../${name}__${version}.zip" "*" > /dev/null
cd "$current_dir"

# Cleanup
rm -rf "$dist_folder"

echo ""
echo "Finished! Archive: dist/${name}__${version}.zip"
