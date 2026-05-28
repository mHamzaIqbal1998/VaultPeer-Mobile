const { withAndroidManifest } = require("@expo/config-plugins");

function withVaultPeerAutofill(config) {
  return withAndroidManifest(config, async (config) => {
    const androidManifest = config.modResults;
    const mainApplication = androidManifest.manifest.application[0];

    // Ensure the service is defined
    const services = mainApplication.service || [];
    const hasService = services.some(
      (s) =>
        s.$["android:name"] ===
        "com.vaultpeer.autofill.VaultPeerAutofillService"
    );

    if (!hasService) {
      if (!mainApplication.service) {
        mainApplication.service = [];
      }
      mainApplication.service.push({
        $: {
          "android:name": "com.vaultpeer.autofill.VaultPeerAutofillService",
          "android:label": "VaultPeer Autofill",
          "android:permission": "android.permission.BIND_AUTOFILL_SERVICE",
          "android:exported": "true",
        },
        "intent-filter": [
          {
            action: [
              {
                $: {
                  "android:name": "android.service.autofill.AutofillService",
                },
              },
            ],
          },
        ],
      });
    }

    // Ensure the activity is defined
    const activities = mainApplication.activity || [];
    const hasActivity = activities.some(
      (a) =>
        a.$["android:name"] ===
        "com.vaultpeer.autofill.AutofillTrampolineActivity"
    );

    if (!hasActivity) {
      if (!mainApplication.activity) {
        mainApplication.activity = [];
      }
      mainApplication.activity.push({
        $: {
          "android:name": "com.vaultpeer.autofill.AutofillTrampolineActivity",
          "android:theme": "@android:style/Theme.Translucent.NoTitleBar",
          "android:exported": "true",
          "android:excludeFromRecents": "true",
        },
      });
    }

    return config;
  });
}

module.exports = withVaultPeerAutofill;
