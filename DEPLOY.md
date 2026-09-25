# Deployment manual — Plebeian Market storefront napplet

**For:** Hermes · **Target:** Linux · **Artifact:** `plebiapplet-storefront` → nsite/NIP-5A

Deploying does two things: it uploads the built `index.html` to Blossom servers, and
it publishes a **signed kind-35129 manifest event** to Nostr relays under the
**Palace of Culture** identity.

> That second half is a public publish under a named identity. Relays do not
> reliably forget. Do a `--dry-run` first, every time.

---

## 1. Prerequisites

```bash
node --version    # need 22+
pnpm --version    # need 10.8.0 (the repo pins packageManager)
git --version
deno --version    # needed for the napplet CLI
```

Install what is missing:

```bash
# pnpm + deno (distro-agnostic)
corepack enable && corepack prepare pnpm@10.8.0 --activate
curl -fsSL https://deno.land/install.sh | sh    # then add ~/.deno/bin to PATH
```

The key store needs **libsecret** and a **D-Bus session** (see §5 — this is the
step most likely to bite you on a headless box):

```bash
sudo apt install libsecret-tools dbus-x11        # Debian/Ubuntu
sudo dnf install libsecret gnome-keyring dbus-x11 # Fedora
sudo pacman -S libsecret gnome-keyring           # Arch
```

---

## 2. Pull from GitHub

```bash
git clone https://github.com/BIMbeamFLX/Plebiapplet.git
cd Plebiapplet/plebiapplet-storefront
pnpm install --frozen-lockfile
```

Deploy from `main` unless you are deliberately shipping a branch:

```bash
git checkout main && git pull --ff-only
```

---

## 3. Build and verify — before you deploy anything

```bash
pnpm verify                                        # type-check + single-file build
pnpm exec playwright install --with-deps chromium  # first run on this machine only
pnpm test:conformance
```

**Gate:** the last line must read `RESULT: CONFORMANT`. If it does not, stop — do
not deploy. A non-conformant artifact will load into shells and fail there instead.

Expected shape of a good build:

```bash
ls -la dist/          # exactly one file: index.html, ~55 kB
```

If `dist/` contains anything besides `index.html`, the single-file artifact rule is
broken and the manifest will be wrong. Rebuild; do not hand-edit `dist/`.

---

## 4. Install the napplet CLI

The npm package `@napplet/cli` is version `0.0.0` and ships **Deno sources with no
binary** — `npm i -g` will not give you a `napplet` command. Compile it:

```bash
git clone https://github.com/sandwichfarm/napplet.git ~/src/napplet
cd ~/src/napplet/packages/cli
deno task compile:linux-x86_64        # → dist/napplet-linux-x86_64
sudo install -m 0755 dist/napplet-linux-x86_64 /usr/local/bin/napplet
napplet --help
```

On ARM use `deno task compile:linux-aarch64`. To skip installing, run it in place:

```bash
alias napplet='deno run --allow-read --allow-write --allow-run --allow-env --allow-net ~/src/napplet/packages/cli/src/cli.ts'
```

---

## 5. Register the Palace of Culture key

This is the step you asked about. The CLI keeps the secret in the **OS keychain**,
and the repo only ever stores a *name* pointing at it.

### 5a. Check the key store works first

```bash
napplet keys doctor
```

On Linux the provider is libsecret's `secret-tool`, and it is only considered
available when **`DBUS_SESSION_BUS_ADDRESS` is set**. Over a plain SSH session it
usually is not, and you will get:

```
No native keychain provider is available.
```

Fix it by giving the command a session bus and an unlocked keyring:

```bash
echo $DBUS_SESSION_BUS_ADDRESS        # empty → wrap the command:
dbus-run-session -- bash -c 'napplet keys doctor'
```

If the keyring is locked, unlock it once in the same session:

```bash
dbus-run-session -- bash -c '
  echo -n "$KEYRING_PASSWORD" | gnome-keyring-daemon --unlock
  napplet keys doctor
'
```

Still stuck on a truly headless box? Skip the keychain entirely and use the CI
path in §8 — that is what it is for.

### 5b. Store the key

```bash
napplet keys store --name palace-of-culture --prompt-sec
```

`--prompt-sec` reads the secret from an interactive prompt. **Use this form.** The
alternative, `--sec <secret>`, puts the key in `argv` — visible to any user via
`ps`, and written into `~/.bash_history`. If you ever do use `--sec`, prefix the
command with a space (with `HISTCONTROL=ignorespace`) and rotate afterwards.

Accepted at the prompt: `nsec1…`, a 64-character hex key, or an `nbunksec`.
`bunker://` URLs are **not implemented yet** — the CLI rejects them and tells you
to use `nbunksec` instead.

### 5c. Bind it to this project

```bash
napplet keys use --name palace-of-culture
napplet keys list
```

`keys use` writes `signing.keyReference: "palace-of-culture"` into
`.napplet/config.json`. That file holds the **reference only, never the secret** —
it is safe to commit. Confirm before you ever `git add` it:

```bash
grep -i -E 'nsec|nbunksec|[0-9a-f]{64}' .napplet/config.json   # must print nothing
```

To rotate or remove later:

```bash
napplet keys delete --name palace-of-culture
```

---

## 6. Initialise the deploy config

```bash
napplet init \
  --name plebeian-storefront \
  --source-dir dist \
  --relay wss://relay.plebeian.market \
  --relay wss://nos.lol \
  --relay wss://relay.damus.io \
  --server https://blossom.example.org
```

**`--relay` and `--server` have no defaults** — both lists start empty. Omit them
and deploy has nowhere to upload and nowhere to publish. Repeat each flag per
entry. Substitute the Blossom server(s) Palace of Culture actually uses.

Resulting `.napplet/config.json`:

| Field | Value | Meaning |
| --- | --- | --- |
| `sourceDir` | `dist` | what gets uploaded |
| `relays` | your `--relay` list | where the manifest event is published |
| `blossomServers` | your `--server` list | where the file bytes go |
| `defaultTarget` | `named` | kind 35129, d-tag `plebeian-storefront` |
| `signing.keyReference` | `palace-of-culture` | set by `keys use` in §5c |

Re-running `init` on an existing config is a no-op unless you pass `--force`.

---

## 7. Dry run, then deploy

```bash
napplet deploy --dry-run
```

Read the plan before continuing. Check: the d-tag is `plebeian-storefront`, the
pubkey is Palace of Culture's, the file list is exactly `/index.html`, and the
relay and Blossom lists are the ones you intended.

```bash
napplet deploy
```

Confirm it landed:

```bash
napplet discover
napplet debug --name plebeian-storefront
```

---

## 8. Headless / automated variant

For a box with no D-Bus session, or for CI, use a **revocable** `nbunksec` rather
than the raw nsec — if it leaks you revoke that session instead of rotating the
Palace of Culture identity.

Set `signing.mode` to `ci` in `.napplet/config.json`, then:

```bash
export NAPPLET_CI_SIGNING_KEY=<key-reference>   # or NAPPLET_CI_KEY_REFERENCE
napplet deploy --dry-run
```

To mint the nbunksec from a remote signer:

```bash
napplet keys connect --name palace-of-culture --relay wss://relay.nsec.app
```

Store it in the runner's secret manager, never in the repo. `NAPPLET_DISABLE_KEYCHAIN=true`
forces the keychain provider off if it is misbehaving.

---

## 9. Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| `No native keychain provider is available` | no `DBUS_SESSION_BUS_ADDRESS`, or `secret-tool` missing | §5a — `dbus-run-session`, install `libsecret-tools` |
| `napplet: command not found` | npm package has no binary | §4 — compile with Deno |
| `Invalid --sec. Expected nsec, nbunksec, bunker:// URL, or 64-char hex` | wrong secret format | check for a stray newline or a truncated paste |
| `bunker:// signing is not implemented yet` | using a bunker URL | mint an `nbunksec` via `keys connect` |
| Deploy uploads nothing / publishes nowhere | empty `relays` / `blossomServers` | §6 — they have no defaults |
| `RESULT: NON-CONFORMANT` | bad build | fix the napplet, do not deploy around it |
| `dist/` has more than `index.html` | single-file build broke | `rm -rf dist && pnpm build` |

---

## 10. What is verified here, and what is not

Being straight about provenance so you do not debug my guesses:

**Verified by running it** (on the Windows dev box, same repo): §2 clone and
install, §3 build + conformance (`CONFORMANT`, 5 passed / 0 failed, a single
`dist/index.html` of about 55 kB), and the manifest sidecar shape (kind 35129,
d-tag `plebeian-storefront`, one hashed `/index.html` path tag, one `requires`
tag per domain the napplet asks the shell for: `outbox`, `resource`, `link`,
`storage`, `common`, `count`, `theme`).

**Read from the CLI source, not executed** — §4 through §8. Deno is not installed
on the machine this was written from, so the flags, the keychain behaviour, the
D-Bus requirement, the empty relay/server defaults and the env-var names all come
from reading `@napplet/cli@0.0.0` (`cli.ts` help text, `signing.ts`,
`key-store.ts`, `config.ts`). The CLI is at version `0.0.0` and its repo
(`sandwichfarm/napplet`) differs from the boilerplate's (`napplet/napplet`), so
treat the exact flags as likely-but-unconfirmed and check `napplet --help` on the
box before your first real deploy.

**Never done by tooling or an agent:** supplying the key. The secret is entered by
you at an interactive prompt in §5b and goes straight into the OS keychain.
