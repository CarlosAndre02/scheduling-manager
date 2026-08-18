# Certificate authorities

Certificates the application verifies a database server against, shipped inside the image and pointed at by `DATABASE_SSL_CA`.

**Nothing here is secret.** A certificate authority is public by design — it is what lets a client recognise a server, not what lets anyone connect to one. It lives in git so that rotating it is an ordinary reviewed change, and so the image needs no network access or extra credential to obtain it.

## supabase-ca.pem

Not committed by default, because it belongs to whoever's project the database is. Download it from the Supabase dashboard — **Project Settings → Database → SSL Configuration → Download certificate** — and save it here under exactly that name.

It is needed because Supabase presents a chain ending in its own self-signed root, which is not in Node's default trust store. Connecting without it fails with `self-signed certificate in certificate chain`, and connecting with verification disabled would leave the client unable to tell the real server from an impostor.

Point at it through the environment rather than from the Dockerfile, so that running the same image against a plaintext database — the local Postgres, for instance — does not try to negotiate TLS:

```
DATABASE_SSL_CA=/app/certs/supabase-ca.pem
```

## Rotation

The certificate has an expiry, and an expired one fails closed: connections stop rather than degrade. Replacing it is a commit and a rebuild, which the pipeline already does on every push — so the only real requirement is knowing the date before it arrives.
