---
name: setCredential
group: net
title: api.net
signature: (secret: string, address: string): Promise<{ ok: true; has: true } | { ok: false; error: 'blocked' | 'invalid' }>
since: unreleased
preview: net-setcredential
control: base | text | https://git.example.com | address in the setting
control: asked | text | https://git.example.com/api/v4/user | address asked for
---

Hand the loader the secret a server wants in a header -- a GitLab token -- so `api.net.request` can send it and the mod never has to hold it. The manifest declares which header, whichever service it is (`"credential": { "header": "PRIVATE-TOKEN" }`, or `{ "header": "Authorization", "prefix": "Bearer " }`) -- anything but a header that belongs to the transport or the session, such as `Host` or `Cookie`; the secret is bound to the origin of `address`, which has to be one of the mod's `network` settings right now, and the loader attaches it to requests for that origin and for no other.

It is write-only: nothing answers with the secret, not this call, not `hasCredential`, not an error. Code that later rewrites the address setting to somewhere else makes the loader send nothing, rather than the token. It is kept in a file of its own under `~/.betterslack/credentials/`, readable by the user only -- not in `settings.json`, which every backup, every window and every page-start script carries -- and a plain file all the same, to be protected like the token it holds. Removing the mod deletes it.

What this does not do is make the page a sandbox. Every plugin shares it, and the loader is told which mod a request is for by the message the page sends, so another plugin that talks to the loader directly can ask for a request to be made *as this one* -- and read the answer -- or replace the secret. What it can never do is read the token. That is the same review contract as the address (see `api.net.request`), and it is why a mod that holds a token is read before it is merged.

```js
// mod.json: "network": { "settings": ["gitUrl"], "credential": { "header": "PRIVATE-TOKEN" } }
const base = api.settings.get('gitUrl');
const stored = await api.net.setCredential(tokenInput.value, base);
tokenInput.value = '';
if (!stored.ok) return showError(stored.error);

const me = await api.net.request(`${base}/api/v4/user`);
```
