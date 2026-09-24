const electron = require("electron");

async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

window.ztools.onPluginEnter((param) => {
    const interval = setInterval(async () => {
        console.log('开始检查')
        
        const lanFrom = document.querySelector('.lanFrom-container');
        if (lanFrom) {
            const tabBody = document.querySelector('.tab-body');
            // 停止继续检测
            clearInterval(interval);

            console.log('开始添加样式')
            // 给 .tab-body 添加样式
            Object.assign(tabBody.style, {
                width: '100vw',
                position: 'fixed',
                zIndex: '999',
                top: 0,
                left: 0,
                bottom: 0,
                right: 0,
                'overflow-y': 'auto',
                'border-radius': 0
            });

            // 给 body 添加样式
            Object.assign(document.body.style, {
                width: '100%',
                overflow: 'hidden'
            });

            console.log('param', param)
            if(!param.payload){
                return
            }

            const clearBtn = document.querySelector('.clearBtn')
            if(clearBtn){
                const clearBtnRect = clearBtn.getBoundingClientRect()
                // await window.ztools.sendMouseEvent('mouseDown',clearBtnRect.x + (clearBtnRect.width / 2), clearBtnRect.y + (clearBtnRect.height / 2),'left')
                await window.ztools.sendInputEvent({
                    type: 'mouseDown',
                    x: clearBtnRect.x + (clearBtnRect.width / 2),
                    y: clearBtnRect.y + (clearBtnRect.height / 2),
                    button: 'left',
                    clickCount: 1
                  })
                await sleep(100)
                // await window.ztools.sendMouseEvent('mouseUp',clearBtnRect.x + (clearBtnRect.width / 2), clearBtnRect.y + (clearBtnRect.height / 2),'left')
                await window.ztools.sendInputEvent({
                    type: 'mouseUp',
                    x: clearBtnRect.x + (clearBtnRect.width / 2),
                    y: clearBtnRect.y + (clearBtnRect.height / 2),
                    button: 'left',
                    clickCount: 1
                  })
            }

            await sleep(100)

            const inputFanyi = document.getElementById('js_fanyi_input')
            const inputFanyiRect = inputFanyi.getBoundingClientRect()
            // await window.ztools.sendMouseEvent('mouseDown',inputFanyiRect.x + (inputFanyiRect.width / 2), inputFanyiRect.y + (inputFanyiRect.height / 2),'left')
            await window.ztools.sendInputEvent({
                type: 'mouseDown',
                x: inputFanyiRect.x + (inputFanyiRect.width / 2),
                y: inputFanyiRect.y + (inputFanyiRect.height / 2),
                button: 'left',
                clickCount: 1
              })
            await sleep(100)
            // await window.ztools.sendMouseEvent('mouseUp',inputFanyiRect.x + (inputFanyiRect.width / 2), inputFanyiRect.y + (inputFanyiRect.height / 2),'left')
            await window.ztools.sendInputEvent({
                type: 'mouseUp',
                x: inputFanyiRect.x + (inputFanyiRect.width / 2),
                y: inputFanyiRect.y + (inputFanyiRect.height / 2),
                button: 'left',
                clickCount: 1
              })
            await sleep(100)
            for (const char of param.payload) {
                // await window.ztools.sendKeyEvent('char',char)
                await window.ztools.sendInputEvent({
                    type: 'char',
                    keyCode: char
                  })
                sleep(50)
            }
            console.log('✅ tab-body 样式已应用');
        }
    }, 200);
})