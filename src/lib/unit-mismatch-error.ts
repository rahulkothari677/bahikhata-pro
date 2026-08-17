/**
 * Thrown when a line's unit cannot be converted into the product's unit.
 *
 * A dedicated class because the refusal happens INSIDE a Prisma interactive
 * transaction, where returning a NextResponse is not possible — the write must
 * roll back first. The route catches this and turns it into a 400.
 *
 * Why refuse at all: selling 4 tablets from a strip of 15 used to take four
 * whole strips off the shelf, because nothing knew how many tablets make a
 * strip and the quantity was spent as-entered. That factor is per-product and
 * does not exist yet, so the honest answer is to stop rather than guess.
 */
export class UnitMismatchError extends Error {
  readonly conflicts: { productName: string; productUnit: string; enteredUnit: string; quantity: number }[]
  constructor(message: string, conflicts: UnitMismatchError['conflicts']) {
    super(message)
    this.name = 'UnitMismatchError'
    this.conflicts = conflicts
  }
}
