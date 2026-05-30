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

### 4. Native SubtleCrypto Polyfill

- **Decision**: Global SubtleCrypto polyfill using `react-native-quick-crypto`.
- **Alternatives Considered**: Targeted AES-KDF patching inside `kdbxweb` internals (brittle/unmaintainable), pure JS worker threads (still slow).
- **Rationale**: Elevates key derivation (AES-KDF), database decryption (AES-CBC), and hashing (HMAC) speeds to native C++ bounds (~100–200ms) without altering any database parsing or UI code.

### 5. Custom Creation Algorithms

- **Decision**: Expand database creation parameters to support Custom Ciphers (AES-256 / ChaCha20) and KDFs (Argon2id / Argon2d / AES-KDF) hidden behind an accordion using segmented pill tabs.
- **Alternatives Considered**: Native select components (clunky, styling limitations), raw string inputs (unsafe for non-technical users).
- **Rationale**: Keeps the default creation screen clean, prevents accidental insecure inputs, and matches standard KeePassDX customization flows.

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

### Phase 6: High-Performance JSI WebCrypto Polyfill

Optimizes symmetric ciphers and hashing to resolve slow file loading (e.g., strong AES-KDF databases).

- [x] Install `react-native-quick-crypto` JSI library.
- [x] Implement mapping handlers in `webCryptoPolyfill.ts` to forward `global.crypto.subtle` calls directly to `react-native-quick-crypto` native methods.
- [x] Implement native-speed `digest`, `importKey`, `sign`, `encrypt`, and `decrypt` operations for SHA-256/512, HMAC, and AES-CBC.
- [x] Implement DOMException wrap handlers to align native JSI errors with standard WebCrypto signatures.
- [x] Write Jest tests validating native encryption/decryption against standard ciphers.
- [x] Measure file decryption benchmarks on development builds to verify sub-second file opening times.

### Phase 7: Custom Database Algorithms & Meta Display

Enables user selection of encryption ciphers and key derivation functions (KDF) on creation, and fixes metadata labeling in settings.

- [x] Fix the KDF name display bug by converting the KDF UUID byte array to a hex string inside `databaseParser.ts` (instead of casting to `String(uuid)`).
- [x] Extend the `VaultMeta` interface to include `cipherName: string`.
- [x] Implement cipher identification logic in `databaseParser.ts` by checking `db.header.dataCipherUuid`.
- [x] Update `app/vault/settings.tsx` to render two distinct rows: "Encryption Cipher" and "Key Derivation (KDF)".
- [x] Update `createNewDatabase` in `cryptoEngine.ts` to accept optional `kdf` and `cipher` overrides and configure database headers appropriately.
- [x] Add the "Advanced Settings" collapsible accordion inside the database creation section of `app/index.tsx`.
- [x] Build segmented pill selection views for Cipher (AES-256, ChaCha20) and KDF (Argon2id, Argon2d, AES-KDF).
- [x] Pass chosen selections from the UI down to the `createNewVault` context action.
- [x] Write unit tests verifying that all KDF/Cipher configuration combinations serialize and load successfully.

### Phase 8: Custom Fields, Attachments, Expiry, & Tags Support

Enhances the database entries to support the full range of entry attributes provided by KeePass/KeePassDX, including custom key-value pairs (plaintext & secure), binary attachments (adding, removing, exporting), entry tags editor, and expiration dates.

- [x] Extend the `VaultEntry` and related types in `src/types/kdbx.ts` to support custom fields metadata (`secureFields`), binary attachments (`VaultAttachment`), and expiration settings (`expires`, `expiryTime`).
- [x] Update `parseDatabase` in `src/services/crypto/databaseParser.ts` to parse standard entry binaries (converting ArrayBuffer/ProtectedValue values into base64 strings), track custom field security settings (flagging `ProtectedValue` types as secure), and parse entry expiration/tags.
- [x] Refactor store actions `createEntry` and `updateEntry` in `src/stores/useVaultStore.ts` to be asynchronous (`Promise<VaultEntry | null>`) and support setting custom fields (plaintext vs `ProtectedValue`), registering new binary attachments in the database pool (`db.binaries.add`), and managing entry expiration/tags.
- [x] Update the Entry Detail screen `app/entry/[id].tsx` to render secure custom fields with togglable visibility, list entry attachments, and show expiration indicators.
- [x] Implement attachment export / download using the native `createFile` mechanism from `VaultPeerFileSystem` (writing to a temp cache file first, then calling `createFile` to let the user save it to their system).
- [x] Refactor the Entry Edit screen `app/entry/edit.tsx` to include interactive controls for:
  - Dynamic tags editor (adding/deleting tags).
  - Custom fields builder (adding plaintext or secure fields, editing names/values, and removing fields).
  - Attachment picker (using `expo-document-picker` to select files, reading them as base64 via `readFile`, and saving them to the entry).
  - Expiration scheduler (date picker for `expiryTime` with a toggle switch for `expires`).
- [x] Write robust unit and integration tests to verify parser extraction, store synchronization of attachments/custom fields, and binary database cleanup.

### Phase 9: OTP & QR Camera Scanner Support

Integrates full TOTP (Time-based One-Time Password) support, matching KeePassDX and Google Authenticator. Allows entries to store, generate, and refresh rolling OTP codes, and adds camera scanning support to scan QR codes for quick OTP setup.

- [x] Install `expo-camera` via expo CLI to enable native QR code scanning.
- [x] Implement `src/services/otpService.ts` containing:
  - Base32 decoding helper to convert standard secret strings into byte arrays.
  - TOTP generator complying with RFC 6238 using `crypto-js` for HMAC-SHA1.
  - Parser for `otpauth://` URIs to extract secrets, issuers, digits, and periods.
- [x] Extend `VaultEntry` in `src/types/kdbx.ts` to include `otp?: string` (to store the `otpauth://` URI).
- [x] Update `databaseParser.ts` to identify the `otp` custom field (or standard KeePass `TimeOtp` / `totp` fields) and populate the `otp` property of the parsed entry.
- [x] Refactor `useVaultStore.ts` to support writing/saving the `otp` field to the database as a standard KeePass OTP-configured string field.
- [x] Update `app/entry/[id].tsx` to render a dedicated, premium OTP display card when an OTP field is present:
  - Shows the parsed issuer/account label.
  - Renders the active 6-digit rolling code (e.g., `456 789`) with clean spacing.
  - Displays a dynamic circular progress ring or indicator countdown showing the seconds left before rotation.
  - Copy-to-clipboard button for the OTP code.
- [x] Build a QR scanner component using `expo-camera` to scan `otpauth://` QR codes.
- [x] Integrate the QR scanner and OTP form fields into `app/entry/edit.tsx` (allowing manual typing of secret/URI or camera scanning to auto-populate).
- [x] Add comprehensive unit tests in `src/services/__tests__/otpService.test.ts` to validate TOTP calculations against RFC 6238 test vectors.

### Phase 10: KDF Tuning, Benchmark Tool, & Settings Redesign

Redesigns the settings dashboard into distinct "Database" (stored in KDBX) and "App" (stored locally) settings panels matching KeePassDX's architecture. Enhances database security with customizable KDF parameters (rounds, memory, iterations, parallelism) and a native benchmarking utility ("Calculate for 1.0s") to automatically calibrate parameters to the device's hardware.

- [x] Implement a KDF benchmarking service `src/services/crypto/kdfBenchmark.ts` that runs test derivations for AES-KDF and Argon2, calculates elapsed time, and estimates the parameters required to achieve a ~1.0-second delay.
- [x] Refactor database creation options (`createNewDatabase` in `cryptoEngine.ts`) and store actions to allow overriding raw KDF parameters (AES-KDF rounds, Argon2 memory, iterations, and parallelism).
- [x] Implement settings routing in `app/vault/settings.tsx` to display a nested/segmented menu using a premium UI design:
  - **App Settings**: Theme settings, Biometric unlock, lockout persistence, and general clipboard preferences.
  - **Database Settings**: Database Name, Description, master password changer, and Security/KDF configuration.
- [x] Build a **Database Security & KDF Tuning** screen/modal under Database Settings:
  - Displays currently active cipher & KDF settings.
  - Exposes manual sliders/inputs for iteration rounds, memory size, and thread counts.
  - Adds a prominent "Benchmark for 1.0s" button that runs the benchmark in a loading overlay and applies the calibrated parameters.
- [x] Update the database serialization and update pipeline in the store to write these custom KDF parameters to the KDBX file header map via `db.header.kdfParameters.set()`.
- [x] Add unit tests in `src/services/crypto/__tests__/kdfBenchmark.test.ts` to verify the benchmarking math and parameter tuning across all algorithms.

### Phase 11: Compression & Database Maintenance Settings

Integrates data compression configuration and on-demand database maintenance features matching KeePassDX, allowing users to configure XML compression algorithms and clean up unlinked binaries or history data.

- [x] Add the database compression option (`db.header.compression`) to Database Settings, allowing users to select between "GZip (Default)" and "None".
- [x] Implement UI toggles/pickers in the Settings screen to update the database compression field.
- [x] Create a "Database Maintenance" section under Database Settings in `app/vault/settings.tsx`.
- [x] Implement a "Clean Up Database" action that:
  - Invokes `db.cleanup({ binaries: true, history: true })` on the active database instance.
  - Removes unreferenced attachments/binaries and redundant history entries.
  - Updates the dirty state of the vault in the store so the user can save the pruned database.
- [x] Add a confirmation prompt showing a summary before performing the cleanup, and a success alert displaying the result.
- [x] Write unit tests to verify that changing the compression setting correctly updates the saved file payload format and that manual cleanup successfully purges unlinked binaries.

### Phase 12: Templates Support

Introduces KeePassDX-style entry templates. Allows users to enable templates in database settings, which initializes a standard "Templates" group containing pre-configured formats (Credit Cards, Emails, Secure Notes). During new entry creation, users can choose from default or custom templates to auto-populate fields.

- [x] Add a database configuration toggle "Enable Entry Templates" in Database Settings.
- [x] Expose a "Template Group" selector menu in Database Settings allowing users to choose which group acts as the active template repository (populating the selector dynamically with all database groups).
- [x] Implement group and entry seeding logic in the store:
  - When templates are enabled, check if `db.meta.entryTemplatesGroup` is set and valid.
  - If not set, check if a root-level group named "Templates" exists.
  - If missing, create the "Templates" group and set its UUID to `db.meta.entryTemplatesGroup`.
  - Populate it with default templates: "Credit Card" (with Card Number, Expiry, CVV, Cardholder Name fields), "Email Account" (with Recovery Email, IMAP/SMTP server fields), and "Secure Note" (with a secure multi-line text area).
- [x] Design a premium template selector modal or screen using a grid layout with vibrant cards for each template:
  - Display cards with custom icons and descriptive helper text.
  - Include a "Blank Entry" default card.
  - Fetch and list any user-created templates from the selected template group dynamically.
- [x] Integrate the template selection screen into the creation flow:
  - When tapping the "+" add button inside any group view, if templates are enabled, display the template selector.
  - Upon selecting a template, navigate to `app/entry/edit.tsx` with the template parameters.
- [x] Update `app/entry/edit.tsx` to read the template entry's fields (Title, Username, Password, URL, Notes, Custom Fields, and Tags) and pre-fill the form fields on mount.
- [x] Add unit tests in `src/stores/__tests__/templates.test.ts` to verify group creation, default template seeding, metadata sync via `entryTemplatesGroup`, field duplication to new entries, and custom user templates loading.

### Phase 13: Recycle Bin Support

Integrates KeePassDX-style Recycle Bin configuration. Allows users to enable/disable Recycle Bin usage in Database Settings and choose which group acts as the active Recycle Bin. On enabling, if the default "Recycle Bin" group is missing, the application will initialize it automatically.

- [x] Add a database configuration toggle "Enable Recycle Bin" in Database Settings.
- [x] Expose a "Recycle Bin Group" selector menu in Database Settings allowing users to choose which group acts as the active recycle bin (populated with all database groups dynamically).
- [x] Update the store configuration logic:
  - Synchronize choices with `db.meta.recycleBinEnabled` and `db.meta.recycleBinUuid` (converting the UUID back and forth).
  - When the recycle bin is enabled, verify that a group matches the designated UUID or a group named "Recycle Bin" exists at the root.
  - If missing, create the "Recycle Bin" group automatically, assign its UUID to `db.meta.recycleBinUuid`, and set the group icon to the standard trash bin icon (Icon 27).
- [x] Refactor the group and entry deletion logic in `useVaultStore.ts` to verify that deletions respect the configured settings (moving items to the designated Recycle Bin if enabled, or deleting permanently if disabled/already in the bin).
- [x] Expose an on-demand "Empty Recycle Bin" button under Database Settings that purges all entries and subgroups within the designated bin permanently.
- [x] Write unit tests verifying Recycle Bin state changes, automatic group creation, moving entries to the bin, permanent deletion, and empty bin actions.

### Phase 14: Master Password Strength & Change Operations

Implements visual password strength metrics during database/file creation and provides on-demand Master Password modification from Settings with automatic SecureStore biometric credential synchronization.

- [x] Add the password strength indicator bar and rating (using the existing `estimatePasswordStrength` service) to the database/file creation screen in `app/index.tsx`.
- [x] Design a secure "Change Master Password" modal/workflow under the Security section of Database Settings in `app/vault/settings.tsx`:
  - Request the current master password and verify it against `db.credentials.passwordHash`.
  - Request the new master password (complete with strength indicator and confirm password validation).
- [x] Implement master password update mechanics in the store:
  - Generate a new Kdbx credentials instance from the new password.
  - Set the new credentials on the active database (`db.credentials`).
  - Update the dirty state of the vault to trigger file saving on close or on manual save.
  - If biometric unlock is active, call `enableBiometric(newPassword)` to automatically update the master password stored in `SecureStore`.
- [x] Write unit tests to verify password validation, credentials updates on the Kdbx instance, and SecureStore synchronization.

### Phase 15: Entry History Settings & Restore Operations

Integrates database history settings matching KeePassDX, allowing users to limit entry history items and sizes, view historical snapshots of individual entries, and restore/delete snapshots on-demand.

- [x] Update the `VaultMeta` type definition in `src/types/kdbx.ts` and the `parseMeta` service in `src/services/crypto/databaseParser.ts` to extract `historyMaxItems` and `historyMaxSize`.
- [x] Add history configuration inputs in Database Settings (`app/vault/settings.tsx`):
  - "Max History Items" number input mapping to `db.meta.historyMaxItems`.
  - "Max History Size" number input mapping to `db.meta.historyMaxSize` (displaying in MB/KB and converting to bytes).
- [x] Add a "History" tab or section to the Entry details screen:
  - Fetch and render the history array (`entry.history`) from the selected entry.
  - Sort snapshots chronologically and show modification timestamps.
- [x] Implement historical preview and restoration features:
  - Add a collapsible preview for each history item displaying its saved fields, custom fields, and password.
  - Implement a "Restore" button that copies the snapshot's state back into the active entry's fields, updating the entry and marking the database as dirty.
  - Implement a "Delete" button that splices out a specific snapshot using `entry.removeHistory(index)`.
- [x] Write unit tests to verify database configuration parsing, snapshot creation, history item deletion, and restore capabilities.

### Phase 16: Multi-File Database Support & File-Specific Biometrics

Enables opening and maintaining a list of multiple database files on the initial setup screen, and allows configuring and executing biometric unlock independently for each listed vault.

- [x] Update `biometricService.ts` to support file-specific keys:
  - Add an optional `fileUri` parameter to all biometric check, enable, disable, and retrieve functions.
  - Derivate secure keys using a sanitized suffix from the URI: `vault_biometric_enabled_${sanitizedUri}` and `vault_master_password_${sanitizedUri}`.
- [x] Extend `FilePickerContext.tsx` to manage a list of recently opened vaults:
  - Add `RecentVault` type and a `recentVaults` array to the context state, storing bookmarks, names, URIs, and last-opened timestamps.
  - Automatically add/update entries in the list when picking, creating, or opening a vault file.
  - Add `selectRecentVault(uri: string)` and `removeRecentVault(uri: string)` methods.
- [x] Redesign the file setup entry screen in `app/index.tsx` using modern cyber aesthetics:
  - Display a scrollable list of recently opened files if any exist, showing their filenames, last-opened relative dates, and indicator icon for saved fingerprint.
  - Tapping a card prompts for the master password (and triggers biometric unlock automatically if enabled for that file).
  - Provide a "Delete" or "Forget" button on each card to remove the file reference and purge its biometric data from SecureStore.
  - Include clean actions for "Open Another Database" and "Create New Database" to support adding more vault files.
- [x] Write unit tests to verify list persistence, file-specific biometric key routing, and multi-vault unlocking flows.

### Phase 17: Light Theme Support & App Security Customizations

Implements dual-theme (light/dark) mode capabilities matching the cyber-sage aesthetic, and makes the auto-lock and clipboard clear timeouts fully editable from App Settings.

- [x] Define the Light Theme color palette in `src/constants/theme.ts` that complements the existing dark cyber aesthetic with high contrast and light green/mint elements.
- [x] Add `theme`, `autoLockTimeout`, and `clipboardClearTime` states and actions to `useVaultStore.ts` with local persistence.
- [x] Refactor styles across screens and components (such as `app/index.tsx`, `app/vault/settings.tsx`, `app/vault/index.tsx`, etc.) to dynamically compute using the active theme colors.
- [x] Update settings controls in the App Settings tab (`app/vault/settings.tsx`):
  - Add theme selection segment or switch control (Light vs. Dark).
  - Convert the "Auto-lock Timeout" and "Clipboard Clear Time" settings from readonly labels into editable inputs or selection picker menus.
- [x] Update `AppSecurityWrapper.tsx` and `useClipboard.ts` to dynamically retrieve and enforce user-configured values from the store.
- [x] Write unit tests to verify theme preference updates, editable settings synchronization, and dynamic timeout checks.

### Phase 18: Android Autofill Service Integration

Integrates VaultPeer as a native Android Autofill Service, allowing the user to select credentials from their vault and fill forms in external web browsers and native apps.

- [x] Scaffold a local Expo module `modules/vaultpeer-autofill` to bridge native Android Autofill APIs:
  - Implement `VaultPeerAutofillService.kt` extending Android's `AutofillService` to intercept system fill requests.
  - Parse the requesting app package name and website domain from the Android screen node structure.
  - Setup an authentication callback `Intent` that launches VaultPeer in a targeted mode.
  - Implement `VaultPeerAutofillModule.kt` exposing methods to fetch the active request details and submit the selected username/password dataset.
- [x] Create the Autofill React Native screen (`app/autofill.tsx`):
  - Setup routing and URL scheme deep links (e.g. `vaultpeer://autofill`) to handle system invocation.
  - Prompt the user to unlock the database (via Master Password or Biometrics) if it is locked.
  - Automatically filter and display matching entries matching the caller's package name or domain.
  - Provide a fallback text search/browse option to select any entry if no automatic match is found.
  - Call the native module helper to fill fields and exit the screen on selection.
- [x] Add Autofill configuration options to App Settings (`app/vault/settings.tsx`):
  - Add a toggle row to check status and redirect the user to Android's Autofill system Settings screen to enable VaultPeer.
- [x] Write integration and unit tests to verify deep link arguments parsing, entry domain matching, and native bridge APIs.

### Phase 19: Autofill Save Credentials & Dataset Capture

Enables native Android system save prompts when entering credentials manually, automatically capturing username, password, package names, or web domains, and pre-filling the entry creation flow upon validation.

- [x] Update `VaultPeerAutofillService.kt` to trigger the save workflow:
  - Configure `SaveInfo` during `onFillRequest` indicating interest in capturing username and password fields when user transitions or submits.
  - Implement `onSaveRequest` callback to extract entered username, password, and package name/domain from the system's `AssistStructure`.
  - Pass the captured credentials and app/web context back to the main app via a targeted save Intent or deep link (`vaultpeer://autofill-save`).
- [x] Implement pre-fill entry creation flow inside React Native (`app/entry/create.tsx` or similar):
  - Configure routing to handle incoming autofill-save query parameters (`username`, `password`, `packageName`, `domain`).
  - If the database is currently locked, redirect to the database unlock screen first, retaining the pre-fill payload.
  - Pre-populate standard entry fields: Username, Password, Title (derived from package/domain), and URL.
  - Automatically add a custom field `"ANDROIDAPP"` containing the calling package name (e.g. `com.instagram.android`).
  - Redirect user to this pre-populated creation screen so they can choose a folder/group and confirm saving.
- [x] Write tests to verify save request node parsing, payload URL parameter generation, and pre-fill state mapping.

### Phase 20: WebRTC Signaling Server Connection Handling

Integrates signaling server connection states, persistent room creation/joining flows, background connection heartbeats, and database header connection indicators.

- [x] Create a global signaling store `src/stores/useSignalingStore.ts`:
  - Manage state properties: `serverUrl`, `roomId`, `connectionStatus` (`"offline" | "disconnected" | "connecting" | "connected"`), and `isConfigured` (whether network mode is selected).
  - Implement dynamic WebSocket lifecycle handling: connection setup, event handlers (`onopen`, `onmessage`, `onclose`, `onerror`), and automatic retry backoff.
  - Implement heartbeat logic: reply to `{ type: 'ping' }` with `{ type: 'pong' }` packets to keep connection alive.
  - Implement room management actions: `joinRoom(roomId)` sends `{ type: 'join', roomId }` payload, and `createRoom()` generates a new UUID and joins.
  - Persist connection configurations (`serverUrl`, `roomId`, `isConfigured`) to local storage on modification.
- [x] Add an onboarding protocol selector screen in `app/index.tsx` (shown on first run or if not configured):
  - Provide cards to choose between "Offline Mode" (default/local-only) and "Network Sync Mode" (P2P).
  - If "Network Sync Mode" is chosen:
    - Input fields for WebSocket server URL and port with "Connect" button.
    - Post-connection flow: "Create Vault Channel" (generates room ID and joins) vs "Join Vault Channel".
    - "Join Vault Channel" must support launching `expo-camera` via `CameraView` to scan room ID QR code, or manual text ID inputs.
- [x] Update settings controls in `app/vault/settings.tsx`:
  - Add a network/sync settings card: enable/disable sync, change server URL, test connection button, view/copy active room ID, show QR code modal.
  - Provide options to create or join a new sync channel if the client is active.
- [x] Add connection state indicators to the database file header in `app/vault/index.tsx`:
  - Beside the filename, show a glowing green WiFi/Check icon (if connected), a red alert icon (if disconnected/reconnecting), or hide it entirely (if offline).
- [x] Write unit tests (`src/stores/__tests__/useSignalingStore.test.ts`) to verify connection state machines, ping/pong reply loops, and message parsing.
