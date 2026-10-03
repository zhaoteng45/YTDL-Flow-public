import { computed, ref, type Ref } from 'vue';
import { DEFAULT_EXTRA_ARGS } from '../constants';
import type { ExtraArgs } from '../types';

const TITLE_ONLY = '%(title)s.%(ext)s';
const fields = {
  title: '%(title)s',
  platform: '%(extractor_key)s',
  uploader: '%(uploader)s',
  date: '%(upload_date)s',
};

// A read-only projection until a user explicitly edits a naming control.
// Legacy blanks keep their stored value and mean the same as Rust's fallback.
export function useFilenameSettings(args: Ref<ExtraArgs>) {
  // Derive the initial switch state from persisted semantics. Once mounted, keep
  // this as local UI state so temporarily clearing the text field does not close
  // the editor while the user is typing a replacement template.
  const storedTemplate = args.value.filenameTemplate?.trim() ?? '';
  const editorEnabled = ref(storedTemplate !== '' && storedTemplate !== TITLE_ONLY);
  const effectiveTemplate = computed(() => args.value.filenameTemplate?.trim()
    ? args.value.filenameTemplate : TITLE_ONLY);
  const isRenamingEnabled = computed({
    get: () => editorEnabled.value,
    set: (enabled: boolean) => {
      editorEnabled.value = enabled;
      args.value.filenameTemplate = enabled ? DEFAULT_EXTRA_ARGS.filenameTemplate : TITLE_ONLY;
    },
  });
  const renameOptions = computed(() => ({
    title: effectiveTemplate.value.includes(fields.title),
    platform: effectiveTemplate.value.includes(fields.platform),
    uploader: effectiveTemplate.value.includes(fields.uploader),
    date: effectiveTemplate.value.includes(fields.date),
    subLangs: Boolean(args.value.subLangs && effectiveTemplate.value.includes(` [${args.value.subLangs}]`)),
  }));
  const setOption = (key: keyof typeof renameOptions.value, enabled: boolean) => {
    const options = { ...renameOptions.value, [key]: enabled };
    const parts = (Object.keys(fields) as (keyof typeof fields)[])
      .filter((field) => options[field]).map((field) => fields[field]);
    let template = parts.length ? parts.join(' - ') : fields.title;
    if (options.subLangs && args.value.subLangs) template += ` [${args.value.subLangs}]`;
    args.value.filenameTemplate = `${template}.%(ext)s`;
  };
  return { effectiveTemplate, isRenamingEnabled, renameOptions, setOption };
}
