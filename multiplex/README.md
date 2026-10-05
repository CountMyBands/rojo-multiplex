# Rojo Multiplex

Rojo Multiplex runs multiple Rojo 7.7 servers at the same time and gives each one a stable local proxy. The desktop app owns the process and port details; normal use is project-based.

## Everyday use

1. Open **Rojo Multiplex**.
2. Choose **Add Project** and select one `.project.json` file.
3. Choose **Start** for every project you want available. Projects are grouped by their containing folder.
4. In Roblox Studio, open the **Rojo Multiplex** plugin and click **Connect** on the desired project.

Different Studio windows can connect to different running projects at the same time. The ordinary Rojo plugin may remain installed, but do not run both sync plugins in the same Studio window.

The app listens only on `127.0.0.1`. It assigns and remembers proxy/backend ports internally, starts a bundled Rojo 7.7.1 binary, and forwards both the MessagePack HTTP API and websocket sync stream.

The bundled binary is built from this repository's own server source, not copied from a stock Rojo release. It reports itself as Rojo 7.7.1 and speaks the same protocol, but also watches the targets of Windows file symlinks, directory symlinks, and junctions, so edits made through a link's target sync to Studio without restarting the project.

## Installation

Run `dist/Rojo Multiplex Setup 0.1.7.exe`, then choose **Install Studio Plugin** inside the desktop app. Restart Studio after installing or upgrading the plugin.

The project list is stored under the app's Windows user-data directory, normally `%APPDATA%\rojo-multiplex-manager\rojo-multiplex.json`.

## Development

```powershell
npm.cmd install
npm.cmd run prepare:rojo
npm.cmd run icons
..\multiplex\bin\rojo.exe build ..\plugin.project.json --output ..\build\RojoMultiplex.rbxm
npm.cmd run check
npm.cmd start
```

`prepare:rojo` runs `cargo build --release --locked` in the repository root and copies `target\release\rojo.exe` into `bin\`, so it needs the Rust toolchain. To bundle a different Rojo 7.7 checkout instead, set `ROJO_MULTIPLEX_ROJO_REPOSITORY` to its folder before running it.

Build the Windows installer with `npm.cmd run build`.

The Studio plugin is based on the official Rojo 7.7.1 plugin (protocol 5) and remains covered by the repository's MPL-2.0 license.
