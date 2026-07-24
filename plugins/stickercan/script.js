const style = document.createElement('style');
style.textContent = `
    @keyframes slideInRight {
        from {
            transform: translateX(100%);
            opacity: 0;
        }
        to {
            transform: translateX(0);
            opacity: 1;
        }
    }
    
    @keyframes slideOutRight {
        from {
            transform: translateX(0);
            opacity: 1;
        }
        to {
            transform: translateX(100%);
            opacity: 0;
        }
    }
`;
document.head.appendChild(style);

let emotionManager;

function initUserInfo() {
    const userAvatar = document.getElementById('userAvatar');
    const userNickname = document.getElementById('userNickname');
    
    if (window.ztools) {
        const user = typeof window.ztools.getUser === 'function' ? window.ztools.getUser() : null;
        if (user) {
            userAvatar.src = user.avatar;
            userNickname.textContent = user.nickname;
        } else {
            userNickname.textContent = '未登录';
        }
    } else {
        userNickname.textContent = '表情罐头';
    }
}

document.addEventListener('DOMContentLoaded', () => {
    if (window.ztools) {
        emotionManager = new EmotionManager();
        emotionManager.init();
        initUserInfo();
    } else {
        console.warn('不在ZTools环境中，使用localStorage模拟数据存储');
        
        // 模拟 ZTools
        window.ztools = {
            db: {
                get(key) {
                    const value = localStorage.getItem(key);
                    return value ? JSON.parse(value) : null;
                },
                put(doc) {
                    localStorage.setItem(doc._id, JSON.stringify(doc));
                    return { id: doc._id, rev: Date.now().toString(), ok: true };
                },
                remove(docOrId) {
                    localStorage.removeItem(typeof docOrId === 'string' ? docOrId : docOrId._id);
                    return { ok: true };
                }
            },
            dbStorage: {
                setItem(key, value) {
                    localStorage.setItem('dbStorage:' + key, JSON.stringify(value));
                },
                getItem(key) {
                    const value = localStorage.getItem('dbStorage:' + key);
                    return value ? JSON.parse(value) : null;
                },
                removeItem(key) {
                    localStorage.removeItem('dbStorage:' + key);
                }
            },
            copyImage(imageData) {
                console.log('模拟复制图片:', imageData);
                alert('复制成功！（这是模拟环境）');
            },
            getUser() {
                return null;
            },
            getNativeId() {
                return 'dev-native-id';
            },
            shellOpenExternal(url) {
                window.open(url, '_blank');
            },
            showOpenDialog() {
                const folderPath = prompt('请输入本地存储路径（例如：C:/表情罐头）');
                return folderPath ? [folderPath] : undefined;
            }
        };
        window.ztools.db.promises = window.ztools.db;

        // 模拟 emotionCan API（用于开发调试）
        window.emotionCan = {
            selectFolder: async function() {
                return prompt('请输入本地存储路径（例如：C:/表情罐头）');
            },
            saveFile: async function(fileData, targetPath) {
                console.log('模拟保存文件到:', targetPath);
                return targetPath;
            },
            fileExists: function(filePath) {
                console.log('模拟检查文件存在:', filePath);
                return false;
            },
            getDefaultDir: function() {
                return 'C:/表情罐头';
            }
        };
        
        emotionManager = new EmotionManager();
        emotionManager.init();
        initUserInfo();
    }

    // 添加表情包弹窗的标签页切换
    const sourceTabs = document.querySelectorAll('.source-tab');
    sourceTabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const source = tab.dataset.source;
            
            // 更新标签状态
            sourceTabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            
            // 显示对应内容
            document.querySelectorAll('.source-content').forEach(content => {
                content.style.display = 'none';
            });
            
            if (source === 'url') {
                document.querySelector('.url-source').style.display = 'block';
            } else {
                document.querySelector('.file-source').style.display = 'block';
            }
            
            // 更新添加按钮文本
            if (emotionManager && typeof emotionManager.updateAddEmotionButtonText === 'function') {
                emotionManager.updateAddEmotionButtonText(source);
            }
        });
    });
});

window.emotionManager = emotionManager;
