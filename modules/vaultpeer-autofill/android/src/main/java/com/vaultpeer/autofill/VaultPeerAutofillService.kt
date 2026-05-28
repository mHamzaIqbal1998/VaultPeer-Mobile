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

class ActiveAutofillRequest(
    val packageName: String,
    val webDomain: String?,
    val usernameId: AutofillId?,
    val passwordId: AutofillId?,
    val focusedId: AutofillId?,
    val callback: FillCallback?
)

class VaultPeerAutofillService : AutofillService() {

    override fun onFillRequest(
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
            android.util.Log.d("VaultPeerAutofill", "Ignoring fill request for our own application")
            callback.onSuccess(null)
            return
        }

        if (requestData.usernameId != null || requestData.passwordId != null || requestData.focusedId != null) {
            // Store the request info statically so the native module can retrieve it
            activeRequest = ActiveAutofillRequest(
                packageName = requestData.packageName,
                webDomain = requestData.webDomain,
                usernameId = requestData.usernameId,
                passwordId = requestData.passwordId,
                focusedId = requestData.focusedId,
                callback = callback
            )

            // Start AutofillTrampolineActivity to authenticate/unlock/select
            val intent = Intent(this, AutofillTrampolineActivity::class.java).apply {
                action = Intent.ACTION_VIEW
                data = Uri.parse("vaultpeermobile://autofill?packageName=${Uri.encode(requestData.packageName)}&webDomain=${Uri.encode(requestData.webDomain ?: "")}")
                putExtra("autofill_request", true)
                putExtra("caller_package", requestData.packageName)
                putExtra("caller_domain", requestData.webDomain)
            }

            val flags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                PendingIntent.FLAG_CANCEL_CURRENT or PendingIntent.FLAG_MUTABLE
            } else {
                PendingIntent.FLAG_CANCEL_CURRENT
            }

            val pendingIntent = PendingIntent.getActivity(
                this,
                1001,
                intent,
                flags
            )

            val remoteViews = RemoteViews(this.packageName, R.layout.autofill_presentation).apply {
                setTextViewText(R.id.autofill_title, "VaultPeer")
            }

            var inlinePresentation: InlinePresentation? = null
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                val inlineSuggestionsRequest = request.inlineSuggestionsRequest
                if (inlineSuggestionsRequest != null) {
                    val specs = inlineSuggestionsRequest.inlinePresentationSpecs
                    if (specs.isNotEmpty()) {
                        inlinePresentation = createInlinePresentation(specs[0], pendingIntent)
                    }
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
            val dataset = datasetBuilder.build()

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
                android.util.Log.w("VaultPeerAutofill", "Could not load app launcher icon", e)
            }
            
            val content = contentBuilder.build()
            return InlinePresentation(content.slice, spec, false)
        } catch (e: Exception) {
            android.util.Log.e("VaultPeerAutofill", "Error creating inline presentation", e)
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
        val packageName = structure.activityComponent.packageName

        var passwordId: AutofillId? = null
        val inputNodes = mutableListOf<AssistStructure.ViewNode>()

        for (i in 0 until structure.windowNodeCount) {
            val windowNode = structure.getWindowNodeAt(i)
            val rootNode = windowNode.rootViewNode
            if (rootNode != null) {
                traverseNode(rootNode) { node ->
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

        // Absolute fallback: if we have any inputs and couldn't match username/password specifically:
        // Assume the first one with text is username (if not password type) and the second is password (if password type).
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

        android.util.Log.d("VaultPeerAutofill", "traverseStructureForSave Done: domain=$webDomain, username=$usernameVal, password=$passwordVal")
        return AutofillSaveData(
            username = usernameVal,
            password = passwordVal,
            packageName = packageName,
            domain = webDomain
        )
    }

    override fun onSaveRequest(request: SaveRequest, callback: SaveCallback) {
        val contexts = request.fillContexts
        if (contexts.isEmpty()) {
            callback.onSuccess()
            return
        }

        val structure = contexts[contexts.size - 1].structure
        val savePayload = traverseStructureForSave(structure)

        android.util.Log.d("VaultPeerAutofill", "onSaveRequest: username=${savePayload.username}, password=${savePayload.password}, package=${savePayload.packageName}, domain=${savePayload.domain}")

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
        val allInputIds: List<AutofillId>
    )

    private fun traverseStructure(structure: AssistStructure): AutofillRequestData {
        var webDomain: String? = null
        var usernameId: AutofillId? = null
        var passwordId: AutofillId? = null
        var focusedId: AutofillId? = null
        val packageName = structure.activityComponent.packageName

        android.util.Log.d("VaultPeerAutofill", "Traversing AssistStructure for package: $packageName")

        val inputNodes = mutableListOf<AssistStructure.ViewNode>()

        for (i in 0 until structure.windowNodeCount) {
            val windowNode = structure.getWindowNodeAt(i)
            val rootNode = windowNode.rootViewNode
            if (rootNode != null) {
                traverseNode(rootNode) { node ->
                    val idEntry = node.idEntry?.lowercase()
                    val hintText = node.hint?.toString()?.lowercase()
                    val className = node.className
                    val hints = node.autofillHints
                    val inputType = node.inputType
                    val autofillType = node.autofillType

                    android.util.Log.d("VaultPeerAutofill", "Node: class=$className, idEntry=$idEntry, hint=$hintText, autofillId=${node.autofillId}, hints=${hints?.joinToString()}, inputType=$inputType, autofillType=$autofillType")

                    if (node.webDomain != null) {
                        webDomain = node.webDomain
                        android.util.Log.d("VaultPeerAutofill", "Found Web Domain: $webDomain")
                    }

                    if (node.isFocused) {
                        focusedId = node.autofillId
                        android.util.Log.d("VaultPeerAutofill", "Found Focused Node: $focusedId")
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
                                android.util.Log.d("VaultPeerAutofill", "Matched PasswordId by hint: $passwordId")
                            } else if (hint.equals(View.AUTOFILL_HINT_USERNAME, ignoreCase = true) ||
                                       hint.equals(View.AUTOFILL_HINT_EMAIL_ADDRESS, ignoreCase = true)) {
                                usernameId = node.autofillId
                                android.util.Log.d("VaultPeerAutofill", "Matched UsernameId by hint: $usernameId")
                            }
                        }
                    }

                    // Parse HTML info if available (critical for WebViews/browsers)
                    val htmlInfo = node.htmlInfo
                    if (htmlInfo != null) {
                        val tag = htmlInfo.tag
                        val attrs = htmlInfo.attributes
                        android.util.Log.d("VaultPeerAutofill", "HTML Tag: $tag, Attributes Count: ${attrs?.size ?: 0}")
                        if (attrs != null) {
                            var isPasswordHtml = false
                            var isUsernameHtml = false
                            for (pair in attrs) {
                                val key = pair.first?.lowercase()
                                val value = pair.second?.lowercase()
                                android.util.Log.d("VaultPeerAutofill", "HTML Attr: $key = $value")
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
                                android.util.Log.d("VaultPeerAutofill", "Matched PasswordId by HTML attribute: $passwordId")
                            }
                            if (isUsernameHtml && usernameId == null) {
                                usernameId = node.autofillId
                                android.util.Log.d("VaultPeerAutofill", "Matched UsernameId by HTML attribute: $usernameId")
                            }
                        }
                    }

                    if (className != null && className.contains("EditText", ignoreCase = true)) {
                        if (passwordId == null && (idEntry?.contains("password") == true || idEntry?.contains("pass") == true || hintText?.contains("password") == true || hintText?.contains("pass") == true)) {
                            passwordId = node.autofillId
                            android.util.Log.d("VaultPeerAutofill", "Matched PasswordId by ID/Hint text: $passwordId")
                        }
                        if (usernameId == null && (idEntry?.contains("username") == true || idEntry?.contains("email") == true || idEntry?.contains("login") == true || hintText?.contains("username") == true || hintText?.contains("email") == true || hintText?.contains("login") == true)) {
                            usernameId = node.autofillId
                            android.util.Log.d("VaultPeerAutofill", "Matched UsernameId by ID/Hint text: $usernameId")
                        }
                    }
                }
            }
        }

        // Apply inputType fallback heuristic if password field wasn't matched explicitly
        if (passwordId == null) {
            for (node in inputNodes) {
                if (isPasswordInputType(node.inputType)) {
                    passwordId = node.autofillId
                    android.util.Log.d("VaultPeerAutofill", "Matched PasswordId by inputType heuristic: $passwordId")
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
                        android.util.Log.d("VaultPeerAutofill", "Matched UsernameId by proximity heuristic: $usernameId")
                        break
                    }
                }
            }
        }

        android.util.Log.d("VaultPeerAutofill", "Traverse Done: domain=$webDomain, usernameId=$usernameId, passwordId=$passwordId, focusedId=$focusedId")
        val allInputIds = inputNodes.mapNotNull { it.autofillId }
        return AutofillRequestData(packageName, webDomain, usernameId, passwordId, focusedId, allInputIds)
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

    private fun traverseNode(node: AssistStructure.ViewNode, action: (AssistStructure.ViewNode) -> Unit) {
        action(node)
        for (i in 0 until node.childCount) {
            val child = node.getChildAt(i)
            if (child != null) {
                traverseNode(child, action)
            }
        }
    }

    companion object {
        var activeRequest: ActiveAutofillRequest? = null
    }
}
