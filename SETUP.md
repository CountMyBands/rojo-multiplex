# Setting up Rojo Multiplex (guide for AI agents)

This guide is for an AI coding agent that is setting up Rojo Multiplex on a user's Windows PC. It covers building the app from source, installing the app and the Studio plugin, adding the user's projects, and checking the result. Humans can follow it too. The shorter guide written for people is [multiplex/README.md](multiplex/README.md).

Run every command in **PowerShell**, from the folder named in each step. Use `npm.cmd`, not `npm`: PowerShell's default execution policy blocks the `npm.ps1` shim.

## What you are setting up

- **The desktop app** (`multiplex/`). An Electron app that runs one `rojo serve` per project and gives each project a stable proxy port on `127.0.0.1`. It ships its own `rojo.exe`, built from this repository's Rojo server source. **The user does not need Rojo installed.**
- **The Studio plugin** (`plugin/`). It lists the app's projects and connects a Studio window to one with a click. It speaks the protocol of Rojo 7.7, the version in `plugin/Version.txt`.

## Ask the user first

Before you change anything, ask the user:

1. **Which projects to add.** You need the full path of each `.project.json` file.
2. **Whether to install missing tools.** Step 1 may need Git, Node.js, Rust, and the Visual Studio C++ Build Tools. Get permission before installing any of them.
3. **Which Rojo version their projects need.** The default, bundled Rojo 7.7.1, is right for almost everyone. Only follow [Using a different Rojo version](#using-a-different-rojo-version) if they need an older Rojo, such as one pinned in a `rokit.toml`, `aftman.toml`, or `foreman.toml`.

## Step 1: Check the tools

```powershell
git --version      # any version
node --version     # v20 or newer
cargo --version    # 1.88 or newer
rustup show        # the default host should end in -pc-windows-msvc
```

If a tool is missing and the user agreed to install it:

```powershell
winget install --id Git.Git -e
winget install --id OpenJS.NodeJS.LTS -e
winget install --id Rustlang.Rustup -e
winget install --id Microsoft.VisualStudio.2022.BuildTools -e --override "--quiet --wait --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
```

Rust needs the Visual Studio C++ Build Tools for its linker. If `cargo build` fails later with `link.exe not found`, they are missing.

New installs don't change the `PATH` of your current shell. Reload it before checking again:

```powershell
$env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [Environment]::GetEnvironmentVariable("Path", "User")
```

## Step 2: Get the source

```powershell
git clone --recursive https://github.com/CountMyBands/rojo-multiplex.git
cd rojo-multiplex\multiplex
```

`--recursive` is required: the plugin's packages are git submodules. If the repository was already cloned without it, run `git submodule update --init --recursive` from the repository root.

## Step 3: Build

From `rojo-multiplex\multiplex`:

```powershell
npm.cmd ci
npm.cmd run prepare:rojo
bin\rojo.exe build ..\plugin.project.json --output ..\build\RojoMultiplex.rbxm
npm.cmd run check
npm.cmd run build
```

Each command must succeed before you run the next one:

| Command | What it does | Expect |
| --- | --- | --- |
| `npm.cmd ci` | Installs the exact Electron and build-tool versions in `package-lock.json`, without changing the lockfile. | A few minutes the first time. npm 11 may warn that it skipped the install script of `electron-winstaller`. That is harmless: the app builds an NSIS installer, which doesn't use it. Don't approve it. |
| `npm.cmd run prepare:rojo` | Runs `cargo build --release --locked` in the repository root and copies `rojo.exe` into `multiplex\bin\`. | 5 to 15 minutes the first time. Give it a long timeout. Ends with `Prepared ... (Rojo 7.7.x)`. |
| `bin\rojo.exe build ...` | Builds the Studio plugin into `..\build\RojoMultiplex.rbxm`. | A few seconds. |
| `npm.cmd run check` | Runs the app's tests. | `fail 0`. |
| `npm.cmd run build` | Builds the installer. It packages both `bin\rojo.exe` and the plugin, so it fails if either step above was skipped. | `dist\Rojo Multiplex Setup <version>.exe`. |

## Step 4: Install the app

If Rojo Multiplex is already running, it must be closed first or the installer cannot replace its files. Ask the user to choose **Quit** from its tray icon. If they can't, stop it yourself:

```powershell
Get-Process "Rojo Multiplex" -ErrorAction SilentlyContinue | Stop-Process
# The app's Rojo servers can outlive it and keep their ports. Stop only the ones it started.
Get-CimInstance Win32_Process -Filter "Name='rojo.exe'" |
    Where-Object { $_.ExecutablePath -like "*\Programs\Rojo Multiplex\*" } |
    ForEach-Object { Stop-Process -Id $_.ProcessId }
```

If stopping fails with "Access is denied", the app was started as administrator. Ask the user to quit it from the tray instead.

Then install it silently, from `rojo-multiplex\multiplex`:

```powershell
$installer = Get-ChildItem "dist\Rojo Multiplex Setup *.exe" | Sort-Object LastWriteTime | Select-Object -Last 1
Start-Process -FilePath $installer.FullName -ArgumentList "/S" -Wait
Test-Path "$env:LOCALAPPDATA\Programs\Rojo Multiplex\Rojo Multiplex.exe"   # should be True
```

The silent install is per-user, in `%LOCALAPPDATA%\Programs\Rojo Multiplex`. It doesn't need administrator rights. Existing projects and settings are kept across reinstalls.

## Step 5: Start the app

```powershell
# Electron apps exit at once if this is set. Some agent shells inherit it.
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
Start-Process "$env:LOCALAPPDATA\Programs\Rojo Multiplex\Rojo Multiplex.exe"
Start-Sleep -Seconds 5
Invoke-RestMethod http://127.0.0.1:34871/api/status
```

`ok : True` means the app is running. It is a single-instance app, so starting it again only brings up its window.

`34871` is the default manager port. If the user changed it, read `managerPort` from `%APPDATA%\rojo-multiplex-manager\rojo-multiplex.json`.

## Step 6: Install the Studio plugin

From `rojo-multiplex\multiplex`:

```powershell
.\Install-Plugin.ps1 -SkipBuild
```

This copies `..\build\RojoMultiplex.rbxm` to `%LOCALAPPDATA%\Roblox\Plugins\RojoMultiplex.rbxm`. The user can also click **Install Studio Plugin** in the app, which does the same thing.

Tell the user to **restart Roblox Studio**. Studio only loads plugins when it starts.

## Step 7: Add and start the user's projects

The app has a local HTTP API on the manager port. Use it to add each project, then start it:

```powershell
$manager = "http://127.0.0.1:34871"
$projectPath = "C:\path\to\game\default.project.json"   # one of the user's projects

$added = Invoke-RestMethod -Method Post "$manager/api/projects" -ContentType "application/json" `
    -Body (@{ projectPath = $projectPath } | ConvertTo-Json)
Invoke-RestMethod -Method Post "$manager/api/projects/$($added.project.id)/start" | Out-Null

Start-Sleep -Seconds 5
(Invoke-RestMethod "$manager/api/projects").projects | Format-Table name, state, port, projectPath
```

- Adding a project that is already in the list is fine. The response has `existing: true` and the same project.
- Each project should reach `state` `running`. A started project restarts with the app, until it is stopped.
- `port` is the project's proxy port. It stays the same across restarts.

If a project ends up in `error`, read its log:

```powershell
(Invoke-RestMethod "$manager/api/projects/$($added.project.id)/logs").lines | Select-Object -Last 20
```

The log shows the exact `rojo serve` command the app ran, followed by Rojo's own output. Most errors are problems in the project file itself, which the user needs to fix.

Other endpoints: `POST .../stop`, `POST .../restart`, `DELETE /api/projects/<id>` (removes the project from the list), and `DELETE .../logs`.

## Step 8: Hand over to the user

Tell the user to:

1. Restart Roblox Studio, if it was open.
2. Open their place, then click **Rojo Multiplex** in the Plugins toolbar.
3. Click **Connect** on the project they want.

Separate Studio windows can connect to separate projects at the same time. They can keep the official Rojo plugin installed, but shouldn't connect both plugins in the same window.

You can't confirm the Studio side from the command line. A project showing `running` in Step 7 is as far as you can check.

## Using a different Rojo version

Only do this if the user needs a Rojo older than 7.7. The app can run any Rojo version, but **the Multiplex plugin only connects to Rojo 7.7 servers**. For any other version, the user connects with that version's official Rojo plugin instead.

1. Choose what to point the app at:
   - **`rojo`**: the Rojo on `PATH`. The app runs Rojo from each project's folder, so a Rokit, Aftman, or Foreman shim picks the version that project pins.
   - **The full path to a specific `rojo.exe`**: every project uses that one binary.
2. Set it for the user, then restart the app:

   ```powershell
   [Environment]::SetEnvironmentVariable("ROJO_MULTIPLEX_ROJO", "rojo", "User")
   $env:ROJO_MULTIPLEX_ROJO = "rojo"   # the app inherits your shell's environment if you start it
   Get-Process "Rojo Multiplex" -ErrorAction SilentlyContinue | Stop-Process
   Start-Process "$env:LOCALAPPDATA\Programs\Rojo Multiplex\Rojo Multiplex.exe"
   ```

   The `Stop-Process` here can leave Rojo servers behind, just like in Step 4. Stop them the same way before you start the app again.

3. Restart each project from Step 7. Its log should show the new command. To check the version a project serves, run `Invoke-RestMethod http://localhost:<port>/api/rojo` against its proxy port. Rojo 7.6 and older answer with JSON that includes `serverVersion`. Rojo 7.7 answers in MessagePack, which PowerShell can't parse, so the log is easier to check.
4. Tell the user to connect with the official Rojo plugin of that version. They set its address to `localhost` and its port to the project's `port`.

To go back to the bundled Rojo, remove the variable with `[Environment]::SetEnvironmentVariable("ROJO_MULTIPLEX_ROJO", $null, "User")`, clear it in your shell with `Remove-Item Env:ROJO_MULTIPLEX_ROJO`, and restart the app.

## Updating an existing setup

```powershell
cd rojo-multiplex
git pull
git submodule update --init --recursive
cd multiplex
```

Then repeat Steps 3, 4, 5, and 6. Projects and ports are kept. Tell the user to restart Studio so it loads the new plugin.

## Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| `npm` is "not digitally signed" or blocked | Use `npm.cmd`. |
| `prepare:rojo` says `Rojo repository does not contain Cargo.toml` | `ROJO_MULTIPLEX_ROJO_REPOSITORY` is set to the wrong folder. Remove it, or point it at a Rojo checkout. |
| `prepare:rojo` says `Expected a Rojo 7.7 binary` | The Rojo being built doesn't match the plugin's version. Usually `ROJO_MULTIPLEX_ROJO_REPOSITORY` points at another Rojo checkout. |
| `link.exe not found` during `cargo build` | Install the Visual Studio C++ Build Tools (Step 1). |
| `npm.cmd run build` can't find `RojoMultiplex.rbxm` or `rojo.exe` | A build step in Step 3 was skipped. |
| `npm.cmd run build` fails with `Cannot create symbolic link` | electron-builder's signing tools contain symlinks. Turn on **Developer Mode** in Windows Settings, or run the build once as administrator. |
| The app exits as soon as it starts | `ELECTRON_RUN_AS_NODE` is set in the shell that launched it. See Step 5. |
| `Invoke-RestMethod` to the manager port is refused | The app isn't running, or uses another `managerPort`. See Step 5. |
| A project stays in `error` with "address already in use" | Leftover Rojo servers hold its ports. Stop them as in Step 4, then restart the project. |
| The Studio plugin shows "different protocol version" or a MessagePack error | The project is served by a Rojo other than 7.7. Use the official plugin for that version, or go back to the bundled Rojo. |
| The plugin doesn't appear in Studio | Studio wasn't restarted, or `%LOCALAPPDATA%\Roblox\Plugins\RojoMultiplex.rbxm` is missing. Repeat Step 6. |
