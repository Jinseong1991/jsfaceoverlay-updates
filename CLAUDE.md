# Project notes for Claude

- **BT Battery Overlay**: Electron tray app showing Bluetooth device battery as a translucent overlay (see README.md).
- `npm test` runs the unit tests (estimator + PowerShell output parser). `npm run dist` builds the portable Windows exe into `dist/` (gitignored).
- Building on Linux/macOS requires `build.win.signAndEditExecutable` to stay `false` (no wine); on Windows it may be set to `true` to embed `assets/icon.ico`.
- The owner's standing request: **after every piece of work, save the result as an Artifact** (a results page with what was built, screenshots, how to use it and where the files are) in addition to the chat summary.
