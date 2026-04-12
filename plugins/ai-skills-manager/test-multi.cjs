const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const SKILLS_DIR = process.env.USERPROFILE 
  ? path.join(process.env.USERPROFILE, '.gemini', 'antigravity', 'skills')
  : path.join(process.env.HOME || '/', '.gemini', 'antigravity', 'skills');

const REGISTRY_FILE = path.join(SKILLS_DIR, 'registry.json');
global.window = {};
const preloadCode = fs.readFileSync(path.join(__dirname, 'preload.js'), 'utf-8');
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
function getPathForAgent(agent) {
  const home = process.env.USERPROFILE || process.env.HOME || '/';
  switch (agent) {
    case 'antigravity': return path.join(home, '.gemini', 'antigravity', 'skills');
    default: return agent;
  }
}
function ensureRegistry() {}
eval(preloadCode);

const realTestUrl = 'https://github.com/obra/pua';
// We don't have this in registry right now for updateSkill, we will test installSkill.
window.preloadAPI.installSkill(realTestUrl, ['antigravity'], (prog) => {
    console.log(prog.text.trim());
}).then(() => {
    console.log("INSTALL MULTI-REPO SUCCESS!");
}).catch(err => {
    console.error("INSTALL MULTI-REPO FAILED:", err.message);
});
