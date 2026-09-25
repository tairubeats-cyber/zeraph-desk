# Installing Zeraph Desk

Zeraph Desk runs on Windows 10 and 11, and on Macs (Apple Silicon and Intel) with macOS 12 (Monterey) or newer.

## Windows

1. Run the file named `Zeraph Desk_…_x64-setup.exe`.
2. Windows may say **"Windows protected your PC"**. That's because the app isn't signed with a paid
   publisher certificate yet. Click **More info**, then **Run anyway**.
3. It installs for your user account only, so it doesn't ask for an administrator password.

## Mac

1. Open the file named `Zeraph Desk_…_universal.dmg` and drag **Zeraph Desk** into **Applications**.
2. The first time, don't double-click it. **Right-click Zeraph Desk, choose Open, then Open** in the dialog.
   Macs show a warning for apps that aren't notarized by Apple yet.
3. If macOS still refuses, open **System Settings, Privacy & Security**, scroll down, and click **Open Anyway**.
4. You only do this once. After that it opens normally.

## Your data

Everything is stored on your computer. Your email app password is kept in the Windows Credential
Manager or the macOS Keychain, not in a file. On Windows the uninstaller asks whether to delete your data too, and leaves it by default. On a Mac,
removing the app leaves your data; to erase it, delete the `dev.zeraph.desk` folder in `~/Library/Application Support`.

---

# For whoever publishes a release

The installers are built in the cloud, so you don't need a Mac.

1. Bump the version in `package.json`, `src-tauri/tauri.conf.json` and `src-tauri/Cargo.toml`.
2. Commit, then tag and push: `git tag v0.1.0 && git push origin v0.1.0`.
3. Open the repository's **Actions** tab. The "Build installers" run takes about 15 to 30 minutes.
4. When it finishes there's a **draft release** under **Releases** with the Windows `.exe` and the Mac `.dmg`
   attached. Review it, then publish.

To try a build without making a release, open **Actions, Build installers, Run workflow**. The files appear under
that run's **Artifacts**.

While the repository is private, only people with access to it can download releases. To give customers a download
link you'll need either a public release page or a download page on your own site.

## Removing the security prompts later

The prompts above go away once the installers are signed:

- **Windows:** a code-signing certificate from a certificate authority, or Azure Trusted Signing.
- **macOS:** an Apple Developer Program membership, a *Developer ID Application* certificate, and notarization.

Both plug into this same workflow with a few repository secrets (see Tauri's "Code signing" guides). Until then,
unsigned builds work; users just see the prompts once.
