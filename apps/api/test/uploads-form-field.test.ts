import { describe, expect, test } from 'vitest';
import { isOurKey, presignUpload } from '../src/modules/stalls/uploads';
import { fakeStore } from './helpers/onboarding';

const FIELD_A = '11111111-1111-4111-8111-111111111111';
const FIELD_B = '22222222-2222-4222-8222-222222222222';

const mint = (fieldId: string) =>
  presignUpload(fakeStore(), {
    purpose: 'FORM_FIELD',
    fieldId,
    fileName: 'cert.pdf',
    contentType: 'application/pdf',
    bytes: 90_000,
  });

describe('a file answer belongs to ONE question', () => {
  /** 🔴 The whole security argument for putting the field id in the PATH. Both
   *  files are the vendor's own and both keys were minted legitimately —
   *  without this, answering "GST certificate" with the PAN upload would be
   *  accepted and the record would be quietly wrong. */
  test('a key minted for one field is refused for another', async () => {
    const { key } = await mint(FIELD_A);
    expect(isOurKey(key, 'FORM_FIELD', FIELD_A)).toBe(true);
    expect(isOurKey(key, 'FORM_FIELD', FIELD_B)).toBe(false);
  });

  test('and is refused when no field is named at all', async () => {
    const { key } = await mint(FIELD_A);
    expect(isOurKey(key, 'FORM_FIELD')).toBe(false);
  });

  /** ⚠️ The id is interpolated into a regex. Anything but a plain uuid is
   *  refused rather than allowed to carry metacharacters into the pattern. */
  test('a field id that is not a uuid never matches', async () => {
    const { key } = await mint(FIELD_A);
    expect(isOurKey(key, 'FORM_FIELD', '.*')).toBe(false);
    expect(isOurKey(key, 'FORM_FIELD', `${FIELD_A}|x`)).toBe(false);
  });

  test('minting one without a field id is refused outright', async () => {
    await expect(
      presignUpload(fakeStore(), {
        purpose: 'FORM_FIELD',
        fileName: 'cert.pdf',
        contentType: 'application/pdf',
        bytes: 90_000,
      }),
    ).rejects.toThrow();
  });

  /** The five existing purposes are untouched, so every key already in the
   *  store stays valid. */
  test('the typed-column purposes still validate their own keys', async () => {
    const cheque = await presignUpload(fakeStore(), {
      purpose: 'BANK_CHEQUE',
      fileName: 'cheque.jpg',
      contentType: 'image/jpeg',
      bytes: 120_000,
    });
    expect(isOurKey(cheque.key, 'BANK_CHEQUE')).toBe(true);
    expect(isOurKey(cheque.key, 'BANK_PAN')).toBe(false);
    expect(isOurKey(cheque.key, 'FORM_FIELD', FIELD_A)).toBe(false);
  });
});
