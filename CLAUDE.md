# CLAUDE.md

mcPER is an MCP server (stdio) that exposes the Fiat ePER v84 parts catalogue (data release 04210, 2014) to clients such as Claude Desktop. It is plain JavaScript (Node.js ESM) with no native modules.

The data access and fitment logic is ported from [openPER](https://github.com/OldBoyCoder/openPER) (C#), as of commit `d6a93eb` on main. openPER is a reference only; it is not used at runtime.

## References (openPER)

When something is unclear, look here first. All links are pinned to a commit.

| Topic | Link |
|---|---|
| SQL and data access | [Release84Repository.cs](https://github.com/OldBoyCoder/openPER/blob/d6a93eb3cd124646e0ba3f3fd179c6bf8e04b5c2/openRepositories/Repositories/Release84Repository.cs) |
| VIN decoding and the KTD "F3" file format | [VinSearcher/](https://github.com/OldBoyCoder/openPER/tree/d6a93eb3cd124646e0ba3f3fd179c6bf8e04b5c2/VinSearcher) |
| Fitment (patterns, MODIF) | [PatternMatchHelper.cs](https://github.com/OldBoyCoder/openPER/blob/d6a93eb3cd124646e0ba3f3fd179c6bf8e04b5c2/openPER/Helpers/PatternMatchHelper.cs) |
| Schema notes | [Release84SchemaNotes.md](https://github.com/OldBoyCoder/openPER/blob/d6a93eb3cd124646e0ba3f3fd179c6bf8e04b5c2/openRepositories/Repositories/Release84SchemaNotes.md) |
| Expression evaluator and tests built from real ePER output (later reverted, so not on main) | [commit 8194551](https://github.com/OldBoyCoder/openPER/commit/81945516073d1263f2abde5d6caa589a42d76801) |

The evaluator in `src/filter/pattern.js` is a port of `ExpressionEvaluater.cs` from commit 8194551. The nine cases in `scripts/check-eper.js` come from `PartsFilteringTests.cs` in the same commit.

## Commands

```sh
npm run build-data    # build data/pack from ePER (~40 s for SQLite, a few minutes including images)
npm test              # node --test; needs data/pack
npm run check-eper    # compare with real ePER output (tests from openPER commit 8194551); must be 9/9 ok
node scripts/smoke.js [tool] '<json>' [image-dir]   # call a tool as an MCP client; omit tool to list tools
node --no-warnings scripts/sql.js "SELECT ..."      # ad-hoc SQL against the data/pack DB
```

`node:sqlite` emits an ExperimentalWarning, so run node with `--no-warnings`.

## Layout

- `src/index.js`: the MCP server. Tool registration and the server instructions (usage guidance for the AI).
  - Tools returning JSON are registered with `tool()`.
  - Tools returning images use `imageTool()` and `imageResult()`.
- `src/config.js`
  - `config`: the data directory read at runtime (`MCPER_DATA_DIR`, default `data/pack`).
  - `eperSource`: the ePER installation. Used only by `build-data`.
- `src/db.js`: read-only SQLite with named parameters.
  - `:lang` and `:fb` are always bound.
  - `dsc(table, col, where)` builds an SQL fragment returning the description in the requested language, falling back to English (`3`).
  - All result strings are NFKC-normalised (turns halfwidth katakana into fullwidth).
- `src/catalog.js`: catalogue search, parts tables, supersessions, where-used, drawing info.
- `src/vehicle.js`: VIN decoding (SP.CH / SP.RT) and the vehicle context used for fitment.
- `src/filter/pattern.js`: fitment pattern evaluation; returns three values (`yes` / `no` / `maybe`).
- `src/filter/modif.js`: MODIF and MDF_ACT cut-over evaluation.
- `src/ktd/ktdReader.js`: reader for the KTD "F3" format (header and index, then bzip2-compressed blocks).
- `src/images.js`: PNG extraction from `.res` files (uncompressed ZIP), red frames (pngjs), partial ZIP copy.
- `scripts/build-data.js`: converts the MDB (mdb-reader) to SQLite keeping only the selected languages, copies the VIN files and extracts the referenced images.
- `scripts/schema.js`: index definitions.

## Data essentials

- A drawing is keyed by `CAT_COD, GRP_COD, SGRP_COD, SGS_COD, VARIANTE, REVISIONE`, shared by DRAWINGS and TBDATA.
- Supersessions are in `RPLNT`, directed `PRT_COD` (old) → `RPL_COD` (new).
- Assembly components are in `CPXDATA` (`CPLX_PRT_COD` → `PRT_COD`); exploded views are in `CLICHE`.
  - Some parts, such as brake pads, appear only in CPXDATA and not in TBDATA.
  - So `search_parts` searches both.
- Pattern syntax: `,` = OR, `+` = AND, `!` = NOT.
  - Strip `|` from the VIN's CARATT (`CC|2.0` → `CC2.0`).
  - Three-digit numeric options (`008`) also apply to symbols ending in them (`E008`).
- Drive side: GS / GSX = left-hand drive, GD / GDX = right-hand drive.
  - When the VIN states one side, the other is set to false.
  - `drive: 'L' | 'R'` corresponds to ePER's DRIVE selector and overrides the VIN.
  - The Grand Punto case in check-eper was recorded with ePER set to DRIVE=S (left-hand), hence `drive: 'L'`.
- When several SINCOM rows share an MVS (different markets or drive sides), pick the one that agrees with CARATT on the most items (`score` in `vehicle.js`).
- Differences from openPER:
  - SP.RT colour columns are read by name (COLINT / COLEST), not by openPER's indexes (7, 8).
- Japanese descriptions are stored as halfwidth katakana.
  - Search converts the input to halfwidth katakana and ignores "･" (`toHalfwidthKatakana`).
  - Terms are terse, e.g. "パッド・セット".
- The availability bits of `PRT_MASK_MAK` (orderable, replaced, exhausted) reflect 2014: **never report them** (user requirement).

## Gotchas

- Tests, check-eper and smoke all need `data/pack`, but not the ePER installation.
  - To make sure the pack alone is enough, run with `EPER_DIR=C:\nonexistent`.
- The MCP SDK's `StdioClientTransport` passes almost no environment variables to the child process, so `smoke.js` sets `env: process.env` explicitly.
- Claude Desktop keeps the server running and the DB file open.
  - Before replacing `data/pack`, quit Desktop or stop the node processes running `mcPER\src\index.js`.
  - Desktop also needs a restart after code changes.
- With the Bash tool on Windows, the shell easily mangles template literals inside `node -e` or heredocs, `'` and `>=`. Use the Edit / Write tools for multi-line changes.
- ePER data is copyrighted by Fiat. Never publish or commit the data directory (`data/` is in .gitignore).
