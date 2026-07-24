import download from 'downloadjs';
import { v4 as uuid } from 'uuid';
import { defineStore } from 'pinia';
import { namespace } from './useProjectStores';
import useTemplateStore from './useTemplateStore';
import { cloneDeep, replace } from 'lodash';
import usePreferencesStore from '@/composables/usePreferencesStore';
import { translate } from '@/i18n/messages';

async function saveTextFile(text, filename, locale) {
    if (window.services?.writeTextFile) {
        const filePath = await window.services.writeTextFile(text, filename);
        window.ztools?.showNotification?.(
            translate(locale, 'notification.savedFile', { file: filename })
        );
        return filePath;
    }

    return download(text, filename);
}

export default function (id) {
    return defineStore(id, {
        state: () => ({
            version: '1.26.1',
            modified: false,
            page: {},
            settings: {},
            viewport: {
                x: 0,
                y: -150,
                zoom: 1,
            },
            tab: {
                order: 0,
                name: null,
                created_at: new Date(),
                id: replace(id, namespace, ''),
            },
        }),

        actions: {
            /**
             * Get a clone of the project.
             *
             * @returns {*}
             */
            clone() {
                const clone = cloneDeep(this.$state);

                clone.tab.id = uuid();

                return clone;
            },

            /**
             * Export the project into a JSON config file.
             */
            export() {
                const state = this.clone();
                const preferences = usePreferencesStore();

                const name =
                    state.tab.name ||
                    translate(preferences.uiLocale, 'placeholder.defaultProjectName');

                void saveTextFile(
                    JSON.stringify(state, null, 2),
                    `${name}.json`,
                    preferences.uiLocale
                );
            },

            /**
             * Save the project as a template.
             */
            saveAsTemplate() {
                const templates = useTemplateStore();

                const project = this.clone();

                project.tab.created_at = new Date();

                const preferences = usePreferencesStore();

                project.tab.name =
                    project.tab.name ||
                    translate(preferences.uiLocale, 'placeholder.defaultProjectName');

                templates.add(project);
            },
        },

        persist: {
            key: id,
            storage: import.meta.client ? localStorage : undefined,
        },
    });
}
