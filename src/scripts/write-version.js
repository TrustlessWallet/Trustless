const fs = require('fs');
const { execSync } = require('child_process');

try {
  const commitHash = execSync('git rev-parse --short HEAD').toString().trim();
  const buildDate = new Date().toISOString();
  
  const buildInfo = {
    commitHash,
    buildDate,
  };

  fs.writeFileSync(
    'src/constants/build.json', 
    JSON.stringify(buildInfo, null, 2)
  );
  
  console.log(`✅ Build info updated: ${commitHash}`);
} catch (error) {
  console.error('❌ Failed to write build info', error);

  fs.writeFileSync(
    'src/constants/build.json', 
    JSON.stringify({ commitHash: 'DEV-BUILD', buildDate: new Date().toISOString() }, null, 2)
  );
}