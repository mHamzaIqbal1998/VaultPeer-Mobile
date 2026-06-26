<p align="center">
  <img src="assets/android-chrome-192x192.png" alt="VaultPeer logo" width="96" height="96" />
</p>

# VaultPeer Mobile

> The Android app for VaultPeer — an open-source, privacy-first KeePass-compatible password manager with live multi-device sync over WebRTC.

---

## Table of Contents

- [Introduction](#introduction)
- [Features](#features)
- [Installation](#installation)
- [Usage Examples](#usage-examples)
- [Testing](#testing)
- [Building](#building)
- [Dependencies](#dependencies)
- [Related Projects](#related-projects)
- [Contributing](#contributing)
- [License](#license)

---

## Introduction

VaultPeer is an open-source, privacy-first password manager that gives you full control over your credentials. It stores vaults in the standard **KDBX** format used by KeePass and KeePassXC, encrypts everything at rest, and keeps your data on your device.

Unlike cloud-first password managers, VaultPeer uses a [**Phonebook signaling server**](https://github.com/mHamzaIqbal1998/VaultPeer-Phonebook) for peer discovery only. Every **node** — [desktop](https://github.com/mHamzaIqbal1998/VaultPeer-Desktop), [mobile](https://github.com/mHamzaIqbal1998/VaultPeer-Mobile) (this repository), or the headless [server node](https://github.com/mHamzaIqbal1998/VaultPeer-ServerNode) — joins a room on Phonebook, discovers the other live nodes, and exchanges the encrypted `.kdbx` vault over WebRTC data channels. Phonebook relays connection metadata only; it never sees your decrypted vault contents. The server node has no UI — it holds the vault file and syncs incoming pushes and pulls with other nodes on your behalf.

VaultPeer Mobile is the Android client in that network. It unlocks and manages your vault locally, then syncs with other live nodes on startup and after local changes.

---

## Features

- **KeePass-compatible storage** — Open, create, and save standard `.kdbx` databases with AES-256 / ChaCha20 encryption and Argon2 KDF.
- **Live multi-device sync** — Connect to [VaultPeer-Phonebook](https://github.com/mHamzaIqbal1998/VaultPeer-Phonebook), join a room, and sync with [desktop](https://github.com/mHamzaIqbal1998/VaultPeer-Desktop), [mobile](https://github.com/mHamzaIqbal1998/VaultPeer-Mobile), and [headless server](https://github.com/mHamzaIqbal1998/VaultPeer-ServerNode) nodes over WebRTC.
- **Offline access** — Your vault works without a network connection; sync runs when peers are available.
- **Password generator** — Generate strong random passwords and passphrases.
- **OTP / TOTP** — Scan QR codes or enter secrets manually for RFC 6238 one-time passwords.
- **Android Autofill** — Fill credentials into other apps via the system autofill service.
- **Biometric unlock** — Quick unlock with fingerprint or face recognition.
- **Local backups** — Automatic and manual vault backups with configurable retention.
- **Import / export** — Open existing KDBX files from KeePassXC or other managers.
- **No telemetry** — No analytics, no cloud vault, and no network activity unless you enable sync.

---

## Installation

### Prerequisites

- **Node.js 20+** — check `.nvmrc` and verify with:

```bash
node --version
```

- **Android Studio** (for local emulator or device builds) — see the [Expo Android setup guide](https://docs.expo.dev/workflow/android-studio-emulator/).

### Steps

```bash
# 1. Clone the repository
git clone https://github.com/mHamzaIqbal1998/VaultPeer-Mobile.git

# 2. Go to the cloned directory
cd VaultPeer-Mobile

# 3. Install dependencies
npm install

# 4. Start the development app
npx expo start
```

Press `a` in the Expo CLI to open on a connected Android device or emulator.

### End-user install (Android)

Download the latest **arm64-v8a APK** from [GitHub Releases](https://github.com/mHamzaIqbal1998/VaultPeer-Mobile/releases).

> VaultPeer Mobile is built for **arm64-v8a** Android devices. Install the APK from Releases and allow installation from unknown sources if prompted.

---

## Usage Examples

### Quick start

1. Launch VaultPeer and **create** or **open** a `.kdbx` database.
2. Unlock with your master password (and optional key file or biometrics).
3. Add entries, groups, and attachments as needed.
4. To sync, open **Settings → Sync**, enter your Phonebook signaling server URL and room ID (from [`VaultPeer-Phonebook`](https://github.com/mHamzaIqbal1998/VaultPeer-Phonebook)), then connect other VaultPeer nodes — desktop, mobile, or headless server — using the same vault filename.

### Sync architecture

```text
┌─────────────────┐     signaling only      ┌──────────────────────┐
│ VaultPeer       │ ◄──────────────────────►│ VaultPeer-Phonebook  │
│ nodes (desktop, │   (room join, ICE, SDP) │ (signaling server)   │
│ mobile, server) │                         └──────────────────────┘
└────────┬────────┘
         │ WebRTC data channels (encrypted .kdbx)
         ▼
   peer-to-peer vault sync
```

Only **Phonebook** handles signaling. Every other component — including the headless **server node** — is a peer node that participates in vault push/pull sync.

---

## Testing

```bash
npm test
```

---

## Building

### Local development build

```bash
npm run android:dev
```

### Production APK (EAS)

```bash
npm run build:android
```

Requires an [Expo](https://expo.dev) account and EAS CLI. Merges to `main` also trigger an automated EAS build and GitHub Release (see [`.github/workflows/eas-build-and-release.yml`](./.github/workflows/eas-build-and-release.yml)).

---

## Dependencies

- [Expo SDK 54](https://docs.expo.dev/)
- [React Native](https://reactnative.dev/)
- [kdbxweb](https://github.com/KeePassXreboot/kdbxweb) (KDBX read/write)
- [react-native-webrtc](https://github.com/react-native-webrtc/react-native-webrtc)
- [Zustand](https://zustand.docs.pmnd.rs/)
- [Expo Router](https://docs.expo.dev/router/introduction/)

---

## Related Projects

| Project                                                                           | Description                                                                     |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| [`VaultPeer-Desktop`](https://github.com/mHamzaIqbal1998/VaultPeer-Desktop)       | Windows desktop node with UI                                                    |
| [`VaultPeer-Mobile`](https://github.com/mHamzaIqbal1998/VaultPeer-Mobile)         | Android mobile node with UI (this repository)                                   |
| [`VaultPeer-ServerNode`](https://github.com/mHamzaIqbal1998/VaultPeer-ServerNode) | Headless sync node — no UI; holds the vault and relays push/pull to other nodes |
| [`VaultPeer-Phonebook`](https://github.com/mHamzaIqbal1998/VaultPeer-Phonebook)   | WebRTC signaling server for room join and peer discovery                        |

All nodes share the same sync protocol and KDBX vault format. Only Phonebook handles signaling; every other component is a peer node.

---

## Contributing

We welcome contributions. See [`CONTRIBUTING.md`](./CONTRIBUTING.md) for the development workflow and coding conventions.

---

## License

This project is licensed under the Apache License, Version 2.0. See the [LICENSE](./LICENSE) file for details.
