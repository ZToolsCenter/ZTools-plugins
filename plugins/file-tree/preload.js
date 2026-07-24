const fs = require('fs');
const path = require('path');

window.services = {
    scanDirectory: (dirPath, showHidden = false, shouldIgnore = null) => {
        try {
            console.log('开始扫描目录:', dirPath);
            
            function scan(currentPath) {
                try {
                    const stats = fs.statSync(currentPath);
                    const name = path.basename(currentPath);
                    
                    if (!showHidden && name.startsWith('.')) {
                        return null;
                    }
                    
                    if (shouldIgnore && shouldIgnore(name)) {
                        return null;
                    }
                    
                    const node = {
                        name: name,
                        comment: '',
                        children: []
                    };

                    if (stats.isDirectory()) {
                        const files = fs.readdirSync(currentPath);
                        
                        const validFiles = files
                            .filter(file => showHidden || !file.startsWith('.'))
                            .filter(file => !shouldIgnore || !shouldIgnore(file))
                            .sort((a, b) => {
                                const aPath = path.join(currentPath, a);
                                const bPath = path.join(currentPath, b);
                                const aIsDir = fs.statSync(aPath).isDirectory();
                                const bIsDir = fs.statSync(bPath).isDirectory();
                                
                                if (aIsDir && !bIsDir) return -1;
                                if (!aIsDir && bIsDir) return 1;
                                return a.localeCompare(b);
                            });
                        
                        validFiles.forEach(file => {
                            const filePath = path.join(currentPath, file);
                            const childNode = scan(filePath);
                            if (childNode) {
                                node.children.push(childNode);
                            }
                        });
                    }

                    return node;
                } catch (error) {
                    console.error(`扫描路径失败 ${currentPath}:`, error);
                    return null;
                }
            }

            const result = scan(dirPath);
            console.log('扫描完成，结果:', result);
            return result;
            
        } catch (error) {
            console.error('扫描目录失败:', error);
            return null;
        }
    },
    
    // 添加文件保存功能
    saveFile: (filePath, arrayBuffer) => {
        try {
            fs.writeFileSync(filePath, arrayBuffer);
            return true;
        } catch (error) {
            console.error('写入文件失败:', error);
            return false;
        }
    },
    
    // 获取路径的基础名称
    getBasename: (filepath) => {
        return path.basename(filepath);
    }
}; 