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

  it('recommends Cookie-Editor and supports cookie file selection on homepage', () => {
    expect(source).toMatch(/t\('input\.cookie_import_hint'\)/);
    expect(source).toMatch(/handleSelectCookies/);
    expect(source).toMatch(/file-cookies-btn/);
  });

  it('surfaces native file and directory picker failures through the existing alert region', () => {
    expect(source).toMatch(/handleSelectCookies[\s\S]*?catch \(err\)[\s\S]*?title: t\('input\.error_cookie_file'\)/);
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
    expect(source).toMatch(/<NeoIcon\s+name="cookie"/);
    expect(source).toMatch(/<NeoIcon\s+name="cross"/);
    expect(source).not.toMatch(/💡/);
  });

  it('displays an honest cookies status badge', () => {
    expect(source).toMatch(/cookieInspectionState/);
    expect(source).toMatch(/class="pot-status-badge pot-idle"/);
    expect(source).toMatch(/input\.cookie_state\.\$\{cookieInspectionState\}/);
    expect(source).not.toMatch(/class="pot-status-badge pot-ready"/);
    expect(source).toMatch(/t\('input\.pot_badge_idle'\)/);
  });

  it('prevents long cookie filenames from squeezing the POT status badge out of view', () => {
    expect(source).toMatch(/class="cookie-title-row"[\s\S]*?class="text-primary cookie-title-text"[\s\S]*?class="pot-status-badge/);
    expect(source).not.toContain('class="dir-path-text cookie-active-path"');
    expect(source).toContain(': cookieFileName }}');
    expect(source).toMatch(/\.cookie-title-row \.text-primary,\s*\.cookie-title-text\s*\{[\s\S]*width:\s*auto;/);
    expect(source).toMatch(/\.pot-status-badge\s*\{[\s\S]*flex-shrink:\s*0;/);
  });
});
