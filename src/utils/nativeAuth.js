import { Capacitor } from "@capacitor/core";
import { FirebaseAuthentication } from "@capacitor-firebase/authentication";
import { GoogleAuthProvider, signInWithCredential, signOut } from "firebase/auth";

export function isNativeAndroidApp() {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android";
}

function nativeSignInError(error) {
  const message = String(error?.message || "");
  if (/developer_error|10|configuration|google-services|firebaseapp/i.test(message)) {
    return new Error("O login Android ainda nao foi registrado no Firebase. Consulte FIREBASE_ANDROID_SETUP.md antes de gerar outro APK.");
  }
  return error instanceof Error ? error : new Error("Nao foi possivel concluir o login Google no Android.");
}

export async function signInWithNativeGoogle(auth) {
  if (!auth) throw new Error("Firebase nao esta configurado neste aplicativo.");

  try {
    const result = await FirebaseAuthentication.signInWithGoogle({
      useCredentialManager: true
    });
    const idToken = result.credential?.idToken;
    if (!idToken) {
      throw new Error("O Google nao retornou um token de identidade para concluir o login.");
    }
    return signInWithCredential(auth, GoogleAuthProvider.credential(idToken));
  } catch (error) {
    throw nativeSignInError(error);
  }
}

export async function signOutFromNativeGoogle(auth) {
  await FirebaseAuthentication.signOut().catch(() => {});
  if (auth) await signOut(auth);
}
