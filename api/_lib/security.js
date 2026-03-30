import crypto from "node:crypto";

function getSessionSecret() {
  const value = process.env.APP_SESSION_SECRET;
  if (!value) {
    throw new Error("Variavel de ambiente ausente: APP_SESSION_SECRET");
  }
  return value;
}

function toBase64Url(value) {
  return Buffer.from(value).toString("base64url");
}

function fromBase64Url(value) {
  return Buffer.from(value, "base64url").toString("utf8");
}

export function sha256(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

export function createSignedToken(payload) {
  const body = toBase64Url(JSON.stringify(payload));
  const signature = crypto.createHmac("sha256", getSessionSecret()).update(body).digest("base64url");
  return `${body}.${signature}`;
}

export function verifySignedToken(token, expectedType) {
  if (!token || !token.includes(".")) {
    throw new Error("Sessao invalida.");
  }

  const [body, signature] = token.split(".");
  const expectedSignature = crypto.createHmac("sha256", getSessionSecret()).update(body).digest("base64url");
  const provided = Buffer.from(signature);
  const expected = Buffer.from(expectedSignature);

  if (provided.length !== expected.length || !crypto.timingSafeEqual(provided, expected)) {
    throw new Error("Sessao invalida.");
  }

  const payload = JSON.parse(fromBase64Url(body));
  if (expectedType && payload.type !== expectedType) {
    throw new Error("Sessao invalida.");
  }
  if (!payload.exp || Number(payload.exp) <= Date.now()) {
    throw new Error("Sessao expirada.");
  }
  return payload;
}

export function randomCode(length = 6) {
  const max = 10 ** length;
  const random = crypto.randomInt(0, max);
  return String(random).padStart(length, "0");
}
