import { safeName } from './names.js';

describe('object key file names', () => {
  it('replaces spaces and symbols', () => expect(safeName('My clip (1).MP4')).toBe('My_clip_1_.MP4'));
  it('cannot climb out of the folder', () => expect(safeName('../../etc/passwd')).toBe('.._.._etc_passwd'));
  it('keeps the end of very long names, including the extension', () => expect(safeName('a'.repeat(300) + '.mov').endsWith('.mov')).toBe(true));
});
