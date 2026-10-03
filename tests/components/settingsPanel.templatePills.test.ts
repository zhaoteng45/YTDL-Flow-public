import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve('src/components/SettingsPanel.vue'), 'utf8');

describe('SettingsPanel filename template variable pills and live preview', () => {
  it('provides clickable variable pills for quick template construction', () => {
    expect(source).toMatch(/class="template-variable-pills"/);
    expect(source).toMatch(/insertTemplateVariable/);
    expect(source).toContain('%(title)s');
    expect(source).toContain('%(uploader)s');
    expect(source).toContain('%(upload_date)s');
    expect(source).toContain('%(resolution)s');
  });

  it('renders dynamic live preview reflecting the active custom template string', () => {
    expect(source).toMatch(/const renamePreview = computed\(\(\) => effectiveTemplate\.value/);
    expect(source).toMatch(/replace\(.*%\\\(title\\\)s/);
  });
});
