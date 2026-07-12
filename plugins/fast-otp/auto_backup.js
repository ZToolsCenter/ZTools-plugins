function createAutoBackupManager(options) {
    const {
        getConfig,
        enqueueJob,
        createBackup,
        getPayload,
        delayMs = 1000,
    } = options || {};

    if (typeof getConfig !== 'function') throw new Error('[AutoBackup] getConfig is required');
    if (typeof enqueueJob !== 'function') throw new Error('[AutoBackup] enqueueJob is required');
    if (typeof createBackup !== 'function') throw new Error('[AutoBackup] createBackup is required');
    if (typeof getPayload !== 'function') throw new Error('[AutoBackup] getPayload is required');

    const listeners = new Set();
    let timer = null;
    let running = false;
    let queued = false;
    let generation = 0;
    let desiredAt = 0;
    let skipToken = 0;
    let lastEmittedStatus = { running: false, scheduled: false };

    function isEnabled(config) {
        return !config || config.autoBackup !== false;
    }

    function isConfigReady(config) {
        if (!config) return false;
        if (!config.dirUrl || !String(config.dirUrl).trim()) return false;
        if (!config.encryptPassword || !String(config.encryptPassword).trim()) return false;
        return true;
    }

    function getStatus() {
        return {
            running: !!running,
            scheduled: !!timer || !!queued,
        };
    }

    function emitStatusIfChanged() {
        const next = getStatus();
        if (
            next.running === lastEmittedStatus.running &&
            next.scheduled === lastEmittedStatus.scheduled
        ) {
            return;
        }

        lastEmittedStatus = next;
        for (const listener of listeners) {
            try {
                listener(next);
            } catch (e) {
                console.warn('autoBackupStatus listener error:', e);
            }
        }
    }

    function onStatusChange(listener) {
        if (typeof listener !== 'function') return () => {};
        listeners.add(listener);
        try {
            listener(getStatus());
        } catch (e) {
            console.warn('autoBackupStatus listener error:', e);
        }
        return () => {
            listeners.delete(listener);
        };
    }

    function cancel() {
        skipToken += 1;
        desiredAt = 0;

        if (timer) {
            clearTimeout(timer);
            timer = null;
        }

        queued = false;
        emitStatusIfChanged();
    }

    function requestRun() {
        if (running || queued) return;

        const config = getConfig();
        if (!isEnabled(config)) return cancel();
        if (!isConfigReady(config)) return cancel();

        const tokenAtEnqueue = skipToken;
        queued = true;
        emitStatusIfChanged();

        enqueueJob(async () => {
            // 允许在队列等待期间被取消
            if (tokenAtEnqueue !== skipToken) return;

            const cfg = getConfig();
            if (!isEnabled(cfg) || !isConfigReady(cfg)) {
                queued = false;
                emitStatusIfChanged();
                return;
            }

            queued = false;
            running = true;
            emitStatusIfChanged();

            const generationAtStart = generation;
            try {
                const payload = getPayload() || {};
                await createBackup(cfg, payload);
            } catch (e) {
                console.warn('[AutoBackup] failed:', e);
            } finally {
                running = false;
                emitStatusIfChanged();

                // 如果运行期间还有变更，按“最后一次变更 + 1s”的时间再补一次备份
                if (generation > generationAtStart) {
                    armTimer();
                }
            }
        });
    }

    function armTimer() {
        const config = getConfig();
        if (!isEnabled(config)) return cancel();
        if (!isConfigReady(config)) return cancel();

        const delay = Math.max(0, Number(desiredAt) - Date.now());
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
            timer = null;
            emitStatusIfChanged();
            requestRun();
        }, delay);
        emitStatusIfChanged();
    }

    function schedule(reason) {
        const config = getConfig();
        if (!isEnabled(config)) return;
        if (!isConfigReady(config)) return;

        generation += 1;
        desiredAt = Date.now() + delayMs;
        armTimer();
    }

    function syncWithConfig() {
        const config = getConfig();
        if (!isEnabled(config) || !isConfigReady(config)) {
            cancel();
        } else {
            emitStatusIfChanged();
        }
    }

    return {
        getStatus,
        onStatusChange,
        schedule,
        cancel,
        syncWithConfig,
    };
}

module.exports = {
    createAutoBackupManager,
};

