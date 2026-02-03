const { withMainActivity } = require('@expo/config-plugins');

const withAndroidDisplaySettings = (config) => {
  return withMainActivity(config, async (config) => {
    let contents = config.modResults.contents;

    const imports = [
      'import android.content.Context',
      'import android.content.res.Configuration',
      'import android.os.Build',
      'import android.util.DisplayMetrics',
      'import android.os.Bundle',
      'import android.view.View',
    ];

    imports.forEach((importLine) => {
      if (!contents.includes(importLine)) {
        contents = contents.replace(
          'import com.facebook.react.ReactActivity',
          `${importLine}\nimport com.facebook.react.ReactActivity`
        );
      }
    });

    const attachBaseContextCode = `
  override fun attachBaseContext(newBase: Context) {
    val configuration = Configuration(newBase.resources.configuration)
    configuration.fontScale = 1.0f
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
      configuration.densityDpi = DisplayMetrics.DENSITY_DEVICE_STABLE
    }
    val context = newBase.createConfigurationContext(configuration)
    super.attachBaseContext(context)
  }
`;

    if (!contents.includes('attachBaseContext')) {
      const lastBraceIndex = contents.lastIndexOf('}');
      contents =
        contents.substring(0, lastBraceIndex) +
        attachBaseContextCode +
        contents.substring(lastBraceIndex);
    }

    const privacyLogic = `
  override fun onPause() {
    super.onPause()
    // Hide content to show window background (Splash Theme)
    findViewById<View>(android.R.id.content)?.alpha = 0f
  }

  override fun onResume() {
    super.onResume()
    // Restore content visibility
    findViewById<View>(android.R.id.content)?.alpha = 1f
  }
`;

    if (!contents.includes('override fun onPause()')) {
      const lastBraceIndex = contents.lastIndexOf('}');
      contents =
        contents.substring(0, lastBraceIndex) +
        privacyLogic +
        contents.substring(lastBraceIndex);
    }

    config.modResults.contents = contents;
    return config;
  });
};

module.exports = withAndroidDisplaySettings;