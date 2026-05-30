package com.vaultpeer.autofill

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import android.util.Log
import android.view.autofill.AutofillId

/**
 * Static bridge for passing autofill data between the AutofillTrampolineActivity
 * and the VaultPeerAutofillModule across the Activity lifecycle.
 *
 * This also serves as a defense-in-depth cache for AutofillId data:
 * If the static [VaultPeerAutofillService.activeRequest] is lost (e.g., process
 * death or unexpected service lifecycle events), the module can reconstruct
 * the request from these cached values.
 */
object AutofillResultBridge {
    var pendingResult: Intent? = null
    var hasSubmitted: Boolean = false

    // Cached autofill request data (populated by the autofill service as backup)
    var cachedPackageName: String? = null
    var cachedWebDomain: String? = null
    var cachedUsernameId: AutofillId? = null
    var cachedPasswordId: AutofillId? = null
    var cachedFocusedId: AutofillId? = null

    fun cacheRequest(
        packageName: String,
        webDomain: String?,
        usernameId: AutofillId?,
        passwordId: AutofillId?,
        focusedId: AutofillId?
    ) {
        cachedPackageName = packageName
        cachedWebDomain = webDomain
        cachedUsernameId = usernameId
        cachedPasswordId = passwordId
        cachedFocusedId = focusedId
    }

    fun clearCache() {
        cachedPackageName = null
        cachedWebDomain = null
        cachedUsernameId = null
        cachedPasswordId = null
        cachedFocusedId = null
    }
}

class AutofillTrampolineActivity : Activity() {
    private var launched = false

    companion object {
        private const val TAG = "VaultPeerAutofill"
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        Log.d(TAG, "AutofillTrampolineActivity onCreate")
        launched = savedInstanceState?.getBoolean("launched", false) ?: false
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        outState.putBoolean("launched", launched)
    }

    override fun onResume() {
        super.onResume()
        Log.d(TAG, "AutofillTrampolineActivity onResume, launched=$launched")

        try {
            handleResume()
        } catch (e: Exception) {
            // CRITICAL: Any unhandled crash here can cascade into the autofill framework
            // and potentially crash the system process. Catch everything and fail gracefully.
            Log.e(TAG, "FATAL: Unhandled exception in AutofillTrampolineActivity onResume", e)
            try {
                setResult(RESULT_CANCELED)
                AutofillResultBridge.pendingResult = null
                AutofillResultBridge.hasSubmitted = false
            } catch (ignored: Exception) {}
            finish()
        }
    }

    private fun handleResume() {
        if ((intent.flags and Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY) != 0) {
            Log.d(TAG, "AutofillTrampolineActivity launched from history. Redirecting to main launcher.")
            val cleanIntent = try {
                packageManager.getLaunchIntentForPackage(packageName)?.apply {
                    action = Intent.ACTION_MAIN
                    addCategory(Intent.CATEGORY_LAUNCHER)
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK)
                }
            } catch (e: Exception) {
                Log.w(TAG, "Failed to create clean intent", e)
                null
            }
            if (cleanIntent != null) {
                startActivity(cleanIntent)
            }
            finish()
            return
        }

        if (!launched) {
            launched = true
            // Launch MainActivity
            val targetIntent = try {
                packageManager.getLaunchIntentForPackage(packageName)?.apply {
                    action = intent.action
                    data = intent.data
                    // Forward only explicit primitive autofill extras to prevent binder serialization crashes
                    putExtra("autofill_request", intent.getBooleanExtra("autofill_request", false))
                    intent.getStringExtra("caller_package")?.let { putExtra("caller_package", it) }
                    intent.getStringExtra("caller_domain")?.let { putExtra("caller_domain", it) }
                    addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP)
                }
            } catch (e: Exception) {
                Log.e(TAG, "Failed to build target intent", e)
                null
            }

            if (targetIntent != null) {
                Log.d(TAG, "AutofillTrampolineActivity starting MainActivity")
                startActivity(targetIntent)
            } else {
                Log.e(TAG, "AutofillTrampolineActivity: targetIntent is null")
                setResult(RESULT_CANCELED)
                finish()
            }
        } else {
            // We have returned from MainActivity
            val hasSubmitted = AutofillResultBridge.hasSubmitted
            val pending = AutofillResultBridge.pendingResult
            Log.d(TAG, "AutofillTrampolineActivity returned: hasSubmitted=$hasSubmitted, pending=$pending")

            if (hasSubmitted && pending != null) {
                setResult(RESULT_OK, pending)
                Log.d(TAG, "AutofillTrampolineActivity setResult RESULT_OK")
            } else {
                setResult(RESULT_CANCELED)
                Log.d(TAG, "AutofillTrampolineActivity setResult RESULT_CANCELED")
            }
            AutofillResultBridge.pendingResult = null
            AutofillResultBridge.hasSubmitted = false
            finish()
        }
    }
}
