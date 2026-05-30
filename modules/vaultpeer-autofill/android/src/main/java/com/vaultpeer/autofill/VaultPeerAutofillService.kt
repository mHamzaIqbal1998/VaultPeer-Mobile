package com.vaultpeer.autofill

import android.app.PendingIntent
import android.app.assist.AssistStructure
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.CancellationSignal
import android.service.autofill.FillCallback
import android.service.autofill.FillContext
import android.service.autofill.FillRequest
import android.service.autofill.FillResponse
import android.service.autofill.SaveCallback
import android.service.autofill.SaveRequest
import android.service.autofill.SaveInfo
import android.service.autofill.Dataset
import android.service.autofill.AutofillService
import android.service.autofill.InlinePresentation
import android.view.View
import android.view.autofill.AutofillId
import android.widget.inline.InlinePresentationSpec
import android.widget.RemoteViews
import androidx.autofill.inline.v1.InlineSuggestionUi
import com.vaultpeer.autofill.R
import java.util.ArrayDeque
import java.util.concurrent.atomic.AtomicInteger

class ActiveAutofillRequest(
    val packageName: String,
    val webDomain: String?,
    val usernameId: AutofillId?,
    val passwordId: AutofillId?,
    val focusedId: AutofillId?,
    val callback: FillCallback?
)

class VaultPeerAutofillService : AutofillService() {

    companion object {
        private const val TAG = "VaultPeerAutofill"
        /**
         * Maximum number of view nodes to visit during structure traversal.
         * Prevents runaway traversals on deeply nested or extremely large view trees
         * (e.g., Chrome WebViews on Samsung One UI which can have 1000+ nodes).
         */
        private const val MAX_NODE_VISIT_COUNT = 2000

        var activeRequest: ActiveAutofillRequest? = null

        /** Monotonically increasing request code for unique PendingIntents */
        private val pendingIntentCounter = AtomicInteger(1000)
    }

    override fun onDisconnected() {
        super.onDisconnected()
        // NOTE: Do NOT clear activeRequest here! The system unbinds the autofill
        // service shortly after onFillRequest responds with callback.onSuccess(),
        // but the user hasn't selected a credential yet. The activeRequest data
        // (containing AutofillIds) must survive until submitCredentials is called
        // from the React Native module after the user selects an entry.
        //
        // Only the callback reference becomes stale after disconnect, but we don't
        // use it after onFillRequest anyway (the result goes back via setResult on
        // AutofillTrampolineActivity).
        android.util.Log.d(TAG, "AutofillService disconnected (activeRequest preserved)")
    }

    override fun onFillRequest(
        request: FillRequest,
        cancellationSignal: CancellationSignal,
        callback: FillCallback
    ) {
        try {
            onFillRequestInternal(request, cancellationSignal, callback)
        } catch (e: Exception) {
            // CRITICAL: Any unhandled exception in the autofill service can crash the
            // system_server process, leading to a full device reboot. We must catch
            // everything and respond gracefully.
            android.util.Log.e(TAG, "FATAL: Unhandled exception in onFillRequest", e)
            try {
                callback.onSuccess(null)
            } catch (callbackError: Exception) {
                android.util.Log.e(TAG, "Failed to send null response after error", callbackError)
            }
        }
    }

    private fun onFillRequestInternal(
        request: FillRequest,
        cancellationSignal: CancellationSignal,
        callback: FillCallback
    ) {
        val contexts = request.fillContexts
        if (contexts.isEmpty()) {
            callback.onSuccess(null)
            return
        }

        val structure = contexts[contexts.size - 1].structure
        val requestData = traverseStructure(structure)

        if (requestData.packageName == this.packageName) {
            android.util.Log.d(TAG, "Ignoring fill request for our own application")
            callback.onSuccess(null)
            return
        }

        val hasCredentialField = requestData.usernameId != null || requestData.passwordId != null
        // Only trigger when we found explicit credential fields on the page.
        // When no credential fields are found, only trigger if the focused field
        // itself has positive credential signals (autofill hints, HTML type=password,
        // credential-related id/hint keywords, etc.).
        // This prevents the popup from appearing on search bars, URL bars, chat
        // text fields, and other non-credential inputs.
        val shouldTrigger = hasCredentialField || requestData.isFocusedNodeCredential

        if (shouldTrigger) {
            // Store the request info statically so the native module can retrieve it
            activeRequest = ActiveAutofillRequest(
                packageName = requestData.packageName,
                webDomain = requestData.webDomain,
                usernameId = requestData.usernameId,
                passwordId = requestData.passwordId,
                focusedId = requestData.focusedId,
                callback = callback
            )

            // Also cache in AutofillResultBridge as defense-in-depth.
            // If the static activeRequest is lost (e.g., process death between
            // onFillRequest and submitCredentials), the module can recover from this.
            AutofillResultBridge.cacheRequest(
                packageName = requestData.packageName,
                webDomain = requestData.webDomain,
                usernameId = requestData.usernameId,
                passwordId = requestData.passwordId,
                focusedId = requestData.focusedId
            )

            // Start AutofillTrampolineActivity to authenticate/unlock/select
            val intent = Intent(this, AutofillTrampolineActivity::class.java).apply {
                action = Intent.ACTION_VIEW
                data = Uri.parse(
                    "vaultpeermobile://autofill?packageName=${Uri.encode(requestData.packageName)}" +
                    "&webDomain=${Uri.encode(requestData.webDomain ?: "")}"
                )
                putExtra("autofill_request", true)
                putExtra("caller_package", requestData.packageName)
                putExtra("caller_domain", requestData.webDomain)
            }

            val flags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                PendingIntent.FLAG_CANCEL_CURRENT or PendingIntent.FLAG_MUTABLE
            } else {
                PendingIntent.FLAG_CANCEL_CURRENT
            }

            // Use a unique request code per invocation to prevent canceling a prior
            // PendingIntent when the user taps multiple fields in quick succession.
            val requestCode = pendingIntentCounter.getAndIncrement()

            val pendingIntent = PendingIntent.getActivity(
                this,
                requestCode,
                intent,
                flags
            )

            val remoteViews = RemoteViews(this.packageName, R.layout.autofill_presentation).apply {
                setTextViewText(R.id.autofill_title, "VaultPeer")
            }

            var inlinePresentation: InlinePresentation? = null
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                inlinePresentation = try {
                    val inlineSuggestionsRequest = request.inlineSuggestionsRequest
                    if (inlineSuggestionsRequest != null) {
                        val specs = inlineSuggestionsRequest.inlinePresentationSpecs
                        if (specs.isNotEmpty()) {
                            createInlinePresentation(specs[0], pendingIntent)
                        } else null
                    } else null
                } catch (e: Exception) {
                    // Samsung One UI keyboards can provide malformed InlinePresentationSpecs
                    // that cause crashes. Gracefully fall back to dropdown-only presentation.
                    android.util.Log.w(TAG, "Failed to create inline presentation, falling back to dropdown", e)
                    null
                }
            }

            val datasetBuilder = Dataset.Builder()
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R && inlinePresentation != null) {
                if (requestData.usernameId != null) {
                    datasetBuilder.setValue(requestData.usernameId, null, remoteViews, inlinePresentation)
                }
                if (requestData.passwordId != null) {
                    datasetBuilder.setValue(requestData.passwordId, null, remoteViews, inlinePresentation)
                }
                if (requestData.focusedId != null && requestData.focusedId != requestData.usernameId && requestData.focusedId != requestData.passwordId) {
                    datasetBuilder.setValue(requestData.focusedId, null, remoteViews, inlinePresentation)
                }
            } else {
                if (requestData.usernameId != null) {
                    datasetBuilder.setValue(requestData.usernameId, null, remoteViews)
                }
                if (requestData.passwordId != null) {
                    datasetBuilder.setValue(requestData.passwordId, null, remoteViews)
                }
                if (requestData.focusedId != null && requestData.focusedId != requestData.usernameId && requestData.focusedId != requestData.passwordId) {
                    datasetBuilder.setValue(requestData.focusedId, null, remoteViews)
                }
            }

            datasetBuilder.setAuthentication(pendingIntent.intentSender)

            val dataset = try {
                datasetBuilder.build()
            } catch (e: Exception) {
                android.util.Log.e(TAG, "Failed to build autofill dataset", e)
                callback.onSuccess(null)
                return
            }

            val responseBuilder = FillResponse.Builder()
                .addDataset(dataset)

            if (requestData.passwordId != null) {
                val saveInfoBuilder = SaveInfo.Builder(
                    SaveInfo.SAVE_DATA_TYPE_PASSWORD,
                    arrayOf(requestData.passwordId)
                )
                val optionalIds = requestData.allInputIds.filter { it != requestData.passwordId }
                if (optionalIds.isNotEmpty()) {
                    saveInfoBuilder.setOptionalIds(optionalIds.toTypedArray())
                }
                responseBuilder.setSaveInfo(saveInfoBuilder.build())
            } else if (requestData.usernameId != null) {
                val saveInfoBuilder = SaveInfo.Builder(
                    SaveInfo.SAVE_DATA_TYPE_USERNAME,
                    arrayOf(requestData.usernameId)
                )
                val optionalIds = requestData.allInputIds.filter { it != requestData.usernameId }
                if (optionalIds.isNotEmpty()) {
                    saveInfoBuilder.setOptionalIds(optionalIds.toTypedArray())
                }
                responseBuilder.setSaveInfo(saveInfoBuilder.build())
            }

            callback.onSuccess(responseBuilder.build())
        } else {
            callback.onSuccess(null)
        }
    }

    private fun createInlinePresentation(
        spec: InlinePresentationSpec,
        pendingIntent: PendingIntent
    ): InlinePresentation? {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) return null
        try {
            val contentBuilder = InlineSuggestionUi.newContentBuilder(pendingIntent)
            contentBuilder.setTitle("VaultPeer")
            
            try {
                val appIconId = resources.getIdentifier("ic_launcher", "mipmap", packageName)
                if (appIconId != 0) {
                    val icon = android.graphics.drawable.Icon.createWithResource(packageName, appIconId)
                    contentBuilder.setStartIcon(icon)
                }
            } catch (e: Exception) {
                android.util.Log.w(TAG, "Could not load app launcher icon", e)
            }
            
            val content = contentBuilder.build()
            return InlinePresentation(content.slice, spec, false)
        } catch (e: Exception) {
            android.util.Log.e(TAG, "Error creating inline presentation", e)
            return null
        }
    }

    private class AutofillSaveData(
        val username: String = "",
        val password: String = "",
        val packageName: String = "",
        val domain: String? = null
    )

    private fun traverseStructureForSave(structure: AssistStructure): AutofillSaveData {
        var webDomain: String? = null
        var usernameVal = ""
        var passwordVal = ""
        val packageName = structure.activityComponent?.packageName ?: ""

        var passwordId: AutofillId? = null
        val inputNodes = mutableListOf<AssistStructure.ViewNode>()

        for (i in 0 until structure.windowNodeCount) {
            val windowNode = structure.getWindowNodeAt(i)
            val rootNode = windowNode.rootViewNode ?: continue
            traverseNodeIterative(rootNode) { node ->
                val idEntry = node.idEntry?.lowercase()
                val hintText = node.hint?.toString()?.lowercase()
                val className = node.className
                val hints = node.autofillHints
                val inputType = node.inputType
                val autofillType = node.autofillType

                if (node.webDomain != null) {
                    webDomain = node.webDomain
                }

                // Collect all input fields
                val isEditText = (className != null && className.contains("EditText", ignoreCase = true)) ||
                                 autofillType == View.AUTOFILL_TYPE_TEXT
                if (isEditText) {
                    inputNodes.add(node)
                }

                if (hints != null) {
                    for (hint in hints) {
                        if (hint.equals(View.AUTOFILL_HINT_PASSWORD, ignoreCase = true)) {
                            passwordId = node.autofillId
                            val txt = node.text?.toString() ?: ""
                            if (txt.isNotEmpty()) passwordVal = txt
                        } else if (hint.equals(View.AUTOFILL_HINT_USERNAME, ignoreCase = true) ||
                                   hint.equals(View.AUTOFILL_HINT_EMAIL_ADDRESS, ignoreCase = true)) {
                            val txt = node.text?.toString() ?: ""
                            if (txt.isNotEmpty()) usernameVal = txt
                        }
                    }
                }

                // HTML attributes
                val htmlInfo = node.htmlInfo
                if (htmlInfo != null) {
                    val attrs = htmlInfo.attributes
                    if (attrs != null) {
                        var isPasswordHtml = false
                        var isUsernameHtml = false
                        for (pair in attrs) {
                            val key = pair.first?.lowercase()
                            val value = pair.second?.lowercase()
                            if (key == "type" && value == "password") {
                                isPasswordHtml = true
                            }
                            if (value != null && (value.contains("password") || value.contains("pass"))) {
                                if (key == "name" || key == "id" || key == "placeholder" || key == "autocomplete") {
                                    isPasswordHtml = true
                                }
                            }
                            if (value != null && (value.contains("username") || value.contains("email") || value.contains("login") || value.contains("usr"))) {
                                if (key == "name" || key == "id" || key == "placeholder" || key == "autocomplete") {
                                    isUsernameHtml = true
                                }
                            }
                        }
                        if (isPasswordHtml) {
                            passwordId = node.autofillId
                            val txt = node.text?.toString() ?: ""
                            if (txt.isNotEmpty()) passwordVal = txt
                        }
                        if (isUsernameHtml) {
                            val txt = node.text?.toString() ?: ""
                            if (txt.isNotEmpty()) usernameVal = txt
                        }
                    }
                }

                if (className != null && className.contains("EditText", ignoreCase = true)) {
                    if ((idEntry?.contains("password") == true || idEntry?.contains("pass") == true || hintText?.contains("password") == true || hintText?.contains("pass") == true)) {
                        passwordId = node.autofillId
                        val txt = node.text?.toString() ?: ""
                        if (txt.isNotEmpty()) passwordVal = txt
                    }
                    if ((idEntry?.contains("username") == true || idEntry?.contains("email") == true || idEntry?.contains("login") == true || hintText?.contains("username") == true || hintText?.contains("email") == true || hintText?.contains("login") == true)) {
                        val txt = node.text?.toString() ?: ""
                        if (txt.isNotEmpty()) usernameVal = txt
                    }
                }
            }
        }

        // Apply inputType fallback heuristic if password field wasn't matched explicitly or value is empty
        if (passwordVal.isEmpty()) {
            for (node in inputNodes) {
                if (isPasswordInputType(node.inputType)) {
                    val txt = node.text?.toString() ?: ""
                    if (txt.isNotEmpty()) {
                        passwordVal = txt
                        passwordId = node.autofillId
                        break
                    }
                }
            }
        }

        // Apply proximity fallback heuristic for username (closest preceding non-password field)
        if (passwordId != null && usernameVal.isEmpty()) {
            val passwordIndex = inputNodes.indexOfFirst { it.autofillId == passwordId }
            if (passwordIndex > 0) {
                for (j in (passwordIndex - 1) downTo 0) {
                    val prevNode = inputNodes[j]
                    if (!isPasswordInputType(prevNode.inputType)) {
                        val txt = prevNode.text?.toString() ?: ""
                        if (txt.isNotEmpty()) {
                            usernameVal = txt
                            break
                        }
                    }
                }
            }
        }

        // Absolute fallback
        if (passwordVal.isEmpty()) {
            for (node in inputNodes) {
                if (isPasswordInputType(node.inputType)) {
                    passwordVal = node.text?.toString() ?: ""
                }
            }
        }
        if (usernameVal.isEmpty()) {
            for (node in inputNodes) {
                if (!isPasswordInputType(node.inputType)) {
                    val txt = node.text?.toString() ?: ""
                    if (txt.isNotEmpty()) {
                        usernameVal = txt
                        break
                    }
                }
            }
        }

        android.util.Log.d(TAG, "traverseStructureForSave Done: domain=$webDomain, hasUsername=${usernameVal.isNotEmpty()}, hasPassword=${passwordVal.isNotEmpty()}")
        return AutofillSaveData(
            username = usernameVal,
            password = passwordVal,
            packageName = packageName,
            domain = webDomain
        )
    }

    override fun onSaveRequest(request: SaveRequest, callback: SaveCallback) {
        try {
            onSaveRequestInternal(request, callback)
        } catch (e: Exception) {
            android.util.Log.e(TAG, "FATAL: Unhandled exception in onSaveRequest", e)
            try {
                callback.onSuccess()
            } catch (callbackError: Exception) {
                android.util.Log.e(TAG, "Failed to send success after error in onSaveRequest", callbackError)
            }
        }
    }

    private fun onSaveRequestInternal(request: SaveRequest, callback: SaveCallback) {
        val contexts = request.fillContexts
        if (contexts.isEmpty()) {
            callback.onSuccess()
            return
        }

        val structure = contexts[contexts.size - 1].structure
        val savePayload = traverseStructureForSave(structure)

        android.util.Log.d(TAG, "onSaveRequest: hasUsername=${savePayload.username.isNotEmpty()}, hasPassword=${savePayload.password.isNotEmpty()}, package=${savePayload.packageName}, domain=${savePayload.domain}")

        if (savePayload.password.isNotEmpty()) {
            // Trigger deep link to our save screen
            val uri = Uri.parse("vaultpeermobile://autofill-save").buildUpon()
                .appendQueryParameter("username", savePayload.username)
                .appendQueryParameter("password", savePayload.password)
                .appendQueryParameter("packageName", savePayload.packageName)
                .appendQueryParameter("domain", savePayload.domain ?: "")
                .build()

            val intent = Intent(this, AutofillTrampolineActivity::class.java).apply {
                action = Intent.ACTION_VIEW
                data = uri
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            startActivity(intent)
        }

        callback.onSuccess()
    }

    private class AutofillRequestData(
        val packageName: String,
        val webDomain: String?,
        val usernameId: AutofillId?,
        val passwordId: AutofillId?,
        val focusedId: AutofillId?,
        val isFocusedNodeNonCredential: Boolean,
        val isFocusedNodeCredential: Boolean,
        val allInputIds: List<AutofillId>
    )

    private fun traverseStructure(structure: AssistStructure): AutofillRequestData {
        var webDomain: String? = null
        var usernameId: AutofillId? = null
        var passwordId: AutofillId? = null
        var focusedId: AutofillId? = null
        var isFocusedNodeNonCredential = false
        var isFocusedNodeCredential = false
        var focusedNode: AssistStructure.ViewNode? = null
        val packageName = structure.activityComponent?.packageName ?: ""

        android.util.Log.d(TAG, "Traversing AssistStructure for package: $packageName, windowCount: ${structure.windowNodeCount}")

        val inputNodes = mutableListOf<AssistStructure.ViewNode>()

        for (i in 0 until structure.windowNodeCount) {
            val windowNode = structure.getWindowNodeAt(i)
            val rootNode = windowNode.rootViewNode ?: continue
            traverseNodeIterative(rootNode) { node ->
                val idEntry = node.idEntry?.lowercase()
                val hintText = node.hint?.toString()?.lowercase()
                val className = node.className
                val hints = node.autofillHints
                val inputType = node.inputType
                val autofillType = node.autofillType

                if (node.webDomain != null) {
                    webDomain = node.webDomain
                }

                // Respect importantForAutofill=no on individual nodes
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    val importance = node.importantForAutofill
                    if (importance == View.IMPORTANT_FOR_AUTOFILL_NO ||
                        importance == View.IMPORTANT_FOR_AUTOFILL_NO_EXCLUDE_DESCENDANTS) {
                        // Skip this node entirely — the app explicitly opted it out
                        return@traverseNodeIterative
                    }
                }

                if (node.isFocused) {
                    focusedId = node.autofillId
                    focusedNode = node
                    isFocusedNodeNonCredential = isNonCredentialField(node, packageName)
                }

                // Collect all input fields
                val isEditText = (className != null && className.contains("EditText", ignoreCase = true)) ||
                                 autofillType == View.AUTOFILL_TYPE_TEXT
                if (isEditText) {
                    inputNodes.add(node)
                }

                if (hints != null) {
                    for (hint in hints) {
                        if (hint.equals(View.AUTOFILL_HINT_PASSWORD, ignoreCase = true)) {
                            passwordId = node.autofillId
                        } else if (hint.equals(View.AUTOFILL_HINT_USERNAME, ignoreCase = true) ||
                                   hint.equals(View.AUTOFILL_HINT_EMAIL_ADDRESS, ignoreCase = true)) {
                            usernameId = node.autofillId
                        }
                    }
                }

                // Parse HTML info if available (critical for WebViews/browsers)
                val htmlInfo = node.htmlInfo
                if (htmlInfo != null) {
                    val attrs = htmlInfo.attributes
                    if (attrs != null) {
                        var isPasswordHtml = false
                        var isUsernameHtml = false
                        for (pair in attrs) {
                            val key = pair.first?.lowercase()
                            val value = pair.second?.lowercase()
                            if (key == "type" && value == "password") {
                                  isPasswordHtml = true
                            }
                            if (value != null && (value.contains("password") || value.contains("pass"))) {
                                if (key == "name" || key == "id" || key == "placeholder" || key == "autocomplete") {
                                    isPasswordHtml = true
                                }
                            }
                            if (value != null && (value.contains("username") || value.contains("email") || value.contains("login") || value.contains("usr"))) {
                                if (key == "name" || key == "id" || key == "placeholder" || key == "autocomplete") {
                                    isUsernameHtml = true
                                }
                            }
                        }
                        if (isPasswordHtml && passwordId == null) {
                            passwordId = node.autofillId
                        }
                        if (isUsernameHtml && usernameId == null) {
                            usernameId = node.autofillId
                        }
                    }
                }

                if (className != null && className.contains("EditText", ignoreCase = true)) {
                    if (passwordId == null && (idEntry?.contains("password") == true || idEntry?.contains("pass") == true || hintText?.contains("password") == true || hintText?.contains("pass") == true)) {
                        passwordId = node.autofillId
                    }
                    if (usernameId == null && (idEntry?.contains("username") == true || idEntry?.contains("email") == true || idEntry?.contains("login") == true || hintText?.contains("username") == true || hintText?.contains("email") == true || hintText?.contains("login") == true)) {
                        usernameId = node.autofillId
                    }
                }
            }
        }

        // Apply inputType fallback heuristic if password field wasn't matched explicitly
        if (passwordId == null) {
            for (node in inputNodes) {
                if (isPasswordInputType(node.inputType)) {
                    passwordId = node.autofillId
                    break
                }
            }
        }

        // Apply proximity fallback heuristic for username (closest preceding non-password field)
        if (passwordId != null && usernameId == null) {
            val passwordIndex = inputNodes.indexOfFirst { it.autofillId == passwordId }
            if (passwordIndex > 0) {
                for (j in (passwordIndex - 1) downTo 0) {
                    val prevNode = inputNodes[j]
                    if (!isPasswordInputType(prevNode.inputType)) {
                        usernameId = prevNode.autofillId
                        break
                    }
                }
            }
        }

        // Determine if the focused node itself has credential signals.
        // This is used as a fallback trigger when no credential fields were found
        // on the page (e.g., single-field login forms or when the user taps a
        // credential field before the full form is parsed).
        if (focusedNode != null && !isFocusedNodeNonCredential) {
            isFocusedNodeCredential = isCredentialField(focusedNode!!, packageName)
        }

        android.util.Log.d(TAG, "Traverse Done: domain=$webDomain, usernameId=$usernameId, passwordId=$passwordId, focusedId=$focusedId, isFocusedNonCredential=$isFocusedNodeNonCredential, isFocusedCredential=$isFocusedNodeCredential, inputNodes=${inputNodes.size}")
        val allInputIds = inputNodes.mapNotNull { it.autofillId }
        return AutofillRequestData(packageName, webDomain, usernameId, passwordId, focusedId, isFocusedNodeNonCredential, isFocusedNodeCredential, allInputIds)
    }

    private fun isNonCredentialField(node: AssistStructure.ViewNode, packageName: String): Boolean {
        val inputType = node.inputType
        val classType = inputType and android.text.InputType.TYPE_MASK_CLASS
        val variation = inputType and android.text.InputType.TYPE_MASK_VARIATION
        val flags = inputType and android.text.InputType.TYPE_MASK_FLAGS

        // 1. Check if it's a known chat/messaging package
        val chatPackages = setOf(
            "com.whatsapp",
            "org.telegram.messenger",
            "org.thunderdog.challegram",
            "com.facebook.orca",
            "com.facebook.mlite",
            "org.thoughtcrime.securesms", // Signal
            "com.slack",
            "com.discord",
            "com.viber.voip",
            "com.tencent.mm", // WeChat
            "com.skype.raider",
            "com.microsoft.teams",
            "com.snapchat.android",
            "com.instagram.android",
            "jp.naver.line.android"
        )
        
        if (chatPackages.contains(packageName)) {
            // In messaging apps, default to non-credential for focused fields unless it's explicitly a password field
            return !isPasswordInputType(inputType)
        }

        // 2. Check InputType flags for multiline text
        if (classType == android.text.InputType.TYPE_CLASS_TEXT &&
            (flags and android.text.InputType.TYPE_TEXT_FLAG_MULTI_LINE) != 0) {
            return true
        }

        // 3. Check InputType variations for chat messages, filters, search, URI
        if (classType == android.text.InputType.TYPE_CLASS_TEXT) {
            if (variation == android.text.InputType.TYPE_TEXT_VARIATION_SHORT_MESSAGE ||
                variation == android.text.InputType.TYPE_TEXT_VARIATION_LONG_MESSAGE ||
                variation == android.text.InputType.TYPE_TEXT_VARIATION_FILTER ||
                variation == android.text.InputType.TYPE_TEXT_VARIATION_EMAIL_SUBJECT ||
                variation == android.text.InputType.TYPE_TEXT_VARIATION_URI) {
                return true
            }
        }

        // 4. Non-text input classes are never credentials
        if (classType == android.text.InputType.TYPE_CLASS_PHONE ||
            classType == android.text.InputType.TYPE_CLASS_DATETIME) {
            return true
        }

        // 5. Check resource IDs, hints, or text values for non-credential keywords
        val idEntry = node.idEntry?.lowercase()
        val hintText = node.hint?.toString()?.lowercase()
        val textVal = node.text?.toString()?.lowercase()

        val nonCredentialKeywords = arrayOf(
            "message", "chat", "search", "query", "filter", "find", "comment",
            "tweet", "post", "body", "note", "editor", "compose", "textinput",
            "reply", "status", "feedback", "description", "search_src_text",
            "search_bar", "search_button", "url", "url_bar", "address",
            "address_bar", "omnibox", "location_bar", "toolbar", "navigation",
            "caption", "title", "subject", "name_prefix", "name_suffix",
            "phone", "tel", "fax", "zip", "postal", "city", "state", "country",
            "street", "apt", "suite", "region", "province"
        )

        for (keyword in nonCredentialKeywords) {
            if (idEntry?.contains(keyword) == true || hintText?.contains(keyword) == true) {
                return true
            }
        }

        // 6. Check autofillHints for non-credential types
        val hints = node.autofillHints
        if (hints != null) {
            val nonCredentialHints = setOf(
                View.AUTOFILL_HINT_PHONE,
                View.AUTOFILL_HINT_NAME,
                View.AUTOFILL_HINT_POSTAL_ADDRESS,
                View.AUTOFILL_HINT_POSTAL_CODE,
                View.AUTOFILL_HINT_CREDIT_CARD_NUMBER,
                View.AUTOFILL_HINT_CREDIT_CARD_EXPIRATION_DATE,
                View.AUTOFILL_HINT_CREDIT_CARD_SECURITY_CODE
            )
            for (hint in hints) {
                if (nonCredentialHints.contains(hint)) {
                    return true
                }
            }
        }

        return false
    }

    /**
     * Positive check: does this field look like a credential input?
     * Used as the fallback trigger when no credential fields were found on the page.
     * Must have strong credential signals to avoid false positives on search bars etc.
     */
    private fun isCredentialField(node: AssistStructure.ViewNode, packageName: String): Boolean {
        val inputType = node.inputType

        // 1. Password input type is a strong signal
        if (isPasswordInputType(inputType)) {
            return true
        }

        // 2. Autofill hints explicitly declare credential intent
        val hints = node.autofillHints
        if (hints != null) {
            for (hint in hints) {
                if (hint.equals(View.AUTOFILL_HINT_PASSWORD, ignoreCase = true) ||
                    hint.equals(View.AUTOFILL_HINT_USERNAME, ignoreCase = true) ||
                    hint.equals(View.AUTOFILL_HINT_EMAIL_ADDRESS, ignoreCase = true)) {
                    return true
                }
            }
        }

        // 3. HTML attributes indicate credential field
        val htmlInfo = node.htmlInfo
        if (htmlInfo != null) {
            val attrs = htmlInfo.attributes
            if (attrs != null) {
                for (pair in attrs) {
                    val key = pair.first?.lowercase()
                    val value = pair.second?.lowercase()
                    if (key == "type" && value == "password") {
                        return true
                    }
                    if (key == "autocomplete" && value != null) {
                        if (value.contains("password") || value.contains("username") ||
                            value == "current-password" || value == "new-password") {
                            return true
                        }
                    }
                    if (value != null && (key == "name" || key == "id")) {
                        if (value.contains("password") || value.contains("passwd") ||
                            value.contains("pass") || value.contains("login") ||
                            value.contains("signin") || value.contains("credential")) {
                            return true
                        }
                    }
                }
            }
        }

        // 4. Resource ID or hint text with credential keywords
        val idEntry = node.idEntry?.lowercase()
        val hintText = node.hint?.toString()?.lowercase()

        val credentialKeywords = arrayOf(
            "password", "passwd", "pass_word", "passwort",
            "username", "user_name", "userid", "user_id",
            "login", "signin", "sign_in", "credential",
            "email", "e_mail"
        )

        for (keyword in credentialKeywords) {
            if (idEntry?.contains(keyword) == true || hintText?.contains(keyword) == true) {
                return true
            }
        }

        return false
    }

    private fun isPasswordInputType(inputType: Int): Boolean {
        val variation = inputType and android.text.InputType.TYPE_MASK_VARIATION
        val classType = inputType and android.text.InputType.TYPE_MASK_CLASS
        return classType == android.text.InputType.TYPE_CLASS_TEXT && (
            variation == android.text.InputType.TYPE_TEXT_VARIATION_PASSWORD ||
            variation == android.text.InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD ||
            variation == android.text.InputType.TYPE_TEXT_VARIATION_WEB_PASSWORD
        ) || classType == android.text.InputType.TYPE_CLASS_NUMBER && (
            variation == android.text.InputType.TYPE_NUMBER_VARIATION_PASSWORD
        )
    }

    /**
     * Iterative (stack-based) traversal of the AssistStructure view tree.
     *
     * This replaces the previous recursive traverseNode() implementation which
     * could cause StackOverflowError on deeply nested view trees — particularly
     * Chrome WebViews on Samsung One UI devices where the tree can easily exceed
     * 200+ levels deep due to Shadow DOM, nested iframes, and Samsung's own
     * accessibility injection layer.
     *
     * A StackOverflowError in the autofill service (which runs in system_server
     * process context) triggers the system watchdog and causes a full device reboot.
     *
     * We also cap the total number of visited nodes at MAX_NODE_VISIT_COUNT to
     * prevent the traversal from taking too long on extremely large pages.
     */
    private fun traverseNodeIterative(
        root: AssistStructure.ViewNode,
        action: (AssistStructure.ViewNode) -> Unit
    ) {
        val stack = ArrayDeque<AssistStructure.ViewNode>()
        stack.push(root)
        var visitCount = 0

        while (stack.isNotEmpty()) {
            if (visitCount >= MAX_NODE_VISIT_COUNT) {
                android.util.Log.w(TAG, "Node visit limit reached ($MAX_NODE_VISIT_COUNT). Stopping traversal early.")
                break
            }

            val node = stack.pop()
            visitCount++

            try {
                action(node)
            } catch (e: Exception) {
                // Don't let a single bad node crash the entire traversal
                android.util.Log.w(TAG, "Error processing node: ${e.message}")
                continue
            }

            // Push children in reverse order so left-most children are processed first
            val childCount = node.childCount
            for (i in (childCount - 1) downTo 0) {
                try {
                    val child = node.getChildAt(i)
                    if (child != null) {
                        stack.push(child)
                    }
                } catch (e: Exception) {
                    android.util.Log.w(TAG, "Error accessing child node at index $i: ${e.message}")
                }
            }
        }
    }
}
