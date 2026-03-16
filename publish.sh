#!/usr/bin/env bash
set -e

# Configuration
default_name="raid_review"
default_version="1.0.1"
current_dir=$(pwd)

# Get user input for the build and publish configuration
echo "Let's start the deployment process... (hit Enter to accept defaults)"
read -p "Please enter the name of your Mod [$default_name]: " name
name=${name:-$default_name}

read -p "Please enter the version number of your Mod [$default_version]: " version
version=${version:-$default_version}

# Ask for target architectures
echo "Available architectures: linux-x64, linux-arm64, osx-x64, osx-arm64, win-x64, win-arm64"
read -p "Enter target architectures (comma-separated, default: linux-x64,win-x64): " target_archs
target_archs=${target_archs:-"linux-x64,win-x64"}

# Parse architectures into array
IFS=',' read -ra ARCH_ARRAY <<< "$target_archs"

clear

rm -rf dist/*
dist_folder="dist/${name}_${version}"

# 1. Build frontend
echo ">> Building frontend..."
cd Private
npm install --silent
npm run build
cd "$current_dir"

# 2. Build server mod for each target architecture. This embeds frontend into DLL
echo ">> Building server mod for architectures: ${ARCH_ARRAY[*]}"
cd ServerMod

# Build for each architecture
for arch in "${ARCH_ARRAY[@]}"; do
    echo "  Building for $arch..."
    dotnet build -c Release --nologo -v q -r $arch
done
cd "$current_dir"

# 3. Build client mod
echo ">> Building client mod..."
cd Client
dotnet build -c Release --nologo -v q
cd "$current_dir"

# Find the client output path in order to copy the client mod DLL to the distribution folders.
# Read the OutputPath from the csproj to handle any custom paths specified in the project file. If a custom path is not found, default to Client/bin/Release
output_path=$(sed -n 's/.*<OutputPath>\(.*\)<\/OutputPath>.*/\1/p' Client/RAID-REVIEW.csproj | head -1 | tr -d '\r' | sed 's/\s*$//')
if [ -z "$output_path" ]; then
    output_path="Client/bin/Release"
fi
echo "  Client mod output path: $output_path"

# 4. Gather files for each architecture into the required structure for distribution and create ZIP archives.
# - a. Copy the server mod files for the architecture into the appropriate structure for an SPT server mod (specified in the server_mod_structure variable below)
#     - The server mod files include the main mod DLL and any additional DLLs or native libraries it depends on (except those already included in SPT server).
# - b. Copy the client mod DLL into the appropriate structure for an SPT client mod (specified in the client_mod_structure variable below).
#     - The client mod is the same for all architectures, but we want it included in each distribution ZIP.
# - c. Create a ZIP archive for each architecture.
server_mod_structure="SPT/user/mods/RaidReview"
client_mod_structure="BepInEx/plugins"

for arch in "${ARCH_ARRAY[@]}"; do
    echo ">> Packaging mod for $arch..."
    
    # 4a. Copy the server mod release builds for each architecture.
    echo "  Copying $arch server mod files for distribution..."
    server_dest="$dist_folder/$arch/$server_mod_structure"
    mkdir -p $server_dest
    cp -r "ServerMod/bin/Release/RaidReview/$arch/"/* "$server_dest/"

    # Remove unnecessary files (keep server libs + config)
    find "$server_dest" -type f ! -path "$server_dest/config/*" ! \( -name "*.dll" -o -name "*.so" -o -name "*.dylib" \) -delete
    # Remove native runtime DLLs from the root folder to avoid the SPT mod loader treating them as managed assemblies. Keeps .so/.dylib for Linux/macOS.
    rm -f "$server_dest"/e_sqlite3.dll "$server_dest"/libe_sqlite3.dll
    find "$server_dest" \( -name "SPTarkov.*" -o -name "SemanticVersioning.*" -o -name "JetBrains.*" \) -delete

    # 4b. Copy the client mod to each architecture distribution folder.
    echo "  Copying client mod files for $arch distribution..."
    client_dest="$dist_folder/$arch/$client_mod_structure"
    mkdir -p $client_dest
    cp "$output_path"/RAID_REVIEW.dll "$client_dest/"

    # 4c. Create ZIP archive
    echo "  Creating archive for $arch distribution..."
    cd "$dist_folder/$arch"
    powershell -Command "Compress-Archive -Force -Path '*' -DestinationPath \"../../${name}__${version}__${arch}.zip\"" > /dev/null
    cd "$current_dir"
done

# 5. Cleanup
echo ">> Cleaning up temporary distribution folders..."
rm -rf "$dist_folder"

echo ""
echo "Finished! The following archives were created and are ready to be published:"
for arch in "${ARCH_ARRAY[@]}"; do
    echo "  dist/${name}__${version}__${arch}.zip"
done