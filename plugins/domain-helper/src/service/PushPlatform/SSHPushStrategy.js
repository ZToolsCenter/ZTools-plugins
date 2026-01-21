import {IPushStrategy} from './IPushStrategy.js';
import {randomString} from "@/utils/tool";

const NodeSSH = preload.nodeSSH.NodeSSH;
const path = preload.path;
const fs = preload.fs;
const os = preload.os;

export class SSHPushStrategy extends IPushStrategy {
    constructor() {
        super();
        this.ssh = new NodeSSH();
    }

    async validate(config) {
        try {
            await this.ssh.connect({
                host: config.host,
                port: config.port || 22,
                username: config.username,
                password: config.password,
                privateKey: config.privateKey
            });
            return true;
        } catch (error) {
            throw new Error(`SSH连接验证失败: ${error.message}`);
        }
    }

    async push(config, certData, oncall = null) {
        try {
            // 连接服务器
            await this.validate(config);
            oncall && oncall('connected', {msg: '连接服务器成功 🎉'});
            const sftp = await this.ssh.requestSFTP();


            // 执行前置命令
            if (config.beforePushCommand) {
                oncall && oncall('beforePushCommand', {msg: '开始执行命令'});
                await this.ssh.execCommand(config.beforePushCommand);
                oncall && oncall('afterPushCommand', {msg: '命令执行成功 🎉'});
            }

            oncall && oncall('beforePush', {msg: '开始推送证书文件'});
            try {
                await this.writeContentToFile(sftp, certData.cert, config.certPath);
                await this.writeContentToFile(sftp, certData.key, config.keyPath);
                oncall && oncall('afterPush', {msg: '证书文件推送成功 🎉'});
            } catch (error) {
                oncall && oncall('error', {msg: "证书sftp推送失败，尝试其他方式推送"});
                
                // 使用SSH命令行方式推送证书
                try {
                    oncall && oncall('beforeAlternativePush', {msg: '开始使用SSH命令行方式推送证书'});
                    await this.pushViaSSHCommand(certData.cert, config.certPath);
                    await this.pushViaSSHCommand(certData.key, config.keyPath);
                    oncall && oncall('afterAlternativePush', {msg: '通过SSH命令行推送证书成功 🎉'});
                } catch (cmdError) {
                    oncall && oncall('error', {msg: `SSH命令行推送失败: ${cmdError.message}`});
                    throw cmdError; // 重新抛出错误以便外部捕获
                }
            }

            // 执行重启命令
            if (config.restartCommand) {
                oncall && oncall('beforeCommand', {msg: '开始执行命令'});
                await this.ssh.execCommand(config.restartCommand);
                oncall && oncall('afterCommand', {msg: '命令执行成功 🎉'});
            }
            oncall && oncall('success',  {msg: '证书推送完成 🎉'});
            await this.ssh.dispose();
            return true;
        } catch (error) {
            console.error('SSHPushStrategy push error:', error);
            oncall && oncall('error', {msg: error.toString()});
            throw new Error(`推送失败: ${error.message}`);
        }
    }

    writeContentToFile(sftp, content, path) {
        console.log("sftp 推送")
        return new Promise((resolve, reject) => {
            sftp.writeFile(path, content, (err) => {
                if (err) {
                    return reject(err);
                }
                resolve();
            });
        });
    }
    
    async pushViaSSHCommand(content, remotePath) {
        try {
            console.log("SSH命令行推送");
            
            // 使用基本Shell命令创建并写入内容到远程文件
            const escapedContent = content.replace(/'/g, "'\\''"); // 转义单引号以防止命令注入
            
            // 方法1：直接尝试写入到目标路径
            try {
                // 确保目标目录存在
                await this.ssh.execCommand(`mkdir -p "$(dirname '${remotePath}')"`);
                
                // 直接写入到目标路径
                const writeResult = await this.ssh.execCommand(`cat > '${remotePath}' << 'EOL'\n${escapedContent}\nEOL`);
                
                if (writeResult.stderr) {
                    console.log("直接写入失败，尝试备选方法:", writeResult.stderr);
                    throw new Error(writeResult.stderr);
                }
                
                // 设置文件权限
                await this.ssh.execCommand(`chmod 600 '${remotePath}'`);
                return true;
            } catch (directWriteError) {
                console.log("直接写入失败，尝试备选方法:", directWriteError);
                
                // 方法2：尝试在目标目录创建临时文件
                try {
                    // 提取目标文件所在目录
                    const targetDir = await this.ssh.execCommand(`dirname '${remotePath}'`);
                    const dirPath = targetDir.stdout.trim();
                    
                    // 在目标目录下创建临时文件
                    const tmpFileName = `temp_cert_${randomString(8)}`;
                    const tmpFilePath = `${dirPath}/${tmpFileName}`;
                    
                    // 写入临时文件
                    const tmpWriteResult = await this.ssh.execCommand(`cat > '${tmpFilePath}' << 'EOL'\n${escapedContent}\nEOL`);
                    
                    if (tmpWriteResult.stderr) {
                        console.log("临时文件写入失败:", tmpWriteResult.stderr);
                        throw new Error(tmpWriteResult.stderr);
                    }
                    
                    // 移动临时文件到目标位置
                    await this.ssh.execCommand(`mv '${tmpFilePath}' '${remotePath}'`);
                    
                    // 设置文件权限
                    await this.ssh.execCommand(`chmod 600 '${remotePath}'`);
                    return true;
                } catch (tempFileError) {
                    console.log("临时文件写入失败:", tempFileError);
                    
                    // 方法3：使用家目录作为临时存储
                    const homeDir = await this.ssh.execCommand('echo $HOME');
                    const homePath = homeDir.stdout.trim();
                    const homeTmpFile = `${homePath}/temp_cert_${randomString(8)}`;
                    
                    // 写入家目录临时文件
                    const homeWriteResult = await this.ssh.execCommand(`cat > '${homeTmpFile}' << 'EOL'\n${escapedContent}\nEOL`);
                    
                    if (homeWriteResult.stderr) {
                        throw new Error(`所有写入方法失败，最后错误: ${homeWriteResult.stderr}`);
                    }
                    
                    // 确保目标目录存在
                    await this.ssh.execCommand(`mkdir -p "$(dirname '${remotePath}')"`);
                    
                    // 移动临时文件到目标位置
                    await this.ssh.execCommand(`mv '${homeTmpFile}' '${remotePath}'`);
                    
                    // 设置文件权限
                    await this.ssh.execCommand(`chmod 600 '${remotePath}'`);
                    return true;
                }
            }
        } catch (error) {
            console.error('SSH命令行推送失败:', error);
            throw new Error(`SSH命令行推送失败: ${error.message}`);
        }
    }
} 