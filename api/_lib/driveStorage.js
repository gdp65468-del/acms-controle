import { Timestamp } from "firebase-admin/firestore";

export const DRIVE_STORAGE_COLLECTION = "resumos_drive";
export const DRIVE_STORAGE_DOCUMENT = "geral";

export async function incrementDriveStorage(adminDb, deltaBytes) {
  const delta = Math.round(Number(deltaBytes || 0));
  if (!delta) return;

  const statsRef = adminDb.collection(DRIVE_STORAGE_COLLECTION).doc(DRIVE_STORAGE_DOCUMENT);
  await adminDb.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(statsRef);
    const currentBytes = Math.max(0, Number(snapshot.data()?.totalBytes || 0));
    transaction.set(
      statsRef,
      {
        totalBytes: Math.max(0, currentBytes + delta),
        updatedAt: Timestamp.now(),
        version: 1
      },
      { merge: true }
    );
  });
}
