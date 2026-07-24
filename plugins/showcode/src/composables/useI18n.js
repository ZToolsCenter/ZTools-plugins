import { computed } from 'vue';
import usePreferencesStore from '@/composables/usePreferencesStore';
import { DEFAULT_LOCALE, locales, translate } from '@/i18n/messages';

export default function useI18n() {
    const preferences = usePreferencesStore();

    const locale = computed({
        get: () => preferences.uiLocale || DEFAULT_LOCALE,
        set: (value) => {
            preferences.uiLocale = value;
        },
    });

    return {
        locale,
        locales,
        t: (key, params) => translate(locale.value, key, params),
    };
}
