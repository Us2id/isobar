// Remembers small preferences. Storage can be missing or blocked, so every call has a fallback
// and the site works the same without it, just forgetting choices on reload.
const PREFIX = 'isobar.';

export function load(key, fallback) {
  try {
    const value = localStorage.getItem(PREFIX + key);
    return value === null ? fallback : JSON.parse(value);
  } catch {
    return fallback;
  }
}

export function save(key, value) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // Nothing to do: the choice just won't be remembered.
  }
}
