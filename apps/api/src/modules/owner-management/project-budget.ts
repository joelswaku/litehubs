export type ProjectBudgetTaskInput = {
  id: string;
  phaseId?: string | null;
  phaseName?: string | null;
  title: string;
  planned: number;
  currencyCode?: string | null;
};

export type ProjectBudgetOrderInput = {
  id: string;
  taskId?: string | null;
  status: string;
  amount: number;
};

export type ProjectBudgetReceiptInput = {
  id: string;
  orderId: string;
  taskId?: string | null;
  status: string;
  amount: number;
};

export type ProjectBudgetExpenseInput = {
  id: string;
  taskId?: string | null;
  receiptId?: string | null;
  expenseType?: "direct_expense" | "receipt_payment" | "reimbursement" | string | null;
  reimbursesExpenseId?: string | null;
  status: string;
  amount: number;
};

export type ProjectTaskBudget = ProjectBudgetTaskInput & {
  committed: number;
  spent: number;
  available: number;
  utilizationPercent: number;
  status:
    | "not_budgeted"
    | "within_budget"
    | "attention"
    | "nearly_exhausted"
    | "over_budget";
};

export type ProjectBudgetCalculation = {
  planned: number;
  allocated: number;
  unallocated: number;
  committed: number;
  spent: number;
  available: number;
  utilizationPercent: number;
  unassignedCommitted: number;
  unassignedSpent: number;
  tasks: ProjectTaskBudget[];
};

const money = (value: number | string | null | undefined) => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

const confirmedReceipt = (status: string) =>
  ["received", "verified"].includes(String(status));
const approvedOrder = (status: string) =>
  // A purchase order remains an engagement once it is released to the
  // supplier. Older records can already say "received" before their receipt
  // has been verified, so they must remain visible in the budget summary.
  ["approved", "sent", "partially_received", "received", "verified"].includes(
    String(status),
  );
const approvedDirectExpense = (status: string) =>
  ["approved", "paid"].includes(String(status));

/**
 * One auditable budget model used by Project Control.  Purchase requests and
 * drafts never enter the calculation. An approved PO reserves its remaining
 * amount; an accepted receipt converts that amount to spent; a supplier
 * payment linked to that receipt is a settlement only and is ignored here.
 */
export function calculateProjectBudget(input: {
  planned: number;
  tasks: ProjectBudgetTaskInput[];
  orders: ProjectBudgetOrderInput[];
  receipts: ProjectBudgetReceiptInput[];
  expenses: ProjectBudgetExpenseInput[];
}): ProjectBudgetCalculation {
  const receiptAmountByOrder = new Map<string, number>();
  const spentByTask = new Map<string, number>();
  const committedByTask = new Map<string, number>();
  let unassignedSpent = 0;
  let unassignedCommitted = 0;

  const add = (map: Map<string, number>, taskId: string | null | undefined, amount: number) => {
    if (!taskId) return false;
    map.set(taskId, (map.get(taskId) ?? 0) + amount);
    return true;
  };

  for (const receipt of input.receipts) {
    if (!confirmedReceipt(receipt.status)) continue;
    const amount = money(receipt.amount);
    receiptAmountByOrder.set(
      receipt.orderId,
      (receiptAmountByOrder.get(receipt.orderId) ?? 0) + amount,
    );
    if (!add(spentByTask, receipt.taskId, amount)) unassignedSpent += amount;
  }

  for (const order of input.orders) {
    if (!approvedOrder(order.status)) continue;
    const outstanding = Math.max(
      money(order.amount) - (receiptAmountByOrder.get(order.id) ?? 0),
      0,
    );
    if (!add(committedByTask, order.taskId, outstanding))
      unassignedCommitted += outstanding;
  }

  for (const expense of input.expenses) {
    if (!approvedDirectExpense(expense.status)) continue;
    const type = String(
      expense.expenseType ?? (expense.receiptId ? "receipt_payment" : "direct_expense"),
    );
    // A payment tied to a confirmed BR already became spent at reception. It
    // remains in the financial history, but never enters project budget twice.
    if (type === "receipt_payment" || expense.receiptId) continue;
    const amount = money(expense.amount) * (type === "reimbursement" ? -1 : 1);
    if (!add(spentByTask, expense.taskId, amount)) unassignedSpent += amount;
  }

  const tasks = input.tasks.map<ProjectTaskBudget>((task) => {
    const planned = money(task.planned);
    const committed = money(committedByTask.get(task.id));
    const spent = money(spentByTask.get(task.id));
    const available = planned - committed - spent;
    const utilizationPercent =
      planned > 0 ? ((committed + spent) / planned) * 100 : 0;
    const status =
      planned <= 0
        ? "not_budgeted"
        : available < 0
          ? "over_budget"
          : utilizationPercent >= 90
            ? "nearly_exhausted"
            : utilizationPercent >= 80
              ? "attention"
              : "within_budget";
    return {
      ...task,
      planned,
      committed,
      spent,
      available,
      utilizationPercent,
      status,
    };
  });

  const planned = money(input.planned);
  const allocated = tasks.reduce((sum, task) => sum + task.planned, 0);
  const committed =
    unassignedCommitted + tasks.reduce((sum, task) => sum + task.committed, 0);
  const spent =
    unassignedSpent + tasks.reduce((sum, task) => sum + task.spent, 0);
  const available = planned - committed - spent;
  return {
    planned,
    allocated,
    unallocated: planned - allocated,
    committed,
    spent,
    available,
    utilizationPercent: planned > 0 ? ((committed + spent) / planned) * 100 : 0,
    unassignedCommitted,
    unassignedSpent,
    tasks,
  };
}