export interface GitHubRepoInfo {
  owner: string
  repo: string
  defaultBranch: string
}

export function parseGitHubUrl(url: string): GitHubRepoInfo | null {
  const trimmed = url.trim()
  const fullMatch = trimmed.match(
    /^(?:https?:\/\/)?(?:www\.)?github\.com\/([^/]+)\/([^/]+?)(?:\/|$)/
  )
  if (fullMatch) {
    return {
      owner: fullMatch[1],
      repo: fullMatch[2].replace(/\.git$/, ''),
      defaultBranch: 'main',
    }
  }
  const shortMatch = trimmed.match(/^([^/]+)\/([^/]+?)$/)
  if (shortMatch) {
    return {
      owner: shortMatch[1],
      repo: shortMatch[2].replace(/\.git$/, ''),
      defaultBranch: 'main',
    }
  }
  return null
}


export async function fetchGitHubFile(
  owner: string,
  repo: string,
  path: string,
  branch = 'main'
): Promise<string> {
  const branches = [branch, 'main', 'master']
  const tried = new Set<string>()
  for (const b of branches) {
    if (tried.has(b)) continue
    tried.add(b)
    const url = `https://raw.githubusercontent.com/${owner}/${repo}/${b}/${path.split('/').map(encodeURIComponent).join('/')}`
    try {
      const resp = await fetch(url, { headers: { 'User-Agent': 'skill-hub' } })
      if (resp.ok) return resp.text()
    } catch {}
  }
  throw new Error(`获取文件失败: ${path}`)
}

export async function fetchGitHubRepoTree(
  owner: string,
  repo: string,
  branch = 'main',
  token?: string
): Promise<{ path: string; type: 'blob' | 'tree' }[]> {
  const branches = [branch, 'main', 'master']
  const tried = new Set<string>()
  for (const b of branches) {
    if (tried.has(b)) continue
    tried.add(b)
    const url = `https://api.github.com/repos/${owner}/${repo}/git/trees/${b}?recursive=1`
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github.v3+json',
      'User-Agent': 'skill-hub',
    }
    if (token) headers.Authorization = `Bearer ${token}`

    const resp = await fetch(url, { headers })
    if (resp.ok) {
      const data = await resp.json()
      return data.tree || []
    }
    if (resp.status === 403) throw new Error('GitHub API 速率限制，请在设置中添加 Token 提升额度')
    if (resp.status === 404) continue
    throw new Error(`获取仓库树失败: ${resp.status}`)
  }
  throw new Error(`仓库或分支未找到: ${owner}/${repo}`)
}

export const SKILL_MANIFEST_FILES = ['SKILL.md', 'skill.json', 'skill.yaml', 'skill.yml']

export function detectSkillDirectories(
  tree: { path: string; type: 'blob' | 'tree' }[]
): { dir: string; manifestFile: string }[] {
  const manifestFiles = tree.filter(
    (item) =>
      item.type === 'blob' && SKILL_MANIFEST_FILES.includes(item.path.split('/').pop() || '')
  )

  const dirSet = new Set<string>()
  for (const mf of manifestFiles) {
    const dir = mf.path.split('/').slice(0, -1).join('/') || '.'
    dirSet.add(dir)
  }

  const rootManifests = manifestFiles.filter((mf) => {
    const parts = mf.path.split('/')
    return parts.length === 1
  })

  return Array.from(dirSet).map((dir) => {
    const dirManifest = manifestFiles.find((mf) => {
      if (dir === '.') return mf.path.split('/').length === 1
      const parts = mf.path.split('/')
      return parts.length === dir.split('/').length + 1 && mf.path.startsWith(dir + '/')
    })
    return {
      dir,
      manifestFile: dirManifest ? dirManifest.path : (rootManifests[0]?.path || ''),
    }
  })
}
