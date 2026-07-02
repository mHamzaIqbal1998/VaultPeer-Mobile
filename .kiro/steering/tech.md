# Tech Stack

## Framework & Runtime

- **React Native** 0.81.5 (New Architecture enabled)
- **Expo SDK 54** with Expo Router v6 (file-based routing, typed routes)
- **React 19.1** with React Compiler experiment enabled
- **TypeScript 5.9** (strict mode)

## State Management

- **Zustand 5** — multiple stores: `useVaultStore`, `useSignalingStore`, `useSyncStore`, `useBackupStore`, `useWebRTCStore`

## Key Libraries

| Purpose         | Library                        |
| --------------- | ------------------------------ |
| KeePass format  | `kdbxweb`                      |
| Native crypto   | `react-native-quick-crypto`    |
| Argon2 KDF      | `react-native-argon2-turbo`    |
| WebRTC P2P sync | `react-native-webrtc`          |
| Animations      | `react-native-reanimated` v4   |
| Gestures        | `react-native-gesture-handler` |
| Secure storage  | `expo-secure-store`            |
| Biometrics      | `expo-local-authentication`    |
| QR scanning     | `expo-camera`                  |
| File picking    | `expo-document-picker`         |

## Custom Native Modules (local)

- `vaultpeer-autofill` — Android/iOS credential autofill provider
- `vaultpeer-file-system` — Platform file I/O with SAF/bookmarks

## Build & CI

- **EAS Build** for cloud builds (preview, production profiles)
- **Metro** bundler
- Local builds via `expo run:android` / `expo run:ios`

## Code Quality

- **ESLint** — expo flat config (`eslint-config-expo`)
- **Prettier** — 80 char width, 2-space indent, semicolons, ES5 trailing commas
- **Husky + lint-staged** — pre-commit hooks run ESLint fix + Prettier on staged files
- **TypeScript** strict mode with path alias `@/*` → project root

## Testing

- **Jest 29** with `jest-expo` preset and `ts-jest`
- Path alias via `moduleNameMapper`: `@/` → `<rootDir>/`
- Coverage collected from `src/**/*.{ts,tsx}`
- Test files co-located in `__tests__/` directories

## Common Commands

```bash
# Development
npm start              # Start Expo dev server
npm run android        # Run on Android device/emulator
npm run ios            # Run on iOS simulator
npm run web            # Start web version

# Building
npm run prebuild              # Generate native projects
npm run android:dev           # Prebuild + run Android
npm run build:android         # EAS production build
npm run build:android:preview # EAS preview build
npm run build:android:local   # EAS local preview build

# Code Quality
npm run lint           # Run ESLint
npm test               # Run Jest tests
npm run test:watch     # Jest in watch mode
npm run test:coverage  # Jest with coverage report
```
