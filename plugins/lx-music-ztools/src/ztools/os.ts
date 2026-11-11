import './contracts'
const env = () => window.lxHost.readSnapshot<any>('host:env')
export const release = () => env().release
export const homedir = () => env().homedir
export const tmpdir = () => env().tmpdir
export const arch = () => env().arch
export const platform = () => env().platform
export const cpus = () => env().cpus
export default { release, homedir, tmpdir, arch, platform, cpus }
