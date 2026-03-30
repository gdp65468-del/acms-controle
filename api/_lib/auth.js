import { adminAuth, adminDb } from "./firebaseAdmin.js";

export async function requireTreasurer(req) {
  const header = String(req.headers.authorization || "");
  if (!header.startsWith("Bearer ")) {
    throw new Error("Sessao da tesouraria nao encontrada.");
  }

  const idToken = header.slice("Bearer ".length).trim();
  const decoded = await adminAuth.verifyIdToken(idToken);
  const userSnapshot = await adminDb.collection("usuarios").doc(decoded.uid).get();

  if (!userSnapshot.exists || userSnapshot.data()?.role !== "treasurer") {
    throw new Error("Acesso restrito a tesouraria.");
  }

  return {
    uid: decoded.uid,
    email: decoded.email || "",
    profile: userSnapshot.data() || {}
  };
}
