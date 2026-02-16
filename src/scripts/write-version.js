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
  const status = execSync('git status --porcelain').toString().trim();
  if (status) {
    commitHash += '-dirty';
    console.warn('⚠️  WARNING: You are building with uncommitted changes! This will break reproducibility.');
  }

  // 3. Get the commit date (Fixed timestamp for reproducibility)
  // Using %cI (ISO 8601 committer date) ensures every builder gets the same string
  const buildDate = execSync('git log -1 --format=%cI').toString().trim();
  
  writeBuildFile(commitHash, buildDate);

} catch (error) {
  // ---------------------------------------------------------
  // SCENARIO 2: We are in a ZIP Download (No .git folder)
  // ---------------------------------------------------------
  
  try {
    const template = require(TEMPLATE_PATH);
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
    
    // Note: This will still break reproducibility but allows the app to compile locally.
    console.error('❌ Failed to verify build version. Defaulting to DEV-BUILD.');
    writeBuildFile('DEV-BUILD', "1970-01-01T00:00:00Z"); 
  }
}

function writeBuildFile(commitHash, buildDate) {
  const buildInfo = { commitHash, buildDate };
  fs.writeFileSync(
    BUILD_PATH, 
    JSON.stringify(buildInfo, null, 2)
  );
  console.log(`✅ Build info updated: ${commitHash} (${buildDate})`);
}