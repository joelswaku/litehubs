"use client";

/**
 * On-screen contract, laid out like the PDF: a white sheet with the company
 * header, the centred title, numbered articles and the same signature block
 * (« Fait à …, le … », Pour l’employeur / Le travailleur, « Lu et approuvé »,
 * signature and date).  On a phone the sheet fills the width and the two
 * signature columns stack.
 */
import type { ReactNode } from "react";
import { ShieldCheck } from "lucide-react";

export type ContractBlock = { type: "heading" | "paragraph" | "table" | "page_break"; text?: string; rows?: string[][] };
export type ContractParties = {
  companyName: string;
  employerName?: string | null;
  employerRole?: string | null;
  employeeName?: string | null;
  employeeTitle?: string | null;
  city?: string | null;
};
export type ContractSignatureState = {
  status: string;
  signedName?: string | null;
  signedAt?: string | null;
  method?: string | null;
};

const BLANK = "________________";

/* Same rules as the PDF generator (api contract-pdf.ts). */
function splitGluedHeading(line: string): [string, string] {
  if (line.length <= 70) return [line, ""];
  const article = line.match(/^((?:article|art\.)\s*\d+[a-z]?\s*[—–:.-]\s*)(.+)$/i);
  if (article) {
    const words = article[2]!.split(/\s+/);
    for (let index = 1; index < words.length; index += 1) {
      if (/^[A-ZÀ-ÖØ-Þ][a-zà-öø-ÿ'’]/.test(words[index]!)) return [`${article[1]}${words.slice(0, index).join(" ")}`, words.slice(index).join(" ")];
    }
    return [line, ""];
  }
  const caps = line.match(/^([A-ZÀ-ÖØ-Þ0-9'’ ,-]{6,}?)\s+([A-ZÀ-ÖØ-Þ][a-zà-öø-ÿ].*)$/);
  return caps ? [caps[1]!.trim(), caps[2]!] : [line, ""];
}
export function normalizeContractBlocks(blocks: ContractBlock[]): ContractBlock[] {
  const out: ContractBlock[] = [];
  for (const block of blocks) {
    if (block.type !== "paragraph" && block.type !== "heading") {
      out.push(block);
      continue;
    }
    const raw = (block.text ?? "").replace(/\r/g, "");
    if (block.type === "heading") {
      out.push({ type: "heading", text: raw.replace(/^\s*#{1,6}\s*/, "").replace(/\*\*/g, "").trim() });
      continue;
    }
    const text = raw.replace(/[ \t]+(#{1,6})[ \t]+(?=\S)/g, "\n$1 ");
    let paragraph: string[] = [];
    const flush = () => {
      const value = paragraph.join("\n").trim();
      if (value) out.push({ type: "paragraph", text: value });
      paragraph = [];
    };
    for (const line of text.split("\n")) {
      const heading = line.match(/^\s*#{1,6}\s+(.+?)\s*$/);
      if (heading) {
        flush();
        const [title, rest] = splitGluedHeading(heading[1]!.replace(/\*\*/g, "").trim());
        out.push({ type: "heading", text: title });
        if (rest) paragraph.push(rest);
        continue;
      }
      paragraph.push(line);
    }
    flush();
  }
  return out;
}
const SIGNATURE_HEADING = /^(signatures?|pour\s+(l['’]\s*employeur|la soci[ée]t[ée]|l['’]entreprise|.{2,60})|l['’]\s*employeur|le travailleur|l['’]employ[ée]|le salari[ée]|employee|employer|worker)\s*:?$/i;
const SIGNATURE_LINE = /^(fait\s+(à|a)\s.*|lu et approuv[ée].*|(nom|pr[ée]nom|fonction|qualit[ée]|date|signature|nom du signataire autoris[ée]|repr[ée]sent[ée]e? par|matricule|poste)\s*:.*|_{3,}.*|\.{3,}.*)$/i;
export function stripTemplateSignatureSection(blocks: ContractBlock[]): ContractBlock[] {
  const plain = (value?: string) => (value ?? "").replace(/^\s*#{1,6}\s*/, "").replace(/\*\*/g, "").trim();
  const isSignatureBlock = (block: ContractBlock) => {
    if (block.type === "page_break") return true;
    if (block.type === "table") return false;
    if (block.type === "heading") return SIGNATURE_HEADING.test(plain(block.text)) || SIGNATURE_LINE.test(plain(block.text));
    const lines = (block.text ?? "").split("\n").map((line) => plain(line)).filter(Boolean);
    return lines.length > 0 && lines.every((line) => SIGNATURE_LINE.test(line) || SIGNATURE_HEADING.test(line));
  };
  let cut = blocks.length;
  while (cut > 0 && isSignatureBlock(blocks[cut - 1]!)) cut -= 1;
  const removed = blocks.slice(cut);
  return removed.some((block) => /signature|lu et approuv|fait\s+(à|a)\s/i.test(block.text ?? "")) ? blocks.slice(0, cut) : blocks;
}

function Rich({ text }: { text: string }) {
  // Non-breaking spaces keep French punctuation with its word (« … ; »).
  const cleaned = text.replace(/\{\{\s*[^}]*\}\}/g, BLANK).replace(/\\$/gm, "").replace(/ ([;:!?»])/g, "\u00a0$1").replace(/« /g, "«\u00a0");
  return (
    <>
      {cleaned.split(/(\*\*[^*]+\*\*)/g).map((part, index) =>
        part.startsWith("**") && part.endsWith("**") && part.length > 4 ? (
          <strong key={index} className="font-semibold text-slate-900">
            {part.slice(2, -2)}
          </strong>
        ) : (
          <span key={index}>{part.replace(/\*\*/g, "")}</span>
        ),
      )}
    </>
  );
}

function Paragraph({ text }: { text: string }) {
  const lines = text.replace(/\r/g, "").split("\n").map((line) => line.trim());
  const items: ReactNode[] = [];
  lines.forEach((line, index) => {
    if (!line || /^---+$/.test(line)) return;
    const numbered = line.match(/^(\d+[.)]|[a-z][.)])\s+(.+)$/i);
    const bullet = line.match(/^[-•*]\s+(.+)$/);
    if (numbered)
      items.push(
        <p key={index} className="flex gap-3 pl-2">
          <span className="w-5 shrink-0 text-right tabular-nums text-slate-500">{numbered[1]}</span>
          <span>
            <Rich text={numbered[2]!} />
          </span>
        </p>,
      );
    else if (bullet)
      items.push(
        <p key={index} className="flex gap-3 pl-3">
          <span className="mt-[0.7em] size-1.5 shrink-0 rounded-full bg-emerald-700" aria-hidden />
          <span>
            <Rich text={bullet[1]!} />
          </span>
        </p>,
      );
    else
      items.push(
        <p key={index} className="sm:text-justify sm:hyphens-auto">
          <Rich text={line} />
        </p>,
      );
  });
  return <div className="space-y-2.5">{items}</div>;
}

const longDate = (value: string | null | undefined, fr: boolean) => {
  if (!value) return null;
  const date = new Date(value.length <= 10 ? `${value}T12:00:00` : value);
  return Number.isNaN(date.getTime()) ? null : new Intl.DateTimeFormat(fr ? "fr-FR" : "en-GB", { dateStyle: "long" }).format(date);
};

function Line({ label, value }: { label: string; value?: string | null }) {
  return (
    <p className="flex items-baseline gap-1.5 text-[13px] text-slate-500">
      <span className="shrink-0">{label} :</span>
      {value?.trim() ? (
        <span className="truncate font-semibold text-slate-900">{value}</span>
      ) : (
        <span className="mb-0.5 min-w-0 flex-1 border-b border-slate-300" aria-hidden />
      )}
    </p>
  );
}

function SignatureColumn({
  fr,
  heading,
  company,
  rows,
  state,
  action,
}: {
  fr: boolean;
  heading: string;
  company?: string;
  rows: { label: string; value?: string | null }[];
  state?: ContractSignatureState;
  action?: ReactNode;
}) {
  const signed = state?.status === "signed";
  const when = longDate(state?.signedAt, fr);
  return (
    <div className="min-w-0">
      <p className="border-b-2 border-emerald-700/70 pb-1 text-[12px] font-bold uppercase tracking-[.08em] text-emerald-900">{heading}</p>
      <div className="mt-3 space-y-1.5">
        {company ? <p className="text-[13px] font-semibold text-slate-900">{company}</p> : null}
        {rows.map((row) => (
          <Line key={row.label} label={row.label} value={row.value} />
        ))}
        <p className="flex items-baseline gap-1.5 pt-1 text-[12px] italic text-slate-500">
          <span className="shrink-0">{fr ? "Mention « Lu et approuvé » :" : "“Read and approved”:"}</span>
          {signed ? <span className="font-medium text-sky-900">{fr ? "Lu et approuvé" : "Read and approved"}</span> : <span className="mb-0.5 flex-1 border-b border-slate-300" aria-hidden />}
        </p>
      </div>
      <div className={`relative mt-2 flex min-h-24 items-center justify-center rounded-md border ${signed ? "border-sky-900/25 bg-sky-50/40" : "border-slate-300 bg-white"}`}>
        <span className="absolute left-2 top-1 text-[10px] text-slate-400">{fr ? "Signature" : "Signature"}</span>
        {signed ? (
          <div className="px-3 py-4 text-center">
            <p className="font-serif text-2xl italic text-sky-900">{state?.signedName}</p>
            <p className="mt-1 inline-flex items-center gap-1 text-[10px] text-slate-500">
              <ShieldCheck className="size-3" />
              {state?.method === "paper"
                ? fr
                  ? "Signé à la main (exemplaire papier)"
                  : "Signed by hand (paper copy)"
                : fr
                  ? "Signé électroniquement via LiteHubs"
                  : "Signed electronically with LiteHubs"}
            </p>
          </div>
        ) : (
          (action ?? null)
        )}
      </div>
      <div className="mt-2">
        <Line label="Date" value={signed ? when : null} />
      </div>
    </div>
  );
}

export function ContractPaper({
  fr,
  title,
  reference,
  versionLabel,
  blocks,
  parties,
  employer,
  employee,
  signedOn,
  employerAction,
  employeeAction,
}: {
  fr: boolean;
  title: string;
  reference: string;
  versionLabel?: string | null;
  blocks: ContractBlock[];
  parties: ContractParties;
  employer?: ContractSignatureState;
  employee?: ContractSignatureState;
  signedOn?: string | null;
  employerAction?: ReactNode;
  employeeAction?: ReactNode;
}) {
  const clean = stripTemplateSignatureSection(normalizeContractBlocks(blocks));
  const hasTitle = clean[0]?.type === "heading";
  const documentTitle = hasTitle ? clean[0]!.text : title;
  const body = hasTitle ? clean.slice(1) : clean;
  const place = parties.city?.trim() || BLANK;
  const date = longDate(signedOn, fr) ?? BLANK;
  return (
    <div className="bg-slate-200/70 px-0 py-0 sm:px-6 sm:py-8">
      <article className="mx-auto max-w-[52rem] bg-white text-slate-800 shadow-[0_1px_3px_rgba(15,23,42,.12),0_18px_40px_-24px_rgba(15,23,42,.45)] sm:rounded-sm">
        <header className="flex items-center justify-between gap-4 border-t-4 border-emerald-700 bg-emerald-50/60 px-5 py-4 sm:px-12">
          <span className="grid size-10 place-items-center rounded-full bg-emerald-700 text-xs font-bold text-white">
            {parties.companyName
              .split(/\s+/)
              .filter(Boolean)
              .slice(0, 2)
              .map((part) => part[0]?.toUpperCase())
              .join("")}
          </span>
          <div className="min-w-0 text-right">
            <p className="truncate text-sm font-bold uppercase tracking-wide text-emerald-950">{parties.companyName}</p>
            <p className="text-[11px] text-slate-500">Réf. {reference}</p>
          </div>
        </header>
        <div className="px-5 pb-10 pt-8 text-[15px] leading-7 sm:px-12 sm:pb-14 sm:pt-10">
          <h1 className="text-balance text-center text-xl font-bold uppercase tracking-wide text-slate-900 sm:text-2xl">{documentTitle}</h1>
          <p className="mt-2 text-center text-xs text-slate-500">
            Réf. {reference}
            {versionLabel ? ` · ${versionLabel}` : ""}
          </p>
          <div className="mx-auto mt-4 h-0.5 w-20 bg-emerald-700" aria-hidden />
          <div className="mt-8 space-y-5">
            {body.map((block, index) => {
              if (block.type === "page_break") return <hr key={index} className="border-dashed border-slate-200" />;
              if (block.type === "heading")
                return (
                  <h2 key={index} className="pt-3 text-[15px] font-bold text-emerald-900">
                    {block.text}
                  </h2>
                );
              if (block.type === "table")
                return (
                  <div key={index} className="overflow-x-auto">
                    <table className="w-full border-collapse text-left text-sm">
                      <tbody>
                        {(block.rows ?? []).map((row, rowIndex) => (
                          <tr key={rowIndex} className={rowIndex === 0 ? "bg-emerald-50 font-semibold text-slate-900" : ""}>
                            {row.map((cell, cellIndex) => (
                              <td key={cellIndex} className="border border-slate-200 px-3 py-2 align-top">
                                {cell}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                );
              return <Paragraph key={index} text={block.text ?? ""} />;
            })}
          </div>
          <section className="mt-10 border-t border-slate-200 pt-6" aria-label={fr ? "Signatures" : "Signatures"}>
            <p className="text-[14px]">
              {fr
                ? `Fait à ${place}, le ${date}, en deux (2) exemplaires originaux, chaque partie reconnaissant avoir reçu le sien.`
                : `Made in ${place}, on ${date}, in two (2) original copies, each party acknowledging receipt of its own.`}
            </p>
            <div className="mt-6 grid gap-8 sm:grid-cols-2">
              <SignatureColumn
                fr={fr}
                heading={fr ? "Pour l’employeur" : "For the employer"}
                company={parties.employerName ?? parties.companyName}
                rows={[
                  { label: fr ? "Représenté par" : "Represented by", value: employer?.status === "signed" ? employer.signedName : null },
                  { label: fr ? "Fonction" : "Title", value: parties.employerRole },
                ]}
                state={employer}
                action={employerAction}
              />
              <SignatureColumn
                fr={fr}
                heading={fr ? "Le travailleur" : "The employee"}
                rows={[
                  { label: fr ? "Nom" : "Name", value: parties.employeeName ?? (employee?.status === "signed" ? employee.signedName : null) },
                  { label: fr ? "Poste" : "Position", value: parties.employeeTitle },
                ]}
                state={employee}
                action={employeeAction}
              />
            </div>
          </section>
        </div>
      </article>
    </div>
  );
}
