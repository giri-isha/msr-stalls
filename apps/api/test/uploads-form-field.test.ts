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

/**
 * A display block's picture, which is the ADMIN's and not an answer.
 *
 * 🔴 `/public/form-image` serves this folder unauthenticated, by key, with no
 * lookup — so "which folder" is the whole of the authorization, and these are
 * the tests that say a vendor's cheque can never be presented as one.
 */
describe("a display block's picture", () => {
  const note = (contentType = 'image/png') =>
    presignUpload(fakeStore(), {
      purpose: 'FORM_NOTE',
      fileName: 'layout.png',
      contentType,
      bytes: 400_000,
    });

  test('needs no field id — it belongs to the form, not to a question', async () => {
    const { key } = await note();
    expect(isOurKey(key, 'FORM_NOTE')).toBe(true);
  });

  /** 🔴 The refusal that keeps the public route honest. A vendor's documents
   *  live in folders of their own, so a key naming one is not servable however
   *  it reaches a field row. */
  test('and no other purpose can pass for one', async () => {
    const { key } = await note();
    expect(isOurKey(key, 'BANK_CHEQUE')).toBe(false);
    expect(isOurKey(key, 'FORM_FIELD', FIELD_A)).toBe(false);

    const cheque = await presignUpload(fakeStore(), {
      purpose: 'BANK_CHEQUE',
      fileName: 'cheque.jpg',
      contentType: 'image/jpeg',
      bytes: 120_000,
    });
    expect(isOurKey(cheque.key, 'FORM_NOTE')).toBe(false);
  });

  /** ⚠️ The block draws its picture in an `<img>`, so a PDF there is a broken
   *  image on every form it sits on. Refused at the presign rather than
   *  discovered by a requester. */
  test('is an image, never a PDF', async () => {
    await expect(note('application/pdf')).rejects.toThrow();
  });
});
