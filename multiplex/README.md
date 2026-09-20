# Rojo Multiplex

Rojo Multiplex runs multiple Rojo 7.7 servers at the same time and gives each one a stable local proxy. The desktop app owns the process and port details; normal use is project-based.

## Everyday use

1. Open **Rojo Multiplex**.
2. Choose **Add Project** and select one `.project.json` file.
3. Choose **Start** for every project you want available. Projects are grouped by their containing folder.
4. In Roblox Studio, open the **Rojo Multiplex** plugin and click **Connect** on the desired project.

Different Studio windows can connect to different running projects at the same time. The ordinary Rojo plugin may remain installed, but do not run both sync plugins in the same Studio window.

The app listens only on `127.0.0.1`. It assigns and remembers proxy/backend ports internally, starts a bundled Rojo 7.7.0 binary, and forwards both the MessagePack HTTP API and websocket sync stream.

## Installation

Run `dist/Rojo Multiplex Setup 0.1.0.exe`, then choose **Install Studio Plugin** inside the desktop app. Restart Studio after installing or upgrading the plugin.

The project list is stored under the app's Windows user-data directory, normally `%APPDATA%\Rojo Multiplex\rojo-multiplex.json`.

## Development

```powershell
npm.cmd install
npm.cmd run prepare:rojo
npm.cmd run icons
..\multiplex\bin\rojo.exe build ..\plugin.project.json --output ..\build\RojoMultiplex.rbxm
npm.cmd run check
npm.cmd start
```

Build the Windows installer with `npm.cmd run build`.

The Studio plugin is based on the official Rojo 7.7.0 plugin (protocol 5) and remains covered by the repository's MPL-2.0 license.
