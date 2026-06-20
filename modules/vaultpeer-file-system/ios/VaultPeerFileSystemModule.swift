import ExpoModulesCore
import UIKit
import UniformTypeIdentifiers

public class VaultPeerFileSystemModule: Module, UIDocumentPickerDelegate {
  private var pendingPromise: Promise?
  private var pendingAction: String? // "pick" or "create"
  private var tempFileToExport: URL?

  public func definition() -> ModuleDefinition {
    Name("VaultPeerFileSystem")

    AsyncFunction("pickFile") { (promise: Promise) in
      guard self.pendingPromise == nil else {
        promise.reject("ERR_BUSY", "Another file system operation is in progress")
        return
      }

      DispatchQueue.main.async {
        self.pendingPromise = promise
        self.pendingAction = "pick"

        // UIDocumentPickerViewController for opening KDBX or any database files
        let documentPicker = UIDocumentPickerViewController(forOpeningContentTypes: [.data], asCopy: false)
        documentPicker.delegate = self
        documentPicker.allowsMultipleSelection = false

        var rootViewController: UIViewController? = nil
        if #available(iOS 13.0, *) {
          rootViewController = UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .flatMap { $0.windows }
            .first { $0.isKeyWindow }?.rootViewController
        }
        if rootViewController == nil {
          rootViewController = UIApplication.shared.keyWindow?.rootViewController
        }

        if let vc = rootViewController {
          vc.present(documentPicker, animated: true, completion: nil)
        } else {
          self.pendingPromise = nil
          self.pendingAction = nil
          promise.reject("ERR_NO_VIEW_CONTROLLER", "Could not find root view controller to present picker")
        }
      }
    }

    AsyncFunction("createFile") { (suggestedName: String, tempFileUri: String, promise: Promise) in
      guard self.pendingPromise == nil else {
        promise.reject("ERR_BUSY", "Another file system operation is in progress")
        return
      }

      var cleanUri = tempFileUri
      if cleanUri.hasPrefix("file://") {
        cleanUri = String(cleanUri.dropFirst(7))
      }
      let tempUrl = URL(fileURLWithPath: cleanUri)

      DispatchQueue.main.async {
        self.pendingPromise = promise
        self.pendingAction = "create"
        self.tempFileToExport = tempUrl

        let documentPicker = UIDocumentPickerViewController(forExporting: [tempUrl], asCopy: true)
        documentPicker.delegate = self

        var rootViewController: UIViewController? = nil
        if #available(iOS 13.0, *) {
          rootViewController = UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .flatMap { $0.windows }
            .first { $0.isKeyWindow }?.rootViewController
        }
        if rootViewController == nil {
          rootViewController = UIApplication.shared.keyWindow?.rootViewController
        }

        if let vc = rootViewController {
          vc.present(documentPicker, animated: true, completion: nil)
        } else {
          self.pendingPromise = nil
          self.pendingAction = nil
          self.tempFileToExport = nil
          promise.reject("ERR_NO_VIEW_CONTROLLER", "Could not find root view controller to present creator")
        }
      }
    }

    AsyncFunction("readFile") { (uriString: String, bookmarkString: String, promise: Promise) in
      do {
        var url = URL(string: uriString)
        var isSecurityScoped = false

        if !bookmarkString.isEmpty {
          if let bookmarkData = Data(base64Encoded: bookmarkString) {
            var isStale = false
            url = try URL(resolvingBookmarkData: bookmarkData, options: .withSecurityScope, relativeTo: nil, bookmarkDataIsStale: &isStale)
            isSecurityScoped = true
          }
        }

        guard let resolvedUrl = url else {
          promise.reject("ERR_INVALID_URI", "Could not resolve file URI: \(uriString)")
          return
        }

        if isSecurityScoped {
          guard resolvedUrl.startAccessingSecurityScopedResource() else {
            promise.reject("ERR_ACCESS_DENIED", "Failed to start accessing security-scoped resource")
            return
          }
        }

        defer {
          if isSecurityScoped {
            resolvedUrl.stopAccessingSecurityScopedResource()
          }
        }

        let data = try Data(contentsOf: resolvedUrl)
        let base64 = data.base64EncodedString()
        promise.resolve(base64)
      } catch {
        promise.reject("ERR_READ_FAILED", "Failed to read file: \(error.localizedDescription)")
      }
    }

    AsyncFunction("writeFile") { (uriString: String, contentBase64: String, bookmarkString: String, promise: Promise) in
      do {
        var url = URL(string: uriString)
        var isSecurityScoped = false

        if !bookmarkString.isEmpty {
          if let bookmarkData = Data(base64Encoded: bookmarkString) {
            var isStale = false
            url = try URL(resolvingBookmarkData: bookmarkData, options: .withSecurityScope, relativeTo: nil, bookmarkDataIsStale: &isStale)
            isSecurityScoped = true
          }
        }

        guard let resolvedUrl = url else {
          promise.reject("ERR_INVALID_URI", "Could not resolve file URI: \(uriString)")
          return
        }

        if isSecurityScoped {
          guard resolvedUrl.startAccessingSecurityScopedResource() else {
            promise.reject("ERR_ACCESS_DENIED", "Failed to start accessing security-scoped resource")
            return
          }
        }

        defer {
          if isSecurityScoped {
            resolvedUrl.stopAccessingSecurityScopedResource()
          }
        }

        guard let data = Data(base64Encoded: contentBase64) else {
          promise.reject("ERR_INVALID_BASE64", "Provided content is not valid Base64")
          return
        }

        // Atomic write: write content to a temporary file first, then replace the original file
        let tempDir = FileManager.default.temporaryDirectory
        let tempFileUrl = tempDir.appendingPathComponent(UUID().uuidString).appendingPathExtension("tmp")
        try data.write(to: tempFileUrl, options: .atomic)

        _ = try FileManager.default.replaceItemAt(resolvedUrl, withItemAt: tempFileUrl, backupItemName: nil, options: .usingProposedNames)
        promise.resolve(true)
      } catch {
        promise.reject("ERR_WRITE_FAILED", "Failed to write file: \(error.localizedDescription)")
      }
    }

    AsyncFunction("writeTempFile") { (contentBase64: String, promise: Promise) in
      do {
        guard let data = Data(base64Encoded: contentBase64) else {
          promise.reject("ERR_INVALID_BASE64", "Provided content is not valid Base64")
          return
        }
        let tempDir = FileManager.default.temporaryDirectory
        let tempFileUrl = tempDir.appendingPathComponent(UUID().uuidString).appendingPathExtension("kdbx")
        try data.write(to: tempFileUrl, options: .atomic)
        promise.resolve(tempFileUrl.absoluteString)
      } catch {
        promise.reject("ERR_TEMP_WRITE_FAILED", "Failed to write temporary file: \(error.localizedDescription)")
      }
    }

    // Read-only metadata: OS last-modified time (ms) and size (bytes).
    AsyncFunction("getMetadata") { (uriString: String, bookmarkString: String, promise: Promise) in
      do {
        var url = URL(string: uriString)
        var isSecurityScoped = false

        if !bookmarkString.isEmpty {
          if let bookmarkData = Data(base64Encoded: bookmarkString) {
            var isStale = false
            url = try URL(resolvingBookmarkData: bookmarkData, options: .withSecurityScope, relativeTo: nil, bookmarkDataIsStale: &isStale)
            isSecurityScoped = true
          }
        }

        guard let resolvedUrl = url else {
          promise.reject("ERR_INVALID_URI", "Could not resolve file URI: \(uriString)")
          return
        }

        if isSecurityScoped {
          guard resolvedUrl.startAccessingSecurityScopedResource() else {
            promise.reject("ERR_ACCESS_DENIED", "Failed to start accessing security-scoped resource")
            return
          }
        }

        defer {
          if isSecurityScoped {
            resolvedUrl.stopAccessingSecurityScopedResource()
          }
        }

        let values = try resolvedUrl.resourceValues(forKeys: [.contentModificationDateKey, .fileSizeKey, .isRegularFileKey])
        let mtimeMs = (values.contentModificationDate?.timeIntervalSince1970 ?? 0) * 1000.0
        let size = Double(values.fileSize ?? 0)
        let exists = values.isRegularFile ?? FileManager.default.fileExists(atPath: resolvedUrl.path)

        let result: [String: Any] = [
          "mtime": mtimeMs,
          "size": size,
          "exists": exists
        ]
        promise.resolve(result)
      } catch {
        promise.reject("ERR_METADATA_FAILED", "Failed to get file metadata: \(error.localizedDescription)")
      }
    }

    // Directory operations back the vault backup-retention feature, which is
    // currently Android-only. These stubs keep the JS API surface consistent.
    AsyncFunction("pickDirectory") { (promise: Promise) in
      promise.reject("ERR_UNSUPPORTED", "Directory backups are not supported on this platform")
    }

    AsyncFunction("createFileInDirectory") { (dirUri: String, displayName: String, contentBase64: String, promise: Promise) in
      promise.reject("ERR_UNSUPPORTED", "Directory backups are not supported on this platform")
    }

    AsyncFunction("listDirectory") { (dirUri: String, promise: Promise) in
      promise.reject("ERR_UNSUPPORTED", "Directory backups are not supported on this platform")
    }

    AsyncFunction("deleteDocument") { (uri: String, promise: Promise) in
      promise.reject("ERR_UNSUPPORTED", "Directory backups are not supported on this platform")
    }
  }

  // MARK: - UIDocumentPickerDelegate

  public func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
    let promise = pendingPromise
    pendingPromise = nil
    pendingAction = nil
    tempFileToExport = nil

    guard let promise = promise else { return }
    guard let url = urls.first else {
      promise.reject("ERR_NO_URL", "No URL was returned by the document picker")
      return
    }

    do {
      // Access security scoped resource to generate bookmark
      guard url.startAccessingSecurityScopedResource() else {
        promise.reject("ERR_ACCESS_DENIED", "Failed to start accessing security-scoped resource")
        return
      }
      defer {
        url.stopAccessingSecurityScopedResource()
      }

      // Generate security-scoped bookmark
      let bookmarkData = try url.bookmarkData(options: .minimalBookmark, includingResourceValuesForKeys: nil, relativeTo: nil)
      let bookmarkBase64 = bookmarkData.base64EncodedString()

      let result: [String: Any] = [
        "uri": url.absoluteString,
        "bookmark": bookmarkBase64,
        "name": url.lastPathComponent
      ]
      promise.resolve(result)
    } catch {
      promise.reject("ERR_BOOKMARK_FAILED", "Failed to create security-scoped bookmark: \(error.localizedDescription)")
    }
  }

  public func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
    let promise = pendingPromise
    pendingPromise = nil
    pendingAction = nil
    tempFileToExport = nil

    promise?.reject("ERR_CANCELLED", "User cancelled file picker operation")
  }
}
