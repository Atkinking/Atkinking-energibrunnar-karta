/**
 * Lösenordskonfiguration (endast hash i repot).
 *
 * Byt lösenord: uppdatera PASSWORD_SHA256_HEX på en rad nedan och pusha.
 * Generera hash: printf 'DITT_LÖSENORD' | sha256sum
 *
 */
export const PASSWORD_SHA256_HEX =
  "526c5927dfd7e658019c0bc362240c8aeaaee74a1f55922ac71b2e403d2779da";

export const SESSION_KEY = "sbc-karta-session";
