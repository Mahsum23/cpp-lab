# Milestone 01 — Raw Sockets

**Time budget:** 4–6 hours total, spread across sessions — see breakdown below.
**Prerequisites:** none
**Libraries allowed:** none. `<sys/socket.h>`, `<netinet/in.h>`, `<arpa/inet.h>`, `<unistd.h>` only.

## Why this exists

You already await async I/O at work. What you haven't done is see what's underneath it.
Asio will hide `accept()`, `recv()`, and the entire file-descriptor model behind
`async_read` and coroutine suspension. If you go straight to Asio, you'll be learning
the library and the operating system at the same time, and you'll end up trusting a
black box.

Build the black box first. Badly, blockingly, by hand. Then Asio becomes a convenience
rather than a mystery.

## End state

Two programs, same as any "write a socket echo server" spec would ask for:

### `src/server.cpp`
- Listens on port `9000`.
- Accepts a connection, prints the client's IP.
- Reads bytes from the client, writes the same bytes back.
- When the client disconnects, goes back to waiting for the next one. Does not exit.

### `src/client.cpp`
- Connects to `127.0.0.1:9000`.
- Reads lines from stdin, sends each one, prints what comes back.
- Exits cleanly on EOF (Ctrl-D).

**You don't write this in one sitting.** It's eight small pieces below, each one a
session: a bit of theory, a quiz, then a scoped task that's 15–30 minutes of typing,
not an afternoon. Each session's code is a stepping stone toward the two files above —
by the last one you're assembling pieces you've already built and understood, not
writing an echo server from a blank page.

## Sessions

### Day 1 — A socket is a file descriptor
**Concept:** what `socket()` actually allocates, why it returns an `int`, address
families (`AF_INET`) vs. socket types (`SOCK_STREAM`).
**Task:** call `socket()`, check the return value, print the fd, `close()` it. That's
the whole program. No address, no network activity yet.
**Watch for:** what a negative return means and how to read it with `strerror(errno)`.

### Day 2 — Addresses and byte order
**Concept:** `struct sockaddr_in`, why network byte order exists, `htons`/`htonl`,
`INADDR_ANY` vs. a literal IP.
**Task:** fill in a `sockaddr_in` for port `9000` on `INADDR_ANY` and print every field
of it (raw and converted) so the byte-order conversion is visible, not assumed.
**Watch for:** this is the session where "why does this look backwards on my machine"
questions belong — ask them, this is exactly what byte order theory is for.

### Day 3 — `bind()` and `listen()`
**Concept:** claiming a port, and the backlog queue `listen()` sets up.
**Task:** extend Day 2's program to `bind()` and `listen()` on that address. Run it,
kill it, and immediately restart it — reproduce "Address already in use" on purpose.
Then fix it with the socket option that prevents it.
**Watch for:** `SO_REUSEADDR` — find it yourself, don't take it as a given.

### Day 4 — `accept()`
**Concept:** why `accept()` hands back a *different* fd than the one `listen()` used,
and what that implies about the listening socket's lifetime.
**Task:** accept exactly one connection, print the client's IP, then `close()` both
sockets and exit. Connect to it with `nc` or `telnet` to trigger it — no client
program yet.
**Watch for:** this is the single most-missed fact in hand-rolled socket code —
confusing the listening socket with the connected one.

### Day 5 — `recv()`/`send()`, once each
**Concept:** what the return value of `recv()`/`send()` actually means — bytes
transferred, not "the message."
**Task:** after `accept()`, call `recv()` **once**, print what came in and how many
bytes, call `send()` **once** to echo exactly those bytes back, then close. No loop.
**Watch for:** `recv()` returning `0` (orderly shutdown) vs. `-1` (error) — different
things, both must be handled. Don't loop yet, even though you'll want to.

### Day 6 — The echo loop for one client
**Concept:** TCP is a byte stream, not a message stream — one `send()` does not
correspond to one `recv()` on the other end, and `recv()`/`send()` can both do
*partial* work in a single call.
**Task:** turn Day 5 into a loop: keep echoing until `recv()` reports the client
disconnected. Handle a `send()` that doesn't write everything you asked it to in one
call.
**Watch for:** this is the classic short-read/short-write bug. Don't take it on faith —
try to make it fail first (small buffer, big paste into `nc`) so you've actually seen
the failure mode before you fix it.

### Day 7 — The outer loop, and the client program
**Concept:** the server as a whole — accept, serve, disconnect, accept again, forever.
Then the mirror image from the client's side: `connect()` instead of `bind`/`listen`/
`accept`.
**Task:** wrap Day 6 in a loop around `accept()` so the server survives a client
disconnecting. Then write `src/client.cpp`: connect, read a line from stdin, send it,
print the echo, repeat until EOF.
**Watch for:** nothing new conceptually — this is where the pieces click together into
the two real files.

### Day 8 — Hardening pass
**Concept:** none new — this session is about rigor, not material.
**Task:** go back through both files and check the return value of **every** syscall
(`socket`, `bind`, `listen`, `accept`, `recv`, `send`, `close` — all of them), printing
`strerror(errno)` and exiting on failure. Compile both with
`g++ -std=c++20 -Wall -Wextra -o server src/server.cpp` /
`... -o client src/client.cpp` and fix every warning. Zero tolerance here.
**Watch for:** nothing dramatic should happen this session if Days 1–7 were solid —
if something *does* break here, that's a sign a `TODO` got skipped earlier.

## Constraints (apply to every session, not just Day 8)

- No `goto`-free-ing, no RAII wrappers, no abstraction layer. Write it flat and ugly.
  You are learning the syscall sequence, not designing a library. (You'll fix this in 02.)
- Check the return value of every syscall as you go, not as a separate cleanup pass —
  Day 8 is a *check*, not the first time this happens.

## Stretch (only after Day 8 is done and clean)

Make the server handle multiple clients by forking a process per connection. Do NOT use
threads yet — fork is simpler and the isolation makes the ownership question obvious.

## Done when

- [ ] Both programs compile with zero warnings under `-Wall -Wextra`
- [ ] Server survives a client disconnecting and accepts the next one
- [ ] Every syscall return value is checked
- [ ] Short reads/writes are handled correctly
- [ ] You can explain every line without looking it up

## Then

Post the code for review. After review passes, teach-back:
you'll explain the socket lifecycle and why `accept()` works the way it does,
in your own words, and I'll push on the gaps.
