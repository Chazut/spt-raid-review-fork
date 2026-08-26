using System.Reflection;
using System.Runtime.InteropServices;
using System.Threading.Channels;
using Microsoft.Data.Sqlite;

namespace RaidReview.Database;

public class DatabaseService : IDisposable
{
    private SqliteConnection? _connection;
    private string _dbPath = string.Empty;
    private static IntPtr _nativeSqliteHandle;
    private Action<string>? _log;

    // Write-behind queue for high-rate single-row inserts (BALLISTIC during firefights, PLAYER_STATUS).
    // Producers enqueue and return immediately; one drain task coalesces ~250ms windows into a single
    // transaction per statement shape, collapsing dozens of per-row commits into one. Order within a
    // table is preserved (single reader). Bounded staleness: rows are visible at most ~250ms late,
    // which nothing reads that fast mid-raid.
    private readonly Channel<(string sql, (string name, object? value)[] parameters)> _writeBehind =
        Channel.CreateUnbounded<(string, (string, object?)[])>(new UnboundedChannelOptions { SingleReader = true });
    private Task? _writeBehindDrainTask;
    private readonly CancellationTokenSource _writeBehindCts = new();

    public async Task InitializeAsync(string dataFolder, Action<string>? log = null)
    {
        // Pre-load the native e_sqlite3 library from the runtimes subfolder.
        // SPT loads mods as plugins so .NET won't probe the mod folder automatically.
        // On Linux, NativeLibrary.Load() alone isn't enough — the P/Invoke resolver in
        // SQLitePCLRaw does its own dlopen("e_sqlite3") which doesn't find our loaded lib.
        // We must register a DllImportResolver on the provider assembly to return our handle.
        var modDir = Path.GetDirectoryName(typeof(DatabaseService).Assembly.Location)!;
        var runtimesDir = Path.Combine(modDir, "runtimes");
        var rid = RuntimeInformation.RuntimeIdentifier;
        var isWindows = RuntimeInformation.IsOSPlatform(OSPlatform.Windows);

        log?.Invoke($"[RAID-REVIEW] SQLite native loader: modDir={modDir}, rid={rid}, isWindows={isWindows}");
        log?.Invoke($"[RAID-REVIEW] SQLite native loader: runtimesDir exists={Directory.Exists(runtimesDir)}");

        if (Directory.Exists(runtimesDir))
        {
            var libName = isWindows ? "e_sqlite3.dll" : "libe_sqlite3.so";

            // Try the exact RID first, then fall back to generic win-x64 / linux-x64
            var candidates = new List<string>();
            if (!string.IsNullOrEmpty(rid))
                candidates.Add(Path.Combine(runtimesDir, rid, "native", libName));
            candidates.Add(Path.Combine(runtimesDir, isWindows ? "win-x64" : "linux-x64", "native", libName));

            foreach (var candidate in candidates)
            {
                log?.Invoke($"[RAID-REVIEW] SQLite native loader: trying {candidate} (exists={File.Exists(candidate)})");
                if (File.Exists(candidate))
                {
                    try
                    {
                        _nativeSqliteHandle = NativeLibrary.Load(candidate);
                        log?.Invoke($"[RAID-REVIEW] SQLite native loader: loaded {candidate} (handle=0x{_nativeSqliteHandle:X})");
                    }
                    catch (Exception ex)
                    {
                        log?.Invoke($"[RAID-REVIEW] SQLite native loader: FAILED to load {candidate}: {ex.Message}");
                        continue;
                    }
                    break;
                }
            }

            // Register a DllImportResolver on the SQLitePCLRaw provider assembly so that
            // when it P/Invokes "e_sqlite3", we return the handle we already loaded.
            if (_nativeSqliteHandle != IntPtr.Zero)
            {
                var providerAssembly = typeof(SQLitePCL.SQLite3Provider_e_sqlite3).Assembly;
                NativeLibrary.SetDllImportResolver(providerAssembly, (libraryName, assembly, searchPath) =>
                {
                    if (libraryName == "e_sqlite3")
                        return _nativeSqliteHandle;
                    return IntPtr.Zero;
                });
                log?.Invoke($"[RAID-REVIEW] SQLite native loader: DllImportResolver registered on {providerAssembly.GetName().Name}");
            }
        }

        SQLitePCL.Batteries_V2.Init();
        Directory.CreateDirectory(dataFolder);
        _dbPath = Path.Combine(dataFolder, "raid_review_mod.db");

        // Connection string with pooling so per-call connections in
        // ExecuteAsync / QueryAsync get reused from the pool instead of
        // re-opening the file each time. Cache=Shared lets the same
        // in-memory page cache be shared across pooled connections.
        _connectionString = $"Data Source={_dbPath};Pooling=True;Cache=Shared";
        _connection = new SqliteConnection(_connectionString);
        await _connection.OpenAsync();

        // WAL mode allows one writer + many concurrent readers without
        // blocking on the same write lock. busy_timeout makes any caller
        // wait up to 5s for the lock instead of erroring instantly, which
        // is what was starving the Kestrel thread pool: every concurrent
        // ws packet handler was serialising through the single shared
        // connection's exclusive write lock.
        await ExecuteOnAsync(_connection, "PRAGMA journal_mode = WAL;");
        await ExecuteOnAsync(_connection, "PRAGMA busy_timeout = 5000;");
        await ExecuteOnAsync(_connection, "PRAGMA synchronous = NORMAL;");
        // temp_store = MEMORY keeps SQLite's transient indexes, sort scratch and intermediate result sets
        // off the physical disk and in process RAM. Reported as a meaningful speedup on slow / write-through
        // RAID arrays (Krelsis.net, Discord) where every disk write is a synchronous round-trip — moving
        // the throwaway temp data out of that path takes a significant chunk of small writes off the I/O
        // queue. Costs a small amount of RAM (typically a few hundred KB) and zero risk: the data is
        // by definition temporary and doesn't survive a transaction commit.
        await ExecuteOnAsync(_connection, "PRAGMA temp_store = MEMORY;");

        await RunMigrationsAsync();

        _log = log;
        _writeBehindDrainTask = Task.Run(() => DrainWriteBehindAsync(_writeBehindCts.Token));
    }

    /// <summary>
    /// Fire-and-forget insert for high-rate event streams. The statement lands within ~250ms,
    /// batched with everything else queued in that window. Use ExecuteAsync when the caller
    /// needs the row visible immediately (raid lifecycle, dedup-sensitive writes).
    /// </summary>
    public void QueueWrite(string sql, params (string name, object? value)[] parameters)
        => _writeBehind.Writer.TryWrite((sql, parameters));

    private async Task DrainWriteBehindAsync(CancellationToken ct)
    {
        var pending = new List<(string sql, (string name, object? value)[] parameters)>(256);
        while (true)
        {
            try
            {
                if (!await _writeBehind.Reader.WaitToReadAsync(ct)) return;
                // Coalesce the burst: grab what's there, give the window a moment to fill, grab again.
                while (_writeBehind.Reader.TryRead(out var item)) pending.Add(item);
                await Task.Delay(250, ct);
                while (_writeBehind.Reader.TryRead(out var item)) pending.Add(item);

                foreach (var group in pending.GroupBy(p => p.sql))
                    await ExecuteBatchAsync(group.Key, group.Select(g => g.parameters));
                pending.Clear();
            }
            catch (OperationCanceledException)
            {
                // Shutdown: push whatever is still queued before letting go.
                while (_writeBehind.Reader.TryRead(out var item)) pending.Add(item);
                foreach (var group in pending.GroupBy(p => p.sql))
                    try { await ExecuteBatchAsync(group.Key, group.Select(g => g.parameters)); } catch { /* best effort on shutdown */ }
                return;
            }
            catch (Exception ex)
            {
                _log?.Invoke($"[DB] write-behind drain error ({pending.Count} rows dropped): {ex.Message}");
                pending.Clear();
            }
        }
    }

    private string _connectionString = string.Empty;

    private static async Task ExecuteOnAsync(SqliteConnection conn, string sql)
    {
        using var cmd = conn.CreateCommand();
        cmd.CommandText = sql;
        await cmd.ExecuteNonQueryAsync();
    }

    public SqliteConnection Connection => _connection ?? throw new InvalidOperationException("Database not initialized.");

    private async Task RunMigrationsAsync()
    {
        // Create migrations table if it doesn't exist
        await ExecuteAsync(@"
            CREATE TABLE IF NOT EXISTS __migrations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE,
                applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        ");

        var migrations = new List<(string name, string sql)>
        {
            ("init", @"
                CREATE TABLE IF NOT EXISTS raid (
                    ""id"" INTEGER PRIMARY KEY AUTOINCREMENT,
                    ""raidId"" TEXT NOT NULL,
                    ""profileId"" TEXT NOT NULL,
                    ""location"" TEXT NOT NULL,
                    ""time"" TEXT NOT NULL,
                    ""timeInRaid"" TEXT NOT NULL,
                    ""exitName"" TEXT NOT NULL,
                    ""exitStatus"" TEXT NOT NULL,
                    ""detectedMods"" TEXT NOT NULL,
                    ""created_at"" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );
                CREATE TABLE IF NOT EXISTS player (
                    ""id"" INTEGER PRIMARY KEY AUTOINCREMENT,
                    ""raidId"" TEXT NOT NULL,
                    ""profileId"" TEXT NOT NULL,
                    ""level"" INTEGER NOT NULL,
                    ""team"" TEXT NOT NULL,
                    ""name"" TEXT NOT NULL,
                    ""group"" INTEGER NOT NULL,
                    ""spawnTime"" INTEGER NOT NULL,
                    ""created_at"" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (""raidId"") REFERENCES raid(""id"")
                );
                CREATE TABLE IF NOT EXISTS kills (
                    ""id"" INTEGER PRIMARY KEY AUTOINCREMENT,
                    ""raidId"" TEXT NOT NULL,
                    ""profileId"" TEXT NOT NULL,
                    ""time"" INTEGER NOT NULL,
                    ""killedId"" TEXT NOT NULL,
                    ""weapon"" TEXT NOT NULL,
                    ""distance"" TEXT NOT NULL,
                    ""bodyPart"" TEXT NOT NULL,
                    ""positionKilled"" TEXT NOT NULL,
                    ""positionKiller"" TEXT NOT NULL,
                    ""created_at"" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (""raidId"") REFERENCES raid(""id"")
                );
                CREATE TABLE IF NOT EXISTS looting (
                    ""id"" INTEGER PRIMARY KEY AUTOINCREMENT,
                    ""raidId"" TEXT NOT NULL,
                    ""profileId"" TEXT NOT NULL,
                    ""time"" TEXT NOT NULL,
                    ""qty"" TEXT NOT NULL,
                    ""itemId"" TEXT NOT NULL,
                    ""itemName"" TEXT NOT NULL,
                    ""added"" TEXT NOT NULL,
                    ""created_at"" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (""raidId"") REFERENCES raid(""id"")
                );
            "),
            ("add_mod_sain_brain", @"
                ALTER TABLE player ADD COLUMN ""mod_SAIN_brain"" TEXT NOT NULL DEFAULT 'UNKNOWN';
            "),
            ("add_type_to_player", @"
                ALTER TABLE player ADD COLUMN ""type"" TEXT NOT NULL DEFAULT 'BOT';
            "),
            ("add_mod_sain_difficulty", @"
                ALTER TABLE player ADD COLUMN ""mod_SAIN_difficulty"" TEXT NOT NULL DEFAULT '';
            "),
            ("add_type_to_raids", @"
                ALTER TABLE raid ADD COLUMN ""type"" TEXT NOT NULL DEFAULT '';
            "),
            ("add_ballistics_tracking", @"
                CREATE TABLE IF NOT EXISTS ballistic (
                    ""id"" INTEGER PRIMARY KEY AUTOINCREMENT,
                    ""raidId"" TEXT NOT NULL,
                    ""time"" INTEGER NOT NULL,
                    ""profileId"" TEXT NOT NULL,
                    ""weaponId"" TEXT NOT NULL,
                    ""ammoId"" TEXT NOT NULL,
                    ""hitPlayerId"" TEXT,
                    ""source"" TEXT NOT NULL,
                    ""target"" TEXT NOT NULL,
                    ""created_at"" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (""raidId"") REFERENCES raid(""id"")
                );
            "),
            ("add_player_status_tracking", @"
                CREATE TABLE IF NOT EXISTS player_status (
                    ""id"" INTEGER PRIMARY KEY AUTOINCREMENT,
                    ""raidId"" TEXT NOT NULL,
                    ""profileId"" TEXT NOT NULL,
                    ""time"" INTEGER NOT NULL,
                    ""status"" TEXT NOT NULL,
                    ""created_at"" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (""raidId"") REFERENCES raid(""id"")
                );
            "),
            ("fix_foreign_keys", @"
                CREATE UNIQUE INDEX IF NOT EXISTS idx_raid_raidId ON raid(""raidId"");

                CREATE TABLE player_new (
                    ""id"" INTEGER PRIMARY KEY AUTOINCREMENT,
                    ""raidId"" TEXT NOT NULL,
                    ""profileId"" TEXT NOT NULL,
                    ""level"" INTEGER NOT NULL,
                    ""team"" TEXT NOT NULL,
                    ""name"" TEXT NOT NULL,
                    ""group"" INTEGER NOT NULL,
                    ""spawnTime"" INTEGER NOT NULL,
                    ""type"" TEXT NOT NULL DEFAULT 'BOT',
                    ""mod_SAIN_brain"" TEXT NOT NULL DEFAULT 'UNKNOWN',
                    ""mod_SAIN_difficulty"" TEXT NOT NULL DEFAULT '',
                    ""created_at"" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (""raidId"") REFERENCES raid(""raidId"")
                );
                INSERT INTO player_new SELECT * FROM player;
                DROP TABLE player;
                ALTER TABLE player_new RENAME TO player;

                CREATE TABLE kills_new (
                    ""id"" INTEGER PRIMARY KEY AUTOINCREMENT,
                    ""raidId"" TEXT NOT NULL,
                    ""profileId"" TEXT NOT NULL,
                    ""time"" INTEGER NOT NULL,
                    ""killedId"" TEXT NOT NULL,
                    ""weapon"" TEXT NOT NULL,
                    ""distance"" TEXT NOT NULL,
                    ""bodyPart"" TEXT NOT NULL,
                    ""positionKilled"" TEXT NOT NULL,
                    ""positionKiller"" TEXT NOT NULL,
                    ""created_at"" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (""raidId"") REFERENCES raid(""raidId"")
                );
                INSERT INTO kills_new SELECT * FROM kills;
                DROP TABLE kills;
                ALTER TABLE kills_new RENAME TO kills;

                CREATE TABLE looting_new (
                    ""id"" INTEGER PRIMARY KEY AUTOINCREMENT,
                    ""raidId"" TEXT NOT NULL,
                    ""profileId"" TEXT NOT NULL,
                    ""time"" TEXT NOT NULL,
                    ""qty"" TEXT NOT NULL,
                    ""itemId"" TEXT NOT NULL,
                    ""itemName"" TEXT NOT NULL,
                    ""added"" TEXT NOT NULL,
                    ""created_at"" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (""raidId"") REFERENCES raid(""raidId"")
                );
                INSERT INTO looting_new SELECT * FROM looting;
                DROP TABLE looting;
                ALTER TABLE looting_new RENAME TO looting;

                CREATE TABLE ballistic_new (
                    ""id"" INTEGER PRIMARY KEY AUTOINCREMENT,
                    ""raidId"" TEXT NOT NULL,
                    ""time"" INTEGER NOT NULL,
                    ""profileId"" TEXT NOT NULL,
                    ""weaponId"" TEXT NOT NULL,
                    ""ammoId"" TEXT NOT NULL,
                    ""hitPlayerId"" TEXT,
                    ""source"" TEXT NOT NULL,
                    ""target"" TEXT NOT NULL,
                    ""created_at"" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (""raidId"") REFERENCES raid(""raidId"")
                );
                INSERT INTO ballistic_new SELECT * FROM ballistic;
                DROP TABLE ballistic;
                ALTER TABLE ballistic_new RENAME TO ballistic;

                CREATE TABLE player_status_new (
                    ""id"" INTEGER PRIMARY KEY AUTOINCREMENT,
                    ""raidId"" TEXT NOT NULL,
                    ""profileId"" TEXT NOT NULL,
                    ""time"" INTEGER NOT NULL,
                    ""status"" TEXT NOT NULL,
                    ""created_at"" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (""raidId"") REFERENCES raid(""raidId"")
                );
                INSERT INTO player_status_new SELECT * FROM player_status;
                DROP TABLE player_status;
                ALTER TABLE player_status_new RENAME TO player_status;
            "),
            ("add_ballistic_weapon_name", @"
                ALTER TABLE ballistic ADD COLUMN ""weaponName"" TEXT DEFAULT '';
            "),
            ("add_loot_price_columns", @"
                ALTER TABLE looting ADD COLUMN ""templateId"" TEXT DEFAULT '';
                ALTER TABLE looting ADD COLUMN ""price"" INTEGER DEFAULT 0;
            "),
            ("add_loose_loot_table", @"
                CREATE TABLE IF NOT EXISTS loose_loot (
                    ""id"" INTEGER PRIMARY KEY AUTOINCREMENT,
                    ""raidId"" TEXT NOT NULL,
                    ""templateId"" TEXT NOT NULL,
                    ""itemName"" TEXT NOT NULL,
                    ""price"" INTEGER DEFAULT 0,
                    ""qty"" INTEGER DEFAULT 1,
                    ""x"" REAL NOT NULL,
                    ""y"" REAL NOT NULL,
                    ""z"" REAL NOT NULL,
                    ""inContainer"" INTEGER DEFAULT 0,
                    ""created_at"" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (""raidId"") REFERENCES raid(""raidId"")
                );
            "),
            ("add_loose_loot_item_id", @"
                ALTER TABLE loose_loot ADD COLUMN ""itemId"" TEXT DEFAULT '';
                ALTER TABLE loose_loot ADD COLUMN ""containerName"" TEXT DEFAULT '';
            "),
            ("add_player_inventory_table", @"
                CREATE TABLE IF NOT EXISTS player_inventory (
                    ""id"" INTEGER PRIMARY KEY AUTOINCREMENT,
                    ""raidId"" TEXT NOT NULL,
                    ""profileId"" TEXT NOT NULL,
                    ""templateId"" TEXT NOT NULL,
                    ""itemName"" TEXT NOT NULL,
                    ""price"" INTEGER DEFAULT 0,
                    ""qty"" INTEGER DEFAULT 1,
                    ""slot"" TEXT DEFAULT '',
                    ""created_at"" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (""raidId"") REFERENCES raid(""raidId"")
                );
            "),
            ("add_loot_position_columns", @"
                ALTER TABLE looting ADD COLUMN ""x"" REAL DEFAULT 0;
                ALTER TABLE looting ADD COLUMN ""y"" REAL DEFAULT 0;
                ALTER TABLE looting ADD COLUMN ""z"" REAL DEFAULT 0;
            "),
            ("add_loose_loot_unique_index", @"
                DELETE FROM loose_loot WHERE rowid NOT IN (
                    SELECT MIN(rowid) FROM loose_loot GROUP BY raidId, itemId
                );
                CREATE UNIQUE INDEX IF NOT EXISTS idx_loose_loot_raid_item ON loose_loot(""raidId"", ""itemId"");
            "),
            ("add_bot_quest_table", @"
                CREATE TABLE IF NOT EXISTS bot_quest (
                    ""id"" INTEGER PRIMARY KEY AUTOINCREMENT,
                    ""raidId"" TEXT NOT NULL,
                    ""profileId"" TEXT NOT NULL,
                    ""time"" INTEGER NOT NULL,
                    ""questName"" TEXT NOT NULL,
                    ""isEFTQuest"" INTEGER DEFAULT 0,
                    ""actionType"" TEXT NOT NULL DEFAULT '',
                    ""status"" TEXT NOT NULL DEFAULT '',
                    ""objectiveX"" REAL DEFAULT 0,
                    ""objectiveY"" REAL DEFAULT 0,
                    ""objectiveZ"" REAL DEFAULT 0,
                    ""created_at"" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (""raidId"") REFERENCES raid(""raidId"")
                );
            "),
            ("add_bot_objective_table", @"
                CREATE TABLE IF NOT EXISTS bot_objective (
                    ""id"" INTEGER PRIMARY KEY AUTOINCREMENT,
                    ""raidId"" TEXT NOT NULL,
                    ""profileId"" TEXT NOT NULL,
                    ""time"" INTEGER NOT NULL,
                    ""status"" TEXT NOT NULL DEFAULT '',
                    ""category"" TEXT NOT NULL DEFAULT '',
                    ""isLeader"" INTEGER DEFAULT 0,
                    ""objectiveX"" REAL DEFAULT 0,
                    ""objectiveY"" REAL DEFAULT 0,
                    ""objectiveZ"" REAL DEFAULT 0,
                    ""created_at"" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (""raidId"") REFERENCES raid(""raidId"")
                );
            "),
            ("add_phobos_field_table", @"
                CREATE TABLE IF NOT EXISTS phobos_field (
                    ""id"" INTEGER PRIMARY KEY AUTOINCREMENT,
                    ""raidId"" TEXT NOT NULL,
                    ""time"" INTEGER NOT NULL,
                    ""gridCols"" INTEGER DEFAULT 0,
                    ""gridRows"" INTEGER DEFAULT 0,
                    ""worldMinX"" REAL DEFAULT 0,
                    ""worldMinZ"" REAL DEFAULT 0,
                    ""cellSize"" REAL DEFAULT 0,
                    ""advection"" TEXT NOT NULL DEFAULT '[]',
                    ""convergence"" TEXT NOT NULL DEFAULT '[]',
                    ""zones"" TEXT NOT NULL DEFAULT '[]',
                    ""created_at"" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (""raidId"") REFERENCES raid(""raidId"")
                );
            "),
            // ORBIT tables — the supported AI integration. Each receives
            // periodic snapshots from the client integration class.
            ("add_orbit_field_table", @"
                CREATE TABLE IF NOT EXISTS orbit_field (
                    ""id"" INTEGER PRIMARY KEY AUTOINCREMENT,
                    ""raidId"" TEXT NOT NULL,
                    ""time"" INTEGER NOT NULL,
                    ""gridCols"" INTEGER DEFAULT 0,
                    ""gridRows"" INTEGER DEFAULT 0,
                    ""worldMinX"" REAL DEFAULT 0,
                    ""worldMinZ"" REAL DEFAULT 0,
                    ""cellSize"" REAL DEFAULT 0,
                    ""advection"" TEXT NOT NULL DEFAULT '[]',
                    ""convergence"" TEXT NOT NULL DEFAULT '[]',
                    ""zones"" TEXT NOT NULL DEFAULT '[]',
                    ""created_at"" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (""raidId"") REFERENCES raid(""raidId"")
                );
            "),
            ("add_orbit_bot_objective_table", @"
                CREATE TABLE IF NOT EXISTS orbit_bot_objective (
                    ""id"" INTEGER PRIMARY KEY AUTOINCREMENT,
                    ""raidId"" TEXT NOT NULL,
                    ""profileId"" TEXT NOT NULL,
                    ""time"" INTEGER NOT NULL,
                    ""status"" TEXT NOT NULL DEFAULT '',
                    ""category"" TEXT NOT NULL DEFAULT '',
                    ""isLeader"" INTEGER NOT NULL DEFAULT 0,
                    ""objectiveX"" REAL DEFAULT 0,
                    ""objectiveY"" REAL DEFAULT 0,
                    ""objectiveZ"" REAL DEFAULT 0,
                    ""extractReason"" TEXT NOT NULL DEFAULT '',
                    ""created_at"" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (""raidId"") REFERENCES raid(""raidId"")
                );
            "),
            ("add_orbit_ghost_fight_table", @"
                CREATE TABLE IF NOT EXISTS orbit_ghost_fight (
                    ""id"" INTEGER PRIMARY KEY AUTOINCREMENT,
                    ""raidId"" TEXT NOT NULL,
                    ""time"" INTEGER NOT NULL,
                    ""aX"" REAL DEFAULT 0,
                    ""aY"" REAL DEFAULT 0,
                    ""aZ"" REAL DEFAULT 0,
                    ""bX"" REAL DEFAULT 0,
                    ""bY"" REAL DEFAULT 0,
                    ""bZ"" REAL DEFAULT 0,
                    ""durationMs"" INTEGER NOT NULL DEFAULT 0,
                    ""casualties"" INTEGER NOT NULL DEFAULT 0,
                    ""created_at"" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (""raidId"") REFERENCES raid(""raidId"")
                );
            "),
            ("add_orbit_main_objectives_table", @"
                CREATE TABLE IF NOT EXISTS orbit_main_objectives (
                    ""id"" INTEGER PRIMARY KEY AUTOINCREMENT,
                    ""raidId"" TEXT NOT NULL,
                    ""time"" INTEGER NOT NULL,
                    ""squads"" TEXT NOT NULL DEFAULT '[]',
                    ""created_at"" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (""raidId"") REFERENCES raid(""raidId"")
                );
            "),
            // Every UI / API read filters on raidId, but only raid + loose_loot were indexed — the
            // raid-detail endpoints full-scanned every table, slower with each raid the GC keeps.
            // The player dedup (raidId, profileId) is UNIQUE so the PLAYER packet handler can use a
            // bare INSERT OR IGNORE instead of its per-spawn SELECT round-trip; the DELETE clears any
            // duplicate rows that slipped in before this index existed (concurrent PLAYER packets).
            ("add_raid_id_indexes", @"
                DELETE FROM player WHERE rowid NOT IN (SELECT MIN(rowid) FROM player GROUP BY raidId, profileId);
                CREATE UNIQUE INDEX IF NOT EXISTS idx_player_raid_profile ON player(""raidId"", ""profileId"");
                CREATE INDEX IF NOT EXISTS idx_kills_raidId ON kills(""raidId"");
                CREATE INDEX IF NOT EXISTS idx_looting_raidId ON looting(""raidId"");
                CREATE INDEX IF NOT EXISTS idx_ballistic_raidId ON ballistic(""raidId"");
                CREATE INDEX IF NOT EXISTS idx_player_status_raidId ON player_status(""raidId"");
                CREATE INDEX IF NOT EXISTS idx_player_inventory_raidId ON player_inventory(""raidId"");
                CREATE INDEX IF NOT EXISTS idx_bot_quest_raidId ON bot_quest(""raidId"");
                CREATE INDEX IF NOT EXISTS idx_bot_objective_raidId ON bot_objective(""raidId"");
                CREATE INDEX IF NOT EXISTS idx_phobos_field_raidId ON phobos_field(""raidId"");
                CREATE INDEX IF NOT EXISTS idx_orbit_field_raidId ON orbit_field(""raidId"");
                CREATE INDEX IF NOT EXISTS idx_orbit_bot_objective_raidId ON orbit_bot_objective(""raidId"");
                CREATE INDEX IF NOT EXISTS idx_orbit_main_objectives_raidId ON orbit_main_objectives(""raidId"");
            "),
            ("add_mod_sain_name", @"
                ALTER TABLE player ADD COLUMN ""mod_SAIN_name"" TEXT NOT NULL DEFAULT '';
            "),
        };

        foreach (var (name, sql) in migrations)
        {
            var checkCmd = _connection!.CreateCommand();
            checkCmd.CommandText = "SELECT COUNT(*) FROM __migrations WHERE name = $name";
            checkCmd.Parameters.AddWithValue("$name", name);
            var count = (long)(await checkCmd.ExecuteScalarAsync() ?? 0L);
            if (count > 0) continue;

            // Run migration statements one by one
            foreach (var stmt in sql.Split(';', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
            {
                if (string.IsNullOrWhiteSpace(stmt)) continue;
                try
                {
                    await ExecuteAsync(stmt);
                }
                catch (SqliteException ex) when (ex.Message.Contains("duplicate column"))
                {
                    // Column already exists, ignore
                }
            }

            var markCmd = _connection!.CreateCommand();
            markCmd.CommandText = "INSERT OR IGNORE INTO __migrations (name) VALUES ($name)";
            markCmd.Parameters.AddWithValue("$name", name);
            await markCmd.ExecuteNonQueryAsync();
        }
    }

    public async Task ExecuteAsync(string sql, params (string name, object? value)[] parameters)
    {
        // Per-call connection from the pool: previously every WS packet
        // handler was contending on the single shared _connection, which
        // serialised every DB write behind SQLite's exclusive write lock
        // and starved the Kestrel thread pool. With pooling + WAL mode
        // each handler grabs its own connection, runs its statement, and
        // releases — the pool reuses opened handles so it's cheap.
        using var conn = new SqliteConnection(_connectionString);
        await conn.OpenAsync();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = sql;
        foreach (var (name, value) in parameters)
            cmd.Parameters.AddWithValue(name, value ?? DBNull.Value);
        await cmd.ExecuteNonQueryAsync();
    }

    /// <summary>
    /// Bulk INSERT helper: wraps N executions in a single transaction so
    /// the per-row fsync cost collapses into one. Used by LOOSE_LOOT
    /// which can land hundreds of items per packet — without batching,
    /// each INSERT acquires the write lock + fsyncs the journal, killing
    /// the thread pool under load.
    /// </summary>
    public async Task ExecuteBatchAsync(string sql, IEnumerable<(string name, object? value)[]> parameterSets)
    {
        using var conn = new SqliteConnection(_connectionString);
        await conn.OpenAsync();
        using var tx = (SqliteTransaction)await conn.BeginTransactionAsync();
        using var cmd = conn.CreateCommand();
        cmd.Transaction = tx;
        cmd.CommandText = sql;
        foreach (var paramSet in parameterSets)
        {
            cmd.Parameters.Clear();
            foreach (var (name, value) in paramSet)
                cmd.Parameters.AddWithValue(name, value ?? DBNull.Value);
            await cmd.ExecuteNonQueryAsync();
        }
        await tx.CommitAsync();
    }

    public async Task<List<Dictionary<string, object?>>> QueryAsync(string sql, params (string name, object? value)[] parameters)
    {
        using var conn = new SqliteConnection(_connectionString);
        await conn.OpenAsync();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = sql;
        foreach (var (name, value) in parameters)
            cmd.Parameters.AddWithValue(name, value ?? DBNull.Value);

        var results = new List<Dictionary<string, object?>>();
        using var reader = await cmd.ExecuteReaderAsync();
        while (await reader.ReadAsync())
        {
            var row = new Dictionary<string, object?>();
            for (int i = 0; i < reader.FieldCount; i++)
                row[reader.GetName(i)] = reader.IsDBNull(i) ? null : reader.GetValue(i);
            results.Add(row);
        }
        return results;
    }

    public async Task<Dictionary<string, object?>?> QuerySingleAsync(string sql, params (string name, object? value)[] parameters)
    {
        var results = await QueryAsync(sql, parameters);
        return results.Count > 0 ? results[0] : null;
    }

    public void Dispose()
    {
        // Stop the write-behind drain and give it a moment to flush what's queued.
        _writeBehindCts.Cancel();
        try { _writeBehindDrainTask?.Wait(TimeSpan.FromSeconds(3)); }
        catch (AggregateException) { }
        _connection?.Dispose();
    }
}
