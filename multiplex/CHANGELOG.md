# Rojo Multiplex Changelog

Rojo server changes are listed in the repository's root `CHANGELOG.md`.

## 0.1.9

* **Launch at Login** is now disabled when running from source (`npm start`). Turning it on there registered the dev `electron.exe`, so Task Manager and Startup apps listed Rojo Multiplex as "Electron". The README now explains how to find and remove such entries.
* Projects can now be served by any Rojo version. Set `ROJO_MULTIPLEX_ROJO` to a Rojo command or path and the app uses it instead of the bundled server. Rojo now runs from each project's folder, so a `rojo` shim from Rokit, Aftman, or Foreman picks the version that project pins. Connect to servers other than 7.7 with the official Rojo plugin of that version.
* Each project row now shows its proxy address, such as `localhost:34900`, for connecting with the official Rojo plugin.
* `prepare:rojo` now reads the expected Rojo version from `plugin/Version.txt` instead of a hardcoded 7.7, so it keeps working after the repository moves to a newer Rojo release.
* The README now has full setup instructions, and `SETUP.md` has step-by-step instructions an AI agent can follow to set Rojo Multiplex up for a user.
* **Launch at Login** now shows as checked when it is on. It used to look unchecked because the saved `--hidden` argument did not match the check.

## 0.1.8

* The bundled server now follows Windows symlink chains (a link in the project pointing at another link, such as Game -> Shared -> Framework) when a link in the middle is removed, recreated, or repointed, without restarting the project.
* Deleting or recreating a shared file that is reachable through both a file link and a linked folder now updates both copies in Studio.

## 0.1.7

* The bundled server no longer logs a warning for every queued file-watcher event whose file and folder were already deleted, such as when a package manager replaces a nested dependency folder.

## 0.1.6

* The bundled `rojo.exe` is now built from this repository's server source instead of being copied from the stock Rojo 7.7.1 release. It still reports Rojo 7.7.1 and uses the same protocol as the bundled plugin.
* Fixed edits to the targets of Windows file symlinks, directory symlinks, and junctions not syncing to Studio until the project's server was restarted.
* Fixed the README's location of the saved project list.

## 0.1.5

* Bundled Rojo 7.7.1 and the matching 7.7.1-based Studio plugin.
