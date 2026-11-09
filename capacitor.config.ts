import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.acmscontrole.mobile",
  appName: "ACMS Controle",
  webDir: "dist",
  server: {
    // Mantem login, Firebase e APIs no mesmo dominio ja publicado na Vercel.
    url: "https://acms-controle.vercel.app",
    cleartext: false
  },
  plugins: {
    FirebaseAuthentication: {
      providers: ["google.com"],
      skipNativeAuth: false
    }
  }
};

export default config;
