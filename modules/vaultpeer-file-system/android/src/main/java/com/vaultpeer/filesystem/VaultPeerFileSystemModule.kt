package com.vaultpeer.filesystem

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.util.Base64
import com.facebook.react.bridge.ActivityEventListener
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactApplicationContext
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File

class VaultPeerFileSystemModule : Module(), ActivityEventListener {
  private var pendingPromise: Promise? = null
  private var pendingAction: String? = null // "pick" or "create"
  private var tempFileToCopy: String? = null // for createFile content copy

  private val REQUEST_CODE_PICK_FILE = 4201
  private val REQUEST_CODE_CREATE_FILE = 4202

  override fun definition() = ModuleDefinition {
    Name("VaultPeerFileSystem")

    OnCreate {
      (appContext.reactContext as? ReactApplicationContext)?.addActivityEventListener(this@VaultPeerFileSystemModule)
    }

    OnDestroy {
      (appContext.reactContext as? ReactApplicationContext)?.removeActivityEventListener(this@VaultPeerFileSystemModule)
    }

    AsyncFunction("pickFile") { promise: Promise ->
      if (pendingPromise != null) {
        promise.reject("ERR_BUSY", "Another file system operation is in progress", null)
        return@AsyncFunction
      }

      val activity = appContext.currentActivity
      if (activity == null) {
        promise.reject("ERR_NO_ACTIVITY", "Activity is not available", null)
        return@AsyncFunction
      }

      pendingPromise = promise
      pendingAction = "pick"

      val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
        addCategory(Intent.CATEGORY_OPENABLE)
        type = "*/*" // Allow all file types (KDBX files are custom binary format)
      }

      try {
        activity.startActivityForResult(intent, REQUEST_CODE_PICK_FILE)
      } catch (e: Exception) {
        pendingPromise = null
        pendingAction = null
        promise.reject("ERR_LAUNCH_PICKER_FAILED", "Failed to launch file picker: ${e.message}", e)
      }
    }

    AsyncFunction("createFile") { suggestedName: String, tempFileUri: String, promise: Promise ->
      if (pendingPromise != null) {
        promise.reject("ERR_BUSY", "Another file system operation is in progress", null)
        return@AsyncFunction
      }

      val activity = appContext.currentActivity
      if (activity == null) {
        promise.reject("ERR_NO_ACTIVITY", "Activity is not available", null)
        return@AsyncFunction
      }

      pendingPromise = promise
      pendingAction = "create"
      tempFileToCopy = tempFileUri

      val intent = Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
        addCategory(Intent.CATEGORY_OPENABLE)
        type = "application/octet-stream"
        putExtra(Intent.EXTRA_TITLE, suggestedName)
      }

      try {
        activity.startActivityForResult(intent, REQUEST_CODE_CREATE_FILE)
      } catch (e: Exception) {
        pendingPromise = null
        pendingAction = null
        tempFileToCopy = null
        promise.reject("ERR_LAUNCH_CREATOR_FAILED", "Failed to launch file creator: ${e.message}", e)
      }
    }

    AsyncFunction("readFile") { uriString: String, bookmarkString: String, promise: Promise ->
      try {
        val context = appContext.reactContext ?: throw Exception("React context is not available")
        val uri = Uri.parse(uriString)

        context.contentResolver.openInputStream(uri)?.use { inputStream ->
          val bytes = inputStream.readBytes()
          val base64 = Base64.encodeToString(bytes, Base64.NO_WRAP)
          promise.resolve(base64)
        } ?: throw Exception("Failed to open input stream for URI: $uriString")
      } catch (e: Exception) {
        promise.reject("ERR_READ_FAILED", "Failed to read file: ${e.message}", e)
      }
    }

    AsyncFunction("writeFile") { uriString: String, contentBase64: String, bookmarkString: String, promise: Promise ->
      try {
        val context = appContext.reactContext ?: throw Exception("React context is not available")
        val uri = Uri.parse(uriString)
        val bytes = Base64.decode(contentBase64, Base64.NO_WRAP)

        // Atomic write: write to a temporary file inside the cache directory first
        val tempFile = File.createTempFile("vaultpeer_write", ".tmp", context.cacheDir)
        tempFile.writeBytes(bytes)

        // Now stream the temp file contents to the persistent SAF target URI.
        context.contentResolver.openOutputStream(uri, "rwt")?.use { outputStream ->
          tempFile.inputStream().use { inputStream ->
            inputStream.copyTo(outputStream)
          }
          promise.resolve(true)
        } ?: throw Exception("Failed to open output stream for URI: $uriString")

        // Clean up temporary file
        try {
          tempFile.delete()
        } catch (ignored: Exception) {}
      } catch (e: Exception) {
        promise.reject("ERR_WRITE_FAILED", "Failed to write file: ${e.message}", e)
      }
    }

    AsyncFunction("writeTempFile") { contentBase64: String, promise: Promise ->
      try {
        val context = appContext.reactContext ?: throw Exception("React context is not available")
        val bytes = Base64.decode(contentBase64, Base64.NO_WRAP)
        val tempFile = File.createTempFile("vaultpeer_temp", ".kdbx", context.cacheDir)
        tempFile.writeBytes(bytes)
        promise.resolve(Uri.fromFile(tempFile).toString())
      } catch (e: Exception) {
        promise.reject("ERR_TEMP_WRITE_FAILED", "Failed to write temporary file: ${e.message}", e)
      }
    }
  }

  override fun onActivityResult(activity: Activity, requestCode: Int, resultCode: Int, data: Intent?) {
    if (requestCode == REQUEST_CODE_PICK_FILE || requestCode == REQUEST_CODE_CREATE_FILE) {
      val promise = pendingPromise
      val action = pendingAction
      val tempPath = tempFileToCopy
      
      pendingPromise = null
      pendingAction = null
      tempFileToCopy = null

      if (promise == null) return

      if (resultCode != Activity.RESULT_OK || data == null || data.data == null) {
        promise.reject("ERR_CANCELLED", "User cancelled or failed to select file", null)
        return
      }

      val uri = data.data!!
      val context = appContext.reactContext ?: run {
        promise.reject("ERR_CONTEXT_LOST", "React context was lost", null)
        return
      }

      try {
        var displayName: String? = null
        try {
          context.contentResolver.query(uri, null, null, null, null)?.use { cursor ->
            if (cursor.moveToFirst()) {
              val nameIndex = cursor.getColumnIndex(android.provider.OpenableColumns.DISPLAY_NAME)
              if (nameIndex != -1) {
                displayName = cursor.getString(nameIndex)
              }
            }
          }
        } catch (queryEx: Exception) {
          // Fallback to null, we'll parse the URI in JS
        }

        // Persist permissions on the URI so we can read/write in subsequent app sessions
        val takeFlags = Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION
        context.contentResolver.takePersistableUriPermission(uri, takeFlags)

        // If creating a file, copy initial content from our temporary file
        if (action == "create" && tempPath != null) {
          val tempUri = Uri.parse(tempPath)
          context.contentResolver.openOutputStream(uri, "rwt")?.use { outputStream ->
            context.contentResolver.openInputStream(tempUri)?.use { inputStream ->
              inputStream.copyTo(outputStream)
            }
          } ?: throw Exception("Failed to copy initial content to created file")
        }

        val result = Arguments.createMap().apply {
          putString("uri", uri.toString())
          putString("bookmark", "") // Bookmarks are only required on iOS
          putString("name", displayName ?: "")
        }
        promise.resolve(result)
      } catch (e: Exception) {
        promise.reject("ERR_PERSIST_PERMISSION_FAILED", "Failed to persist file permissions: ${e.message}", e)
      }
    }
  }

  override fun onNewIntent(intent: Intent) {
    // No-op
  }
}
