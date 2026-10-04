<script setup lang="ts">
import { ref, computed, nextTick, watch, useId, useTemplateRef } from 'vue';
import { onClickOutside } from '@vueuse/core';
import { useI18n } from 'vue-i18n';
import { THEMES, type AppTheme } from '../constants';

// SVG Path Configuration
const icons = {
    sun: {
        viewBox: '0 0 24 24',
        content: `
            <circle cx="12" cy="12" r="5"></circle>
            <line x1="12" y1="1" x2="12" y2="3"></line>
            <line x1="12" y1="21" x2="12" y2="23"></line>
            <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line>
            <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line>
            <line x1="1" y1="12" x2="3" y2="12"></line>
            <line x1="21" y1="12" x2="23" y2="12"></line>
            <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line>
            <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>
        `
    },
    moon: {
        viewBox: '0 0 24 24',
        content: '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>'
    },
    feather: {
        viewBox: '0 0 24 24',
        content: `
            <path d="M20.24 12.24a6 6 0 0 0-8.49-8.49L5 10.5V19h8.5z"></path>
            <line x1="16" y1="8" x2="2" y2="22"></line>
            <line x1="17.5" y1="15" x2="9" y2="15"></line>
        `
    },
    terminal: {
        viewBox: '0 0 24 24',
        content: `
            <polyline points="4 17 10 11 4 5"></polyline>
            <line x1="12" y1="19" x2="20" y2="19"></line>
        `
    },
    grid: {
        viewBox: '0 0 24 24',
        content: `
            <rect x="3" y="3" width="7" height="7"></rect>
            <rect x="14" y="3" width="7" height="7"></rect>
            <rect x="14" y="14" width="7" height="7"></rect>
            <rect x="3" y="14" width="7" height="7"></rect>
        `
    },
    layers: {
        viewBox: '0 0 24 24',
        content: `
            <polygon points="12 2 2 7 12 12 22 7 12 2"></polygon>
            <polyline points="2 17 12 22 22 17"></polyline>
            <polyline points="2 12 12 17 22 12"></polyline>
        `
    },
    scroll: {
        viewBox: '0 0 24 24',
        content: `
            <path d="M19 20H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h11a5 5 0 0 1 5 5v11a2 2 0 0 1-2 2z"></path>
            <line x1="17" y1="9" x2="17" y2="13"></line>
        `
    },
    monitor: {
        viewBox: '0 0 24 24',
        content: `
            <rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect>
            <line x1="8" y1="21" x2="16" y2="21"></line>
            <line x1="12" y1="17" x2="12" y2="21"></line>
        `
    },
    pokeball: {
        viewBox: '0 0 24 24',
        content: `
            <circle cx="12" cy="12" r="10"></circle>
            <line x1="2" y1="12" x2="22" y2="12"></line>
            <circle cx="12" cy="12" r="3"></circle>
            <circle cx="12" cy="12" r="1.5"></circle>
        `
    },
    pingpong: {
        viewBox: '0 0 24 24',
        content: `
            <circle cx="10" cy="10" r="7" fill="none" stroke="currentColor" stroke-width="2"></circle>
            <line x1="10" y1="17" x2="10" y2="22" stroke="currentColor" stroke-width="3" stroke-linecap="round"></line>
            <circle cx="19" cy="19" r="3" fill="currentColor"></circle>
        `
    },
    paperplane: {
        viewBox: '0 0 24 24',
        content: `
            <path d="M22 2L11 13"></path>
            <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
        `
    },
    natural_taupe: {
        viewBox: '0 0 24 24',
        content: `
            <path d="M12 2.5l-9.5 19h19l-9.5-19z" stroke="currentColor" stroke-width="2" fill="none"></path>
            <path d="M12 2.5v19" stroke="currentColor" stroke-width="2"></path>
        `
    },
    natural_olive: {
        viewBox: '0 0 24 24',
        content: `
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z" fill="currentColor" opacity="0.3"></path>
            <path d="M12 4v16M4 12h16" stroke="currentColor" stroke-width="2"></path>
        `
    }
} as const;

type ThemeKey = keyof typeof icons;

const { modelValue } = defineProps<{
    modelValue: AppTheme;
}>();

const emit = defineEmits<{
    (e: 'update:modelValue', value: AppTheme): void;
}>();

const { t } = useI18n();
const isOpen = ref(false);
const containerRef = useTemplateRef<HTMLElement>('containerRef');
const triggerRef = useTemplateRef<HTMLButtonElement>('triggerRef');
const listboxRef = useTemplateRef<HTMLElement>('listboxRef');
const focusedIndex = ref(-1);
const listboxId = useId();

const themes = [
    { value: THEMES.MATERIAL, label: 'app.theme_material', icon: 'layers' },
    { value: THEMES.FLUENT, label: 'app.theme_fluent', icon: 'monitor' },
    { value: THEMES.COBALT_BUTTER, label: 'app.theme_cobalt_butter', icon: 'grid' },
] as const;

const currentTheme = computed(() => themes.find(t => t.value === modelValue) || themes[0]);
const activeDescendant = computed(() => (
    isOpen.value && focusedIndex.value >= 0
        ? `theme-${themes[focusedIndex.value].value}`
        : undefined
));

const scrollFocusedOptionIntoView = () => {
    nextTick(() => {
        if (!listboxRef.value || focusedIndex.value < 0) return;
        const value = themes[focusedIndex.value]?.value;
        listboxRef.value
            .querySelector<HTMLElement>(`#theme-${value}`)
            ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    });
};

watch([isOpen, focusedIndex], ([open]) => {
    if (open) scrollFocusedOptionIntoView();
});

const openDropdown = () => {
    isOpen.value = true;
    focusedIndex.value = Math.max(0, themes.findIndex(t => t.value === modelValue));
};

const toggleDropdown = () => {
    if (isOpen.value) {
        isOpen.value = false;
        focusedIndex.value = -1;
    } else {
        openDropdown();
    }
};

const selectTheme = (value: AppTheme) => {
    emit('update:modelValue', value);
    isOpen.value = false;
    focusedIndex.value = -1;
    nextTick(() => triggerRef.value?.focus());
};

// Keyboard navigation
const handleKeydown = (e: KeyboardEvent) => {
    if (!isOpen.value) {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            openDropdown();
        }
        return;
    }

    switch (e.key) {
        case 'ArrowDown':
            e.preventDefault();
            focusedIndex.value = (focusedIndex.value + 1) % themes.length;
            break;
        case 'ArrowUp':
            e.preventDefault();
            focusedIndex.value = (focusedIndex.value - 1 + themes.length) % themes.length;
            break;
        case 'Enter':
        case ' ':
            e.preventDefault();
            if (focusedIndex.value >= 0) {
                selectTheme(themes[focusedIndex.value].value);
            }
            break;
        case 'Escape':
            e.preventDefault();
            isOpen.value = false;
            focusedIndex.value = -1;
            triggerRef.value?.focus();
            break;
        case 'Home':
            e.preventDefault();
            focusedIndex.value = 0;
            break;
        case 'End':
            e.preventDefault();
            focusedIndex.value = themes.length - 1;
            break;
    }
};

const handleClickOutside = () => {
    isOpen.value = false;
};

onClickOutside(containerRef, handleClickOutside);
</script>

<template>
    <div class="theme-selector" ref="containerRef">
        <button ref="triggerRef" class="selector-trigger header-control" @click="toggleDropdown" :class="{ 'is-open': isOpen }"
            role="combobox" :title="t('app.current_theme', { theme: t(currentTheme.label) })"
            :aria-label="t('app.current_theme', { theme: t(currentTheme.label) })" aria-haspopup="listbox"
            :aria-controls="listboxId" :aria-expanded="isOpen" :aria-activedescendant="activeDescendant"
            @keydown="handleKeydown">
            <span class="icon-wrapper">
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18"
                    :viewBox="icons[currentTheme.icon as ThemeKey].viewBox" fill="none" stroke="currentColor"
                    stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
                    v-html="icons[currentTheme.icon as ThemeKey].content" aria-hidden="true">
                </svg>
            </span>
            <span class="label-text">{{ t(currentTheme.label) }}</span>
            <span class="chevron" :class="{ 'rotated': isOpen }" aria-hidden="true">
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none"
                    stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="6 9 12 15 18 9"></polyline>
                </svg>
            </span>
        </button>

        <div ref="listboxRef" :id="listboxId" class="dropdown-menu" v-if="isOpen" role="listbox" :aria-label="t('app.theme')">
            <div v-for="(item, idx) in themes" :key="item.value" class="dropdown-item"
                :class="{ 'active': modelValue === item.value, 'focused': focusedIndex === idx }" @click="selectTheme(item.value)"
                role="option" :aria-selected="modelValue === item.value" :id="'theme-' + item.value"
                tabindex="-1" @mouseenter="focusedIndex = idx">
                <span class="item-icon" aria-hidden="true">
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"
                        :viewBox="icons[item.icon as ThemeKey].viewBox" fill="none" stroke="currentColor"
                        stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
                        v-html="icons[item.icon as ThemeKey].content">
                    </svg>
                </span>
                <span class="item-label">{{ t(item.label) }}</span>
                <span class="check-icon" v-if="modelValue === item.value" aria-hidden="true">
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none"
                        stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
                        <polyline points="20 6 9 17 4 12"></polyline>
                    </svg>
                </span>
            </div>
        </div>
    </div>
</template>

<style scoped>
.theme-selector {
    position: relative;
    display: inline-block;
    min-width: 140px;
}

.selector-trigger {
    display: flex;
    align-items: center;
    justify-content: center;
    position: relative;
    width: 100%;
    padding: var(--spacing-sm) 36px;
    background-color: var(--color-surface);
    border: var(--border-width) solid var(--color-border);
    border-radius: var(--radius-sm);

    cursor: pointer;

    color: var(--color-text);
    font-family: var(--font-body);
}

.icon-wrapper {
    display: flex;
    align-items: center;
    margin-right: var(--spacing-sm);
}

.label-text {
    text-align: center;
    font-weight: 600;
    font-size: 0.9rem;
}

.chevron {
    position: absolute;
    right: 14px;
    display: flex;
    align-items: center;
    transition: transform 0.2s ease;
    opacity: 0.6;
}

.chevron.rotated {
    transform: rotate(180deg);
}

.dropdown-menu {
    position: absolute;
    top: calc(100% + 4px);
    right: 0;
    min-width: 220px;
    width: max-content;
    max-width: 280px;
    max-height: 360px;
    overflow-y: auto;
    background-color: var(--color-surface);
    border: var(--border-width) solid var(--color-border);
    border-radius: var(--radius-sm);
    box-shadow: var(--shadow-hard);
    z-index: 1000;
    animation: slideDown 0.15s ease-out;
}

.dropdown-item {
    display: flex;
    align-items: center;
    padding: var(--spacing-sm) var(--spacing-md);
    cursor: pointer;
    transition: background-color 0.1s;
}

.dropdown-item:hover {
    background-color: var(--color-bg-hover);
}

.dropdown-item.focused {
    background-color: var(--color-bg-hover);
    outline: 2px solid var(--color-primary);
    outline-offset: -2px;
}

.dropdown-item.active {
    background-color: var(--color-primary);
    color: var(--color-on-primary);
}

.item-icon {
    display: flex;
    align-items: center;
    margin-right: var(--spacing-sm);
    opacity: 0.8;
}

.dropdown-item.active .item-icon {
    opacity: 1;
}

.item-label {
    flex: 1;
    font-weight: 500;
    font-size: 0.9rem;
    white-space: nowrap;
}

.check-icon {
    display: flex;
    align-items: center;
}

@keyframes slideDown {
    from {
        opacity: 0;
        transform: translateY(-4px);
    }

    to {
        opacity: 1;
        transform: translateY(0);
    }
}

@media (prefers-reduced-motion: reduce) {
    .dropdown-menu {
        animation: none;
    }

    .chevron {
        transition: none;
    }
}
</style>
