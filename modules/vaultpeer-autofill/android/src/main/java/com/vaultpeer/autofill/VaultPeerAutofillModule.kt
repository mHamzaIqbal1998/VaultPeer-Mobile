package com.vaultpeer.autofill

import android.app.Activity
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.service.autofill.Dataset
import android.service.autofill.FillResponse
import android.view.autofill.AutofillManager
import android.view.autofill.AutofillValue
import android.widget.RemoteViews
import com.facebook.react.bridge.Arguments
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import com.vaultpeer.autofill.R

class VaultPeerAutofillModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("VaultPeerAutofill")

    AsyncFunction("isAutofillServiceEnabled") { promise: Promise ->
      try {
        val context = appContext.reactContext ?: throw Exception("Context not found")
        val service = Settings.Secure.getString(context.contentResolver, "autofill_service")
        val componentName = ComponentName(context, VaultPeerAutofillService::class.java)
        val isEnabled = service != null && ComponentName.unflattenFromString(service) == componentName
        promise.resolve(isEnabled)
      } catch (e: Exception) {
        promise.resolve(false)
      }
    }

    AsyncFunction("openAutofillSettings") { promise: Promise ->
      try {
        val context = appContext.reactContext ?: throw Exception("Context not found")
        try {
          val intent = Intent(Settings.ACTION_REQUEST_SET_AUTOFILL_SERVICE).apply {
            data = Uri.parse("package:${context.packageName}")
          }
          context.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        } catch (e: Exception) {
          val intent = Intent(Settings.ACTION_MANAGE_DEFAULT_APPS_SETTINGS)
          context.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        }
        promise.resolve(null)
      } catch (e: Exception) {
        promise.reject("ERR_OPEN_SETTINGS_FAILED", "Failed to open settings: ${e.message}", e)
      }
    }

    AsyncFunction("getActiveRequest") { promise: Promise ->
      val active = VaultPeerAutofillService.activeRequest
      if (active == null) {
        promise.resolve(null)
        return@AsyncFunction
      }

      val result = Arguments.createMap().apply {
        putString("packageName", active.packageName)
        putString("webDomain", active.webDomain)
        putBoolean("hasUsernameField", active.usernameId != null)
        putBoolean("hasPasswordField", active.passwordId != null)
        putBoolean("hasFocusedField", active.focusedId != null)
      }
      promise.resolve(result)
    }

    AsyncFunction("submitCredentials") { usernameString: String?, passwordString: String?, promise: Promise ->
      val active = VaultPeerAutofillService.activeRequest
      if (active == null) {
        promise.reject("ERR_NO_ACTIVE_REQUEST", "No active autofill request found", null)
        return@AsyncFunction
      }

      val rContext = appContext.reactContext ?: throw Exception("Context not found")
      val pkg = rContext.packageName
      val datasetBuilder = Dataset.Builder()
      var hasData = false

      val username = usernameString ?: ""
      val password = passwordString ?: ""

      if (usernameString != null && active.usernameId != null) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
          datasetBuilder.setValue(
            active.usernameId,
            AutofillValue.forText(username)
          )
        } else {
          val usernamePresentation = RemoteViews(pkg, R.layout.autofill_entry_presentation).apply {
            setTextViewText(R.id.autofill_text, username)
          }
          datasetBuilder.setValue(
            active.usernameId,
            AutofillValue.forText(username),
            usernamePresentation
          )
        }
        hasData = true
      }

      if (passwordString != null && active.passwordId != null) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
          datasetBuilder.setValue(
            active.passwordId,
            AutofillValue.forText(password)
          )
        } else {
          val passwordPresentation = RemoteViews(pkg, R.layout.autofill_entry_presentation).apply {
            setTextViewText(R.id.autofill_text, "••••••••")
          }
          datasetBuilder.setValue(
            active.passwordId,
            AutofillValue.forText(password),
            passwordPresentation
          )
        }
        hasData = true
      }

      if (!hasData && active.focusedId != null) {
        val fillValue = usernameString ?: passwordString ?: ""
        val isPassword = passwordString != null && usernameString == null
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
          datasetBuilder.setValue(
            active.focusedId,
            AutofillValue.forText(fillValue)
          )
        } else {
          val presentationText = if (isPassword) "••••••••" else fillValue
          val focusedPresentation = RemoteViews(pkg, R.layout.autofill_entry_presentation).apply {
            setTextViewText(R.id.autofill_text, presentationText)
          }
          datasetBuilder.setValue(
            active.focusedId,
            AutofillValue.forText(fillValue),
            focusedPresentation
          )
        }
        hasData = true
      }

      if (!hasData) {
        promise.reject("ERR_NO_FIELDS", "No username or password field found to autofill", null)
        return@AsyncFunction
      }

      val dataset = datasetBuilder.build()
      val currentActivity = appContext.currentActivity
      if (currentActivity == null) {
        promise.reject("ERR_NO_ACTIVITY", "Current activity is not available", null)
        return@AsyncFunction
      }

      val replyIntent = Intent().apply {
        putExtra(AutofillManager.EXTRA_AUTHENTICATION_RESULT, dataset)
      }
      
      AutofillResultBridge.pendingResult = replyIntent
      AutofillResultBridge.hasSubmitted = true
      currentActivity.finish()

      VaultPeerAutofillService.activeRequest = null
      promise.resolve(true)
    }

    AsyncFunction("cancelRequest") { promise: Promise ->
      AutofillResultBridge.pendingResult = null
      AutofillResultBridge.hasSubmitted = false
      val currentActivity = appContext.currentActivity
      if (currentActivity != null) {
        currentActivity.finish()
      }
      VaultPeerAutofillService.activeRequest = null
      promise.resolve(null)
    }
  }
}

