import { PASSWORD_SHA256_HEX, SESSION_KEY } from "./auth-config.js";

const gate = document.getElementById("auth-gate");
const shell = document.getElementById("app-shell");
const form = document.getElementById("auth-form");
const errorEl = document.getElementById("auth-error");
const passwordInput = document.getElementById("auth-password");

async function sha256Hex(text) {
  const data = new TextEncoder().encode(text);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}

async function unlockApp() {
  gate.classList.add("hidden");
  gate.setAttribute("aria-hidden", "true");
  shell.classList.remove("hidden");
  shell.removeAttribute("aria-hidden");
  await import("./app.js?v=13");
}

function hasSession() {
  return sessionStorage.getItem(SESSION_KEY) === "1";
}

async function onSubmit(event) {
  event.preventDefault();
  errorEl.textContent = "";
  const password = passwordInput.value;
  const hash = await sha256Hex(password);
  if (hash === PASSWORD_SHA256_HEX) {
    sessionStorage.setItem(SESSION_KEY, "1");
    passwordInput.value = "";
    await unlockApp();
    return;
  }
  errorEl.textContent = "Fel lösenord. Försök igen.";
  passwordInput.select();
}

if (hasSession()) {
  unlockApp();
} else {
  gate.classList.remove("hidden");
  gate.removeAttribute("aria-hidden");
  shell.classList.add("hidden");
  shell.setAttribute("aria-hidden", "true");
  form.addEventListener("submit", onSubmit);
}
