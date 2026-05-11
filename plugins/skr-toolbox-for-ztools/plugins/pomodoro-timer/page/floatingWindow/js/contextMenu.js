class contextMenu{
    constructor(){
        this.menu = document.createElement('div');
        this.menu.className = 'contextMenu';
        this.menu.style.display = 'none';
        this.menu.style.position = 'fixed';
        this.menu.style.zIndex = '1000';
        document.body.appendChild(this.menu);
        this.menu.addEventListener('click', (e) => {
            e.stopPropagation();
        });
        document.body.addEventListener('click', () => {
            this.hide();
        });
    }
    show(x, y){
        this.menu.style.display = 'block';
        this.menu.style.left = x + 'px';
        this.menu.style.top = y + 'px';
        console.log('show');
    }
    hide(){
        this.menu.style.display = 'none';
    }
    addOption(text, callback){
        let option = document.createElement('div');
        option.className = 'contextMenuOption';
        option.innerHTML = text;
        option.addEventListener('click', callback);
        this.menu.appendChild(option);
    }
    clear(){
        this.menu.innerHTML = '';
    }
}

