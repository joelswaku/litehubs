import { describe, expect, it } from "vitest";
import { calculateProjectBudget } from "../../src/modules/owner-management/project-budget";

describe("project budget by task", () => {
  it("moves approved order commitment to spent receipt without double-counting its payment", () => {
    const result = calculateProjectBudget({
      planned: 100_000,
      tasks: [
        { id: "task-a", title: "Task A", planned: 40_000, currencyCode: "CDF" },
        { id: "task-b", title: "Task B", planned: 30_000, currencyCode: "CDF" },
      ],
      orders: [
        { id: "po-a", taskId: "task-a", status: "partially_received", amount: 10_000 },
      ],
      receipts: [
        { id: "br-a", orderId: "po-a", taskId: "task-a", status: "received", amount: 6_000 },
      ],
      expenses: [
        // Payment of BR-A is a settlement record, not a second budget cost.
        { id: "payment-a", taskId: "task-a", receiptId: "br-a", status: "paid", amount: 6_000 },
      ],
    });

    expect(result.allocated).toBe(70_000);
    expect(result.unallocated).toBe(30_000);
    // Accepted receipt: 10,000 order becomes 4,000 committed + 6,000 spent.
    expect(result.committed).toBe(4_000);
    expect(result.spent).toBe(6_000);
    expect(result.available).toBe(90_000);
    expect(result.tasks.find((task) => task.id === "task-a")).toEqual(
      expect.objectContaining({ available: 30_000 }),
    );

    const afterDirectExpense = calculateProjectBudget({
      planned: 100_000,
      tasks: [
        { id: "task-a", title: "Task A", planned: 40_000, currencyCode: "CDF" },
        { id: "task-b", title: "Task B", planned: 30_000, currencyCode: "CDF" },
      ],
      orders: [{ id: "po-a", taskId: "task-a", status: "partially_received", amount: 10_000 }],
      receipts: [{ id: "br-a", orderId: "po-a", taskId: "task-a", status: "received", amount: 6_000 }],
      expenses: [
        { id: "payment-a", taskId: "task-a", receiptId: "br-a", status: "paid", amount: 6_000 },
        { id: "direct-a", taskId: "task-a", status: "approved", amount: 2_000 },
      ],
    });
    expect(afterDirectExpense.spent).toBe(8_000);
    expect(afterDirectExpense.available).toBe(88_000);
    expect(afterDirectExpense.tasks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "task-a",
          planned: 40_000,
          committed: 4_000,
          spent: 8_000,
          available: 28_000,
        }),
        expect.objectContaining({
          id: "task-b",
          planned: 30_000,
          committed: 0,
          spent: 0,
          available: 30_000,
        }),
      ]),
    );
  });

  it("ignores drafts and reverses cancelled receipts and expenses", () => {
    const result = calculateProjectBudget({
      planned: 20_000,
      tasks: [{ id: "task", title: "Task", planned: 10_000 }],
      orders: [
        { id: "draft", taskId: "task", status: "draft", amount: 5_000 },
        { id: "approved", taskId: "task", status: "sent", amount: 7_000 },
      ],
      receipts: [
        { id: "cancelled", orderId: "approved", taskId: "task", status: "cancelled", amount: 3_000 },
      ],
      expenses: [
        { id: "draft-expense", taskId: "task", status: "draft", amount: 4_000 },
        { id: "void-expense", taskId: "task", status: "void", amount: 2_000 },
      ],
    });

    expect(result.committed).toBe(7_000);
    expect(result.spent).toBe(0);
    expect(result.available).toBe(13_000);
    expect(result.tasks[0]).toEqual(
      expect.objectContaining({ committed: 7_000, spent: 0, available: 3_000 }),
    );
  });
  it("keeps a released order committed until its receipt is confirmed", () => {
    const result = calculateProjectBudget({
      planned: 310_000,
      tasks: [],
      orders: [{ id: "po-received", status: "received", amount: 15_000 }],
      receipts: [],
      expenses: [],
    });

    expect(result.committed).toBe(15_000);
    expect(result.spent).toBe(0);
    expect(result.available).toBe(295_000);
  });
  it("counts a direct cost once across approval and payment, then reverses an audited reimbursement", () => {
    const base = {
      planned: 20_000,
      tasks: [{ id: "task-a", title: "Task A", planned: 10_000 }],
      orders: [],
      receipts: [],
    };
    const approved = calculateProjectBudget({
      ...base,
      expenses: [
        { id: "direct", taskId: "task-a", expenseType: "direct_expense", status: "approved", amount: 2_000 },
      ],
    });
    const paid = calculateProjectBudget({
      ...base,
      expenses: [
        { id: "direct", taskId: "task-a", expenseType: "direct_expense", status: "paid", amount: 2_000 },
      ],
    });
    const reimbursed = calculateProjectBudget({
      ...base,
      expenses: [
        { id: "direct", taskId: "task-a", expenseType: "direct_expense", status: "paid", amount: 2_000 },
        { id: "refund", taskId: "task-a", expenseType: "reimbursement", status: "approved", amount: 500 },
      ],
    });

    expect(approved.spent).toBe(2_000);
    expect(paid.spent).toBe(2_000);
    expect(reimbursed.spent).toBe(1_500);
    expect(reimbursed.tasks[0]).toEqual(expect.objectContaining({ available: 8_500 }));
  });

  it("keeps receipt payment and its refund out of the project budget", () => {
    const result = calculateProjectBudget({
      planned: 10_000,
      tasks: [],
      orders: [],
      receipts: [],
      expenses: [
        { id: "payment-1", receiptId: "br-1", expenseType: "receipt_payment", status: "paid", amount: 4_000 },
        { id: "refund-1", receiptId: "br-1", expenseType: "reimbursement", status: "approved", amount: 1_000 },
      ],
    });
    expect(result.spent).toBe(0);
    expect(result.available).toBe(10_000);
  });
});