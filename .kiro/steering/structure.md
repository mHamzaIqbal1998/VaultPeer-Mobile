# Project Structure

## Top-Level Layout

```
├── app/                  → Expo Router file-based routes (screens)
├── src/                  → Application source (business logic, UI components)
├── modules/              → Custom Expo native modules
├── assets/               → Fonts, icons, images
├── scripts/              → Utility scripts (reset-project, etc.)
├── app.json              → Expo app configuration
├── eas.json              → EAS Build profiles
├── tsconfig.json         → TypeScript config (strict, @/* alias)
├── jest.config.js        → Jest test configuration
├── eslint.config.js      → ESLint flat config
└── .prettierrc           → Prettier formatting rules
```

## Routing (`app/`)

Expo Router file-based navigation with typed routes:

```
app/
├── _layout.tsx           → Root Stack (splash, fonts, crypto init, security wrapper)
├── index.tsx             → Unlock / file-picker screen
├── autofill.tsx          → Autofill entry point (credential provider)
├── autofill-save.tsx     → Save credentials from autofill flow
├── vault/
│   ├── _layout.tsx       → Tab navigator (Explorer, Generator, Settings)
│   ├── index.tsx         → Vault browser (group tree + entry list)
│   ├── generator.tsx     → Password generator
│   └── settings.tsx      → App settings
└── entry/
    ├── _layout.tsx       → Entry stack layout
    ├── [id].tsx          → Entry detail (dynamic route)
    └── edit.tsx          → Create / edit entry form
```

## Source (`src/`)

```
src/
├── components/           → Reusable UI (modals, banners, cards)
├── constants/            → Theme tokens, KeePass icon map
├── context/              → React contexts (FilePickerContext)
├── hooks/                → Custom hooks (useActiveConnection, useClipboard)
├── services/             → Business logic (no React dependencies)
│   ├── crypto/           → Crypto engine, database parser, Argon2 registration
│   ├── sync/             → SyncEngine singleton, protocol, backup, meta store
│   ├── webrtc/           → WebRTCManager, peer connection logic
│   └── *.ts             → Password generator, search, OTP, biometric, autofill
├── stores/               → Zustand stores (vault, signaling, sync, backup, webrtc)
└── types/                → TypeScript interfaces (kdbx.ts)
```

## Native Modules (`modules/`)

```
modules/
├── vaultpeer-autofill/       → Android/iOS credential autofill provider
└── vaultpeer-file-system/    → Platform file I/O (SAF bookmarks, iOS security-scoped)
```

## Architecture Patterns

- **Singleton services**: `syncEngine` and `webRTCManager` are module-level singletons registered via hook callbacks
- **Store-first**: All app state lives in Zustand stores; components subscribe to slices
- **Bridge pattern**: `SyncHost` interface decouples the sync engine from React layer (dependency inversion)
- **Parsed state model**: Raw `kdbxweb.Kdbx` instance is private (`_db`); UI reads parsed `VaultGroup`/`VaultEntry` with flat index maps for O(1) lookups
- **Co-located tests**: `__tests__/` directories live next to the code they test
- **Theme system**: Dark-first "Cyber-Sage" design system with `useThemeColors()` hook and `createStyles(colors)` factory pattern
