import { computed } from 'vue';
import useI18n from '@/composables/useI18n';

export default function () {
    const { t } = useI18n();

    const types = [
        { title: 'X', name: 'x' },
        { title: 'Twitter', name: 'twitter' },
        { title: 'GitHub', name: 'github' },
        { title: 'Facebook', name: 'facebook' },
        { title: 'LinkedIn', name: 'linkedin' },
    ];

    const positions = computed(() => [
        { title: t('common.insideLeft'), name: 'inside-left' },
        { title: t('common.insideCenter'), name: 'inside-center' },
        { title: t('common.insideRight'), name: 'inside-right' },

        { title: t('common.bottomLeft'), name: 'bottom-left' },
        { title: t('common.bottomCenter'), name: 'bottom-center' },
        { title: t('common.bottomRight'), name: 'bottom-right' },
    ]);

    return {
        types,
        positions,
    };
}
