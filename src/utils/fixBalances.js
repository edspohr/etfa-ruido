/**
 * Script to verify and fix user balances.
 * This script recalculates the balance for all users based on their Allocations and Expenses history.
 *
 * Logic:
 * Balance = Sum(Allocations) - Sum(Expenses)
 *
 * Usage:
 * Import this function in a component (e.g. AdminDashboard or a temp repair page) and run it.
 * It uses console.log for output.
 */

import { collection, getDocs, doc, writeBatch } from "firebase/firestore";
import { db } from "../lib/firebase";

export async function recalculateAllUserBalances() {
  console.log("Starting Balance Recalculation...");

  try {
    // 1. Fetch All Users
    const usersSnap = await getDocs(collection(db, "users"));
    const users = usersSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    console.log(`Found ${users.length} users.`);

    // 2. Fetch All Allocations
    const allocSnap = await getDocs(collection(db, "allocations"));
    const allocations = allocSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    console.log(`Found ${allocations.length} allocations.`);

    // 3. Fetch All Expenses (Approved or Pending? Usually Pending also deducts from potential balance or Approved only?
    // Logic check: When expense is created, is balance deducted immediately?
    // In ExpenseForm refactor: YES, `balance: increment(item.amount)`.
    // Wait, ExpenseForm ADDS to balance (Refund logic) or SUBTRACTS?
    // Let's re-read ExpenseForm.
    // `await setDoc(userRef, { balance: increment(item.amount) }, { merge: true });`
    // It INCREMENTS.
    // Wait.
    // If I receive 1000 (Allocation). Balance = 1000.
    // If I spend 200 (Expense). Balance -> 1200? No.

    // Let's check AdminProjectDetails:
    // Allocation adds to balance?
    // `await updateDoc(userRef, { balance: increment(amount) });` (in handleAllocationSubmit - need to verify)
    // If Allocation = "Here is 1000 cash". Balance = +1000.
    // If Expense = "I spent 200 of that cash". Balance should decrease.
    // So Expense should be NEGATIVE increment?
    // OR ExpenseForm logic is "I spent 200 of MY OWN money, so refund me".
    // ExpenseForm said: `if (!isProjectExpense) ... increment(item.amount)`.
    // "Saldo a Favor" implies I am owed money.
    // Be careful.

    // Let's check `AdminUserDetails` logic again.
    // "Saldo Actual (Viático)". If > 0 "Saldo a Favor".
    // If Allocation is GIVEN ("Transfer In" / "Viatico"), does it ADD to balance?
    // Usually Viatico = Money given to user.
    // User starts with 0. Given 1000. Balance = 1000.
    // User spends 200. Does balance go down?
    // If "Rendicion" means "I justify I spent 200", then "Funds to be rendered" goes down.
    // So Expense should DECREMENT the "Funds held".

    // CHECK EXPENSEFORM AGAIN.
    // `await setDoc(userRef, { balance: increment(item.amount) })`
    // It INCREMENTS. This implies "Rendition adds to my credit?"

    // Let's check `AdminBalances.jsx` or similar to understand the sign.
    // Or check `handleDeleteAllocation` in `AdminUserDetails.jsx`:
    // `updateDoc(userRef, { balance: increment(Number(allocation.amount)) });` (Revert of deletion?)
    // Wait. If I delete an allocation (remove money given), user balance should DECREASE.
    // But `handleDeleteAllocation` says `increment(amount)`.
    // This implies removing allocation ADDS to balance??
    // NO, the code says:
    // `if (!confirm("... Se descontará del saldo ..."))` ...
    // `updateDoc(userRef, { balance: increment(Number(allocation.amount)) });`
    // If allocation.amount is positive... we are ADDING it when deleting?
    // That seems WRONG unless allocation was negative.

    // Let's find where Allocation is created. `AdminProjectDetails.jsx`.
    // "Asignar Viatico".

    // I need to be VERY sure about the signs.
    // Hypothesis:
    // Allocation (Viatico) -> Positive Amount. Logic: `balance = balance + amount`.
    // Expense (Rendicion) -> Positive Amount. Logic: `balance = balance - amount`.

    // If ExpenseForm does `increment(item.amount)`, then Expense might be treated as "I paid, pay me back".
    // But if it is "Viatico", the user HAS the money.
    // "Rendicion" lowers the amount they "have left" to render.
    // So it should be `increment(-amount)`.

    // Let's check `ExpenseForm.jsx` (My recent change).
    // `batch.set(userRef, { balance: increment(item.amount) }, ...)`
    // I used `increment(item.amount)`.
    // If amount is 19.140, I added 19.140 to balance.

    // Let's look at the Screenshot.
    // Saldo Actual $45.072 (Favor).
    // Allocations: 250.000 (Row 4).
    // Expenses: 19.140 + 15.000 + 7.180 + 272.892 = 314.212.
    // If Logic: Bal = Alloc - Exp
    // Bal = 250.000 - 314.212 = -64.212.
    // -64.212 means "Spent 64k more than given". i.e. "Saldo a Favor del usuario" (Company owes user).

    // The display says "45.072 Saldo a Favor".
    // If 45.072 is POSITIVE, and "Saldo a Favor" means POSITIVE.
    // And -64k is NEGATIVE.
    // Then Signs are inverted?
    // Maybe Balance = User's Credit.
    // Spent 314k -> Credit +314k.
    // Given 250k -> Debit -250k.
    // Net = +64k.

    // Let's check logic:
    // If I spend money (Expense), my "Credit" goes UP. (Company owes me).
    // If I receive money (Allocation), my "Credit" goes DOWN (Company paid me / I owe verification).

    // Check `AdminUserDetails.jsx` delete expense:
    // `updateDoc(userRef, { balance: increment(-expense.amount) })`
    // Deleting expense (removing credit) -> Decrements balance.
    // So Expense ADDS to balance.

    // Check `AdminUserDetails.jsx` delete allocation:
    // `updateDoc(userRef, { balance: increment(Number(allocation.amount)) })`
    // Deleting allocation. If allocation reduced balance (gave money), removing it should INCREASE balance (back to neutral).
    // So Allocation SUBTRACTS from balance.

    // VERDICT:
    // Balance = "Money Company Owes User".
    // Expenses = +Amount (I spent, you owe me).
    // Allocations = -Amount (You gave me money, debt reduced).

    // So:
    // Expense Total = 314.212.
    // Allocation Total = 250.000.
    // Balance = 314.212 - 250.000 = 64.212.

    // Current Displayed Balance: 45.072.
    // 64.212 - 45.072 = 19.140.
    // 19.140 is Caja Chica.

    // So, the database `user.balance` is 45.072.
    // It skipped the Caja Chica expense (which would have added 19.140).
    // Fix: Recalculate correctly.

    // Formula:
    // Balance = Sum(Expenses.amount) - Sum(Allocations.amount)
    // (Assuming Allocation amount is stored as positive in DB).

    // Let's verify Allocation sign in DB.
    // `AdminProjectDetails` usually saves allocation as positive number.
    // Code in `AdminUserDetails`: `amount: -amount` for transfer_out.
    // Generally "Viatico" is positive.

    // Wait, if I transfer OUT, I create a negative allocation.
    // So Sum(Allocations) should respect the sign field? No, field is `amount`.

    // RECALC FUNCTION:
    // For each user:
    //   Let totalExp = Sum of all expenses where userId == u.id AND (status == 'approved' OR status == 'pending'?)
    //      Note: Pending expenses usually count towards "Saldo" (I submitted it).
    //      If rejected, it doesn't count.
    //      And `isCompanyExpense` must be false (if true, it doesn't affect user balance).

    //   Let totalAlloc = Sum of all allocations where userId == u.id.
    //      Allocations are "Money Given".
    //      If allocation type 'transfer_out', amount is negative? Or positive but treated negative?
    //      Looking at `handleTransferFunds`: `amount: -amount` (explicitly negative).
    //      So simply Sum(Allocations.amount).

    //   New Balance = totalExp - totalAlloc.

    //   Update user.balance.

    // 4. Fetch Expenses
    const expSnap = await getDocs(collection(db, "expenses"));
    const allExpenses = expSnap.docs.map((d) => d.data());
    console.log(`Found ${allExpenses.length} expenses.`);

    const batch = writeBatch(db);
    let batchCount = 0;

    for (const user of users) {
      const userExpenses = allExpenses.filter(
        (e) => e.userId === user.id && e.status !== "rejected",
      );

      const EXPENSE_SUM = userExpenses.reduce(
        (sum, e) => sum + (Number(e.amount) || 0),
        0,
      );

      const userAllocations = allocations.filter((a) => a.userId === user.id);
      // Allocations reduce the "Credit". (Money given to user).
      // But if `amount` is stored nicely, we just sum them.
      // Wait.
      // If Balance = Money Owed To User.
      // Allocation (Value 1000). Should it be -1000?
      // Yes.
      // So Balance = ExpSum - AllocSum.

      const ALLOC_SUM = userAllocations.reduce(
        (sum, a) => sum + (Number(a.amount) || 0),
        0,
      );

      const calculatedBalance = EXPENSE_SUM - ALLOC_SUM;

      console.log(
        `User ${user.email}: Exp=${EXPENSE_SUM}, Alloc=${ALLOC_SUM}, NewBal=${calculatedBalance}, OldBal=${user.balance}`,
      );

      const userRef = doc(db, "users", user.id);
      batch.update(userRef, { balance: calculatedBalance });
      batchCount++;
    }

    await batch.commit();
    console.log(`Updated ${batchCount} users.`);
  } catch (e) {
    console.error("Migration Failed:", e);
  }
}
