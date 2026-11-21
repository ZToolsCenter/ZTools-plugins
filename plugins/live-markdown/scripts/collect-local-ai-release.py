"""Collect pinned upstream artifacts and per-file hashes for release review.

All writes stay in this plugin's ignored cache. This is a maintainer tool, never
part of the distributed plugin. It does not execute downloaded programs.
"""
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import hashlib
import json
import tarfile
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / '.cache' / 'local-ai-release'
TAG = 'b11793'
TARGETS = {
    'darwin-arm64': 'macos-arm64.tar.gz',
    'darwin-x64': 'macos-x64.tar.gz',
    'linux-x64': 'ubuntu-x64.tar.gz',
    'linux-arm64': 'ubuntu-arm64.tar.gz',
    'win32-x64': 'win-cpu-x64.zip',
    'win32-arm64': 'win-cpu-arm64.zip',
}


def request(url):
    return urllib.request.urlopen(urllib.request.Request(
        url, headers={'User-Agent': 'LiveMarkdown-release-review'}), timeout=90)


def get_json(url):
    with request(url) as response:
        return json.load(response)


def sha_file(file):
    h = hashlib.sha256()
    while data := file.read(1024 * 1024):
        h.update(data)
    return h.hexdigest()


def collect_runtime(item):
    platform, asset = item
    dest = CACHE / asset['name']
    expected = asset['digest'].removeprefix('sha256:')
    if not dest.exists():
        partial = dest.with_suffix(dest.suffix + '.part')
        with request(asset['browser_download_url']) as response, partial.open('wb') as out:
            while data := response.read(1024 * 1024):
                out.write(data)
        partial.rename(dest)
    with dest.open('rb') as f:
        assert sha_file(f) == expected, asset['name']
    assert dest.stat().st_size == asset['size']
    files, links = [], []
    archive = 'zip' if dest.suffix == '.zip' else 'tar.gz'
    if archive == 'zip':
        with zipfile.ZipFile(dest) as z:
            for member in z.infolist():
                if member.is_dir():
                    continue
                with z.open(member) as f:
                    digest = sha_file(f)
                files.append({'path': member.filename, 'size': member.file_size,
                              'sha256': digest, 'executable': member.filename.endswith('.exe')})
    else:
        with tarfile.open(dest, 'r:gz') as t:
            for member in t:
                if member.issym() or member.islnk():
                    links.append({'path': member.name, 'target': member.linkname})
                    with t.extractfile(member) as f:
                        data = f.read()
                    files.append({'path': member.name, 'size': len(data),
                                  'sha256': hashlib.sha256(data).hexdigest(),
                                  'executable': bool(member.mode & 0o111),
                                  'linkTarget': member.linkname})
                elif member.isfile():
                    with t.extractfile(member) as f:
                        digest = sha_file(f)
                    files.append({'path': member.name, 'size': member.size,
                                  'sha256': digest, 'executable': bool(member.mode & 0o111)})
    entry = next(f['path'] for f in files if f['path'].split('/')[-1] in ('llama-server', 'llama-server.exe'))
    result = {'id': 'llama-' + TAG + '-' + platform, 'version': TAG,
              'url': asset['browser_download_url'], 'sha256': expected, 'size': asset['size'],
              'allowedHosts': ['github.com', 'release-assets.githubusercontent.com', 'objects.githubusercontent.com'],
              'archive': archive, 'files': files, 'entryPoint': entry,
              'backend': 'metal' if platform == 'darwin-arm64' else 'cpu'}
    print(json.dumps({'platform': platform, 'archive': asset['size'], 'files': len(files), 'links': len(links)}), flush=True)
    return platform, result


def collect_model(profile, repo, filename):
    d = get_json('https://huggingface.co/api/models/' + repo + '?blobs=true')
    f = next(f for f in d['siblings'] if f['rfilename'] == filename)
    resource_id = 'qwen3-' + profile + '-q4km'
    return {'id': resource_id, 'version': d['sha'],
            'url': 'https://huggingface.co/' + repo + '/resolve/' + d['sha'] + '/' + filename,
            'sha256': f['lfs']['sha256'], 'size': f['size'], 'archive': 'file',
            'allowedHosts': ['huggingface.co', 'cdn-lfs.huggingface.co', 'cdn-lfs.hf.co',
                             'cdn-lfs-us-1.hf.co', 'cas-bridge.xethub.hf.co',
                             'us.aws.cdn.hf.co', 'cdn-lfs-eu-1.hf.co'],
            'files': [{'path': filename, 'sha256': f['lfs']['sha256'], 'size': f['size']}],
            'entryPoint': filename, 'backend': 'cpu', 'publisher': repo}


def main():
    CACHE.mkdir(parents=True, exist_ok=True)
    release = get_json('https://api.github.com/repos/ggml-org/llama.cpp/releases/tags/' + TAG)
    assets = [(platform, next(a for a in release['assets']
               if a['name'] == 'llama-' + TAG + '-bin-' + suffix))
              for platform, suffix in TARGETS.items()]
    with ThreadPoolExecutor(max_workers=2) as pool:
        runtimes = dict(pool.map(collect_runtime, assets))
    model_specs = [('light', 'unsloth/Qwen3-0.6B-GGUF', 'Qwen3-0.6B-Q4_K_M.gguf'),
                   ('balanced', 'unsloth/Qwen3-1.7B-GGUF', 'Qwen3-1.7B-Q4_K_M.gguf'),
                   ('quality', 'Qwen/Qwen3-4B-GGUF', 'Qwen3-4B-Q4_K_M.gguf')]
    models = {profile: collect_model(profile, repo, filename) for profile, repo, filename in model_specs}
    manifest = {'version': '2026-10-21.1',
                'runtimeByPlatform': {p: r['id'] for p, r in runtimes.items()},
                'modelByProfile': {p: r['id'] for p, r in models.items()},
                'resources': list(runtimes.values()) + list(models.values())}
    (CACHE / 'manifest-candidate.json').write_text(json.dumps(manifest, indent=2) + '\n')
    print(json.dumps({'manifest': str(CACHE / 'manifest-candidate.json'),
                      'models': {p: r['size'] for p, r in models.items()}}), flush=True)


if __name__ == '__main__':
    main()
