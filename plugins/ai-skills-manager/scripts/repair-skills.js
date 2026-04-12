const fs = require('fs');
const path = require('path');

/**
 * 动态修复脚本 - 独立运行版
 */

const SKILLS_DIR = process.env.USERPROFILE 
  ? path.join(process.env.USERPROFILE, '.gemini', 'antigravity', 'skills')
  : path.join(process.env.HOME || '/', '.gemini', 'antigravity', 'skills');

const REGISTRY_FILE = path.join(SKILLS_DIR, 'registry.json');
const AGENTS = ['antigravity', 'claudecode', 'openclaw', 'qoder', 'qwencode', 'trae'];

function getPathForAgent(agent) {
  const home = process.env.USERPROFILE || process.env.HOME || '/';
  switch (agent) {
    case 'antigravity': return path.join(home, '.gemini', 'antigravity', 'skills');
    case 'claudecode': return path.join(home, '.claude', 'skills');
    case 'openclaw': return path.join(home, 'skills');
    case 'qoder': return path.join(home, '.qoder', 'skills');
    case 'qwencode': return path.join(home, '.qwen', 'skills');
    case 'trae': return path.join(home, '.trae', 'skills');
    default: return agent;
  }
}

function runRepair() {
    console.log('--- Starting Dynamic Skill Metadata Audit ---');
    if (!fs.existsSync(REGISTRY_FILE)) return;

    let registry = JSON.parse(fs.readFileSync(REGISTRY_FILE, 'utf-8'));
    const globalKnowledge = {}; 
    let changed = false;

    // 1. 发现知识
    for (const agent of AGENTS) {
        try {
            const p = getPathForAgent(agent);
            if (!fs.existsSync(p)) continue;
            const dirs = fs.readdirSync(p, { withFileTypes: true });
            for (const d of dirs) {
                if (!d.isDirectory()) continue;
                const metaPath = path.join(p, d.name, 'metadata.json');
                if (fs.existsSync(metaPath)) {
                    try {
                        const m = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
                        if (m.source_url && m.source_url !== '本地/未托管') {
                            globalKnowledge[d.name] = m.source_url;
                        }
                    } catch(e) {}
                }
            }
        } catch(e) {}
    }

    // 2. 修复
    for (const skill of registry) {
        if (!fs.existsSync(skill.localPath)) continue;
        const metaPath = path.join(skill.localPath, 'metadata.json');
        
        if (!skill.sourceUrl || skill.sourceUrl === '本地/未托管') {
            if (globalKnowledge[skill.name]) {
                skill.sourceUrl = globalKnowledge[skill.name];
                changed = true;
                console.log(`[Borrowed] ${skill.name} source found in other agent: ${skill.sourceUrl}`);
            } else {
                const mdPath = path.join(skill.localPath, 'SKILL.md');
                if (fs.existsSync(mdPath)) {
                    const content = fs.readFileSync(mdPath, 'utf-8');
                    const githubMatch = content.match(/https?:\/\/github\.com\/[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+(\/tree\/[^\s)\]]+)?/);
                    if (githubMatch) {
                        skill.sourceUrl = githubMatch[0].replace(/\/$/, '').replace(/\.git$/, '');
                        changed = true;
                        console.log(`[Extracted] ${skill.name} source found in SKILL.md: ${skill.sourceUrl}`);
                    }
                }
            }
        }

        if (skill.sourceUrl && skill.sourceUrl !== '本地/未托管') {
            const meta = {
                name: skill.name,
                source_url: skill.sourceUrl,
                installed_at: skill.installedAt || new Date().toISOString(),
                type: "git"
            };
            fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));
        }
    }

    if (changed) {
        fs.writeFileSync(REGISTRY_FILE, JSON.stringify(registry, null, 2));
    }
    console.log('--- Audit Finished ---');
}

runRepair();
