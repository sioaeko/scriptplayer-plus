# Updating and recovering ScriptPlayer+

[한국어](UPDATE_AND_RECOVERY_KO.md)

## Back up before updating

1. Stop playback, disconnect the device from the app, and exit ScriptPlayer+ completely.
2. Copy the entire user-data directory to a separate backup folder. Keep the original directory intact.
3. Keep a copy of the previous official installer or ZIP and record its version.

Default user-data locations:

| System | Location |
| --- | --- |
| Windows | %APPDATA%\scriptplayer-plus |
| macOS | ~/Library/Application Support/scriptplayer-plus |
| Linux | ~/.config/scriptplayer-plus (or the configured XDG configuration directory) |

An explicit --user-data-dir or a development profile changes the actual location. Windows ZIP and Setup distributions normally share the same profile. A ZIP is a portable application directory, not a separate profile.

Back up the full directory, including library-catalog.json, runtime preferences, Local Storage, IndexedDB, custom thumbnails, and plugin settings. Copying only the catalog does not preserve renderer settings, ratings, recent items, or saved offsets. Media and funscript files stored outside this directory are not included in this backup and are not modified by this procedure.

## Install and check

Use the official Setup for the installed Windows application, or extract the new ZIP into a new application folder. After updating, confirm the version in Settings, check the library and favorites, open a known video/script pair, and review device settings before reconnecting.

If an external drive or NAS is offline, reconnect it before diagnosing a missing source. Do not reset the app or rebuild/delete the catalog as the first recovery step.

## Roll back with a matching profile

1. Exit the new version completely.
2. Preserve the current profile in a second, separately named backup folder.
3. Restore the pre-update profile as a complete directory and use the matching previous official application version. Keep both backups until recovery is confirmed.
4. Confirm the library, ratings, offsets, device configuration, and one video/script pair.

Do not assume an older application can read a profile already written by a newer version. ScriptPlayer+ does not automatically downgrade a schema or merge two profile backups. A restore returns settings to the backup time; keep newer state available in the second backup.

## Reporting an update or playback issue

Include the app version, Setup/ZIP package, Windows version, storage type, steps, expected result, and actual result. For playback delays, copy Device → Diagnostics → Copy Issue Report after reproduction. Review the text before posting: even redacted reports can contain media filenames. Never attach an entire profile, media library, connection key, pairing token, or private network credentials.
