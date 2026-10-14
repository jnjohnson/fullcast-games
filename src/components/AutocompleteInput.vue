<script setup>
    import { ref, watch, onMounted, onUnmounted } from 'vue';

    const props = defineProps({
        // Which index to search: 'team', 'coach' or 'qb'.
        kind: { type: String, required: true },
        placeholder: { type: String, default: 'Start typing...' },
        disabled: { type: Boolean, default: false },
    });
    // `select` fires with { id, name, detail } when a suggestion is picked, and with null when the text is edited after.
    const emit = defineEmits(['select']);

    const DEBOUNCE_MS = 150;
    const MIN_CHARS = 2;

    const text = ref('');
    const suggestions = ref([]);
    const open = ref(false);
    const highlighted = ref(-1);
    const selected = ref(null);
    const root = ref(null);
    const input = ref(null);
    // Each list gets a unique id so aria-activedescendant works with more than one input on a page.
    const listId = `autocomplete-${Math.random().toString(36).slice(2)}`;
    let timer = null;
    // Increments on every search so a slow, stale response can't overwrite a newer one.
    let requestId = 0;

    // Fetches suggestions for the current text after a short pause in typing.
    function onInput() {
        if (selected.value) {
            selected.value = null;
            emit('select', null);
        }
        clearTimeout(timer);
        const query = text.value.trim();
        if (query.length < MIN_CHARS) {
            suggestions.value = [];
            open.value = false;
            return;
        }
        timer = setTimeout(() => fetchSuggestions(query), DEBOUNCE_MS);
    }

    // Loads suggestions from the server and opens the list. Ignores responses for outdated queries.
    async function fetchSuggestions(query) {
        const id = ++requestId;
        try {
            const res = await fetch(`/api/ladder/search?kind=${props.kind}&q=${encodeURIComponent(query)}`);
            const body = await res.json();
            if (id !== requestId) return;
            suggestions.value = res.ok ? body : [];
        } catch {
            if (id !== requestId) return;
            suggestions.value = [];
        }
        highlighted.value = suggestions.value.length ? 0 : -1;
        open.value = true;
    }

    // Fills the input with a suggestion and reports it to the parent.
    function pick(item) {
        selected.value = item;
        text.value = item.name;
        open.value = false;
        emit('select', item);
    }

    // Arrow keys move the highlight, Enter picks the highlighted suggestion, Escape closes the list.
    function onKeydown(e) {
        if (!open.value || !suggestions.value.length) return;
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            highlighted.value = (highlighted.value + 1) % suggestions.value.length;
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            highlighted.value = (highlighted.value - 1 + suggestions.value.length) % suggestions.value.length;
        } else if (e.key === 'Enter' && highlighted.value >= 0) {
            e.preventDefault();
            pick(suggestions.value[highlighted.value]);
        } else if (e.key === 'Escape') {
            open.value = false;
        }
    }

    // Closes the list when the user clicks anywhere outside the component.
    function onDocClick(e) {
        if (open.value && !root.value?.contains(e.target)) {
            open.value = false;
        }
    }

    // Clears the input. Called by the parent after a guess, and whenever the kind changes.
    function clear() {
        clearTimeout(timer);
        requestId++;
        text.value = '';
        suggestions.value = [];
        selected.value = null;
        open.value = false;
    }

    // Scrolls the input to the middle of the screen and focuses it.
    function focus() {
        input.value?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        input.value?.focus({ preventScroll: true });
    }

    watch(() => props.kind, clear);
    onMounted(() => { document.addEventListener('click', onDocClick); });
    onUnmounted(() => {
        document.removeEventListener('click', onDocClick);
        clearTimeout(timer);
    });

    defineExpose({ clear, focus });
</script>

<template>
    <div ref="root" class="autocomplete">
        <input
            ref="input"
            v-model="text"
            type="text"
            role="combobox"
            autocomplete="off"
            aria-autocomplete="list"
            :aria-expanded="open"
            :aria-controls="listId"
            :aria-activedescendant="open && highlighted >= 0 ? `${listId}-${highlighted}` : undefined"
            :placeholder="placeholder"
            :disabled="disabled"
            @input="onInput"
            @keydown="onKeydown"
            @focus="open = suggestions.length > 0 && !selected"
        />
        <ul v-if="open" :id="listId" role="listbox" class="suggestions">
            <li
                v-for="(item, i) in suggestions"
                :id="`${listId}-${i}`"
                :key="item.id"
                role="option"
                :aria-selected="i === highlighted"
                :class="{ highlighted: i === highlighted }"
                @mousedown.prevent="pick(item)"
                @mouseenter="highlighted = i"
            >
                <span class="name">{{ item.name }}</span>
                <span v-if="item.detail" class="detail">{{ item.detail }}</span>
            </li>
            <li v-if="!suggestions.length" class="empty">No matches</li>
        </ul>
    </div>
</template>

<style scoped lang="scss">
    @use '../assets/base';

    .autocomplete {
        position: relative;
        width: 100%;
    }

    input {
        background: base.$color-background;
        border: 1px solid base.$ptku-blue;
        border-radius: 15px;
        color: base.$color-text;
        font-family: base.$inter;
        font-size: 1.1rem;
        padding: 16px 20px;
        width: 100%;

        &:focus {
            outline: 2px solid base.$ptku-blue;
            outline-offset: 2px;
        }

        &:disabled {
            opacity: 0.6;
        }
    }

    .suggestions {
        background: base.$color-background;
        border: 1px solid base.$ptku-blue;
        border-radius: 15px;
        left: 0;
        list-style: none;
        margin-top: 6px;
        max-height: 320px;
        overflow-y: auto;
        padding: 6px;
        position: absolute;
        right: 0;
        text-align: left;
        top: 100%;
        z-index: 10;

        li {
            border-radius: 10px;
            cursor: pointer;
            display: flex;
            gap: 10px;
            justify-content: space-between;
            padding: 10px 14px;

            &.highlighted {
                background: base.$ptku-blue;
                color: #222222;
            }

            &.empty {
                cursor: default;
                opacity: 0.6;
            }
        }

        .name {
            font-weight: 700;
        }

        .detail {
            font-size: 0.85rem;
            opacity: 0.8;
            text-align: right;
        }
    }
</style>
