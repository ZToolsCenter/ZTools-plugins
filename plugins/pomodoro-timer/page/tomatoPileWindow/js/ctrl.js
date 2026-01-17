
window.ipcRenderer.on('exce', (event, message) => {
    // console.log(message);

    switch (message.type) {
        case 'tomataFalling':
            tomataFalling(message.content.x,message.content.y + 20, message.content.progress)
            break;

        case 'stopFlag':

            if (message.content){ 
                pauseRunner();
                newRender_.clearAllCanvases();
            } else if(!isRunning){
                resumeRunner();
                newRender_.drawAllCanvases();
            }
            break;
        case 'totalTomatoNum':
            totalTomatoNum(message.content);
            break;

    }

});