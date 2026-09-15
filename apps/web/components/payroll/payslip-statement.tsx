type PayslipLine = {
  id: string;
  code: string;
  name: string;
  type: string;
  amount: number;
  basis?: string | null;
};

type PayslipStatementProps = {
  fr: boolean;
  locale: string;
  organization: { name?: string | null; logoUrl?: string | null };
  employee: {
    fullName: string;
    employeeNumber: string;
    jobTitle?: string | null;
  };
  payslip: {
    reference: string;
    payrollRunReference?: string | null;
    periodStart: string;
    periodEnd: string;
    payDate: string;
    currency: string;
    grossPay: number;
    totalDeductions: number;
    netPay: number;
    paymentMethod?: string | null;
    lines: PayslipLine[];
  };
  statusLabel?: string;
  statusHint?: string;
};

const text = (fr: boolean, english: string, french: string) =>
  fr ? french : english;

const amount = (value: number, currency: string, locale: string) =>
  new Intl.NumberFormat(locale, {
    style: "currency",
    currency: /^[A-Z]{3}$/.test(currency) ? currency : "CDF",
    maximumFractionDigits: 0,
  }).format(value || 0);

const date = (value: string | null | undefined, locale: string) =>
  value
    ? new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(
        new Date(`${value.slice(0, 10)}T12:00:00`),
      )
    : "—";

const words = (value: string) =>
  value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());

const isIncomeTax = (line: PayslipLine) =>
  line.type === "deduction" &&
  /(income_?tax|taxe?|imp[ôo]t|withholding)/i.test(line.code);

function AmountLine({
  item,
  currency,
  locale,
  deduction = false,
}: {
  item: PayslipLine;
  currency: string;
  locale: string;
  deduction?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-5 border-b border-slate-200 py-3 last:border-b-0">
      <div className="min-w-0">
        <p className="text-sm font-semibold text-slate-800">{item.name}</p>
        <p className="mt-0.5 text-xs leading-5 text-slate-500">
          {item.basis || words(item.type)}
        </p>
      </div>
      <p
        className={`shrink-0 text-sm font-bold tabular-nums ${deduction ? "text-rose-700" : "text-slate-900"}`}
      >
        {deduction ? "-" : ""}
        {amount(item.amount, currency, locale)}
      </p>
    </div>
  );
}

function Total({
  label,
  value,
  emphatic = false,
}: {
  label: string;
  value: string;
  emphatic?: boolean;
}) {
  return (
    <div
      className={
        emphatic ? "bg-[#182d72] px-4 py-3 text-white" : "bg-blue-50 px-4 py-3"
      }
    >
      <p
        className={
          emphatic
            ? "text-[11px] font-bold uppercase tracking-wide text-blue-100"
            : "text-[11px] font-bold uppercase tracking-wide text-slate-500"
        }
      >
        {label}
      </p>
      <p
        className={`mt-1 font-bold tabular-nums ${emphatic ? "text-xl" : "text-base text-slate-900"}`}
      >
        {value}
      </p>
    </div>
  );
}

/** The same controlled statement is used in HR payroll and the employee account. */
export function PayslipStatement({
  fr,
  locale,
  organization,
  employee,
  payslip,
  statusLabel,
  statusHint,
}: PayslipStatementProps) {
  const organizationName = organization.name?.trim() || "LiteHubs";
  const organizationInitial = organizationName.slice(0, 2).toUpperCase();
  const deductions = payslip.lines.filter((line) => line.type === "deduction");
  const taxLines = deductions.filter(isIncomeTax);
  const incomeTax = taxLines.reduce((total, line) => total + line.amount, 0);
  const otherDeductions = deductions.filter((line) => !isIncomeTax(line));
  const earnings = payslip.lines.filter((line) => line.type === "earning");

  return (
    <article className="mx-auto max-w-[47rem] overflow-hidden rounded-sm bg-white shadow-[0_18px_42px_-26px_rgba(15,23,42,.48)] ring-1 ring-slate-200">
      <div className="relative h-24 overflow-hidden bg-[#121c70] sm:h-28">
        <div
          className="absolute -left-10 -top-8 h-24 w-[62%] -rotate-6 rounded-[50%] bg-[#3868ff] opacity-90"
          aria-hidden
        />
        <div
          className="absolute -right-8 top-7 h-20 w-[65%] rotate-[5deg] rounded-[50%] bg-[#2d43c9]"
          aria-hidden
        />
        <div className="relative flex h-full items-center justify-between gap-4 px-6 text-white sm:px-9">
          <div className="flex min-w-0 items-center gap-3">
            <span className="relative grid size-12 shrink-0 place-items-center overflow-hidden rounded-xl border border-white/25 bg-white/95 p-1 text-sm font-bold text-[#182d72] shadow-sm">
              <span aria-hidden>{organizationInitial}</span>
              {organization.logoUrl ? (
                <img
                  src={organization.logoUrl}
                  alt=""
                  className="absolute inset-0 size-full object-contain p-1"
                />
              ) : null}
            </span>
            <div className="min-w-0">
              <p className="truncate text-[11px] font-semibold uppercase tracking-[.2em] text-blue-100">
                {organizationName}
              </p>
              <p className="mt-1 text-xl font-bold tracking-[-.025em]">
                {text(fr, "PAYSLIP", "BULLETIN DE PAIE")}
              </p>
            </div>
          </div>
          {statusLabel ? (
            <p className="rounded-full border border-white/25 bg-white/10 px-3 py-1.5 text-xs font-semibold">
              {statusLabel}
            </p>
          ) : null}
        </div>
      </div>

      <div className="space-y-6 p-5 text-slate-800 sm:p-9">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 pb-5">
          <div>
            <p className="text-xs font-bold uppercase tracking-[.12em] text-[#182d72]">
              {text(fr, "Payslip reference", "Référence du bulletin")}
            </p>
            <p className="mt-1 text-base font-bold text-slate-900">
              {payslip.reference}
            </p>
          </div>
          <div className="text-left sm:text-right">
            <p className="text-xs font-semibold uppercase tracking-[.1em] text-slate-500">
              {text(fr, "Payment date", "Date de paiement")}
            </p>
            <p className="mt-1 text-sm font-bold text-slate-900">
              {date(payslip.payDate, locale)}
            </p>
            {statusHint ? (
              <p className="mt-1 text-xs font-medium text-slate-500">
                {statusHint}
              </p>
            ) : null}
          </div>
        </div>

        <section>
          <h3 className="inline-flex min-w-52 bg-[#182d72] px-3 py-1.5 text-xs font-bold uppercase tracking-wide text-white">
            {text(fr, "Employee information", "Informations employé")}
          </h3>
          <dl className="grid border border-slate-200 text-sm sm:grid-cols-2">
            <div className="border-b border-slate-200 px-4 py-3 sm:border-r">
              <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                {text(fr, "Full name", "Nom complet")}
              </dt>
              <dd className="mt-1 font-bold text-slate-900">
                {employee.fullName}
              </dd>
            </div>
            <div className="border-b border-slate-200 px-4 py-3">
              <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                {text(fr, "Employee number", "Matricule")}
              </dt>
              <dd className="mt-1 font-bold text-slate-900">
                #{employee.employeeNumber}
              </dd>
            </div>
            <div className="border-b border-slate-200 px-4 py-3 sm:border-b-0 sm:border-r">
              <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                {text(fr, "Position", "Poste")}
              </dt>
              <dd className="mt-1 font-semibold text-slate-900">
                {employee.jobTitle || "—"}
              </dd>
            </div>
            <div className="px-4 py-3">
              <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                {text(fr, "Pay period", "Période de paie")}
              </dt>
              <dd className="mt-1 font-semibold text-slate-900">
                {date(payslip.periodStart, locale)} —{" "}
                {date(payslip.periodEnd, locale)}
              </dd>
            </div>
          </dl>
        </section>

        <section className="grid gap-5 sm:grid-cols-2">
          <div>
            <h3 className="inline-flex min-w-32 bg-[#182d72] px-3 py-1.5 text-xs font-bold uppercase tracking-wide text-white">
              {text(fr, "Earnings", "Gains")}
            </h3>
            <div className="border-x border-b border-slate-200 px-4">
              {earnings.length ? (
                earnings.map((line) => (
                  <AmountLine
                    key={line.id}
                    item={line}
                    currency={payslip.currency}
                    locale={locale}
                  />
                ))
              ) : (
                <p className="py-4 text-sm text-slate-500">
                  {text(fr, "No earnings recorded.", "Aucun gain enregistré.")}
                </p>
              )}
            </div>
          </div>
          <div>
            <h3 className="inline-flex min-w-32 bg-[#182d72] px-3 py-1.5 text-xs font-bold uppercase tracking-wide text-white">
              {text(fr, "Tax and deductions", "Impôt et retenues")}
            </h3>
            <div className="border-x border-b border-slate-200 px-4">
              <AmountLine
                item={
                  taxLines[0] ?? {
                    id: "income-tax",
                    code: "income_tax",
                    name: text(fr, "Income tax", "Impôt sur le revenu"),
                    type: "deduction",
                    amount: 0,
                    basis: text(
                      fr,
                      "No tax withholding configured",
                      "Aucune retenue fiscale configurée",
                    ),
                  }
                }
                currency={payslip.currency}
                locale={locale}
                deduction
              />
              {otherDeductions.length ? (
                otherDeductions.map((line) => (
                  <AmountLine
                    key={line.id}
                    item={line}
                    currency={payslip.currency}
                    locale={locale}
                    deduction
                  />
                ))
              ) : (
                <p className="py-3 text-xs text-slate-500">
                  {text(fr, "No other deductions.", "Aucune autre retenue.")}
                </p>
              )}
            </div>
          </div>
        </section>

        <section className="grid gap-px overflow-hidden rounded-sm border border-[#182d72]/20 bg-[#182d72]/15 sm:grid-cols-2 lg:grid-cols-4">
          <Total
            label={text(fr, "Gross pay", "Brut")}
            value={amount(payslip.grossPay, payslip.currency, locale)}
          />
          <Total
            label={text(fr, "Income tax", "Impôt")}
            value={amount(incomeTax, payslip.currency, locale)}
          />
          <Total
            label={text(fr, "Deductions", "Retenues")}
            value={amount(payslip.totalDeductions, payslip.currency, locale)}
          />
          <Total
            label={text(fr, "Net to pay", "Net à payer")}
            value={amount(payslip.netPay, payslip.currency, locale)}
            emphatic
          />
        </section>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-4 text-xs leading-5 text-slate-500">
          <p>
            {text(
              fr,
              `This personal document was issued by ${organizationName} from its approved payroll cycle.`,
              `Ce document personnel est émis par ${organizationName} dans le cadre de son cycle de paie approuvé.`,
            )}
          </p>
          {payslip.payrollRunReference ? (
            <p className="font-semibold text-slate-600">
              {text(fr, "Payroll reference", "Référence de paie")} :{" "}
              {payslip.payrollRunReference}
            </p>
          ) : null}
          {payslip.paymentMethod ? (
            <p className="font-semibold text-slate-600">
              {text(fr, "Method", "Mode")} : {words(payslip.paymentMethod)}
            </p>
          ) : null}
        </div>
      </div>
    </article>
  );
}
