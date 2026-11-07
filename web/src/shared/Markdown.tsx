import "katex/dist/katex.min.css";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkMath from "remark-math";

/**
 * Renders a Question or Option written by the Parent: Markdown with $LaTeX$.
 * Relative image paths (e.g. `images/triangle.png`) load from the Exercise Set's folder.
 */
export function Markdown({ text, setNumber, inline = false }: { text: string; setNumber: string; inline?: boolean }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkMath]}
      rehypePlugins={[rehypeKatex]}
      urlTransform={(url) => {
        const safe = defaultUrlTransform(url);
        return /^([a-z]+:|\/|#)/i.test(safe) ? safe : `/api/sets/${encodeURIComponent(setNumber)}/files/${safe}`;
      }}
      components={inline ? { p: ({ children }) => <>{children}</> } : undefined}
    >
      {text}
    </ReactMarkdown>
  );
}
