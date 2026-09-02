import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { renderMarkdown } from './renderMarkdown'

describe('renderMarkdown', () => {
  it('renders **bold** spans', () => {
    render(<div>{renderMarkdown('This is **bold** text.')}</div>)
    expect(screen.getByText('bold').tagName).toBe('STRONG')
  })

  it('renders blank-line-separated paragraphs', () => {
    const { container } = render(<div>{renderMarkdown('First paragraph.\n\nSecond paragraph.')}</div>)
    expect(container.querySelectorAll('p')).toHaveLength(2)
  })

  it('renders a "> quoted" line as a blockquote, not literal text', () => {
    render(<div>{renderMarkdown('Here is the verse:\n\n> "Jesus wept."')}</div>)
    expect(screen.getByText('"Jesus wept."').closest('blockquote')).not.toBeNull()
    expect(screen.queryByText(/^>/)).not.toBeInTheDocument()
  })

  it('strips the ">" marker from every line of a multi-line blockquote', () => {
    const { container } = render(<div>{renderMarkdown('> Line one\n> Line two')}</div>)
    const blockquote = container.querySelector('blockquote')
    expect(blockquote).not.toBeNull()
    expect(blockquote?.textContent).toContain('Line one')
    expect(blockquote?.textContent).toContain('Line two')
    expect(blockquote?.textContent).not.toContain('>')
  })

  it('renders [text](url) as an anchor', () => {
    render(
      <div>{renderMarkdown('Grow in grace (see [2 Pet 3:18](/explorer?reference=2PE%203%3A18)).')}</div>
    )
    const link = screen.getByRole('link', { name: '2 Pet 3:18' })
    expect(link.getAttribute('href')).toBe('/explorer?reference=2PE%203%3A18')
  })

  it('renders links alongside bold text in the same paragraph', () => {
    render(
      <div>{renderMarkdown('**Grace is undeserved favor** — see [Rom 6:14](/explorer?reference=ROM%206%3A14).')}</div>
    )
    expect(screen.getByText('Grace is undeserved favor').tagName).toBe('STRONG')
    expect(screen.getByRole('link', { name: 'Rom 6:14' })).not.toBeNull()
  })

  // wiki_qa bolds scripture refs *before* resolve_scripture_refs links them,
  // so the LLM's output routinely contains **[ref](url)** — the link must
  // survive inside the bold span rather than show as literal syntax.
  it('renders a link nested inside **bold** markers as an anchor, not literal text', () => {
    render(
      <div>
        {renderMarkdown('- **[Philippians 3:13](/explorer?reference=PHP%203%3A13)** — forgetting those things')}
      </div>
    )
    const link = screen.getByRole('link', { name: 'Philippians 3:13' })
    expect(link.getAttribute('href')).toBe('/explorer?reference=PHP%203%3A13')
    expect(link.closest('strong')).not.toBeNull()
    expect(screen.queryByText(/\[Philippians/)).not.toBeInTheDocument()
  })

  it('renders **bold** inside link text without showing asterisks', () => {
    render(<div>{renderMarkdown('See [**Matthew 1:1-16**](/explorer?reference=MAT%201%3A1) for the genealogy.')}</div>)
    const link = screen.getByRole('link', { name: 'Matthew 1:1-16' })
    expect(link.getAttribute('href')).toBe('/explorer?reference=MAT%201%3A1')
    expect(link.querySelector('strong')).not.toBeNull()
  })

  it('leaves text without links untouched', () => {
    render(<div>{renderMarkdown('Nothing link-like here at all [really].')}</div>)
    expect(screen.queryByRole('link')).toBeNull()
    expect(screen.getByText(/Nothing link-like/)).toBeInTheDocument()
  })

  it('renders a GFM pipe table as a real <table>, not literal pipes', () => {
    const md = [
      '| Term | Meaning |',
      '|------|---------|',
      '| Faith | Trust in God |',
      '| Works | Acts of obedience |',
    ].join('\n')
    const { container } = render(<div>{renderMarkdown(md)}</div>)

    expect(container.querySelector('table')).not.toBeNull()
    expect(container.querySelectorAll('thead th')).toHaveLength(2)
    expect(container.querySelectorAll('tbody tr')).toHaveLength(2)
    expect(screen.getByRole('cell', { name: 'Acts of obedience' })).toBeInTheDocument()
    expect(screen.queryByText(/\|/)).not.toBeInTheDocument()
  })

  it('renders ### headings and --- rules as elements, not literal text', () => {
    const { container } = render(
      <div>{renderMarkdown('### Section One\n\nBody text.\n\n---\n\nMore text.')}</div>
    )
    expect(container.querySelector('h3')?.textContent).toBe('Section One')
    expect(container.querySelector('hr')).not.toBeNull()
    expect(screen.queryByText('### Section One')).not.toBeInTheDocument()
  })

  it('renders "- item" lines as list items', () => {
    const { container } = render(<div>{renderMarkdown('- first\n- second\n- third')}</div>)
    expect(container.querySelectorAll('ul li')).toHaveLength(3)
  })
})
