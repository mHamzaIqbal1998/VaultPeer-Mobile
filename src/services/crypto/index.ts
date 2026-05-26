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
  applyKdfParams,
} from "./cryptoEngine";

export {
  parseMeta,
  parseDatabase,
  parseEntry,
  parseGroup,
} from "./databaseParser";

export { nativeArgon2Hash, createKdbxArgon2Impl } from "./argon2Bridge";

export type { Argon2HashRequest } from "./argon2Bridge";

export {
  runKdfBenchmark,
  getCurrentKdfParams,
  validateKdfParams,
  formatKdfParams,
  formatMemory,
} from "./kdfBenchmark";

export type {
  KdfType,
  KdfBenchmarkResult,
  KdfTuningParams,
} from "./kdfBenchmark";
