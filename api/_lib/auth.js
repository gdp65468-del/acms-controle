import { adminAuth, adminDb } from "./firebaseAdmin.js";

export async function requireTreasurer(req) {
  const header = String(req.headers.authorization || "");
  if (!header.startsWith("Bearer ")) {
    throw new Error("Sessao da tesouraria nao encontrada.");
  }

  const idToken = header.slice("Bearer ".length).trim();
  const decoded = await adminAuth.verifyIdToken(idToken);
  const usersCollection = adminDb.collection("usuarios");
  let profile = null;

  const userSnapshot = await usersCollection.doc(decoded.uid).get();
  if (userSnapshot.exists && userSnapshot.data()?.role === "treasurer") {
    profile = userSnapshot.data() || {};
  }

  if (!profile && decoded.email) {
    const byEmailSnapshot = await usersCollection
      .where("email", "==", decoded.email)
      .where("role", "==", "treasurer")
      .limit(1)
      .get();

    if (!byEmailSnapshot.empty) {
      profile = byEmailSnapshot.docs[0].data() || {};
    }
  }

  if (!profile) {
    throw new Error("Acesso restrito a tesouraria.");
  }

  return {
    uid: decoded.uid,
    email: decoded.email || "",
    profile
  };
}
