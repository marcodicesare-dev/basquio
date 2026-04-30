import "server-only";

import {
  AlignmentType,
  Document,
  ExternalHyperlink,
  FootnoteReferenceRun,
  HeadingLevel,
  type IParagraphOptions,
  type ISectionOptions,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";
import { marked, type Tokens } from "marked";

/**
 * Server-side Markdown → .docx conversion.
 *
 * Backed by the `docx` npm library (v9.6.x), the same library Anthropic ships
 * with their docx skill. Produces standards-compliant OOXML that opens cleanly
 * in Word for Mac, Word for Windows, Google Docs, and Apple Pages.
 *
 * Design notes:
 *   - Tokenize via `marked.lexer` (markdown → AST), walk the AST, map each
 *     token to docx primitives. Tables, headings, lists, bold/italic, code,
 *     and links all carry through.
 *   - Inline citations like [s1] become Word footnotes via FootnoteReferenceRun.
 *     The footnote body is the citation excerpt + filename. Word, Pages, and
 *     Google Docs all render footnotes natively, so the analyst hands a
 *     Word file to Mario Bianco and the citations stay intact.
 *   - Code blocks render as a single paragraph with monospace font and a
 *     subtle gray shade so they read as code without dropping fidelity.
 *   - This module is pure: in goes (markdown, citations, title), out comes a
 *     Buffer. No I/O, easy to test.
 */

export type ExportCitation = {
  label: string;
  source_type: string;
  source_id: string;
  filename: string | null;
  excerpt: string;
};

export type ExportInput = {
  title: string;
  bodyMarkdown: string;
  citations: ExportCitation[];
  subtitle?: string | null;
  /** Display name of the analyst who exported it, shown beside the title. */
  exportedBy?: string | null;
};

const FONT_BODY = "Calibri";
const FONT_HEADING = "Calibri";
const FONT_MONO = "Consolas";

const CITATION_RE = /\[([a-z][a-z0-9]*)\](?:\[([a-z][a-z0-9]*)\])*/gi;

/**
 * Build the .docx Buffer for a given deliverable. Returns a Buffer ready
 * to stream as the `application/vnd.openxmlformats-officedocument.wordprocessingml.document`
 * response body.
 */
export async function exportDeliverableToDocx(input: ExportInput): Promise<Buffer> {
  const tokens = marked.lexer(input.bodyMarkdown);
  const citationByLabel = new Map(input.citations.map((c) => [c.label.toLowerCase(), c]));
  const usedCitationLabels: string[] = [];
  const footnotes: Record<number, { children: Paragraph[] }> = {};

  function getOrCreateFootnoteId(label: string): number {
    const lower = label.toLowerCase();
    const existingIdx = usedCitationLabels.indexOf(lower);
    if (existingIdx >= 0) return existingIdx + 1;
    usedCitationLabels.push(lower);
    const id = usedCitationLabels.length;
    const citation = citationByLabel.get(lower);
    const body = citation
      ? footnoteParagraphsForCitation(citation)
      : [new Paragraph({ children: [new TextRun({ text: `[${label}]`, italics: true })] })];
    footnotes[id] = { children: body };
    return id;
  }

  const sectionChildren: Array<Paragraph | Table> = [];

  // Title block.
  sectionChildren.push(
    new Paragraph({
      heading: HeadingLevel.TITLE,
      spacing: { before: 0, after: 120 },
      children: [
        new TextRun({
          text: input.title,
          bold: true,
          size: 40,
          font: FONT_HEADING,
        }),
      ],
    }),
  );
  if (input.subtitle) {
    sectionChildren.push(
      new Paragraph({
        spacing: { before: 0, after: 120 },
        children: [
          new TextRun({ text: input.subtitle, italics: true, color: "555555", font: FONT_BODY }),
        ],
      }),
    );
  }
  if (input.exportedBy) {
    sectionChildren.push(
      new Paragraph({
        spacing: { before: 0, after: 240 },
        children: [
          new TextRun({
            text: `Exported by ${input.exportedBy} · ${new Date().toLocaleDateString()}`,
            size: 18,
            color: "888888",
            font: FONT_BODY,
          }),
        ],
      }),
    );
  } else {
    sectionChildren.push(
      new Paragraph({
        spacing: { before: 0, after: 240 },
        children: [
          new TextRun({
            text: `Exported ${new Date().toLocaleDateString()}`,
            size: 18,
            color: "888888",
            font: FONT_BODY,
          }),
        ],
      }),
    );
  }

  for (const token of tokens) {
    sectionChildren.push(...mapToken(token, getOrCreateFootnoteId));
  }

  // Sources appendix when the markdown referenced citations the LLM gave us.
  // This is belt-and-suspenders alongside the inline footnotes (the analyst
  // can scan the appendix to see every citation in one place).
  if (input.citations.length > 0) {
    sectionChildren.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 360, after: 120 },
        children: [
          new TextRun({ text: "Sources", bold: true, font: FONT_HEADING, size: 28 }),
        ],
      }),
    );
    for (const c of input.citations) {
      sectionChildren.push(
        new Paragraph({
          spacing: { before: 0, after: 80 },
          bullet: { level: 0 },
          children: [
            new TextRun({ text: `[${c.label}] `, bold: true, font: FONT_BODY, size: 22 }),
            new TextRun({
              text: c.filename ? `${c.filename}` : `${c.source_type}:${c.source_id}`,
              font: FONT_BODY,
              size: 22,
            }),
            ...(c.excerpt
              ? [
                  new TextRun({ text: " · ", font: FONT_BODY, size: 22, color: "888888" }),
                  new TextRun({
                    text: truncate(c.excerpt, 240),
                    italics: true,
                    font: FONT_BODY,
                    size: 22,
                    color: "555555",
                  }),
                ]
              : []),
          ],
        }),
      );
    }
  }

  const sections: ISectionOptions[] = [
    {
      properties: {
        page: {
          margin: { top: 1080, right: 1080, bottom: 1080, left: 1080 },
        },
      },
      children: sectionChildren,
    },
  ];

  const doc = new Document({
    creator: "Basquio",
    title: input.title,
    styles: {
      default: {
        document: {
          run: { font: FONT_BODY, size: 22 },
          paragraph: { spacing: { line: 320 } },
        },
      },
    },
    footnotes,
    sections,
  });

  return Packer.toBuffer(doc);
}

function footnoteParagraphsForCitation(c: ExportCitation): Paragraph[] {
  const lines: Paragraph[] = [];
  const head = c.filename ? c.filename : `${c.source_type}:${c.source_id}`;
  lines.push(
    new Paragraph({
      children: [
        new TextRun({ text: `[${c.label}] `, bold: true, size: 18 }),
        new TextRun({ text: head, size: 18 }),
      ],
    }),
  );
  if (c.excerpt) {
    lines.push(
      new Paragraph({
        children: [
          new TextRun({ text: truncate(c.excerpt, 360), italics: true, size: 18 }),
        ],
      }),
    );
  }
  return lines;
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1)}…`;
}

function mapToken(
  token: Tokens.Generic,
  getOrCreateFootnoteId: (label: string) => number,
): Array<Paragraph | Table> {
  switch (token.type) {
    case "heading": {
      const t = token as Tokens.Heading;
      const level = t.depth as 1 | 2 | 3 | 4 | 5 | 6;
      return [
        new Paragraph({
          heading: headingLevel(level),
          spacing: { before: 280, after: 120 },
          children: inlineRuns(t.tokens ?? [{ type: "text", text: t.text } as Tokens.Text], getOrCreateFootnoteId, { bold: true, size: headingSize(level) }),
        }),
      ];
    }
    case "paragraph": {
      const t = token as Tokens.Paragraph;
      return [
        new Paragraph({
          spacing: { before: 0, after: 160 },
          children: inlineRuns(t.tokens ?? [], getOrCreateFootnoteId),
        }),
      ];
    }
    case "blockquote": {
      const t = token as Tokens.Blockquote;
      const children: Paragraph[] = [];
      for (const inner of t.tokens ?? []) {
        const mapped = mapToken(inner, getOrCreateFootnoteId);
        for (const m of mapped) {
          if (m instanceof Paragraph) {
            children.push(blockquoteWrap(m));
          }
        }
      }
      return children;
    }
    case "list": {
      const t = token as Tokens.List;
      const ordered = t.ordered;
      const paragraphs: Paragraph[] = [];
      for (const item of t.items as Tokens.ListItem[]) {
        // Marked nests block-level tokens inside list items as `tokens`.
        // For simple line items we collapse to a single paragraph; for
        // nested blocks we emit each as its own paragraph at level 0.
        const inline = item.tokens?.filter((x) => x.type !== "list") ?? [];
        const inlineParagraph = inline.length > 0
          ? new Paragraph({
              numbering: ordered ? { reference: "ordered", level: 0 } : undefined,
              bullet: ordered ? undefined : { level: 0 },
              spacing: { before: 0, after: 80 },
              children: inlineRuns(
                inline.flatMap((x) => (x as Tokens.Paragraph).tokens ?? [x as Tokens.Generic]),
                getOrCreateFootnoteId,
              ),
            })
          : null;
        if (inlineParagraph) paragraphs.push(inlineParagraph);

        // Nested lists.
        const nested = item.tokens?.filter((x) => x.type === "list") ?? [];
        for (const sub of nested) {
          const subList = sub as Tokens.List;
          for (const subItem of subList.items as Tokens.ListItem[]) {
            paragraphs.push(
              new Paragraph({
                bullet: { level: 1 },
                spacing: { before: 0, after: 60 },
                children: inlineRuns(subItem.tokens ?? [], getOrCreateFootnoteId),
              }),
            );
          }
        }
      }
      return paragraphs;
    }
    case "code": {
      const t = token as Tokens.Code;
      return [
        new Paragraph({
          spacing: { before: 80, after: 160 },
          shading: { type: ShadingType.SOLID, color: "F5F5F5", fill: "F5F5F5" },
          children: [
            new TextRun({ text: t.text, font: FONT_MONO, size: 20 }),
          ],
        }),
      ];
    }
    case "table": {
      return [renderTable(token as Tokens.Table, getOrCreateFootnoteId)];
    }
    case "hr":
      return [
        new Paragraph({
          spacing: { before: 160, after: 160 },
          alignment: AlignmentType.CENTER,
          children: [new TextRun({ text: "· · ·", color: "888888" })],
        }),
      ];
    case "space":
      return [];
    default:
      // Fallback: render whatever raw text the token carries.
      const rawText = (token as { raw?: string; text?: string }).raw ?? (token as { text?: string }).text ?? "";
      if (!rawText) return [];
      return [
        new Paragraph({
          spacing: { before: 0, after: 120 },
          children: [new TextRun({ text: rawText, font: FONT_BODY, size: 22 })],
        }),
      ];
  }
}

function headingLevel(level: 1 | 2 | 3 | 4 | 5 | 6) {
  switch (level) {
    case 1: return HeadingLevel.HEADING_1;
    case 2: return HeadingLevel.HEADING_2;
    case 3: return HeadingLevel.HEADING_3;
    case 4: return HeadingLevel.HEADING_4;
    case 5: return HeadingLevel.HEADING_5;
    case 6: return HeadingLevel.HEADING_6;
  }
}

function headingSize(level: 1 | 2 | 3 | 4 | 5 | 6) {
  switch (level) {
    case 1: return 36;
    case 2: return 28;
    case 3: return 24;
    case 4: return 22;
    case 5: return 20;
    case 6: return 20;
  }
}

function blockquoteWrap(paragraph: Paragraph): Paragraph {
  // Reuse the paragraph by extracting its options into a new one with a
  // left border. docx Paragraph is immutable so we rebuild.
  const opts = paragraph as unknown as { options?: IParagraphOptions };
  return new Paragraph({
    ...(opts.options ?? {}),
    border: {
      left: { style: "single", size: 18, space: 8, color: "CCCCCC" },
    },
    indent: { left: 360 },
  });
}

function renderTable(
  token: Tokens.Table,
  getOrCreateFootnoteId: (label: string) => number,
): Table {
  const headerCells = token.header.map(
    (cell) =>
      new TableCell({
        shading: { type: ShadingType.SOLID, color: "F0F0F0", fill: "F0F0F0" },
        children: [
          new Paragraph({
            children: inlineRuns(cell.tokens ?? [{ type: "text", text: cell.text } as Tokens.Text], getOrCreateFootnoteId, { bold: true }),
          }),
        ],
      }),
  );
  const headerRow = new TableRow({ children: headerCells, tableHeader: true });

  const bodyRows = token.rows.map(
    (row) =>
      new TableRow({
        children: row.map(
          (cell) =>
            new TableCell({
              children: [
                new Paragraph({
                  children: inlineRuns(
                    cell.tokens ?? [{ type: "text", text: cell.text } as Tokens.Text],
                    getOrCreateFootnoteId,
                  ),
                }),
              ],
            }),
        ),
      }),
  );

  return new Table({
    rows: [headerRow, ...bodyRows],
    width: { size: 100, type: WidthType.PERCENTAGE },
  });
}

function inlineRuns(
  tokens: Tokens.Generic[],
  getOrCreateFootnoteId: (label: string) => number,
  baseStyle: { bold?: boolean; italics?: boolean; size?: number } = {},
): Array<TextRun | FootnoteReferenceRun | ExternalHyperlink> {
  const out: Array<TextRun | FootnoteReferenceRun | ExternalHyperlink> = [];
  for (const t of tokens) {
    switch (t.type) {
      case "text": {
        const tt = t as Tokens.Text;
        if (tt.tokens && tt.tokens.length > 0) {
          out.push(...(inlineRuns(tt.tokens, getOrCreateFootnoteId, baseStyle) as Array<TextRun | FootnoteReferenceRun | ExternalHyperlink>));
        } else {
          out.push(...textWithCitations(tt.text, getOrCreateFootnoteId, baseStyle));
        }
        break;
      }
      case "strong": {
        const tt = t as Tokens.Strong;
        out.push(...(inlineRuns(tt.tokens ?? [], getOrCreateFootnoteId, { ...baseStyle, bold: true }) as Array<TextRun | FootnoteReferenceRun | ExternalHyperlink>));
        break;
      }
      case "em": {
        const tt = t as Tokens.Em;
        out.push(...(inlineRuns(tt.tokens ?? [], getOrCreateFootnoteId, { ...baseStyle, italics: true }) as Array<TextRun | FootnoteReferenceRun | ExternalHyperlink>));
        break;
      }
      case "codespan": {
        const tt = t as Tokens.Codespan;
        out.push(new TextRun({ text: tt.text, font: FONT_MONO, size: baseStyle.size ?? 20 }));
        break;
      }
      case "link": {
        const tt = t as Tokens.Link;
        out.push(
          new ExternalHyperlink({
            link: tt.href,
            children: [
              new TextRun({
                text: tt.text,
                style: "Hyperlink",
                color: "1A56DB",
                underline: {},
                font: FONT_BODY,
                size: baseStyle.size ?? 22,
                bold: baseStyle.bold,
                italics: baseStyle.italics,
              }),
            ],
          }),
        );
        break;
      }
      case "br":
        out.push(new TextRun({ text: "", break: 1 }));
        break;
      case "del": {
        const tt = t as Tokens.Del;
        out.push(...(inlineRuns(tt.tokens ?? [], getOrCreateFootnoteId, baseStyle) as Array<TextRun | FootnoteReferenceRun | ExternalHyperlink>));
        break;
      }
      default: {
        const fallback = (t as { text?: string }).text ?? "";
        if (fallback) {
          out.push(...textWithCitations(fallback, getOrCreateFootnoteId, baseStyle));
        }
      }
    }
  }
  return out;
}

/**
 * Split a plain string on inline citations [s1], [s2][s3], etc., turning each
 * label into a Word footnote reference. Plain text between citations becomes
 * standard TextRun.
 */
function textWithCitations(
  text: string,
  getOrCreateFootnoteId: (label: string) => number,
  baseStyle: { bold?: boolean; italics?: boolean; size?: number },
): Array<TextRun | FootnoteReferenceRun> {
  const runs: Array<TextRun | FootnoteReferenceRun> = [];
  let lastIndex = 0;
  CITATION_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = CITATION_RE.exec(text)) !== null) {
    if (match.index > lastIndex) {
      const before = text.slice(lastIndex, match.index);
      runs.push(
        new TextRun({
          text: before,
          font: FONT_BODY,
          size: baseStyle.size ?? 22,
          bold: baseStyle.bold,
          italics: baseStyle.italics,
        }),
      );
    }
    // Each label inside the matched cluster gets its own footnote.
    const labels = match[0].slice(1, -1).split("][");
    for (const label of labels) {
      const id = getOrCreateFootnoteId(label);
      runs.push(new FootnoteReferenceRun(id));
    }
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    const tail = text.slice(lastIndex);
    runs.push(
      new TextRun({
        text: tail,
        font: FONT_BODY,
        size: baseStyle.size ?? 22,
        bold: baseStyle.bold,
        italics: baseStyle.italics,
      }),
    );
  }
  return runs;
}
