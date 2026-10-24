# Rojo Multiplex

Rojo Multiplex runs several Rojo servers at the same time and gives each one a stable local proxy port. You add `.project.json` files to a desktop app, start the ones you need, and connect each Roblox Studio window to a different project. The app handles the processes and ports.

It has two parts:

- **The desktop app** (this folder). An Electron app for Windows that starts one `rojo serve` per project, keeps it running, and proxies its HTTP API and websocket sync stream on `127.0.0.1`.
- **The Studio plugin** (`../plugin`). A copy of the official Rojo plugin that lists the app's projects and connects to one with a click.

## Requirements

- Windows 10 or 11
- Roblox Studio

To build from source you also need:

- [Git](https://git-scm.com/)
- [Node.js](https://nodejs.org/) 20 or newer (includes `npm`)
- [Rust](https://rustup.rs/) 1.88 or newer, with the MSVC toolchain that `rustup` installs by default on Windows

## Setup

To have an AI coding agent set this up for you, point it at [SETUP.md](../SETUP.md). It has agent-friendly steps for building, installing, and adding your projects.

### Option 1: Install a release

1. Download `Rojo Multiplex Setup <version>.exe` from this repository's Releases page and run it.
2. Open **Rojo Multiplex** and choose **Install Studio Plugin**.
3. Restart Roblox Studio.

### Option 2: Build from source

Run these in PowerShell:

```powershell
# Clone with submodules; the plugin's packages are git submodules.
git clone --recursive <this repository's URL> rojo-multiplex
cd rojo-multiplex\multiplex

# If you already cloned without --recursive:
# git submodule update --init --recursive

npm.cmd ci

# Build this repository's Rojo server into bin\rojo.exe (needs Rust).
npm.cmd run prepare:rojo

# Build the Studio plugin with that server into ..\build\RojoMultiplex.rbxm.
bin\rojo.exe build ..\plugin.project.json --output ..\build\RojoMultiplex.rbxm

# Run the tests, then build the installer into dist\.
npm.cmd run check
npm.cmd run build
```

Run `dist\Rojo Multiplex Setup <version>.exe`, then continue from step 2 of Option 1.

Use `npm.cmd`, not `npm`, in PowerShell. PowerShell's default execution policy blocks the `npm.ps1` shim.

To run from source without installing, use `npm.cmd start` instead of `npm.cmd run build`. To install only the plugin, without the app, run `.\Install-Plugin.ps1`. It builds the plugin and copies it to `%LOCALAPPDATA%\Roblox\Plugins`.

## Everyday use

1. Open **Rojo Multiplex**.
2. Choose **Add Project** and select a `.project.json` file.
3. Choose **Start** on each project you want to sync. Projects are grouped by their folder.
4. In Roblox Studio, open the **Rojo Multiplex** plugin and click **Connect** on a project.

Separate Studio windows can connect to separate projects at the same time. You can keep the official Rojo plugin installed, but don't connect both plugins in the same Studio window.

Each project row shows its proxy address, such as `localhost:34900`. A project keeps that port across restarts.

The project list and ports are saved in `%APPDATA%\rojo-multiplex-manager\rojo-multiplex.json`. When running from source, they are saved in `rojo-multiplex.json` in this folder.

## Rojo versions

The app works with any Rojo version. The Multiplex plugin does not. It speaks the protocol of the Rojo release it was built from: see `../plugin/Version.txt`, currently 7.7.1, which uses protocol 5. That plugin works with Rojo 7.7 servers. Older servers, such as 7.6 and earlier, use protocol 4, and the plugin cannot connect to them.

### Using the bundled Rojo (default)

The app ships a `rojo.exe` built from this repository. It matches the bundled plugin, so this setup needs no further steps. It also includes a Windows fix that stock Rojo lacks: edits made through file symlinks, directory symlinks, and junctions sync to Studio without restarting the project.

### Using a different Rojo version

To serve projects with another Rojo, such as the version a project pins in `rokit.toml`, `aftman.toml`, or `foreman.toml`:

1. Set `ROJO_MULTIPLEX_ROJO` to the Rojo command or the full path of a `rojo.exe`. Then quit the app from its tray icon and open it again:

   ```powershell
   # Use whatever `rojo` is on PATH. Rokit, Aftman, and Foreman shims pick the
   # version pinned by each project's folder, because the app runs Rojo there.
   [Environment]::SetEnvironmentVariable("ROJO_MULTIPLEX_ROJO", "rojo", "User")

   # Or use one specific binary:
   [Environment]::SetEnvironmentVariable("ROJO_MULTIPLEX_ROJO", "C:\Tools\rojo-7.6.1\rojo.exe", "User")
   ```

2. Connect from Studio:
   - **Rojo 7.7.x:** use the Rojo Multiplex plugin as usual.
   - **Any other version:** use the official Rojo plugin of that version. Set its address to `localhost` and its port to the project's proxy port shown in the app. Each Studio window can still connect to a different project.

To return to the bundled Rojo, remove the variable with `[Environment]::SetEnvironmentVariable("ROJO_MULTIPLEX_ROJO", $null, "User")` and restart the app.

### Updating the bundled Rojo to a new release

The server and plugin come from upstream Rojo. To move them to a new release, for example `v7.8.0`:

```powershell
git remote add rojo https://github.com/rojo-rbx/rojo.git   # once
git fetch rojo --tags
git merge v7.8.0
```

Resolve any conflicts, then bump the `rojo` entry in `../rokit.toml` and the app version in `package.json`. Rebuild with the steps in [Build from source](#option-2-build-from-source). `prepare:rojo` reads the expected Rojo line from `../plugin/Version.txt`, so it rejects a server whose version doesn't match the plugin.

To bundle a different Rojo checkout instead of this repository's, set `ROJO_MULTIPLEX_ROJO_REPOSITORY` to its folder before running `npm.cmd run prepare:rojo`. That checkout must be the same Rojo line as the plugin.

## Development

```powershell
npm.cmd install
npm.cmd run prepare:rojo
npm.cmd run icons
bin\rojo.exe build ..\plugin.project.json --output ..\build\RojoMultiplex.rbxm
npm.cmd run check
npm.cmd start
```

`prepare:rojo` runs `cargo build --release --locked` in the repository root and copies `target\release\rojo.exe` into `bin\`.

`npm.cmd run server` runs only the manager and proxy, without the desktop window. It reads `rojo-multiplex.json` in this folder; see `rojo-multiplex.example.json` for the format.

Build the Windows installer with `npm.cmd run build`.

## Troubleshooting

### The Multiplex plugin can't connect to a running project

If connecting fails with "different protocol version" or a MessagePack decoding error, the Multiplex plugin and the project's Rojo server use different protocols. You probably set `ROJO_MULTIPLEX_ROJO` to a Rojo version other than 7.7. Connect with that version's official Rojo plugin instead. See [Using a different Rojo version](#using-a-different-rojo-version).

### A project fails to start

Open the project's logs in the app. The log shows the exact `rojo serve` command the app ran. If it says the command could not be found, `ROJO_MULTIPLEX_ROJO` points at something that isn't installed or isn't on `PATH`.

### "Electron" in Task Manager

Task Manager and the Startup apps list name each process after the version info in its exe. The installed `Rojo Multiplex.exe` says "Rojo Multiplex". The dev runtime that `npm.cmd start` uses, `node_modules\electron\dist\electron.exe`, says "Electron". If Task Manager shows "Electron", something launched the dev runtime. Usually that is a dev run left open, or a login item, shortcut, or Startup-folder link that points at `electron.exe`.

To fix it:

1. Find the process: in Task Manager's **Details** tab, add the **Command line** column, or run
   `Get-CimInstance Win32_Process -Filter "Name='electron.exe'" | Select-Object ProcessId, CommandLine`.
   Close the dev window, or end that process tree.
2. Remove whatever starts it at login. Look under `HKCU\Software\Microsoft\Windows\CurrentVersion\Run` (Electron writes values such as `electron.app.Electron`) and in `shell:startup` for `.lnk` files that target `electron.exe`.
3. Start the installed app from the Start menu. To launch it at login, use **Launch at Login** in its tray menu. That option is disabled in dev runs so they cannot register `electron.exe`.

To confirm which build is running, check that `(Get-Process "Rojo Multiplex").Path` is under `%LOCALAPPDATA%\Programs\Rojo Multiplex\`, and that `(Get-Item $path).VersionInfo.FileDescription` is `Rojo Multiplex`. If the exe itself says "Electron", electron-builder could not edit its resources. Rebuild with `npm.cmd run build` and check the build log for `rcedit` or `signAndEditExecutable` errors.

## License

The Studio plugin is based on the official Rojo plugin and, like the rest of this repository, is covered by the MPL-2.0 license in `../LICENSE.txt`.
