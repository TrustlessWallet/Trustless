const fs = require('fs');
const path = require('path');
const { withDangerousMod } = require('@expo/config-plugins');

const withLiquidGlassIcon = (config) => {
  return withDangerousMod(config, [
    'ios',
    async (config) => {
      const projectRoot = config.modRequest.projectRoot;
      const projectName = config.modRequest.projectName;
      
      const sourcePath = path.join(projectRoot, 'assets', 'Trustless.icon');
      const destPath = path.join(projectRoot, 'ios', projectName, 'Images.xcassets', 'AppIcon.appiconset');
      
      if (fs.existsSync(sourcePath)) {
        if (fs.existsSync(destPath)) {
          fs.rmSync(destPath, { recursive: true, force: true });
        }
        // Copies the .icon folder directly into the xcassets bundle
        fs.cpSync(sourcePath, destPath, { recursive: true });
      } else {
        throw new Error(`Trustless.icon not found at ${sourcePath}`);
      }
      return config;
    },
  ]);
};

module.exports = withLiquidGlassIcon;