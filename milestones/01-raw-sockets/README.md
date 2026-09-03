# Milestone 01 — Raw Sockets

**Time budget:** 4–6 hours total, spread across sessions — see breakdown below.
**Prerequisites:** none
**Libraries allowed:** none. `<sys/socket.h>`, `<netinet/in.h>`, `<arpa/inet.h>`, `<unistd.h>` only.

## Why this exists

Most C++ networking gets done through a library — Asio, Qt, gRPC, something in-house.
Any of them will hide `accept()`, `recv()`, and the entire file-descriptor model behind
a friendlier API. Start there and you end up learning the library and the operating
system at the same time, which usually means trusting a black box for the parts you
can't yet distinguish.

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
**Task:** call `socket()`, check the return value, print the fd, `close()` it. Then find
that fd in `/proc/<pid>/fd` and see it pointing at `socket:[...]`. No address, no
network activity yet.
**Worth knowing:** `SOCK_CLOEXEC` can be OR'd straight into the type argument, and the
reason it exists at all is a race — setting the same bit with a later `fcntl()` leaves a
window where another thread's `fork()`+`exec()` leaks your socket to a child that has no
idea it owns it.
**Watch for:** what a negative return means and how to read it with `strerror(errno)`.

### Day 2 — Addresses and byte order
**Concept:** `struct sockaddr_in`, why network byte order exists, `htons`/`htonl`,
`INADDR_ANY` vs. a literal IP.
**Task:** fill in a `sockaddr_in` for port `9000` on `INADDR_ANY`, then dump the struct
byte by byte so the conversion is visible rather than assumed.
**Worth knowing:** `sin_zero` — the eight bytes of padding that exist only so
`sockaddr_in` is the same size as the generic `sockaddr` it gets cast to, which is the
1983 answer to "how do you write a polymorphic C API without void*". Also:
`htons()` compiles to literally nothing on a big-endian machine, and `inet_ntoa()`
returns a pointer to a static buffer, so two calls in one `printf` silently print the
same address twice.
**Watch for:** this is where "why does this look backwards" questions belong — ask
them, that's what byte-order theory is for.

### Day 3 — `bind()` and `listen()`
**Concept:** claiming a port, and the backlog queue `listen()` sets up.
**Task:** extend Day 2 to `bind()` and `listen()`. Run it, kill it, restart it
immediately — reproduce "Address already in use" on purpose. Then find the socket
option that prevents it.
**Worth knowing:** `SO_REUSEADDR` is one letter away from `SO_REUSEPORT`, and they do
very different things — the second lets *multiple processes* bind the same port and has
the kernel load-balance connections between them, which is how modern servers scale
across cores without a single accepting thread. Also: your `listen(fd, 4096)` is
silently clamped to `net.core.somaxconn`, so the number you passed is frequently a
polite suggestion. `ss -ltn` shows the listening socket, and its Send-Q column is the
backlog you actually got.
**Watch for:** find `SO_REUSEADDR` yourself, don't take it as a given. And notice you
are fixing a symptom whose cause (TIME_WAIT) doesn't get explained until Day 8.

### Day 4 — `accept()`
**Concept:** why `accept()` hands back a *different* fd than the one `listen()` used,
and what that implies about the listening socket's lifetime.
**Task:** accept exactly one connection, print the client's IP, close both sockets,
exit. Trigger it with `nc` or `telnet` — no client program yet.
**Worth knowing:** `accept4()` takes the `SOCK_CLOEXEC`/`SOCK_NONBLOCK` flags directly,
for exactly the race described on Day 1. And the client address is filled in *by the
kernel*, which is why you pass a length in and get a length back — the same
value-result parameter pattern that shows up all over this API.
**Watch for:** the single most-missed fact in hand-rolled socket code — confusing the
listening socket with the connected one.

### Day 5 — `recv()`/`send()`, once each
**Concept:** what the return value of `recv()`/`send()` actually means — bytes
transferred, not "the message."
**Task:** after `accept()`, call `recv()` **once**, print what came in and how many
bytes, `send()` those exact bytes back once, then close. No loop.
**Worth knowing:** `MSG_PEEK` reads bytes without consuming them, so you can read the
same data twice and prove the kernel's buffer is a separate thing from yours — a
two-line experiment that makes the whole buffering model concrete. `MSG_WAITALL` and
`MSG_DONTWAIT` are the other two flags worth knowing exist.
**Watch for:** `recv()` returning `0` (the peer sent FIN — an orderly shutdown) vs `-1`
(error). Different things, both must be handled. Don't loop yet, even though you'll
want to.

### Day 6 — The echo loop for one client
**Concept:** TCP is a byte stream, not a message stream — one `send()` does not
correspond to one `recv()` on the other end, and both can do *partial* work in a single
call.
**Task:** turn Day 5 into a loop until the client disconnects. Handle a `send()` that
writes less than you asked.
**Worth knowing:** two classics. First, Nagle's algorithm plus delayed ACK: two
optimisations that are individually sensible and together produce a reproducible ~40ms
stall on small back-and-forth writes — the reason `TCP_NODELAY` exists and gets set by
approximately every RPC library ever written. You can measure it. Second, writing to a
socket the peer already closed raises `SIGPIPE`, whose default action is to *kill your
process* — so a server that doesn't pass `MSG_NOSIGNAL` (or ignore the signal) dies
silently when a client hangs up rudely.
**Watch for:** the classic short-read/short-write bug. Make it fail first — small
buffer, big paste into `nc` — so you've seen the failure before you fix it.

### Day 7 — The outer loop, and the client program
**Concept:** the server as a whole — accept, serve, disconnect, accept again, forever.
Then the mirror image: `connect()` instead of `bind`/`listen`/`accept`.
**Task:** wrap Day 6 in a loop around `accept()`. Then write `src/client.cpp`: connect,
read a line from stdin, send it, print the echo, repeat until EOF.
**Worth knowing:** `shutdown()` is not `close()`. `close()` drops your reference to the
socket; `shutdown(fd, SHUT_WR)` sends FIN while leaving you able to read — a *half*
close, which is how you say "I'm done talking, still listening" and the only correct way
to end a request/response exchange without truncating the reply. Also: `connect()` to a
port with nothing listening fails immediately with `ECONNREFUSED`, because the kernel
answered your SYN with an RST — one of the few times the network gives you a fast, clear
"no".
**Watch for:** nothing new conceptually — this is where the pieces click together.

### Day 8 — Watch it work
**Concept:** everything you've been told so far, made visible. This session is rigor
*and* observability, because the tools are how a senior engineer answers "what is it
actually doing" without guessing.
**Task:** two halves.
1. *Harden.* Check the return value of **every** syscall in both files, print
   `strerror(errno)`, exit non-zero. Compile both with `-Wall -Wextra` and fix every
   warning. Zero tolerance.
2. *Observe.* Run the server and point real tools at it: `strace -e trace=network ./server`
   to watch your own syscall sequence exactly as you wrote it; `ss -tan` to watch the
   connection move through `LISTEN` → `ESTABLISHED` → `TIME_WAIT`; `tcpdump -i lo -n port 9000`
   to see the three-way handshake and the FIN. Then answer the question Day 3 left open:
   *why* was the port still busy after you killed the server, and what is `TIME_WAIT`
   protecting you from?
**Watch for:** if the hardening half breaks something, that's a `TODO` skipped earlier.
The observability half is where Day 1's "there's a state machine in there" stops being
a claim you took on trust.

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
