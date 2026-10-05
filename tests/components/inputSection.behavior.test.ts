import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve('src/components/InputSection.vue'), 'utf8');

describe('InputSection primary flow', () => {
  it('uses one shared multi-URL parser for preview and submit without txt import or a 50-link batch cap', () => {
    expect(source).toMatch(/import \{ parseUrlInput \} from '\.\.\/application\/urlInput';/);
    expect(source).toMatch(/const parsedInput = computed\(\(\) => parseUrlInput\(inputContent\.value\)\);/);
    expect(source).toMatch(/const parsedLinks = computed\(\(\) => parsedInput\.value\.urls\);/);
    expect(source).toMatch(/emit\('analyze', parsedInput\.value\.urls\)/);
    expect(source).toMatch(/const noticeMessage = ref\(''\);/);
    expect(source).toMatch(/input\.warning_invalid_ignored/);
    expect(source).toMatch(/v-if="noticeMessage"[\s\S]*?role="status"/);
    expect(source).not.toMatch(/maxlength=|handleImportFile|importUrlTextFile|error_limit|lines\.length > 50/);
  });

  it('gives each link remove button an accessible name', () => {
    expect(source).toMatch(/class="chip-remove"[\s\S]*?:aria-label="t\('input\.remove_link'\)"/);
  });

  it('connects inline validation to the textarea', () => {
    expect(source).toMatch(/const errorMessageId = `\$\{urlInputId\}-error`;/);
    expect(source).toMatch(/<textarea[\s\S]*?:aria-invalid="!!errorTitle"/);
    expect(source).toMatch(/:aria-describedby="errorTitle \? errorMessageId : undefined"/);
    expect(source).toMatch(/<div v-if="errorTitle" :id="errorMessageId"[\s\S]*?role="alert"/);
  });


  it('surfaces native directory picker failures through the existing alert region', () => {
    expect(source).toMatch(/selectDirectory[\s\S]*?catch \(err\)[\s\S]*?title: t\('input\.error_download_dir'\)/);
    expect(source).toMatch(/handleOpenDirectory[\s\S]*?catch \(err\)[\s\S]*?title: t\('input\.error_open_dir'\)/);
  });

  it('provides a visual dropzone indicator and handles drag states', () => {
    expect(source).toMatch(/isDragging/);
    expect(source).toMatch(/onDragEnter/);
    expect(source).toMatch(/onDragLeave/);
    expect(source).toMatch(/class="drop-overlay-indicator"/);
  });

  it('uses NeoIcon vector iconography without raw structural emojis', () => {
    expect(source).toMatch(/import NeoIcon from '\.\/NeoIcon\.vue';/);
    expect(source).toMatch(/<NeoIcon\s+name="search"/);
    expect(source).toMatch(/<NeoIcon\s+name="folder"/);
    expect(source).toMatch(/<NeoIcon\s+name="cross"/);
    expect(source).not.toMatch(/💡/);
  });

  // Homepage credential actions, honest states and responsive geometry are now
  // exercised by tests/ui/homepage-connections.ts using real Vue components.

});
