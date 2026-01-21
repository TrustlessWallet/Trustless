const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const BUILD_PATH = 'src/constants/build.json';
const TEMPLATE_PATH = '../constants/release-template.json'; // Relative to this script

try {
  // ---------------------------------------------------------
  // SCENARIO 1: We are in a Git Repository (Dev / Clone)
  // ---------------------------------------------------------
  
  // 1. Get the commit hash
  let commitHash = execSync('git rev-parse --short HEAD').toString().trim();
  
  // 2. DIRTY CHECK: Check for uncommitted changes
  // This protects you from releasing a binary that doesn't match the commit
  const status = execSync('git status --porcelain').toString().trim();
  if (status) {
    commitHash += '-dirty';
    console.warn('⚠️  WARNING: You are building with uncommitted changes!');
  }

  const buildDate = new Date().toISOString();
  writeBuildFile(commitHash, buildDate);

} catch (error) {
  // ---------------------------------------------------------
  // SCENARIO 2: We are in a ZIP Download (No .git folder)
  // ---------------------------------------------------------
  
  try {
    // Read the template file which might have been modified by 'export-subst'
    const template = require(TEMPLATE_PATH);
    
    // Check if Git actually replaced the placeholder
    // If the file still says "$Format:%h$", it means we are in a weird state (not a zip, not a repo)
    const isReplaced = !template.commitHash.startsWith('$Format:');

    if (isReplaced) {
      console.log('📦 Git repository not found. Using ZIP archive info.');
      writeBuildFile(template.commitHash, template.buildDate);
    } else {
      throw new Error('No version info found');
    }

  } catch (fallbackError) {
    // ---------------------------------------------------------
    // SCENARIO 3: Total Failure (Raw download, no git)
    // ---------------------------------------------------------
    console.error('❌ Failed to verify build version. Defaulting to DEV-BUILD.');
    writeBuildFile('DEV-BUILD', new Date().toISOString());
  }
}

function writeBuildFile(commitHash, buildDate) {
  const buildInfo = { commitHash, buildDate };
  fs.writeFileSync(
    BUILD_PATH, 
    JSON.stringify(buildInfo, null, 2)
  );
  console.log(`✅ Build info updated: ${commitHash}`);
}