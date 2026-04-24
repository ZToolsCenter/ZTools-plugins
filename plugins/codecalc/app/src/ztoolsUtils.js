import {
    isDarkColors,
    isZtoolsEnv,
    onMainPush,
    onPluginEnter,
    onPluginOut,
    onThemeChange,
    pasteText
} from './host.js';

const Calculator = window.CodeCalcCore.Calculator;
let hasHandledPluginOut = false;

function isBase64(str) {
    str = str.trim();
    return /^(?=(?:.*[A-Za-z]){3,})(?:[A-Za-z0-9+\/]{4}){3,}(?:[A-Za-z0-9+\/]{2}==|[A-Za-z0-9+\/]{3}=)?$/.test(str);
}

function handleRegexInput(code, payload) {
    let expr = payload.trim();

    if (code === 'quickcalc') {
        if (isBase64(expr)) {
            expr = 'str(' + expr + ').unbase64';
        } else if (expr.endsWith('=')) {
            expr = expr.substring(0, expr.length - 1);
        }
    } else if (code === 'timestamp') {
        if (!expr.startsWith('@')) {
            expr = '@' + expr;
        }
        expr = expr.replace(/\//g, '-');
    }

    return expr;
}

function setTheme(isDark) {
    document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
}

function shouldPersistOnPluginOut(processExited) {
    return processExited === true;
}

function handlePluginOut(processExited) {
    if (hasHandledPluginOut) return;

    const historyToggle = document.getElementById('historyToggle');
    const keepHistory = historyToggle ? historyToggle.checked : true;

    if (!keepHistory) {
        hasHandledPluginOut = true;
        clearAll();
        return;
    }

    if (shouldPersistOnPluginOut(processExited)) {
        hasHandledPluginOut = true;
        clearAll();
    }
}

setTheme(isDarkColors());

onThemeChange((matches) => {
    setTheme(matches);
});

if (isZtoolsEnv) {
    onPluginEnter(({ code, type, payload }) => {
        const inputs = document.querySelectorAll('.input');
        const lastInput = inputs[inputs.length - 1];

        if (type === 'regex') {
            const expr = handleRegexInput(code, payload);

            if (lastInput.value.trim() !== '') {
                addNewLine();
                const newInputs = document.querySelectorAll('.input');
                const newLastInput = newInputs[newInputs.length - 1];
                newLastInput.value = expr;
                newLastInput.dispatchEvent(new Event('input'));
            } else {
                lastInput.value = expr;
                lastInput.dispatchEvent(new Event('input'));
            }
        } else {
            lastInput.focus();
        }
    });

    onPluginOut((processExited) => {
        handlePluginOut(processExited);
    });

    onMainPush(
        ({ code, type, payload }) => {
            if (type === 'regex') {
                let value = '';
                const expr = handleRegexInput(code, payload);
                let title = '点击复制结果';

                try {
                    const rslt = Calculator.calculate(expr);
                    value = rslt.value;
                    if (code === 'timestamp') {
                        title = rslt.info;
                    }
                } catch (error) {
                    value = 'error: ' + error.message;
                }

                return [
                    {
                        icon: 'logo-equal.png',
                        text: value.toString(),
                        title
                    }
                ];
            }
        },
        ({ option }) => {
            void pasteText(option?.text);
            return false;
        }
    );
}
