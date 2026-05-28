package com.vaultpeer.autofill

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import android.util.Log
import android.view.autofill.AutofillManager

object AutofillResultBridge {
    var pendingResult: Intent? = null
    var hasSubmitted: Boolean = false
}

class AutofillTrampolineActivity : Activity() {
    private var launched = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        Log.d("VaultPeerAutofill", "AutofillTrampolineActivity onCreate")
        launched = savedInstanceState?.getBoolean("launched", false) ?: false
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        outState.putBoolean("launched", launched)
    }

    override fun onResume() {
        super.onResume()
        Log.d("VaultPeerAutofill", "AutofillTrampolineActivity onResume, launched=$launched")

        if ((intent.flags and Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY) != 0) {
            Log.d("VaultPeerAutofill", "AutofillTrampolineActivity launched from history. Redirecting to main launcher.")
            val cleanIntent = packageManager.getLaunchIntentForPackage(packageName)?.apply {
                action = Intent.ACTION_MAIN
                addCategory(Intent.CATEGORY_LAUNCHER)
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK)
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
            val targetIntent = packageManager.getLaunchIntentForPackage(packageName)?.apply {
                action = intent.action
                data = intent.data
                // Forward only explicit primitive autofill extras to prevent binder serialization crashes
                putExtra("autofill_request", intent.getBooleanExtra("autofill_request", false))
                intent.getStringExtra("caller_package")?.let { putExtra("caller_package", it) }
                intent.getStringExtra("caller_domain")?.let { putExtra("caller_domain", it) }
                addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP)
            }

            if (targetIntent != null) {
                Log.d("VaultPeerAutofill", "AutofillTrampolineActivity starting MainActivity")
                startActivity(targetIntent)
            } else {
                Log.e("VaultPeerAutofill", "AutofillTrampolineActivity: targetIntent is null")
                setResult(RESULT_CANCELED)
                finish()
            }
        } else {
            // We have returned from MainActivity
            val hasSubmitted = AutofillResultBridge.hasSubmitted
            val pending = AutofillResultBridge.pendingResult
            Log.d("VaultPeerAutofill", "AutofillTrampolineActivity returned: hasSubmitted=$hasSubmitted, pending=$pending")

            if (hasSubmitted && pending != null) {
                setResult(RESULT_OK, pending)
                Log.d("VaultPeerAutofill", "AutofillTrampolineActivity setResult RESULT_OK")
            } else {
                setResult(RESULT_CANCELED)
                Log.d("VaultPeerAutofill", "AutofillTrampolineActivity setResult RESULT_CANCELED")
            }
            AutofillResultBridge.pendingResult = null
            AutofillResultBridge.hasSubmitted = false
            finish()
        }
    }
}

