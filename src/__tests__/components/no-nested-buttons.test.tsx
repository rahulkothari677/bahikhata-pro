/**
 * A control inside another control is a control that cannot be pressed.
 *
 * 🐛 2026-08-15. The invoice hub rendered each section as a <button> and put
 * the ⓘ InfoHint — itself a <button> — inside it. Nested interactive elements
 * are invalid HTML; React reports a hydration error, and the browser hands the
 * click to the outer control. So tapping ⓘ opened the section instead of the
 * explanation.
 *
 * Rahul reported it as "icon button isn't working anywhere". I diagnosed it as
 * a preventDefault() call, removed that, and reported it fixed. It was not
 * fixed — the nesting was still there, and I had never pressed the control I
 * shipped. It took the browser console to find what a tap would have found.
 *
 * WHY THIS TEST IS A RENDER AND NOT A GREP. Every guard in this codebase that
 * matched nearby text has eventually passed on broken code (CLAUDE.md, Cause
 * 7 — five of them). Nesting is a fact about the DOM tree, so the only honest
 * check is to build the tree and look. This one fails the moment a button is
 * put inside a button, wherever in the subtree it happens, and no comment or
 * rename can satisfy it.
 */

import { render } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { InvoiceSettingsPage } from '@/components/settings/InvoiceSettingsPage'

// jsdom ships neither, and the preview measures itself to scale the sheet.
;(globalThis as unknown as Record<string, unknown>).ResizeObserver ||= class {
  observe() {}
  unobserve() {}
  disconnect() {}
}

/**
 * Every interactive element that has an interactive ancestor.
 *
 * Exported and taking a plain container SPECIFICALLY so it can be run against
 * a known-bad tree as well as the real one — a rule I cannot call with my own
 * input is a comment with a green tick next to it.
 */
export function nestedInteractives(root: HTMLElement): string[] {
  const INTERACTIVE = 'button, a[href], input, select, textarea'
  return [...root.querySelectorAll(INTERACTIVE)]
    .filter(el => el.parentElement?.closest(INTERACTIVE))
    .map(el => {
      const outer = el.parentElement!.closest(INTERACTIVE)!
      return `<${outer.tagName.toLowerCase()}> contains <${el.tagName.toLowerCase()}>`
        + ` (${el.getAttribute('aria-label') || el.textContent?.trim().slice(0, 30) || '?'})`
    })
}

describe('nestedInteractives — the rule itself', () => {
  it('finds a button inside a button', () => {
    /*
     * Built with DOM calls, NOT innerHTML — and that detail is the whole bug.
     *
     * An HTML parser auto-closes an open <button> when it meets another one,
     * so `innerHTML = '<button><button/></button>'` silently yields two
     * SIBLINGS and this assertion passes against a tree that has no nesting
     * in it. My first version of this test did exactly that and went green
     * while proving nothing.
     *
     * React's renderer has no such repair step, which is precisely why the
     * real defect surfaced as a HYDRATION error: the tree React built and the
     * tree the browser parsed were different shapes.
     */
    const bad = document.createElement('div')
    const outer = document.createElement('button')
    const span = document.createElement('span')
    const inner = document.createElement('button')
    inner.setAttribute('aria-label', 'About Numbering')
    span.appendChild(inner)
    outer.appendChild(span)
    bad.appendChild(outer)

    expect(nestedInteractives(bad)).toHaveLength(1)
    expect(nestedInteractives(bad)[0]).toContain('About Numbering')
  })

  it('passes two buttons that are siblings', () => {
    const good = document.createElement('div')
    good.innerHTML = '<div><button></button><button aria-label="i"></button></div>'
    expect(nestedInteractives(good)).toEqual([])
  })
})

describe('the invoice settings hub', () => {
  const renderHub = () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    return render(
      <QueryClientProvider client={qc}>
        <InvoiceSettingsPage section="invoices" setting={{}} onOpen={() => {}} />
      </QueryClientProvider>,
    )
  }

  it('nests no control inside another', () => {
    const { container } = renderHub()
    expect(nestedInteractives(container)).toEqual([])
  })

  it('still gives every section a pressable row', () => {
    // The fix must not cost the full-width tap target — a 44px row that only
    // responds on its label would be a worse bug than the one being fixed.
    const { container } = renderHub()
    const rowButtons = [...container.querySelectorAll('button')]
      .filter(b => b.className.includes('absolute inset-0'))
    expect(rowButtons.length).toBeGreaterThanOrEqual(6)
    for (const b of rowButtons) expect(b.getAttribute('aria-label')).toBeTruthy()
  })
})
