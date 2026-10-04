import { describe, expect, it } from 'vitest';
import { assertPublishIdentity, releaseAction } from '../../scripts/lib/installer-release.mjs';

const identity = { tag: 'v3.1.4', version: '3.1.4', sourceCommit: 'a'.repeat(40), tagCommit: 'a'.repeat(40) };
describe('automatic installer publishing', () => {
  it('refuses to publish a different tag, source or version', () => {
    expect(() => assertPublishIdentity(identity)).not.toThrow();
    expect(() => assertPublishIdentity({ ...identity, tagCommit: 'b'.repeat(40) })).toThrow(/source/);
    expect(() => assertPublishIdentity({ ...identity, tag: 'v3.1.3' })).toThrow(/version/);
  });
  it('creates a new draft or resumes only its own draft', () => {
    expect(releaseAction(null, identity)).toBe('create');
    expect(releaseAction({ draft: true, tag_name: identity.tag, target_commitish: identity.sourceCommit }, identity)).toBe('resume');
    expect(() => releaseAction({ draft: true, tag_name: identity.tag, target_commitish: 'main' }, identity)).toThrow(/source/);
  });
  it('never overwrites a published version, including on retry', () => {
    expect(() => releaseAction({ draft: false, tag_name: identity.tag, target_commitish: identity.sourceCommit }, identity)).toThrow(/published/);
  });
});
