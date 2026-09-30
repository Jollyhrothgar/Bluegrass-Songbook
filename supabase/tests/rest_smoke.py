#!/usr/bin/env python3
"""End-to-end smoke test of the list security migration through PostgREST.

list_security.test.sql proves the policies and grants with role switching.
This proves the same thing over HTTP, the way the browser's supabase-js does
it, with real signed JWTs: named RPC arguments resolve (the client calls
rpc('remove_list_owner', { p_list_id }) and nothing else), anon gets empty
reads rather than errors, and the response shapes are what supabase-auth.js
expects.

Local stack only. Invoked by run.sh, which passes the ports; it writes
fixtures into the throwaway database and never reads any environment secret
(the JWT secret is the published local-development default).
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import subprocess
import sys
import time
import urllib.error
import urllib.request

API = "http://127.0.0.1:54421"
DB = "postgresql://postgres:postgres@127.0.0.1:54422/postgres"
JWT_SECRET = b"super-secret-jwt-token-with-at-least-32-characters-long"  # local default

O = "00000000-0000-0000-0000-0000000000a1"   # owner
F = "00000000-0000-0000-0000-0000000000f1"   # follower
S = "00000000-0000-0000-0000-000000000051"   # stranger
L = "11111111-1111-1111-1111-1111111111a1"   # the list


def b64(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode()


def jwt(role: str, sub: str | None = None) -> str:
    head = b64(json.dumps({"alg": "HS256", "typ": "JWT"}).encode())
    claims = {"role": role, "iss": "supabase-demo", "exp": int(time.time()) + 3600}
    if sub:
        claims["sub"] = sub
    body = b64(json.dumps(claims).encode())
    sig = b64(hmac.new(JWT_SECRET, f"{head}.{body}".encode(), hashlib.sha256).digest())
    return f"{head}.{body}.{sig}"


def call(method: str, path: str, token: str, body=None):
    req = urllib.request.Request(
        API + path, method=method,
        data=json.dumps(body).encode() if body is not None else None,
        headers={"apikey": token, "Authorization": f"Bearer {token}",
                 "Content-Type": "application/json", "Prefer": "return=representation"})
    try:
        with urllib.request.urlopen(req) as r:
            raw = r.read()
            return r.status, json.loads(raw) if raw else None
    except urllib.error.HTTPError as e:
        raw = e.read()
        return e.code, json.loads(raw) if raw else None


failures = []


def check(ok: bool, what: str, detail=None):
    print(("ok   " if ok else "FAIL ") + what + ("" if ok else f"  -> {detail}"))
    if not ok:
        failures.append(what)


sql = f"""
insert into auth.users (id, aud, role, email) values
  ('{O}','authenticated','authenticated','rest-o@test.invalid'),
  ('{F}','authenticated','authenticated','rest-f@test.invalid'),
  ('{S}','authenticated','authenticated','rest-s@test.invalid') on conflict do nothing;
insert into public.user_lists (id, user_id, owners, name) values
  ('{L}','{O}', array['{O}']::uuid[], 'REST list') on conflict do nothing;
insert into public.user_list_items (list_id, song_id, position, metadata) values
  ('{L}','rest-song-1',0,'{{"notes":"n"}}'),('{L}','rest-song-2',1,'{{}}') on conflict do nothing;
insert into public.list_followers (list_id, user_id) values ('{L}','{F}') on conflict do nothing;
"""
subprocess.run(["psql", DB, "-X", "-q", "-v", "ON_ERROR_STOP=1", "-c", sql], check=True)

anon, owner, follower, stranger = jwt("anon"), jwt("authenticated", O), jwt("authenticated", F), jwt("authenticated", S)

# anon: direct reads are empty (not an error), the share-link RPC works.
for table in ("user_lists", "user_list_items", "list_followers"):
    st, body = call("GET", f"/rest/v1/{table}?select=*", anon)
    check(st == 200 and body == [], f"anon GET {table} -> 200 []", (st, body))
st, body = call("POST", "/rest/v1/rpc/get_public_list", anon, {"p_list_id": L})
check(st == 200 and body.get("songs") == ["rest-song-1", "rest-song-2"]
      and body["list"]["name"] == "REST list" and body["is_owner"] is False,
      "anon rpc get_public_list returns list + songs", (st, body))
st, body = call("POST", "/rest/v1/rpc/add_list_owner", anon, {"p_list_id": L, "p_user_id": S})
check(st in (401, 403, 404), "anon rpc add_list_owner is refused", (st, body))
st, body = call("POST", "/rest/v1/rpc/remove_list_owner", anon, {"p_list_id": L})
check(st in (401, 403, 404), "anon rpc remove_list_owner is refused", (st, body))

# stranger: sees nothing of L, can change nothing.
st, body = call("GET", f"/rest/v1/user_lists?id=eq.{L}&select=id", stranger)
check(st == 200 and body == [], "stranger GET user_lists?id=L -> []", (st, body))
st, body = call("GET", f"/rest/v1/user_list_items?list_id=eq.{L}&select=song_id", stranger)
check(st == 200 and body == [], "stranger GET user_list_items?list_id=L -> []", (st, body))
st, body = call("POST", "/rest/v1/rpc/add_list_owner", stranger, {"p_list_id": L, "p_user_id": S})
check(st in (401, 403, 404), "stranger rpc add_list_owner is refused", (st, body))
st, body = call("POST", "/rest/v1/rpc/remove_list_owner", stranger, {"p_list_id": L})
check(st == 200 and body == {"error": "Not an owner"}, "stranger rpc remove_list_owner(p_list_id) -> Not an owner", (st, body))
st, body = call("POST", "/rest/v1/rpc/remove_list_owner", stranger, {"p_list_id": L, "p_user_id": O})
check(st == 404, "remove_list_owner with a p_user_id no longer resolves", (st, body))
st, body = call("DELETE", f"/rest/v1/user_lists?id=eq.{L}", stranger)
check(st in (200, 204) and not body, "stranger DELETE list deletes nothing", (st, body))

# owner: the reads fetchCloudLists() makes (contains filter), items, followers.
st, body = call("GET", f"/rest/v1/user_lists?select=id,name,position,owners,orphaned_at&owners=cs.%7B{O}%7D", owner)
check(st == 200 and [r["id"] for r in body] == [L], "owner GET user_lists?owners=cs.{me}", (st, body))
st, body = call("GET", f"/rest/v1/user_list_items?select=list_id,song_id,position,metadata&list_id=in.({L})", owner)
check(st == 200 and len(body) == 2, "owner GET user_list_items", (st, body))
st, body = call("GET", f"/rest/v1/list_followers?list_id=eq.{L}&select=user_id", owner)
check(st == 200 and [r["user_id"] for r in body] == [F], "owner GET list_followers of own list", (st, body))
st, body = call("POST", "/rest/v1/user_lists", owner, {"user_id": O, "owners": [O], "name": "second", "position": 1})
check(st == 201 and body and body[0]["name"] == "second", "owner creates a list (insert ... returning)", (st, body))
st, body = call("POST", "/rest/v1/user_lists", stranger, {"user_id": S, "owners": [O], "name": "spam", "position": 1})
check(st in (401, 403), "stranger cannot create a list owned by someone else", (st, body))

# follower: the reads fetchFollowedLists() makes.
st, body = call("GET", f"/rest/v1/list_followers?select=list_id&user_id=eq.{F}", follower)
check(st == 200 and body == [{"list_id": L}], "follower GET own list_followers", (st, body))
st, body = call("GET", f"/rest/v1/user_lists?select=id,name,position,owners,orphaned_at&id=in.({L})", follower)
check(st == 200 and [r["id"] for r in body] == [L], "follower GET followed user_lists", (st, body))
st, body = call("GET", f"/rest/v1/user_list_items?select=list_id,song_id,position,metadata&list_id=in.({L})", follower)
check(st == 200 and len(body) == 2 and body[0]["metadata"] == {"notes": "n"}, "follower GET followed user_list_items", (st, body))
st, body = call("POST", "/rest/v1/rpc/remove_list_owner", follower, {"p_list_id": L})
check(st == 200 and body == {"error": "Not an owner"}, "follower rpc remove_list_owner -> Not an owner", (st, body))

# owner leaves through the exact call leaveList() makes.
st, body = call("POST", "/rest/v1/rpc/remove_list_owner", owner, {"p_list_id": L})
check(st == 200 and body.get("status") == "orphaned", "owner rpc remove_list_owner(p_list_id) -> orphaned", (st, body))

# A2: analytics over HTTP.
st, body = call("POST", "/rest/v1/rpc/log_events", anon,
                {"p_visitor_id": "rest-visitor", "p_events": [{"event_name": "rest_smoke"}]})
check(st == 200 and body == 1, "anon rpc log_events -> 1 (was 404 42P01)", (st, body))

sys.exit(1 if failures else 0)
