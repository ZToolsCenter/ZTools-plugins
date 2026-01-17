class Switch {
    constructor(selector, settingsConfigInstance, configKey, initialState = false) {
        this.element = document.querySelector(selector);
        if (!this.element) {
            throw new Error(`Element not found for selector: ${selector}`);
        }

        this.settingsConfigInstance = settingsConfigInstance;
        this.configKey = configKey;
        this.state = this.settingsConfigInstance.config[this.configKey] ?? initialState;

        this.createSwitch();
        this.render();
        this.bindEvents();
    }

    createSwitch() {
        this.switchContainer = document.createElement('div');
        this.switchContainer.classList.add('switch-container');

        this.switchButton = document.createElement('div');
        this.switchButton.classList.add('switch-button');

        this.switchContainer.appendChild(this.switchButton);
        this.element.appendChild(this.switchContainer);
    }

    render() {
        if (this.state) {
            this.switchContainer.classList.add('on');
        } else {
            this.switchContainer.classList.remove('on');
        }
    }

    bindEvents() {
        this.switchContainer.addEventListener('click', () => {
            this.toggle();
        });
    }

    toggle() {
        this.state = !this.state;
        this.updateConfig(); // 更新关联配置
        this.render();
        this.dispatchEvent();
    }

    updateConfig() {
        // 更新 `settingsConfig` 实例中的配置
        this.settingsConfigInstance.updateConfig(this.configKey, this.state);
    }

    dispatchEvent() {
        const event = new CustomEvent('switchChange', {
            detail: {
                state: this.state,
                config: this.settingsConfigInstance.config,
            },
        });
        this.element.dispatchEvent(event);
    }

    getState() {
        return this.state;
    }

    setState(state) {
        this.state = state;
        this.updateConfig(); // 更新关联配置
        this.render();
    }
}




