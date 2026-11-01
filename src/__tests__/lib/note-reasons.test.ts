/**
 * 8f: one list of note reasons. The form's choices and the saved note's label
 * come from NOTE_REASONS; the server's schema must accept exactly those codes.
 */
import { NOTE_REASONS, noteReasonLabel } from '@/lib/note-reasons'
import { createTransactionSchema } from '@/lib/validation'

test('the schema accepts exactly the codes the form offers', () => {
  const field: any = (createTransactionSchema as any).shape.noteReason
  const accepted = [...(field.unwrap ? field.unwrap() : field).options].sort()
  expect(accepted).toEqual(NOTE_REASONS.map((r) => r.code).slice().sort())
})

test('a saved reason shows in shop words; an unknown code shows as itself', () => {
  expect(noteReasonLabel('post-sale-discount')).toBe('Discount after sale')
  expect(noteReasonLabel('return')).toBe('Goods returned')
  expect(noteReasonLabel('mystery')).toBe('mystery')
  expect(noteReasonLabel(null)).toBe('')
})
