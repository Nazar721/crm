import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

/** Keep provider text inert: no HTML, image requests, or executable link schemes. */
function safeUrl(value: string): string {
  if (/[\u0000-\u0020\\]/.test(value)) return '';
  if (/^https?:\/\//i.test(value)) return value;
  if (value.startsWith('#') || /^\/(?![\/\\])/.test(value)) return value;
  return '';
}

export default function MarkdownMessage({ text }: { text: string }) {
  return (
    <div className="ai-markdown">
      <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml urlTransform={safeUrl} components={{
        a: ({ href, children }) => href ? <a href={href} target={/^https?:/i.test(href) ? '_blank' : undefined} rel="noopener noreferrer">{children}</a> : <span>{children}</span>,
        img: ({ alt }) => <span>{alt}</span>,
        table: ({ children }) => <div className="ai-table-scroll" role="region" aria-label="Таблиця у відповіді" tabIndex={0}><table>{children}</table></div>,
      }}>
        {text}
      </ReactMarkdown>
    </div>
  );
}
