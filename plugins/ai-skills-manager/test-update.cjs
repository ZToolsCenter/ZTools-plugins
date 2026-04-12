const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const SKILLS_DIR = process.env.USERPROFILE 
  ? path.join(process.env.USERPROFILE, '.gemini', 'antigravity', 'skills')
  : path.join(process.env.HOME || '/', '.gemini', 'antigravity', 'skills');

const REGISTRY_FILE = path.join(SKILLS_DIR, 'registry.json');

// Mock DOM
global.window = {};

// Load preload.js
const preloadCode = fs.readFileSync(path.join(__dirname, 'preload.js'), 'utf-8');
// Mock parseGitHubUrl
function parseGitHubUrl(url) {
  if (!url) return { gitUrl: '', subPath: '' };
  let gitUrl = url;
  let subPath = '';

  const gitHubTreeRegex = /^(https?:\/\/github\.com\/[^\/]+\/[^\/]+)\/tree\/[^\/]+\/(.+)$/;
  const match = url.match(gitHubTreeRegex);
  
  if (match) {
    gitUrl = match[1] + '.git';
    subPath = match[2];
  } else if (!url.endsWith('.git') && url.includes('github.com')) {
    gitUrl = url + '.git';
  }

  return { gitUrl, subPath };
}

// Evaluate preload.js (requires careful handling or just copy the logic)
// Since evaluating might be tricky with environment, let's just copy the relevant functions for a standalone test.

eval(preloadCode);

window.preloadAPI.updateSkill("pua", (prog) => {
    console.log(prog.text.trim());
}).then(() => {
    console.log("UPDATE SUCCESS");
}).catch(err => {
    console.error("UPDATE FAILED:", err.message);
});
