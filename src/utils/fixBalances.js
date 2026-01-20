import { db } from "../lib/firebase";
import {
  collection,
  getDocs,
  query,
  where,
  doc,
  updateDoc,
  writeBatch,
} from "firebase/firestore";

/**
 * Recalculates and fixes the balance for all users or a specific user.
 *
 * Logic:
 * Balance = (Sum of Approved/Pending Personal Expenses) - (Sum of Allocations)
 *
 * - Allocations decrease balance (Debt).
 * - Expenses (Pending/Approved) increase balance (Repayment/Justification).
 * - Rejected expenses are ignored (or assumed reversed).
 * - Company expenses are ignored.
 */
export const fixAllUserBalances = async (dryRun = true) => {
  console.log(`Starting Balance Correction (Dry Run: ${dryRun})...`);
  const usersRef = collection(db, "users");
  const usersSnap = await getDocs(usersRef);

  let totalDiscrepancies = 0;
  const batch = writeBatch(db);
  let opCount = 0;

  for (const userDoc of usersSnap.docs) {
    const userId = userDoc.id;
    const userData = userDoc.data();
    const currentBalance = Number(userData.balance) || 0;

    // 1. Fetch Allocations
    const allocQuery = query(
      collection(db, "allocations"),
      where("userId", "==", userId),
    );
    const allocSnap = await getDocs(allocQuery);
    const totalAllocated = allocSnap.docs.reduce(
      (sum, doc) => sum + (Number(doc.data().amount) || 0),
      0,
    );

    // 2. Fetch Expenses
    const expQuery = query(
      collection(db, "expenses"),
      where("userId", "==", userId),
    );
    const expSnap = await getDocs(expQuery);

    let totalExpenses = 0;
    expSnap.docs.forEach((doc) => {
      const data = doc.data();
      // Only count if NOT company expense
      if (!data.isCompanyExpense) {
        // Only count if Pending or Approved
        if (data.status === "pending" || data.status === "approved") {
          totalExpenses += Number(data.amount) || 0;
        }
      }
    });

    // 3. Calculate Correct Balance
    // Balance starts at 0.
    // Allocation means user OWES money (Negative).
    // Expense means user JUSTIFIES money (Positive).
    const correctBalance = totalExpenses - totalAllocated;

    // 4. Check Discrepancy
    if (correctBalance !== currentBalance) {
      console.log(
        `[UserId: ${userId}] (${userData.displayName}) -> Current: ${currentBalance} | Calculated: ${correctBalance} | Diff: ${correctBalance - currentBalance}`,
      );
      console.log(
        `   Allocated: ${totalAllocated}, Expenses: ${totalExpenses}`,
      );

      totalDiscrepancies++;

      if (!dryRun) {
        const userRef = doc(db, "users", userId);
        batch.update(userRef, { balance: correctBalance });
        opCount++;
      }
    }
  }

  if (!dryRun && opCount > 0) {
    await batch.commit();
    console.log(`Successfully updated ${opCount} users.`);
  } else {
    console.log(`Found ${totalDiscrepancies} users with incorrect balances.`);
    if (dryRun) console.log("Run with dryRun=false to apply changes.");
  }

  return { totalDiscrepancies, opCount };
};
