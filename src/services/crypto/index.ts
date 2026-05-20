/**
 * Crypto Service — Public API
 *
 * Re-exports all cryptographic primitives used by the app.
 */

import "./webCryptoPolyfill";

export {
  initCryptoEngine,
  isCryptoEngineReady,
  createCredentials,
  decryptDatabase,
  encryptDatabase,
  createNewDatabase,
} from "./cryptoEngine";

export { parseMeta, parseDatabase } from "./databaseParser";

export { nativeArgon2Hash, createKdbxArgon2Impl } from "./argon2Bridge";

export type { Argon2HashRequest } from "./argon2Bridge";
