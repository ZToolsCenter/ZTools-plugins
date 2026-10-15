const path = require('path')

module.exports = {
    id: "remind",
    src: "index.html",
    config:{
        id: 'styleConfig',
        logo: path.resolve(__dirname, '../../assets/images/1.gif'),
        // width: 500,
        // height: 500,
        openLogo: true,
        backgroundColor: '#ffffff',
        color: '#000000',
        fontSize: '28',
        title: '下班！'
    },
    options: {
        width: 500,
        height: 500,
        alwaysOnTop: true,
        transparent: true,
        frame: false,
        resizable: false,
        backgroundColor: "#00000000",
        webPreferences: {
            preload: "preload.js",
            devTools: true,
        }
    }
}