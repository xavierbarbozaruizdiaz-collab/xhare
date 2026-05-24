/**
 * Alinea autolinking.json con applicationId de android/app/build.gradle (evita com.xhare.app stale).
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const gradlePath = path.join(root, 'android', 'app', 'build.gradle');
const autolinkPath = path.join(root, 'android', 'build', 'generated', 'autolinking', 'autolinking.json');

if (!fs.existsSync(gradlePath) || !fs.existsSync(autolinkPath)) {
  process.exit(0);
}

const gradle = fs.readFileSync(gradlePath, 'utf8');
const match = gradle.match(/applicationId\s+'([^']+)'/);
if (!match) {
  console.warn('[sync-autolinking-package] No applicationId en build.gradle');
  process.exit(0);
}

const applicationId = match[1];
const json = JSON.parse(fs.readFileSync(autolinkPath, 'utf8'));
if (!json.project) json.project = {};
if (!json.project.android) json.project.android = {};
const prev = json.project.android.packageName;
json.project.android.packageName = applicationId;
fs.writeFileSync(autolinkPath, JSON.stringify(json));
if (prev !== applicationId) {
  console.log(`[sync-autolinking-package] ${prev} → ${applicationId}`);
}
