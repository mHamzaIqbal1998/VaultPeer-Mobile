# Implementation Plan: VaultPeerMobile

VaultPeerMobile is a modern, minimal, and premium KeePass-compatible password manager mobile app built in React Native (Expo SDK 54, React 19) that reads, writes, and manages standard `.kdbx` database files.

---

## 🎨 Visual Identity & Theme: "Cyber-Sage"

A unique, minimal dark-mode-first aesthetic with a tech-organic cyber feel. Focuses on high-fidelity surfaces, glowing indicators, glassmorphism boundaries, and clean typography.

### Color Tokens

- **`color-background-primary`**: `#0B0F0E` (Near-black emerald slate)
- **`color-surface-card`**: `#141A18` (Dark emerald surface)
- **`color-border-sage`**: `#232E2A` (Muted sage border for cards/inputs)
- **`color-accent-mint`**: `#34D399` (Vibrant mint green for primary CTAs/active indicators)
- **`color-text-primary`**: `#ECFDF5` (High-contrast mint-white for readable headings)
- **`color-text-muted`**: `#94A3B8` (Soft slate gray for body text and labels)
- **`color-status-error`**: `#EF4444` (Soft red for lock state / error alerts)
- **`color-status-success`**: `#10B981` (Standard emerald for strength/integrity)

### Typography Pairing

- **Font Family**: `Inter` (loaded dynamically)
- **Headings**: `Inter-SemiBold` (600) / `Inter-Medium` (500)
- **Body**: `Inter-Regular` (400) / `Inter-Light` (300)
- **Monospace (Passwords)**: `SpaceMono-Regular` (standard monospace font)

---

## 🛠️ Architecture & Decision Log

### 1. Cryptographic Engine

- **Decision**: Hybrid Approach — JavaScript `kdbxweb` library for database tree management paired with JSI (JavaScript Interface) native cryptographic bindings for Argon2 KDF and AES/ChaCha20.
- **Alternatives Considered**: Pure JS (rejected due to 15s+ decryption times for Argon2 on older mobile CPUs), Full Native Swift/Kotlin engine (rejected due to extreme UI bridge complexity and poor cross-platform code sharing).
- **Rationale**: Ensures native-speed database decryption (~300ms) while keeping UI development cross-platform.

### 2. In-place File Sync

- **Decision**: Native Platform Storage Frameworks — Android Storage Access Framework (SAF) URI persistence + iOS File Coordinator URL Bookmarks.
- **Alternatives Considered**: Standard Expo Document Picker (copies to app sandbox cache, changes not synced back to cloud providers), isolated App Sandbox (prevents external syncing entirely).
- **Rationale**: Matches KeePassDX by saving directly to the original user-selected file path, supporting automatic sync via Nextcloud, Google Drive, iCloud, or Syncthing.

### 3. Biometric Unlock

- **Decision**: Hardware-Backed Cryptographic Binding — Generating an asymmetric key inside Android Keystore / iOS Secure Enclave which encrypts/decrypts the master password in the device's Keychain.
- **Alternatives Considered**: Simple local authentication check (verified via biometrics but password remains in RAM in plaintext, insecure).
- **Rationale**: Ensures security is hardware-enforced and user credentials are encrypted until biometrically validated.

---

## 📅 Phased Implementation Plan

### Phase 1: Setup & JSI Cryptographic Bridge

Focuses on scaffolding dependencies and establishing fast native cryptography.

- [x] Add base dependencies to `package.json` (`kdbxweb`, `expo-secure-store`, `expo-local-authentication`, `expo-document-picker`, `expo-font`).
- [x] Configure `expo-build-properties` for native architectures.
- [x] Implement/integrate native JSI bridge for Argon2 key derivation.
- [x] Implement AES-256-CBC and ChaCha20 decryption helpers.
- [x] Write Jest tests simulating database loading with heavy KDF configurations.
- [x] Create an EAS development build configuration.

### Phase 2: In-place File System Integrations

Focuses on accessing files in-place and tracking sync directories.

- [x] Create Android Native Module to request persistent tree URI permissions (`takePersistableUriPermission`) and write to `ContentResolver`.
- [x] Create iOS File System helper to save/resolve Security-Scoped Bookmarks.
- [x] Build file state manager (`FilePickerContext`) handles file creation vs file loading.
- [x] Implement atomic write mechanism (saving to `.tmp` file first, then replacing original).
- [x] Design the File Setup Screen (initial routing to create/open `.kdbx` file).

### Phase 3: Zustand Store & KeePass Database Parser

Integrates the memory management database structure.

- [x] Write Zustand store `useVaultStore` managing active groups, entries, history logs, and file path metadata.
- [x] Integrate `kdbxweb` parser to convert raw binary decryption streams into React-readable state arrays.
- [x] Implement entry CRUD logic (Create, Read, Update, Delete) and Group folder navigation.
- [x] Build local search index (fuzzy search across entry title, username, URL, and notes).
- [x] Design Entry Detail and Entry Edit screens.

### Phase 4: Modern UI & Cyber-Sage Design System

Applies the minimal and aesthetic visuals with touch targets.

- [x] Configure custom `Inter` and `SpaceMono` fonts in the layout loader.
- [x] Implement `CyberCard` components using thin glass borders (`rgba(35, 46, 42, 0.5)`) and dark background surfaces.
- [x] Build the Custom Bottom Tab Navigator.
- [x] Build the Password Generator view with strength bars and character option pills.
- [x] Ensure all interactive touch targets meet the `44x44px` physical target size standard with `Pressable` ripple feedbacks.
- [x] Add smooth micro-animations using `react-native-reanimated` for collapsible groups.

### Phase 5: Security Lockout & Hardening

Secures database states in runtime and integrates biometrics.

- [x] Setup secure keystore integration to bind the master key credentials behind OS biometrics (Face ID/Fingerprint).
- [x] Implement `AppState` listener which triggers a database purge and loads the `/unlock` screen if the app is backgrounded.
- [x] Set up user inactivity timers to auto-lock the app after 60 seconds of no touch interaction.
- [x] Build a clipboard safety hook (auto-clear copied passwords after 30 seconds).
- [x] Run comprehensive manual security audits and verify build pipelines on EAS.
