import { requireNativeModule } from "expo-modules-core";

const VaultPeerFileSystem = requireNativeModule("VaultPeerFileSystem");

export interface PickResult {
  uri: string;
  bookmark: string;
}

/**
 * Launch document picker to select an existing file.
 * Returns the URI and bookmark (iOS only) of the selected file.
 */
export async function pickFile(): Promise<PickResult> {
  return await VaultPeerFileSystem.pickFile();
}

/**
 * Save a file to a user-selected location.
 * @param suggestedName The default file name suggested to the user.
 * @param tempFileUri The local temporary file URI containing the initial content to write.
 */
export async function createFile(
  suggestedName: string,
  tempFileUri: string
): Promise<PickResult> {
  return await VaultPeerFileSystem.createFile(suggestedName, tempFileUri);
}

/**
 * Read the content of the file as Base64.
 * @param uri The URI of the file.
 * @param bookmark The security-scoped bookmark data (iOS only).
 */
export async function readFile(
  uri: string,
  bookmark?: string
): Promise<string> {
  return await VaultPeerFileSystem.readFile(uri, bookmark || "");
}

/**
 * Write Base64 content to the file.
 * @param uri The URI of the file.
 * @param contentBase64 The Base64 content to write.
 * @param bookmark The security-scoped bookmark data (iOS only).
 */
export async function writeFile(
  uri: string,
  contentBase64: string,
  bookmark?: string
): Promise<boolean> {
  return await VaultPeerFileSystem.writeFile(
    uri,
    contentBase64,
    bookmark || ""
  );
}

/**
 * Write Base64 content to a temporary file in the app cache and return its URI.
 */
export async function writeTempFile(contentBase64: string): Promise<string> {
  return await VaultPeerFileSystem.writeTempFile(contentBase64);
}
