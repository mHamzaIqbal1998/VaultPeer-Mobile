/**
 * Crypto Service — Public API
 *
 * Re-exports all cryptographic primitives used by the app.
 */

export {
  initCryptoEngine,
  isCryptoEngineReady,
  createCredentials,
  decryptDatabase,
  encryptDatabase,
  createNewDatabase,
} from "./cryptoEngine";

export { nativeArgon2Hash, createKdbxArgon2Impl } from "./argon2Bridge";

export type { Argon2HashRequest } from "./argon2Bridge";
