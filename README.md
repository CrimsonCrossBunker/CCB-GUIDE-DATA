# CCB-GUIDE-DATA

Generated data for the
[Cataclysm: Cleanwater Bomb Guide](https://github.com/CrimsonCrossBunker/CCB-GUIDE).

The `action` branch contains the generator and scheduled GitHub Actions
workflow. The generated `main` branch contains only the most recent Cleanwater
Bomb release in the following locations:

- `builds.json`
- `data/latest/all.json`
- `data/latest/lang/<locale>.json`
- `data/<release>/...`

Keeping a single release bounds repository growth while allowing the guide to
update automatically every six hours. A manual run is also available from the
Actions tab.

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
