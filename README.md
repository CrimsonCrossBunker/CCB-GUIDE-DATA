# CCB-GUIDE-DATA

Generated data for the
[Cataclysm: Cleanwater Bomb Guide](https://github.com/CrimsonCrossBunker/CCB-GUIDE).

The `action` branch contains the generator and scheduled GitHub Actions
workflow. The generated `main` branch keeps every processed Cleanwater Bomb
release in the following locations:

- `builds.json`
- `data/latest/all.json`
- `data/latest/lang/<locale>.json`
- `data/<release>/...`

Each update adds new files to the existing data tree and advances the branch
with a normal parent commit, so previously generated releases remain
selectable. Scheduled runs process up to sixteen missing releases at a time,
starting with the newest, which also backfills releases created before history
retention was enabled. A manual run is available from the Actions tab with a
configurable batch size of up to 20 releases. Each release is uploaded before
generation continues, so batch backfills do not retain several complete
release payloads in memory at once.

The generator records a data format version in `builds.json`. When the format
changes, older entries are regenerated in batches without removing their
existing data until the replacement is ready.

## Attribution and licensing

The generator source in the `action` branch is licensed under the MIT License.
Generated game records and game translations are derived from
[Cataclysm: Cleanwater Bomb](https://github.com/CrimsonCrossBunker/Cataclysm-Cleanwater-Bomb)
and remain available under the Creative Commons Attribution-ShareAlike 3.0
Unported license and the source game's applicable third-party notices.

The repository layout and JSON interchange format are compatible with the
public format documented by
[nornagon/cdda-data](https://github.com/nornagon/cdda-data), created for the
original Hitchhiker's Guide to the Cataclysm. This generator is independently
implemented for CrimsonCrossBunker and does not copy the original update
script.
