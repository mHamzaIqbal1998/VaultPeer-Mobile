# Product Overview

VaultPeer Mobile is an open-source, KeePass-compatible password manager for iOS and Android with peer-to-peer vault synchronization over WebRTC.

## Core Capabilities

- Read/write `.kdbx` files (KeePass format, versions 3 and 4)
- Full CRUD on entries and groups with hierarchical folder navigation
- Password and passphrase generator with customizable rules
- Entry templates (Login, Credit Card, SSH Key, Wi-Fi, etc.)
- OTP/TOTP support for two-factor authentication
- Biometric unlock (Face ID, fingerprint) via expo-local-authentication
- Autofill integration for Android and iOS credential providers
- QR-code based pairing for establishing WebRTC sync channels
- Real-time peer-to-peer vault sync using WebRTC data channels
- Last-Write-Wins conflict resolution with backup-before-pull safety net
- Auto-save with configurable debounce

## Security Principles

- Master password and key material only held in memory during unlock
- Secrets stored via expo-secure-store (Keychain / Android Keystore)
- Protected values (passwords, secure custom fields) never logged
- Memory is purged on vault close
- Native Argon2 KDF via react-native-argon2-turbo
- App security wrapper hides content on task switcher
