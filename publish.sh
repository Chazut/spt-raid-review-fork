#!/usr/bin/env bash
set -e

# Configuration
default_name="raid_review"
default_version="0.4.0"
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
server_dest="$dist_folder/user/mods/RaidReview"
mkdir -p "$server_dest"

# Copy server mod output (exclude SPTarkov/SemanticVersioning/JetBrains DLLs — they're in the SPT server already)
for f in ServerMod/bin/Release/RaidReview/*; do
    base=$(basename "$f")
    case "$base" in
        SPTarkov.*|SemanticVersioning.*|JetBrains.*) continue ;;
        *) cp -r "$f" "$server_dest/" ;;
    esac
done

# Copy config if not embedded
if [ -f "ServerMod/config.json" ] && [ ! -f "$server_dest/config.json" ]; then
    cp "ServerMod/config.json" "$server_dest/"
fi

# 5. Package client mod
echo ">> Packaging client mod..."
client_dest="$dist_folder/BepInEx/plugins"
mkdir -p "$client_dest"

xml_file="Client/RAID-REVIEW.csproj"
output_path=$(grep -oP '<OutputPath>\K.*?(?=</OutputPath>)' "$xml_file" | head -1 | sed 's/^\s*//;s/\s*$//')
for file in "$output_path"/RAID_REVIEW__*.dll; do
    if [ -f "$file" ]; then
        echo "  Copying $(basename "$file")"
        cp "$file" "$client_dest/"
    fi
done

# 6. Create ZIP
echo ">> Creating distribution archive..."
cd "$dist_folder"
powershell -Command "Compress-Archive -Force -Path '*' -DestinationPath '../${name}__${version}_windows.zip'" > /dev/null
cd "$current_dir"

# Cleanup
rm -rf "$dist_folder"

echo ""
echo "Finished! Archive: dist/${name}__${version}_windows.zip"
