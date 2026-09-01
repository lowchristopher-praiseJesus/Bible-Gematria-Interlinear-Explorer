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
    expect(blockquote?.textContent).toBe('Line one\nLine two')
  })
})
