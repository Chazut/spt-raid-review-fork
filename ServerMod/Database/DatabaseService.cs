using Microsoft.Data.Sqlite;

namespace RaidReview.Database;

public class DatabaseService : IDisposable
{
    private SqliteConnection? _connection;
    private string _dbPath = string.Empty;

    public async Task InitializeAsync(string dataFolder)
    {
        SQLitePCL.Batteries_V2.Init(); // Use winsqlite3.dll from Windows System32 — no native bundling needed
        Directory.CreateDirectory(dataFolder);
        _dbPath = Path.Combine(dataFolder, "raid_review_mod.db");

        _connection = new SqliteConnection($"Data Source={_dbPath}");
        await _connection.OpenAsync();

        await RunMigrationsAsync();
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
        using var cmd = _connection!.CreateCommand();
        cmd.CommandText = sql;
        foreach (var (name, value) in parameters)
            cmd.Parameters.AddWithValue(name, value ?? DBNull.Value);
        await cmd.ExecuteNonQueryAsync();
    }

    public async Task<List<Dictionary<string, object?>>> QueryAsync(string sql, params (string name, object? value)[] parameters)
    {
        using var cmd = _connection!.CreateCommand();
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
        _connection?.Dispose();
    }
}
