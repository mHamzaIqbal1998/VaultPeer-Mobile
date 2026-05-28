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
import android.service.autofill.Dataset
import android.service.autofill.AutofillService
import android.view.View
import android.view.autofill.AutofillId
import android.widget.RemoteViews
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

            val datasetBuilder = Dataset.Builder()
            if (requestData.usernameId != null) {
                datasetBuilder.setValue(requestData.usernameId, null, remoteViews)
            }
            if (requestData.passwordId != null) {
                datasetBuilder.setValue(requestData.passwordId, null, remoteViews)
            }
            if (requestData.focusedId != null && requestData.focusedId != requestData.usernameId && requestData.focusedId != requestData.passwordId) {
                datasetBuilder.setValue(requestData.focusedId, null, remoteViews)
            }

            datasetBuilder.setAuthentication(pendingIntent.intentSender)
            val dataset = datasetBuilder.build()

            val response = FillResponse.Builder()
                .addDataset(dataset)
                .build()

            callback.onSuccess(response)
        } else {
            callback.onSuccess(null)
        }
    }

    override fun onSaveRequest(request: android.service.autofill.SaveRequest, callback: android.service.autofill.SaveCallback) {
        callback.onSuccess()
    }

    private class AutofillRequestData(
        val packageName: String,
        val webDomain: String?,
        val usernameId: AutofillId?,
        val passwordId: AutofillId?,
        val focusedId: AutofillId?
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
        return AutofillRequestData(packageName, webDomain, usernameId, passwordId, focusedId)
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
